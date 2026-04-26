// §3 후속 — TOKEN_ENCRYPTION_KEY rotation batch.
//
// Run from `scheduled()` in `src/index.ts` on the `0 3 * * *` cron. Each tick:
//   1. SELECT N rows from `oauth_tokens` whose `token_version` differs from
//      `TARGET_TOKEN_VERSION` (defined in `src/config/tokenVersion.ts`).
//   2. For each row: decrypt with `TOKEN_ENCRYPTION_KEY_PREV`, re-encrypt with
//      the current `TOKEN_ENCRYPTION_KEY`, UPDATE the row in place with the
//      new ciphertext + bumped version + fresh `rotated_at`.
//   3. Idempotent — incomplete rows naturally roll over to the next tick;
//      concurrent ticks racing the same row see exactly one UPDATE succeed
//      thanks to the `ne(token_version, target)` predicate (zero rows updated
//      means a peer worker already finished, not an error).
//
// CROSS-USER SCAN: this is the ONE legitimate exception to the
// "Tenant isolation" rule in `src/CLAUDE.md`. The WHERE clause filters on
// `token_version` only, with NO `userId` predicate, because the rotation
// cron acts on behalf of the operator, not a request principal. Every other
// `oauth_tokens` query in this codebase MUST keep its
// `where(eq(oauthTokens.userId, ...))` clause — see
// `src/CLAUDE.md` "Token rotation (§3 후속)" for the writer/reader contract.
//
// FAILURE ISOLATION: every per-row failure is warn-only and never rethrown
// (caller `scheduled()` `.catch(warn)`s the entire batch promise). Mirrors
// the §6 Wave A/B observability discipline — observability writes must
// never trigger cron retry, since a retried tick re-issues
// `aesGcmDecrypt` against the same rows and wastes CPU.
//
// PII: `aesGcmDecrypt` plaintext (the refresh token) is NEVER logged. AAD is
// `user:${userId}` where `userId` is a UUID (not PII; same convention as
// `watchRenewal.ts`).
import { and, eq, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { TARGET_TOKEN_VERSION } from "../config/tokenVersion";
import { oauthTokens } from "../db/schema";
import type { Bindings } from "../env";
import { aesGcmDecrypt, aesGcmEncrypt, textEncoder } from "../lib/crypto";

const DEFAULT_BATCH_SIZE = 50;

export type RotationSummary = {
  scanned: number;
  ok: number;
  decrypt_fail_prev: number;
  encrypt_fail: number;
  update_fail: number;
  // Number of stale rows the cron found but could not act on because
  // `TOKEN_ENCRYPTION_KEY_PREV` is unset. Distinct from the success/failure
  // counters so dashboards can distinguish "operator misconfigured" from
  // "Worker failed". See D1 in the plan.
  skipped_no_prev: number;
};

function emptySummary(): RotationSummary {
  return {
    scanned: 0,
    ok: 0,
    decrypt_fail_prev: 0,
    encrypt_fail: 0,
    update_fail: 0,
    skipped_no_prev: 0,
  };
}

export async function rotateBatch(args: {
  db: PostgresJsDatabase;
  env: Bindings;
  batchSize?: number;
  targetVersion?: number;
}): Promise<RotationSummary> {
  const { db, env } = args;
  const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;
  const targetVersion = args.targetVersion ?? TARGET_TOKEN_VERSION;
  const summary = emptySummary();

  if (!env.TOKEN_ENCRYPTION_KEY) {
    // Programmer error — `TOKEN_ENCRYPTION_KEY` is a required binding. Throw
    // instead of warning so the broken deploy is loud at the cron layer.
    throw new Error(
      "tokenRotation: TOKEN_ENCRYPTION_KEY is missing — required binding for the rotation batch.",
    );
  }

  const rows = await db
    .select({
      id: oauthTokens.id,
      userId: oauthTokens.userId,
      iv: oauthTokens.iv,
      encryptedRefreshToken: oauthTokens.encryptedRefreshToken,
    })
    .from(oauthTokens)
    .where(
      and(
        eq(oauthTokens.provider, "google"),
        ne(oauthTokens.tokenVersion, targetVersion),
      ),
    )
    .limit(batchSize);

  summary.scanned = rows.length;

  if (rows.length === 0) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "token rotation tick complete",
        ...summary,
        batchSize,
        targetVersion,
      }),
    );
    return summary;
  }

  const previous = env.TOKEN_ENCRYPTION_KEY_PREV;
  if (previous === undefined || previous === "") {
    // §3 후속 D1 — operator misconfig: stale rows exist but PREV is unset.
    // We CANNOT decrypt without the old key, but we deliberately do NOT
    // mark rows `needs_reauth` here because amplifying an operator typo
    // into mass user logout is worse than the lazy-reauth fallback (the
    // user's next request hits `getGoogleRefreshToken`'s decrypt failure
    // path and propagates the original error). One warn per tick + a
    // distinct counter so dashboards can tell this apart from per-row
    // crypto failures.
    summary.skipped_no_prev = rows.length;
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "token rotation skipped — TOKEN_ENCRYPTION_KEY_PREV not configured but stale rows exist",
        scanned: rows.length,
        targetVersion,
      }),
    );
    return summary;
  }

  for (const row of rows) {
    const aad = textEncoder.encode(`user:${row.userId}`);

    let plaintext: Uint8Array;
    try {
      plaintext = await aesGcmDecrypt(
        previous,
        row.iv,
        row.encryptedRefreshToken,
        aad,
      );
    } catch (err) {
      // §3 후속 D2 — per-row PREV decrypt failure. Could be the row was
      // written under an even-older key, or PREV is wrong, or ciphertext
      // corruption. Warn-only; no `needs_reauth` flip (lazy-reauth on the
      // user's next request handles it cleanly).
      summary.decrypt_fail_prev += 1;
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "token rotation row decrypt failed",
          userId: row.userId,
          rowId: row.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      continue;
    }

    let nextIv: Uint8Array;
    let nextCipher: Uint8Array;
    try {
      const out = await aesGcmEncrypt(env.TOKEN_ENCRYPTION_KEY, plaintext, aad);
      nextIv = out.iv;
      nextCipher = out.ciphertext;
    } catch (err) {
      summary.encrypt_fail += 1;
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "token rotation row encrypt failed",
          userId: row.userId,
          rowId: row.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      continue;
    }

    try {
      // Conditional UPDATE — `ne(tokenVersion, targetVersion)` is the claim:
      // a peer worker that already rotated this row would see zero rows
      // updated here, which we treat as `ok` (no-op idempotent re-run, not
      // an error). Drizzle's `.update()` is fire-and-forget on row count
      // unless we ask for it; we don't, because either way the row ends up
      // at `targetVersion` post-tick.
      await db
        .update(oauthTokens)
        .set({
          encryptedRefreshToken: nextCipher,
          iv: nextIv,
          tokenVersion: targetVersion,
          rotatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(oauthTokens.id, row.id),
            ne(oauthTokens.tokenVersion, targetVersion),
          ),
        );
      summary.ok += 1;
    } catch (err) {
      summary.update_fail += 1;
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "token rotation row update failed",
          userId: row.userId,
          rowId: row.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      continue;
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "token rotation tick complete",
      ...summary,
      batchSize,
      targetVersion,
    }),
  );
  return summary;
}

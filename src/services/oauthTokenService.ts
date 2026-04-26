import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { TARGET_TOKEN_VERSION } from "../config/tokenVersion";
import { oauthTokens } from "../db/schema";
import { aesGcmDecrypt, aesGcmEncrypt, textDecoder, textEncoder } from "../lib/crypto";

// §3 후속 — encryption-key surface passed to `getGoogleRefreshToken` /
// `saveGoogleRefreshToken`. `current` is always required and is the only
// key used for writes. `previous` is populated only during an active
// rotation window; reads fall back to it when the primary key fails so a
// row written under the old key remains accessible until the cron flips
// it. Symmetric shape across read & write callsites makes refactors
// during a rotation cheap.
export type EncryptionKeys = {
  current: string;
  // `string | undefined` (not `previous?: string`) to satisfy
  // `exactOptionalPropertyTypes: true` while letting callers pass
  // `env.TOKEN_ENCRYPTION_KEY_PREV` straight through without first
  // narrowing it.
  previous?: string | undefined;
};

export async function saveGoogleRefreshToken(
  db: PostgresJsDatabase,
  keys: EncryptionKeys,
  params: { userId: string; refreshToken: string; scope: string },
): Promise<void> {
  const aad = textEncoder.encode(`user:${params.userId}`);
  const plaintext = textEncoder.encode(params.refreshToken);
  const { iv, ciphertext } = await aesGcmEncrypt(keys.current, plaintext, aad);

  await db
    .insert(oauthTokens)
    .values({
      userId: params.userId,
      provider: "google",
      encryptedRefreshToken: ciphertext,
      iv,
      scope: params.scope,
      // §3 후속 — stamp the current rotation target on every write so a
      // freshly saved row never enters the cron's "needs rotation" set.
      tokenVersion: TARGET_TOKEN_VERSION,
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        encryptedRefreshToken: ciphertext,
        iv,
        scope: params.scope,
        tokenVersion: TARGET_TOKEN_VERSION,
        rotatedAt: sql`now()`,
        updatedAt: sql`now()`,
        // A successful re-save clears any prior reauth flag.
        needsReauth: false,
        needsReauthReason: null,
      },
    });
}

export async function getGoogleRefreshToken(
  db: PostgresJsDatabase,
  keys: EncryptionKeys,
  userId: string,
): Promise<{ refreshToken: string; scope: string; needsReauth: boolean } | null> {
  const rows = await db
    .select({
      iv: oauthTokens.iv,
      encryptedRefreshToken: oauthTokens.encryptedRefreshToken,
      scope: oauthTokens.scope,
      needsReauth: oauthTokens.needsReauth,
    })
    .from(oauthTokens)
    .where(
      and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const aad = textEncoder.encode(`user:${userId}`);
  // §3 후속 — try the current key first (fast path; matches every row
  // post-rotation). On failure AND when `previous` is configured, try the
  // old key so rows still under the previous version remain readable
  // during the rotation window. If neither succeeds we rethrow the
  // ORIGINAL (current-key) error — preserving the existing reauth signal
  // path. Decrypt failure is NOT mapped to `needs_reauth` here; the
  // caller (`tokenRefresh.ts`) already pivots `invalid_grant` from
  // Google's token endpoint into reauth, and pre-emptively flagging on a
  // crypto error would mass-flip users on a misconfigured PREV.
  let plaintext: Uint8Array;
  try {
    plaintext = await aesGcmDecrypt(
      keys.current,
      row.iv,
      row.encryptedRefreshToken,
      aad,
    );
  } catch (currentErr) {
    if (keys.previous === undefined) throw currentErr;
    try {
      plaintext = await aesGcmDecrypt(
        keys.previous,
        row.iv,
        row.encryptedRefreshToken,
        aad,
      );
    } catch {
      throw currentErr;
    }
  }
  return {
    refreshToken: textDecoder.decode(plaintext),
    scope: row.scope,
    needsReauth: row.needsReauth,
  };
}

export async function markReauthRequired(
  db: PostgresJsDatabase,
  userId: string,
  reason: string,
): Promise<void> {
  await db
    .update(oauthTokens)
    .set({
      needsReauth: true,
      needsReauthReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")),
    );
}

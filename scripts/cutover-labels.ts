#!/usr/bin/env tsx
/**
 * native-labels #04 — one-shot label cutover migration (ADR-0006 Decision 4).
 *
 * For every user with pre-cutover rules (`categories.label_id IS NULL`,
 * not label-deleted), creates a named Google Calendar event label per rule
 * on the PRIMARY calendar ({name: rule name, backgroundColor: classic hex
 * of its colorId}) and fills `categories.label_id`. Existing same-name
 * named labels are LINKED, never duplicated; unnamed system palette slots
 * are never touched (append-only — the user's manual palette is shared
 * property).
 *
 * TRIGGER: operator runs it from a workstation inside the cutover window
 * (post-OAuth-review, pre-launch):
 *   pnpm tsx scripts/cutover-labels.ts --env .prod.vars          # dry-run
 *   pnpm tsx scripts/cutover-labels.ts --env .prod.vars --execute
 *
 * DRY-RUN (default): reads DB + each user's labelProperties (1 GET/user)
 * and prints the full per-user plan (link / append / skip / cap) without
 * writing anywhere — doubling as a pre-cutover token health check.
 *
 * IDEMPOTENT: re-running converges — completed rows are excluded by
 * `label_id IS NULL`, and a half-finished append (label created, DB link
 * crashed) resolves to a same-name LINK on re-run. See cutover-labels-core.ts.
 *
 * APPEND-ONLY + 200 CAP: label writes go through `appendEventLabel` (the
 * sole sanctioned labelProperties writer: fresh re-read before each write,
 * per-write cap check). Additionally the plan pre-checks
 * `existing + planned > 200` and holds ALL of that user's appends (links
 * still run — they don't change the label count).
 *
 * EXIT CODE: 0 only when nothing needs operator attention; 1 when any user
 * was skipped (token issues), any category was skipped (name_too_long /
 * label_claimed / cap), any item failed, or post-run verification found
 * rows still pending beyond the reported skips/failures.
 *
 * SECURITY: never prints tokens, keys, or ciphertext. Emails and rule/label
 * names go to the operator's local console only (label-probe precedent) —
 * this is NOT the Worker log stream, whose redaction contract stays intact.
 *
 * Reads DIRECT_DATABASE_URL + TOKEN_ENCRYPTION_KEY(+_PREV) +
 * GOOGLE_CLIENT_ID/SECRET from the --env file — operator-workstation
 * locality contract (backfill-seeds precedent; never injected into the
 * Worker).
 */
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { appendEventLabel } from "../src/services/eventLabels";
import { getCalendarLabelProperties } from "../src/services/googleCalendar";
import { getGoogleRefreshToken } from "../src/services/oauthTokenService";
import {
  applyUserPlan,
  planCutover,
  type CutoverPlan,
  type PendingCategory,
} from "./cutover-labels-core";

// The sync pipeline is primary-calendar-single (see schema.ts
// `categories.labelId`) — same target as the editor's label creation.
const CALENDAR_ID = "primary";

const envFile = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]!
  : ".dev.vars";
const execute = process.argv.includes("--execute");

loadEnv({ path: envFile });

const dbUrl = process.env["DIRECT_DATABASE_URL"];
const encKey = process.env["TOKEN_ENCRYPTION_KEY"];
const encKeyPrev = process.env["TOKEN_ENCRYPTION_KEY_PREV"];
const clientId = process.env["GOOGLE_CLIENT_ID"];
const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
if (!dbUrl || !encKey || !clientId || !clientSecret) {
  throw new Error(
    `missing env in ${envFile} (need DIRECT_DATABASE_URL, TOKEN_ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)`,
  );
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
    }),
  });
  if (!res.ok) {
    // Google's token-endpoint error body is an error code, not a secret.
    throw new Error(`token refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

type UserRow = { id: string; email: string };
type CategoryRow = { id: string; name: string; color_id: string };

async function main(): Promise<void> {
  const sql = postgres(dbUrl as string, { prepare: false, idle_timeout: 5 });
  const db = drizzle(sql);
  let attention = false;
  try {
    const users = (await sql`
      SELECT DISTINCT u.id, u.email, u.created_at FROM users u
      JOIN categories c ON c.user_id = u.id
      WHERE c.label_id IS NULL AND c.label_deleted_at IS NULL
      ORDER BY u.created_at
    `) as unknown as UserRow[];
    console.log(
      `${execute ? "EXECUTE" : "DRY-RUN"} (${envFile}) — users with pending rules: ${users.length}`,
    );

    for (const user of users) {
      const pendingRows = (await sql`
        SELECT id, name, color_id FROM categories
        WHERE user_id = ${user.id} AND label_id IS NULL AND label_deleted_at IS NULL
        ORDER BY created_at
      `) as unknown as CategoryRow[];
      const claimedRows = (await sql`
        SELECT label_id FROM categories
        WHERE user_id = ${user.id} AND label_id IS NOT NULL
      `) as unknown as Array<{ label_id: string }>;

      console.log(`\n— ${user.email}: pending=${pendingRows.length}`);

      // Token → labelProperties. Any failure here skips the USER (their
      // rows stay pending for a re-run after the operator fixes the cause).
      let accessToken: string;
      try {
        const tok = await getGoogleRefreshToken(
          db,
          { current: encKey!, previous: encKeyPrev },
          user.id,
        );
        if (!tok) {
          console.log(`  SKIP USER: no oauth token row`);
          attention = true;
          continue;
        }
        if (tok.needsReauth) {
          console.log(`  SKIP USER: needs_reauth flagged`);
          attention = true;
          continue;
        }
        accessToken = await refreshAccessToken(tok.refreshToken);
      } catch (err) {
        console.log(
          `  SKIP USER: token unavailable — ${err instanceof Error ? err.message : String(err)}`,
        );
        attention = true;
        continue;
      }

      let plan: CutoverPlan;
      try {
        const labels = await getCalendarLabelProperties(accessToken, CALENDAR_ID);
        const pending: PendingCategory[] = pendingRows.map((r) => ({
          id: r.id,
          name: r.name,
          colorId: r.color_id,
        }));
        plan = planCutover({
          labels,
          pending,
          claimedLabelIds: new Set(claimedRows.map((r) => r.label_id)),
        });
      } catch (err) {
        console.log(
          `  SKIP USER: labelProperties read failed — ${err instanceof Error ? err.message : String(err)}`,
        );
        attention = true;
        continue;
      }

      console.log(
        `  labels existing=${plan.existingLabelCount} plan: link=${plan.links.length} append=${plan.appends.length} skip=${plan.skips.length} capExceeded=${plan.capExceeded}`,
      );
      for (const l of plan.links) console.log(`    link   "${l.name}" -> ${l.labelId}`);
      for (const a of plan.appends) console.log(`    append "${a.name}" ${a.backgroundColor}`);
      for (const s of plan.skips) {
        console.log(`    skip   "${s.name}" (${s.reason})`);
        attention = true;
      }
      if (plan.capExceeded) attention = true;

      if (!execute) continue;

      const result = await applyUserPlan(plan, {
        appendLabel: (input) => appendEventLabel(accessToken, CALENDAR_ID, input),
        linkCategory: async (categoryId, labelId) => {
          const updated = await sql`
            UPDATE categories SET label_id = ${labelId}, updated_at = now()
            WHERE id = ${categoryId} AND user_id = ${user.id} AND label_id IS NULL
            RETURNING id
          `;
          return updated.length > 0;
        },
      });
      console.log(
        `  applied: linked=${result.linked} appended=${result.appended} linkMissed=${result.linkMissed} capHeld=${result.appendsSkippedForCap} failures=${result.failures.length}`,
      );
      for (const f of result.failures) {
        console.log(`    FAIL "${f.name}": ${f.error}`);
      }
      if (result.failures.length > 0) attention = true;

      // Verification (backfill-seeds precedent): every pending row must now
      // be linked except the ones this run explicitly reported.
      const remainRows = (await sql`
        SELECT count(*)::int AS count FROM categories
        WHERE user_id = ${user.id} AND label_id IS NULL AND label_deleted_at IS NULL
      `) as unknown as Array<{ count: number }>;
      const remaining = Number(remainRows[0]?.count ?? 0);
      const expected =
        plan.skips.length + result.appendsSkippedForCap + result.failures.length;
      if (remaining !== expected) {
        console.log(`  VERIFY MISMATCH: remaining=${remaining} expected=${expected}`);
        attention = true;
      } else {
        console.log(`  ✓ verified (remaining=${remaining}, all accounted for)`);
      }
    }

    console.log(
      attention
        ? "\n⚠ attention required — see SKIP/FAIL/capExceeded lines above"
        : "\n✓ cutover clean",
    );
  } finally {
    await sql.end();
  }
  if (attention) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

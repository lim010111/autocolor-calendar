// Watch self-heal — opportunistic Watch channel registration on hot user-facing
// request paths (`/me`, `/sync/run`).
//
// Why this exists:
// - `/sync/bootstrap` registers the channel exactly once at onboarding. There
//   is no other code path that *creates* a Watch channel for a sync_state row —
//   the 6h renewal cron (`renewal.ts`) only refreshes existing channels.
// - If bootstrap was incomplete (transient failure, `WEBHOOK_BASE_URL` unset
//   at the time, …), the user has no Watch channel and webhooks never fire.
//   They have to keep pressing "지금 즉시 동기화" indefinitely.
// - Self-heal closes that gap: on `/me` and `/sync/run` we lazily register
//   when the user's row is missing a channel or its expiration is < 24h away.
//
// The (re)registration itself is owned by `reRegisterWatch` (core); this
// adapter layers the self-heal policy (needs_reauth gate, active/expiring
// decision, 10-min cooldown stamp) on top.
//
// Caller is responsible for `executionCtx.waitUntil(...)` wrapping —
// the helper itself is plain async so it stays trivially testable. See
// `src/CLAUDE.md` "Watch self-heal" for the writer / cooldown contract.

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { oauthTokens, syncState } from "../../db/schema";
import type { Bindings } from "../../env";
import { reRegisterWatch } from "./core";

const SELF_HEAL_THRESHOLD_HOURS = 24;
const SELF_HEAL_COOLDOWN_MIN = 10;

export async function maybeSelfHealWatch(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
): Promise<void> {
  // Dev shell w/o verified custom domain — Google rejects watch.create against
  // workers.dev, so the entire heal block is a no-op there. Mirrors the same
  // guard in `reRegisterWatch` / `renewal.ts`; held here too so we skip the
  // DB reads + cooldown stamp entirely when there's nothing to register.
  if (!env.WEBHOOK_BASE_URL) return;

  // (1) needs_reauth gate. Token refresh is going to fail; firing a Calendar
  // API round-trip just to discover that wastes the user's quota and our
  // subrequest budget. The user's reconnect card is shown by other paths.
  const tokRows = await db
    .select({ needsReauth: oauthTokens.needsReauth })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")))
    .limit(1);
  if (!tokRows[0] || tokRows[0].needsReauth) return;

  // (2) sync_state row — single source of truth for both the heal decision
  // and the cooldown gate.
  const ssRows = await db
    .select({
      calendarId: syncState.calendarId,
      active: syncState.active,
      watchChannelId: syncState.watchChannelId,
      watchExpiration: syncState.watchExpiration,
      lastSelfHealAt: syncState.lastSelfHealAt,
    })
    .from(syncState)
    .where(eq(syncState.userId, userId))
    .limit(1);
  const row = ssRows[0];
  if (!row || !row.active) return;

  const expiringSoon =
    !row.watchChannelId ||
    !row.watchExpiration ||
    new Date(row.watchExpiration).getTime() - Date.now() <
      SELF_HEAL_THRESHOLD_HOURS * 60 * 60 * 1000;
  if (!expiringSoon) return;

  // (3) Cooldown — prevents retry storms when registration keeps failing
  // (rate-limited, backend errors, etc). Caller hits `/me` on every home-card
  // load and we don't want to fire Calendar API once per second.
  if (row.lastSelfHealAt) {
    const ageMs = Date.now() - new Date(row.lastSelfHealAt).getTime();
    if (ageMs < SELF_HEAL_COOLDOWN_MIN * 60 * 1000) return;
  }

  // (4) Stamp BEFORE attempting register — failure-or-success cooldown gate.
  // Two concurrent waitUntil-wrapped calls can both pass step (3) and both
  // stamp here; that's fine — last writer wins, and the core's stop→register
  // absorbs the resulting double-register on the Google side.
  await db
    .update(syncState)
    .set({ lastSelfHealAt: sql`now()` })
    .where(
      and(eq(syncState.userId, userId), eq(syncState.calendarId, row.calendarId)),
    );

  // (5) (Re)register via the shared core. Same stop→register ordering as
  // bootstrap and renewal. The core never throws for the expected outcomes —
  // it returns a result union — so an unexpected throw is the only catch path.
  let result;
  try {
    result = await reRegisterWatch(db, env, userId, row.calendarId);
  } catch {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "watch self-heal failed",
        userId,
        code: "unknown",
      }),
    );
    return;
  }

  if ("ok" in result) {
    console.log(
      JSON.stringify({ level: "info", msg: "watch self-heal ok", userId }),
    );
    return;
  }
  if ("failed" in result) {
    const code =
      result.failed === "reauth_required" ? "reauth_required" : result.kind;
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "watch self-heal failed",
        userId,
        code,
      }),
    );
  }
  // skipped (WEBHOOK_BASE_URL unset) — unreachable past the guard above.
}

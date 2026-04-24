import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../db/schema";

// §6.4 / §4B M4 — per-row concurrency control for the watch-channel
// renewal loop, backed by `sync_state.watch_renewal_in_progress_at`.
//
// This helper is a deliberate sibling of `src/lib/syncClaim.ts` — same
// claim-with-staleness-window pattern and the same `date_trunc('milliseconds',
// now())` ownership probe. We mirror the sync version rather than extracting
// a shared helper on purpose:
//
//   1. The two locks guard different Google API surfaces (events.list +
//      patch vs channels.stop + watch). Collapsing them into one column
//      would block watch renewal while a sync is running, with no data-race
//      justification.
//   2. The TTLs differ (see STALE_WINDOW_MS below). A single helper with a
//      TTL parameter is one layer of indirection past "read the file and
//      understand the lock," and we already pay a near-zero cost by keeping
//      the ownership-aware release cleanly paired to each column.
//
// See `src/lib/syncClaim.ts` for the pooler-compatibility rationale
// (why we don't use `pg_advisory_lock`) — it applies identically here.

// 10-minute stale window. Longer than syncClaim's 5-minute window because
// `channels.stop` + `channels.watch` + a 429 retry can legitimately run
// for tens of seconds, and renewal fires from cron — user-perceived latency
// is not sensitive. If the original worker crashes or hangs, another worker
// (e.g. a future manual-trigger route) can take over after 10 minutes and
// the next cron tick absorbs any transient double-register via Google's
// idempotent `channels.stop` semantics (404 absorbed).
const STALE_WINDOW_MS = 10 * 60 * 1000;

export type ClaimResult =
  | { acquired: true; rowId: string; claimedAt: Date }
  | { acquired: false };

// Claim the renewal slot for (userId, calendarId). Returns `{ acquired: false }`
// if another worker holds the lock and it's not yet stale, so the caller can
// `continue` the row without firing stop/register.
export async function claimWatchRenewal(
  db: PostgresJsDatabase,
  userId: string,
  calendarId: string,
): Promise<ClaimResult> {
  // CRITICAL: truncate `now()` to millisecond precision so `claimedAt` survives
  // the Postgres → postgres.js → JS Date round-trip without drift. See the
  // mirrored explanation in `syncClaim.ts` — the failure mode is identical:
  // without this, `releaseWatchRenewal` compares ms-ISO against the µs value
  // stored in the column and silently no-ops, leaving the lock held until
  // STALE_WINDOW_MS expires.
  const rows = await db
    .update(syncState)
    .set({
      watchRenewalInProgressAt: sql`date_trunc('milliseconds', now())`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(syncState.userId, userId),
        eq(syncState.calendarId, calendarId),
        or(
          isNull(syncState.watchRenewalInProgressAt),
          lt(
            syncState.watchRenewalInProgressAt,
            sql`now() - interval '${sql.raw(String(STALE_WINDOW_MS))} milliseconds'`,
          ),
        ),
      ),
    )
    .returning({
      id: syncState.id,
      watchRenewalInProgressAt: syncState.watchRenewalInProgressAt,
    });
  const row = rows[0];
  if (!row || !row.watchRenewalInProgressAt) return { acquired: false };
  return {
    acquired: true,
    rowId: row.id,
    claimedAt: row.watchRenewalInProgressAt,
  };
}

// Ownership-aware release: only clears the lock if the timestamp still matches
// what we stamped in `claimWatchRenewal`. If another worker re-claimed after
// STALE_WINDOW_MS expired, our late release becomes a no-op rather than
// clobbering their claim. Mirrors `releaseSyncRun`.
//
// Stale-takeover race note: if the 10-minute window elapses while the original
// worker is still running (e.g. stuck in a long retry), a second worker can
// claim and re-run `stop → register`, transiently producing two fresh channels.
// Google's `channels.stop` is idempotent (404 absorbed) and the next cron tick
// reconciles naturally, so this is the same "observed, not prevented" stance
// as the concurrent PATCH race documented in `src/CLAUDE.md` §5.4.
export async function releaseWatchRenewal(
  db: PostgresJsDatabase,
  userId: string,
  calendarId: string,
  claimedAt: Date,
): Promise<void> {
  await db
    .update(syncState)
    .set({ watchRenewalInProgressAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(syncState.userId, userId),
        eq(syncState.calendarId, calendarId),
        eq(syncState.watchRenewalInProgressAt, claimedAt),
      ),
    );
}

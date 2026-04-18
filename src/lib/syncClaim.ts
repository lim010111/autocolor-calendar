import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../db/schema";

// Per-calendar concurrency control via a claim-based lock on
// `sync_state.in_progress_at`.
//
// WHY NOT advisory locks: Supabase Pooler (Transaction mode) multiplexes
// backends between queries, so session-level `pg_advisory_lock` is unreliable
// (the unlock may hit a different backend). Transaction-level
// `pg_advisory_xact_lock` would force us to hold a DB transaction across
// multi-minute Calendar API calls, burning the single pooled connection
// (`max: 1` in our postgres.js client) and starving other work in the isolate.
//
// Claim-based locking with a staleness window is the pooler-compatible
// equivalent: a single atomic UPDATE sets `in_progress_at = now()` only if
// the row is free (null or older than STALE_WINDOW_MS), and the consumer
// clears it on finish. A crashed consumer auto-heals after STALE_WINDOW_MS.
//
// Idempotency makes the edge case safe: even if two runs overlapped (e.g.
// the staleness window expired mid-run), both would see monotonically
// advancing `nextSyncToken` and both patches would be color-equality-skipped
// on the second pass.

const STALE_WINDOW_MS = 5 * 60 * 1000;

export type ClaimResult =
  | { acquired: true; rowId: string; claimedAt: Date }
  | { acquired: false };

export async function claimSyncRun(
  db: PostgresJsDatabase,
  userId: string,
  calendarId: string,
): Promise<ClaimResult> {
  // CRITICAL: truncate `now()` to millisecond precision so `claimedAt` survives
  // the Postgres → postgres.js → JS Date round-trip without drift.
  // Postgres timestamptz stores µs precision; JS `Date` only has ms. Without
  // the truncation, `RETURNING in_progress_at` gives us a ms-precision Date,
  // but the DB column still holds the original µs timestamp — `releaseSyncRun`
  // then compares ms-ISO string against the µs value and misses every time,
  // silently no-op'ing the release. That loses the claim invariant and drops
  // chunked full_resync continuations (next consumer sees fresh in_progress_at
  // and acks-coalesced). See §4A review round 4.
  const rows = await db
    .update(syncState)
    .set({
      inProgressAt: sql`date_trunc('milliseconds', now())`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(syncState.userId, userId),
        eq(syncState.calendarId, calendarId),
        or(
          isNull(syncState.inProgressAt),
          lt(syncState.inProgressAt, sql`now() - interval '${sql.raw(String(STALE_WINDOW_MS))} milliseconds'`),
        ),
      ),
    )
    .returning({ id: syncState.id, inProgressAt: syncState.inProgressAt });
  const row = rows[0];
  if (!row || !row.inProgressAt) return { acquired: false };
  return { acquired: true, rowId: row.id, claimedAt: row.inProgressAt };
}

// Ownership-aware release: only clears `in_progress_at` if it still matches the
// timestamp we set in `claimSyncRun`. Protects the invariant "whoever holds the
// claim releases it" — if another consumer re-claimed after STALE_WINDOW_MS
// expired, our late release becomes a no-op rather than clobbering its claim.
export async function releaseSyncRun(
  db: PostgresJsDatabase,
  userId: string,
  calendarId: string,
  claimedAt: Date,
): Promise<void> {
  await db
    .update(syncState)
    .set({ inProgressAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(syncState.userId, userId),
        eq(syncState.calendarId, calendarId),
        eq(syncState.inProgressAt, claimedAt),
      ),
    );
}

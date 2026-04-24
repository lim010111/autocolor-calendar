// §4C Watch channel renewal — scheduled batch job.
//
// Google caps Watch channel lifetime at 7 days. We renew ~24h before expiry
// to tolerate a missed cron tick without losing real-time push delivery.
// Each user's renewal is independent: we stop the old channel, register a
// fresh one, and continue even if individual users fail (logged per-user;
// the batch keeps going).
//
// Called from `scheduled` handler (wrangler.toml [env.dev.triggers] crons).
// Per-row concurrency is guarded by `claimWatchRenewal` / `releaseWatchRenewal`
// against `sync_state.watch_renewal_in_progress_at` (§6.4 / §4B M4). Cloudflare
// cron does not overlap itself on a single schedule, but adding the claim
// pre-emptively protects against future manual-trigger paths (e.g. an admin
// "renew now" button in §6.3 Wave B follow-ups) racing with a cron tick at
// the stop→register boundary. See `src/CLAUDE.md` "Watch renewal concurrency
// (§6.4)" for the writer/reader contract.

import { and, eq, lt, sql, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../db/schema";
import type { Bindings } from "../env";
import { claimWatchRenewal, releaseWatchRenewal } from "../lib/watchClaim";
import { CalendarApiError } from "./googleCalendar";
import { getValidAccessToken, ReauthRequiredError } from "./tokenRefresh";
import { registerWatchChannel, stopWatchChannel } from "./watchChannel";

// Cloudflare scheduled Workers are CPU-bound (default 30s). Hard cap the
// per-invocation batch so one long tail doesn't starve the remaining work;
// the next cron tick picks up stragglers.
const MAX_PER_RUN = 50;

export type RenewalSummary = {
  scanned: number;
  renewed: number;
  skipped: number;
  failed: number;
};

export async function renewExpiringWatches(
  db: PostgresJsDatabase,
  env: Bindings,
): Promise<RenewalSummary> {
  const summary: RenewalSummary = {
    scanned: 0,
    renewed: 0,
    skipped: 0,
    failed: 0,
  };

  if (!env.WEBHOOK_BASE_URL) {
    // Dev shell w/o verified custom domain — nothing to renew. Log once per
    // tick so ops can tell cron is firing but no-op'd intentionally.
    console.log(
      JSON.stringify({
        level: "info",
        msg: "watch renewal skipped — WEBHOOK_BASE_URL not configured",
      }),
    );
    return summary;
  }

  // timestamptz comparison — NOW() + interval. We purposely don't use a JS
  // Date + `lt` with a prebaked timestamp so timezones don't drift between
  // the Worker's clock and the DB's clock.
  const threshold = sql`now() + interval '24 hours'`;
  const rows = await db
    .select({
      userId: syncState.userId,
      calendarId: syncState.calendarId,
      expiration: syncState.watchExpiration,
    })
    .from(syncState)
    .where(
      and(
        eq(syncState.active, true),
        isNotNull(syncState.watchExpiration),
        lt(syncState.watchExpiration, threshold),
      ),
    )
    .limit(MAX_PER_RUN);

  summary.scanned = rows.length;

  for (const row of rows) {
    // §6.4 concurrency claim. If another worker holds the lock (future manual
    // trigger overlapping cron), skip this row — next cron tick will re-check.
    // Firing stop→register anyway would potentially destroy a fresh channel
    // the other worker just registered.
    const claim = await claimWatchRenewal(db, row.userId, row.calendarId);
    if (!claim.acquired) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "watch renewal skipped — claim not acquired",
          userId: row.userId,
          calendarId: row.calendarId,
        }),
      );
      summary.skipped += 1;
      continue;
    }

    try {
      const { accessToken } = await getValidAccessToken(db, env, row.userId);
      // Stop the old channel first so we don't accumulate duplicates. 404 is
      // absorbed inside stopWatchChannel — expired channels are indistinguishable
      // from "already stopped".
      await stopWatchChannel(db, accessToken, row.userId, row.calendarId);
      await registerWatchChannel(
        db,
        accessToken,
        row.userId,
        row.calendarId,
        env.WEBHOOK_BASE_URL,
      );
      summary.renewed += 1;
    } catch (err) {
      const code =
        err instanceof ReauthRequiredError
          ? "reauth_required"
          : err instanceof CalendarApiError
            ? err.kind
            : "unknown";
      // Reauth is a terminal state (user must re-connect); not a cron retry
      // concern. Rate limit / server errors will be retried next tick.
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "watch renewal failed",
          userId: row.userId,
          calendarId: row.calendarId,
          code,
        }),
      );
      summary.failed += 1;
    } finally {
      // Release before the next iteration so a downstream manual trigger can
      // immediately re-claim this row without waiting STALE_WINDOW_MS.
      // `.catch(warn)` mirrors `llm_calls` / `rollback_runs` fire-and-forget
      // discipline: observability / lock-release failure must not halt the
      // outer renewal loop. A release failure auto-heals after the 10-min
      // stale window regardless.
      await releaseWatchRenewal(
        db,
        row.userId,
        row.calendarId,
        claim.claimedAt,
      ).catch((releaseErr: unknown) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "watch renewal release failed — lock auto-heals after 10min TTL",
            userId: row.userId,
            calendarId: row.calendarId,
            error:
              releaseErr instanceof Error
                ? releaseErr.message
                : String(releaseErr),
          }),
        );
      });
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "watch renewal tick complete",
      ...summary,
    }),
  );

  return summary;
}

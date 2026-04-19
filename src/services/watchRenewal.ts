// §4C Watch channel renewal — scheduled batch job.
//
// Google caps Watch channel lifetime at 7 days. We renew ~24h before expiry
// to tolerate a missed cron tick without losing real-time push delivery.
// Each user's renewal is independent: we stop the old channel, register a
// fresh one, and continue even if individual users fail (logged per-user;
// the batch keeps going).
//
// Called from `scheduled` handler (wrangler.toml [env.dev.triggers] crons).
// Safe to invoke *sequentially* — channels outside the renewal window are
// skipped on each tick. Concurrent invocations against the same row set
// (e.g., cron overlap with a manual admin trigger) would race at the
// stop→register boundary and orphan fresh channels; Cloudflare cron does
// not overlap itself on a single schedule, so we rely on that guarantee
// rather than an in-row claim. Adding a claim is a §6 follow-up once
// manual re-trigger paths exist.

import { and, eq, lt, sql, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../db/schema";
import type { Bindings } from "../env";
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
    }
  }

  // Anything we didn't touch was either not in the renewal window or already
  // renewed earlier this tick via a concurrent run.
  summary.skipped = summary.scanned - summary.renewed - summary.failed;

  console.log(
    JSON.stringify({
      level: "info",
      msg: "watch renewal tick complete",
      ...summary,
    }),
  );

  return summary;
}

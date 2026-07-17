// §4B Google Calendar Watch channel lifecycle — shared (re)registration core.
//
// `reRegisterWatch` is the ONE shared core the four registration entry points
// (bootstrap / selfHeal / renewal / reconnect) compose on top of. It owns the
// WEBHOOK_BASE_URL guard, the access-token fetch (+ ReauthRequiredError
// mapping), the stop → register ordering, and the CalendarApiError →
// ReRegisterResult mapping — the ≈15 lines that were duplicated across all
// four callers. The HTTP-response → CalendarApiError step itself is the
// shared `throwCalendarApiError` factory in googleCalendar.ts (#07), so
// watch ops and event ops can never drift their status→kind mapping apart.
//
// `registerWatchChannel` / `stopWatchChannel` are MODULE-PRIVATE: importable by
// siblings inside `src/services/watch/` only (teardown needs stop), and barred
// from every other path by the ESLint `no-restricted-imports` seam. The prose
// rule in `src/CLAUDE.md` "Watch self-heal" — "never call registerWatchChannel
// directly from a new code path" — is enforced structurally here, not by
// convention. New registration entry points compose `reRegisterWatch`.
//
// Per-channel random tokens are the auth signal for webhook receipt — see
// `receipt.ts` for the verification path and
// drizzle/0005_watch_channel_token.sql for the schema rationale.

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../../db/schema";
import type { Bindings } from "../../env";
import { CalendarApiError, throwCalendarApiError } from "../googleCalendar";
import { getValidAccessToken, ReauthRequiredError } from "../tokenRefresh";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

// Google caps Watch channel lifetime at 7 days. We request the maximum and
// rely on §4C cron renewal (~24h before expiration) to refresh before Google
// stops delivering notifications.
const WATCH_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

type WatchResponse = {
  id: string;
  resourceId: string;
  expiration?: string; // ms timestamp as string per Google's API
};

export type WatchRegistration = {
  channelId: string;
  resourceId: string;
  token: string;
  expiration: Date;
};

/**
 * Registers a new Watch channel for `calendarId`. MODULE-PRIVATE — compose
 * `reRegisterWatch` instead of calling this directly.
 *
 * Caller is responsible for ensuring any previous channel was stopped first —
 * Google accepts overlapping registrations but they double-deliver and share
 * the calendar's per-user channel quota. `stopWatchChannel` should be called
 * before re-registering.
 *
 * `webhookBaseUrl` must be an HTTPS URL on a verified custom domain. Google
 * rejects workers.dev.
 */
export async function registerWatchChannel(
  db: PostgresJsDatabase,
  accessToken: string,
  userId: string,
  calendarId: string,
  webhookBaseUrl: string,
): Promise<WatchRegistration> {
  const channelId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const expirationMs = Date.now() + WATCH_EXPIRATION_MS;

  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: `${webhookBaseUrl.replace(/\/$/, "")}/webhooks/calendar`,
      token,
      expiration: String(expirationMs),
    }),
  });
  if (!res.ok) await throwCalendarApiError(res, "channels.watch");
  const data = (await res.json()) as WatchResponse;

  // Google may clamp expiration — trust the server value when present.
  const expiration = data.expiration
    ? new Date(Number(data.expiration))
    : new Date(expirationMs);

  await db
    .update(syncState)
    .set({
      watchChannelId: data.id,
      watchResourceId: data.resourceId,
      watchChannelToken: token,
      watchExpiration: expiration,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(syncState.userId, userId), eq(syncState.calendarId, calendarId)),
    );

  return {
    channelId: data.id,
    resourceId: data.resourceId,
    token,
    expiration,
  };
}

/**
 * Stops the current Watch channel (if any) and clears the columns. 404 from
 * Google is treated as success — the channel has already expired or never
 * existed, and either way the local state should be cleared. MODULE-PRIVATE.
 */
export async function stopWatchChannel(
  db: PostgresJsDatabase,
  accessToken: string,
  userId: string,
  calendarId: string,
): Promise<void> {
  const rows = await db
    .select({
      channelId: syncState.watchChannelId,
      resourceId: syncState.watchResourceId,
    })
    .from(syncState)
    .where(
      and(eq(syncState.userId, userId), eq(syncState.calendarId, calendarId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.channelId || !row.resourceId) return;

  const res = await fetch(`${CALENDAR_BASE}/channels/stop`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: row.channelId, resourceId: row.resourceId }),
  });
  if (!res.ok && res.status !== 404) {
    await throwCalendarApiError(res, "channels.stop");
  }

  await db
    .update(syncState)
    .set({
      watchChannelId: null,
      watchResourceId: null,
      watchChannelToken: null,
      watchExpiration: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(syncState.userId, userId), eq(syncState.calendarId, calendarId)),
    );
}

// Result of a (re)registration attempt. The four registration entry points
// branch on this union and layer their own policy (enqueue / cooldown stamp /
// claim / active gate) on top. Unexpected (non-reauth, non-CalendarApiError)
// failures are NOT folded into this union — `reRegisterWatch` rethrows them so
// each caller preserves its prior handling (reconnect → 500, the rest → a
// best-effort "unknown" warn).
export type ReRegisterResult =
  | { ok: true; expiration: Date }
  | { skipped: "webhook_unconfigured" }
  | { failed: "reauth_required" }
  | { failed: "api_error"; kind: CalendarApiError["kind"] };

/**
 * The shared (re)registration core. Guards on WEBHOOK_BASE_URL, fetches a valid
 * access token (mapping ReauthRequiredError → `reauth_required`), stops any
 * existing channel, registers a fresh one, and classifies a CalendarApiError
 * into `api_error` + kind. The `oauth_tokens.needs_reauth` *column* precheck is
 * deliberately left to callers (a round-trip optimisation + per-caller policy).
 */
export async function reRegisterWatch(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
  calendarId: string,
): Promise<ReRegisterResult> {
  // Dev shells leave WEBHOOK_BASE_URL unset (Google rejects workers.dev for
  // watch.create), so the entire path no-ops there — before paying a token
  // round-trip. Mirrors the guard the four callers used to hold individually.
  if (!env.WEBHOOK_BASE_URL) return { skipped: "webhook_unconfigured" };

  let accessToken: string;
  try {
    ({ accessToken } = await getValidAccessToken(db, env, userId));
  } catch (err) {
    if (err instanceof ReauthRequiredError) return { failed: "reauth_required" };
    throw err;
  }

  try {
    await stopWatchChannel(db, accessToken, userId, calendarId);
    const reg = await registerWatchChannel(
      db,
      accessToken,
      userId,
      calendarId,
      env.WEBHOOK_BASE_URL,
    );
    return { ok: true, expiration: reg.expiration };
  } catch (err) {
    if (err instanceof CalendarApiError) {
      return { failed: "api_error", kind: err.kind };
    }
    throw err;
  }
}

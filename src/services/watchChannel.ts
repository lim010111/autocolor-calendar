// §4B Google Calendar Watch channel lifecycle.
//
// Register: mints a random channel ID + token, POSTs /events/watch with the
// webhook URL, persists (channel_id, resource_id, token, expiration) on the
// sync_state row. Stop: POSTs /channels/stop and clears the columns.
//
// Per-channel random tokens are the auth signal for webhook receipt — see
// routes/webhooks.ts for the verification path and
// drizzle/0005_watch_channel_token.sql for the schema rationale.

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../db/schema";
import { CalendarApiError } from "./googleCalendar";

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

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

function classify(
  status: number,
  reason: string | undefined,
): CalendarApiError["kind"] {
  if (status === 401) return "auth";
  if (status === 403) {
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return "rate_limited";
    }
    return "forbidden";
  }
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unknown";
}

async function throwWatchError(res: Response, op: string): Promise<never> {
  let body: GoogleErrorBody = {};
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    // swallow — don't leak response text
  }
  const reason = body.error?.errors?.[0]?.reason;
  const kind = classify(res.status, reason);
  throw new CalendarApiError(
    kind,
    res.status,
    reason,
    `${op} failed: ${res.status}${reason ? ` (${reason})` : ""}`,
  );
}

export type WatchRegistration = {
  channelId: string;
  resourceId: string;
  token: string;
  expiration: Date;
};

// Constant-time token comparison. Workers Runtime lacks
// `crypto.subtle.timingSafeEqual`, so we XOR byte-by-byte. The length check is
// a short-circuit — a length mismatch is inherently a negative and doesn't
// leak useful timing since the legitimate token length is public anyway.
export function verifyChannelToken(
  stored: string | null | undefined,
  received: string | null | undefined,
): boolean {
  if (!stored || !received) return false;
  if (stored.length !== received.length) return false;
  let mismatch = 0;
  for (let i = 0; i < stored.length; i++) {
    mismatch |= stored.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Registers a new Watch channel for `calendarId`.
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
  if (!res.ok) await throwWatchError(res, "channels.watch");
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
 * existed, and either way the local state should be cleared.
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
    await throwWatchError(res, "channels.stop");
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

export type ChannelLookup = {
  userId: string;
  calendarId: string;
  storedToken: string;
  active: boolean;
};

/**
 * Resolves a (channelId, resourceId) pair sent via X-Goog-* headers back to
 * the owning sync_state row. Returns null when no row matches — caller must
 * treat this as "unauthorized" (we don't own this channel) rather than 404,
 * to avoid an enumeration oracle.
 */
export async function lookupChannelOwner(
  db: PostgresJsDatabase,
  channelId: string,
  resourceId: string,
): Promise<ChannelLookup | null> {
  const rows = await db
    .select({
      userId: syncState.userId,
      calendarId: syncState.calendarId,
      storedToken: syncState.watchChannelToken,
      active: syncState.active,
    })
    .from(syncState)
    .where(
      and(
        eq(syncState.watchChannelId, channelId),
        eq(syncState.watchResourceId, resourceId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.storedToken) return null;
  return {
    userId: row.userId,
    calendarId: row.calendarId,
    storedToken: row.storedToken,
    active: row.active,
  };
}

// Re-export for call sites that need to narrow on watch-specific failures.
export { CalendarApiError };

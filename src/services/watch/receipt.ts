// §4B Google Calendar Watch webhook receipt — inbound verification.
//
// These run on the webhook-delivery path (routes/webhooks.ts), not the
// registration path, so they stay PUBLIC (re-exported from the barrel) and
// outside the register/stop privacy seam. Per-channel random tokens are the
// auth signal; see drizzle/0005_watch_channel_token.sql for the rationale.

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../../db/schema";

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

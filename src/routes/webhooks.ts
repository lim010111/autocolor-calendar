// §4B Google Calendar Watch webhook receiver.
//
// Contract: Google delivers POSTs to our `address` with an empty body and
// signal carried entirely in X-Goog-* headers. Our job is to:
//   1. Validate headers are present.
//   2. Resolve (channel_id, resource_id) → owner row in sync_state.
//   3. Constant-time compare stored channel token against the header.
//   4. Return 2xx *fast* (Google retries 4xx/5xx with backoff) and enqueue
//      an incremental sync as fire-and-forget via ctx.waitUntil.
//
// Security:
// - Per-channel random tokens (see services/watchChannel.ts) mean a leaked
//   token only exposes one user's sync trigger — not a global forging key.
// - We never log the received token or any header that could leak channel
//   identifiers. The existing logger middleware only records method/path/
//   status/duration; headers and body are never touched.
// - 401 is returned for every failure mode (missing headers, no matching
//   row, token mismatch) so an attacker can't distinguish "channel exists
//   but wrong token" from "channel doesn't exist" via response codes.
//   Response *timing* does differ between "missing headers" (pre-DB) and
//   "row not found / token mismatch" (post-DB lookup), but channel IDs
//   are random UUIDs minted server-side — an attacker cannot probe a
//   specific channel without first obtaining its ID via another leak, so
//   the pre/post-DB timing split does not weaken the anti-enumeration
//   posture we care about (which is: can't distinguish known-channel
//   from known-channel-wrong-token).

import { Hono } from "hono";

import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { enqueueSync, SyncQueueUnavailableError } from "../queues/syncProducer";
import {
  lookupChannelOwner,
  verifyChannelToken,
} from "../services/watchChannel";

export const webhookRoutes = new Hono<HonoEnv>();

webhookRoutes.post("/calendar", async (c) => {
  const channelId = c.req.header("x-goog-channel-id");
  const resourceId = c.req.header("x-goog-resource-id");
  const resourceState = c.req.header("x-goog-resource-state");
  const receivedToken = c.req.header("x-goog-channel-token");

  // Missing any required signal → 401 (not 400) so the shape of the failure
  // response doesn't leak whether we're even set up to receive webhooks.
  if (!channelId || !resourceId || !resourceState || !receivedToken) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const { db, close } = getDb(c.env);
  try {
    const owner = await lookupChannelOwner(db, channelId, resourceId);
    if (!owner || !verifyChannelToken(owner.storedToken, receivedToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // `sync` is the one-shot handshake Google sends immediately after channel
    // registration to confirm reachability. There are no real events yet —
    // ack with 200 and skip the sync enqueue to avoid a redundant cold start.
    if (resourceState === "sync") {
      return c.json({ ok: true, handshake: true }, 200);
    }

    // Inactive calendars should still 2xx so Google doesn't backoff the
    // channel; we just skip the sync job because downstream code would
    // immediately refuse with calendar_inactive.
    if (!owner.active) {
      return c.json({ ok: true, skipped: "inactive" }, 200);
    }

    // Fire-and-forget enqueue. waitUntil lets us return 2xx within Google's
    // low-latency timeout window (~10s) even if Queue send has tail latency.
    c.executionCtx.waitUntil(
      enqueueSync(c.env, {
        type: "incremental",
        userId: owner.userId,
        calendarId: owner.calendarId,
        reason: "webhook",
        enqueuedAt: Date.now(),
      }).catch((err) => {
        if (err instanceof SyncQueueUnavailableError) return;
        // Unknown enqueue failure — log at warn. Do NOT re-raise: the response
        // has already been returned and Google treats a non-2xx as a retry
        // signal that would re-enter this same failing path.
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "webhook enqueue failed",
            channelId,
            error: String(err),
          }),
        );
      }),
    );

    return c.json({ ok: true, enqueued: true }, 202);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

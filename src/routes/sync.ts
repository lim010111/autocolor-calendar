import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db";
import { oauthTokens, syncState } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { enqueueSync, SyncQueueUnavailableError } from "../queues/syncProducer";
import { CalendarApiError } from "../services/googleCalendar";
import { getValidAccessToken, ReauthRequiredError } from "../services/tokenRefresh";
import { registerWatchChannel, stopWatchChannel } from "../services/watchChannel";

export const syncRoutes = new Hono<HonoEnv>();

const PRIMARY = "primary";
const COALESCE_WINDOW_SECONDS = 30;

syncRoutes.use("*", authMiddleware);

syncRoutes.post("/run", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    // Reauth guard — fail fast if the refresh token is known-bad.
    const tokRows = await db
      .select({ needsReauth: oauthTokens.needsReauth })
      .from(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")))
      .limit(1);
    if (!tokRows[0] || tokRows[0].needsReauth) {
      return c.json({ error: "reauth_required" }, 503);
    }

    // Upsert sync_state row for primary calendar.
    await db
      .insert(syncState)
      .values({ userId, calendarId: PRIMARY })
      .onConflictDoNothing();

    // Read current state. Coalesce only if the CONSUMER has a fresh claim
    // (in_progress_at set and young) — we never stamp it here, because that
    // would block the consumer we just woke up.
    const rows = await db
      .select({
        nextSyncToken: syncState.nextSyncToken,
        inProgressAt: syncState.inProgressAt,
        lastManualTriggerAt: syncState.lastManualTriggerAt,
        updatedAt: syncState.updatedAt,
        active: syncState.active,
      })
      .from(syncState)
      .where(
        and(eq(syncState.userId, userId), eq(syncState.calendarId, PRIMARY)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ error: "internal" }, 500);
    }
    if (!row.active) {
      return c.json({ error: "calendar_inactive" }, 409);
    }

    const now = Date.now();
    const inProgFresh =
      row.inProgressAt &&
      now - new Date(row.inProgressAt).getTime() < COALESCE_WINDOW_SECONDS * 1000;
    if (inProgFresh) {
      return c.json({ ok: true, enqueued: false, coalesced: true }, 200);
    }
    // §6.4 — per-user manual-trigger rate limit. `last_manual_trigger_at` is
    // stamped only by this route on successful enqueue, so the consumer's
    // own claim/release/summary writes (which touch `updated_at`) no longer
    // lock out a re-trigger inside the 30s window. Pre-migration rows have
    // NULL here; we fall back to `updated_at` in that case to preserve the
    // pre-split behavior until the first post-deploy trigger lands.
    const rateLimitRef = row.lastManualTriggerAt ?? row.updatedAt;
    const refAgeMs = now - new Date(rateLimitRef).getTime();
    if (refAgeMs < COALESCE_WINDOW_SECONDS * 1000) {
      const retryAfterSec = Math.ceil(
        (COALESCE_WINDOW_SECONDS * 1000 - refAgeMs) / 1000,
      );
      return c.json(
        { error: "rate_limited", retry_after_sec: retryAfterSec },
        429,
      );
    }

    const jobType: "incremental" | "full_resync" = row.nextSyncToken
      ? "incremental"
      : "full_resync";

    try {
      if (jobType === "incremental") {
        await enqueueSync(c.env, {
          type: "incremental",
          userId,
          calendarId: PRIMARY,
          reason: "manual",
          enqueuedAt: now,
        });
      } else {
        await enqueueSync(c.env, {
          type: "full_resync",
          userId,
          calendarId: PRIMARY,
          reason: "manual",
          enqueuedAt: now,
        });
      }
    } catch (err) {
      if (err instanceof SyncQueueUnavailableError) {
        return c.json({ error: "queue_unavailable" }, 503);
      }
      throw err;
    }

    // §6.4 — stamp only after enqueue succeeds, so an enqueue failure doesn't
    // punish the user with an unwarranted 30s lockout. Not atomic with the
    // SELECT above; two racing requests can both pass the rate-limit check,
    // which is acceptable for manual button-spam absorption.
    await db
      .update(syncState)
      .set({ lastManualTriggerAt: sql`now()` })
      .where(
        and(eq(syncState.userId, userId), eq(syncState.calendarId, PRIMARY)),
      );

    return c.json({ ok: true, enqueued: true, jobType }, 202);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

syncRoutes.post("/bootstrap", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const tokRows = await db
      .select({ needsReauth: oauthTokens.needsReauth })
      .from(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")))
      .limit(1);
    if (!tokRows[0] || tokRows[0].needsReauth) {
      return c.json({ error: "reauth_required" }, 503);
    }

    await db
      .insert(syncState)
      .values({ userId, calendarId: PRIMARY })
      .onConflictDoNothing();

    try {
      await enqueueSync(c.env, {
        type: "full_resync",
        userId,
        calendarId: PRIMARY,
        reason: "bootstrap",
        enqueuedAt: Date.now(),
      });
    } catch (err) {
      if (err instanceof SyncQueueUnavailableError) {
        return c.json({ error: "queue_unavailable" }, 503);
      }
      throw err;
    }

    // Register Watch channel if a verified webhook base URL is configured.
    // Dev environments typically leave WEBHOOK_BASE_URL unset (workers.dev is
    // rejected by Google), so this branch no-ops there. We stop any pre-
    // existing channel first — re-bootstrap (re-onboarding, consent replay,
    // client retry) would otherwise leak duplicate live channels on Google's
    // side; every orphan double-delivers webhooks for up to 7 days until its
    // own TTL lapses. Non-reauth failures do not fail the bootstrap — the
    // full_resync queue job already let the user sync; they just don't get
    // real-time push until the next attempt.
    let watchRegistered = false;
    if (c.env.WEBHOOK_BASE_URL) {
      try {
        const { accessToken } = await getValidAccessToken(db, c.env, userId);
        await stopWatchChannel(db, accessToken, userId, PRIMARY);
        await registerWatchChannel(
          db,
          accessToken,
          userId,
          PRIMARY,
          c.env.WEBHOOK_BASE_URL,
        );
        watchRegistered = true;
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          // Refresh token is revoked — bootstrap is meaningless until the
          // user re-consents. Surface it to GAS so the re-login card shows
          // now rather than on the next /sync/run or consumer tick.
          return c.json({ error: "reauth_required" }, 503);
        }
        const code =
          err instanceof CalendarApiError ? err.kind : "unknown";
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "watch channel registration failed (bootstrap proceeds)",
            userId,
            calendarId: PRIMARY,
            code,
          }),
        );
      }
    }

    return c.json({ ok: true, calendarId: PRIMARY, watchRegistered }, 202);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db";
import { oauthTokens, syncState } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { enqueueSync, SyncQueueUnavailableError } from "../queues/syncProducer";
import {
  bootstrapUserSync,
  maybeSelfHealWatch,
  reconnectWatch,
} from "../services/watch";

export const syncRoutes = new Hono<HonoEnv>();

const PRIMARY = "primary";
const COALESCE_WINDOW_SECONDS = 30;

syncRoutes.use("*", authMiddleware);

syncRoutes.post("/run", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  // Set true once we've reached the "this looks like a real sync trigger"
  // branch (post reauth-guard, post coalesce, post rate-limit). The finally
  // block uses this to gate the watch self-heal call — early-return paths
  // (reauth, calendar_inactive, coalesce, rate-limited, queue_unavailable)
  // are not the right moment to retry watch registration.
  let shouldSelfHeal = false;
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

    // Past every guard — this is a real sync attempt. Mark for the finally
    // block to opportunistically self-heal the user's watch channel.
    shouldSelfHeal = true;

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
    // Watch self-heal — fire-and-forget on every successful sync trigger.
    // Pressing "지금 즉시 동기화" = the user's clearest signal that the
    // automatic webhook path isn't fulfilling their expectations, so this is
    // the highest-value moment to backfill a missing/expiring watch channel.
    // Skipped on early-return paths (reauth, coalesce, rate-limit, etc.) —
    // those aren't the right moment to retry watch registration. Chained
    // with close() so the shared db connection stays alive until the helper
    // finishes (waitUntil promises run concurrently otherwise — close would
    // race the helper's queries on the same socket).
    if (shouldSelfHeal) {
      c.executionCtx.waitUntil(
        maybeSelfHealWatch(db, c.env, userId)
          .catch(() => undefined)
          .finally(() => close()),
      );
    } else {
      c.executionCtx.waitUntil(close());
    }
  }
});

syncRoutes.post("/bootstrap", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const result = await bootstrapUserSync(db, c.env, userId);
    if (!result.ok) {
      return c.json({ error: result.error }, 503);
    }
    return c.json(
      { ok: true, calendarId: PRIMARY, watchRegistered: result.watchRegistered },
      202,
    );
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

// User-explicit watch reconnect. Called by the GAS home card's "지금 연결"
// button when `push_active=false`. Differs from /sync/bootstrap in two ways:
//   1. No full_resync enqueue — this endpoint only re-creates the watch
//      channel. The next webhook (or manual sync) catches up missed events.
//   2. No self-heal cooldown gate — user explicitly clicked, so rate-limit
//      doesn't apply. We also intentionally do NOT stamp last_self_heal_at
//      (sole-writer is `maybeSelfHealWatch`, see src/CLAUDE.md).
syncRoutes.post("/heal-watch", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const result = await reconnectWatch(db, c.env, userId);
    if ("ok" in result) {
      return c.json({ ok: true, expiresAt: result.expiration.toISOString() }, 200);
    }
    switch (result.error) {
      case "webhook_unconfigured":
        // Dev shell — Google rejects workers.dev for push notifications, so
        // there's nothing to register. Distinct code so GAS can show
        // "이 환경에서는 자동 동기화 불가".
        return c.json({ error: "webhook_unconfigured" }, 503);
      case "reauth_required":
        return c.json({ error: "reauth_required" }, 503);
      case "not_bootstrapped":
        // Onboarding wasn't completed — bootstrap creates the row. 409 so GAS
        // routes to the onboarding card.
        return c.json({ error: "not_bootstrapped" }, 409);
      case "calendar_inactive":
        return c.json({ error: "calendar_inactive" }, 409);
      case "api_error":
        // Thin kind → HTTP mapping kept inline (mapper extraction is a separate
        // deepening candidate). ReRegisterResult carries kind only — the
        // factory-parsed retryAfterSec is dropped at the reRegisterWatch
        // boundary (#07) — so rate_limited is a fixed 1s, matching the prior
        // `?? 1` fallback.
        switch (result.kind) {
          case "auth":
            return c.json({ error: "reauth_required" }, 503);
          case "forbidden":
            return c.json({ error: "forbidden" }, 403);
          case "not_found":
            return c.json({ error: "calendar_not_found" }, 404);
          case "rate_limited": {
            const retryAfter = 1;
            return c.json(
              { error: "rate_limited", retry_after_sec: retryAfter },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }
          case "full_sync_required":
          case "server":
          case "unknown":
            return c.json({ error: "upstream_unavailable" }, 502);
          default: {
            const _exhaustive: never = result.kind;
            void _exhaustive;
            return c.json({ error: "upstream_unavailable" }, 502);
          }
        }
      default: {
        const _exhaustive: never = result;
        void _exhaustive;
        return c.json({ error: "upstream_unavailable" }, 502);
      }
    }
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

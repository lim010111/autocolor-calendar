import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db";
import { oauthTokens, syncState } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { enqueueSync, SyncQueueUnavailableError } from "../queues/syncProducer";

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
    return c.json({ ok: true, calendarId: PRIMARY }, 202);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

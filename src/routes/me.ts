import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db";
import { oauthTokens, syncState } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";

export const meRoutes = new Hono<HonoEnv>();

meRoutes.use("*", authMiddleware);

const IN_PROGRESS_WINDOW_MS = 5 * 60 * 1000;

meRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const [tok] = await db
      .select({
        needsReauth: oauthTokens.needsReauth,
        needsReauthReason: oauthTokens.needsReauthReason,
      })
      .from(oauthTokens)
      .where(
        and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")),
      )
      .limit(1);

    const [sync] = await db
      .select({
        calendarId: syncState.calendarId,
        nextSyncToken: syncState.nextSyncToken,
        inProgressAt: syncState.inProgressAt,
        lastError: syncState.lastError,
        lastRunSummary: syncState.lastRunSummary,
        active: syncState.active,
      })
      .from(syncState)
      .where(and(eq(syncState.userId, userId), eq(syncState.calendarId, "primary")))
      .limit(1);

    const body: Record<string, unknown> = {
      userId,
      email: c.get("email"),
      needs_reauth: tok?.needsReauth ?? false,
      needs_reauth_reason: tok?.needsReauthReason ?? null,
    };

    if (sync) {
      const inProgAt = sync.inProgressAt ? new Date(sync.inProgressAt).getTime() : null;
      body["last_sync"] = {
        calendar_id: sync.calendarId,
        next_sync_token_present: sync.nextSyncToken != null,
        last_error: sync.lastError ?? null,
        in_progress:
          inProgAt != null && Date.now() - inProgAt < IN_PROGRESS_WINDOW_MS,
        last_summary: sync.lastRunSummary ?? null,
        active: sync.active,
      };
    } else {
      body["last_sync"] = null;
    }

    return c.json(body);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

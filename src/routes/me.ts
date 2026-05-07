import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db";
import { oauthTokens, syncState } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { maybeSelfHealWatch } from "../services/watchSelfHeal";

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
        watchChannelId: syncState.watchChannelId,
        watchExpiration: syncState.watchExpiration,
      })
      .from(syncState)
      .where(and(eq(syncState.userId, userId), eq(syncState.calendarId, "primary")))
      .limit(1);

    // `pushActive` is the GAS home card's status pill source. Both columns
    // are required because a row with `watchExpiration` set but `channelId`
    // null is incoherent state — treat as inactive defensively.
    const pushActive =
      Boolean(sync?.watchChannelId) &&
      Boolean(sync?.watchExpiration) &&
      new Date(sync!.watchExpiration!).getTime() > Date.now();

    const body: Record<string, unknown> = {
      userId,
      email: c.get("email"),
      needs_reauth: tok?.needsReauth ?? false,
      needs_reauth_reason: tok?.needsReauthReason ?? null,
      push_active: pushActive,
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
    // Watch self-heal — fire-and-forget. Caller-side waitUntil keeps /me
    // response latency at zero while the helper opportunistically registers a
    // missing/expiring channel. We chain `close()` after the helper so the
    // shared `db` connection isn't yanked mid-query (waitUntil promises run
    // concurrently — without the chain, close() can race the helper's
    // SELECT/UPDATE on the same socket). See `src/services/watchSelfHeal.ts`
    // for the 24h threshold + 10min cooldown contract.
    c.executionCtx.waitUntil(
      maybeSelfHealWatch(db, c.env, userId)
        .catch(() => undefined)
        .finally(() => close()),
    );
  }
});

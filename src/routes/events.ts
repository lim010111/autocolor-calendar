import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import { oauthTokens } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { CalendarApiError, patchEventColorManual } from "../services/googleCalendar";
import { getValidAccessToken, ReauthRequiredError } from "../services/tokenRefresh";

export const eventsRoutes = new Hono<HonoEnv>();

eventsRoutes.use("*", authMiddleware);

// Per-event manual color override. Sole caller: GAS sidebar's
// `actionSaveEventOverride`. Synchronous (no queue) so the user gets
// immediate feedback — speed is the primary requirement here.
//
// §5.4 invariant: `patchEventColorManual` clears the three ownership marker
// keys in the same PATCH, so the next sync sees `appOwned === false` and
// skips re-coloring (same outcome as if the user edited the color directly
// in Google Calendar).
const ColorBody = z.object({
  // Google's documented event color palette is 1..11 (see
  // https://developers.google.com/calendar/api/v3/reference/colors). Reject
  // anything else at the boundary so a malformed UI payload can't slip
  // through to Google as a 400 we'd have to translate.
  colorId: z.string().regex(/^([1-9]|1[01])$/),
});

eventsRoutes.post("/:calendarId/:eventId/color", async (c) => {
  const userId = c.get("userId");
  const calendarId = c.req.param("calendarId");
  const eventId = c.req.param("eventId");
  if (!calendarId || !eventId) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = ColorBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }

  const { db, close } = getDb(c.env);
  try {
    // Reauth fast-fail. Same pattern as `/sync/run` — surface a 503 the GAS
    // client maps to the reconnect card before we burn any token-refresh
    // round trip.
    const tokRows = await db
      .select({ needsReauth: oauthTokens.needsReauth })
      .from(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")))
      .limit(1);
    if (!tokRows[0] || tokRows[0].needsReauth) {
      return c.json({ error: "reauth_required" }, 503);
    }

    let accessToken: string;
    try {
      const res = await getValidAccessToken(db, c.env, userId);
      accessToken = res.accessToken;
    } catch (err) {
      if (err instanceof ReauthRequiredError) {
        return c.json({ error: "reauth_required" }, 503);
      }
      throw err;
    }

    try {
      await patchEventColorManual(
        accessToken,
        calendarId,
        eventId,
        parsed.data.colorId,
      );
    } catch (err) {
      if (err instanceof CalendarApiError) {
        switch (err.kind) {
          case "auth":
            // Access token went stale between refresh and PATCH (rare); ask
            // the GAS client to walk the reconnect path same as a refresh
            // failure.
            return c.json({ error: "reauth_required" }, 503);
          case "forbidden":
            return c.json({ error: "forbidden" }, 403);
          case "not_found":
          case "full_sync_required":
            // Per-event 410 means the event is gone for good — treat it as
            // not_found from the user's perspective. (Calendar-level 410
            // / `fullSyncRequired` only fires from `events.list`.)
            return c.json({ error: "event_not_found" }, 404);
          case "rate_limited": {
            const retryAfter = err.retryAfterSec ?? 1;
            return c.json(
              { error: "rate_limited", retry_after_sec: retryAfter },
              429,
              { "Retry-After": String(retryAfter) },
            );
          }
          case "server":
          case "unknown":
            return c.json({ error: "upstream_unavailable" }, 502);
          default: {
            // Exhaustiveness guard — adding a new CalendarErrorKind without
            // mapping it here is a TS compile error rather than a silent
            // fallthrough to Hono's 500.
            const _exhaustive: never = err.kind;
            void _exhaustive;
            return c.json({ error: "upstream_unavailable" }, 502);
          }
        }
      }
      throw err;
    }

    return c.json({ ok: true, colorId: parsed.data.colorId }, 200);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

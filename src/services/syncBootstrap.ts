// Onboarding bootstrap — single creation path for a user's `sync_state` row,
// initial `full_resync` enqueue, and Google Calendar Watch channel.
//
// Two callers share this helper:
// - `POST /sync/bootstrap` — explicit/manual entry (legacy + ops). Maps the
//   outcome to the same JSON envelope the route used to return inline.
// - `/oauth/google/callback` — fires synchronously after a fresh user +
//   refresh-token + session land, so the user's first `/me` already reports
//   `push_active: true`. Failure is non-fatal and logged by the caller.
//
// Per `src/CLAUDE.md` "Watch self-heal": this is the ONE legitimate
// onboarding-time creation path for a Watch channel. New entry points must
// route through this helper or `maybeSelfHealWatch` — never call
// `registerWatchChannel` directly.

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { oauthTokens, syncState } from "../db/schema";
import type { Bindings } from "../env";
import { enqueueSync, SyncQueueUnavailableError } from "../queues/syncProducer";
import { CalendarApiError } from "./googleCalendar";
import { getValidAccessToken, ReauthRequiredError } from "./tokenRefresh";
import { registerWatchChannel, stopWatchChannel } from "./watchChannel";

const PRIMARY = "primary";

export type BootstrapOutcome =
  | { ok: true; watchRegistered: boolean }
  | { ok: false; error: "reauth_required" | "queue_unavailable" };

export async function bootstrapUserSync(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
): Promise<BootstrapOutcome> {
  const tokRows = await db
    .select({ needsReauth: oauthTokens.needsReauth })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")))
    .limit(1);
  if (!tokRows[0] || tokRows[0].needsReauth) {
    return { ok: false, error: "reauth_required" };
  }

  await db
    .insert(syncState)
    .values({ userId, calendarId: PRIMARY })
    .onConflictDoNothing();

  try {
    await enqueueSync(env, {
      type: "full_resync",
      userId,
      calendarId: PRIMARY,
      reason: "bootstrap",
      enqueuedAt: Date.now(),
    });
  } catch (err) {
    if (err instanceof SyncQueueUnavailableError) {
      return { ok: false, error: "queue_unavailable" };
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
  if (env.WEBHOOK_BASE_URL) {
    try {
      const { accessToken } = await getValidAccessToken(db, env, userId);
      await stopWatchChannel(db, accessToken, userId, PRIMARY);
      await registerWatchChannel(
        db,
        accessToken,
        userId,
        PRIMARY,
        env.WEBHOOK_BASE_URL,
      );
      watchRegistered = true;
    } catch (err) {
      if (err instanceof ReauthRequiredError) {
        return { ok: false, error: "reauth_required" };
      }
      const code = err instanceof CalendarApiError ? err.kind : "unknown";
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

  return { ok: true, watchRegistered };
}

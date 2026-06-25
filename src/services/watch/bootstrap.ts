// Onboarding bootstrap — single creation path for a user's `sync_state` row,
// initial `full_resync` enqueue, and Google Calendar Watch channel.
//
// Two callers share this entry point:
// - `POST /sync/bootstrap` — explicit/manual entry (legacy + ops). Maps the
//   outcome to the same JSON envelope the route used to return inline.
// - `/oauth/google/callback` — fires synchronously after a fresh user +
//   refresh-token + session land, so the user's first `/me` already reports
//   `push_active: true`. Failure is non-fatal and logged by the caller.
//
// The watch (re)registration itself is owned by `reRegisterWatch` (core);
// this adapter layers the onboarding policy (row upsert + full_resync enqueue)
// on top and maps the core's result union to the bootstrap envelope.

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { oauthTokens, syncState } from "../../db/schema";
import type { Bindings } from "../../env";
import { enqueueSync, SyncQueueUnavailableError } from "../../queues/syncProducer";
import { reRegisterWatch } from "./core";

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

  // Register the Watch channel via the shared core. We stop any pre-existing
  // channel first (inside the core) — re-bootstrap (re-onboarding, consent
  // replay, client retry) would otherwise leak duplicate live channels on
  // Google's side. Non-reauth failures do NOT fail the bootstrap — the
  // full_resync queue job already let the user sync; they just don't get
  // real-time push until the next attempt.
  let result;
  try {
    result = await reRegisterWatch(db, env, userId, PRIMARY);
  } catch {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "watch channel registration failed (bootstrap proceeds)",
        userId,
        calendarId: PRIMARY,
        code: "unknown",
      }),
    );
    return { ok: true, watchRegistered: false };
  }

  if ("ok" in result) {
    return { ok: true, watchRegistered: true };
  }
  if ("failed" in result) {
    if (result.failed === "reauth_required") {
      return { ok: false, error: "reauth_required" };
    }
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "watch channel registration failed (bootstrap proceeds)",
        userId,
        calendarId: PRIMARY,
        code: result.kind,
      }),
    );
  }
  // skipped (WEBHOOK_BASE_URL unset) → no push, no warn.
  return { ok: true, watchRegistered: false };
}

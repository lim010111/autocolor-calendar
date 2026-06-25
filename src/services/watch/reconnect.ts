// User-explicit watch reconnect — the GAS home card's "지금 연결" button when
// `push_active=false`. Extracted from the `/sync/heal-watch` route body so the
// route is a thin result→HTTP adapter. Differs from bootstrap in two ways:
//   1. No full_resync enqueue — this only re-creates the watch channel. The
//      next webhook (or manual sync) catches up missed events.
//   2. No self-heal cooldown gate — the user explicitly clicked, so the
//      background rate-limit doesn't apply. We also intentionally do NOT stamp
//      `last_self_heal_at` (sole-writer is `maybeSelfHealWatch`, see
//      src/CLAUDE.md "Watch self-heal").
//
// The (re)registration itself is owned by `reRegisterWatch` (core); this
// adapter layers the active gate (+ needs_reauth precheck) on top and returns a
// result union the route maps to HTTP.

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { oauthTokens, syncState } from "../../db/schema";
import type { Bindings } from "../../env";
import type { CalendarApiError } from "../googleCalendar";
import { reRegisterWatch } from "./core";

const PRIMARY = "primary";

export type ReconnectResult =
  | { ok: true; expiration: Date }
  | {
      error:
        | "webhook_unconfigured"
        | "reauth_required"
        | "not_bootstrapped"
        | "calendar_inactive";
    }
  | { error: "api_error"; kind: CalendarApiError["kind"] };

export async function reconnectWatch(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
): Promise<ReconnectResult> {
  // Webhook guard first — dev shells (no WEBHOOK_BASE_URL) surface a distinct
  // code so GAS can show "이 환경에서는 자동 동기화 불가", and we skip the DB
  // reads entirely. Matches the route's prior check order.
  if (!env.WEBHOOK_BASE_URL) return { error: "webhook_unconfigured" };

  const tokRows = await db
    .select({ needsReauth: oauthTokens.needsReauth })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")))
    .limit(1);
  if (!tokRows[0] || tokRows[0].needsReauth) return { error: "reauth_required" };

  const ssRows = await db
    .select({
      calendarId: syncState.calendarId,
      active: syncState.active,
    })
    .from(syncState)
    .where(and(eq(syncState.userId, userId), eq(syncState.calendarId, PRIMARY)))
    .limit(1);
  const ss = ssRows[0];
  if (!ss) return { error: "not_bootstrapped" };
  if (!ss.active) return { error: "calendar_inactive" };

  const result = await reRegisterWatch(db, env, userId, PRIMARY);
  if ("ok" in result) return { ok: true, expiration: result.expiration };
  if ("skipped" in result) return { error: "webhook_unconfigured" };
  if (result.failed === "reauth_required") return { error: "reauth_required" };
  return { error: "api_error", kind: result.kind };
}

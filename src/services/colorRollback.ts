import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Bindings } from "../env";
import {
  AUTOCOLOR_KEYS,
  AUTOCOLOR_MARKER_VERSION,
  CalendarApiError,
  clearEventColor,
  listEvents,
  type CalendarEvent,
} from "./googleCalendar";
import { ReauthRequiredError, getValidAccessToken } from "./tokenRefresh";

// Same window as runFullResync — bounded so a user with years of history
// can't force the rollback consumer through infinite pages. Events colored
// outside this window will remain until a §6 full-cleanup tool is added.
const ROLLBACK_PAST_MS = 30 * 24 * 3600 * 1000;
const ROLLBACK_FUTURE_MS = 365 * 24 * 3600 * 1000;
const MAX_PAGES_PER_ROLLBACK_RUN = 10;

export type RollbackSummary = {
  pages: number;
  seen: number;
  cleared: number;
  skipped_stale_marker: number;
  skipped_manual_override: number;
  skipped_version_mismatch: number;
  not_found: number;
  forbidden_events: number;
  started_at: string;
  finished_at: string;
};

export type RollbackContext = {
  db: PostgresJsDatabase;
  env: Bindings;
  userId: string;
  calendarId: string;
};

export type RollbackResult =
  | { ok: true; summary: RollbackSummary }
  | {
      ok: false;
      reason: "reauth_required" | "forbidden" | "not_found" | "retryable";
      error: Error;
      summary: RollbackSummary;
      retryAfterSec?: number | undefined;
    };

function makeSummary(): RollbackSummary {
  return {
    pages: 0,
    seen: 0,
    cleared: 0,
    skipped_stale_marker: 0,
    skipped_manual_override: 0,
    skipped_version_mismatch: 0,
    not_found: 0,
    forbidden_events: 0,
    started_at: new Date().toISOString(),
    finished_at: "",
  };
}

// §5 후속 B — rule-deletion rollback. Iterates events that still bear the
// `autocolor_category=<id>` marker and clears both the color override and
// the three autocolor markers, but *only* when the marker still "owns" the
// current colorId (i.e., the user hasn't re-painted after our last PATCH).
//
// Ownership gate is intentionally strict and reuses §5.4 semantics:
//   appOwned := marker.version === "1" && marker.color === event.colorId
// Anything else (stale marker, manual override, v≠1) is left untouched and
// recorded in the summary for §6 observability.
//
// Errors are classified the same way calendarSync does so the existing
// consumer retry/reauth ladder (`applyResult` in syncConsumer.ts) handles
// this job type without special-casing:
// - reauth_required → ack, mark token reauth
// - forbidden       → ack, abort this calendar
// - not_found       → ack
// - retryable       → msg.retry with backoff
export async function runColorRollback(
  ctx: RollbackContext,
  categoryId: string,
): Promise<RollbackResult> {
  const summary = makeSummary();

  let accessToken: string;
  try {
    const res = await getValidAccessToken(ctx.db, ctx.env, ctx.userId);
    accessToken = res.accessToken;
  } catch (err) {
    summary.finished_at = new Date().toISOString();
    if (err instanceof ReauthRequiredError) {
      return { ok: false, reason: "reauth_required", error: err, summary };
    }
    return { ok: false, reason: "retryable", error: err as Error, summary };
  }

  const timeMin = new Date(Date.now() - ROLLBACK_PAST_MS).toISOString();
  const timeMax = new Date(Date.now() + ROLLBACK_FUTURE_MS).toISOString();
  const filter = `${AUTOCOLOR_KEYS.category}=${categoryId}`;

  let pageToken: string | undefined;
  do {
    let pageItems: CalendarEvent[];
    try {
      const res = await listEvents(accessToken, ctx.calendarId, {
        privateExtendedProperty: filter,
        timeMin,
        timeMax,
        pageToken,
      });
      summary.pages += 1;
      pageItems = res.items ?? [];
      pageToken = res.nextPageToken;
    } catch (err) {
      summary.finished_at = new Date().toISOString();
      if (err instanceof CalendarApiError) {
        if (err.kind === "auth") {
          return { ok: false, reason: "reauth_required", error: err, summary };
        }
        if (err.kind === "forbidden") {
          // Whole-calendar 403 — user lost access (ACL shrinkage, shared
          // calendar demotion). Ack without retry; the row in sync_state
          // may also be stale.
          return { ok: false, reason: "forbidden", error: err, summary };
        }
        if (err.kind === "not_found") {
          return { ok: false, reason: "not_found", error: err, summary };
        }
        if (
          err.kind === "rate_limited" ||
          err.kind === "server" ||
          err.kind === "full_sync_required"
        ) {
          return {
            ok: false,
            reason: "retryable",
            error: err,
            summary,
            retryAfterSec: err.retryAfterSec,
          };
        }
        return { ok: false, reason: "retryable", error: err, summary };
      }
      return { ok: false, reason: "retryable", error: err as Error, summary };
    }

    for (const event of pageItems) {
      summary.seen += 1;
      const priv = event.extendedProperties?.private;
      if (!priv) {
        // Shouldn't happen — Google's filter promises the key exists, but
        // defend against schema drift.
        summary.skipped_stale_marker += 1;
        continue;
      }
      const markerVersion = priv[AUTOCOLOR_KEYS.version];
      if (markerVersion !== AUTOCOLOR_MARKER_VERSION) {
        summary.skipped_version_mismatch += 1;
        continue;
      }
      const ownedColor = priv[AUTOCOLOR_KEYS.color];
      const current = event.colorId ?? "";
      if (!ownedColor || ownedColor !== current) {
        // Marker predates a user-initiated color change — the user re-
        // painted this event after our last PATCH, so we treat it as
        // manual and leave it alone (same invariant §5.4 uses in sync).
        summary.skipped_manual_override += 1;
        continue;
      }

      try {
        await clearEventColor(accessToken, ctx.calendarId, event.id);
        summary.cleared += 1;
      } catch (err) {
        if (err instanceof CalendarApiError) {
          if (err.kind === "auth") {
            summary.finished_at = new Date().toISOString();
            return {
              ok: false,
              reason: "reauth_required",
              error: err,
              summary,
            };
          }
          if (err.kind === "not_found" || err.kind === "full_sync_required") {
            // Event deleted between list and patch — benign.
            summary.not_found += 1;
            continue;
          }
          if (err.kind === "forbidden") {
            // Per-event 403 (shared event where user lost write access).
            // Absorb so one bad event doesn't abort the whole calendar.
            summary.forbidden_events += 1;
            continue;
          }
          // rate_limited / server → rethrow so consumer retries the whole
          // batch. We don't checkpoint mid-run; re-running from page 1 is
          // fine because clearEventColor is idempotent once the marker
          // equality check passes.
          summary.finished_at = new Date().toISOString();
          return {
            ok: false,
            reason: "retryable",
            error: err,
            summary,
            retryAfterSec: err.retryAfterSec,
          };
        }
        throw err;
      }
    }

    if (summary.pages >= MAX_PAGES_PER_ROLLBACK_RUN && pageToken) {
      // Safety valve — runaway marker filter shouldn't starve the queue.
      // Abandon remaining pages; they stay visible to a future rollback
      // triggered by re-deleting a ghost category (§6 cleanup path).
      break;
    }
  } while (pageToken);

  summary.finished_at = new Date().toISOString();
  return { ok: true, summary };
}

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Bindings } from "../env";
import { parseSubrequestBudget } from "./calendarSync";
import {
  AUTOCOLOR_KEYS,
  AUTOCOLOR_MARKER_VERSION,
  AUTOCOLOR_MARKER_VERSION_V1,
  CalendarApiError,
  clearEventLabel,
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

// sync-reliability #05 — per-invocation subrequest budget guard, ported from
// calendarSync (#02) in reduced form. The paging loop's fetches (1 list per
// page + 1 PATCH per app-owned event) previously went uncounted, so a
// rollback over a large marked set (maxResults defaults to 2500 and
// singleEvents=true expands recurring instances) ran straight into the
// Workers Free 50-subrequest cap: the thrown fetch escaped as an unknown
// error, msg.retry ground forward ~46 clears per attempt, and after
// max_retries the DLQ left the calendar permanently half-colored — the
// category is already deleted, so no user-accessible path re-triggers the
// rollback. The guard counts list + PATCH fetches against the shared
// SYNC_SUBREQUEST_BUDGET (one env edit on the #01 plan change recovers both
// paths) and stops BEFORE the fetch that would overrun.
//
// Resume needs NO continuation state (unlike #02's (syncToken, pageToken)):
// every cleared event loses its `autocolor_category` marker and drops out of
// the privateExtendedProperty filter, so restarting from page 1 naturally
// resumes at the first still-marked event — carrying a pageToken into a
// mutating filtered listing would instead risk item-shift skips. The
// consumer simply re-enqueues the same job, gated on PROGRESS
// (cleared + not_found > 0): the filter-match set strictly shrinks each run,
// so the restart chain terminates. A budget stop with zero progress (e.g.
// per-event 403s eating the whole budget) abandons the remainder with a
// warn — same semantics as the MAX_PAGES_PER_ROLLBACK_RUN valve below.
const ROLLBACK_PAGE_FETCH_COST = 1; // events.list
const ROLLBACK_EVENT_FETCH_COST = 1; // events.patch (clearEventLabel)

export type RollbackSummary = {
  pages: number;
  seen: number;
  cleared: number;
  skipped_stale_marker: number;
  skipped_manual_override: number;
  skipped_version_mismatch: number;
  not_found: number;
  forbidden_events: number;
  // #05 — set when the run stopped at the subrequest budget instead of
  // exhausting the marked set. Present-only-when-true; lands in the
  // consumer's completion info log (rollback_runs has no column for it —
  // the repeated ok rows of the restart chain are the durable trace).
  budget_stopped?: true;
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
  // #05 — `continuation: true` asks the consumer to re-enqueue the same job
  // (restart-resume; no coordinates needed, see the budget-guard comment
  // above). Set only when the run budget-stopped AND made progress.
  | { ok: true; summary: RollbackSummary; continuation?: true }
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

// §5 후속 B — rule-deletion rollback, label world (ADR-0006). Iterates
// events that still bear the `autocolor_category=<id>` marker and clears
// both the label assignment and the autocolor markers, but *only* when the
// marker still "owns" the event (the user hasn't re-labelled/re-painted
// after our last PATCH).
//
// Ownership gate is intentionally strict and reuses §5.4 semantics,
// version-gated like calendarSync.processEvent:
//   v2: appOwned := marker.label === event.eventLabelId
//   v1 (transitional until the #04 re-stamp): appOwned :=
//       marker.color === event.colorId
// Anything else (stale marker, manual override, unknown version) is left
// untouched and recorded in the summary for §6 observability.
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

  // #05 budget guard state — see the header comment on the constants above.
  // Counters only in the warn (log redaction contract); calendarId is
  // deliberately excluded — a primary calendar id is the user's email.
  const budget = parseSubrequestBudget(ctx.env.SYNC_SUBREQUEST_BUDGET);
  const fetches = { used: 0 };
  let budgetStopped = false;
  const warnBudgetStop = (): void => {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "rollback subrequest budget reached — stopping run",
        used: fetches.used,
        budget,
        pages: summary.pages,
        seen: summary.seen,
        cleared: summary.cleared,
        userId: ctx.userId,
      }),
    );
  };

  let pageToken: string | undefined;
  do {
    let pageItems: CalendarEvent[];
    try {
      // Counted before issuing — a list that throws still consumed budget.
      fetches.used += ROLLBACK_PAGE_FETCH_COST;
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
      if (
        markerVersion !== AUTOCOLOR_MARKER_VERSION &&
        markerVersion !== AUTOCOLOR_MARKER_VERSION_V1
      ) {
        summary.skipped_version_mismatch += 1;
        continue;
      }
      // Version-gated ownership probe (mirror of calendarSync §5.4):
      // v2 compares the stored label to the event's current eventLabelId;
      // v1 (transitional) compares the stored colorId. `!!` (not
      // `!== undefined`) keeps the pre-existing guard's semantics: an
      // empty-string marker value is never ours.
      const appOwned =
        markerVersion === AUTOCOLOR_MARKER_VERSION
          ? !!priv[AUTOCOLOR_KEYS.label] &&
            priv[AUTOCOLOR_KEYS.label] === (event.eventLabelId ?? "")
          : !!priv[AUTOCOLOR_KEYS.color] &&
            priv[AUTOCOLOR_KEYS.color] === (event.colorId ?? "");
      // native-labels #01 — label-aware manual gate. A post-PATCH user
      // repaint via a label reads back as a different eventLabelId (v2) or
      // an empty/best-match colorId (v1); the explicit clause keeps the two
      // §5.4 readers in lockstep.
      if (!appOwned && (event.eventLabelId ?? "") !== "") {
        summary.skipped_manual_override += 1;
        continue;
      }
      if (!appOwned) {
        // Marker predates a user-initiated color change — the user re-
        // painted this event after our last PATCH, so we treat it as
        // manual and leave it alone (same invariant §5.4 uses in sync).
        summary.skipped_manual_override += 1;
        continue;
      }

      // #05 mid-page budget stop — placed after the ownership gates so
      // skip-only events keep scanning for free; only the PATCH spends
      // budget. The event that trips the guard stays marked and is picked
      // up by the restart (its marker keeps it in the filter).
      if (fetches.used + ROLLBACK_EVENT_FETCH_COST > budget) {
        budgetStopped = true;
        break;
      }
      try {
        // Counted before issuing — a PATCH that throws still consumed budget.
        fetches.used += ROLLBACK_EVENT_FETCH_COST;
        await clearEventLabel(accessToken, ctx.calendarId, event.id);
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

    if (budgetStopped) break;
    // #05 page-boundary budget stop — only fetch the next page when it plus
    // at least one PATCH still fits. Checked BEFORE the MAX_PAGES valve so
    // a run that trips both gets the re-enqueue semantics, not the abandon.
    if (
      pageToken &&
      fetches.used + ROLLBACK_PAGE_FETCH_COST + ROLLBACK_EVENT_FETCH_COST >
        budget
    ) {
      budgetStopped = true;
      break;
    }
    if (summary.pages >= MAX_PAGES_PER_ROLLBACK_RUN && pageToken) {
      // Safety valve — runaway marker filter shouldn't starve the queue.
      // Abandon remaining pages; they stay visible to a future rollback
      // triggered by re-deleting a ghost category (§6 cleanup path).
      break;
    }
  } while (pageToken);

  summary.finished_at = new Date().toISOString();
  if (budgetStopped) {
    summary.budget_stopped = true;
    warnBudgetStop();
    // Progress gate — the restart chain must strictly shrink the marked set
    // to terminate. `cleared` events lose the marker; `not_found` events are
    // gone from the calendar. Anything else (forbidden, skips) would recur
    // verbatim on restart, so a no-progress stop abandons like MAX_PAGES.
    if (summary.cleared + summary.not_found > 0) {
      return { ok: true, summary, continuation: true };
    }
  }
  return { ok: true, summary };
}

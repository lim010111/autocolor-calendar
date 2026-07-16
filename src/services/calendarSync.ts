import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../db/schema";
import type { Bindings } from "../env";
import { buildDefaultClassifier } from "./classifierChain";
import type {
  ClassificationOutcome,
  ClassifyContext,
  ClassifyEventFn,
} from "./classifierOutcomes";
import { llmCallsBufferSink, syncSummarySink } from "./classifierSinks";
import { resolveEmbedder, type EmbedTexts } from "./embeddings";
import type { LlmCallRecord } from "./llmClassifier";
import {
  AUTOCOLOR_KEYS,
  AUTOCOLOR_MARKER_VERSION,
  AUTOCOLOR_MARKER_VERSION_V1,
  CalendarApiError,
  listEvents,
  patchEventLabel,
  type CalendarEvent,
} from "./googleCalendar";
import { reconcileLabels } from "./labelReconcile";
import { listRules } from "./ruleService";
import { ReauthRequiredError, getValidAccessToken } from "./tokenRefresh";

export type SyncSummary = {
  pages: number;
  seen: number;
  evaluated: number;
  updated: number;
  skipped_manual: number;
  skipped_equal: number;
  // ADR-0006 — hit on a rule with no `labelId` yet (pre-cutover row). The
  // write is skipped rather than guessed; the #04 cutover backfills labels
  // and re-syncs. Counter lives in the summary/`lastRunSummary` jsonb only —
  // deliberately NOT a `sync_runs` column (transient until #04).
  skipped_no_label: number;
  cancelled: number;
  no_match: number;
  // §5.3 LLM fallback counters. `llm_attempted` fires whenever the chain
  // delegates to the LLM leg (after rule-miss and pre-fetch). The three
  // outcome counters are disjoint: a single attempt bumps at most one of
  // {succeeded, timeout, quota_exceeded} (http_error / bad_response /
  // disabled fold silently into no_match without a dedicated counter in
  // this release — see §6 observability for the full breakdown table).
  llm_attempted: number;
  llm_succeeded: number;
  llm_timeout: number;
  llm_quota_exceeded: number;
  stored_next_sync_token: boolean;
  started_at: string;
  finished_at: string;
};

export type SyncContext = {
  db: PostgresJsDatabase;
  env: Bindings;
  userId: string;
  calendarId: string;
  classifyEvent?: ClassifyEventFn;
  // §6 Wave A — bulk sink for per-call LLM records captured during this run.
  // Called once at sync-run end with the accumulated buffer. Production
  // callers (syncConsumer) wire this to `execCtx.waitUntil(db.insert(...))`;
  // tests omit to skip persistence. No-op when the buffer is empty.
  recordLlmCalls?: (records: LlmCallRecord[]) => void;
  // §6 Wave B — per-run sync log sink. Called exactly once per Worker
  // invocation through the `finalize()` helper wrapping every `runPagedList`
  // return path, so a retry→DLQ sequence surfaces as N records (attempts
  // counter owned by the consumer) and a chunked full_resync surfaces as
  // one record per Worker invocation. Production callers (syncConsumer)
  // wire this to `execCtx.waitUntil(db.insert(syncRuns).values(...))`;
  // tests omit to skip persistence. Synchronous callback — failure-
  // isolation is the wiring layer's responsibility (`.catch(warn)` in the
  // waitUntil chain).
  recordSyncRun?: (record: SyncRunRecord) => void;
};

export type SyncRunOutcome =
  | "ok"
  | "reauth_required"
  | "not_found"
  | "forbidden"
  | "full_sync_required"
  | "retryable";

export type SyncRunRecord = SyncSummary & { outcome: SyncRunOutcome };

export type RunResult =
  | {
      ok: true;
      summary: SyncSummary;
      continuation?:
        | { pageToken: string; timeMin: string; timeMax: string }
        | undefined;
    }
  | {
      ok: false;
      reason: Exclude<SyncRunOutcome, "ok">;
      error: Error;
      summary: SyncSummary;
      retryAfterSec?: number | undefined;
    };

const MAX_PAGES_PER_FULL_RESYNC_RUN = 5;
const FULL_RESYNC_PAST_MS = 30 * 24 * 3600 * 1000;
const FULL_RESYNC_FUTURE_MS = 365 * 24 * 3600 * 1000;

function makeSummary(): SyncSummary {
  return {
    pages: 0,
    seen: 0,
    evaluated: 0,
    updated: 0,
    skipped_manual: 0,
    skipped_equal: 0,
    skipped_no_label: 0,
    cancelled: 0,
    no_match: 0,
    llm_attempted: 0,
    llm_succeeded: 0,
    llm_timeout: 0,
    llm_quota_exceeded: 0,
    stored_next_sync_token: false,
    started_at: new Date().toISOString(),
    finished_at: "",
  };
}

async function loadCategories(
  db: PostgresJsDatabase,
  userId: string,
): Promise<ClassifyContext["categories"]> {
  return await listRules(db, userId);
}

// ADR-0004 #02 AC #6 — per-page batch title embedding. One `env.AI.run` batch
// per page (aligned to the `res.items` boundary of the existing streaming
// paging loop). Vectors are transient (never stored) and consumed by Stage-1
// kNN via the per-page `Map<eventId, vector>`. Cancelled events and empty
// titles are skipped (they never reach Stage 1). A batch failure leaves the
// map empty so every event this page degrades to Stage-2 LLM — the systemic
// Workers-AI failure blast radius (#02 AC #9), bounded by the daily caps.
async function embedPageTitles(
  embed: EmbedTexts,
  items: CalendarEvent[],
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  const targets = items.filter(
    (e) => e.status !== "cancelled" && (e.summary?.trim().length ?? 0) > 0,
  );
  if (targets.length === 0) return map;
  try {
    const vectors = await embed(targets.map((e) => e.summary!.trim()));
    for (let i = 0; i < targets.length; i += 1) {
      const v = vectors[i];
      if (v) map.set(targets[i]!.id, v);
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "page title embedding failed (degrade to Stage 2)",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return map;
}

async function processEvent(
  ctx: SyncContext,
  accessToken: string,
  event: CalendarEvent,
  classifyCtx: ClassifyContext,
  classify: ClassifyEventFn,
  summary: SyncSummary,
): Promise<void> {
  summary.seen += 1;
  if (event.status === "cancelled") {
    summary.cancelled += 1;
    return;
  }
  summary.evaluated += 1;

  // Outcome counters (no_match / llm_*) are now owned by `syncSummarySink`,
  // composed into the chain in `runPagedList`. processEvent only handles
  // lifecycle counters (seen / cancelled / evaluated / skipped_* / updated)
  // that derive from §5.4 ownership marker checks + `patchEventColor`.
  const outcome: ClassificationOutcome = await classify(event, classifyCtx);
  const hit = outcomeToRuleHit(outcome);
  if (hit === null) return;

  // ADR-0006 (native-labels #02) — classification output is a native label.
  // A hit on a rule that has no label yet (pre-cutover row, labelId NULL)
  // is skipped rather than guessed; the #04 cutover backfills `labelId` and
  // re-syncs.
  const target = hit.labelId ?? null;
  if (target === null) {
    summary.skipped_no_label += 1;
    return;
  }
  const currentLabel = event.eventLabelId ?? "";
  // Invariant: the marker is stamped only on labels *this code actually
  // wrote*. We never retro-claim ownership of a label that happens to match
  // our target, even if the equality lets us short-circuit the PATCH below.
  if (currentLabel === target) {
    summary.skipped_equal += 1;
    return;
  }
  // §5.4 ownership-aware skip, label world. Version-gated probes:
  // - marker v2: ownership = stored `autocolor_label` still equals the
  //   event's current `eventLabelId` (the user hasn't re-labelled after us).
  // - marker v1 (transitional, until the #04 re-stamp): ownership = stored
  //   `autocolor_color` still equals the legacy `colorId` — the bridge keeps
  //   colorId stable for classic colors we wrote. Residual v1 blind spot
  //   (user label best-matching our marker color) is ADR-0006 잔여 리스크 ②,
  //   closed by the v2 re-stamp.
  // - unknown versions are opaque: skip rather than misinterpret.
  // Manual signal (native-labels #01): any label/color present without
  // ownership = user-manual — label presence alone is NOT manual (our own
  // writes carry the label / a bridged one).
  const priv = event.extendedProperties?.private;
  const markerVersion = priv?.[AUTOCOLOR_KEYS.version];
  let appOwned = false;
  if (markerVersion === AUTOCOLOR_MARKER_VERSION) {
    const ownedLabel = priv?.[AUTOCOLOR_KEYS.label];
    appOwned = ownedLabel !== undefined && ownedLabel === currentLabel;
  } else if (markerVersion === AUTOCOLOR_MARKER_VERSION_V1) {
    const ownedColor = priv?.[AUTOCOLOR_KEYS.color];
    appOwned = ownedColor !== undefined && ownedColor === (event.colorId ?? "");
  }
  if (currentLabel !== "" && !appOwned) {
    summary.skipped_manual += 1;
    return;
  }
  // Label-less but legacy-colored (pre-bridge relic / cleared-label event
  // keeping a colorId): still user-manual unless owned.
  if ((event.colorId ?? "") !== "" && !appOwned) {
    summary.skipped_manual += 1;
    return;
  }
  await patchEventLabel(accessToken, ctx.calendarId, event.id, target, {
    [AUTOCOLOR_KEYS.version]: AUTOCOLOR_MARKER_VERSION,
    [AUTOCOLOR_KEYS.label]: target,
    [AUTOCOLOR_KEYS.category]: hit.id,
    // Purge the v1 legacy probe on re-stamp so an event never carries a
    // stale colorId marker alongside a v2 marker.
    [AUTOCOLOR_KEYS.color]: null,
  });
  summary.updated += 1;
}

// Hit narrowing — collapses every outcome shape down to "do we PATCH?".
// Returns the RuleRef for hit-shaped outcomes (`embeddingHit` / `llmHit`) and
// `null` for everything else. Lives next to processEvent because this is purely
// a hit-vs-miss decision at the lifecycle layer.
function outcomeToRuleHit(
  outcome: ClassificationOutcome,
): { id: string; name: string; colorId: string; labelId?: string | null } | null {
  switch (outcome.kind) {
    case "llmHit":
    case "embeddingHit":
      return outcome.rule;
    case "embeddingMiss":
    case "ambiguous":
    case "llmTimeout":
    case "llmQuotaExceeded":
    case "llmBadResponse":
    case "noMatch":
      return null;
  }
}

export async function runIncrementalSync(ctx: SyncContext): Promise<RunResult> {
  const rows = await ctx.db
    .select({ nextSyncToken: syncState.nextSyncToken })
    .from(syncState)
    .where(
      and(eq(syncState.userId, ctx.userId), eq(syncState.calendarId, ctx.calendarId)),
    )
    .limit(1);
  const token = rows[0]?.nextSyncToken ?? null;
  if (!token) return runFullResync(ctx);
  return runPagedList(ctx, { syncToken: token }, false);
}

export async function runFullResync(
  ctx: SyncContext,
  opts?: { pageToken?: string; timeMin?: string; timeMax?: string },
): Promise<RunResult> {
  await ctx.db
    .insert(syncState)
    .values({ userId: ctx.userId, calendarId: ctx.calendarId })
    .onConflictDoNothing();

  // Window is computed once per full_resync run and must be reused across every
  // chunked continuation — Google couples `pageToken` to the original timeMin/
  // timeMax and rejects / silently returns inconsistent results otherwise.
  const timeMin =
    opts?.timeMin ?? new Date(Date.now() - FULL_RESYNC_PAST_MS).toISOString();
  const timeMax =
    opts?.timeMax ?? new Date(Date.now() + FULL_RESYNC_FUTURE_MS).toISOString();
  return runPagedList(
    ctx,
    { timeMin, timeMax, pageToken: opts?.pageToken },
    true,
  );
}

type ListStart = {
  syncToken?: string | undefined;
  pageToken?: string | undefined;
  timeMin?: string | undefined;
  timeMax?: string | undefined;
};

async function runPagedList(
  ctx: SyncContext,
  start: ListStart,
  chunked: boolean,
): Promise<RunResult> {
  const summary = makeSummary();
  // §6 Wave A buffer — every LLM call during this run (including quota-
  // latched skips) pushes a record. Flushed via `flushLlmCalls()` before
  // every return, so retryable failures still record the work done before
  // the page loop aborted.
  const llmCallBuffer: LlmCallRecord[] = [];
  const flushLlmCalls = (): void => {
    if (llmCallBuffer.length === 0) return;
    ctx.recordLlmCalls?.(llmCallBuffer);
  };
  // §6 Wave B — every early return must be routed through `finalize()` so
  // `ctx.recordSyncRun` fires exactly once per Worker invocation. Bypassing
  // this helper silently drops the observability row for that outcome; the
  // `calendarSync.test.ts` "finalize routes all outcomes" suite tests all
  // six branches to catch regressions.
  const finalize = (result: RunResult): RunResult => {
    if (!summary.finished_at) {
      summary.finished_at = new Date().toISOString();
    }
    const outcome: SyncRunOutcome = result.ok ? "ok" : result.reason;
    ctx.recordSyncRun?.({ ...summary, outcome });
    return result;
  };
  // ADR-0004 #02 — Stage-1 embedding kNN. The default classifier reads each
  // event's title vector from `pageVectors`, refreshed per page by
  // `embedPageTitles` in the loop below. `getTitleVector` closes over the
  // (reassigned-per-page) `pageVectors` binding so the classifier always sees
  // the current page's map. When `env.AI` is unbound, `stage1` is omitted and
  // the chain degrades to LLM-only (#02 AC #9). A test-injected
  // `ctx.classifyEvent` bypasses both the chain and per-page embedding.
  const embedTitles = resolveEmbedder(ctx.env);
  const usingDefaultClassifier = ctx.classifyEvent === undefined;
  let pageVectors = new Map<string, number[]>();
  const classify =
    ctx.classifyEvent ??
    buildDefaultClassifier({
      db: ctx.db,
      env: ctx.env,
      userId: ctx.userId,
      sinks: [
        syncSummarySink(summary),
        llmCallsBufferSink((rec) => {
          llmCallBuffer.push(rec);
        }),
      ],
      ...(embedTitles
        ? {
            stage1: {
              db: ctx.db,
              embedTexts: embedTitles,
              getTitleVector: (id: string) => pageVectors.get(id),
            },
          }
        : {}),
    });

  try {
  let accessToken: string;
  try {
    const res = await getValidAccessToken(ctx.db, ctx.env, ctx.userId);
    accessToken = res.accessToken;
  } catch (err) {
    summary.finished_at = new Date().toISOString();
    if (err instanceof ReauthRequiredError) {
      return finalize({ ok: false, reason: "reauth_required", error: err, summary });
    }
    return finalize({ ok: false, reason: "retryable", error: err as Error, summary });
  }

  // ADR-0006 (native-labels #02) — fold Google-side label edits into the
  // rule cache BEFORE loading categories, so this very run classifies with
  // renamed/created rules and never assigns a deleted-label rule. Warn-only
  // inside; a reconcile failure degrades to the cached rules. Runs only with
  // the default classifier — a test-injected `ctx.classifyEvent` bypasses
  // rules entirely, so the extra `calendars.get` fetch would be pure waste.
  // Subrequest budget: this is the run's single extra fetch (+ AI embed
  // calls only when a rename/new label needs re-seeding).
  if (usingDefaultClassifier) {
    await reconcileLabels({
      db: ctx.db,
      userId: ctx.userId,
      calendarId: ctx.calendarId,
      accessToken,
      embed: embedTitles,
    });
  }

  const cats = await loadCategories(ctx.db, ctx.userId);
  const classifyCtx: ClassifyContext = { userId: ctx.userId, categories: cats };

  let pageToken: string | undefined = start.pageToken;
  let finalSyncToken: string | undefined;
  let continuation:
    | { pageToken: string; timeMin: string; timeMax: string }
    | undefined;

  do {
    try {
      const res = await listEvents(accessToken, ctx.calendarId, {
        syncToken: start.syncToken,
        pageToken,
        timeMin: start.timeMin,
        timeMax: start.timeMax,
      });
      summary.pages += 1;
      // Refresh the per-page title vectors before classifying this page's
      // events. Only when the default (embedding) classifier is in use.
      if (usingDefaultClassifier && embedTitles) {
        pageVectors = await embedPageTitles(embedTitles, res.items ?? []);
      }
      for (const ev of res.items ?? []) {
        try {
          await processEvent(ctx, accessToken, ev, classifyCtx, classify, summary);
        } catch (err) {
          if (err instanceof CalendarApiError) {
            // Session-wide / transient signals must abort the page loop so
            // Queue retry/backoff kicks in — otherwise a transient 429 or 5xx
            // on PATCH leaves the event mis-colored until it mutates again.
            // Per-event kinds (e.g. 404/410 for a deleted event; 410 from
            // PATCH is classified `full_sync_required` by status alone) are
            // absorbed as no_match so one stale event doesn't wipe the
            // calendar's nextSyncToken.
            if (
              err.kind === "auth" ||
              err.kind === "rate_limited" ||
              err.kind === "server"
            ) {
              throw err;
            }
            summary.no_match += 1;
          } else {
            throw err;
          }
        }
      }
      pageToken = res.nextPageToken;
      if (res.nextSyncToken) finalSyncToken = res.nextSyncToken;

      if (chunked && pageToken && summary.pages >= MAX_PAGES_PER_FULL_RESYNC_RUN) {
        // chunked runs are always full_resync, so timeMin/timeMax are set.
        continuation = {
          pageToken,
          timeMin: start.timeMin!,
          timeMax: start.timeMax!,
        };
        break;
      }
    } catch (err) {
      summary.finished_at = new Date().toISOString();
      if (err instanceof CalendarApiError) {
        if (err.kind === "auth") {
          return finalize({ ok: false, reason: "reauth_required", error: err, summary });
        }
        if (err.kind === "full_sync_required") {
          // Clear the stale token here; lastFullResyncAt is stamped only when
          // the subsequent full_resync actually completes (success path below).
          await ctx.db
            .update(syncState)
            .set({
              nextSyncToken: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(syncState.userId, ctx.userId),
                eq(syncState.calendarId, ctx.calendarId),
              ),
            );
          return finalize({ ok: false, reason: "full_sync_required", error: err, summary });
        }
        if (err.kind === "forbidden") {
          return finalize({ ok: false, reason: "forbidden", error: err, summary });
        }
        if (err.kind === "not_found") {
          await ctx.db
            .update(syncState)
            .set({ active: false, updatedAt: sql`now()` })
            .where(
              and(
                eq(syncState.userId, ctx.userId),
                eq(syncState.calendarId, ctx.calendarId),
              ),
            );
          return finalize({ ok: false, reason: "not_found", error: err, summary });
        }
        return finalize({
          ok: false,
          reason: "retryable",
          error: err,
          retryAfterSec: err.retryAfterSec,
          summary,
        });
      }
      return finalize({ ok: false, reason: "retryable", error: err as Error, summary });
    }
  } while (pageToken);

  summary.finished_at = new Date().toISOString();

  if (!continuation && finalSyncToken) {
    // Stamp the flag BEFORE persisting so the stored summary is accurate.
    summary.stored_next_sync_token = true;
    const update: Partial<typeof syncState.$inferInsert> = {
      nextSyncToken: finalSyncToken,
      lastError: null,
      lastErrorAt: null,
      lastRunSummary: summary,
      // §6 Wave A — clear any retryable-failure summary that was staged by
      // a prior attempt. Leaving it set after a successful run would cause
      // the next DLQ landing on an unrelated job to snapshot stale data.
      lastFailureSummary: null,
      updatedAt: sql`now()` as unknown as Date,
    };
    if (start.timeMin) {
      update.lastFullResyncAt = sql`now()` as unknown as Date;
    }
    await ctx.db
      .update(syncState)
      .set(update)
      .where(
        and(
          eq(syncState.userId, ctx.userId),
          eq(syncState.calendarId, ctx.calendarId),
        ),
      );
  } else if (!finalSyncToken) {
    // Mid-chunked full_resync: record partial summary without touching token.
    await ctx.db
      .update(syncState)
      .set({
        lastRunSummary: summary,
        // Same clear-on-progress rationale as the full-sync branch above.
        lastFailureSummary: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(syncState.userId, ctx.userId),
          eq(syncState.calendarId, ctx.calendarId),
        ),
      );
  }

  return finalize({ ok: true, summary, continuation });
  } finally {
    // Every return path above flows through here — including each
    // reauth/forbidden/not_found/retryable early return — so the buffer
    // always flushes once per run, never twice and never zero times.
    // `recordSyncRun` runs on the return side (inside finalize), not here,
    // because outcome isn't known until the RunResult is in hand.
    flushLlmCalls();
  }
}

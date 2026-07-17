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
  // sync-reliability #04 — set when a syncToken-paged run found
  // sync_state.nextSyncToken changed since its arc started (another run
  // completed meanwhile): either the resume-hop entry pre-check tripped
  // before any external fetch, or the final CAS UPDATE missed. The newer
  // token survived either way. Present-only-when-true and deliberately NOT
  // a `sync_runs` column (jsonb summaries only — same policy as
  // `skipped_no_label`); the flagged summary is persisted through a narrow
  // `lastRunSummary` write, which is the durable surface distinguishing a
  // stale-skip from a #02 budget stop (both share the `outcome='ok' AND
  // stored_next_sync_token=false` sync_runs signature).
  sync_token_write_skipped?: true;
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

// Chunk-continuation coordinates the consumer (`applyResult`) re-enqueues as
// a fresh queue job. Two shapes, discriminated by `syncToken` presence:
// - full_resync (window-paged): `timeMin`/`timeMax` — Google couples the
//   pageToken to the original window, so it must survive the hop unchanged.
// - incremental (syncToken-paged, #02 budget guard): `syncToken` — carried in
//   the job rather than re-read from sync_state so the (syncToken, pageToken)
//   pair Google sees stays consistent even if another incremental sync
//   interleaves between the stop and the resume. Staleness is guarded in
//   three layers (#04): a resumed hop pre-checks the store at entry and
//   aborts before any external fetch when a newer NON-NULL token landed
//   while the job sat in the queue; every syncToken-paged run stores its
//   arc's final token via a CAS on the arc's start token (covers changes
//   that land DURING a hop, incl. stale-claim overlap); and a stale-skip
//   persists the flagged summary to sync_state.lastRunSummary so the skip
//   is durably distinguishable from a #02 budget stop.
export type SyncContinuation = {
  pageToken: string;
  timeMin?: string | undefined;
  timeMax?: string | undefined;
  syncToken?: string | undefined;
};

export type RunResult =
  | {
      ok: true;
      summary: SyncSummary;
      continuation?: SyncContinuation | undefined;
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

// sync-reliability #02 — per-invocation subrequest budget guard. Workers Free
// caps external fetches at 50 per invocation; past the cap EVERY subsequent
// fetch() rejects with "Too many subrequests", which silently drops LLM
// classifications (bad_response → no_match) and turns PATCH failures into
// queue retry storms that burn the daily LLM quota (see
// .scratch/sync-reliability/PRD.md). `runPagedList` therefore counts the
// external fetches it issues — events.list, events.patch, per-page title
// embedding, and the LLM leg's OpenAI calls — and stops at a safe point,
// re-enqueueing a continuation chunk instead of running into the cap.
//
// The default (40) leaves the 50-cap margin for the fetches the guard does
// NOT count: token refresh, the Hyperdrive DB connection, and the queue
// producer send. Plan changes (#01 Workers Paid, 1000-subrequest cap) only
// change the env value — the guard logic is plan-agnostic.
const DEFAULT_SUBREQUEST_BUDGET = 40;
// Fixed per-page fetches: 1 events.list + 1 Workers-AI title-embed batch.
const PAGE_FIXED_FETCH_COST = 2;
// Fixed per-run fetches: 1 calendars.get labelProperties (ADR-0006 label
// reconcile, before the first page). Reconcile's Workers-AI re-seed embeds
// (rename/new label only) are deliberately NOT budgeted — rare, and covered
// by the 50-cap margin the default budget leaves.
const RUN_FIXED_FETCH_COST = 1;
// Worst-case per-event fetches: ≤2 OpenAI attempts (llmClassifier
// MAX_ATTEMPTS) + 1 events.patch.
const PER_EVENT_FETCH_COST = 3;

// Same parse rules as `parseDailyLimit` (llmClassifier.ts): NaN / ≤0 / unset
// all fall back to the default.
function parseSubrequestBudget(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SUBREQUEST_BUDGET;
}

// events.list page size is DERIVED from the budget so that one full page can
// never overrun a fresh invocation's budget (run-fixed + page-fixed +
// perEvent×P ≤ budget — the run-fixed reconcile fetch is included because
// every resumed chunk pays it again before its first page).
// That is what makes same-pageToken resume convergent: a page interrupted
// mid-way (entered with budget already partially spent) completes on the next
// invocation, which starts from used=0 and re-processes the page's prefix
// idempotently (same color → skipped_equal). Keeping maxResults at 2500 with
// a 40-fetch budget would strand large LLM-heavy pages forever — every redo
// re-burns one OpenAI fetch per rule-miss event before reaching fresh work.
function deriveSyncPageSize(budget: number): number {
  const p = Math.floor(
    (budget - RUN_FIXED_FETCH_COST - PAGE_FIXED_FETCH_COST) / PER_EVENT_FETCH_COST,
  );
  return Math.min(2500, Math.max(1, p));
}

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
  // #02 budget guard — shared per-invocation fetch counter owned by
  // `runPagedList`. processEvent adds the LLM leg's OpenAI attempts and the
  // events.patch it issues.
  fetches: { used: number },
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
  // #02 budget guard — OpenAI fetches are counted post-hoc from the record
  // every llm* outcome carries (`attempts` = actual fetch count; 0 for the
  // quota-latched / disabled short-circuits that never fetched). Reading the
  // record here keeps the counter wiring entirely out of classifierChain /
  // llmClassifier.
  if ("llmRecord" in outcome) fetches.used += outcome.llmRecord.attempts;
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
  // Counted before issuing — a PATCH that throws still consumed budget.
  fetches.used += 1;
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

export async function runIncrementalSync(
  ctx: SyncContext,
  // #02 budget guard — continuation resume. Carries the exact
  // (syncToken, pageToken) pair the interrupted run was paging with, so the
  // pair Google sees stays consistent even if another incremental sync
  // interleaved and stored a fresh token in sync_state meanwhile. A stale
  // pair is self-healing: Google answers 410 → full_sync_required recovery.
  opts?: { syncToken: string; pageToken: string },
): Promise<RunResult> {
  if (opts) {
    return runPagedList(
      ctx,
      { syncToken: opts.syncToken, pageToken: opts.pageToken },
      false,
    );
  }
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
  // #02 subrequest budget guard state. `fetches.used` counts the external
  // fetches this invocation issued (events.list / title-embed batch /
  // events.patch / OpenAI attempts). Two stop points, both re-enqueued as a
  // continuation chunk via the consumer:
  // - mid-page: before each event, when even a worst-case event (3 fetches)
  //   no longer fits, resume from the CURRENT page's token — re-processing
  //   the already-handled prefix is idempotent (same color → skipped_equal).
  // - page boundary: only start the next page when fetching it plus at least
  //   one event still fits.
  // Budget stops are observable as sync_runs rows with outcome='ok' AND
  // stored_next_sync_token=false (for full_resync additionally
  // pages < MAX_PAGES_PER_FULL_RESYNC_RUN), plus the warn line below.
  const budget = parseSubrequestBudget(ctx.env.SYNC_SUBREQUEST_BUDGET);
  const pageSize = deriveSyncPageSize(budget);
  const fetches = { used: 0 };
  // Counters only — no event content (log redaction contract). calendarId is
  // deliberately excluded: a primary calendar id is the user's email.
  const warnBudgetStop = (): void => {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "subrequest budget reached — stopping run, re-enqueueing continuation chunk",
        used: fetches.used,
        budget,
        pages: summary.pages,
        seen: summary.seen,
        userId: ctx.userId,
      }),
    );
  };
  // Continuation coordinates for a budget stop. `chunked` runs are always
  // full_resync (window present); non-chunked runs are always syncToken-paged
  // (runIncrementalSync is the only caller) — hence the non-null assertions.
  const budgetContinuation = (resumeToken: string): SyncContinuation =>
    chunked
      ? { pageToken: resumeToken, timeMin: start.timeMin!, timeMax: start.timeMax! }
      : { pageToken: resumeToken, syncToken: start.syncToken! };
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
  // #04 — shared stale-skip path, used by the entry pre-check and the
  // final-write CAS miss below. Flags the summary, emits one counters-only
  // warn (no calendarId — a primary calendar id is the user's email), and
  // persists the flagged summary through a NARROW sync_state UPDATE:
  // lastRunSummary + updatedAt only. Deliberately NO nextSyncToken (the
  // newer token must survive), NO lastFailureSummary (a stale-skip is not
  // "progress" that may clear another run's staged failure snapshot), NO
  // lastError. The narrow write is the durable surface that distinguishes a
  // stale-skip from a #02 budget stop — sync_runs rows are scalar-only, so
  // without it the flag would live in memory and transient logs alone.
  const staleSkip = async (): Promise<void> => {
    summary.stored_next_sync_token = false;
    summary.sync_token_write_skipped = true;
    if (!summary.finished_at) {
      summary.finished_at = new Date().toISOString();
    }
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "stale continuation — sync_state token changed since arc start; skipping token write",
        pages: summary.pages,
        seen: summary.seen,
        userId: ctx.userId,
      }),
    );
    await ctx.db
      .update(syncState)
      .set({ lastRunSummary: summary, updatedAt: sql`now()` })
      .where(
        and(
          eq(syncState.userId, ctx.userId),
          eq(syncState.calendarId, ctx.calendarId),
        ),
      );
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
  // #04 — entry pre-check: a resumed hop (syncToken AND pageToken carried in
  // from the queue job) proves its arc is still current BEFORE doing any
  // external work. If a newer run completed while this job sat in the queue,
  // the stored token differs and the whole hop is stale — abort here with
  // zero external fetches instead of burning quota on pages/PATCHes whose
  // final token write would only be skipped by the CAS below anyway (worse:
  // a hop that budget-stops again would re-enqueue the stale arc without
  // ever reaching that CAS). A NULL store is tolerated: that is a 410-clear
  // / bootstrap absence, not evidence of a newer completed run — the pending
  // full_resync re-establishes the arc and the final-write CAS still
  // protects this corner.
  if (start.syncToken !== undefined && start.pageToken !== undefined) {
    const rows = await ctx.db
      .select({ nextSyncToken: syncState.nextSyncToken })
      .from(syncState)
      .where(
        and(
          eq(syncState.userId, ctx.userId),
          eq(syncState.calendarId, ctx.calendarId),
        ),
      )
      .limit(1);
    const stored = rows[0]?.nextSyncToken ?? null;
    if (stored !== null && stored !== start.syncToken) {
      await staleSkip();
      return finalize({ ok: true, summary });
    }
  }

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
  // calls only when a rename/new label needs re-seeding) — pre-paid by
  // RUN_FIXED_FETCH_COST in the page-size derivation.
  if (usingDefaultClassifier) {
    fetches.used += 1; // calendars.get labelProperties
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
  let continuation: SyncContinuation | undefined;

  do {
    // Token that fetched the page currently being processed — the mid-page
    // budget stop's resume point. Undefined only on the very first page of a
    // fresh arc, where the mid-page guard can never trip: page size is
    // derived so a full page fits a fresh invocation's budget.
    const thisPageToken = pageToken;
    try {
      fetches.used += 1; // events.list
      const res = await listEvents(accessToken, ctx.calendarId, {
        syncToken: start.syncToken,
        pageToken,
        timeMin: start.timeMin,
        timeMax: start.timeMax,
        maxResults: pageSize,
      });
      summary.pages += 1;
      // Refresh the per-page title vectors before classifying this page's
      // events. Only when the default (embedding) classifier is in use.
      if (usingDefaultClassifier && embedTitles) {
        fetches.used += 1; // Workers-AI title-embed batch
        pageVectors = await embedPageTitles(embedTitles, res.items ?? []);
      }
      for (const ev of res.items ?? []) {
        // #02 mid-page budget stop — see the guard-state comment above.
        if (
          thisPageToken !== undefined &&
          fetches.used + PER_EVENT_FETCH_COST > budget
        ) {
          continuation = budgetContinuation(thisPageToken);
          warnBudgetStop();
          break;
        }
        try {
          await processEvent(ctx, accessToken, ev, classifyCtx, classify, summary, fetches);
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
      // Mid-page budget stop: leave this page's nextPageToken/nextSyncToken
      // untouched — the continuation re-fetches the same page, so advancing
      // either would skip its unprocessed tail.
      if (continuation) break;
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
      // #02 page-boundary budget stop: start the next page only when fetching
      // + embedding it plus at least one worst-case event still fits.
      if (
        pageToken &&
        fetches.used + PAGE_FIXED_FETCH_COST + PER_EVENT_FETCH_COST > budget
      ) {
        continuation = budgetContinuation(pageToken);
        warnBudgetStop();
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
    // sync-reliability #04 — every syncToken-paged run (fresh AND resumed)
    // writes its arc's final token through a CAS: only when sync_state still
    // holds the token this arc started from. Fresh runs are USUALLY
    // claim-atomic, but syncClaim's 5-minute stale window explicitly allows
    // a second consumer to take over while an overrunning run is still
    // executing — so an unconditional fresh-run write would be a second
    // token-rollback path. The uniform CAS gives the store a linearity
    // invariant: it only ever moves X → Y where Y was minted by an arc that
    // started at the stored X; no writer can regress it. A CAS miss skips
    // the token/failure-clear entirely (the interleaved run's writes are the
    // authoritative ones) and routes through `staleSkip` for the durable
    // flagged-summary surface. full_resync stays unconditional — its purpose
    // is to establish a fresh token arc.
    if (start.syncToken !== undefined) {
      const casRows = await ctx.db
        .update(syncState)
        .set(update)
        .where(
          and(
            eq(syncState.userId, ctx.userId),
            eq(syncState.calendarId, ctx.calendarId),
            eq(syncState.nextSyncToken, start.syncToken),
          ),
        )
        .returning({ id: syncState.id });
      if (casRows.length === 0) {
        await staleSkip();
      }
    } else {
      await ctx.db
        .update(syncState)
        .set(update)
        .where(
          and(
            eq(syncState.userId, ctx.userId),
            eq(syncState.calendarId, ctx.calendarId),
          ),
        );
    }
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

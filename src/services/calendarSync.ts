import { and, asc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { categories, syncState } from "../db/schema";
import type { Bindings } from "../env";
import type { ClassifyContext, ClassifyEventFn } from "./classifier";
import { buildDefaultClassifier } from "./classifierChain";
import {
  CalendarApiError,
  listEvents,
  patchEventColor,
  type CalendarEvent,
} from "./googleCalendar";
import { ReauthRequiredError, getValidAccessToken } from "./tokenRefresh";

export type SyncSummary = {
  pages: number;
  seen: number;
  evaluated: number;
  updated: number;
  skipped_manual: number;
  skipped_equal: number;
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
};

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
      reason:
        | "reauth_required"
        | "not_found"
        | "forbidden"
        | "full_sync_required"
        | "retryable";
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
  return await db
    .select({
      id: categories.id,
      name: categories.name,
      colorId: categories.colorId,
      keywords: categories.keywords,
      priority: categories.priority,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.priority), asc(categories.createdAt));
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

  const classification = await classify(event, classifyCtx);
  if (!classification) {
    summary.no_match += 1;
    return;
  }

  const current = event.colorId ?? "";
  // Idempotency: already our target color → skip PATCH.
  if (current === classification.colorId) {
    summary.skipped_equal += 1;
    return;
  }
  // Manual override protection: user picked a different color → don't touch.
  if (current) {
    summary.skipped_manual += 1;
    return;
  }
  await patchEventColor(accessToken, ctx.calendarId, event.id, classification.colorId);
  summary.updated += 1;
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
  const classify =
    ctx.classifyEvent ??
    buildDefaultClassifier({
      db: ctx.db,
      env: ctx.env,
      userId: ctx.userId,
      onLlmAttempted: () => {
        summary.llm_attempted += 1;
      },
      onLlmSucceeded: () => {
        summary.llm_succeeded += 1;
      },
      onLlmTimeout: () => {
        summary.llm_timeout += 1;
      },
      onLlmQuotaExceeded: () => {
        summary.llm_quota_exceeded += 1;
      },
    });

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
          return { ok: false, reason: "reauth_required", error: err, summary };
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
          return { ok: false, reason: "full_sync_required", error: err, summary };
        }
        if (err.kind === "forbidden") {
          return { ok: false, reason: "forbidden", error: err, summary };
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
          return { ok: false, reason: "not_found", error: err, summary };
        }
        return {
          ok: false,
          reason: "retryable",
          error: err,
          retryAfterSec: err.retryAfterSec,
          summary,
        };
      }
      return { ok: false, reason: "retryable", error: err as Error, summary };
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
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(syncState.userId, ctx.userId),
          eq(syncState.calendarId, ctx.calendarId),
        ),
      );
  }

  return { ok: true, summary, continuation };
}

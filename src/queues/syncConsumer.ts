import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db";
import { llmCalls, rollbackRuns, syncRuns, syncState } from "../db/schema";
import type { Bindings } from "../env";
import { computeBackoffSeconds } from "../lib/backoff";
import { claimSyncRun, releaseSyncRun } from "../lib/syncClaim";
import {
  runFullResync,
  runIncrementalSync,
  type RunResult,
  type SyncRunRecord,
} from "../services/calendarSync";
import {
  runColorRollback,
  type RollbackResult,
} from "../services/colorRollback";
import type { LlmCallRecord } from "../services/llmClassifier";
import { markReauthRequired } from "../services/oauthTokenService";
import { enqueueSync } from "./syncProducer";
import type { SyncJob } from "./types";

export async function handleSyncBatch(
  batch: MessageBatch<SyncJob>,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<void> {
  // Process messages sequentially within a batch to keep DB pool pressure low
  // (postgres.js is configured with max: 1).
  for (const msg of batch.messages) {
    await handleOne(msg, env, ctx);
  }
}

async function handleOne(
  msg: Message<SyncJob>,
  env: Bindings,
  execCtx: ExecutionContext,
): Promise<void> {
  const job = msg.body;
  const { db, close } = getDb(env);
  try {
    if (job.type === "color_rollback") {
      // §5 후속 B — rollback doesn't bootstrap sync_state (it's a per-event
      // cleanup, not a sync) and deliberately does not take the sync claim.
      // Holding the claim would coalesce concurrent sync runs and freeze
      // /sync/run's user-visible rate limit for the duration of the
      // rollback. Google's last-writer-wins PATCH makes overlap benign.
      const rollback = await runColorRollback(
        { db, env, userId: job.userId, calendarId: job.calendarId },
        job.categoryId,
      );
      await applyRollbackResult(db, msg, job, rollback);
      return;
    }

    // Bootstrap sync_state before claiming. `/sync/run` and `/sync/bootstrap`
    // already upsert this row, but a DLQ replay, orphaned queue message, or
    // manual injection could deliver a job whose row is missing — without
    // this, the claim UPDATE would silently match 0 rows and we'd ack as
    // "coalesced", dropping the message. If the row was genuinely created
    // here, log at warn level so the anomaly is observable.
    const bootstrapped = await db
      .insert(syncState)
      .values({ userId: job.userId, calendarId: job.calendarId })
      .onConflictDoNothing()
      .returning({ id: syncState.id });
    if (bootstrapped.length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "sync_state row bootstrapped by consumer (expected from /sync/run or /sync/bootstrap)",
          job: safeJob(job),
        }),
      );
    }

    const claim = await claimSyncRun(db, job.userId, job.calendarId);
    if (!claim.acquired) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "sync coalesced (claim not acquired — another consumer is running)",
          job: safeJob(job),
        }),
      );
      msg.ack();
      return;
    }

    // §6 Wave A — bulk sink for the sync run's LLM call log. `runPagedList`
    // buffers per-call records and flushes once through this hook. We wrap
    // the insert in `waitUntil` so the response is not blocked on telemetry,
    // and `.catch` downgrades any DB write failure to a warn log — missing
    // observability must never cause the sync itself to retry.
    const recordLlmCalls = (records: LlmCallRecord[]): void => {
      if (records.length === 0) return;
      const rows = records.map((r) => ({
        userId: job.userId,
        outcome: r.outcome,
        latencyMs: r.latencyMs,
        categoryCount: r.categoryCount,
        attempts: r.attempts,
        ...(r.httpStatus !== undefined ? { httpStatus: r.httpStatus } : {}),
        ...(r.categoryName !== undefined ? { categoryName: r.categoryName } : {}),
      }));
      execCtx.waitUntil(
        db
          .insert(llmCalls)
          .values(rows)
          .catch((e: unknown) => {
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "llm_calls insert failed",
                error: e instanceof Error ? e.message : String(e),
                userId: job.userId,
              }),
            );
          }),
      );
    };

    // §6 Wave B — per-run sync log sink. Same fire-and-forget discipline as
    // recordLlmCalls above: insert errors fall through to a warn log and never
    // trigger msg.retry. `finalize()` in runPagedList guarantees exactly one
    // record per Worker invocation regardless of outcome, so retried messages
    // emit N rows (Queue owns `attempts`) and chunked full_resync runs emit
    // one row per invocation.
    const recordSyncRun = (record: SyncRunRecord): void => {
      execCtx.waitUntil(
        db
          .insert(syncRuns)
          .values({
            userId: job.userId,
            calendarId: job.calendarId,
            startedAt: new Date(record.started_at),
            finishedAt: new Date(
              record.finished_at || new Date().toISOString(),
            ),
            pages: record.pages,
            seen: record.seen,
            evaluated: record.evaluated,
            updated: record.updated,
            skippedManual: record.skipped_manual,
            skippedEqual: record.skipped_equal,
            cancelled: record.cancelled,
            noMatch: record.no_match,
            llmAttempted: record.llm_attempted,
            llmSucceeded: record.llm_succeeded,
            llmTimeout: record.llm_timeout,
            llmQuotaExceeded: record.llm_quota_exceeded,
            storedNextSyncToken: record.stored_next_sync_token,
            outcome: record.outcome,
          })
          .catch((e: unknown) => {
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "sync_runs insert failed",
                error: e instanceof Error ? e.message : String(e),
                userId: job.userId,
                calendarId: job.calendarId,
              }),
            );
          }),
      );
    };

    let result: RunResult;
    try {
      result =
        job.type === "incremental"
          ? await runIncrementalSync({
              db,
              env,
              userId: job.userId,
              calendarId: job.calendarId,
              recordLlmCalls,
              recordSyncRun,
            })
          : await runFullResync(
              {
                db,
                env,
                userId: job.userId,
                calendarId: job.calendarId,
                recordLlmCalls,
                recordSyncRun,
              },
              {
                ...(job.pageToken ? { pageToken: job.pageToken } : {}),
                ...(job.timeMin ? { timeMin: job.timeMin } : {}),
                ...(job.timeMax ? { timeMax: job.timeMax } : {}),
              },
            );
    } finally {
      // Release BEFORE applyResult — applyResult may enqueue a full_resync
      // continuation, and the next consumer must be able to claim without
      // hitting our still-fresh in_progress_at (which would coalesce and drop
      // the message). Release is ownership-aware: if our run overran the
      // STALE_WINDOW_MS and a newer consumer already re-claimed, this is a
      // no-op.
      await releaseSyncRun(
        db,
        job.userId,
        job.calendarId,
        claim.claimedAt,
      ).catch(() => undefined);
    }
    await applyResult(db, env, msg, job, result);
  } catch (err) {
    // Unknown error — record and let Queue retry counter decide DLQ fate.
    await recordUnknownError(db, job, err);
    msg.retry({ delaySeconds: computeBackoffSeconds(msg.attempts) });
  } finally {
    execCtx.waitUntil(close());
  }
}

// §5 후속 B — rollback result → Queue ack/retry map. Deliberately does NOT
// write to sync_state.last_error (rollback failure shouldn't pollute the
// user-visible sync health panel). Reauth flips the global needs_reauth
// flag through markReauthRequired so the user's next /me call surfaces it.
async function applyRollbackResult(
  db: ReturnType<typeof getDb>["db"],
  msg: Message<SyncJob>,
  job: Extract<SyncJob, { type: "color_rollback" }>,
  result: RollbackResult,
): Promise<void> {
  // §6 Wave A — persist run result BEFORE ack/retry so every outcome
  // (including retryable attempts that later DLQ) is visible in
  // `rollback_runs`. The insert is best-effort: a failure here must NOT
  // cause msg.retry, since a retried rollback re-issues clearEventColor
  // PATCHes on already-cleared events and costs Google API quota.
  await db
    .insert(rollbackRuns)
    .values({
      userId: job.userId,
      calendarId: job.calendarId,
      categoryId: job.categoryId,
      startedAt: new Date(result.summary.started_at),
      finishedAt: new Date(
        result.summary.finished_at || new Date().toISOString(),
      ),
      pages: result.summary.pages,
      seen: result.summary.seen,
      cleared: result.summary.cleared,
      skippedStaleMarker: result.summary.skipped_stale_marker,
      skippedManualOverride: result.summary.skipped_manual_override,
      skippedVersionMismatch: result.summary.skipped_version_mismatch,
      notFound: result.summary.not_found,
      forbiddenEvents: result.summary.forbidden_events,
      outcome: result.ok ? "ok" : result.reason,
      attempt: msg.attempts,
      errorMessage: result.ok ? null : result.error.message,
    })
    .catch((e: unknown) => {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "rollback_runs insert failed",
          error: e instanceof Error ? e.message : String(e),
          job: safeJob(job),
        }),
      );
    });

  if (result.ok) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "color_rollback completed",
        job: safeJob(job),
        summary: result.summary,
      }),
    );
    msg.ack();
    return;
  }
  if (result.reason === "reauth_required") {
    await markReauthRequired(db, job.userId, result.error.message).catch(
      () => undefined,
    );
    msg.ack();
    return;
  }
  if (result.reason === "forbidden" || result.reason === "not_found") {
    console.log(
      JSON.stringify({
        level: "info",
        msg: `color_rollback aborted (${result.reason})`,
        job: safeJob(job),
      }),
    );
    msg.ack();
    return;
  }
  const delay = result.retryAfterSec ?? computeBackoffSeconds(msg.attempts);
  msg.retry({ delaySeconds: delay });
}

async function applyResult(
  db: ReturnType<typeof getDb>["db"],
  env: Bindings,
  msg: Message<SyncJob>,
  job: SyncJob,
  result: RunResult,
): Promise<void> {
  if (result.ok) {
    if (result.continuation) {
      // Chunked full_resync: enqueue next page as a fresh job (attempt counter
      // resets). timeMin/timeMax must survive the hop so the same pageToken
      // keeps seeing the same query window — see types.ts comment.
      // Incremental → full_resync fallthrough (empty token) is a first-time
      // bootstrap, so label the continuation accordingly rather than "manual".
      const continuationReason =
        job.type === "full_resync" ? job.reason : "bootstrap";
      await enqueueSync(env, {
        type: "full_resync",
        userId: job.userId,
        calendarId: job.calendarId,
        reason: continuationReason,
        enqueuedAt: Date.now(),
        pageToken: result.continuation.pageToken,
        timeMin: result.continuation.timeMin,
        timeMax: result.continuation.timeMax,
      });
    }
    msg.ack();
    return;
  }

  // Persist last_error for UI. §6 Wave A — also persist the current run's
  // summary to `last_failure_summary` so the DLQ consumer can snapshot it
  // into `sync_failures.summary_snapshot` if retries eventually exhaust.
  // Non-retryable reasons (reauth/forbidden/not_found/full_sync_required)
  // do not round-trip through DLQ, so stamping them is cheap bookkeeping.
  // Success paths (calendarSync.ts) clear the column to null.
  const errMessage = result.error.message;
  await db
    .update(syncState)
    .set({
      lastError: errMessage,
      lastErrorAt: sql`now()`,
      lastFailureSummary: result.summary,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(syncState.userId, job.userId),
        eq(syncState.calendarId, job.calendarId),
      ),
    );

  if (result.reason === "reauth_required") {
    await markReauthRequired(db, job.userId, errMessage).catch(() => undefined);
    msg.ack();
    return;
  }
  if (result.reason === "forbidden" || result.reason === "not_found") {
    msg.ack();
    return;
  }
  if (result.reason === "full_sync_required") {
    await enqueueSync(env, {
      type: "full_resync",
      userId: job.userId,
      calendarId: job.calendarId,
      reason: "410-recovery",
      enqueuedAt: Date.now(),
    });
    msg.ack();
    return;
  }
  // retryable
  const delay = result.retryAfterSec ?? computeBackoffSeconds(msg.attempts);
  msg.retry({ delaySeconds: delay });
}

async function recordUnknownError(
  db: ReturnType<typeof getDb>["db"],
  job: SyncJob,
  err: unknown,
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  // Best-effort persist: if Hyperdrive/Postgres is itself down, we must not
  // block the caller's msg.retry path. Swallow the DB error but surface it to
  // Worker logs so that §6 observability picks up "DB write failed" instead of
  // silently leaving `/me` showing a stale last_error. Only the error *message*
  // is logged — never the job envelope beyond IDs (event payload PII contract).
  await db
    .update(syncState)
    .set({
      lastError: msg,
      lastErrorAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(syncState.userId, job.userId),
        eq(syncState.calendarId, job.calendarId),
      ),
    )
    .catch((cause: unknown) => {
      console.error("[syncConsumer] recordUnknownError persist failed", {
        userId: job.userId,
        calendarId: job.calendarId,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    });
}

// Logs only the job envelope shape — never Calendar event payloads.
function safeJob(job: SyncJob): Record<string, unknown> {
  return {
    type: job.type,
    userId: job.userId,
    calendarId: job.calendarId,
    reason: "reason" in job ? job.reason : undefined,
    categoryId: "categoryId" in job ? job.categoryId : undefined,
  };
}

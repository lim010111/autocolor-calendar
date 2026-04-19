import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db";
import { syncState } from "../db/schema";
import type { Bindings } from "../env";
import { computeBackoffSeconds } from "../lib/backoff";
import { claimSyncRun, releaseSyncRun } from "../lib/syncClaim";
import {
  runFullResync,
  runIncrementalSync,
  type RunResult,
} from "../services/calendarSync";
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

    let result: RunResult;
    try {
      result =
        job.type === "incremental"
          ? await runIncrementalSync({
              db,
              env,
              userId: job.userId,
              calendarId: job.calendarId,
            })
          : await runFullResync(
              {
                db,
                env,
                userId: job.userId,
                calendarId: job.calendarId,
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

  // Persist last_error for UI.
  const errMessage = result.error.message;
  await db
    .update(syncState)
    .set({
      lastError: errMessage,
      lastErrorAt: sql`now()`,
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
  };
}

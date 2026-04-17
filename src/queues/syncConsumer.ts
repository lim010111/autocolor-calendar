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
    const claim = await claimSyncRun(db, job.userId, job.calendarId);
    if (!claim.acquired) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "sync coalesced (claim not acquired)",
          job: safeJob(job),
        }),
      );
      msg.ack();
      return;
    }

    try {
      const result =
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
              job.pageToken ? { pageToken: job.pageToken } : undefined,
            );

      await applyResult(db, env, msg, job, result);
    } finally {
      await releaseSyncRun(db, job.userId, job.calendarId).catch(() => undefined);
    }
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
      // Chunked full_resync: enqueue next page as a fresh job (attempt counter resets).
      await enqueueSync(env, {
        type: "full_resync",
        userId: job.userId,
        calendarId: job.calendarId,
        reason: job.type === "full_resync" ? job.reason : "manual",
        enqueuedAt: Date.now(),
        pageToken: result.continuation.pageToken,
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
    .catch(() => undefined);
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

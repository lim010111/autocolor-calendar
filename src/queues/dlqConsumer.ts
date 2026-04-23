import { and, eq } from "drizzle-orm";

import { getDb } from "../db";
import { syncFailures, syncState } from "../db/schema";
import type { Bindings } from "../env";
import type { SyncJob } from "./types";

// DLQ messages arrive with the dead-lettered SyncJob body and the accumulated
// attempt count. We persist an audit row and log — no retry, no requeue.
// NOTE: never write Calendar event payloads here (PII). Only the job envelope
// and the failure metadata.
export async function handleDlqBatch(
  batch: MessageBatch<SyncJob>,
  env: Bindings,
  execCtx: ExecutionContext,
): Promise<void> {
  const { db, close } = getDb(env);
  try {
    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        // §6 Wave A — snapshot the most recent failure SyncSummary. The
        // sync consumer stamps this on every retryable failure via
        // `applyResult` and clears it on success, so at DLQ time it reflects
        // the last failed run's counters. Null if the job never reached
        // applyResult (e.g. envelope-level reject). Lookup is scoped to the
        // DLQ'd job's (user, calendar) — rollback jobs also carry these
        // fields but have no sync_state row of their own, so the SELECT
        // legitimately returns no rows and `snapshot` stays null.
        let snapshot: unknown = null;
        try {
          const rows = await db
            .select({ s: syncState.lastFailureSummary })
            .from(syncState)
            .where(
              and(
                eq(syncState.userId, job.userId),
                eq(syncState.calendarId, job.calendarId),
              ),
            )
            .limit(1);
          snapshot = rows[0]?.s ?? null;
        } catch {
          snapshot = null;
        }
        await db.insert(syncFailures).values({
          userId: job.userId,
          calendarId: job.calendarId,
          job: job as unknown as Record<string, unknown>,
          errorCode: null,
          errorBody: null,
          attempt: msg.attempts,
          summarySnapshot: snapshot as Record<string, unknown> | null,
        });
        console.error(
          JSON.stringify({
            level: "error",
            msg: "sync dlq",
            job: { type: job.type, userId: job.userId, calendarId: job.calendarId },
            attempts: msg.attempts,
          }),
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "sync dlq write failed",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      msg.ack();
    }
  } finally {
    execCtx.waitUntil(close());
  }
}

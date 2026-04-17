import { getDb } from "../db";
import { syncFailures } from "../db/schema";
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
        await db.insert(syncFailures).values({
          userId: job.userId,
          calendarId: job.calendarId,
          job: job as unknown as Record<string, unknown>,
          errorCode: null,
          errorBody: null,
          attempt: msg.attempts,
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

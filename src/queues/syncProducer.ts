import type { Bindings } from "../env";
import type { SyncJob } from "./types";

export class SyncQueueUnavailableError extends Error {
  constructor() {
    super("SYNC_QUEUE binding is missing");
    this.name = "SyncQueueUnavailableError";
  }
}

export async function enqueueSync(env: Bindings, job: SyncJob): Promise<void> {
  if (!env.SYNC_QUEUE) throw new SyncQueueUnavailableError();
  await env.SYNC_QUEUE.send(job);
}

import { describe, expect, it, vi } from "vitest";

import type { SyncJob } from "../queues/types";

// §6 Wave A guardrails for the DLQ writer:
//   1. `summary_snapshot` copied from `sync_state.last_failure_summary`.
//   2. No sync_state row → snapshot column stays null (never undefined).
//   3. SELECT itself failing → snapshot null, insert still proceeds.
//   4. insert failing → console.error + msg.ack still called (no retry).

const mocks = vi.hoisted(() => ({
  // Set to an object to simulate a present row, null to simulate absence,
  // or throw by setting selectThrows.
  lastFailureSummary: null as Record<string, unknown> | null,
  selectThrows: null as Error | null,
  insertThrows: null as Error | null,
  insertedRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db", () => ({
  getDb: () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              if (mocks.selectThrows) throw mocks.selectThrows;
              return mocks.lastFailureSummary === null
                ? []
                : [{ s: mocks.lastFailureSummary }];
            },
          }),
        }),
      }),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          if (mocks.insertThrows) throw mocks.insertThrows;
          mocks.insertedRows.push(row);
          return undefined;
        },
      }),
    };
    return { db: db as never, close: async () => undefined };
  },
}));

const { handleDlqBatch } = await import("../queues/dlqConsumer");

function makeMessage(body: SyncJob, attempts = 5): Message<SyncJob> {
  return {
    id: "mid",
    timestamp: new Date(),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  } as unknown as Message<SyncJob>;
}

function makeBatch(msg: Message<SyncJob>): MessageBatch<SyncJob> {
  return {
    queue: "sync-dlq",
    messages: [msg],
    retryAll: () => undefined,
    ackAll: () => undefined,
  } as unknown as MessageBatch<SyncJob>;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
}

function incrementalJob(): SyncJob {
  return {
    type: "incremental",
    userId: "u1",
    calendarId: "primary",
    reason: "manual",
    enqueuedAt: Date.now(),
  };
}

describe("handleDlqBatch — §6 Wave A summary_snapshot", () => {
  it("copies last_failure_summary into summary_snapshot when present", async () => {
    mocks.lastFailureSummary = { pages: 1, seen: 3, updated: 1 };
    mocks.selectThrows = null;
    mocks.insertThrows = null;
    mocks.insertedRows = [];
    const msg = makeMessage(incrementalJob());
    await handleDlqBatch(makeBatch(msg), {} as never, makeCtx());
    expect(mocks.insertedRows).toHaveLength(1);
    const row = mocks.insertedRows[0]!;
    expect(row.summarySnapshot).toEqual({ pages: 1, seen: 3, updated: 1 });
    expect(row.userId).toBe("u1");
    expect(row.calendarId).toBe("primary");
    expect(row.attempt).toBe(5);
    expect(msg.ack).toHaveBeenCalled();
  });

  it("writes null summary_snapshot when sync_state row is absent", async () => {
    // Rollback jobs or orphaned DLQ messages land here — they have no
    // sync_state row of their own. Snapshot column must be null, not
    // undefined (drizzle would translate undefined to "don't set").
    mocks.lastFailureSummary = null;
    mocks.selectThrows = null;
    mocks.insertThrows = null;
    mocks.insertedRows = [];
    const msg = makeMessage(incrementalJob());
    await handleDlqBatch(makeBatch(msg), {} as never, makeCtx());
    expect(mocks.insertedRows).toHaveLength(1);
    expect(mocks.insertedRows[0]!.summarySnapshot).toBeNull();
    expect(msg.ack).toHaveBeenCalled();
  });

  it("SELECT failure falls through — snapshot null, insert still proceeds", async () => {
    // If Hyperdrive blinks mid-batch, the DLQ audit row should still land
    // with the job envelope. Better to lose the snapshot than to lose the
    // entire failure record.
    mocks.lastFailureSummary = { pages: 99 };
    mocks.selectThrows = new Error("hyperdrive down");
    mocks.insertThrows = null;
    mocks.insertedRows = [];
    const msg = makeMessage(incrementalJob());
    await handleDlqBatch(makeBatch(msg), {} as never, makeCtx());
    expect(mocks.insertedRows).toHaveLength(1);
    expect(mocks.insertedRows[0]!.summarySnapshot).toBeNull();
    expect(msg.ack).toHaveBeenCalled();
    mocks.selectThrows = null;
  });

  it("INSERT failure logs via console.error and still ack (no retry)", async () => {
    mocks.lastFailureSummary = { pages: 1 };
    mocks.selectThrows = null;
    mocks.insertThrows = new Error("unique violation");
    mocks.insertedRows = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = makeMessage(incrementalJob());
    await handleDlqBatch(makeBatch(msg), {} as never, makeCtx());
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("sync dlq write failed");
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
    errSpy.mockRestore();
    mocks.insertThrows = null;
  });
});

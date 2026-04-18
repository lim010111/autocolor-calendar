import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncJob } from "../queues/types";

// Shared mock state hoisted above the vi.mock factories — vitest hoists vi.mock
// calls to the top of the file, so any identifier referenced inside a factory
// must be hoisted too.
const mocks = vi.hoisted(() => ({
  callLog: [] as string[],
  bootstrapReturning: [] as Array<{ id: string }>,
  claimResult: { acquired: true, rowId: "rid", claimedAt: new Date() } as
    | { acquired: true; rowId: string; claimedAt: Date }
    | { acquired: false },
  fullResyncResult: null as unknown,
  incrementalResult: null as unknown,
}));

vi.mock("../db", () => ({
  getDb: () => {
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => mocks.bootstrapReturning,
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    };
    return { db: db as never, close: async () => undefined };
  },
}));

vi.mock("../lib/syncClaim", () => ({
  claimSyncRun: vi.fn(async () => {
    mocks.callLog.push("claim");
    return mocks.claimResult;
  }),
  releaseSyncRun: vi.fn(async () => {
    mocks.callLog.push("release");
  }),
}));

vi.mock("../queues/syncProducer", () => ({
  enqueueSync: vi.fn(async () => {
    mocks.callLog.push("enqueue");
  }),
  SyncQueueUnavailableError: class extends Error {
    constructor() {
      super("SYNC_QUEUE binding missing");
      this.name = "SyncQueueUnavailableError";
    }
  },
}));

vi.mock("../services/calendarSync", () => ({
  runFullResync: vi.fn(async () => {
    mocks.callLog.push("runFullResync");
    return mocks.fullResyncResult;
  }),
  runIncrementalSync: vi.fn(async () => {
    mocks.callLog.push("runIncrementalSync");
    return mocks.incrementalResult;
  }),
}));

vi.mock("../services/oauthTokenService", () => ({
  markReauthRequired: vi.fn(async () => undefined),
}));

// Import after mocks are registered.
const { handleSyncBatch } = await import("../queues/syncConsumer");

function makeMessage(body: SyncJob): Message<SyncJob> {
  return {
    id: "mid",
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  } as unknown as Message<SyncJob>;
}

function makeBatch(msg: Message<SyncJob>): MessageBatch<SyncJob> {
  return {
    queue: "autocolor-sync-dev",
    messages: [msg],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<SyncJob>;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function makeSummary() {
  return {
    pages: 5,
    seen: 100,
    evaluated: 100,
    updated: 0,
    skipped_manual: 0,
    skipped_equal: 0,
    cancelled: 0,
    no_match: 100,
    stored_next_sync_token: false,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  };
}

describe("syncConsumer.handleSyncBatch", () => {
  beforeEach(() => {
    mocks.callLog.length = 0;
    mocks.bootstrapReturning = [];
    mocks.claimResult = {
      acquired: true,
      rowId: "rid",
      claimedAt: new Date(),
    };
    mocks.fullResyncResult = {
      ok: true,
      summary: makeSummary(),
      continuation: {
        pageToken: "pt-next",
        timeMin: "2024-01-01T00:00:00.000Z",
        timeMax: "2030-01-01T00:00:00.000Z",
      },
    };
    mocks.incrementalResult = {
      ok: true,
      summary: makeSummary(),
    };
  });

  it("release runs BEFORE continuation enqueue (race-fix regression guard)", async () => {
    // A full_resync that returned a continuation — this is the exact scenario
    // where, if release happened after enqueue, a parallel consumer could
    // claim the continuation on a still-fresh in_progress_at and coalesce-ack
    // the message, silently dropping it.
    const job: SyncJob = {
      type: "full_resync",
      userId: "u1",
      calendarId: "primary",
      reason: "bootstrap",
      enqueuedAt: Date.now(),
    };
    const msg = makeMessage(job);
    await handleSyncBatch(makeBatch(msg), {} as never, makeCtx());

    const releaseIdx = mocks.callLog.indexOf("release");
    const enqueueIdx = mocks.callLog.indexOf("enqueue");
    expect(releaseIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeLessThan(enqueueIdx);
    expect(msg.ack).toHaveBeenCalled();
  });

  it("bootstraps sync_state and logs warn when row was missing", async () => {
    // DLQ replay / orphaned queue / missing /sync/run upsert → returning()
    // reports that a row was actually inserted.
    mocks.bootstrapReturning = [{ id: "new-row" }];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const job: SyncJob = {
      type: "incremental",
      userId: "u1",
      calendarId: "primary",
      reason: "manual",
      enqueuedAt: Date.now(),
    };
    const msg = makeMessage(job);
    await handleSyncBatch(makeBatch(msg), {} as never, makeCtx());

    const warnPayload = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnPayload).toContain("sync_state row bootstrapped by consumer");
    expect(msg.ack).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not log bootstrap warn when row already exists", async () => {
    mocks.bootstrapReturning = []; // returning empty → no insert happened
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const job: SyncJob = {
      type: "incremental",
      userId: "u1",
      calendarId: "primary",
      reason: "manual",
      enqueuedAt: Date.now(),
    };
    await handleSyncBatch(makeBatch(makeMessage(job)), {} as never, makeCtx());

    const warnPayload = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnPayload).not.toContain("bootstrapped by consumer");
    warnSpy.mockRestore();
  });

  it("releases ownership-aware: passes the claimedAt timestamp captured at claim time", async () => {
    // NOTE: this test only asserts the consumer-side plumbing (Date reference
    // forwarded from claim to release). It does NOT exercise the Postgres →
    // postgres.js → JS Date round-trip, which is where a µs/ms precision
    // mismatch would break the `eq(inProgressAt, claimedAt)` match in
    // releaseSyncRun. That hazard is handled in `claimSyncRun` itself by
    // using `date_trunc('milliseconds', now())` when setting the timestamp —
    // see the CRITICAL comment in `src/lib/syncClaim.ts`.
    const claimTime = new Date("2026-04-17T10:00:00.000Z");
    mocks.claimResult = {
      acquired: true,
      rowId: "rid",
      claimedAt: claimTime,
    };
    const { releaseSyncRun } = await import("../lib/syncClaim");

    const job: SyncJob = {
      type: "incremental",
      userId: "u1",
      calendarId: "primary",
      reason: "manual",
      enqueuedAt: Date.now(),
    };
    await handleSyncBatch(makeBatch(makeMessage(job)), {} as never, makeCtx());

    const calls = (releaseSyncRun as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[3]).toBe(claimTime);
  });
});

describe("syncClaim — precision invariant", () => {
  // Source-level guard: the `inProgressAt` SET clause in claimSyncRun must
  // truncate `now()` to milliseconds. Any future refactor that reverts to a
  // plain `sql\`now()\`` re-introduces the precision drift that silently
  // breaks releaseSyncRun's ownership check. This test reads the source file
  // directly because emulating postgres.js timestamptz precision inside a
  // unit-level DB double would require a full Postgres simulator.
  it("claimSyncRun stores in_progress_at at ms precision", async () => {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, "../lib/syncClaim.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /inProgressAt:\s*sql`date_trunc\('milliseconds',\s*now\(\)\)`/,
    );
  });
});

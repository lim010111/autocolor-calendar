import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HonoEnv } from "../env";

// Mocks must be registered before the import tree of `../routes/sync` resolves.

vi.mock("../middleware/auth", () => ({
  authMiddleware: async (
    c: {
      req: { header: (k: string) => string | undefined };
      set: (key: string, value: unknown) => void;
      json: (body: unknown, status: number) => unknown;
    },
    next: () => Promise<void>,
  ) => {
    if (!c.req.header("authorization")) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("userId", "u-test");
    c.set("email", "test@example.com");
    await next();
  },
}));

// DB mock. We drive it per-test by pushing row batches onto `selectBatches`.
// Each `select().from(...).where(...).limit(...)` call shifts the next batch.
// The `insert`/`update` calls are spies; success returns undefined.

const selectBatches: unknown[][] = [];
const insertMock = vi.fn().mockReturnValue({
  values: () => ({ onConflictDoNothing: () => Promise.resolve(undefined) }),
});
const updateMock = vi.fn();

function resetDbMocks(): void {
  selectBatches.length = 0;
  insertMock.mockClear();
  updateMock.mockReset();
  updateMock.mockReturnValue({
    set: () => ({ where: () => Promise.resolve(undefined) }),
  });
}

vi.mock("../db", () => ({
  getDb: () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectBatches.shift() ?? []),
          }),
        }),
      }),
      insert: (...args: unknown[]) => insertMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    close: async () => undefined,
  }),
}));

const enqueueMock = vi.fn();
vi.mock("../queues/syncProducer", () => ({
  enqueueSync: (...args: unknown[]) => enqueueMock(...args),
  SyncQueueUnavailableError: class SyncQueueUnavailableError extends Error {},
}));

import { syncRoutes } from "../routes/sync";

const app = new Hono<HonoEnv>();
app.route("/sync", syncRoutes);

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const BASE_ENV = {
  ENV: "dev",
  GOOGLE_OAUTH_REDIRECT_URI: "x",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
  GAS_REDIRECT_URL: "x",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
} as const;

async function postRun(
  env: Record<string, unknown> = BASE_ENV,
  headers: Record<string, string> = { authorization: "Bearer x" },
): Promise<Response> {
  return app.fetch(
    new Request("https://worker.test/sync/run", { method: "POST", headers }),
    env as never,
    ctx,
  );
}

async function invoke(
  path: string,
  init?: RequestInit,
  env: Record<string, unknown> = BASE_ENV,
): Promise<Response> {
  return app.fetch(
    new Request(`https://worker.test${path}`, init),
    env as never,
    ctx,
  );
}

describe("sync routes — auth gate", () => {
  beforeEach(() => resetDbMocks());
  afterEach(() => {
    enqueueMock.mockReset();
  });

  it("POST /sync/run without bearer returns 401", async () => {
    const res = await invoke("/sync/run", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /sync/bootstrap without bearer returns 401", async () => {
    const res = await invoke("/sync/bootstrap", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

// §6.4 — manual-trigger rate limit is tied to `last_manual_trigger_at`, not
// `updated_at`. These tests pin the intended behavior: the consumer's own
// post-run writes no longer lock out a re-trigger, but a just-issued manual
// trigger still coalesces to 429 for the 30s window.

describe("POST /sync/run — §6.4 last_manual_trigger_at rate limit", () => {
  beforeEach(() => {
    resetDbMocks();
    enqueueMock.mockReset().mockResolvedValue(undefined);
  });

  it("allows a re-trigger right after the consumer touched updated_at (stale last_manual_trigger_at)", async () => {
    // oauth_tokens row
    selectBatches.push([{ needsReauth: false }]);
    // sync_state row: consumer just wrote (updated_at fresh), but manual
    // trigger is old → rate limit should NOT engage.
    selectBatches.push([
      {
        nextSyncToken: "tok-123",
        inProgressAt: null,
        lastManualTriggerAt: new Date(Date.now() - 10 * 60_000),
        updatedAt: new Date(), // fresh — would 429 under old behavior
        active: true,
      },
    ]);

    const res = await postRun();
    expect(res.status).toBe(202);
    const body = (await res.json()) as { enqueued?: boolean; jobType?: string };
    expect(body.enqueued).toBe(true);
    expect(body.jobType).toBe("incremental");
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    // One UPDATE fires on success to stamp last_manual_trigger_at.
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("429s when last_manual_trigger_at is inside the 30s window", async () => {
    selectBatches.push([{ needsReauth: false }]);
    selectBatches.push([
      {
        nextSyncToken: "tok-123",
        inProgressAt: null,
        lastManualTriggerAt: new Date(Date.now() - 5_000), // 5s ago
        updatedAt: new Date(Date.now() - 60 * 60_000), // stale
        active: true,
      },
    ]);

    const res = await postRun();
    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      error?: string;
      retry_after_sec?: number;
    };
    expect(body.error).toBe("rate_limited");
    expect(body.retry_after_sec).toBeGreaterThan(0);
    expect(body.retry_after_sec).toBeLessThanOrEqual(30);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("falls back to updated_at when last_manual_trigger_at is NULL (pre-migration row)", async () => {
    selectBatches.push([{ needsReauth: false }]);
    selectBatches.push([
      {
        nextSyncToken: "tok-123",
        inProgressAt: null,
        lastManualTriggerAt: null, // pre-migration
        updatedAt: new Date(Date.now() - 5_000), // fresh
        active: true,
      },
    ]);

    const res = await postRun();
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("rate_limited");
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("allows a first trigger when last_manual_trigger_at is NULL and updated_at is stale", async () => {
    selectBatches.push([{ needsReauth: false }]);
    selectBatches.push([
      {
        nextSyncToken: null, // first run → full_resync
        inProgressAt: null,
        lastManualTriggerAt: null,
        updatedAt: new Date(Date.now() - 60 * 60_000),
        active: true,
      },
    ]);

    const res = await postRun();
    expect(res.status).toBe(202);
    const body = (await res.json()) as { enqueued?: boolean; jobType?: string };
    expect(body.enqueued).toBe(true);
    expect(body.jobType).toBe("full_resync");
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("does not stamp last_manual_trigger_at when a fresh consumer claim coalesces", async () => {
    selectBatches.push([{ needsReauth: false }]);
    selectBatches.push([
      {
        nextSyncToken: "tok-123",
        inProgressAt: new Date(Date.now() - 5_000), // fresh claim
        lastManualTriggerAt: new Date(Date.now() - 60 * 60_000),
        updatedAt: new Date(Date.now() - 60 * 60_000),
        active: true,
      },
    ]);

    const res = await postRun();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { coalesced?: boolean };
    expect(body.coalesced).toBe(true);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not stamp last_manual_trigger_at when enqueue fails (SyncQueueUnavailableError)", async () => {
    const { SyncQueueUnavailableError } = await import("../queues/syncProducer");
    enqueueMock.mockRejectedValueOnce(new SyncQueueUnavailableError());
    selectBatches.push([{ needsReauth: false }]);
    selectBatches.push([
      {
        nextSyncToken: "tok-123",
        inProgressAt: null,
        lastManualTriggerAt: new Date(Date.now() - 60 * 60_000),
        updatedAt: new Date(Date.now() - 60 * 60_000),
        active: true,
      },
    ]);

    const res = await postRun();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("queue_unavailable");
    expect(updateMock).not.toHaveBeenCalled();
  });
});

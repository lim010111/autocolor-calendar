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

// Default to resolved Promise so /sync/run's `.catch().finally()` chain doesn't
// blow up in tests that don't explicitly arrange the mock — the helper is
// always invoked from the finally block on the success path.
const selfHealMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/watch/selfHeal", () => ({
  maybeSelfHealWatch: (...args: unknown[]) => selfHealMock(...args),
}));

// `/sync/heal-watch` is a thin result→HTTP adapter over `reconnectWatch`; the
// reconnect adapter's own gates are pinned in watchReconnect.test.ts. Here we
// mock the seam and assert the byte-shape of every status / body / header.
const reconnectMock = vi.fn();
vi.mock("../services/watch/reconnect", () => ({
  reconnectWatch: (...args: unknown[]) => reconnectMock(...args),
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

// /sync/run wires self-heal in the finally block — every successful trigger
// fires `maybeSelfHealWatch` opportunistically. Coalesce/rate-limit/reauth
// branches don't (the helper would no-op anyway, and skipping it spares the
// extra DB round-trip on early exits).
describe("POST /sync/run — self-heal hook", () => {
  beforeEach(() => {
    resetDbMocks();
    enqueueMock.mockReset().mockResolvedValue(undefined);
    selfHealMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("calls maybeSelfHealWatch on successful enqueue", async () => {
    selectBatches.push([{ needsReauth: false }]);
    selectBatches.push([
      {
        nextSyncToken: "tok-123",
        inProgressAt: null,
        lastManualTriggerAt: new Date(Date.now() - 10 * 60_000),
        updatedAt: new Date(Date.now() - 10 * 60_000),
        active: true,
      },
    ]);

    const res = await postRun();
    expect(res.status).toBe(202);
    expect(selfHealMock).toHaveBeenCalledTimes(1);
    expect(selfHealMock.mock.calls[0]?.[2]).toBe("u-test");
  });

  it("does NOT call maybeSelfHealWatch on reauth_required short-circuit", async () => {
    // /sync/run returns early with 503 when needsReauth=true. self-heal is
    // pointless there — the helper would also bail at its own needs_reauth
    // gate, but skipping the call entirely spares a DB round-trip.
    selectBatches.push([{ needsReauth: true }]);

    const res = await postRun();
    expect(res.status).toBe(503);
    expect(selfHealMock).not.toHaveBeenCalled();
  });
});

describe("POST /sync/heal-watch — result → HTTP mapping", () => {
  const ENV_WITH_WEBHOOK = {
    ...BASE_ENV,
    WEBHOOK_BASE_URL: "https://example.test",
  } as const;

  beforeEach(() => {
    resetDbMocks();
    enqueueMock.mockReset();
    reconnectMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  async function postHealWatch(
    env: Record<string, unknown> = ENV_WITH_WEBHOOK,
  ): Promise<Response> {
    return invoke(
      "/sync/heal-watch",
      { method: "POST", headers: { authorization: "Bearer x" } },
      env,
    );
  }

  it("ok → 200 { ok, expiresAt: ISO }", async () => {
    reconnectMock.mockResolvedValue({
      ok: true,
      expiration: new Date("2026-06-01T00:00:00.000Z"),
    });
    const res = await postHealWatch();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; expiresAt?: string };
    expect(body.ok).toBe(true);
    expect(body.expiresAt).toBe("2026-06-01T00:00:00.000Z");
    // Route hands (db, env, userId) to the reconnect adapter.
    expect(reconnectMock.mock.calls[0]?.[2]).toBe("u-test");
  });

  it("webhook_unconfigured → 503", async () => {
    reconnectMock.mockResolvedValue({ error: "webhook_unconfigured" });
    const res = await postHealWatch(BASE_ENV);
    expect(res.status).toBe(503);
    expect((await res.json()) as unknown).toEqual({ error: "webhook_unconfigured" });
  });

  it("reauth_required → 503", async () => {
    reconnectMock.mockResolvedValue({ error: "reauth_required" });
    const res = await postHealWatch();
    expect(res.status).toBe(503);
    expect((await res.json()) as unknown).toEqual({ error: "reauth_required" });
  });

  it("not_bootstrapped → 409", async () => {
    reconnectMock.mockResolvedValue({ error: "not_bootstrapped" });
    const res = await postHealWatch();
    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toEqual({ error: "not_bootstrapped" });
  });

  it("calendar_inactive → 409", async () => {
    reconnectMock.mockResolvedValue({ error: "calendar_inactive" });
    const res = await postHealWatch();
    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toEqual({ error: "calendar_inactive" });
  });

  it("api_error(auth) → 503 reauth_required", async () => {
    reconnectMock.mockResolvedValue({ error: "api_error", kind: "auth" });
    const res = await postHealWatch();
    expect(res.status).toBe(503);
    expect((await res.json()) as unknown).toEqual({ error: "reauth_required" });
  });

  it("api_error(forbidden) → 403 forbidden", async () => {
    reconnectMock.mockResolvedValue({ error: "api_error", kind: "forbidden" });
    const res = await postHealWatch();
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({ error: "forbidden" });
  });

  it("api_error(not_found) → 404 calendar_not_found", async () => {
    reconnectMock.mockResolvedValue({ error: "api_error", kind: "not_found" });
    const res = await postHealWatch();
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({ error: "calendar_not_found" });
  });

  it("api_error(rate_limited) → 429 with retry_after_sec + Retry-After header", async () => {
    reconnectMock.mockResolvedValue({ error: "api_error", kind: "rate_limited" });
    const res = await postHealWatch();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect((await res.json()) as unknown).toEqual({
      error: "rate_limited",
      retry_after_sec: 1,
    });
  });

  it.each(["server", "unknown", "full_sync_required"] as const)(
    "api_error(%s) → 502 upstream_unavailable",
    async (kind) => {
      reconnectMock.mockResolvedValue({ error: "api_error", kind });
      const res = await postHealWatch();
      expect(res.status).toBe(502);
      expect((await res.json()) as unknown).toEqual({ error: "upstream_unavailable" });
    },
  );
});

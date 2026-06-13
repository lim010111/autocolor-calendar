import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HonoEnv } from "../env";

// Mocks must be registered before the import tree of `../routes/sync` resolves.
// We bypass authMiddleware entirely — auth gating is covered in syncRoute.test.ts.

vi.mock("../middleware/auth", () => ({
  authMiddleware: async (
    c: {
      set: (key: string, value: unknown) => void;
    },
    next: () => Promise<void>,
  ) => {
    c.set("userId", "u-test");
    c.set("email", "test@example.com");
    await next();
  },
}));

// Simulate oauth_tokens row and absence of any existing watch channel columns.
// The bootstrap path reads needsReauth only — we return a single row.
const dbSelectRows: unknown[] = [{ needsReauth: false }];
const insertMock = vi.fn().mockReturnValue({
  values: () => ({ onConflictDoNothing: () => Promise.resolve(undefined) }),
});
vi.mock("../db", () => ({
  getDb: () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(dbSelectRows),
          }),
        }),
      }),
      insert: (...args: unknown[]) => insertMock(...args),
    },
    close: async () => undefined,
  }),
}));

const enqueueMock = vi.fn();
vi.mock("../queues/syncProducer", () => ({
  enqueueSync: (...args: unknown[]) => enqueueMock(...args),
  SyncQueueUnavailableError: class SyncQueueUnavailableError extends Error {},
}));

// `bootstrapUserSync` now composes the shared watch core — the adapter test
// mocks the single `reRegisterWatch` seam instead of register+stop. The
// guard / reauth / stop→register / classify cases are owned once by
// `watchCore.test.ts`.
const reRegisterMock = vi.fn();
vi.mock("../services/watch/core", () => ({
  reRegisterWatch: (...args: unknown[]) => reRegisterMock(...args),
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

async function postBootstrap(env: Record<string, unknown>): Promise<Response> {
  return app.fetch(
    new Request("https://worker.test/sync/bootstrap", {
      method: "POST",
      headers: { authorization: "Bearer x" },
    }),
    env as never,
    ctx,
  );
}

describe("POST /sync/bootstrap — watch channel lifecycle", () => {
  beforeEach(() => {
    enqueueMock.mockReset().mockResolvedValue(undefined);
    reRegisterMock.mockReset().mockResolvedValue({
      ok: true,
      expiration: new Date(Date.now() + 7 * 86400 * 1000),
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers the watch channel via the core and reports watchRegistered:true", async () => {
    const res = await postBootstrap({
      ...BASE_ENV,
      WEBHOOK_BASE_URL: "https://example.test",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { watchRegistered?: boolean };
    expect(body.watchRegistered).toBe(true);
    expect(reRegisterMock).toHaveBeenCalledTimes(1);
    // Adapter delegates (db, env, userId, calendarId) to the core.
    expect(reRegisterMock.mock.calls[0]?.[2]).toBe("u-test");
    expect(reRegisterMock.mock.calls[0]?.[3]).toBe("primary");
  });

  it("short-circuits to 503 reauth_required when the core returns failed: reauth_required", async () => {
    reRegisterMock.mockResolvedValue({ failed: "reauth_required" });
    const res = await postBootstrap({
      ...BASE_ENV,
      WEBHOOK_BASE_URL: "https://example.test",
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("reauth_required");
  });

  it("reports watchRegistered:false when the core skips (WEBHOOK_BASE_URL unset)", async () => {
    reRegisterMock.mockResolvedValue({ skipped: "webhook_unconfigured" });
    const res = await postBootstrap(BASE_ENV);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { watchRegistered?: boolean };
    expect(body.watchRegistered).toBe(false);
  });

  it("swallows a non-reauth api_error and keeps bootstrap at 202", async () => {
    // The full_resync queue job was already enqueued, so a transient watch
    // failure must not fail the bootstrap — the user can still sync.
    reRegisterMock.mockResolvedValue({ failed: "api_error", kind: "rate_limited" });
    const res = await postBootstrap({
      ...BASE_ENV,
      WEBHOOK_BASE_URL: "https://example.test",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { watchRegistered?: boolean };
    expect(body.watchRegistered).toBe(false);
  });

  it("swallows an unexpected thrown failure and keeps bootstrap at 202", async () => {
    reRegisterMock.mockRejectedValue(new Error("hyperdrive socket reset"));
    const res = await postBootstrap({
      ...BASE_ENV,
      WEBHOOK_BASE_URL: "https://example.test",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { watchRegistered?: boolean };
    expect(body.watchRegistered).toBe(false);
  });
});

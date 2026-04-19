import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HonoEnv } from "../env";
import type * as TokenRefreshModule from "../services/tokenRefresh";

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

const getTokenMock = vi.fn();
vi.mock("../services/tokenRefresh", async () => {
  const actual =
    await vi.importActual<typeof TokenRefreshModule>("../services/tokenRefresh");
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getTokenMock(...args),
  };
});

const stopMock = vi.fn();
const registerMock = vi.fn();
vi.mock("../services/watchChannel", () => ({
  stopWatchChannel: (...args: unknown[]) => stopMock(...args),
  registerWatchChannel: (...args: unknown[]) => registerMock(...args),
}));

import { ReauthRequiredError } from "../services/tokenRefresh";
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
    getTokenMock.mockReset().mockResolvedValue({
      accessToken: "at-1",
      expiresAt: Date.now() + 3600_000,
    });
    stopMock.mockReset().mockResolvedValue(undefined);
    registerMock.mockReset().mockResolvedValue({
      channelId: "c-new",
      resourceId: "r-new",
      token: "tok-new",
      expiration: new Date(Date.now() + 7 * 86400 * 1000),
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stops any existing channel before registering a fresh one (ordering)", async () => {
    const callOrder: string[] = [];
    stopMock.mockImplementation(async () => {
      callOrder.push("stop");
    });
    registerMock.mockImplementation(async () => {
      callOrder.push("register");
      return {
        channelId: "c",
        resourceId: "r",
        token: "t",
        expiration: new Date(),
      };
    });
    const res = await postBootstrap({
      ...BASE_ENV,
      WEBHOOK_BASE_URL: "https://example.test",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { watchRegistered?: boolean };
    expect(body.watchRegistered).toBe(true);
    expect(callOrder).toEqual(["stop", "register"]);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it("short-circuits to 503 reauth_required when registration hits ReauthRequiredError", async () => {
    registerMock.mockRejectedValue(new ReauthRequiredError("invalid_grant"));
    const res = await postBootstrap({
      ...BASE_ENV,
      WEBHOOK_BASE_URL: "https://example.test",
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("reauth_required");
  });

  it("skips watch registration entirely when WEBHOOK_BASE_URL is unset", async () => {
    const res = await postBootstrap(BASE_ENV);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { watchRegistered?: boolean };
    expect(body.watchRegistered).toBe(false);
    expect(stopMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("swallows non-reauth watch failures and keeps bootstrap at 202", async () => {
    // stopWatchChannel succeeds, registerWatchChannel fails with a transient
    // CalendarApiError shape — bootstrap should still succeed since the
    // full_resync queue job was already enqueued.
    registerMock.mockRejectedValue(
      Object.assign(new Error("rate_limited"), { kind: "rate_limited" }),
    );
    const res = await postBootstrap({
      ...BASE_ENV,
      WEBHOOK_BASE_URL: "https://example.test",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { watchRegistered?: boolean };
    expect(body.watchRegistered).toBe(false);
  });
});

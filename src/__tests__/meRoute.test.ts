import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HonoEnv } from "../env";

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

const selectBatches: unknown[][] = [];

function resetDbMocks(): void {
  selectBatches.length = 0;
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
    },
    close: async () => undefined,
  }),
}));

const selfHealMock = vi.fn();
vi.mock("../services/watch/selfHeal", () => ({
  maybeSelfHealWatch: (...args: unknown[]) => selfHealMock(...args),
}));

import { meRoutes } from "../routes/me";

const app = new Hono<HonoEnv>();
app.route("/me", meRoutes);

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

async function getMe(
  env: Record<string, unknown> = BASE_ENV,
  headers: Record<string, string> = { authorization: "Bearer x" },
): Promise<Response> {
  return app.fetch(
    new Request("https://worker.test/me", { headers }),
    env as never,
    ctx,
  );
}

describe("GET /me — push_active field", () => {
  beforeEach(() => {
    resetDbMocks();
    selfHealMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("returns push_active=true when channel id present and expiration in future", async () => {
    selectBatches.push([{ needsReauth: false, needsReauthReason: null }]);
    selectBatches.push([
      {
        calendarId: "primary",
        nextSyncToken: "tok",
        inProgressAt: null,
        lastError: null,
        lastRunSummary: null,
        active: true,
        watchChannelId: "ch-id",
        watchExpiration: new Date(Date.now() + 6 * 86400 * 1000),
      },
    ]);

    const res = await getMe();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { push_active?: boolean };
    expect(body.push_active).toBe(true);
  });

  it("returns push_active=false when watchChannelId is null (defensive even if expiration set)", async () => {
    selectBatches.push([{ needsReauth: false, needsReauthReason: null }]);
    selectBatches.push([
      {
        calendarId: "primary",
        nextSyncToken: null,
        inProgressAt: null,
        lastError: null,
        lastRunSummary: null,
        active: true,
        watchChannelId: null,
        // even with a future expiration, missing channel id → no push.
        watchExpiration: new Date(Date.now() + 1 * 86400 * 1000),
      },
    ]);

    const res = await getMe();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { push_active?: boolean };
    expect(body.push_active).toBe(false);
  });

  it("returns push_active=false when watchExpiration is in the past", async () => {
    selectBatches.push([{ needsReauth: false, needsReauthReason: null }]);
    selectBatches.push([
      {
        calendarId: "primary",
        nextSyncToken: "tok",
        inProgressAt: null,
        lastError: null,
        lastRunSummary: null,
        active: true,
        watchChannelId: "ch-id",
        watchExpiration: new Date(Date.now() - 1000),
      },
    ]);

    const res = await getMe();
    const body = (await res.json()) as { push_active?: boolean };
    expect(body.push_active).toBe(false);
  });

  it("returns push_active=false when sync_state row is missing entirely", async () => {
    selectBatches.push([{ needsReauth: false, needsReauthReason: null }]);
    selectBatches.push([]); // no sync_state row

    const res = await getMe();
    const body = (await res.json()) as { push_active?: boolean; last_sync?: unknown };
    expect(body.push_active).toBe(false);
    expect(body.last_sync).toBeNull();
  });
});

describe("GET /me — self-heal hook", () => {
  beforeEach(() => {
    resetDbMocks();
    selfHealMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("calls maybeSelfHealWatch on every authenticated /me", async () => {
    selectBatches.push([{ needsReauth: false, needsReauthReason: null }]);
    selectBatches.push([
      {
        calendarId: "primary",
        nextSyncToken: null,
        inProgressAt: null,
        lastError: null,
        lastRunSummary: null,
        active: true,
        watchChannelId: null,
        watchExpiration: null,
      },
    ]);

    const res = await getMe();
    expect(res.status).toBe(200);
    expect(selfHealMock).toHaveBeenCalledTimes(1);
    // 3rd arg is userId (db, env, userId).
    expect(selfHealMock.mock.calls[0]?.[2]).toBe("u-test");
  });

  it("/me returns 200 even when self-heal helper rejects (waitUntil-isolated)", async () => {
    selectBatches.push([{ needsReauth: false, needsReauthReason: null }]);
    selectBatches.push([
      {
        calendarId: "primary",
        nextSyncToken: null,
        inProgressAt: null,
        lastError: null,
        lastRunSummary: null,
        active: true,
        watchChannelId: null,
        watchExpiration: null,
      },
    ]);
    selfHealMock.mockRejectedValue(new Error("simulated self-heal failure"));

    const res = await getMe();
    expect(res.status).toBe(200);
  });
});

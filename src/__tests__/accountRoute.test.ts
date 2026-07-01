import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HonoEnv } from "../env";

// Mocks must be registered before the import tree of `../routes/account`
// resolves. Layout mirrors `syncRoute.test.ts` so reviewers can scan both.

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
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("userId", "u-test");
    c.set("email", "test@example.com");
    await next();
  },
}));

// DB mock. `select(...).from(...).where(...)` is awaitable directly (returns
// the next batch from `selectBatches`) and also exposes `.limit(...)` for
// callers that chain it.
const selectBatches: unknown[][] = [];
const deleteMock = vi.fn();

function resetDbMocks(): void {
  selectBatches.length = 0;
  deleteMock.mockReset();
  deleteMock.mockReturnValue({
    where: () => Promise.resolve(undefined),
  });
}

vi.mock("../db", () => {
  const buildSelectChain = () => {
    const popBatch = () => Promise.resolve(selectBatches.shift() ?? []);
    const where = () => ({
      limit: popBatch,
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => popBatch().then(resolve, reject),
    });
    return { from: () => ({ where }) };
  };
  return {
    getDb: () => ({
      db: {
        select: () => buildSelectChain(),
        delete: (...args: unknown[]) => deleteMock(...args),
      },
      close: async () => undefined,
    }),
  };
});

const revokeRefreshTokenMock = vi.fn();
vi.mock("../services/googleOAuth", () => ({
  revokeRefreshToken: (...args: unknown[]) => revokeRefreshTokenMock(...args),
}));

// The account-deletion channels.stop loop is absorbed by
// `teardownWatchesForUser`; the route is a thin caller. The loop's own
// best-effort discipline (per-row warn, no-token skip, never-throw) is pinned
// in watchTeardown.test.ts — here we mock the seam and assert the deletion
// order + that teardown sits at Step 2.
const teardownMock = vi.fn();
vi.mock("../services/watch/teardown", () => ({
  teardownWatchesForUser: (...args: unknown[]) => teardownMock(...args),
}));

const getGoogleRefreshTokenMock = vi.fn();
vi.mock("../services/oauthTokenService", () => ({
  getGoogleRefreshToken: (...args: unknown[]) =>
    getGoogleRefreshTokenMock(...args),
}));

const revokeSessionMock = vi.fn();
vi.mock("../services/sessionService", () => ({
  revokeSession: (...args: unknown[]) => revokeSessionMock(...args),
}));

import { accountRoutes } from "../routes/account";

const app = new Hono<HonoEnv>();
app.route("/api/account", accountRoutes);

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

async function postDelete(
  headers: Record<string, string> = { authorization: "Bearer t" },
): Promise<Response> {
  return app.fetch(
    new Request("https://worker.test/api/account/delete", {
      method: "POST",
      headers,
    }),
    BASE_ENV as never,
    ctx,
  );
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    resetDbMocks();
    revokeRefreshTokenMock
      .mockReset()
      .mockResolvedValue(undefined);
    teardownMock.mockReset().mockResolvedValue(undefined);
    getGoogleRefreshTokenMock.mockReset().mockResolvedValue({
      refreshToken: "rt",
      scope: "openid email https://www.googleapis.com/auth/calendar",
      needsReauth: false,
    });
    revokeSessionMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    // No outer side effects to clear.
  });

  it("401 when no Authorization header", async () => {
    const res = await app.fetch(
      new Request("https://worker.test/api/account/delete", {
        method: "POST",
      }),
      BASE_ENV as never,
      ctx,
    );
    expect(res.status).toBe(401);
    expect(revokeRefreshTokenMock).not.toHaveBeenCalled();
    expect(teardownMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(revokeSessionMock).not.toHaveBeenCalled();
  });

  it("happy path: revoke → teardownWatchesForUser → DELETE users → revokeSession, returns 200", async () => {
    const callOrder: string[] = [];
    revokeRefreshTokenMock.mockImplementationOnce(async () => {
      callOrder.push("revoke");
    });
    teardownMock.mockImplementationOnce(async () => {
      callOrder.push("teardown");
    });
    deleteMock.mockReturnValueOnce({
      where: () => {
        callOrder.push("delete-users");
        return Promise.resolve(undefined);
      },
    });
    revokeSessionMock.mockImplementationOnce(async () => {
      callOrder.push("revoke-session");
    });

    const res = await postDelete();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // §3 order: revoke → watch-teardown (Step 2) → users delete → session revoke.
    expect(callOrder).toEqual([
      "revoke",
      "teardown",
      "delete-users",
      "revoke-session",
    ]);
    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(revokeSessionMock).toHaveBeenCalledTimes(1);
  });

  it("Google revoke failure → still 200, teardown and delete still run", async () => {
    // Simulate revoke throwing despite the helper's contract (defense-in-depth).
    revokeRefreshTokenMock.mockRejectedValueOnce(new Error("network down"));

    const res = await postDelete();
    expect(res.status).toBe(200);
    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(revokeSessionMock).toHaveBeenCalledTimes(1);
  });

  it("no oauth_tokens row → skip Google revoke, teardown + delete still run, still 200", async () => {
    getGoogleRefreshTokenMock.mockResolvedValueOnce(null);

    const res = await postDelete();
    expect(res.status).toBe(200);
    expect(revokeRefreshTokenMock).not.toHaveBeenCalled();
    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(revokeSessionMock).toHaveBeenCalledTimes(1);
  });

  it("users delete failure surfaces 500", async () => {
    deleteMock.mockReturnValueOnce({
      where: () => Promise.reject(new Error("db down")),
    });

    const res = await postDelete();
    expect(res.status).toBe(500);
    expect(revokeSessionMock).not.toHaveBeenCalled();
  });

  it("schema cascade contract: 10 references-to-users.id with onDelete cascade in src/db/schema.ts", () => {
    // Pin the §3 row 179 cascade contract: every user-scoped table FK to
    // users.id must declare onDelete: "cascade". Adding a new such table
    // without the cascade — or removing one — must fail this assertion.
    // The narrowed regex (vs. plain `onDelete: "cascade"`) ensures cascading
    // FKs to OTHER parents (e.g. categories) cannot mask a missing user
    // cascade by inflating a loose count. ADR-0004 #02 added `rule_seeds`
    // (user_id → users cascade), bumping the count 9 → 10.
    const schemaPath = fileURLToPath(new URL("../db/schema.ts", import.meta.url));
    const src = readFileSync(schemaPath, "utf8");
    const matches = src.match(
      /\.references\(\(\) => users\.id, \{ onDelete: "cascade" \}\)/g,
    );
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(10);
  });
});

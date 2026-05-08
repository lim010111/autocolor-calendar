// Onboarding bug fix — OAuth 콜백이 신규 사용자에게 `bootstrapUserSync`를
// 트리거하는지 검증한다. 이 호출이 빠지면 사용자가 dashboard에 도착했을 때
// `sync_state` row가 없어서 /me가 push_active=false를 보고하고 "Reconnect now"
// 가 409 not_bootstrapped로 실패한다 — 사용자가 보고한 회귀의 정확한 원인.
//
// `bootstrap.test.ts`가 이미 helper 내부 동작을 커버하므로 여기서는 호출 자체만
// 단언한다. 추가로 fail-soft 회귀 가드(bootstrap이 throw해도 OAuth 자체는
// 성공)를 검증한다.

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HonoEnv } from "../env";

vi.mock("../db", () => ({
  getDb: () => ({
    db: {} as unknown,
    close: async () => undefined,
  }),
}));

vi.mock("../lib/state", () => ({
  signState: vi.fn().mockResolvedValue("mock-state"),
  verifyState: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/googleOAuth", () => ({
  exchangeCode: vi.fn().mockResolvedValue({
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    scope: "openid email",
    token_type: "Bearer",
  }),
  fetchUserInfo: vi.fn().mockResolvedValue({
    sub: "google-sub-123",
    email: "newuser@example.com",
  }),
}));

vi.mock("../services/userService", () => ({
  upsertUserByGoogleSub: vi.fn().mockResolvedValue({
    id: "u-new",
    email: "newuser@example.com",
  }),
}));

vi.mock("../services/oauthTokenService", () => ({
  saveGoogleRefreshToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/sessionService", () => ({
  issueSession: vi.fn().mockResolvedValue({ token: "session-token-xyz" }),
}));

const bootstrapMock = vi.fn();
vi.mock("../services/syncBootstrap", () => ({
  bootstrapUserSync: (...args: unknown[]) => bootstrapMock(...args),
}));

import { errorHandler } from "../middleware/errorHandler";
import { oauthRoutes } from "../routes/oauth";

const app = new Hono<HonoEnv>();
app.route("/oauth", oauthRoutes);
app.onError(errorHandler);

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const BASE_ENV = {
  ENV: "dev",
  GOOGLE_OAUTH_REDIRECT_URI: "https://worker.test/oauth/google/callback",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csec",
  GAS_REDIRECT_URL: "https://gas.test/exec",
  TOKEN_ENCRYPTION_KEY: "tek",
  SESSION_HMAC_KEY: "shk",
  SESSION_PEPPER: "spp",
} as const;

async function getCallback(query: string): Promise<Response> {
  return app.fetch(
    new Request(`https://worker.test/oauth/google/callback?${query}`),
    BASE_ENV as never,
    ctx,
  );
}

describe("/oauth/google/callback — onboarding bootstrap", () => {
  beforeEach(() => {
    bootstrapMock.mockReset();
    bootstrapMock.mockResolvedValue({ ok: true, watchRegistered: true });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls bootstrapUserSync with the upserted user.id on happy path", async () => {
    const res = await getCallback("code=abc&state=mock-state");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("https://gas.test/exec");
    expect(res.headers.get("location")).toContain("token=session-token-xyz");
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    // bootstrapUserSync(db, env, userId) — userId is the third arg.
    expect(bootstrapMock.mock.calls[0]?.[2]).toBe("u-new");
  });

  it("redirect succeeds even when bootstrap throws (fail-soft regression guard)", async () => {
    bootstrapMock.mockRejectedValueOnce(new Error("upstream queue down"));
    const res = await getCallback("code=abc&state=mock-state");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("token=session-token-xyz");
    // session token must still be issued — OAuth itself succeeded.
    expect(res.headers.get("location")).not.toContain("error=");
  });

  it("redirect succeeds when bootstrap returns reauth_required (non-fatal)", async () => {
    bootstrapMock.mockResolvedValueOnce({
      ok: false,
      error: "reauth_required",
    });
    const res = await getCallback("code=abc&state=mock-state");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("token=session-token-xyz");
  });
});

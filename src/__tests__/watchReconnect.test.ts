import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `reconnectWatch` is the user-explicit "지금 연결" entry point extracted from
// the `/sync/heal-watch` route body. It owns the webhook guard, the
// needs_reauth column precheck, and the sync_state active gate, then composes
// the shared core. This adapter test mocks the single `reRegisterWatch` seam
// and drives the gates; the route's result→HTTP mapping is pinned separately
// in syncRoute.test.ts.

const reRegisterMock = vi.fn();
vi.mock("../services/watch/core", () => ({
  reRegisterWatch: (...args: unknown[]) => reRegisterMock(...args),
}));

import { reconnectWatch } from "../services/watch";

type TokRow = { needsReauth: boolean };
type SsRow = { calendarId: string; active: boolean };

function fakeDb(opts: { tok?: TokRow; ss?: SsRow }) {
  return {
    select(cols: Record<string, unknown>) {
      const isTokenSelect = "needsReauth" in cols && Object.keys(cols).length === 1;
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  if (isTokenSelect) {
                    return Promise.resolve(opts.tok ? [opts.tok] : []);
                  }
                  return Promise.resolve(opts.ss ? [opts.ss] : []);
                },
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

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

const ENV_WITH_WEBHOOK = {
  ...BASE_ENV,
  WEBHOOK_BASE_URL: "https://example.test",
} as const;

const USER_ID = "user-1";
const ACTIVE_SS: SsRow = { calendarId: "primary", active: true };

describe("reconnectWatch", () => {
  beforeEach(() => {
    reRegisterMock.mockReset();
    reRegisterMock.mockResolvedValue({
      ok: true,
      expiration: new Date("2026-06-01T00:00:00.000Z"),
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("returns webhook_unconfigured without touching the DB when WEBHOOK_BASE_URL is unset", async () => {
    const result = await reconnectWatch(
      fakeDb({ tok: { needsReauth: false }, ss: ACTIVE_SS }),
      BASE_ENV,
      USER_ID,
    );
    expect(result).toEqual({ error: "webhook_unconfigured" });
    expect(reRegisterMock).not.toHaveBeenCalled();
  });

  it("returns reauth_required when the needs_reauth column is set", async () => {
    const result = await reconnectWatch(
      fakeDb({ tok: { needsReauth: true }, ss: ACTIVE_SS }),
      ENV_WITH_WEBHOOK,
      USER_ID,
    );
    expect(result).toEqual({ error: "reauth_required" });
    expect(reRegisterMock).not.toHaveBeenCalled();
  });

  it("returns reauth_required when there is no oauth_tokens row", async () => {
    const result = await reconnectWatch(
      fakeDb({ ss: ACTIVE_SS }),
      ENV_WITH_WEBHOOK,
      USER_ID,
    );
    expect(result).toEqual({ error: "reauth_required" });
    expect(reRegisterMock).not.toHaveBeenCalled();
  });

  it("returns not_bootstrapped when there is no sync_state row", async () => {
    const result = await reconnectWatch(
      fakeDb({ tok: { needsReauth: false } }),
      ENV_WITH_WEBHOOK,
      USER_ID,
    );
    expect(result).toEqual({ error: "not_bootstrapped" });
    expect(reRegisterMock).not.toHaveBeenCalled();
  });

  it("returns calendar_inactive when the sync_state row is not active", async () => {
    const result = await reconnectWatch(
      fakeDb({ tok: { needsReauth: false }, ss: { calendarId: "primary", active: false } }),
      ENV_WITH_WEBHOOK,
      USER_ID,
    );
    expect(result).toEqual({ error: "calendar_inactive" });
    expect(reRegisterMock).not.toHaveBeenCalled();
  });

  it("returns ok + expiration when the core registers successfully", async () => {
    const result = await reconnectWatch(
      fakeDb({ tok: { needsReauth: false }, ss: ACTIVE_SS }),
      ENV_WITH_WEBHOOK,
      USER_ID,
    );
    expect(result).toEqual({
      ok: true,
      expiration: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(reRegisterMock).toHaveBeenCalledTimes(1);
    expect(reRegisterMock.mock.calls[0]?.[2]).toBe(USER_ID);
    expect(reRegisterMock.mock.calls[0]?.[3]).toBe("primary");
  });

  it("maps the core's reauth_required failure through", async () => {
    reRegisterMock.mockResolvedValue({ failed: "reauth_required" });
    const result = await reconnectWatch(
      fakeDb({ tok: { needsReauth: false }, ss: ACTIVE_SS }),
      ENV_WITH_WEBHOOK,
      USER_ID,
    );
    expect(result).toEqual({ error: "reauth_required" });
  });

  it("maps the core's api_error + kind through", async () => {
    reRegisterMock.mockResolvedValue({ failed: "api_error", kind: "server" });
    const result = await reconnectWatch(
      fakeDb({ tok: { needsReauth: false }, ss: ACTIVE_SS }),
      ENV_WITH_WEBHOOK,
      USER_ID,
    );
    expect(result).toEqual({ error: "api_error", kind: "server" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as WatchChannelModule from "../services/watchChannel";
import type * as TokenRefreshModule from "../services/tokenRefresh";

// Stub the Google-facing services + token refresh so the renewal logic can be
// exercised without network or DB. The renewExpiringWatches function orders
// stop → register per user, so the mocks let us assert that order.

const stopMock = vi.fn();
const registerMock = vi.fn();
const getTokenMock = vi.fn();

vi.mock("../services/watchChannel", async () => {
  const actual =
    await vi.importActual<typeof WatchChannelModule>("../services/watchChannel");
  return {
    ...actual,
    stopWatchChannel: (...args: unknown[]) => stopMock(...args),
    registerWatchChannel: (...args: unknown[]) => registerMock(...args),
  };
});

vi.mock("../services/tokenRefresh", async () => {
  const actual =
    await vi.importActual<typeof TokenRefreshModule>("../services/tokenRefresh");
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getTokenMock(...args),
  };
});

import { ReauthRequiredError } from "../services/tokenRefresh";
import { renewExpiringWatches } from "../services/watchRenewal";

type FakeRow = { userId: string; calendarId: string; expiration: Date };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDb(rows: FakeRow[]): any {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
  };
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

describe("renewExpiringWatches", () => {
  beforeEach(() => {
    stopMock.mockReset();
    registerMock.mockReset();
    getTokenMock.mockReset();
    getTokenMock.mockResolvedValue({ accessToken: "at-x", expiresAt: Date.now() });
    stopMock.mockResolvedValue(undefined);
    registerMock.mockResolvedValue({
      channelId: "new-c",
      resourceId: "new-r",
      token: "new-tok",
      expiration: new Date(Date.now() + 7 * 86400 * 1000),
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops and logs when WEBHOOK_BASE_URL is not configured", async () => {
    const out = await renewExpiringWatches(fakeDb([]), BASE_ENV);
    expect(out.scanned).toBe(0);
    expect(stopMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("stops then registers a fresh channel per row (ordering matters)", async () => {
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 3600 * 1000),
      },
      {
        userId: "u2",
        calendarId: "primary",
        expiration: new Date(Date.now() + 3600 * 1000),
      },
    ];
    const env = { ...BASE_ENV, WEBHOOK_BASE_URL: "https://example.test" };
    const callOrder: string[] = [];
    stopMock.mockImplementation(async (_db, _at, userId) => {
      callOrder.push(`stop:${userId}`);
    });
    registerMock.mockImplementation(async (_db, _at, userId) => {
      callOrder.push(`register:${userId}`);
      return {
        channelId: "c",
        resourceId: "r",
        token: "t",
        expiration: new Date(),
      };
    });

    const out = await renewExpiringWatches(fakeDb(rows), env);

    expect(out).toEqual({ scanned: 2, renewed: 2, skipped: 0, failed: 0 });
    expect(callOrder).toEqual([
      "stop:u1",
      "register:u1",
      "stop:u2",
      "register:u2",
    ]);
  });

  it("continues to the next user when one fails (no cascade)", async () => {
    const rows: FakeRow[] = [
      {
        userId: "u-bad",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
      {
        userId: "u-good",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
    ];
    const env = { ...BASE_ENV, WEBHOOK_BASE_URL: "https://example.test" };
    // First user's token refresh fails; second proceeds normally.
    getTokenMock.mockImplementation(async (_db, _env, userId: string) => {
      if (userId === "u-bad") throw new ReauthRequiredError("invalid_grant");
      return { accessToken: "at", expiresAt: 0 };
    });

    const out = await renewExpiringWatches(fakeDb(rows), env);

    expect(out).toEqual({ scanned: 2, renewed: 1, skipped: 0, failed: 1 });
    // u-bad should never reach stop/register because token refresh failed.
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
  });
});

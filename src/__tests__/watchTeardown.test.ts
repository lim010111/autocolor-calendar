import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as TokenRefreshModule from "../services/tokenRefresh";

// `teardownWatchesForUser` absorbs the account-deletion channels.stop loop. It
// is a watch-module sibling, so it composes the module-private
// `stopWatchChannel` directly (the only entry point that does). This unit test
// mocks that seam + the access-token fetch and pins the best-effort discipline:
// per-row warn-and-continue, and skip-the-loop when no token is available —
// neither path may throw (deletion must never be blocked).

const stopMock = vi.fn();
const getTokenMock = vi.fn();

vi.mock("../services/watch/core", () => ({
  stopWatchChannel: (...args: unknown[]) => stopMock(...args),
}));

vi.mock("../services/tokenRefresh", async () => {
  const actual =
    await vi.importActual<typeof TokenRefreshModule>("../services/tokenRefresh");
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getTokenMock(...args),
  };
});

import { ReauthRequiredError } from "../services/tokenRefresh";
import { teardownWatchesForUser } from "../services/watch";

const USER_ID = "user-1";

// `select(...).from(...).where(...)` is awaitable directly — no `.limit()`,
// mirroring the account-deletion watch-rows query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDb(rows: Array<{ calendarId: string }>): any {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve(rows);
            },
          };
        },
      };
    },
  };
}

const ENV = {
  ENV: "dev",
  GOOGLE_OAUTH_REDIRECT_URI: "x",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
  GAS_REDIRECT_URL: "x",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
} as const;

describe("teardownWatchesForUser", () => {
  beforeEach(() => {
    stopMock.mockReset().mockResolvedValue(undefined);
    getTokenMock.mockReset().mockResolvedValue({ accessToken: "at", expiresAt: 0 });
  });
  afterEach(() => vi.clearAllMocks());

  it("stops every active watch row in order", async () => {
    const order: string[] = [];
    stopMock.mockImplementation(async (_db, _at, _uid, calId) => {
      order.push(`stop:${calId}`);
    });

    await teardownWatchesForUser(
      fakeDb([{ calendarId: "cal-a" }, { calendarId: "cal-b" }]),
      ENV,
      USER_ID,
    );

    expect(order).toEqual(["stop:cal-a", "stop:cal-b"]);
    expect(stopMock).toHaveBeenCalledTimes(2);
  });

  it("continues to the next row when one channels.stop fails (per-row warn)", async () => {
    stopMock
      .mockRejectedValueOnce(new Error("calendar api 500"))
      .mockResolvedValueOnce(undefined);

    await expect(
      teardownWatchesForUser(
        fakeDb([{ calendarId: "cal-a" }, { calendarId: "cal-b" }]),
        ENV,
        USER_ID,
      ),
    ).resolves.toBeUndefined();

    expect(stopMock).toHaveBeenCalledTimes(2);
  });

  it("skips the loop without throwing when no access token is available", async () => {
    getTokenMock.mockRejectedValue(new ReauthRequiredError("no_refresh_token"));

    await expect(
      teardownWatchesForUser(fakeDb([{ calendarId: "cal-a" }]), ENV, USER_ID),
    ).resolves.toBeUndefined();

    expect(stopMock).not.toHaveBeenCalled();
  });

  it("no active watch rows → no channels.stop calls", async () => {
    await teardownWatchesForUser(fakeDb([]), ENV, USER_ID);
    expect(stopMock).not.toHaveBeenCalled();
  });
});

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as WatchChannelModule from "../services/watchChannel";
import type * as TokenRefreshModule from "../services/tokenRefresh";
import type * as WatchClaimModule from "../lib/watchClaim";

// Stub the Google-facing services + token refresh so the renewal logic can be
// exercised without network or DB. The renewExpiringWatches function orders
// stop → register per user, so the mocks let us assert that order. `watchClaim`
// is also mocked so concurrency test cases can drive claim success / failure
// per-call without reaching the real `sync_state` UPDATE.

const stopMock = vi.fn();
const registerMock = vi.fn();
const getTokenMock = vi.fn();
const claimMock = vi.fn();
const releaseMock = vi.fn();

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

vi.mock("../lib/watchClaim", async () => {
  const actual =
    await vi.importActual<typeof WatchClaimModule>("../lib/watchClaim");
  return {
    ...actual,
    claimWatchRenewal: (...args: unknown[]) => claimMock(...args),
    releaseWatchRenewal: (...args: unknown[]) => releaseMock(...args),
  };
});

import { CalendarApiError } from "../services/googleCalendar";
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

// Default claim factory used by all tests. Tests that need claim-failure behavior
// override `claimMock.mockResolvedValueOnce` / `mockResolvedValue` explicitly.
function makeClaim(claimedAt = new Date("2026-04-24T00:00:00.000Z")) {
  return { acquired: true as const, rowId: "row-id", claimedAt };
}

describe("renewExpiringWatches", () => {
  beforeEach(() => {
    stopMock.mockReset();
    registerMock.mockReset();
    getTokenMock.mockReset();
    claimMock.mockReset();
    releaseMock.mockReset();
    getTokenMock.mockResolvedValue({ accessToken: "at-x", expiresAt: Date.now() });
    stopMock.mockResolvedValue(undefined);
    registerMock.mockResolvedValue({
      channelId: "new-c",
      resourceId: "new-r",
      token: "new-tok",
      expiration: new Date(Date.now() + 7 * 86400 * 1000),
    });
    claimMock.mockResolvedValue(makeClaim());
    releaseMock.mockResolvedValue(undefined);
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

// §6.4 / §4B M4 — per-row claim guard around stop→register.
describe("renewExpiringWatches — concurrency claim (§6.4)", () => {
  const FIXED_CLAIMED_AT = new Date("2026-04-24T00:00:00.000Z");
  const ENV_WITH_WEBHOOK = {
    ...BASE_ENV,
    WEBHOOK_BASE_URL: "https://example.test",
  } as const;

  beforeEach(() => {
    stopMock.mockReset();
    registerMock.mockReset();
    getTokenMock.mockReset();
    claimMock.mockReset();
    releaseMock.mockReset();
    getTokenMock.mockResolvedValue({ accessToken: "at-x", expiresAt: Date.now() });
    stopMock.mockResolvedValue(undefined);
    registerMock.mockResolvedValue({
      channelId: "new-c",
      resourceId: "new-r",
      token: "new-tok",
      expiration: new Date(Date.now() + 7 * 86400 * 1000),
    });
    claimMock.mockResolvedValue({
      acquired: true,
      rowId: "row-id",
      claimedAt: FIXED_CLAIMED_AT,
    });
    releaseMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("claim acquired → stop+register runs; release called with matching claimedAt", async () => {
    // Behavioral round-trip pin for the ms-precision invariant: whatever Date
    // the claim returns must flow through finally to release unchanged.
    // Mutating `date_trunc('milliseconds', ...)` out of watchClaim would let a
    // µs-drifted Date slip through and this exact-reference check would still
    // pass under mocks (see the source-level regex below for the µs guard).
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 3600 * 1000),
      },
    ];

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 1, renewed: 1, skipped: 0, failed: 0 });
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    // The 4th arg to releaseWatchRenewal is the claimedAt — pin that it's the
    // exact Date reference returned by claim, not a re-derived value.
    expect(releaseMock.mock.calls[0]?.[3]).toBe(FIXED_CLAIMED_AT);
  });

  it("claim not acquired → row skipped, stop/register/release never called", async () => {
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 3600 * 1000),
      },
    ];
    claimMock.mockResolvedValue({ acquired: false });

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 1, renewed: 0, skipped: 1, failed: 0 });
    expect(stopMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    // Critically: release must not fire when we never held the claim, or
    // we'd null out whichever worker actually holds it right now.
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("stop throws CalendarApiError → release still fires in finally", async () => {
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
    ];
    stopMock.mockRejectedValue(
      new CalendarApiError("rate_limited", 429, "rateLimitExceeded", "channels.stop 429"),
    );

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 1, renewed: 0, skipped: 0, failed: 1 });
    expect(registerMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.calls[0]?.[3]).toBe(FIXED_CLAIMED_AT);
  });

  it("register throws CalendarApiError → release still fires in finally", async () => {
    // Most common real-world failure: stop succeeds, register fails on rate
    // limit / backend error. The old channel is already gone; the claim must
    // be released so the next cron tick re-tries cleanly.
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
    ];
    registerMock.mockRejectedValue(
      new CalendarApiError("server", 503, "backendError", "channels.watch 503"),
    );

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 1, renewed: 0, skipped: 0, failed: 1 });
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.calls[0]?.[3]).toBe(FIXED_CLAIMED_AT);
  });

  it("release succeeded on row N → row N+1 re-claims independently", async () => {
    // Pins that `releaseWatchRenewal` finishing doesn't block the next
    // iteration's claim — important regression guard if a future refactor
    // accidentally holds the lock across iterations.
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
      {
        userId: "u2",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
    ];

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 2, renewed: 2, skipped: 0, failed: 0 });
    expect(claimMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledTimes(2);
    // Each claim is called with its own (userId, calendarId), not the
    // previous row's — proves the loop re-reads row state per iteration.
    expect(claimMock.mock.calls[0]?.[1]).toBe("u1");
    expect(claimMock.mock.calls[1]?.[1]).toBe("u2");
  });

  it("stale TTL — second invocation re-claims after first is held", async () => {
    // Simulates the cron-tick arc: first tick finds the row held by another
    // worker (claim=false → skip), second tick (10min later in reality)
    // finds the stale lock reclaimable (claim=true → proceeds).
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
    ];

    claimMock
      .mockResolvedValueOnce({ acquired: false })
      .mockResolvedValueOnce({
        acquired: true,
        rowId: "row-id",
        claimedAt: FIXED_CLAIMED_AT,
      });

    const firstTick = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);
    expect(firstTick).toEqual({ scanned: 1, renewed: 0, skipped: 1, failed: 0 });
    expect(stopMock).not.toHaveBeenCalled();

    const secondTick = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);
    expect(secondTick).toEqual({ scanned: 1, renewed: 1, skipped: 0, failed: 0 });
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it("source-level precision invariant: watchClaim.ts uses date_trunc('milliseconds', now())", () => {
    // Mirrors syncClaim's regex guard. Removing the ms truncation would let
    // Postgres µs drift through the Date round-trip and silently no-op every
    // ownership-aware release until the 10-min stale window fires.
    // __dirname is unavailable under the test runner's ESM transform; resolve
    // via import.meta.url instead (matches the `syncClaim` regex-guard style).
    const here = path.dirname(new URL(import.meta.url).pathname);
    const src = fs.readFileSync(
      path.resolve(here, "../lib/watchClaim.ts"),
      "utf8",
    );
    expect(src).toMatch(/date_trunc\(['"]milliseconds['"],\s*now\(\)\)/);
  });
});

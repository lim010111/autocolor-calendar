import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as WatchClaimModule from "../lib/watchClaim";

// `renewExpiringWatches` composes the shared watch core per row. This adapter
// test mocks the single `reRegisterWatch` seam (guard / reauth / stop→register
// / classify owned once by `watchCore.test.ts`) and the `watchClaim` helpers so
// concurrency cases drive claim success / failure per-call. The batch's own
// policy — SELECT, per-row claim/release, summary counters, continue-on-fail —
// is what this suite pins.

const reRegisterMock = vi.fn();
const claimMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("../services/watch/core", () => ({
  reRegisterWatch: (...args: unknown[]) => reRegisterMock(...args),
}));

vi.mock("../lib/watchClaim", async () => {
  const actual =
    await vi.importActual<typeof WatchClaimModule>("../lib/watchClaim");
  return {
    ...actual,
    claimWatchRenewal: (...args: unknown[]) => claimMock(...args),
    releaseWatchRenewal: (...args: unknown[]) => releaseMock(...args),
  };
});

import { renewExpiringWatches } from "../services/watch";

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

function okResult() {
  return { ok: true as const, expiration: new Date(Date.now() + 7 * 86400 * 1000) };
}

// Default claim factory used by all tests. Tests that need claim-failure behavior
// override `claimMock.mockResolvedValueOnce` / `mockResolvedValue` explicitly.
function makeClaim(claimedAt = new Date("2026-04-24T00:00:00.000Z")) {
  return { acquired: true as const, rowId: "row-id", claimedAt };
}

describe("renewExpiringWatches", () => {
  beforeEach(() => {
    reRegisterMock.mockReset();
    claimMock.mockReset();
    releaseMock.mockReset();
    reRegisterMock.mockResolvedValue(okResult());
    claimMock.mockResolvedValue(makeClaim());
    releaseMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops and logs when WEBHOOK_BASE_URL is not configured", async () => {
    const out = await renewExpiringWatches(fakeDb([]), BASE_ENV);
    expect(out.scanned).toBe(0);
    expect(reRegisterMock).not.toHaveBeenCalled();
  });

  it("(re)registers a fresh channel per row in order", async () => {
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
    reRegisterMock.mockImplementation(async (_db, _env, userId) => {
      callOrder.push(`register:${userId}`);
      return okResult();
    });

    const out = await renewExpiringWatches(fakeDb(rows), env);

    expect(out).toEqual({ scanned: 2, renewed: 2, skipped: 0, failed: 0 });
    expect(callOrder).toEqual(["register:u1", "register:u2"]);
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
    // First user's core reports reauth_required; second proceeds normally.
    reRegisterMock.mockImplementation(async (_db, _env, userId: string) => {
      if (userId === "u-bad") return { failed: "reauth_required" as const };
      return okResult();
    });

    const out = await renewExpiringWatches(fakeDb(rows), env);

    expect(out).toEqual({ scanned: 2, renewed: 1, skipped: 0, failed: 1 });
    expect(reRegisterMock).toHaveBeenCalledTimes(2);
  });
});

// §6.4 / §4B M4 — per-row claim guard around the core (re)registration.
describe("renewExpiringWatches — concurrency claim (§6.4)", () => {
  const FIXED_CLAIMED_AT = new Date("2026-04-24T00:00:00.000Z");
  const ENV_WITH_WEBHOOK = {
    ...BASE_ENV,
    WEBHOOK_BASE_URL: "https://example.test",
  } as const;

  beforeEach(() => {
    reRegisterMock.mockReset();
    claimMock.mockReset();
    releaseMock.mockReset();
    reRegisterMock.mockResolvedValue(okResult());
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

  it("claim acquired → core runs; release called with matching claimedAt", async () => {
    // Behavioral round-trip pin for the ms-precision invariant: whatever Date
    // the claim returns must flow through finally to release unchanged.
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 3600 * 1000),
      },
    ];

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 1, renewed: 1, skipped: 0, failed: 0 });
    expect(reRegisterMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    // The 4th arg to releaseWatchRenewal is the claimedAt — pin that it's the
    // exact Date reference returned by claim, not a re-derived value.
    expect(releaseMock.mock.calls[0]?.[3]).toBe(FIXED_CLAIMED_AT);
  });

  it("claim not acquired → row skipped, core/release never called", async () => {
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
    expect(reRegisterMock).not.toHaveBeenCalled();
    // Critically: release must not fire when we never held the claim, or
    // we'd null out whichever worker actually holds it right now.
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("core returns a failed result → release still fires in finally", async () => {
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
    ];
    reRegisterMock.mockResolvedValue({ failed: "api_error", kind: "rate_limited" });

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 1, renewed: 0, skipped: 0, failed: 1 });
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.calls[0]?.[3]).toBe(FIXED_CLAIMED_AT);
  });

  it("core throws an unexpected error → release still fires in finally", async () => {
    // Most common real-world failure surfaces as a result union, but an
    // unexpected throw (e.g. a socket reset) must still release the claim so
    // the next cron tick re-tries cleanly.
    const rows: FakeRow[] = [
      {
        userId: "u1",
        calendarId: "primary",
        expiration: new Date(Date.now() + 1000),
      },
    ];
    reRegisterMock.mockRejectedValue(new Error("hyperdrive socket reset"));

    const out = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);

    expect(out).toEqual({ scanned: 1, renewed: 0, skipped: 0, failed: 1 });
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.calls[0]?.[3]).toBe(FIXED_CLAIMED_AT);
  });

  it("release succeeded on row N → row N+1 re-claims independently", async () => {
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
    expect(reRegisterMock).not.toHaveBeenCalled();

    const secondTick = await renewExpiringWatches(fakeDb(rows), ENV_WITH_WEBHOOK);
    expect(secondTick).toEqual({ scanned: 1, renewed: 1, skipped: 0, failed: 0 });
    expect(reRegisterMock).toHaveBeenCalledTimes(1);
  });

  it("source-level precision invariant: watchClaim.ts uses date_trunc('milliseconds', now())", () => {
    // Mirrors syncClaim's regex guard. Removing the ms truncation would let
    // Postgres µs drift through the Date round-trip and silently no-op every
    // ownership-aware release until the 10-min stale window fires.
    const here = path.dirname(new URL(import.meta.url).pathname);
    const src = fs.readFileSync(
      path.resolve(here, "../lib/watchClaim.ts"),
      "utf8",
    );
    expect(src).toMatch(/date_trunc\(['"]milliseconds['"],\s*now\(\)\)/);
  });
});

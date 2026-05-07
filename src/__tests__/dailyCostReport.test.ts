// Cost guardrail (§5/§6 후속) — `runDailyCostReport` unit tests. The
// service is the operator-facing alert layer for `llm_usage_global_daily`,
// so the suite pins:
//   1. UTC-yesterday selection (day boundary correctness)
//   2. zero-row fallback (the previous day saw no LLM activity)
//   3. warn vs info log routing at the 80% threshold
//   4. env override honoured by the report's limit calc
//
// The fake `db` only supports the exact chain the service uses
// (`select.from.where.limit`), so a future query-shape change in the
// service will surface as a typed test breakage rather than passing tests
// against an unintended fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import { runDailyCostReport, WARN_THRESHOLD_PCT } from "../services/dailyCostReport";

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ENV: "dev",
    GOOGLE_OAUTH_REDIRECT_URI: "x",
    GOOGLE_CLIENT_ID: "x",
    GOOGLE_CLIENT_SECRET: "x",
    GAS_REDIRECT_URL: "x",
    TOKEN_ENCRYPTION_KEY: "x",
    SESSION_HMAC_KEY: "x",
    SESSION_PEPPER: "x",
    ...overrides,
  };
}

function fakeDb(rows: Array<{ callCount: number }>): {
  db: never;
  whereArgs: unknown[];
} {
  const whereArgs: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: (arg: unknown) => {
          whereArgs.push(arg);
          return {
            limit: async () => rows,
          };
        },
      }),
    }),
  } as never;
  return { db, whereArgs };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDailyCostReport — daily LLM cost summary", () => {
  it("uses YESTERDAY's UTC date regardless of the time-of-day component", async () => {
    const { db } = fakeDb([{ callCount: 100 }]);
    const summary = await runDailyCostReport({
      db,
      env: makeEnv({ LLM_GLOBAL_DAILY_LIMIT: "10000" }),
      now: new Date("2026-05-07T12:34:56Z"),
    });
    expect(summary.day).toBe("2026-05-06");
  });

  it("rolls UTC-yesterday across month/year boundaries", async () => {
    const { db } = fakeDb([]);
    const s = await runDailyCostReport({
      db,
      env: makeEnv(),
      now: new Date("2026-01-01T00:05:00Z"),
    });
    expect(s.day).toBe("2025-12-31");
  });

  it("rolls UTC-yesterday across non-leap-year Feb→Mar boundary", async () => {
    const { db } = fakeDb([]);
    const s = await runDailyCostReport({
      db,
      env: makeEnv(),
      now: new Date("2026-03-01T00:05:00Z"),
    });
    expect(s.day).toBe("2026-02-28");
  });

  it("returns callCount=0 when no row exists for yesterday (no LLM activity)", async () => {
    const { db } = fakeDb([]);
    const summary = await runDailyCostReport({
      db,
      env: makeEnv({ LLM_GLOBAL_DAILY_LIMIT: "10000" }),
      now: new Date("2026-05-07T00:05:00Z"),
    });
    expect(summary.callCount).toBe(0);
    expect(summary.saturationPct).toBe(0);
    expect(summary.warned).toBe(false);
    // Empty-day report goes to info, not warn.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns at the 80% saturation threshold (warned=true → console.warn)", async () => {
    const { db } = fakeDb([{ callCount: 8000 }]);
    const summary = await runDailyCostReport({
      db,
      env: makeEnv({ LLM_GLOBAL_DAILY_LIMIT: "10000" }),
      now: new Date("2026-05-07T00:05:00Z"),
    });
    expect(summary.callCount).toBe(8000);
    expect(summary.saturationPct).toBe(80);
    expect(summary.warned).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    // Sanity: the threshold constant matches the test expectation so a
    // future tweak doesn't silently make the test self-validate the wrong
    // value.
    expect(WARN_THRESHOLD_PCT).toBe(80);
  });

  it("stays at info below the threshold even when saturation is non-zero", async () => {
    const { db } = fakeDb([{ callCount: 7999 }]);
    const summary = await runDailyCostReport({
      db,
      env: makeEnv({ LLM_GLOBAL_DAILY_LIMIT: "10000" }),
      now: new Date("2026-05-07T00:05:00Z"),
    });
    expect(summary.warned).toBe(false);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("honours env override for the global limit (parse rules match classifier)", async () => {
    const { db } = fakeDb([{ callCount: 90 }]);
    const summary = await runDailyCostReport({
      db,
      env: makeEnv({ LLM_GLOBAL_DAILY_LIMIT: "100" }),
      now: new Date("2026-05-07T00:05:00Z"),
    });
    expect(summary.globalLimit).toBe(100);
    expect(summary.saturationPct).toBe(90);
    expect(summary.warned).toBe(true);
  });

  it("falls back to the default (10000) when env var is unset", async () => {
    const { db } = fakeDb([{ callCount: 8001 }]);
    const summary = await runDailyCostReport({
      db,
      env: makeEnv(), // LLM_GLOBAL_DAILY_LIMIT unset
      now: new Date("2026-05-07T00:05:00Z"),
    });
    expect(summary.globalLimit).toBe(10000);
    expect(summary.warned).toBe(true); // 8001/10000 = 80.01% → warn
  });
});

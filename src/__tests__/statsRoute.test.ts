import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks must precede the tested-module import. Same pattern as
// categoriesRoute.test.ts.
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../services/sessionService", () => ({
  verifySession: vi.fn(),
}));

import { app } from "../index";
import { getDb } from "../db";
import {
  llmCalls,
  llmUsageDaily,
  rollbackRuns,
  syncRuns,
} from "../db/schema";
import { verifySession } from "../services/sessionService";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

type Fixtures = {
  syncAgg: {
    runs: number;
    okRuns: number;
    evaluated: number;
    updated: number;
    skippedManual: number;
    skippedEqual: number;
    noMatch: number;
  };
  llmAgg: {
    calls: number;
    hits: number;
    miss: number;
    timeout: number;
    quotaExceeded: number;
    httpError: number;
    badResponse: number;
    disabled: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
  };
  rollbackAgg: {
    runs: number;
    cleared: number;
    ok: number;
    reauthRequired: number;
    forbidden: number;
    notFound: number;
    retryable: number;
  };
  usage: Array<{ callCount: number }>;
  lastSync: Array<{ finishedAt: Date; outcome: string }>;
};

function emptyFixtures(): Fixtures {
  return {
    syncAgg: {
      runs: 0,
      okRuns: 0,
      evaluated: 0,
      updated: 0,
      skippedManual: 0,
      skippedEqual: 0,
      noMatch: 0,
    },
    llmAgg: {
      calls: 0,
      hits: 0,
      miss: 0,
      timeout: 0,
      quotaExceeded: 0,
      httpError: 0,
      badResponse: 0,
      disabled: 0,
      avgLatencyMs: null,
      p95LatencyMs: null,
    },
    rollbackAgg: {
      runs: 0,
      cleared: 0,
      ok: 0,
      reauthRequired: 0,
      forbidden: 0,
      notFound: 0,
      retryable: 0,
    },
    usage: [],
    lastSync: [],
  };
}

// Drizzle's `select({...}).from(table).where(...)` returns a thenable. For the
// lastSync query it chains `.orderBy(...).limit(1)`. We return an object that
// serves both shapes. Differentiation by `from(table)` identity + select-field
// shape (present only when fields include `finishedAt`+`outcome` → lastSync).
function makeFakeDb(fx: Fixtures) {
  return {
    db: {
      select: (fields: Record<string, unknown>) => ({
        from: (table: unknown) => {
          const fieldKeys = Object.keys(fields);
          const isLastSync =
            table === syncRuns &&
            fieldKeys.length === 2 &&
            fieldKeys.includes("finishedAt") &&
            fieldKeys.includes("outcome");
          const isSyncAgg =
            table === syncRuns &&
            !isLastSync &&
            fieldKeys.includes("runs") &&
            fieldKeys.includes("okRuns");
          const isLlmAgg =
            table === llmCalls && fieldKeys.includes("avgLatencyMs");
          const isRollbackAgg =
            table === rollbackRuns && fieldKeys.includes("cleared");
          const isUsage =
            table === llmUsageDaily && fieldKeys.includes("callCount");

          const rowsForAgg = isSyncAgg
            ? [fx.syncAgg]
            : isLlmAgg
              ? [fx.llmAgg]
              : isRollbackAgg
                ? [fx.rollbackAgg]
                : [];

          return {
            where: (_w: unknown) => {
              const aggPromise = Promise.resolve(rowsForAgg);
              return {
                orderBy: (_o: unknown) => ({
                  limit: async (_n: number) => fx.lastSync,
                }),
                limit: async (_n: number) =>
                  isUsage ? fx.usage : rowsForAgg,
                then: (
                  onFulfilled: (v: unknown[]) => unknown,
                  onRejected?: (e: unknown) => unknown,
                ) => aggPromise.then(onFulfilled, onRejected),
                catch: (onRejected: (e: unknown) => unknown) =>
                  aggPromise.catch(onRejected),
              };
            },
          };
        },
      }),
    },
    close: async () => undefined,
  };
}

const baseEnv = {
  ENV: "dev" as const,
  HYPERDRIVE: { connectionString: "postgres://fake" } as unknown as Hyperdrive,
  GOOGLE_OAUTH_REDIRECT_URI: "https://worker.test/oauth/google/callback",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "cs",
  GAS_REDIRECT_URL: "https://script.google.com/test/exec",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
};

const ctx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function invoke(
  path: string,
  init?: RequestInit & { userToken?: string; env?: Record<string, unknown> },
): Promise<Response> {
  const headers: Record<string, string> = {};
  const incoming = init?.headers as Record<string, string> | undefined;
  if (incoming) Object.assign(headers, incoming);
  if (init?.userToken) headers["authorization"] = `Bearer ${init.userToken}`;
  return app.fetch(
    new Request(`https://worker.test${path}`, { ...init, headers }),
    (init?.env ?? baseEnv) as unknown as Record<string, unknown>,
    ctx,
  );
}

let fixtures: Fixtures;

beforeEach(() => {
  fixtures = emptyFixtures();
  vi.mocked(getDb).mockImplementation(
    () => makeFakeDb(fixtures) as unknown as ReturnType<typeof getDb>,
  );
  vi.mocked(verifySession).mockImplementation(async (_db, _pep, token) => {
    if (token === "token-a") return { userId: USER_A, email: "a@test" };
    if (token === "token-b") return { userId: USER_B, email: "b@test" };
    return null;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/api/stats — auth gate", () => {
  it("returns 401 without bearer", async () => {
    const res = await invoke("/api/stats");
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid bearer", async () => {
    const res = await invoke("/api/stats", { userToken: "token-bad" });
    expect(res.status).toBe(401);
  });
});

describe("/api/stats — window parameter", () => {
  it("rejects invalid window values with 400", async () => {
    const res = await invoke("/api/stats?window=xx", { userToken: "token-a" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_window");
  });

  it("accepts ?window=30d and reports it back", async () => {
    const res = await invoke("/api/stats?window=30d", {
      userToken: "token-a",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { window: string };
    expect(body.window).toBe("30d");
  });

  it("defaults to 7d when window is omitted", async () => {
    const res = await invoke("/api/stats", { userToken: "token-a" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { window: string };
    expect(body.window).toBe("7d");
  });
});

describe("/api/stats — empty state", () => {
  it("returns zero counters + null latency + null lastSync when no data", async () => {
    const res = await invoke("/api/stats", { userToken: "token-a" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      classification: { runs: number; updated: number };
      llm: { calls: number; avgLatencyMs: number | null; p95LatencyMs: number | null };
      rollback: { runs: number };
      lastSync: unknown;
    };
    expect(body.classification.runs).toBe(0);
    expect(body.classification.updated).toBe(0);
    expect(body.llm.calls).toBe(0);
    expect(body.llm.avgLatencyMs).toBeNull();
    expect(body.llm.p95LatencyMs).toBeNull();
    expect(body.rollback.runs).toBe(0);
    expect(body.lastSync).toBeNull();
  });
});

describe("/api/stats — aggregation shape", () => {
  it("surfaces sync_runs outcome counts (runs vs okRuns)", async () => {
    fixtures.syncAgg = {
      runs: 5,
      okRuns: 2,
      evaluated: 120,
      updated: 17,
      skippedManual: 3,
      skippedEqual: 8,
      noMatch: 2,
    };
    const res = await invoke("/api/stats", { userToken: "token-a" });
    const body = (await res.json()) as {
      classification: {
        runs: number;
        okRuns: number;
        evaluated: number;
        updated: number;
        skippedManual: number;
      };
    };
    expect(body.classification.runs).toBe(5);
    expect(body.classification.okRuns).toBe(2);
    expect(body.classification.evaluated).toBe(120);
    expect(body.classification.updated).toBe(17);
    expect(body.classification.skippedManual).toBe(3);
  });

  it("surfaces LLM byOutcome breakdown with rounded latency metrics", async () => {
    fixtures.llmAgg = {
      calls: 10,
      hits: 6,
      miss: 2,
      timeout: 1,
      quotaExceeded: 1,
      httpError: 0,
      badResponse: 0,
      disabled: 0,
      avgLatencyMs: 387.42,
      p95LatencyMs: 612.8,
    };
    const res = await invoke("/api/stats", { userToken: "token-a" });
    const body = (await res.json()) as {
      llm: {
        calls: number;
        hits: number;
        byOutcome: Record<string, number>;
        avgLatencyMs: number | null;
        p95LatencyMs: number | null;
      };
    };
    expect(body.llm.calls).toBe(10);
    expect(body.llm.hits).toBe(6);
    expect(body.llm.byOutcome).toEqual({
      hit: 6,
      miss: 2,
      timeout: 1,
      quota_exceeded: 1,
      http_error: 0,
      bad_response: 0,
      disabled: 0,
    });
    // Math.round drops fractional ms — telemetry precision is ms, not μs.
    expect(body.llm.avgLatencyMs).toBe(387);
    expect(body.llm.p95LatencyMs).toBe(613);
  });

  it("surfaces rollback runs + cleared count", async () => {
    fixtures.rollbackAgg = {
      runs: 3,
      cleared: 42,
      ok: 2,
      reauthRequired: 0,
      forbidden: 0,
      notFound: 1,
      retryable: 0,
    };
    const res = await invoke("/api/stats", { userToken: "token-a" });
    const body = (await res.json()) as {
      rollback: { runs: number; cleared: number; byOutcome: Record<string, number> };
    };
    expect(body.rollback.runs).toBe(3);
    expect(body.rollback.cleared).toBe(42);
    expect(body.rollback.byOutcome.ok).toBe(2);
    expect(body.rollback.byOutcome.not_found).toBe(1);
  });

  it("returns lastSync ISO + outcome when a row exists", async () => {
    fixtures.lastSync = [
      { finishedAt: new Date("2026-04-22T10:30:00Z"), outcome: "ok" },
    ];
    const res = await invoke("/api/stats", { userToken: "token-a" });
    const body = (await res.json()) as {
      lastSync: { finishedAt: string; outcome: string } | null;
    };
    expect(body.lastSync).not.toBeNull();
    expect(body.lastSync!.outcome).toBe("ok");
    expect(body.lastSync!.finishedAt).toBe("2026-04-22T10:30:00.000Z");
  });
});

describe("/api/stats — LLM daily quota surface", () => {
  it("returns null dailyQuotaRemaining when OPENAI_API_KEY is unset", async () => {
    const envNoKey = { ...baseEnv };
    const res = await invoke("/api/stats", {
      userToken: "token-a",
      env: envNoKey,
    });
    const body = (await res.json()) as {
      llm: { dailyQuotaRemaining: number | null };
    };
    expect(body.llm.dailyQuotaRemaining).toBeNull();
  });

  it("computes quota remaining with LLM_DAILY_LIMIT override", async () => {
    fixtures.usage = [{ callCount: 40 }];
    const envWithKey = {
      ...baseEnv,
      OPENAI_API_KEY: "sk-test",
      LLM_DAILY_LIMIT: "100",
    };
    const res = await invoke("/api/stats", {
      userToken: "token-a",
      env: envWithKey,
    });
    const body = (await res.json()) as {
      llm: { dailyQuotaRemaining: number | null };
    };
    // 100 - 40 = 60 remaining
    expect(body.llm.dailyQuotaRemaining).toBe(60);
  });

  it("falls back to default 200 when LLM_DAILY_LIMIT is unset", async () => {
    fixtures.usage = [{ callCount: 0 }];
    const envKeyOnly = { ...baseEnv, OPENAI_API_KEY: "sk-test" };
    const res = await invoke("/api/stats", {
      userToken: "token-a",
      env: envKeyOnly,
    });
    const body = (await res.json()) as {
      llm: { dailyQuotaRemaining: number | null };
    };
    expect(body.llm.dailyQuotaRemaining).toBe(200);
  });

  it("floors remaining at 0 when usage has exceeded the limit", async () => {
    // Race between check and UPSERT can push callCount slightly above limit —
    // guard the response from showing a negative value.
    fixtures.usage = [{ callCount: 250 }];
    const envWithKey = {
      ...baseEnv,
      OPENAI_API_KEY: "sk-test",
      LLM_DAILY_LIMIT: "200",
    };
    const res = await invoke("/api/stats", {
      userToken: "token-a",
      env: envWithKey,
    });
    const body = (await res.json()) as {
      llm: { dailyQuotaRemaining: number | null };
    };
    expect(body.llm.dailyQuotaRemaining).toBe(0);
  });
});

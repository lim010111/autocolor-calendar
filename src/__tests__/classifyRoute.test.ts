import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../services/sessionService", () => ({
  verifySession: vi.fn(),
}));
// §5 후속 — classifierChain is mocked at module boundary so the preview-LLM
// suite can drive the chain's return value without wiring up real fetch / DB
// UPSERT machinery. The real chain has its own coverage in classifierChain.test.ts.
vi.mock("../services/classifierChain", () => ({
  buildDefaultClassifier: vi.fn(),
}));

import { app } from "../index";
import { getDb } from "../db";
import { verifySession } from "../services/sessionService";
import { buildDefaultClassifier } from "../services/classifierChain";
import type { ChainDeps } from "../services/classifierChain";
import type {
  Classification,
  ClassifyContext,
  ClassifyEventFn,
} from "../services/classifier";
import type { CalendarEvent } from "../services/googleCalendar";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

type Row = {
  id: string;
  userId: string;
  name: string;
  colorId: string;
  keywords: string[];
  priority: number;
  createdAt: Date;
};

function row(overrides: Partial<Row>): Row {
  return {
    id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
    userId: overrides.userId ?? USER_A,
    name: overrides.name ?? "주간회의",
    colorId: overrides.colorId ?? "9",
    keywords: overrides.keywords ?? ["주간회의"],
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? new Date("2026-04-19T00:00:00Z"),
  };
}

// Hand-rolled fake drizzle select chain. The classify route only issues a
// select/where/orderBy, so we don't need the full machinery from
// categoriesRoute.test.ts. We extract the user_id constraint by walking the
// Drizzle SQL tree for a string-chunk that ends in " = " and pairing it with
// the adjacent Param.
function extractUserIdFromWhere(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!chunks) return undefined;
  for (let i = 0; i < chunks.length; i++) {
    const col = chunks[i] as { name?: string };
    const maybeEq = chunks[i + 1] as { value?: unknown };
    const param = chunks[i + 2] as { value?: unknown };
    if (
      col?.name === "user_id" &&
      Array.isArray((maybeEq as { value?: unknown[] })?.value) &&
      ((maybeEq as { value: string[] }).value[0] ?? "").includes(" = ") &&
      param &&
      "value" in param
    ) {
      return param.value as string;
    }
  }
  for (const c of chunks) {
    const found = extractUserIdFromWhere(c);
    if (found) return found;
  }
  return undefined;
}

type FakeDbHandle = {
  db: unknown;
  close: () => Promise<void>;
  state: { rows: Row[] };
  inserts: { table: unknown; values: unknown }[];
};

type InsertRecord = { table: unknown; values: unknown };

type FakeDb = {
  select(_cols: unknown): unknown;
  insert(table: unknown): { values(values: unknown): Promise<void> };
};

function makeFakeDb(initial: Row[] = []): FakeDbHandle & { inserts: InsertRecord[] } {
  const state = { rows: [...initial] };
  const inserts: InsertRecord[] = [];
  const db: FakeDb = {
    select(_cols: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(whereSql: unknown) {
              const uid = extractUserIdFromWhere(whereSql);
              const filtered = state.rows.filter((r) => r.userId === uid);
              return {
                orderBy: async (..._args: unknown[]) => {
                  return [...filtered].sort((a, b) => {
                    if (a.priority !== b.priority)
                      return a.priority - b.priority;
                    return a.createdAt.getTime() - b.createdAt.getTime();
                  });
                },
              };
            },
          };
        },
      };
    },
    // Preview LLM hit/miss tests exercise the §6 Wave A `llm_calls` writer.
    // The fake records each insert so tests can assert the shape without
    // reaching for a real drizzle builder chain.
    insert(table: unknown) {
      return {
        values: async (values: unknown) => {
          inserts.push({ table, values });
        },
      };
    },
  };
  return { db, close: async () => undefined, state, inserts };
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

let currentDb: FakeDbHandle;

beforeEach(() => {
  currentDb = makeFakeDb();
  vi.mocked(getDb).mockImplementation(
    () => currentDb as unknown as ReturnType<typeof getDb>,
  );
  vi.mocked(verifySession).mockImplementation(async (_db, _pep, token) => {
    if (token === "token-a") return { userId: USER_A, email: "a@test" };
    if (token === "token-b") return { userId: USER_B, email: "b@test" };
    return null;
  });
  // §5 후속 — default fails loudly if a test accidentally engages the LLM
  // branch without supplying its own stub. The rule-only tests never call
  // the factory, so the default is never exercised there.
  vi.mocked(buildDefaultClassifier).mockImplementation(() => {
    throw new Error("buildDefaultClassifier called without test-specific stub");
  });
});

// Helper — returns a stub `ChainDeps → ClassifyEventFn` builder that invokes
// the provided hooks in the order the real chain would, then returns the
// configured classification. Default `reason` prefix drives the route's
// rule-vs-llm response branch.
function stubChain(opts: {
  result: Classification | null;
  engageLlmLeg?: boolean;
  llmCallRecord?: Parameters<NonNullable<ChainDeps["onLlmCall"]>>[0];
}): (deps: ChainDeps) => ClassifyEventFn {
  return (deps: ChainDeps): ClassifyEventFn =>
    async (_event: CalendarEvent, _ctx: ClassifyContext) => {
      if (opts.engageLlmLeg) {
        deps.onLlmAttempted?.();
        if (opts.llmCallRecord) deps.onLlmCall?.(opts.llmCallRecord);
      }
      return opts.result;
    };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/classify/preview", () => {
  it("returns 401 without bearer", async () => {
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "주간회의" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 on Zod validation failure (empty summary)", async () => {
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("returns no_match with llmAvailable=false when no OPENAI_API_KEY and zero categories", async () => {
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "주간회의" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "no_match", llmAvailable: false });
  });

  it("returns no_match with llmAvailable=true when OPENAI_API_KEY is set", async () => {
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "임의 이벤트 without matches" }),
      env: { ...baseEnv, OPENAI_API_KEY: "sk-test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "no_match", llmAvailable: true });
  });

  it("returns rule hit with matchedKeyword when summary contains a keyword", async () => {
    currentDb.state.rows.push(
      row({ id: "11111111-1111-1111-1111-111111111111" }),
    );
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "오늘의 주간회의" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "rule",
      category: {
        id: "11111111-1111-1111-1111-111111111111",
        name: "주간회의",
        colorId: "9",
      },
      matchedKeyword: "주간회의",
    });
  });

  it("does not leak other users' categories (tenant isolation)", async () => {
    currentDb.state.rows.push(
      row({
        id: "22222222-2222-2222-2222-222222222222",
        userId: USER_B,
        name: "점심",
        keywords: ["점심"],
      }),
    );
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "점심 미팅" }),
    });
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe("no_match");
  });

  it("matches description when summary doesn't contain keyword", async () => {
    currentDb.state.rows.push(row({ keywords: ["운동"] }));
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: "저녁 약속",
        description: "헬스장에서 운동 후 식사",
      }),
    });
    const body = (await res.json()) as {
      source: string;
      matchedKeyword?: string;
    };
    expect(body.source).toBe("rule");
    expect(body.matchedKeyword).toBe("운동");
  });

  // §5 후속 — on-demand LLM preview. These cases pin the `llm: true` branch.
  // Regression guard for the default path: buildDefaultClassifier must NOT
  // be called when the flag is absent, so the rule-only path stays cheap.
  it("llm flag omitted — buildDefaultClassifier never called (regression guard)", async () => {
    currentDb.state.rows.push(row({ keywords: ["주간회의"] }));
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "오늘의 주간회의" }),
    });
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe("rule");
    expect(vi.mocked(buildDefaultClassifier)).not.toHaveBeenCalled();
  });

  it("llm:true + OPENAI_API_KEY absent — no_match without llmTried (chain bails at key check)", async () => {
    currentDb.state.rows.push(row({}));
    // Chain bails before onLlmAttempted fires (stub mirrors classifierChain's
    // env.OPENAI_API_KEY check returning null without invoking the hook).
    vi.mocked(buildDefaultClassifier).mockImplementation(
      stubChain({ result: null, engageLlmLeg: false }),
    );
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "임의 이벤트", llm: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "no_match", llmAvailable: false });
  });

  it("llm:true + rule hit (via chain) — source:'rule', onLlmAttempted not called", async () => {
    currentDb.state.rows.push(row({ keywords: ["회의"] }));
    vi.mocked(buildDefaultClassifier).mockImplementation(
      stubChain({
        result: {
          colorId: "9",
          categoryId: "11111111-1111-1111-1111-111111111111",
          reason: "rule_match:회의",
          matchedKeyword: "회의",
        },
        // Rule hit short-circuits inside the chain — LLM leg never engages.
        engageLlmLeg: false,
      }),
    );
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "주간 회의", llm: true }),
      env: { ...baseEnv, OPENAI_API_KEY: "sk-test" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("rule");
    expect(body).not.toHaveProperty("llmTried");
    expect(body.matchedKeyword).toBe("회의");
  });

  it("llm:true + LLM hit — source:'llm', category shape correct, no matchedKeyword", async () => {
    currentDb.state.rows.push(
      row({
        id: "11111111-1111-1111-1111-111111111111",
        name: "회의",
        colorId: "9",
      }),
    );
    vi.mocked(buildDefaultClassifier).mockImplementation(
      stubChain({
        result: {
          colorId: "9",
          categoryId: "11111111-1111-1111-1111-111111111111",
          reason: "llm_match:회의",
        },
        engageLlmLeg: true,
        llmCallRecord: {
          outcome: "hit",
          latencyMs: 42,
          categoryCount: 1,
          attempts: 1,
          categoryName: "회의",
        },
      }),
    );
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: "전혀 무관한 제목",
        llm: true,
      }),
      env: { ...baseEnv, OPENAI_API_KEY: "sk-test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "llm",
      category: {
        id: "11111111-1111-1111-1111-111111111111",
        name: "회의",
        colorId: "9",
      },
    });
    // §6 Wave A parity — preview's onCall record reaches the llm_calls table.
    // Sync path bulk-inserts; preview inserts one row per request through the
    // same execCtx.waitUntil / warn-on-failure discipline.
    const row0 = currentDb.inserts[0]?.values as Record<string, unknown>;
    expect(row0).toMatchObject({
      userId: USER_A,
      outcome: "hit",
      latencyMs: 42,
      categoryCount: 1,
      attempts: 1,
      categoryName: "회의",
    });
  });

  it("llm:true + LLM miss (null) — no_match with llmTried:true", async () => {
    currentDb.state.rows.push(row({}));
    vi.mocked(buildDefaultClassifier).mockImplementation(
      stubChain({
        result: null,
        engageLlmLeg: true,
        llmCallRecord: {
          outcome: "miss",
          latencyMs: 120,
          categoryCount: 1,
          attempts: 1,
        },
      }),
    );
    const res = await invoke("/api/classify/preview", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "아무 이벤트", llm: true }),
      env: { ...baseEnv, OPENAI_API_KEY: "sk-test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "no_match",
      llmAvailable: true,
      llmTried: true,
    });
    // Miss also emits its own llm_calls row — §6 Wave A parity across
    // outcomes, not only hits.
    const missRow = currentDb.inserts[0]?.values as Record<string, unknown>;
    expect(missRow).toMatchObject({
      userId: USER_A,
      outcome: "miss",
      latencyMs: 120,
      categoryCount: 1,
      attempts: 1,
    });
  });
});

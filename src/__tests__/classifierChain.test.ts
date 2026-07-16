import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import { buildDefaultClassifier } from "../services/classifierChain";
import type {
  ClassificationOutcome,
  ClassifyContext,
} from "../services/classifierOutcomes";
import type { Sink } from "../services/classifierSinks";
import type { Stage1Deps } from "../services/stage1";
import type { CalendarEvent } from "../services/googleCalendar";
import type { ReserveLlmCallFn } from "../services/llmClassifier";
import type { Rule } from "../services/ruleService";
import { synthesizeSeeds } from "../services/ruleService";

const USER = "00000000-0000-0000-0000-000000000001";

function cat(partial: Partial<Rule> = {}): Rule {
  const name = partial.name ?? "회의";
  const keywords = partial.keywords ?? ["회의"];
  return {
    id: partial.id ?? "c-1",
    userId: partial.userId ?? USER,
    name,
    colorId: partial.colorId ?? "9",
    keywords,
    priority: partial.priority ?? 100,
    labelId: partial.labelId ?? null,
    labelDeletedAt: partial.labelDeletedAt ?? null,
    seeds: partial.seeds ?? synthesizeSeeds({ name, keywords }),
    createdAt: partial.createdAt ?? new Date("2026-04-19T00:00:00Z"),
    updatedAt: partial.updatedAt ?? new Date("2026-04-19T00:00:00Z"),
  };
}

function ctxOf(categories: Rule[]): ClassifyContext {
  return { userId: USER, categories };
}

function ev(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: partial.id ?? "e-1", ...partial };
}

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ENV: "dev",
    GOOGLE_OAUTH_REDIRECT_URI: "https://worker.test/oauth/google/callback",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GAS_REDIRECT_URL: "https://script.google.com/x",
    TOKEN_ENCRYPTION_KEY: "key",
    SESSION_HMAC_KEY: "key",
    SESSION_PEPPER: "pep",
    OPENAI_API_KEY: "sk-test",
    ...overrides,
  };
}

const okReserve: ReserveLlmCallFn = async () => ({ ok: true, count: 1 });

function openAiJson(name: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ category_name: name }) } }],
    }),
    { status: 200 },
  );
}

// Build a recording sink that captures every outcome it receives. Used to
// assert (a) the chain emitted exactly the expected outcome(s), and (b) the
// sink was invoked the expected number of times.
function recordingSink(): { sink: Sink; outcomes: ClassificationOutcome[] } {
  const outcomes: ClassificationOutcome[] = [];
  const sink: Sink = async (o) => {
    outcomes.push(o);
  };
  return { sink, outcomes };
}

// ADR-0004 #02 — a Stage-1 deps whose kNN returns a single high-score seed for
// `ruleId`, so `classifyStage1` yields an `embeddingHit`. The embed vector
// content is irrelevant because `db.execute` is faked to return ranked rows
// directly. Omitting `stage1` from the chain deps skips Stage 1 (miss → LLM),
// which is how the LLM-leg tests below reach the Stage-2 path.
function stage1Hit(ruleId = "c-1", seedText = "회의", score = 0.99): Stage1Deps {
  const rows = [{ ruleId, seedId: "s-1", seedText, seedType: "name", score }];
  return {
    db: { execute: async () => rows } as never,
    embedTexts: async (texts: string[]) => texts.map(() => [0.1, 0.2]),
  };
}

describe("buildDefaultClassifier — rule → LLM chain", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("embedding hit short-circuits — LLM never invoked, emits embeddingHit", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [rec.sink],
      stage1: stage1Hit("c-1", "회의", 0.99),
    });
    const out = await classify(ev({ summary: "주간 회의" }), ctxOf([cat()]));
    expect(out).toEqual({
      kind: "embeddingHit",
      rule: { id: "c-1", name: "회의", colorId: "9", labelId: null },
      seed: { id: "s-1", text: "회의" },
      grade: "declared",
      score: 0.99,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rec.outcomes).toHaveLength(1);
    expect(rec.outcomes[0]!.kind).toBe("embeddingHit");
  });

  it("rule miss + LLM hit → emits llmHit with llmRecord attached", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("회의")) as unknown as typeof fetch;
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [rec.sink],
    });
    const out = await classify(
      ev({ summary: "totally unrelated" }),
      ctxOf([cat({ name: "회의", colorId: "9" })]),
    );
    expect(out.kind).toBe("llmHit");
    if (out.kind !== "llmHit") return;
    expect(out.rule).toEqual({ id: "c-1", name: "회의", colorId: "9", labelId: null });
    expect(out.llmRecord.outcome).toBe("hit");
    expect(rec.outcomes).toHaveLength(1);
    expect(rec.outcomes[0]!.kind).toBe("llmHit");
  });

  it("rule miss + LLM timeout → emits llmTimeout", async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [rec.sink],
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out.kind).toBe("llmTimeout");
    if (out.kind !== "llmTimeout") return;
    expect(out.llmRecord.outcome).toBe("timeout");
    expect(rec.outcomes.map((o) => o.kind)).toEqual(["llmTimeout"]);
  });

  it("rule miss + LLM bad_response (unknown category name) → emits llmBadResponse", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("관리자")) as unknown as typeof fetch;
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [rec.sink],
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out.kind).toBe("llmBadResponse");
    expect(rec.outcomes.map((o) => o.kind)).toEqual(["llmBadResponse"]);
  });

  it("rule miss + quota exceeded → emits llmQuotaExceeded, no fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: async () => ({ ok: false, count: 201 }),
      sinks: [rec.sink],
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out.kind).toBe("llmQuotaExceeded");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rec.outcomes.map((o) => o.kind)).toEqual(["llmQuotaExceeded"]);
  });

  it("OPENAI_API_KEY absent → emits noMatch, no fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const rec = recordingSink();
    const { OPENAI_API_KEY: _omit, ...envNoKey } = makeEnv();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: envNoKey,
      userId: USER,
      reserve: okReserve,
      sinks: [rec.sink],
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out).toEqual({ kind: "noMatch" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rec.outcomes.map((o) => o.kind)).toEqual(["noMatch"]);
  });

  it("quota latch — after first quota_exceeded, subsequent rule-miss events skip reserve() and fetch()", async () => {
    // Per-run latch prevents the llm_usage_daily write storm described in
    // §5.3 review I2: once quota is confirmed exhausted, the chain stops
    // touching the DB for the rest of this sync run.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const reserveSpy = vi.fn(async () => ({ ok: false, count: 201 }));
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: reserveSpy,
      sinks: [rec.sink],
    });

    // First rule-miss → reserve called, returns over-quota → latch engages.
    expect((await classify(ev({ summary: "x" }), ctxOf([cat()]))).kind).toBe(
      "llmQuotaExceeded",
    );
    // Next three rule-misses should NOT re-invoke reserve or fetch.
    expect((await classify(ev({ summary: "y" }), ctxOf([cat()]))).kind).toBe(
      "llmQuotaExceeded",
    );
    expect((await classify(ev({ summary: "z" }), ctxOf([cat()]))).kind).toBe(
      "llmQuotaExceeded",
    );
    expect((await classify(ev({ summary: "w" }), ctxOf([cat()]))).kind).toBe(
      "llmQuotaExceeded",
    );

    expect(reserveSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Sink saw every event (summary accuracy parity with the pre-PR
    // onLlmAttempted/onLlmQuotaExceeded callback counts).
    expect(rec.outcomes).toHaveLength(4);
    expect(rec.outcomes.every((o) => o.kind === "llmQuotaExceeded")).toBe(true);
  });

  it("llmHit outcome carries the llmRecord with outcome='hit', attempts>=1, categoryCount, categoryName", async () => {
    // §6 Wave A telemetry contract. `classifyWithLlm` returns the record
    // alongside the outcome; the chain attaches it to the matching
    // `ClassificationOutcome.llmRecord` field.
    globalThis.fetch = vi.fn(async () => openAiJson("회의")) as unknown as typeof fetch;
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [rec.sink],
    });
    const out = await classify(
      ev({ summary: "unrelated" }),
      ctxOf([cat({ name: "회의", colorId: "9" })]),
    );
    expect(out.kind).toBe("llmHit");
    if (out.kind !== "llmHit") return;
    expect(out.llmRecord.outcome).toBe("hit");
    expect(out.llmRecord.attempts).toBeGreaterThanOrEqual(1);
    expect(out.llmRecord.categoryCount).toBe(1);
    expect(out.llmRecord.categoryName).toBe("회의");
    expect(out.llmRecord.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("quota-latched synthetic record carries attempts:0 / latencyMs:0", async () => {
    // Second+ rule-miss events after the latch engages do NOT call
    // `classifyWithLlm`. The chain itself synthesizes the record so the §6
    // log captures the intent to call.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const reserveSpy = vi.fn(async () => ({ ok: false, count: 201 }));
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: reserveSpy,
      sinks: [rec.sink],
    });

    // First call engages latch (record from classifyWithLlm with attempts:0
    // since reserve blocks before any attempt).
    await classify(ev({ summary: "x" }), ctxOf([cat()]));
    // Second call is the synthetic latched path.
    const out = await classify(ev({ summary: "y" }), ctxOf([cat()]));

    expect(rec.outcomes).toHaveLength(2);
    expect(out.kind).toBe("llmQuotaExceeded");
    if (out.kind !== "llmQuotaExceeded") return;
    expect(out.llmRecord.outcome).toBe("quota_exceeded");
    expect(out.llmRecord.attempts).toBe(0);
    expect(out.llmRecord.latencyMs).toBe(0);
    expect(out.llmRecord.categoryCount).toBe(1);
  });

  it("§6.3 후속 — quota-latched synthetic record carries eventId + availableCategories (NOT promptSummary / rawResponse)", async () => {
    // The latched skip never builds a prompt or hits the network, so
    // `promptSummary` / `rawResponse` MUST be undefined to match the
    // schema NULL semantics. `eventId` and `availableCategories` are
    // known cheaply and would be useful for debugging which event tripped
    // the over-quota fallthrough.
    const reserveSpy = vi.fn(async () => ({ ok: false, count: 201 }));
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: reserveSpy,
      sinks: [rec.sink],
    });

    // First call latches via classifyWithLlm.
    await classify(ev({ id: "evt-A", summary: "x" }), ctxOf([cat()]));
    // Second call is the chain's synthetic skip.
    const out = await classify(
      ev({ id: "evt-B", summary: "y" }),
      ctxOf([cat({ name: "회의" }), cat({ id: "c-2", name: "개인" })]),
    );

    expect(out.kind).toBe("llmQuotaExceeded");
    if (out.kind !== "llmQuotaExceeded") return;
    expect(out.llmRecord.eventId).toBe("evt-B");
    expect(out.llmRecord.availableCategories).toEqual(["회의", "개인"]);
    expect(out.llmRecord.promptSummary).toBeUndefined();
    expect(out.llmRecord.rawResponse).toBeUndefined();
  });

  it("empty categories → emits noMatch, no LLM leg engagement", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const rec = recordingSink();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [rec.sink],
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([]));
    expect(out).toEqual({ kind: "noMatch" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rec.outcomes.map((o) => o.kind)).toEqual(["noMatch"]);
  });

  it("AC #8 — sink failure isolation: throwing sink does NOT fail classify, warn 1줄 emitted, other sinks still ran", async () => {
    // Observability writes must never cause retry (`src/CLAUDE.md`). A sink
    // that throws is logged via warn and silently swallowed; the chain
    // still returns the outcome and other sinks still see it.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const goodSink = vi.fn(async (_o: ClassificationOutcome) => {});
    const badSink: Sink = async () => {
      throw new Error("sink boom");
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [badSink, goodSink],
      stage1: stage1Hit(),
    });
    const out = await classify(ev({ summary: "주간 회의" }), ctxOf([cat()]));
    expect(out.kind).toBe("embeddingHit");
    expect(goodSink).toHaveBeenCalledTimes(1);
    // Exactly one warn line referencing the sink failure.
    const sinkFailLogs = warnSpy.mock.calls.filter((c) =>
      c.some((arg) => typeof arg === "string" && arg.includes("classifier sink failed")),
    );
    expect(sinkFailLogs).toHaveLength(1);
    warnSpy.mockRestore();
  });

  it("AC #8 — synchronous sink throw also isolated (sync-throw, not async rejection)", async () => {
    // Codex review (PR #96) caught: `Promise.allSettled(sinks.map(s => s(o)))`
    // does NOT catch sync throws — those escape `sinks.map`'s callback before
    // any Promise exists. A sink whose body throws BEFORE returning a Promise
    // (typical for a non-async sink: `() => { somethingThatThrows();
    // return Promise.resolve(); }`) bypasses `allSettled` and would crash
    // classify. The `async (s) =>` wrapper in `runSinks` is the fix; this
    // test pins it.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const goodSink = vi.fn(async (_o: ClassificationOutcome) => {});
    const syncThrowSink: Sink = (() => {
      throw new Error("sync sink boom");
    }) as unknown as Sink;
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      sinks: [syncThrowSink, goodSink],
      stage1: stage1Hit(),
    });
    const out = await classify(ev({ summary: "주간 회의" }), ctxOf([cat()]));
    expect(out.kind).toBe("embeddingHit");
    expect(goodSink).toHaveBeenCalledTimes(1);
    const sinkFailLogs = warnSpy.mock.calls.filter((c) =>
      c.some((arg) => typeof arg === "string" && arg.includes("classifier sink failed")),
    );
    expect(sinkFailLogs).toHaveLength(1);
    warnSpy.mockRestore();
  });
});

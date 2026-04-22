import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { Category, ClassifyContext } from "../services/classifier";
import { buildDefaultClassifier } from "../services/classifierChain";
import type { CalendarEvent } from "../services/googleCalendar";
import type { ReserveLlmCallFn } from "../services/llmClassifier";

const USER = "00000000-0000-0000-0000-000000000001";

function cat(partial: Partial<Category> = {}): Category {
  return {
    id: partial.id ?? "c-1",
    name: partial.name ?? "회의",
    colorId: partial.colorId ?? "9",
    keywords: partial.keywords ?? ["회의"],
    priority: partial.priority ?? 100,
  };
}

function ctxOf(categories: Category[]): ClassifyContext {
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

describe("buildDefaultClassifier — rule → LLM chain", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rule hit short-circuits — LLM never invoked", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmSucceeded: vi.fn(),
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      ...counters,
    });
    const out = await classify(ev({ summary: "주간 회의" }), ctxOf([cat()]));
    expect(out).toEqual({
      colorId: "9",
      categoryId: "c-1",
      reason: "rule_match:회의",
      matchedKeyword: "회의",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(counters.onLlmAttempted).not.toHaveBeenCalled();
    expect(counters.onLlmSucceeded).not.toHaveBeenCalled();
  });

  it("rule miss + LLM hit → returns classification, bumps attempted+succeeded", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("회의")) as unknown as typeof fetch;
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmSucceeded: vi.fn(),
      onLlmTimeout: vi.fn(),
      onLlmQuotaExceeded: vi.fn(),
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      ...counters,
    });
    const out = await classify(
      ev({ summary: "totally unrelated" }),
      ctxOf([cat({ name: "회의", colorId: "9" })]),
    );
    expect(out).toEqual({
      colorId: "9",
      categoryId: "c-1",
      reason: "llm_match:회의",
    });
    expect(counters.onLlmAttempted).toHaveBeenCalledTimes(1);
    expect(counters.onLlmSucceeded).toHaveBeenCalledTimes(1);
    expect(counters.onLlmTimeout).not.toHaveBeenCalled();
    expect(counters.onLlmQuotaExceeded).not.toHaveBeenCalled();
  });

  it("rule miss + LLM timeout → null, bumps attempted+timeout", async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmSucceeded: vi.fn(),
      onLlmTimeout: vi.fn(),
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      ...counters,
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out).toBeNull();
    expect(counters.onLlmAttempted).toHaveBeenCalledTimes(1);
    expect(counters.onLlmTimeout).toHaveBeenCalledTimes(1);
    expect(counters.onLlmSucceeded).not.toHaveBeenCalled();
  });

  it("rule miss + LLM bad_response (unknown category name) → null, succeeded NOT bumped", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("관리자")) as unknown as typeof fetch;
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmSucceeded: vi.fn(),
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      ...counters,
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out).toBeNull();
    expect(counters.onLlmAttempted).toHaveBeenCalledTimes(1);
    expect(counters.onLlmSucceeded).not.toHaveBeenCalled();
  });

  it("rule miss + quota exceeded → null, bumps attempted+quotaExceeded", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmQuotaExceeded: vi.fn(),
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: async () => ({ ok: false, count: 201 }),
      ...counters,
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out).toBeNull();
    expect(counters.onLlmAttempted).toHaveBeenCalledTimes(1);
    expect(counters.onLlmQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OPENAI_API_KEY absent → null, no LLM counters bumped, no fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmSucceeded: vi.fn(),
      onLlmTimeout: vi.fn(),
      onLlmQuotaExceeded: vi.fn(),
    };
    const { OPENAI_API_KEY: _omit, ...envNoKey } = makeEnv();
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: envNoKey,
      userId: USER,
      reserve: okReserve,
      ...counters,
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([cat()]));
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(counters.onLlmAttempted).not.toHaveBeenCalled();
    expect(counters.onLlmSucceeded).not.toHaveBeenCalled();
    expect(counters.onLlmTimeout).not.toHaveBeenCalled();
    expect(counters.onLlmQuotaExceeded).not.toHaveBeenCalled();
  });

  it("quota latch — after first quota_exceeded, subsequent rule-miss events skip reserve() and fetch()", async () => {
    // Per-run latch prevents the llm_usage_daily write storm described in
    // §5.3 review I2: once quota is confirmed exhausted, the chain stops
    // touching the DB for the rest of this sync run.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const reserveSpy = vi.fn(async () => ({ ok: false, count: 201 }));
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmSucceeded: vi.fn(),
      onLlmQuotaExceeded: vi.fn(),
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: reserveSpy,
      ...counters,
    });

    // First rule-miss → reserve called, returns over-quota → latch engages.
    expect(await classify(ev({ summary: "x" }), ctxOf([cat()]))).toBeNull();
    // Next three rule-misses should NOT re-invoke reserve or fetch.
    expect(await classify(ev({ summary: "y" }), ctxOf([cat()]))).toBeNull();
    expect(await classify(ev({ summary: "z" }), ctxOf([cat()]))).toBeNull();
    expect(await classify(ev({ summary: "w" }), ctxOf([cat()]))).toBeNull();

    expect(reserveSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Attempted + quotaExceeded still bump every time (summary accuracy).
    expect(counters.onLlmAttempted).toHaveBeenCalledTimes(4);
    expect(counters.onLlmQuotaExceeded).toHaveBeenCalledTimes(4);
    expect(counters.onLlmSucceeded).not.toHaveBeenCalled();
  });

  it("empty categories → null, no LLM counters bumped (LLM leg short-circuits)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const counters = {
      onLlmAttempted: vi.fn(),
      onLlmSucceeded: vi.fn(),
    };
    const classify = buildDefaultClassifier({
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: okReserve,
      ...counters,
    });
    const out = await classify(ev({ summary: "x" }), ctxOf([]));
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(counters.onLlmAttempted).not.toHaveBeenCalled();
  });
});

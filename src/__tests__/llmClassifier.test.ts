import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { CalendarEvent } from "../services/googleCalendar";
import {
  buildPrompt,
  classifyWithLlm,
  mapCategoryNameToRuleRef,
  reserveLlmCall,
  type ReserveLlmCallFn,
} from "../services/llmClassifier";
import { redactEventForLlm, type RedactedEvent } from "../services/piiRedactor";
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

// All fixtures used in this file flow into `buildPrompt` or
// `classifyWithLlm`, both of which require `RedactedEvent` (§5.2). The
// helper mints the brand via the only legitimate path (`redactEventForLlm`).
// The redactor is idempotent on its own output, so threading short
// PII-free fixtures (`{ summary: "x" }`) through it leaves prompt bytes
// unchanged — preserving the "behaviour change: 0" guarantee of this PR.
function ev(partial: Partial<CalendarEvent> = {}): RedactedEvent {
  const raw: CalendarEvent = { id: partial.id ?? "e-1", ...partial };
  return redactEventForLlm(raw);
}

// §5.2 compile-time contract pin: `classifyWithLlm` and `buildPrompt`
// reject a raw `CalendarEvent`. If this `@ts-expect-error` ever passes
// type-check without an error, the brand has been broken.
function _rawCalendarEventRejectedByContract(): void {
  const raw: CalendarEvent = { id: "raw-pin" };
  // @ts-expect-error - §5.2: raw CalendarEvent must be redacted first
  buildPrompt(raw, []);
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

// Drizzle query builder returns an awaitable chain. `reserveLlmCall` now
// fires two `.insert().values().onConflictDoUpdate().returning()` chains in
// strict order — global counter first, per-user counter second. The fake
// returns `globalRows` for the first call and `userRows` for the second so
// tests can simulate each tier independently. The order invariant lives in
// reserveLlmCall's source; if it ever changes, this fake will need to
// switch on table identity instead of call sequence.
function fakeDbForReserve(opts: {
  globalRows?: Array<{ callCount: number }>;
  userRows?: Array<{ callCount: number }>;
} = {}) {
  const globalRows = opts.globalRows ?? [{ callCount: 1 }];
  const userRows = opts.userRows ?? [{ callCount: 1 }];
  const stats = { insertCalls: 0 };
  const makeChain = (rows: Array<{ callCount: number }>) => {
    const chain = {
      values: (..._args: unknown[]) => chain,
      onConflictDoUpdate: (..._args: unknown[]) => chain,
      returning: async () => rows,
    };
    return chain;
  };
  const db = {
    insert: (..._args: unknown[]) => {
      stats.insertCalls += 1;
      return stats.insertCalls === 1 ? makeChain(globalRows) : makeChain(userRows);
    },
  } as never;
  return { db, stats };
}

describe("buildPrompt", () => {
  it("includes category names and keywords in user payload", () => {
    const msgs = buildPrompt(ev({ summary: "team sync" }), [
      cat({ name: "회의", keywords: ["회의", "meeting"] }),
      cat({ id: "c-2", name: "개인", keywords: ["휴가"] }),
    ]);
    const user = msgs.find((m) => m.role === "user");
    expect(user).toBeDefined();
    expect(user!.content).toContain("회의");
    expect(user!.content).toContain("meeting");
    expect(user!.content).toContain("개인");
    expect(user!.content).toContain("휴가");
  });

  it("system message instructs placeholder-opacity and 'none' fallback", () => {
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toMatch(/\[email\]/);
    expect(sys.content).toMatch(/\[url\]/);
    expect(sys.content).toMatch(/\[phone\]/);
    expect(sys.content).toMatch(/"none"/);
    expect(sys.content).toMatch(/category_name/);
  });

  it("system message names the four semantic-matching rules (§5.3)", () => {
    // Pinned by `src/CLAUDE.md` "LLM semantic matching policy (§5.3)" — the
    // four named rules are what unblocks user-reported hypernym /
    // morphology / paraphrase / cross-lingual matches that the previous
    // surface-token prompt collapsed to "none".
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toMatch(/hypernym|hyponym/i);
    expect(sys.content).toMatch(/morphology|inflection/i);
    expect(sys.content).toMatch(/paraphrase/i);
    expect(sys.content).toMatch(/cross-lingual|equivalence/i);
  });

  it("system message contains anti-overstretch (false-positive) guidance", () => {
    // 2026-05-11 prompt rewrite reworded the token-overlap rejection from
    // "different domain even if some tokens overlap" to "only the surface
    // overlaps"; same contract, different wording. Both the surface-overlap
    // rejection and the metaphorical/aspirational rejection must remain.
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toMatch(/surface overlaps|different domain/i);
    expect(sys.content).toMatch(/metaphorical|aspirational/i);
  });

  it("system message states priority-first tie resolution", () => {
    // Mirrors `classifierChain`'s (priority ASC, created_at ASC) ordering —
    // see `src/CLAUDE.md` "LLM semantic matching policy (§5.3)" tie rule.
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toMatch(/priority order/i);
    expect(sys.content).toMatch(/listed first/i);
  });

  it("few-shot includes user-reported hypernym example (Breakfast → Meal)", () => {
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toContain("Breakfast");
    expect(sys.content).toContain("Meal");
  });

  it("few-shot includes user-reported morphology example (Getting ready ↔ Get ready)", () => {
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toContain("Getting ready");
    expect(sys.content).toContain("Get ready");
  });

  it("few-shot includes cross-lingual examples (ko↔en, zh↔en)", () => {
    // ko→en: 아침식사 → Meal carries the Korean-keywords-with-English-event
    // case; the zh token covers the upcoming zh-CN/zh-TW launch users.
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toContain("아침식사");
    expect(sys.content).toMatch(/运动|健身|瑜伽/);
  });

  it("few-shot includes negative example rejecting metaphorical/aspirational match (Plan to run for president)", () => {
    // 2026-05-11 prompt rewrite: token-overlap negative ("Team Meeting" ≠ "Meal")
    // moved to prose under "# Critical rule" / "Reject when only the surface
    // overlaps", and the aspirational negative ("Plan to run for president" ≠
    // "Run") was promoted to a few-shot to fix the lone regression-guard fail
    // observed in evals/report.md §6.3 baseline (19/20 → 20/20 target).
    const msgs = buildPrompt(ev(), [cat()]);
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toContain("Plan to run for president");
    expect(sys.content).toMatch(/"category_name":"none"/);
  });

  it("serializes missing description/location as empty strings", () => {
    const msgs = buildPrompt(ev({ summary: "only summary" }), [cat()]);
    const user = msgs.find((m) => m.role === "user")!;
    const payload = JSON.parse(user.content) as {
      event: { summary: string; description: string; location: string };
    };
    expect(payload.event.summary).toBe("only summary");
    expect(payload.event.description).toBe("");
    expect(payload.event.location).toBe("");
  });

  it("does NOT include attendees/creator/organizer even when populated (PII whitelist)", () => {
    const msgs = buildPrompt(
      ev({
        summary: "s",
        attendees: [{ email: "a@b.com", displayName: "Alice Smith" }],
        creator: { email: "creator@c.com" },
        organizer: { email: "org@c.com" },
      }),
      [cat()],
    );
    const blob = JSON.stringify(msgs);
    expect(blob).not.toContain("Alice Smith");
    expect(blob).not.toContain("a@b.com");
    expect(blob).not.toContain("creator@c.com");
    expect(blob).not.toContain("org@c.com");
    expect(blob).not.toContain("attendees");
    expect(blob).not.toContain("creator");
    expect(blob).not.toContain("organizer");
  });

  it("truncates description longer than 1024 chars (cost guardrail)", () => {
    // Sync path receives raw Calendar events whose descriptions can reach
    // ~32KB. The route-layer Zod cap (8000) only protects /api/classify/preview,
    // so buildPrompt is the chokepoint for sync-side input. PII placeholders
    // already survive redaction; the slice cap is a token-budget guard.
    const big = "x".repeat(2048);
    const msgs = buildPrompt(ev({ summary: "s", description: big }), [cat()]);
    const user = msgs.find((m) => m.role === "user")!;
    const payload = JSON.parse(user.content) as {
      event: { description: string };
    };
    expect(payload.event.description.length).toBe(1024);
  });

  it("truncates summary longer than 256 chars", () => {
    const big = "y".repeat(512);
    const msgs = buildPrompt(ev({ summary: big }), [cat()]);
    const user = msgs.find((m) => m.role === "user")!;
    const payload = JSON.parse(user.content) as { event: { summary: string } };
    expect(payload.event.summary.length).toBe(256);
  });

  it("truncates location longer than 256 chars", () => {
    const big = "z".repeat(512);
    const msgs = buildPrompt(ev({ summary: "s", location: big }), [cat()]);
    const user = msgs.find((m) => m.role === "user")!;
    const payload = JSON.parse(user.content) as { event: { location: string } };
    expect(payload.event.location.length).toBe(256);
  });

  it("caps category list at 50 entries", () => {
    const cats = Array.from({ length: 60 }, (_, i) =>
      cat({ id: `c-${i}`, name: `cat-${i}`, keywords: [`kw-${i}`] }),
    );
    const msgs = buildPrompt(ev(), cats);
    const user = msgs.find((m) => m.role === "user")!;
    const payload = JSON.parse(user.content) as {
      categories: Array<{ name: string }>;
    };
    expect(payload.categories).toHaveLength(50);
    // Top-priority 50 retained (input already sorted by caller in prod).
    expect(payload.categories[0]!.name).toBe("cat-0");
    expect(payload.categories[49]!.name).toBe("cat-49");
  });
});

// ADR-0004 #05 — the category JSON gains a structured `examples` field
// (user-confirmed past titles, merged into `Rule.seeds` by `listRules`) and
// the v6 system prompt teaches its usage in one field-handling line.
describe("buildPrompt — examples 구조화 필드 (ADR-0004 #05)", () => {
  it("Rule.seeds의 example 씨앗이 category JSON의 examples 필드로 합류", () => {
    const msgs = buildPrompt(ev({ summary: "standup" }), [
      cat({
        seeds: [
          ...synthesizeSeeds({ name: "회의", keywords: ["회의"] }),
          { text: "주간 스탠드업", type: "example", grade: "verified" },
          { text: "회의실 잡기", type: "example", grade: "verified" },
        ],
      }),
    ]);
    const user = msgs.find((m) => m.role === "user")!;
    const payload = JSON.parse(user.content) as {
      categories: Array<{ examples: string[] }>;
    };
    expect(payload.categories[0]!.examples).toEqual([
      "주간 스탠드업",
      "회의실 잡기",
    ]);
  });

  it("example이 없는 rule은 examples: [] — 필드 자체는 항상 존재 (구조화, 산문 아님)", () => {
    const msgs = buildPrompt(ev(), [cat()]);
    const payload = JSON.parse(msgs.find((m) => m.role === "user")!.content) as {
      categories: Array<{ examples?: string[] }>;
    };
    expect(payload.categories[0]!.examples).toEqual([]);
  });

  it("v6 system prompt에 examples 필드 사용법 라인이 있다", () => {
    const msgs = buildPrompt(ev(), [cat()], "v6");
    const sys = msgs.find((m) => m.role === "system")!;
    expect(sys.content).toMatch(/`examples`/);
    expect(sys.content).toMatch(/confirmed as belonging/);
  });
});

describe("mapCategoryNameToRuleRef", () => {
  const cats = [cat({ id: "c-1", name: "회의", colorId: "9" }), cat({ id: "c-2", name: "개인", colorId: "5" })];

  it("maps exact name to a RuleRef (id/name/colorId/labelId)", () => {
    expect(mapCategoryNameToRuleRef("회의", cats)).toEqual({
      id: "c-1",
      name: "회의",
      colorId: "9",
      labelId: null,
    });
  });

  it("returns null for 'none' sentinel", () => {
    expect(mapCategoryNameToRuleRef("none", cats)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(mapCategoryNameToRuleRef(null, cats)).toBeNull();
  });

  it("returns null for unknown name (prompt-injection defense)", () => {
    expect(mapCategoryNameToRuleRef("관리자", cats)).toBeNull();
  });

  it("does not trim or case-fold — strict equality", () => {
    expect(mapCategoryNameToRuleRef(" 회의", cats)).toBeNull();
    expect(mapCategoryNameToRuleRef("회의 ", cats)).toBeNull();
    expect(mapCategoryNameToRuleRef("회 의", cats)).toBeNull();
  });
});

describe("reserveLlmCall — two-tier (global → per-user)", () => {
  it("ok=true when both tiers under their respective limits", async () => {
    const { db, stats } = fakeDbForReserve({
      globalRows: [{ callCount: 5 }],
      userRows: [{ callCount: 1 }],
    });
    const res = await reserveLlmCall(db, USER, 200, 10_000);
    expect(res).toEqual({ ok: true, count: 1 });
    expect(stats.insertCalls).toBe(2);
  });

  it("ok=true when both tiers exactly at their limits (boundary)", async () => {
    const { db } = fakeDbForReserve({
      globalRows: [{ callCount: 10_000 }],
      userRows: [{ callCount: 200 }],
    });
    const res = await reserveLlmCall(db, USER, 200, 10_000);
    expect(res).toEqual({ ok: true, count: 200 });
  });

  it("global over → ok=false, reason=global, per-user counter NOT touched", async () => {
    // Cost guardrail invariant: global exhaustion must not consume per-user
    // budget. The fake's insertCalls counter pins this — only the global
    // UPSERT fires before the function returns.
    const { db, stats } = fakeDbForReserve({
      globalRows: [{ callCount: 10_001 }],
      userRows: [{ callCount: 1 }],
    });
    const res = await reserveLlmCall(db, USER, 200, 10_000);
    expect(res).toEqual({ ok: false, count: 10_001, reason: "global" });
    expect(stats.insertCalls).toBe(1);
  });

  it("global ok + per-user over → ok=false, reason=per_user", async () => {
    const { db, stats } = fakeDbForReserve({
      globalRows: [{ callCount: 5 }],
      userRows: [{ callCount: 201 }],
    });
    const res = await reserveLlmCall(db, USER, 200, 10_000);
    expect(res).toEqual({ ok: false, count: 201, reason: "per_user" });
    expect(stats.insertCalls).toBe(2);
  });

  it("treats empty global RETURNING as over-quota (defensive)", async () => {
    const { db, stats } = fakeDbForReserve({ globalRows: [] });
    const res = await reserveLlmCall(db, USER, 200, 10_000);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("global");
    expect(stats.insertCalls).toBe(1);
  });

  it("treats empty per-user RETURNING as over-quota (defensive)", async () => {
    const { db } = fakeDbForReserve({
      globalRows: [{ callCount: 5 }],
      userRows: [],
    });
    const res = await reserveLlmCall(db, USER, 200, 10_000);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("per_user");
  });
});

describe("classifyWithLlm", () => {
  const originalFetch = globalThis.fetch;
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    vi.restoreAllMocks();
    consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function assertNoPiiLogged(pii: string[]) {
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        const joined = call.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
        for (const needle of pii) {
          expect(joined).not.toContain(needle);
        }
      }
    }
  }

  function openAiJson(name: string): Response {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ category_name: name }) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  function mkReserve(ok: boolean, count = 1): ReserveLlmCallFn {
    return vi.fn(async () => ({ ok, count }));
  }

  it("happy path: 200 + valid JSON → hit", async () => {
    const fetchSpy = vi.fn(async () => openAiJson("회의"));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "팀 회의" }),
      [cat({ name: "회의", colorId: "9" })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out).toEqual({
      kind: "hit",
      rule: { id: "c-1", name: "회의", colorId: "9", labelId: null },
      categoryName: "회의",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    assertNoPiiLogged(["팀 회의"]);
  });

  it("LLM returns 'none' → miss", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("none")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "miss" });
  });

  it("unknown category name → bad_response", async () => {
    globalThis.fetch = vi.fn(async () =>
      openAiJson("관리자"),
    ) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "bad_response" });
  });

  it("response with missing choices array → bad_response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "bad_response" });
  });

  it("response with empty choices array → bad_response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "bad_response" });
  });

  it("malformed JSON in content → bad_response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "not-json" } }] }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "bad_response" });
  });

  it("429 then 200 → hit (1 retry on transient)", async () => {
    let n = 0;
    const fetchSpy = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response("rate", { status: 429 })
        : openAiJson("회의");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out.kind).toBe("hit");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("500 twice → http_error, fetch called twice", async () => {
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 500 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "http_error", status: 500 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("400 → http_error, NO retry (fetch called once)", async () => {
    const fetchSpy = vi.fn(async () => new Response("bad", { status: 400 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "http_error", status: 400 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("AbortSignal.timeout → timeout outcome", async () => {
    const fetchSpy = vi.fn(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "timeout" });
    // timeout is transient → retry fires → 2 total attempts
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("quota exceeded → NO fetch, kind: quota_exceeded", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(false, 201),
    });
    expect(out).toEqual({ kind: "quota_exceeded" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OPENAI_API_KEY missing → disabled, NO fetch, NO reserve", async () => {
    const reserveSpy = mkReserve(true);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    // Build env without OPENAI_API_KEY (exactOptionalPropertyTypes forbids
    // assigning `undefined` to an optional field — omission is distinct).
    const { OPENAI_API_KEY: _omit, ...envNoKey } = makeEnv();
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: envNoKey,
      userId: USER,
      reserve: reserveSpy,
    });
    expect(out).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reserveSpy).not.toHaveBeenCalled();
  });

  it("empty categories → disabled, NO fetch, NO reserve", async () => {
    const reserveSpy = mkReserve(true);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: reserveSpy,
    });
    expect(out).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reserveSpy).not.toHaveBeenCalled();
  });

  it("unknown error (non-TypeError, non-TimeoutError, allowlist-unmatched) → 1 retry then fetch_failed, warn logs err.name only", async () => {
    // §5.3 review M7 + sync-reliability #03: operators need a signal when
    // this path trips, but err.message may embed request bodies or PII, so
    // only err.name is logged (no allowlist classification for unmatched
    // messages). Unmatched unknowns are treated as connection-level
    // transients (PRD "Mode B") — retried once within MAX_ATTEMPTS=2.
    // consoleSpies index 2 is the `warn` spy (see beforeEach ordering).
    const warnSpy = consoleSpies[2]!;
    class WeirdError extends Error {
      override name = "WeirdError";
    }
    const fetchSpy = vi.fn(async () => {
      throw new WeirdError("request body leak: 매우비밀회의 password=hunter2");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "매우비밀회의", description: "password=hunter2" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out).toEqual({ kind: "fetch_failed" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const nameLogs = warnSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("WeirdError")),
    );
    expect(nameLogs.length).toBeGreaterThanOrEqual(1);
    // Unmatched message → no allowlist classification parenthetical.
    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        if (typeof arg === "string") {
          expect(arg).not.toContain("subrequest_cap");
          expect(arg).not.toContain("network_lost");
        }
      }
    }
    // … and never the message content or event PII.
    assertNoPiiLogged(["매우비밀회의", "password=hunter2", "hunter2", "request body leak"]);
  });

  it("unknown error then success on retry → hit (Mode B transient rescued)", async () => {
    let n = 0;
    const fetchSpy = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("connection reset mid-flight");
      return openAiJson("회의");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out, record: r } = await classifyWithLlm(
      ev({ summary: "x" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out.kind).toBe("hit");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r.attempts).toBe(2);
  });

  it("'Too many subrequests' → fetch_failed(subrequest_cap), NO retry, warn carries classification not the message", async () => {
    // Workers Free subrequest cap (PRD sync-reliability): the budget is
    // exhausted for the entire invocation, so a retry fails instantly —
    // fetch fires exactly once. The warn line carries the allowlist
    // classification name so operators can diagnose from `wrangler tail`,
    // but never the raw err.message.
    const warnSpy = consoleSpies[2]!;
    const fetchSpy = vi.fn(async () => {
      throw new Error("Too many subrequests by single Worker invocation.");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out, record: r } = await classifyWithLlm(
      ev({ summary: "x" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out).toEqual({ kind: "fetch_failed", classification: "subrequest_cap" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("fetch_failed");
    expect(r.attempts).toBe(1);
    const capLogs = warnSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes("unknown error: Error (subrequest_cap)"),
      ),
    );
    expect(capLogs).toHaveLength(1);
    // The raw runtime message must not reach the log stream.
    assertNoPiiLogged(["Too many subrequests by single Worker invocation."]);
  });

  it("'Network connection lost' → fetch_failed(network_lost), 1 retry, warn carries classification", async () => {
    const warnSpy = consoleSpies[2]!;
    const fetchSpy = vi.fn(async () => {
      throw new Error("Network connection lost.");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(out).toEqual({ kind: "fetch_failed", classification: "network_lost" });
    // Connection-level transient → retried once (MAX_ATTEMPTS=2).
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const lostLogs = warnSpy.mock.calls.filter((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("(network_lost)"),
      ),
    );
    expect(lostLogs.length).toBeGreaterThanOrEqual(1);
    assertNoPiiLogged(["Network connection lost."]);
  });

  it("SECURITY CONTRACT — err.message never reaches the log stream, matched or not", async () => {
    // Pin for sync-reliability #03 AC: the allowlist matcher reads
    // err.message for matching only; no code path may emit the message
    // text itself. Exercise both a matched (allowlist) and an unmatched
    // message carrying PII-looking payloads.
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n += 1;
      throw new Error(
        n === 1
          ? "Too many subrequests by single Worker invocation. secret=매우비밀 token=abc123"
          : "totally novel failure secret=매우비밀 token=abc123",
      );
    }) as unknown as typeof fetch;
    await classifyWithLlm(ev({ summary: "x" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    // Second run hits the unmatched branch (fresh call, budget mock differs).
    await classifyWithLlm(ev({ summary: "y" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    assertNoPiiLogged([
      "secret=매우비밀",
      "token=abc123",
      "totally novel failure",
      "Too many subrequests by single Worker invocation. secret",
    ]);
  });

  it("fetch_failed record: rawResponse undefined, promptSummary captured pre-fetch", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("some thrown fetch failure");
    }) as unknown as typeof fetch;
    const { record: r } = await classifyWithLlm(
      ev({ id: "e-ff", summary: "x" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(r.outcome).toBe("fetch_failed");
    // No HTTP body was ever received — this is what separates fetch_failed
    // from bad_response in `llm_calls` (raw_response IS NULL by shape).
    expect(r.rawResponse).toBeUndefined();
    expect(r.promptSummary).toBeDefined();
    expect(r.eventId).toBe("e-ff");
    expect(r.availableCategories).toEqual(["회의"]);
    expect(r.attempts).toBe(2);
  });

  it("request body sets max_completion_tokens: 64 (response-side cost cap)", async () => {
    // Cost guardrail: structured-output schema gives us a tiny JSON object,
    // but reasoning-token overruns or model regressions could still inflate
    // response size. The completion cap turns the worst-case cost-per-call
    // into a bounded constant.
    const fetchSpy = vi.fn(async (_url: unknown, _init?: unknown) =>
      openAiJson("회의"),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await classifyWithLlm(ev({ summary: "x" }), [cat({ name: "회의" })], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(64);
    // Sanity: the rest of the payload is intact.
    expect(body.model).toBeTypeOf("string");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("does NOT log event content on any failure path", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("server error body with secrets", { status: 500 }),
    ) as unknown as typeof fetch;
    await classifyWithLlm(
      ev({ summary: "매우비밀회의", description: "password=hunter2" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    assertNoPiiLogged(["매우비밀회의", "password=hunter2", "hunter2", "server error body"]);
  });

  // §5.3 semantic matching — mocked outcome, deterministic. These verify the
  // wiring stays correct (categoryId mapping, miss/hit shapes) for the four
  // user-report cases. Whether the real model actually returns these names
  // for these prompts is the job of `evals/scripts/run-classification-eval.ts`.

  it("hypernym: Meal category + Breakfast event → hit (user-report case)", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("Meal")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "Breakfast with mom" }),
      [cat({ name: "Meal", keywords: ["Meal", "식사"] })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out).toEqual({
      kind: "hit",
      rule: { id: "c-1", name: "Meal", colorId: "9", labelId: null },
      categoryName: "Meal",
    });
  });

  it("hypernym: Meal category + Lunch event → hit (user-report case)", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("Meal")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "Lunch on Wednesday" }),
      [cat({ name: "Meal", keywords: ["Meal"] })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") expect(out.categoryName).toBe("Meal");
  });

  it("morphology+paraphrase: Move category + 'Getting ready to go out' → hit (user-report case)", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("Move")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "Getting ready to go out" }),
      [cat({ name: "Move", keywords: ["Get ready", "move"] })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") expect(out.categoryName).toBe("Move");
  });

  it("cross-lingual ko→en: Meal category + 아침식사 event → hit", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("Meal")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "아침식사 약속" }),
      [cat({ name: "Meal", keywords: ["Meal"] })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out.kind).toBe("hit");
  });

  it("cross-lingual en→ko: 식사 category + Breakfast event → hit", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("식사")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "Breakfast" }),
      [cat({ name: "식사", keywords: ["식사"] })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") expect(out.categoryName).toBe("식사");
  });

  it("anti-overstretch: Meal category + 'Team Meeting' event → miss when model says 'none' (user-report case)", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("none")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "Team Meeting tomorrow" }),
      [cat({ name: "Meal", keywords: ["Meal"] })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out).toEqual({ kind: "miss" });
  });

  it("priority-first: tie between Meeting and Meal → hit on first listed (Meeting)", async () => {
    // The chain delivers categories sorted by (priority ASC, created_at ASC),
    // and the prompt instructs the model to prefer the first listed when two
    // are equally good. This pins the wiring; whether the real model actually
    // picks the first listed is verified by the offline eval suite.
    globalThis.fetch = vi.fn(async () => openAiJson("Meeting")) as unknown as typeof fetch;
    const { outcome: out } = await classifyWithLlm(
      ev({ summary: "Lunch meeting with the design team" }),
      [
        cat({ id: "c-1", name: "Meeting", keywords: ["meeting"], priority: 100 }),
        cat({ id: "c-2", name: "Meal", keywords: ["meal"], priority: 200 }),
      ],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") expect(out.rule.id).toBe("c-1");
  });
});

// §6.3 후속 — debugging surface fields on `LlmCallRecord`. Every outcome
// branch is exercised once so a future edit that forgets to populate (or
// wrongly populates) one of {eventId, promptSummary, rawResponse,
// availableCategories} fails a test instead of silently writing
// incomplete rows. The existing tests above cover outcome+latency+attempts
// invariants; this suite is purely about the new columns.
describe("classifyWithLlm — §6.3 debugging fields", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mkReserve(ok: boolean, count = 1): ReserveLlmCallFn {
    return vi.fn(async () => ({ ok, count }));
  }

  function openAiText(content: string): Response {
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  it("hit: populates eventId / promptSummary / rawResponse / availableCategories + categoryName", async () => {
    globalThis.fetch = vi.fn(async () =>
      openAiText(JSON.stringify({ category_name: "회의" })),
    ) as unknown as typeof fetch;
    const { record: r } = await classifyWithLlm(
      ev({ id: "evt-42", summary: "팀 회의" }),
      [cat({ name: "회의" }), cat({ id: "c-2", name: "개인" })],
      {
        db: {} as never,
        env: makeEnv(),
        userId: USER,
        reserve: mkReserve(true),
      },
    );
    expect(r.outcome).toBe("hit");
    expect(r.categoryName).toBe("회의");
    expect(r.eventId).toBe("evt-42");
    expect(r.promptSummary).toBeDefined();
    expect(r.promptSummary).toContain("팀 회의");
    expect(r.rawResponse).toBeDefined();
    expect(r.rawResponse).toContain("category_name");
    expect(r.availableCategories).toEqual(["회의", "개인"]);
  });

  it("miss: rawResponse populated, categoryName undefined", async () => {
    globalThis.fetch = vi.fn(async () =>
      openAiText(JSON.stringify({ category_name: "none" })),
    ) as unknown as typeof fetch;
    const { record: r } = await classifyWithLlm(ev({ id: "e1" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(r.outcome).toBe("miss");
    expect(r.categoryName).toBeUndefined();
    expect(r.rawResponse).toContain("none");
    expect(r.availableCategories).toEqual(["회의"]);
    expect(r.promptSummary).toBeDefined();
  });

  it("bad_response: malformed body still recorded into rawResponse", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "not-json" } }] }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const { record: r } = await classifyWithLlm(ev({ id: "e1" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(r.outcome).toBe("bad_response");
    expect(r.rawResponse).toContain("not-json");
    expect(r.promptSummary).toBeDefined();
  });

  it("http_error: 4xx body captured in rawResponse, promptSummary captured pre-fetch", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("invalid request payload", { status: 400 }),
    ) as unknown as typeof fetch;
    const { record: r } = await classifyWithLlm(
      ev({ id: "e1", summary: "x" }),
      [cat()],
      {
        db: {} as never,
        env: makeEnv(),
        userId: USER,
        reserve: mkReserve(true),
      },
    );
    expect(r.outcome).toBe("http_error");
    expect(r.httpStatus).toBe(400);
    expect(r.rawResponse).toBe("invalid request payload");
    expect(r.promptSummary).toBeDefined();
    expect(r.availableCategories).toEqual(["회의"]);
  });

  it("timeout: rawResponse undefined (no body received)", async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;
    const { record: r } = await classifyWithLlm(ev({ id: "e1" }), [cat()], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(r.outcome).toBe("timeout");
    expect(r.rawResponse).toBeUndefined();
    // promptSummary is captured pre-fetch, so it survives the timeout.
    expect(r.promptSummary).toBeDefined();
    expect(r.availableCategories).toEqual(["회의"]);
  });

  it("quota_exceeded: NO promptSummary, NO rawResponse — but availableCategories present", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { record: r } = await classifyWithLlm(
      ev({ id: "e1" }),
      [cat({ name: "회의" })],
      {
        db: {} as never,
        env: makeEnv(),
        userId: USER,
        reserve: mkReserve(false, 201),
      },
    );
    expect(r.outcome).toBe("quota_exceeded");
    expect(r.promptSummary).toBeUndefined();
    expect(r.rawResponse).toBeUndefined();
    expect(r.availableCategories).toEqual(["회의"]);
    expect(r.eventId).toBe("e1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("disabled (no API key): promptSummary / rawResponse / availableCategories all undefined", async () => {
    const { OPENAI_API_KEY: _omit, ...envNoKey } = makeEnv();
    const { record: r } = await classifyWithLlm(ev({ id: "e1" }), [cat()], {
      db: {} as never,
      env: envNoKey,
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(r.outcome).toBe("disabled");
    expect(r.promptSummary).toBeUndefined();
    expect(r.rawResponse).toBeUndefined();
    expect(r.availableCategories).toBeUndefined();
    expect(r.eventId).toBe("e1");
  });

  it("disabled (zero categories): all debug fields undefined", async () => {
    const { record: r } = await classifyWithLlm(ev({ id: "e1" }), [], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(r.outcome).toBe("disabled");
    expect(r.promptSummary).toBeUndefined();
    expect(r.rawResponse).toBeUndefined();
    expect(r.availableCategories).toBeUndefined();
  });

  it("availableCategories reflects post-slice cap (50 of 60 owned)", async () => {
    globalThis.fetch = vi.fn(async () =>
      openAiText(JSON.stringify({ category_name: "cat-0" })),
    ) as unknown as typeof fetch;
    const cats = Array.from({ length: 60 }, (_, i) =>
      cat({ id: `c-${i}`, name: `cat-${i}` }),
    );
    const { record: r } = await classifyWithLlm(ev({ id: "e1" }), cats, {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: mkReserve(true),
    });
    expect(r.availableCategories).toHaveLength(50);
    expect(r.availableCategories?.[0]).toBe("cat-0");
    expect(r.availableCategories?.[49]).toBe("cat-49");
    expect(r.categoryCount).toBe(50);
  });
});

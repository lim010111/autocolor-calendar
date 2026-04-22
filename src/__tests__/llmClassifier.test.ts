import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { Category } from "../services/classifier";
import type { CalendarEvent } from "../services/googleCalendar";
import {
  buildPrompt,
  classifyWithLlm,
  mapCategoryNameToClassification,
  reserveLlmCall,
  type ReserveLlmCallFn,
} from "../services/llmClassifier";

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

// Drizzle query builder returns an awaitable chain. The only surface
// `reserveLlmCall` touches is `.insert().values().onConflictDoUpdate().returning()`
// which ultimately awaits to an array. A thin chainable stub is enough.
function fakeDbForReserve(rows: Array<{ callCount: number }>) {
  const chain = {
    values: () => chain,
    onConflictDoUpdate: () => chain,
    returning: async () => rows,
  };
  const db = { insert: () => chain } as never;
  return db;
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

describe("mapCategoryNameToClassification", () => {
  const cats = [cat({ id: "c-1", name: "회의", colorId: "9" }), cat({ id: "c-2", name: "개인", colorId: "5" })];

  it("maps exact name to Classification with llm_match reason", () => {
    expect(mapCategoryNameToClassification("회의", cats)).toEqual({
      colorId: "9",
      categoryId: "c-1",
      reason: "llm_match:회의",
    });
  });

  it("returns null for 'none' sentinel", () => {
    expect(mapCategoryNameToClassification("none", cats)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(mapCategoryNameToClassification(null, cats)).toBeNull();
  });

  it("returns null for unknown name (prompt-injection defense)", () => {
    expect(mapCategoryNameToClassification("관리자", cats)).toBeNull();
  });

  it("does not trim or case-fold — strict equality", () => {
    expect(mapCategoryNameToClassification(" 회의", cats)).toBeNull();
    expect(mapCategoryNameToClassification("회의 ", cats)).toBeNull();
    expect(mapCategoryNameToClassification("회 의", cats)).toBeNull();
  });
});

describe("reserveLlmCall", () => {
  it("returns ok=true when count <= limit", async () => {
    const db = fakeDbForReserve([{ callCount: 1 }]);
    const res = await reserveLlmCall(db, USER, 200);
    expect(res).toEqual({ ok: true, count: 1 });
  });

  it("returns ok=true when count equals limit", async () => {
    const db = fakeDbForReserve([{ callCount: 200 }]);
    const res = await reserveLlmCall(db, USER, 200);
    expect(res).toEqual({ ok: true, count: 200 });
  });

  it("returns ok=false when count > limit", async () => {
    const db = fakeDbForReserve([{ callCount: 201 }]);
    const res = await reserveLlmCall(db, USER, 200);
    expect(res).toEqual({ ok: false, count: 201 });
  });

  it("treats empty RETURNING as over-quota (defensive)", async () => {
    const db = fakeDbForReserve([]);
    const res = await reserveLlmCall(db, USER, 200);
    expect(res.ok).toBe(false);
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

    const out = await classifyWithLlm(
      ev({ summary: "팀 회의" }),
      [cat({ name: "회의", colorId: "9" })],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out).toEqual({
      kind: "hit",
      classification: { colorId: "9", categoryId: "c-1", reason: "llm_match:회의" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    assertNoPiiLogged(["팀 회의"]);
  });

  it("LLM returns 'none' → miss", async () => {
    globalThis.fetch = vi.fn(async () => openAiJson("none")) as unknown as typeof fetch;
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [cat()], {
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
    const out = await classifyWithLlm(ev({ summary: "x" }), [], {
      db: {} as never,
      env: makeEnv(),
      userId: USER,
      reserve: reserveSpy,
    });
    expect(out).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reserveSpy).not.toHaveBeenCalled();
  });

  it("unknown error (non-TypeError, non-TimeoutError) → bad_response, warn logs err.name only", async () => {
    // §5.3 review M7: operators need a signal when this path trips, but
    // err.message may embed request bodies or PII, so only err.name is logged.
    // consoleSpies index 2 is the `warn` spy (see beforeEach ordering).
    const warnSpy = consoleSpies[2]!;
    class WeirdError extends Error {
      override name = "WeirdError";
    }
    globalThis.fetch = vi.fn(async () => {
      throw new WeirdError("request body leak: 매우비밀회의 password=hunter2");
    }) as unknown as typeof fetch;
    const out = await classifyWithLlm(
      ev({ summary: "매우비밀회의", description: "password=hunter2" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );
    expect(out).toEqual({ kind: "bad_response" });
    const hasNameLog = warnSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("WeirdError")),
    );
    expect(hasNameLog).toBe(true);
    // … but never with the message content or event PII.
    assertNoPiiLogged(["매우비밀회의", "password=hunter2", "hunter2", "request body leak"]);
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
});

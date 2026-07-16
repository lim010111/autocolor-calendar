import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { CalendarEvent } from "../services/googleCalendar";
import { classifyWithLlm, type ReserveLlmCallFn } from "../services/llmClassifier";
import { redactEventForLlm, type RedactedEvent } from "../services/piiRedactor";
import type { Rule } from "../services/ruleService";
import { synthesizeSeeds } from "../services/ruleService";

// Adversarial repro for merge-gate finding: "Subrequest-cap errors during
// quota reservation bypass the latch."
//
// `reserveLlmCall` performs DB writes (TCP subrequests on Workers) BEFORE the
// OpenAI fetch. At HEAD, `const reservation = await reserve(...)` sits
// OUTSIDE the fetch retry loop's try/catch, so a "Too many subrequests"
// thrown at the reservation point propagates out of `classifyWithLlm`
// instead of being folded into `fetch_failed(subrequest_cap)` the way the
// same error thrown from the fetch itself is (llmClassifier.ts catch arm).
//
// Expected (finding-fixed) behavior asserted here:
//   1. classifyWithLlm RESOLVES (no throw escapes),
//   2. outcome is fetch_failed with classification "subrequest_cap"
//      (so classifierChain sets capLatched and skips remaining LLM legs),
//   3. an LlmCallRecord is still emitted via finish() (llm_calls row),
//   4. the OpenAI fetch is never attempted.
//
// At HEAD this test FAILS at the first await: the injected reserve throw
// rejects the classifyWithLlm promise.

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

function ev(partial: Partial<CalendarEvent> = {}): RedactedEvent {
  const raw: CalendarEvent = { id: partial.id ?? "e-1", ...partial };
  return redactEventForLlm(raw);
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

describe("finding repro — subrequest cap thrown at quota reservation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reserve throwing 'Too many subrequests' folds to fetch_failed(subrequest_cap) + record, no throw", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const throwingReserve: ReserveLlmCallFn = vi.fn(async () => {
      throw new Error("Too many subrequests.");
    });

    // At HEAD this await REJECTS — the reservation-point throw escapes
    // classifyWithLlm — which fails the test before any assertion runs.
    const { outcome, record } = await classifyWithLlm(
      ev({ summary: "x" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: throwingReserve },
    );

    // (1)+(2) chain latch signal: fetch_failed classified subrequest_cap.
    expect(outcome).toEqual({
      kind: "fetch_failed",
      classification: "subrequest_cap",
    });
    // (3) finish() still emitted the llm_calls record for this event.
    expect(record.outcome).toBe("fetch_failed");
    expect(record.eventId).toBe("e-1");
    // (4) the OpenAI fetch was never attempted — budget already exhausted.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

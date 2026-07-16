// Merge-gate finding #1 adversarial repro (sync-reliability #03).
//
// Claim under test: the `err instanceof TypeError` branch in
// `classifyWithLlm`'s catch block runs BEFORE the infra-error allowlist
// (`classifyInfraError`), so a Workers-runtime network failure — which the
// runtime throws as `TypeError: Network connection lost.` (the source's own
// comment says "Workers runtime wraps network failures as TypeError") — is
// recorded as `http_error(status 0)` instead of
// `fetch_failed(network_lost)`. Consequences asserted here:
//   1. the allowlist's `network_lost` classification must fire (issue #03 AC:
//      "unknown-error warn이 allowlist 분류를 포함한다"),
//   2. telemetry must land as outcome `fetch_failed` so `llm_calls` /
//      `/api/stats` fetch_failed filters see TypeError-shaped network
//      failures (AC: thrown-fetch 실패가 bad_response와 구분 가능),
//   3. the retry-once contract (MAX_ATTEMPTS=2) is preserved.
//
// This file mirrors the existing `llmClassifier.test.ts` case
// "'Network connection lost' → fetch_failed(network_lost), 1 retry, warn
// carries classification" — the ONLY delta is throwing `new TypeError(...)`
// (the production shape) instead of `new Error(...)`. On HEAD this test
// FAILS (outcome is `http_error` status 0, no warn emitted), proving the
// finding; the plain-Error sibling passing while this fails is the mask.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { CalendarEvent } from "../services/googleCalendar";
import { classifyWithLlm, type ReserveLlmCallFn } from "../services/llmClassifier";
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

describe("finding #1 repro — TypeError-shaped network failure", () => {
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
        const joined = call
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" ");
        for (const needle of pii) {
          expect(joined).not.toContain(needle);
        }
      }
    }
  }

  function mkReserve(ok: boolean, count = 1): ReserveLlmCallFn {
    return vi.fn(async () => ({ ok, count }));
  }

  it("TypeError('Network connection lost') → fetch_failed(network_lost), 1 retry, warn carries classification", async () => {
    // Production shape: the Workers runtime throws network failures as
    // TypeError (per the catch block's own comment). The existing suite
    // only exercises `new Error(...)` for this message.
    const warnSpy = consoleSpies[2]!;
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Network connection lost.");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { outcome: out, record: r } = await classifyWithLlm(
      ev({ id: "e-tnl", summary: "x" }),
      [cat()],
      { db: {} as never, env: makeEnv(), userId: USER, reserve: mkReserve(true) },
    );

    // (2) Telemetry: must be the thrown-fetch outcome, not http_error(0) —
    // otherwise `llm_calls.outcome='fetch_failed'` filters and the
    // `/api/stats` fetch_failed counter miss every TypeError-shaped
    // network failure.
    expect(out).toEqual({ kind: "fetch_failed", classification: "network_lost" });
    expect(r.outcome).toBe("fetch_failed");
    expect(r.httpStatus).toBeUndefined();

    // (3) Retry-once contract preserved: connection-level transient →
    // retried within MAX_ATTEMPTS=2.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r.attempts).toBe(2);

    // (1) Issue #03 AC: the unknown-error warn includes the allowlist
    // classification. On HEAD the TypeError branch returns before any
    // warn is emitted, so no `(network_lost)` line exists.
    const lostLogs = warnSpy.mock.calls.filter((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("(network_lost)"),
      ),
    );
    expect(lostLogs.length).toBeGreaterThanOrEqual(1);

    // SECURITY CONTRACT stays intact either way: the raw runtime message
    // must never reach the log stream.
    assertNoPiiLogged(["Network connection lost."]);
  });
});

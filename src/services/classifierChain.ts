import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Bindings } from "../env";
import { classifyEvent as ruleClassify } from "./classifier";
import type {
  ClassificationOutcome,
  ClassifyEventFn,
} from "./classifierOutcomes";
import { runSinks, type Sink } from "./classifierSinks";
import {
  classifyWithLlm,
  LLM_PROMPT_MAX_CATEGORIES,
  type LlmCallRecord,
  type ReserveLlmCallFn,
} from "./llmClassifier";

// §5.3 chain composition: rule → LLM fallback → ClassificationOutcome.
//
// Contract:
// - Runs `ruleClassify` first. A hit short-circuits (LLM never called) and
//   emits a `ruleHit` outcome.
// - On rule-miss, if `env.OPENAI_API_KEY` is present AND the user has at
//   least one category, delegates to `classifyWithLlm` and maps the LLM
//   outcome to the matching `ClassificationOutcome` case
//   (`llmHit` / `llmTimeout` / `llmQuotaExceeded` / `llmBadResponse`).
// - All other paths emit `noMatch`. There is no fall-through to rule-based
//   logic on the LLM leg (Halt on Failure).
// - Sink emission: every emitted outcome is passed to all configured sinks
//   in parallel via `runSinks`. Sink failures are warn-only — they do NOT
//   fail classify (§6 observability discipline).
// - Per-run quota latch: once `quota_exceeded` fires for any event in the
//   current `buildDefaultClassifier` closure, every subsequent rule-miss
//   event skips the LLM leg (including `reserveLlmCall`) for the rest of
//   this sync run. This prevents an N-event rule-miss burst after quota
//   exhaustion from producing N wasted `llm_usage_daily` UPSERTs. A new
//   sync run mints a fresh closure, so the next run re-probes quota once.

export type ChainDeps = {
  db: PostgresJsDatabase;
  env: Bindings;
  userId: string;
  // Sinks receive every emitted outcome in parallel. Composition is the
  // caller's responsibility (see calendarSync wiring for the sync path
  // and routes/classify.ts for the preview path).
  sinks: ReadonlyArray<Sink>;
  // Test-only: inject a custom reserve fn to bypass the real drizzle writer.
  reserve?: ReserveLlmCallFn;
};

export function buildDefaultClassifier(deps: ChainDeps): ClassifyEventFn {
  let quotaLatched = false;

  return async (event, ctx) => {
    // Stage 1: substring matcher.
    const hit = await ruleClassify(event, ctx);
    if (hit) {
      const outcome: ClassificationOutcome = {
        kind: "ruleHit",
        rule: hit.rule,
        matchedKeyword: hit.matchedKeyword,
      };
      await runSinks(outcome, deps.sinks);
      return outcome;
    }

    // Skips that never engage the LLM leg.
    if (!deps.env.OPENAI_API_KEY || ctx.categories.length === 0) {
      const outcome: ClassificationOutcome = { kind: "noMatch" };
      await runSinks(outcome, deps.sinks);
      return outcome;
    }

    // Quota-latched short-circuit — synthesize an LlmCallRecord so the §6.3
    // debugging row shape stays consistent with the non-latched path.
    // `promptSummary` and `rawResponse` stay undefined because no prompt
    // was built and no response was received.
    if (quotaLatched) {
      const record: LlmCallRecord = {
        outcome: "quota_exceeded",
        latencyMs: 0,
        categoryCount: Math.min(LLM_PROMPT_MAX_CATEGORIES, ctx.categories.length),
        attempts: 0,
        eventId: event.id,
        availableCategories: ctx.categories
          .slice(0, LLM_PROMPT_MAX_CATEGORIES)
          .map((c) => c.name),
      };
      const outcome: ClassificationOutcome = {
        kind: "llmQuotaExceeded",
        llmRecord: record,
      };
      await runSinks(outcome, deps.sinks);
      return outcome;
    }

    // LLM leg.
    const { outcome: llmOut, record } = await classifyWithLlm(
      event,
      ctx.categories,
      {
        db: deps.db,
        env: deps.env,
        userId: deps.userId,
        ...(deps.reserve !== undefined ? { reserve: deps.reserve } : {}),
      },
    );

    let outcome: ClassificationOutcome;
    switch (llmOut.kind) {
      case "hit":
        outcome = { kind: "llmHit", rule: llmOut.rule, llmRecord: record };
        break;
      case "timeout":
        outcome = { kind: "llmTimeout", llmRecord: record };
        break;
      case "quota_exceeded":
        quotaLatched = true;
        outcome = { kind: "llmQuotaExceeded", llmRecord: record };
        break;
      // `disabled` is unreachable here because the explicit
      // `!OPENAI_API_KEY || ctx.categories.length === 0` guard above already
      // short-circuited. Keep the arm defensive (fold to `llmBadResponse`)
      // so future refactors that reorder the guards don't drop a row.
      case "miss":
      case "http_error":
      case "bad_response":
      case "disabled":
        outcome = { kind: "llmBadResponse", llmRecord: record };
        break;
    }
    await runSinks(outcome, deps.sinks);
    return outcome;
  };
}

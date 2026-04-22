import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Bindings } from "../env";
import type { ClassifyEventFn } from "./classifier";
import { classifyEvent as ruleClassify } from "./classifier";
import { classifyWithLlm, type LlmOutcome, type ReserveLlmCallFn } from "./llmClassifier";

// §5.3 chain composition: rule → LLM fallback → null.
//
// Contract:
// - Runs `ruleClassify` first. A hit short-circuits (LLM never called).
// - On rule-miss, if `env.OPENAI_API_KEY` is present AND the user has at
//   least one category, delegates to `classifyWithLlm`.
// - Any LLM outcome other than "hit" collapses to null; the chain stays
//   silent and `calendarSync.processEvent` bumps `summary.no_match`.
// - Counter callbacks are narrow and optional — the chain never reaches into
//   SyncSummary directly, which keeps it testable and reusable.
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
  onLlmAttempted?: () => void;
  onLlmSucceeded?: () => void;
  onLlmTimeout?: () => void;
  onLlmQuotaExceeded?: () => void;
  // Test-only: inject a custom reserve fn to bypass the real drizzle writer.
  reserve?: ReserveLlmCallFn;
};

export function buildDefaultClassifier(deps: ChainDeps): ClassifyEventFn {
  let quotaLatched = false;

  return async (event, ctx) => {
    const ruleHit = await ruleClassify(event, ctx);
    if (ruleHit) return ruleHit;

    if (!deps.env.OPENAI_API_KEY) return null;
    if (ctx.categories.length === 0) return null;
    if (quotaLatched) {
      // Quota already confirmed exhausted earlier in this run — skip both
      // the LLM fetch and the `reserveLlmCall` UPSERT. Still count the
      // event so the summary reflects that the chain wanted to call LLM.
      deps.onLlmAttempted?.();
      deps.onLlmQuotaExceeded?.();
      return null;
    }

    deps.onLlmAttempted?.();
    const outcome: LlmOutcome = await classifyWithLlm(event, ctx.categories, {
      db: deps.db,
      env: deps.env,
      userId: deps.userId,
      ...(deps.reserve !== undefined ? { reserve: deps.reserve } : {}),
    });

    switch (outcome.kind) {
      case "hit":
        deps.onLlmSucceeded?.();
        return outcome.classification;
      case "timeout":
        deps.onLlmTimeout?.();
        return null;
      case "quota_exceeded":
        quotaLatched = true;
        deps.onLlmQuotaExceeded?.();
        return null;
      case "miss":
      case "http_error":
      case "bad_response":
      case "disabled":
        return null;
    }
  };
}

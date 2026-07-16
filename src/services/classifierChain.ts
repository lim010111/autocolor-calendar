import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Bindings } from "../env";
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
import { redactEventForLlm } from "./piiRedactor";
import { classifyStage1, type Stage1Deps } from "./stage1";

// §5.3 chain composition (ADR-0004): embedding kNN → LLM fallback →
// ClassificationOutcome.
//
// Contract:
// - Runs `classifyStage1` first (Stage 1 = embedding kNN). An `embeddingHit`
//   short-circuits (LLM never called) and is emitted directly. `embeddingMiss`
//   / `ambiguous` fall through to the LLM leg (Stage 1 does not guess).
// - On Stage-1 non-hit, if `env.OPENAI_API_KEY` is present AND the user has at
//   least one category, delegates to `classifyWithLlm` and maps the LLM
//   outcome to the matching `ClassificationOutcome` case
//   (`llmHit` / `llmTimeout` / `llmQuotaExceeded` / `llmBadResponse`). When the
//   LLM leg is unavailable, the Stage-1 `embeddingMiss` / `ambiguous` outcome
//   is emitted directly (both fold to `no_match` in the sinks).
// - When `deps.stage1` is absent (no Workers-AI embedder resolvable), Stage 1
//   is skipped and every event degrades straight to the LLM gate — the
//   systemic-embedding-failure blast radius (#02 AC #9), bounded by the
//   two-tier daily caps.
// - Sink emission: every emitted outcome is passed to all configured sinks in
//   parallel via `runSinks`. Sink failures are warn-only (§6 observability).
// - Per-run quota latch: once `quota_exceeded` fires for any event in the
//   current closure, every subsequent Stage-1-miss event skips the LLM leg
//   (including `reserveLlmCall`) for the rest of this sync run. A new sync run
//   mints a fresh closure, so the next run re-probes quota once.
// - Per-run cap latch (sync-reliability #03): once `classifyWithLlm` reports a
//   `fetch_failed` classified as `subrequest_cap` (Workers Free 50-subrequest
//   cap), every subsequent Stage-1-miss event skips the LLM leg — including
//   `reserveLlmCall`, so exhausted-budget calls stop burning daily quota.
//   Mirror of the quota latch above; a new invocation re-probes.

export type ChainDeps = {
  db: PostgresJsDatabase;
  env: Bindings;
  userId: string;
  // Sinks receive every emitted outcome in parallel. Composition is the
  // caller's responsibility (see calendarSync wiring for the sync path and
  // routes/classify.ts for the preview path).
  sinks: ReadonlyArray<Sink>;
  // ADR-0004 #02 — Stage 1 embedding kNN dependencies. Optional so a chain can
  // be built without an embedder (degrades to LLM-only). Production callers
  // (sync / preview) always provide it when `env.AI` is bound.
  stage1?: Stage1Deps;
  // Test-only: inject a custom reserve fn to bypass the real drizzle writer.
  reserve?: ReserveLlmCallFn;
};

export function buildDefaultClassifier(deps: ChainDeps): ClassifyEventFn {
  let quotaLatched = false;
  let capLatched = false;

  return async (event, ctx) => {
    // Stage 1: embedding kNN. An `embeddingHit` short-circuits. When no
    // embedder is wired (`deps.stage1` absent), Stage 1 never ran, so the
    // fall-through outcome is `noMatch` (nothing was classified), not
    // `embeddingMiss` (Stage 1 ran and found nothing above threshold).
    let stage1: ClassificationOutcome = { kind: "noMatch" };
    if (deps.stage1) {
      stage1 = await classifyStage1(event, ctx, deps.stage1);
      if (stage1.kind === "embeddingHit") {
        await runSinks(stage1, deps.sinks);
        return stage1;
      }
    }

    // Stage-2 gate. No LLM available → emit the Stage-1 outcome
    // (`embeddingMiss` / `ambiguous` / `noMatch` all fold to `no_match` in the
    // sinks).
    if (!deps.env.OPENAI_API_KEY || ctx.categories.length === 0) {
      await runSinks(stage1, deps.sinks);
      return stage1;
    }

    // Quota-latched short-circuit — synthesize an LlmCallRecord so the §6.3
    // debugging row shape stays consistent with the non-latched path.
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

    // Cap-latched short-circuit — the subrequest budget is exhausted for the
    // whole invocation, so a fetch cannot succeed. Skip the LLM leg entirely,
    // including `reserveLlmCall` (quota must not be burned on calls that
    // cannot fire). Synthetic record mirrors the quota-latched path:
    // attempts:0 / latencyMs:0 distinguishes the skip from an actual thrown
    // fetch (attempts >= 1) in `llm_calls`.
    if (capLatched) {
      const record: LlmCallRecord = {
        outcome: "fetch_failed",
        latencyMs: 0,
        categoryCount: Math.min(LLM_PROMPT_MAX_CATEGORIES, ctx.categories.length),
        attempts: 0,
        eventId: event.id,
        availableCategories: ctx.categories
          .slice(0, LLM_PROMPT_MAX_CATEGORIES)
          .map((c) => c.name),
      };
      const outcome: ClassificationOutcome = {
        kind: "llmBadResponse",
        llmRecord: record,
      };
      await runSinks(outcome, deps.sinks);
      return outcome;
    }

    // LLM leg. §5.2 branded contract — redact before crossing into the LLM
    // module. `classifyWithLlm` accepts only `RedactedEvent`; the redactor is
    // idempotent so output bytes are unchanged.
    const redactedEvent = redactEventForLlm(event);
    const { outcome: llmOut, record } = await classifyWithLlm(
      redactedEvent,
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
      // Thrown-fetch failure. A `subrequest_cap` classification engages the
      // cap latch (see short-circuit above); the ClassificationOutcome fold
      // stays `llmBadResponse` — same silent-no_match behavior as before,
      // the per-call `llm_calls.outcome='fetch_failed'` row carries the
      // telemetry distinction.
      case "fetch_failed":
        if (llmOut.classification === "subrequest_cap") capLatched = true;
        outcome = { kind: "llmBadResponse", llmRecord: record };
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

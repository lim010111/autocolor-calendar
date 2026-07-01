import type { SyncSummary } from "./calendarSync";
import type { ClassificationOutcome } from "./classifierOutcomes";
import type { LlmCallRecord } from "./llmClassifier";

// §5.3 classifier sink contract. A sink receives every outcome emitted by
// the chain and decides what to do with it (mutate a counter bag, push to a
// buffer, etc.). Sink failures are warn-only inside `runSinks` — they must
// NEVER fail the classify call (`src/CLAUDE.md` "Observability writes must
// NEVER cause retry").
export type Sink = (outcome: ClassificationOutcome) => Promise<void>;

// Counter map: see SyncSummary lifecycle counters note in CLAUDE.md §6.
// This sink owns ONLY classifier-outcome counters
// (`no_match`, `llm_attempted` / `llm_succeeded` / `llm_timeout` /
// `llm_quota_exceeded`). `processEvent` still owns lifecycle counters
// (`seen` / `cancelled` / `evaluated` / `skipped_equal` / `skipped_manual`
// / `updated`) because those derive from §5.4 ownership-marker checks and
// `patchEventColor` results, not from any classifier outcome.
export function syncSummarySink(summary: SyncSummary): Sink {
  return async (outcome) => {
    switch (outcome.kind) {
      case "embeddingHit":
        return;
      case "llmHit":
        summary.llm_attempted += 1;
        summary.llm_succeeded += 1;
        return;
      case "llmTimeout":
        summary.llm_attempted += 1;
        summary.llm_timeout += 1;
        summary.no_match += 1;
        return;
      case "llmQuotaExceeded":
        summary.llm_attempted += 1;
        summary.llm_quota_exceeded += 1;
        summary.no_match += 1;
        return;
      case "llmBadResponse":
        summary.llm_attempted += 1;
        summary.no_match += 1;
        return;
      case "embeddingMiss":
      case "ambiguous":
      case "noMatch":
        summary.no_match += 1;
        return;
    }
  };
}

// Bulk-sync wiring: every outcome that carries an `llmRecord` pushes it
// into the run's buffer. `calendarSync.runPagedList` flushes the buffer
// once per Worker invocation through `ctx.recordLlmCalls`.
export function llmCallsBufferSink(push: (r: LlmCallRecord) => void): Sink {
  return async (outcome) => {
    if ("llmRecord" in outcome) push(outcome.llmRecord);
  };
}

// Preview-route wiring: captures the single LlmCallRecord this request
// produced (if any) so the route can do its one-row `llm_calls` insert.
export function previewLlmCallSink(emit: (r: LlmCallRecord) => void): Sink {
  return async (outcome) => {
    if ("llmRecord" in outcome) emit(outcome.llmRecord);
  };
}

// Helper used by the chain. Sink failure is warn-only — never fails classify.
// The `async (s) =>` wrapper converts a synchronous throw inside a sink (one
// that fires before the sink returns its Promise) into a rejected Promise,
// so `Promise.allSettled` catches both sync throws and async rejections.
// Without the wrapper a sync throw escapes `sinks.map` and breaks the
// failure-isolation contract above.
export async function runSinks(
  outcome: ClassificationOutcome,
  sinks: ReadonlyArray<Sink>,
): Promise<void> {
  const results = await Promise.allSettled(
    sinks.map(async (s) => s(outcome)),
  );
  for (const r of results) {
    if (r.status === "rejected") {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "classifier sink failed",
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        }),
      );
    }
  }
}

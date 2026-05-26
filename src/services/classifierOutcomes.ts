import type { ClassifyContext } from "./classifier";
import type { CalendarEvent } from "./googleCalendar";
import type { LlmCallRecord } from "./llmClassifier";

export type RuleRef = { id: string; name: string; colorId: string };

export type EmbeddingCandidate = {
  ruleId: string;
  seedId: string;
  score: number;
};

// ADR-0004 (`docs/adr/0004-embedding-classifier.md`) #02 will emit
// embeddingHit / embeddingMiss / ambiguous; this PR defines their types
// only. Cases currently emitted: ruleHit, llmHit, llmQuotaExceeded,
// llmTimeout, llmBadResponse, noMatch.
export type ClassificationOutcome =
  | { kind: "ruleHit"; rule: RuleRef; matchedKeyword: string }
  | {
      kind: "embeddingHit";
      rule: RuleRef;
      seed: { id: string; text: string };
      grade: "verified" | "declared";
      score: number;
    }
  | { kind: "embeddingMiss"; best?: EmbeddingCandidate; second?: EmbeddingCandidate }
  | {
      kind: "ambiguous";
      best: EmbeddingCandidate;
      second: EmbeddingCandidate;
      margin: number;
    }
  | { kind: "llmHit"; rule: RuleRef; llmRecord: LlmCallRecord }
  | { kind: "llmQuotaExceeded"; llmRecord: LlmCallRecord }
  | { kind: "llmTimeout"; llmRecord: LlmCallRecord }
  | { kind: "llmBadResponse"; llmRecord: LlmCallRecord }
  | { kind: "noMatch" };

// Chain's public closure type — single union return signature replaces the
// pre-PR `Classification | null`. Lives next to the union so the contract
// is self-contained.
export type ClassifyEventFn = (
  event: CalendarEvent,
  ctx: ClassifyContext,
) => Promise<ClassificationOutcome>;

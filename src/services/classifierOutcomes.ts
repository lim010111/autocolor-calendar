import type { CalendarEvent } from "./googleCalendar";
import type { LlmCallRecord } from "./llmClassifier";
import type { Rule } from "./ruleService";

export type RuleRef = { id: string; name: string; colorId: string };

// Classifier input context. Relocated here from the deleted substring
// `classifier.ts` (ADR-0004 #02). `categories` is assumed pre-sorted by
// (priority ASC, created_at ASC) at load time (`calendarSync.loadCategories`
// / `listRules`); the priority tiebreaker relies on that order.
export type ClassifyContext = {
  userId: string;
  categories: Rule[];
};

export type EmbeddingCandidate = {
  ruleId: string;
  seedId: string;
  score: number;
};

// ADR-0004 #02 — Stage 1 is now embedding kNN. `embeddingHit` short-circuits
// (assign, no LLM); `embeddingMiss` / `ambiguous` fall through to the Stage-2
// LLM leg (or are emitted directly when the LLM leg is unavailable). The
// substring `ruleHit` case is gone — Stage 1 no longer inspects keyword
// substrings (ADR-0004 supersedes §5.1).
export type ClassificationOutcome =
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

// Chain's public closure type — single union return signature. Lives next to
// the union so the contract is self-contained.
export type ClassifyEventFn = (
  event: CalendarEvent,
  ctx: ClassifyContext,
) => Promise<ClassificationOutcome>;

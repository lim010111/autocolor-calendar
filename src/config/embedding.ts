// Embedding classifier config — single source of truth (ADR-0004 #02).
//
// Every write path (backfill, rule create/update name-seed embedding) and
// read path (sync-run title embedding, Stage-1 kNN thresholds) references
// these constants. Two flips are designed to be one-place edits here:
//
//   1. `EMBEDDING_DIM` 768 → 1024. The vector dimension is PROVISIONAL
//      (ADR-0005 §deferred-freeze): the single-persona / ko-only gold set
//      lacks the statistical power to freeze 768 vs 1024, so #02–#06 build on
//      gemma(768) but a multi-persona / multilingual gold set may flip it.
//      A flip is a bounded, irreversible migration — see the header of the
//      `rule_seeds` migration for the exact procedure (ALTER column type +
//      truncate + backfill re-run + HNSW rebuild).
//   2. Threshold provisional release. `T_VERIFIED` / `T_DECLARED` / `MARGIN`
//      are PROVISIONAL (ADR-0005 §threshold): the `sts` prefix's Workers-AI
//      parity was probed only on the empty prefix (mean cosine 1.0 is a
//      high-confidence transfer signal, NOT a boundary bit-equality proof).
//      Re-measure the winner prefix on Workers-AI, then lift provisional by
//      editing the three numbers below.
//
// The embedding PREFIX is a PROD INVARIANT, already frozen (ADR-0005 §prefix):
// backfill, create/update, and the sync title hot-path MUST embed with the
// identical prefix — a mismatch poisons every stored seed vector against the
// live title vectors. `src/services/embeddings.ts` is the single enforcement
// point (callers cannot bypass the prefix).

// Must be a key of the Workers AI `AiModels` catalog so `env.AI.run(...)` is
// typed. `@cf/google/embeddinggemma-300m` → 768-dim text embeddings.
export const EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m" as const;

// PROVISIONAL (ADR-0005). Bound to `rule_seeds.embedding vector(N)`; a change
// here without the accompanying migration + re-backfill is a schema/data
// mismatch. See flip procedure note above.
export const EMBEDDING_DIM = 768;

// PROD INVARIANT (ADR-0005 §prefix). Exact string, sha256_16 = 793518b01601c92e.
// Winning arm = `sts` / `name_phrase`. Do NOT edit without re-embedding every
// stored seed (backfill re-run) in lockstep.
export const EMBEDDING_PREFIX = "task: sentence similarity | query: ";

// Grade-based Stage-1 thresholds — all PROVISIONAL (ADR-0005 §threshold).
// Decision logic: a best-seed cosine below its grade bar → Stage-2 LLM
// fallback; a best/second gap below `MARGIN` → ambiguous → Stage-2 fallback;
// otherwise assign the best rule. `T_VERIFIED` is the low bar for
// Instant-Feedback example seeds (#05, `addExample`) — live in the decision
// logic, though examples stay at zero rows until the OAuth-gated consent
// flow can mint a `ConsentReceipt` (dark build).
export const T_VERIFIED = 0.3;
export const T_DECLARED = 0.55;
export const MARGIN = 0.1;

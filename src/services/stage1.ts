import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { MARGIN, T_DECLARED, T_VERIFIED } from "../config/embedding";
import type {
  ClassificationOutcome,
  ClassifyContext,
  EmbeddingCandidate,
} from "./classifierOutcomes";
import type { EmbedTexts } from "./embeddings";
import type { CalendarEvent } from "./googleCalendar";
import type { Rule } from "./ruleService";

// ADR-0004 #02 — Stage 1 embedding kNN.
//
// A Rule's meaning = its seed vectors (name / keyword / example), each
// embedded separately. score(rule) = MAX cosine over that rule's seeds vs the
// event-title vector (kNN, k = whole seed pool, agg = max, metric = cosine).
// Seed types arrived in slices: name (#02), keyword (#03), example (#05 —
// Instant Feedback, the only Verified-grade type). The pool query below is
// deliberately seed-type-agnostic, so each new type joined without a
// read-path change.

// One row per rule = its single best seed against the title vector (the
// pgvector `DISTINCT ON (rule_id)` query below). Exported for unit tests of
// the pure `decideStage1`.
export type RankedSeed = {
  ruleId: string;
  seedId: string;
  seedText: string;
  seedType: string;
  score: number;
};

// The three Stage-1 outcomes. `embeddingHit` short-circuits in the chain;
// `embeddingMiss` / `ambiguous` fall through to the Stage-2 LLM leg.
export type Stage1Outcome = Extract<
  ClassificationOutcome,
  { kind: "embeddingHit" } | { kind: "embeddingMiss" } | { kind: "ambiguous" }
>;

export type Stage1Deps = {
  db: PostgresJsDatabase;
  // Forced-prefix embedder (single call for preview; page-batched for sync).
  embedTexts: EmbedTexts;
  // Sync read path pre-embeds titles per page and supplies vectors by event
  // id. When a provider is present, an `undefined` return means "this page's
  // batch failed or the title was empty" → Stage-1 miss (no per-event
  // re-embed). Preview omits the provider and embeds the single title inline.
  getTitleVector?: (eventId: string) => number[] | undefined;
};

function gradeOf(seedType: string): "verified" | "declared" {
  // Trust grade is derived, never stored: example = verified (Instant
  // Feedback, strong evidence), name/keyword = declared (ADR-0004).
  return seedType === "example" ? "verified" : "declared";
}

function toCandidate(r: RankedSeed): EmbeddingCandidate {
  return { ruleId: r.ruleId, seedId: r.seedId, score: r.score };
}

function lookupRuleRef(
  ruleId: string,
  rules: Rule[],
): { id: string; name: string; colorId: string; labelId: string | null } | undefined {
  const r = rules.find((x) => x.id === ruleId);
  return r
    ? { id: r.id, name: r.name, colorId: r.colorId, labelId: r.labelId }
    : undefined;
}

// Pure decision logic (ADR-0004 #02 AC #7). Grade-aware bar chosen by the
// seed_type of the pool-wide max-cosine WINNER (no separate verified-only
// aggregation): a verified (example, #05) best seed uses `T_VERIFIED`, a
// declared (name/keyword) best seed uses `T_DECLARED`. A rule with zero
// examples can never produce a verified winner, so `T_VERIFIED` simply never
// fires for it — no cold-start special case (ADR-0005 REPORT §1's "verified
// score nan" cannot arise under max-over-pool). `MARGIN` applies across the
// whole pool regardless of grade.
//
// Branches:
//   1. best.score < bar               → miss   → Stage-2 LLM fallback
//   2. best.score - second.score < M  → ambiguous → Stage-2 LLM fallback
//   3. otherwise                      → assign best rule
export function decideStage1(ranked: RankedSeed[], rules: Rule[]): Stage1Outcome {
  const best = ranked[0];
  if (!best) return { kind: "embeddingMiss" };

  const second = ranked[1];
  const bestCand = toCandidate(best);
  const secondCand = second ? toCandidate(second) : undefined;
  const miss = (): Stage1Outcome => ({
    kind: "embeddingMiss",
    best: bestCand,
    ...(secondCand ? { second: secondCand } : {}),
  });

  const grade = gradeOf(best.seedType);
  const bar = grade === "verified" ? T_VERIFIED : T_DECLARED;
  if (best.score < bar) return miss();

  if (second && best.score - second.score < MARGIN) {
    return {
      kind: "ambiguous",
      best: bestCand,
      second: secondCand as EmbeddingCandidate,
      margin: best.score - second.score,
    };
  }

  const ruleRef = lookupRuleRef(best.ruleId, rules);
  // Rule vanished between the kNN read and the lookup — degrade to Stage 2
  // rather than assign a colorless hit.
  if (!ruleRef) return miss();

  return {
    kind: "embeddingHit",
    rule: ruleRef,
    seed: { id: best.seedId, text: best.seedText },
    grade,
    score: best.score,
  };
}

// Per-user kNN: one row per rule (its best seed) against `vec`. Tenant scope
// is the `user_id` predicate — RLS is bypassed on the Worker path
// (src/AGENTS.md "Tenant isolation"). `<=>` is pgvector cosine distance, so
// `1 - distance` is cosine similarity and the ascending distance sort backs
// the HNSW `vector_cosine_ops` index.
async function knnByUser(
  db: PostgresJsDatabase,
  userId: string,
  vec: number[],
): Promise<RankedSeed[]> {
  const lit = `[${vec.join(",")}]`;
  const result = await db.execute(sql`
    SELECT DISTINCT ON (rule_id)
      rule_id AS "ruleId",
      id AS "seedId",
      seed_text AS "seedText",
      seed_type AS "seedType",
      (1 - (embedding <=> ${lit}::vector)) AS score
    FROM rule_seeds
    WHERE user_id = ${userId}
    ORDER BY rule_id, embedding <=> ${lit}::vector
  `);
  const rows = result as unknown as Array<{
    ruleId: string;
    seedId: string;
    seedText: string;
    seedType: string;
    score: number | string;
  }>;
  const ranked = rows.map((r) => ({
    ruleId: r.ruleId,
    seedId: r.seedId,
    seedText: r.seedText,
    seedType: r.seedType,
    score: typeof r.score === "string" ? Number(r.score) : r.score,
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

// Compose: resolve the title vector (batch-provided or inline) → kNN → decide.
// Every failure (no categories, empty title, embed error, page-batch miss, DB
// error) resolves to `embeddingMiss` so the chain degrades to the Stage-2 LLM
// leg (ADR-0004 "약한 증거로 추측하느니 Stage 2"; #02 AC #9).
export async function classifyStage1(
  event: CalendarEvent,
  ctx: ClassifyContext,
  deps: Stage1Deps,
): Promise<Stage1Outcome> {
  if (ctx.categories.length === 0) return { kind: "embeddingMiss" };
  const title = event.summary?.trim() ?? "";
  if (title.length === 0) return { kind: "embeddingMiss" };

  let vec: number[] | undefined;
  if (deps.getTitleVector) {
    // Sync path: the per-page batch already embedded this title. A miss here
    // means empty title or a systemic page-batch failure → Stage 2.
    vec = deps.getTitleVector(event.id);
    if (!vec) return { kind: "embeddingMiss" };
  } else {
    // Preview path: embed the single title inline.
    try {
      const out = await deps.embedTexts([title]);
      vec = out[0];
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "title embedding failed (degrade to Stage 2)",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return { kind: "embeddingMiss" };
    }
    if (!vec) return { kind: "embeddingMiss" };
  }

  let ranked: RankedSeed[];
  try {
    ranked = await knnByUser(deps.db, ctx.userId, vec);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "stage-1 kNN query failed (degrade to Stage 2)",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { kind: "embeddingMiss" };
  }
  return decideStage1(ranked, ctx.categories);
}

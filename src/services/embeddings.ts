import type { Bindings } from "../env";
import {
  EMBEDDING_MODEL,
  EMBEDDING_PREFIX,
} from "../config/embedding";

// ADR-0004 #02 — the single embedding enforcement point.
//
// PREFIX INVARIANT (ADR-0005 §prefix). Seed vectors (backfill + rule
// create/update) and title vectors (sync read path) MUST be embedded with the
// identical frozen prefix — a mismatch silently poisons every stored seed
// against the live titles. This module is the ONLY place that prepends the
// prefix and the ONLY caller of `env.AI.run` for embeddings, so a caller
// cannot bypass it: callers pass RAW text and always get prefixed embeddings.

// Injectable seam (mirrors `reserve?` / `classifyEvent?` DI elsewhere). Tests
// pass a fake; prod resolves the Workers-AI-backed impl from `env.AI`.
export type EmbedTexts = (texts: string[]) => Promise<number[][]>;

// Wraps a Workers AI binding into an `EmbedTexts` that forces the prefix.
export function makeWorkersAiEmbedder(ai: Ai): EmbedTexts {
  return async (texts) => {
    if (texts.length === 0) return [];
    const prefixed = texts.map((t) => EMBEDDING_PREFIX + t);
    const res = await ai.run(EMBEDDING_MODEL, { text: prefixed });
    return res.data;
  };
}

// Resolve the prod embedder from env, or `undefined` when the AI binding is
// absent (unit tests / misconfig). Callers degrade accordingly:
//   - read path (sync/preview) → Stage-1 miss → Stage-2 LLM fallback
//   - write path (create/update) → warn-only skip (fan-out failure model)
export function resolveEmbedder(env: Bindings): EmbedTexts | undefined {
  return env.AI ? makeWorkersAiEmbedder(env.AI) : undefined;
}

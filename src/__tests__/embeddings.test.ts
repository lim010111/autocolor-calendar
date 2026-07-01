import { describe, expect, it, vi } from "vitest";

import { EMBEDDING_MODEL, EMBEDDING_PREFIX } from "../config/embedding";
import type { Bindings } from "../env";
import {
  makeWorkersAiEmbedder,
  resolveEmbedder,
} from "../services/embeddings";

// ADR-0004 #02 — the embedding helper is the single prefix-enforcement point.
// Seed vectors and title vectors MUST share the frozen prefix; these tests pin
// that the helper prepends it and callers pass raw text.

function fakeAi(): { ai: Ai; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(
    async (_model: string, inputs: { text: string[] }) => ({
      shape: [inputs.text.length, 3],
      data: inputs.text.map(() => [0.1, 0.2, 0.3]),
    }),
  );
  return { ai: { run } as unknown as Ai, run };
}

describe("makeWorkersAiEmbedder", () => {
  it("forces the frozen prefix onto every input and calls the model once", async () => {
    const { ai, run } = fakeAi();
    const embed = makeWorkersAiEmbedder(ai);
    const out = await embed(["회의", "study"]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(EMBEDDING_MODEL, {
      text: [`${EMBEDDING_PREFIX}회의`, `${EMBEDDING_PREFIX}study`],
    });
    expect(out).toEqual([
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3],
    ]);
  });

  it("short-circuits empty input without calling the model", async () => {
    const { ai, run } = fakeAi();
    const embed = makeWorkersAiEmbedder(ai);
    expect(await embed([])).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("resolveEmbedder", () => {
  it("returns undefined when no AI binding is present", () => {
    expect(resolveEmbedder({} as Bindings)).toBeUndefined();
  });

  it("returns an embedder when the AI binding is present", () => {
    const { ai } = fakeAi();
    expect(typeof resolveEmbedder({ AI: ai } as unknown as Bindings)).toBe(
      "function",
    );
  });
});

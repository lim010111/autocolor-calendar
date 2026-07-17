import { describe, expect, it, vi } from "vitest";

import { MARGIN, T_DECLARED, T_VERIFIED } from "../config/embedding";
import type { ClassifyContext } from "../services/classifierOutcomes";
import type { CalendarEvent } from "../services/googleCalendar";
import { synthesizeSeeds, type Rule } from "../services/ruleService";
import {
  classifyStage1,
  decideStage1,
  type RankedSeed,
  type Stage1Deps,
} from "../services/stage1";

function rule(id: string, name = id, colorId = "9"): Rule {
  return {
    id,
    userId: "u",
    name,
    colorId,
    labelId: null,
    labelDeletedAt: null,
    keywords: [],
    priority: 100,
    seeds: synthesizeSeeds({ name, keywords: [] }),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function seed(
  ruleId: string,
  score: number,
  seedType = "name",
  seedText = "n",
): RankedSeed {
  return { ruleId, seedId: `s-${ruleId}`, seedText, seedType, score };
}

function ctx(categories: Rule[]): ClassifyContext {
  return { userId: "u", categories };
}

function ev(summary?: string): CalendarEvent {
  return { id: "e-1", ...(summary !== undefined ? { summary } : {}) };
}

describe("decideStage1 — three branches (declared bar)", () => {
  it("below bar → embeddingMiss (Stage-2 fallback)", () => {
    const out = decideStage1([seed("c-1", T_DECLARED - 0.05)], [rule("c-1")]);
    expect(out.kind).toBe("embeddingMiss");
    if (out.kind !== "embeddingMiss") return;
    expect(out.best?.ruleId).toBe("c-1");
  });

  it("best - second < margin → ambiguous (Stage-2 fallback)", () => {
    const out = decideStage1(
      [seed("c-1", 0.8), seed("c-2", 0.8 - (MARGIN - 0.02))],
      [rule("c-1"), rule("c-2")],
    );
    expect(out.kind).toBe("ambiguous");
    if (out.kind !== "ambiguous") return;
    expect(out.best.ruleId).toBe("c-1");
    expect(out.second.ruleId).toBe("c-2");
    expect(out.margin).toBeCloseTo(MARGIN - 0.02, 6);
  });

  it("above bar with clear margin → embeddingHit (assign best)", () => {
    const out = decideStage1(
      [seed("c-1", 0.85, "name", "회의"), seed("c-2", 0.85 - (MARGIN + 0.05))],
      [rule("c-1", "회의", "5"), rule("c-2")],
    );
    expect(out.kind).toBe("embeddingHit");
    if (out.kind !== "embeddingHit") return;
    expect(out.rule).toEqual({ id: "c-1", name: "회의", colorId: "5", labelId: null });
    expect(out.seed).toEqual({ id: "s-c-1", text: "회의" });
    expect(out.grade).toBe("declared");
    expect(out.score).toBeCloseTo(0.85, 6);
  });

  it("single seed above bar (no second) → embeddingHit", () => {
    const out = decideStage1([seed("c-1", 0.9)], [rule("c-1")]);
    expect(out.kind).toBe("embeddingHit");
  });

  it("empty ranking → embeddingMiss", () => {
    expect(decideStage1([], [rule("c-1")]).kind).toBe("embeddingMiss");
  });

  it("verified (example) seed uses the lower T_verified bar", () => {
    // 0.40 is below the declared bar (0.55) but above the verified bar (0.30),
    // so an example seed hits where a name seed would miss. This slice never
    // produces example seeds, but the grade-aware bar is pinned for #05.
    const out = decideStage1([seed("c-1", 0.4, "example")], [rule("c-1")]);
    expect(out.kind).toBe("embeddingHit");
    if (out.kind !== "embeddingHit") return;
    expect(out.grade).toBe("verified");
  });

  it("rule vanished between kNN and lookup → embeddingMiss", () => {
    // best references a ruleId not in the categories list.
    const out = decideStage1([seed("gone", 0.9)], [rule("c-1")]);
    expect(out.kind).toBe("embeddingMiss");
  });
});

// ADR-0004 #03 — keyword seeds join the same ranking as name seeds. The read
// path (`knnByUser`) has NO `seed_type` filter, so a keyword row competes in
// the per-rule `DISTINCT ON (rule_id)` max-cosine pool exactly like a name row;
// grade derivation maps keyword → declared. These guards pin that behavior
// (no read-path code changed in #03 — regression protection only).
describe("keyword seeds are declared-grade first-class in the ranking", () => {
  it("keyword best seed above the declared bar → embeddingHit (grade declared)", () => {
    const out = decideStage1(
      [seed("c-1", 0.85, "keyword", "스크럼")],
      [rule("c-1", "회의")],
    );
    expect(out.kind).toBe("embeddingHit");
    if (out.kind !== "embeddingHit") return;
    expect(out.grade).toBe("declared");
    expect(out.seed).toEqual({ id: "s-c-1", text: "스크럼" });
  });

  it("keyword best seed below the declared bar → miss (keyword is NOT verified)", () => {
    // 0.40 hits as an example (verified, 0.30 bar) but a keyword uses the
    // declared bar (0.55), so the very same score misses.
    const out = decideStage1(
      [seed("c-1", T_DECLARED - 0.05, "keyword")],
      [rule("c-1")],
    );
    expect(out.kind).toBe("embeddingMiss");
  });

  it("a keyword kNN row flows end-to-end to a declared embeddingHit", async () => {
    // knnByUser returns whichever seed_type won the rule's max-cosine pool.
    const knnRows = [
      {
        ruleId: "c-1",
        seedId: "s-1",
        seedText: "스크럼",
        seedType: "keyword",
        score: 0.9,
      },
    ];
    const db = { execute: async () => knnRows } as never;
    const embedTexts = vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2]));
    const out = await classifyStage1(ev("데일리 스크럼"), ctx([rule("c-1", "회의")]), {
      db,
      embedTexts,
    });
    expect(out.kind).toBe("embeddingHit");
    if (out.kind !== "embeddingHit") return;
    expect(out.grade).toBe("declared");
    expect(out.seed.text).toBe("스크럼");
  });
});

// ADR-0004 #05 — example seeds activate the `T_verified` path. The bar is
// chosen by the seed_type of the POOL-WIDE max-cosine winner (no separate
// verified-only aggregation); margin applies across grades. Same
// regression-protection posture as the #03 keyword suite above: the read
// path (`knnByUser`) has NO `seed_type` filter, so example rows join the
// per-rule `DISTINCT ON (rule_id)` pool with zero read-path code change.
describe("example seeds are verified-grade first-class in the ranking (#05)", () => {
  it("cross-grade margin: best=verified · second=declared가 margin 이내 → ambiguous", () => {
    // Verified winner clears its low bar (0.40 ≥ 0.30) but the declared
    // runner-up sits within MARGIN → still ambiguous → Stage 2. Margin is
    // grade-agnostic across the whole pool.
    const out = decideStage1(
      [
        seed("c-1", T_VERIFIED + 0.1, "example", "회의실 잡기"),
        seed("c-2", T_VERIFIED + 0.1 - (MARGIN - 0.05), "name"),
      ],
      [rule("c-1"), rule("c-2")],
    );
    expect(out.kind).toBe("ambiguous");
    if (out.kind !== "ambiguous") return;
    expect(out.best.ruleId).toBe("c-1");
    expect(out.second.ruleId).toBe("c-2");
  });

  it("cold-start nan 비이슈: example 0개 rule은 verified 승자가 불가능 → T_verified 미발화", () => {
    // ADR-0005 REPORT §1의 "verified score nan"은 verified-only 집계에서만
    // 생기는 아티팩트. max-over-pool 설계에선 example이 없으면 verified
    // 후보 자체가 없어 declared 바(0.55)만 적용된다 — 0.40은 T_verified
    // (0.30)보다 높지만 miss여야 한다.
    const out = decideStage1(
      [seed("c-1", T_VERIFIED + 0.1, "name"), seed("c-1b", 0.2, "keyword")],
      [rule("c-1"), rule("c-1b")],
    );
    expect(out.kind).toBe("embeddingMiss");
    if (out.kind !== "embeddingMiss") return;
    // NaN이 흘러들 자리가 없다 — best/second 점수는 유한값.
    expect(Number.isFinite(out.best?.score ?? 0)).toBe(true);
    expect(Number.isFinite(out.second?.score ?? 0)).toBe(true);
  });

  it("an example kNN row flows end-to-end to a verified embeddingHit (풀 자동 합류)", async () => {
    // knnByUser returns whichever seed_type won the rule's max-cosine pool —
    // an example row rides the same query (no seed_type filter, read-path
    // 코드 변경 0), and its 0.42 score hits ONLY because the verified bar
    // applies (declared bar 0.55 would miss).
    const knnRows = [
      {
        ruleId: "c-1",
        seedId: "s-1",
        seedText: "회의실 잡기",
        seedType: "example",
        score: T_VERIFIED + 0.12,
      },
    ];
    const db = { execute: async () => knnRows } as never;
    const embedTexts = vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2]));
    const out = await classifyStage1(
      ev("회의실 잡기 (3층)"),
      ctx([rule("c-1", "회의")]),
      { db, embedTexts },
    );
    expect(out.kind).toBe("embeddingHit");
    if (out.kind !== "embeddingHit") return;
    expect(out.grade).toBe("verified");
    expect(out.seed.text).toBe("회의실 잡기");
    expect(out.score).toBeLessThan(T_DECLARED);
  });
});

describe("classifyStage1 — degradation to Stage 2", () => {
  const knnRows = [
    { ruleId: "c-1", seedId: "s-1", seedText: "회의", seedType: "name", score: 0.9 },
  ];
  const fakeDb = { execute: async () => knnRows } as never;

  it("no categories → embeddingMiss", async () => {
    const embedTexts = vi.fn(async (t: string[]) => t.map(() => [0.1]));
    const out = await classifyStage1(ev("회의"), ctx([]), {
      db: fakeDb,
      embedTexts,
    });
    expect(out.kind).toBe("embeddingMiss");
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("empty title → embeddingMiss", async () => {
    const embedTexts = vi.fn(async (t: string[]) => t.map(() => [0.1]));
    const out = await classifyStage1(ev("   "), ctx([rule("c-1")]), {
      db: fakeDb,
      embedTexts,
    });
    expect(out.kind).toBe("embeddingMiss");
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("sync provider returns undefined (page batch miss) → embeddingMiss, no per-event embed", async () => {
    const embedTexts = vi.fn(async (t: string[]) => t.map(() => [0.1]));
    const deps: Stage1Deps = {
      db: fakeDb,
      embedTexts,
      getTitleVector: () => undefined,
    };
    const out = await classifyStage1(ev("회의"), ctx([rule("c-1")]), deps);
    expect(out.kind).toBe("embeddingMiss");
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("inline embed throws → embeddingMiss (warn, degrade to Stage 2)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const embedTexts = vi.fn(async () => {
      throw new Error("AI down");
    });
    const out = await classifyStage1(ev("회의"), ctx([rule("c-1")]), {
      db: fakeDb,
      embedTexts,
    });
    expect(out.kind).toBe("embeddingMiss");
    warnSpy.mockRestore();
  });

  it("happy path: inline embed + kNN row → embeddingHit", async () => {
    const embedTexts = vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2]));
    const out = await classifyStage1(ev("회의"), ctx([rule("c-1", "회의")]), {
      db: fakeDb,
      embedTexts,
    });
    expect(out.kind).toBe("embeddingHit");
    if (out.kind !== "embeddingHit") return;
    expect(out.rule.id).toBe("c-1");
    expect(out.score).toBeCloseTo(0.9, 6);
    expect(embedTexts).toHaveBeenCalledWith(["회의"]);
  });

  it("kNN query throws → embeddingMiss (warn, degrade to Stage 2)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const embedTexts = vi.fn(async (t: string[]) => t.map(() => [0.1]));
    const out = await classifyStage1(ev("회의"), ctx([rule("c-1")]), {
      db: {
        execute: async () => {
          throw new Error("db boom");
        },
      } as never,
      embedTexts,
    });
    expect(out.kind).toBe("embeddingMiss");
    warnSpy.mockRestore();
  });
});

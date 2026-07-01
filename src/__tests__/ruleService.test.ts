import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../queues/syncProducer", () => ({
  enqueueSync: vi.fn(async () => undefined),
  SyncQueueUnavailableError: class extends Error {},
}));

import type { Bindings } from "../env";
import { enqueueSync } from "../queues/syncProducer";
import {
  consentExample,
  type ConsentReceipt,
} from "../services/piiRedactor";
import {
  addExample,
  computeKeywordDiff,
  createRule,
  deleteRule,
  DuplicateRuleNameError,
  getRule,
  listRules,
  synthesizeSeeds,
  updateRule,
} from "../services/ruleService";
import type { RuleSeedRow } from "./_helpers/fakeDb";
import { categories } from "../db/schema";

import { type Row, makeFakeDb } from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const RULE_A = "11111111-1111-1111-1111-11111111111a";
const RULE_B = "22222222-2222-2222-2222-22222222222b";

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: overrides.id ?? RULE_A,
    userId: overrides.userId ?? USER_A,
    name: overrides.name ?? "주간회의",
    colorId: overrides.colorId ?? "9",
    keywords: overrides.keywords ?? ["주간회의"],
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? new Date("2026-04-19T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-04-19T00:00:00Z"),
  };
}

const env = {
  ENV: "dev",
} as unknown as Bindings;

beforeEach(() => {
  vi.mocked(enqueueSync).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(enqueueSync).mockImplementation(async () => undefined);
});

describe("synthesizeSeeds", () => {
  it("derives one 'name' seed + one 'keyword' seed per keyword, all declared", () => {
    const seeds = synthesizeSeeds({
      name: "주간회의",
      keywords: ["meeting", "회의"],
    });
    expect(seeds).toEqual([
      { text: "주간회의", type: "name", grade: "declared" },
      { text: "meeting", type: "keyword", grade: "declared" },
      { text: "회의", type: "keyword", grade: "declared" },
    ]);
  });

  it("handles empty keywords (still emits the name seed)", () => {
    const seeds = synthesizeSeeds({ name: "혼자작업", keywords: [] });
    expect(seeds).toEqual([
      { text: "혼자작업", type: "name", grade: "declared" },
    ]);
  });
});

describe("listRules", () => {
  it("returns rules scoped to userId with seeds populated", async () => {
    const { db } = makeFakeDb({
      categories: [
        row({ id: RULE_A, userId: USER_A, name: "회의" }),
        row({ id: RULE_B, userId: USER_B, name: "공부" }),
      ],
    });
    const rules = await listRules(db as never, USER_A);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe(RULE_A);
    expect(rules[0]?.seeds).toEqual([
      { text: "회의", type: "name", grade: "declared" },
      { text: "주간회의", type: "keyword", grade: "declared" },
    ]);
  });

  it("returns empty array when the user owns no rules", async () => {
    const { db } = makeFakeDb({ categories: [] });
    expect(await listRules(db as never, USER_A)).toEqual([]);
  });
});

describe("getRule", () => {
  it("returns the rule with seeds when found", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
    });
    const rule = await getRule(db as never, USER_A, RULE_A);
    expect(rule?.id).toBe(RULE_A);
    expect(rule?.seeds?.length).toBeGreaterThan(0);
  });

  it("returns null when the rule belongs to another user", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_B })],
    });
    expect(await getRule(db as never, USER_A, RULE_A)).toBeNull();
  });

  it("returns null when the rule does not exist", async () => {
    const { db } = makeFakeDb({ categories: [] });
    expect(await getRule(db as never, USER_A, RULE_A)).toBeNull();
  });
});

describe("createRule", () => {
  it("inserts a rule and fans out full_resync to every user calendar", async () => {
    const { db } = makeFakeDb({
      syncStates: [
        { userId: USER_A, calendarId: "primary" },
        { userId: USER_A, calendarId: "work@group" },
      ],
    });
    const { rule, sideEffects } = await createRule(db as never, env, USER_A, {
      name: "회의",
      colorId: "9",
      keywords: ["회의"],
    });
    expect(rule.name).toBe("회의");
    expect(rule.seeds).toEqual([
      { text: "회의", type: "name", grade: "declared" },
      { text: "회의", type: "keyword", grade: "declared" },
    ]);
    await sideEffects;
    expect(vi.mocked(enqueueSync)).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(enqueueSync).mock.calls.map((c) => c[1]);
    expect(calls.every((m) => m.type === "full_resync")).toBe(true);
    expect(calls.map((m) => m.calendarId).sort()).toEqual([
      "primary",
      "work@group",
    ]);
  });

  it("skips fan-out when the user has no calendars in sync_state", async () => {
    const { db } = makeFakeDb({ syncStates: [] });
    const { sideEffects } = await createRule(db as never, env, USER_A, {
      name: "회의",
      colorId: "9",
      keywords: ["회의"],
    });
    await sideEffects;
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("throws DuplicateRuleNameError on a unique-name violation", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A, name: "회의" })],
    });
    await expect(
      createRule(db as never, env, USER_A, {
        name: "회의",
        colorId: "9",
        keywords: ["회의"],
      }),
    ).rejects.toBeInstanceOf(DuplicateRuleNameError);
  });
});

describe("updateRule", () => {
  it("updates and fans out full_resync when colorId/keywords/priority changes", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [{ userId: USER_A, calendarId: "primary" }],
    });
    const result = await updateRule(db as never, env, USER_A, RULE_A, {
      colorId: "3",
    });
    expect(result?.rule.colorId).toBe("3");
    await result?.sideEffects;
    expect(vi.mocked(enqueueSync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueSync).mock.calls[0]?.[1]?.type).toBe(
      "full_resync",
    );
  });

  it("does NOT fan out when only the name (metadata) changes", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [{ userId: USER_A, calendarId: "primary" }],
    });
    const result = await updateRule(db as never, env, USER_A, RULE_A, {
      name: "주간회의(수정)",
    });
    expect(result?.rule.name).toBe("주간회의(수정)");
    await result?.sideEffects;
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("returns null when the rule does not exist for this user", async () => {
    const { db } = makeFakeDb({ categories: [] });
    expect(
      await updateRule(db as never, env, USER_A, RULE_A, { colorId: "3" }),
    ).toBeNull();
  });

  it("throws DuplicateRuleNameError when renaming into another rule's name", async () => {
    const { db } = makeFakeDb({
      categories: [
        row({ id: RULE_A, userId: USER_A, name: "회의" }),
        row({ id: RULE_B, userId: USER_A, name: "공부" }),
      ],
    });
    await expect(
      updateRule(db as never, env, USER_A, RULE_A, { name: "공부" }),
    ).rejects.toBeInstanceOf(DuplicateRuleNameError);
  });
});

describe("name seed write (ADR-0004 #02)", () => {
  const embedOk = () =>
    vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  it("createRule embeds the name into a rule_seeds 'name' row", async () => {
    const { db, state } = makeFakeDb({ syncStates: [] });
    const embed = embedOk();
    const { rule, sideEffects } = await createRule(
      db as never,
      env,
      USER_A,
      { name: "회의", colorId: "9", keywords: ["회의"] },
      embed,
    );
    await sideEffects;
    expect(embed).toHaveBeenCalledWith(["회의"]);
    // Create also reconciles keyword seeds (#03); assert the name seed
    // specifically rather than that it is the only row.
    const nameSeed = state.ruleSeeds.find((s) => s["seedType"] === "name");
    expect(nameSeed).toMatchObject({
      ruleId: rule.id,
      userId: USER_A,
      seedType: "name",
      seedText: "회의",
      embedding: [0.1, 0.2, 0.3],
    });
  });

  it("createRule without an embedder (no AI binding) writes no seed", async () => {
    const { db, state } = makeFakeDb({ syncStates: [] });
    const { sideEffects } = await createRule(db as never, env, USER_A, {
      name: "회의",
      colorId: "9",
      keywords: ["회의"],
    });
    await sideEffects;
    expect(state.ruleSeeds).toHaveLength(0);
  });

  it("updateRule re-embeds the name seed when name changes", async () => {
    const { db, state } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A, name: "회의" })],
      syncStates: [{ userId: USER_A, calendarId: "primary" }],
    });
    const embed = embedOk();
    const result = await updateRule(
      db as never,
      env,
      USER_A,
      RULE_A,
      { name: "주간회의" },
      embed,
    );
    await result?.sideEffects;
    expect(embed).toHaveBeenCalledWith(["주간회의"]);
    expect(state.ruleSeeds).toHaveLength(1);
    expect(state.ruleSeeds[0]).toMatchObject({
      ruleId: RULE_A,
      seedType: "name",
      seedText: "주간회의",
    });
    // name-only change still does NOT fan out a resync (§02 AC #4).
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("updateRule does NOT re-embed when only colorId changes", async () => {
    const { db, state } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [{ userId: USER_A, calendarId: "primary" }],
    });
    const embed = embedOk();
    const result = await updateRule(
      db as never,
      env,
      USER_A,
      RULE_A,
      { colorId: "3" },
      embed,
    );
    await result?.sideEffects;
    expect(embed).not.toHaveBeenCalled();
    expect(state.ruleSeeds).toHaveLength(0);
  });

  it("embedding failure is warn-only — the rule still returns, no seed written", async () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, state } = makeFakeDb({ syncStates: [] });
    const embed = vi.fn(async () => {
      throw new Error("AI unavailable");
    });
    const { rule, sideEffects } = await createRule(
      db as never,
      env,
      USER_A,
      { name: "회의", colorId: "9", keywords: ["회의"] },
      embed,
    );
    await expect(sideEffects).resolves.toBeUndefined();
    expect(rule.name).toBe("회의");
    expect(state.ruleSeeds).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

describe("computeKeywordDiff (ADR-0004 #03)", () => {
  it("adds new, removes dropped, keeps unchanged", () => {
    expect(computeKeywordDiff(["a", "b"], ["b", "c"])).toEqual({
      toAdd: ["c"],
      toRemove: ["a"],
      unchanged: ["b"],
    });
  });

  it("empty incoming removes every existing keyword", () => {
    expect(computeKeywordDiff(["a", "b"], [])).toEqual({
      toAdd: [],
      toRemove: ["a", "b"],
      unchanged: [],
    });
  });

  it("all unchanged → no add / no remove (nothing re-embedded)", () => {
    expect(computeKeywordDiff(["a", "b"], ["a", "b"])).toEqual({
      toAdd: [],
      toRemove: [],
      unchanged: ["a", "b"],
    });
  });

  it("trims, drops empties, and dedupes the incoming set", () => {
    expect(computeKeywordDiff([], ["a", "a", "  b  ", " ", ""])).toEqual({
      toAdd: ["a", "b"],
      toRemove: [],
      unchanged: [],
    });
  });
});

describe("keyword seed reconciliation (ADR-0004 #03)", () => {
  const embedOk = () =>
    vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  const kwSeed = (seedText: string, embedding: number[] = [0, 0, 1]): RuleSeedRow => ({
    ruleId: RULE_A,
    userId: USER_A,
    seedType: "keyword",
    seedText,
    embedding,
  });

  const keywordSeeds = (state: { ruleSeeds: RuleSeedRow[] }) =>
    state.ruleSeeds.filter((s) => s["seedType"] === "keyword");

  it("createRule adds one keyword seed per (deduped) keyword", async () => {
    const { db, state } = makeFakeDb({ syncStates: [] });
    const embed = embedOk();
    const { rule, sideEffects } = await createRule(
      db as never,
      env,
      USER_A,
      { name: "회의", colorId: "9", keywords: ["스크럼", "데일리", "스크럼"] },
      embed,
    );
    await sideEffects;
    const kw = keywordSeeds(state);
    expect(kw.map((s) => s["seedText"]).sort()).toEqual(["데일리", "스크럼"]);
    expect(
      kw.every((s) => s["ruleId"] === rule.id && s["userId"] === USER_A),
    ).toBe(true);
    // A fresh rule embeds its keyword adds in ONE batch (deduped).
    expect(embed).toHaveBeenCalledWith(["스크럼", "데일리"]);
  });

  it("updateRule reconciles: adds new, removes dropped, leaves unchanged untouched", async () => {
    const { db, state } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [{ userId: USER_A, calendarId: "primary" }],
      ruleSeeds: [kwSeed("a", [1, 0, 0]), kwSeed("b", [0, 1, 0])],
    });
    const embed = embedOk();
    const result = await updateRule(
      db as never,
      env,
      USER_A,
      RULE_A,
      { keywords: ["b", "c"] },
      embed,
    );
    await result?.sideEffects;

    const kw = keywordSeeds(state);
    expect(kw.map((s) => s["seedText"]).sort()).toEqual(["b", "c"]);
    // Only the ADDED keyword is embedded; the unchanged "b" is never touched.
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(["c"]);
    const b = kw.find((s) => s["seedText"] === "b");
    expect(b?.["embedding"]).toEqual([0, 1, 0]);
  });

  it("updateRule with keywords:[] removes all keyword seeds (embeds nothing)", async () => {
    const { db, state } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [],
      ruleSeeds: [kwSeed("a"), kwSeed("b")],
    });
    const embed = embedOk();
    const result = await updateRule(
      db as never,
      env,
      USER_A,
      RULE_A,
      { keywords: [] },
      embed,
    );
    await result?.sideEffects;
    expect(keywordSeeds(state)).toHaveLength(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it("updateRule colorId-only does NOT reconcile keyword seeds", async () => {
    const { db, state } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [{ userId: USER_A, calendarId: "primary" }],
      ruleSeeds: [kwSeed("a")],
    });
    const embed = embedOk();
    const result = await updateRule(
      db as never,
      env,
      USER_A,
      RULE_A,
      { colorId: "3" },
      embed,
    );
    await result?.sideEffects;
    expect(embed).not.toHaveBeenCalled();
    expect(keywordSeeds(state)).toHaveLength(1);
  });

  it("embed failure is warn-only and preserves existing keyword seeds (embed-before-mutate)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, state } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [],
      ruleSeeds: [kwSeed("a", [9, 9, 9])],
    });
    // Incoming drops "a" and adds "c": the embed of "c" fails BEFORE the
    // removal delete, so "a" must survive (no partial mutation).
    const embed = vi.fn(async () => {
      throw new Error("AI unavailable");
    });
    const result = await updateRule(
      db as never,
      env,
      USER_A,
      RULE_A,
      { keywords: ["c"] },
      embed,
    );
    await expect(result?.sideEffects).resolves.toBeUndefined();
    const kw = keywordSeeds(state);
    expect(kw).toHaveLength(1);
    expect(kw[0]).toMatchObject({ seedText: "a", embedding: [9, 9, 9] });
    errSpy.mockRestore();
  });

  it("no embedder (no AI binding) → keyword seeds untouched", async () => {
    const { db, state } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [],
      ruleSeeds: [kwSeed("a")],
    });
    // Omit the embed arg → resolveEmbedder(env) returns undefined (no env.AI).
    const result = await updateRule(db as never, env, USER_A, RULE_A, {
      keywords: ["b"],
    });
    await result?.sideEffects;
    expect(keywordSeeds(state).map((s) => s["seedText"])).toEqual(["a"]);
  });
});

describe("deleteRule", () => {
  it("deletes and fans out color_rollback to every user calendar", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
      syncStates: [
        { userId: USER_A, calendarId: "primary" },
        { userId: USER_A, calendarId: "work@group" },
      ],
    });
    const result = await deleteRule(db as never, env, USER_A, RULE_A);
    expect(result).not.toBeNull();
    await result?.sideEffects;
    expect(vi.mocked(enqueueSync)).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(enqueueSync).mock.calls.map((c) => c[1]);
    expect(calls.every((m) => m.type === "color_rollback")).toBe(true);
    expect(calls.every((m) => "categoryId" in m && m.categoryId === RULE_A)).toBe(
      true,
    );
  });

  it("returns null and skips fan-out when the rule does not exist", async () => {
    const { db } = makeFakeDb({ categories: [] });
    expect(await deleteRule(db as never, env, USER_A, RULE_A)).toBeNull();
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });
});

describe("addExample", () => {
  it("resolves without side effects (no-op stub until ADR-0004 #05)", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A })],
    });
    // §5.2: the only branded entry path. `ConsentReceipt` has no exposed
    // minter in this PR (ADR-0004 #05 introduces consent log + receipt
    // issuance) — fabricate a brand-only fake here. This is the single
    // test-side forgery of the receipt brand; production code MUST NOT
    // cast its way around the type.
    const example = consentExample("회의실 잡기", RULE_A, {} as ConsentReceipt);
    await expect(addExample(db as never, example)).resolves.toBeUndefined();
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });
});

describe("categories table reference compile guard", () => {
  // Existence check — ensures the test file links against the same schema
  // table the service uses. Catches an accidental schema relocation that
  // would otherwise only fail at runtime.
  it("references the categories table object", () => {
    expect(categories).toBeDefined();
  });
});

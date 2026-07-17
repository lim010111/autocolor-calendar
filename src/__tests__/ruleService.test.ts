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
  EXAMPLES_PER_RULE_CAP,
  getRule,
  listRules,
  synthesizeSeeds,
  updateRule,
} from "../services/ruleService";
import type { RuleSeedRow } from "./_helpers/fakeDb";
import { categories, ruleSeeds } from "../db/schema";

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

// ─── Finding-1 oracle (merge-gate codex:finding-1) ──────────────────────────
// "Keyword reconciliation is not atomic after delete." reconcileKeywordSeeds
// embeds `toAdd` first (embed-before-mutate), then runs a DELETE of `toRemove`
// followed by a SEPARATE, non-transactional INSERT of `toAdd`, with a warn-only
// catch. embed-before-mutate only guards against an EMBED failure — it does
// nothing for a DB failure that lands BETWEEN the committed delete and the
// insert. For an edit ['a'] -> ['b'] where embed SUCCEEDS but the INSERT
// throws, the catch swallows it and the rule is left with NEITHER 'a' (already
// deleted) NOR 'b' (insert failed): a partial-failure data loss.
describe("finding-1 oracle: keyword reconcile atomicity after delete", () => {
  const embedOk = () =>
    vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  const kwSeed = (seedText: string): RuleSeedRow => ({
    ruleId: RULE_A,
    userId: USER_A,
    seedType: "keyword",
    seedText,
    embedding: [9, 9, 9],
  });

  // Wraps makeFakeDb and overrides insert(ruleSeeds) so the ARRAY-insert path
  // (the #03 keyword adds) throws — a transient DB failure AFTER the removal
  // delete has already committed. The name-seed onConflictDoUpdate path is
  // left intact (unused here — this is a keywords-only patch).
  function makeInsertFailDb() {
    const base = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A, keywords: ["a"] })],
      syncStates: [],
      ruleSeeds: [kwSeed("a")],
    });
    const realInsert = (base.db as { insert: (t: unknown) => unknown }).insert;
    const db = {
      ...(base.db as object),
      insert(table: unknown) {
        if (table === ruleSeeds) {
          return {
            values(v: RuleSeedRow | RuleSeedRow[]) {
              if (Array.isArray(v)) {
                return Promise.resolve().then(() => {
                  throw new Error(
                    "rule_seeds INSERT failed (transient DB error)",
                  );
                });
              }
              return (
                realInsert(table) as { values: (x: unknown) => unknown }
              ).values(v);
            },
          };
        }
        return realInsert(table);
      },
    };
    return { db, state: base.state };
  }

  it("preserves the old keyword seed 'a' when the INSERT of 'b' fails after the DELETE", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, state } = makeInsertFailDb();
    // embed SUCCEEDS — this is a DB failure, NOT an embed failure, so the
    // embed-before-mutate guard does not fire.
    const embed = embedOk();

    const result = await updateRule(
      db as never,
      env,
      USER_A,
      RULE_A,
      { keywords: ["b"] },
      embed,
    );
    // The warn-only catch swallows the insert failure; sideEffects still
    // resolves (no error surfaces to the caller).
    await expect(result?.sideEffects).resolves.toBeUndefined();
    // Confirm the embed leg actually ran (rules out an embed-count-mismatch or
    // no-embedder path — the delete DID reach the DB and the insert DID throw).
    expect(embed).toHaveBeenCalledWith(["b"]);

    const kw = state.ruleSeeds.filter((s) => s["seedType"] === "keyword");
    // Data-preservation oracle: a mid-mutation DB failure must not lose the
    // pre-existing seed. On HEAD 'a' was deleted before the insert threw, so
    // this FAILS — proving the non-atomic partial-failure data loss.
    expect(kw.map((s) => s["seedText"])).toContain("a");
    errSpy.mockRestore();
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

describe("addExample (ADR-0004 #05 — 저장 경로 + 생애주기)", () => {
  const embedOk = () =>
    vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  // §5.2: `ConsentReceipt` has no production minter (OAuth-gated consent
  // flow) — test-side forgery of the receipt brand only; production code
  // MUST NOT cast its way around the type.
  const receipt = {} as ConsentReceipt;
  const mint = (title: string, ruleId = RULE_A, userId = USER_A) => {
    const example = consentExample(title, ruleId, userId, receipt);
    if (!example) throw new Error("fixture title must survive redaction");
    return example;
  };

  const exSeed = (
    seedText: string,
    opts: {
      id: string;
      createdAt: Date;
      ruleId?: string;
      userId?: string;
    },
  ): RuleSeedRow => ({
    id: opts.id,
    ruleId: opts.ruleId ?? RULE_A,
    userId: opts.userId ?? USER_A,
    seedType: "example",
    seedText,
    embedding: [9, 9, 9],
    createdAt: opts.createdAt,
  });

  const exampleSeeds = (state: { ruleSeeds: RuleSeedRow[] }) =>
    state.ruleSeeds.filter((s) => s["seedType"] === "example");

  it("consentExample→addExample 경로: 임베딩(embedTexts) 후 rule_seeds(example) insert", async () => {
    const { db, state } = makeFakeDb({});
    const embed = embedOk();
    const result = await addExample(db as never, embed, mint("회의실 잡기"));
    expect(result).toEqual({ stored: true });
    expect(embed).toHaveBeenCalledWith(["회의실 잡기"]);
    expect(exampleSeeds(state)).toHaveLength(1);
    expect(exampleSeeds(state)[0]).toMatchObject({
      ruleId: RULE_A,
      userId: USER_A,
      seedType: "example",
      seedText: "회의실 잡기",
      embedding: [0.1, 0.2, 0.3],
    });
  });

  it("embed 실패 → embed_failed 소프트 실패, 행 변경 0 (embed-before-mutate)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, state } = makeFakeDb({
      ruleSeeds: [
        exSeed("기존 예시", { id: "s-1", createdAt: new Date("2026-07-01") }),
      ],
    });
    const embed = vi.fn(async () => {
      throw new Error("AI unavailable");
    });
    const result = await addExample(db as never, embed, mint("회의실 잡기"));
    // #02/#03 fan-out의 warn-only-silent와 달리 직접 사용자 행위 — 실패가
    // 반환값으로 표면화되어 Instant Feedback UI가 "정정이 안 붙었음"을
    // 보여줄 수 있어야 한다.
    expect(result).toEqual({ stored: false, reason: "embed_failed" });
    expect(exampleSeeds(state)).toHaveLength(1);
    expect(exampleSeeds(state)[0]).toMatchObject({ seedText: "기존 예시" });
    warnSpy.mockRestore();
  });

  it("embedder 부재 → embed_failed (직접 사용자 행위라 silent skip 금지)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, state } = makeFakeDb({});
    const result = await addExample(db as never, undefined, mint("회의실 잡기"));
    expect(result).toEqual({ stored: false, reason: "embed_failed" });
    expect(state.ruleSeeds).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("캡: 11번째 추가 시 created_at 기준 가장 오래된 example부터 FIFO 축출", async () => {
    // 캡(10개)을 채운 상태 — 배열 순서를 섞어 넣어 FIFO가 배열 순서가 아닌
    // created_at 정렬임을 함께 고정한다. t1이 가장 오래됨.
    const seeds = [3, 1, 5, 2, 4, 6, 7, 8, 9, 10].map((n) =>
      exSeed(`예시 ${n}`, {
        id: `s-${n}`,
        createdAt: new Date(`2026-07-${String(n).padStart(2, "0")}`),
      }),
    );
    const { db, state } = makeFakeDb({ ruleSeeds: seeds });
    const result = await addExample(
      db as never,
      embedOk(),
      mint("열한번째 예시"),
    );
    expect(result).toEqual({ stored: true });
    const remaining = exampleSeeds(state).map((s) => s["seedText"]);
    expect(remaining).toHaveLength(EXAMPLES_PER_RULE_CAP);
    expect(remaining).not.toContain("예시 1"); // 최고령 축출
    expect(remaining).toContain("예시 2");
    expect(remaining).toContain("열한번째 예시");
  });

  it("제목당 단일 Rule (last-write-wins): 다른 Rule의 동일 제목 example을 제거하고 이동", async () => {
    const { db, state } = makeFakeDb({
      ruleSeeds: [
        exSeed("스탠드업", {
          id: "s-b",
          ruleId: RULE_B,
          createdAt: new Date("2026-07-01"),
        }),
      ],
    });
    const result = await addExample(db as never, embedOk(), mint("스탠드업"));
    expect(result).toEqual({ stored: true });
    const rows = exampleSeeds(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: RULE_A, seedText: "스탠드업" });
  });

  it("last-write-wins 제거는 테넌트 스코프 — 다른 사용자의 동일 제목 example은 보존", async () => {
    const { db, state } = makeFakeDb({
      ruleSeeds: [
        exSeed("스탠드업", {
          id: "s-other",
          ruleId: RULE_B,
          userId: USER_B,
          createdAt: new Date("2026-07-01"),
        }),
      ],
    });
    await addExample(db as never, embedOk(), mint("스탠드업"));
    const rows = exampleSeeds(state);
    expect(rows).toHaveLength(2);
    expect(
      rows.find((s) => s["userId"] === USER_B),
    ).toMatchObject({ ruleId: RULE_B, seedText: "스탠드업" });
  });

  it("같은 Rule에 같은 제목 재추가 → 행 교체 (중복 0, created_at 갱신)", async () => {
    const { db, state } = makeFakeDb({
      ruleSeeds: [
        exSeed("스탠드업", { id: "s-old", createdAt: new Date("2026-07-01") }),
      ],
    });
    await addExample(db as never, embedOk(), mint("스탠드업"));
    const rows = exampleSeeds(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).not.toBe("s-old");
  });
});

describe("listRules — example 씨앗 합류 (ADR-0004 #05)", () => {
  it("rule_seeds의 example 행이 verified grade로 seeds에 합류 (created_at 오름차순)", async () => {
    const { db } = makeFakeDb({
      categories: [row({ id: RULE_A, userId: USER_A, name: "회의" })],
      ruleSeeds: [
        {
          id: "s-2",
          ruleId: RULE_A,
          userId: USER_A,
          seedType: "example",
          seedText: "둘째 예시",
          embedding: [0, 0, 1],
          createdAt: new Date("2026-07-02"),
        },
        {
          id: "s-1",
          ruleId: RULE_A,
          userId: USER_A,
          seedType: "example",
          seedText: "첫째 예시",
          embedding: [0, 1, 0],
          createdAt: new Date("2026-07-01"),
        },
        // keyword 행은 examples 합류 대상이 아니다 (synthesize가 커버).
        {
          id: "s-kw",
          ruleId: RULE_A,
          userId: USER_A,
          seedType: "keyword",
          seedText: "kw",
          embedding: [1, 0, 0],
          createdAt: new Date("2026-07-01"),
        },
        // 다른 사용자의 example은 테넌트 밖 — 합류 금지.
        {
          id: "s-b",
          ruleId: RULE_A,
          userId: USER_B,
          seedType: "example",
          seedText: "남의 예시",
          embedding: [1, 1, 1],
          createdAt: new Date("2026-07-01"),
        },
      ],
    });
    const rules = await listRules(db as never, USER_A);
    expect(rules).toHaveLength(1);
    const exampleSeeds = rules[0]?.seeds.filter((s) => s.type === "example");
    expect(exampleSeeds).toEqual([
      { text: "첫째 예시", type: "example", grade: "verified" },
      { text: "둘째 예시", type: "example", grade: "verified" },
    ]);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../queues/syncProducer", () => ({
  enqueueSync: vi.fn(async () => undefined),
  SyncQueueUnavailableError: class extends Error {},
}));

import type { Bindings } from "../env";
import { enqueueSync } from "../queues/syncProducer";
import {
  addExample,
  createRule,
  deleteRule,
  DuplicateRuleNameError,
  getRule,
  listRules,
  synthesizeSeeds,
  updateRule,
} from "../services/ruleService";
import { categories, syncState } from "../db/schema";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const RULE_A = "11111111-1111-1111-1111-11111111111a";
const RULE_B = "22222222-2222-2222-2222-22222222222b";

type Row = {
  id: string;
  userId: string;
  name: string;
  colorId: string;
  keywords: string[];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
};

type SyncStateRow = { userId: string; calendarId: string };

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

class DuplicateNameError extends Error {
  readonly code = "23505";
  readonly constraint_name = "categories_user_id_name_unique";
  constructor() {
    super("duplicate key value violates unique constraint");
  }
}

type SqlWhere = {
  __userId?: string | undefined;
  __ruleId?: string | undefined;
};

// Lightweight chainable db mock — verifies that ruleService routes through
// drizzle's builder methods correctly without walking the SQL AST. The
// route-level test (`categoriesRoute.test.ts`) keeps the broader AST-walk
// contract so the wire shape stays pinned.
function makeFakeDb(initial: {
  rules?: Row[];
  calendars?: SyncStateRow[];
  failInsertWith?: Error;
  failUpdateWith?: Error;
} = {}) {
  const state = {
    rules: [...(initial.rules ?? [])],
    calendars: [...(initial.calendars ?? [])],
  };

  // Lifted from the categoriesRoute fake: extract eq(table.col, val)
  // constraints out of a drizzle SQL tree so where clauses are honored.
  function extractEq(
    node: unknown,
    out: Record<string, unknown> = {},
  ): Record<string, unknown> {
    if (!node || typeof node !== "object") return out;
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (!chunks) return out;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i] as { name?: string; queryChunks?: unknown[] };
      if (
        c &&
        typeof c.name === "string" &&
        !Array.isArray((c as { queryChunks?: unknown }).queryChunks)
      ) {
        const nxt = chunks[i + 1] as { value?: unknown };
        const param = chunks[i + 2] as { value?: unknown };
        if (
          typeof (nxt as { value?: unknown[] })?.value !== "undefined" &&
          Array.isArray((nxt as { value?: unknown[] }).value) &&
          ((nxt as { value?: string[] }).value ?? [])[0]?.includes(" = ") &&
          param &&
          "value" in param
        ) {
          out[c.name] = (param as { value: unknown }).value;
        }
      }
      if (Array.isArray((c as { queryChunks?: unknown }).queryChunks)) {
        extractEq(c, out);
      }
    }
    return out;
  }

  function whereMatcher(whereSql: unknown): SqlWhere {
    const constraints = extractEq(whereSql);
    return {
      __userId: constraints["user_id"] as string | undefined,
      __ruleId: constraints["id"] as string | undefined,
    };
  }

  const db = {
    select(_cols: unknown) {
      return {
        from(table: unknown) {
          if (table === syncState) {
            return {
              where(whereSql: unknown) {
                const { __userId } = whereMatcher(whereSql);
                const out = state.calendars.filter(
                  (c) => c.userId === __userId,
                );
                return Promise.resolve(out);
              },
            };
          }
          // categories
          return {
            where(whereSql: unknown) {
              const m = whereMatcher(whereSql);
              const filtered = state.rules.filter((r) => {
                if (m.__userId && r.userId !== m.__userId) return false;
                if (m.__ruleId && r.id !== m.__ruleId) return false;
                return true;
              });
              return {
                orderBy: async () => filtered.slice(),
                limit: async (_n: number) => filtered.slice(0, _n),
              };
            },
          };
        },
      };
    },
    insert(_table: unknown) {
      return {
        values(v: Partial<Row>) {
          return {
            returning: async (_cols: unknown) => {
              if (initial.failInsertWith) throw initial.failInsertWith;
              const dup = state.rules.find(
                (r) => r.userId === v.userId && r.name === v.name,
              );
              if (dup) throw new DuplicateNameError();
              const overrides: Partial<Row> = {
                id:
                  v.id ??
                  "99999999-9999-9999-9999-" +
                    Math.floor(Math.random() * 1e12)
                      .toString()
                      .padStart(12, "0"),
              };
              if (v.userId !== undefined) overrides.userId = v.userId;
              if (v.name !== undefined) overrides.name = v.name;
              if (v.colorId !== undefined) overrides.colorId = v.colorId;
              if (v.keywords !== undefined) overrides.keywords = v.keywords;
              if (v.priority !== undefined) overrides.priority = v.priority;
              const inserted = row(overrides);
              state.rules.push(inserted);
              return [inserted];
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(patch: Partial<Row>) {
          return {
            where(whereSql: unknown) {
              return {
                returning: async (_cols: unknown) => {
                  if (initial.failUpdateWith) throw initial.failUpdateWith;
                  const m = whereMatcher(whereSql);
                  const matched = state.rules.filter((r) => {
                    if (m.__userId && r.userId !== m.__userId) return false;
                    if (m.__ruleId && r.id !== m.__ruleId) return false;
                    return true;
                  });
                  for (const r of matched) {
                    if (
                      patch.name !== undefined &&
                      patch.name !== r.name &&
                      state.rules.some(
                        (o) =>
                          o !== r &&
                          o.userId === r.userId &&
                          o.name === patch.name,
                      )
                    ) {
                      throw new DuplicateNameError();
                    }
                    Object.assign(r, patch);
                  }
                  return matched.slice();
                },
              };
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        where(whereSql: unknown) {
          return {
            returning: async (_cols: unknown) => {
              const m = whereMatcher(whereSql);
              const toDelete = state.rules.filter((r) => {
                if (m.__userId && r.userId !== m.__userId) return false;
                if (m.__ruleId && r.id !== m.__ruleId) return false;
                return true;
              });
              state.rules = state.rules.filter((r) => !toDelete.includes(r));
              return toDelete.map((r) => ({ id: r.id }));
            },
          };
        },
      };
    },
  };

  return { db: db as never, state };
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
      rules: [
        row({ id: RULE_A, userId: USER_A, name: "회의" }),
        row({ id: RULE_B, userId: USER_B, name: "공부" }),
      ],
    });
    const rules = await listRules(db, USER_A);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe(RULE_A);
    expect(rules[0]?.seeds).toEqual([
      { text: "회의", type: "name", grade: "declared" },
      { text: "주간회의", type: "keyword", grade: "declared" },
    ]);
  });

  it("returns empty array when the user owns no rules", async () => {
    const { db } = makeFakeDb({ rules: [] });
    expect(await listRules(db, USER_A)).toEqual([]);
  });
});

describe("getRule", () => {
  it("returns the rule with seeds when found", async () => {
    const { db } = makeFakeDb({
      rules: [row({ id: RULE_A, userId: USER_A })],
    });
    const rule = await getRule(db, USER_A, RULE_A);
    expect(rule?.id).toBe(RULE_A);
    expect(rule?.seeds?.length).toBeGreaterThan(0);
  });

  it("returns null when the rule belongs to another user", async () => {
    const { db } = makeFakeDb({
      rules: [row({ id: RULE_A, userId: USER_B })],
    });
    expect(await getRule(db, USER_A, RULE_A)).toBeNull();
  });

  it("returns null when the rule does not exist", async () => {
    const { db } = makeFakeDb({ rules: [] });
    expect(await getRule(db, USER_A, RULE_A)).toBeNull();
  });
});

describe("createRule", () => {
  it("inserts a rule and fans out full_resync to every user calendar", async () => {
    const { db } = makeFakeDb({
      calendars: [
        { userId: USER_A, calendarId: "primary" },
        { userId: USER_A, calendarId: "work@group" },
      ],
    });
    const { rule, sideEffects } = await createRule(db, env, USER_A, {
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
    const { db } = makeFakeDb({ calendars: [] });
    const { sideEffects } = await createRule(db, env, USER_A, {
      name: "회의",
      colorId: "9",
      keywords: ["회의"],
    });
    await sideEffects;
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("throws DuplicateRuleNameError on a unique-name violation", async () => {
    const { db } = makeFakeDb({
      rules: [row({ id: RULE_A, userId: USER_A, name: "회의" })],
    });
    await expect(
      createRule(db, env, USER_A, {
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
      rules: [row({ id: RULE_A, userId: USER_A })],
      calendars: [{ userId: USER_A, calendarId: "primary" }],
    });
    const result = await updateRule(db, env, USER_A, RULE_A, { colorId: "3" });
    expect(result?.rule.colorId).toBe("3");
    await result?.sideEffects;
    expect(vi.mocked(enqueueSync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueSync).mock.calls[0]?.[1]?.type).toBe(
      "full_resync",
    );
  });

  it("does NOT fan out when only the name (metadata) changes", async () => {
    const { db } = makeFakeDb({
      rules: [row({ id: RULE_A, userId: USER_A })],
      calendars: [{ userId: USER_A, calendarId: "primary" }],
    });
    const result = await updateRule(db, env, USER_A, RULE_A, {
      name: "주간회의(수정)",
    });
    expect(result?.rule.name).toBe("주간회의(수정)");
    await result?.sideEffects;
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("returns null when the rule does not exist for this user", async () => {
    const { db } = makeFakeDb({ rules: [] });
    expect(
      await updateRule(db, env, USER_A, RULE_A, { colorId: "3" }),
    ).toBeNull();
  });

  it("throws DuplicateRuleNameError when renaming into another rule's name", async () => {
    const { db } = makeFakeDb({
      rules: [
        row({ id: RULE_A, userId: USER_A, name: "회의" }),
        row({ id: RULE_B, userId: USER_A, name: "공부" }),
      ],
    });
    await expect(
      updateRule(db, env, USER_A, RULE_A, { name: "공부" }),
    ).rejects.toBeInstanceOf(DuplicateRuleNameError);
  });
});

describe("deleteRule", () => {
  it("deletes and fans out color_rollback to every user calendar", async () => {
    const { db } = makeFakeDb({
      rules: [row({ id: RULE_A, userId: USER_A })],
      calendars: [
        { userId: USER_A, calendarId: "primary" },
        { userId: USER_A, calendarId: "work@group" },
      ],
    });
    const result = await deleteRule(db, env, USER_A, RULE_A);
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
    const { db } = makeFakeDb({ rules: [] });
    expect(await deleteRule(db, env, USER_A, RULE_A)).toBeNull();
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });
});

describe("addExample", () => {
  it("resolves without side effects (no-op stub until ADR-0004 #05)", async () => {
    const { db } = makeFakeDb({ rules: [row({ id: RULE_A, userId: USER_A })] });
    await expect(
      addExample(db, RULE_A, "회의실 잡기"),
    ).resolves.toBeUndefined();
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

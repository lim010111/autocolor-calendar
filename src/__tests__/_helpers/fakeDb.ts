// Shared FakeDb for service- and route-level unit tests.
//
// Replaces the hand-rolled drizzle-AST walker + chainable mock builder
// that `categoriesRoute.test.ts` and `ruleService.test.ts` were each
// keeping their own copy of. Single source — if drizzle-orm changes the
// SQL AST shape on a minor bump, only `extractEq` here needs to move
// and the sibling `fakeDb.guard.test.ts` fails with a clear named
// message instead of a dozen unit tests producing cryptic mismatches.
//
// Extension point: helper currently handles `categories` + `syncState`
// only. When a third table needs FakeDb coverage, add a new `if (table
// === <newTable>)` arm to the `from()` body — that is deliberately the
// cheapest extension path. No placeholder `extraTables` option until a
// real third caller arrives.

import { ruleSeeds, syncState } from "../../db/schema";

export type Row = {
  id: string;
  userId: string;
  name: string;
  colorId: string;
  keywords: string[];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SyncStateRow = { userId: string; calendarId: string };

// Mirrors the unique-violation Postgres error that
// `services/categoryService` / `services/ruleService` re-throw as
// `DuplicateRuleNameError`. Tests need an instance that satisfies the
// `code === "23505" && constraint_name === "categories_user_id_name_unique"`
// branch in the producer.
export class DuplicateNameError extends Error {
  readonly code = "23505";
  readonly constraint_name = "categories_user_id_name_unique";
  constructor() {
    super("duplicate key value violates unique constraint");
  }
}

// SQL-column → Row field map (schema.ts snake_case ↔ TS camelCase).
const COL_MAP: Record<string, keyof Row> = {
  id: "id",
  user_id: "userId",
  name: "name",
  color_id: "colorId",
  priority: "priority",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

// Walks a drizzle SQL tree to extract `col = val` constraints.
// Pattern: queryChunks = [_, Column, StringChunk(" = "), Param, _].
//
// Behavior is pinned by `fakeDb.guard.test.ts` — a drizzle-orm minor
// bump that breaks this assumption fails there with a clear named
// message before any consumer-test mismatch.
export function extractEq(
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

function matches(r: Row, whereSql: unknown): boolean {
  const constraints = extractEq(whereSql);
  for (const [sqlCol, val] of Object.entries(constraints)) {
    const field = COL_MAP[sqlCol];
    if (!field) return false;
    if (r[field] !== val) return false;
  }
  return true;
}

// First column `.name` reachable inside a drizzle SQL node — the shape
// used by `asc(col)` / `desc(col)` wrappers.
function firstColumnName(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const self = node as { name?: unknown; queryChunks?: unknown[] };
  if (typeof self.name === "string" && !Array.isArray(self.queryChunks)) {
    return self.name;
  }
  if (Array.isArray(self.queryChunks)) {
    for (const c of self.queryChunks) {
      const found = firstColumnName(c);
      if (found) return found;
    }
  }
  return null;
}

function sortBy(rows: Row[], orderArgs: unknown[]): Row[] {
  const cols = orderArgs
    .map(firstColumnName)
    .filter((v): v is string => typeof v === "string");
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const sqlCol of cols) {
      const field = COL_MAP[sqlCol] ?? (sqlCol as keyof Row);
      const av = a[field] as unknown;
      const bv = b[field] as unknown;
      const an = av instanceof Date ? av.getTime() : (av as number | string);
      const bn = bv instanceof Date ? bv.getTime() : (bv as number | string);
      if (an < bn) return -1;
      if (an > bn) return 1;
    }
    return 0;
  });
  return sorted;
}

function randomUuidIsh(): string {
  return (
    "99999999-9999-9999-9999-" +
    Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, "0")
  );
}

function fillRowDefaults(v: Partial<Row>): Row {
  const now = new Date();
  return {
    id: v.id ?? randomUuidIsh(),
    userId: v.userId ?? "",
    name: v.name ?? "",
    colorId: v.colorId ?? "1",
    keywords: v.keywords ?? [],
    priority: v.priority ?? 100,
    createdAt: v.createdAt ?? now,
    updatedAt: v.updatedAt ?? now,
  };
}

export type FakeDbInitial = {
  categories?: Row[];
  syncStates?: SyncStateRow[];
  failInsertWith?: Error;
  failUpdateWith?: Error;
};

// ADR-0004 #02 — captured `rule_seeds` upserts (name-seed write path). Keyed
// loosely because the row shape (ruleId / userId / seedType / seedText /
// embedding) is not the `categories` Row.
export type RuleSeedRow = Record<string, unknown>;

export type FakeDbState = {
  categories: Row[];
  syncStates: SyncStateRow[];
  ruleSeeds: RuleSeedRow[];
};

export type FakeDbHandle = {
  db: unknown;
  close: () => Promise<void>;
  state: FakeDbState;
};

export function makeFakeDb(initial: FakeDbInitial = {}): FakeDbHandle {
  const state: FakeDbState = {
    categories: [...(initial.categories ?? [])],
    syncStates: [...(initial.syncStates ?? [])],
    ruleSeeds: [],
  };

  const db = {
    select(_cols: unknown) {
      return {
        from(table: unknown) {
          if (table === syncState) {
            return {
              where(whereSql: unknown) {
                const constraints = extractEq(whereSql);
                const uid = constraints["user_id"];
                const filtered = state.syncStates.filter(
                  (r) => r.userId === uid,
                );
                return Promise.resolve(filtered);
              },
            };
          }
          // categories (default). To support a third table, add an
          // `else if (table === <newTable>) { ... }` arm above this
          // block — see the module-header note.
          void table;
          return {
            where(whereSql: unknown) {
              const filtered = state.categories.filter((r) =>
                matches(r, whereSql),
              );
              return {
                orderBy: async (...args: unknown[]) => sortBy(filtered, args),
                limit: async (n: number) => filtered.slice(0, n),
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      // ADR-0004 #02 — name-seed create-or-replace. `writeNameSeed` issues
      // `insert(ruleSeeds).values(...).onConflictDoUpdate(...)`; capture the
      // row so tests can assert the seed write without a real pgvector upsert.
      if (table === ruleSeeds) {
        return {
          values(v: RuleSeedRow) {
            return {
              onConflictDoUpdate: async (_cfg?: unknown) => {
                state.ruleSeeds.push(v);
                return undefined;
              },
            };
          },
        };
      }
      return {
        values(v: Partial<Row>) {
          return {
            returning: async (_cols?: unknown) => {
              if (initial.failInsertWith) throw initial.failInsertWith;
              const dup = state.categories.find(
                (r) => r.userId === v.userId && r.name === v.name,
              );
              if (dup) throw new DuplicateNameError();
              const inserted = fillRowDefaults(v);
              state.categories.push(inserted);
              return [inserted];
            },
            onConflictDoNothing: async () => undefined,
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
                returning: async (_cols?: unknown) => {
                  if (initial.failUpdateWith) throw initial.failUpdateWith;
                  const matched = state.categories.filter((r) =>
                    matches(r, whereSql),
                  );
                  if (matched.length === 0) return [];
                  for (const r of matched) {
                    if (
                      patch.name !== undefined &&
                      patch.name !== r.name &&
                      state.categories.some(
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
            returning: async (_cols?: unknown) => {
              const toDelete = state.categories.filter((r) =>
                matches(r, whereSql),
              );
              state.categories = state.categories.filter(
                (r) => !toDelete.includes(r),
              );
              return toDelete.map((r) => ({ id: r.id }));
            },
          };
        },
      };
    },
  };

  return { db, close: async () => undefined, state };
}

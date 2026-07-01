import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { categories, ruleSeeds } from "../../db/schema";

import { extractEq, extractInArray } from "./fakeDb";

// drizzle-orm SQL-AST shape guard. The FakeDb helper relies on the AST
// of `eq(table.column, value)` to be `queryChunks =
// [_, Column, StringChunk(" = "), Param, _]`. A minor drizzle-orm
// bump that changes this shape silently turns every where-clause
// constraint into "no match" — every consumer test would then fail
// in cryptic ways. This guard exists so the failure surface is one
// named test instead of dozens.
describe("fakeDb.guard: drizzle-orm AST shape invariant", () => {
  it("extractEq pulls (column, value) from a single eq(...) fragment", () => {
    const probeUuid = "00000000-0000-0000-0000-00000000abcd";
    const sql = eq(categories.userId, probeUuid);

    const result = extractEq(sql);

    expect(
      result,
      `fakeDb.guard: drizzle-orm AST shape changed — extractEq returned ${JSON.stringify(
        result,
      )}, expected { user_id: "${probeUuid}" }. ` +
        `If drizzle-orm was bumped, update extractEq in src/__tests__/_helpers/fakeDb.ts ` +
        `to match the new queryChunks shape.`,
    ).toEqual({ user_id: probeUuid });
  });

  it("extractInArray pulls the (column, values) from an inArray(...) fragment", () => {
    // ADR-0004 #03 keyword-delete shape: eq predicates + a `seed_text IN (…)`.
    // extractEq must ignore the IN clause (separator " in ", not " = "); the
    // companion extractInArray must recover its value list.
    const where = and(
      eq(ruleSeeds.ruleId, "R1"),
      eq(ruleSeeds.userId, "U1"),
      eq(ruleSeeds.seedType, "keyword"),
      inArray(ruleSeeds.seedText, ["a", "b", "c"]),
    );

    expect(
      extractInArray(where),
      "fakeDb.guard: drizzle-orm inArray AST shape changed — update " +
        "extractInArray in src/__tests__/_helpers/fakeDb.ts.",
    ).toEqual({ column: "seed_text", values: ["a", "b", "c"] });

    // The eq predicates still resolve; the IN clause is (correctly) absent.
    expect(extractEq(where)).toEqual({
      rule_id: "R1",
      user_id: "U1",
      seed_type: "keyword",
    });
  });
});

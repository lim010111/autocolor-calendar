// ─── Finding-0 oracle (merge-gate codex:finding-0) ──────────────────────────
// "addExample's one-title-one-rule move is not atomic after delete."
// `addExample` (ADR-0004 #05) implements last-write-wins by DELETEing the
// tenant's example rows for the redacted title and THEN INSERTing the fresh
// row — two separate, non-transactional statements. embed-before-mutate only
// guards against an EMBED failure; it does nothing for a DB failure landing
// BETWEEN the committed delete and the insert. For a move of title "스탠드업"
// from RULE_B to RULE_A where embed SUCCEEDS but the INSERT throws, the title
// is left with NO example row at all: the pre-existing RULE_B row was deleted
// and the RULE_A row never landed — mid-mutation data loss.
//
// Mirror of the finding-1 oracle in ruleService.test.ts (~line 513), adapted
// to the #05 plain-await single-object insert path.
import { describe, expect, it, vi } from "vitest";

import {
  consentExample,
  type ConsentReceipt,
} from "../services/piiRedactor";
import { addExample } from "../services/ruleService";
import { ruleSeeds } from "../db/schema";
import { type RuleSeedRow, makeFakeDb } from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const RULE_A = "11111111-1111-1111-1111-11111111111a";
const RULE_B = "22222222-2222-2222-2222-22222222222b";

describe("finding-0 oracle: addExample move atomicity after delete", () => {
  const embedOk = () =>
    vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  // §5.2: `ConsentReceipt` has no production minter (OAuth-gated consent
  // flow) — test-side forgery of the receipt brand only.
  const receipt = {} as ConsentReceipt;
  const mint = (title: string, ruleId = RULE_A, userId = USER_A) => {
    const example = consentExample(title, ruleId, userId, receipt);
    if (!example) throw new Error("fixture title must survive redaction");
    return example;
  };

  // Wraps makeFakeDb and overrides insert(ruleSeeds) so the SINGLE-OBJECT
  // plain-await path (the #05 example insert — the thenable whose `then()`
  // performs the insert) REJECTS: a transient DB failure AFTER the
  // last-write-wins delete has already committed. The array path (#03
  // keyword adds) and every other table/verb delegate to the real fakeDb,
  // so the delete and the FIFO select behave normally.
  function makeInsertFailDb() {
    const base = makeFakeDb({
      ruleSeeds: [
        {
          id: "s-b",
          ruleId: RULE_B,
          userId: USER_A,
          seedType: "example",
          seedText: "스탠드업",
          embedding: [9, 9, 9],
          createdAt: new Date("2026-07-01"),
        },
      ],
    });
    const realInsert = (base.db as { insert: (t: unknown) => unknown }).insert;
    const db = {
      ...(base.db as object),
      insert(table: unknown) {
        if (table === ruleSeeds) {
          return {
            values(v: RuleSeedRow | RuleSeedRow[]) {
              if (!Array.isArray(v)) {
                return {
                  then(
                    onFulfilled?: (value: undefined) => unknown,
                    onRejected?: (reason: unknown) => unknown,
                  ) {
                    return Promise.reject(
                      new Error("rule_seeds INSERT failed (transient DB error)"),
                    ).then(onFulfilled, onRejected);
                  },
                };
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

  it("preserves an example row for '스탠드업' when the INSERT fails after the DELETE (move RULE_B → RULE_A)", async () => {
    const { db, state } = makeInsertFailDb();
    // embed SUCCEEDS — this is a DB failure, NOT an embed failure, so the
    // embed-before-mutate guard does not fire.
    const embed = embedOk();

    // addExample has no catch around the mutation steps — the DB error
    // propagates to the caller. The claim is about DB state, not the throw,
    // so catch it and move on to the oracle.
    await expect(
      addExample(db as never, embed, mint("스탠드업")),
    ).rejects.toThrow("rule_seeds INSERT failed (transient DB error)");
    // Confirm the embed leg actually ran (rules out the embed_failed
    // soft-return path — the delete DID reach the DB before the insert threw).
    expect(embed).toHaveBeenCalledWith(["스탠드업"]);

    const standupRows = state.ruleSeeds.filter(
      (s) =>
        s["seedType"] === "example" &&
        s["seedText"] === "스탠드업" &&
        s["userId"] === USER_A,
    );
    // Data-preservation oracle: a failed move must not leave the title with
    // ZERO example rows — the old RULE_B row must survive when the new
    // RULE_A row never landed. On HEAD (delete-before-insert) the RULE_B
    // row was already deleted, so this FAILS — proving mid-mutation data
    // loss exactly as codex:finding-0 claims.
    expect(standupRows.length).toBeGreaterThanOrEqual(1);
  });
});

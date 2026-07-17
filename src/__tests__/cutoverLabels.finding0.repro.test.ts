/**
 * Finding #0 repro (merge-gate advisory, PR #156):
 * "Concurrent reruns can append orphan labels and still verify clean"
 *
 * Scenario: applyUserPlan's append loop mints a real Google label
 * (appendLabel succeeds) and THEN the DB link UPDATE hits 0 rows
 * (linkCategory returns false) because a concurrent run / sync reconcile
 * linked the row between plan and apply. The minted label is now an
 * orphan on the user's calendar, consuming the 200-label cap, and the
 * row is no longer pending — so remaining-count verification passes.
 *
 * Desired safety property encoded here: a post-append 0-row link must be
 * surfaced as a failure/attention item (distinguishable from the benign
 * pre-planned-link miss, which is correctly warn-only), naming the
 * affected category/label so an operator can find the orphan.
 *
 * This test is expected to FAIL on current HEAD: the append path folds
 * the post-append miss into the same `linkMissed` counter as the benign
 * case (scripts/cutover-labels-core.ts:163) and `failures` stays empty.
 */
import { describe, expect, it, vi } from "vitest";

import { applyUserPlan, type CutoverPlan } from "../../scripts/cutover-labels-core";

const emptyPlan = (over: Partial<CutoverPlan> = {}): CutoverPlan => ({
  links: [],
  appends: [],
  skips: [],
  existingLabelCount: 0,
  capExceeded: false,
  ...over,
});

describe("finding #0 — post-append 0-row link orphans the minted Google label", () => {
  it("surfaces a post-append link miss as a failure/attention item, distinct from a benign pre-planned linkMissed", async () => {
    const appendLabel = vi.fn().mockResolvedValue({ id: "minted-orphan-1" });
    // Concurrent writer linked both rows between plan build and apply:
    // every link UPDATE hits 0 rows.
    const linkCategory = vi.fn().mockResolvedValue(false);

    const result = await applyUserPlan(
      emptyPlan({
        // Benign case: pre-planned link against an already-existing label.
        // A 0-row UPDATE here is harmless convergence (warn-only is fine).
        links: [{ categoryId: "c-linked", name: "Work", labelId: "lbl-work" }],
        // Dangerous case: append mints a REAL new Google label first, then
        // the link misses — the minted label is now an invisible orphan.
        appends: [{ categoryId: "c-append", name: "Gym", backgroundColor: "#fbd75b" }],
      }),
      { appendLabel, linkCategory },
    );

    // The label really was created on Google's side.
    expect(appendLabel).toHaveBeenCalledTimes(1);

    // Safety property: the orphaned append must surface on the attention
    // surface (failures), naming the affected category / minted label, so
    // the operator can see it even though remaining-count verification
    // reads clean. On HEAD this fails: failures === [] and the orphan is
    // folded into the same linkMissed counter as the benign case above.
    expect(result.failures.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result.failures)).toMatch(/minted-orphan-1|c-append|Gym/);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  applyUserPlan,
  LABEL_NAME_MAX,
  planCutover,
  type CutoverPlan,
} from "../../scripts/cutover-labels-core";
import { CALENDAR_EVENT_LABEL_CAP } from "../services/eventLabels";
import type { CalendarEventLabel } from "../services/googleCalendar";
import { CLASSIC_EVENT_COLOR_HEX } from "../services/labelReconcile";

const unnamed = (id: string, backgroundColor = "#7986cb"): CalendarEventLabel => ({
  id,
  backgroundColor,
});
const named = (id: string, name: string): CalendarEventLabel => ({
  id,
  backgroundColor: "#ad1457",
  name,
});

const cat = (id: string, name: string, colorId = "5") => ({ id, name, colorId });

const emptyPlan = (over: Partial<CutoverPlan> = {}): CutoverPlan => ({
  links: [],
  appends: [],
  skips: [],
  existingLabelCount: 0,
  capExceeded: false,
  ...over,
});

describe("planCutover", () => {
  it("plans an append with the classic hex of the rule's colorId", () => {
    const plan = planCutover({
      labels: [unnamed("slot-1")],
      pending: [cat("c1", "Work", "5")],
      claimedLabelIds: new Set(),
    });
    expect(plan.appends).toEqual([
      { categoryId: "c1", name: "Work", backgroundColor: CLASSIC_EVENT_COLOR_HEX["5"] },
    ]);
    expect(plan.links).toEqual([]);
    expect(plan.skips).toEqual([]);
    expect(plan.capExceeded).toBe(false);
  });

  it("links a same-name named label instead of appending (re-run idempotency)", () => {
    // Models the half-finished prior run: the label exists on Google but the
    // DB link crashed — the re-run must converge to a link, not a duplicate.
    const plan = planCutover({
      labels: [named("lbl-work", "Work")],
      pending: [cat("c1", "Work")],
      claimedLabelIds: new Set(),
    });
    expect(plan.links).toEqual([{ categoryId: "c1", name: "Work", labelId: "lbl-work" }]);
    expect(plan.appends).toEqual([]);
  });

  it("matches names by trimmed equality", () => {
    const plan = planCutover({
      labels: [named("lbl-work", "  Work  ")],
      pending: [cat("c1", "Work")],
      claimedLabelIds: new Set(),
    });
    expect(plan.links).toEqual([{ categoryId: "c1", name: "Work", labelId: "lbl-work" }]);
  });

  it("never links unnamed palette slots, even when everything else matches", () => {
    const plan = planCutover({
      labels: [unnamed("slot-1"), { id: "slot-2", backgroundColor: "#fbd75b", name: "  " }],
      pending: [cat("c1", "Work")],
      claimedLabelIds: new Set(),
    });
    expect(plan.links).toEqual([]);
    expect(plan.appends).toHaveLength(1);
  });

  it("skips when the same-name label is already claimed by another rule", () => {
    const plan = planCutover({
      labels: [named("lbl-work", "Work")],
      pending: [cat("c1", "Work")],
      claimedLabelIds: new Set(["lbl-work"]),
    });
    expect(plan.skips).toEqual([{ categoryId: "c1", name: "Work", reason: "label_claimed" }]);
    expect(plan.links).toEqual([]);
    expect(plan.appends).toEqual([]);
  });

  it("skips names over the label cap instead of truncating", () => {
    const long = "x".repeat(LABEL_NAME_MAX + 1);
    const plan = planCutover({
      labels: [],
      pending: [cat("c1", long)],
      claimedLabelIds: new Set(),
    });
    expect(plan.skips).toEqual([{ categoryId: "c1", name: long, reason: "name_too_long" }]);
    expect(plan.appends).toEqual([]);
  });

  it("first named label wins when Google holds duplicate names", () => {
    const plan = planCutover({
      labels: [named("lbl-a", "Work"), named("lbl-b", "Work")],
      pending: [cat("c1", "Work")],
      claimedLabelIds: new Set(),
    });
    expect(plan.links).toEqual([{ categoryId: "c1", name: "Work", labelId: "lbl-a" }]);
  });

  it("allows appends up to exactly the 200 cap", () => {
    const labels = Array.from({ length: CALENDAR_EVENT_LABEL_CAP - 2 }, (_, i) =>
      unnamed(`slot-${i}`),
    );
    const plan = planCutover({
      labels,
      pending: [cat("c1", "A"), cat("c2", "B")],
      claimedLabelIds: new Set(),
    });
    expect(plan.capExceeded).toBe(false);
  });

  it("flags capExceeded when appends would pass 200", () => {
    const labels = Array.from({ length: CALENDAR_EVENT_LABEL_CAP - 1 }, (_, i) =>
      unnamed(`slot-${i}`),
    );
    const plan = planCutover({
      labels,
      pending: [cat("c1", "A"), cat("c2", "B")],
      claimedLabelIds: new Set(),
    });
    expect(plan.capExceeded).toBe(true);
    expect(plan.appends).toHaveLength(2); // still reported so dry-run shows them
  });

  it("links never count toward the cap", () => {
    const labels = [
      ...Array.from({ length: CALENDAR_EVENT_LABEL_CAP - 1 }, (_, i) => unnamed(`s${i}`)),
      named("lbl-work", "Work"),
    ];
    const plan = planCutover({
      labels,
      pending: [cat("c1", "Work")],
      claimedLabelIds: new Set(),
    });
    expect(plan.links).toHaveLength(1);
    expect(plan.capExceeded).toBe(false);
  });
});

describe("applyUserPlan", () => {
  it("links, then appends + links the minted label id", async () => {
    const appendLabel = vi.fn().mockResolvedValue({ id: "minted-1" });
    const linkCategory = vi.fn().mockResolvedValue(true);
    const result = await applyUserPlan(
      emptyPlan({
        links: [{ categoryId: "c1", name: "Work", labelId: "lbl-work" }],
        appends: [{ categoryId: "c2", name: "Gym", backgroundColor: "#fbd75b" }],
      }),
      { appendLabel, linkCategory },
    );
    expect(linkCategory).toHaveBeenNthCalledWith(1, "c1", "lbl-work");
    expect(appendLabel).toHaveBeenCalledWith({ name: "Gym", backgroundColor: "#fbd75b" });
    expect(linkCategory).toHaveBeenNthCalledWith(2, "c2", "minted-1");
    expect(result).toEqual({
      linked: 2,
      appended: 1,
      linkMissed: 0,
      appendsSkippedForCap: 0,
      failures: [],
    });
  });

  it("counts a 0-row link UPDATE as linkMissed (concurrent link converged)", async () => {
    const result = await applyUserPlan(
      emptyPlan({ links: [{ categoryId: "c1", name: "Work", labelId: "lbl-work" }] }),
      { appendLabel: vi.fn(), linkCategory: vi.fn().mockResolvedValue(false) },
    );
    expect(result.linkMissed).toBe(1);
    expect(result.linked).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("holds ALL appends when the cap is exceeded but still applies links", async () => {
    const appendLabel = vi.fn();
    const linkCategory = vi.fn().mockResolvedValue(true);
    const result = await applyUserPlan(
      emptyPlan({
        links: [{ categoryId: "c1", name: "Work", labelId: "lbl-work" }],
        appends: [
          { categoryId: "c2", name: "A", backgroundColor: "#fbd75b" },
          { categoryId: "c3", name: "B", backgroundColor: "#fbd75b" },
        ],
        capExceeded: true,
      }),
      { appendLabel, linkCategory },
    );
    expect(appendLabel).not.toHaveBeenCalled();
    expect(result.appendsSkippedForCap).toBe(2);
    expect(result.linked).toBe(1);
  });

  it("isolates a failing append — later items still run", async () => {
    const appendLabel = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "minted-2" });
    const linkCategory = vi.fn().mockResolvedValue(true);
    const result = await applyUserPlan(
      emptyPlan({
        appends: [
          { categoryId: "c1", name: "A", backgroundColor: "#fbd75b" },
          { categoryId: "c2", name: "B", backgroundColor: "#fbd75b" },
        ],
      }),
      { appendLabel, linkCategory },
    );
    expect(result.failures).toEqual([{ categoryId: "c1", name: "A", error: "boom" }]);
    expect(result.appended).toBe(1);
    expect(linkCategory).toHaveBeenCalledWith("c2", "minted-2");
  });

  it("isolates a failing link — remaining links still run", async () => {
    const linkCategory = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(true);
    const result = await applyUserPlan(
      emptyPlan({
        links: [
          { categoryId: "c1", name: "A", labelId: "lbl-a" },
          { categoryId: "c2", name: "B", labelId: "lbl-b" },
        ],
      }),
      { appendLabel: vi.fn(), linkCategory },
    );
    expect(result.failures).toEqual([{ categoryId: "c1", name: "A", error: "db down" }]);
    expect(result.linked).toBe(1);
  });
});

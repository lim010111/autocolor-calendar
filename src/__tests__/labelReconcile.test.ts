import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as GoogleCalendar from "../services/googleCalendar";
import type * as RuleService from "../services/ruleService";

vi.mock("../services/googleCalendar", async () => {
  const actual = await vi.importActual<typeof GoogleCalendar>(
    "../services/googleCalendar",
  );
  return {
    ...actual,
    getCalendarLabelProperties: vi.fn(),
  };
});

vi.mock("../services/ruleService", async () => {
  const actual = await vi.importActual<typeof RuleService>(
    "../services/ruleService",
  );
  return {
    ...actual,
    writeNameSeed: vi.fn(async () => undefined),
  };
});

import { getCalendarLabelProperties } from "../services/googleCalendar";
import { writeNameSeed } from "../services/ruleService";
import {
  nearestClassicColorId,
  reconcileLabels,
} from "../services/labelReconcile";

const USER = "00000000-0000-0000-0000-00000000aaaa";
const CAL = "primary";
const AT = "acc-token";
const mockedLabels = vi.mocked(getCalendarLabelProperties);
const mockedSeed = vi.mocked(writeNameSeed);

// Reconcile is read-only, so the resolved calendarId the reader now returns
// alongside the labels is irrelevant here — it exists for the write path.
const labelsRead = (
  eventLabels: Awaited<ReturnType<typeof getCalendarLabelProperties>>["eventLabels"],
) => ({ calendarId: "owner@example.com", eventLabels });

type RuleRow = {
  id: string;
  name: string;
  backgroundColor?: string | null;
  labelId: string | null;
  labelDeletedAt: Date | null;
  // Optional so the pre-tombstone cases stay literal; makeDb normalizes.
  ruleDeletedAt?: Date | null;
};

// Minimal db double for labelReconcile's five query shapes: a thenable
// where() for the direct-await rules select, update().set().where(),
// insert().values().returning(), and delete().where() (the seed purge that
// rides along with a deactivation stamp).
function makeDb(rules: RuleRow[]) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const deletes: number[] = [];
  const rows = rules.map((r) => ({ ruleDeletedAt: null, ...r }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          then: (resolve: (v: RuleRow[]) => unknown) => resolve(rows),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { returning: async () => [{ id: "new-rule-id" }] };
      },
    }),
    delete: () => ({
      where: async () => {
        deletes.push(deletes.length);
        return undefined;
      },
    }),
  };
  return { db: db as never, updates, inserts, deletes };
}

const embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2]));

beforeEach(() => {
  mockedLabels.mockReset();
  mockedSeed.mockClear();
});

describe("nearestClassicColorId", () => {
  it("maps a classic hex to its own colorId", () => {
    expect(nearestClassicColorId("#dc2127")).toBe("11");
    expect(nearestClassicColorId("#a4bdfc")).toBe("1");
  });

  it("maps a non-classic hex to the nearest classic", () => {
    // #ad1457 (radicchio) lands on grape — pin the deterministic answer.
    expect(nearestClassicColorId("#ad1457")).toBe("3");
  });

  it("measures against the palette the picker actually sends", () => {
    // Regression: the table used to hold `colors.get`'s pastel hexes while
    // every hex compared against it comes from the modern 24-color label
    // picker. Dark grey then landed on basil GREEN (pastel graphite is the
    // near-white #e1e1e1) and brown landed on green too.
    expect(nearestClassicColorId("#616161")).toBe("8"); // graphite → graphite
    expect(nearestClassicColorId("#795548")).toBe("8"); // cocoa → graphite
    expect(nearestClassicColorId("#33b679")).toBe("2"); // sage → sage
    expect(nearestClassicColorId("#7986cb")).toBe("1"); // lavender → lavender
  });

  it("falls back to graphite for garbage/missing input", () => {
    expect(nearestClassicColorId(undefined)).toBe("8");
    expect(nearestClassicColorId("papayawhip")).toBe("8");
  });
});

describe("reconcileLabels — Google labelProperties is canonical (ADR-0006)", () => {
  it("rename: updates the name cache and re-embeds the name seed", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L1", backgroundColor: "#ad1457", name: "새이름" },
    ]));
    const { db, updates, inserts } = makeDb([
      // color already matches, so this case isolates the rename
      { id: "r1", name: "옛이름", backgroundColor: "#ad1457", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ name: "새이름" });
    expect(mockedSeed).toHaveBeenCalledTimes(1);
    expect(mockedSeed.mock.calls[0]![2]).toEqual({
      ruleId: "r1",
      userId: USER,
      name: "새이름",
    });
    expect(inserts).toHaveLength(0);
  });

  it("recolor: folds a Google-side color edit into the background_color cache", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L1", backgroundColor: "#795548", name: "식사" },
    ]));
    const { db, updates } = makeDb([
      { id: "r1", name: "식사", backgroundColor: "#33b679", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      backgroundColor: "#795548",
      colorId: "8", // legacy nearest-classic cache follows along
    });
    // color-only edit must not re-embed the name seed
    expect(mockedSeed).not.toHaveBeenCalled();
  });

  it("recolor: backfills a row written before the column existed", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L1", backgroundColor: "#795548", name: "식사" },
    ]));
    const { db, updates } = makeDb([
      { id: "r1", name: "식사", backgroundColor: null, labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ backgroundColor: "#795548" });
  });

  it("recolor: an unchanged color writes nothing (case-insensitive)", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L1", backgroundColor: "#795548", name: "식사" },
    ]));
    const { db, updates } = makeDb([
      { id: "r1", name: "식사", backgroundColor: "#795548", labelId: "L1", labelDeletedAt: null },
    ]);
    const upper = makeDb([
      { id: "r1", name: "식사", backgroundColor: "#795548", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });
    expect(updates).toHaveLength(0);

    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L1", backgroundColor: "#795548".toUpperCase(), name: "식사" },
    ]));
    await reconcileLabels({
      db: upper.db, userId: USER, calendarId: CAL, accessToken: AT, embed,
    });
    expect(upper.updates).toHaveLength(0);
  });

  it("delete: stamps labelDeletedAt when the backing label vanished", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([]));
    const { db, updates } = makeDb([
      { id: "r1", name: "운동", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect("labelDeletedAt" in updates[0]!).toBe(true);
  });

  it("un-name: a label that lost its name also deactivates its rule", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L1", backgroundColor: "#ad1457" }, // name removed
    ]));
    const { db, updates } = makeDb([
      { id: "r1", name: "운동", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect("labelDeletedAt" in updates[0]!).toBe(true);
  });

  it("no revival: a deactivated rule stays deactivated even if its label is back", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L1", backgroundColor: "#ad1457", name: "운동" },
    ]));
    const { db, updates, inserts } = makeDb([
      {
        id: "r1",
        name: "운동",
        labelId: "L1",
        labelDeletedAt: new Date("2026-07-01T00:00:00Z"),
      },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(mockedSeed).not.toHaveBeenCalled();
  });

  it("new named label: auto-creates a Rule with [name] keyword fallback + name seed", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L9", backgroundColor: "#dc2127", name: "긴급" },
    ]));
    const { db, updates, inserts } = makeDb([]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      userId: USER,
      name: "긴급",
      keywords: ["긴급"],
      labelId: "L9",
      colorId: "11", // nearest classic for #dc2127
      backgroundColor: "#dc2127", // the real hex — what the editor renders
      // ADR-0008 — this label came from Google, so the Add-on must never be
      // allowed to delete it. Written explicitly rather than left to the
      // column default: the default means "we never recorded it", which is a
      // weaker claim than the fact this branch actually knows.
      labelOrigin: "discovered",
    });
    expect(mockedSeed).toHaveBeenCalledTimes(1);
    expect(mockedSeed.mock.calls[0]![2]).toEqual({
      ruleId: "new-rule-id",
      userId: USER,
      name: "긴급",
    });
    expect(updates).toHaveLength(0);
  });

  it("unnamed palette slots never become rules", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "slot-1", backgroundColor: "#a4bdfc" },
      { id: "slot-2", backgroundColor: "#7ae7bf", name: "  " },
    ]));
    const { db, updates, inserts } = makeDb([]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(mockedSeed).not.toHaveBeenCalled();
  });

  it("link: a new named label pairs with a same-named pre-cutover rule (labelId null)", async () => {
    mockedLabels.mockResolvedValueOnce(labelsRead([
      { id: "L2", backgroundColor: "#5484ed", name: "운동" },
    ]));
    const { db, updates, inserts } = makeDb([
      { id: "r1", name: "운동", labelId: null, labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    // linking also adopts the label's color — Google is canonical from here
    expect(updates[0]).toMatchObject({
      labelId: "L2",
      backgroundColor: "#5484ed",
      // ADR-0008 — adopting a label the user already had never confers
      // deletion rights on it, however the pairing was made.
      labelOrigin: "discovered",
    });
    expect(inserts).toHaveLength(0);
  });

  // The rule-resurrection regression. Deleting a Rule in the Add-on editor
  // leaves the Google label alone (label removal is Google's UI to own,
  // ADR-0006 Decision 3), so reconcile MUST recognise the tombstone —
  // otherwise the surviving named label reads as brand new and the rule is
  // re-created seconds later, which is exactly what made six user deletions
  // silently undo themselves.
  describe("user-deleted Rule (rule_deleted_at) is never resurrected", () => {
    const DELETED = new Date("2026-07-30T00:00:00Z");

    it("does not re-create a Rule for the label the deleted rule was attached to", async () => {
      mockedLabels.mockResolvedValueOnce(labelsRead([
        { id: "L1", backgroundColor: "#ad1457", name: "회의" },
      ]));
      const { db, updates, inserts } = makeDb([
        {
          id: "r1",
          name: "회의",
          backgroundColor: "#ad1457",
          labelId: "L1",
          labelDeletedAt: null,
          ruleDeletedAt: DELETED,
        },
      ]);

      await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

      expect(inserts).toHaveLength(0);
      expect(updates).toHaveLength(0);
      expect(mockedSeed).not.toHaveBeenCalled();
    });

    it("does not rename or recolor a tombstoned rule when the label changes in Google", async () => {
      mockedLabels.mockResolvedValueOnce(labelsRead([
        { id: "L1", backgroundColor: "#0b8043", name: "새이름" },
      ]));
      const { db, updates } = makeDb([
        {
          id: "r1",
          name: "옛이름",
          backgroundColor: "#ad1457",
          labelId: "L1",
          labelDeletedAt: null,
          ruleDeletedAt: DELETED,
        },
      ]);

      await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

      expect(updates).toHaveLength(0);
      expect(mockedSeed).not.toHaveBeenCalled();
    });

    it("does not insert for a same-named label when the tombstone has no labelId", async () => {
      // Pre-cutover shape: the deleted rule never carried a labelId, so the
      // labelId lookup cannot protect it — the name check has to.
      mockedLabels.mockResolvedValueOnce(labelsRead([
        { id: "L7", backgroundColor: "#0b8043", name: "운동" },
      ]));
      const { db, updates, inserts } = makeDb([
        {
          id: "r1",
          name: "운동",
          labelId: null,
          labelDeletedAt: null,
          ruleDeletedAt: DELETED,
        },
      ]);

      await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

      expect(inserts).toHaveLength(0);
      expect(updates).toHaveLength(0);
    });

    it("still creates a Rule for an unrelated new label while a tombstone exists", async () => {
      // The guard must be narrow: it blocks the deleted rule's own label,
      // not label discovery in general.
      mockedLabels.mockResolvedValueOnce(labelsRead([
        { id: "L1", backgroundColor: "#ad1457", name: "회의" },
        { id: "L2", backgroundColor: "#0b8043", name: "운동" },
      ]));
      const { db, inserts } = makeDb([
        {
          id: "r1",
          name: "회의",
          backgroundColor: "#ad1457",
          labelId: "L1",
          labelDeletedAt: null,
          ruleDeletedAt: DELETED,
        },
      ]);

      await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({ name: "운동", labelId: "L2" });
    });

    it("does not re-stamp label_deleted_at on a tombstoned rule whose label vanished", async () => {
      mockedLabels.mockResolvedValueOnce(labelsRead([]));
      const { db, updates, deletes } = makeDb([
        {
          id: "r1",
          name: "회의",
          labelId: "L1",
          labelDeletedAt: null,
          ruleDeletedAt: DELETED,
        },
      ]);

      await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

      expect(updates).toHaveLength(0);
      expect(deletes).toHaveLength(0);
    });
  });

  it("deactivation drops the rule's seed vectors along with the stamp", async () => {
    // `knnByUser` ranks `rule_seeds` with no join to `categories`, so seeds
    // left behind by a deactivation keep competing in the kNN pool forever.
    mockedLabels.mockResolvedValueOnce(labelsRead([]));
    const { db, updates, deletes } = makeDb([
      { id: "r1", name: "회의", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("labelDeletedAt");
    expect(deletes).toHaveLength(1);
  });

  it("labelProperties fetch failure is warn-only — sync proceeds on the cache", async () => {
    mockedLabels.mockRejectedValueOnce(new Error("calendars.get failed: 500"));
    const { db, updates, inserts } = makeDb([
      { id: "r1", name: "운동", labelId: "L1", labelDeletedAt: null },
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed }),
    ).resolves.toBeUndefined();

    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

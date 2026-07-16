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

type RuleRow = {
  id: string;
  name: string;
  labelId: string | null;
  labelDeletedAt: Date | null;
};

// Minimal db double for labelReconcile's four query shapes: a thenable
// where() for the direct-await rules select, update().set().where(), and
// insert().values().returning().
function makeDb(rules: RuleRow[]) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          then: (resolve: (v: RuleRow[]) => unknown) => resolve(rules),
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
  };
  return { db: db as never, updates, inserts };
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
    // #ad1457 (deep pink) sits closest to tomato #ff887c / bold red #dc2127
    // territory — pin the deterministic answer.
    expect(nearestClassicColorId("#ad1457")).toBe("11");
  });

  it("falls back to graphite for garbage/missing input", () => {
    expect(nearestClassicColorId(undefined)).toBe("8");
    expect(nearestClassicColorId("papayawhip")).toBe("8");
  });
});

describe("reconcileLabels — Google labelProperties is canonical (ADR-0006)", () => {
  it("rename: updates the name cache and re-embeds the name seed", async () => {
    mockedLabels.mockResolvedValueOnce([
      { id: "L1", backgroundColor: "#ad1457", name: "새이름" },
    ]);
    const { db, updates, inserts } = makeDb([
      { id: "r1", name: "옛이름", labelId: "L1", labelDeletedAt: null },
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

  it("delete: stamps labelDeletedAt when the backing label vanished", async () => {
    mockedLabels.mockResolvedValueOnce([]);
    const { db, updates } = makeDb([
      { id: "r1", name: "운동", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect("labelDeletedAt" in updates[0]!).toBe(true);
  });

  it("un-name: a label that lost its name also deactivates its rule", async () => {
    mockedLabels.mockResolvedValueOnce([
      { id: "L1", backgroundColor: "#ad1457" }, // name removed
    ]);
    const { db, updates } = makeDb([
      { id: "r1", name: "운동", labelId: "L1", labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect("labelDeletedAt" in updates[0]!).toBe(true);
  });

  it("no revival: a deactivated rule stays deactivated even if its label is back", async () => {
    mockedLabels.mockResolvedValueOnce([
      { id: "L1", backgroundColor: "#ad1457", name: "운동" },
    ]);
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
    mockedLabels.mockResolvedValueOnce([
      { id: "L9", backgroundColor: "#dc2127", name: "긴급" },
    ]);
    const { db, updates, inserts } = makeDb([]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      userId: USER,
      name: "긴급",
      keywords: ["긴급"],
      labelId: "L9",
      colorId: "11", // nearest classic for #dc2127
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
    mockedLabels.mockResolvedValueOnce([
      { id: "slot-1", backgroundColor: "#a4bdfc" },
      { id: "slot-2", backgroundColor: "#7ae7bf", name: "  " },
    ]);
    const { db, updates, inserts } = makeDb([]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(mockedSeed).not.toHaveBeenCalled();
  });

  it("link: a new named label pairs with a same-named pre-cutover rule (labelId null)", async () => {
    mockedLabels.mockResolvedValueOnce([
      { id: "L2", backgroundColor: "#5484ed", name: "운동" },
    ]);
    const { db, updates, inserts } = makeDb([
      { id: "r1", name: "운동", labelId: null, labelDeletedAt: null },
    ]);

    await reconcileLabels({ db, userId: USER, calendarId: CAL, accessToken: AT, embed });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ labelId: "L2" });
    expect(inserts).toHaveLength(0);
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

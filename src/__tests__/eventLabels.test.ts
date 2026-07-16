import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as GoogleCalendar from "../services/googleCalendar";

vi.mock("../services/googleCalendar", async () => {
  const actual = await vi.importActual<typeof GoogleCalendar>(
    "../services/googleCalendar",
  );
  return {
    ...actual,
    getCalendarLabelProperties: vi.fn(),
    patchCalendarLabelProperties: vi.fn(),
  };
});

import {
  getCalendarLabelProperties,
  patchCalendarLabelProperties,
  type CalendarEventLabel,
} from "../services/googleCalendar";
import {
  appendEventLabel,
  CALENDAR_EVENT_LABEL_CAP,
  EventLabelCapError,
} from "../services/eventLabels";

const AT = "access-token";
const CAL = "primary";
const mockedGet = vi.mocked(getCalendarLabelProperties);
const mockedPatch = vi.mocked(patchCalendarLabelProperties);

beforeEach(() => {
  mockedGet.mockReset();
  mockedPatch.mockReset();
  mockedPatch.mockResolvedValue(undefined);
});

describe("appendEventLabel — append-only labelProperties writer (ADR-0006)", () => {
  it("writes exactly the freshly-read entries + the new one (append-only under concurrency)", async () => {
    // Simulates the lost-update scenario the re-read defends against: a
    // FOREIGN label ("동시편집") was added by another writer after the
    // editor loaded its stale snapshot. The function's own read happens
    // immediately before the write, so the foreign entry MUST survive in
    // the full-replace payload, verbatim.
    const fresh: CalendarEventLabel[] = [
      { id: "slot-1", backgroundColor: "#a4bdfc" },
      { id: "user-1", backgroundColor: "#ad1457", name: "운동" },
      { id: "foreign-new", backgroundColor: "#123456", name: "동시편집" },
    ];
    mockedGet.mockResolvedValueOnce(fresh);

    const { id } = await appendEventLabel(AT, CAL, {
      name: "회의",
      backgroundColor: "#5484ed",
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedPatch).toHaveBeenCalledTimes(1);
    const written = mockedPatch.mock.calls[0]![2];
    // Prefix is the fresh read, byte-for-byte — nothing dropped or edited.
    expect(written.slice(0, 3)).toEqual(fresh);
    // Suffix is exactly our one new entry, carrying the returned id.
    expect(written).toHaveLength(4);
    expect(written[3]).toEqual({
      id,
      backgroundColor: "#5484ed",
      name: "회의",
    });
  });

  it("returns a uuid-shaped id for the new entry", async () => {
    mockedGet.mockResolvedValueOnce([]);
    const { id } = await appendEventLabel(AT, CAL, {
      name: "x",
      backgroundColor: "#fbd75b",
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("throws EventLabelCapError at the 200 cap without writing", async () => {
    mockedGet.mockResolvedValueOnce(
      Array.from({ length: CALENDAR_EVENT_LABEL_CAP }, (_, i) => ({
        id: `slot-${i}`,
        backgroundColor: "#e1e1e1",
      })),
    );
    await expect(
      appendEventLabel(AT, CAL, { name: "넘침", backgroundColor: "#ffffff" }),
    ).rejects.toBeInstanceOf(EventLabelCapError);
    expect(mockedPatch).not.toHaveBeenCalled();
  });

  it("propagates read errors without writing (no blind full-replace)", async () => {
    mockedGet.mockRejectedValueOnce(new Error("calendars.get failed: 500"));
    await expect(
      appendEventLabel(AT, CAL, { name: "x", backgroundColor: "#ffffff" }),
    ).rejects.toThrow();
    expect(mockedPatch).not.toHaveBeenCalled();
  });
});

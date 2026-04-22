import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as TokenRefresh from "../services/tokenRefresh";
import type * as GoogleCalendar from "../services/googleCalendar";

vi.mock("../services/tokenRefresh", async () => {
  const actual = await vi.importActual<typeof TokenRefresh>(
    "../services/tokenRefresh",
  );
  return {
    ...actual,
    getValidAccessToken: vi.fn(),
  };
});

vi.mock("../services/googleCalendar", async () => {
  const actual = await vi.importActual<typeof GoogleCalendar>(
    "../services/googleCalendar",
  );
  return {
    ...actual,
    listEvents: vi.fn(),
    clearEventColor: vi.fn(),
  };
});

import {
  clearEventColor,
  listEvents,
  CalendarApiError,
  AUTOCOLOR_KEYS,
  type CalendarEvent,
} from "../services/googleCalendar";
import { getValidAccessToken, ReauthRequiredError } from "../services/tokenRefresh";
import { runColorRollback, type RollbackContext } from "../services/colorRollback";

const USER = "00000000-0000-0000-0000-00000000aaaa";
const CAL = "primary";
const CAT = "cat-deleted";
const mockedList = vi.mocked(listEvents);
const mockedClear = vi.mocked(clearEventColor);
const mockedToken = vi.mocked(getValidAccessToken);

const ctx: RollbackContext = {
  db: {} as never,
  env: {} as never,
  userId: USER,
  calendarId: CAL,
};

function ev(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: overrides.id ?? "e-1",
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
    ...(overrides.colorId !== undefined ? { colorId: overrides.colorId } : {}),
    ...(overrides.extendedProperties !== undefined
      ? { extendedProperties: overrides.extendedProperties }
      : {}),
  };
}

function markedEvent(
  id: string,
  currentColor: string,
  markerColor: string,
  version = "1",
): CalendarEvent {
  return ev({
    id,
    colorId: currentColor,
    extendedProperties: {
      private: {
        [AUTOCOLOR_KEYS.version]: version,
        [AUTOCOLOR_KEYS.color]: markerColor,
        [AUTOCOLOR_KEYS.category]: CAT,
      },
    },
  });
}

beforeEach(() => {
  mockedToken.mockResolvedValue({ accessToken: "acc-token", expiresAt: 0 });
  mockedList.mockReset();
  mockedClear.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runColorRollback", () => {
  it("clears events whose marker matches the current color", async () => {
    mockedList.mockResolvedValueOnce({
      items: [markedEvent("e-1", "9", "9"), markedEvent("e-2", "9", "9")],
    });
    mockedClear.mockResolvedValue(undefined);

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.cleared).toBe(2);
    expect(mockedClear).toHaveBeenCalledTimes(2);
    expect(mockedClear).toHaveBeenCalledWith("acc-token", CAL, "e-1");
    expect(mockedClear).toHaveBeenCalledWith("acc-token", CAL, "e-2");
    const listCall = mockedList.mock.calls[0]![2];
    expect(listCall.privateExtendedProperty).toBe(
      `${AUTOCOLOR_KEYS.category}=${CAT}`,
    );
    expect(typeof listCall.timeMin).toBe("string");
    expect(typeof listCall.timeMax).toBe("string");
  });

  it("skips events where user re-painted after our PATCH (stale marker)", async () => {
    // marker says we wrote "9", but current color is "5" — user changed it.
    mockedList.mockResolvedValueOnce({
      items: [markedEvent("e-manual", "5", "9")],
    });

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.skipped_manual_override).toBe(1);
    expect(res.summary.cleared).toBe(0);
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("skips events whose marker version is unknown (forward-compat v2+)", async () => {
    mockedList.mockResolvedValueOnce({
      items: [markedEvent("e-v2", "9", "9", "2")],
    });

    const res = await runColorRollback(ctx, CAT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.skipped_version_mismatch).toBe(1);
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("absorbs per-event 404 (event deleted between list and patch) and continues", async () => {
    mockedList.mockResolvedValueOnce({
      items: [markedEvent("e-gone", "9", "9"), markedEvent("e-ok", "9", "9")],
    });
    mockedClear
      .mockRejectedValueOnce(
        new CalendarApiError("not_found", 404, undefined, "events.patch.clear failed: 404"),
      )
      .mockResolvedValueOnce(undefined);

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.not_found).toBe(1);
    expect(res.summary.cleared).toBe(1);
  });

  it("absorbs per-event 403 and counts it", async () => {
    mockedList.mockResolvedValueOnce({
      items: [markedEvent("e-readonly", "9", "9")],
    });
    mockedClear.mockRejectedValueOnce(
      new CalendarApiError(
        "forbidden",
        403,
        "forbiddenForNonOrganizer",
        "events.patch.clear failed: 403",
      ),
    );

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.forbidden_events).toBe(1);
    expect(res.summary.cleared).toBe(0);
  });

  it("returns reason=retryable on 429 rate limit from listEvents", async () => {
    mockedList.mockRejectedValueOnce(
      new CalendarApiError("rate_limited", 429, undefined, "events.list failed: 429", 7),
    );

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("retryable");
    expect(res.retryAfterSec).toBe(7);
  });

  it("returns reason=reauth_required when token refresh fails", async () => {
    mockedToken.mockReset();
    mockedToken.mockRejectedValueOnce(new ReauthRequiredError("invalid_grant"));

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("reauth_required");
    expect(mockedList).not.toHaveBeenCalled();
  });

  it("returns reason=forbidden when whole-calendar list is 403", async () => {
    mockedList.mockRejectedValueOnce(
      new CalendarApiError(
        "forbidden",
        403,
        "insufficientPermissions",
        "events.list failed: 403",
      ),
    );

    const res = await runColorRollback(ctx, CAT);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("forbidden");
  });

  it("paginates through nextPageToken until exhausted", async () => {
    mockedList
      .mockResolvedValueOnce({
        items: [markedEvent("e-p1", "9", "9")],
        nextPageToken: "tok-p2",
      })
      .mockResolvedValueOnce({
        items: [markedEvent("e-p2", "9", "9")],
      });
    mockedClear.mockResolvedValue(undefined);

    const res = await runColorRollback(ctx, CAT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.pages).toBe(2);
    expect(res.summary.cleared).toBe(2);
    expect(mockedList.mock.calls[1]![2].pageToken).toBe("tok-p2");
  });
});

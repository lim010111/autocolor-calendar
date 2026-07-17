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
    clearEventLabel: vi.fn(),
  };
});

import {
  clearEventLabel,
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
const mockedClear = vi.mocked(clearEventLabel);
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
    ...(overrides.eventLabelId !== undefined
      ? { eventLabelId: overrides.eventLabelId }
      : {}),
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

// ADR-0006 marker v2 — ownership probe is the stored labelId vs the event's
// current eventLabelId (colorId no longer participates).
function markedEventV2(
  id: string,
  currentLabelId: string,
  markerLabelId: string,
): CalendarEvent {
  return ev({
    id,
    ...(currentLabelId !== "" ? { eventLabelId: currentLabelId } : {}),
    extendedProperties: {
      private: {
        [AUTOCOLOR_KEYS.version]: "2",
        [AUTOCOLOR_KEYS.label]: markerLabelId,
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

  it("clears v2-marked events whose stored label matches the current eventLabelId", async () => {
    mockedList.mockResolvedValueOnce({
      items: [markedEventV2("e-v2-owned", "label-uuid-9", "label-uuid-9")],
    });
    mockedClear.mockResolvedValue(undefined);

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.cleared).toBe(1);
    expect(mockedClear).toHaveBeenCalledWith("acc-token", CAL, "e-v2-owned");
  });

  it("skips v2-marked events where the user re-labelled after our PATCH", async () => {
    mockedList.mockResolvedValueOnce({
      items: [markedEventV2("e-v2-manual", "label-user", "label-ours")],
    });

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.skipped_manual_override).toBe(1);
    expect(res.summary.cleared).toBe(0);
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("skips v2-marked events whose label was cleared by the user", async () => {
    // current eventLabelId absent but marker claims label-ours — the user
    // detached our label; !appOwned and no label → manual-override skip.
    mockedList.mockResolvedValueOnce({
      items: [markedEventV2("e-v2-cleared", "", "label-ours")],
    });

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.skipped_manual_override).toBe(1);
    expect(mockedClear).not.toHaveBeenCalled();
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

  it("skips labelled events whose colorId reads empty (label-aware manual gate)", async () => {
    // native-labels #01 — user re-painted via a label after our PATCH:
    // non-classic colors read back as colorId "" + eventLabelId. Marker
    // color "9" can't own an empty colorId, and the explicit label clause
    // pins the gate even if the equality semantics change (marker v2).
    mockedList.mockResolvedValueOnce({
      items: [
        {
          ...markedEvent("e-labelled", "", "9"),
          eventLabelId: "11111111-2222-3333-4444-555555555555",
        },
      ],
    });

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.skipped_manual_override).toBe(1);
    expect(res.summary.cleared).toBe(0);
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("clears app-owned events that carry Google's bridge label", async () => {
    // Our own colorId PATCH gets bridged to a label slot by Google, so an
    // app-owned event (marker color === current) ALSO has eventLabelId.
    // Label presence must not block the rollback of our own color.
    mockedList.mockResolvedValueOnce({
      items: [
        {
          ...markedEvent("e-bridged", "9", "9"),
          eventLabelId: "99999999-8888-7777-6666-555555555555",
        },
      ],
    });
    mockedClear.mockResolvedValue(undefined);

    const res = await runColorRollback(ctx, CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.cleared).toBe(1);
    expect(res.summary.skipped_manual_override).toBe(0);
    expect(mockedClear).toHaveBeenCalledWith("acc-token", CAL, "e-bridged");
  });

  it("skips events whose marker version is unknown (forward-compat v3+)", async () => {
    mockedList.mockResolvedValueOnce({
      items: [markedEvent("e-v3", "9", "9", "3")],
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

// sync-reliability #05 — subrequest budget guard (list + PATCH accounting,
// budget stop, progress-gated restart-resume). Budgets are set via the
// shared SYNC_SUBREQUEST_BUDGET env var; small values keep fixtures tiny.
describe("runColorRollback — #05 subrequest budget guard", () => {
  const ctxWithBudget = (budget: number): RollbackContext => ({
    db: {} as never,
    env: { SYNC_SUBREQUEST_BUDGET: String(budget) } as never,
    userId: USER,
    calendarId: CAL,
  });

  const ownedEvents = (n: number, prefix = "e"): ReturnType<typeof markedEvent>[] =>
    Array.from({ length: n }, (_, i) => markedEvent(`${prefix}-${i + 1}`, "9", "9"));

  it("mid-page stop: PATCHes until the budget, flags continuation, warn is counters-only", async () => {
    // Budget 6 = 1 list + 5 PATCHes; the 6th owned event trips the guard.
    mockedList.mockResolvedValueOnce({ items: ownedEvents(8) });
    mockedClear.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await runColorRollback(ctxWithBudget(6), CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.cleared).toBe(5);
    expect(mockedClear).toHaveBeenCalledTimes(5);
    expect(res.summary.budget_stopped).toBe(true);
    expect(res.continuation).toBe(true);

    const budgetWarns = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("rollback subrequest budget"));
    expect(budgetWarns).toHaveLength(1);
    const payload = JSON.parse(budgetWarns[0]!) as Record<string, unknown>;
    expect(payload.used).toBe(6);
    expect(payload.budget).toBe(6);
    expect(payload.userId).toBe(USER);
    // Log redaction contract — no calendarId (primary id is the user's
    // email), no event ids/content.
    expect("calendarId" in payload).toBe(false);
    expect(budgetWarns[0]).not.toContain("e-1");
    warnSpy.mockRestore();
  });

  it("page-boundary stop: does not fetch a page that cannot make progress", async () => {
    // Budget 4: 1 list + 2 PATCHes (used 3); next page would need 1 list +
    // ≥1 PATCH → 3+2 > 4, so the second list is never issued.
    mockedList.mockResolvedValueOnce({
      items: ownedEvents(2),
      nextPageToken: "tok-p2",
    });
    mockedClear.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await runColorRollback(ctxWithBudget(4), CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(res.summary.cleared).toBe(2);
    expect(res.summary.budget_stopped).toBe(true);
    expect(res.continuation).toBe(true);
    warnSpy.mockRestore();
  });

  it("no-progress budget stop abandons instead of re-enqueueing (termination gate)", async () => {
    // Budget 3: 1 list + 2 PATCH attempts, both per-event 403 — the marked
    // set would NOT shrink on restart, so continuation must be absent.
    mockedList.mockResolvedValueOnce({ items: ownedEvents(4) });
    mockedClear.mockRejectedValue(
      new CalendarApiError(
        "forbidden",
        403,
        "forbiddenForNonOrganizer",
        "events.patch.clear failed: 403",
      ),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await runColorRollback(ctxWithBudget(3), CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.forbidden_events).toBe(2);
    expect(res.summary.cleared).toBe(0);
    expect(res.summary.budget_stopped).toBe(true);
    expect(res.continuation).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("not_found counts as progress (deleted events shrink the marked set too)", async () => {
    // Budget 3: 1 list + 2 PATCH attempts, both 404 — events are gone from
    // the calendar, so a restart WILL see a smaller set: re-enqueue.
    mockedList.mockResolvedValueOnce({ items: ownedEvents(3) });
    mockedClear.mockRejectedValue(
      new CalendarApiError("not_found", 404, undefined, "events.patch.clear failed: 404"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await runColorRollback(ctxWithBudget(3), CAT);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.not_found).toBe(2);
    expect(res.summary.budget_stopped).toBe(true);
    expect(res.continuation).toBe(true);
    warnSpy.mockRestore();
  });

  it("restart converges: the re-run sees only still-marked events and completes", async () => {
    // Large-calendar simulation (AC #3): run 1 budget-stops after 5 of 8
    // owned events; cleared events lose the marker, so the consumer's
    // restart lists only the remaining 3 and completes without a stop.
    mockedList
      .mockResolvedValueOnce({ items: ownedEvents(8) })
      .mockResolvedValueOnce({ items: ownedEvents(3, "rest") });
    mockedClear.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = await runColorRollback(ctxWithBudget(6), CAT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.summary.cleared).toBe(5);
    expect(first.continuation).toBe(true);

    const second = await runColorRollback(ctxWithBudget(6), CAT);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.summary.cleared).toBe(3);
    expect(second.summary.budget_stopped).toBeUndefined();
    expect(second.continuation).toBeUndefined();
    // 8 owned events fully cleared across the restart chain.
    expect(mockedClear).toHaveBeenCalledTimes(8);
    warnSpy.mockRestore();
  });
});

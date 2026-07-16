const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

// §5.4 ownership marker. Keys written under `extendedProperties.private`
// when this app PATCHes a label. `version` lets us evolve the schema without
// a retroactive backfill; v2 (ADR-0006, native-labels #02) stores `label`
// (the eventLabelId we wrote) as the ownership probe — on the next sync, if
// the event's `eventLabelId` no longer equals it, the user changed it after
// us and we treat the event as manual. `category` is read by the
// rule-deletion rollback. `color` is the v1 legacy probe (colorId we wrote):
// still READ for v1-marked events until the #04 cutover re-stamps them, and
// purged (null) on every v2 write. See src/CLAUDE.md "Color ownership
// marker" for the full contract.
export const AUTOCOLOR_MARKER_VERSION = "2";
// v1 read-compat: ownership of v1-marked events is still decided by colorId
// equality (the bridge keeps colorId stable for classic colors). Remove with
// the #04 cutover once the full resync has re-stamped v1 events to v2.
export const AUTOCOLOR_MARKER_VERSION_V1 = "1";
export const AUTOCOLOR_KEYS = {
  version: "autocolor_v",
  color: "autocolor_color",
  label: "autocolor_label",
  category: "autocolor_category",
} as const;

export type CalendarEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  // native-labels #01 (ADR-0006) — Google's 2026-06/07 label rewrite. The
  // API returns this without any opt-in (no eventLabelVersion needed on
  // reads). Semantics per raw-API probe (.scratch/native-labels/PRD.md):
  // every UI color pick assigns a label slot, and legacy `colorId` writes
  // are bridged to one too — so our own PATCHes ALSO produce a label here.
  // Non-classic grid colors / named labels surface with an EMPTY `colorId`,
  // which is why manual-change detection must read this field.
  eventLabelId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  creator?: { email?: string; self?: boolean };
  organizer?: { email?: string; self?: boolean };
  // §5.2에서 추가 — 현재 유일한 소비자는 `piiRedactor.ts`이며, Google API
  // 실제 응답에 존재하는 필드를 타입 정합성만 맞춘 것이다. 다른 경로
  // (classifier / calendarSync)는 여전히 이 필드를 읽지 않는다.
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean }>;
  // §5.4 ownership marker source. Only `private` is modeled — we never read
  // or write `shared`. Google omits this field entirely on events with no
  // extended properties, so all reads must be optional-chained.
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
};

export type EventsListResponse = {
  items: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type ListParams = {
  syncToken?: string | undefined;
  pageToken?: string | undefined;
  timeMin?: string | undefined;
  timeMax?: string | undefined;
  maxResults?: number | undefined;
  // Filter on events.list by `extendedProperties.private` entries. Google
  // accepts the query parameter `privateExtendedProperty=key=value` (repeated
  // for multiple filters). §5 후속 B uses this to find events written by a
  // specific rule's autocolor_category marker without iterating the full
  // calendar. Server-side semantics: all supplied filters must match (AND),
  // and the parameter is incompatible with `syncToken` — callers should use
  // a time window instead.
  privateExtendedProperty?: string | string[] | undefined;
};

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

export type CalendarErrorKind =
  | "auth"           // 401 / authError — token refresh needed or reauth
  | "forbidden"     // 403 insufficientPermissions — non-retryable
  | "not_found"     // 404 — calendar gone, deactivate
  | "full_sync_required" // 410 — clear token, full resync
  | "rate_limited"  // 429 / 403 rateLimitExceeded
  | "server"        // 5xx / network — retryable
  | "unknown";      // shouldn't happen — treat as retryable

export class CalendarApiError extends Error {
  constructor(
    public readonly kind: CalendarErrorKind,
    public readonly status: number,
    public readonly reason: string | undefined,
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "CalendarApiError";
  }
}

function classify(status: number, reason: string | undefined): CalendarErrorKind {
  if (status === 401) return "auth";
  if (status === 403) {
    // Google returns 403 for both insufficientPermissions and rate limits.
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return "rate_limited";
    }
    return "forbidden";
  }
  if (status === 404) return "not_found";
  if (status === 410 || reason === "fullSyncRequired") return "full_sync_required";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unknown";
}

async function parseError(res: Response): Promise<GoogleErrorBody> {
  try {
    return (await res.json()) as GoogleErrorBody;
  } catch {
    return {};
  }
}

async function throwApiError(res: Response, op: string): Promise<never> {
  const body = await parseError(res);
  const reason = body.error?.errors?.[0]?.reason;
  const retryAfterHeader = res.headers.get("retry-after");
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  const kind = classify(res.status, reason);
  // NOTE: error message intentionally omits response body payload so we never
  // leak event data or tokens into logs via .message.
  throw new CalendarApiError(
    kind,
    res.status,
    reason,
    `${op} failed: ${res.status}${reason ? ` (${reason})` : ""}`,
    Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
  );
}

// IMPORTANT (§5.4): we currently rely on Google's default response shape,
// which includes `extendedProperties` on every event that has it. If a
// future change adds a `fields=` mask here for bandwidth optimization, the
// mask MUST include `items(extendedProperties/private)` (or at minimum
// `items(extendedProperties/private/autocolor_v,autocolor_color,autocolor_category)`)
// AND `items(eventLabelId)` — the label-aware manual gate (native-labels #01)
// reads it. Dropping either field silently breaks ownership detection —
// re-applies stop happening on rule changes / user label picks get painted
// over, with no error surfaced.
export async function listEvents(
  accessToken: string,
  calendarId: string,
  params: ListParams,
): Promise<EventsListResponse> {
  const qs = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "true",
    maxResults: String(params.maxResults ?? 2500),
  });
  if (params.syncToken) qs.set("syncToken", params.syncToken);
  if (params.pageToken) qs.set("pageToken", params.pageToken);
  if (params.timeMin) qs.set("timeMin", params.timeMin);
  if (params.timeMax) qs.set("timeMax", params.timeMax);
  if (params.privateExtendedProperty) {
    const filters = Array.isArray(params.privateExtendedProperty)
      ? params.privateExtendedProperty
      : [params.privateExtendedProperty];
    for (const f of filters) qs.append("privateExtendedProperty", f);
  }

  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) await throwApiError(res, "events.list");
  return (await res.json()) as EventsListResponse;
}

// ADR-0006 (native-labels #02) — the sync pipeline's color writer, label
// world. `eventLabelVersion=1` opts the PATCH into label semantics (Google
// then IGNORES any `colorId` in the body — labels supersede it), and
// `eventLabelId` assigns the label. Verified live 2026-07-15 (PRD): HTTP 200
// with the current OAuth scopes, renders in Google UI immediately.
export async function patchEventLabel(
  accessToken: string,
  calendarId: string,
  eventId: string,
  labelId: string,
  // Optional ownership marker keys, written under
  // `extendedProperties.private`. Google merges this map per-key with any
  // existing private properties on the event (a `null` value deletes that
  // key), so other apps' keys are preserved. Omit to send `{ eventLabelId }`
  // only (regression-safe for callers that don't care about ownership
  // tracking).
  extendedPrivate?: Record<string, string | null>,
): Promise<void> {
  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(
    calendarId,
  )}/events/${encodeURIComponent(eventId)}?eventLabelVersion=1`;
  const body: Record<string, unknown> = { eventLabelId: labelId };
  if (extendedPrivate) {
    body.extendedProperties = { private: extendedPrivate };
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, "events.patch");
}

// Per-event manual override (sidebar "변경사항 저장"), label world
// (ADR-0006). Sets `eventLabelId` to a concrete value AND deletes all four
// §5.4 ownership marker keys in the same PATCH. Result: the event is
// unambiguously user-manual, so the next incremental sync's §5.4 check
// (label present + !appOwned) lands on `skipped_manual` and leaves the
// user's choice intact — same outcome as picking the label chip directly in
// Google Calendar.
//
// Separate from `patchEventLabel` (sync-pipeline writer) and
// `clearEventLabel` (rule-deletion rollback) to keep each function's
// payload contract narrow: this is the only call site that combines a
// non-empty `eventLabelId` with explicit marker deletion.
export async function patchEventLabelManual(
  accessToken: string,
  calendarId: string,
  eventId: string,
  labelId: string,
): Promise<void> {
  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(
    calendarId,
  )}/events/${encodeURIComponent(eventId)}?eventLabelVersion=1`;
  const body = {
    eventLabelId: labelId,
    extendedProperties: {
      private: {
        [AUTOCOLOR_KEYS.version]: null,
        [AUTOCOLOR_KEYS.color]: null,
        [AUTOCOLOR_KEYS.label]: null,
        [AUTOCOLOR_KEYS.category]: null,
      },
    },
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, "events.patch.manual");
}

// §5 후속 B — rule-deletion rollback, label world (ADR-0006). PATCH an
// event to clear both the label assignment AND all four autocolor ownership
// markers. `eventLabelId: ""` under `eventLabelVersion=1` detaches the
// label (spec'd by native-labels #02); `null` under
// `extendedProperties.private.<key>` deletes that specific key while
// preserving other apps' private properties (Google merges this map
// per-key).
//
// Bridge assumption: `colorId` is a legacy VIEW of the label (the two are
// one mechanism — PRD 실측 3), so detaching the label also clears the
// event's visible color. A label-less legacy `colorId` relic (unobserved in
// the probe) would keep its color — accepted; the next full resync
// re-evaluates it.
export async function clearEventLabel(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(
    calendarId,
  )}/events/${encodeURIComponent(eventId)}?eventLabelVersion=1`;
  const body = {
    eventLabelId: "",
    extendedProperties: {
      private: {
        [AUTOCOLOR_KEYS.version]: null,
        [AUTOCOLOR_KEYS.color]: null,
        [AUTOCOLOR_KEYS.label]: null,
        [AUTOCOLOR_KEYS.category]: null,
      },
    },
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, "events.patch.clear");
}

// ADR-0006 — calendar-level label definitions (`Calendars.labelProperties`).
// Entry shape per the 07-15 raw probe: `{ id: UUID, backgroundColor: hex,
// name?: ≤50 chars }`; the 24 default palette colors are pre-seeded unnamed
// entries. Definitions are owner-only and FULL-REPLACE on write — which is
// why raw write access is scoped to `eventLabels.ts`'s append-only
// `appendEventLabel` (read-modify-write + 200 cap); do not call
// `patchCalendarLabelProperties` from anywhere else.
export type CalendarEventLabel = {
  id: string;
  backgroundColor?: string;
  name?: string;
};

export async function getCalendarLabelProperties(
  accessToken: string,
  calendarId: string,
): Promise<CalendarEventLabel[]> {
  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(
    calendarId,
  )}?fields=labelProperties`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) await throwApiError(res, "calendars.get");
  const body = (await res.json()) as {
    labelProperties?: { eventLabels?: CalendarEventLabel[] };
  };
  return body.labelProperties?.eventLabels ?? [];
}

export async function patchCalendarLabelProperties(
  accessToken: string,
  calendarId: string,
  eventLabels: CalendarEventLabel[],
): Promise<void> {
  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ labelProperties: { eventLabels } }),
  });
  if (!res.ok) await throwApiError(res, "calendars.patch");
}

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

// §5.4 ownership marker. Three keys written under `extendedProperties.private`
// when this app PATCHes a color. `version` lets us evolve the schema without a
// retroactive backfill; `color` records the value we wrote so the next sync
// can detect post-write user edits (current colorId !== stored color → user
// touched it after us → treat as manual); `category` is forward-compat for the
// deferred rule-deletion rollback (TODO §5 line 95). See src/CLAUDE.md "Color
// ownership marker" for the full contract.
export const AUTOCOLOR_MARKER_VERSION = "1";
export const AUTOCOLOR_KEYS = {
  version: "autocolor_v",
  color: "autocolor_color",
  category: "autocolor_category",
} as const;

export type CalendarEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
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
// `items(extendedProperties/private/autocolor_v,autocolor_color,autocolor_category)`).
// Dropping that field silently breaks ownership detection — re-applies stop
// happening on rule changes, with no error surfaced.
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

  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) await throwApiError(res, "events.list");
  return (await res.json()) as EventsListResponse;
}

export async function patchEventColor(
  accessToken: string,
  calendarId: string,
  eventId: string,
  colorId: string,
  // Optional ownership marker keys, written under
  // `extendedProperties.private`. Google merges this map per-key with any
  // existing private properties on the event, so other apps' keys are
  // preserved. Omit to send `{ colorId }` only (regression-safe for callers
  // that don't care about ownership tracking).
  extendedPrivate?: Record<string, string>,
): Promise<void> {
  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(
    calendarId,
  )}/events/${encodeURIComponent(eventId)}`;
  const body: Record<string, unknown> = { colorId };
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

import {
  getCalendarLabelProperties,
  patchCalendarLabelProperties,
  type CalendarEventLabel,
} from "./googleCalendar";

// ADR-0006 (native-labels #02) — the ONLY sanctioned writer of
// `Calendars.labelProperties`. Google's write semantics are FULL-REPLACE
// (the submitted array becomes the calendar's entire label set), so a naive
// write from a stale read would silently delete labels the user (or another
// app) created since that read. Contract:
//
// - **Append-only**: the payload is always `freshly-read entries + ours`,
//   verbatim — never modify or drop an existing entry, whoever created it.
// - **Re-read immediately before write**: the read below happens inside
//   this function, right before the PATCH, not at editor-load time. This
//   narrows (not closes) the lost-update window; Google exposes no ETag on
//   labelProperties, so a concurrent write in the remaining window is
//   "observed, not prevented" — same posture as the §5.4 concurrent PATCH
//   race.
// - **200 cap**: Google caps a calendar at 200 event labels; we check
//   before writing so the user gets a typed error instead of an opaque 400.
//
// The label id is minted client-side (`crypto.randomUUID()`). **Validated
// live 2026-07-28**: an append carrying a client-minted UUID returned 200 and
// the entry read back verbatim, and the discovery doc is explicit — `id` is
// "Optional when inserting a new label… If provided, the ID must be unique
// within the calendar and follow UUID format." The write-then-re-read-diff
// fallback this comment used to hedge on is therefore not needed.
export const CALENDAR_EVENT_LABEL_CAP = 200;

export class EventLabelCapError extends Error {
  constructor(public readonly count: number) {
    super(`calendar event label cap reached (${count}/${CALENDAR_EVENT_LABEL_CAP})`);
    this.name = "EventLabelCapError";
  }
}

export async function appendEventLabel(
  accessToken: string,
  calendarId: string,
  input: { name: string; backgroundColor: string },
): Promise<{ id: string }> {
  // Re-read immediately before write — see the append-only contract above.
  // The read also resolves the calendar id: `calendars.patch` 404s on the
  // `primary` alias that callers pass, so the write below MUST use the
  // resolved id (see `patchCalendarLabelProperties`'s header).
  const { calendarId: resolvedCalendarId, eventLabels: existing } =
    await getCalendarLabelProperties(accessToken, calendarId);
  if (existing.length >= CALENDAR_EVENT_LABEL_CAP) {
    throw new EventLabelCapError(existing.length);
  }
  const entry: CalendarEventLabel = {
    id: crypto.randomUUID(),
    backgroundColor: input.backgroundColor,
    name: input.name,
  };
  await patchCalendarLabelProperties(accessToken, resolvedCalendarId, [
    ...existing,
    entry,
  ]);
  return { id: entry.id };
}

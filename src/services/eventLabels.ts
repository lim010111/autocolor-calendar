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

// `calendars.get` returned 200 but no `id`, so there is no safe target for
// the full-replace write (see `appendEventLabel`). Distinct from
// `EventLabelCapError` — that one is a user-facing 422, this one is a bug
// signal and deliberately has no typed HTTP mapping.
export class UnresolvedCalendarIdError extends Error {
  constructor(public readonly requestedCalendarId: string) {
    super(`calendars.get returned no id for "${requestedCalendarId}"`);
    this.name = "UnresolvedCalendarIdError";
  }
}

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
  if (resolvedCalendarId === null) {
    // Google answered the read but omitted `id`. Falling back to the caller's
    // argument would PATCH the `primary` alias — the exact 404 this resolution
    // exists to avoid, resurfacing as a misleading 502. Fail loudly instead:
    // an unresolvable id is our bug or an API shape change, not a user error.
    throw new UnresolvedCalendarIdError(calendarId);
  }
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

// The sanctioned exception to the append-only contract above. Scoped so that
// dropping ONE caller-supplied id is the only thing it can do: every other
// entry is carried through verbatim from a fresh read, whoever created it.
//
// TWO callers are entitled to it, and the boundary between them matters:
//
// 1. **Orphan retraction** (`routes/categories.ts` POST catch). The create
//    flow mints the label before inserting the Rule, so a losing race on the
//    name's unique constraint leaves a label with no Rule. Reconcile cannot
//    clean that up — Google permits two labels with the same name, so
//    treating same-name duplicates as garbage would delete labels the user
//    made on purpose. Only the request that minted the orphan knows it is one.
//
// 2. **Add-on-owned label deletion** (ADR-0008, `routes/categories.ts`
//    DELETE with `?deleteLabel=1`). Permitted ONLY when
//    `categories.label_origin = 'addon'` — i.e. we minted this label — AND
//    the user confirmed it on the delete card. The gate is about blast
//    radius, not knowledge: a label the user made in Google Calendar may be
//    worn by events this app has never touched, and `color_rollback` only
//    visits marker-bearing events, so those would go colourless with no
//    rollback and no warning. That case stays Google's UI to own
//    (ADR-0006 Decision 3, narrowed by ADR-0008 — never widen the gate to
//    'discovered'/'unknown' without re-reading that ADR's Consequences).
//
// Anything else — reconcile-driven cleanup, dedupe, "tidying" a stale set —
// is still forbidden.
//
// Unchanged risk in both cases: `labelProperties` has no ETag, so the
// re-read below narrows but does not close the lost-update window. A
// concurrent writer between our read and PATCH loses its entry. Same
// "observed, not prevented" posture as the append path and the §5.4
// concurrent-PATCH race.
export async function removeEventLabel(
  accessToken: string,
  calendarId: string,
  labelId: string,
): Promise<void> {
  const { calendarId: resolvedCalendarId, eventLabels: existing } =
    await getCalendarLabelProperties(accessToken, calendarId);
  if (resolvedCalendarId === null) {
    throw new UnresolvedCalendarIdError(calendarId);
  }
  const remaining = existing.filter((l) => l.id !== labelId);
  // Not there (already gone, or never landed) — skip the write. A full-replace
  // PATCH that changes nothing is still a lost-update window for no gain.
  if (remaining.length === existing.length) return;
  await patchCalendarLabelProperties(
    accessToken,
    resolvedCalendarId,
    remaining,
  );
}

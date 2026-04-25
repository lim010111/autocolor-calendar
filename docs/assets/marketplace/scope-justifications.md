# OAuth Scope Justifications

> This document is the per-scope justification artifact required by Google's
> OAuth Consent Screen verification (and by `docs/marketplace-readiness.md`
> §2 status table). Each scope below states the function it enables, the
> data minimum the implementation actually consumes, and the canonical
> contract pointers proving the claim. Pair with `docs/security-principles.md`
> Principle 3 (Scope Minimization) and Principle 2 (PII Masking); the body
> of each contract lives at the canonical pointer and is not restated here.
>
> Audience: OAuth Consent Screen reviewers, Google Workspace Marketplace
> reviewers, and the launch owner verifying §2 status freshness.

## Scope

In scope:

- Per-scope justification text for the three rows in
  `docs/marketplace-readiness.md` §2 status table
  (`calendar` / `calendar.events` / `userinfo.email`).
- The data-minimum whitelist for each scope — the fields and operations the
  implementation actually consumes.

Out of scope (intentionally):

- Apps Script Add-on framework scopes (`script.external_request`,
  `script.locale`, `calendar.addons.execute`,
  `calendar.addons.current.event.read`,
  `calendar.addons.current.event.write`). These are framework-required
  scopes that the Add-on runtime mandates and that are explicitly
  declared in `gas/appsscript.json` → `oauthScopes`. Their consent-screen
  surface and demonstrated usage are tracked in
  `docs/marketplace-readiness.md` §4 (Reviewer Demo Scenarios) — the
  Event-open preview rows pin `calendar.addons.current.event.read` to a
  specific demo flow.
- The OIDC `openid` sub-scope. Bundled with `email` in `OAUTH_SCOPES` to
  obtain the id_token; adds no PII access beyond what `email` already
  grants. See §3 below.
- Privacy Policy / Terms of Service body — separate legal artifacts (§1
  of `docs/marketplace-readiness.md`).
- Restricted-scope demo video (separate row in `docs/marketplace-readiness.md`
  §2 status table).

## §1 — `https://www.googleapis.com/auth/calendar` (Restricted)

**Why we request.** Incremental sync (`events.list` with `syncToken` per
calendar) and watch-channel management (`channels.watch` + `channels.stop`
for the webhook lifecycle) require this Restricted scope. The narrower
`calendar.events` scope cannot enumerate the user's calendars
(`calendarList.list`) or subscribe to push notifications, both of which
are load-bearing for the §4 sync architecture (incremental-sync flow,
backend-side watch renewal cron). Without it the app cannot determine
which calendars to color or stay in sync as events change.

**Data minimum.** Two read envelopes and one write envelope sit under
this scope:

- `calendarList.list` — id + summary + primary flag, used once during
  onboarding to bootstrap `sync_state` rows.
- `events.list` (per-calendar, paged) — `id` + `status` + `start` +
  `end` + `colorId` + `extendedProperties.private` (the §5.4 ownership
  probe) + `summary` + `description` + `location` + `attendees` +
  `creator` + `organizer`, plus pagination cursors. Of these, **only**
  `summary` / `description` / `location` are forwarded to the LLM leg
  after PII redaction (see §4); the rest stay on the Worker side and
  are never logged (calendar-event-payload logging ban,
  `src/CLAUDE.md` → "Log redaction contract").
- `channels.watch` / `channels.stop` — registration metadata
  (`channelId`, `resourceId`, `expiration`) only; no event content.

**Canonical pointers.**

- `src/config/constants.ts` → `OAUTH_SCOPES` (source of truth; the array
  literal lists this scope alongside `openid` / `email` /
  `calendar.events`).
- `gas/appsscript.json` → `oauthScopes` (manifest declaration consumed by
  the Add-on framework).
- `docs/security-principles.md` Principle 3 — Scope Minimization promise
  and blast-radius paragraph.
- `docs/architecture-guidelines.md` → "Sync Flow" — the five-step
  incremental sync token flow.
- `src/services/calendarSync.ts` — `events.list` + `events.patch` driver.
- `src/services/watchRenewal.ts`; `src/CLAUDE.md` → "Watch renewal
  concurrency (§6.4)" — the watch-channel lifecycle invariant.

## §2 — `https://www.googleapis.com/auth/calendar.events` (Sensitive)

**Why we request.** `events.patch` is the only operation that writes back
the classified `colorId` (and the three `autocolor_*`
`extendedProperties.private` ownership markers) to user events. This scope
is the strict subset of the broader `calendar` scope above for event-level
read/write; we keep both because `calendarList.list` (under `calendar`)
is required by the sync bootstrap and watch registration path, while
`events.patch` (under `calendar.events`) covers the day-to-day write
surface.

**Data minimum.** The `events.patch` body is bounded to
`{ colorId, extendedProperties: { private: { autocolor_v, autocolor_color, autocolor_category } } }`
exclusively. No event body field
(`summary` / `description` / `location` / `attendees` / `creator` /
`organizer` / `start` / `end` / `recurrence`) is mutated. Read fields
follow the same `summary` / `description` / `location` whitelist before
crossing the LLM boundary (see §4).

**Canonical pointers.**

- `src/config/constants.ts` → `OAUTH_SCOPES`.
- `gas/appsscript.json` → `oauthScopes` — note: the backend requests
  `calendar.events` via the OIDC token; the GAS manifest exposes the same
  write surface to the Add-on UI via the Add-on framework's
  `calendar.addons.current.event.write` scope (framework-declared; see
  "Out of scope" above).
- `docs/architecture-guidelines.md` → "Color Ownership (§5.4)" — the
  `events.patch` body shape contract.
- `src/CLAUDE.md` → "Color ownership marker (§5.4)" — per-key merge
  semantics and the `autocolor_*` prefix exclusivity invariant.
- `src/services/googleCalendar.ts` → `AUTOCOLOR_KEYS` /
  `AUTOCOLOR_MARKER_VERSION` (the three-key marker constants) /
  `patchEventColor` (PATCH body construction site).
- `docs/security-principles.md` Principle 2 — PII Masking; points at
  `src/services/piiRedactor.ts` for the LLM-leg defense.

## §3 — `https://www.googleapis.com/auth/userinfo.email` (Non-Sensitive)

**Why we request.** Identifies the authenticated Google account so the
backend can pin OAuth tokens, sessions, sync state, and category rows to a
stable tenant key (`users.google_sub`) and surface a human-readable
identifier in onboarding cards and admin tooling. Without this scope the
OIDC id_token's `sub` claim is still obtainable but the `email` claim is
not, leaving no human-readable account label. The backend declares the
OIDC pair `openid` + `email` (`src/config/constants.ts` →
`OAUTH_SCOPES`); the GAS manifest declares the URL-form `userinfo.email`
scope (`gas/appsscript.json` → `oauthScopes`). Both grant functionally
equivalent access — Google's documentation pairs them as the
email-identity surface — and the OIDC `openid` sub-scope is listed under
"Out of scope" above because it adds no PII access beyond what `email`
already grants.

**Data minimum.** The `email` field of the id_token / userinfo response,
nothing else. No `profile`, `name`, `picture`, or directory claims are
requested. Email is stored under `users.email` (it is not the input to
any pepper / encryption key — see §4 "Refresh-token encryption at rest"
for the secret-keyed surfaces). `email` is also a
**query-string-parameter** redaction target in `src/middleware/logger.ts`
— the middleware skips request/response bodies and request headers by
construction (not by allowlist), so the redactor exists to scrub
`?email=...` query strings before a log line is emitted.

**Canonical pointers.**

- `src/config/constants.ts` → `OAUTH_SCOPES` (OIDC pair `openid` +
  `email`).
- `gas/appsscript.json` → `oauthScopes` (URL-form `userinfo.email`
  manifest declaration).
- `docs/security-principles.md` Principle 1 — Data Minimization (the
  email redaction in the logger contract).
- `docs/security-principles.md` Principle 3 — Scope Minimization.
- `src/CLAUDE.md` → "Log redaction contract" — `email` is in the
  query-string field set; bodies and request headers are excluded by
  construction.

## §4 — Common defenses across all three scopes

A non-restating cross-link to the runtime invariants that prevent each
scope above from leaking beyond its data-minimum envelope. These contracts
are not duplicated here; the pointers below are authoritative.

- **PII redaction before any LLM call.**
  `docs/security-principles.md` Principle 2; `src/services/piiRedactor.ts`.
  Whitelists `summary` / `description` / `location` only; email fields on
  `attendees` / `creator` / `organizer` are removed by destructure-and-omit
  (not by regex).
- **Calendar event payloads never logged.** `src/CLAUDE.md` → "Log
  redaction contract" → "Calendar event payloads (§4+) must never be
  logged" paragraph. Logger middleware skips request/response bodies and
  request headers by construction.
- **Tenant isolation in every query.** `docs/security-principles.md`
  Principle 4. The application-layer `where(user_id)` predicate is the
  sole live enforcer on the Worker path (Hyperdrive runs as `BYPASSRLS`).
- **Refresh-token encryption at rest.** `docs/security-principles.md`
  Principle 5; `src/CLAUDE.md` → "Secret rotation impact" →
  `TOKEN_ENCRYPTION_KEY`.
- **E2E backend mandatory** — no local-trigger fallback that would
  silently widen the runtime scope envelope:
  `docs/architecture-guidelines.md` → "E2E Backend Mandatory" + "Halt on
  Failure".
- **Observability writes are aggregate counters and Google API error
  envelopes only** — no event content reaches the audit tables:
  `docs/security-principles.md` Principle 6; `src/CLAUDE.md` →
  "Observability tables (§6 Wave A)" and "Observability tables (§6 Wave
  B)".

## How to use this document

- **OAuth Consent Screen reviewer.** Read §1–§3 in order. Each "Why we
  request" paragraph is the public posture and "Data minimum" enumerates
  the implementation envelope. The pointers prove the claims at their
  canonical source.
- **Marketplace reviewer.** Read alongside `docs/marketplace-readiness.md`
  §2 status table; this file is the artifact behind the three
  `Justification` rows (`calendar` / `calendar.events` / `userinfo.email`).
  §4 is the cross-cutting defense surface that backstops all three.
- **New contributor.** This file does not redefine scope rules — it
  indexes them. To change a justification, edit the canonical source
  (almost always `src/config/constants.ts` or
  `docs/security-principles.md`) first, then update the pointer here in
  the same PR. A pointer that lags its canonical source is a review
  hazard.

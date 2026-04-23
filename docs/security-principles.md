# Security & Compliance Principles

> This document is an **index** to the security, privacy, and compliance
> invariants enforced by AutoColor for Calendar. Each principle below states
> what the app promises and points at the canonical source of that promise in
> the codebase. The contract body lives only at the pointer — if you need to
> change a rule, edit the canonical source first and then update the pointer
> here. Do not restate contracts inside this document; the duplication will
> drift.
>
> Audience: Marketplace reviewers (§7), incident responders, and new
> contributors who need a single surface to reason about the security posture
> before diving into module-level rules.

## Scope

In scope:
- Runtime invariants that affect user data confidentiality, integrity, or the
  authentication surface.
- Operational invariants that prevent observability or retry paths from
  silently leaking user content or wasting Google API quota.

Out of scope (intentionally):
- The Privacy Policy / Terms of Service required for Google Workspace
  Marketplace submission. Those are separate legal artifacts tracked under
  §7 and are not indexed here.
- Rate-limiting as a throttling policy. The one rate-limit-like invariant
  that exists (`/sync/run` button-spam coalesce, §6.4) is cross-listed under
  Audit & Observability Discipline because its correctness is about telemetry
  columns and consumer isolation, not throttling.
- Full-text restatement of the contracts. This document only names them and
  points at their canonical location.

## Principle 1 — Data Minimization

**Promise.** The service collects and stores only what it needs to classify
calendar events and to prove the user authorized the app. Request and
response bodies are never written to the log stream, and sensitive
query-string parameters are redacted before any log line is emitted.

**Canonical pointers.**
- `src/CLAUDE.md` → `Log redaction contract`. The middleware deliberately
  omits request/response bodies and request headers from the log stream by
  construction; there is no allowlist to extend.
- `src/middleware/logger.ts`. Query-string redactor. The authoritative field
  list (`authorization`, `token`, `code`, `state`, `refresh_token`,
  `access_token`, `id_token`, `email`, `sub`, `password`) is declared in
  `src/CLAUDE.md` — the code references the same set.
- `src/CLAUDE.md` → `Observability tables (§6 Wave A)` and
  `Observability tables (§6 Wave B)`. The four audit surfaces
  (`sync_failures.summary_snapshot`, `llm_calls`, `rollback_runs`,
  `sync_runs`) store aggregate counters and error envelopes only — no event
  body fields ever reach these tables.

**If this is broken.** A calendar event's summary, description, location, or
attendee emails could end up in logs, DLQ audit rows, or dashboards. Under
Google Workspace Marketplace terms this is a reportable data exposure even
when the log stream is private.

## Principle 2 — PII Masking

**Promise.** Before any calendar event field crosses the boundary into the
LLM leg of the classifier, personal identifiers (emails, URLs, phone numbers)
are token-replaced. Structured person fields (`attendees[].email`,
`creator.email`, `organizer.email`) are removed by destructure-and-omit, not
by regex. The LLM prompt builder whitelists only `summary`, `description`,
and `location` — everything else is dropped upstream of the HTTP call. Error
messages from Google API failures surface `status` / `reason` / operation
name only and never include the response body.

**Canonical pointers.**
- `src/services/piiRedactor.ts` (§5.2). `redactEventForLlm(event)` is the
  pure function every LLM-bound event must pass through. The `SECURITY`
  header comment in the file carries the "DO NOT LOG OUTPUT" and regex-clone
  footgun notice.
- `docs/architecture-guidelines.md` → `Hybrid Classification Engine` bullet.
  Declares that PII redaction is mandatory and non-bypassable before any LLM
  call.
- `src/CLAUDE.md` → `Log redaction contract`. The "Calendar event payloads
  (§4+) must never be logged" paragraph is the shared invariant that
  prevents the redactor's input from ever being persisted elsewhere.
- `src/services/googleCalendar.ts` → `CalendarApiError`. Error messages are
  assembled from `status` / `reason` / op name only; the Google response
  body is never attached. `sync_failures.error_body` stores Google's API
  error envelope, not the event payload that triggered the failure.

**If this is broken.** User content could reach an external LLM provider, a
log aggregator, or a DLQ audit trail. Any of these is a direct violation of
the Workspace Marketplace user data policy and of the app's stated scope
reduction promise to end users.

## Principle 3 — Scope Minimization

**Promise.** The app requests the smallest Google OAuth scope set that still
lets it classify events (`openid`, `email`, `calendar`, `calendar.events`)
and never provisions additional scopes opportunistically. Refresh tokens are
stored encrypted at rest; the plaintext never touches the DB. Local
fallback paths that would broaden effective access (e.g. running sync from a
GAS trigger with the add-on's OAuth context) are explicitly forbidden — if
the backend is unreachable, the user sees an error, not a degraded local
flow.

**Canonical pointers.**
- `src/config/constants.ts` → `OAUTH_SCOPES`. Authoritative list of scopes
  requested at OAuth initiation. `OAUTH_SCOPE_PARAM` is derived from this
  array.
- `src/CLAUDE.md` → `Secret rotation impact` → `TOKEN_ENCRYPTION_KEY`.
  Refresh tokens are stored in `oauth_tokens.encrypted_refresh_token`, keyed
  for rotation via `token_version`.
- `docs/architecture-guidelines.md` → `E2E Backend Mandatory` and
  `Halt on Failure` bullets. Local GAS triggers for syncing or coloring are
  deprecated; on backend failure the flow halts without falling back to
  local rules. (The `invalid_grant` re-login prompt is the narrow documented
  exception — the refresh token is already revoked, so no local escalation
  of privilege is possible.)
- `gas/CLAUDE.md`. The GAS add-on layer delegates all sync and color logic
  to the backend; it does not ship any local-trigger code path that would
  widen the scope envelope at runtime.

**If this is broken.** The consent screen would request more than the user
is told about, a stolen refresh token would be immediately reusable by an
attacker, or a backend outage would silently switch to a less-audited local
execution path. All three are user-data-posture regressions.

## Principle 4 — Tenant Isolation

**Promise.** Every query that touches user-scoped data includes the
tenant's `user_id` in its `WHERE` clause at the application layer. RLS is
enabled on every table as defense-in-depth, but because the Worker connects
as a `BYPASSRLS` role, the application-layer predicate is the sole live
enforcer of tenant isolation in the hot path.

**Canonical pointers.**
- `src/CLAUDE.md` → `Tenant isolation`. States the rule and explains why
  RLS alone is insufficient on the Worker path.
- `drizzle/0001_rls.sql`. The RLS policy set that serves as the
  defense-in-depth layer for Studio / `supabase-js` access patterns.
- Drizzle query sites across `src/routes/*.ts`, `src/services/*.ts`,
  `src/queues/*.ts`. Each tenant-scoped query pairs `user_id` with its
  additional keys (e.g. `(user_id, calendar_id)` for `sync_state`).

**If this is broken.** A single missing `user_id` in a new query would leak
one tenant's sync state, categories, or OAuth tokens into another tenant's
response. RLS on the Worker path does not catch this — the tests and code
review have to.

## Principle 5 — Secret Hygiene

**Promise.** Application secrets are provisioned and rotated through an
audited script path. The blast radius of each secret is documented, so that
a rotation is always a conscious operational decision, not a surprise. The
Supabase connection string never surfaces on the Worker itself — only
Hyperdrive knows the origin credentials.

**Canonical pointers.**
- `src/CLAUDE.md` → `Secret rotation impact`. The authoritative matrix of
  what breaks when each of the three Worker secrets (`SESSION_PEPPER`,
  `TOKEN_ENCRYPTION_KEY`, `SESSION_HMAC_KEY`) is rotated, and the
  separate Hyperdrive update procedure for the Supabase DB password.
- `scripts/gen-secrets.ts` (§3.6a). Generates and injects the three Worker
  secrets per environment.
- `scripts/sync-secrets.ts`. Per-environment reconciliation of the Worker
  secret set against a team backup store. Optional secrets (like
  `OPENAI_API_KEY`, `LLM_DAILY_LIMIT`) are handled separately so absence
  does not block deploy.
- `src/CLAUDE.md` → `DB connectivity`. Records why `DIRECT_DATABASE_URL`
  must never become a Worker secret: migrations run locally through the
  Session Pooler, and the Worker path stays behind Hyperdrive.

**If this is broken.** An un-documented rotation logs every user out
(`SESSION_PEPPER`), bricks token refresh (`TOKEN_ENCRYPTION_KEY` without the
re-encryption batch), or exposes the origin DB credentials to the Worker
runtime. Each has a different, large incident scope — hence the explicit
matrix.

## Principle 6 — Audit & Observability Discipline

**Promise.** Telemetry writers never cause the underlying user-facing work
to retry. Sync, color-rollback, and LLM telemetry are written
fire-and-forget — an observability DB failure downgrades to a warn log, it
never flips a Queue message from `ack` to `retry`. Retried sync or rollback
jobs re-issue Google API calls, so driving that loop from an audit write is
a quota and correctness hazard. Telemetry tables store aggregate counters
and Google error envelopes only; no event content ever crosses into them.
Observable state changes that could look rate-limit-like (e.g. the 30-second
`POST /sync/run` coalesce window) are deliberately not hard rate limits —
they absorb button spam, and the consumer's own claim-release invariants
serialize actual work.

**Canonical pointers.**
- `src/CLAUDE.md` → `Observability tables (§6 Wave A)`. Contract for
  `sync_failures.summary_snapshot`, `llm_calls`, and `rollback_runs`.
  Includes the fire-and-forget / `.catch(warn)` discipline and the PII
  stance for each table.
- `src/CLAUDE.md` → `Observability tables (§6 Wave B)`. Contract for
  `sync_runs` and the reader surface `/api/stats`. Documents the
  `finalize(result)` routing invariant and the intentional duplication
  with `sync_state.last_run_summary`.
- `src/CLAUDE.md` → `Manual-trigger rate limit (§6.4)`. Documents why the
  consumer must never write `sync_state.last_manual_trigger_at`, why the
  SELECT/UPDATE is deliberately non-atomic, and why this is button-spam
  absorption rather than a hard rate limit.
- `src/CLAUDE.md` → `Color ownership marker (§5.4)`. Documents why the
  `autocolor_*` keys under `extendedProperties.private` are app metadata
  (not PII), which makes them safe to include in debug paths even though
  the broader calendar-event payload logging ban still applies to the event
  body surrounding them.
- `docs/architecture-guidelines.md` → `Halt on Failure` bullet. The wider
  contract that observability paths ride on — the sync pipeline does not
  silently degrade to a local fallback when the backend is unreachable, so
  an observability anomaly cannot mask a real incident by triggering a
  local rule path.

**If this is broken.** The most common failure mode is an observability
write error forcing a Queue retry, which re-fires Google API calls and
double-counts telemetry. The second is event body content leaking into
`sync_failures`, `llm_calls`, `rollback_runs`, or `sync_runs` — covered
by Principle 1 (Data Minimization) but re-listed here because the discipline
is enforced at the telemetry writer, not at the log redactor.

## How to use this document

- **Marketplace review.** Each principle's "promise" paragraph is the public
  posture statement. The pointers are the proof. A reviewer who wants to
  verify a claim follows the pointer and reads the contract at its canonical
  location.
- **Incident response.** Walk the principles in order. Each has a "if this
  is broken" paragraph that summarizes the blast radius, so the on-call can
  decide whether to page, rotate, or retry.
- **New contributor onboarding.** Read this file end-to-end, then read the
  canonical pointers it names. The pointers are the source of truth; this
  file should be the fastest way to find the right one.
- **Changing a rule.** Edit the canonical source (almost always
  `src/CLAUDE.md`, `docs/architecture-guidelines.md`, or a module-level
  `CLAUDE.md`). Then, in the same PR, update the pointer and the
  promise/blast-radius paragraph here if the change moved the semantics. If
  this document lags the canonical source, readers will draw wrong
  conclusions during an incident.

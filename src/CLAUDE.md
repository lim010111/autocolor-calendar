# Backend Module — Operational Rules (autocolor backend)

This module runs as the Cloudflare Worker `autocolor-{dev,prod}`, backed by
Supabase (PostgreSQL). The rules below are non-obvious invariants
that you must not break when extending this directory. They supersede general
style advice; see `@docs/architecture-guidelines.md` for cross-cutting rules.

## Tenant isolation

RLS policies exist on every table (`drizzle/0001_rls.sql`) but **they do not
protect the Worker path**. The Worker connects through Hyperdrive → Supabase
pooler as the `postgres` role, which has `BYPASSRLS`. The policies are
defense-in-depth for Studio / future `supabase-js` clients.

Every query that touches user-scoped data **must** include
`where(eq(table.user_id, ctx.userId))` — or the equivalent compound key for
tables keyed on `(user_id, ...)`. Never rely on "RLS will catch it."

## DB connectivity

- Runtime path: Hono → `getDb(c.env)` → postgres.js against
  `env.HYPERDRIVE.connectionString`. The Worker never sees the origin DB
  credentials — those live in the Hyperdrive config.
- Pool settings (`prepare: false`, `max: 1`, `idle_timeout: 0`,
  `fetch_types: false`) are deliberate: postgres.js's defaults burn through
  the Worker subrequest budget during the Supabase pooler handshake, and
  `prepare: false` is mandatory because Supabase's pooler disallows server-
  prepared statements. Don't raise `max` or enable prepares without re-
  testing `/me` and `/oauth/google/callback` under load.
- Always wrap DB work in `try { ... } finally { c.executionCtx.waitUntil(close()); }`
  so the socket is released after the response.
- Migrations run locally with `pnpm db:migrate`, using
  `DIRECT_DATABASE_URL` from `.dev.vars` (Supabase Session Pooler, port 5432,
  IPv4). Never inject `DIRECT_DATABASE_URL` as a Worker secret.

## GAS deployment URL must stay stable

The Worker redirects OAuth results to `env.GAS_REDIRECT_URL`, which points at
the GAS web app `/exec`. Do not create a **new** deployment for GAS code
changes — it mints a fresh `/exec` URL and every Worker secret / GCP
authorized redirect / Script Property needs rewiring.

Instead: **GAS editor → Deploy → Manage deployments → pencil/edit on the
existing deployment → Version: "New version" → Deploy**. This publishes the
code under the same `/exec` URL.

## Secret rotation impact

- `SESSION_PEPPER`: all `sessions.token_hash` values become unverifiable →
  every logged-in user is logged out on next request. Expect a re-auth spike;
  schedule rotation outside peak hours.
- `TOKEN_ENCRYPTION_KEY`: every `oauth_tokens.encrypted_refresh_token` row
  stops decrypting. A full re-encryption batch is required (iterate rows,
  decrypt with the old key, encrypt with the new one, bump `token_version`).
  The batch job is a Section 6 (observability) deliverable — do **not** rotate
  this key before that job exists.
- `SESSION_HMAC_KEY`: in-flight OAuth state values fail verification → only
  users mid-login are affected; existing sessions keep working.
- Supabase DB password: update the Hyperdrive origin via
  `wrangler hyperdrive update <id> --connection-string=...`. The Worker
  reconnects on next request.

## Log redaction contract

`src/middleware/logger.ts` redacts these field names when they appear as
**query-string parameters** before emitting each JSON log line:

`authorization`, `token`, `code`, `state`, `refresh_token`, `access_token`,
`id_token`, `email`, `sub`, `password`

The middleware deliberately does not read or log request/response bodies —
that keeps refresh tokens, opaque session tokens, and PII out of the log
stream by construction. If a future route needs body-level diagnostics, add
a body-scoped redactor that covers the same field set and keep the response
body out of the log. Request headers are also excluded because `Authorization:
Bearer …` tokens would otherwise be captured.

**Calendar event payloads (§4+) must never be logged.** The sync consumer
(`src/queues/syncConsumer.ts`) and `src/services/calendarSync.ts` receive
raw `events.list` responses whose `summary`, `description`, `location`,
`attendees`, `creator`, and `organizer` fields are PII. Log only aggregate
counters (`SyncSummary`) and event IDs/status. Error messages from
`CalendarApiError` are built to include only `status`/`reason`/op name, never
the response body. `sync_failures.error_body` stores Google's API error
envelope only — never the event payload that triggered the failure.

## Color ownership marker (§5.4)

When the sync pipeline PATCHes an event color (`src/services/calendarSync.ts`
→ `patchEventColor` in `src/services/googleCalendar.ts`), it writes three keys
under `extendedProperties.private`. Constants live at the top of
`googleCalendar.ts` as `AUTOCOLOR_KEYS` / `AUTOCOLOR_MARKER_VERSION` —
**reference the constants, never the literal strings**:

- `autocolor_v` — schema version. Currently `"1"`. Bump only when the
  meaning of the other keys changes; readers should treat unknown versions
  as opaque (skip rather than misinterpret).
- `autocolor_color` — the colorId this code wrote at the time of PATCH.
  This is the **ownership probe**: on the next sync, if the event's
  `colorId` no longer equals this value, the user changed it after us and
  we must treat the event as manual.
- `autocolor_category` — the categoryId that drove the color choice.
  Read by the rule-deletion rollback (`src/services/colorRollback.ts`):
  `DELETE /api/categories/:id` enqueues one `color_rollback` queue job
  per calendar in `sync_state`, and the consumer filters
  `events.list` with `privateExtendedProperty=autocolor_category=<id>`
  before PATCHing `colorId: null` + three `null` markers on events that
  pass the §5.4 ownership check (marker color still equals current
  color). **Rollback policy:** deleted-rule events revert to Google's
  default color, not to a user's pre-app original. Restoring an
  arbitrary original color would require a fourth key
  (e.g. `autocolor_prev_color`) that §5.4 deliberately does not
  capture. If product later wants true original-color restore, the
  rollback path must add that key and accept that events colored before
  the change cannot be perfectly restored.

### Concurrent PATCH race

If two devices / a webhook delivery race against an in-flight sync, the
last writer wins. This is intentional: Google's `events.patch` exposes
no `If-Match` ETag flow on `colorId`, and the next sync will re-evaluate
either way (idempotent reconciliation). Do **not** add optimistic
concurrency for this — observed-not-prevented is the correct policy.
Brief flicker between writers is benign and self-heals on the next
incremental sync.

Google's `events.patch` merges `extendedProperties.private` per-key —
other apps' keys on the same event are preserved. Conversely, **never write
a key under the `autocolor_*` prefix from any other code path** without
bumping `autocolor_v`; doing so would silently corrupt ownership decisions
on the next sync. If a future migration needs to change marker semantics,
add a new schema version (`"2"`), update the reader to switch on version,
and write a one-shot job to upgrade existing events.

`extendedProperties.private` is **app metadata, not user PII** — it is
never logged anyway (calendar event payloads are excluded from logs by the
contract above), but it would be safe to include in error messages if a
future debug path needed it. The PII redactor for the LLM leg
(`src/services/piiRedactor.ts`) does not touch this field because the LLM
prompt builder whitelists only `summary`/`description`/`location` (§5.3).

## Observability tables (§6 Wave A)

Three storage surfaces landed together so dashboards and runbooks have data to
read once they ship. No UI / rollup endpoints in this wave — schema + writers
only.

### `sync_failures.summary_snapshot` + `sync_state.last_failure_summary`

DLQ rows now carry the `SyncSummary` of the last failed attempt. Flow:

1. `applyResult` (syncConsumer) writes `result.summary` to
   `sync_state.last_failure_summary` on every retryable failure alongside
   `lastError` / `lastErrorAt`.
2. Successful sync runs (`calendarSync.runPagedList`) clear
   `last_failure_summary: null` in the same UPDATE that stamps
   `last_run_summary` — both the full-sync-complete branch and the mid-chunk
   branch. Missing the clear would leave a stale snapshot for an unrelated
   future DLQ landing.
3. When a retried message finally dies, `handleDlqBatch` SELECTs
   `last_failure_summary` for the (user, calendar) pair and copies it into
   `sync_failures.summary_snapshot`. Absent row or SELECT error → `null`
   snapshot; we never drop the DLQ audit row over a failed snapshot read.

The summary is **aggregate counters only** — no Calendar event content — so
this field respects the calendar-event-payload logging ban.

### `llm_calls`

Per-call LLM telemetry promoted from the four `SyncSummary.llm_*` counters.
Written as a single bulk INSERT at sync-run end, not per event:

- `classifyWithLlm` emits one `LlmCallRecord` via `deps.onCall` before every
  return (all outcomes covered by a `finish()` helper — adding a new outcome
  without routing through `finish()` would silently drop a row).
- `classifierChain` forwards the record to its own `onLlmCall` callback and
  synthesizes a record for the quota-latched short-circuit path
  (`latencyMs: 0`, `attempts: 0`) so "we wanted to call the model" is still
  observable.
- `runPagedList` buffers records into a per-run array; on the way out — via
  a `try { ... } finally { flushLlmCalls() }` that wraps the entire body —
  it calls `ctx.recordLlmCalls?.(buffer)` exactly once. Every return path
  (success, retryable, reauth, forbidden, not_found, full_sync_required)
  flows through the finally, so the record stream is never lost on early
  failures.
- `syncConsumer.handleOne` injects the hook with
  `execCtx.waitUntil(db.insert(llmCalls).values(rows).catch(warn))` —
  fire-and-forget so response latency is unaffected, and a DB write failure
  only downgrades to a warn log. **Observability writes must never cause
  the sync itself to retry.**

PII stance: `category_name` is the user's own category name (not PII).
`outcome`, `latency_ms`, `category_count`, `attempts`, `http_status` are pure
telemetry. No event content crosses this boundary — the whitelist in
`buildPrompt` and the `redactEventForLlm` call happen upstream of the record
emission.

### `rollback_runs`

`color_rollback` queue job audit log. Written by `applyRollbackResult` before
`msg.ack` / `msg.retry`. **All outcomes** (`ok` / `reauth_required` /
`forbidden` / `not_found` / `retryable`) insert a row with `attempt =
msg.attempts`, so a "retry then DLQ" sequence is visible as multiple rows
with increasing attempt numbers. Same error-isolation discipline as
`llm_calls`: insert errors land in a warn log and **never trigger
`msg.retry`**, because a retried rollback re-issues `clearEventColor`
PATCHes on already-cleared events and costs Google API quota.

`category_id` deliberately has no FK — the trigger for a rollback is the
category being deleted, so the target is already gone by write time.
`error_message` carries only the Google API error shape
(`status/reason/op`), consistent with the `sync_failures.error_body`
contract.

## Environments

- `dev`: `autocolor-dev` Worker, `autocolor-dev-db` Hyperdrive, full secrets.
- `prod`: `autocolor-prod` Worker is a **URL-reserving shell**. It has
  `GOOGLE_OAUTH_REDIRECT_URI` configured and answers `/healthz`, but has no
  secrets, no Hyperdrive binding, and no Supabase project yet. `/oauth/*`,
  `/me`, `/auth/logout` will fail until a prod Supabase project, GCP OAuth
  client, and secret bootstrap are added (separate task).

# Sub-processors Disclosure

> This document is the sub-processors disclosure required by Google
> Workspace Marketplace admin review (and by `docs/marketplace-readiness.md`
> §3 status table — the `Sub-processors list` row). It enumerates the
> third-party processors AutoColor for Calendar relies on, the role each
> plays in the runtime, the data envelope each receives, and the canonical
> contract pointers proving the envelope claim. Pair with
> `docs/security-principles.md` Principle 1 (Data Minimization),
> Principle 2 (PII Masking), Principle 4 (Tenant Isolation), and
> Principle 5 (Secret Hygiene); the body of each contract lives at the
> canonical pointer and is not restated here.
>
> Audience: Workspace Marketplace admin reviewers, the launch owner
> verifying §3 status freshness, and incident responders who need to know
> which processor sees which surface.
>
> Region cells in the table and per-processor blocks below all defer to
> the `Processing region` row in `docs/marketplace-readiness.md` §3
> status table — that row is the canonical statement of where each
> processor's data resides and is tracked separately because Marketplace
> review treats region as its own disclosure surface.

## Scope

In scope:

- The three third-party processors AutoColor for Calendar transmits user
  data to: Cloudflare (Workers + Hyperdrive + Queues), Supabase (managed
  PostgreSQL), OpenAI (`gpt-5.4-nano` LLM fallback).
- The data envelope our service transmits to each — what crosses the
  boundary, in what shape, after what defenses.

Out of scope (intentionally):

- Vendor-side data handling, retention, and operator access for each
  sub-processor — governed by the respective vendor's Terms of Service /
  Data Processing Addendum, not by this repository.
- Privacy Policy / Terms of Service body — separate legal artifacts
  (`docs/marketplace-readiness.md` §1 row).
- Region statement for each processor — separate row in
  `docs/marketplace-readiness.md` §3 status table (`Processing region`,
  currently `초안`; substantive disclosure at
  `docs/assets/marketplace/processing-region.md`).
- Retention policy — separate row in `docs/marketplace-readiness.md` §3
  status table (`Retention policy`, currently `미작성`; depends on
  `pg_cron` session GC, see `TODO.md` §3 후속).
- Account-deletion endpoint — separate row in
  `docs/marketplace-readiness.md` §3 status table (`Deletion on account
  revoke`, currently `초안`).
- Google itself (the data subject's own platform — Calendar API, OAuth
  IdP, Apps Script Add-on runtime). Google is the source of the data
  this app processes, not a downstream sub-processor in the Marketplace
  reviewer sense.

## Summary

| Sub-processor | Role | Data envelope | Region |
|---|---|---|---|
| **Cloudflare** | Edge runtime + DB connection broker (Hyperdrive) + queue substrate (Queues + DLQ) + scheduled-trigger runner | Calendar event payloads in transit only; queue messages are job descriptors; DLQ rows are Google API error envelopes | See §3 `Processing region` row |
| **Supabase** | Managed PostgreSQL — OAuth tokens (encrypted at rest), sync state, observability counters, sessions | Aggregate counters / sync state / categories / encrypted refresh tokens / error envelopes; no calendar event content | See §3 `Processing region` row |
| **OpenAI** | Optional LLM fallback (`gpt-5.4-nano`) for the rule-miss path of the classifier | Three whitelisted fields only (`summary` / `description` / `location`) after PII redaction; not invoked when `OPENAI_API_KEY` is unset | See §3 `Processing region` row |

## §1 — Cloudflare

### Role

Edge runtime hosting the Worker (`autocolor-{dev,prod}`); DB connection
broker (Hyperdrive); queue substrate (Cloudflare Queues — one primary
sync queue plus one dead-letter queue); scheduled-trigger runner
(cron-driven watch-channel renewal).

### Data handled

The Workers runtime processes calendar event payloads **in transit**
during sync (rule evaluation, PII redaction, LLM dispatch); event
content is never persisted to Cloudflare-owned storage. Queue message
bodies are job descriptors only — no event content. DLQ rows carry
Google API error envelopes only (`status` / `reason` / op name).
Hyperdrive proxies DB traffic — origin DB credentials live in
Hyperdrive config and are not visible to the Worker. Operator log
access (`wrangler tail`) returns redacted request metadata only;
request/response bodies and Authorization headers are never written to
the log stream by construction.

### Region / location

See `Processing region` row in `docs/marketplace-readiness.md` §3 status
table (currently `초안`); the substantive disclosure lives at
`docs/assets/marketplace/processing-region.md`.

### Canonical pointers

- `wrangler.toml` — `[[env.dev.hyperdrive]]`,
  `[[env.dev.queues.producers]]`, `[[env.dev.queues.consumers]]`,
  `[env.dev.triggers]` blocks declare the bound surfaces.
- `src/CLAUDE.md` → `DB connectivity` — Hyperdrive → Supabase pooler
  posture; the Worker never sees origin DB credentials.
- `src/CLAUDE.md` → `Observability tables (§6 Wave A)` — DLQ row stance
  (`sync_failures.error_body` carries Google API error envelopes only,
  not event payloads).
- `src/CLAUDE.md` → `Log redaction contract` — query-string redactor
  field set + the body/header logging ban that backs the operator-log
  claim above.
- `docs/security-principles.md` → `Principle 1 — Data Minimization`
  (log-stream contents) and `Principle 5 — Secret Hygiene` (Hyperdrive
  holds origin DB credentials, not the Worker).

## §2 — Supabase

### Role

Managed PostgreSQL backing all persistent state — OAuth tokens
(encrypted at rest), sync state, observability counters, and sessions;
reached only via Hyperdrive from the Worker path. The full table
enumeration lives at the canonical pointer
(`src/CLAUDE.md` → `Observability tables (§6 Wave A)` /
`(§6 Wave B)`); not restated here.

### Data handled

`oauth_tokens.encrypted_refresh_token` is encrypted at rest with
`TOKEN_ENCRYPTION_KEY`. Other tables hold aggregate counters / sync
state / categories / error envelopes — no calendar event content. RLS
policies exist on every table as defense-in-depth; the Worker connects
through Hyperdrive as the `postgres` role (`BYPASSRLS`), so the
application-layer `where(user_id)` predicate is the live tenant
isolation enforcer.

### Region / location

See `Processing region` row in `docs/marketplace-readiness.md` §3 status
table (currently `초안`); the substantive disclosure lives at
`docs/assets/marketplace/processing-region.md`.

### Canonical pointers

- `src/CLAUDE.md` → `Tenant isolation` — `BYPASSRLS` posture and the
  `where(user_id)` invariant.
- `src/CLAUDE.md` → `Secret rotation impact` — `TOKEN_ENCRYPTION_KEY`
  blast radius and rotation procedure.
- `drizzle/0001_rls.sql` — RLS policy set (defense-in-depth surface).
- `docs/security-principles.md` → `Principle 4 — Tenant Isolation` and
  `Principle 5 — Secret Hygiene`.

## §3 — OpenAI

### Role

Optional LLM fallback for the rule-miss path of the classifier. Model:
`gpt-5.4-nano`.

### Data handled

Three whitelisted fields only (`summary`, `description`, `location`),
each token-replaced for emails / URLs / phone numbers before transmission.
Structured email fields (`attendees[].email`, `creator.email`,
`organizer.email`) are removed by destructure-and-omit upstream of the
HTTP call. A per-user daily quota gate (`llm_usage_daily`, default 200
calls, `LLM_DAILY_LIMIT` runtime override) caps invocation volume.

### Conditional / optional

When `OPENAI_API_KEY` is unset, the LLM call is skipped entirely — the
event lands as `no_match` and no request reaches OpenAI. Quota
exhaustion, network errors, malformed responses, and missing key all
collapse identically into `no_match`; per-outcome telemetry lands in
`llm_calls`.

### Region / location

See `Processing region` row in `docs/marketplace-readiness.md` §3 status
table (currently `초안`); the substantive disclosure lives at
`docs/assets/marketplace/processing-region.md`.

### Canonical pointers

- `src/services/llmClassifier.ts` — `LLM_MODEL` constant
  (`gpt-5.4-nano`); `OPENAI_API_KEY` gate; `reserveLlmCall` daily-quota
  enforcement.
- `src/services/piiRedactor.ts` — `redactEventForLlm` is the pure
  function every LLM-bound event passes through.
- `docs/security-principles.md` → `Principle 2 — PII Masking`.
- `docs/architecture-guidelines.md` → `Hybrid Classification Engine`
  bullet — declares PII redaction mandatory and non-bypassable before
  any LLM call.

## §4 — Vendor-side handling

This disclosure covers only the data envelope our service transmits to
each sub-processor. Vendor-side data handling, retention windows, and
operator access for Cloudflare, Supabase, and OpenAI are governed by the
respective vendor's Terms of Service and Data Processing Addendum;
readers verify those policies at the vendor's own published source. No
external links are inlined here — vendor policies change independently
of this repository, and an out-of-date inline summary would mislead
faster than it would inform.

## How to use this document

- **Workspace Marketplace admin reviewer.** Read the summary table
  first; then §1–§3 in order for the per-processor envelope claim and
  the canonical pointers proving it. §4 names the boundary between this
  disclosure (what we transmit) and vendor-side governance (what each
  vendor does after receipt).
- **Launch owner verifying §3 status freshness.** This file is the
  artifact behind `docs/marketplace-readiness.md` §3 status table's
  `Sub-processors list` row. Region / Retention / Deletion are tracked
  in their own §3 rows and are out of scope here.
- **Incident responder.** Use the per-processor `Data handled` blocks to
  scope blast radius — the envelope claim names what each processor
  could plausibly hold of user data. Operator log access for Cloudflare
  is bounded by `src/CLAUDE.md` → `Log redaction contract`.
- **New contributor / changing a processor.** This file does not define
  the contracts — it indexes them. To change what crosses any boundary,
  edit the canonical source (`src/services/piiRedactor.ts`,
  `src/services/llmClassifier.ts`, `wrangler.toml`, or the relevant
  `src/CLAUDE.md` section) first, then update the pointer here in the
  same PR. A pointer that lags its canonical source is a review hazard.

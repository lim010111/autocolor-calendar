# Processing Region Disclosure (placeholder)

> This document is the source-of-truth artifact behind
> `docs/marketplace-readiness.md` §3 row 176 (`Processing region`). It is a
> **thin placeholder**, not a concrete per-processor region table:
> Cloudflare Workers run on a global edge fabric with no region pin,
> OpenAI's processing region is governed by the vendor's published policy,
> and the Supabase prod region statement is held back behind `TODO.md` §3
> 후속 "Prod 환경 활성화" until that gate clears.
>
> Audience: Workspace Marketplace admin reviewers verifying §3 status, the
> launch owner tracking row 176 freshness, and incident responders
> cross-referencing region questions to the per-processor blocks in
> `sub-processors.md`.

- **Scope:** Region/location of each runtime processor handling user data.
  Placeholder, not a scope or scenario walkthrough.
- **Pre-conditions:** `sub-processors.md` §1-§3 per-processor blocks each
  defer their `Region / location` H3 subsection to this file.

## Cloudflare Workers + Hyperdrive + Queues — global edge, no region pinning

The Workers runtime executes at the nearest Cloudflare edge PoP per request
— no region pin, and `wrangler.toml` carries no `region =` setting. The
bound surfaces declared there (`[[env.dev.hyperdrive]]`,
`[[env.dev.queues.*]]`, `[env.dev.triggers]`) are region-less by
construction. Hyperdrive is similarly an edge proxy with no regional
binding visible to the Worker.

Cross-refs: `wrangler.toml`, `src/CLAUDE.md` "DB connectivity".

## Supabase Postgres — gated to §3 후속 prod activation

Supabase managed Postgres holds all persistent state per `sub-processors.md`
§2. The concrete prod region statement is gated to `TODO.md` §3 후속 "Prod
환경 활성화" — the prod project is not yet provisioned, so this file
states the gating only and does not name a region. Dev-environment region
is intentionally out of scope; admin review concerns the prod surface.

Cross-refs: `TODO.md` §3 후속, `src/CLAUDE.md` "DB connectivity",
`docs/marketplace-readiness.md` §3 row 176.

## OpenAI `gpt-5.4-nano` — vendor-published policy, zero requests when unset

OpenAI is the only sub-processor with a vendor-published processing-region
policy that admins verify at the vendor's source; this file does not
restate it (mirror `sub-processors.md` §4 — vendor policies change
independently of this repository). When `OPENAI_API_KEY` is unset, no LLM
request reaches OpenAI; the rule-miss event lands as `no_match` and the
region question is structurally moot in that configuration.

Cross-refs: `src/services/llmClassifier.ts` (`OPENAI_API_KEY` gate +
daily-quota enforcement), `sub-processors.md` §3.

## Logs / observability — per-request streaming, no central aggregation

Operator log access is `wrangler tail` per-request streaming only;
AutoColor runs no central log aggregator and writes no log warehouse, so
there is no regional log-storage surface to disclose. The redaction
contract (`src/CLAUDE.md` "Log redaction contract") bans request/response
bodies, Authorization headers, and calendar event payloads from the
stream by construction.

Cross-refs: `src/CLAUDE.md` "Log redaction contract",
`sub-processors.md` §1 Canonical pointers.

## Out of scope

- **User-device location.** Data subject's own surface, not a processor
  this disclosure covers.
- **Google Calendar API region.** Governed by Google itself (data subject's
  platform), not a downstream sub-processor — mirror the
  "Google itself" out-of-scope bullet in `sub-processors.md` Scope.
- **Inline vendor URLs.** This file does not hyperlink Cloudflare, OpenAI,
  or Supabase docs (mirror `sub-processors.md` §4 — vendor policies change
  independently). Readers verify region posture at each vendor's own source.

## Submission-time checklist — when the placeholder graduates

- **Flips on this slice landing:** §3 row 176 Status `미작성` → `초안`,
  Source-of-truth pointer to this file. Five stale citations in
  `sub-processors.md` sync to `초안`: four pointing at row 176 (the
  `Region statement for each processor` Out-of-scope bullet plus the three
  per-processor `Region / location` H3 subsections) and one pointing at
  row 179 (the `Account-deletion endpoint` Out-of-scope bullet, stale
  since slice 7 graduated row 179 to `초안`). The three per-processor
  `Region / location` subsections also gain a pointer to this file
  alongside their existing row-176 reference.
- **Does NOT flip:** §5 row "Data handling / Admin answers drafted" stays
  at `초안` (graduation requires every §3 row at `초안+` AND prod
  activation; Retention and Domain-wide install posture remain `미작성`).
  §5 row "Reviewer demo bundle" stays at `초안` (orthogonal). Concrete
  Supabase prod region remains gated to `TODO.md` §3 후속.

### Cross-references

- `wrangler.toml` — no `region =` setting in the bound-surface blocks.
- `src/CLAUDE.md` "DB connectivity" — runtime anchor for the Cloudflare
  and Supabase blocks above.
- `src/CLAUDE.md` "Log redaction contract" — runtime invariant backing
  the Logs / observability block.
- `docs/assets/marketplace/sub-processors.md` §1 / §2 / §3 "Region /
  location" subsections — the three deferring sites pointing at this
  file.
- `docs/marketplace-readiness.md` §3 row 176 — the row this file is now
  Source-of-truth for.
- `docs/marketplace-readiness.md` §5 row "Data handling / Admin answers
  drafted" Launch Gate — gate this slice approaches but does not
  graduate.
- `TODO.md` §3 후속 "Prod 환경 활성화" — gates the concrete Supabase
  region statement.

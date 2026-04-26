# AutoColor Reviewer Demo Bundle

> This bundle is the reproducible walkthrough required by Google OAuth
> Consent Screen verification (and indexed at `docs/marketplace-readiness.md`
> §4). Each scenario file demonstrates a sensitive scope being exercised —
> what the reviewer does, what the Add-on shows, which Google API call is
> made, and what observable outcome confirms the claim. The per-scope
> justifications (the *why*) live in
> `docs/assets/marketplace/scope-justifications.md`; this bundle is the
> *how it looks in motion* counterpart.
>
> Audience: OAuth Consent Screen reviewers, Google Workspace Marketplace
> reviewers, and the launch owner verifying §4 status freshness.

## How reviewers use this bundle

Run scenarios in order: `08-test-account.md` (credentials) →
`01-install.md` → `02-rule-to-color.md` → `03-event-preview-rule-hit.md`
→ `04-event-preview-ai-fallback.md` → `05-rule-deletion-rollback.md` →
`06-reauth-invalid-grant.md` → `07-account-deletion.md`. Each scenario
is standalone and assumes the test account from `08`.

**Two consent surfaces are exercised by this bundle.** The reviewer will
see scope prompts on two distinct surfaces; the bundle covers both:

- **Marketplace install consent** — granted once when the user installs
  the Add-on from Workspace Marketplace. Lists 7 scopes declared in
  `gas/appsscript.json:5-13` — 5 framework scopes
  (`script.external_request` / `script.locale` /
  `calendar.addons.execute` / `calendar.addons.current.event.read` /
  `calendar.addons.current.event.write`; justifications under
  `docs/assets/marketplace/scope-justifications.md` "Out of scope") plus
  `calendar` and `userinfo.email` (per-scope justifications at
  `docs/assets/marketplace/scope-justifications.md` §1 / §3).
- **Backend OAuth consent** — granted at `01-install.md` Step 3 when the
  user clicks "Google 계정으로 시작하기". Lists the 4 backend scopes from
  `src/config/constants.ts:1-6` (`openid` / `email` / `calendar` /
  `calendar.events`). The two surfaces overlap on `calendar`; the
  Sensitive `calendar.events` scope is unique to this surface and is the
  reason scenarios `02` / `05` exist.

The bundle's scope justifications live in
`docs/assets/marketplace/scope-justifications.md`; this bundle shows each
surface in motion.

## Test account credentials

TBD — shared via secure note at submission time.

Rationale: secrets out of git. This section exists so
`docs/marketplace-readiness.md` §4 "Status" row "Test account credentials"
has a concrete pointer; the actual credentials are conveyed out-of-band
when the verification submission is filed. Owner / submission-time
checklist: `docs/marketplace-readiness.md` §5 "Launch Gate Checklist"
row "Reviewer demo bundle" — the credentials placeholder graduates
to a live secure-note pointer the moment that gate flips to `초안`.

## Sample fixtures

TBD: fixture capture pending.

Future scenarios will reference synthetic test events on the demo
account's primary calendar. Working titles (placeholder dates — these
are illustrative, not literal):

- `"팀 회의 - YYYY-MM-DD HH:MM"` (rule-hit candidate for keyword `회의`)
- `"John 1:1 - YYYY-MM-DD HH:MM"` (LLM-fallback candidate; rule-miss
  unless `1:1` is configured)
- `"점심 식사 - 매주 화요일"` (recurring event, rule-hit on keyword
  `식사`)

**Real-account event captures are forbidden** in this bundle — both
literal screenshots and pasted event payload data. The calendar-event
payload logging ban from `src/CLAUDE.md` "Log redaction contract"
(specifically the "Calendar event payloads (§4+) must never be logged"
paragraph) extends to committed documentation: synthetic strings only.

## Scenario matrix

| Scenario | Scope(s) exercised | File | Status |
|---|---|---|---|
| Install + first-time OAuth | `openid` / `email` / `calendar` / `calendar.events` | `01-install.md` | 초안 |
| Create rule → color applied | `calendar.events` | `02-rule-to-color.md` | 초안 |
| Event-open preview (rule hit) | `calendar.addons.current.event.read` | `03-event-preview-rule-hit.md` | 초안 |
| Event-open AI fallback preview | `calendar.addons.current.event.read` + backend LLM | `04-event-preview-ai-fallback.md` | 초안 |
| Rule deletion → color rollback | `calendar.events` | `05-rule-deletion-rollback.md` | 초안 |
| Re-auth on `invalid_grant` | `calendar` | `06-reauth-invalid-grant.md` | 미작성 |
| Service disconnect / account deletion | all | `07-account-deletion.md` | 미작성 |
| Test account credentials | — | `08-test-account.md` | 미작성 |

Source of truth: `docs/marketplace-readiness.md` §4 "Status" table. This
table is a mirror; on drift, edit `docs/marketplace-readiness.md` first
and re-sync this row, never the reverse.

## Bundle conventions

- **Filename pattern.** `NN-kebab-slug.md`, where `NN` is a 2-digit
  zero-padded ordinal mirroring §4 row order. Reserved slugs:
  `02-rule-to-color.md`, `03-event-preview-rule-hit.md`,
  `04-event-preview-ai-fallback.md`, `05-rule-deletion-rollback.md`,
  `06-reauth-invalid-grant.md`, `07-account-deletion.md`,
  `08-test-account.md`. The 2-digit padding leaves room past 99 without
  re-numbering.
- **Heading depth.** Top-level `# <title>` once per file; `## N. <step>`
  for numbered steps; `### <subsection>` for `Failure modes` /
  `Cross-references` and similar.
- **Required scenario sections.** Every scenario file MUST include:
  - Scopes-exercised callout (front-matter bullet).
  - Pre-conditions callout.
  - Numbered steps (`## N.`), each with reviewer action / surface /
    backend or Google API call / observable outcome.
  - Exact in-product copy quoted with a `gas/addon.js:LINE` (or
    sibling) citation so a future grep finds drift.
  - Backend-route citations as `src/routes/<file>.ts:LINE`.
  - `### Failure modes` subsection.
  - `### Cross-references` subsection.
- **No markdown links.** Plain-text path:line pointers only — matches
  the style of `scope-justifications.md` and `sub-processors.md`.
- **No real Calendar event payloads.** Synthetic fixtures only;
  real-account screenshots forbidden. Cite `src/CLAUDE.md` "Log
  redaction contract" if a future contributor proposes otherwise.
- **Sub-directory threshold.** Bundles under `docs/assets/marketplace/`
  stay flat (single file alongside siblings) unless they cross 3+
  files; this bundle crosses that threshold by spec, hence the
  `reviewer-demo/` directory. The flat siblings
  (`scope-justifications.md`, `sub-processors.md`) stay flat unless
  they grow comparably.

## Cross-references

- `docs/marketplace-readiness.md` §4 "Reviewer Demo Scenarios" — the
  index this bundle backs.
- `docs/add-on-ui-plan.md` — Add-on UI screen designs (referenced per
  scenario).
- `docs/architecture-guidelines.md` "Halt on Failure" — the policy that
  scenario `06-reauth-invalid-grant.md` exercises (`invalid_grant` is
  the documented narrow exception to halt-on-failure).
- `docs/assets/marketplace/scope-justifications.md` — per-scope
  justification text (the *why* for each scope this bundle exercises).
- `docs/security-principles.md` Principle 3 — Scope Minimization. The
  conceptual anchor this bundle proves: each requested scope maps to a
  specific scenario whose absence would justify removing the scope.
- `gas/appsscript.json:5-13` — Marketplace-install scope manifest (the
  first consent surface).

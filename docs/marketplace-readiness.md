# Marketplace Readiness Checklist

> This document is an **index** to the artifacts required for Google Workspace
> Marketplace listing approval and OAuth Consent Screen verification. Each
> section states what will be submitted, points at the canonical source of the
> artifact in the repo (or flags it as TBD), and carries a **status table**
> tracking progress. The substance of contracts and legal text lives at the
> pointer, not here — duplicating it drifts.
>
> Audience: Workspace Marketplace reviewers, the launch owner, and contributors
> looking for a single surface that roll up `TODO.md` §1 and §7 launch gates.
> Paired with `docs/security-principles.md` — that file covers runtime
> invariants, this one covers submission artifacts. Neither restates the other.

## Scope

In scope:
- Artifacts Google requires for Workspace Marketplace listing approval (app
  identity, branding, descriptions, support surface, developer identity).
- Artifacts required for OAuth Consent Screen verification (scope
  justifications, restricted-scope demo video, home / privacy / ToS URLs).
- The Admin-facing summary of data handling that a Workspace domain admin
  reads before approving a domain-wide install.
- Reviewer demo scenarios that exercise each sensitive / restricted scope.
- A go / no-go launch gate roll-up joining the above to infrastructure gates
  in other `TODO.md` sections.

Out of scope (intentionally):
- Runtime security / privacy / compliance invariants. Those live in
  `docs/security-principles.md` as six indexed principles; this file points at
  them from §2 and §3 but never restates.
- Verbatim body of the Privacy Policy or Terms of Service. Those are separate
  legal artifacts at TBD URLs; this file tracks their existence and status
  only.
- Runtime operational contracts (log redaction, observability, color marker,
  secret rotation, rate-limit / concurrency locks). Those live in
  `src/CLAUDE.md`; pointed at, never restated.
- §4 Watch API lifecycle, §5 classification pipeline semantics, and §6
  observability rollups. Pointed at where relevant.

## 1. Marketplace Listing Assets

### Promise

Submit the Marketplace listing with a complete asset bundle — app display
name, short and long descriptions, icon at every required resolution,
promotional screenshots and optional video, category, developer / publisher
identity, and support contact. Every asset has a single source-of-truth
location in the repo or in the team's shared asset store; this section is
only the index.

### Canonical pointers

- App identity in code: `gas/appsscript.json:16` (`addOns.common.name =
  "AutoColor"`), `gas/appsscript.json:17` (placeholder `gstatic` `logoUrl` —
  must be replaced with an owned-domain icon before submission).
- Home-card copy baseline: `gas/addon.js:100-113` (3-step tutorial) and
  `docs/add-on-ui-plan.md` (screen-by-screen copy source of truth).
- Owned-domain gate: `TODO.md:8` (§1 — domain acquisition + Search Console
  verification). Gates the support URL and the webhook URL.
- Prod deployment gate: `TODO.md:35` (§3 후속 "Prod 환경 활성화").
- Final icon / screenshots / video assets: **TBD** at
  `docs/assets/marketplace/` (path reserved, not yet created).
- External: Google Workspace Marketplace brand and listing guidelines
  (referenced by stable name).

### Status

| Item | Source of truth | Status | Owner | Notes |
|---|---|---|---|---|
| App display name | `gas/appsscript.json:16` | 완료 | — | "AutoColor" confirmed |
| Short description (KR / EN) | `docs/assets/marketplace/description.md` | 완료 | Product | KR 41자 / EN 65 chars; tone-review pending pre-publish |
| Long description (KR / EN) | `docs/assets/marketplace/description.md` | 완료 | Product | Derived from `docs/add-on-ui-plan.md` Screen 1·2 + `gas/addon.js:95-115` 3-step copy |
| App icon 128×128 / 32×32 | `docs/assets/marketplace/icons/` (8종 일습) | 초안 | Design | 1024 마스터 + 480/128/32/16 + mono-dark/light + source SVG commit 완료. `scripts/generate-marketplace-icons.py`로 재생성. Cloudflare Pages 호스팅 + `gas/appsscript.json:22` `logoUrl` 교체 pending |
| Promotional screenshots (≥ 3) | TBD `docs/assets/marketplace/screenshots/` | 미작성 | Design | Welcome / Home / Rules / Event preview |
| Promotional video (optional) | TBD | 미작성 | Product | Reusable for the §2 restricted-scope demo |
| Category | TBD | 미작성 | Product | Candidate: Productivity |
| Support email | TBD | 미작성 | Ops | Blocked on `TODO.md:8` |
| Support / help URL | TBD | 미작성 | Ops | Blocked on `TODO.md:8` |
| Developer / publisher identity | TBD (GCP project owner) | 초안 | Ops | Tied to `TODO.md:35` prod activation |

## 2. OAuth Consent Screen Verification

### Promise

The consent screen presents the exact scope set the backend requests, with a
per-scope written justification anchored in `docs/security-principles.md`
Principle 3 (Scope Minimization). Submission includes the app home page
URL, privacy policy URL, terms of service URL, authorized domain(s), and —
for each sensitive or restricted scope — a justification paragraph plus a
demo video showing the minimum functionality that requires the scope.
`src/config/constants.ts` is the single source of truth for the backend
scope list; no scope is requested opportunistically.

### Canonical pointers

- Backend scopes: `src/config/constants.ts:1-8` (`openid`, `email`,
  `calendar`, `calendar.events`). `calendar` is Restricted,
  `calendar.events` is Sensitive under Google's current classification.
- GAS-side scopes: `gas/appsscript.json:5-12`.
- Scope minimization contract: `docs/security-principles.md` Principle 3.
- PII redaction gating the LLM leg: `docs/security-principles.md` Principle
  2; `src/services/piiRedactor.ts`.
- E2E backend mandatory (no local trigger fallback that would widen scope
  at runtime): `gas/CLAUDE.md`; `docs/architecture-guidelines.md` →
  "E2E Backend Mandatory" and "Halt on Failure".
- Consent-screen copy placeholder already in the onboarding card:
  `gas/addon.js:119` ("정식 링크는 출시 시점에 제공됩니다") — awaits
  final Privacy Policy and ToS URLs before rewrite.
- Existing TODO gate: `TODO.md:133` (§7 OAuth Consent Screen 검수).

Both `calendar` and `calendar.events` are currently requested. This section
captures current state; any scope reduction is a separate engineering task
and is not adjudicated here.

### Status

| Item | Source of truth | Status | Owner | Notes |
|---|---|---|---|---|
| App home page URL | TBD (owned domain) | 미작성 | Ops | Blocked on `TODO.md:8` |
| Privacy Policy URL | https://legal.autocolorcal.app/privacy | 완료 | Legal | Cloudflare Pages publish 2026-05-05 (`docs/legal/privacy-policy.md` → `dist/legal/privacy.html`) |
| Terms of Service URL | https://legal.autocolorcal.app/terms | 완료 | Legal | Cloudflare Pages publish 2026-05-05 (`docs/legal/terms-of-service.md` → `dist/legal/terms.html`) |
| Authorized domain(s) | TBD | 미작성 | Ops | Must match home / privacy / ToS |
| Scope list (backend) | `src/config/constants.ts:1-8` | 완료 | Eng | Matches `OAUTH_SCOPES` |
| Scope list (GAS manifest) | `gas/appsscript.json:5-12` | 완료 | Eng | |
| `calendar` (Restricted) justification | `docs/assets/marketplace/scope-justifications.md` | 완료 | Eng + Product | Final per `docs/runbooks/06-oauth-verification.md` Step 1 (2026-05-04) |
| `calendar.events` (Sensitive) justification | `docs/assets/marketplace/scope-justifications.md` | 완료 | Eng + Product | Same final review |
| `userinfo.email` justification | `docs/assets/marketplace/scope-justifications.md` | 완료 | Eng | Same final review |
| Demo video (restricted-scope usage) | TBD `docs/assets/marketplace/oauth-verification-video.mp4` | 미작성 | Product | Required by Google's Restricted Scope policy |
| CASA security assessment (if required) | TBD | 미작성 | Ops | Only if Google flags |
| Onboarding-card copy refresh | `gas/addon.js:119` | 완료 | Eng | URL을 `legal.autocolorcal.app/{privacy,terms}` 로 갱신 (2026-05-05). GAS New version 배포 필요. |

## 3. Data Handling Agreement (Workspace Admin Perspective)

### Promise

A Workspace admin evaluating the app for domain-wide installation gets a
concise, truthful statement of what data the app reads, where it is
processed, how long it is retained, who sub-processes it, and how users
exercise deletion. The substance of these answers lives in
`docs/security-principles.md` (Principles 1, 2, 4, 5) and the §6
observability contracts in `src/CLAUDE.md`; this section surfaces them in
Admin-question shape without restating the underlying contracts.

### Canonical pointers

- Data minimization: `docs/security-principles.md` Principle 1.
- PII masking before the LLM leg: `docs/security-principles.md` Principle
  2; `src/services/piiRedactor.ts`. Attendee / creator / organizer email
  fields are destructure-and-omit dropped; only `summary` / `description`
  / `location` cross the LLM boundary after PII token replacement.
- Tenant isolation: `docs/security-principles.md` Principle 4.
- Secret hygiene (refresh-token encryption via `TOKEN_ENCRYPTION_KEY`):
  `docs/security-principles.md` Principle 5.
- Processing infrastructure: `docs/project-overview.md`; `src/CLAUDE.md`
  → "DB connectivity" (Hyperdrive → Supabase pooler, `BYPASSRLS` role).
- Observability writes — aggregate counters and Google error envelopes
  only, never event content: `src/CLAUDE.md` → "Observability tables
  (§6 Wave A)" and "Observability tables (§6 Wave B)" cover
  `sync_failures.summary_snapshot`, `llm_calls`, `rollback_runs`, and
  `sync_runs`.
- Retention hooks: `TODO.md:38` (§3 후속 "세션 GC" — `pg_cron` job not yet
  landed); account-deletion endpoint = **TBD** (no endpoint exists yet).
- Sub-processors by role: Cloudflare (Workers runtime, Hyperdrive edge
  proxy, Queues + DLQ — DLQ rows carry error envelopes, not event
  content), Supabase (managed Postgres), OpenAI (`gpt-5.4-nano` per
  `src/services/llmClassifier.ts`, called only when `OPENAI_API_KEY` is
  provisioned).

### Status

| Admin question | Answer source | Status | Notes |
|---|---|---|---|
| What user data is read? | Principles 1 + 2 | 초안 | Admin-voice phrasing 미작성 |
| What user data is stored? | `src/CLAUDE.md` "Observability tables" | 초안 | Counters and error envelopes only; no event content |
| Processing region | `docs/assets/marketplace/processing-region.md` | 초안 | Thin placeholder; concrete Supabase prod region gated to `TODO.md` §3 후속 |
| Encryption at rest / in transit | Principle 5 + Hyperdrive TLS | 초안 | Refresh tokens encrypted per `TOKEN_ENCRYPTION_KEY` |
| Retention policy | TBD + `TODO.md:38` | 미작성 | `pg_cron` session GC not yet landed |
| Deletion on account revoke | POST /api/account/delete (`src/routes/account.ts`) | 초안 | FK cascade로 9개 테이블 정리 + Google revoke + 세션 무효화. `src/CLAUDE.md` "Account deletion (§3 row 179)" 참조 |
| Sub-processors list | `docs/assets/marketplace/sub-processors.md` | 초안 | Three-row Cloudflare / Supabase / OpenAI disclosure landed; region cells defer to row above |
| LLM data handling | Principle 2 + `src/services/piiRedactor.ts` | 초안 | PII redacted before any LLM call |
| Domain-wide install posture | TBD | 미작성 | Allowed / opt-in decision pending |

## 4. Reviewer Demo Scenarios

### Promise

A Google reviewer receives a reproducible walkthrough: test account
credentials, sample calendar fixtures, step-by-step actions exercising each
sensitive scope, and expected observable outcomes. Scenarios cover the
smallest set that demonstrates why each requested scope is necessary, per
Google's OAuth verification guidance. Bundle lives in a dedicated TBD
directory; this section is the index.

### Canonical pointers

- Onboarding flow: `docs/add-on-ui-plan.md` Screen 1 (Welcome).
- Home / rules / event-preview flows: `docs/add-on-ui-plan.md` Screens
  2–5.
- Halt-on-failure and re-auth UX: `docs/architecture-guidelines.md` →
  "Halt on Failure" (notes the narrow `invalid_grant` re-login exception
  — the only documented surface where the app prompts the user instead of
  halting silently); `gas/authError.html` (§3 후속 error-code branches
  tracked at `TODO.md:36`).
- Sync demonstration: `src/services/calendarSync.ts` → §5.4 color
  ownership (`TODO.md:85-90`).
- LLM preview demonstration: `src/routes/classify.ts` + `gas/addon.js`
  "🤖 AI 분류 확인" button (§5 후속 at `TODO.md:97`).
- Rule-deletion rollback: `src/services/colorRollback.ts`.
- Demo bundle path: `docs/assets/marketplace/reviewer-demo/` (index: `reviewer-demo/README.md`).

### Status

| Scenario | Scope(s) exercised | Source of truth | Status |
|---|---|---|---|
| Install + first-time OAuth | `openid` / `email` / `calendar` / `calendar.events` | `docs/assets/marketplace/reviewer-demo/01-install.md` | 초안 |
| Create rule → color applied | `calendar.events` | `docs/assets/marketplace/reviewer-demo/02-rule-to-color.md` | 초안 |
| Event-open preview (rule hit) | `calendar.addons.current.event.read` | `docs/assets/marketplace/reviewer-demo/03-event-preview-rule-hit.md` | 초안 |
| Event-open AI fallback preview | `calendar.addons.current.event.read` + backend LLM | `docs/assets/marketplace/reviewer-demo/04-event-preview-ai-fallback.md` | 초안 |
| Rule deletion → color rollback | `calendar.events` | `docs/assets/marketplace/reviewer-demo/05-rule-deletion-rollback.md` | 초안 |
| Re-auth on `invalid_grant` | `calendar` | `docs/assets/marketplace/reviewer-demo/06-reauth-invalid-grant.md` | 초안 |
| Service disconnect / account deletion | all | `docs/assets/marketplace/reviewer-demo/07-account-deletion.md` | 초안 |
| Test account credentials | — | `docs/assets/marketplace/reviewer-demo/08-test-account.md` | 초안 |

## 5. Launch Gate Checklist

### Promise

Go / no-go roll-up. One table joining the critical items from §1–§4 with
cross-cutting infrastructure gates (domain verification, prod activation,
CI/CD, backup policy) into a launch-blocker view. Each row has a pointer
into the owning section or the owning `TODO.md` line — the gate carries
status and blocking-on pointer only, never a duplicated contract. To change
a gate, edit the owning source first and then the status here.

### Canonical pointers

- Domain gate: `TODO.md:8` (§1).
- Prod environment activation: `TODO.md:35` (§3 후속).
- Prod Watch API activation (blocked on domain verification, not a code
  change): `TODO.md:52` (§4 후속).
- CI/CD + backup / recovery: `TODO.md:131-132` (§7).
- OAuth verification: `TODO.md:133` (§7).
- Privacy policy + Marketplace registration: `TODO.md:134` (§7).
- Cross-listed security posture: `docs/security-principles.md`.

### Status

| Gate | Blocks | Owner | Status | Detail pointer |
|---|---|---|---|---|
| Owned domain + Search Console verification | Prod Watch API, support URL, privacy URL, home URL | Ops | 완료 | `TODO.md:8` + `docs/runbooks/01-domain-and-search-console.md` (`autocolorcal.app` GSC verified 2026-05-04, GCP Consent Screen Authorized domains 등록 완료) |
| Prod Supabase + Worker activated | OAuth verification (prod client), Marketplace listing | Eng | 완료 | `TODO.md:35` + `docs/runbooks/02-prod-environment-activation.md` (PR #43 `a01bde7` — Hyperdrive / Queue / cron bindings 활성화 완료) |
| Listing assets bundle | Marketplace submission | Product + Design | 미작성 | §1 + `docs/runbooks/05-marketplace-listing-assets.md` |
| Privacy Policy published | Consent screen, listing | Legal | 완료 | §2 → https://legal.autocolorcal.app/privacy (Cloudflare Pages publish 2026-05-05) + `docs/runbooks/04-legal-hosting.md` |
| Terms of Service published | Consent screen, listing | Legal | 완료 | §2 → https://legal.autocolorcal.app/terms (Cloudflare Pages publish 2026-05-05) + `docs/runbooks/04-legal-hosting.md` |
| Scope justifications written | OAuth verification | Eng + Product | 완료 | §2 → `docs/assets/marketplace/scope-justifications.md` (final 2026-05-04) + `docs/runbooks/06-oauth-verification.md` |
| Restricted-scope demo video | OAuth verification | Product | 미작성 | §2 + `docs/runbooks/06-oauth-verification.md` |
| Data handling / Admin answers drafted | Marketplace submission | Eng + Ops | 초안 | §3 |
| Account-deletion endpoint live | Marketplace submission | Eng | 완료 | §3 → `POST /api/account/delete` (`src/routes/account.ts`) — FK cascade로 9개 user-scoped 테이블 정리 + Google revoke + watch-stop. 계약은 `src/CLAUDE.md` "Account deletion (§3 row 179)" |
| Reviewer demo bundle | OAuth verification | Product + Eng | 초안 | §4 |
| CI/CD pipeline | Quality gate | Eng | 완료 | `TODO.md:129` + `docs/runbooks/03-cicd-pipeline.md` (`.github/workflows/ci.yml` 4-job + `main` 보호 룰셋 활성화. Step 5 자동 deploy job은 의도적 미룸 — G6 통과 후) |
| Backup / recovery policy | Admin review | Eng | 초안 | `TODO.md:130` + `docs/runbooks/07-backup-and-recovery.md` (Supabase Pro 결제 완료 2026-05-06; **PITR add-on 보류 결정 (2026-05-06)** — daily snapshot 7일 보존만 운영, RPO 24h. PITR 도입은 유료 사용자 규모/매출 트리거 충족 후. daily snapshot 기반 복구 리허설 1회 잔여) |
| Security principles index current | Reviewer spot-checks | Eng | 완료 | `docs/security-principles.md` |
| Marketplace submission (publish 단계) | — | Product + Eng | 미작성 | `docs/runbooks/08-marketplace-submission.md` (G1·G2·G4·G5·G6·G7 충족 후 publish) |

## How to use this document

- **Marketplace reviewer.** Read §1–§4; each "Promise" paragraph is the
  public posture, the canonical pointers are the proof, the status tables
  signal freshness. Follow any pointer to read the contract at its
  canonical source.
- **Launch owner.** Walk §5 top to bottom on a recurring cadence. Never
  flip a row to `완료` without updating the canonical source behind the
  pointer first; this file lags reality otherwise.
- **New contributor.** Pair this file with `docs/security-principles.md`.
  That file covers runtime invariants, this one covers submission
  artifacts. Neither duplicates the other, and both point at the same
  underlying sources (`src/CLAUDE.md`, `docs/architecture-guidelines.md`,
  module-level `CLAUDE.md`s) when relevant.
- **Changing a row.** Edit the canonical source first (or create the TBD
  asset), then update the Status column here in the same PR. A row whose
  Status drifts from its pointer is a review hazard.

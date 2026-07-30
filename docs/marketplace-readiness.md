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

- App identity in code: `gas/appsscript.json:29` (`addOns.common.name =
  "AutoColor"`), `gas/appsscript.json:30` (`logoUrl` — owned-domain icon at
  `https://legal.autocolorcal.app/icon-128.png`; the `gstatic` placeholder
  was replaced 2026-05-08).
- Home-card copy baseline: `gas/addon.js:97-108` (3-step tutorial) and
  `docs/add-on-ui-plan.md` (screen-by-screen copy source of truth).
- Owned-domain gate: `TODO.md:8` (§1 — domain acquisition + Search Console
  verification). Gates the support URL and the webhook URL.
- Prod deployment gate: `TODO.md:37` (§3 후속 "Prod 환경 활성화").
- Final icon / screenshots / video assets: `docs/assets/marketplace/`
  (icons + screenshots + copy landed; screenshots pending re-shoot — see
  the Status row below).
- External: Google Workspace Marketplace brand and listing guidelines
  (referenced by stable name).

### Status

| Item | Source of truth | Status | Owner | Notes |
|---|---|---|---|---|
| App display name | `gas/appsscript.json:29` | 완료 | — | "AutoColor" confirmed |
| Short description (KR / EN) | `docs/assets/marketplace/description.md` | 완료 | Product | KR 41자 / EN 65 chars; tone-review pending pre-publish |
| Long description (KR / EN) | `docs/assets/marketplace/description.md` | 완료 | Product | Derived from `docs/add-on-ui-plan.md` Screen 1·2 + `gas/addon.js:97-108` 3-step copy |
| App icon 128×128 / 32×32 | `docs/assets/marketplace/icons/` (8종 일습) | 완료 | Design | 1024 마스터 + 480/128/32/16 + mono-dark/light + source SVG commit. `scripts/generate-marketplace-icons.py`로 재생성. Cloudflare Pages 호스팅 라이브 (`https://legal.autocolorcal.app/icon-128.png` 200) + `gas/appsscript.json:30` `logoUrl` 교체 + GAS New version 배포 완료 (2026-05-08). 마스터 디자인: 바인더 링 / 다크 헤더 + 별 4개 컨셉. 32/16/mono 변형은 코드 렌더 유지(Option A) — render_* 재작성은 별도 PR 후속. |
| Promotional screenshots (≥ 3) | `docs/assets/marketplace/screenshots/` (01-welcome / 02-home / 03-rules / 04-event-preview) | 재촬영 필요 | Design | repo의 png 4장은 2026-05-09 촬영분(commit `1f41184`)이며 **무효**다 — 그 뒤 UI 가 두 번 바뀌었다: native-labels #03 편집기 개편(2026-07-28, 이름·색 읽기 전용 + 라벨 칩)과 legal clickwrap(2026-07-29, welcome 카드 약관 링크 + 설정 카드 체크박스 3개 제거). Marketplace SDK Configuration 에 업로드된 것도 같은 낡은 자료라 재촬영 후 **교체**가 필요하다. 촬영 절차·장면 4종은 `docs/runbooks/00-user-action-checklist.md` ④ (native-labels #03 4로케일 증거와 같은 화면). |
| Promotional video (optional) | https://youtu.be/5hzXGmM_dQc | 완료 | Product | YouTube unlisted 업로드 (2026-05-09). §2 "Demo video (restricted-scope usage)" 행 / §5 "Restricted-scope demo video" 게이트와 같은 정본 — `docs/runbooks/06-oauth-verification.md` Step 2 시나리오 기반. |
| Category | Productivity | 완료 | Product | `docs/runbooks/05-marketplace-listing-assets.md` Step 5 권장값. publish 후 Marketplace SDK 콘솔에서 재조정 가능 |
| Support email | `support@autocolorcal.app` | 완료 | Ops | Cloudflare Email Routing 활성화 (2026-05-08) — MX/SPF Cloudflare 자동 추가, 개인 forward 대상 verified, `support@` custom address rule 송수신 확인 |
| Support / help URL | https://github.com/lim010111/autocolor-calendar/issues | 완료 | Ops | `docs/runbooks/05-marketplace-listing-assets.md` Step 5 권장. 사용자 베이스 성장 시 정식 support 페이지로 전환 |
| Developer / publisher identity | TBD (GCP project owner) | 초안 | Ops | Tied to `TODO.md:37` prod activation |

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

- Backend scopes: `src/config/constants.ts:1-6` (`openid`, `email`,
  `calendar`, `calendar.events`). `calendar` is Restricted,
  `calendar.events` is Sensitive under Google's current classification.
- GAS-side scopes: `gas/appsscript.json:5-12`. Unchanged since commit
  `5318fde` (2026-05-14) — i.e. no scope or consent-screen change has
  occurred since the 2026-07-24 approval, so the re-verification trigger
  in the approval mail has not fired.
- Scope minimization contract: `docs/security-principles.md` Principle 3.
- PII redaction gating the LLM leg: `docs/security-principles.md` Principle
  2; `src/services/piiRedactor.ts`.
- E2E backend mandatory (no local trigger fallback that would widen scope
  at runtime): `gas/CLAUDE.md`; `docs/architecture-guidelines.md` →
  "E2E Backend Mandatory" and "Halt on Failure".
- Consent-screen copy in the onboarding card: `gas/addon.js:110-125`
  (ToS §0.3 clickwrap-lite — notice + Privacy / ToS links render before
  the assent button). The old "정식 링크는 출시 시점에 제공됩니다"
  placeholder was replaced with the live `legal.autocolorcal.app` URLs
  (2026-05-05) and no longer exists in `gas/`.
- Existing TODO gate: `TODO.md:136` (§7 OAuth Consent Screen 검수).

Both `calendar` and `calendar.events` are currently requested. This section
captures current state; any scope reduction is a separate engineering task
and is not adjudicated here.

### Status

| Item | Source of truth | Status | Owner | Notes |
|---|---|---|---|---|
| App home page URL | `https://autocolorcal.app/` (`src/routes/home.ts`) | 완료 | Ops | apex `/` landing 라우트 + 테스트(2026-05-08). 컨텐츠 source: `docs/assets/marketplace/description.md` short/long description + `docs/security-principles.md` Principle 2. Worker prod deploy 완료 (Version `e021b47f`, 2026-05-08) — `https://autocolorcal.app/` 200 + `text/html` active, `/healthz` 회귀 없음. |
| Privacy Policy URL | https://legal.autocolorcal.app/privacy | 완료 | Legal | Cloudflare Pages publish 2026-05-05 (`docs/legal/privacy-policy.md` → `dist/legal/privacy.html`) |
| Terms of Service URL | https://legal.autocolorcal.app/terms | 완료 | Legal | Cloudflare Pages publish 2026-05-05 (`docs/legal/terms-of-service.md` → `dist/legal/terms.html`) |
| Authorized domain(s) | `autocolorcal.app` | 완료 | Ops | OAuth Consent Screen "Authorized domains" 입력값. apex + 모든 subdomain(`legal.autocolorcal.app` 포함) 자동 커버. GSC verified 2026-05-04. |
| Scope list (backend) | `src/config/constants.ts:1-6` | 완료 | Eng | Matches `OAUTH_SCOPES` |
| Scope list (GAS manifest) | `gas/appsscript.json:5-12` | 완료 | Eng | |
| `calendar` (Restricted) justification | `docs/assets/marketplace/scope-justifications.md` | 완료 | Eng + Product | Final per `docs/runbooks/06-oauth-verification.md` Step 1 (2026-05-04) |
| `calendar.events` (Sensitive) justification | `docs/assets/marketplace/scope-justifications.md` | 완료 | Eng + Product | Same final review |
| `userinfo.email` justification | `docs/assets/marketplace/scope-justifications.md` | 완료 | Eng | Same final review |
| Demo video (restricted-scope usage) | https://youtu.be/5hzXGmM_dQc | 완료 | Product | §1 "Promotional video (optional)" 행과 같은 정본 — YouTube unlisted (2026-05-09). Required by Google's Restricted Scope policy. |
| Verification status | GCP Console → OAuth consent screen | 완료 | Ops | 2026-05-09 1차 Submit → brand 거절 3건(홈페이지 privacy 링크 가시성 / 영문 purpose 부재 / OAuth App name `autocolor-dev` ↔ 홈페이지 `AutoColor for Calendar` 미스매치) → `src/routes/home.ts` 보강(commit `c08e2d6`) + Worker prod redeploy(Version `fa63d651`) + GCP App name → "AutoColor for Calendar" 후 재제출 → **Brand verified** (consent screen이 unverified warning 없이 노출). Restricted/Sensitive scope review는 별도 트랙 — 100명 사용자 cap 유지, Marketplace publish는 scope review 통과 후 가능. 2026-05-09 오후 OAuth Verification Questionnaire 제출(personal/internal/dev/wordpress 모두 No + CASA acknowledgement 체크) → sensitive scope justification 통합 본문 + demo video URL 입력 완료. Google CASA Tier 결정 + scope review 통보 대기. → 라운드 2 반려(demo video 가 OAuth consent 화면 미노출, 2026-07-03) → 재편집 영상 제출(2026-07-17) → 라운드 3 반려(consent 요청 스코프 ↔ Console 등록 스코프 불일치, 2026-07-20) → Console 에 `script.external_request` 추가 + 영상 링크 갱신 후 답장(2026-07-23) → **승인 (2026-07-24)**: `script.external_request` / `calendar` / `calendar.events` 3종. 승인 메일 조건 — 신규 스코프 요청 또는 **consent screen 설정 변경 시 재검수 필요**, verification 은 상속 불가. **2026-07-28 Console 실측**: Verification Center = "Your branding has been verified" + "Your app's data access has been verified"; Data Access sensitive 3종 전부 `This scope is verified`; Audience = Publishing status **In production** / External / 4 users of 100 user cap — 단 Console 안내문대로 "승인된 sensitive/restricted 스코프만 요청하면 user cap 은 적용되지 않는다" 이므로 **100명 상한은 실효 해제**. |
| CASA security assessment | Console → Data Access "Your restricted scopes" | 해당 없음 | Ops | 2026-05-09 questionnaire 에서 CASA acknowledgement 를 체크했으나 **CASA 는 트리거되지 않았다** — 2026-07-28 Console 실측: Data Access 페이지의 "Your restricted scopes" 표가 **0행**이고, `calendar` 는 "Your sensitive scopes" 에 분류되어 3종 모두 "This scope is verified". CASA(Tier 2 self-assessment / Tier 3 LoA)는 *restricted* 스코프 앱의 연례 트랙이므로 현 스코프 구성에서는 대상 아님. **restricted 스코프를 추가하면 이 행이 되살아난다** (예: Gmail·Drive 전체 접근). |
| Onboarding-card copy refresh | `gas/addon.js:110-125` | 완료 | Eng | URL을 `legal.autocolorcal.app/{privacy,terms}` 로 갱신 (2026-05-05). GAS New version 배포 완료 (2026-05-08). |

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
- Retention hooks: `TODO.md:40` (§3 후속 "세션 GC" — `pg_cron` job not yet
  landed); account-deletion endpoint = `POST /api/account/delete`
  (`src/routes/account.ts`, contract at `src/CLAUDE.md` "Account deletion
  (§3 row 179)").
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
| Retention policy | TBD + `TODO.md:40` | 미작성 | `pg_cron` session GC not yet landed. 처리방침 §6 은 이 사실을 그대로 기재했으므로 문서 결함이 아니라 구현 과제 (PIPA §21① 대응) |
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
Google's OAuth verification guidance. Bundle lives at
`docs/assets/marketplace/reviewer-demo/`; this section is the index.

### Canonical pointers

- Onboarding flow: `docs/add-on-ui-plan.md` Screen 1 (Welcome).
- Home / rules / event-preview flows: `docs/add-on-ui-plan.md` Screens
  2–5.
- Halt-on-failure and re-auth UX: `docs/architecture-guidelines.md` →
  "Halt on Failure" (notes the narrow `invalid_grant` re-login exception
  — the only documented surface where the app prompts the user instead of
  halting silently); `gas/authError.html` (§3 후속 error-code branches
  tracked at `TODO.md:38`).
- Sync demonstration: `src/services/calendarSync.ts` → §5.4 color
  ownership (`TODO.md:88-92`).
- LLM preview demonstration: `src/routes/classify.ts` + `gas/addon.js`
  "🤖 AI 분류 확인" button (§5 후속 at `TODO.md:99`).
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
- Prod environment activation: `TODO.md:37` (§3 후속).
- Prod Watch API activation (blocked on domain verification, not a code
  change): `TODO.md:54` (§4 후속).
- CI/CD + backup / recovery: `TODO.md:134-135` (§7).
- OAuth verification: `TODO.md:136` (§7).
- Privacy policy + Marketplace registration: `TODO.md:137` (§7).
- Cross-listed security posture: `docs/security-principles.md`.

### Status

| Gate | Blocks | Owner | Status | Detail pointer |
|---|---|---|---|---|
| Owned domain + Search Console verification | Prod Watch API, support URL, privacy URL, home URL | Ops | 완료 | `TODO.md:8` + `docs/runbooks/01-domain-and-search-console.md` (`autocolorcal.app` GSC verified 2026-05-04, GCP Consent Screen Authorized domains 등록 완료) |
| Prod Supabase + Worker activated | OAuth verification (prod client), Marketplace listing | Eng | 완료 | `TODO.md:37` + `docs/runbooks/02-prod-environment-activation.md` (PR #43 `a01bde7` — Hyperdrive / Queue / cron bindings 활성화 완료) |
| Listing assets bundle | Marketplace submission | Product + Design | 미충족 | §1 — description / icon / video / category / support email·URL 은 완료(2026-05-09)이나 **screenshots 가 무효**(2026-05-09 촬영분, UI 2회 변경 이후). 재촬영 + SDK 콘솔 교체 전까지 이 게이트는 열리지 않는다. `docs/runbooks/05-marketplace-listing-assets.md` + `docs/runbooks/00-user-action-checklist.md` ④ |
| Privacy Policy published | Consent screen, listing | Legal | 완료 | §2 → https://legal.autocolorcal.app/privacy (Cloudflare Pages publish 2026-05-05) + `docs/runbooks/04-legal-hosting.md` |
| Terms of Service published | Consent screen, listing | Legal | 완료 | §2 → https://legal.autocolorcal.app/terms (Cloudflare Pages publish 2026-05-05) + `docs/runbooks/04-legal-hosting.md` |
| Scope justifications written | OAuth verification | Eng + Product | 완료 | §2 → `docs/assets/marketplace/scope-justifications.md` (final 2026-05-04) + `docs/runbooks/06-oauth-verification.md` |
| Restricted-scope demo video | OAuth verification | Product | 완료 | §2 → https://youtu.be/5hzXGmM_dQc (YouTube unlisted, 2026-05-09) + `docs/runbooks/06-oauth-verification.md` |
| Data handling / Admin answers drafted | Marketplace submission | Eng + Ops | 초안 | §3 |
| Account-deletion endpoint live | Marketplace submission | Eng | 완료 | §3 → `POST /api/account/delete` (`src/routes/account.ts`) — FK cascade로 9개 user-scoped 테이블 정리 + Google revoke + watch-stop. 계약은 `src/CLAUDE.md` "Account deletion (§3 row 179)" |
| Reviewer demo bundle | OAuth verification | Product + Eng | 초안 | §4 |
| CI/CD pipeline | Quality gate | Eng | 완료 | `TODO.md:134` + `docs/runbooks/03-cicd-pipeline.md` (`.github/workflows/ci.yml` 4-job + `main` 보호 룰셋 활성화. Step 5 자동 deploy job은 의도적 미룸 — G6 통과 후) |
| Backup / recovery policy | Admin review | Eng | 미충족 (후퇴) | `TODO.md:135` + `docs/runbooks/07-backup-and-recovery.md`. **2026-07-01 Supabase Pro billing 이 중단되어 prod 가 임시 Free 다** (pause → Restore). Free 는 백업 0 + 7일 무활동 자동 pause 이므로 2026-05-06 에 세웠던 "Pro daily snapshot 7일 보존, RPO 24h" 정책이 현재 성립하지 않는다. **PITR add-on 보류 결정 (2026-05-06)** 은 그대로 유효 — 이 행이 요구하는 것은 PITR 이 아니라 **Pro 복구**다. 접속기록 1년 보관(처리방침 §8.2)의 Audit Log Drain 도 같은 Pro 결제에 묶인다. 복구 리허설 1회는 Pro 복구 이후 잔여 |
| 접속기록 1년 보관 | Marketplace submission (게시된 처리방침의 대외 약속) | Eng + Ops | 미충족 | `docs/legal/privacy-policy.md` §8.2 — v1.1 이 2026-07-29 에 이미 게시됐고, 같은 문서의 운영자 체크리스트 6번은 이 루틴을 "publish 전에 가동" 하라고 지시한다. 현재 콘솔 감사로그 보존은 7일이고 export 경로가 없어 Supabase Pro + Audit Log Drain 이 유일한 경로 — 위 Backup 행과 같은 결제에 묶인다 |
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

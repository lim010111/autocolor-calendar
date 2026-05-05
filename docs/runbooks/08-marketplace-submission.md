# 08 — Marketplace submission

> 이 runbook은 [`TODO.md` §7 line 134](../../TODO.md) "Google Workspace
> Marketplace 등록" 정본 절차다. 다른 모든 게이트(G1·G2·G4·G5·G6·G7)의
> **수렴 지점** — 자료 / 인프라 / 검수 산출물을 모아 Marketplace에
> 정식 등록한다. Google admin 검수 통상 1-3주.
>
> Owner: Product + Eng. **본 runbook은 다른 게이트들의 결과물을 publish
> 버튼 1회로 외부 노출시키는 마지막 단계**이며, 그 전에 모든 prerequisite
> 의 정합성을 한 번 더 점검하는 책임을 진다.
>
> **이 runbook의 범위 밖**: 출시 후 사용자 베이스 성장 / 마케팅 / 향후
> 기능 개발. 본 runbook은 publish 시점 + publish 직후 정착 모니터링까지.

- **Pre-conditions** (모두 status `완료`):
  - [01 runbook](./01-domain-and-search-console.md) — Domain + GSC verified.
  - [02 runbook](./02-prod-environment-activation.md) — Prod env 활성화
    (test 계정 OAuth + sync 검증 통과).
  - [04 runbook](./04-legal-hosting.md) — Privacy / ToS URL 공개.
  - [05 runbook](./05-marketplace-listing-assets.md) — 11개 listing 자료
    Marketplace SDK Draft 입력 완료.
  - [06 runbook](./06-oauth-verification.md) — OAuth Consent Screen
    Verification status `Verified`.
  - [07 runbook](./07-backup-and-recovery.md) — PITR 활성화 + 복구 리허설.
  - [03 runbook](./03-cicd-pipeline.md) — 권장이지만 G8 차단 게이트 아님
    (출시 후 추가 가능).
- **Acceptance**:
  - GCP Console → Marketplace SDK → "App Configuration" status `Published`.
  - Workspace Marketplace에서 "AutoColor" 검색 시 listing 노출.
  - 별도 Workspace 도메인의 test 사용자 (본인 외)가 Marketplace에서 install
    + OAuth + 카테고리 추가 + sync 흐름 1회 성공.

## Step 1 — 사전 점검 체크리스트

`docs/marketplace-readiness.md` §5 launch gates 표를 한 행씩 검증.
각 행의 정본 pointer를 따라가서 status가 실제 상태와 일치하는지 확인.

```bash
# 본 runbook 실행자가 cross-check할 grep 명령 모음
grep -E "^\| (Owned domain|Prod Supabase|Privacy Policy|Terms of Service|Scope justifications|Demo video|CI/CD|Backup|Listing assets)" docs/marketplace-readiness.md
```

| 항목 | 확인 명령 |
|---|---|
| Domain + GSC verified | `dig +short TXT <prod-domain>`에 google-site-verification 라인 존재 |
| Prod Worker 활성 | `curl https://<prod-domain>/healthz` → 200 |
| Privacy / ToS URL | `curl -I https://legal.<prod-domain>/privacy` → 200 + content-type (G4 결정: legal subdomain) |
| OAuth verification | GCP Console → OAuth consent screen → Verification status: Verified |
| Listing assets | Marketplace SDK 콘솔 → App Configuration 모든 빨간 ! 사라짐 |
| Backup policy | Supabase Dashboard → Backups → PITR 토글 ON |
| `gas/appsscript.json:17` | `grep "logoUrl" gas/appsscript.json`이 `gstatic` 아닌 자체 호스팅 URL |
| `gas/addon.js:119` | `grep "정식 링크" gas/addon.js` 결과 0행 (placeholder 제거됨) |

위 check 중 하나라도 실패면 **publish 금지**. 해당 prerequisite runbook으
로 돌아가 마무리.

## Step 2 — Marketplace SDK App Configuration final 점검

GCP Console → APIs & Services → Marketplace SDK → "App Configuration"
탭. [05 runbook] Step 6에서 Draft 입력했던 모든 필드를 다시 검토:

| 필드 | 검수 viewpoint |
|---|---|
| App name "AutoColor" | 단수 / 영문 표기. 변경 시 모든 surface 영향. |
| Short description (KR/EN) | ≤80자. 핵심 가치 제안 1줄. |
| Long description (KR/EN) | 기능·privacy·sub-processors·시작 방법 모두 포함. |
| App icon | 1024×1024 자체 호스팅. Material Design 가이드라인 부합. |
| Screenshots | ≥3, prod env 화면, dev URL 노출 0. |
| Category | Productivity 또는 적절한 sub-category. |
| Support contact | `support@<prod-domain>` — Step 1 cross-check. |
| Support URL | GitHub Issues 또는 dedicated support page. |
| Privacy Policy URL | `legal.<prod-domain>/privacy` 200 응답. |
| Terms of Service URL | `legal.<prod-domain>/terms` 200 응답. |
| OAuth scopes 4개 | `src/config/constants.ts` + `gas/appsscript.json` 일치. |
| Distribution | Step 3에서 결정. |
| Pricing model | "Free". |

콘솔 우상단 "Save" 누른 상태 — publish 직전.

## Step 3 — Distribution 결정 (Public listing vs. Unlisted)

| 옵션 | 의미 | 권장 시점 |
|---|---|---|
| **Public listing** | Workspace Marketplace 검색에 노출 | 안정성 + 모니터링 인프라 신뢰 후 |
| **Unlisted** | URL 직접 접근하는 사용자만 install (검색 비노출) | 출시 직후 1-2주 |

**권장 출시 패턴**:

1. **첫 publish는 Unlisted**. 친구·지인·타겟 베타 사용자만 install URL
   공유 → 1-2주 운영하며 prod env 안정성 / 사용자 흐름 / 지원 요청 패턴
   관찰.
2. **이슈 0건 + 사용자 만족 확인 후 Public 전환**. SDK 콘솔에서 Distribution
   토글로 1단계 전환. 검수 재진행 없음.

이 패턴의 비용은 Public 노출 지연 1-2주뿐, 이득은 첫 OAuth 흐름 / sync
오류 / 색상 적용 회귀 등의 위험을 본인 통제 범위 내에서 발견·수정.

## Step 4 — Publish

GCP Console → APIs & Services → Marketplace SDK → "App Configuration"
화면 → "Publish" 버튼.

확인 모달 표시 — Distribution / Pricing / Scopes 요약. "Confirm publish".

자동으로 검수 큐 진입. **검수 통상 1-3주.** Google 측 검수 진행 도중 추가
정보 요청 메일 가능 (24시간 내 응답 권장 — [06 runbook] Step 4와 동일
discipline).

자주 나오는 거절 사유:

- **Screenshot에 dev URL 노출**: [05 runbook] Step 3 재촬영.
- **OAuth 검수 미완**: G6 [06 runbook] 통과 전 G8 publish 시 자동 거절.
  Step 1 사전 점검에서 차단해야 함.
- **Scope justification 부족**: G6 [06 runbook] Step 1 본문 보강.
- **Listing description이 generic**: USP / 차별점이 명확하지 않음. [05
  runbook] Step 1 Long description 본문 보강.
- **Privacy Policy 본문 부족**: 한국어만 있어 영문 reviewer가 평가 불가
  ⇒ 영문 번역 추가. [04 runbook] Step 1 자문 검토와 동시에 처리.

거절 사유 분석 → 자료 보강 → 재제출. 반복 가능, 단 횟수 누적되면 검수자
risk 인식 증가하므로 1차 제출 전 [01-07 runbook] prerequisite를 철저히
점검.

## Step 5 — 출시 직후 모니터링 (publish 후 첫 7일)

검수 통과 메일 수신 → Marketplace 검색 노출 가능 → 본 step 시작.

### 5A — 첫 30분 — 본인 install 검증

본인 (또는 본인 다른 Google 계정)으로:

1. Workspace Marketplace 검색 → "AutoColor" → "Install".
2. OAuth Consent 화면 — Privacy / ToS 링크가 publish 시점에 등록한
   URL과 일치 확인.
3. Calendar 사이드바 → add-on 진입 → "백엔드 연결" → OAuth 흐름 →
   카테고리 추가 → "지금 동기화" → Calendar에서 색상 변경 확인.

이 30분 흐름 중 하나라도 깨지면 **Distribution을 즉시 Unlisted로 전환** +
재진단. publish 직후 1차 검증의 책임은 본인.

### 5B — 첫 7일 — 운영 모니터링

```bash
# 매일 1회 또는 alerts 설정
pnpm wrangler tail --env prod
```

체크 항목:

- `5xx` 응답 빈도 — 0이 정상.
- `OAuthError` / `invalid_grant` — 사용자 토큰 만료 비율 spike 시 사용자
  alarm.
- `sync_runs` 테이블 outcome 분포 — `ok` 비율, `retryable` 비율.
  Supabase Dashboard SQL Editor:
  ```sql
  SELECT outcome, count(*) FROM sync_runs
  WHERE started_at > now() - interval '24 hours'
  GROUP BY outcome;
  ```
- `sync_failures` 테이블 — DLQ 적재 0이 정상. 1건 이상 적재 시 즉시 디
  버그.
- `/api/stats` 호출 — GAS 홈카드의 라이브 카운터. 사용자 지표 spot-check.

7일 무사고 후 Distribution Public 전환 검토.

### 5C — 사용자 피드백 채널

Step 5C 의 Support URL (GitHub Issues 권장 — [05 runbook] Step 5)을
모니터. 첫 1-2주는 사용자 피드백 응답 시간이 짧을수록 평판 안정.

## Step 6 — 출시 후 정기 운영 트리거

publish 통과 후 본 서비스 long-running 운영 책임:

### 분기 1회

- **백업 복구 리허설** — [07 runbook](./07-backup-and-recovery.md) Step 3B.
- **`pnpm test` / `pnpm typecheck` / `pnpm lint`** 정합성 — [03 runbook]
  CI가 매 PR마다 강제.
- **Hyperdrive / Supabase plan 점검** — 사용자 / 데이터 증가 추이 보고
  upgrade 결정.

### 연 1회

- **TOKEN_ENCRYPTION_KEY 로테이션** — `src/CLAUDE.md` "Secret rotation
  impact" 절차. 운영자 procedure를 1년 단위로 재실행.
- **OAuth 검수 만료 갱신** — Google이 검수 만료를 자동 통지하면 본
  메일 받고 [06 runbook]의 자료를 최신화 + 재제출.
- **CASA 보안 평가 트리거 점검** — 사용자 수가 100K+ 도달 시 Google이
  요청 가능. 별도 budget / lead time 마련.

### 사고 발생 시

- **prod 5xx 또는 데이터 손상 의심** — [07 runbook] Step 4 disaster
  recovery 시나리오 A/B/C 분기 적용.
- **Supabase 인프라 사고** — Supabase status page 확인 → vendor 측 대기
  또는 [07 runbook] Step 4B 전면 손실 절차.
- **token rotation 도중 PREV 누락** — `src/CLAUDE.md` "Token rotation"
  실패 모드 가이드.

### 주기적 코드 / 의존성 점검

- **drizzle / Hono / Cloudflare Workers** 메이저 버전 업그레이드 — 분기
  단위 검토. CI 파이프라인이 lockfile drift / type 에러를 자동 발견.
- **Node 20 EOL** (2026 후반) — Node 22 또는 차세대 LTS로 전환 계획
  + CI matrix 갱신.

## 롤백 시나리오

publish 자체는 mutation이지만 **회수 가능**:

- **출시 직후 critical 문제 발견**: Distribution을 Public → Unlisted로
  토글 (검수 재진행 없음, 즉시 적용). 신규 install 차단, 기존 사용자는
  영향 없음. 문제 fix → Distribution 재토글 Public.
- **OAuth 검수 본문이 잘못 publish됐음 (예: 거짓 Privacy 본문)**: GCP
  Console → OAuth consent screen → "Back to Testing"으로 publishing
  status 환원. 사용자 OAuth 흐름이 끊김 — 적용 영향이 사용자 가시 영역
  이라 신중. fix 후 재 publish.
- **Marketplace listing 자체 회수**: SDK 콘솔에서 "Unpublish" 버튼.
  검색 / install 비노출 + 기존 사용자도 다음 OAuth 시 거절. 사용자 영향
  최대.
- **DB / Worker 손상은 [07 runbook] Step 4 시나리오로 분리** — Marketplace
  publish와 무관하게 별도 런북 처리.

## Submission-time 영향

본 runbook 통과 = **`docs/completion-roadmap.md` "완성 정의" 3 조건 모두 충족**:

1. ✅ Public listing 활성 — Marketplace 검색 노출.
2. ✅ Prod 백엔드 활성 — `<prod-domain>` Worker 트래픽 처리.
3. ✅ OAuth verification 완료 — Restricted Scope 검수 통과.

`docs/marketplace-readiness.md` §5 status 표 모든 행 `완료`.
`TODO.md` §7 모든 line `[x]`.

## Cross-references

- [`TODO.md` §7 line 134](../../TODO.md) — 작업 정본
- [`docs/completion-roadmap.md`](../completion-roadmap.md) — G8 절 + "완성 정의"
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) — 모든 §status 표가 G8 prerequisite
- [`docs/runbooks/01-domain-and-search-console.md`](./01-domain-and-search-console.md) — Domain prerequisite
- [`docs/runbooks/02-prod-environment-activation.md`](./02-prod-environment-activation.md) — Prod env prerequisite
- [`docs/runbooks/03-cicd-pipeline.md`](./03-cicd-pipeline.md) — 출시 후 회귀 방지 (권장)
- [`docs/runbooks/04-legal-hosting.md`](./04-legal-hosting.md) — Privacy / ToS prerequisite
- [`docs/runbooks/05-marketplace-listing-assets.md`](./05-marketplace-listing-assets.md) — Listing 자료 prerequisite
- [`docs/runbooks/06-oauth-verification.md`](./06-oauth-verification.md) — OAuth 검수 prerequisite
- [`docs/runbooks/07-backup-and-recovery.md`](./07-backup-and-recovery.md) — Backup prerequisite + 분기 정기 트리거
- [`src/CLAUDE.md` "Secret rotation impact"](../../src/CLAUDE.md) — 연 1회 운영 트리거
- [`src/CLAUDE.md` "Token rotation (§3 후속)"](../../src/CLAUDE.md) — 동일

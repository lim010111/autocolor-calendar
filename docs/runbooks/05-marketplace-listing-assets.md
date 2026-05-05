# 05 — Marketplace listing assets

> 이 runbook은 [`docs/marketplace-readiness.md` §1](../marketplace-readiness.md)
> "Marketplace Listing Assets" 표 11개 항목(현재 `미작성` 7건 / `초안` 2건 /
> `완료` 1건 — App display name "AutoColor"만 확정)을 정본화하는 절차다.
> 산출물은 `docs/assets/marketplace/` 하위 파일들 + `gas/appsscript.json`의
> 아이콘 URL 교체 + Marketplace SDK 콘솔 입력값.
>
> Owner: Product + Design + Eng. **G2 (prod 활성화) 직후 시작 권장** —
> 스크린샷이 prod env 화면이어야 reviewer 거절을 회피한다 (`*.workers.dev`
> URL이 화면에 보이면 자동 거절 사례 흔함). G6 (OAuth 검수)와 일부 자료
> 공유 — 데모 영상은 본 runbook과 06 runbook 모두에서 인용.
>
> **이 runbook의 범위 밖**: Marketplace SDK 정식 publish (= G8 — [08
> runbook](./08-marketplace-submission.md) 책임). 본 runbook은 자료
> 수집 / 입력 칸 채우기까지만.

- **Pre-conditions**:
  - [01 runbook](./01-domain-and-search-console.md) 완료 (`<prod-domain>` /
    support 이메일 도메인 결정).
  - [02 runbook](./02-prod-environment-activation.md) Step 12 검증 통과
    (스크린샷 촬영 가능한 상태).
  - 디자인 도구 (Figma / Sketch / Adobe Illustrator 등) 접근.
  - GCP Console → Marketplace SDK 콘솔 접근 권한.
- **Acceptance**:
  - [`docs/marketplace-readiness.md` §1](../marketplace-readiness.md) 11
    행 모두 status `완료`.
  - `gas/appsscript.json:17`의 `logoUrl`이 `gstatic` placeholder가 아닌
    자체 호스팅 URL.
  - Marketplace SDK 콘솔의 "App Configuration" 탭 모든 필수 필드 채워짐
    (publish 직전 상태).

## Step 1 — App display name + Description (KR / EN)

신규: `docs/assets/marketplace/description.md` (TBD — 본 step에서 생성).

### App display name

이미 확정 (`gas/appsscript.json:16` `addOns.common.name = "AutoColor"`).
변경 권장하지 않음 — 변경 시 onboarding 카드 카피 / 마케팅 자료 등
연쇄 영향.

### Short description

| 언어 | 길이 제한 | 내용 |
|---|---|---|
| KR | ≤80자 | "Google Calendar 일정에 키워드 규칙으로 자동 색상 적용" 류 1줄 |
| EN | ≤80자 | "Auto-apply colors to Google Calendar events by keyword rules" 류 1줄 |

본문 소스: [`docs/add-on-ui-plan.md`](../add-on-ui-plan.md) Screen 1
(Welcome) + Screen 2 (Home).

### Long description

| 언어 | 길이 제한 | 내용 |
|---|---|---|
| KR | ≤16,000자 | 기능·차별점·데이터 처리·요금 모델·시작 방법 |
| EN | ≤16,000자 | 동일 |

권장 섹션 구성:

1. **What it does** — 1단락. 키워드 규칙 / AI 보조 / 색상 자동 적용.
2. **How it works** — 2-stage classification (rule → LLM with PII redaction).
   `docs/security-principles.md` Principle 2를 1줄로 요약.
3. **Privacy** — 3개 sub-processor (Cloudflare / Supabase / OpenAI),
   `docs/legal/privacy-policy.md` URL.
4. **Get started** — install → OAuth → 카테고리 추가 → "지금 동기화" 흐름.
5. **Pricing** — 무료 / 유료 정책 (현재는 무료, 미래 유료화 시점에 갱신).
6. **Support** — `support@<prod-domain>` (Step 5에서 결정).

본문 작성 후 `docs/assets/marketplace/description.md`에 다음 구조로 commit:

```markdown
# Marketplace listing — descriptions

## Short — KR
<≤80자>

## Short — EN
<≤80 chars>

## Long — KR
<long body>

## Long — EN
<long body>
```

## Step 2 — App icon (128×128 + 32×32 PNG)

신규 디렉터리: `docs/assets/marketplace/icons/` (TBD — 본 step에서 생성).

### 디자인 요구사항

- 128×128 PNG (Marketplace listing primary).
- 32×32 PNG (Add-on 사이드바 favicon).
- 투명 배경 또는 brand background 색상.
- Material Design 가이드라인 / Google Workspace Add-on 아이콘 스타일과
  조화 (모서리 둥근 사각형 — 현재 `gstatic palette` placeholder는 정확히
  이 스타일).
- "AutoColor"의 의미를 시각적으로 환기 — 팔레트 / 컬러휠 / 캘린더 + 색상
  결합 등.

### Add-on manifest 갱신

현재 `gas/appsscript.json:17`:
```json
"logoUrl": "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png"
```

이 URL은 Google CDN의 임시 placeholder. 자체 호스팅 URL로 교체:

옵션 A — **Cloudflare Pages legal 프로젝트에 함께 호스팅** (권장):

[04 runbook](./04-legal-hosting.md) Step 3에서 만든 Pages 빌드 결과물에
`icon-128.png` / `icon-32.png`도 포함. URL: `https://<prod-domain>/icon-128.png`
(Worker 측 `src/routes/legal.ts`에 `/icon-*.png` 추가 또는 Pages 직접
hostname).

옵션 B — **GAS Add-on 정적 자원** (단점: GAS Add-on 외부 노출 공식 URL
없음 — Marketplace listing의 큰 아이콘 surface와 conflict).

권장 A. Marketplace SDK 콘솔의 listing 아이콘도 같은 URL 입력.

### Manifest 변경 + 새 version 배포

```json
// gas/appsscript.json (수정)
"logoUrl": "https://<prod-domain>/icon-128.png"
```

GAS 새 version 배포 절차는 `src/CLAUDE.md` "GAS deployment URL must stay
stable" 준수 — 기존 deployment의 New version. 본 변경분은 G6 직전에
다른 manifest 변경분(Step 5에서 결정될 support URL 등)과 묶어 1회 배포
권장.

## Step 3 — Promotional screenshots (≥3 — Welcome / Home / Rules / Event preview)

신규 디렉터리: `docs/assets/marketplace/screenshots/` (TBD — 본 step에서 생성).

### 촬영 필수 시점

**G2 prod 환경 활성화 후**. dev URL이 화면에 보이면 reviewer 거절 위험.
runbook 02 Step 12 (test 계정으로 OAuth + 카테고리 1개 추가 + sync 1회)
시점이 가장 자연스럽다.

### 촬영 시나리오

| # | 화면 | 트리거 |
|---|---|---|
| 1 | Welcome 카드 (최초 onboarding) | test 계정으로 처음 add-on 사이드바 열기 |
| 2 | Home 카드 (이번 주 분류 카운터 + 최근 동기화) | 카테고리 1개 + sync 1회 후 add-on 재진입 |
| 3 | Rules 카드 (규칙 추가 + 색상 그리드 + 선택 색상 ✓) | "규칙 관리" 진입 |
| 4 | Event preview (특정 이벤트 클릭 시 매칭 규칙 표시) | Calendar에서 매칭되는 이벤트 클릭 → add-on이 event open |

### 촬영 가이드

- 해상도: 1280×800 권장 (Marketplace 표시 영역 비율 일치).
- 브라우저: Chrome (가장 표준).
- 데스크톱 / 모바일 분리 — 둘 다 있어야 reviewer가 양 surface 검증 가능.
- 사용자 이름·이메일·실제 calendar 이벤트 PII 노출 금지 — test 계정 사용.
- URL bar에 dev URL 노출 금지 — Calendar 자체는 `calendar.google.com` 표
  시되니 무관.

촬영 후 `docs/assets/marketplace/screenshots/`에 PNG로 commit. 파일명
규칙: `01-welcome.png`, `02-home.png`, `03-rules.png`, `04-event-preview.png`.

## Step 4 — Promotional video (선택)

선택 사항. G6 (OAuth 검수) Restricted Scope 데모 영상이 별도 필요
([06 runbook](./06-oauth-verification.md) Step 2)이라, **그 영상을
재사용**하는 것이 가장 효율적이다.

영상 1개로 두 surface 충족하기 위한 시나리오:
- 길이 60-90초.
- 시작에서 5-10초 marketing hook (앱 가치 제안), 이후 reviewer가 보고
  싶어하는 install → consent → 핵심 기능 1개 → 색상 변경 결과 → 계정
  삭제까지 일관된 흐름.

자료 위치: `docs/assets/marketplace/oauth-verification-video.mp4`. 06 runbook
Step 2와 정본 공유.

## Step 5 — Category / Support email / Support URL / Developer identity

### Category

Marketplace 카테고리는 publish 시점에 단 1개 선택. 후보:

- **Productivity** — 가장 자연스러운 후보. 연관 검색 트래픽 풍부.
- **Calendar & Scheduling** (Workspace 내 sub-category 존재 시).

권장: **Productivity**. 변경 어렵지 않으므로 publish 후 Marketplace SDK
콘솔에서 데이터 보고 재조정 가능.

### Support email

권장 형태: `support@<prod-domain>` (예: `support@autocolorcal.app`).

설정 절차:
- Cloudflare Email Routing (계정 owner, 무료): Cloudflare Dashboard →
  Email → Email Routing → 도메인 인증 (DNS 자동 설정) → "Routing rules"
  → custom address `support@<prod-domain>` → 본인 개인 메일로 forward.
- 또는 Google Workspace 계정이 있다면 도메인 추가 + `support@` 별칭
  생성. 비용 발생.

권장: 초기에는 Cloudflare Email Routing (비용 0). 트래픽 증가 시 Google
Workspace로 전환.

### Support URL

옵션 1 — `<prod-domain>/support` 정적 페이지 (legal과 같은 패턴, [04
runbook] Pages 빌드에 추가).

옵션 2 — GitHub Issues 페이지 (`https://github.com/<owner>/autocolor_for_calendar/issues`).

권장: **GitHub Issues** 초기 선택. 별도 문서 작성 부담 0, 사용자 피드백
공개 트래킹 가능, 검수 측에서 흔히 보는 형태. 본격적인 사용자 베이스가
생기면 정식 support 페이지로 전환.

### Developer / publisher identity

Marketplace 등록자 본인 명의 + GCP 프로젝트 owner. 별도 자료 없음.

### `marketplace-readiness.md` §1 status 갱신

5 row 결정 후 본 페이지에서 status `완료` + 결정값 인라인.

## Step 6 — Marketplace SDK Configuration 입력

GCP Console → APIs & Services → Marketplace SDK → "App Configuration"
탭 (정확한 메뉴 위치는 콘솔 개편 시 변경 가능 — 본 runbook은 메뉴 경로만
명시, vendor URL 인라인 금지: `docs/runbooks/README.md` "글로벌 컨벤션").

### 입력 필드 (정본 source)

| 필드 | 값 | source |
|---|---|---|
| App name | AutoColor | `gas/appsscript.json:16` |
| App icon (1024×1024 또는 480×480) | Step 2 결과 | 자체 호스팅 URL |
| Short description (KR/EN) | Step 1 결과 | `docs/assets/marketplace/description.md` |
| Long description (KR/EN) | Step 1 결과 | 동일 |
| Screenshots (≥3) | Step 3 결과 | `docs/assets/marketplace/screenshots/` |
| Category | Productivity (Step 5 결정) | 본 runbook |
| Support contact email | `support@<prod-domain>` | 본 runbook Step 5 |
| Support URL | GitHub Issues URL | 본 runbook Step 5 |
| Privacy Policy URL | `legal.<prod-domain>/privacy` | [04 runbook] (G4 결정: legal subdomain 분리) |
| Terms of Service URL | `legal.<prod-domain>/terms` | [04 runbook] (G4 결정: legal subdomain 분리) |
| Distribution | Public / Domain Internal | 결정 보류 — [08 runbook] Step 3 |
| Pricing model | Free | (현재) |
| Listed regions | Worldwide 권장 | 결정 |

**Save Draft**까지만 하고 "Publish"는 누르지 말 것 — G8 (08 runbook) 책임.

## 롤백 시나리오

본 runbook의 모든 산출물은 **자료 수집 + Draft 입력**까지라 외부 publish
mutation이 없다. 단, 다음 두 가지 미세 mutation은 별도 롤백:

- **`gas/appsscript.json:17` logoUrl 교체 후 GAS 새 version 배포**: 새
  version으로 롤백 (Editor → Manage deployments → Edit → Version → 직전
  version 선택 → Deploy). `gstatic` placeholder로 임시 환원.
- **Cloudflare Pages 아이콘 추가 빌드 깨짐**: [04 runbook] 롤백 정책 동일
  (Cloudflare Pages 자동 직전 빌드 유지).

Marketplace SDK 콘솔 Draft 입력값은 publish 전까지 자유롭게 수정·삭제.

## Submission-time 영향

- `docs/marketplace-readiness.md` §1 status 표 11 행 모두 `완료`.
- §5 row 253 (Listing assets bundle) status `미작성` → `완료`.
- §2 row 131 (Onboarding-card 카피 refresh) — [04 runbook] Step 6B와
  묶어 처리. 본 runbook은 직접 변경 없음.
- 본 runbook 자체는 G6 / G8을 unblock하지만 G6의 데모 영상 / G8의 publish
  버튼은 별도 runbook 책임.

## Cross-references

- [`docs/marketplace-readiness.md` §1](../marketplace-readiness.md) — 작업 정본
- [`docs/completion-roadmap.md`](../completion-roadmap.md) — G5 절
- [`docs/add-on-ui-plan.md`](../add-on-ui-plan.md) — Description 본문 source
- [`docs/security-principles.md`](../security-principles.md) — Long description "How it works" 본문 source
- [`gas/appsscript.json`](../../gas/appsscript.json) — Step 2 logoUrl 교체 위치
- [`docs/runbooks/01-domain-and-search-console.md`](./01-domain-and-search-console.md) — `<prod-domain>` 정의
- [`docs/runbooks/02-prod-environment-activation.md`](./02-prod-environment-activation.md) — Step 3 스크린샷 prerequisite
- [`docs/runbooks/04-legal-hosting.md`](./04-legal-hosting.md) — Step 2 / 5 호스팅 인프라 재사용
- [`docs/runbooks/06-oauth-verification.md`](./06-oauth-verification.md) — Step 4 영상 자료 정본 공유
- [`docs/runbooks/08-marketplace-submission.md`](./08-marketplace-submission.md) — 본 runbook의 Draft가 그쪽의 publish 입력
- `src/CLAUDE.md` "GAS deployment URL must stay stable" — Step 2 manifest 배포 절차

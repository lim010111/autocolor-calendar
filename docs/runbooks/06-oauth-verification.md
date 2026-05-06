# 06 — OAuth Consent Screen + Restricted Scope verification

> 이 runbook은 [`TODO.md` §7 line 133](../../TODO.md) "Google Cloud Console:
> OAuth Consent Screen 검수(Verification) 신청" 정본 절차다. Google 측
> 검수가 통상 4-6주 — critical path의 가장 긴 비-코드 구간. **본격 출시
> 일정의 backwards planning은 이 4-6주에서 시작**해야 한다.
>
> Owner: Eng + Product. Pre-conditions가 G1·G4·G5(일부)에 의존해 가장
> 늦게 시작되지만, 검수 리드타임이 길어 이 자료들이 정합되는 즉시 제출
> 권장. 데모 영상은 G5 (마케팅 영상)와 자료 공유.
>
> **이 runbook의 범위 밖**: Marketplace 등록 publish (= G8). 본 runbook은
> Google Cloud Console의 OAuth Consent Screen "Submit for verification"
> 까지만.

- **Pre-conditions**:
  - [01 runbook](./01-domain-and-search-console.md) 완료 — `<prod-domain>`
    GSC verified, OAuth Consent Screen Authorized domains에 등록.
  - [04 runbook](./04-legal-hosting.md) 완료 — Privacy URL / ToS URL 호스팅
    공개 + Consent Screen 입력값 갱신 (Step 6C).
  - [05 runbook](./05-marketplace-listing-assets.md) Step 2 완료 — 자체
    호스팅 아이콘 (Consent 화면에 노출되는 logo).
  - [02 runbook](./02-prod-environment-activation.md) 완료 — 데모 영상
    촬영용 prod env 동작.
  - [`docs/assets/marketplace/scope-justifications.md`](../assets/marketplace/scope-justifications.md)
    본문 final 확정됨 (Step 1 self-review 2026-05-04, status line 박혀있음).
  - GCP Console의 OAuth Consent Screen Edit 권한 보유.
- **Acceptance**:
  - GCP Console → OAuth consent screen → Status 표시:
    - Publishing status: **In production**.
    - Verification status: **Verified** (또는 동급).
  - Restricted Scope (`https://www.googleapis.com/auth/calendar`) 옆에
    `Granted` 또는 `Verified` 라벨 (콘솔 텍스트는 시기에 따라 다름).
  - 검수 통과 메일 수신 (`oauth-verification@google.com` 또는 유사
    sender).

## Step 1 — `scope-justifications.md` final 확정

**상태: 완료 (2026-05-04 self-review).** `docs/assets/marketplace/scope-justifications.md`
본문 첫머리의 status line이 "Final — reviewed against runbook 06 Step 1
checklist on 2026-05-04"로 박혀 있고, 아래 4 elements가 §1·§2·§3 본문에
모두 포함되어 있음을 동일 self-review에서 확인.

- [x] §1 `calendar` (Restricted) — 정당화 본문에 다음 4개가 모두 명시:
  1. **Why we request** — incremental sync + watch lifecycle 필수.
  2. **Data minimum** — `events.list` / `events.patch` / `calendars.list` /
     `channels.{watch,stop}` 호출 envelope만, 사용 필드 화이트리스트.
  3. **Why narrower scopes don't suffice** — `calendar.events`만으로는
     `calendarList.list` 불가, push notification 미지원.
  4. **PII protection** — PII redactor 호출 위치 + observability 테이블의
     PII 배제 정책. `docs/security-principles.md` Principle 2 인용.
- [x] §2 `calendar.events` (Sensitive) — Restricted `calendar`로 cover되지만
  Google 콘솔이 별도 row로 열거하므로 별도 정당화. 본문은 `calendar`와
  중복되지 않게 "events 자원 단위의 read+patch 한정"이라는 axis로 작성됨.
- [x] §3 `userinfo.email` — `sub` (사용자 식별자) + `email` (사용자 식별
  display) 한정. RLS / 사용자 격리의 source of truth임을 명시.
- [x] (참고) Apps Script Add-on framework scopes (`calendar.addons.*`,
  `script.external_request`, `script.locale`)는 framework 강제이므로 정당화
  대상 아님 (이미 §scope-justifications.md "Out of scope"에 명시).

본문 status line 갱신은 본문 변경과 동일 commit으로 처리한다 (status line
본문이 self-policing). 다음 변경 시 이 Step 1을 fresh로 재실행하고
status line 날짜를 갱신할 것.

## Step 2 — Restricted scope 데모 영상 촬영

### 자료 위치

`docs/assets/marketplace/oauth-verification-video.mp4` (path 이미 예약 —
[`docs/marketplace-readiness.md` §2 row 129](../marketplace-readiness.md)).

### 촬영 환경

- **prod env 사용 필수.** dev URL이 화면에 노출되면 거절. URL bar에
  `<prod-domain>` 또는 `accounts.google.com` / `calendar.google.com`만
  보여야 한다.
- 길이: 60-90초. 너무 짧으면 reviewer가 핵심 흐름을 못 보고, 너무 길면
  검수 흐름이 늘어진다.
- 해상도: 1080p 권장 (720p 최소).
- 자막: **영어 자막 필수.** Google 검수 인력은 영어가 일관됨. 자체 한국
  설명 음성 가능, 단 자막은 영어.
- test 계정 사용. 사용자 PII 노출 0.
- 화면 레코더: OBS / Loom / QuickTime 등.

### 사전 준비 (녹화 직전 체크리스트)

영상이 5-15s 구간에서 **Install** 흐름과 65-90s 구간에서 **계정 삭제 →
Welcome 카드 복귀**를 둘 다 보여줘야 하므로, 녹화 시점에 test 계정의
환경이 "Add-on 미설치 + OAuth grant 없음"으로 초기화돼 있어야 한다. 또
50-65s 구간의 **Sync 결과** 시각 확인용으로 캘린더에 매칭 이벤트와
비매칭 이벤트가 적당히 섞여 있어야 한다.

**(a) test 계정 등록**

- 영상 촬영용 계정 1개 (본인 메인 계정 외 — 일정 PII 노출 방지). 신규
  Gmail 계정 또는 본인 운영 부계정 모두 가능.
- GCP Console → APIs & Services → OAuth consent screen → **Test users**
  에 해당 이메일 등록. publishing status가 "In production"으로 전환되기
  전까지(=Step 4 Submit 후 검수 통과 전까지) 미등록 사용자는 OAuth
  consent에서 차단되므로 필수.
- Marketplace 설치 흐름은 publishing status "Testing" 상태에서도 동작
  하므로 본 영상은 검수 신청 전에도 촬영 가능.

**(b) 캘린더 사전 데이터 (test 계정 기본 캘린더)**

50-65s 구간의 매칭 시각 효과를 위해 영상 촬영 당일 또는 다음 날에 다음
이벤트 4개를 미리 만들어 둔다 (모두 30분 길이, default 색상):

| 제목 | 매칭 키워드 | 영상에서 기대 색 |
|---|---|---|
| `Team meeting` | "meeting" hits | 세이지 |
| `Product sync meeting` | "meeting" hits | 세이지 |
| `Lunch break` | (rule 없음 → no_match) | default |
| `Solo focus block` | (rule 없음 → no_match) | default |

매칭 이벤트 2건 + 비매칭 2건 구성으로 50-65s 시각 컷에서 "어떤 건 색이
바뀌고 어떤 건 그대로"가 명확. **이벤트 제목은 영어로 통일** — 자막
"events whose title contains 'meeting'"과 시각 일관성 + reviewer 영어권
독해성.

**(c) 녹화 직전 환경 초기화** (가장 빠뜨리기 쉬움)

이전 dev 테스트 / 본인 메인 계정 install 흔적이 남아 있으면 5-15s
"Install" 단계가 "이미 설치됨"으로 보여 흐름이 깨진다. 녹화 직전 다음을
**test 계정에서** 실행:

1. `myaccount.google.com/permissions` → "AutoColor" 항목 → **Remove
   access** (OAuth grant 회수). 백엔드 `oauth_tokens.needs_reauth=true`로
   flip되며 다음 sync에서 자동 logout 처리됨.
2. Calendar 사이드바 → ⚙️ 설정 → Add-ons → AutoColor → **Uninstall**.
   사이드바에서 아이콘 사라짐 확인.
3. (선택) test 계정 캘린더에 이전 sync로 색이 입혀진 이벤트가 남아
   있으면 수동으로 color reset — 또는 신규 이벤트 4건만 새로 만들고 이전
   이벤트는 캘린더 view에서 가려지도록 다른 캘린더로 이동.
4. Calendar 사이드바를 새로고침해 add-on 마켓 진입 가능한 상태인지
   확인 (사이드바 우측 ➕ → AutoColor 검색 가능).

**(d) 녹화 자체 환경**

- Browser private/incognito window — 메인 계정 cookie 격리.
- 화면 해상도 1920×1080 (1080p 송출용). 사이드바는 최대 폭으로 확장.
- 마이크 음성: 한국어 narration 가능, 단 자막은 영어로 별도 입력.
- 녹화 도구: OBS Studio (cross-platform) / Loom (브라우저) / QuickTime
  (macOS) 중 택1.

### 시나리오 (60-90초 — 모든 Restricted scope 사용 demonstrated)

> 동작 컬럼의 한국어 버튼 라벨은 `gas/addon.js` V8 deploy 시점 기준
> (`buildHomeCard` / `buildRuleManagementCard` / `buildSettingsCard` /
> color list `addon.js:3-13`). UI 카피 변경 시 본 표 갱신 필요.

| 구간 | 시간 | 동작 | 자막 (영문) |
|---|---|---|---|
| Hook | 0-5s | "AutoColor for Calendar" 타이틀 + 1줄 가치 제안 | "AutoColor automatically applies colors to calendar events." |
| Install | 5-15s | Marketplace install → Calendar 사이드바에 add-on 표시 | "Install from Marketplace, then open the Calendar sidebar." |
| OAuth | 15-30s | **"Google 계정으로 시작하기"** 버튼 → Google consent screen → "Allow" → 사이드바가 홈 카드로 갱신 | "Sign in with Google. AutoColor requests Calendar read/write to apply colors." |
| 규칙 추가 | 30-50s | **"매핑 규칙 관리"** → **"새 규칙 추가"** → 키워드 입력 `meeting` + 색상 **세이지** 선택 → **"규칙 추가"** | "Define a rule — any event whose title contains 'meeting' becomes Sage." |
| Sync 결과 | 50-65s | **"지금 즉시 동기화"** → Calendar로 돌아가 사전에 만들어 둔 **"Team meeting"** 이벤트가 세이지 색상으로 변경됨을 시각 확인 | "Run sync — matching events get colored automatically." |
| 계정 삭제 | 65-90s | **"상세 설정"** → **"계정 삭제 / 데이터 삭제"** → 확인 → add-on 사이드바가 비-로그인 Welcome 카드로 환원 | "Delete your account anytime — all data and OAuth grants are removed." |

### 호스팅

업로드 옵션:

- **YouTube unlisted** — 가장 일반적. URL: `youtu.be/<id>`. 검색 비노출.
- **Google Drive shared link** — Workspace 내 권장.
- 본 저장소 `docs/assets/marketplace/oauth-verification-video.mp4` —
  파일 자체를 Git LFS로 관리. 단점: GitHub LFS 비용 + reviewer가 파일을
  다운로드해야 함.

권장: **YouTube unlisted**. 검수 입력 칸이 URL이라 가장 자연스럽다. URL
은 `docs/marketplace-readiness.md` §2 row 129에도 인라인.

## Step 3 — GCP OAuth Consent Screen 입력값 final 점검

GCP Console → APIs & Services → OAuth consent screen → "EDIT APP".

### App information

| 필드 | 값 | source |
|---|---|---|
| App name | AutoColor | `gas/appsscript.json:16` |
| User support email | `support@<prod-domain>` | [05 runbook] Step 5 |
| App logo | 자체 호스팅 1024×1024 또는 480×480 PNG | [05 runbook] Step 2 |

### App domain

| 필드 | 값 | source |
|---|---|---|
| Application home page | `https://<prod-domain>` | [01 runbook] |
| Application privacy policy link | `https://<prod-domain>/privacy` | [04 runbook] Step 6C |
| Application terms of service link | `https://<prod-domain>/terms` | [04 runbook] Step 6C |
| Authorized domains | `<prod-domain>` (apex만) | [01 runbook] Step 5 |

### Developer contact information

| 필드 | 값 |
|---|---|
| Email addresses | 본인 운영 이메일 1개 이상 (구글의 검수 진행 회신용 — `support@`와 분리해도 무방) |

### Scopes

"Add or Remove Scopes" 메뉴에서 다음 4개 모두 추가 (이미 `src/config/constants.ts`
와 `gas/appsscript.json:5-12`로 코드 내에 잠겨 있음):

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/calendar.events`

각 scope row 옆 "Justification" 칸에 [`docs/assets/marketplace/scope-justifications.md`](../assets/marketplace/scope-justifications.md)
본문을 단락 단위로 복붙. 콘솔의 입력 한계가 있을 수 있으므로 (통상
~2,000자/scope) 핵심 4개 항목 (Why / Data minimum / Why narrower
won't suffice / PII protection)을 압축해 입력.

### Test users (publishing status가 "Testing"인 동안만 의미)

dev 단계의 test 계정 목록을 그대로 두어도 검수에 영향 없음. publish 후
의미 사라짐.

### Demo video

App information 또는 별도 "Verification" 단계에 video URL 입력 칸 등장.
Step 2 결과 URL 입력. 자막 / 길이 / 해상도 요건 점검.

## Step 4 — "Submit for verification"

### 제출 직전 체크리스트

- [ ] Step 3의 모든 필드가 placeholder가 아닌 prod 값.
- [ ] Privacy URL / ToS URL이 200 응답 + 본문 노출 ([04 runbook] Step 5
  검증 결과 재확인).
- [ ] 데모 영상 URL이 unlisted라도 비-Google 사용자가 클릭으로 접근 가능
  (private 모드 브라우저로 직접 클릭해 검증).
- [ ] App logo가 1024×1024 또는 480×480, 자체 호스팅 (gstatic 아님).
- [ ] Authorized domains에 `<prod-domain>` 포함.
- [ ] Scopes 4개 모두 등록 + 정당화 본문 입력.

### 제출

GCP Console → OAuth consent screen → "Publishing status" 섹션 →
"PUBLISH APP" → 확인 → 자동으로 "Verification status: Pending" 전환 +
검수 큐 진입.

이 시점부터 publishing status는 **자동으로 "In production"**이 되고
다른 사용자(test users 외)도 OAuth 흐름 시도 가능. 단 Restricted scope는
검수 통과 전까지는 "100명 사용자 제한"이 자동 적용 — Marketplace 정식
publish 전에는 영향 없음.

### 응답 대기 (4-6주)

검수 진행 도중 Google이 추가 정보 요청 메일을 보낼 수 있음. **24시간
이내 응답 권장** — 응답 지연 시 검수 큐 뒤로 밀린다.

자주 나오는 추가 질의:
- "Demo video doesn't show <specific scope> usage" → 영상 재촬영 + 재제출.
- "Privacy Policy doesn't mention <X>" → [04 runbook] Step 1 자문 회신
  본문에 누락된 영역 있을 가능성. 본문 보강 후 publish + 재제출.
- "App logo doesn't match Material Design guidelines" → [05 runbook]
  Step 2 디자인 재작업.

## Step 5 — 통과 후 / 거절 시

### 통과

- GCP Console → OAuth consent screen → "Verification status: Verified"
  표시.
- 검수 통과 메일 수신 (Subject: "Your OAuth Consent Screen has been
  approved" 또는 유사).
- 100명 사용자 제한 자동 해제 — Restricted scope 무제한 사용 가능.
- 다음 게이트: G7 (백업/복구) → G8 (Marketplace 등록) 순.

### 거절

거절 메일에 사유 포함. 가장 흔한 거절 사유:

- 데모 영상이 dev URL 노출.
- Privacy Policy URL이 200 미응답 또는 본문이 영문 검수자 기준 빈약.
- Scope 정당화가 "왜 narrower scope로 부족한지" 누락.
- 데모 영상이 모든 Restricted scope 사용을 demonstrated 못함.

대응:
- 사유 파악 → 해당 자료 보강 → publish 재시도. 재제출 자체는 무료, 시간만
  소요.
- 같은 거절을 2회 반복하면 패턴이 잘못 잡힌 것 — 본 runbook의 Step 1-3을
  처음부터 재검토.

## Step 6 — `marketplace-readiness.md` status 갱신

§2 status 표:
- row 121-122 (Privacy / ToS URL) — 이미 [04 runbook]에서 갱신.
- row 124-128 (Scope list / 정당화) — 본 runbook에서 `초안` → `완료`.
- row 129 (Demo video) — `미작성` → `완료` + URL 인라인.
- row 130 (CASA assessment) — Google이 별도 요청한 적 없으면 `미작성` 유지.
- row 131 (Onboarding-card 카피 refresh) — [04 runbook] Step 6B와 묶음.

§5 status 표:
- row 256 (Scope justifications) — `초안` → `완료`.
- row 257 (Demo video) — `미작성` → `완료`.

`TODO.md:133` 체크박스 `[ ]` → `[x]`.

## (참고) CASA 보안 평가

`docs/marketplace-readiness.md` §2 row 130. Google이 검수 도중 별도 요청
시에만 발동되며, 평가 본인 부담(통상 USD 수천~수만 단위 + 수개월 리드
타임). 본 서비스는 다음 경우에만 요청 받을 가능성:

- 사용자 수가 분기 단위로 100,000+ 이상.
- Restricted scope 외에 더 민감한 scope 사용 (예: Drive full).

본 서비스 현재 design은 Restricted `calendar` 1개만 사용 + PII 마스킹
계약이 명확해 CASA 요청 가능성 낮음. 요청 받으면 `TODO.md`에 별도 line
추가 후 처리.

## 롤백 시나리오

- **검수 결과 받기 전 publish 취소**: GCP Console → OAuth consent screen →
  "Back to Testing". Verification은 자동 취소. 다시 publishing할 때까지
  100명 제한 + Testing 상태로 환원. publish 자체가 mutation 없음.
- **검수 통과 후 본문 큰 변경 (예: 새 scope 추가)**: 새 scope 추가는 **재검수
  유발**. 자료 충분한 시점에 묶어 처리, 사용자 흐름 끊기지 않도록 점진
  적용 (이전 scope 유지 + 새 scope 추가 + verification 재신청).
- **검수 통과 후 Privacy URL 본문 큰 변경**: 본문은 자유롭게 갱신 가능,
  단 핵심 데이터 처리 정책 변경 시 사용자 통지 의무 (한국 PIPA / GDPR).
  자문 회신 [04 runbook] Step 1에 명시된 통지 절차 준수.

## Submission-time 영향

- `docs/marketplace-readiness.md` §2 status 표 거의 모두 `완료`.
- `docs/marketplace-readiness.md` §5 row 256-257 `완료`.
- `TODO.md:133` 체크박스 `[ ]` → `[x]`.
- G8 (Marketplace 등록) unblock — 본 runbook이 G8의 핵심 prerequisite.
- 사용자 OAuth 흐름의 "100명 제한" 자동 해제.

## Cross-references

- [`TODO.md` §7 line 133](../../TODO.md) — 작업 정본
- [`docs/completion-roadmap.md`](../completion-roadmap.md) — G6 절
- [`docs/assets/marketplace/scope-justifications.md`](../assets/marketplace/scope-justifications.md) — Step 1 정본
- [`docs/security-principles.md`](../security-principles.md) — Principle 2 (PII) + Principle 3 (Scope minimization)
- [`src/config/constants.ts`](../../src/config/constants.ts) — 백엔드 scope source of truth
- [`gas/appsscript.json`](../../gas/appsscript.json) — Add-on framework scope source
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) — §2 / §5
- [`docs/runbooks/01-domain-and-search-console.md`](./01-domain-and-search-console.md) — Authorized domains prerequisite
- [`docs/runbooks/02-prod-environment-activation.md`](./02-prod-environment-activation.md) — 데모 환경 prerequisite
- [`docs/runbooks/04-legal-hosting.md`](./04-legal-hosting.md) — Privacy / ToS URL prerequisite
- [`docs/runbooks/05-marketplace-listing-assets.md`](./05-marketplace-listing-assets.md) — Logo / 데모 영상 자료 공유
- [`docs/runbooks/08-marketplace-submission.md`](./08-marketplace-submission.md) — 본 runbook 통과가 G8 prerequisite

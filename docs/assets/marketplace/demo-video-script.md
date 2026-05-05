# Restricted-scope demo video — storyboard + English subtitle script

> 본 문서는 [`docs/runbooks/06-oauth-verification.md`](../../runbooks/06-oauth-verification.md)
> Step 2 "Restricted scope 데모 영상 촬영"의 정본 작업 문서다. 60-90초
> 분량의 OAuth Restricted Scope 검수 제출용 영상 한 편을 위한 분 단위
> 콘티 + 영문 자막 + 사전 셋업 체크리스트 + 자주 거절되는 결함 모음.
>
> Owner: Product (영상 촬영) + Eng (시드 데이터 / prod 환경 검증). 본
> 영상은 [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md)
> Step 4의 Marketplace 홍보 영상으로도 재사용 가능 — 단, Marketplace
> 홍보 영상은 음성 한국어 + 영어 자막 동시 사용 가능, OAuth 검수 영상은
> 영어 자막 필수.
>
> **이 문서의 범위 밖**: 영상 편집 / 자막 SRT 파일 생성 / 업로드 자체.
> 본문은 콘티와 자막 텍스트만 정본화하고, 실제 영상 촬영 / 후반 작업 /
> YouTube unlisted 업로드는 운영자가 별도 진행한다.

## 결과물 요건 (06 runbook Step 2 미러)

| 항목 | 값 | 사유 |
|---|---|---|
| 길이 | **60-90초** | 너무 짧으면 reviewer가 핵심을 못 보고, 너무 길면 검수 흐름이 늘어진다 |
| 해상도 | **1080p 권장 (720p 최소)** | reviewer 화면에서 UI 라벨 식별 가능해야 함 |
| 프레임 | 30fps 또는 60fps | 마우스 이동 가독성 |
| 오디오 | 무음 또는 한국어 음성 모두 가능 | 자막이 있어야 영어 reviewer가 따라올 수 있음 |
| 자막 | **영어 자막 필수** | Google 검수 인력은 영어 일관 |
| 환경 | **prod env** (`autocolorcal.app`) | dev URL 노출 시 즉시 거절 |
| 계정 | 별도 test 계정 | 실 사용자 PII 노출 0 |
| 노출 URL | `accounts.google.com` / `calendar.google.com` / `autocolorcal.app` 만 | 그 외 도메인 노출 시 reviewer 의심 |

---

## 사전 셋업 (촬영 전 30분)

### 1. test 계정 + 시드 캘린더 데이터

촬영용 별도 Google 계정 (`autocolor.demo.<연도>@gmail.com` 등) 1개를
prod env에 OAuth 연결한 적이 **없는** 상태로 준비.

해당 계정의 기본 캘린더에 다음 일정을 미리 입력:

| 제목 | 시간 | 의도 |
|---|---|---|
| 팀 미팅 — 분기 리뷰 | 촬영 당일 오전 | "meeting" 키워드 매칭, 영상에서 색상 변경 시각화 대상 |
| 1:1 with PM | 촬영 당일 오후 | 두 번째 매칭 이벤트 (변경 효과 다중 시각화) |
| 점심 약속 | 촬영 당일 점심 | non-match 대조군 (색상 그대로 — 매칭 없는 이벤트는 영향 없다는 것을 시각화) |
| 휴가 — 5/15 | 촬영일 +10일 | 미래 이벤트 (sync 범위에 포함되어야 함) |

영상의 "Sync 결과" 구간에서 **색상 변경된 이벤트와 변경되지 않은 이벤트가
같은 화면에 나란히 보이도록** 캘린더 view를 "주" 또는 "일"로 미리 설정.

### 2. 브라우저 / 화면 정리

- **profile**: Chrome / Edge guest 모드 또는 별도 Chrome profile.
  주 사용자 PII (북마크, 자동 로그인) 노출 차단.
- **확장 프로그램 비활성화**: 브라우저 우측 아이콘 영역에 광고 차단 /
  비밀번호 매니저 / 캘린더 확장 등이 보이면 reviewer 의심. guest 모드면
  자동 해결.
- **북마크 바 숨기기**: `Ctrl+Shift+B`.
- **창 크기**: 1920×1080 또는 1280×720. 캡처 도구의 출력 해상도와 동일.
- **시계 / 알림**: OS 알림 설정에서 "Do Not Disturb" 활성화. 촬영 중
  Slack / 메일 toast 노출 시 재촬영.
- **다른 탭 닫기**: 캘린더 + (필요 시) Marketplace 1개만 열어 둔 상태.

### 3. 캡처 도구 사전 점검

OBS / Loom / QuickTime 중 택1. 사전 30초 trial 캡처로:

- [ ] 마우스 커서 표시됨 (reviewer가 클릭 위치 식별)
- [ ] 클릭 효과 (잔상 highlight) 활성화 권장
- [ ] 오디오 레벨 0 (무음 촬영) 또는 -12dB 부근 (음성 동반 시)
- [ ] 1080p / 30fps 출력 확인
- [ ] 키보드 입력 시 키 stroke가 화면에 노출되지 않음 (Stream Deck /
      Karabiner의 키 표시 기능 비활성화)

### 4. prod env 사전 검증

촬영 직전 prod env가 정상 동작하는지 30초 smoke test:

```
curl -s https://autocolorcal.app/healthz
# → {"status":"ok"} 또는 동급
```

`docs/runbooks/02-prod-environment-activation.md` Step 12 (smoke test)
의 절차로 OAuth → /me → /sync/run → events.patch 한 round를 사전 1회
성공시킨 후 촬영 시작. 촬영 중 prod 장애 시 재촬영 코스트가 크다.

---

## 콘티 (분 단위)

### Scene 0 — Hook (0-5s, 5초)

| 항목 | 내용 |
|---|---|
| 화면 | "AutoColor for Calendar" 타이틀 카드 + 브랜드 컬러 단색 배경 + 아이콘 1024×1024 (예약 자료 [`05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md) Step 2 산출물) |
| 동작 | 정지 화면. 마우스 이동 없음. |
| 자막 (EN) | **"AutoColor automatically applies colors to your Google Calendar events."** |
| 자막 길이 | 1줄, 약 60자 |
| 사용된 scope | (없음 — intro) |

> 만약 아이콘 자료가 미준비면 단색 배경에 흰색 sans-serif 타이포만으로도
> 가능. reviewer 가독성을 우선.

### Scene 1 — Install + Sidebar 진입 (5-15s, 10초)

| 항목 | 내용 |
|---|---|
| 화면 1 | Workspace Marketplace listing 페이지의 "Install" 버튼 (또는 admin install 시연 시 Workspace Admin Console) |
| 동작 1 | "Install" 클릭 → 권한 동의 다이얼로그 (Google이 자동 띄움) → "Continue" 클릭 |
| 화면 2 | Google Calendar 사이드바 우측에 add-on 아이콘 추가됨 |
| 동작 2 | 사이드바 아이콘 클릭 → "AutoColor 사용 가이드" Welcome Card 노출 (`gas/addon.js:88-135`) |
| 자막 (EN) | **"Install from Marketplace, then open it from the Calendar sidebar."** |
| 사용된 scope | (Workspace install — OAuth 권한 화면은 Scene 2에서) |

> 시간이 빡빡하면 **이미 install 된 상태에서 사이드바 클릭만 시연**해도
> 무방. install 행위 자체가 OAuth scope 사용을 demonstrate 하지는 않으며,
> reviewer가 "Marketplace listing is real"임을 확인하는 컨텍스트일 뿐.

### Scene 2 — OAuth 동의 (15-30s, 15초) ★ Restricted Scope demonstrated

| 항목 | 내용 |
|---|---|
| 화면 1 | Welcome Card 하단의 "Google 계정으로 시작하기" 버튼 |
| 동작 1 | 버튼 클릭 → 새 탭에서 Google OAuth consent 화면 열림 |
| 화면 2 | OAuth consent 화면 — `accounts.google.com/o/oauth2/...`. **AutoColor 앱 이름 + 로고 + 4개 scope row 명시적으로 노출**되어야 함 |
| 동작 2 | 사용자가 scope 목록을 잠깐 hover로 보여주는 듯한 마우스 움직임 (reviewer가 정확한 scope set을 시각 확인) → "Allow" 또는 "Continue" 클릭 |
| 화면 3 | redirect 후 사이드바가 "연결 완료" 상태로 갱신됨 (`actionLogin` 후 home card 재구성 — `gas/addon.js`의 `buildHomeCard` 출력) |
| 자막 (EN) | **"Sign in with Google. AutoColor requests Calendar read and write access to apply colors to events you choose."** |
| 사용된 scope | `openid`, `userinfo.email`, **`calendar`** (Restricted), **`calendar.events`** (Sensitive) |

> **중요**: Scope 목록 row가 화면에 분명히 보여야 함. 화면 너무 빠르게
> 넘어가면 reviewer가 "Restricted scope 사용 demonstrated 안 됨"으로
> 거절한다. consent 화면에서 최소 3-4초 머무는 페이싱.

### Scene 3 — 카테고리/규칙 추가 (30-50s, 20초)

| 항목 | 내용 |
|---|---|
| 화면 1 | 사이드바 home card에서 "매핑 규칙 관리" 버튼 클릭 (`gas/addon.js:213-214` `buildRuleListCard` 진입) |
| 동작 1 | rule list card 진입 — 비어 있는 상태 (test 계정이라 규칙 0건) |
| 동작 2 | "+ 새 규칙 추가" 버튼 클릭 → rule editor card 진입 |
| 동작 3 | "키워드" 입력란에 `meeting` 타이핑 |
| 동작 4 | "색상" 선택에서 "Sage" (또는 시각적으로 두드러지는 색) 선택 |
| 동작 5 | "저장" 또는 "규칙 추가" 버튼 클릭 → rule list card로 복귀 + 1건의 규칙이 추가된 상태로 노출 |
| 자막 (EN) | **"Define a rule: events matching 'meeting' should be colored Sage."** |
| 사용된 scope | (Categories는 우리 backend DB 작업 — Calendar API 사용 0. 단 다음 Scene 4의 sync에서 `calendar.events` PATCH 트리거가 됨) |

> rule editor에 다른 입력이 있으면 (예: regex 옵션 / 우선순위) 본 데모
> 에서는 default 그대로 두고 키워드 + 색상만 시각화. reviewer는 "rule
> 시스템이 존재한다"는 사실만 확인하면 됨.

### Scene 4 — Sync 실행 + 결과 시각화 (50-70s, 20초) ★ `calendar.events` write demonstrated

| 항목 | 내용 |
|---|---|
| 화면 1 | rule list card 또는 home card에서 "지금 동기화" 버튼 클릭 |
| 동작 1 | "동기화 시작" 노티 / 진행 토스트 → 5-10초 대기 |
| 동작 2 | 사이드바에 "동기화 완료: N개 이벤트 처리" 또는 동급 메시지 노출 |
| 화면 2 | Calendar main view로 마우스 이동 → "팀 미팅" 이벤트가 sage 색상으로 변경된 것을 시각 확인 |
| 동작 3 | "팀 미팅" 이벤트 클릭 → event preview에서 색상 변경 확인 (선택) |
| 화면 3 | "점심 약속"은 색상 변경 없음을 함께 시각화 (대조군) |
| 자막 (EN) | **"Sync runs. Matching events become Sage. Non-matching events stay untouched."** |
| 사용된 scope | **`calendar.events`** (PATCH `colorId`), **`calendar`** (`events.list` for incremental sync) |

> sync API 호출이 prod 백엔드 → Google Calendar API로 나가므로 prod env
> 동작이 필수. 캘린더 화면 새로고침 (browser refresh) 한 번 거쳐야 색상
> 변경이 가시화될 수 있음 — 촬영 시 새로고침을 자연스럽게 포함.

### Scene 5 — 계정 / 데이터 삭제 (70-90s, 20초) ★ user agency demonstrated

| 항목 | 내용 |
|---|---|
| 화면 1 | 사이드바 home card에서 "설정" 또는 동급 navigation 진입 |
| 동작 1 | "계정 삭제 / 데이터 삭제" 버튼 클릭 (`gas/addon.js:1028`) |
| 화면 2 | 확인 다이얼로그 ("정말 삭제하시겠습니까?") |
| 동작 2 | "확인" 클릭 → POST `/api/account/delete` 호출 (`src/routes/account.ts`) |
| 화면 3 | 사이드바가 Welcome card로 환원 — "Google 계정으로 시작하기" 버튼이 다시 보임 = 로그아웃 + 데이터 삭제 완료 |
| 자막 (EN) | **"Delete your account anytime — all stored data and OAuth grants are revoked."** |
| 사용된 scope | (없음 — 우리 백엔드의 token revoke + DB cascade. Google API 호출은 본 endpoint에서 token revoke 1건뿐) |

> 이 Scene이 reviewer에게 가장 중요한 메시지: "사용자는 언제든 빠져
> 나갈 수 있다." OAuth 검수의 정렬 항목 중 "데이터 보유 정책"에 직접
> 답하는 시각자료다.

---

## 자막 SRT 초안

```srt
1
00:00:00,000 --> 00:00:05,000
AutoColor automatically applies colors
to your Google Calendar events.

2
00:00:05,000 --> 00:00:15,000
Install from Marketplace,
then open it from the Calendar sidebar.

3
00:00:15,000 --> 00:00:30,000
Sign in with Google. AutoColor requests
Calendar read and write access
to apply colors to events you choose.

4
00:00:30,000 --> 00:00:50,000
Define a rule: events matching 'meeting'
should be colored Sage.

5
00:00:50,000 --> 00:01:10,000
Sync runs. Matching events become Sage.
Non-matching events stay untouched.

6
00:01:10,000 --> 00:01:30,000
Delete your account anytime —
all stored data and OAuth grants are revoked.
```

총 길이 90초 기준. 60-75초로 줄이려면 Scene 1을 5초로 압축 (사이드바
클릭만 — install 단계 생략) 또는 Scene 4의 대조군 시각화를 줄인다.

> SRT 자체는 reviewer에게 별도 제출 필요 없음 (영상에 이미 burned-in
> 자막). 단 SRT 파일을 함께 보관하면 다국어 변환 시 재사용 가능.

---

## 자주 거절되는 결함

| 결함 | 검출 시점 | 회피 |
|---|---|---|
| dev URL 노출 (`autocolor-dev.workers.dev`) | 검수 1차 | prod env에서만 촬영, 사전 smoke test |
| OAuth consent 화면이 너무 빠르게 넘어감 | 검수 1차 | Scene 2에서 최소 3-4초 머물기 |
| Restricted scope (`calendar`)의 read+write 사용이 시각화되지 않음 | 검수 1차 | Scene 4의 sync 결과 시각화 + Scene 2의 scope 목록 hover |
| 데모가 "권한 요청 후 화면"만 보여 줌 (실제 사용 X) | 검수 1차 | Scene 4의 색상 변경을 명확히 시각화 |
| 영어 자막 누락 | 검수 1차 | SRT 초안 그대로 burn-in |
| 사용자 PII 노출 (실 메일 / 실 미팅 제목) | 검수 1차 | test 계정 + 시드 데이터만 사용 |
| 데이터 삭제 / opt-out 흐름 누락 | 검수 2-3차 (privacy 보강 요구) | Scene 5 필수 포함 |
| 영상 화질 < 720p | 검수 1차 | 1080p 출력 |
| 길이 > 2분 | 검수 1차 | 90초 이내 |

---

## 호스팅 / 제출 (참고)

촬영 + 편집 완료 후:

1. YouTube **unlisted**로 업로드 (06 runbook Step 2 권장).
2. URL을 [`docs/marketplace-readiness.md`](../marketplace-readiness.md)
   §2 row 129의 status를 `미작성` → `완료` + URL을 Notes 컬럼에 기록.
3. GCP Console → OAuth consent screen → Demo video URL 입력칸에 paste.

비-Google 사용자가 unlisted URL을 클릭으로 접근 가능한지 시크릿 창으로
검증 (06 runbook Step 4 제출 직전 체크리스트 미러).

---

## Cross-references

- [`docs/runbooks/06-oauth-verification.md`](../../runbooks/06-oauth-verification.md) Step 2 — 본 문서의 정본 절차
- [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md) Step 4 — 홍보 영상 재사용
- [`docs/runbooks/02-prod-environment-activation.md`](../../runbooks/02-prod-environment-activation.md) Step 12 — 촬영 직전 prod smoke test
- [`gas/addon.js`](../../../gas/addon.js) — UI 라벨 정본 (`buildWelcomeCard` / `buildRuleListCard` / 계정 삭제 카드)
- [`docs/architecture-guidelines.md`](../../architecture-guidelines.md) — Halt on Failure / Color Ownership (Scene 4 색상 변경 동작 정합성)
- [`src/CLAUDE.md`](../../../src/CLAUDE.md) "Account deletion (§3 row 179)" — Scene 5의 백엔드 동작 정본

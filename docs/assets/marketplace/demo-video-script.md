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
| 길이 | **90-105초 (≤ 120초 절대 상한)** | 본 영상은 Scene 4 에서 첫 이벤트 1분 지연 (timelapse 압축) + 두 번째 이벤트 5-10초를 모두 시연하므로 90초로 압축이 어렵다. 2분(120초) 초과 시 검수 1차 거절 |
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

> ⚠️ **최초 1회는 1분 이상, 두 번째부터 5-10초 — 두 케이스를 모두
> 시연한다**: OAuth 직후 첫 이벤트 등록 → 색상 적용 라운드는 watch
> 채널 등록 + 첫 incremental sync bootstrap + 토큰 캐시 워밍 때문에
> **약 1분** 소요되며, 이는 backend가 단축할 수 없는 정상 동작이라
> 신규 대시보드에도 "첫 자동 색상 적용은 1분 이상 걸릴 수 있습니다"
> ℹ️ 안내가 노출된다 (`gas/addon.js` 참고). 두 번째 이벤트부터는
> watch 채널이 살아있어 5-10초 안에 색상이 적용된다. 본 영상은 이
> **두 케이스를 같은 테이크 안에서 연속 시연**하므로(Scene 4),
> 사전 워밍업을 하지 말고 prod에 OAuth 연결 이력이 없는 fresh
> test 계정 그대로 본 촬영에 진입한다. prod 헬스 검증은 `curl
> /healthz` + 별도 운영용 계정의 smoke test round로 끝낸다.

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

### Scene 1 — Sidebar 진입 (5-10s, 5초)

| 항목 | 내용 |
|---|---|
| 화면 1 | Google Calendar 메인 화면, 우측 사이드바에 AutoColor 아이콘이 이미 install 된 상태 |
| 동작 1 | 사이드바 아이콘 클릭 → "AutoColor 사용 가이드" Welcome Card 노출 (`gas/addon.js:86-116` `buildWelcomeCard`) |
| 자막 (EN) | **"Open AutoColor from the Calendar sidebar."** |
| 사용된 scope | (없음 — UI 진입) |

> Marketplace install 단계는 본 영상에서 **생략**. install 행위는 OAuth
> scope 사용을 demonstrate 하지 않으며, reviewer 도 install 흐름이 아닌
> scope 사용을 본다. 길이 여유가 있는 marketplace 홍보 변종에서는 Install
> 클릭 → "Continue" 다이얼로그 5초 분량을 앞에 prepend 가능.

### Scene 2 — OAuth 동의 (10-25s, 15초) ★ Restricted Scope demonstrated

| 항목 | 내용 |
|---|---|
| 화면 1 | Welcome Card 하단의 "Google 계정으로 시작하기" 버튼 (`welcome.cta.login`) |
| 동작 1 | 버튼 클릭 → `actionStartOAuth` (`gas/addon.js:1161`) 가 새 창에서 OAuth consent URL 오픈 (`OpenAs.FULL_SIZE`, `OnClose.RELOAD_ADD_ON`) |
| 화면 2 | OAuth consent 화면 — `accounts.google.com/o/oauth2/...`. **AutoColor 앱 이름 + 로고 + 4개 scope row 명시적으로 노출**되어야 함 |
| 동작 2 | 사용자가 scope 목록을 잠깐 hover로 보여주는 듯한 마우스 움직임 (reviewer가 정확한 scope set을 시각 확인) → "Allow" 또는 "Continue" 클릭 |
| 화면 3 | consent 창 닫힘 → `RELOAD_ADD_ON` 트리거로 사이드바가 Home Card 로 재렌더 (`gas/addon.js:129` `buildHomeCard`) — "AutoColor 대시보드" 헤더 + "지금 모든 일정에 규칙 적용" footer 버튼 노출 |
| 자막 (EN) | **"Sign in with Google. AutoColor requests Calendar read and write access to apply colors to events you choose."** |
| 사용된 scope | `openid`, `userinfo.email`, **`calendar`** (Restricted), **`calendar.events`** (Sensitive) |

> **중요**: Scope 목록 row가 화면에 분명히 보여야 함. 화면 너무 빠르게
> 넘어가면 reviewer가 "Restricted scope 사용 demonstrated 안 됨"으로
> 거절한다. consent 화면에서 최소 3-4초 머무는 페이싱.

### Scene 3 — 규칙 추가 (25-40s, 15초)

| 항목 | 내용 |
|---|---|
| 화면 1 | Home Card 의 "색상 규칙 관리" 버튼 클릭 (`home.btn.rules` — `gas/addon.js:178-180`, action `actionGoToRuleManagement`) |
| 동작 1 | `buildRuleManagementCard` (`gas/addon.js:794`) 카드 진입 — 비어 있는 상태 ("아직 등록된 규칙이 없습니다. 위에서 첫 규칙을 만들어보세요." `rules.list.empty`) |
| 동작 2 | 카드 상단의 "규칙 만들기" 섹션 (`rules.section.create`) — "규칙 이름"(`rules.name.label`) 입력란에 `meeting` 타이핑. 키워드는 그 아래 접힌 "키워드 (선택)" 섹션(`rules.section.keywords`)에 있고 선택 입력이라 데모에선 생략 |
| 동작 3 | "일정 색상 선택" (`rules.colorPicker`) 에서 "Sage" (또는 시각적으로 두드러지는 색) 선택 |
| 동작 4 | "규칙 추가" 버튼 (`rules.btn.add`, action `actionAddRule` — `gas/addon.js:856`) 클릭 → 같은 카드가 재렌더되며 "내 규칙 목록"(`rules.section.list`)에 1건이 추가된 상태로 노출 + "새 규칙이 저장되었습니다" 토스트(`rules.toast.added`) |
| 자막 (EN) | **"Define a rule: events matching 'meeting' should be colored Sage."** |
| 사용된 scope | (Rule 목록은 우리 backend DB 작업 — Calendar API 사용 0. 단 다음 Scene 4의 sync에서 `calendar.events` PATCH 트리거가 됨) |

> 규칙 추가는 별도 카드가 아니라 `buildRuleManagementCard` 한 화면 안에
> 인라인 섹션으로 노출된다 (상단 "규칙 만들기" / 하단 "내 규칙 목록").
> 따라서 별도 진입/복귀 동작 없이 같은 카드에서 입력 → 저장 → 목록 갱신
> 까지 일관되게 시각화된다. reviewer는 "rule 시스템이 존재한다"는 사실만
> 확인하면 됨.

### Scene 4 — 자동 색상 적용 (40-85s, 45초) ★★ Killer feature + `calendar.events` write demonstrated

본 add-on의 **제품 가치 가시화의 핵심**. Scene 3에서 만든 규칙이 사용자가
별도 버튼을 누르지 않아도 새 일정에 자동 반영된다는 것을 **두 이벤트
연속 시연**으로 보여준다 — 첫 이벤트는 watch 채널 + sync bootstrap
때문에 약 1분, 두 번째부터는 5-10초. backend 의 Calendar Watch push
채널 → `/sync/run` enqueue → `events.patch` 파이프라인이 이 동작의 정체.

#### Scene 4a — 첫 이벤트 (40-65s, 25초): 약 1분 지연 (timelapse)

| 항목 | 내용 |
|---|---|
| 화면 1 | Calendar 주간 view 로 이동 → 빈 슬롯 더블클릭 또는 좌측 상단 "+ 만들기" / "Create" 클릭 |
| 동작 1 | quick-create 다이얼로그에 `Team meeting — Q2 review` 타이핑 (Scene 3에서 등록한 'meeting' 키워드와 substring 매칭. Korean 자막을 강조하고 싶으면 Scene 3에서 키워드를 '미팅' 으로 바꾸고 본 Scene에서 `팀 미팅 — Q2 리뷰` 타이핑 — 둘 중 하나로 일관) |
| 동작 2 | "저장" / "Save" 클릭 → 캘린더에 새 일정이 **default 파란색**으로 노출 |
| 자막 (EN) #1 | **"The first event takes about 1 minute (initial sync setup)."** |
| 화면 2 | **마우스 이동 없이 약 1분 정지 화면 → 4-5x timelapse 압축으로 영상에서는 ~15초 처리**. 우측 상단 시계가 1분 흐른 것을 증언. 자막에 "(timelapse)" 명시 |
| 동작 3 | 첫 이벤트 색상이 **default → Sage 로 자동 전환** — 사이드바를 짧게 비춰 사용자가 동기화 버튼을 누르지 않았음을 강조 |
| 자막 (EN) #2 | **"Color applied automatically — no extra click."** |

#### Scene 4b — 두 번째 이벤트 (65-85s, 20초): 5-10초 정상 상태

| 항목 | 내용 |
|---|---|
| 화면 3 | 같은 캘린더 view 에서 다른 빈 슬롯 더블클릭 → quick-create 다이얼로그 |
| 동작 4 | `1:1 with PM — meeting prep` 타이핑 ('meeting' 키워드 두 번째 매칭) → "저장" 클릭 → 또 한 번 default 파란색으로 노출 |
| 자막 (EN) #3 | **"From now on, new events are colored within 5-10 seconds."** |
| 화면 4 | **5-10초 정지 화면 — 시간 압축 없음, 실시간 그대로**. 시계가 같이 흐름 |
| 동작 5 | 두 번째 이벤트의 색상이 **default → Sage 로 전환** — Scene 4a와 동일한 색이 적용되어 규칙의 일관성 시각화 |
| 사용된 scope (4a + 4b 공통) | **`calendar`** (`events.watch` 푸시 채널 + `events.list` incremental sync), **`calendar.events`** (PATCH `colorId`) |

> **두 이벤트를 모두 보여주는 이유**: 첫 1분 지연은 watch 채널 등록 +
> 첫 incremental sync bootstrap 때문에 backend 단에서 단축할 수 없는
> 정상 동작이다. 한 이벤트만 보여주면 reviewer / 신규 사용자 입장에서
> "1분이 정상인지 5-10초가 정상인지" 판단이 안 선다. 같은 테이크에서
> 연속 시연하면 (1) backend 가 실제로 watch+patch 사이클을 돌고 있음
> (조작 의심 차단) + (2) 신규 사용자에게 "첫 1분은 정상, 이후 빠름"
> 이라는 멘탈 모델을 동시에 전달할 수 있다.

> **타이밍 / 편집 리스크**: Scene 4a 의 1분 정지 구간은 **timelapse
> 4-5x 압축 + 자막 "(timelapse)" 명시 필수**. 압축 없이 1분 정지를
> 그대로 두면 영상 총 길이가 2분 제약을 깨고 reviewer 집중도 잃는다.
> 반대로 자막 "(timelapse)" 없이 압축만 하면 reviewer 가 "조작된
> 영상" 으로 의심한다. Scene 4b 의 5-10초는 **압축 없이 그대로 보존**
> — 정상 상태 페이싱은 그 자체가 제품 데모다. 4b 가 12초를 넘으면
> 재촬영(prod 의 watch 채널 헬스 점검 후 다시).

> **(선택) b-roll — 수동 백필**: 시간 여유가 있고 length 가 100초
> 미만으로 마무리될 것 같으면, Scene 4b 끝에 5초 b-roll 로 Home Card
> footer 의 "지금 모든 일정에 규칙 적용" 버튼 (`home.cta.syncNow` —
> `gas/addon.js:209-213`) 클릭 → "규칙을 적용 중입니다. 잠시 후
> 반영됩니다." 토스트 (`sync.toast.running`) 노출. 기존 일정 일괄
> 백필 흐름 보조 시연. 단 이 b-roll 을 끼우면 Scene 5 시작이 90s
> 부근으로 밀려 총 길이 100s+ 가 되므로 reviewer 의 길이 제약 (≤ 2분)
> 안에서만 사용.

### Scene 5 — 계정 / 데이터 삭제 (85-105s, 20초) ★ User agency demonstrated

| 항목 | 내용 |
|---|---|
| 화면 1 | Home Card 의 "상세 설정" 버튼 클릭 (`home.btn.settings` — `gas/addon.js:182-184`, action `actionGoToSettings`) → `buildSettingsCard` 진입 (`gas/addon.js:1049`) |
| 동작 1 | 계정 섹션의 "서비스 해지 및 계정 삭제" 버튼 클릭 (`settings.btn.deleteAccount` — `gas/addon.js:1088-1091`, action `actionGoToAccountDeleteConfirm`) |
| 화면 2 | 확인 카드 `buildAccountDeleteConfirmCard` (`gas/addon.js:1114`) — 헤더 "서비스 해지 및 계정 삭제 / 정말 진행하시겠습니까?" + 경고 문구 (`delete.warning`) + "⬅ 취소" / "네, 진행합니다" 두 버튼 (`delete.btn.cancel` / `delete.btn.confirm`) |
| 동작 2 | "네, 진행합니다" 클릭 → `actionConfirmDeleteAccount` (`gas/addon.js:1143`) 가 POST `/api/account/delete` 호출 (`src/routes/account.ts:19`) |
| 화면 3 | 사이드바가 Welcome card로 환원 — "Google 계정으로 시작하기" 버튼이 다시 보임 + "서비스가 해지되고 계정이 삭제되었습니다." 토스트(`delete.toast.done`) = 로그아웃 + 데이터 삭제 완료 |
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
00:00:05,000 --> 00:00:10,000
Open AutoColor from the Calendar sidebar.

3
00:00:10,000 --> 00:00:25,000
Sign in with Google. AutoColor requests
Calendar read and write access
to apply colors to events you choose.

4
00:00:25,000 --> 00:00:40,000
Define a rule: events matching 'meeting'
should be colored Sage.

5
00:00:40,000 --> 00:00:55,000
The first event takes about 1 minute
(initial sync setup). (timelapse)

6
00:00:55,000 --> 00:01:05,000
Color applied automatically —
no extra click.

7
00:01:05,000 --> 00:01:25,000
From now on, new events are colored
within 5-10 seconds.

8
00:01:25,000 --> 00:01:45,000
Delete your account anytime —
all stored data and OAuth grants are revoked.
```

총 길이 105초 기준 (Scene 4a 의 1분 지연을 timelapse 4-5x 로 압축한
영상 시간). 90초로 줄이려면 Scene 5(계정 삭제)를 15초로 단축 +
Scene 4a timelapse 를 더 짧게 압축. **Scene 4 의 두 이벤트 시연
(40-85s) 은 본 영상의 핵심 가치 데모이므로 절대 줄이지 않는다** —
첫 1분 + 두 번째 5-10초의 대비 자체가 "초기 부트스트랩 / 정상 상태"
멘탈 모델을 전달하는 유일한 시각 단서다. 4b 의 실시간 5-10초 대기는
편집 압축 금지.

> 자막 #5 의 "(timelapse)" 표기는 **필수**. reviewer 가 1분 정지 →
> 영상 15초 압축 사이의 시간 차를 "조작" 으로 의심하지 않게 하는
> 명시적 disclosure 다.

> SRT 자체는 reviewer에게 별도 제출 필요 없음 (영상에 이미 burned-in
> 자막). 단 SRT 파일을 함께 보관하면 다국어 변환 시 재사용 가능.

---

## 자주 거절되는 결함

| 결함 | 검출 시점 | 회피 |
|---|---|---|
| dev URL 노출 (`autocolor-dev.workers.dev`) | 검수 1차 | prod env에서만 촬영, 사전 smoke test |
| OAuth consent 화면이 너무 빠르게 넘어감 | 검수 1차 | Scene 2에서 최소 3-4초 머물기 |
| Restricted scope (`calendar`)의 read+write 사용이 시각화되지 않음 | 검수 1차 | Scene 4의 자동 색상 전환(default → Sage) + b-roll 의 수동 백필 토스트 + Scene 2의 scope 목록 hover |
| 데모가 "권한 요청 후 화면"만 보여 줌 (실제 사용 X) | 검수 1차 | Scene 4의 색상 변경을 명확히 시각화 — 일정 저장 시점과 색 변경 시점 사이 시계 흐름 보존 |
| Push 자동화가 "조작된 영상" 으로 보임 (편집 의심) | 검수 2-3차 | Scene 4b의 실시간 5-10초 대기 화면을 압축 없이 보존. Scene 4a 의 1분 timelapse 압축 시 자막에 "(timelapse)" 명시 disclosure |
| Scene 4 가 한 이벤트만 시연 — 1분/5-10초 대비를 reviewer가 볼 수 없음 | 검수 2-3차 (제품 동작 불명확) | Scene 4a (첫 이벤트 ~1분, timelapse) + Scene 4b (두 번째 이벤트 5-10초, 실시간) 두 케이스를 같은 테이크에서 연속 시연 |
| Scene 4a 의 timelapse 압축에 "(timelapse)" 자막 누락 | 검수 2-3차 | SRT #5 의 "(timelapse)" 표기 burn-in. 미표기 시 reviewer 가 1분 정지 → 15초 압축 차이를 조작으로 의심 |
| 영어 자막 누락 | 검수 1차 | SRT 초안 그대로 burn-in |
| 사용자 PII 노출 (실 메일 / 실 미팅 제목) | 검수 1차 | test 계정 + 시드 데이터만 사용 |
| 데이터 삭제 / opt-out 흐름 누락 | 검수 2-3차 (privacy 보강 요구) | Scene 5 필수 포함 |
| 영상 화질 < 720p | 검수 1차 | 1080p 출력 |
| 길이 > 2분 | 검수 1차 | 90-105초 권장, 120초 절대 상한 |

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
- [`gas/addon.js`](../../../gas/addon.js) — UI 라벨 정본 (`buildWelcomeCard` / `buildHomeCard` / `buildRuleManagementCard` / `buildSettingsCard` / `buildAccountDeleteConfirmCard`). 사용자 노출 문자열은 `gas/i18n.js` 의 `welcome.*` / `home.*` / `rules.*` / `sync.toast.*` / `settings.*` / `delete.*` 키 — Korean 번들이 본 콘티의 정본 라벨
- [`docs/architecture-guidelines.md`](../../architecture-guidelines.md) — Halt on Failure / Color Ownership (Scene 4 색상 변경 동작 정합성)
- [`src/CLAUDE.md`](../../../src/CLAUDE.md) "Account deletion (§3 row 179)" — Scene 5의 백엔드 동작 정본

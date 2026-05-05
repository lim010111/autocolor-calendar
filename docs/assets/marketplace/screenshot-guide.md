# Marketplace screenshots — 촬영 체크리스트 + 시드 데이터 가이드

> 본 문서는 [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md)
> Step 3 "Promotional screenshots"의 정본 작업 문서다. 4장의 listing
> 스크린샷 (Welcome / Home / Rules / Event preview) 촬영 직전에 따라가야
> 할 사전 셋업 / 시드 캘린더 데이터 / 화면별 구도 / 자주 거절되는 결함을
> 정리한다.
>
> Owner: Product (촬영) + Eng (시드 데이터 / prod env 검증). 데모 영상
> ([`demo-video-script.md`](./demo-video-script.md))의 사전 셋업 항목과
> 의도적으로 중복 — 이 두 작업은 같은 test 계정 / 같은 시드 데이터로
> 한 자리에서 이어 진행하는 것이 가장 효율적.
>
> **이 문서의 범위 밖**: 영상 촬영 (별도 [`demo-video-script.md`](./demo-video-script.md)),
> 아이콘 디자인 ([`icon-design-brief.md`](./icon-design-brief.md) 별도),
> screenshot 후 편집 (cropping / annotation).

## 결과물 요건 (05 runbook Step 3 미러)

| 항목 | 값 | 사유 |
|---|---|---|
| 장수 | **최소 3장**, 권장 4장 (Welcome / Home / Rules / Event preview) | Marketplace listing 카드 carousel 표시 |
| 해상도 | **1280×800** | Marketplace 표시 영역 비율과 일치 |
| 비율 | 16:10 | 위와 동일 |
| 형식 | PNG (lossless) | JPEG artifact가 UI 라벨 가독성 저해 |
| 환경 | **prod env** (`autocolorcal.app`) | dev URL 노출 시 reviewer 거절 |
| 계정 | 별도 test 계정 | 실 사용자 PII 노출 0 |
| 파일명 | `01-welcome.png` / `02-home.png` / `03-rules.png` / `04-event-preview.png` | 05 runbook Step 3 명시 |
| Commit 위치 | `docs/assets/marketplace/screenshots/` | 05 runbook Step 3 명시 |

---

## 사전 셋업 (촬영 전 30분)

### 1. test 계정 + 시드 데이터 (데모 영상과 공유 가능)

촬영용 별도 Google 계정 1개를 prod env에 OAuth 연결한 적이 **없는**
상태로 준비. (데모 영상 촬영을 같은 자리에서 이어 한다면 동일 계정 사용
권장.)

#### 시드 카테고리 5개

규칙 추가 화면(Rule list) 스크린샷이 비어 보이지 않도록, 사이드바를 통해
미리 카테고리 5개를 등록.

| # | 키워드 | 색상 (Google Calendar palette) | 의도 |
|---|---|---|---|
| 1 | `회의` | Sage (palette 옅은 녹색) | 가장 자주 매칭될 카테고리 |
| 2 | `1:1` | Blueberry (옅은 파랑) | 매칭이 한정적인 작은 그룹 |
| 3 | `리뷰` | Tangerine (주황) | 강조 색상 시각화 |
| 4 | `학습` | Lavender (보라) | 컬러 다양성 시연 |
| 5 | `점심` | Banana (노랑) | non-business 카테고리 — 시각 다양성 |

#### 시드 캘린더 이벤트 10개

촬영 당일 기준으로 다음 이벤트를 사전 등록. "주" 또는 "일" view에서
색상이 분포된 화면을 만들기 위함.

| 제목 | 시작 | 매칭 키워드 | 기대 색상 |
|---|---|---|---|
| 주간 회의 | 촬영일 09:00 | 회의 | Sage |
| 1:1 with PM | 촬영일 10:30 | 1:1 | Blueberry |
| 디자인 리뷰 | 촬영일 13:00 | 리뷰 | Tangerine |
| 점심 약속 | 촬영일 12:00 | 점심 | Banana |
| 영어 학습 | 촬영일 18:00 | 학습 | Lavender |
| 분기 리뷰 회의 | 촬영일+1 14:00 | 회의 (우선) | Sage |
| 코드 리뷰 | 촬영일+2 15:00 | 리뷰 | Tangerine |
| 주간 회의 | 촬영일+3 09:00 | 회의 | Sage |
| 점심 — 외부 미팅 | 촬영일+4 12:00 | 점심 (우선) | Banana |
| (매칭 없음) 휴가 | 촬영일+5 종일 | 매칭 없음 | (Google 기본) |

> 마지막 "휴가"는 의도적으로 매칭 없는 이벤트 — Home 카드 카운터에
> "분류된 이벤트 9 / 미분류 1" 등의 비-zero 분포가 보여 reviewer에게
> 시스템이 동작 중임을 시각화.

### 2. 브라우저 / 화면 정리 (데모 영상 가이드와 동일)

- **profile**: Chrome / Edge guest 모드 또는 별도 profile.
- **확장 프로그램 비활성화**: 광고 차단 / 비밀번호 매니저 / 캘린더 확장.
- **북마크 바 숨기기**: `Ctrl+Shift+B`.
- **창 크기**: 1280×800 (촬영 직전 `window.resizeTo(1280, 800)` 또는
  Chrome DevTools "Device Mode" 1280×800 preset).
- **시계 / 알림**: OS Do Not Disturb 활성화.
- **다른 탭 닫기**: Calendar 1개만.
- **DevTools 닫기**: 사이드바 width 변동 방지.

### 3. prod env 사전 검증

```
curl -s https://autocolorcal.app/healthz
```

[`docs/runbooks/02-prod-environment-activation.md`](../../runbooks/02-prod-environment-activation.md)
Step 12 (smoke test) 1회 round 통과 후 촬영 시작.

### 4. 시드 데이터 입력 + 동기화 1회

OAuth 연결 후 사이드바에서:

1. 위 카테고리 5개 등록 (Rule list → 새 규칙 추가 5회 반복).
2. 위 이벤트 10개를 캘린더에 등록 (수기 또는 ICS import).
3. 사이드바 "지금 동기화" 버튼 1회 클릭 → 결과 토스트 확인 (예상: "9개
   이벤트 색상 적용 / 1개 매칭 없음").
4. 캘린더 view를 "주" 또는 "일"로 변경하여 색상 분포 시각 확인.

---

## 화면별 촬영 가이드

### 01-welcome.png — Welcome 카드 (최초 onboarding)

| 항목 | 내용 |
|---|---|
| 화면 트리거 | test 계정으로 **처음** add-on 사이드바 열기 (OAuth 연결 전 상태 — Welcome card는 OAuth 연결 후에는 다시 안 나옴) |
| 보여야 할 것 | "AutoColor 사용 가이드" 헤더, 3-step 튜토리얼, "Google 계정으로 시작하기" 버튼 (`gas/addon.js:88-135`) |
| 보이면 안 될 것 | URL bar의 dev URL, 다른 탭, 북마크, OS 시계 (옵션 — 흐림 처리도 가능) |
| 구도 | 사이드바 좌측 + Calendar main view 일부 (background) — Welcome card 자체가 listing의 first impression |
| 캡처 영역 | 1280×800 전체 또는 사이드바 + Calendar 일부 → 이후 1280×800으로 crop |
| 기록 시점 | OAuth 연결 직전 (한 번만 가능 — 연결 후에는 Home card로 강제 전환) |

> **주의**: Welcome card는 OAuth 연결 직전 1회만 노출. test 계정에서 한
> 번 OAuth를 완료하면 다음 사이드바 진입은 곧장 Home card. 이 순서를
> 어기면 test 계정을 폐기하고 새로 만들어야 한다. **순서 권장**:
> Welcome 촬영 → OAuth 연결 → 시드 데이터 입력 → 나머지 3장 촬영.

### 02-home.png — Home 카드 (메인 대시보드)

| 항목 | 내용 |
|---|---|
| 화면 트리거 | OAuth 연결 + 카테고리 5개 + 시드 이벤트 10개 + sync 1회 후 사이드바 재진입 |
| 보여야 할 것 | "이번 주 분류된 일정 N개" 카운터 (시드 결과 9), "최근 동기화 X분 전", 주요 액션 버튼 (`gas/addon.js`의 `buildHomeCard`) |
| 보이면 안 될 것 | "동기화 실패" / "재시도 필요" 등 에러 토스트, dev URL |
| 구도 | 사이드바 + Calendar main view — Calendar가 "주" 또는 "일" view에서 색상 분포가 시각화된 상태 |
| 캡처 영역 | 1280×800 전체 권장 (Home card + 색상 분포된 Calendar 동시 노출이 가장 효과적) |
| 기록 시점 | sync 1회 직후, "최근 동기화" 라벨이 "방금 전" 또는 "1분 전"일 때 |

> Home card의 카운터가 mock 값이 아니라 [§6 Wave B `/api/stats`](../../../src/CLAUDE.md)
> 의 실 데이터인지 확인. mock 노출 시 reviewer가 "stub UI"로 판정해
> 거절 가능.

### 03-rules.png — Rules 카드 (규칙 관리)

| 항목 | 내용 |
|---|---|
| 화면 트리거 | 사이드바 → "매핑 규칙 관리" 버튼 클릭 (`gas/addon.js:213-214`) |
| 보여야 할 것 | 시드 카테고리 5개의 list, 각 row의 키워드 + 색상 dot, "+ 새 규칙 추가" 버튼 |
| 보이면 안 될 것 | 1개도 없는 비어있는 list (시드 데이터로 5개 등록 상태 필수), "삭제 확인" 다이얼로그 등 일시 모달 |
| 구도 | 사이드바 widget이 list로 가득 찬 상태 — Marketplace listing에서 "잘 운영되는 시스템" 인상 |
| 캡처 영역 | 사이드바 영역 위주 → 1280×800으로 crop (Calendar 영역은 사이드바를 명확히 보여주기 위해 비워도 OK) |
| 기록 시점 | 카테고리 5개 등록 직후, list가 stable한 상태 |

> 5개의 카테고리를 골고루 다른 색상으로 쓰는 것이 핵심 — 같은 색상 쏠림은
> "기능 다양성 부족"으로 보일 수 있음.

### 04-event-preview.png — Event preview (특정 이벤트 클릭 시 매칭 규칙 표시)

| 항목 | 내용 |
|---|---|
| 화면 트리거 | Calendar에서 시드 이벤트 중 매칭이 명확한 1건(예: "주간 회의") 클릭 → add-on이 event open trigger 발동 |
| 보여야 할 것 | 이벤트 제목 (test 데이터라 PII 무관), 매칭된 규칙 표시 ("회의" → Sage), "🤖 AI 분류 확인" 버튼 (`gas/addon.js`의 `buildEventCard`) |
| 보이면 안 될 것 | 실 사용자 PII (참석자 이메일은 시드 데이터에 추가하지 말 것), error toast |
| 구도 | Calendar event modal + 사이드바 add-on event card 동시 노출 — Marketplace에서 "이벤트 단위 piece가 어떻게 동작하는지" 시각화 |
| 캡처 영역 | 1280×800 전체 |
| 기록 시점 | sync 직후, 색상 변경된 이벤트가 시각화된 상태에서 클릭 |

> "주간 회의" / "분기 리뷰 회의" 등 회의 키워드 매칭 이벤트가 가장
> 안정적. "디자인 리뷰" 같은 multi-keyword (회의 + 리뷰) 이벤트는 우선
> 순위 정책에 따라 다른 색상이 나올 수 있어 reviewer 혼란 위험 — Sage
> 단일 매칭 이벤트로 첫 촬영 권장.

---

## 촬영 후 후처리

### 1. 1280×800 정확 crop

캡처가 1280×800에 정확히 맞지 않으면 ImageMagick / Figma / Preview에서
crop. 기준점:

- 좌상단: Chrome viewport 좌상단 (URL bar 아래 시작) 또는 Calendar
  main view 시작점.
- 사이드바와 Calendar 영역의 비율은 보존 (브라우저 기본 width — Add-on
  사이드바는 약 320px).

### 2. PII 마스킹 (스크린샷에 실수로 노출된 경우)

- test 계정의 이메일이 사이드바 상단에 표시 → blur 또는 단색 박스 마스킹.
- Calendar grid의 다른 calendar 이름 → 단색 박스.
- OS 시계 / 알림 / 다른 앱 windows → crop 또는 박스.

### 3. 파일명 / commit

```
docs/assets/marketplace/screenshots/
├── 01-welcome.png       # 1280×800
├── 02-home.png          # 1280×800
├── 03-rules.png         # 1280×800
└── 04-event-preview.png # 1280×800
```

별도 PR로 commit. PR 본문에 4장 모두 inline preview (`![](path)`)로
포함하면 review 시 시각 확인 용이.

### 4. readiness 갱신

[`docs/marketplace-readiness.md`](../marketplace-readiness.md) §1 row
75 (Promotional screenshots) status `미작성` → `완료`.

---

## 자주 거절되는 결함

| 결함 | 검출 시점 | 회피 |
|---|---|---|
| 해상도 1280×800 미달 / 초과 | listing 등록 시 자동 검출 | 캡처 직후 정확 crop |
| dev URL 노출 (`autocolor-dev.workers.dev`) | 검수 1차 | prod env에서만 촬영, sync 결과도 prod 데이터 |
| Mock UI 노출 ("이번 주 분류된 일정 (mock)" 또는 placeholder 라벨) | 검수 1차 | sync 1회 실 round 후 촬영, `/api/stats` 응답이 stable한 후 |
| 사용자 PII 노출 (test 계정의 이메일이 사이드바 상단에 노출) | 검수 1차 | 후처리 단계에서 blur 마스킹, 또는 사이드바 상단 crop out |
| 사이드바가 비어 있음 (카테고리 / 이벤트 0건) | 검수 1차 | 시드 데이터 5+10건 입력 후 촬영 |
| 같은 카드 / 같은 화면을 4장 모두 사용 | 검수 1차 | 4가지 카드 (Welcome / Home / Rules / Event preview)를 1장씩 |
| Welcome card를 OAuth 연결된 계정으로 촬영 시도 | 촬영 시점 | OAuth 연결 직전 1회만 가능 — 새 test 계정 필요 |
| URL bar의 OAuth 흐름 노출 ("oauth/google/callback?code=...") | 검수 1차 | OAuth 응답 후 redirect 완료된 시점에서 촬영 |
| 화면에 Slack / Email / Browser notification toast 노출 | 검수 1차 | OS Do Not Disturb 활성 |
| Calendar에 실 사용자 / 동료 이벤트 잔존 | 검수 1차 | test 계정의 빈 캘린더에 시드 데이터만 — 다른 calendar 노출 없음 |

---

## Cross-references

- [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md) Step 3 — 본 문서의 정본 절차
- [`docs/assets/marketplace/demo-video-script.md`](./demo-video-script.md) — 같은 시드 데이터 / test 계정 공유 가능
- [`docs/runbooks/02-prod-environment-activation.md`](../../runbooks/02-prod-environment-activation.md) Step 12 — 촬영 직전 prod smoke test
- [`docs/add-on-ui-plan.md`](../../add-on-ui-plan.md) — 4 화면 (Welcome / Home / Rules / Event preview) 정본 카피
- [`gas/addon.js`](../../../gas/addon.js) — 실 UI 코드
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) §1 row 75 — 촬영 완료 후 status 갱신 대상

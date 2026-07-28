Status: ready-for-human
GitHub: #148

## What to build

GAS 규칙 편집기를 A2 모델로 재배선한다: 목록 = Google 라벨(정본) + 우리
분류 설정, 생성 = 기존 플로우가 라벨 생성을 겸임, 관리(개명·색·삭제) =
Google UI 로 안내 (ADR-0006 Decision 2·3 의 UI 절반).

설계 노트 (구현 세션 재량):

- **목록**: 백엔드가 캐시한 라벨+Rule 병합 뷰. 이름 있는 라벨은 전부 Rule
  행(자동 생성분 포함 — #02), "라벨 삭제됨" 상태는 배지. unnamed 슬롯은
  행으로 안 만들고, 홈 카드에 "Google 에서 색에 이름을 붙이면 규칙이
  됩니다" 힌트 1줄 (4로케일).
- **생성 플로우**(기존 화면 유지): 이름 + 색 스와치 + 키워드 → 백엔드
  `appendEventLabel`(#02) + Rule 생성. 색 스와치는 24 기본 hex —
  `scripts/gen-swatch-assets.py` 로 data URI 재생성 (기존 11-swatch
  파이프라인 재사용). 실측 hex 목록은 PRD/probe 산출 참조.
- **이름·색 읽기 전용**: 기존 Rule 편집 화면에서 이름·색 입력 제거,
  "이름·색 변경은 Google Calendar 에서" 안내 문구 (4로케일; 라벨 관리
  다이얼로그 딥링크는 존재하지 않으므로 텍스트 안내만).
- **폐기**: `gas/i18n.js` COLOR_PALETTE 11종 + `colors.*` 4로케일 색
  이름 (라벨엔 색 이름이 없다). 이벤트 사이드바의 색 선택도 라벨 칩
  목록으로 전환.
- **배포**: 기존 deployment 에 새 버전 (URL 동결 준수, v55 전례).
  스코프·consent 무변경 — OAuth 게이트 아님.

## Acceptance criteria

- [x] 편집기 목록이 라벨 정본 기준으로 렌더 (named=Rule 행, 삭제됨 배지,
      unnamed 힌트)
- [x] 생성 플로우가 라벨+Rule 을 한 걸음에 만들고, 만든 라벨이 Google
      색 선택 창에 칩으로 보인다 (라이브 육안 확인) *(2026-07-28 확인 —
      단 호스트 탭 새로고침 1회 필요, 아래 Comments)*
- [x] 이름·색 읽기 전용 + Google 안내 문구 4로케일
- [x] 24 hex 스와치 data URI 생성·렌더 (외부 이미지 호스트 없음 —
      card-latency #03 계약 유지)
- [x] 구 11-팔레트·색 이름 i18n 잔재 제거 (gas/ 내 참조 0)
- [ ] 4로케일 스크린샷 각 1장 첨부 (사람 단계)

> **Resolution:** feat/native-labels-03-editor-a2-rewire (#02 스택).
> 설계 노트 대비 확정 사항:
> - **생성 라우트**: `POST /api/categories` 에 `backgroundColor`(hex) 입력
>   추가 — hex 가 오면 `appendEventLabel`(primary 캘린더) → labelId 링크 →
>   `colorId` 는 `nearestClassicColorId` 캐시로 채움. colorId-only 요청은
>   구계약 그대로(회귀 테스트). 라벨 생성 실패 시 Rule 미생성(반쪽 상태
>   금지), `EventLabelCapError`→422 `label_cap_reached`, reauth→503,
>   rate_limited→429. 중복 이름은 라벨 생성 **전에** 프리체크(orphan 라벨
>   방지; TOCTOU 는 unique 제약이 백스톱).
> - **이름·색 읽기 전용**: 기존 UI 에 per-rule 편집 화면이 없어 제거할
>   입력은 없음 — `rules.manageInGoogle` 안내 문구(4로케일, 텍스트만)로
>   충족. 삭제 버튼은 Rule(분류 설정) 삭제로 유지.
> - **24 hex 출처**: 21개 = 07-15 probe 실측 unnamed 슬롯, `#ad1457` =
>   probe 실측 named 테스트 라벨, `#e67c73` = 기존 클래식 스와치 파이프
>   라인의 flamingo. **`#d81b60`(cherry blossom) 1개만 미실측** — 공개
>   팔레트 값, `scripts/gen-swatch-assets.py` 에 TODO 플래그.
> - **사이드바**: 색 그리드 → 라벨 칩 그리드(labelId identifier + 이름
>   타이틀, 삭제됨 라벨 제외), 저장은 labelId POST(#02 신계약). 선택
>   상태·라벨 캐시는 액션 파라미터로 캐리(card-latency #01 패턴) — 기존
>   save 버튼이 선택값을 파라미터로 못 받던 틈도 함께 배선.
> - GAS 는 테스트 하니스가 없어 수동 검증 불가 — `node --check` 구문
>   검사 + 백엔드 vitest 만 통과. clasp push + 기존 deployment 새 버전
>   (URL 동결) + 라이브 육안 + 4로케일 스크린샷이 사람 단계.

## Blocked by

- #02 (`appendEventLabel`, 라벨 캐시/자동 Rule)

## Comments

### 2026-07-28 — 생성한 라벨이 Google 색 선택 창에 즉시 안 뜬다 (호스트 캐시, 우회 불가)

라이브 확인: 규칙 생성은 성공하고 애드온 목록에도 즉시 반영되지만, **Google
색 선택 창에는 캘린더를 새로고침해야 나타난다.**

**원인**: 색 선택 창은 Google Calendar 웹 클라이언트가 페이지 로드 시점에
`labelProperties` 를 읽어 캐시한 결과다. 우리는 서버 API 로 라벨을 만들었으니
Google 백엔드에는 즉시 반영되지만, 이미 떠 있는 탭의 클라이언트 캐시를
무효화할 채널이 애드온에 없다.

**우회 불가 (문서 확인)**: `CalendarEventActionResponseBuilder` 의 메서드는
`addAttachments` / `addAttendees` / `setConferenceData` / `build` 4개뿐이고
전부 **열려 있는 이벤트 초안** 범위다. 호스트 새로고침이나 캘린더 레벨
데이터 재로드를 요청하는 API 는 존재하지 않는다. 애드온은 우측 패널 iframe
에 갇혀 있어 호스트 앱을 제어하지 못한다.

**대응**: 강제 갱신이 불가능하므로 "고장 났나?" 하는 순간을 없애는 쪽으로
처리 — `rules.toast.added` 성공 토스트에 새로고침 안내를 4로케일로 추가.
코드 변경 없이 i18n 만.

**영향 범위 판단**: 색 선택 창은 **수동 오버라이드** 경로에서만 필요하다.
제품 본체(규칙 생성 → 백엔드 자동 채색)는 피커를 거치지 않으므로 부차 경로다.

**미확인 (다음 육안 검증에서 같이 볼 것)**: 이미 열린 탭에서 *클라이언트가
모르는 라벨*이 칠해진 이벤트가 어떻게 렌더되는가. 새로고침 없이 색이 정상
표시되면 위 판단대로 부차 문제지만, 기본색/무색으로 보인다면 자동 채색이
새로고침 전까지 안 보인다는 뜻이므로 본체 문제이며 별도로 다뤄야 한다.

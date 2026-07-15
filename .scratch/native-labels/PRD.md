# native-labels — Google 네이티브 이벤트 라벨 채택 트랙

Google Calendar 의 색·라벨 체계 재편(2026-06/07)에 대한 대응 트랙.
grilling 세션 2026-07-15, 결정 정본: [ADR-0006](../../docs/adr/0006-native-labels-adoption.md).

## 배경 — 무엇이 바뀌었나 (라이브 소스 검증, 2026-07-15)

- **2026-06-17** "Custom event colors in Google Calendar" (Workspace Updates):
  이벤트 색 UI 가 기본 24색 + RGB 피커(웹/API) + 캘린더당 최대 200 라벨로
  재편. 전 Workspace + 개인 @gmail, 기본 ON, 관리자 토글 없음.
  <https://workspaceupdates.googleblog.com/2026/06/custom-event-colors-in-google-calendar.html>
- **2026-07-07** Calendar API 라벨 GA:
  `Calendars.labelProperties.eventLabels[]` (항목 = `{id: UUID,
  backgroundColor: hex 필수, name: 선택 ≤50자}`, 정의/수정은 owner 전용,
  full-replace 시맨틱), `Event.eventLabelId`, 쓰기 파라미터
  `eventLabelVersion=1`(지정 시 `colorId` 무시). `colorId` 는 공식 문서상
  "legacy", 라벨이 "supersedes". `events.list` 에 라벨 필터 없음.
  <https://developers.google.com/workspace/calendar/api/guides/labels>
- 색 확장과 라벨은 별개 기능이 아니라 **하나의 메커니즘**: 커스텀 색 =
  라벨의 `backgroundColor`. 이벤트에 hex 를 직접 쓰는 필드는 없다.
- 경쟁 신호: Google 의 라벨 기반 *자동* 색칠은 현재 없음. 단 재료(이름 있는
  라벨 + Calendar MCP developer preview 2026-04-22 + Gemini in Calendar)는
  모두 등장 — taxonomy 레이어는 Google 이 가져갔고 automation 레이어가
  우리 자리다.

## Raw API 실측 (2026-07-15, 운영자 본인 prod 계정, spike/label-probe.ts)

UI 로 색을 입힌 테스트 이벤트 4개를 실제 Calendar API v3 로 읽고 쓴 결과:

| 시나리오 | v0 읽기 (`colorId`) | `eventLabelId` |
|---|---|---|
| 24색 그리드의 비클래식 색 | **absent** | 해당 unnamed 슬롯 UUID |
| 24색 그리드의 바나나(클래식) | `"5"` | 해당 unnamed 슬롯 UUID (병기) |
| 이름 라벨(#ad1457) 적용 | best-match `"4"` 로 위장 | 해당 라벨 UUID |
| (최초 관찰, 재현 불가) 커스텀 색 표시 상태 | **absent** | **absent** — 아래 6 참조 |

핵심 확정 사실:

1. **읽기는 옵트인 없이 `eventLabelId` 반환** — fields 파라미터·버전 지정
   불필요. 현행 Worker 읽기 경로에 그대로 실려 온다.
2. **기본 24색 = 캘린더마다 시스템이 미리 심어둔 unnamed 라벨 슬롯**
   (실측 계정: unnamed 21 + 사용자 명명 2 = 23 entries). UI 색 선택 = 라벨
   할당. "라벨 관리" 다이얼로그의 미리 채워진 행들이 바로 이 슬롯들.
3. **colorId ↔ 라벨 양방향 브리지**: legacy `colorId` 쓰기를 Google 이
   대응 슬롯 라벨 할당으로 번역 저장(쓴 뒤 읽으면 두 필드가 병기됨).
   클래식 11색 밖의 라벨은 v0 읽기에서 `colorId` 가 빈 값.
4. **`eventLabelVersion=1` PATCH 는 현재 스코프·토큰으로 HTTP 200** —
   새 OAuth 스코프 불필요. OAuth 검수 동결과 무관하게 백엔드 작업 가능.
   **UI 렌더 육안 검증 완료**(우리 API 쓰기로 붙인 라벨이 Google UI 에
   핫핑크 + 칩 선택으로 표시됨, 07-15). 역방향(UI 칩 적용 → API 읽기)도
   **즉시 가시적** — 전파 지연 없음(07-15 재실험).
5. **현행 파이프라인의 열린 결함(실측 재현)**: `calendarSync.ts` 의 수동
   변경 감지는 `event.colorId` 만 보므로, 비클래식 색/라벨 이벤트가 "색
   없음"으로 보여 색칠 대상이 되고, 우리의 colorId PATCH 는 사용자의 라벨
   연결을 **소리 없이 끊는다**(라벨 정의는 생존, 이벤트 연결만 해제).
   2026-06 이후 색을 만진 모든 사용자가 잠재 피해자 — 런칭 게이트급.
6. **TEST-D 최초 관찰(양 필드 부재)은 재현 불가로 종결**(07-15 재실험):
   UI 칩 적용이 API 에 즉시 반영됨이 확인되면서, 최초 관찰의 유력 해석은
   "라벨 다이얼로그의 저장(정의 생성)만 하고 이벤트 적용(칩 클릭)은 안 된
   사용자 동선"이다. 차선 해석 — "라벨 없는 커스텀 색 경로"의 실존 —은
   미확정으로 격하하되, 실존하더라도 API 불가시라 보호 불가·저빈도로 수용
   (ADR-0006 Consequences). 방어(#01)는 `eventLabelId` 가 보이는 모든
   케이스를 커버한다.

미확정으로 남긴 것: 반복 시리즈의 라벨 인스턴스/시리즈 시맨틱(공식 문서
없음), 개인 @gmail 의 Time Insights 집계 범위. 설계에 영향 없어 보류.

## 결정 요약 (ADR-0006)

1. 분류 출력 = 네이티브 라벨 (`eventLabelVersion=1` 쓰기, 마커 v2).
2. 정본 = Google `labelProperties` (A2). `categories` 는 라벨에 부착된
   분류 설정으로 격하 — 이름·색은 읽기 전용 캐시.
3. 이름 붙은 라벨은 출처 불문 동일 취급(발견 즉시 이름 강도 Rule).
   이름 없는 라벨은 분류 대상 아님.
4. 생성 쌍방향(애드온 생성 플로우가 라벨 생성 겸임, append-only) / 관리
   비대칭(개명·색·삭제는 Google UI, 삭제된 Rule 부활 금지).
5. 이행 = 깨끗한 컷오버 (이중 모드 없음).

## 우리 코드의 접점 (2026-07-15 기준)

- 분류기는 색-무관(카테고리 이름 출력) — 프롬프트·씨앗 레이어 무변경.
- "11색" 가정 위치: `src/db/schema.ts:124-127` CHECK,
  `src/routes/categories.ts` ColorIdSchema, `src/routes/events.ts:29` regex,
  `gas/i18n.js:20-42` COLOR_PALETTE + 4로케일 색 이름.
- §5.4 마커: `googleCalendar.ts:10-15` (autocolor_v/color/category),
  판정 `calendarSync.ts:205-215`, 롤백 `colorRollback.ts:160-173`.
- 쓰기 단일점: `googleCalendar.ts:183` `{ colorId }` PATCH.

## 이슈 분해 · 순서

| # | 이슈 | 성격 | 의존 |
|---|---|---|---|
| 01 | label-aware manual skip (방어 패치) | 소형·런칭 게이트 | 없음 — 즉시 |
| 02 | 라벨 쓰기 전환 + 마커 v2 + labelProperties 대조 | 중형 | 01 |
| 03 | 편집기 A2 재배선 (GAS) | 중형 | 02 |
| 04 | 컷오버 마이그레이션 + colorId 레거시 제거 | 중형·운영 | 02·03 + **sync-reliability #01/#02** |

**트랙 간 의존**: 04 의 full resync fan-out 은 Workers Free 50-fetch 캡을
정면으로 밟는다(sync-reliability PRD). 02 의 sync 런당 `calendars.get`
+1 fetch 도 예산 계상 필요.

## 스파이크 아티팩트

- `spike/label-probe.ts` — raw API 프로브 (읽기 표면 / labelProperties /
  v1 쓰기). 운영자 워크스테이션 전용, `.prod.vars` 필요:
  `pnpm tsx .scratch/native-labels/spike/label-probe.ts --env .prod.vars`.
  토큰·키는 출력하지 않는다.

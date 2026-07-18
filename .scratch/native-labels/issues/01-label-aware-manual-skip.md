Status: done
GitHub: #146

## What to build

sync 파이프라인이 라벨 붙은 이벤트를 "색 없음"으로 오판해 사용자의 색
선택을 덮어쓰는 구멍을 막는다 (방어 패치 — [PRD](../PRD.md) 실측 5번,
런칭 게이트급). raw API 실측으로 읽기는 옵트인 없이 `eventLabelId` 를
반환함이 확정됐으므로, 그 필드를 읽어 수동 변경 판정에 반영하면 된다.
ADR-0006 의 라벨 쓰기 전환(#02)과 독립 — 이 이슈는 **읽기·판정만** 바꾼다.

설계 노트 (구현 세션 재량):

- `googleCalendar.ts` `CalendarEvent` 에 `eventLabelId?: string` 추가.
  현행 읽기 경로가 fields 마스크를 쓴다면 마스크에도 추가 (`:132-138` 의
  마스크 해저드 주석 참조).
- `calendarSync.ts:205-215` 판정 확장. 현행: `current === ""` 이면 색칠
  진행. 신규: **`event.eventLabelId` 가 있고 app-owned 가 아니면
  `skipped_manual`** — colorId 가 비어 있어도. app-owned 판정 주의:
  우리가 colorId 로 색칠한 이벤트도 Google 브리지 때문에 `eventLabelId`
  를 갖는다(PRD 실측 3) — 즉 "라벨 존재 = 수동"이 아니라 "마커 불일치
  + 라벨 존재 = 수동". 마커 v1 (colorId 저장) 하에서의 안전한 규칙:
  `appOwned`(기존 colorId 동등성)가 참이면 진행, 거짓이면서
  `eventLabelId` 존재 시 skip, 둘 다 없으면 기존 로직.
- `colorRollback.ts:160-173` 의 동일 게이트에도 같은 확장.
- best-match 위장(사용자 라벨이 colorId "4" 등으로 보이는 케이스)은 현행
  로직이 이미 `skipped_manual` 처리하므로 회귀 없음을 테스트로 고정.
- 잔여 리스크 문서화: 라벨 없이 적용된 커스텀 색(PRD TEST-D)은 API 에
  안 보여 보호 불가 — `src/AGENTS.md` §5.4 에 한 줄 명시.

## Acceptance criteria

- [x] `CalendarEvent` 가 `eventLabelId` 를 읽는다 (마스크 사용 시 마스크
      포함, 미사용 시 타입만)
- [x] 마커 불일치 + `eventLabelId` 존재 이벤트가 `skipped_manual` 로
      스킵된다 (colorId 빈 값이어도) — calendarSync + colorRollback 양쪽
- [x] 우리가 과거 colorId 로 색칠한 이벤트(마커 v1 일치 + 브리지 라벨
      병존)는 계속 재적용 대상이다 (오탐 스킵 없음)
- [x] best-match 위장 케이스(colorId 비어있지 않음 + 마커 불일치)의 기존
      skip 동작 회귀 없음 — 테스트로 고정
- [x] 신규/갱신 테스트: 위 세 판정 경로 + 라벨 없는 무색 이벤트는 여전히
      색칠된다
- [x] `src/AGENTS.md` §5.4 에 라벨-불가시 커스텀 색 잔여 리스크 1줄 추가
- [x] `python3 scripts/check-context-paths.py` 통과

> **Resolution:** feat/native-labels-01-label-aware-manual-skip — 현행 읽기
> 경로는 fields 마스크 미사용이라 타입 추가 + 마스크 해저드 주석 갱신으로
> 커버. 무색·무라벨 이벤트 색칠 유지는 기존 "PATCHes empty-color event"
> 테스트가 계속 고정.

## Blocked by

None — can start immediately. (#02 라벨 쓰기 전환과 독립, 선행 가능.)

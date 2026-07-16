Status: ready-for-agent

## What to build

색 적용 쓰기를 `colorId` PATCH 에서 **`eventLabelVersion=1` +
`eventLabelId`** 로 전환하고, 소유권 마커를 v2 로 승격하며, sync 가
`labelProperties` 를 대조해 라벨 개명·삭제·신규를 따라가게 한다
(ADR-0006 Decision 1·2·3 의 백엔드 절반).

설계 노트 (구현 세션 재량):

- **쓰기 전환**: `googleCalendar.ts` `patchEventColor` → body
  `{eventLabelId}` + query `eventLabelVersion=1` (실측: 현행 스코프로
  HTTP 200). 대상 labelId 는 Rule 에 연결된 `categories.labelId`.
- **마커 v2**: `AUTOCOLOR_MARKER_VERSION = "2"`, 키
  `autocolor_v`/`autocolor_label`(labelId)/`autocolor_category`.
  소유권 판정 = `event.eventLabelId === marker.autocolor_label`.
  마커 v1 이벤트는 과도기 판정(colorId 동등성) 유지 — 컷오버(#04)
  재동기화가 v2 로 재각인할 때까지 읽기 하위호환.
- **스키마**: `categories.labelId text` (calendar 단위 라벨 UUID; 현행
  sync 는 primary 단일이므로 컬럼 1개로 충분, 다중 캘린더는 그때 매핑
  분리), `name`/`colorId` 는 캐시 의미로 격하(주석). colorId CHECK ·
  Zod enum 완화는 #04(레거시 제거)에서 일괄 — 이 이슈에서는 추가만.
- **labelProperties 대조** (sync 시작 시 `calendars.get?fields=labelProperties`,
  런당 +1 fetch — 서브리퀘스트 예산 계상):
  - 개명 → `categories.name` 캐시 갱신 + name 씨앗 재임베딩
    (`rule_seeds` upsert, backfill-seeds 의 name-seed 경로 재사용).
  - 삭제 → 해당 Rule 비활성(분류 제외 + 편집기 "라벨 삭제됨" 표시용
    상태 컬럼). **부활 금지** — 사용자 편집이 이긴다.
  - 신규 **이름 있는** 라벨 → Rule 자동 생성(키워드 폴백 `[name]`,
    name 씨앗 임베딩) = "출처 불문 동일 취급". unnamed 슬롯은 무시.
- **라벨 정의 쓰기(애드온 생성 경로 대비)**: `appendEventLabel` 서비스 —
  read-modify-write, **append-only(남의 항목 절대 축소 금지)**, 쓰기 직전
  재읽기, 200 캡 검사. #03 이 소비.
- **수동 오버라이드 라우트** `routes/events.ts`: colorId regex 입력 →
  labelId 입력으로 전환 (마커 클리어 의미는 동일).
- `colorRollback`: 라벨 해제 = `eventLabelVersion=1` + `eventLabelId: ""`.

## Acceptance criteria

- [ ] 분류 적용이 `eventLabelVersion=1` + `eventLabelId` 로 나가고 마커
      v2 가 각인된다 (라이브 1건 육안 확인 포함)
- [ ] 마커 v2 소유권 판정 + v1 하위호환 판정이 공존한다 (테스트)
- [ ] sync 시작 시 labelProperties 대조: 개명→캐시+씨앗 갱신, 삭제→Rule
      비활성(부활 없음), 신규 named→Rule 자동 생성 (각 테스트)
- [ ] `appendEventLabel` 이 append-only + 재읽기 + 200 캡 검사를 지킨다
      — 동시 편집 시나리오 테스트(우리 쓰기가 남의 신규 라벨을 지우지
      않음)
- [ ] 수동 오버라이드·롤백 경로가 라벨 세계에서 동작 (테스트)
- [ ] 런당 추가 fetch 는 labelProperties 1회뿐 (서브리퀘스트 예산 문서
      갱신)
- [ ] `pnpm test` / `pnpm typecheck` 통과, drizzle 마이그레이션 생성

## Blocked by

None — #01 (판정 로직 기반) 해소됨, can start.

Status: ready-for-human
GitHub: #147

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
      v2 가 각인된다 (라이브 1건 육안 확인 포함) *(코드·테스트 완료 —
      라이브 육안 확인만 대기, 사람 단계)*
- [x] 마커 v2 소유권 판정 + v1 하위호환 판정이 공존한다 (테스트)
- [x] sync 시작 시 labelProperties 대조: 개명→캐시+씨앗 갱신, 삭제→Rule
      비활성(부활 없음), 신규 named→Rule 자동 생성 (각 테스트)
- [x] `appendEventLabel` 이 append-only + 재읽기 + 200 캡 검사를 지킨다
      — 동시 편집 시나리오 테스트(우리 쓰기가 남의 신규 라벨을 지우지
      않음)
- [x] 수동 오버라이드·롤백 경로가 라벨 세계에서 동작 (테스트)
- [x] 런당 추가 fetch 는 labelProperties 1회뿐 (서브리퀘스트 예산 문서
      갱신)
- [x] `pnpm test` / `pnpm typecheck` 통과, drizzle 마이그레이션 생성

> **Resolution:** feat/native-labels-02-label-write-migration (#01 스택).
> 설계 노트 대비 추가: labelId 없는 pre-cutover 룰 hit 은 `skipped_no_label`
> 카운터로 스킵(컷오버 전 안전 배포), 신규 named 라벨은 same-name·labelId
> null 룰에 우선 링크(#04 페어링 선행). appendEventLabel 의 라벨 id 는
> 클라이언트 mint(UUID) — 라이브 검증 항목. sync-reliability #02 예산
> 가드와의 rebase 시 reconcile +1 fetch 를 카운터에 계상할 것.

## Blocked by

None — #01 (판정 로직 기반) 해소됨, can start.

## Comments

### 2026-07-28 — 라벨 생성이 라이브에서 전면 실패했음 (PR #162 로 수정)

배포 후 첫 실사용에서 규칙 생성이 100% 실패했다. 애드온 표시:
`Failed to save rule: … SERVER_ERROR: 502 - {"error":"upstream_unavailable"}`

**원인**: `calendars.patch` 가 `primary` 별칭을 **404 notFound** 로 거부한다
(실측: 본문 무관, 빈 `{}` no-op 도 404 / resolved id 로는 200 / `calendars.get`
은 별칭 200). `appendEventLabel` 의 read-modify-write 가 read 만 성공하고
write 에서 죽는 형태였다. Google discovery 문서는 이 메서드의 `calendarId`
에도 primary 를 허용한다고 적혀 있어 **문서와 실동작이 다르다**.

07-15 프로브(`spike/label-probe.ts`)가 P3 = *이벤트* PATCH 만 실측했고
**`Calendars.patch` 라벨 생성 경로는 라이브에서 한 번도 안 돌려본 표면**
이었던 것이 놓친 지점이다. 설계 노트의 "실측: 현행 스코프로 HTTP 200" 은
이벤트 쓰기에 대한 것이지 라벨 정의 쓰기에 대한 것이 아니었다.

**수정**(PR #162): 이미 수행하는 read 의 fields 마스크에 `id` 추가 →
`getCalendarLabelProperties` 가 `{calendarId, eventLabels}` 반환 → 쓰기가
resolved id 사용. 추가 fetch 없음(런당 +1 계약 유지). id 미해소 시에는
폴백하지 않고 `UnresolvedCalendarIdError` 로 쓰기 거부.

**AC 1 관련 진전**: Resolution 에 "라이브 검증 항목" 으로 남겨둔
**클라이언트 mint UUID 는 확인됨** — append 200 + 읽기 왕복 일치, discovery
도 `id` 를 "must be unique within the calendar and follow UUID format" 로
명시. `eventLabels.ts` 의 write-then-re-read-diff 헤지 주석 제거. 다만 AC 1
의 나머지 절반(분류 적용이 `eventLabelVersion=1`+`eventLabelId` 로 나가고
마커 v2 가 각인되는 **육안 확인**)은 여전히 사람 단계로 남는다.

**#04 에 미친 영향**: `scripts/cutover-labels.ts` 도 같은 리더/쓰기 경로라
동일 결함이었다 — **이 수정 전에 컷오버를 실행했으면 전부 실패했을 것.**

**후속(범위 밖)**: 404 → `not_found` → 라우트 `default:` → 502
`upstream_unavailable` 매핑이 "업스트림 장애" 라는 잘못된 신호를 준다.
진단을 느리게 만든 실제 원인이므로 라우트 계약 차원에서 재검토할 것.

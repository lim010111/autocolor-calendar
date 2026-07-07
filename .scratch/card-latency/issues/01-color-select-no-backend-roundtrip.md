Status: done

## What to build

규칙 편집기에서 **색상 스와치를 고를 때 백엔드 왕복(`GET /api/categories`)이
일어나지 않게** 한다. 색 선택은 카테고리 데이터가 하나도 바뀌지 않는 순수 UI
토글인데, 현재는 재렌더가 규칙 관리 카드를 통째로 재빌드하면서 목록을 다시
fetch한다 — 이 트랙의 지배적 지연 원인.

동작 목표: 규칙 편집기 진입 시 이미 받아둔 카테고리 목록을 색 선택 재렌더에
재사용한다. 색을 고르면 선택 스와치 하이라이트만 갱신되고, 기존 규칙 리스트와
폼 입력값은 그대로 유지되며, 백엔드 호출은 0이다.

**Prefactor (먼저 수행)**: 규칙 관리 카드 빌더가 "이미 받은 카테고리
스냅샷"을 optional 인자로 받도록 한다. 인자가 없으면 지금처럼 fetch(기존 동작
완전 보존) — 이 prefactor가 #02도 열어준다.

**확정된 기법 (param pass-through + fetch 폴백)**: 재사용할 목록은
`fetchCategoriesOrError`가 이미 trim하는 `{id, keyword, colorId}` 스냅샷을
CardService action parameter로 전달한다. 일반 사용자(규칙 수십 개 미만)는
파라미터 크기 한도 내에 들어간다. 스냅샷이 파라미터 한도를 넘으면 fetch로
폴백한다(정확한 한도·직렬화 방식은 구현 세션이 측정해 확정). Halt-on-Failure
"no cache" 계약과 충돌하지 않는다 — 영속 캐시가 아니라 단일 렌더 사이클
안에서만 사는 pass-through다.

## Acceptance criteria

- [x] 규칙 관리 카드 빌더가 optional 카테고리 스냅샷 인자를 받는다; 인자 부재 시
      기존처럼 fetch (회귀 없음)
- [x] 색 선택 액션이 pass-through 스냅샷으로 재렌더 — 색 선택 시 `/api/categories`
      GET 0회 (`wrangler tail`에 해당 GET 라인 없음으로 검증)
- [x] pass-through 스냅샷은 trim된 `{id, keyword, colorId}`; 파라미터 크기 초과 시
      fetch 폴백
- [x] 색 선택 후에도 기존 규칙 리스트가 그대로 보인다 (목록 사라짐 회귀 없음)
- [x] 폼 입력값(rule_name / rule_keywords) 보존 유지 (기존 form-state 보존 동작
      회귀 없음)
- [x] 사용자 노출 카피 변경 없음 (신규 카피 발생 시 en/ko/zh-CN/zh-TW 4 bundle 동시
      추가)
- [x] 기존 deployment "New version"으로 배포 — `/exec` URL 불변, `appsscript.json`
      scopes 불변 ("New deployment" 금지)
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

None — can start immediately.

## Comments

**2026-07-07 (agent)** — 구현 완료 (`gas/addon.js`,
branch `feat/card-latency-01-color-select-no-roundtrip`):

- Prefactor: `buildRuleManagementCard(e, categoriesSnapshot)` — optional 인자,
  부재 시 기존 fetch + AUTH_EXPIRED 단락 그대로 (#02도 이 시그니처를 소비).
- Pass-through: 색상 그리드 액션에만 `categoriesSnapshotJson` 파라미터로 trim된
  `{id, keyword, colorId}` JSON 부착. mutation 액션(add/delete)에는 미부착 —
  변경 후엔 반드시 재fetch.
- 직렬화 = 단일 파라미터 JSON 문자열. 크기 한도: CardService 파라미터 한도가
  비문서화라 보수 예산 `CATEGORIES_SNAPSHOT_PARAM_MAX_CHARS = 8192`(≈규칙 70+개)
  적용, 초과 시 파라미터 생략 → fetch 폴백. **정확한 실측 한도는 라이브 검증 때
  확정 예정.**
- 로컬 검증: node vm 시뮬레이션 11/11 통과 (스냅샷 시 backend 호출 0회 / 부재 시
  1회 / 한도 초과 폴백 / 폼 보존 / 목록 렌더 / corrupt JSON 폴백).

남은 것 (라이브, 사람 게이트): "New version" 배포(AC7) → `wrangler tail`로
색 선택 시 GET 0회(AC2) + 목록 유지(AC4) + 폼 보존(AC5) 확인.

**2026-07-07 (agent) — 라이브 검증 완료, done.**

- PR #130 머지(CI 5/5). merge-gate finding 1건(스냅샷 재부착)은 스펙상
  의도된 동작(AC2가 모든 클릭에서 GET 0회 요구)이라 drop, 주석 명확화만 반영.
- **배포 함정 발견**: "New version"이 설치본과 무관한 deployment(AKfycbxKZ…)에
  적용돼 설치본이 v49 구코드로 잔류 — 편집기 실행 메뉴의 "버전" 컬럼으로 진단,
  `clasp deploy -i AKfycbxfHV5… -V 54`(설치본+/exec 웹앱 겸용 deployment,
  URL 불변·200 확인)로 repoint하여 해결.
- **AC2 실증** (`wrangler tail --env prod`, 17:06 KST): 편집기 진입
  `/api/categories` GET 1회 → 색 스와치 연속 클릭 GET **0회** (구코드
  라운드는 클릭마다 GET 3~4회로 대비 명확). 실행 기록 버전 54 확인.
- AC4(목록 유지)·AC5(폼 보존) 사용자 육안 확인. 부수 실측: Grid 클릭도
  `Action.setParameters`를 전달함 (`grid_item_identifier`와 함께 p1/p2 모두,
  스냅샷 237자 무손실 도착).

> **Resolution:** PR #130 (`gas/addon.js` 스냅샷 pass-through) + deployment
> repoint. 후속: #02 (mutation 단일 왕복, prefactor 공유) unblock.

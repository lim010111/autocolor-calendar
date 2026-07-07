Status: ready-for-agent

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

- [ ] 규칙 관리 카드 빌더가 optional 카테고리 스냅샷 인자를 받는다; 인자 부재 시
      기존처럼 fetch (회귀 없음)
- [ ] 색 선택 액션이 pass-through 스냅샷으로 재렌더 — 색 선택 시 `/api/categories`
      GET 0회 (`wrangler tail`에 해당 GET 라인 없음으로 검증)
- [ ] pass-through 스냅샷은 trim된 `{id, keyword, colorId}`; 파라미터 크기 초과 시
      fetch 폴백
- [ ] 색 선택 후에도 기존 규칙 리스트가 그대로 보인다 (목록 사라짐 회귀 없음)
- [ ] 폼 입력값(rule_name / rule_keywords) 보존 유지 (기존 form-state 보존 동작
      회귀 없음)
- [ ] 사용자 노출 카피 변경 없음 (신규 카피 발생 시 en/ko/zh-CN/zh-TW 4 bundle 동시
      추가)
- [ ] 기존 deployment "New version"으로 배포 — `/exec` URL 불변, `appsscript.json`
      scopes 불변 ("New deployment" 금지)
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

None — can start immediately.

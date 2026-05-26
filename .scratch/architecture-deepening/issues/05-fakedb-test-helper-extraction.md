Status: ready-for-agent

## What to build

`src/__tests__/categoriesRoute.test.ts` 와 `src/__tests__/ruleService.test.ts`
가 동일한 *FakeDb pattern* (drizzle SQL AST를 `queryChunks`까지 walk 해서
`eq(col, val)` 제약을 추출하는 손글씨 mock)을 거의 그대로 복제 보관한다.
앞으로 추가될 다른 service-level test가 같은 패턴을 다시 베끼면 부채가
지수적으로 누적되고, drizzle-orm minor 업데이트가 AST shape를 바꾸면 모든
복제본을 동시에 손봐야 한다.

`/third-party-review` agy 평가가 이 점을 들어 "테스트 환경 불안정성 방치"
로 마크함 (2026-05-26). 동의하되, `01-rule-module-aggregate` PR 범위 외로
판정해 이 후속 이슈로 escalate.

본 이슈의 산출물은 **공통 모듈 1개**: `src/__tests__/_helpers/fakeDb.ts`
(또는 동등). 두 기존 test 파일은 이 helper를 import만 한 채 자기 도메인
fixture(`row()`, `state`)만 보유. drizzle AST shape가 바뀌면 helper 1
지점만 손댄다.

### 설계 결정

- **Helper scope**: drizzle SQL AST → `{ user_id?, id?, ... }` 제약 dict
  파싱 + `categories` / `syncState` 테이블에 한정된 chainable `select` /
  `insert` / `update` / `delete` 빌더 mock. 다른 테이블이 필요해지면 helper
  옵션 (`extraTables`) 으로 옵트인 확장.
- **타입 협상**: helper 가 generic `Row` 타입을 받음 — `categories` 전용
  파일 둘이 동일한 `Row` 정의 (id/userId/name/colorId/keywords/priority/
  createdAt/updatedAt) 를 공유.
- **DuplicateNameError 도 helper 가 export** — 두 파일이 동일 클래스를
  복제 보관 중.
- **AST walker fragility 봉쇄**: helper 내부에 drizzle 버전 가드 1개 추가
  (`expect chunks[i+1].value[0].includes(" = ")`). 가드 깨지면 단일 명확
  에러로 즉시 실패 → "조용한 잘못된 통과" 방지.
- **Real Postgres harness 와의 관계**: 본 이슈는 *FakeDb 일반화*만 수행.
  실제 Postgres 기반 integration test 인프라는 본 feature 의 `#04
  integration-test-harness` 가 별도 surface 로 도입. 둘이 공존 — fake 는
  단위, real 은 cross-module.

### 범위 외

- `loadCategories` 호출자 다른 test 들 (`calendarSync.test.ts` 등) 의 fake
  통일 — drizzle 호출 패턴이 다름. 후속 wave.
- pglite / better-sqlite3 등 in-memory DB 대체 도입 — `#04` harness 가
  진짜 Supabase local 을 쓰기로 결정됨, 또 다른 surface 도입 reject.

## Acceptance criteria

- [ ] `src/__tests__/_helpers/fakeDb.ts` 신설 — extractEq / chainable
      select/insert/update/delete / DuplicateNameError export
- [ ] `categoriesRoute.test.ts` 가 helper 만 import (현 손글씨 mock 삭제)
- [ ] `ruleService.test.ts` 가 helper 만 import (현 손글씨 mock 삭제)
- [ ] AST shape 가드 1개 (`drizzle version sanity check`) 통과 — 깨지면
      명확한 에러 메시지로 실패
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

— (없음 — 본 PR 머지 후 즉시 가능)

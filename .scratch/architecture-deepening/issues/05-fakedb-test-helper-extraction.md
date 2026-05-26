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

본 이슈의 산출물은 **공통 모듈 1개**: `src/__tests__/_helpers/fakeDb.ts`.
두 기존 test 파일은 이 helper를 import만 한 채 자기 도메인 fixture(`row()`)
만 보유. drizzle AST shape가 바뀌면 helper 1 지점만 손댄다.

### 설계 결정

- **단일 `makeFakeDb` 통합** — 두 기존 factory의 차이는 *구조적*이 아니라
  *추가적*이라 union 한 번이면 끝난다. 시그니처:

  ```ts
  makeFakeDb(initial?: {
    categories?: Row[];
    syncStates?: SyncStateRow[];
    failInsertWith?: Error;
    failUpdateWith?: Error;
  }): {
    db: FakeDb;
    close: () => Promise<void>;
    state: { categories: Row[]; syncStates: SyncStateRow[] };
  };
  ```

  - `categories` / `syncStates` 라는 통일 이름을 채택 — 기존 `rows` /
    `syncStateRows` (route test) 와 `rules` / `calendars` (service test)
    는 모두 같은 두 테이블이며, helper 의 시점에서는 schema table 이름
    그대로가 가장 덜 혼란스럽다 (`Category` ↔ `Rule` rename 은 #01 에서
    이미 정리됨 — 도메인 용어는 `Rule`, DB table 명은 `categories` 잔존).
  - `failInsertWith` / `failUpdateWith` 는 옵션-bag 항목; 미설정 시 무시.
    route test 는 비용 0.
  - return 형태는 production `getDb(env)` (`src/db/client.ts:23`) 와
    동일한 `{ db, close }` shape — route test 의
    `vi.mocked(getDb).mockImplementation(() => currentDb)` 가 어댑터 없이
    그대로 동작. service test 는 `close` 무시 (cost 0).

- **`Row` 타입은 helper 가 export** — `categories` 스키마 row 그대로
  (`id` / `userId` / `name` / `colorId` / `keywords` / `priority` /
  `createdAt` / `updatedAt`). 두 test 가 같은 정의를 복제 보관 중. generic
  `<Row>` 는 *현재* 두 callsite 가 동일 shape 이므로 over-engineering —
  세 번째 테이블이 실제로 등장할 때 generic 도입.

- **`SyncStateRow` 도 helper 가 export** — `{ userId: string; calendarId: string }`.

- **`DuplicateNameError` 도 helper 가 export** — 두 파일이 동일 클래스를
  복제 보관 중. 단일 source.

- **`orderBy` semantics: always honor**. `firstColumnName` walker 로
  `asc(col)` / `desc(col)` 인자에서 컬럼명을 뽑아 `sortBy(rows, args)` 로
  실제 정렬. categoriesRoute 의 priority-tiebreaker contract test 가
  의존, ruleService 는 어차피 정렬 미assert 라 no-op. opt-in 플래그 두는
  것은 동일 동작을 두 길로 갈라놓는 셈이라 reject.

- **AST shape 가드는 dedicated test 로 분리** —
  `src/__tests__/_helpers/fakeDb.guard.test.ts`. 새 파일 내부에서 합성
  `eq(categories.userId, "...uuid...")` SQL fragment 를 만들어 `extractEq`
  에 통과시키고 `{ user_id: "<uuid>" }` 가 나오는지 assert. drizzle-orm
  minor bump 으로 AST shape 가 바뀌면 단일 named test 가 fail —
  module-load throw (option a) 처럼 "module failed to load" 같은
  난독 메시지가 아니라 "fakeDb.guard: extractEq returned X, expected Y"
  로 직격. per-call assertion (option b) 은 `and(...)` 의 비-eq arm 같은
  legitimate 케이스에서 false 5xx 를 낳아 reject.

- **`extraTables` 옵트인 확장은 *구현 안 함*** — 코드에 placeholder option
  추가 금지. 헬퍼 내부 `from(table)` 분기는 명시적 if/else (`if (table ===
  categories) … else if (table === syncState) …`) 로 두고, *세 번째 테이블이
  필요해질 때 그 분기 한 줄을 추가하는 것이 가장 싼 확장 경로* 라는 점만
  주석으로 남긴다. YAGNI — `categoriesRoute` / `ruleService` 외에 본 패턴을
  쓰는 후속 service-level test 가 실제로 등장하기 전엔 매핑 인프라 자체를
  쓰지 않는다.

- **Real Postgres harness 와의 관계**: 본 이슈는 *FakeDb 일반화*만 수행.
  실제 Postgres 기반 integration test 인프라는 본 feature 의 `#04
  integration-test-harness` 가 별도 surface 로 도입. 둘이 공존 — fake 는
  단위, real 은 cross-module.

### 범위 외

- `loadCategories` 호출자 다른 test 들 (`calendarSync.test.ts` 등) 의 fake
  통일 — drizzle 호출 패턴이 다름. 후속 wave.
- pglite / better-sqlite3 등 in-memory DB 대체 도입 — `#04` harness 가
  진짜 Supabase local 을 쓰기로 결정됨, 또 다른 surface 도입 reject.
- generic `<Row>` 타입 — 본 PR 에서는 categories 스키마 row 고정. 세 번째
  테이블 등장 시 도입.

## Acceptance criteria

- [x] `src/__tests__/_helpers/fakeDb.ts` 신설 — 다음을 export:
      `Row` / `SyncStateRow` 타입, `DuplicateNameError` 클래스,
      `extractEq` 함수, `makeFakeDb` factory
- [x] `makeFakeDb` 시그니처가 `initial?: { categories?, syncStates?,
      failInsertWith?, failUpdateWith? }` → `{ db, close, state: { categories,
      syncStates } }` 형태와 일치 (production `getDb` 의 `{ db, close }`
      shape 동형)
- [x] `orderBy` walker 가 `asc(col)` / `desc(col)` 의 컬럼명을 추출해 실제
      정렬을 수행 (`firstColumnName` + `sortBy` 로직 helper 내부 이동)
- [x] `failInsertWith` / `failUpdateWith` 옵션이 `insert.returning` /
      `update.returning` 호출 시 해당 Error 를 throw
- [x] helper 내부 `from(table)` 분기는 명시적 if/else 로 categories +
      syncState 만 다룸 — `extraTables` 같은 placeholder option 없음
- [x] `src/__tests__/_helpers/fakeDb.guard.test.ts` 신설 — 합성
      `eq(categories.userId, <uuid>)` 을 `extractEq` 에 통과시켜
      `{ user_id: <uuid> }` 결과를 assert. 실패 시 명확한 메시지로 named
      test 실패
- [x] `categoriesRoute.test.ts` 가 helper 만 import — 손글씨 `extractEq` /
      `firstColumnName` / `sortBy` / `matches` / `makeFakeDb` / `Row` /
      `DuplicateNameError` 블록 전부 삭제, `row()` 도메인 fixture 만 잔존
- [x] `ruleService.test.ts` 가 helper 만 import — 손글씨 `extractEq` /
      `whereMatcher` / `makeFakeDb` / `Row` / `SyncStateRow` /
      `DuplicateNameError` 블록 전부 삭제, `row()` 도메인 fixture 만 잔존
- [x] 본 PR 범위 외 test 파일 (`calendarSync.test.ts` 등) 무변경
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

— (없음 — 본 PR 머지 후 즉시 가능)

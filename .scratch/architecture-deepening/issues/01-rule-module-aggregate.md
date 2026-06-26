Status: ready-for-agent
GitHub: #107

## What to build

`Category` 타입과 `categories` 테이블을 가리는 Rule aggregate Module을
service layer에 도입한다. ADR-0004 구현 이슈 #02 (embedding kNN seeds)가
들어오기 전 prep PR 단계 — Rule Module이 깔리면 후속 ADR-0004 작업은 모두
이 Module *내부* 변경이 된다.

CONTEXT.md "Flagged ambiguities" 결정의 *실행*: 도메인 용어는 `Rule`,
DB 레거시 명칭 `categories`/`Category`는 그대로 두되 신규 코드/문서는
`Rule` 사용. URL path `/api/categories`는 GAS API 호환성 위해 유지.

### 설계 결정

- **Rule aggregate**: `{ id, userId, colorId, priority, name, seeds: Seed[] }`.
  seeds는 name / keyword / example을 통합한다.
- **Seed shape**: `{ text, type: 'name'|'keyword'|'example', grade:
  'verified'|'declared' }`. ADR-0004의 trust grade 모델을 미리 도입.
- **`RuleService` 단일** — Repo 분리하지 않음. validation + persistence +
  부수효과(resync fan-out + 향후 embedding job dispatch) 책임:
  - `list(userId): Rule[]` — 가벼움 (seeds 미동반, 리스트 UI용)
  - `get(ruleId): Rule` — seeds 포함 aggregate (상세/편집용)
  - `create(userId, input): Rule`
  - `update(ruleId, patch): Rule`
  - `delete(ruleId): void`
  - `addExample(ruleId, title)` — Instant Feedback 진입점 stub.
    실제 동작 enable은 ADR-0004 구현 이슈 #05 시점.
- **동작 변경 0줄**: 본 PR 시점에는 `rule_seeds` 테이블이 아직 없다 —
  ADR-0004 구현 이슈 #02가 도입. seeds는 기존 `categories.name` /
  `categories.keywords` 컬럼에서 *반환 시점에* synthesize한다 (모두
  `grade: 'declared'`). ADR-0004 이슈 #02가 synthesize 부분만 "rule_seeds
  테이블 read"로 갈아끼우므로 호출자 변경 0.
- **마이그레이션**: 전 코드에서 `Category` → `Rule` rename + `type
  Category = Rule` deprecated alias 한 줄 잔존. 점진 흡수.
- **Route 흡수**: `src/routes/categories.ts`의 validation + insert +
  `fanOutFullResync` 로직은 `RuleService.create()` 안으로 이동. route는
  thin Hono adapter — Zod parse → service 호출 → JSON 응답.

### 범위 외

- `rule_seeds` 테이블 / 임베딩 호출 / kNN 매칭 — ADR-0004 구현 이슈 #02.
- `addExample()` 실제 동작 (consent + insert + FIFO) — ADR-0004 구현 이슈 #05.
- integration test 신설 — 본 feature 이슈 #04.

## Acceptance criteria

- [x] `src/services/rules/` (또는 `src/services/ruleService.ts`) 신설 —
      `RuleService` + Rule / Seed 타입 정의
- [x] 전 코드에서 `Category` → `Rule` rename, `type Category = Rule`
      deprecated alias 한 줄만 잔존
- [x] `RuleService.list()` / `get()` / `create()` / `update()` /
      `delete()` 구현 + 단위 test
- [x] `RuleService.addExample()` stub — 반환만, 실제 동작은 ADR-0004 #05 시점
- [x] `seeds: Seed[]` synthesize 로직 — 기존 `name` + `keywords` 컬럼에서
      `grade: 'declared'`로 합성
- [x] `src/routes/categories.ts` (URL path 유지) → `RuleService` 위임,
      route는 thin Hono adapter로 축소
- [x] 동작 변경 0줄 — 기존 단위 test 그대로 통과
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

— (없음)

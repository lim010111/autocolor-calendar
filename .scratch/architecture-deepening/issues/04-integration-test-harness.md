Status: wontfix
GitHub: #110

## Deferred (2026-05-26)

본 issue는 **wontfix (deferred)** 로 마크된다. 결정 근거 — `/harden-issue`
세션 + `/consult-externals` 외부 council (Codex / agy 양쪽 endorse):

1. 본 harness 의 진짜 load-bearing user 는 ADR-0004 embedding pipeline 이다.
   현 시점 embedding 코드 경로 0줄 — `EmbeddingService` interface 자체가
   production 에 존재하지 않으며 (`src/services/classifierChain.ts` 의
   `ChainDeps` 에 embedding 관련 필드 없음), 벡터 차원 N 도 embedding-
   classifier #01 모델 eval (HITL, 768 vs 1024 미정) 결과를 기다린다.
   harness 만 먼저 land 하면 fixture `EmbeddingService` 시그니처 · `rule_seeds`
   schema · 차원 N 모두를 *추측*으로 굳혀야 하고, ADR-0004 구현 #02 가
   실제 interface 를 정의하면 사후 재작성 비용이 발생한다.

2. 남는 시나리오 1/2/3/5 는 이미 unit coverage 가 있다 —
   `classifierChain.test.ts` / `classifier.test.ts` / `llmClassifier.test.ts`
   / `calendarSync.test.ts` (시나리오 1), `syncRoute.test.ts` §6.4 suite
   (시나리오 2), `watchRenewal.test.ts` (시나리오 3, millisecond precision
   invariant 까지 regex guard 로 pin 됨), `categoriesRoute.test.ts` +
   `colorRollback.test.ts` (시나리오 5). real-Postgres 격차에서 잡힐 추가
   신호는 실재하지만 *urgent* 하지 않다 (prod incident 0).

3. 다른 architecture-deepening prep (#01/#02/#03/#05) 과 성격이 다르다.
   다른 셋은 **prod 코드 0줄 + 즉시 navigability 이득**. 본 이슈는
   **heavy infrastructure 신규 도입** (vitest-pool-workers + Supabase local
   CLI + 13개 AC + 신규 CI job) **+ 즉시 이득 없음**. 원작이 가정한
   "ADR-0004 구현 #02 시작 직전 land" 는 #02 가 HITL-blocked 로 ETA 미정인
   현실에서 깨졌다.

**Folded into**: ADR-0004 구현 트랙. 첫 후보 흡수 지점은
`.scratch/embedding-classifier/issues/02-embedding-knn-classifier-name-seeds.md`
— 그 PR (또는 그 직전 별도 PR) 이 harness 도입과 첫 embedding integration
test 를 같이 land 한다. fixture 시그니처가 실제 production
`EmbeddingService` interface 와 co-design 되어 사후 재작성이 사라진다.

아래 원본 설계 노트는 ADR-0004 #02 가 참고할 reference 로 보존한다 — stack
선정, 시나리오 우선순위, test 격리 정책, factory shape, CI 통합 비용 추정은
그 때 그대로 재사용 가능하다.

---

## What to build (원본 — reference only, deferred)

Deepened Classifier pipeline의 첫 integration coverage 도입. 기존 unit
test는 mock-heavy해서 cross-module seam bug — `classifierChain.ts:52-53`의
short-circuit (ADR-0004 도입 근거)과 같은 — 을 잡지 못한다. 본 이슈는
ADR-0004 구현 이슈 #02 시작 *전에* 정착해서, 이후 ADR-0004 구현이 이
harness 위에서 lockstep으로 test를 추가하게 한다.

본 harness는 *회귀 net*이 아니라 *deepened pipeline의 첫 integration
coverage*다 — #01 / #02 / #03 deepening 후가 test 비용이 훨씬 싸기 때문에
(예: `chain.classify()` 단일 콜 vs 7 callbacks mock).

### 설계 결정

- **Stack** — Cloudflare Workers + Supabase pgvector 조합이 거의 강제:
  - `@cloudflare/vitest-pool-workers` (Workers 표준, miniflare 안에서
    vitest 실행)
  - Supabase local CLI (pgvector 포함, prod 매칭)
  - mocked external HTTP (Google Calendar, OpenAI) — fixture responses
  - **fixture embeddings for Workers AI** — 결정론적 `hash(text) →
    vector(N)` fake EmbeddingService. pglite는 pgvector 미지원이라 후보 외.
- **Fixture embeddings의 책임 경계**: integration test는 *파이프라인
  wiring* 검증. 실제 모델 거동(임계값 sweep, 다국어 정확도)은 evals
  pipeline (Langfuse + `classification.json`) 책임. 두 surface 절대 섞지
  않는다.
- **시나리오** (우선순위 순):
  1. `ClassificationOutcome` 8개 case 각각 최소 1 test — `chain.classify()`
     반환 + sink emit 둘 다 검증
  2. Sync claim race — 동시 sync run 2개, 한 쪽만 claim 획득
     (`src/CLAUDE.md` §6.4)
  3. Watch renewal claim semantics — sync claim과 독립성 (§6.4)
  4. Embedding service 실패 → LLM fallback (ADR-0004의 새 실패 모드)
  5. Rule mutation (`RuleService.create/update/delete`) → resync fan-out
- **Per-module integration 패스** — `RuleService` 단독 integration test는
  추가 안 함. 위 시나리오가 cross-module이라 자연스럽게 exercise. Locality
  유지를 위해 굳이 별도로 쪼개지 않음.
- **Test 격리**: `truncate-tables-in-beforeEach`. transaction rollback보다
  빠르고 schema-per-test보다 단순. 테스트 간 DB state leak 0.
- **Test data**: factory 함수 (`makeRule()`, `makeEvent()`, `makeUser()`).
  공유 seed 없음 — 각 테스트가 필요한 fixture만 생성.
- **CI 통합**: `.github/workflows/ci.yml`에 새 job `integration` — Supabase
  local CLI container + 시나리오 실행. 로컬 default `pnpm test`는
  unit-only 유지, integration은 `pnpm test:integration` opt-in. 추가 CI
  시간 ~1-2분.

### 범위 외

- evals/ pipeline 변경 (Langfuse, 모델 정확도) — 본 이슈 무관.
- GAS Add-on E2E test (CardService UI) — 별도 future work.
- 시나리오 1의 `embeddingHit` / `embeddingMiss` / `ambiguous` case는 본
  PR에서 type 정의만 검증; 실제 emit assertion은 ADR-0004 구현 이슈 #02가
  lockstep으로 채움.

## Acceptance criteria

- [ ] `@cloudflare/vitest-pool-workers` 도입 + `vitest.integration.config.ts`
      신설
- [ ] `pnpm test:integration` 스크립트 추가 — default `pnpm test`와 분리
- [ ] Supabase local CLI 기반 DB 시작/종료 helper (CI + 로컬 둘 다)
- [ ] Fixture `EmbeddingService` — 결정론적 `hash(text) → vector(N)`
- [ ] External HTTP mocking (Google Calendar, OpenAI) — fixture responses
- [ ] Test factory 함수 (`makeRule` / `makeEvent` / `makeUser`) +
      `truncate-tables-in-beforeEach` helper
- [ ] 시나리오 1 — `ClassificationOutcome` 각 case ≥ 1 test (LLM /
      no-match / embedding type 정의 검증; embedding emit assertion은
      ADR-0004 #02 lockstep)
- [ ] 시나리오 2 — Sync claim race (한 쪽만 획득)
- [ ] 시나리오 3 — Watch renewal claim semantics (독립성)
- [ ] 시나리오 4 — Embedding 실패 → LLM fallback
- [ ] 시나리오 5 — Rule mutation → resync fan-out
- [ ] `.github/workflows/ci.yml`에 `integration` job 추가
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

- #03

Status: done
GitHub: #114

## What to build

ADR-0004 의 임베딩 kNN 분류기를 가장 얇은 end-to-end 경로로 구현한다 —
`name` 씨앗만 다루는 tracer bullet. 한 Rule 의 이름을 임베딩해 저장하고, sync
시 이벤트 제목을 임베딩해 max 코사인으로 매칭하며, 기존 substring Stage 1 을
완전히 폐기한다.

end-to-end 범위:

- 신규 `rule_seeds` 테이블 — `(id, rule_id FK, user_id, seed_type
  enum('name'|'keyword'|'example'), seed_text, embedding vector(N),
  created_at)`. 씨앗당 1행, HNSW 인덱스, `user_id` 테넌트 스코프. 이 슬라이스는
  `seed_type='name'` 행만 기록한다.
- Workers AI 임베딩 쓰기 경로 — Rule 생성/수정 시 그 Rule 의 name 을 임베딩해
  `rule_seeds` 에 upsert.
- 기존 사용자 name 일괄 backfill 임베딩 1회성 잡.
- Stage 1 읽기 경로 — sync 시 이벤트 제목을 임베딩(sync run 당 배치, 저장
  안 함)하고, 해당 사용자 씨앗 벡터에 대한 max 코사인을 score 로 계산.
- 2등급 결정 로직 — `score(best) < T_low` → Stage 2 LLM fallback,
  `best - second < margin` → 모호 → Stage 2 fallback, 그 외 → best Rule 배정.
  이 슬라이스의 씨앗은 전부 Declared 등급이므로 `T_declared` 만 활성;
  `T_verified` 경로는 examples 슬라이스에서 활성화된다.
- substring 매처 폐기 — Stage 1 이 더 이상 키워드 부분문자열을 보지 않는다.

Stage 2 LLM fallback 은 그대로 존속한다 (ADR-0002 모델 결정 유효). 임베딩
호출은 Cloudflare 플랫폼 내부 호출이라 PII 경계를 넘지 않는다.

**OAuth 검수 게이트: 해당 없음.** 이 슬라이스의 씨앗(`name`)은 사용자가 직접
입력한 비-PII 텍스트이며 새 캘린더 내용을 durable 저장하지 않는다 — OAuth 검수
출시 게이트는 examples 씨앗(#05/#06)에만 적용된다. 이 이슈는 검수 통과 전에
빌드·배포 가능하다 (ADR-0004 "범위").

> **기존 prep seam (이미 존재).** `src/services/ruleService.ts` 에 `SeedType` /
> `SeedGrade` / `Seed` / `synthesizeSeeds()` / `RuleSideEffects` /
> `addExample()`(no-op) 가 이미 있다 — #02 는 이 seam *안*에서 구현하고
> 호출자를 건드리지 않는다. name 씨앗 write 는 기존 `RuleSideEffects`
> (`createRule`/`updateRule` 의 `sideEffects` → 라우트의 `waitUntil`) 를 재사용.
> pgvector 확장(`CREATE EXTENSION vector`)은 `0000` 마이그레이션에서 이미 설치됨;
> 과거 `categories.embedding vector(1536)` 컬럼은 `0007` 에서 제거됨(신규 테이블과
> 무관, 참고용).

## Provisional dependencies (ADR-0005) — 상속 결정과 흡수 전략

#02 는 #01 이 **잠정(provisional)** 으로 내린 세 결정 위에 서며, 뒤집힐 수 있는
리스크를 스키마·상수·backfill 설계로 흡수한다:

- **모델·차원 = `@cf/google/embeddinggemma-300m`(768d) provisional** — 동결은
  멀티 persona/다국어 골드셋까지 *연기*(ADR-0005 §8: 단일 persona·ko-only·`cat_0`
  47% 지배·꼬리 카테고리 n=2~9 → gemma↔qwen3 macro 격차 ~0.05 는 노이즈 안). **768→1024
  로 뒤집히면 비가역 스키마 마이그레이션**(전 테넌트·전 언어).
  → **흡수:** 차원은 단일 상수 `EMBEDDING_DIM`(AC #2). 마이그레이션 헤더에
  flip 절차를 주석으로 박고(AC #1), backfill 을 **재실행 안전**하게 만들어(AC #5)
  flip = "상수 1줄 + 마이그레이션 + backfill 재실행 + HNSW 재빌드" 의 bounded 조작이
  되게 한다.
- **임계값 `T=(0.30, 0.55, 0.10)` provisional** — `sts` 프리픽스의 Workers-AI
  parity 가 *빈 prefix 로만* 측정됨(ADR-0005 §6, mean cosine 1.0 은 고신뢰지 경계
  비트일치 보증 아님). 승자 프리픽스로 WAI 재측정 후 provisional 해제.
  → **흡수:** 임계값도 `EMBEDDING_DIM` 과 같은 단일 config 모듈 상수(AC #2) —
  provisional 해제가 한 곳 수정.
- **프리픽스 = prod 불변항, 이미 확정** — arm `sts`, 정확 문자열
  `task: sentence similarity | query: `(`sha256_16=793518b01601c92e`). backfill·
  create/update·title hot-path 가 **동일 프리픽스**로 임베딩해야 하며 불일치 시 저장
  씨앗 벡터 전수 오염(ADR-0005 §1). → **흡수:** 단일 임베딩 헬퍼가 프리픽스를
  강제(AC #3) — 호출자가 우회 불가.

## Acceptance criteria

- [x] **`rule_seeds` 마이그레이션** — 테이블 `(id, rule_id FK→categories
      onDelete cascade, user_id FK→users onDelete cascade, seed_type
      enum('name'|'keyword'|'example'), seed_text, embedding vector(768),
      created_at)` + **HNSW 인덱스 `vector_cosine_ops`**(ADR-0004 cosine 계약)
      + `(user_id)` 테넌트 인덱스. **grade 컬럼 없음** — 등급은 seed_type 에서
      파생(name/keyword=declared, example=verified; ADR-0004 신뢰등급 +
      `synthesizeSeeds` 규약). (rule_id, seed_type='name') 은 유일(name 1행 보장,
      create-or-replace 근거). 마이그레이션 헤더에 **차원 768 = ADR-0005 provisional·
      동결 연기** 를 명시하고 1024 flip 절차(컬럼 타입 ALTER + `rule_seeds` truncate +
      backfill 재실행 + HNSW 재빌드)를 주석으로 남긴다.
- [x] **config 단일화** — 모델 `@cf/google/embeddinggemma-300m`, `EMBEDDING_DIM=768`,
      프리픽스 `task: sentence similarity | query: `(sha256_16 `793518b01601c92e`),
      임계값 `T_verified=0.30`/`T_declared=0.55`/`margin=0.10` 를 **단일 config
      모듈**(예: `src/config/embedding.ts`)에 상수로 두고 **ADR-0005 provisional**
      임을 주석 명시. write(backfill·create/update)·read(sync) 경로가 전부 이 상수를
      참조 — provisional 해제(WAI 재측정, ADR-0005 §6)와 768→1024 flip 이 한 곳 수정.
- [x] **Workers AI 바인딩 + 프리픽스 강제 헬퍼** — `env.AI`(type `Ai`)를
      `src/env.ts` `Bindings` + `wrangler.toml`(dev·prod)에 추가(현재 미존재).
      임베딩은 **단일 헬퍼**(예: `embedText`/`embedTexts`)가
      `env.AI.run(EMBEDDING_MODEL, ...)` 를 감싸고 **위 고정 프리픽스를 강제** —
      씨앗·제목 양쪽이 동일 프리픽스를 쓴다는 불변항의 단일 집행점(호출자가 프리픽스를
      우회할 수 없어야 함).
- [x] **name 씨앗 write** — Rule 생성/수정 시 name 을 임베딩해
      `rule_seeds`(seed_type='name')에 **create-or-replace**(rule 당 name 1행).
      재임베딩은 **name 텍스트가 바뀔 때만** — colorId/priority-only 변경은 재임베딩
      안 함(`updateRule` 의 기존 `triggerSync` 판별과 정합). 기존
      `RuleSideEffects`(`ruleService.ts`) seam 을 통해 `waitUntil` 로 실행.
      keyword/example 씨앗 write 는 범위 밖(#03/#05).
- [x] **backfill 잡** — 기존 사용자 전원의 name 을 `rule_seeds` 로 일괄 임베딩하는
      1회성 잡. **재실행 안전**(idempotent: (rule_id,'name') upsert 또는
      truncate-then-rebuild) — 768→1024 flip 재-backfill 이 이 잡의 재실행이 되도록.
      트리거 수단(script vs route vs migration-hook)과 검증 방법(잡 후 name 행 수 ==
      활성 rule 수)을 명시.
- [x] **batch title 임베딩 read seam** — sync 경로에서 이벤트 제목을 **페이지 단위
      배치**로 임베딩(1 페이지 = `env.AI.run` 1회 배치, `res.items` 경계)하고
      **저장하지 않음**(transient). 벡터는 per-page `Map<eventId, vector>` 로 Stage-1
      kNN 이 소비. ("sync run 당 배치, 저장 안 함" 의 배치 granularity = **per-page** —
      기존 스트리밍 paging 루프·`MAX_PAGES_PER_FULL_RESYNC_RUN` 청킹과 정합.)
- [x] **Stage-1 kNN** — 각 이벤트 제목 벡터에 대해 해당 user 씨앗 벡터 전체와 max
      코사인(k=씨앗 풀 전체, agg=max, metric=cosine; ADR-0004) → score. pgvector
      쿼리는 반드시 `where(eq(rule_seeds.userId, ctx.userId))` 테넌트 스코프
      (src/AGENTS.md "Tenant isolation" — RLS 는 Worker 경로에서 무효).
- [x] **2등급 결정 로직 (테스트 검증)** — `score(best) < T_declared` → Stage 2
      fallback; `best - second < margin` → 모호 → Stage 2 fallback; 그 외 → best
      rule 배정. 이 슬라이스 씨앗은 전부 Declared → `T_declared`/`margin` 만 활성,
      `T_verified` 경로는 examples(#05)까지 비활성(cold-start ex=0 → verified score
      `nan`, ADR-0005 REPORT §1). 단위 테스트로 세 분기(미달·모호·배정) 검증.
- [x] **임베딩 호출 실패 거동** — sync read 경로에서 제목 임베딩 실패 시 **Stage 2
      LLM fallback 으로 강등**(ADR-0004 "약한 증거로 추측하느니 Stage 2" 정합; 조용한
      no_match 아님). **blast-radius 명시:** 시스템적 Workers-AI 장애 시 전 이벤트가
      LLM leg 로 몰리지만 기존 two-tier 일일 캡(global 10k / per-user 200) +
      per-run quota-latch 가 상한을 지어 폭주를 막는다(src/AGENTS.md "Cost guardrail").
      write(create/update/backfill) 경로 임베딩 실패는 기존 fan-out 실패 모델(warn-only,
      요청은 성공, 복구=재시도)을 따른다. **(ADR 후보 — 하단 note 참조.)**
- [x] **substring 폐기** — `src/services/classifier.ts` 삭제 + `classifierChain.ts`
      의 `ruleClassify` 호출/`ruleHit` 분기를 임베딩 kNN 으로 교체.
      `ClassificationOutcome.ruleHit.matchedKeyword`(substring 적중어)는 임베딩
      체제에서 의미 소멸(ADR-0004 consequence) → **적중 씨앗 식별로 대체하거나 제거**하고
      preview/사이드바 카피 영향을 명시. substring 전제 테스트(`classifier.test.ts` 등)
      정리.
- [x] **lockstep 문서 갱신** — ADR-0004 consequence 대로 `src/AGENTS.md` §5(§5.1
      substring 계약 → 임베딩 kNN)·§5.3 인접 서술과 `docs/architecture-guidelines.md`
      "Hybrid Classification Engine" 불변항을 **이 PR 에서 동시** 갱신(ADR-0004
      References; live invariant 인 `src/AGENTS.md` 우위).
- [x] **account-deletion cascade 계약 갱신** — `rule_seeds` 의 user-scoped 삭제 경로
      확정(`user_id → users onDelete cascade`). src/AGENTS.md "Account deletion" 의
      **9-table cascade 계약** 서술 + `accountRoute.test.ts` schema-cascade regex
      카운트(**9→10**)를 이 PR 에서 갱신(신규 user-cascade 테이블 추가 → 테스트가
      깨짐).
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] `python3 scripts/check-context-paths.py` 통과

> **ADR 후보 (AC #9 — 임베딩 실패 거동).** degrade-to-Stage-2 정책은 real
> trade-off(LLM 쿼터 비용 ↔ coloring 커버리지)이고 quota-latch 와의 blast-radius
> 상호작용이 surprising 하다(three-test 통과). ADR-0004 가 실패 거동을 "구현 이슈"
> 로 **위임**했으므로 여기 AC + 결정 note 로 착지시킨다 — 필요 시 blast-radius
> 정책을 **ADR-0006** 로 승격 가능(운영자 판단).

## Blocked by

None — #01 (모델·차원 eval) resolved 2026-06-30: 벡터 차원 잠정 `gemma 768`
(ADR-0005, 동결은 연기). 잠정 768 위에서 `rule_seeds` 스키마 작업 즉시 착수 가능.

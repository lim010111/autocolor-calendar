Status: done

## What to build

`classifierChain`의 shallow 책임 분산 정리. 현재 한 Classifier 결과는
두 경로로 외부에 누출된다 — (a) optional callbacks (`onLlmAttempted`,
`onLlmSucceeded`, `onLlmQuotaExceeded`, `onLlmCall`, …), (b) `SyncSummary`
flat 카운터 bag을 caller가 직접 `++`. 새 outcome 하나 추가하려면 chain
callback + summary field + observability emit + consumer wiring 네 군데를
동기화해야 한다. ADR-0004의 새 outcomes (`< T_declared` / `< T_verified` /
`ambiguous`)이 들어오면 4×3 = 12 군데 touch.

`ClassificationOutcome` discriminated union을 도입하고, chain이 default
sink를 owner로 보유한다 (옵션 C — union 반환 + chain owns default sinks).

### 설계 결정

- **`ClassificationOutcome` union**:
  - `embeddingHit { rule, seed, grade, score }`
  - `embeddingMiss { best?, second? }`
  - `ambiguous { best, second, margin }`
  - `llmHit { rule }`
  - `llmQuotaExceeded`
  - `llmBadResponse`
  - `llmTimeout`
  - `noMatch`
  - grade (`verified`|`declared`)는 별도 case가 아니라 `embeddingHit` 안의
    필드 — ADR-0004 trust grade 모델 그대로.
- **`Sink` Interface**: `(outcome: ClassificationOutcome) => Promise<void>`.
  chain 생성 시 주입. 기본 sink 2개:
  - `llmCallsTableSink` — 기존 `llm_calls` 테이블 emit
  - `syncSummarySink` — `SyncSummary` mutation
- **`chain.classify(event, rules)` 단일 콜**: outcome 결정 → sinks 병렬
  호출 (`Promise.allSettled`) → union 반환.
- **Failure isolation**: sink 실패는 warn 1줄, classify에 영향 없음 —
  `src/CLAUDE.md` §6 "observability writes must NEVER cause retry" 패턴.
- **`llmClassifier`는 순수 LLM 호출만 책임** — prompt build + API call +
  response parse. 기존 `finish()` 헬퍼의 observability emit 로직은 chain의
  default sink로 이동.
- **`SyncSummary`** — `calendarSync.ts`가 lifecycle owner (sync 시작 시
  init, 종료 시 caller가 read). chain에 `syncSummarySink`로 주입. 모양
  자체는 sync.ts에 잔존.
- **callback 폐기**: `onLlmAttempted` / `onLlmSucceeded` /
  `onLlmQuotaExceeded` / `onLlmCall` 등 전부 제거. `syncConsumer` wiring은
  sink 주입으로 교체. 호환 alias 없음 — surgical.
- **caller shape**:
  - `calendarSync.processEvent`: `const out = await classify(event, rules);
    if (out.kind === 'embeddingHit' || out.kind === 'llmHit')
    applyColor(event, out.rule.colorId)`
  - `preview` route: union 자체를 deserialize → best / score / seed text
    노출. ADR-0004 Consequences "`matchedKeyword`의 의미 변화" 처리 surface.
- **동작 변경 0줄**: 본 PR 시점에는 기존 outcomes (substring hit / no-match
  / LLM hit/miss)만 union에 매핑. ADR-0004의 새 outcomes (`embeddingMiss`
  / `ambiguous`)는 타입 정의만, 실제 emit은 ADR-0004 구현 이슈 #02 시점.

### 범위 외

- 새 `embedding*` outcome의 실제 emit — ADR-0004 구현 이슈 #02.
- Branded PII type 강제 — 본 feature 이슈 #03.
- Integration test 신설 — 본 feature 이슈 #04.
- lifecycle 카운터 (`seen` / `cancelled` / `evaluated` / `skipped_equal` /
  `skipped_manual` / `updated`) sink 이주 — chain outcome과 무관 (§5.4
  ownership marker + `patchEventColor` 결과에 묶임), processEvent 잔존이
  정합.

## Acceptance criteria

- [x] `ClassificationOutcome` discriminated union 정의 (`src/services/
      classifier/outcomes.ts` 또는 유사 위치)
- [x] `Sink` Interface 정의 + `llmCallsTableSink` / `syncSummarySink` 구현
- [x] `classifierChain` 리팩터 — `classify()` 단일 콜이 union 반환 + sinks
      병렬 emit
- [x] `llmClassifier`의 observability emit 로직이 chain default sink로 이동,
      `llmClassifier`는 순수 LLM 호출만 담당
- [x] calendarSync.processEvent의 **classifier-outcome 카운터**
      (`no_match`, `llm_attempted` / `llm_succeeded` / `llm_timeout` /
      `llm_quota_exceeded`) 직접 increment 제거 — syncSummarySink로 일원화
- [x] 모든 optional callback (`onLlmAttempted` 등) 제거, `syncConsumer`
      wiring 갱신
- [x] 기존 `preview` route가 union 통해 동등하거나 더 풍부한 정보 노출,
      회귀 없음
- [x] Sink 실패가 classify를 실패시키지 않고 warn 1줄로 끝남 (test로 검증)
- [x] 동작 변경 0줄 — 기존 단위 test 그대로 통과
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

- #01

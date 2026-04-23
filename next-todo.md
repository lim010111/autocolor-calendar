# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§6.1 DLQ 적재 동작 검증 테스트 확장**
  - **문제**: `src/__tests__/dlqConsumer.test.ts`가 존재하긴 하지만 §6 Wave A에서 랜딩한 `sync_failures.summary_snapshot` 복사 경로(마지막 실패 시도의 `SyncSummary`를 `sync_state.last_failure_summary`에서 SELECT → `sync_failures`로 INSERT)의 회귀 가드가 얇다. 특히 (a) 마지막 실패 summary가 없는 경우 `null` snapshot으로 기록되는 경로, (b) SELECT 실패 시 DLQ 감사 행은 여전히 쓰여야 한다는 불변식, (c) `msg.attempts` 값이 DLQ 행과 최종 consume 시점의 attempt 카운터가 일치하는지 검증, (d) `sync_state.last_failure_summary`는 성공 sync 시 null로 클리어되는지가 테스트로 못 박혀 있지 않아 `src/CLAUDE.md`의 "Observability tables (§6 Wave A)" 계약이 향후 리팩터링 시 silent하게 깨질 수 있다.
  - **해결**: `dlqConsumer.test.ts`에 §6 Wave A 회귀 가드 4~5 케이스 추가. (1) `last_failure_summary` 존재 시 `summary_snapshot`에 그대로 복사, (2) `last_failure_summary` NULL 시 `summary_snapshot = null`로 rows 기록, (3) SELECT 실패 mock 시 snapshot은 null이지만 DLQ 감사 행은 여전히 INSERT됨, (4) `msg.attempts` 값이 `sync_failures.attempts`와 일치, (5) 성공 sync 경로(`applyResult`)가 `last_failure_summary`를 null로 클리어하는 회귀는 `syncConsumer.test.ts`에 추가(Wave A 계약의 양 끝단을 묶음). 새 소스 코드는 추가하지 않음 — 순수 회귀 가드.
  - **주요 변경**: `src/__tests__/dlqConsumer.test.ts`에 `describe("§6 Wave A — summary_snapshot 회귀 가드")` 신규 블록 4 케이스. `src/__tests__/syncConsumer.test.ts`에 "applyResult가 last_failure_summary를 성공 시 null로 클리어" 1 케이스 추가. 소스 파일 수정 없음.
  - **문서**: 없음 — 기존 `src/CLAUDE.md: Observability tables (§6 Wave A)` 계약을 회귀 가드로 못 박는 것이 이번 작업의 목적이고, 계약 자체는 이미 정본에 있어서 문서 변경 불필요.
  - **의존성**: 없음.
  - **사이즈**: M (test 5 케이스, mock 팩토리 재사용).

# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§6.4 `/sync/run` `last_manual_trigger_at` 컬럼 분리** (§4A 리뷰 Finding #7)
  - **문제**: 현재 `sync_state.updated_at` 기반 30초 coalesce window는 consumer의 claim/release/요약 쓰기까지 전부 밀어 "방금 끝난 직후 변경사항 추가" 재트리거 UX가 429로 막힘.
  - **해결**: `sync_state`에 `last_manual_trigger_at timestamptz` 컬럼 신설. `/sync/run` 라우트에서 이 컬럼만 검사해 수동 트리거 레이트리밋 판단, consumer의 `updated_at` 터치와 분리. 기존 row는 `NULL` → `updated_at` fallback으로 호환 유지.
  - **주요 변경**: `drizzle/0011_*.sql` 마이그레이션, `src/db/schema.ts` 컬럼 추가, `src/routes/sync.ts`의 30초 window 체크 로직 교체, `/sync/run` 성공 시 `last_manual_trigger_at = now()` 스탬프, `syncRoute.test.ts`에 회귀 가드 (방금 consumer가 write → 곧바로 `/sync/run` 허용 / 방금 `/sync/run` → 30초 차단 / NULL fallback).
  - **문서**: `src/CLAUDE.md`에 "수동 트리거 레이트리밋" 계약 추가, TODO.md §6.4 해당 항목 체크.
  - **의존성**: 없음 (Supabase pg_cron·도메인 검수·OAuth 심사 모두 불필요).
  - **사이즈**: S (컬럼 1개 + 라우트 1개 + 테스트 3개).

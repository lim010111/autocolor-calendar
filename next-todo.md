# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§6.4 Watch 갱신 동시성 가드 (§4B 리뷰 M4)**
  - **문제**: 현재 `renewExpiringWatches`는 Cloudflare cron trigger에만 의존해 중복 실행을 막고 있지만, 수동 어드민 재트리거 경로(예: `/admin/watch/renew`)가 생기거나 cron이 overlap하는 환경(타 리전 / 장애 재시도)이 생기면 같은 `watch_channels` 행에 대해 stop → register 구간이 race될 수 있음. 기존 채널을 죽이고 신규 채널을 세팅하는 동안 또 다른 갱신 경로가 같은 row를 잡아 중간 상태의 신규 채널 ID를 날리는 시나리오가 가능. 현재는 잠재 버그지만, §7 어드민 도구 또는 §4 후속 "Prod Watch API 활성화" 시 surface 확률 높음.
  - **해결**: `watch_channels` 테이블에 `in_progress_at timestamptz` 컬럼 추가(`sync_state.in_progress_at`와 동일 패턴). `renewExpiringWatches`가 row를 잡을 때 `SELECT ... WHERE in_progress_at IS NULL OR in_progress_at < now() - interval '2 minutes'` + `UPDATE SET in_progress_at = now()` 원자적 claim. stop + register 성공 후 `in_progress_at = null` 릴리스. 실패(Google 4xx/5xx/timeout) 시 `in_progress_at`은 stale TTL(2분) 경과 후 자연 재획득 가능. Drizzle migration + test + `src/CLAUDE.md`에 watch concurrency 계약 섹션.
  - **주요 변경**: `drizzle/NNNN_watch_channel_in_progress_at.sql` (컬럼 + btree index on `(user_id, in_progress_at)`), `src/db/schema.ts` `watchChannels` drizzle 정의에 필드 추가, `src/services/watchRenewal.ts` claim/release 로직, `src/__tests__/watchRenewal.test.ts`에 3~4 케이스(claim 성공 / 이미 진행 중 skip / 2분 TTL stale row 재획득 / stop 실패 시 release 없이 return). `src/CLAUDE.md`에 "Watch renewal concurrency (§6.4)" 계약 섹션.
  - **문서**: `src/CLAUDE.md` 새 섹션(Manual-trigger rate limit 바로 뒤) + `docs/architecture-guidelines.md` "Watch 채널 수명주기" 항목에 concurrency 정책 1~2줄 추가. TODO.md §6.4 해당 체크박스 flip.
  - **의존성**: 없음. `sync_state.in_progress_at` 패턴을 그대로 차용하므로 schema review 부담 적음.
  - **사이즈**: M (migration 1 + schema 1 + service 1 + test 3~4).

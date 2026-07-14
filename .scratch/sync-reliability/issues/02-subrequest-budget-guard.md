Status: ready-for-agent
GitHub: #137

## What to build

sync 런이 **invocation당 외부 fetch 수를 스스로 세고, 예산에 근접하면 그
지점에서 멈춘 뒤 연속 chunk를 재enqueue**하게 한다. 근거는 [PRD](../PRD.md):
Free 플랜 50개(Paid 1000개) 캡을 넘는 순간 이후 모든 fetch가 던져져 분류
소실(silent no_match)·PATCH 실패발 재시도 폭풍이 발생한다. 페이지 수 제한
(`MAX_PAGES_PER_FULL_RESYNC_RUN=5`)만으로는 못 막는다 — `maxResults`가
2500이라 페이지 1개에 이벤트 수백 개가 실린다.

설계 노트 (구현 세션 재량):
- 카운트 대상: events.list / events.patch / OpenAI fetch. 재개 방식은
  full_resync의 기존 chunk 재enqueue 경로 재사용이 유력 — 같은 pageToken으로
  재처리해도 idempotent(재분류 결과 동일 색은 `skipped_equal`)하므로
  mid-page 커서 없이 페이지 단위 재개로 충분한지 먼저 검토.
- 예산은 env var(플랜 전환 대응, Free 기본 ~40 마진). #01 결정과 무관하게
  동작해야 함 — 상수만 다르다.
- incremental sync(webhook발)는 변경 이벤트 수가 작아 통상 안전하지만,
  가드는 공통 경로(`runPagedList`)에 있어야 대형 변경 폭주도 막는다.

## Acceptance criteria

- [ ] `runPagedList`가 invocation당 외부 fetch 수를 카운트하고, 예산 도달 시
      처리를 중단하고 연속 chunk를 재enqueue한다 (이벤트 유실 없음)
- [ ] 예산 기본값은 env var로 조정 가능, Free 플랜 50 기준 안전 마진 포함
- [ ] 예산 중단 시 warn 로그 1줄 (카운터만 — 이벤트 내용 없음, 로그 리댁션
      계약 준수)
- [ ] 대형 페이지 시뮬레이션 테스트: 예산 초과 상황에서 어떤 fetch도
      "Too many subrequests"로 던져지지 않고 chunk 재개로 완주
- [ ] `sync_runs` 카운터에 예산 중단이 관측 가능 (기존 outcome 활용 또는
      필드 추가 — 구현 선택)
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

None — can start immediately. (#01 결정은 예산 상수만 바꾼다 — hard blocker
아님.)

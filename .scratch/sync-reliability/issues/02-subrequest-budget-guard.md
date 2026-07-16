Status: done
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

- [x] `runPagedList`가 invocation당 외부 fetch 수를 카운트하고, 예산 도달 시
      처리를 중단하고 연속 chunk를 재enqueue한다 (이벤트 유실 없음)
- [x] 예산 기본값은 env var로 조정 가능, Free 플랜 50 기준 안전 마진 포함
- [x] 예산 중단 시 warn 로그 1줄 (카운터만 — 이벤트 내용 없음, 로그 리댁션
      계약 준수)
- [x] 대형 페이지 시뮬레이션 테스트: 예산 초과 상황에서 어떤 fetch도
      "Too many subrequests"로 던져지지 않고 chunk 재개로 완주
- [x] `sync_runs` 카운터에 예산 중단이 관측 가능 (기존 outcome 활용 또는
      필드 추가 — 구현 선택)
- [x] `python3 scripts/check-context-paths.py` 통과

## 구현 노트 (2026-07-16)

- 검토 결과 **maxResults=2500 그대로는 페이지 단위 재개가 수렴하지 않음**
  (redo가 rule-miss 이벤트당 OpenAI fetch 1개씩 재소모 → LLM-heavy 페이지에서
  스톨). 페이지 크기를 예산에서 유도(`floor((budget-2)/3)`, 기본 40 → 12)해
  "fresh invocation이면 페이지 하나는 반드시 완주"를 보장 — 같은 pageToken
  재처리(mid-page 중단)와 페이지 경계 중단 모두 수렴한다.
- incremental(syncToken 기반) 런의 예산 중단은 `{syncToken, pageToken}` 쌍을
  잡(job)에 실어 재개 — full_resync의 chunk 재enqueue 경로(`applyResult`)를
  분기 확장. 토큰 쌍을 잡에 싣는 이유: 끼어든 다른 incremental이 새 토큰을
  저장해도 Google이 보는 쌍이 항상 일관되도록.
- `sync_runs` 관측: 마이그레이션 없이 기존 필드 재사용 —
  `outcome='ok' AND stored_next_sync_token=false` (full_resync는 추가로
  `pages < 5`)가 예산 중단 시그니처. incremental의 ok+미저장 행은 예산
  중단에서만 나온다. warn 로그 1줄(used/budget/pages/seen/userId)이 보조.

## Blocked by

None — can start immediately. (#01 결정은 예산 상수만 바꾼다 — hard blocker
아님.)

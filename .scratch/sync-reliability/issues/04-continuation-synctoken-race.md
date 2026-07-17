Status: done
GitHub: #150

## What to build

지연된 chunk-continuation이 더 새로운 syncToken을 **과거로 되덮는 레이스**의
방지(또는 명시적 무해화 재확정). PR #143 merge-gate finding에서 관측된
시나리오 — #02 예산 가드의 continuation은 중단 시점의 `(syncToken, pageToken)`
쌍을 큐 잡에 실어 재개하는데(`src/services/calendarSync.ts` 353행 부근,
sync_state 재조회 없이 잡에 실린 값을 사용), 이 잡이 지연되는 사이 같은
캘린더에 새 sync 런이 완료되면 continuation 완주 시 `finalSyncToken` 저장이
최신 sync_state 토큰을 되돌릴 수 있다. #02 머지 시 **observed-not-prevented로
수용**(발생해도 다음 incremental이 과다 재처리할 뿐 데이터 유실 아님, 발생
확률 낮음) — 이 이슈는 그 수용을 방지로 승격할지 grill에서 판단하고 구현한다.

설계 후보 (구현 세션 재량):

- continuation에 run 세대(시작 시점 syncToken)를 실어, sync_state 쓰기를
  "저장된 토큰이 이 런의 시작 토큰과 같을 때만" 조건부 UPDATE(CAS)로 —
  낡으면 쓰지 않고 관측 로그만
- 또는 계측만 추가(되덮기 발생 카운터/warn) 후 wontfix 재확정

## Acceptance criteria

- [x] 지연 continuation이 최신 토큰을 되덮는 시나리오의 재현 테스트
- [x] 방지책 적용 시: 낡은 continuation은 토큰을 되덮지 않고 관측 가능하게
      종료한다 (정상 완주 summary와 구분)
- [x] 정상(비경합) continuation 경로 회귀 없음 — 기존 budget-guard 테스트 green
- [x] wontfix 재확정으로 종결할 경우: 근거를 이 파일 Comments에 기록
      *(해당 없음 — 방지책(CAS) 채택, grill 결론 Comments 참조)*

## Blocked by

None — 배포 게이트와 무관, pre-OAuth 머지 가능(라이브 반영만 배포 대기).

## Comments

- **2026-07-17 grill 결론 (구현 세션): 후보 1 채택 — CAS 조건부 UPDATE.**
  - 레이스 성립 조건 재확인: 모든 sync 런은 claim 하에 토큰을 읽고 쓰므로
    fresh 런의 read→write 는 claim-원자적이다. 낡은 토큰이 스토어를 되덮을
    수 있는 유일한 경로는 **hop 경계에서 claim 을 놓는 continuation** —
    잡에 실린 arc 시작 토큰이 다음 hop 의 쓰기 시점까지 살아남는, #02 가
    신설한 경로다. §5.4 PATCH 레이스 등 기존 observed-not-prevented 선례는
    ETag 없는 Google 쪽 last-writer-wins 라 방지 수단 자체가 없었던 반면,
    이 레이스는 우리 DB 위라 WHERE 술어 하나로 막힌다.
  - 후보 2(계측만) 기각: 되덮기를 "관측"하는 데에도 동일한 저장-토큰
    비교가 필요해 코드 풋프린트가 같다 — 같은 비용이면 방지가 지배 전략.
    §6.4 manual-trigger 의 "조건부 UPDATE 금지" 근거(추가 라운드트립 비용)는
    여기 해당 없음: 기존 최종 UPDATE 에 술어 하나 추가라 라운드트립 0.
  - 순수 wontfix (AC 4) 기각: continuation hop 은 retryable backoff 로 분
    단위 지연이 가능하고(계측 없이는 발생 자체가 안 보임), 수정은 소규모.
  - 스코프: CAS 는 **continuation-resume hop 에만** (`start.syncToken` +
    `start.pageToken` 동반 시). fresh incremental 에 일괄 적용하면 지연 hop
    이 먼저 쓴 뒤 fresh 런이 CAS 미스로 더 신선한 토큰을 버리는 역전이
    생긴다 — fresh 런은 claim-원자라 CAS 불필요. full_resync 는 새 토큰
    arc 확립이 목적이므로 무조건 쓰기 유지.
  - CAS 미스 시 최종 UPDATE 전체(토큰 + lastRunSummary + failure-clear)를
    스킵 — 끼어든 최신 완주 런이 이미 자기 요약을 썼으므로 그쪽이 정본.
    관측: summary 에 `sync_token_write_skipped`(jsonb 전용, sync_runs 컬럼
    아님 — `skipped_no_label` 선례) + warn 1줄(카운터만). #02 의 sync_runs
    시그니처("incremental ok+미저장 = 예산 중단")에 희귀한 제2 생산자가
    생기는 점은 이 플래그와 warn 으로 구분한다.
  - 수렴 검증(이중 arc): 두 continuation 이 같은 시작 토큰 X 를 실었을 때
    먼저 완주한 쪽만 쓰고 늦은 쪽은 CAS 미스로 스킵 — 원하는 방향.
    끼어든 410-clear(stored=NULL)와의 비교도 자연히 미스 → 스킵(대기 중인
    full_resync 가 토큰을 재확립).

- **2026-07-17 merge-gate findings 패스 1 (ADR-0027 loop): 3건 재현 확정 →
  3-레이어로 확장.** 위 grill 결론의 두 판단이 리뷰에서 반증됨:
  - finding-0 (재현 확정): "fresh 런은 claim-원자" 는 과대 주장 —
    `syncClaim` 의 5분 stale 윈도우가 overrun 런과 새 consumer 의 동시
    실행을 명시적으로 허용하므로, fresh 무조건 쓰기는 제2의 되덮기
    경로였다. → CAS 를 **모든 syncToken-paged 런**으로 통일 (스토어
    선형성: stored X 에서 시작한 arc 의 결과만 X 를 대체 가능). grill 이
    우려한 "fresh 역전"은 통일 CAS 아래서 benign(과다 재처리 한 사이클,
    플래그로 관측)으로 재평가.
  - finding-1 (재현 확정): CAS 미스 시 전체 UPDATE 스킵이면 skip 플래그가
    메모리/로그에만 남음(sync_runs 는 스칼라 전용) → **narrow persist**
    추가: `{lastRunSummary(플래그 포함), updatedAt}` 만 쓰는 좁은 UPDATE.
    nextSyncToken(최신 토큰 보존)·lastFailureSummary(타 런의 실패
    스냅샷 보존)는 건드리지 않는다.
  - finding-2 (재현 확정, 구현 diff 리뷰): CAS 가 최종 페이지 브랜치에만
    있어 다시 예산-중단하는 stale hop 은 fetch 를 계속 쓰고 재enqueue 를
    반복 → **entry pre-check** 추가: resume hop 은 어떤 외부 fetch 보다
    먼저 stored 토큰을 재조회, 비-NULL 불일치면 즉시 stale-skip 종료
    (fetch 0). NULL 은 관용(410-clear 잔재 — 최종 CAS 가 커버).
  - 오라클: `calendarSync.finding{0,1,2}.repro.test.ts` (동결 회귀 테스트로
    영구 편입). 절차 메모: finding-2 reproduce 서브의 파일 쓰기가 2회
    유실·보고 불일치 → 오라클은 메인 세션이 직접 작성·HEAD 실패 확인.
    fix 서브 결과물도 동시 실행 서브 간섭으로 유실 → 동일 설계를 메인
    세션이 재적용 후 전체 재검증 (571 tests green).

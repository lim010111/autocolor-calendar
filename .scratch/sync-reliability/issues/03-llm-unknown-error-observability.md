Status: done
GitHub: #138

## What to build

`llmClassifier.ts`의 unknown-error catch(현재 `err.name`만 로깅)를
**진단 가능하게** 만들고, 캡 감지 시 낭비를 멈춘다. 근거는 [PRD](../PRD.md):
name-only 로깅이 "Too many subrequests"를 12일간 `unknown error: Error`로
은폐했고, 캡 소진 후에도 이벤트마다 `reserveLlmCall`(쿼터 예약)을 계속
소모했다(07-14 런에서 21건 낭비). 산발성 Mode B 실패(연결 수준 transient
추정)의 정확한 메시지도 현재는 소실된다.

설계 노트 (구현 세션 재량):
- **로깅**: SECURITY CONTRACT(이벤트 내용·프롬프트·응답 미로깅) 유지.
  알려진 런타임 인프라 메시지의 allowlist 매칭(최소 "Too many subrequests",
  "Network connection lost")으로 분류명만 로깅 — `err.message` 원문은 여전히
  로깅 금지.
- **cap-latch**: "Too many subrequests" 감지 시 그 런의 잔여 LLM 콜을 스킵.
  `classifierChain`의 `quotaLatched` 패턴 미러 (감지 신호를 chain까지
  전달하는 방법이 설계 포인트 — outcome kind 추가 또는 별도 신호).
- **재시도**: 그 외 unknown 에러는 timeout/transient http와 동일하게
  `MAX_ATTEMPTS` 내 1회 재시도 (Mode B는 다음 콜이 바로 성공하는 transient —
  재시도 1회로 대부분 구제 가능).
- **telemetry**: `llm_calls`에서 thrown-fetch 실패와 모델발 bad_response가
  구분되게 (현재는 `raw_response IS NULL` 간접 추론만 가능). 새 outcome
  kind를 추가하면 check constraint 마이그레이션 + `sync_runs`/stats 카운터
  파급을 함께 처리.

## Acceptance criteria

- [x] unknown-error warn이 allowlist 분류를 포함한다 (예:
      `[llmClassifier] unknown error: Error (subrequest_cap)`) — 비매칭
      메시지는 기존처럼 name만
- [x] "Too many subrequests" 감지 시 같은 런의 잔여 LLM 콜이 스킵되고
      `reserveLlmCall`이 호출되지 않는다 (quota 낭비 0)
- [x] allowlist 비매칭 unknown 에러는 1회 재시도 후 기존 폴백 (기존
      `MAX_ATTEMPTS=2` 계약 내)
- [x] thrown-fetch 실패가 `llm_calls`에서 모델발 bad_response와 구분 가능
- [x] `llmClassifier.test.ts` unknown-error 케이스 갱신 + cap-latch / 재시도
      신규 테스트
- [x] SECURITY CONTRACT 회귀 없음 — `err.message` 원문이 로그에 나가는 경로
      없음 (테스트로 고정)
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

None — can start immediately.

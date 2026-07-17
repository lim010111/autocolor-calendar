Status: needs-triage
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

- [ ] 지연 continuation이 최신 토큰을 되덮는 시나리오의 재현 테스트
- [ ] 방지책 적용 시: 낡은 continuation은 토큰을 되덮지 않고 관측 가능하게
      종료한다 (정상 완주 summary와 구분)
- [ ] 정상(비경합) continuation 경로 회귀 없음 — 기존 budget-guard 테스트 green
- [ ] wontfix 재확정으로 종결할 경우: 근거를 이 파일 Comments에 기록

## Blocked by

None — 배포 게이트와 무관, pre-OAuth 머지 가능(라이브 반영만 배포 대기).

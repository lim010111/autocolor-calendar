Status: needs-triage
GitHub: #151

## What to build

`src/services/colorRollback.ts`의 do/while 페이징 루프(110~248행)는 페이지 수
캡(`MAX_PAGES_PER_ROLLBACK_RUN`)만 있고 **#02 서브리퀘스트 예산 가드가
미적용** — 페이지당 list 1 fetch + app-owned 이벤트마다 PATCH 1 fetch가
무계상으로 나가서, 색칠된 이벤트가 많은 캘린더의 rollback(서비스 해지/계정
삭제 경로)이 Workers Free 50캡을 그대로 밟을 수 있다. 캡 초과 시 rollback이
중도 사망 → 사용자 캘린더에 색이 반쯤 남은 상태로 종료된다. calendarSync의
fetch 계상(`fetches.used`)·chunk continuation 패턴을 rollback 경로에
이식하거나, rollback 전용 예산 상한을 도입한다.

설계 노트:

- rollback은 sync_state를 만지지 않으므로(§5 후속 B, `syncConsumer.ts`
  43~53행) 재개 상태는 `(calendarId, pageToken)`만으로 충분 — #04의
  syncToken 레이스와 무관
- Paid 전환(`SYNC_SUBREQUEST_BUDGET` ~900) 후엔 실질 위험이 급감 —
  grill에서 Paid 전제로 wontfix/연기 판단도 유효 (sr#01 Comments 참조)

## Acceptance criteria

- [ ] rollback 런의 fetch 사용량이 예산 계상된다 (list + PATCH)
- [ ] 예산 도달 시 중도 사망 대신 관측 가능한 재개(또는 부분완료 보고) 경로
- [ ] 캡 초과 시나리오 테스트 (대형 캘린더 시뮬레이션)
- [ ] 기존 `colorRollback.test.ts` 회귀 없음

## Blocked by

None — pre-OAuth 머지 가능. 우선순위는 Paid 전환 결정과 커플링.

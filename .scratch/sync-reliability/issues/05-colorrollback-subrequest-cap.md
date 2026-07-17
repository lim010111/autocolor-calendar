Status: done
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

- [x] rollback 런의 fetch 사용량이 예산 계상된다 (list + PATCH)
- [x] 예산 도달 시 중도 사망 대신 관측 가능한 재개(또는 부분완료 보고) 경로
- [x] 캡 초과 시나리오 테스트 (대형 캘린더 시뮬레이션)
- [x] 기존 `colorRollback.test.ts` 회귀 없음

## Blocked by

None — pre-OAuth 머지 가능. 우선순위는 Paid 전환 결정과 커플링.

## Comments

- **2026-07-17 grill 결론 (구현 세션): 예산 가드 이식 채택 — 단, rollback
  도메인 특성에 맞춘 축소 이식(재시작-재개, continuation state 0).**
  - Paid 전제 wontfix 기각. ① 잔여물이 자가치유 불가: cleared 안 된 색은
    다음 sync 가 안 고치고(카테고리가 이미 삭제됨) 사용자가 재트리거할
    방법도 없음(`DELETE /api/categories/:id` 는 이미 404) — §6 cleanup 툴
    미구현이라 캘린더 오염이 영구 잔존. ② Free 가 지금의 라이브 posture 고
    Paid 트리거(OAuth 통과)는 외부 게이트라 시점 미정. ③ Paid(1000캡)로도
    소멸 안 함: `listEvents` 는 maxResults 기본 2500 + `singleEvents=true`
    라 recurring 전개 인스턴스가 전부 개별 PATCH 대상 — 한 카테고리
    ~950개 이상(예: daily recurring 3개 ≈ 1,185 인스턴스)이면 Paid 캡도
    밟는다. ④ 현행 실패 모드: 캡 초과 fetch throw 는 CalendarApiError 가
    아니라서 `runColorRollback` 을 이탈 → `recordUnknownError`(sync_state
    lastError 오염) + msg.retry, max_retries=5 → Free 기준 attempt 당
    ~46개 진행 × 6 ≈ 280개 후 DLQ — 그 이상은 영구 잔존.
  - 이식 형태: fetch 계상(list + PATCH)은 #02 와 동일한
    `SYNC_SUBREQUEST_BUDGET` 공유(플랜 전환 시 env 하나로 두 경로 회복) +
    예산 도달 시 중단. **재개는 pageToken 없이 같은 잡 재enqueue(재시작)**:
    cleared 이벤트는 marker 가 지워져 `privateExtendedProperty` 필터에서
    빠지므로 1페이지부터 재시작해도 자연히 미처리 이벤트에서 재개된다 —
    mutation 중인 필터 목록에 pageToken 재개를 걸면 오히려 항목 시프트로
    누락 위험. #02 의 페이지 크기 유도는 불필요(sync 와 달리 redo 비용이
    LLM 재소모가 아니라 값싼 list 재스캔).
  - 종료 보장: 재enqueue 는 **진행 게이트**(`cleared + not_found > 0`)
    아래서만 — 필터 매치 집합이 런마다 엄격 감소하므로 유한 종료.
    무진행 예산 중단(예: forbidden 이벤트가 예산을 다 먹는 경우)은 기존
    MAX_PAGES 밸브와 같은 "잔여 페이지 포기 + warn" 의미론 유지.
  - `MAX_PAGES_PER_ROLLBACK_RUN=10` 밸브는 불변(포기 의미론 포함) — AC
    범위 밖. #04 syncToken 레이스와 무관(rollback 은 sync_state 의 토큰을
    만지지 않음) — 별도 브랜치·PR.

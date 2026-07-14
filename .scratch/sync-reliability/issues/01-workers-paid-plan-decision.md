Status: ready-for-human
GitHub: #136

## What to build

**Workers Paid(Standard) 플랜 업그레이드 여부를 결정한다** — 비용 결정이라
사람 게이트. 근거는 [PRD](../PRD.md): 계정이 Free 플랜이라 invocation당
서브리퀘스트 50개 제한에 큰 sync 런이 걸려 분류 소실·재시도 폭풍·쿼터
전소가 발생 중(07-02·07-14 실측). Paid는 $5/월, 한도 1000개.

판단 재료:
- 실사용자 온보딩(캘린더 전체 full sync)이 구조적으로 캡을 밟으므로,
  **마켓플레이스 런칭 전에는 사실상 필수**. 운영자 1인 사용 단계에서는
  규칙 추가/삭제 때만 간헐 발생.
- Supabase Pro 중단(2026-07-01)과 같은 비용 절감 기조라면 "런칭/실트래픽
  임박 시 업그레이드" 트리거로 보류 가능 — 단 그 사이 대형 resync는 #02·#03
  없이는 계속 조용히 부서진다.

## Acceptance criteria

- [ ] 결정 기록: 즉시 업그레이드 / 트리거 조건부 보류(트리거 명시) 중 하나를
      이 파일 Comments에 남김
- [ ] 업그레이드를 택한 경우: 대시보드에서 플랜 전환 후, 규칙 추가로 대형
      full resync 1회를 유발해 `wrangler tail --env prod`에서
      `[llmClassifier] unknown error` 부재 확인
- [ ] 보류를 택한 경우: 트리거 조건을 STATUS.md Open decisions에 등재

## Blocked by

None — can start immediately.

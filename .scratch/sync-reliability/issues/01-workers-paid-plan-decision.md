Status: done
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

- [x] 결정 기록: 즉시 업그레이드 / 트리거 조건부 보류(트리거 명시) 중 하나를
      이 파일 Comments에 남김
- [x] 업그레이드를 택한 경우: 대시보드에서 플랜 전환 후, 규칙 추가로 대형
      full resync 1회를 유발해 `wrangler tail --env prod`에서
      `[llmClassifier] unknown error` 부재 확인 *(해당 없음 — 보류 선택;
      전환 시점에 이 검증 절차 수행)*
- [x] 보류를 택한 경우: 트리거 조건을 STATUS.md Open decisions에 등재

## Blocked by

None — can start immediately.

## Comments

- **2026-07-16 결정 (운영자): 보류 — OAuth 검수 통과 트리거.** OAuth 검수
  통과 → native-labels #04 컷오버 직전에 Paid($5/월) 전환. 근거: #02
  서브리퀘스트 예산 가드(PR #143)가 Free 캡에서도 sync 를 chunk 재개로
  완주시켜(조용한 소실·재시도 폭풍 해소) 긴급도가 내려갔고, 비용 절감
  기조(Supabase Pro 중단과 동일)를 유지. 트레이드오프: 대형 resync 가
  느려짐(invocation당 ~12이벤트 페이지) — 전환 시
  `SYNC_SUBREQUEST_BUDGET` env 를 ~900 으로 올리면 자동 회복. 전환 후
  검증 절차는 AC 2 그대로 수행.

- **2026-07-24: Paid 전환 트리거 발화.** OAuth 검수 승인 → native-labels #04
  컷오버 창 개방. 위 보류 결정의 트리거 조건이 충족됐으므로 컷오버 직전에
  Paid 전환 + `SYNC_SUBREQUEST_BUDGET` ~900 상향 + AC 2 검증 절차를 수행할 것.

- **2026-07-28: 전환 절차의 결함 발견 (merge-gate finding, PR #161).** 위
  "`SYNC_SUBREQUEST_BUDGET` 를 ~900 으로 올리면 자동 회복" 은 **그것만으로는
  불충분**하다. #02 예산 가드는 주석상 "per-invocation" 이지만 실제로는
  **per-job** 이다 — `runPagedList` 가 `fetches = { used: 0 }` 를 run 마다
  새로 만드는데(`calendarSync.ts:449`), `handleSyncBatch` 는 배치의 모든
  메시지를 **한 invocation 안에서** 순차 처리한다(`syncConsumer.ts:31`).
  `max_batch_size = 10` 이므로 큰 job 두 개가 한 배치에 들어오면 900+900 을
  시도해 Paid 의 1000/invocation 캡을 그대로 넘고, 가드가 막으려던 "Too many
  subrequests" 가 되살아난다. colorRollback 도 같은 큐·같은 env 값을 쓰므로
  sync 1 + rollback 1 조합에서도 동일.
  - **성질**: 신규 결함이 아니라 **기존 잠복 결함**. Free/40 에서도 10×40=400
    > 50 으로 이미 깨져 있었고, 실사용자 1명·캘린더 1개라 claim 코얼레싱이
    대부분의 배치를 흡수해 드러나지 않았을 뿐이다. 멀티테넌트로 가면 터진다.
  - **PR #161 의 조치**: prod sync consumer `max_batch_size` 10 → **1**.
    `handleSyncBatch` 가 어차피 순차라 배치는 병렬성을 준 적이 없고 invocation
    수만 아꼈다 — Paid 에서는 싼 축이다. per-job == per-invocation 이 되어
    가드의 선언된 불변식이 복구된다.
  - **남은 잔여 (별도 이슈 후보)**: ① dev 도 동일 잠복 결함(40×10 vs Free 50)
    — 배포 대상이 아니라 이번 PR 범위 밖으로 뒀다. ② 근본 수정 = 배치 전체를
    관통하는 **공유 카운터**를 스레딩해 남은 예산을 각 job 에 넘기기. 이게
    되면 `max_batch_size` 를 다시 올려도 안전하다.

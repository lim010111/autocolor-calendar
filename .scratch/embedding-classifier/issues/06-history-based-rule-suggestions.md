Status: ready-for-agent
GitHub: #118

## What to build

과거 일정 기반 자동 Rule 생성(idea 3) — 온보딩 1회성, 옵트인/옵트아웃 기능.
사용자 본인 캘린더의 최근 12개월 제목을 분석해 Rule 을 제안하고, 사용자가
검토·편집·수락한 뒤에야 적용한다. **자동 적용은 절대 없다** (자동 적용은
§5.4 색 ownership marker 와 충돌하고 신뢰를 훼손한다).

end-to-end 범위:

- 최근 12개월 이벤트 제목을 임베딩해 클러스터링. 인프라 재사용 —
  `prompts/dataset-builder/label-clusters.system.v1.md` 클러스터 라벨링
  프롬프트가 이미 존재하며, idea 3 는 dataset-builder 파이프라인을 사용자
  본인 캘린더에 돌리는 것. 클러스터링은 임베딩, 라벨링만 LLM(클러스터당 1콜).
- (3a) 색 히스토리가 있는 사용자 — 제목→색 매핑을 추론해 색까지 채운 완전한
  Rule 을 제안.
- (3b) 색 히스토리가 없는 사용자 — 제목만 클러스터링해 Rule 골격(이름 +
  examples)을 제안하고 색은 사용자가 고름. (3b)가 없으면 idea 3 은 "이미
  색칠하는 사람"만을 위한 기능이 되어 핵심 타겟을 빗나간다 — 둘 다 필수.
- 제안 Rule 상위 8~10개로 캡 (CardService 에서 검토 가능하도록).
- 생성 Rule 은 `examples[]` 만 씨앗으로 채운다(대표 과거 제목 ≤10).
  `keywords[]` 는 비운다 — 키워드는 검토 화면에서 examples 기반 LLM 제안으로
  제시하되 꺼진 채(opt-in), 사용자가 명시적으로 켜야 적용.
- 흐름: 생성 → 제안 목록 제시 → 사용자 검토/편집/수락 → 그 다음 평소 "모든
  일정에 규칙 적용" 동기화.

example 인프라(이슈 #05)에 의존한다 — 생성 Rule 의 씨앗이 곧 example 이므로
같은 OAuth 검수 출시 게이트를 상속한다.

## Acceptance criteria

- [ ] 온보딩에 옵트인/옵트아웃 가능한 자동 Rule 생성 진입점이 추가된다
- [ ] 최근 12개월 제목 임베딩 클러스터링 + `label-clusters` 프롬프트 라벨링이
      사용자 캘린더에 대해 동작한다
- [ ] (3a) 색 히스토리 보유 사용자에게 색까지 채운 완전 Rule 이 제안된다
- [ ] (3b) 색 히스토리 없는 사용자에게 이름+examples 골격 Rule 이 제안되고
      색은 사용자가 고른다
- [ ] 제안 Rule 이 상위 8~10개로 캡되고 CardService 검토 화면에 표시된다
- [ ] 생성 Rule 은 `examples[]` 만 채우고 `keywords[]` 는 비며, 키워드 제안은
      opt-in(꺼진 채 표시)이다
- [ ] 자동 적용 경로가 없다 — 사용자 수락 후에만 동기화가 적용된다
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과

## Blocked by

- #05

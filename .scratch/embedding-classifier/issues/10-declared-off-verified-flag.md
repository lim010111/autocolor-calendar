Status: ready-for-agent
GitHub: #177

## What to build

ADR-0008 묶음 2: declared 임베딩 배정을 끈다 — name/keyword 씨앗 코사인이
높다는 이유만으로 칠하는 경로(`T_DECLARED` 승자 배정) 제거, 해당
트래픽은 전부 LLM 행. 측정 근거: 배정 중 오적용 17.2%, 모든 게이트
변형의 통과 부분집합에서 LLM 이 배정을 이김(체인 +0.454 vs LLM +0.488).

verified(example) 경로는 **휴면 조건부 유지 + flag 차단**:

- **마스킹 수정 (3자 리뷰 공통 지적)**: `stage1.ts` 풀 질의가
  `DISTINCT ON (rule_id)` 로 규칙당 최고 씨앗 1개만 뽑아 등급을 정하므로,
  declared 씨앗이 example 을 눌러 verified 가 영구 침묵할 수 있다 —
  등급별(verified/declared) 최고 씨앗 분리 조회로 수정.
- **feature flag**: verified 칠하기는 §12 저장 개시(2026-08-28) 후에도
  기본 차단. 마스킹 수정 + 실측(ADR-0008 재판정 트리거 2: example 축적
  후 T=0.30 배정 품질을 같은 케이스 LLM 답과 짝비교) 통과 후에만 연다.
  2표 게이트가 LLM 판정에만 걸리므로, flag 없이 열면 미측정 bar 0.30 이
  유일한 무검증 페인트 경로가 된다.
- 상수·씨앗 인프라는 유지(가역). `src/AGENTS.md` Stage 1 절의 declared
  배정 기술을 갱신(정본 우위 규칙 — 3자 리뷰 낮음 finding).

## Acceptance criteria

- [ ] declared 승자 배정 제거 — Stage 1 은 verified(flag 뒤) 외 배정 없음,
      나머지 전부 Stage 2 행
- [ ] 등급별 최고 씨앗 분리 조회로 verified 마스킹 해소 (회귀 테스트:
      declared 점수 > example 점수인 규칙에서 verified 후보가 살아있음)
- [ ] verified 칠하기 feature flag (기본 off) + 개방 조건 문서화
- [ ] `src/AGENTS.md` Stage 1 절 갱신 (declared 오프 반영)
- [ ] 콜 증가 관측: prod `llm_calls` 상승분이 예상 배율(0.815→1.0)과
      부합하는지 배포 후 확인

## Blocked by

None — can start immediately.

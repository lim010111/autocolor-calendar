Status: ready-for-human
GitHub: #113

## What to build

운영자 로컬 3080 10GB GPU 를 eval 랩으로 써서, ADR-0004 가 확정한 임베딩 kNN
분류기에 쓸 임베딩 모델을 선정한다. Workers AI 에서 도는 후보 3종을 4개 언어
classification 데이터셋으로 비교하고, 2등급 신뢰 구조의 임계값을 1차 sweep
한다.

후보: `@cf/baai/bge-m3` (1024d) / `@cf/qwen/qwen3-embedding-0.6b` (1024d) /
`@cf/google/embeddinggemma-300m` (768d).

이 슬라이스는 `rule_seeds` pgvector 컬럼의 벡터 차원을 확정하므로 후속 모든
슬라이스의 선행조건이다. prod 추론은 Workers AI 이며 3080 은 측정 전용이다 —
서버리스 Worker 는 가정용 GPU 에 닿을 수 없다.

HITL 인 이유: 로컬 GPU 접근이 필요하고, 정확도·차원·임계값 사이의 트레이드
오프 판단이 들어간다.

## Acceptance criteria

- [ ] 후보 3종을 `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` 으로
      Stage 1 임베딩 kNN(이벤트 제목 vs 씨앗 max 코사인)에 대해 측정한 결과가
      ledger/report 로 남는다
- [ ] 등급별 임계값 `T_verified` / `T_declared` / `margin` 의 잠정값이
      sweep 으로 도출된다 (`T_verified < T_declared`)
- [ ] 선정 모델 1종과 그 벡터 차원(768 또는 1024)이 결정·기록된다
- [ ] 결정이 ADR(-0004 supersede 가 아니라 후속 측정 ADR, 0002 형식) 또는
      eval report 로 외부화되어 후속 슬라이스가 차원·모델을 참조할 수 있다

## Blocked by

None - can start immediately

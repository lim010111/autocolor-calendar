Status: ready-for-human
GitHub: #113

## What to build

운영자 로컬 3080 10GB GPU 를 eval 랩으로 써서, ADR-0004 가 확정한 임베딩 kNN
분류기에 쓸 임베딩 모델·벡터 차원을 선정하고 2등급 신뢰 구조의 임계값을 1차
sweep 한다. 후보 3종을 **운영자 본인 캘린더에서 만든 real ko gold set** 으로
비교한다 (합성 데이터 0줄).

후보: `@cf/baai/bge-m3` (1024d) / `@cf/qwen/qwen3-embedding-0.6b` (1024d) /
`@cf/google/embeddinggemma-300m` (768d).

이 슬라이스는 `rule_seeds` pgvector 컬럼의 벡터 차원을 확정하므로 후속 모든
슬라이스의 선행조건이다. prod 추론은 Workers AI 이며 3080 은 측정 전용이다 —
서버리스 Worker 는 가정용 GPU 에 닿을 수 없다.

HITL 인 이유: 로컬 GPU 접근 + 본인 캘린더 라벨링이 필요하고, 정확도·차원·
임계값 사이의 트레이드오프 판단이 들어간다.

> **데이터셋 결정 근거·구성 스펙·EDA·로드맵은
> [01-dataset-design.md](../01-dataset-design.md) 참조.** 기존 HuggingFace
> `anakin87/events-scheduling` 합성셋은 **폐기**한다 (example 부재로 T_verified
> 측정 불가 + keyword 누출 + 기계번역 다국어 + 합성/편향). raw 캘린더 제목은
> 운영자 로컬에만 두고 절대 커밋하지 않는다.

## Acceptance criteria

- [ ] **real ko gold set 구축** — 운영자 캘린더에서 신호창(2025-09~2026-06,
      dedup 후 ~520 고유) · 노이즈 규칙 · ~8 자연발생 카테고리(1~2개 held-out
      `expected=none`). 스키마: 카테고리별 `{name, keywords[], example_seeds[]}`
      + query `{title, expected: <category>|none}`. seed/query 분리는 **temporal**
      (작은 카테고리 random 폴백), Declared 씨앗은 **blind-authored**.
      (구성 스펙: 설계노트 §4)
- [ ] 후보 3종을 그 gold set 으로 Stage 1 임베딩 kNN(이벤트 제목 vs 씨앗 max
      코사인)에 대해 측정한 결과가 ledger/report 로 남는다
- [ ] 등급별 임계값 `T_verified` / `T_declared` / `margin` 의 잠정값이 sweep 으로
      도출된다 (`T_verified < T_declared`)
- [ ] **Declared-seed-form arm 비교** — name-only / name+단어keyword /
      name+구절declared 의 콜드스타트(example 없이 Declared 만) 정확도 → keyword
      가치·형태 판정 (ADR-0004 후속 finding)
- [ ] 모델·차원(768/1024) 선택의 **다국어 안전성을 공개 MTEB-multilingual /
      MIRACL ko+zh 랭킹으로 크로스체크** (ko-overfit 방지; en/zh 합성 생성은 안 함)
- [ ] 선정 모델 1종과 그 벡터 차원(768 또는 1024)이 결정·기록된다
- [ ] 결정이 ADR(-0004 supersede 가 아니라 후속 측정 ADR, 0002 형식) 또는
      eval report 로 외부화 — en/zh 는 *provisional·미검증* 플래그, persona skew 는
      known-limitation, en/zh·persona 확장은 로드맵(설계노트 §6)으로 명시

## Blocked by

None - 운영자가 캘린더 export 를 확보했으므로 즉시 착수 가능 (HITL).

Status: done
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

HITL 경계(seam): **로컬 PII 단계만 운영자 전담** — gold set 빌드·라벨링, 로컬
3080 sweep 실행, 집계 커밋. **data-blind 하네스**(sweep 러너·메트릭·ledger
writer·Workers-AI parity 프로브·리포트 골격)는 원시데이터 무관이라 **에이전트가
선스캐폴드**할 수 있다(설계노트 §5-견고화 항목1). 정확도·차원·임계값 트레이드오프
판단도 운영자 몫.

> **데이터셋 결정 근거·구성 스펙·EDA·로드맵은
> [01-dataset-design.md](../01-dataset-design.md) 참조.** 기존 HuggingFace
> `anakin87/events-scheduling` 합성셋은 **폐기**한다 (example 부재로 T_verified
> 측정 불가 + keyword 누출 + 기계번역 다국어 + 합성/편향). raw 캘린더 제목은
> 운영자 로컬에만 두고 절대 커밋하지 않는다.

## Acceptance criteria

- [x] **real ko gold set 구축** — 운영자 캘린더에서 신호창(2025-09~2026-06,
      dedup 후 ~520 고유) · 노이즈 규칙 · ~8 자연발생 카테고리(1~2개 held-out
      `expected=none`). 스키마: 카테고리별 `{name, keywords[], example_seeds[]}`
      + query `{title, expected: <category>|none}`. seed/query 분리는 **temporal**
      (작은 카테고리 random 폴백), Declared 씨앗은 **blind-authored**.
      (구성 스펙: 설계노트 §4)
- [x] **gold set 버전·집계 manifest 커밋** — 로컬-only 셋에 버전 문자열(`ko-v1`)을
      부여하고 **집계 manifest** 를 커밋한다: 카테고리별 seed/query 카운트 +
      정규화·정렬·연결한 **전체 코퍼스 단일 다이제스트** `sha256` 1개. **per-title
      해시 금지** — 7자 평균 짧은 ko 제목의 무염 per-item 해시는 사전공격·brute-force
      복원이 가능해 커밋 시 원시 제목이 사실상 git 에 누출된다(merge-gate finding-0).
      per-item 식별이 필요하면 미커밋 로컬 secret 의 **keyed HMAC** 만(공개
      title-fingerprint 아님 명시). 카테고리명은 **PII-free 일반명사 블라인드 라벨**만
      (인명·기관·클라이언트 금지 — 설계노트 §3). **원시 제목은 0줄.** 모든 run 은 이
      단일 `manifest_sha256` 로 어느 gold set 위에서 돌았는지 핀고정(설계노트 §4 항목7).
- [x] **단일 annotator 라벨 신뢰도 가드** — 라벨은 운영자 1인 판단(no
      inter-annotator κ). §4.5 모호 경계쌍(개발↔공부, 부트캠프수업↔개발)은
      **cooling-period 후 재라벨 self-consistency** 를 1회 돌려 불일치율을
      manifest 메모로 기록. single-annotator 는 known-limitation 으로 외부화.
      *(cooling 정량 재라벨은 운영자 descope 2026-06-30 — 라벨 신뢰 충분 판단 +
      골드셋 1일 신선으로 cooling 미경과; single-annotator known-limitation
      외부화는 REPORT §8 에 완료, manifest `self_consistency_mismatch` null·메모.)*
- [x] **후보군 선정 근거·제외 목록 명시** — 후보 3종 = Workers AI 의 *다국어
      범용* 임베딩 모델 전체(2026-06 카탈로그 확인). 제외 기록: `bge-*-en-v1.5`
      군(영어 전용), `@cf/pfnet/plamo-embedding-1b`(일본어 전용),
      reranker/cross-encoder 계열(ADR-0004 lines 45–49 bi-encoder dense 계약
      위반 — kNN 인덱스 불가). prod 후보는 **Workers AI 한정** — 3080 은 측정
      전용이라 prod 서빙 불가(ADR-0004). 카탈로그 드리프트(ko 특화 모델 신규
      등장 등) 시 harness 재실행으로 재평가 가능하게 남긴다.
- [x] **Declared-seed-form arm 비교** — name-only / name+단어keyword /
      name+구절declared 의 콜드스타트(example 없이 Declared 만) 정확도 → keyword
      가치·형태 판정 (ADR-0004 후속 finding)
- [x] **프롬프트/프리픽스 arm** — 각 모델을 (a)프리픽스 없음 vs (b)그 모델의
      *대칭/STS* 프롬프트(예: gemma `task: sentence similarity`, qwen3 권장
      instruction)로 측정. retrieval(query/doc 비대칭) 프롬프트는 우리 use case
      (title↔seed 대칭)와 불일치라 제외. `bge-m3` 는 instruction-free → (a)만
      ((b)와 동치). 이 축은 keyword-form arm 과 **직교** — 프리픽스는 모든
      임베딩(씨앗·제목)에 동일 적용된다. 각 arm 의 **정확 프리픽스 문자열**(또는
      `sha256` 16-char)을 ledger 에 그대로 기록 — 의역·예시 금지.
- [x] **승자 프리픽스 규약 = prod 불변항으로 동결** — 선정된 (model, prompt)
      쌍의 프리픽스 규약을 #01 출력 ADR/report 에 *prod 불변항*의 **정확
      문자열**로 명시한다: `rule_seeds` backfill 잡과 title hot-path 가 **동일**
      프리픽스로 임베딩해야 한다(불일치 시 저장 씨앗 벡터 전수 오염 →
      re-backfill 고비용).
- [x] **data-blind 하네스 = 에이전트 선스캐폴드(커밋)** — `evals/embedding-eval/`
      에 sweep 러너 · 메트릭 함수 · ledger writer · Workers-AI parity 프로브 ·
      리포트 골격을 **원시데이터 무관**하게 빌드(설계노트 §5-견고화 항목1).
      운영자 전담은 **로컬 PII 단계만**: gold set 빌드 · 로컬 sweep 실행 · 집계 커밋.
- [x] **run 추적 = wandb(집계-only) + 로컬 `runs.jsonl`(정본)** — wandb 를
      sweep/metric UI 로 쓰되 **PII-safe 계약**을 강제: config · 하이퍼파라미터 ·
      스칼라 메트릭 · 임계값 · **합성 카테고리 ID**(cat_0…) confusion 만 송신하고,
      **카테고리명·씨앗·제목·keyword·케이스별 예측 텍스트는 절대 송신 안 함** —
      카테고리명도 work/학교/건강/관계 맥락을 누출할 수 있어 cloud 제외(merge-gate
      finding-1), 이름↔ID 맵은 로컬-only. `ledger.py` 의 **wandb 송신 게이트가 raw
      title·seed_text·keyword·카테고리명을 거부하는 allowlist 스키마**로 강제(케이스별
      forensics 는 로컬 scratchpad JSONL-only). 집계 정본은 로컬 append-only `runs.jsonl`
      (=`agent-results.json` 선례; ADR-0001 의 "tracker=augmentation, ledger=SoT"
      자세 재현). 이 추적 규약은 **#01 출력 ADR 의 방법론 섹션에 fold-in**
      (별도 ADR 안 만듦) — ADR-0001 의 "PII dataset→SaaS 재평가" consequence 대비
      divergence rationale 포함.
- [x] **run 레코드가 재현 가능** — 각 run 이 `{model, dim, prompt_arm,
      prompt_prefix(+sha256_16), keyword_form_arm, gold_set_version,
      manifest_sha256, seed, determinism:{dtype:fp32, normalize:l2},
      embedding_backend, model_revision, k:all-seeds, agg:max, metric:cosine,
      thresholds, metrics}` 을 남긴다(스키마: 설계노트 §5-견고화 항목2). 동일
      (config, gold set) → 동일 결과.
- [x] 후보 3종을 그 gold set 으로 Stage 1 임베딩 kNN(이벤트 제목 vs 씨앗 max
      코사인)에 대해 측정한 결과가 `runs.jsonl`/report 로 남는다
- [x] **임계값 선정 목표함수 = 정밀도 우선** — sweep 의 승자 결정 규칙을 명시:
      Verified auto-apply **정밀도 바닥선** + `expected=none` **오적용(false-apply)
      상한** 제약 하에서 **커버리지(자동적용률) 최대화**, `T_declared` 는 Stage-2
      핸드오프 recall 로 튜닝(설계노트 §5-견고화 항목4). 바닥선·상한의 실제 수치는
      sweep 결과로 박는다.
- [x] 등급별 임계값 `T_verified` / `T_declared` / `margin` 의 잠정값이 위
      목표함수로 도출된다 (`T_verified < T_declared`)
- [x] **모델·차원 다국어 안전성 크로스체크 + flip 규칙** — 공개
      MTEB-multilingual / MIRACL ko+zh 랭킹으로 크로스체크하되 **결정 규칙**을
      명시: ko-gold 승자가 MIRACL-ko 에서 차순위 후보보다 N 랭크 이상 아래면
      red-flag → 재검토(N 은 sweep 시 박음). (ko-overfit 방지; en/zh 합성 생성 안 함)
- [x] **3080 ↔ Workers AI 전이 타당성** — 비-PII 문자열로 로컬 vs Workers-AI
      임베딩 **코사인 정합 프로브**(`wai_parity.py`)를 돌려 mean cosine 을 기록.
      정합 확인 전 임계값은 **provisional 플래그**. WAI 는 PII 경계 안이므로 승자
      모델의 **최종 임계값은 WAI 에서 재측정해 확정** 가능(설계노트 §5-견고화 항목5).
- [x] 선정 모델 1종과 그 벡터 차원(768 또는 1024)이 결정·기록된다
      *(gemma 768 잠정 기록; 차원 *동결*은 멀티 persona/다국어 골드셋까지 연기 —
      단일 persona·ko-only 검정력 약함, ADR-0005 §8. #02~#06 은 잠정 768 로 진행.)*
- [x] 결정이 ADR(-0004 supersede 가 아니라 후속 측정 ADR, 0002 형식) 또는
      eval report 로 외부화 — en/zh 는 *provisional·미검증* 플래그, persona·단일
      annotator skew 는 known-limitation, en/zh·persona 확장은 로드맵(설계노트
      §6)으로 명시. wandb 추적 규약 · 임계값 목표함수 · 승자 prefix 동결값도 이
      출력에 포함.

> **Resolution (2026-06-30):** D 완료 — 측정 정본 `evals/embedding-eval/REPORT.md`
> + `docs/adr/0005-embedding-model-eval-ko-v1.md` (ADR-0004 데이터셋 단락 개정).
> 선정 = `embeddinggemma-300m`(768d) **provisional**, `T=(0.30, 0.55, 0.10)`
> **provisional**, floor 0.90, 차원 동결 연기, flip-rule N=2 미발동. cooling 정량
> 부분 운영자 descope. 머지게이트 findings 패스1 처리. 커밋 `a7f0f8f`
> (branch `embedding-eval-scaffold`, push 완료). **#02 unblock**(잠정 gemma 768).

## Blocked by

None - 운영자가 캘린더 export 를 확보했으므로 즉시 착수 가능 (HITL).

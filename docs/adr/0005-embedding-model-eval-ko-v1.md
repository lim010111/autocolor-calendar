# ADR-0005: 임베딩 모델 = `embeddinggemma-300m`(768d) 잠정 선정 — ko-v1 골드셋 측정

- Status: Accepted (2026-06-30)
- Context: ADR-0004 가 Stage 1 을 substring 에서 임베딩 kNN 으로 교체하며 모델·벡터
  차원 선정을 **eval 과제로 위임**했다(`rule_seeds.embedding vector(N)` 의 N 이 여기
  묶임 → #02~#06 선행조건). 본 ADR 은 그 측정의 결정을 외부화한다 — **ADR-0004
  supersede 가 아니라 ADR-0004 가 가리키는 후속 측정 ADR**(0002 형식).

  측정은 운영자 로컬 3080 을 eval 랩으로, **운영자 본인 캘린더의 real ko 골드셋
  `ko-v1`**(합성 0줄, en/zh 이연)으로 후보 3종을 비교했다. 측정 정본은
  `evals/embedding-eval/REPORT.md`(집계-only, PII-free) + 로컬 `_local/runs.jsonl`
  (13,320 sweep 레코드). prod 추론은 Workers AI 이고 3080 은 측정 전용이다.

  **골드셋(`ko-v1`, `manifest_sha256` `d9bf2ddd…49fcae2`):** 11 rule 카테고리 + 1
  held-out, 311 query(none 13), example_seed 296, declared_seed 156. temporal split,
  blind-authored declared seeds. 단일 운영자·단일 persona(학생/개발 편향, `cat_0`=공부
  가 query 의 47%)·ko-only.

  **측정 요약** (후보 3종, precision-first 목표함수: verified_precision ≥ floor AND
  none_false_apply ≤ 0.05 하 coverage 최대; 콜드스타트 ex=0):

  | Model | dim | macro-recall @fl0.90 | cold-start 최적 (name_phrase) | MIRACL-ko (rank/3) |
  |-------|-----|---|---|---|
  | `@cf/baai/bge-m3` | 1024 | 0.353 | cov 0.119 | 0.701 (1st) |
  | `@cf/qwen/qwen3-embedding-0.6b` | 1024 | 0.450 | cov 0.309 (ex=1) | 0.620 (3rd) |
  | **`@cf/google/embeddinggemma-300m`** | **768** | **0.553** | **cov 0.341** | **0.661 (2nd)** |

  bge-m3 은 micro·macro 양쪽에서 dominated. qwen3 의 micro 우위는 전적으로 `cat_0`
  catch-all 에서 나오며 macro 는 gemma 아래 — 그 격차(~0.05)는 꼬리 카테고리(n=2~9)
  단일 쿼리 노이즈 안이다. gemma 가 macro·콜드스타트 Declared 경로에서 최강이고,
  MTEB-multilingual mean 순위(qwen3 > gemma > bge-m3)가 MIRACL-ko 순위(bge-m3 > gemma >
  qwen3)를 뒤집는 ko-overfit 함정에서 안전한 쪽(flip 규칙 N=2 미발동, REPORT §5)에 선다.

- Decision: 임베딩 모델을 **`@cf/google/embeddinggemma-300m`(768d)로 잠정 선정**하고,
  등급별 임계값을 **`T_verified=0.30` / `T_declared=0.55` / `margin=0.10`(provisional)**
  로 잠정 핀한다. 승자 arm = `sts` / `name_phrase`(콜드스타트). 상세·근거는
  `evals/embedding-eval/REPORT.md`(이 ADR 의 측정 정본).

  - **승자 프리픽스 = prod 불변항(AC #7).** arm `sts`, 정확 문자열
    `task: sentence similarity | query: `(`sha256_16=793518b01601c92e`). `rule_seeds`
    backfill 잡과 title hot-path 가 **동일 프리픽스**로 임베딩해야 한다 — 불일치 시 저장
    씨앗 벡터 전수 오염(재-backfill 고비용). `transformers`/런타임 버전도 양쪽 동일하게
    핀할 것(embeddinggemma 의 bidirectional-attention 버전 민감성, REPORT §5).

  - **벡터 차원 동결 = 연기(deferred), 가장 중요한 결정.** 768 을 **잠정 기본값**으로
    두되 `vector(768)` 을 *동결하지 않는다*. 차원 동결은 전 테넌트·전 언어에 묶이는
    비가역 마이그레이션 결정인데, 본 측정의 검정력이 약하다 — **단일 persona·ko-only·
    `cat_0` 47% 지배·꼬리 카테고리 n=2~9·none 13개**. gemma↔qwen3 macro 격차(~0.05)는
    단일 쿼리 노이즈 안이라 이 데이터로 768 vs 1024 를 박으면 노이즈 위 비가역 결정이
    된다. **#02~#06 은 잠정 gemma(768)로 진행**하고, 동결은 멀티 persona/다국어 골드셋이
    생길 때 한다(REPORT §8).

  - **임계값 목표함수 = 정밀도 우선, floor 0.90.** 보수안 0.95(cov 0.167/prec 0.981)
    대신 0.90(cov 0.341/prec 0.906)을 택했다 — Stage-1 의 존재 이유가 LLM 비용 절감인데
    0.95 의 16.7% 콜드스타트 커버리지는 대부분을 LLM 으로 넘겨 그 명분을 깎는다. 0.90 의
    높은 오적용률은 (a) 정정이 Verified 씨앗으로 Stage-1 에 전파돼 재발을 막고(ADR-0004
    가 substring 폐기로 산 학습성), (b) 임계값이 어차피 provisional 이라 수용 가능. **단,
    그 정정 루프는 OAuth 게이트의 Instant Feedback(#05)이라 pre-OAuth 콜드스타트 창에선
    in-product 정정이 없다**(REPORT §3·§8).

  - **다국어 안전성 + flip 규칙 N=2.** 공개 MTEB-multilingual / MIRACL ko+zh 대조,
    "ko-gold 승자가 MIRACL-ko 에서 차순위보다 ≥2 랭크 아래면 red-flag" → **미발동**(gemma
    2nd, 차순위 qwen3 3rd 보다 위). REPORT §5.

  - **추적 방법론 fold-in(별도 ADR 안 만듦).** wandb = eval-only·**집계-only PII 계약**
    (config·스칼라·임계값·합성 `cat_N` confusion 만; 카테고리명·씨앗·제목·keyword·raw
    prefix 거부 — `ledger.assert_wandb_safe` allowlist 강제). 집계 정본 = 로컬 append-only
    `runs.jsonl`. ADR-0001 "tracker=augmentation, ledger=SoT" 재현; "PII dataset → SaaS
    재평가" consequence 대비 divergence = 골드셋은 PII 지만 합성 ID 위 집계만 경계를
    넘으므로 SaaS-송신 우려가 구조적으로 회피됨(REPORT §7).

- Consequences:
  - **#02~#06 unblock(잠정).** `rule_seeds` 스키마는 gemma(768)로 진행한다. 차원이
    *동결이 아니라 잠정*이므로, 멀티 persona/다국어 골드셋 측정이 1024 를 가리키면 스키마
    마이그레이션이 필요하다 — 그 비용을 알고 진행한다(줄이는 게 늘리는 것보다 싸다는
    가정 하 768 기본).
  - **임계값은 provisional.** (a) 차원 동결 연기, (b) `sts` 프리픽스의 Workers-AI parity
    미확정(parity 프로브는 빈 prefix 로 측정 — mean cosine 1.0 은 고신뢰 전이지 경계
    비트일치 보증 아님). 승자 모델의 최종 임계값을 **WAI 에서 `sts` 프리픽스로 재측정**해
    provisional 을 해제한다(REPORT §6).
  - **en/zh 는 provisional·미검증.** ko 잠정값 차용. en/zh real 데이터는 OAuth 통과 후
    동의자 기여 경로로만 확보(합성 생성 안 함, REPORT §8 로드맵).
  - **known-limitations(REPORT §8):** 단일 annotator(self-consistency 불일치율 = **미측정**,
    cooling 재라벨 운영자 descope 2026-06-30 — single-annotator 는 known-limitation 으로
    외부화) · persona skew · 수용된 하향 클립(Tv0.30/Td0.55 grid MIN) · **약한 none
    게이트**(0/13 → 실오적용율 95% 상한 ~20-25%, 두 자릿수도 통과 가능).
  - **재현성(AC #10):** 측정은 `git_sha=b081d97` + `config.py` 확장 grid(dirty-intentional,
    커밋)에서 수행. 실제 swept grid·source ledger 파일명·분석 스크립트(`scripts/`)를
    REPORT provenance 에 박아 레포만으로 승자 숫자가 복원되게 했다.

- References:
  - `evals/embedding-eval/REPORT.md` — 본 ADR 의 측정 정본(집계·frontier·flip·parity·한계).
  - `evals/embedding-eval/manifest.json` — `ko-v1` 골드셋 집계 매니페스트(단일 digest,
    원시 제목 0).
  - `evals/embedding-eval/scripts/{analyze,verify,percat,push_wandb}.py` — frontier·무결성
    분석(감사 재현).
  - `evals/embedding-eval/src/embedding_eval/config.py` — 후보·프리픽스·확장 grid 상수.
  - `docs/adr/0004-embedding-classifier.md` — 이 측정을 위임한 상위 ADR(데이터셋 단락
    개정 대상 — 아래 "ADR-0004 데이터셋 단락 개정" 참조).
  - `docs/adr/0001-langfuse-eval-only.md` — tracker=augmentation/ledger=SoT 선례.
  - `.scratch/embedding-classifier/01-dataset-design.md` · `.../issues/01-*.md` — 설계
    정본 + AC.

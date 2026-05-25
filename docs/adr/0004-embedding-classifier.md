# ADR-0004: Stage 1 substring 키워드 매칭 폐기 — 임베딩 kNN 분류기로 교체

- Status: Accepted (2026-05-20)
- Context: 현행 분류기는 2단계 파이프라인이다 — Stage 1 substring 키워드
  매칭 (`src/services/classifier.ts`, 카테고리 keyword 의 대소문자 무시
  부분문자열 포함 검사) → rule-miss 시 Stage 2 LLM fallback
  (`src/services/llmClassifier.ts`, gpt-5.4-nano). `classifierChain.ts:52-53`
  에서 Stage 1 hit 은 LLM 을 영영 호출하지 않고 short-circuit 한다.

  이 구조의 결함은 사용자 시나리오로 확정됐다. keyword `"스타벅스"` (스타벅스
  근무 일정을 색칠하려는 의도) 가 `"여자친구와 스타벅스에서 만나기"` 라는
  무관한 일정 제목에 substring 적중한다. `classifierChain.ts:52-53` 의
  short-circuit 때문에 그 일정은 LLM 도, 사용자가 나중에 줄 수 있는 어떤
  정정 신호도 영영 보지 못한다. **Stage 1 substring 오탐은 구제 불가능**이다 —
  사용자가 정정을 examples 형태로 쌓아도 examples 는 Stage 2 에 도달한
  이벤트에만 영향을 주는데, 오탐 이벤트는 Stage 1 에서 이미 배정돼 Stage 2 에
  닿지 못한다. 키워드를 좁게 공학하라는 가이드(아이디어 1)로 완화할 수는
  있으나, 그것은 사용자에게 substring 매처의 약점을 떠넘기는 것이다.

  배경에는 캘린더 사용 방식이 사용자마다 천차만별이라는 더 큰 문제의식이
  있다. `grill-with-docs` 세션에서 4개 개인화 아이디어(Rule 작성 가이드 /
  Instant Feedback / 과거 일정 기반 자동 Rule 생성 / per-user 최적화 프롬프트)
  를 grill 한 결과, 그 아이디어들이 모두 "Stage 1 을 substring 에서 의미
  매칭으로 바꾼다"는 단일 결정으로 수렴했다. 정정이 Stage 1 까지 학습
  전파되려면 Stage 1 자체가 의미 표현을 다뤄야 하기 때문이다.

  이 ADR 은 `docs/architecture-guidelines.md` 의 **"Hybrid Classification
  Engine (Rule-based … keyword substring match → LLM Fallback)"** 불변항과
  `src/CLAUDE.md` §5 (특히 §5.1 rule-based matching 의 substring 계약) 을
  **대체**한다. ADR-0002 (LLM 분류기 모델 = gpt-5.4-nano) 는 **대체하지
  않는다** — Stage 2 LLM fallback 은 존속하며 그 모델 결정은 그대로 유효하다.

- Decision: Stage 1 의 substring 키워드 매칭을 **완전히 폐기**하고 임베딩
  기반 kNN 유사도 매칭으로 교체한다. 새 파이프라인은 **Stage 1 = 임베딩
  kNN, Stage 2 = LLM fallback** 이다.

  - **Rule 의 의미 표현 = 씨앗 벡터 N개.** 한 Rule 의 의미는 그 Rule 의
    *씨앗* — 이름 1개 + keyword 0~N개 + example 0~N개 — 을 **각각 따로
    임베딩한 벡터 N개**로 표현한다. centroid 평균이나 텍스트 concat 은
    금지한다: 한 Rule 이 multi-modal 일 수 있어서다 ("오픈/미들/마감" 처럼
    의미가 서로 먼 씨앗들의 평균은 어느 씨앗과도 가깝지 않다). 이벤트 제목은
    벡터 1개로 임베딩하고, **score = 그 Rule 의 씨앗 벡터 N개에 대한 최대
    코사인 유사도** (kNN, k 는 씨앗 풀 전체).

  - **bi-encoder dense 코사인.** dense 벡터의 코사인 유사도를 쓴다. SPLADE
    등 sparse/lexical 표현은 기각한다 — (1) 다국어 커버리지가 빈약하고,
    (2) lexical 편향은 우리가 폐기하는 바로 그 실패 모드(표면 토큰 일치)
    이며, (3) Workers AI 에 네이티브 경로가 없다. hybrid dense+sparse 는
    *나중 개선 후보*로만 남긴다 (이 ADR 의 범위 밖).

  - **신뢰 등급 2개.** 씨앗은 증거의 강도에 따라 두 등급으로 나뉜다:
    - **Verified** = example. 사용자가 Instant Feedback 으로 "이 일정은 이
      Rule 이었다"고 확정한 실제 과거 제목 — 강한 증거.
    - **Declared** = name + keyword. Rule 생성 시점의 선언/추측 — 약한 증거.
      name 과 keyword 는 *씨앗으로서*는 동일 취급하되, *DB 필드로서*는 별개다
      (name 은 1개·필수·unique·UI 라벨, keyword 는 0~N개·선택).
    - 등급별 임계값: Verified 씨앗 적중은 `T_verified` (낮은 바), Declared
      씨앗 적중은 `T_declared` (높은 바), `T_verified < T_declared`.
      keyword 는 Stage 1 에 남되 높은 바를 통과해야 적중한다 — 콜드 스타트
      (example 이 아직 없는 신규 Rule) 신호로 필요하기 때문이다.
    - 결정 로직: `score(best) < T_low` → Stage 2 LLM fallback. `best -
      second < margin` → 모호 → Stage 2 LLM fallback (Stage 1 은 추측하지
      않는다). 그 외 → best Rule 배정.
    - **v1 은 2등급 *구조*만 확정한다.** 실제 숫자
      (`T_verified` / `T_declared` / `margin`) 는 4개 언어 데이터셋
      (`evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json`) 으로 sweep 해
      정한다.

  - **임베딩 모델 = eval 과제, 잠정 기본값 = `@cf/google/embeddinggemma-300m`.**
    모델은 **Cloudflare Workers AI 에서 도는 것 중에서만** 선택한다 — 이벤트
    제목이 Cloudflare 플랫폼 밖으로 나가지 않아야 `src/CLAUDE.md` §5.3
    redaction 의무 / "Calendar event payloads must never be logged" 계약을
    건드리지 않기 때문이다. OpenAI text-embedding-3 / Gemini Embedding API 는
    외부 전송이라 탈락한다 (EmbeddingGemma 는 Google 제 모델이지만 Workers AI
    경유로 호출하면 합격 — 중요한 것은 모델 제작자가 아니라 *호출 목적지*다).
    - 후보: `@cf/baai/bge-m3` (1024d) / `@cf/qwen/qwen3-embedding-0.6b`
      (1024d) / `@cf/google/embeddinggemma-300m` (768d).
    - 선정 방법: 운영자 로컬 3080 10GB GPU 를 **eval 랩**으로 써서 4개 언어
      `classification.json` 으로 세 후보를 비교하고 등급별 임계값을 sweep
      한다. **prod 추론은 Workers AI** — 서버리스 Worker 는 가정용 GPU 에
      닿을 수 없으므로 3080 은 측정 전용이다.
    - 이 eval 은 `rule_seeds` 마이그레이션의 **선행조건**이다: pgvector
      컬럼의 벡터 차원이 선정 모델에 묶이기 때문 (768 vs 1024).
    - 설계/스키마 작업의 잠정 기본값은 `embeddinggemma-300m` (use case
      정합 + 768차원 경량). eval 결과가 뒤집으면 교체한다.
    - 비용은 논점이 아니다: Workers AI 무료 한도 (~10k neurons/day ≈ 9.3M
      토큰/day) 대비 캘린더 제목은 이벤트당 ~15 토큰.

  - **저장소 = Supabase pgvector.** 신규 테이블
    `rule_seeds(id, rule_id FK, user_id, seed_type enum('name'|'keyword'
    |'example'), seed_text, embedding vector(N), created_at)` — 씨앗당
    1행, HNSW 인덱스, `user_id` 테넌트 스코프 (`src/CLAUDE.md` "Tenant
    isolation"). 씨앗 벡터는 durable, 이벤트 제목 벡터는 transient
    (sync run 당 배치 임베딩, 저장 안 함). 마이그레이션은 기존 사용자의
    name·keyword 를 일괄 backfill 임베딩하는 1회성 잡을 포함한다.

  - **examples 생애주기.** Rule 당 example 캡 = **10개**, **FIFO eviction**
    (오래된 것부터 밀려나 staleness 자동 처리). Instant Feedback 시 다른
    Rule 에 같은 제목 example 이 있으면 제거한다 — **last-write-wins**,
    한 제목은 한 Rule 의 example 만 된다 (CONTEXT.md "Relationships" 참조).

  - **범위 — 이 ADR 은 결정의 외부화이며 production 코드 변경 0 줄이다.**
    구현은 `/to-issues` 가 분해하는 tracer-bullet 수직 슬라이스로 들어간다.
    name·keyword 씨앗 (둘 다 비-PII) 만으로 Stage 1 임베딩 인프라를 빌드·
    배포할 수 있다. examples 씨앗(=캘린더 제목의 최초 durable 저장)을 켜는
    것은 개인정보처리방침/동의 표면 변경을 동반하므로 **OAuth 검수 통과
    이후 출시 게이트**다 (2026-05-14 재제출분 — 통과 전까지 oauthScopes /
    consent / redirect / GAS deploy URL 동결).

- Consequences:
  - **불변항 대체.** `docs/architecture-guidelines.md` 의 "Hybrid
    Classification Engine" bullet 과 `src/CLAUDE.md` §5 (§5.1 substring
    계약 포함) 은 이 ADR 과 lockstep 으로 갱신해야 한다. `docs/adr/
    README.md` 의 Drift 정책에 따라 live invariant 인 `src/CLAUDE.md` 가
    우위이며, 구현 PR 이 두 문서를 동시에 갱신할 책임을 진다.
  - **§5.1 의 substring 정당화가 무효화된다.** `classifier.ts` 의 "한국어
    형태론 때문에 word-boundary 매칭이 불안정하므로 substring 이 의도된
    기본값" 이라는 주석 근거는 임베딩 체제에서 더 이상 성립하지 않는다 —
    의미 매칭이 형태론·다국어를 모두 흡수한다.
  - **새 외부 의존성: Workers AI 임베딩 바인딩.** prod hot path 에 Workers
    AI `env.AI.run(...)` 호출이 추가된다. Cloudflare 플랫폼 내부 호출이라
    PII 경계는 안전하지만, sync 경로의 새 latency·실패 지점이다 — 임베딩
    호출 실패 시의 거동(Stage 2 로 강등 vs no_match)은 구현 이슈가 정의한다.
  - **`matchedKeyword` 의 의미 변화.** `Classification.matchedKeyword`
    (`classifier.ts:22-25`) 는 substring 적중 키워드를 사이드바에 노출하던
    필드다. 임베딩 체제에서는 "어떤 키워드 부분문자열이 맞았다"가 아니라
    "어떤 씨앗이 가장 가까웠다"로 의미가 바뀐다 — preview/사이드바 카피도
    함께 재설계 대상이다.
  - **ADR-0002 는 유효.** Stage 2 LLM fallback 은 존속하므로 LLM 모델
    (gpt-5.4-nano), §5.3 매칭 규칙, prompt eval-gate 3-gate 는 그대로다.
    단 Stage 2 에 도달하는 트래픽 분포는 바뀐다 (substring 오탐이 사라지고,
    Stage 1 임계값 미달/모호 케이스가 새로 유입). 임베딩 분류기 출시 후
    LLM leg 의 baseline 정확도는 4개 언어 데이터셋으로 재측정해야 한다.
  - **콜드 스타트 거동.** example 이 0개인 신규 Rule 은 Declared 씨앗
    (name + keyword) 만으로 분류되며 `T_declared` 라는 높은 바를 넘어야
    한다. 이는 의도된 보수성이다 — 약한 증거로 추측하느니 Stage 2 LLM 으로
    넘긴다. 사용자가 Instant Feedback 으로 example 을 쌓을수록 Verified
    씨앗이 늘어 Stage 1 적중률이 올라간다.
  - **DB 레거시 명칭.** 테이블/타입은 여전히 `categories`/`Category` 지만
    (CONTEXT.md "Flagged ambiguities"), 신규 테이블은 도메인 용어를 따라
    `rule_seeds` 로 명명한다 — 신규 코드/문서는 `Rule` 을 쓴다.
  - **임베딩 모델 eval 미완료 = 스키마 차원 미확정.** `rule_seeds.embedding`
    의 `vector(N)` 차원은 모델 선정 eval 이 끝나야 못 박힌다. 그전까지
    스키마 작업은 `embeddinggemma-300m` 의 768 을 잠정값으로 진행한다.

- References:
  - `CONTEXT.md` (리포 루트) — 도메인 용어 사전 (Rule / Keyword / Example /
    Classifier / Instant Feedback). 이 ADR 의 용어 출처.
  - `docs/architecture-guidelines.md` "Hybrid Classification Engine" —
    이 ADR 로 대체 → lockstep 갱신 대상.
  - `src/CLAUDE.md` §5 (§5.1 rule-based matching / §5.3 LLM semantic
    matching policy) — 이 ADR 로 대체 → lockstep 갱신 대상.
  - `src/services/classifier.ts` — 폐기 대상 Stage 1 substring 매처.
  - `src/services/classifierChain.ts:52-53` — short-circuit 결함 지점.
  - `src/services/llmClassifier.ts` — 존속하는 Stage 2 LLM fallback.
  - `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` — 임베딩 모델
    선정 + 임계값 sweep 데이터셋.
  - `prompts/dataset-builder/label-clusters.system.v1.md` — 아이디어 3
    (과거 일정 기반 자동 Rule 생성) 재사용 인프라.
  - `docs/adr/0002-llm-classifier-model.md` — Stage 2 모델 결정
    (이 ADR 이 대체하지 않음).
  - `docs/adr/README.md` — ADR 템플릿 + Drift 정책.

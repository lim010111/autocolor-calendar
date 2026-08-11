# ADR-0008: 분류 아키텍처 판정 — declared 배정 오프 + LLM 단독 2표 재확인 + 판정 캐시 + 규칙 description

- Status: Accepted (2026-08-11) — 게이트 3건 전부 통과:
  ① hard 슬라이스 비열화 확인 (2026-08-11 채점: 436건에서 권고안
  C+2표 utility +0.353/오적용 16.5% vs 현행 A +0.044/29.2% — 어려운
  케이스일수록 격차 확대; 골드 라벨 재검토는 선택 잔여).
  ② 3자 앙상블 리뷰(codex·agy·claude, 2026-08-11 —
  `.scratch/arch-judgment/third-party-review-2026-08-11/`) findings
  반영 — 본 판이 그 개정판.
  ③ wave-4 측정 (2026-08-11, ko-11 3조건×2런): `keywords:[]` 가
  `[name]` 폴백 대비 +0.015 우세 → min(0) 완화 안전 실측; 병합 단일
  필드는 양립 대비 단발 −0.015/2표 −0.019 일관 열세 → **병합 비채택,
  keyword·description 필드 분리 유지 확정**.

- Context:

  2단계 분류기(Stage 1 임베딩 kNN → Stage 2 gpt-5.4-nano)는 ADR-0004/0005가
  잠정 상수(`T=(0.30, 0.55, 0.10)`)로 출시했고, 아키텍처 후보들(임계 조정,
  게이트, 재확인, 캐시)의 우열은 실측 없이 열려 있었다. prod 오분류 4건이
  관측되며 판정이 필요해졌다.

  판정에 앞서 목적함수를 제품 판단으로 확정했다: **오적용(틀린 색을
  칠함)은 미배정(안 칠함)의 3배 손실**이다. 안 칠한 일정은 사용자가
  수동으로 칠하면 되지만, 틀리게 칠한 일정은 §5.4 소유권 마커가 잡은
  뒤 재적용까지 하므로 신뢰 손상이 크다. 채점: 케이스당 정답 +1 /
  미배정 0 / 오적용 −2의 평균(= utility). 전부 미배정하는 정책이 0점.

  측정(2026-08-08~11, `.scratch/arch-judgment/2026-08-08-verdict-draft.md`):
  운영자 실데이터 ko 골드셋 311제목 × 8조건(언어·씨앗 풍부도·규칙 수)
  × 기본 2~3런 = 조건셋당 2,488케이스. LLM 콜 테이블 위에서 모든 정책
  후보를 산술로 재채점(콜 재사용)하고, 임베딩 후보는 prod 모델
  (embeddinggemma-300m, prod 프리픽스)의 코사인 그리드로 합성했다.
  실제 제목·픽스처는 gitignore된 `_local/` 에만 두고 Langfuse 는 빈 키로
  차단(레포·클라우드 data-blind).

  핵심 실측:

  1. **declared 임베딩 배정은 순손해.** prod 임계(0.55/0.10)에서 배정률
     18.5%, 배정 중 오적용 17.2% — 같은 케이스를 LLM에 넘기는 것보다
     일관되게 나쁘다 (utility 체인 +0.454 vs LLM 단독 +0.488, 런 편차
     밴드 밖). 임계 상향·마진 조정·씨앗 인지·설명 코사인 veto 게이트
     등 어떤 변형도 "전부 LLM행"을 넘지 못했다 — 모든 게이트의 통과
     부분집합에서 LLM이 임베딩 배정을 이겼다.
  2. **재확인 2표는 오적용을 선택적으로 걸러낸다.** LLM 1차 판정이
     "칠하자"일 때만 확인 콜을 보내 일치해야 칠하면, 비결정성(런 간
     flip 9.4%)이 오답 쪽에 몰려 있어 오적용 10.5→8.6%로 내려간다.
     3표는 이득 대비 콜 비용이 나빠 2표 채택.
  3. **반복 재분류는 래칫 열화를 만든다.** §5.4 마커 하에서 같은
     제목을 매 sync 재판정하면 오적용이 누적된다(k=2 재판정 채점
     12.3%). 단 이 채점은 **비관적 상한**이다 — "한 번이라도 오답이면
     최종 오답"으로 세며(`score.py` ratchet 주석), 런타임은 후속 hit이
     기존 색을 덮어쓸 수 있어 자동 교정도 일부 일어난다. 캐시는 후속
     오답 유입을 막는 동시에 **최초 오답의 자동 교정 경로도 차단**하므로,
     Instant Feedback 정정에 의한 무효화와 TTL 이 캐시 스펙의 필수
     요소다(아래 결정 4).
  4. **규칙 description 은 측정 전체에서 최대 지렛대.** 사용자가 쓴
     한 줄 설명을 LLM 프롬프트 카테고리 JSON에 넣으면 전 후보 +0.05,
     상승분 전부 미배정→정답 전환(오적용 불변), flip 도 6.2%로 감소.
     효과가 가장 큰 곳은 키워드가 없는 온보딩 상태(+0.077)다. 같은
     설명을 임베딩 씨앗으로 쓰는 건 +0.006~0.015로 반려 — 문장형
     씨앗은 짧은 제목과의 코사인 분포가 압축·중첩돼 분별력이 없다.

  채택 전 검증 2건: 요소 존재론 리뷰(2렌즈 — name/keyword/example/
  description 중 폐지 가능 요소 없음, `.scratch/arch-judgment/
  2026-08-11-element-ontology-review.md`)와 3자 앙상블 적대 리뷰
  (codex gpt-5.6-sol·agy gemini-3.6-flash·claude opus, 평결 원문
  `.scratch/arch-judgment/third-party-review-2026-08-11/`). 세 평가자
  공통 지적(조기 Accepted·캐시 키 과소명세·쿼터 산술 표기·min(0)
  과대주장·verified 마스킹 방치·통계 한계)은 본 개정판에 반영했다.

- Decision:

  4개 묶음을 채택한다. 최종 자세 실측: **utility +0.566 / 오적용 8.6% /
  정답 73.9%** (현행 +0.454 / 11.8% 대비 — 8조건 등가중 평균이며 prod
  기대값이 아님, 아래 측정 한계 참조).

  1. **규칙 description 필드 도입 — LLM 프롬프트 전용.** `categories`
     에 선택 컬럼 추가, `buildPrompt` 카테고리 JSON `{name, keywords,
     description, examples}` 로 전송(경로는 이미 존재:
     `src/services/llmClassifier.ts` 조건부 spread). 임베딩 씨앗
     (`rule_seeds`)으로는 넣지 않는다. 선택 입력이므로 미입력 사용자는
     기존 자세로 동작 — 점진 채택.
  2. **declared 임베딩 배정 오프.** name/keyword 씨앗의 코사인이 높다는
     이유만으로 칠하는 경로(`T_DECLARED` 승자 배정)를 끈다. Stage 1 은
     verified(example) 경로와 향후 후보 축소 용도로 남는다. 상수·씨앗
     인프라는 유지(가역).
  3. **칠하기 전 재확인 2표.** LLM 1차 판정이 none 이면 즉시 수용,
     칠하기면 확인 콜 1회 — 두 판정이 일치할 때만 칠한다.
  4. **판정 캐시.** 재분류 반복을 캐시로 응답한다. 키는 제목만으로
     부족하다 — prod 프롬프트는 이벤트 `summary`+`description`+`location`
     3필드를 전송하므로(`buildPrompt` 화이트리스트), 키는 **분류 입력
     전체를 canonicalize 한 해시**여야 한다: redacted 이벤트 3필드 ×
     규칙 입력(이름·키워드·규칙 description·전송 examples) × 프롬프트
     버전 × 판정 정책 버전(2표 도입 등 정책 변경도 무효화 대상).
     원문 제목을 durable 키/행으로 저장하지 않는다(§12 표면 재생성
     방지 — Consequences 참조). 무효화는 규칙 단위 targeted(해당 규칙
     관련 항목만) + Instant Feedback 정정 시 해당 항목 즉시 + TTL.

  **배포 순서 제약: 캐시 → 2표.** 관측 resync 스파이크는 116콜/일 =
  현행 배율 0.815콜/케이스 기준 ~142케이스이며, 권고 자세 1.54콜/
  케이스로 환산하면 ~219콜로 per-user 일일 쿼터 200을 초과한다(증가의
  주인은 2표 자체보다 declared 오프의 전면 LLM행). 캐시는 재분류
  스파이크를 흡수하지만 **cold resync(첫 동기화·전면 무효화 직후)에는
  적중이 없으므로 쿼터를 보장하지 못한다** — 대량 첫 동기화는 캐시와
  무관하게 쿼터 설계(resync 경로 상향/예외 또는 일 단위 분산)가 별도로
  필요하다. 특히 description 편집이 무효화를 유발하므로, description
  기능 출시 직후의 재분류 물결을 배포 계획에 넣을 것.

  **verified(example) 경로는 휴면 조건부 유지 — 단 실측 전 자동 활성화
  금지.** prod example 씨앗 0개(§12 저장 개시 2026-08-28)라 현재
  무발화. 유지 근거: §12 인터록상 example 이 OpenAI 전송 없이 분류에
  작용하는 유일한 채널(v8 프롬프트 examples 미전송) + Instant Feedback
  즉시 반영 UX + 캐시가 못 잡는 변형 제목 커버. 그러나 3자 리뷰가
  공통 지적한 두 결함이 미해결이다: ① **마스킹** — Stage 1 풀이
  `DISTINCT ON (rule_id)` 로 규칙당 최고 씨앗 1개만 뽑아 등급을
  정하므로, declared 씨앗이 example 을 눌러 verified 가 영구 침묵할
  수 있다(등급별 최고 씨앗 분리 조회로 수정 필요). ② **무게이트
  칠하기** — 2표 재확인은 LLM 판정에만 걸리므로, 미측정 bar 0.30 의
  verified 배정이 유일한 무검증 페인트 경로가 된다. 따라서 verified
  칠하기는 §12 저장 개시 후에도 **feature flag 로 막아 두고**, 마스킹
  수정 + 실측(재판정 트리거 2) 통과 후에만 연다.

- Consequences:

  - **비용**: 콜당 ~3K 입력/12 출력 토큰. 권고 자세 1.54콜/케이스로
    현행 대비 ~1.9배, prod 실물량 기준 사용자당 월 ~$0.10 → ~$0.21 —
    달러 비용은 판정 요인이 아니었다. 실제 제약은 per-user 쿼터이며
    배포 순서로 해소한다.
  - **description 채택 비용**: `categories` 스키마 + 규칙 편집기 UI
    (nl#04 합류) + §5.3 프롬프트 eval-gate(시스템 프롬프트에 필드
    문서화 여부 포함) + 설명 텍스트의 OpenAI 전송 고지(기존 키워드와
    동일 채널). 온보딩 화면에는 선택 텍스트 입력을 하나만 노출한다
    (keyword 는 collapsible 고급 옵션 — ec#04 패턴).
  - **판정 캐시의 프라이버시 제약**: 캐시 키/행에 원문 제목을 durable
    저장하면 §12 동의 표면을 재생성하고 철회 purge 가 닿지 않는 두
    번째 사본이 생긴다(`sanitizePromptSummary` 가 막은 구멍의 재발
    경로). 캐시 설계는 해시 키 또는 §12 검토를 거쳐야 한다.
  - **`keywords.min(1)` → min(0) 완화 실측 성립 (wave-4)**: `keywords:
    []` 가 `[name]` 폴백보다 소폭 우세(+0.2283 vs +0.2133, desc 추가
    시에도 동일 방향)로, 이름을 키워드로 위장하는 GAS 폴백은 무익이
    실측됐다. 오적용 소폭 상승(+1.2%p)은 2표가 흡수. 완화 시 GAS 폴백
    제거와 Worker Zod 완화의 배포 순서 조율 필요(새 GAS + 구 Worker
    조합이 400).
  - **verified 마스킹**: Stage 1 풀이 규칙당 최고 씨앗 1개라 declared
    오프 후에도 keyword/name 씨앗이 example 씨앗을 눌러 verified 배정을
    막을 수 있다. 씨앗 행 거취는 verified 실측 때 일괄 판정.
  - **기각된 대안**(사후 추적용): 임계 상향 스윕(B1, 0.55~0.90 전
    구간 열세), 마진 스윕(9조합 전패), 밴드/카운트/합의/증거 게이트
    (D1/B2/D2/E — 억제 계열은 desc 반영 후에도 열세), 3표(+0.523,
    콜 ~2.0), 설명 코사인 veto 게이트(모든 통과 부분집합에서 LLM 열세
    — 비용 절감이 필요해지면 d≥0.60 이 최선의 완충이라는 기록만 남김),
    description 의 임베딩 씨앗화(반려).

  **측정 한계** (3자 리뷰 반영 — 수치 해석 시 항상 전제할 것):

  - 단일 사용자(운영자) 골드셋 311제목이며, 규칙 description 11개와 en
    이름 번역도 같은 사람이 작성했다(저자 상관). 카테고리 분포도 편중.
  - 헤드라인 +0.566 은 8조건(희소·교차언어 포함) 등가중 평균이지 prod
    분포 기대값이 아니다. prod 재채점(트리거 1)과 직접 비교 금지.
  - 불확실성 추정은 런 간 편차뿐(부트스트랩·CI 없음). 8조건은 동일
    311제목의 상관 반복이라 유효 표본은 케이스 수보다 작다 — desc 의
    +0.05 는 보수적으로도 유의하나, declared 오프의 마진(+0.034)은
    표집 불확실성에 상대적으로 민감하다(트리거 1 이 이를 재검증).
  - 이벤트 summary 만 채워 측정 — prod 프롬프트가 이미 전송하는 이벤트
    description/location 필드는 빈 값이었고, `categories[].description`
    과 `event.description` 의 동명 필드 공존도 미실행 경로다.
  - 측정된 description 효과는 v8 이 필드를 문서화하지 않은 상태의
    값이다. 배포 프롬프트에서 문서화를 추가하면 §5.3 eval-gate 로
    재측정한다(문서화 arm vs 비문서화 arm).

  **재판정 트리거** (하나라도 발화하면 같은 하네스로 재채점):

  1. 출시 후 사용자 N≥10 또는 `llm_calls` 5,000행 축적 — 임계 상수와
     슬라이스 분포를 prod 로 재검증(단일 사용자 데이터 한계). prod
     분포 가중 재채점 + 기존 4언어 데이터셋 교차검증 포함.
  2. §12 저장 개시 후 example 씨앗 축적 — 마스킹 수정 뒤 verified
     레그(T=0.30) 배정 품질을 같은 케이스 LLM 답과 짝비교. 통과 전
     verified 칠하기 flag 를 열지 않는다.
  3. ~~keyword↔description 병합·`keywords:[]` 미측정~~ — **wave-4 로
     해소** (2026-08-11): min(0) 완화 안전, 병합 비채택. 재발화 조건:
     description 채택률·작성 품질의 prod 분포가 확인되면(트리거 1 과
     함께) 병합 재검토 가능하나 현 증거는 분리 유지.
  4. eval 이 summary 외 이벤트 필드(description/location)를 채워
     측정하게 될 때 — 현 수치는 summary-only 픽스처 기준.

  **기각·미탐색 대안 기록** (3자 리뷰 제안 — 후속 검토 후보): logprobs/
  신뢰도 기반 선택적 재확인(2표는 확신도를 재표집으로 사는 가장 비싼
  방법 — 모델 지원 여부 확인 필요), 확인 콜의 축소 프롬프트(후보 2개만
  재질의), 저확신 케이스를 칠하지 않고 Instant Feedback 으로 넘기는
  human-gate, ec#06 히스토리 기반 description 초안 자동 생성(선택
  입력 채택률 문제의 보완), prod 분포 가중 채점.

- References:
  - 판정 기록: `.scratch/arch-judgment/2026-08-08-verdict-draft.md`
    (1~3파 실측 전체), `.scratch/arch-judgment/
    2026-08-11-element-ontology-review.md` (요소 존재론 리뷰)
  - 채점 하네스: `evals/arch-judgment/` (build_fixtures.py ·
    build_cosine_grid.py · score*.py — 재현 커맨드는 판정 기록 말미)
  - 코드 경로: `src/services/stage1.ts` (declared/verified 등급),
    `src/config/embedding.ts` (T 상수), `src/services/llmClassifier.ts`
    (buildPrompt · examples 인터록 · sanitizePromptSummary)
  - 선행 ADR: ADR-0004(2단계 분류기) · ADR-0005(임베딩 모델·임계 잠정
    출시 — 본 ADR 이 declared 배정 부분을 변경) · ADR-0007(§12 동의
    모델, verified 유지 근거)

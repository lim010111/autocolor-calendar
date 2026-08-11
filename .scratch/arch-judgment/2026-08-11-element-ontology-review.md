# 규칙 텍스트 요소 존재론 리뷰 — name / keyword / example / description

2026-08-11. 아키텍처 판정(4개 묶음) 채택 전 사전 검증: 요소 4종이 정말
개별 존재로 필요한가, 통합 가능한가. 독립 서브에이전트 2개(증거 렌즈 +
구조 렌즈)로 리뷰, 핵심 숫자는 오케스트레이터가 재계산 검증.

## 결론 한 줄

**폐지할 요소는 없다. 4종은 병렬 4요소가 아니라 "3역할 구조"다** —
① 정체성 name, ② 전송형 LLM 신호 keyword+description, ③ 비전송 verified
신호 example. 실질 병합 후보는 keyword↔description 한 쌍뿐이며, 그 병합
변형은 미측정이라 지금은 양립이 정답.

## 요소별 판정 (두 렌즈 합의)

- **name — 재분류: 분류 신호가 아니라 정체성 요소.** LLM 응답의 폐쇄
  enum 키(`mapCategoryNameToRuleRef` 엄격 일치) + Google 라벨 read-only
  캐시(ADR-0006)라 제거·전송 제외 불가. 임베딩 신호로서의 역할(min 조건
  = keywords=[name])은 declared 오프 판정과 함께 사실상 소멸. name 씨앗
  행(`seed_type='name'`) 제거는 가능하나 판정 확정 전엔 가역성 손해 —
  verified 실측 때 일괄 재판정.
- **keyword — 유지.** 폐지 시 utility −0.072 실측 손실(매치드 조건,
  노이즈 밴드의 ~5배). description과 부분 중복(서로의 델타를 절반 이상
  깎음)이나 어느 쪽도 부분집합이 아님 — 둘 다 있을 때 +0.5707로 최고.
- **description — 도입 (기존 판정 유지).** 매치드 2×2 (C llm-only, ko-11+ko-3,
  n=622/셀, 오케스트레이터 재계산 일치):

  | utility | desc 없음 | desc 있음 | Δ |
  |---|---|---|---|
  | name만 (min) | +0.4223 | +0.4992 | +0.0769 |
  | name+keyword (full) | +0.5520 | +0.5707 | +0.0188 |

  desc 가치의 최대 지점이 정확히 온보딩 상태(키워드 없음) — 신규 사용자
  기본 상태. keyword 있어도 +0.019 잔여 이득(런 편차 3배+).
- **example — 휴면 조건부 유지 (기존 판정 유지 + 구조 근거 보강).**
  수명주기가 모든 축에서 별개(시스템 포착+사용자 확정 / §12 동의 /
  철회 purge / OpenAI 미전송 / verified 등급) — ADR-0007이 설계로 강제한
  차이라 병합 금지. 판정 캐시로 대체도 금지: 캐시 키에 원문 제목을
  durable 저장하는 순간 §12 동의 표면을 재생성하고 철회 purge가 닿지
  않는 두 번째 사본이 생긴다(해시 키 우회는 즉시반영 UI·변형 제목
  커버를 잃어 대체 실패). 캐시와 example은 대체재가 아니라 보완재.

## 구조 렌즈의 신규 발견 (판정·ADR에 반영할 것)

1. **판정 캐시 프라이버시 항목 신설**: 캐시 키/행에 원문 제목을 durable
   저장하는지가 §12 검토 대상 — `sanitizePromptSummary`가 막은 구멍의
   재발 경로. 채택 시 ADR에 명기.
2. **keywords.min(1) 미결의 답이 바뀐다**: description 도입 시 GAS
   `[name]` 폴백(= 최악의 min 씨앗 상태를 만드는 장본인)의 존재 이유가
   소멸 → min(0) 완화 쪽으로 기움. "keyword 또는 description 중 하나
   필수" 제약은 불필요(LLM-only에서 name 단독 동작 실측). 완화 시 GAS
   폴백 제거와 Worker Zod 완화의 배포 순서 조율 필요(새 GAS + 구 Worker
   조합이 400).
3. **verified 마스킹**: stage1 풀이 규칙당 최고 씨앗 1개(`DISTINCT ON`)라
   declared 오프 후에도 keyword/name 씨앗이 같은 규칙의 example 씨앗을
   눌러 verified 배정을 막을 수 있다. keyword/name 씨앗 행의 거취는
   verified 레그 실측(저장 개시 후, 재판정 트리거 5)과 묶어서 판정.
4. **UX**: ec#04가 keyword를 이미 collapsible 선택 입력으로 강등 —
   description 추가는 충돌 없음. 단 선택 텍스트 입력 2개 병렬 노출은
   혼란 → 온보딩 화면에는 하나만 노출(어느 쪽 승격은 사용자 결정).

## 미측정 (후속 실측 후보)

1. keyword+description 단일 자유텍스트 병합 변형 — 조건 자체가 없어
   손익 미지수. 하네스 재사용으로 wave-4 측정 가능.
2. example verified 레그(T=0.30) 짝비교 — 2026-08-28 저장 개시 후.

## 원 리포트

서브에이전트 전문은 세션 로그에만 있음(요지는 위에 흡수). 증거 렌즈:
wave1~3 detail.json 실측 + 가설 4개 판정. 구조 렌즈: 수명주기 표 +
통합 시나리오 3종 파급 분석.

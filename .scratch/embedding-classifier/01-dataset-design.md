# embedding-classifier #01 — 데이터셋 결정 & ko gold-set 설계

> grill-with-docs 산출물 (2026-06-26). #01 이 참조하는 설계 근거.
> raw 캘린더 제목/인명은 **이 문서에 없음** — 운영자 로컬 scratchpad 에만 존재(미커밋).
> 여기엔 집계·일반명사만 싣는다.

## 1. 배경 — 왜 기존 데이터셋을 버리나

기존 #01 은 `anakin87/events-scheduling`(HF) 을 임베딩·클러스터링·라벨링·번역해
`evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` 을 만들어 썼다. 부적합 4가지:

1. **구조적 결함 — T_verified 를 못 뽑는다.** 케이스의 "씨앗"이 `categories[].{name,keywords}`
   뿐(=Declared 등급만), `example` 필드가 없다(192 케이스 전부 base/paraphrase). 그런데 #01 은
   `T_verified < T_declared` sweep 을 요구한다. **realism 이전에 데이터 *형상* 자체가 불가능.**
2. **keyword 누출.** 클러스터 keyword 를 gpt-5.5 가 멤버 제목에서 역추출 → Declared 매칭 점수
   인위적 부풀림(낙관 편향).
3. **출처/현실성.** 50개 합성 스케줄링-퍼즐 제목, tech/엔터 편향, ko/zh 는 영어 기계번역
   (원어민 캘린더 작성 방식 아님). silhouette 0.03(k=10) — 사실상 군집 없음.
4. **summary-only**(description/location 없음) — prod 분류기는 셋 다 읽음.

## 2. 결정 요약 (Q1–Q6)

- **Q1 — 목적/바.** "모델 랭킹(a) / 임계값 캘리브레이션(b)" 분리안은 폐기. **현실에 가까운
  단일 데이터셋**으로 일관되게 간다.
- **Q2/Q3 — 소스/접근.** 운영자 본인 Google Calendar `.ics` export → 로컬 scratchpad 파싱.
  prod 자세와 일치(데이터가 Worker 밖, 로컬에만). raw 는 절대 커밋 안 함.
- **Q4 — persona.** 운영자 1인 진짜 분포를 **그대로** v1 으로. dev/부트캠프 편향은
  *known-limitation 으로 문서화*(리밸런싱=합성 재유입이라 거부).
- **Q5 — 언어.** v1 의 *측정*은 **real ko 단독**(합성 0줄). 모델·차원 선택의 다국어 안전성은
  공개 **MTEB-multilingual / MIRACL ko+zh** 로 크로스체크. en/zh **실데이터는 로드맵으로 이연**
  (네이티브 동의자 export / post-OAuth opt-in). 출시 시 en/zh 는 ko 잠정 임계값을
  빌려 쓰되 *provisional·미검증* 플래그.
- **Q6 — 구성.** 아래 §4.

## 3. EDA 요약 (운영자 캘린더, 집계만)

소스: 주 캘린더 `.ics` (Birthdays.ics 3건=자동 생일 캘린더, 제외). 총 **1308 VEVENT**.

- **형상:** 종일 22.9% / 시간지정 77.1%, RRULE 0.8%(반복은 대부분 *수기 개별입력*),
  ATTENDEE 1·CANCELLED 0(회의초대/Gmail-자동 노이즈 거의 없음 = 순수 개인 캘린더),
  제목 길이 mean 9.0 / median **7자**(매우 짧음).
- **시간적 비정상성:** 실사용 **2025-02~2026-06** 집중. 2025-09 에 월 112건으로 점프
  (부트캠프 시작) → 2025-09~2026-05 월 69~168건(습관기). **2027~2099 는 매년 1건씩
  =미래 투영 생일반복=노이즈.**
- **스타일 드리프트(실재):** 2025 emoji 4.8%/digit 25%/종일 27% → 2026 emoji 0%/digit 11%/
  종일 12%. (temporal split 의 robustness 테스트 근거.)
- **언어:** ko 93.9% / en-latin 4.7% / other 1.3%, **ko+latin 혼용 15.6%**(개발어 코드스위칭).
  **zh ≈ 0** → en/zh 는 이 캘린더에서 안 나옴(이연 근거).
- **신호창(2025-09~2026-06):** 886 이벤트 → **고유 제목 520개**(정규화), 81%가 singleton
  (표면형 다양성 풍부). **실효 N ≈ 520 진짜 ko 제목**(anakin87 파생 192보다 큼).
- **자연발생 카테고리 후보 ~8개:** 식사(끼니) / 부트캠프 수업(스크럼·피어세션·과제·N강) /
  개발·프로젝트 / 공부·자기계발 / 운동·생활루틴 / 이동·외출 / 약속·사교 / 알바·근무.
  → 상위 절반이 학습/개발 = **persona 편향**(Q4 known-limitation).
- **노이즈 규칙(버리지 말고 보고 후 적용):** ①미래 투영 생일반복(≥2027 종일) 제외
  ②`생일 축하합니다!`류 자동 생일 제외 ③빈 SUMMARY(41) 제외 ④종일(299)은 *분리* —
  공휴일/생일=노이즈, 중간고사·휴강·약속 등 실제=유지 ⑤정확중복 습관제목은 노이즈 아님
  (진짜 반복) 단 eval 에선 dedup/대표1개.

> 상세 raw-파생 통계는 운영자 로컬 `scratchpad/eda-summary.md` (미커밋).

## 4. gold-set 구성 스펙

**스키마(신규):** 카테고리마다 `{name, keywords[], example_seeds[]}`,
query case 는 `{title, expected: <category>|none}`. **`example_seeds[]` 가 핵심 추가**
(기존 결함 #1 의 수정 — Verified 등급을 데이터에 실재시킴).

1. **dedup-before-split.** 신호창 886 → 고유 520 으로 접고 시작. 안 접으면 씨앗=query 정확일치
   → cosine 1.0 → 암기로 풀려 T_verified 가짜로 낮아짐.
2. **temporal split.** 카테고리별 *이른* 제목 = `example_seeds`(="확정된 과거"),
   *늦은* 제목 = query. prod 인과(과거 확정 → 미래 분류) 모사 + 스타일 드리프트 직격 테스트.
   **작은 카테고리는 random 폴백.**
3. **blind-authored Declared 씨앗.** `name`+`keywords` 는 제목 리스트 안 보고 기억으로 작성
   (실유저가 Rule 만들 때처럼). anakin87 의 역추출 누출 차단.
4. **held-out 카테고리 → `expected=none` 음성.** ~8개 중 1~2개(예: 알바/근무)는 Rule 로
   안 만들고 그 제목들을 음성으로 → T_low(Stage 2 양보)·오탐 가드 측정.
5. **within-user 구조.** 남은 카테고리를 *한 유저의 Rule 셋*으로 → 헷갈리는 쌍
   (개발↔공부, 부트캠프수업↔개발)이 `margin` 임계값에 압력.
6. **keyword-form arm (sweep 축 추가).** 콜드스타트(example 없이 Declared 만) 정확도를 세 형태로
   비교 — **arm1 name-only / arm2 name+단어 keyword / arm3 name+구절 declared**. keyword 가
   name 대비 값을 버는지·번다면 어떤 형태인지 데이터로 판정. name-only≈name+keyword 면
   keyword 폐기(Simplicity). → ADR-0004 후속 finding.

## 5. 측정/산출

- **후보군 = Workers AI 다국어 범용 임베딩 전체.** 모델은 ADR-0004 의 PII 경계
  계약상 Workers AI 에서 도는 것만 가능하다(이벤트 제목이 Cloudflare 밖으로 안 나감;
  3080 은 측정 전용이라 prod 서빙 불가). 2026-06 카탈로그 확인 결과 다국어 범용
  임베딩은 정확히 후보 3종뿐이다. **제외:** `bge-*-en-v1.5`(영어 전용),
  `@cf/pfnet/plamo-embedding-1b`(일본어 전용, 2026-04 신규), reranker/cross-encoder
  계열(ADR-0004 bi-encoder dense 계약 — kNN 인덱스 불가). ko 특화 모델이 카탈로그에
  새로 뜨면 harness 재실행으로 재평가.
- **프롬프트/프리픽스 arm.** qwen3-embedding·embeddinggemma 는 instruction-tuned
  (task-prompt 프리픽스 민감), bge-m3 는 instruction-free. 과제는 title↔seed *대칭*
  (STS)이므로 retrieval(query/doc 비대칭) 프롬프트가 아니라 **대칭/STS 프롬프트**로
  (a)없음 vs (b)모델별 STS 프롬프트를 비교한다. 승자 프리픽스 규약은 **prod 불변항** —
  `rule_seeds` backfill 과 title hot-path 가 동일 프리픽스를 써야 함(불일치 시 저장
  씨앗 벡터 전수 오염). keyword-form arm 과 직교.
- 후보 3종(`@cf/baai/bge-m3` 1024d / `@cf/qwen/qwen3-embedding-0.6b` 1024d /
  `@cf/google/embeddinggemma-300m` 768d)을 real ko gold set 으로 임베딩 kNN(이벤트 제목 vs
  씨앗 max 코사인) 측정 → ledger/report.
- 등급별 임계값 `T_verified`/`T_declared`/`margin` 잠정값 sweep (`T_verified < T_declared`).
- 모델·차원(768/1024) 다국어 안전성 = MTEB/MIRACL ko+zh 크로스체크.
- 선정 모델 1종 + 벡터 차원 결정·기록 → ADR(0002형식 후속 측정) 또는 eval report.

## 6. known-limitations + 로드맵 (추적·점증 개선)

두 external-validity 갭은 **blocker 가 아니라 추적 대상**:

- **persona 확장**(무엇을 적나) + **작성 방식**(어떻게 적나) —
  - 단계0(지금): 운영자 1인. 단계1(v2): **동의한 지인 N명 오프라인 export+로컬 라벨**
    (두 갭 동시 전진, OAuth 무관, 명시 동의 필요). 단계2(post-OAuth): 제품 내 opt-in
    익명 기여(스케일; examples-씨앗 #05/#06 과 *동일 게이트*에 묶임). 보강: prod **집계 지표만**
    (제목 텍스트 미저장, "payload 미저장" 계약 준수). 보조: 네이티브 LLM 스타일변형 생성
    (robustness 프로브, 언제든).
- **en/zh** 도 같은 로드맵 메커니즘으로 진짜 데이터를 받는다(합성 생성 안 함).

## 7. open follow-ups

- ADR-0004 후속: keyword-form arm 결과 → keyword 존속/폐기/형태(단어 vs 구절) finding.
- #01 출력 ADR(0002형식) 또는 eval report 가 후속 슬라이스(차원·모델)의 참조점.

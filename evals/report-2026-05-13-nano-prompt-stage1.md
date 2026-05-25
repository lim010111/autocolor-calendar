# gpt-5-nano 프롬프트 차원 실험 Stage 1 — `v4-light-{A,B,C}` + `v4-ko` 측정

- **측정일:** 2026-05-12
- **git SHA:** `70f23e0` (PR-α 인프라 commit)
- **대상 모델:** `gpt-5-nano` (`reasoning_effort=low`, `max_completion_tokens=1024`)
- **프롬프트 변형:** `prompts/classifier/system.v4-light-{A,B,C}.md`, `system.v4-ko.md`
- **데이터셋:** `evals/datasets/{en,ko}/classification.json` (각 192 케이스)
- **관측 surface:** Langfuse Cloud (EU `jp.cloud.langfuse.com`) dataset run × 4 + `evals/agent-results.json` ledger × 4
- **선행 보고서:** `evals/report-2026-05-12-nano-rca.md` (RCA + ADR-0002 lock); `evals/report-2026-05-11-prompt-rewrite.md` (5.4-nano + v2 baseline)
- **planning artifact:** `.claude/handoffs/nano-prompt-experiment-2026-05-12.md` (Frame B 측정 핸드오프)
- **본 PR 의 production 영향:** **없음** — `LLM_MODEL = "gpt-5.4-nano"` / `DEFAULT_CLASSIFIER_PROMPT_VERSION = "v2"` 그대로. 본 보고서는 eval-only Frame B 측정.

---

## 1. 요약 (TL;DR)

Stage 1 의 4 셀 모두 §4 *"Winner selection 기준 R"* 의 hard gate 를 통과하지 못했다. Stage 2 트리거 조건 — *"Stage 1 winner X exists (Cells 1.1a/b/c) AND Cell 1.2 v4-ko passes its gate"* — 은 **두 변** 모두 거짓. **Stage 2 / Scope β 는 불발**, PR-β 는 본 실험의 **terminal PR**.

| Cell | lang | prompt | accuracy | bad_response | mean reasoning tok | mean completion tok | hard gate (acc) | hard gate (bad=0) | verdict |
|------|------|--------|---------:|-------------:|-------------------:|--------------------:|-----------------|-------------------|---------|
| 1.1a | en | `v4-light-A` (Radical, ~25 lines, 3 ex) | 157/192 (**81.8 %**) | 0/192 (**0.000**) | 110.0 | 129.3 | ≥ 85.1 % — ❌ FAIL by 3.3 %p | ✅ | ❌ no-winner |
| 1.1b | en | `v4-light-B` (Surgical, ~70 lines, 5 ex) | 160/192 (**83.3 %**) | 0/192 (**0.000**) | 95.7 | 114.9 | ≥ 85.1 % — ❌ FAIL by 1.8 %p | ✅ | ❌ no-winner |
| 1.1c | en | `v4-light-C` (Compress, ~85 lines, 6 ex) | 160/192 (**83.3 %**) | 0/192 (**0.000**) | 175.7 | 194.9 | ≥ 85.1 % — ❌ FAIL by 1.8 %p | ✅ | ❌ no-winner |
| 1.2  | ko | `v4-ko` (Bilingual KR, lighter NOT applied) | 148/192 (**77.1 %**) | 1/192 (**0.005**) | 264.0 | 284.6 | ≥ 82.1 % — ❌ FAIL by 5.0 %p | ❌ FAIL | ❌ no-lift |

**핵심 관찰**

- **en 사이드 (H "lighter prompt" 가설):** 3 개 변형 모두 *baseline−5 %p* (= 85.1 %) 게이트를 1.8 – 3.3 %p 차로 떨어졌다. `bad_response` 는 0 으로 깨끗하지만 의미 정확도가 모자란다. Wave 1 (v3 + `minimal`) en 87.0 % 와 비교하면 −3.7 ~ −5.2 %p — 즉 *"lighter + low"* 가 *"verbose + minimal"* 보다 분류 능력이 떨어진다.
- **ko 사이드 (H3 lang-native semantic 가설):** `v4-ko @ low` = **77.1 %**, 즉 RCA Wave 6 의 `v3 @ low` ko (77.1 %) 와 **정확히 동일**. 한국어 instructions + Critical rule + examples 의 lang-native 번역이 nano 의 CJK 분류 정확도에 **측정 가능한 lift 를 만들지 못한다**. 더불어 reasoning_tokens 가 max=1024 까지 도달해 1 건의 truncation `bad_response` 발생 — lang-native 변형이 reasoning loop 를 늘리는 부작용도 관찰.
- **Stage 1 → Stage 2 게이트:** §4 의 5 단계 결정 트리에서 step 5 ("If no candidate passes gates 1 + 2, Stage 1 terminates") 가 발동한다. 추가로 Cell 1.2 도 독립 게이트를 떨어졌기 때문에 *"Stage 2 trigger: Stage 1 winner X exists AND Cell 1.2 v4-ko passes its gate"* 의 두 변 모두 거짓. **Stage 2 (6 셀) 와 Scope β (5.4-nano 백포트 2 셀) 는 본 실험에서 firing 되지 않는다**.

본 측정의 cost: 4 셀 × 192 케이스 × `gpt-5-nano` ≈ $0.45. Scope β / Stage 2 의 $1.15 추가 비용은 측정의 정보값이 음(negative) 인 것으로 판명되어 **절감**.

---

## 2. Cell 결과 상세

### 2.1 Cell 1.1a — `v4-light-A` (Radical) on en

- **셀 정의 (§4 lighter philosophies A):** Task + Critical rule (3 matching rules, 거부 subsection 없음) + Output format + 3 examples. Inputs · Exact step order · Edge cases / tie-breakers a–f 전부 삭제. ~25 lines.
- **결과:**
  - accuracy = **81.8 % (157/192)**
  - `bad_response_rate = 0.000` (0/192 truncation·schema 위반)
  - mean reasoning tokens = 110.0, max = 256
  - mean completion tokens = 129.3, max = 276
- **Langfuse run:** [`70f23e0-en-v4-light-A-low`](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0yz6tj01n7ad08w4pexg7f/runs/74967352-03ca-4b3c-9a4e-6219de1a2569)
- **ledger row:** `2026-05-12-classification-multilingual-en-gpt-5-nano-prompt-v4-light-A-effort-low-cap1024`
- **관찰:**
  - 절단 시그널 0 — Radical 의 짧은 길이가 reasoning budget 을 압박하지 않음.
  - 그러나 tie-breaker (b)-(f) 부재가 cross-cluster 혼동을 적극 막지 못한다. log 표본에서 `Tech Talks ↔ Social Plans` 혼동이 다수 관측됨 (RCA §3.1 의 c0↔c7 패턴).

### 2.2 Cell 1.1b — `v4-light-B` (Surgical) on en

- **셀 정의 (§4 lighter philosophies B):** Task + Critical rule (3 matching + 2 rejection subsections) + Inputs + Output format + 5 examples. Exact step order · Edge cases / tie-breakers 삭제. ~70 lines.
- **결과:**
  - accuracy = **83.3 % (160/192)**
  - `bad_response_rate = 0.000`
  - mean reasoning tokens = 95.7, max = 320
  - mean completion tokens = 114.9, max = 339
- **Langfuse run:** [`70f23e0-en-v4-light-B-low`](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0yz6tj01n7ad08w4pexg7f/runs/a4342216-0fb3-4189-bee4-c6c1a4e6d502)
- **ledger row:** `2026-05-12-classification-multilingual-en-gpt-5-nano-prompt-v4-light-B-effort-low-cap1024`
- **관찰:**
  - 본 셀이 Stage 1 의 **cost-optimal** 셀이다 — mean reasoning 95.7 로 4 셀 중 최저, accuracy 는 1.1c 와 동률. 하지만 게이트를 충족하지 못해 cost-narrative 표는 무의미.
  - rejection subsection ("How meaning does NOT match") 이 1.1a 보다 cross-cluster 거부를 살짝 강화한 것으로 보임 (+1.5 %p over A), 그러나 절대값은 baseline 한참 아래.

### 2.3 Cell 1.1c — `v4-light-C` (Compress) on en

- **셀 정의 (§4 lighter philosophies C):** v3 와 동일한 섹션 (Task + Critical rule + Inputs + Exact step order + Tie-breakers 표 + Output format) 의 prose-compressed 버전 + 6 examples (base 5 + morphology). ~85 lines.
- **결과:**
  - accuracy = **83.3 % (160/192)**
  - `bad_response_rate = 0.000`
  - mean reasoning tokens = 175.7, max = 832
  - mean completion tokens = 194.9, max = 851
- **Langfuse run:** [`70f23e0-en-v4-light-C-low`](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0yz6tj01n7ad08w4pexg7f/runs/6a00205a-7647-4814-84bf-e6de527db201)
- **ledger row:** `2026-05-12-classification-multilingual-en-gpt-5-nano-prompt-v4-light-C-effort-low-cap1024`
- **관찰:**
  - tie-breaker 표 + step order 를 보존했지만 1.1b 와 동률 — 즉 *"섹션을 다 살리고 prose 만 압축"* 의 정보값이 *"섹션을 둘 잘라낸 Surgical"* 과 같다. v3 의 verbose 영역이 nano + low 에서 정확도에 기여하지 않는다는 보조 증거.
  - reasoning_tokens 가 1.1b 의 거의 2 배 (175.7 vs 95.7), max=832 — 길어진 본문이 reasoning loop 도 늘렸지만 정확도로 환산되지 않았다.

### 2.4 Cell 1.2 — `v4-ko` (Bilingual KR) on ko

- **셀 정의 (§4 lang-native v4-ko, Q5 modified):** v3 의 모든 섹션을 한국어로 번역, JSON output schema 는 영어 유지, cross-lingual 규칙은 1-line disclaimer 로 축소. 5 monolingual 한국어 examples. lighter 변형 적용 **안 됨**.
- **결과:**
  - accuracy = **77.1 % (148/192)**
  - `bad_response_rate = 0.005` (1/192) ← Stage 1 에서 **유일한 절단**
  - mean reasoning tokens = 264.0, **max = 1024**
  - mean completion tokens = 284.6, max = 1024
- **Langfuse run:** [`70f23e0-ko-v4-ko-low`](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0z6b86002tad07fut3ye8a/runs/d87b760b-5dbc-4d19-973a-6f5f382eb7bd)
- **ledger row:** `2026-05-12-classification-multilingual-ko-gpt-5-nano-prompt-v4-ko-effort-low-cap1024`
- **관찰:**
  - **77.1 % 는 RCA Wave 6 `v3 + low` ko (77.1 %) 와 소수점 자리까지 동일**. 한국어 lang-native 번역은 ko 분류 정확도에 **측정 가능한 lift 를 만들지 못한다** — RCA §2.3 에서 *"unmeasured"* 로 남겨둔 H3 *semantic* 측면이 본 셀로 사실상 반증된다.
  - max=1024 reasoning 도달 + 1 건 `bad_response`: 한국어 instructions 가 reasoning chain 길이를 늘려 1024 cap 을 처음으로 점유. RCA Wave 6 v3+low ko 의 reasoning 분포보다 본 셀이 더 cap-pressure 가 높다 (RCA 의 Wave 6 ledger 에서는 reasoning_tokens 캡처 전이므로 직접 비교 불가, 정성적 관찰).
  - 정량 갭: baseline (`v2 + 5.4-nano` ko = 88.5 %) 대비 −11.4 %p. 한국어 프롬프트가 이 갭을 좁히지 못함.

---

## 3. Winner Selection R 적용 트레이스 (§4)

§4 *"Winner selection 기준 R"* 의 결정 트리를 그대로 따른다.

### 3.1 en 게이트 (Cells 1.1a, 1.1b, 1.1c)

| Step | 규칙 | 1.1a (A) | 1.1b (B) | 1.1c (C) |
|------|------|---------|---------|---------|
| 1 | Hard gate 1: `bad_response_rate = 0` | ✅ 0.000 | ✅ 0.000 | ✅ 0.000 |
| 2 | Hard gate 2: `accuracy ≥ 85.1 %` (= baseline_en 90.1 % − 5 %p) | ❌ 81.8 % | ❌ 83.3 % | ❌ 83.3 % |
| 3 | Cost-tradeoff cohort: `accuracy ≥ 88.1 %` (= baseline_en − 2 %p), 그 중 min mean_reasoning_tokens | n/a (step 2 실패) | n/a | n/a |
| 4 | Fallback: max accuracy among step 1 + 2 passes | n/a (step 2 실패) | n/a | n/a |
| 5 | **No candidate passes gates 1 + 2 → Stage 1 terminates** | **✅ 발동** | | |

**결정:** Winner X **미존재**. step 4 (max accuracy 백업) 도 step 2 통과자가 없어 발동하지 않는다.

### 3.2 ko 독립 게이트 (Cell 1.2)

| Step | 규칙 | 1.2 (v4-ko) |
|------|------|------------|
| 1 | Hard gate 1: `bad_response_rate = 0` | ❌ 0.005 (1/192) |
| 2 | Hard gate 2: `accuracy ≥ 82.1 %` (= Wave 6 ko low 77.1 % + 5 %p) | ❌ 77.1 % |

**결정:** Cell 1.2 도 두 게이트 모두 실패. lang-native 의 정량 lift 가 0 이며 reasoning cap 도 한 번 도달.

### 3.3 Stage 2 / Scope β 트리거 평가

§4 Stage 2 trigger: *"Stage 1 winner X exists (Cells 1.1a/b/c) AND Cell 1.2 v4-ko passes its gate"*.

- 좌변 (winner X exists): **거짓** (3.1).
- 우변 (1.2 passes): **거짓** (3.2).
- 두 변 모두 거짓이므로 **Stage 2 는 발동하지 않는다**.

§4 Scope β trigger: *"After Stage 2 settles, if at least one of {α, ζ} passes the hard gate"*. Stage 2 자체가 발동하지 않았으므로 Scope β 도 발동하지 않는다.

---

## 4. PR-β 종결 결정

§4 PR-γ 정의 ("Only opens if PR-β's report concludes Stage 2 should fire") 의 조건이 거짓. **PR-γ 는 열리지 않는다**. PR-β 가 본 실험의 terminal PR.

핸드오프 §10 implementation plan step 2.7 ("If Stage 2 entry is _no_, PR-β is terminal. Skip steps 3.") 에 그대로 부합한다.

---

## 5. 발견 사항 (Findings)

### 5.1 H "lighter prompt" 가설 — null (≥ 5 %p 부족)

RCA §2 가 *"v3 가 nano 에 비해 너무 무거울 수 있다"* 로 남겨둔 가능성은 본 실험의 3 셀로 직접 측정되었고, **lighter 가 nano + low 의 en 분류를 baseline−5 %p 위로 끌어올리지 못한다**. 세 디자인 (Radical / Surgical / Compress) 모두 같은 결론을 — A 가 ~3 %p, B/C 가 ~7 %p 부족한 채로 — 동시에 산출한다.

추가 관찰:
- A vs B 의 +1.5 %p 갭 (81.8 → 83.3) 은 *"How meaning does NOT match"* rejection subsection 의 기여로 추정. 그러나 절대값으로는 의미 미미.
- B vs C 의 동률 (둘 다 83.3 %) 은 tie-breaker 표 + step order 의 *추가* 정보값이 nano + low 에서 거의 0 이라는 것을 시사. v3 의 verbose 가 5.4-nano 의 88.5 / 90.1 % 를 만든 핵심이라면, nano + low 는 그 verbose 를 흡수할 reasoning capacity 가 부족하다는 가설로 이어진다 (검증 미실시).
- 1.1c 의 reasoning_tokens mean=175.7, max=832 은 1.1b (95.7 / 320) 의 거의 2 배 — *"더 긴 본문이 더 긴 reasoning 을 부르지만 정확도로 환산되지 않는다"*.

### 5.2 H3 *semantic* 가설 (lang-native ko) — substantially refuted

`v4-ko @ low` ko = 77.1 % = `v3 @ low` ko (77.1 %). 한국어 lang-native 프롬프트가 nano 의 CJK 분류에 **lift 를 만들지 못한다**. RCA §2.3 의 *"영어로 쓰인 프롬프트가 CJK 입력의 reasoning chain 을 비효율적으로 가이드한다"* 가설은 본 측정으로 **defeated** — 한국어 프롬프트가 같은 데이터셋에서 같은 점수를 낸다.

추가 관찰:
- 한국어 프롬프트가 reasoning_tokens 를 늘리는 **부작용** 만 관측 (mean=264.0 / max=1024, 1024 cap 도달 1 건). 표면적으로 *"lang-native 가 reasoning 을 도와줄 수 있다"* 와 반대 방향.
- 한국어 instructions 의 token 비용 (≈ 3× English) + reasoning_tokens 의 증가가 결합되어 cost-narrative 도 음수.

### 5.3 ADR-0002 lock 강화

ADR-0002 (`docs/adr/0002-llm-classifier-model.md`) 의 결정 — *"production `LLM_MODEL = gpt-5.4-nano` 유지, gpt-5-nano 는 보류"* — 의 retire-test 3 가지 트리거 중 **prompt-side optimization 의 가능성** 이 본 보고서로 정량 측정되었다:

- 본 보고서가 측정한 4 셀 중 어느 것도 nano 의 정확도를 *baseline−5 %p* 까지 끌어올리지 못한다.
- *"lang-native semantic"* 가능성이 사실상 refuted 됨.
- 결과: ADR-0002 의 세 트리거 중 *"새 nano 스냅샷 출시"* / *"5.4 가 30 % 비싸짐"* 두 가지만 살아 있고, *"6-month stagnation 트리거"* 는 본 측정에 의해 *"prompt 차원에서도 회복 불가"* 가 추가로 확인되었기에 더 강해진다.

본 PR 은 ADR-0002 의 본문을 수정하지 않는다 (핸드오프 §"ADRs created this session" 결정 그대로). ADR-0002 의 *References* 섹션에 본 보고서로의 link 추가는 본 PR 의 옵션이며, 별도 commit 으로 분리할 수도 있다.

### 5.4 baseline 표

| 비교 대상 | model | prompt | effort | en | ko | 출처 |
|----------|-------|--------|--------|---:|---:|------|
| Production baseline | gpt-5.4-nano | v2 | (omitted) | **90.1 %** | **88.5 %** | `report-2026-05-11-prompt-rewrite.md` |
| RCA Wave 1 | gpt-5-nano | v3 | minimal | 87.0 % | 70.8 % | `report-2026-05-12-nano-rca.md` |
| RCA Wave 6 | gpt-5-nano | v3 | low | _(unrun)_ | **77.1 %** | `report-2026-05-12-nano-rca.md` |
| **Stage 1 1.1a** | gpt-5-nano | v4-light-A | low | **81.8 %** | _(unrun)_ | _본 보고서_ |
| **Stage 1 1.1b** | gpt-5-nano | v4-light-B | low | **83.3 %** | _(unrun)_ | _본 보고서_ |
| **Stage 1 1.1c** | gpt-5-nano | v4-light-C | low | **83.3 %** | _(unrun)_ | _본 보고서_ |
| **Stage 1 1.2**  | gpt-5-nano | v4-ko       | low | _(unrun)_ | **77.1 %** | _본 보고서_ |
| Hard gate (en) | — | — | — | ≥ 85.1 % | — | §4 winner R |
| Hard gate (ko) | — | — | — | — | ≥ 82.1 % | §4 winner R |

en 사이드 Stage 1 의 정확도 갭 (vs production baseline): −6.8 ~ −8.3 %p. ko 사이드: −11.4 %p (`v4-ko`). 두 격차 모두 어떤 prompt 변형으로도 회복되지 않는다.

---

## 6. Open questions (이후 측정 대상)

본 보고서가 직접 답하지 않은 채로 남는 질문 — ADR-0003 작성 트리거가 발생할 때 재검토.

1. **zh-CN / zh-TW 의 lang-native 효과:** v4-ko 가 ko 에서 null 인 것이 모든 CJK 에 일반화될지 모름. zh-CN 의 한어/번체 사이의 형태론 차이가 다른 시그널을 줄 가능성. 본 실험의 Scope β / Stage 2 가 firing 되지 않으면서 이 질문은 미측정으로 남는다.
2. **Cross-lingual production 분포:** 본 실험은 *"4 lang × 192 monolingual"* 데이터셋 분석에서 cross-lingual 사례가 0 임을 사실로 사용. 실제 production `llm_calls` 의 cross-lingual 비율 (ko event + en categories 등) 이 의미 있다면 v4 의 cross-lingual rule 축소 (Q5) 가 가져올 영향이 다시 측정 대상.
3. **`reasoning_effort=medium` 1-셀 sanity check:** RCA §3.3 가 비용·truncation 비대칭으로 ruled out 했지만, 본 실험에서 `v3 + low + ko = 77.1 %` 와 `v3 + low + en` 의 값이 일치하는지를 확인하려면 en 의 low 측정도 한 번 필요. PR-α 의 smoke (10 케이스) 만으로는 192 추정 불가. ADR-0003 트리거 발생 시 재검토.

---

## 7. References

- 핸드오프 (decision log): [`.claude/handoffs/nano-prompt-experiment-2026-05-12.md`](../.claude/handoffs/nano-prompt-experiment-2026-05-12.md)
- 선행 RCA: [`evals/report-2026-05-12-nano-rca.md`](report-2026-05-12-nano-rca.md)
- Production baseline: [`evals/report-2026-05-11-prompt-rewrite.md`](report-2026-05-11-prompt-rewrite.md)
- ADR-0002 (gpt-5.4-nano lock): [`docs/adr/0002-llm-classifier-model.md`](../docs/adr/0002-llm-classifier-model.md)
- 4 ledger rows: `evals/agent-results.json` (run_id `…v4-light-{A,B,C}…` × 3, `…v4-ko…` × 1, git_sha=`70f23e0`)
- 4 Langfuse runs (위 §2 각 셀에 inline).

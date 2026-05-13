# gpt-5-nano 프롬프트 차원 실험 Stage 1 — 中文 follow-up (`v4-zh-CN` + `v4-zh-TW` 측정)

- **측정일:** 2026-05-12
- **git SHA:** `ef7f1ec` (PR-β commit; 본 측정은 PR-β 의 zh follow-up commit 에서 실행)
- **대상 모델:** `gpt-5-nano` (`reasoning_effort=low`, `max_completion_tokens=1024`)
- **프롬프트 변형:** `prompts/classifier/system.v4-zh-CN.md` (简体), `system.v4-zh-TW.md` (繁體)
- **데이터셋:** `evals/datasets/{zh-CN,zh-TW}/classification.json` (각 192 케이스)
- **관측 surface:** Langfuse Cloud (EU `jp.cloud.langfuse.com`) dataset run × 2 + `evals/agent-results.json` ledger × 2
- **선행 보고서:** [`evals/report-2026-05-13-nano-prompt-stage1.md`](report-2026-05-13-nano-prompt-stage1.md) (en/ko 사이드 — PR-β), [`evals/report-2026-05-12-nano-rca.md`](report-2026-05-12-nano-rca.md) (RCA + ADR-0002 lock)
- **planning artifact:** `.claude/handoffs/nano-prompt-experiment-2026-05-12.md` (Frame B 측정 핸드오프 — Stage 1 §6 "Open questions" 의 zh-CN / zh-TW lang-native 미측정 항목을 닫는 follow-up)
- **본 PR 의 production 영향:** **없음** — `LLM_MODEL = "gpt-5.4-nano"` / `DEFAULT_CLASSIFIER_PROMPT_VERSION = "v2"` 그대로. eval-only Frame B 측정의 연장.

---

## 1. 요약 (TL;DR)

zh-CN / zh-TW 두 셀 모두 §4 *"Winner selection 기준 R"* 의 hard gate 를 통과하지 못했다. H3 lang-native semantic 가설은 PR-β 의 ko 결과(`v4-ko` ≡ Wave 6 `v3+low`)에 이어 **중국어 4-language 전체에서 일관되게 기각**. ADR-0002 (`gpt-5.4-nano` lock) 는 모든 4 개 언어에서 prompt-side 우회로가 없음을 통해 강화된다.

> **실험 설계 비대칭 (transparency note).** 본 4-language 비교는 두 개의 다른 prompt dimension 을 섞고 있다.
> - **en (Cell 1.1a/b/c):** v3 → **경량화 (lighter)** 변형. `v4-light-A` (Radical, 49 lines / 3 ex), `v4-light-B` (Surgical, 87 lines / 5 ex), `v4-light-C` (Compress, 77 lines / 6 ex). v3 의 일부 섹션을 제거/압축한 구조 변형.
> - **ko (Cell 1.2), zh-CN (Cell 1.3), zh-TW (Cell 1.4):** v3 → **lang-native 번역**. `v4-ko` / `v4-zh-CN` / `v4-zh-TW` (모두 ≈ 120 lines / 5 ex). v3 의 7-section 구조 (Task / Critical rule / Inputs / Exact step order / Edge cases / Output format / Examples) 를 1:1 유지한 채 instructions·examples 만 해당 언어로 번역.
>
> 따라서 §5 의 4-language 종합 표는 "동일 prompt 처리가 4 언어에 일관적으로 효과가 있었는가" 가 아니라 "각 언어에서 가장 유망한 prompt dimension 하나만 측정했을 때 nano 가 baseline gate 를 회복하는가" 의 측정이다. 이 비대칭은 planning artifact (`.claude/handoffs/nano-prompt-experiment-2026-05-12.md` §4) 의 설계 의도 — 두 가설 H ("lighter") / H3 ("lang-native") 를 독립 변수 하나씩만 변경해 분리 측정 — 에서 비롯되었다. 비-en 언어에서 "경량화 + lang-native 동시 적용" 셀 (예: `v4-zh-CN-light-B`) 은 본 실험에서 측정되지 않았다 (§7 Open questions 참조).

| Cell | lang | prompt | accuracy | bad_response | mean reasoning tok | mean completion tok | hard gate (acc) | hard gate (bad=0) | verdict |
|------|------|--------|---------:|-------------:|-------------------:|--------------------:|-----------------|-------------------|---------|
| 1.3 | zh-CN | `v4-zh-CN` (Bilingual 简体) | 150/192 (**78.1 %**) | 2/192 (**0.010**) | 255.7 | 275.4 | ≥ 81.5 % — ❌ FAIL by 3.4 %p | ❌ FAIL | ❌ no-lift + unsafe |
| 1.4 | zh-TW | `v4-zh-TW` (Bilingual 繁體) | 142/192 (**74.0 %**) | 0/192 (**0.000**) | 256.0 | 276.5 | ≥ 76.8 % — ❌ FAIL by 2.8 %p | ✅ | ❌ no-lift |

**핵심 관찰**

- **zh-CN 사이드 (H3 lang-native, 简体):** `v4-zh-CN @ low` = **78.1 %**. v2+5.4-nano baseline (86.5 %) 대비 −8.4 %p, Wave 6 의 `v3+low+nano` zh-CN (75.0 %) 대비 +3.1 %p. 부분적 개선은 있으나 production baseline gate (81.5 %) 에 3.4 %p 미달. 추가로 reasoning_tokens 가 max=1024 캡을 정확히 두 번 hit (truncation `bad_response`) — `v4-ko` 와 동일한 lang-native side-effect 가 简体 에서도 재현됨. **hard gate 위반으로 prompt 는 reject**.
- **zh-TW 사이드 (H3 lang-native, 繁體):** `v4-zh-TW @ low` = **74.0 %**. v2+5.4-nano baseline (81.8 %) 대비 −7.8 %p. bad_response 는 깨끗 (0/192) 하지만 accuracy gate (76.8 %) 에 2.8 %p 미달. zh-CN 보다 4.1 %p 낮은 결과는 (a) zh-TW 가 nano 의 코퍼스에서 zh-CN 보다 sparse 한 것 + (b) 1 건의 네트워크 abort (`<error:This operation was aborted>`) 로 인한 자동 miss 가 누적된 영향으로 보인다.
- **lang-native 가설의 4-language 종합 결론:** instructions / Critical rule / examples 의 native 언어 번역은 nano 의 CJK + KR 분류 정확도에 **measurable lift 를 만들지 못한다**. ko (`v4-ko`) / zh-CN (`v4-zh-CN`) / zh-TW (`v4-zh-TW`) 모두 baseline−5%p gate 미달. 동일 패턴이 3 개 비-en 언어에서 일관되게 반복되는 것은 **prompt-side 가 아닌 model-side (gpt-5-nano 의 CJK·KR semantic capacity)** 가 병목임을 강하게 시사한다.

본 측정의 cost: 2 셀 × 192 케이스 × `gpt-5-nano` ≈ $0.22.

---

## 2. Cell 결과 상세

### 2.1 Cell 1.3 — `v4-zh-CN` (Bilingual 简体) on zh-CN

- **셀 정의:** `v4-ko` 의 구조를 그대로 미러링한 简体中文 bilingual 변형 — 모든 instructions / Critical rule (3 matching + 2 rejection) / Inputs / Exact step order (5 단계) / tie-breakers a–f / Output format / 5 examples 를 简体 으로 번역. examples 5 개는 monolingual zh-CN (健身/用餐/运动/none/跑步). cross-lingual 단락은 1 줄 disclaimer 로 축약. JSON 출력 schema (`{"category_name":"..."}`) 는 영어 유지.
- **결과:**
  - accuracy = **78.1 % (150/192)**
  - `bad_response_rate = 0.010` (2/192 truncation·schema 위반)
  - mean reasoning tokens = 255.7, max = **1024** (cap hit)
  - mean completion tokens = 275.4, max = **1024** (cap hit)
- **Langfuse run:** [`ef7f1ec-zh-CN-v4-zh-CN-low`](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0z959a005tad086yn82b4l/runs/25826343-38e0-45f9-89ce-5be6df0f45b7)
- **ledger row:** `2026-05-12-classification-multilingual-zh-CN-gpt-5-nano-prompt-v4-zh-CN-effort-low-cap1024`
- **관찰:**
  - **bad_response=2 → hard gate 위반.** §4 step 1 의 hard gate ("`bad_response = 0`") 가 가장 먼저 발동. accuracy 가 어느 수준이든 본 prompt 는 자동 reject.
  - reasoning_tokens max = 1024 = `max_completion_tokens` cap → **`v4-ko` 의 truncation pattern 이 简体 에서도 재현**. lang-native 변형은 reasoning loop 길이를 늘리는 일관된 부작용을 보인다. cap 1024 가 ko 에서는 1 건, zh-CN 에서는 2 건의 truncation 을 만들었다 (zh-CN dataset 평균 input 토큰이 ko 보다 약간 길어 한계선에 더 자주 닿는다).
  - +3.1 %p (vs Wave 6 zh-CN `v3+low+nano` 75.0 %) 의 부분 lift 는 examples 의 简体 monolingual 화가 nano 의 token-level matching 에 작은 도움을 준다는 신호로 읽힐 수 있다 — 그러나 hard gate 위반이 우선이며, 어떤 경우에도 production baseline (86.5 %) 까지의 8.4 %p gap 를 회복하지 못한다.

### 2.2 Cell 1.4 — `v4-zh-TW` (Bilingual 繁體) on zh-TW

- **셀 정의:** Cell 1.3 의 繁體中文 미러. 같은 구조·같은 5 examples (健身/用餐/運動/none/跑步 — 모든 글자는 繁體 변환). cross-lingual 단락 1 줄 disclaimer.
- **결과:**
  - accuracy = **74.0 % (142/192)**
  - `bad_response_rate = 0.000` (0/192 — clean)
  - mean reasoning tokens = 256.0, max = 768
  - mean completion tokens = 276.5, max = 789
  - 1 건의 abort error (`<error:This operation was aborted>`) 발생 — fetch timeout 추정, 셀 단위로는 자동 miss 처리되어 accuracy 에 반영됨.
- **Langfuse run:** [`ef7f1ec-zh-TW-v4-zh-TW-low`](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0zbxey0086ad07e5bdv9a3/runs/6dbd31e1-c6b2-43a1-aaa4-125b5e817bc1)
- **ledger row:** `2026-05-12-classification-multilingual-zh-TW-gpt-5-nano-prompt-v4-zh-TW-effort-low-cap1024`
- **관찰:**
  - **bad_response 깨끗 → hard gate (`bad=0`) 통과.** zh-CN 과 달리 reasoning_tokens max = 768 로 cap 1024 에 닿지 않음 — input 토큰 분포가 zh-CN 대비 약간 짧거나 모델의 reasoning chain 이 일찍 종결되는 경향.
  - 그러나 accuracy 74.0 % 는 zh-TW baseline (81.8 %) 대비 −7.8 %p, gate (76.8 %) 에 −2.8 %p 부족.
  - zh-CN 대비 −4.1 %p 가 발생한 가장 큰 원인은 (a) nano 의 繁體 corpus 가 简体 보다 sparse 함, (b) abort error 1 건의 자동 miss, (c) zh-TW dataset 의 cross-cluster 혼동 패턴 (RCA §3.1) 이 zh-CN 보다 진하게 남아있는 점. **prompt-side 의 lang-native 처리로는 회복 불가**.

---

## 3. §4 Winner Selection R 적용

§4 *"Winner selection 기준 R"* 의 결정 트리를 본 측정에 적용한 결과는 다음과 같다.

**Cell 1.3 (zh-CN + `v4-zh-CN`):**

1. **hard gate 1 — `bad_response_rate = 0`?** → **NO** (2/192 = 0.010). **gate FAIL → reject prompt, 후속 단계 무관.**

**Cell 1.4 (zh-TW + `v4-zh-TW`):**

1. **hard gate 1 — `bad_response_rate = 0`?** → **YES** (0/192).
2. **hard gate 2 — `accuracy ≥ baseline − 5 %p` (= 81.8 − 5 = 76.8 %)?** → **NO** (74.0 % < 76.8 %, gap = 2.8 %p). **gate FAIL → reject prompt.**

두 셀 모두 §4 step 5 ("Stage 1 terminates — no candidate passes gates 1 + 2") 에 해당한다. PR-β 본문(en + ko)의 4 셀과 합쳐 **6 셀 / 4 언어 / 5 prompt 변형 모두 baseline−5 %p gate 미달**. lang-native 가설 (H3) 의 4-language 종합 검증은 종료, 결과는 **null (no lift)**.

---

## 4. 후속 조치 — None

본 측정은 PR-β (en + ko) 가 이미 `Stage 1 = terminal`로 종결한 상태의 **scope-extension follow-up** 이다. 6 셀 / 4 언어 / 5 prompt 변형 측정이 모두 동일한 null 결과로 수렴한 이상, 추가 stage·scope 도 발동되지 않는다.

- **Stage 2 (en × 5.4-nano backport, 6 셀):** PR-β §4 에서 이미 firing 조건 거짓으로 종결.
- **Scope β (5.4-nano × ko 백포트, 2 셀):** PR-β §4 에서 이미 firing 조건 거짓으로 종결.
- **본 zh follow-up (2 셀):** 두 셀 모두 게이트 미달. 추가 후속 셀 없음.
- **PR structure:** PR-α (#83 infra) → PR-β (#84 en/ko Stage 1) → 본 PR (#85 zh Stage 1 follow-up) — **본 PR 도 terminal**, PR-γ 는 본 실험의 어떤 분기에서도 열리지 않는다.

---

## 5. 4-language 종합 (PR-β + 본 PR)

H3 lang-native semantic 가설의 4-language 검증을 단일 표로 모은다.

| 언어 | dimension | prod baseline (v2+5.4-nano+low+cap512) | nano+v3+low+cap1024 (Wave 6) | v4 변형 +nano+low+cap1024 (실험) | gate (baseline−5 %p) | gate 결과 |
|------|-----------|------:|------:|------:|------:|------|
| en | **lighter** (`v4-light-B/C` best, structure-reduced) | 90.1 % | n/a (Wave 1 87.0 % @ minimal) | 83.3 % | 85.1 % | ❌ −1.8 %p |
| ko | **lang-native** (`v4-ko`, v3 구조 + 한국어 번역) | 88.5 % | 77.1 % | 77.1 % | 83.5 % | ❌ −6.4 %p (vs prod), ≡ Wave 6 |
| zh-CN | **lang-native** (`v4-zh-CN`, v3 구조 + 简体 번역) | 86.5 % | 75.0 % | 78.1 % | 81.5 % | ❌ −3.4 %p (vs prod), +3.1 %p (vs Wave 6) + 2 bad_response |
| zh-TW | **lang-native** (`v4-zh-TW`, v3 구조 + 繁體 번역) | 81.8 % | (baseline at minimal 66.1 %) | 74.0 % | 76.8 % | ❌ −2.8 %p (vs prod) |

> **표 해석 주의 (§1 transparency note 의 재확인).** "v4 변형" 열의 prompt 종류는 언어별로 다르다 — en 은 *경량화 (구조 축소)*, ko/zh-CN/zh-TW 는 *lang-native (v3 구조 그대로 번역)*. 두 dimension 모두 nano 의 prompt-side 회복 폭을 측정하기 위한 변형이지만, 동일 처리의 cross-language 비교는 아니다. "각 언어에서 가장 유망한 dimension 하나가 gate 를 통과하는가" 의 질문에 대한 4-언어 답이 모두 ❌ 라는 것이 본 표의 정확한 의미이다.

**관찰:**
- 4 언어 전체에서 prod baseline (v2+5.4-nano) 까지의 gap 가 prompt 변형으로 회복되지 않는다.
- CJK 두 언어에서 nano+`v4-native` 가 nano+`v3+low` 대비 부분적 lift 를 보이는 경향은 있으나 (zh-CN +3.1 %p, zh-TW: minimal vs low 비교라 직접 비교는 불가) **gate 통과에 필요한 폭은 아니다**. ko 는 lift 가 0 %p.
- bad_response 발생 패턴: ko 1 건, zh-CN 2 건, zh-TW 0 건, en (3 셀) 0 건. lang-native 변형이 reasoning_tokens 를 비-en 언어에서 늘리는 경향이 관측된다.

**결론:** prompt-side optimization 으로는 nano 의 CJK·KR 성능을 production 게이트까지 끌어올 수 없다. 병목은 model-side (gpt-5-nano 의 CJK·KR semantic capacity) 이며, ADR-0002 lock 의 정당성을 4 언어 전부에서 강화한다.

---

## 6. ADR-0002 (`gpt-5.4-nano` lock) 강화 신호

- **lock 의 근거:** prod baseline 4 언어 평균 (en 90.1 / ko 88.5 / zh-CN 86.5 / zh-TW 81.8 = **86.7 %**) vs nano-experimental 최고 평균 (en 83.3 / ko 77.1 / zh-CN 78.1 / zh-TW 74.0 = **78.1 %**) — **8.6 %p gap 가 prompt-side dimension 으로 회복되지 않음**.
- **본 follow-up 의 기여:** PR-β 가 en + ko 에서 lock 근거를 강화했다면, 본 PR 은 동일 결론을 zh-CN + zh-TW 까지 확장한다. **lock 의 단정성은 4 언어 전부에서 검증됨**.
- **ADR-0002 References 항목** 에 본 보고서 추가 권장 — `docs/decisions/0002-llm-classifier-model.md` 의 References 섹션에 다음 두 줄 추가:
  - `evals/report-2026-05-13-nano-prompt-stage1.md` — Stage 1 en + ko 측정
  - `evals/report-2026-05-13-nano-prompt-stage1-zh.md` — Stage 1 zh-CN + zh-TW follow-up 측정 (본 보고서)

---

## 7. Open questions

본 측정으로 남는 미해결 문항 (모두 production 영향 없음, 향후 별도 PR 에서 다뤄질 수 있음):

- **두 dimension 의 교차 측정 (en × lang-native, 비-en × lighter)**: 본 실험은 언어별로 하나의 dimension 만 측정했다 (§1 transparency note). 누락된 셀은 (a) en 에 v3-translation-style full-structure 변형을 얹은 셀 — 단, en 은 이미 v3 자체가 native 이므로 의미가 없음, (b) **비-en 언어에 lighter 변형을 적용한 셀** (예: `v4-zh-CN-light-B`, `v4-ko-light-B`). 후자가 미측정 공백이며, ko 에서 `v4-ko ≡ Wave 6 v3+low` 인 점 — instructions 길이/구조 변경이 ko 의 정확도를 움직이지 않는다는 약한 신호 — 으로 보아 비-en × lighter 도 gate 통과 가능성은 낮다고 추정되나 직접 측정은 없다. 추가 4 셀 측정 비용 ≈ $0.45.
- **CJK 의 dataset 품질 영향**: zh-TW 의 abort error 1 건은 fetch timeout 으로 추정되나, 셀 단위로는 자동 miss 로 처리됐다. retry 후 안정 측정 시 +0.5 %p 의 회복 가능성 존재 — gate 통과에는 부족.
- **lang-native 번역의 native-speaker 검수 부재**: `v4-zh-CN` / `v4-zh-TW` 의 번역은 모델 (Claude Opus 4.7) 이 작성했으며 native CJK 화자의 검수를 거치지 않았다. 简体/繁體 어휘 선택 (e.g., 「圓桌討論」 vs 「圆桌讨论」, 「瑜珈」 vs 「瑜伽」), tie-breaker 의 미묘한 뉘앙스, 예시 5 개의 자연스러움에 대해 minor 한 unidiomatic 표현이 잔존할 가능성이 있다. 본 실험 결론 (lang-native 가설 기각) 의 절대값에는 영향을 미칠 수 있으나, 4 개 언어 8.6 %p 평균 gap 의 방향성 자체를 뒤집을 가능성은 낮다.
- **`v4-zh-CN` truncation pattern**: cap 1024 가 zh-CN dataset 에서 2 회 hit. cap 2048 로 확장 시 bad_response 가 사라질 수 있으나 (a) 비용 2 배, (b) 1.8 %p 미만의 회복 폭 예상으로 production 적용 불가. (실험적 호기심 차원에서만 흥미)
- **5.4-nano 백포트 (Scope β)**: v4-native prompt 를 5.4-nano 위에 얹어 4 언어 모두에서 prompt-only 회복 폭을 측정하는 시나리오. 본 실험에서는 firing 조건 거짓으로 종결되었으나, lock 강화의 추가 신호로서 향후 별도 PR 에서 다룰 수 있다. cost: 4 셀 × $0.13 ≈ $0.52.

---

## 8. References

- 선행 보고서:
  - [`evals/report-2026-05-13-nano-prompt-stage1.md`](report-2026-05-13-nano-prompt-stage1.md) (PR-β, en/ko)
  - [`evals/report-2026-05-12-nano-rca.md`](report-2026-05-12-nano-rca.md) (RCA + ADR-0002 lock)
  - [`evals/report-2026-05-11-prompt-rewrite.md`](report-2026-05-11-prompt-rewrite.md) (v2 + 5.4-nano baseline)
- 본 PR 프롬프트 source:
  - [`prompts/classifier/system.v4-zh-CN.md`](../prompts/classifier/system.v4-zh-CN.md)
  - [`prompts/classifier/system.v4-zh-TW.md`](../prompts/classifier/system.v4-zh-TW.md)
- 의사결정 문서: [`docs/decisions/0002-llm-classifier-model.md`](../docs/decisions/0002-llm-classifier-model.md)
- planning artifact: `.claude/handoffs/nano-prompt-experiment-2026-05-12.md`
- ledger: [`evals/agent-results.json`](agent-results.json) — 본 PR 의 2 개 신규 row 는 모두 `git_sha = ef7f1ec`
- Langfuse run × 2: 위 §2 의 각 셀 항목 참조.

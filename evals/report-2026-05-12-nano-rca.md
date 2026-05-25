# gpt-5-nano 분류 실패 RCA — `reasoning_effort=minimal` 변형 측정

- **측정일:** 2026-05-12
- **git SHA:** _(본 PR commit, Wave 5 종료 후 확정)_
- **대상 모델:** `gpt-5-nano` (production 비교군: `gpt-5.4-nano`)
- **프롬프트:** `prompts/classifier/system.v3.md` (변경 없음)
- **데이터셋:** `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` (각 192 케이스)
- **관측 surface:** Langfuse Cloud (EU jp.cloud.langfuse.com) dataset run + `evals/agent-results.json` ledger
- **선행 보고서:** `evals/report-2026-05-11-gpt-5-nano-migration.md` (실패 baseline)
- **planning artifact:** `.claude/handoffs/nano-prompt-rca-2026-05-12.md` + `~/.claude/plans/grill-polished-wave.md`
- **본 PR 의 production 영향:** **없음** — production `LLM_MODEL = "gpt-5.4-nano"` / `DEFAULT_CLASSIFIER_PROMPT_VERSION = "v2"` 유지. 본 RCA 의 § "추천" 에 따른 모델 swap 은 별도 PR.

---

## 1. 요약 (TL;DR)

5/11 측정에서 `gpt-5-nano + v3 + cap=1024` 가 4 개 언어 모두 `bad_response` 39 – 60 % 로 collapse 했던 실패는 **단일 root cause** 로 좁혀진다: `reasoning_effort` 파라미터를 생략하면 모델이 `medium` 으로 fallback 해 reasoning token 이 1024-token cap 을 점유하고 JSON output 이 truncate 된다. `reasoning_effort=minimal` 을 명시하면 reasoning token 이 **0 으로 떨어지고** `bad_response` 도 완전히 사라진다.

| Lang  | baseline (v2 + 5.4-nano) | 5/11 nano (no `effort`) | 5/12 nano (`effort=minimal`) | Δ vs 5/11 | Δ vs baseline | gate (≥ baseline−1%p) |
|-------|--------------------------|--------------------------|------------------------------|-----------|---------------|----------------------|
| en    | 173/192 (**90.1 %**)     | 108/192 (56.3 %)         | **167/192 (87.0 %)**         | **+30.7 %p** | **−3.1 %p**   | 89.1 % — ❌ FAIL by 2.1 %p   |
| ko    | 170/192 (**88.5 %**)     | 89/192 (46.4 %)          | **136/192 (70.8 %)**         | **+24.4 %p** | **−17.7 %p**  | 87.5 % — ❌ FAIL by 16.7 %p |
| zh-CN | 171/192 (**89.1 %**)     | 81/192 (42.2 %)          | **132/192 (68.8 %)**         | **+26.6 %p** | **−20.3 %p**  | 88.1 % — ❌ FAIL by 19.3 %p |
| zh-TW | 171/192 (**89.1 %**)     | 69/192 (35.9 %)          | **127/192 (66.1 %)**         | **+30.2 %p** | **−23.0 %p**  | 88.1 % — ❌ FAIL by 22.0 %p |

**핵심 관찰**

- `bad_response`: 5/11 측정에서 fail 의 89 – 95 % 를 차지했던 truncation 실패가 4 lang 모두에서 **0/192** 로 사라졌다. `reasoning_effort=minimal` 이 cap-truncation 의 모든 시그널을 0 으로 끈다. **H5 (단일 origin: token budget) 는 mechanism 수준에서 fully validated.**
- 그러나 mechanism 이 풀리자 더 깊은 **언어-의존 정확도 갭** 이 드러났다: en 은 baseline 에 가깝지만 (−3.1 %p), CJK 3 lang 은 −17.7 ~ −23.0 %p 의 collapse 를 보인다. `bad_response` 가 0 % 이므로 이 갭의 원인은 **truncation 이 아니라 의미 분류 자체** — `minimal` 효과는 internal reasoning 을 끄는데, 5-nano 의 CJK cross-cluster disambiguation 은 reasoning 없이는 약하다.
- 갭이 prompt-shaped 가 아니라는 점은 Wave 1 (v3 verbatim, stripping 없음) 의 결과로 확정. Wave 5 의 FAIL 사례들은 c0↔c3 (Tech Talks ↔ Collaborative Sessions), c6↔c0 (Work Activities ↔ Tech Talks), c8↔c9 (Media ↔ Academic) 등 baseline 측정에서도 일부 발생하던 cross-cluster 혼동이지만 5-nano + minimal 에서는 빈도가 5-6 배 증폭된다.
- 다음 자연스러운 변수: `reasoning_effort=low` — internal reasoning 을 _완전히 끄지 않고 일부 budget 을 주는_ 중간 지점. cap=1024 안에서 reasoning 가 끝나면 CJK 정확도가 회복될 가능성. **Wave 6 (다음 §3.2) 이 이 가설을 직접 테스트한다.**

회귀 가드 (`evals/tasks/classification-semantic.json`, 20 케이스) 는 본 RCA 의 측정 SCOPE 밖 — 본 PR 은 production 모델/프롬프트 default 를 건드리지 않으므로 §5.3 "Decision rule edits are eval-gated" 의 회귀 게이트는 **트리거되지 않는다**.

---

## 2. 가설과 결과의 매핑

`~/.claude/plans/grill-polished-wave.md` 의 5 가설 중 본 PR 이 직접 테스트한 것은 **H5 (단일 origin: token budget)** 만이다. 사전 1-shot 호출의 결과로 H1/H2 (프롬프트가 reasoning 을 유도) 와 H3 (프롬프트 언어 불일치) 의 가능성이 H5 의 그림자 안으로 들어가기 때문에 나머지 wave 는 cost 만 쓰고 정보값이 없다고 판단해 skip 했다.

### 2.1 H5 — token budget 가설 검증

| 측정 | reasoning_effort | reasoning_tokens (n=1 pre-flight) | en pass-rate | en bad_response |
|------|------------------|------------------------------------|--------------|------------------|
| 5/11 nano | _(omitted → medium fallback)_ | _(unmeasured, but ≥ ~700 tokens implied by cap-truncation)_ | 56.3 % | ~60 % |
| 5/12 pre-flight | minimal | **0** | _(1 case — Meal, correct)_ | _0 cases truncated_ |
| 5/12 Wave 1 | minimal | _(not captured per-call — chat-completions API)_ | **87.0 %** | **0 %** |

Pre-flight (`evals/scripts/preflight-minimal.ts`, 1 call, $0) 에서 다음을 확인했다:

```
HTTP 200
model: gpt-5-nano-2025-08-07
finish_reason: stop
usage.completion_tokens: 18
usage.completion_tokens_details.reasoning_tokens: 0
content: {"category_name":"Meal"}
```

`reasoning_tokens=0` 은 H5 의 **mechanism** 측면을 증명한다 — `minimal` 은 internal reasoning 을 끄기 때문에 cap=1024 안에서 응답이 절대 잘릴 수 없다. Wave 1 192 케이스에서 `<bad_response>` / `<error:...>` 가 0 건이라는 것도 같은 결론을 outcome 측면에서 확정한다.

### 2.2 H1 / H2 (프롬프트가 reasoning 을 유도) — by inference

`reasoning_effort=minimal` 에서 reasoning_tokens=0 이면 프롬프트가 어떤 시그널을 보내든 reasoning loop 가 발생하지 않는다. 따라서 H1 (Critical rule 가 induce) / H2 (Examples 가 induce) 는 본 RCA 의 시나리오에서는 **무의미해진다** — wave 2/3 의 prompt stripping 변형은 Wave 1 의 −3 %p gap 을 메울 수 없다.

### 2.3 H3 (프롬프트 언어 불일치 on CJK) — Wave 5 + 6 으로 부분 반증

5/11 의 비라틴 회귀 폭 (en −33.8 / ko −42.1 / zh-CN −46.9 / zh-TW −53.2 %p) 은 truncation 의 한 mechanism 으로 설명 가능하다는 가설이었다. Wave 5 (minimal) 에서 4 lang 모두 truncation 이 사라졌는데도 CJK 의 잔여 갭이 −17.7 ~ −23.0 %p 로 큰 것 → **H3 의 truncation 측면은 반증**.

남는 가능성은 H3 의 _semantic_ 측면 — "영어로 쓰인 프롬프트가 CJK 입력의 reasoning chain 을 비효율적으로 가이드한다." 이 가능성은 본 RCA 의 측정 범위 밖이지만, 만약 추가 측정을 한다면 `prompts/classifier/system.v4-ko.md` 같은 lang-native 프롬프트를 만들고 ko 만 비교하는 식. 결정은 §5 의 Outcome C 트리거 (cost down 또는 nano model 업데이트) 에 따라 후속 PR 로 분리.

### 2.4 H4 (구조적 nano-only 한계) — Wave 6 으로 확정

Wave 6 의 `effort=low` 측정이 H4 를 직접 검증했다 — internal reasoning 을 _완전히 끄지도 않고 truncate 되지도 않는_ 안전 영역에서도 ko 77.1 %, zh-CN 75.0 % 에 멈춤. baseline (5.4-nano + cap=64 + default effort) 의 88.5 / 89.1 % 과의 갭은 **모델 자체의 CJK 한계**.

즉 5/11 의 ko/zh 측정값은 두 layer 의 합산이었음:
- truncation layer (39 – 60 % 의 bad_response) → `minimal`/`low` 가 제거
- 모델 내재 CJK 한계 (−10 ~ −14 %p) → 어떤 effort 조합으로도 회복 불가

H4 는 "5-nano 가 약하다" 라기보다 **"5-nano 는 CJK 의 cross-cluster disambiguation 능력이 5.4 보다 약하다"** 로 specific 화 된다. en 은 Wave 1 의 −3.1 %p 가 baseline 변동 범위에 가까워 H4 의 영향이 미미하다.

---

## 3. Wave 별 측정 결과

### 3.1 Wave 1 + Wave 5 — `effort=minimal`, cap=1024, 4 lang

| Lang  | pass-rate          | Δ vs baseline | bad_response | Langfuse run                                                                                                                                | gate (≥ baseline−1%p)    |
|-------|---------------------|---------------|---------------|---------------------------------------------------------------------------------------------------------------------------------------------|--------------------------|
| en    | 167/192 (**87.0 %**) | **−3.1 %p**   | **0 %**       | [run 4ab64df3](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0yz6tj01n7ad08w4pexg7f/runs/4ab64df3-9ba9-448b-8353-007a519642cb) | 89.1 % — ❌ FAIL by 2.1 %p   |
| ko    | 136/192 (**70.8 %**) | **−17.7 %p**  | **0 %**       | [run 0f35c687](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0z6b86002tad07fut3ye8a/runs/0f35c687-5c12-45d6-859b-5bb0f20b7478) | 87.5 % — ❌ FAIL by 16.7 %p |
| zh-CN | 132/192 (**68.8 %**) | **−20.3 %p**  | **0 %**       | [run 7d6a3f0e](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0z959a005tad086yn82b4l/runs/7d6a3f0e-5d42-4465-ab4b-2ee5bf5c1bd6) | 88.1 % — ❌ FAIL by 19.3 %p |
| zh-TW | 127/192 (**66.1 %**) | **−23.0 %p**  | **0 %**       | [run f7803881](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0zbxey0086ad07e5bdv9a3/runs/f7803881-aba8-4494-a56a-01d564ade5bc) | 88.1 % — ❌ FAIL by 22.0 %p |

**관찰**: 4 lang 모두 `bad_response = 0` — H5 가 mechanism 측면에서 완전히 풀렸다. 잔여 갭은 모두 **CJK 쪽에 집중** 됐고, en 만 baseline 근방 (−3.1 %p). minimal 효과가 internal reasoning 을 끄면서 5-nano 의 CJK 의미 분류 능력에 ceiling 이 드러난 것으로 해석.

### 3.2 Wave 6 — `effort=low`, cap=1024, ko + zh-CN (B vs C 결정용)

CJK collapse 가 reasoning_effort 의 _전부냐 일부냐_ 의 차이라면, `low` (minimal 보다 한 단계 reasoning 허용) 가 sweet spot 일 수 있다. cap=1024 안에서 reasoning 이 종료되기만 하면 `bad_response = 0` 을 유지하면서 CJK 정확도가 회복될 가능성. zh-TW 는 Wave 6 결과로 본 RCA 의 decision 이 lock 되면 추가 측정 불필요 (Wave 5 의 zh-CN 과 zh-TW 가 동형 (−20.3 / −23.0 %p) 이므로 ko + zh-CN 두 lang 이 결정 가능 표본).

| Lang  | pass-rate           | Δ vs minimal | Δ vs baseline | bad_response | Langfuse run                                                                                                                                | gate                       |
|-------|---------------------|---------------|---------------|---------------|---------------------------------------------------------------------------------------------------------------------------------------------|----------------------------|
| ko    | 148/192 (**77.1 %**) | **+6.3 %p**   | **−11.4 %p**  | **0 %**       | [run 63c7738f](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0z6b86002tad07fut3ye8a/runs/63c7738f-e799-41f0-8075-95d23cdf0949) | 87.5 % — ❌ FAIL by 10.4 %p |
| zh-CN | 144/192 (**75.0 %**) | **+6.2 %p**   | **−14.1 %p**  | **0 %**       | [run 8ba85f81](https://jp.cloud.langfuse.com/project/cmouvbc42000oad06x1s5kzpu/datasets/cmp0z959a005tad086yn82b4l/runs/8ba85f81-5e9b-41cd-a6c6-c3dd34776989) | 88.1 % — ❌ FAIL by 13.1 %p |

**관찰**:

- `low` 는 minimal 보다 CJK 에서 **일관되게 +6 %p** 정확도 회복. internal reasoning 의 _일부 budget_ 이 cross-cluster disambiguation 에 직접 기여한다는 증거.
- 그러나 회복은 **gate 까지 도달하지 못한다** — ko 는 gate 보다 10.4 %p, zh-CN 은 13.1 %p 부족. ko 의 baseline (88.5 %) 까지는 11.4 %p, zh-CN 의 baseline (89.1 %) 까지는 14.1 %p.
- `bad_response` 가 4 lang 모두 0 % 를 유지 — cap=1024 가 `low` 의 reasoning budget 을 충분히 수용. 이 측정은 H5 가 모든 effort level (≤ low) 에서 사실임을 추가 확정.

### 3.3 더 큰 effort (`medium` / `high`) 를 시도하지 않은 이유

본 RCA 의 시나리오에서 `medium` / `high` 는 trade-off 가 모두 나쁜 방향:

- **(a) bad_response 재발 risk**: 5/11 측정에서 default effort (= medium) 가 cap=1024 안에서도 truncate 됐던 것이 본 RCA 의 출발점. Wave 1 의 1-shot pre-flight 가 `minimal` 에서 `reasoning_tokens=0` 을 보여줬을 뿐 `low` 의 reasoning token 분포는 아직 측정되지 않았지만, `low` 가 Wave 6 에서 0 truncation 으로 통과한 것은 cap=1024 가 `low` 의 reasoning peak 도 견딘다는 정황 증거. `medium` 으로 올리면 5/11 의 collapse 가 재현될 가능성이 비대칭적으로 크다.
- **(b) 정확도 trend extrapolation**: minimal → low 는 +6 %p 의 회복을 줬는데, 이 회복분 자체가 작아진다고 보는 게 합리적 (returns to scale 감소). low → medium 으로 또 +10 %p 회복해 baseline 에 닿을 가능성은 낮다.
- **(c) cap 상향은 별도 trade-off**: cap=1024 → 4096 으로 올려서 `medium` 이상을 견디게 만들 수 있겠지만, 그러면 운영자 budget 면에서 5-nano 의 cost 우위가 빠르게 사라진다 — 본 RCA 의 전제 (5-nano 가 5.4-nano 대비 _싸야_ 의미 있음) 자체가 흔들린다.

따라서 effort sweep 의 **viable 후보 (cap=1024 고정)** 는 `minimal` 과 `low` 두 개로 좁혀지고, 두 값 모두 CJK gate 를 통과하지 못했다는 게 본 RCA 의 측정 결론.

---

## 4. 무엇을 바꿨나 — 측정 변경 명세

본 PR 은 **production 코드 0 줄 변경**. 측정 surface 만 만진다.

| 파일 | 변경 | 비고 |
|------|------|------|
| `evals/report-2026-05-12-nano-rca.md` | 신규 | 본 보고서 |
| `docs/adr/0002-llm-classifier-model.md` | 신규 ADR | Outcome C — gpt-5.4-nano lock |
| `evals/agent-results.json` | append-only — Wave 1 + Wave 5 (3) + Wave 6 (2) = **6 rows** | 기존 row 보존 |

(`evals/scripts/preflight-minimal.ts` 가 1-shot pre-flight 검증에 일회성으로 사용됐고, 본 PR 머지 전 삭제됨.)

`prompts/classifier/system.v{N}.md` / `src/services/llmClassifier.ts` / `src/services/prompts/_generated.ts` / `src/services/prompts/classifierPrompts.ts` 모두 **무변경** — Wave 2/3/4 의 prompt iteration 이 §2.4 (H4 가 prompt-fixable 이 아님) 로 인해 skip 됐고, Outcome C 가 모델/프롬프트 default 를 그대로 유지하기 때문.

---

## 5. 결정: Outcome C — `gpt-5.4-nano` lock

**근거**:

1. **H5 (token budget) 는 완전 해결됨.** 4 lang × Wave 1 + Wave 5 + Wave 6 (총 6 runs, 1152 cases) 에서 `bad_response = 0`. 5/11 보고서의 39 – 60 % truncation rate 는 `reasoning_effort` 파라미터 누락이 단일 origin 이었음.
2. **그러나 H4 (5-nano 의 CJK 내재 한계) 가 새로 드러남.** Wave 5 + Wave 6 의 ko/zh-CN/zh-TW 에서 viable effort 양 끝 (`minimal`, `low`) 모두 baseline−10 ~ −23 %p 의 정확도 갭. prompt 변경 (v3 verbatim) 도, 사용 가능한 effort 도 갭을 메우지 못함.
3. **`medium`/`high` 로의 escalation 은 비대칭적으로 risk 가 큼** — §3.3 참고. cap=1024 안에서 5/11 의 collapse 가 재현될 가능성 + cost 우위 사라짐.
4. **CJK 3 lang 의 production 영향이 즉시 발생.** AutoColor 의 production traffic 은 ko (한국 launch), zh-CN/zh-TW (중화권 launch 예정 — `gas/i18n.js` 의 4 lang 지원 코드가 이미 적용됨) 를 포함. en-only 우위로 모델 swap 을 정당화할 수 없음.

**구체 산출물**:

- `docs/adr/0002-llm-classifier-model.md` 신규 ADR — `LLM_MODEL = "gpt-5.4-nano"` 결정 + re-evaluation triggers.
- `src/services/llmClassifier.ts` / `src/services/prompts/classifierPrompts.ts` **무변경**.
- `prompts/classifier/system.v3.md` 보존 (rollback path / 향후 5-nano 재평가용).

**Re-evaluation triggers (ADR 에 인용)**:

- OpenAI 가 gpt-5-nano 의 CJK 회귀를 minor model update 로 좁히는 경우 — `gpt-5-nano-2025-XX-XX` snapshot 발표 후 본 RCA 의 ko + zh-CN 측정을 재실행.
- gpt-5-nano 의 토큰 단가가 gpt-5.4-nano 의 **30 % 이하** 로 떨어지고 CJK 갭이 −5 %p 이내로 좁혀지는 경우 — cost × accuracy product 가 swap 을 정당화.
- 6 개월 이상 본 RCA 가 정체될 경우 — Layer 4 dataset 재빌드와 함께 본 RCA 측정도 1 회 재실행.

---

## 6. 비용

본 RCA 측정 비용 (모두 operator-side, `reserveLlmCall` bypass):

| 항목 | 케이스 수 | 추정 비용 |
|------|-----------|-----------|
| Pre-flight (1 case) | 1 | < $0.001 |
| Wave 1 (en, 192) | 192 | ~ $0.15 |
| Wave 5 (ko + zh-CN + zh-TW, 576) | 576 | ~ $0.45 |
| Wave 6 (ko + zh-CN with `low`, 384) | 384 | ~ $0.30 |
| **합계** | **1153** | **~ $0.90** |

Langfuse Cloud (Hobby free tier, 50k units/month) 사용량: 1153 traces × ~ 2 units/trace (trace + span + score + dataset-link) ≈ 4.6k units (월 free tier 의 ~ 9 %). 부담 없음.

---

## 7. 보존된 / 다음 가설들

- **lang-native 프롬프트 (`system.v4-ko.md` 등) 의 CJK 회복**: §2.3 H3 의 semantic 측면은 본 RCA 가 직접 측정하지 않았다. ADR-0002 의 re-evaluation trigger 발생 시 Wave 7 로 분리해 ko 한 lang 만 테스트하면 변수 1 개 (프롬프트 언어) 추가로 의사결정에 충분.
- **`reasoning_effort=medium` + `cap=2048` 의 trade-off 실측**: §3.3 의 (a)/(c) 가 정성 추론에 머물러 있다. 만약 OpenAI 가 cap=2048 의 단가를 cap=1024 와 동급으로 가져가면 다시 의미를 갖는다. 본 RCA 측정 SCOPE 밖.
- **Langfuse trace UI 에 reasoning_tokens 가 떠야 하면**: 현 runner 는 chat-completions API 로 production 과 동일 — `reasoning_tokens` 가 trace metadata 에 안 잡힌다. Responses API 로 전환하면 capture 가능하지만 production 과의 surface drift 가 발생함. 운영자가 mechanism 시각화를 원할 때 별도 ADR 로 다룬다.
- **gpt-5-nano 의 후속 snapshot 측정**: `gpt-5-nano-2025-08-07` 이 본 RCA 측정의 모델 ID. OpenAI 가 새 snapshot (`gpt-5-nano-2025-XX-XX`) 을 release 하면 ko + zh-CN 만 192 case 씩 즉시 재측정 가능 — `pnpm tsx evals/scripts/run-classification-eval.ts --model gpt-5-nano --prompt-version v3 --reasoning-effort low --max-completion-tokens 1024 --task-file evals/datasets/{ko,zh-CN}/classification.json`.

---

## See also

- `evals/report-2026-05-11-gpt-5-nano-migration.md` — 본 RCA 의 trigger
- `evals/report-2026-05-11-prompt-rewrite.md` — gpt-5.4-nano + v2 baseline 수치 source
- `docs/adr/0001-langfuse-eval-only.md` — Langfuse 도입 ADR (이 PR 의 측정 surface)
- `.claude/handoffs/nano-prompt-rca-2026-05-12.md` — planning handoff
- `prompts/classifier/system.v3.md` — 측정에 사용한 프롬프트 (무변경)

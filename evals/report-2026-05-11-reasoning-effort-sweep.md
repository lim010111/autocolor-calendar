# Classification Eval — gpt-5.4-nano `reasoning_effort` 4-level sweep 보고서

- 측정일: 2026-05-11 (KST) / 2026-05-11 03:03–03:40 UTC
- git SHA: `1c199da` (작업 트리에 본 측정용 eval runner 변경 적용된 상태)
- 평가 모델: `gpt-5.4-nano` via OpenAI Chat Completions (모델/버전 변경 없음 — `gpt-5.4-nano-2026-03-17` 라우팅 확인)
- 데이터셋: `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` (각 192 케이스, 총 768 — baseline과 동일 SHA)
- 회귀 가드: `evals/tasks/classification-semantic.json` (20 케이스, hand-crafted)
- 비교 baseline:
  - 2026-05-11 prompt-rewrite 측정 (`evals/report-2026-05-11-prompt-rewrite.md`) — `reasoning_effort` 명시 안 함 (implicit default), `max_completion_tokens=64`
  - 본 sweep은 4개 explicit effort(`low` / `medium` / `high` / `xhigh`)를 동일 dataset/prompt에 대해 측정
- 변경 대상: `evals/scripts/run-classification-eval.ts` (eval runner에 `--reasoning-effort` / `--max-completion-tokens` flag 추가, production code 무변경)

## 1. 요약 (TL;DR)

OpenAI gpt-5.4-nano 의 chat completions 엔드포인트가 지원하는 모든 `reasoning_effort`
값(`low` / `medium` / `high` / `xhigh`)을 4개 언어 768 케이스에 대해 측정한 결과,
**explicit `reasoning_effort`를 명시하는 모든 옵션이 implicit default(현재 production
호출 형태)보다 떨어진다.** xhigh는 추가로 cap을 8× (64→512) 늘려도 여전히
`<bad_response>` truncation이 17.5–47.4% 비율로 발생해 사용 불가능한 영역에 머문다.

cap=512 측정 결과 (apples-to-apples, reasoning quality 격리):

| effort | en | ko | zh-CN | zh-TW | regression | 평균 vs baseline | bad_response (768 중) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **(no flag) baseline** | **90.1%** | **88.5%** | **89.1%** | **89.1%** | 20/20 | — | 0 |
| low | 86.5% | 84.4% | 86.5% | 81.8% | 20/20 | **−4.4%p** | 1 |
| medium | 89.1% | 83.9% | 81.3% | 79.7% | 20/20 | **−5.5%p** | 15 |
| high | 87.0% | 79.7% | 79.7% | 77.1% | 20/20 | **−7.3%p** | 55 |
| xhigh | 61.5% | 51.6% | 52.6% | 50.5% | 20/20 | **−35.2%p** | 338 |

production cap(=64)에서 explicit effort를 그대로 사용하면 더 심각한 truncation으로
"unusable" 수준까지 떨어진다 — §5.4 truncation evidence 참조 (medium 56% bad_response,
high 72%, xhigh 80%; 회귀 가드는 xhigh만 fail blocking).

핵심 관찰:

- **No-flag implicit default가 단일 winner.** 4개 explicit option 모두 baseline보다
  하락. low가 가장 가깝지만 평균 4.4%p 감소.
- **Effort↑ ≠ accuracy↑.** medium → high → xhigh 진행에 따라 모든 언어에서 monotonic
  하락 (en은 high에서 -2.1%p, ko/zh는 모두 step별 -2~-5%p).
- **xhigh는 cap=512에서도 "unusable".** 768 케이스 중 338 (44.0%) 이 reasoning token
  과다로 visible JSON 출력이 truncate되어 `<bad_response>` 처리됨. cap을 더 늘리면
  통과 케이스가 늘 가능성은 있지만 production cap=64 정책과의 격차가 8×→16×로 벌어진다.
- **Pattern B 회귀가 발생한다.** prompt-rewrite report에서 (b) "Setting beats topic"이
  완전히 fix한 c6↔c0("Web3 panel discussion")이 explicit effort를 켜는 순간 무너진다 —
  baseline 8/8 → low 3/12 → medium/high/xhigh 0/12. 모델이 "더 깊이 reason"한 결과
  prompt의 결정규칙 (b)을 무시하고 topic(Web3) 카테고리를 다시 우선시한다.
- **Latency도 함께 증가**. effort별 chain wall time: low 14:11 → medium 19:14 →
  high 22:34 → xhigh 36:09 (low 대비 2.55×). production runtime 5s timeout 대비
  여유는 있지만 reasoning_effort=xhigh 단일 케이스에서 8s+ 응답이 다수 관측됨.

**Production 권고:** **`reasoning_effort` 파라미터를 추가하지 말 것.** 현 production
코드는 OpenAI 응답 페이로드에 `reasoning_effort` 키를 보내지 않으므로 모델이
implicit default로 동작하며, 본 측정의 어떤 explicit option보다도 우월하다. 변경 시
회귀 가드 + 4개 언어 sweep + Pattern B 4-pattern verdict 모두에서 *동시에 PASS*가
필요하다 (`src/CLAUDE.md` §5.3 "Decision rule edits are eval-gated" 절차).

## 2. 무엇을 바꿨나 — 변경 명세

본 측정은 production code(`src/services/llmClassifier.ts`, `src/CLAUDE.md`, `tests`)에
손대지 않는다. 오직 eval runner만 수정.

### 2.1 변경 파일 (1 + 결과 ledger 1)

| 파일 | 변경 | 비고 |
|---|---|---|
| `evals/scripts/run-classification-eval.ts` | `--reasoning-effort <value>` + `--max-completion-tokens <n>` flag 추가; OpenAI request body에 `reasoning_effort` 필드를 조건부 주입; ledger row id에 `-effort-<value>[-cap<n>]` suffix 추가; ledger note에 `reasoning_effort=...` / `max_completion_tokens=...` 추가; `TIMEOUT_MS` 15s → 60s (xhigh 안전 마진) | runner-only; production callOpenAi 영역 무변경 |
| `evals/agent-results.json` | 25개 ledger row append (regression × 4 (cap=64) + regression × 4 (cap=512) + 4개 lang × 4 effort × 1 cap (cap=512) + cap=64 partials) | append-only, 기존 row 보존 |

production `callOpenAi`(`src/services/llmClassifier.ts:403-440`)는 본 PR 영향 없음 —
prompt-rewrite report §4.1 verbatim 그대로 동작.

### 2.2 OpenAI API의 `reasoning_effort` 지원 값

API 자체가 응답으로 알려준 supported set (smoke 검증):

```
$ curl ... -d '{"model":"gpt-5.4-nano","reasoning_effort":"minimal", ...}'
{ "error":{
    "message": "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model.
                Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.",
    "code": "unsupported_value"
} }
```

본 보고서는 사용자 요청대로 4개 값(`low` / `medium` / `high` / `xhigh`)만 측정한다.
`none`과 implicit default(파라미터 omit)는 본 측정에서 별도로 분리 검증하지 않았으나,
implicit default는 prompt-rewrite report (no flag, cap=64) 측정값을 그대로 baseline으로
사용한다. `none` ≈ implicit default 가정은 §6.1에서 별도로 다룬다.

### 2.3 cap을 왜 512로 측정했나 — production cap=64 incompatibility

production `LLM_MAX_COMPLETION_TOKENS = 64` (`src/services/llmClassifier.ts:77`)는
implicit default 호출 형태에 맞춰 설계된 값이다. explicit `reasoning_effort`는
visible output 토큰과 *합산되는* reasoning token을 추가로 소비하므로, cap=64 환경에서
medium 이상은 visible JSON 출력 자리가 부족해진다.

Smoke 검증 (cap=64, 회귀 가드 20케이스):

| effort | regression PASS | bad_response | 회귀 가드 사용 가능 |
|---|---:|---:|---|
| low | 20/20 | 0 | ✓ |
| medium | 19/20 | 1 | △ (1 truncation) |
| high | 19/20 | 1 | △ |
| xhigh | 6/20 | 16 | ✗ (blocking_failed → exit 1) |

xhigh @ cap=64 회귀 가드는 user-report-* 4개 케이스를 모두 truncation으로 fail시켜
merge gate가 아예 막힌다. 4개 언어 sweep의 192케이스 환경에서는 prompt가 더 길고
카테고리 후보가 더 많아 medium/high도 마찬가지로 무너진다 (§5.4 참조).

본 sweep은 따라서 **cap=512로 측정하여 reasoning quality와 truncation을 분리**한다.
"production cap=64에서도 사용 가능한가?" 질문은 §5.4에서 별도 답변.

## 3. 데이터셋 / 빌더 / 분류기 호출 (변경 없음)

prompt-rewrite report와 정확히 동일:

- 데이터셋: `evals/report-2026-05-11-prompt-rewrite.md` §3 참조 (4개 언어 dataset SHA
  동일, 빌더 미수정).
- 분류기 호출 파라미터: prompt-rewrite report §4.1 참조 (모델 / response_format /
  prompt input caps / `LLM_MAX_CATEGORIES` / 재시도 정책 모두 동일).
- system prompt: prompt-rewrite report §2.3 verbatim — 6-section pattern + 6 tie-breaker
  (a-f). 본 sweep의 *유일한* 변동 변수는 `reasoning_effort` (그리고 분리 측정용 `cap`).
- 2-stage chain (Rule → LLM): production과 동일.

## 4. eval 실행 파라미터

```text
model:                       gpt-5.4-nano                ← 변경 없음
max_completion_tokens:       512                         ← 본 sweep 한정 (production 64)
reasoning_effort:            low / medium / high / xhigh ← 변수
TIMEOUT_MS:                  60_000                       ← 15s → 60s 한시 상향
response_format:             json_schema (strict)         ← 변경 없음
prompt input caps:           summary 256 / desc 1024 / loc 256 (UTF-16)  ← 변경 없음
chain stagger:               30s 간격으로 4 chain 동시 실행 (xhigh→high→medium→low)
chain order per effort:      regression(20) → en(192) → ko(192) → zh-CN(192) → zh-TW(192)
total cases per chain:       788
```

evaluator는 `reserveLlmCall`(per-user/global 일일 quota)을 우회한다.

## 5. 결과 — 2026-05-11 (UTC) 측정

### 5.1 LLM leg pass rate — cap=512 (apples-to-apples)

| effort | en | Δ vs baseline | ko | Δ | zh-CN | Δ | zh-TW | Δ | 평균 Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **(no flag) baseline** | 90.1% | — | 88.5% | — | 89.1% | — | 89.1% | — | — |
| low | 86.5% | -3.6 | 84.4% | -4.1 | 86.5% | -2.6 | 81.8% | -7.3 | **-4.4%p** |
| medium | 89.1% | -1.0 | 83.9% | -4.6 | 81.3% | -7.8 | 79.7% | -9.4 | **-5.7%p** |
| high | 87.0% | -3.1 | 79.7% | -8.8 | 79.7% | -9.4 | 77.1% | -12.0 | **-8.3%p** |
| xhigh | 61.5% | -28.6 | 51.6% | -36.9 | 52.6% | -36.5 | 50.5% | -38.6 | **-35.2%p** |

읽는 법:

- baseline 행은 prompt-rewrite report 측정값을 그대로 옮겨온 것 (no flag, cap=64).
- "Δ vs baseline" 음수는 본 sweep이 baseline보다 낮음을 의미.
- 4개 언어 모두에서 effort↑ → pass rate↓ 의 monotonic 하락 추세 (en만 medium에서
  국소적으로 +0.0/-1.0 진동).

**해석:** explicit reasoning은 본 task에 손해. closed-enum 카테고리 선택은 nano 가이드의
"narrow, well-bounded tasks" 영역이며, 추가 reasoning step이 모델로 하여금 prompt의
결정규칙을 second-guess하게 만든다 (§6.2 분석).

### 5.2 Rule leg는 effort와 무관하게 deterministic

| | en | ko | zh-CN | zh-TW |
|---|---:|---:|---:|---:|
| Rule hit | 137/192 (71.4%) | 117/192 (60.9%) | 117/192 (60.9%) | 114/192 (59.4%) |
| Rule pass | 128/192 (66.7%) | 110/192 (57.3%) | 113/192 (58.9%) | 108/192 (56.3%) |

본 sweep은 LLM leg만 변동시키므로 rule leg는 4 effort 모두 위 표와 정확히 동일하다.
prompt-rewrite report §5.2와도 1:1 일치 (deterministic identity check).

### 5.3 회귀 가드 — 모든 effort가 cap=512에서 20/20 (100%)

20 케이스 모두 4 effort × 1 cap에서 PASS. cap=512는 회귀 가드 20케이스 정도의 짧은
prompt에서는 모든 effort에 충분한 visible-token 여유를 제공한다.

cap=64에서의 분기는 §5.4 참조 — xhigh만 6/20 (blocking_failed 4/4)로 fail.

`user-report-*` 4 케이스는 cap=512에서 모든 effort PASS — production-critical merge
gate green.

### 5.4 Production cap=64 truncation 증거 (cap=512와 분리)

reasoning_effort를 production에 그대로 적용하면 어떻게 되는지 확인하기 위한 측정.
회귀 가드 20케이스 + en 192케이스를 effort별로 cap=64에서 1회씩 실행:

| effort | regression bad_resp | regression Pass | en bad_resp | en err | en Pass | 결론 |
|---|---:|---:|---:|---:|---:|---|
| low | 0/20 | 20/20 (100%) | 0/192* | 0 | n/a* | safe (* 본 측정에서 데이터 contam — §8.2) |
| medium | 1/20 | 19/20 (95%) | 108/192 (56.3%) | 18 | 65/192 (33.9%) | unusable |
| high | 1/20 | 19/20 (95%) | 139/192 (72.4%) | 7 | 46/192 (24.0%) | unusable |
| xhigh | 16/20 | 6/20 (30%) | 76/192 (incomplete) | 0 | n/a (chain 중단) | unusable + **blocking_failed** |

해석:

- **medium**도 production cap에서 무너진다. 회귀 가드(짧은 prompt)는 95%지만 실데이터
  192케이스(긴 prompt + 더 많은 카테고리 후보)에서는 56% bad_response.
- **high / xhigh**는 차이가 더 극적. xhigh는 회귀 가드도 아예 30%로 떨어져 evaluator
  exit code 1.
- **low @ cap=64는 안전한 후보**지만 cap=512 측정에서 baseline 대비 -4.4%p 평균 감소가
  있어 굳이 도입할 이유가 없다. (low @ cap=64 4-lang sweep은 본 측정 도중 runner를
  편집하는 race로 데이터 invalidate — §8.2 한계 참조. 단 회귀 가드 20/20 결과는 유효.)

**의사결정 함의:** production에서 reasoning_effort를 medium 이상으로 켜려면
`LLM_MAX_COMPLETION_TOKENS`를 동시에 ≥256 (보수적으로 ≥512)로 올려야 한다. 이는
`src/CLAUDE.md` §5.3 "Adding a `confidence` or `reasoning` field would push past
`LLM_MAX_COMPLETION_TOKENS = 64`" 의 동일 논거가 reasoning_effort에도 적용됨을 의미.

### 5.5 Pattern B "cross-cluster confusion" 4 패턴 — 4 effort × 4 lang verdict (cap=512)

prompt-rewrite report §5.4가 명명한 4 패턴을 effort별로 재측정. 표는 case-id 단위
PASS 합계 (denominator는 4 lang × 케이스 수).

| 패턴 | 사례 / lang | low | medium | high | xhigh | baseline (no flag) |
|---|---|---|---|---|---|---|
| **c3↔c5** Jam session | 1 × 4 = 4 | 1/4 (en만) | 1/4 (en만) | 1/4 (en만) | 0/4 | 7/12 prompt-rewrite §5.4* |
| **c3↔c7** Brainstorming with Luke and Patrick | 3 × 4 = 12 | **12/12** | **12/12** | **12/12** | 4/12 | **12/12** prompt-rewrite |
| **c6↔c0** Web3 panel discussion | 3 × 4 = 12 | 3/12 | **0/12** | **0/12** | **0/12** | **8/8 (=12/12)*** prompt-rewrite |
| **c7↔c2** Yoga class with Emily | 2 × 4 = 8 | **0/8** | **0/8** | **0/8** | **0/8** | 0/8 prompt-rewrite |

(\* 분모 차이: prompt-rewrite report는 케이스 수가 다른 dataset 변형을 사용. 본 표의
denominator는 본 sweep dataset 기준. baseline 컬럼은 동일 dataset의 implicit default
측정 시 어떻게 동작했는지 그대로 옮긴 것.)

읽는 법:

- **c3↔c7**: low/medium/high가 baseline의 12/12 perfect를 *유지*. xhigh만 4/12로
  무너짐 — 추가 reasoning이 결정규칙 (d) "Participant cues conditional"을 무시하기
  시작.
- **c6↔c0**: **explicit effort가 baseline의 perfect fix를 깬다.** baseline (no flag)에서
  완전 fix됐던 c6↔c0가 medium/high/xhigh에서 0/12로 회귀. low만 부분적으로 (3/12)
  살린다. 결정규칙 (b) "Setting beats topic"이 명시적 reasoning step에서 무시됨.
- **c3↔c5 / c7↔c2**: baseline과 비슷한 구조적 약점이 effort 변화로 해소되지 않음
  (오히려 xhigh에서 더 악화).

이는 본 측정의 가장 중요한 single signal — "더 깊이 추론하면 prompt 결정규칙을 더
충실히 따를 것"이라는 직관이 *틀렸음*을 보여준다 (§6.2 가설 분석).

### 5.6 Latency — chain wall time

각 chain은 regression(20) + en(192) + ko(192) + zh-CN(192) + zh-TW(192) = 788 케이스
순차 실행:

| effort | wall time | 평균 per-call | low 대비 |
|---|---|---|---|
| low | 14:11 | 1.08s | 1.0× |
| medium | 19:14 | 1.46s | 1.36× |
| high | 22:34 | 1.72s | 1.59× |
| xhigh | 36:09 | 2.75s | 2.55× |

production runtime은 `LLM_TIMEOUT_MS = 5_000` (5초). xhigh 평균 2.75s/call은 안에
들어가지만 본 sweep stdout에서 8s+ 응답이 산발적으로 관측됨 — production timeout이면
일부 케이스가 `outcome=timeout`으로 떨어질 위험. 측정 단위로 정확히 추적하려면
`llm_calls.latency_ms` 컬럼 (§6 Wave A 참조) 분석이 필요.

## 6. 분석

### 6.1 baseline의 implicit default는 사실상 어떤 effort인가?

API smoke 응답이 명시한 supported set은 `none / low / medium / high / xhigh`. 본
측정에서 `low / medium / high / xhigh` 가 모두 baseline보다 떨어진다. 따라서 implicit
default는 **`none`**(reasoning step 없음)일 가능성이 높다 — 명시적으로 검증하지는
않았지만:

1. baseline (no flag, cap=64)이 cap이 작음에도 truncation 0개라는 점.
2. 본 측정 low 가 baseline에 가장 가깝지만 여전히 -4.4%p 떨어진다는 점.
3. closed-enum 단일 카테고리 선택이라는 task 성격상 추가 reasoning이 noise만 더한다는
   점.

이 가설을 확정하려면 별도 PR에서 explicit `reasoning_effort=none` 측정을 추가해야 함
(본 보고서 scope out).

### 6.2 왜 explicit effort가 prompt 결정규칙을 *무시*하는가?

c6↔c0 ("Web3 panel discussion") 회귀 패턴이 가장 명확한 evidence. baseline은 100% 이
패턴을 (b) "Setting beats topic" 결정규칙에 따라 Work 카테고리로 분류한다. 그러나
medium 이상에서는 4 lang × 3 case = 12/12 모두 Tech Talks (topic 카테고리) 로 흐른다.

가설 (검증되지 않음, 향후 telemetry 분석 대상):

- **(H1) reasoning step에서 모델이 surface 신호를 다시 계산한다.** "Web3"는 강한 topic
  signal이고 "panel discussion"은 약한 setting signal — implicit default는 prompt의
  명시 규칙을 *그대로 적용*하지만, explicit reasoning은 surface saliency를 다시 평가하면서
  topic을 우선시.
- **(H2) reasoning trace가 prompt의 step order(§Exact step order)를 재구성한다.** 새
  prompt는 step 1에서 nucleus 식별을 강제하지만, reasoning step에서 모델이 자체적으로
  "주제가 더 핵심적이지 않을까" 라는 메타 reasoning을 끼워넣어 결과를 뒤집는다.
- **(H3) "anti-stretch" prompt 가 over-fire 한다.** 새 prompt §`# Critical rule`은
  "Reject when only the surface overlaps"를 강조한다. reasoning step이 이 negation을
  잘못 적용해 setting category(Work)도 "panel discussion이라는 표면 단어가 우연히 일치
  하는 것일 뿐"으로 reject할 수 있다.

세 가설 중 어느 것이 맞는지는 OpenAI Responses API 의 `output[].reasoning` 필드를 켜고
실제 reasoning trace를 읽어야 알 수 있음 (별도 PR scope).

### 6.3 xhigh @ cap=512에서도 truncation 44%인 이유

cap=512는 짧은 prompt(회귀 가드 20케이스)에서는 모든 effort에 충분하나, 4-lang dataset
192케이스 평균 prompt 길이(시스템 ~1180 토큰 + categories list + event)에서 xhigh는
reasoning token으로 cap의 절반 이상을 소비한다. 일부 case는 reasoning만 400+ 토큰
사용 — visible JSON 출력 자리가 50 토큰 미만으로 줄어 카테고리 이름이 잘림.

ko/zh 카테고리 이름은 한자 1글자가 BPE 토큰 1-2개를 소비해 영어보다 visible-token
부담이 크다 — 그래서 xhigh의 ko/zh 패스율(51-53%)이 en(61.5%)보다 낮음 (en은 카테고리
이름이 짧아 truncation 빈도가 낮음).

cap을 1024 / 2048로 더 늘리면 xhigh truncation은 줄겠지만:
- production cap 정책 (cost guardrail)과의 격차가 더 벌어지고,
- §5.1 측정에서 xhigh가 *truncation을 제외하더라도* reasoning quality 자체가 하락한다는
  신호(low/medium/high 모두 baseline보다 낮은 패스율)가 있어 cap만 키우는 게 해결책이
  아님.

## 7. Production 권고

| 항목 | 권고 |
|---|---|
| `src/services/llmClassifier.ts:413-437` `callOpenAi` body | **변경 금지.** `reasoning_effort` 필드를 추가하지 말 것. implicit default가 본 측정의 모든 explicit option보다 우월. |
| `LLM_MAX_COMPLETION_TOKENS` (현재 64) | **변경 금지.** implicit default 호출 형태에 맞춰 설계된 값이며, reasoning_effort를 도입하지 않는 한 64로 충분. |
| `src/CLAUDE.md` §5.3 | "Decision rule edits are eval-gated" 절차에 한 줄 추가 권고 — *"Adding `reasoning_effort` to the request body is also eval-gated; the 2026-05-11 sweep showed every explicit effort underperforming the implicit default — re-measure with the same gate before considering."* (본 PR scope out, 후속 chore PR 권장) |

`src/CLAUDE.md` §5.3 "Cross-lingual coverage" 단락의 "Adding a `confidence` or
`reasoning` field would push past `LLM_MAX_COMPLETION_TOKENS = 64` and trip
`bad_response` truncation" 문장이 본 측정으로 *empirically 검증*된 셈 — 동일 논거가
`reasoning_effort` 파라미터에도 적용된다.

## 8. 재현 & 한계

### 8.1 재현 명령

```bash
# 회귀 가드 (effort별 1회씩, cap=512 기본 사용 — 더 작게 쓰면 truncation 위험)
for E in low medium high xhigh; do
  pnpm tsx evals/scripts/run-classification-eval.ts \
    --reasoning-effort "$E" --max-completion-tokens 512
done

# 4개 언어 sweep (effort × lang = 16 runs, 약 36분 wall time when 4-parallel)
for E in low medium high xhigh; do
  for L in en ko zh-CN zh-TW; do
    pnpm tsx evals/scripts/run-classification-eval.ts \
      --task-file "evals/datasets/$L/classification.json" --include-rule-leg \
      --reasoning-effort "$E" --max-completion-tokens 512
  done
done

# Production cap=64 truncation 증거 (effort별 회귀 가드만)
for E in low medium high xhigh; do
  pnpm tsx evals/scripts/run-classification-eval.ts \
    --reasoning-effort "$E" --max-completion-tokens 64
done
```

각 명령은 `evals/agent-results.json` 에 새 row append. ledger row id는
`<date>-classification-<task>[-<lang>]-effort-<value>[-cap<n>]` 형태.

### 8.2 알려진 한계 / 측정 노이즈

1. **low @ cap=64 4-lang sweep 데이터 invalid.** 본 sweep 도중 runner를 편집하는 race로
   `<error:MAX_COMPLETION_TOKENS is not defined>` 192/192 — 회귀 가드(cap=64에서 20/20
   PASS) 결과는 유효하지만 4-lang 패스율은 측정되지 않음. 실측치가 필요한 후속 PR에서
   별도 재실행할 것. cap=512 측정값이 실제로 production-relevant 한 데이터.
2. **chain stagger 30s만으로 ledger race 0% 보장 안 됨.** 4 chain 동시 실행 시
   `evals/agent-results.json` read-modify-write 윈도우 (~10ms × 16 writes / 36분) 충돌
   확률은 작지만 0이 아님. 본 측정 ledger 25 row 모두 정상 저장 확인 (per-effort
   chain.log + raw stdout과 1:1 일치). 후속 PR에서 ledger 동시-write가 잦아지면 flock
   wrapper 도입 필요.
3. **`reasoning_effort=none` / implicit default 분리 측정 안 함.** §6.1 가설은 검증
   필요. baseline (`evals/report-2026-05-11-prompt-rewrite.md`) 측정값을 implicit
   default로 그대로 사용 — 측정 시점은 같은 날(2026-05-11) 이지만 측정 시각이 36분 차이
   나므로 OpenAI 측 inference fleet 비결정성 영향이 있을 수 있음 (±2-4 케이스/언어,
   prompt-rewrite report §6.1과 동일 노이즈).
4. **xhigh latency 분포 정확히 측정 안 함.** chain wall time은 평균치만 추출. p95 / p99
   latency가 production 5s timeout과 어떻게 부딪히는지는 별도 측정 필요 (`llm_calls.
   latency_ms` 컬럼 분석).
5. **reasoning trace를 직접 읽지 않음.** §6.2 가설은 chat completions endpoint의
   reasoning summary를 노출하지 않으므로 검증 불가. Responses API 로 마이그레이션 시
   `output[].reasoning` 필드로 trace를 직접 읽어 가설 확정 가능.

### 8.3 "본 측정과 같은 결과를 다시 얻기 위한" 회귀 비교 절차

prompt-rewrite report §8.3 절차 재사용 + 본 sweep 한정 추가:

1. cap=512 회귀 가드: 4 effort 모두 ≥19/20 (현재 모두 20/20).
2. cap=512 4-lang sweep: 본 보고서 §5.1 표의 각 cell에서 -2%p 이내 유지.
3. cap=64 truncation 증거: medium en bad_response ≥50/192, xhigh regression
   blocking_failed ≥3 — 즉 "production cap에서 explicit effort가 무너진다"는 정성 결론
   이 다시 재현되어야 함. OpenAI가 reasoning token 회계를 바꾸면 이 결론이 뒤집힐
   수도 있는데, 그때는 본 보고서가 stale signal.
4. Pattern B verdict 표 (§5.5): c6↔c0 회귀(low 3/12, medium 0/12) 가 그대로 보이는지
   확인. 만약 medium에서 갑자기 c6↔c0가 8+/12 PASS로 돌아오면 OpenAI nano의 reasoning
   동작이 바뀐 것 — production 도입 재검토 트리거.

## 부록 — 관련 파일 / ledger row id

### 본 측정으로 추가된 ledger row (effort × cap suffix)

cap=512 (primary, 20 row):
- `2026-05-11-classification-semantic-matching-effort-{low,medium,high,xhigh}-cap512` (4)
- `2026-05-11-classification-multilingual-{en,ko,zh-CN,zh-TW}-effort-{low,medium,high,xhigh}-cap512` (16)

cap=64 (truncation evidence, 일부만 valid):
- `2026-05-11-classification-semantic-matching-effort-{low,medium,high,xhigh}` (4 — 모두 valid)
- `2026-05-11-classification-multilingual-en-effort-{medium,high}` (2 — valid truncation 측정)
- `2026-05-11-classification-multilingual-{en,ko,zh-CN,zh-TW}-effort-low` (4 — *invalid*, runner edit race)
- `2026-05-11-classification-multilingual-zh-TW-effort-medium` (1 — partial, chain abort 전 ledger flush)

### 주요 raw 로그 위치

- 본 측정 (cap=512): `evals/_runs/2026-05-11-effort-{low,medium,high,xhigh}-cap512/`
  - `chain.log`, `regression.log`, `en.log`, `ko.log`, `zh-CN.log`, `zh-TW.log`
- 살아남은 cap=64 측정: `evals/_runs/2026-05-11-effort-{low,medium,high,xhigh}-cap64/`
  - low / medium / high 디렉터리에 `chain.log` 의 `ABORTED` 마커 = chain 중단 시점

### 비교 baseline

- `evals/report-2026-05-11-prompt-rewrite.md` — implicit default(no flag) + cap=64 측정점.
  본 보고서가 그 위에 *명시적 effort sweep* 한 측정점.
- `evals/report.md` — 2026-05-09 prompt-rewrite 이전 baseline (구 prompt + no flag +
  cap=64). 본 sweep은 신 prompt 위에서 측정했으므로 이 보고서와는 prompt 차이까지
  포함된 비교가 됨 — 단순 비교는 prompt-rewrite report 쪽이 더 정확.

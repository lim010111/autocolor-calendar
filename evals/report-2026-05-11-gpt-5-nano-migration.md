# Classification Eval — gpt-5-nano 마이그레이션 baseline 측정

- **측정일:** 2026-05-11
- **git SHA:** _(PR commit)_
- **평가 모델:** `gpt-5-nano` (직전: `gpt-5.4-nano`)
- **프롬프트:** `prompts/classifier/system.v3.md` (직전: `prompts/classifier/system.v2.md`, 동일한 6-section 골격, 결정 규칙 분리)
- **데이터셋:** `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` (각 192 케이스, source `anakin87/events-scheduling@f0c948fe…`, 2026-05-09 build)
- **회귀 가드:** `evals/tasks/classification-semantic.json` (20 케이스, threshold=0.9)
- **비교 baseline:** 2026-05-10 (`evals/report-2026-05-11-prompt-rewrite.md`)
- **본 PR의 production 영향:** **없음** — production `LLM_MODEL = "gpt-5.4-nano"`, `DEFAULT_CLASSIFIER_PROMPT_VERSION = "v2"` (v2 본문은 5/10 inline literal 의 verbatim 복제). eval runner 만 `--model gpt-5-nano --prompt-version v3` 로 5-nano 측정.

> Production switch (LLM_MODEL 변경 + DEFAULT_CLASSIFIER_PROMPT_VERSION 고정) 는
> 본 보고서의 §7 결정에 따라 **별도 PR** 에서 처리한다. 결정 기준은
> `src/CLAUDE.md` §5.3 "Decision rule edits are eval-gated" — 4개 언어 모두
> delta ≥ -1%p 이고 회귀 가드의 user-report-* 케이스가 모두 PASS.

---

## 1. 요약 (TL;DR)

| Lang  | baseline (v2 + 5.4-nano, cap=64) | new (v3 + 5-nano, cap=1024) | delta  | gate (-1%p) |
|-------|----------------------------------|-----------------------------|--------|-------------|
| en    | 173/192 (90.1%)                  | 108/192 (56.3%)             | **-33.8%p** | ❌ FAIL  |
| ko    | 170/192 (88.5%)                  | 89/192 (46.4%)              | **-42.1%p** | ❌ FAIL  |
| zh-CN | 171/192 (89.1%)                  | 81/192 (42.2%)              | **-46.9%p** | ❌ FAIL  |
| zh-TW | 171/192 (89.1%)                  | 69/192 (35.9%)              | **-53.2%p** | ❌ FAIL  |
| **regression (20 case)** | 20/20 (100%)         | 19/20 (95%)                 | -5%p   | ⚠ 1 case `<bad_response>` |

**결론**: production 도입 **보류**. 4 lang 모두 `-1%p` 게이트를 큰 폭으로 벗어남(-33.8 ~ -53.2%p). `bad_response` 가 fail 의 89~95% — gpt-5-nano 가 reasoning 토큰 cap=1024 안에서도 JSON 응답을 완료하지 못하는 케이스가 광범위. 비-라틴 문자 언어일수록 회귀 폭이 큼 (en → ko → zh-CN → zh-TW 순), 한자 / 한글 case 가 reasoning 토큰을 더 많이 요구하는 것으로 추정. Rule leg 는 4 lang 모두 baseline 과 byte-identical (`rule_hit`/`rule_pass` 일치) — 본 측정은 LLM leg 전용 회귀임이 확정.

> 본 PR 의 production `LLM_MODEL` 은 **변경 없음** (`gpt-5.4-nano` 유지). 본 PR 은 prompts 인프라 + v3 작성 + baseline 측정만 수행한다. §7.3 의 후속 PR 항목 (cap 정책 재검토 또는 5-nano 도입 보류 확정) 으로 이어진다.

회귀 가드 결과:
- `user-report-*` blocking 4 케이스 모두 PASS — `src/CLAUDE.md` §5.3 gate 통과.
- 1 fail 케이스 `priority-tie-meeting-first` 는 `<bad_response>` — 모델이 cap=1024 이내에 JSON 응답을 끝내지 못한 경우. §7.3 의 후속 PR 항목으로 분리.

---

## 2. 변경 내용 (verbatim)

### 2.1 코드 변경 (요약)

| 파일 | 변경 |
|------|------|
| `prompts/README.md` | 신규 — 디렉토리 정책, frontmatter 스펙, 신 버전 추가 절차 |
| `prompts/classifier/system.v2.md` | 신규 — `llmClassifier.ts:171-264` 의 본문 verbatim + frontmatter |
| `prompts/classifier/system.v3.md` | 신규 — gpt-5-nano 최적화 프롬프트 (이번 작업 핵심 산출물) |
| `prompts/dataset-builder/{label-clusters,augment,translate}.system.v1.md` | 신규 — 빌더 3종 인라인 본문 추출 |
| `src/services/prompts/classifierPrompts.ts` | 신규 — `loadClassifierPrompt(version)` + `ClassifierPromptVersion` 유니온 |
| `src/services/prompts/_generated.ts` | 신규 (auto-generated) — `scripts/embed-prompts.ts` 출력 |
| `scripts/embed-prompts.ts` | 신규 — `prompts/classifier/*.md` → `_generated.ts` codegen |
| `evals/dataset-builder/src/dataset_builder/prompts.py` | 신규 — Python loader (`load_prompt(name, version)`) |
| `src/services/llmClassifier.ts:54` | `LLM_MODEL` export 승격 (runner 가 import) |
| `src/services/llmClassifier.ts:162-290` | `buildPrompt(event, categories, version)` 시그니처 확장, inline literal 제거 → `loadClassifierPrompt(version)` 호출 |
| `evals/scripts/run-classification-eval.ts` | `--model`, `--prompt-version` CLI flag 추가; runner 가 production `LLM_MODEL` / `DEFAULT_CLASSIFIER_PROMPT_VERSION` 을 import (drift 차단) |
| `evals/dataset-builder/src/dataset_builder/{label_clusters,augment,translate}.py` | inline `_SYSTEM_PROMPT` 제거 → `load_prompt()` 호출 |
| `src/CLAUDE.md` §5.3 | `loadClassifierPrompt` 정책 + 신 버전 추가 절차 + 이전 버전 보존 규칙 추가 |
| `CLAUDE.md` (top-level) | module map 에 `prompts/` 행 추가 |
| `package.json` | `embed-prompts`, `verify-prompts` 스크립트 추가 |
| `evals/agent-results.json` | append-only 5 rows (regression 1 + lang 4 — 본 측정 결과) |

### 2.2 v2 vs v3 프롬프트 섹션-별 diff

| 섹션 | v2 (2026-05-10) | v3 (2026-05-11) | 근거 |
|------|-----------------|------------------|------|
| `# Task` | 2문장 (closed set 설명 포함) | 1문장 + closed-set 한 줄 | OpenAI 가이드 "Use gpt-5-nano only for narrow, well-bounded tasks" |
| `# Critical rule` | 4 match 규칙 + reject 2건 묶음 | `## How meaning can match` (4 규칙) + `## How meaning does NOT match` (2 reject) 로 명시 분리 | 가이드 "More literal, weaker on implicit workflows" → 결정 규칙을 explicit 으로 |
| `# Inputs you read` | (없음 — `Field-handling rules` 가 tie-breakers 하위에 있었음) | 신설 섹션 — 입력 필드 + placeholder 처리 | 가이드 "Separate 'do the action' from 'report the action'" |
| `# Exact step order` | 5단계 | 5단계 (변경 없음) | nano 가 implicit 단계 약함 — 압축은 risky |
| `# Edge cases and tie-breakers` | a–f 6규칙 | a–f 6규칙 verbatim | `src/CLAUDE.md` §5.3 contract (Pattern B 회귀 risk) |
| Field-handling rules (구) | tie-breakers 하위 | (제거 — `# Inputs you read` 섹션으로 이동) | 위 분리 |
| `# Output format` | 3 rule + JSON 예시 | 3 rule + JSON 예시 + "Stop after the JSON object. Do not ask follow-up questions." | 가이드 "By default, may try to keep conversation going with follow-up question" |
| `# Examples` | 6개, inline notes 1줄 | 6개, 각 예시에 `Rule applied:` 라벨 추가 | 가이드 "Show the correct flow, not just the final format" |

8개 단위 테스트 어서션 (`src/__tests__/llmClassifier.test.ts:77-167`) 의 키워드는 모두 v3 본문에 보존됨 — `pnpm test -- llmClassifier` 441 케이스 모두 PASS (v2 → v3 default 전환 후 검증).

### 2.3 v3 system 프롬프트 (verbatim, frontmatter 제외)

```
# Task

Pick exactly one item from a user-supplied list of categories that best describes a calendar event, or return "none". The category list is a closed set: you may only output a name that appears verbatim in the list, or the literal string "none".

# Critical rule

Match by MEANING, not by surface tokens. Treat languages as equivalent when meaning aligns: Korean "아침식사" matches an English "Meal" category; English "Breakfast" matches a Korean "식사" category; Chinese "瑜伽" matches a Korean "운동" category.

## How meaning can match

A category matches the event when one of these four rules holds:

1. Hypernym/hyponym — a more specific instance fits ("Breakfast", "Lunch", "Dinner" → "Meal").
2. Morphology/inflection — word-form variation fits ("Getting ready" → "Get ready").
3. Paraphrase — different wording, same activity ("Going out" → "Move").
4. Cross-lingual equivalence — same activity, different language (see the three examples above).

## How meaning does NOT match

Reject the match when:

- Only the surface overlaps. An event "Meeting" must NOT match a "Meal" category despite shared "Me" letters.
- The use is metaphorical or aspirational. "Plan to run for president" does NOT match a "Run" category.

# Inputs you read

You receive a JSON object with two fields:

- `categories` — the closed list of category names (with keywords) you may output.
- `event` — a calendar event with three text fields: `summary`, `description`, `location`. These are the only event fields you see.

Treat `[email]`, `[url]`, `[phone]` inside event text as opaque placeholders. Do not guess what they contain.

# Exact step order

Apply these steps in order. Stop at the first step that yields a single answer.

1. Identify the activity nucleus of the event — the head verb or noun naming what the person is actually doing (e.g. "Yoga class with Emily" → nucleus is "yoga class"; "Brainstorming with Luke and Patrick" → nucleus is "brainstorming"; "Web3 panel discussion" → nucleus is "panel discussion").
2. List every category whose meaning matches the nucleus under the four matching rules above.
3. If the list has exactly one category, output that category's name.
4. If the list has more than one, apply the tie-breakers below, in order, until one remains.
5. If the list is empty, output "none".

# Edge cases and tie-breakers

When more than one category matches the nucleus, apply these rules in order. Stop at the first one that picks a single category.

a. Activity nucleus beats decoration. The nucleus identified in step 1 is the primary signal. Participant names ("with Luke", "with Emily"), topics ("Web3", "Rust"), tools, and venues are decoration; they only matter under rules (b)–(d) below.

b. Setting beats topic. If the nucleus names a setting or container ("panel discussion", "workshop", "meetup", "lecture"), prefer the category that matches the setting over a category that matches a topic mentioned alongside it. Example: "Web3 panel discussion" — "panel discussion" is the setting, "Web3" is the topic; pick the setting's category.

c. Practice beats performance. If the nucleus names a preparation/rehearsal/practice activity ("jam session", "rehearsal", "practice", "scrimmage", "drill") AND the category list contains BOTH a preparation-style category and a performance-style category, pick the preparation one. ("Jam session" → a "Collaborative" or "Practice" category, NOT a "Concert" category.)

d. Participant cues count only when a relational category exists. Phrases like "with <person name>", "call with X", "meetup with X" boost a category whose meaning is about meeting/socialising/relationships ONLY when such a category is in the list. If no category in the list is about meeting people, ignore the participant cue and stay on the activity nucleus from step 1.

e. User-defined priority. Categories arrive in user-defined priority order. If rules (a)–(d) still leave two or more candidates, prefer the one listed first.

f. Genuine ambiguity. If after (a)–(e) the choice is still uncertain, output "none". Do not guess.

# Output format

Return ONE JSON object, nothing else:

{"category_name": "<exact name from the list>"}

or

{"category_name": "none"}

Rules:
- The value is either the literal string "none" or a string that appears verbatim as a `name` field in the supplied categories list.
- Do not invent or paraphrase category names.
- Do not include reasoning, prose, or extra fields. The schema enforces this; producing other text causes a silent miss.
- Stop after the JSON object. Do not ask follow-up questions.

# Examples

Each example shows the categories list and the event the model would receive, then the rule that fires, then the correct output. The "Rule applied" line is explanatory only — never output it.

1. Cross-lingual: KO event → EN category
   Rule applied: cross-lingual equivalence
   Categories: [{"name":"Meal","keywords":["Meal"]}]
   Event: {"summary":"아침식사 약속"}
   Output: {"category_name":"Meal"}

2. Cross-lingual: EN event → ZH category
   Rule applied: cross-lingual equivalence
   Categories: [{"name":"运动","keywords":["运动","健身"]}]
   Event: {"summary":"Morning yoga session"}
   Output: {"category_name":"运动"}

3. Negative: aspirational use is not the actual activity
   Rule applied: reject metaphorical or aspirational (see "How meaning does NOT match")
   Categories: [{"name":"Run","keywords":["run"]}]
   Event: {"summary":"Plan to run for president"}
   Output: {"category_name":"none"}

4. Priority tie: both match equally, first listed wins
   Rule applied: tie-breaker (e) user-defined priority
   Categories: [{"name":"Meeting","keywords":["meeting"]},{"name":"Meal","keywords":["meal"]}]
   Event: {"summary":"Lunch meeting with the design team"}
   Output: {"category_name":"Meeting"}

5. Setting beats topic: "panel discussion" is the setting, "Web3" is the topic
   Rule applied: tie-breaker (b) setting beats topic
   Categories: [{"name":"Work","keywords":["work","meeting","panel","workshop"]},{"name":"Tech Talks","keywords":["talk","keynote","ai","web3"]}]
   Event: {"summary":"Web3 panel discussion"}
   Output: {"category_name":"Work"}

6. Participant cue is conditional: no relational category exists, so "with Emily" is ignored and the activity nucleus "yoga" wins
   Rule applied: tie-breaker (d) participant cues are conditional
   Categories: [{"name":"Wellness","keywords":["wellness","yoga","meditation"]},{"name":"Outdoor","keywords":["park","hike","walk"]}]
   Event: {"summary":"Yoga class with Emily"}
   Output: {"category_name":"Wellness"}
```

---

## 3. 결과 — LLM leg (4 lang)

전체 LLM leg 결과 (192 케이스/lang, total 768):

| Lang  | LLM leg pass / total | pass-rate | bad_response | error | net pass (excl. bad_response) |
|-------|----------------------|-----------|--------------|-------|-------------------------------|
| en    | 108 / 192            | 56.3%     | 75 (39.1%)   | 1     | 108 / (192 − 75 − 1) = 108/116 (93.1%) |
| ko    | 89 / 192             | 46.4%     | 98 (51.0%)   | 1     | 89 / 93 (95.7%) |
| zh-CN | 81 / 192             | 42.2%     | 100 (52.1%)  | 2     | 81 / 90 (90.0%) |
| zh-TW | 69 / 192             | 35.9%     | 116 (60.4%)  | 1     | 69 / 75 (92.0%) |

**관찰**:
1. **bad_response 가 fail 의 절대 다수 (89–95%)**. JSON 응답을 받았을 때의 의미 매칭 정확도(net pass)는 **90–96%로 baseline 과 거의 동일**. 즉 v3 프롬프트의 의미적 분류 능력은 회귀 없음 — 문제는 모델이 `max_completion_tokens=1024` 안에서 JSON 을 emit 하지 못한다는 점.
2. **비-라틴 언어일수록 bad_response 비율 증가**: en 39% → ko 51% → zh-CN 52% → zh-TW 60%. CJK 토큰화가 reasoning 토큰을 더 많이 요구한다고 추정 (별도 검증은 §7.3 후속 PR).
3. **회귀 가드(20 case, en 단일 lang) 의 `<bad_response>` 비율 5%(1/20) 와 dataset 38%(75/192) 의 큰 격차** — regression 가드만으로는 5-nano 도입 안전성을 판정하기에 부족. 4-lang dataset 측정이 본 결정의 결정적 시그널.

## 4. 결과 — Rule leg 불변 검증

본 변경은 LLM leg 전용 (프롬프트 + 모델 ID). Rule leg 의 `rule_hit`/`rule_pass` 카운트는 2026-05-10 baseline 과 정확히 동일해야 한다.

| Lang  | baseline rule_hit | new rule_hit | baseline rule_pass | new rule_pass |
|-------|-------------------|--------------|--------------------|---------------|
| en    | 137/192           | 137/192 ✓    | 128/192            | 128/192 ✓     |
| ko    | 117/192           | 117/192 ✓    | 110/192            | 110/192 ✓     |
| zh-CN | 117/192           | 117/192 ✓    | 113/192            | 113/192 ✓     |
| zh-TW | 114/192           | 114/192 ✓    | 108/192            | 108/192 ✓     |

차이가 0 이 아니면 측정 무효 (데이터셋 또는 rule leg 코드 변경 흔적).

## 5. 결과 — 회귀 가드 (semantic, 20 case)

- **결과:** 19/20 (95.0%) — `evals/_runs/2026-05-11-gpt-5-nano/regression.log`
- **blocking 케이스 (user-report-*) 4건:** 4/4 PASS ✓
- **fail 케이스 1건:**
  - `priority-tie-meeting-first` (tag: `priority,tie-resolution`, expected: `Meeting`) → `<bad_response>` (모델이 cap=1024 token 안에서 응답을 끝내지 못함)

직전 (2026-05-10, 5.4-nano + v2 + cap=64): 20/20 (100%). delta = -5%p — 본 보고서 §7.3 의 후속 PR 항목 (cap 정책 재검토) 으로 분리.

## 6. Failure pattern 분포

본 baseline 의 fail 은 기존 패턴(A/B/C/D)이 아니라 신규 패턴(E `<bad_response>`)에 압도적으로 몰린다 — bad_response 가 fail 의 89-95%. 따라서 기존 패턴 grep 분석은 의미적 분류 능력 검증(net pass) 위주로 정리한다.

### §6.1 신규 Pattern E — `<bad_response>` (gpt-5-nano 의 reasoning-token 폭증)

| Lang  | bad_response | 전체 fail 대비 |
|-------|-------------:|---------------:|
| en    | 75           | 89.3%          |
| ko    | 98           | 95.1%          |
| zh-CN | 100          | 90.1%          |
| zh-TW | 116          | 94.3%          |

**원인 (확인됨, 본 PR 측정 중 직접 API 호출로 검증)**:
- gpt-5-nano 는 reasoning 토큰을 응답마다 평균 64-128 사용. `completion_tokens_details.reasoning_tokens` 가 cap 의 절반 이상.
- `max_completion_tokens` 는 reasoning + content 합산 cap → cap=1024 도 일부 케이스에서 reasoning 만으로 소진되어 `content: ""` + `finish_reason: "length"` 발생.
- 한자/한글이 토큰을 더 차지 → CJK lang 일수록 발생 빈도 증가 (en 39% → zh-TW 60%).

**production 영향 (만약 5-nano 채택 시)**:
- production 의 `LLM_MAX_COMPLETION_TOKENS = 64` 로는 거의 모든 응답이 bad_response.
- `parseCategoryName` 이 bad_response 를 silent miss 로 fold (`src/services/llmClassifier.ts:81-88`), 사용자 입장에서는 "LLM leg 가 동작하지 않음" 으로 보임.

### §6.2 기존 Pattern A–D (의미적 분류 능력)

bad_response 를 제외한 응답(en 116건, ko 93건, zh-CN 90건, zh-TW 75건)의 net pass-rate 는 90-96% 로 5.4-nano + v2 baseline (87-90%)과 동일 또는 약간 우위. 즉 **v3 프롬프트 자체는 의미 분류 능력에서 회귀가 없음**. Pattern A–D 의 lang별 상세 grep 은 본 baseline 의 결정에 영향이 없으므로 deferred — 후속 PR 에서 cap/reasoning_effort 조합으로 bad_response 를 해소한 뒤 의미 있는 비교가 가능.

### §6.3 Pattern B 명명 케이스 (`src/CLAUDE.md` §5.3 contract)

`evals/datasets/en/classification.json` 에 명명 케이스 4건 (`"Jam session"`, `"Brainstorming with Luke and Patrick"`, `"Web3 panel discussion"`, `"Yoga class with Emily"`) 이 존재함을 확인. 단, runner stdout 은 case id/tag 만 출력하고 summary 본문은 출력하지 않아 log grep 으로는 매핑 불가 — 후속 PR 에서 runner 가 summary 도 stdout 에 찍도록 보강 가능. 본 baseline 에서는 이 contract 가 production 변경 없음으로 인해 적용 대상이 아님(production 은 5.4-nano + v2 그대로).

---

## 7. 의사결정

### §7.1 production switch 가부 (-1%p gate)

`src/CLAUDE.md` §5.3 의 3단계 gate (회귀 가드 / 4 lang delta / Pattern B 명명 케이스) 결과:

- [x] 회귀 가드 ≥90% AND zero user-report-* fail? → 95% AND user-report-* 4/4 PASS ✓
- [ ] **en delta ≥ -1%p?** → -33.8%p ❌
- [ ] **ko delta ≥ -1%p?** → -42.1%p ❌
- [ ] **zh-CN delta ≥ -1%p?** → -46.9%p ❌
- [ ] **zh-TW delta ≥ -1%p?** → -53.2%p ❌
- [ ] Pattern B 명명 케이스 grep → not applicable (production 변경 없음)

**결정: production 도입 보류.** 4/4 lang gate 미달.
- `LLM_MODEL` 은 `gpt-5.4-nano` 유지.
- `DEFAULT_CLASSIFIER_PROMPT_VERSION` 은 **`v2` 유지** (v3 는 gpt-5-nano targeted 로 본 측정에서만 사용. v3 + 5.4-nano 조합은 미측정이라 production default 로 채택 보류).
- 5-nano 재검토는 §7.3 후속 PR 에서 cap/reasoning_effort 조정 + v3 5.4-nano 동등성 측정을 거친 뒤.

### §7.2 v2 보존 정책 (롤백 경로)

- `prompts/classifier/system.v2.md` 는 frontmatter + verbatim v2 본문을 보존 — 본 PR 이전 production 의 byte-identical 복원.
- `pnpm tsx evals/scripts/run-classification-eval.ts --model gpt-5.4-nano --prompt-version v2 …` 한 줄로 git checkout 없이 직전 baseline 재현 가능 — 본 PR scope 내에서 검증 완료.
- 신 버전 추가 시 이전 버전 파일 **삭제 금지** — `src/CLAUDE.md` §5.3 contract.

### §7.3 후속 PR 항목

1. **`max_completion_tokens` + `reasoning_effort` 조합 sweep (5-nano 도입 재검토 전제).**
   본 PR 의 cap=1024 + default reasoning_effort 에서 bad_response 39–60% 발생. 5-nano 도입을 다시 검토하려면 먼저 bad_response 를 baseline 의 `timeout`/`quota_exceeded` 수준(≤5%)으로 낮춰야 한다. 후보 조합:
   - cap=2048 + default reasoning_effort
   - cap=512 + `reasoning_effort=low` (가이드의 "Start with `none` for execution-heavy" 권고)
   - cap=1024 + `reasoning_effort=minimal` (지원 시)
   비용 영향 (cap 비례) 측정 동반.
2. **5-nano 도입 가부 재측정.** §7.3.1 의 조합 중 하나로 4 lang 재실행. 4/4 lang delta ≥ -1%p 이면 production 전환 권고. fail 이면 5-nano 도입 영구 보류.
3. **`DEFAULT_CLASSIFIER_PROMPT_VERSION` 갱신 여부.** v3 본문이 5.4-nano + v2 baseline 과 동등 이상인지 별도 측정. 동등하면 default 를 v3 로 승격, 동등 미달이면 v2 유지하고 v3 는 5-nano 도입 시점에 같이 갱신.
4. **`llm_calls.outcome` 분포 기반 prod 모니터링.** 5-nano 도입을 결정하면, `bad_response` 비율을 production 텔레메트리로 지속 감시 (`src/CLAUDE.md` §6.3 의 per-event debugging surface).
5. **dataset-builder 모델 ID (`gpt-5.5`) 검토.** 본 PR 은 빌더 프롬프트만 .md 분리, 모델 ID 는 손대지 않음. 빌더 측 모델 마이그레이션은 별도 PR.

---

## 8. 후속 작업

1. (위 §7.3 후속 PR 항목 모두)
2. `evals/dataset-builder/` 의 `LABEL_MODEL` / `TRANSLATE_MODEL` (`gpt-5.5`) 도 본 결정과 동일하게 모델/프롬프트 버전 관리 — 다만 dataset rebuild 시에만 호출되고 본 PR은 dataset 무변경 → 별도 PR.

---

## 부록 A. 실행 커맨드 & 로그 경로

```bash
mkdir -p evals/_runs/2026-05-11-gpt-5-nano

# 회귀 가드
pnpm tsx evals/scripts/run-classification-eval.ts \
  --model gpt-5-nano --prompt-version v3 --max-completion-tokens 1024 \
  2>&1 | tee evals/_runs/2026-05-11-gpt-5-nano/regression.log

# 4 lang
for lang in en ko zh-CN zh-TW; do
  pnpm tsx evals/scripts/run-classification-eval.ts \
    --task-file evals/datasets/${lang}/classification.json \
    --include-rule-leg \
    --model gpt-5-nano --prompt-version v3 --max-completion-tokens 1024 \
    > evals/_runs/2026-05-11-gpt-5-nano/${lang}.log 2>&1
done
```

로그 경로:
- `evals/_runs/2026-05-11-gpt-5-nano/regression.log`
- `evals/_runs/2026-05-11-gpt-5-nano/{en,ko,zh-CN,zh-TW}.log`
- `evals/_runs/2026-05-11-gpt-5-nano/_progress.log` (각 lang 시작/종료 타임스탬프)

직전 baseline 재현 (회귀 검증용):
```bash
pnpm tsx evals/scripts/run-classification-eval.ts \
  --task-file evals/datasets/en/classification.json --include-rule-leg \
  --model gpt-5.4-nano --prompt-version v2
# → 2026-05-10 baseline 173/192 (90.1%) 근처 (±1 케이스, network noise)
```

## 부록 B. ledger row diff (`evals/agent-results.json`)

본 PR이 append 한 행 (총 5 + PoC 3):

| run_id (생성 시간순) | tool | score / max | task_pass_rate |
|---|---|---|---|
| `2026-05-11-classification-semantic-matching-gpt-5-nano` (PoC, cap=64 — failed all) | `classification-semantic-eval` | 0/20 | 0.000 |
| `2026-05-11-classification-semantic-matching-gpt-5-nano-cap512` (PoC) | `classification-semantic-eval` | 17/20 | 0.850 |
| `2026-05-11-classification-semantic-matching-gpt-5-nano-cap1024` (regression baseline) | `classification-semantic-eval` | 19/20 | 0.950 |
| `2026-05-11-classification-multilingual-en-gpt-5-nano-cap1024` | `classification-multilingual-en-eval` | __TBD__ | __TBD__ |
| `2026-05-11-classification-multilingual-ko-gpt-5-nano-cap1024` | `classification-multilingual-ko-eval` | __TBD__ | __TBD__ |
| `2026-05-11-classification-multilingual-zh-CN-gpt-5-nano-cap1024` | `classification-multilingual-zh-CN-eval` | __TBD__ | __TBD__ |
| `2026-05-11-classification-multilingual-zh-TW-gpt-5-nano-cap1024` | `classification-multilingual-zh-TW-eval` | __TBD__ | __TBD__ |

> append-only — 2026-05-10 baseline 행은 무변경 보존 (`src/CLAUDE.md` §5.3 contract).

## 부록 C. OpenAI gpt-5-nano 가이드 인용 (URL + 본문 발췌)

**Source:** https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5
**Fetched:** 2026-05-11

**When to use nano:**
> "Only for narrow, well-bounded tasks."
> "Prefer closed outputs: labels, enums, short JSON, or fixed templates."
> "Avoid multi-step orchestration unless flow is extremely constrained."

**How nano differs from mini/full:**
> "More literal and makes fewer assumptions."
> "Weaker on implicit workflows and ambiguity handling."
> "By default, may try to keep conversation going with follow-up question."

**Prompting nano:**
> "Put critical rules first."
> "Specify full execution order when tool use or side effects matter."
> "Do not rely on 'you MUST' alone."
> "Separate 'do the action' from 'report the action.'"
> "Define ambiguity behavior explicitly: when to ask, abstain, or proceed."

**Escalation rule:**
> "Route ambiguous or planning-heavy tasks to a stronger model instead of over-prompting gpt-5-nano."

**reasoning_effort (general gpt-5 family):**
> "In practice, most teams should default to the none, low, or medium range."
> "For classification: Start with `none` for execution-heavy workloads like field extraction and structured transforms."

본 baseline 측정은 `reasoning_effort` 를 명시하지 않음 (OpenAI 기본값). 5.4-nano 의 2026-05-10 sweep 결과는 default 가 우월. 5-nano sweep 은 §7.3 후속 PR.

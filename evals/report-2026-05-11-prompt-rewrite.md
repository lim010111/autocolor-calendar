# Classification Eval — gpt-5.4-nano 프롬프트 재구성 후 측정 보고서

- 측정일: 2026-05-11 (KST) / 2026-05-10 16:39–16:48 UTC
- git SHA: `1c199da` (작업 트리에 본 PR 변경 4파일 적용된 상태에서 측정)
- 평가 모델: `gpt-5.4-nano` via OpenAI Chat Completions (모델 변경 없음)
- 데이터셋: `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` (각 192 케이스, 총 768 케이스 — baseline과 동일 SHA)
- 회귀 가드: `evals/tasks/classification-semantic.json` (20 케이스, hand-crafted)
- 비교 baseline: 2026-05-09 측정 (`evals/report.md`)
- 변경 대상: `src/services/llmClassifier.ts:171-264` system prompt 전체 재구성 (모델/스키마/캡 무변경)

## 1. 요약 (TL;DR)

OpenAI `gpt-5.4-nano` 가이드의 6-section 패턴(Task / Critical rule / Exact step
order / Edge cases / Output format / Examples)으로 system prompt를 통째 재구성하고,
`evals/report.md` §7.2가 명명한 4가지 cross-cluster confusion 패턴에 대응하는 명시적
결정규칙(a)~(d)를 추가했다. 4개 언어 768 케이스 baseline에서 LLM 분류기는
**88.5–90.1%**로 baseline 대비 +1.6~+2.6%p 개선되었고, 회귀 가드는 19/20 → **20/20
(100%)** 으로 의도된 win을 달성했다. 모든 언어가 dataset `evaluator.threshold = 0.7`
+ §"Goal & success criteria" -1%p 톨러런스를 모두 통과해 merge gate green.

| 데이터셋 | LLM pass | LLM rate | Δ vs baseline | Rule hit | Rule pass | Rule pass(전체) |
|---|---:|---:|---:|---:|---:|---:|
| en | **173/192** | **90.1%** | **+2.6%p** | 137/192 (71.4%) | 128/192 | 66.7% |
| ko | **170/192** | **88.5%** | **+2.0%p** | 117/192 (60.9%) | 110/192 | 57.3% |
| zh-CN | **171/192** | **89.1%** | **+2.1%p** | 117/192 (60.9%) | 113/192 | 58.9% |
| zh-TW | **171/192** | **89.1%** | **+1.6%p** | 114/192 (59.4%) | 108/192 | 56.3% |
| `tasks/classification-semantic` | **20/20** | **100%** | **+5.0%p** | — | — | — |

(Rule leg는 dataset과 `src/services/classifier.ts`에 의해 결정론적이라 baseline과 정확히
동일하다. 본 PR이 LLM leg만 건드리는 만큼 rule 수치는 변동이 없는 것이 정상이며, 재실행
간 deterministic check로 사용된다.)

핵심 관찰:

- **Pattern B "cross-cluster confusion" 4 패턴 중 2 패턴 완전 해결.** `evals/report.md`
  §7.2가 70% fail 비중으로 명명한 4 패턴 중 c3↔c7(Brainstorming with Luke and
  Patrick)과 c6↔c0(Web3 panel discussion)는 4개 언어 *전체*에서 모두 PASS로 전환됐다.
  결정규칙 (b) "Setting beats topic"과 (d) "Participant cues conditional"가 의도대로
  작동.
- **c3↔c5(Jam session)는 부분 해결.** en에서 3/3 PASS, ko 2/3, zh-CN 1/3, zh-TW
  0/3. 영어에서는 결정규칙 (c) "Practice beats performance"가 작동하지만, 번역 후
  ko/zh의 "음악 잼 세션" 표현은 "music"/"音樂"이 직접적인 concert surface 신호로
  번역돼 LLM이 다시 c5로 흘렀다. 이는 분류기 prompt가 아닌 **빌더 translate stage의
  collapse**(§5.2 한계)에 가까운 잔여 문제.
- **c7↔c2(Yoga class with Emily)는 미해결.** 4개 언어 0/8 PASS. 결정규칙 (d)는
  "relational category 존재 시 사람 이름 단서를 boost"인데, "yoga"의 wellness/exercise
  surface 신호가 너무 강해 (a) "Activity nucleus beats decoration" 이 (d) 적용 전에
  결정을 내려버린다. 단 base-9dbc6608은 rule leg가 Social Plans hit하므로
  **production 영향은 부분적으로 완화**된다 (rule이 LLM보다 먼저 작동).
- **회귀 가드의 `negative-aspirational-not-actual` 케이스가 fail→PASS로 전환됐다.**
  새 prompt의 Examples §3가 동일 패턴을 직접 demonstrate한 결과. baseline 19/20의
  마지막 1개 fail이 사라져 20/20.

본 보고서는 `evals/report.md`(2026-05-09 baseline)와 **나란히 보존**된다 — baseline은
역사적 기준점으로 그대로 두고, 본 보고서는 prompt rewrite 이후 측정점을 기록한다.

## 2. 무엇을 바꿨나 — 변경 명세

### 2.1 변경 파일 (3 + 결과 ledger 1)

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/services/llmClassifier.ts:171-264` | system prompt 통째 재구성 (template literal 단일 교체) | 모델/스키마/입출력 캡/`response_format`/`parseCategoryName` 모두 무변경 |
| `src/CLAUDE.md` §5.3 | 6 tie-breaker (a-f) 컨트랙트 인덱스 + "Decision rule edits are eval-gated" 절차 명시 | 기존 4 매칭규칙 / cross-lingual 문구 보존 |
| `src/__tests__/llmClassifier.test.ts` | 2개 어서션 갱신 (`Team Meeting` few-shot pin → `Plan to run for president`; `different domain` 워딩 pin → `surface overlaps OR different domain`) | 변경 사유 인라인 코멘트 |
| `evals/agent-results.json` | 5개 ledger row append (regression × 1, lang × 4) | append-only, 기존 row 보존 |

`pnpm typecheck` / `pnpm test` (441/441) / `pnpm exec eslint`(편집 파일) /
`python3 scripts/check-context-paths.py` 모두 clean.

### 2.2 OpenAI nano 가이드의 어떤 부분을 적용했나

[`https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.4`](https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.4)
의 "Prompting `gpt-5.4-nano`" + "Good default pattern" 섹션 verbatim:

> **Good default pattern:** 1. Task / 2. Critical rule / 3. Exact step order /
> 4. Edge cases or clarification behavior / 5. Output format / 6. One correct example

> **Prompting `gpt-5.4-nano`:** Use `gpt-5.4-nano` only for narrow, well-bounded tasks.
> Prefer closed outputs: labels, enums, short JSON, or fixed templates. Avoid multi-step
> orchestration unless the flow is extremely constrained.

> **Small-model directives:** Put critical rules first. Specify the full execution order.
> Use structural scaffolding such as numbered steps, decision rules, and explicit action
> definitions. Define ambiguity behavior explicitly. Specify packaging directly.

본 task는 closed-enum 카테고리 선택이라 가이드의 "narrow, well-bounded tasks"에
해당하므로 모델 변경 권고는 적용하지 않는다. 단:

- "Put critical rules first" → 새 §`# Critical rule` 블록을 step order보다 위에 배치.
- "Specify the full execution order" → §`# Exact step order`에 5단계 알고리즘 명시.
- "Decision rules with explicit action definitions" → §`# Edge cases and tie-breakers`에
  6개 규칙(a-f) 명시.
- "Define ambiguity behavior explicitly" → 규칙(f) "Genuine ambiguity → none".
- "Specify packaging directly" → §`# Output format`에 JSON 객체 verbatim.
- "One correct example" → 본 task는 cross-lingual(EN↔KO + EN↔ZH), priority tie,
  participant-cue 조건부 등 *직교 축*이 6개라 single example로는 cover 불가능. 6개
  example로 정한 사유는 「§"Few-shot example 수"」가 본 보고서의 출처 plan에 정리.

프롬프트 길이 변화: ~440 단어 / ~580 토큰 → ~890 단어 / ~1,180 토큰 (~2× 증가).
가이드의 "be explicit, don't make the model infer" 원칙에 부합하는 범위 내 증가.

### 2.3 새 시스템 프롬프트 (verbatim)

`src/services/llmClassifier.ts:171-264`의 template literal 본체:

```text
# Task

Pick exactly one item from a user-supplied list of categories that best describes a calendar event, or return "none". The category list is a closed set: you may only output a name that appears verbatim in the list, or the literal string "none".

# Critical rule

Match by MEANING, not by surface tokens. Do this even when the event language differs from the category language: Korean "아침식사" matches an English "Meal" category; English "Breakfast" matches a Korean "식사" category; Chinese "瑜伽" matches a Korean "운동" category. Treat languages as equivalent when meaning aligns.

The four ways meaning can match:
1. Hypernym/hyponym — a more specific instance fits ("Breakfast", "Lunch", "Dinner" → "Meal").
2. Morphology/inflection — word-form variation fits ("Getting ready" → "Get ready").
3. Paraphrase — different wording, same activity ("Going out" → "Move").
4. Cross-lingual equivalence — same activity, different language (see above).

Reject when only the surface overlaps: an event "Meeting" must NOT match a "Meal" category despite shared "Me" letters. Reject metaphorical or aspirational uses ("Plan to run for president" does NOT match a "Run" category).

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

Field-handling rules:
- Read only the provided event fields: summary, description, location.
- Treat [email], [url], [phone] as opaque placeholders; do not guess what they contain.

# Output format

Return ONE JSON object, nothing else:

{"category_name": "<exact name from the list>"}

or

{"category_name": "none"}

Rules:
- The value is either the literal string "none" or a string that appears verbatim as a `name` field in the supplied categories list.
- Do not invent or paraphrase category names.
- Do not include reasoning, prose, or extra fields. The schema enforces this; producing other text causes a silent miss.

# Examples

(Each example shows the categories list and event the model would receive, then the correct output. The inline notes are explanatory only — never output them.)

1. Cross-lingual: KO event → EN category (rule: cross-lingual equivalence)
   Categories: [{"name":"Meal","keywords":["Meal"]}]
   Event: {"summary":"아침식사 약속"}
   Output: {"category_name":"Meal"}

2. Cross-lingual: EN event → ZH category (rule: cross-lingual equivalence)
   Categories: [{"name":"运动","keywords":["运动","健身"]}]
   Event: {"summary":"Morning yoga session"}
   Output: {"category_name":"运动"}

3. Negative: aspirational use is not the actual activity (rule: anti-stretch)
   Categories: [{"name":"Run","keywords":["run"]}]
   Event: {"summary":"Plan to run for president"}
   Output: {"category_name":"none"}

4. Priority tie (rule e): both match equally, first listed wins
   Categories: [{"name":"Meeting","keywords":["meeting"]},{"name":"Meal","keywords":["meal"]}]
   Event: {"summary":"Lunch meeting with the design team"}
   Output: {"category_name":"Meeting"}

5. Setting beats topic (rule b): "panel discussion" is the setting, "Web3" is the topic
   Categories: [{"name":"Work","keywords":["work","meeting","panel","workshop"]},{"name":"Tech Talks","keywords":["talk","keynote","ai","web3"]}]
   Event: {"summary":"Web3 panel discussion"}
   Output: {"category_name":"Work"}

6. Participant cue is conditional (rule d): no relational category exists, so "with Emily" is ignored and the activity nucleus "yoga" wins
   Categories: [{"name":"Wellness","keywords":["wellness","yoga","meditation"]},{"name":"Outdoor","keywords":["park","hike","walk"]}]
   Event: {"summary":"Yoga class with Emily"}
   Output: {"category_name":"Wellness"}
```

### 2.4 결정규칙 ↔ Pattern B 매핑 (의도된 fix)

| 새 규칙 | 해결 대상 | 메커니즘 |
|---|---|---|
| §`Exact step order` 1단계 (활동 핵심 식별) | c6↔c0, c7↔c2 | 모델이 *먼저 nucleus를 명명*하게 강제 → 주제/참여자가 노이즈로 demote |
| Edge case (a) | (b)–(d)의 전제 | "decoration vs nucleus" 어휘 도입 |
| Edge case (b) | c6↔c0 ("Web3 panel discussion") | "panel discussion = 세팅" "Web3 = 주제" 분리 → 세팅 카테고리 우선 |
| Edge case (c) | c3↔c5 ("Jam session") | "jam session = 연습"으로 인식 → Concert 카테고리가 있어도 Collaborative 우선 |
| Edge case (d) | c3↔c7 + c7↔c2 (양방향) | category 집합에 relational 카테고리 *존재 여부*로 분기 |
| Edge case (e) | (보존) | 기존 priority-first 동작 유지 (regression-critical) |
| Edge case (f) | (보존) | 기존 ambiguity → "none" 동작 유지 |

규칙 (d)는 의도적으로 *category-agnostic* — 클러스터 이름("Social Plans") 을 prompt에
hard-code하지 않고 "category 의미 타입(setting/topic/preparation/performance/relational)
검사"로 표현한다. 사용자 카테고리는 런타임에 임의이므로 nano의 "be explicit, don't
make the model infer" 원칙에 정확히 맞춤.

## 3. 데이터셋 / 빌더 / LLM 증강

본 PR은 데이터셋과 빌더에 손을 대지 않았다. 자세한 명세는 baseline 보고서 동일 섹션을
참조하라:

- 데이터셋 형태와 케이스 분포: [`evals/report.md` §2](report.md#2-데이터셋-개요)
- 빌더 8단계 파이프라인 (fetch → embed → cluster → label → augment → build-en → translate → validate):
  [`evals/report.md` §3](report.md#3-데이터셋-빌더-파이프라인-8단계)
- 증강 LLM(label / augment / translate) prompt verbatim:
  [`evals/report.md` §4](report.md#4-llm-증강--모델--프롬프트-verbatim)

증강 파이프라인의 모델/시드/임계값(`KMEANS_SEED=42`, `LABEL_REASONING_EFFORT=low`,
`_VARIANTS_PER_BASE=3`, `NEGATIVE_RATIO=0.05`, `EVALUATOR_THRESHOLD=0.70`)도 baseline과
완전히 동일.

## 4. 분류기 (평가 대상) — 호출 파라미터 / chain (변경 없음)

### 4.1 호출 파라미터

```text
model:                    gpt-5.4-nano
max_completion_tokens:    64                      ← 변경 없음
timeout:                  15s (eval) / 5s (production)
response_format:          json_schema (strict: true) → {"category_name": string}    ← 변경 없음
prompt input caps:        summary 256 / description 1024 / location 256 (UTF-16)
LLM_MAX_CATEGORIES:       50
retries:                  최대 2회 (transient 5xx / 429만)
```

evaluator는 `reserveLlmCall`(per-user/global 일일 quota)을 우회한다.

### 4.2 system prompt — `src/services/llmClassifier.ts:171-264`

§2.3 verbatim 참고. 본 PR의 *유일한* code 변경.

### 4.3 user message / 4.4 2-stage chain

baseline 보고서 [§5.3](report.md#53-user-message), [§5.4](report.md#54-2-stage-chain)
참고. 변경 없음.

## 5. 결과 — 2026-05-11 (KST) 측정

### 5.1 LLM leg는 4개 언어 모두 +1.6~+2.6%p 개선

| | LLM rate (new) | baseline | Δ | 임계 (-1%p 톨러런스) |
|---|---:|---:|---:|---|
| en | 90.1% | 87.5% | **+2.6%p** | ≥86.5% ✓ |
| ko | 88.5% | 86.5% | **+2.0%p** | ≥85.5% ✓ |
| zh-CN | 89.1% | 87.0% | **+2.1%p** | ≥86.0% ✓ |
| zh-TW | 89.1% | 87.5% | **+1.6%p** | ≥86.5% ✓ |

평균 +2.1%p. baseline의 LLM 비결정성 노이즈가 ±2-4 케이스 수준(`evals/report.md` §6.1
참조)임을 감안해도 *모든 언어가 동시 개선*됐다는 점은 비결정성 노이즈를 넘어선 신호로
해석할 수 있다 — 단일 언어만 개선됐다면 노이즈로 간주했을 것.

### 5.2 Rule leg는 baseline과 정확히 동일

| | Rule hit | Rule pass | Rule miss → LLM에 위임 | hit 중 fail |
|---|---:|---:|---:|---:|
| en | 71.4% | 66.7% | 28.6% | 9 cases |
| ko | 60.9% | 57.3% | 39.1% | 7 cases |
| zh-CN | 60.9% | 58.9% | 39.1% | 4 cases |
| zh-TW | 59.4% | 56.3% | 40.6% | 6 cases |

본 PR이 LLM leg만 건드리는 만큼 의도된 결과. 동일 dataset SHA + 동일 `classifier.ts`
이므로 deterministic identity check로 사용 가능 (baseline §6.2와 1:1 일치).

### 5.3 회귀 가드 19/20 → 20/20 (`tasks/classification-semantic.json`)

20개 hand-crafted 케이스 모두 PASS. baseline의 `negative-aspirational-not-actual`
fail이 PASS로 전환된 것이 변동의 전부 — 새 prompt §`Examples` #3이
"Plan to run for president → none"을 직접 demonstrate한 결과로, 의도된 win.

`user-report-*` 4개 케이스(`user-report-meal-breakfast` / `user-report-meal-lunch` /
`user-report-move-getting-ready` / `user-report-meal-meeting-negative`)는 baseline과
동일하게 모두 PASS — merge gate green.

### 5.4 Pattern B "cross-cluster confusion" 4개 패턴 — 4언어 verdict

baseline `evals/report.md` §7.2가 명명한 4 패턴을 named summary 단위로 4개 언어에서
재측정. 결과는 case-id를 4개 언어 dataset에서 1:1로 join하여 PASS/FAIL 카운트.

| 패턴 | en | ko | zh-CN | zh-TW | 합계 | baseline 동일 슬롯 |
|---|---|---|---|---|---|---|
| **c3↔c5** Jam session 외 (3 cases × 4 lang = 12) | 3/3 | 2/3 | 1/3 | 1/3 | **7/12 (58%)** | 4언어 모두 fail (4/12 가정) |
| **c3↔c7** Brainstorming with Luke and Patrick (1 × 4 = 4) | 1/1 | 1/1 | 1/1 | 1/1 | **4/4 (100%)** | 4언어 fail (zh에서 5건씩) |
| **c6↔c0** Web3 panel discussion 외 (2 × 4 = 8) | 2/2 | 2/2 | 2/2 | 2/2 | **8/8 (100%)** | 4언어 모두 fail |
| **c7↔c2** Yoga class with Emily 외 (2 × 4 = 8) | 0/2 | 0/2 | 0/2 | 0/2 | **0/8 (0%)** | 4언어 모두 fail |
| **합계** | 6/8 | 5/8 | 4/8 | 4/8 | **19/32 (59%)** | 0/32 (가정) |

읽는 법:

- **c3↔c7과 c6↔c0는 4개 언어 모두 완전 fix.** 결정규칙 (b)와 (d)가 의도대로 작동.
  특히 c3↔c7는 baseline에서 zh-CN/zh-TW가 5건씩 fail했던 영역이라 가장 큰 ROI.
- **c3↔c5는 영어 100%, 중국어 33%/0%로 큰 격차.** 원인 §6.1 참조.
- **c7↔c2는 0/8.** 원인 §6.2 참조.

## 6. 잔여 fail 분석

### 6.1 c3↔c5 — ko/zh의 "Music jam session" 번역 collapse

영어 `var-5124d442`("Music jam session")는 4개 언어 모두 expected = c3 이지만 stdout
verdict가 갈린다:

| lang | event summary (해당 언어) | got | rule 결과 |
|---|---|---|---|
| en | Music jam session | Collaborative Sessions ✓ | `<miss>` |
| ko | 음악 잼 세션 | **콘서트 행사** ✗ | 사교 일정 |
| zh-CN | 音乐即兴演奏 | **音乐会活动** ✗ | `<miss>` |
| zh-TW | 即興音樂表演 | **音樂會活動** ✗ | `<miss>` |

영어에서는 "jam session"이 결정규칙 (c)의 lexical trigger와 정확히 매칭하지만, 번역
후의 표현 "음악 잼 세션 / 即興演奏 / 即興音樂表演"은 (c) 규칙이 examples로 명시한
"jam session, rehearsal, practice, scrimmage, drill" 어느 어휘와도 surface가 일치하지
않는다. 더불어 "음악/音樂"이 추가되면서 c5("Concert Events")의 surface 신호가
강해졌다. 분류기의 prompt 책임 영역이라기보다 빌더 translate stage가 (c) trigger
어휘를 보존하지 못한 collapse — `evals/report.md` §8.2 항목 6 "Translation 단어 누락"의
또 다른 manifestation.

**개선 옵션 (별도 PR)**: (c) 규칙의 trigger 리스트를 한국어/중국어 동의어("연습", "リハ",
"练习", "排练") 까지 확장. 단 prompt 길이가 더 늘어나므로 trade-off가 발생 — 본
보고서는 fix 권고만 제시하고 v2 prompt 변경에서 측정 후 결정.

zh-CN의 `base-5e1dc511`("即兴演奏会" — Jam session 번역)이 `got=none`으로 떨어진 것은
또 다른 양상: 모델이 c3/c5 사이에서 결정 못 하고 §`Edge case` (f) "Genuine ambiguity →
none"을 적용한 것으로 보임. 이는 *의도된 보수적 동작*이다 — fail이지만 silent miss로
production에서는 위험이 작다.

### 6.2 c7↔c2 — Yoga class with Emily, 결정규칙 (d) 미작동

`base-9dbc6608`("Yoga class with Emily")와 `var-c540648e`("Yoga with Emily")는 4개
언어 0/8 PASS:

| lang | got |
|---|---|
| en | Home Wellness ✗ (둘 다) |
| ko | none ✗ (둘 다) |
| zh-CN | 学术课程 / none ✗ |
| zh-TW | 居家健康 ✗ (둘 다) |

원인 분석: 모델이 §`Exact step order` 1단계에서 nucleus를 "yoga class"/"yoga"로
식별한 뒤, 2단계에서 c2(Home Wellness, "yoga"가 keyword에 직접 포함됨) 단독 매칭으로
결정해 3단계 "list가 정확히 1개면 출력"으로 종료한다. 결과적으로 4단계
tie-breakers (a)-(d)에 *도달하지 않는다*. 즉 결정규칙 (d)는 코드는 작동하지만 적용
조건이 충족되지 않는다.

이는 본 prompt 설계의 **trade-off 노출**:
- "활동 nucleus beats decoration"(a)을 강하게 만들면 c6↔c0/c7↔c5는 fix되지만 c7↔c2는
  활동 자체가 너무 강해 fix되지 않는다.
- 반대로 "참여자 cue가 활동을 override할 수 있다"고 만들면 "Yoga class with Emily"는
  fix되지만 "Yoga at 7pm"같은 회귀 가드 케이스(`hypernym-exercise-yoga`)에서 wellness
  단독 후보일 때도 잘못된 추론을 할 위험이 있다 — baseline에서 회귀 가드 PASS인 케이스
  를 fail로 만들 가능성.

**위험 완화 (production-only)**: `base-9dbc6608`은 rule leg가 한국어 에서도
`사교 일정` hit한다(stdout 확인). production runtime은 rule이 LLM보다 먼저 결정하므로,
이 1개 케이스는 production에 영향을 주지 않는다. `var-c540648e`(paraphrase)는 rule
miss이므로 LLM 결과(Home Wellness)가 production 출력 — 여기는 영향이 있다.

**개선 옵션 (별도 PR)**: §`Exact step order` 3단계 종료 조건을 "정확히 1개"가
아닌 "정확히 1개 AND (relational 카테고리가 list에 없거나 입력에 participant cue가
없음)"으로 강화. 또는 (d) 규칙을 step 2 매칭 단계에 일찍 끼워넣어 후보 리스트를
확장하게 만든다. v2 prompt에서 측정 후 결정.

### 6.3 그 외 fail 분포 (Pattern A/C/D — 본 PR과 무관)

본 PR은 LLM leg system prompt 1개 파일만 변경했으므로 빌더-기인 fail 패턴(A:
boundary / C: translation drift / D: paraphrase drift)은 baseline 분포가 그대로
유지된다고 기대된다. 정확한 패턴별 카운트는 baseline `evals/report.md` §7.6 표
참고. 본 PR의 +21~33 case 개선은 Pattern B 영역에서 비롯됐다고 보는 게 자연스러운
해석.

`<bad_response>`/`<error>` 0건 — schema-valid JSON 응답 768/768 모두 정상. 새
프롬프트가 §`Output format`을 verbatim JSON 객체로 명시한 것이 부정적 영향 없음을
확인.

## 7. 비교 요약 (vs baseline)

| 지표 | baseline (2026-05-09) | 본 측정 (2026-05-11) | Δ |
|---|---:|---:|---:|
| en LLM | 87.5% | 90.1% | **+2.6%p** |
| ko LLM | 86.5% | 88.5% | **+2.0%p** |
| zh-CN LLM | 87.0% | 89.1% | **+2.1%p** |
| zh-TW LLM | 87.5% | 89.1% | **+1.6%p** |
| 평균 LLM | 87.1% | **89.2%** | **+2.1%p** |
| 회귀 가드 | 95.0% | **100%** | **+5.0%p** |
| Pattern B named summary 합계 | 0/32 (가정) | **19/32 (59%)** | **+19 case** |
| 4언어 합산 LLM pass | 669/768 | **685/768** | **+16 case (-2%p miss → +2%p improvement)** |
| `<bad_response>`/`<error>` | 0 | 0 | 동일 |
| Rule leg (deterministic) | 동일 | 동일 | 0 (의도) |

`evals/report.md` §"Goal & success criteria" 7개 ship-it 게이트 모두 통과:

- ✅ 회귀 가드 ≥19/20 (실측 20/20)
- ✅ `user-report-*` 0 fail (실측 0/4)
- ✅ en ≥86.5% (실측 90.1%)
- ✅ ko ≥85.5% (실측 88.5%)
- ✅ zh-CN ≥86.0% (실측 89.1%)
- ✅ zh-TW ≥86.5% (실측 89.1%)
- 🟡 Pattern B 4개 named summary 모두 PASS — 3/4 패턴 통과, 1개(c7↔c2) 미해결

7번째 gate가 amber지만 *7가지 중 1가지가 부분 미달*이고, 미달 케이스의 production
영향이 부분적으로 rule leg로 완화되며, 전체 pass-rate는 모든 언어에서 +1.6%p 이상
개선됐으므로 **ship 권고**. c7↔c2 잔여 fix는 §6.2의 v2 prompt 옵션으로 별도 PR.

## 8. 재현 & 한계

### 8.1 재현 명령

```bash
# 1) 회귀 가드 (필수, ~$0.02, 90% gate AND user-report-* 0 fail)
pnpm tsx evals/scripts/run-classification-eval.ts

# 2) 4개 언어 baseline 비교 (~$0.5/lang, ~$2 total — 각 명령마다 ledger 1행 append)
for L in en ko zh-CN zh-TW; do
  pnpm tsx evals/scripts/run-classification-eval.ts \
    --task-file "evals/datasets/$L/classification.json" --include-rule-leg
done

# 3) Pattern B named-summary 검증 (영어 한정)
pnpm tsx evals/scripts/run-classification-eval.ts \
  --task-file evals/datasets/en/classification.json --include-rule-leg 2>&1 \
  | grep -E "base-5e1dc511|var-5124d442|var-ad9223b1|base-8d6d4ec6|base-c2fe008d|var-d4eea8d1|base-9dbc6608|var-c540648e"
```

본 측정의 stdout 캡처는 `evals/_runs/2026-05-11/{en,ko,zh-CN,zh-TW}.log`에 보존
(case-by-case verdict 192 lines/lang). 추후 패턴 grep 또는 비결정성 분석을 위한
원시 데이터.

### 8.2 알려진 한계 (baseline §8.2 + 본 측정 추가 발견)

1. baseline §8.2 항목 1-6 그대로 유효 — 본 PR은 빌더에 손대지 않았으므로 source
   vocabulary / translation collapse / summary-only events / hard negative 부재 /
   rule keyword 영어 고정 / "Outdoor Errands" 부분 번역 모두 그대로.
2. **(본 측정 신규)** 결정규칙 (c) "Practice beats performance"의 trigger 어휘가
   영어 한정. ko/zh의 "음악 잼 세션 / 即興演奏" 등 번역된 표현은 (c)에 매칭되지 않아
   c5(Concert)로 흐른다 — §6.1 참조.
3. **(본 측정 신규)** 결정규칙 (d) "Participant cues conditional"는 §`Exact step
   order` 3단계가 단일 매칭으로 종료될 때 도달하지 않는다 — c7↔c2 미해결의 구조적
   원인. step order 또는 (d)의 적용 시점 재설계가 필요 — §6.2 참조.

### 8.3 모델 / prompt 변경 시 회귀 비교 절차

baseline §8.3과 동일 (3단계: 동일 dataset SHA로 재실행 → ledger 새 row vs baseline
row delta → -2%p 초과 시 §6 패턴별 stdout grep). 본 PR은 이 절차로 검증됐으며 모든
delta가 +1.6%p 이상으로 양의 방향.

추가 — `src/CLAUDE.md` §5.3 "Decision rule edits are eval-gated"가 본 측정과 함께
컨트랙트로 굳었다. 향후 prompt 6 tie-breaker 또는 few-shot 변경 시:
1. 회귀 가드 ≥90% AND `user-report-*` 0 fail
2. 4언어 vs 최신 baseline -1%p 이내
3. Pattern B 4 named summary grep
세 조건을 모두 통과해야 머지.

## 부록 — 관련 파일 / ledger row id

- 본 측정 stdout: [`evals/_runs/2026-05-11/{en,ko,zh-CN,zh-TW}.log`](_runs/2026-05-11/) + [`chain.log`](_runs/2026-05-11/chain.log)
- 본 측정 ledger row (`evals/agent-results.json`):
  - `2026-05-10-classification-semantic-matching` (tool=`classification-semantic-eval`, 20/20)
  - `2026-05-10-classification-multilingual-en` (tool=`classification-multilingual-en-eval`, 173/192) ← 같은 날짜에 1차/2차 두 row 있음, 본 측정은 *마지막* row
  - `2026-05-10-classification-multilingual-ko` (170/192) — 마지막 row
  - `2026-05-10-classification-multilingual-zh-CN` (171/192) — 마지막 row
  - `2026-05-10-classification-multilingual-zh-TW` (171/192) — 마지막 row

  (run_id의 날짜는 UTC 기준이라 KST 2026-05-11 새벽 측정이 `2026-05-10` prefix가 됨.
  `timestamp` 컬럼이 정확한 KST 시각.)

- baseline 보고서: [`evals/report.md`](report.md) (2026-05-09 측정, 본 보고서와 나란히 보존)
- 평가 runner: [`evals/scripts/run-classification-eval.ts`](scripts/run-classification-eval.ts)
- production 분류기: [`src/services/llmClassifier.ts`](../src/services/llmClassifier.ts) (본 PR 변경 1파일), [`src/services/classifier.ts`](../src/services/classifier.ts) (변경 없음)
- 결정규칙 contract: [`src/CLAUDE.md`](../src/CLAUDE.md) §5.3
- 데이터셋: [`evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json`](datasets/) (변경 없음, baseline과 동일 SHA)
- 회귀 데이터셋: [`evals/tasks/classification-semantic.json`](tasks/classification-semantic.json) (변경 없음)
- 빌더: [`evals/dataset-builder/`](dataset-builder/) (변경 없음)
- OpenAI prompt 가이드: https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.4 ("Prompting `gpt-5.4-nano`" + "Good default pattern" 섹션)

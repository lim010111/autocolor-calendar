# Classification Eval — 4-Language Baseline Report

- 측정일: 2026-05-09 (공식 baseline) / 2026-05-10 (오류 분석용 재실행)
- git SHA: `1f41184` (PR #76 직후)
- 평가 모델: `gpt-5.4-nano` via OpenAI Chat Completions
- 데이터셋: `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` (각 192 케이스, 총 768 케이스)
- 회귀 가드: `evals/tasks/classification-semantic.json` (20 케이스, hand-crafted)

## 1. 요약 (TL;DR)

4개 언어 768 케이스 baseline에서 LLM 분류기는 **86.5–87.5% pass-rate**를 기록했고
(언어 간 ±1%p 편차), §5.3 회귀 가드 20케이스는 **95% (19/20)** 이었다.
모든 언어가 dataset 내 `evaluator.threshold = 0.7`을 통과해 merge gate는 green.

| 데이터셋 | LLM pass | LLM rate | Rule hit | Rule pass | Rule pass(전체) |
|---|---:|---:|---:|---:|---:|
| en | 168/192 | **87.5%** | 137/192 (71.4%) | 128/192 | 66.7% |
| ko | 166/192 | **86.5%** | 117/192 (60.9%) | 110/192 | 57.3% |
| zh-CN | 167/192 | **87.0%** | 117/192 (60.9%) | 113/192 | 58.9% |
| zh-TW | 168/192 | **87.5%** | 114/192 (59.4%) | 108/192 | 56.3% |
| `tasks/classification-semantic` | 19/20 | **95.0%** | — | — | — |

핵심 관찰:

- **Cross-lingual 일반화는 잘 동작한다.** LLM leg가 영어 87.5% → 한국어 86.5% → 중국어
  87.0/87.5%로 1%p 안쪽 편차. 분류기 system prompt에 명시된 cross-lingual 매칭
  규칙(§5)이 효과를 본다.
- **Rule leg가 비-라틴 언어에서 9–11%p 떨어진다.** 영어 71.4% hit → 한국어 60.9%,
  중국어 59.4–60.9%. 클러스터 키워드가 영어로만 라벨링됐기 때문(빌더의 알려진
  한계 — 자세한 건 §6 참조).
- **fail 케이스가 특정 클러스터에 몰린다.** 4개 언어의 24-29개 fail이 c3
  (Collaborative Sessions) / c6 (Work Activities) / c7 (Social Plans) 세 클러스터에
  집중. 이 셋은 baseline silhouette도 가장 낮음(0.0007–0.05).

## 2. 데이터셋 개요

### 2.1 형태

각 언어 파일은 backwards-compatible `schema_version: 1` (회귀 데이터셋과 동일
스키마) + root-level metadata.

```json
{
  "schema_version": 1,
  "task": "classification-multilingual",
  "lang": "en",
  "source": { "dataset": "anakin87/events-scheduling", "revision": "f0c948fe…", "license": "Apache-2.0" },
  "generator": { "embedding_model": "text-embedding-3-small", "label_model": "gpt-5.5", "k": 10, "selected_silhouette": 0.0307, "seed": 42, "negative_ratio": 0.05, "boundary_threshold": -0.0297, "built_at": "2026-05-09T04:29:39Z" },
  "evaluator": { "threshold": 0.7, "blocking_tags": [] },
  "cases": [ { "id": "base-0e16a037", "tag": "base,c0", "categories": [...], "event": { "summary": "Quantum computing guest talk" }, "expected": { "category_name": "Tech Talks" } } ]
}
```

- `id` 컨벤션: `base-<sha8>` (소스 타이틀 1개당) / `var-<sha8>` (paraphrase 1개당).
  **4개 언어에 동일한 id가 1:1로 들어있어** cross-lingual 델타 분석이 가능하다.
- `tag` 형식: `base|paraphrase,c<idx>[,boundary]` — 예: `base,c6,boundary`.
- `event`에는 **`summary`만** 채워져 있다. HF source가 description/location을
  제공하지 않음. (§6 한계 참조)

### 2.2 케이스 분포 (192 cases / language)

| | base | paraphrase | boundary (전체 중) |
|---|---:|---:|---:|
| count | 50 | 142 | 7 |

클러스터별 케이스 수 (가장 큰 c6 = "Work Activities"가 전체의 24%):

| cluster | name | size | cases |
|---|---|---:|---:|
| c0 | Tech Talks | 5 | 20 |
| c1 | Nightlife Entertainment | 3 | 10 |
| c2 | Home Wellness | 3 | 12 |
| c3 | Collaborative Sessions | 4 | 16 |
| c4 | Outdoor Errands | 5 | 19 |
| c5 | Concert Events | 5 | 17 |
| c6 | Work Activities | 12 | 46 |
| c7 | Social Plans | 6 | 24 |
| c8 | Media Consumption | 2 | 8 |
| c9 | Academic Classes | 5 | 20 |

### 2.3 클러스터 silhouette (k=10 선정 사유)

빌더는 k ∈ {7, 8, 9, 10} 을 silhouette score로 sweep해 가장 높은 k를 선택했다:

| k | silhouette |
|---:|---:|
| 7 | 0.0258 |
| 8 | 0.0249 |
| 9 | 0.0286 |
| **10** | **0.0307** ✓ |

절대 silhouette은 낮은 편(0.03)이지만 50개 타이틀로 구성된 작은 vocabulary에서는
예측 가능한 수치. 이 낮은 separability가 그대로 §5의 fail 패턴으로 이어진다 — c3,
c6 같이 평균 silhouette이 0.01 미만인 클러스터가 분류 fail의 70%를 차지한다.

## 3. 데이터셋 빌더 파이프라인 (8단계)

`evals/dataset-builder/`는 8개 idempotent stage로 구성된다 (`uv run build-dataset all`).
운영자 수동 실행만 가능 — CI에는 들어있지 않다.

| # | stage | 입력 | 모델/알고리즘 | 출력 |
|---|---|---|---|---|
| 1 | `fetch` | HF `anakin87/events-scheduling@f0c948fe…` (3,528 records) | dedup | `_meta/source-titles.jsonl` (50 unique titles) |
| 2 | `embed` | 50 titles | `text-embedding-3-small` (sync) | `data/embeddings.npz` |
| 3 | `cluster` | embeddings | scikit-learn KMeans, k∈{7,8,9,10}, seed=42, n_init=10 | `_meta/clusters-draft.json` (k=10 selected) |
| 4 | `label` | 클러스터 medoid 타이틀 | `gpt-5.5`, reasoning_effort=low | `_meta/clusters.json` (10 categories × 6-10 keywords) |
| 5 | `augment` | 50 base titles + category names | `gpt-5.5`, reasoning_effort=low, 3 variants/base | `_meta/augmented-cases.jsonl` (~150 paraphrases) |
| 6 | `build-en` | augmented + clusters | — | `datasets/en/classification.json` (192 cases, hash 기반 id) |
| 7 | `translate` | en suite의 unique strings | `gpt-5.5` via **OpenAI Batch API** (~870 requests) | `datasets/{ko,zh-CN,zh-TW}/classification.json` |
| 8 | `validate` | 4개 dataset | schema + cross-lingual sanity | exit code 0/1 |

핵심 파라미터:

- `KMEANS_SEED = 42`, `LABEL_REASONING_EFFORT = "low"`,
  `_VARIANTS_PER_BASE = 3`, `NEGATIVE_RATIO = 0.05` (boundary 비율),
  `EVALUATOR_THRESHOLD = 0.70`, Batch poll 15s / max wait 24h.
- 모든 모델/임계값은 `evals/dataset-builder/src/dataset_builder/config.py`에 pinned.
- 소스 dataset revision은 `HF_DATASET_REVISION` 환경변수로 override 가능 (재현성용).

## 4. LLM 증강 — 모델 & 프롬프트 (verbatim)

증강 파이프라인은 **3개의 LLM 호출 단계**(label / augment / translate)를 사용한다.
모두 `gpt-5.5` + `reasoning_effort=low` + structured JSON 출력 + `strict: true`.

### 4.1 Cluster labeling — `evals/dataset-builder/src/dataset_builder/label_clusters.py:26-35`

system prompt:

```text
You name calendar event categories for an evaluation dataset. Given a tight
cluster of event titles, return a short English category name (1-3 words,
Title Case) and 6-10 lowercase keywords that, when substring-matched against
natural calendar titles, would reliably bucket the events into this category.
Keywords must be short (1-2 words), lowercase, deduplicated, and chosen to
maximise coverage of paraphrases without overlapping other obvious
categories. Do not include the cluster members verbatim as keywords.
```

response schema:

```json
{ "type": "object", "additionalProperties": false, "required": ["name","keywords"],
  "properties": { "name": {"type":"string"},
                  "keywords": {"type":"array","items":{"type":"string"}} } }
```

호출 후 처리:

- 같은 카테고리 이름이 두 클러스터에 충돌하면 `<name> 2`, `<name> 3`처럼
  suffix를 붙여 dedup (분류기는 카테고리 이름을 ground-truth key로 쓰므로 충돌
  허용 불가).
- keyword 6개 미만이면 `RuntimeError` — re-label 필요.

### 4.2 Paraphrase augmentation — `evals/dataset-builder/src/dataset_builder/augment.py:22-29`

system prompt (호출 시 `{n}`은 3으로 substitute):

```text
You rewrite calendar event titles for evaluation. Given a single title and
the category it belongs to, produce {n} alternative phrasings that a real
person might type into Google Calendar. Vary surface form (length, word
order, punctuation, abbreviations like '@', 'w/'); preserve the underlying
activity and category exactly. Do NOT introduce a different activity, do NOT
add proper nouns that weren't implied, do NOT translate.
```

user message 템플릿:

```text
Title: {base_title}
Category: {category_name}
Return exactly {n} natural rewrites.
```

response schema:

```json
{ "type": "object", "additionalProperties": false, "required": ["variants"],
  "properties": { "variants": {"type":"array","items":{"type":"string"}} } }
```

호출 후 처리: base title과 case-fold 비교로 자기 자신/중복 variant 제거 후 최대
`n=3` 보존.

### 4.3 Translation — `evals/dataset-builder/src/dataset_builder/translate.py:40-46`

system prompt (`{lang_name}`은 호출 시 substitute):

```text
You translate short English calendar text into {lang_name} for an evaluation
dataset. Keep the translation natural, concise, and faithful to the activity.
Do not transliterate; do not add commentary; preserve proper nouns (people,
brands, song titles) when they would not be translated in normal usage.
Output only the translation in JSON.
```

`{lang_name}` 매핑:

| lang | lang_name |
|---|---|
| `ko` | `Korean (한국어)` |
| `zh-CN` | `Simplified Chinese (简体中文)` |
| `zh-TW` | `Traditional Chinese (繁體中文)` |

response schema:

```json
{ "type": "object", "additionalProperties": false, "required": ["translation"],
  "properties": { "translation": {"type":"string"} } }
```

번역 단위는 (lang, string) pair — 각 언어 × ~192 unique strings(카테고리 이름 +
키워드 + event summary, 중복 제거 후) = ~870 requests를 단일 Batch job으로 제출.
custom ID `L<lang_idx>-S<string_idx>`로 unordered output을 reassemble한다. en
suite의 case id / colorId / expected 구조는 그대로 보존하고 문자열만 substitute해
4개 언어 cases가 1:1 매핑된다.

## 5. 분류기 (평가 대상) — 모델 & 프롬프트 (verbatim)

평가 runner(`evals/scripts/run-classification-eval.ts`)는 **production 코드 경로를
그대로 재사용**한다. 즉 `src/services/llmClassifier.ts`의 `buildPrompt` +
`parseCategoryName`을 그대로 import해 prompt drift 가능성을 차단한다.

### 5.1 호출 파라미터

```text
model:                    gpt-5.4-nano
max_completion_tokens:    64
timeout:                  15s (eval) / 5s (production)
response_format:          json_schema (strict: true) → {"category_name": string}
prompt input caps:        summary 256 / description 1024 / location 256 (UTF-16 chars)
LLM_MAX_CATEGORIES:       50 (초과 시 user-supplied priority order로 슬라이싱)
retries:                  최대 2회 (transient 5xx / 429만)
```

evaluator는 `reserveLlmCall` (per-user/global 일일 quota)을 우회한다 — operator
budget이라 별개로 metering.

### 5.2 System prompt — `src/services/llmClassifier.ts:171-221`

```text
You classify a calendar event into one of the user's categories, or return "none".

The event's title or description may not literally contain the category's name or keywords. Match by MEANING, not by surface tokens. Use these matching rules:

1. Hypernym / hyponym: a more specific instance of a category fits. E.g. "Breakfast", "Lunch", "Dinner" all fit a "Meal" category.
2. Morphology / inflection: word-form variation still counts. E.g. "Getting ready" matches a keyword "Get ready".
3. Paraphrase: a different way of saying the same activity fits. E.g. "Going out" or "Travel" can match a "Move" category.
4. Cross-lingual equivalence: the event language may differ from the category language. Korean "아침식사" matches an English "Meal" category; English "Breakfast" matches a Korean "식사" category; Chinese "瑜伽" matches a Korean "운동" category. Treat languages as equivalent when meaning aligns.

But do NOT stretch matches. Reject when:
- The category is about a different domain even if some tokens overlap. E.g. an event "Meeting" must NOT match a "Meal" category despite the shared "Me" prefix.
- The match is only metaphorical or aspirational, not the actual activity.

Categories are listed in user-defined priority order — if two are equally good, prefer the one listed first; if still ambiguous, return "none".

Other rules:
- Read only the provided event fields: summary, description, location.
- [email], [url], [phone] are opaque placeholders; do not guess their content.
- Output the exact "name" string from the provided list, or "none".
- Do not invent category names.
- Output JSON: {"category_name": string}.

Examples:

Categories: [{"name":"Meal","keywords":["Meal","식사"]}]
Event: {"summary":"Breakfast with mom"}
Output: {"category_name":"Meal"}

Categories: [{"name":"Meal","keywords":["Meal"]}]
Event: {"summary":"Lunch on Wednesday"}
Output: {"category_name":"Meal"}

Categories: [{"name":"Move","keywords":["Get ready","move"]}]
Event: {"summary":"Getting ready to go out"}
Output: {"category_name":"Move"}

Categories: [{"name":"Meal","keywords":["Meal"]}]
Event: {"summary":"아침식사 약속"}
Output: {"category_name":"Meal"}

Categories: [{"name":"运动","keywords":["运动","健身"]}]
Event: {"summary":"Morning yoga session"}
Output: {"category_name":"运动"}

Categories: [{"name":"Meal","keywords":["Meal"]}]
Event: {"summary":"Team Meeting tomorrow"}
Output: {"category_name":"none"}

Categories: [{"name":"Meeting","keywords":["meeting"]},{"name":"Meal","keywords":["meal"]}]
Event: {"summary":"Lunch meeting with the design team"}
Output: {"category_name":"Meeting"}
```

### 5.3 User message

```json
{
  "categories": [{"name": "...", "keywords": ["..."]}],
  "event": { "summary": "...", "description": "...", "location": "..." }
}
```

PII redaction(`redactEventForLlm`)이 적용된 후 input cap이 슬라이싱된다. cap을
넘어가는 경우 silent truncation (분류 신호의 대부분이 앞부분에 있다는 가정).

### 5.4 2-stage chain

production runtime은 `classifierChain`이 다음 순서로 호출한다:

1. **Rule leg** (`src/services/classifier.ts:47-71`) — 카테고리 우선순위 ASC 순으로
   `summary + "\n" + description`에 대해 case-insensitive substring match. 첫 hit
   승. `attendees`/`location`은 rule leg에서 제외 (PII redaction 불필요).
2. **LLM leg** (`src/services/llmClassifier.ts:427-558`) — rule miss 시에만 호출.
   non-hit outcome은 silent `no_match`로 collapse (fall-through 없음).

eval runner의 `--include-rule-leg` 플래그는 두 leg를 모두 측정해 비교 표
(§6)를 만든다.

## 6. 결과 — 2026-05-09 baseline

언어별 LLM/Rule pass 비교는 §1 표 참고. 추가 관찰:

### 6.1 LLM leg는 cross-lingual 안정적

| | LLM rate | en 대비 델타 |
|---|---:|---:|
| en | 87.5% | — |
| ko | 86.5% | -1.0%p |
| zh-CN | 87.0% | -0.5%p |
| zh-TW | 87.5% | 0.0%p |

언어 간 ±1%p 편차에 불과. system prompt의 cross-lingual rule(§5.2 매칭규칙 #4)이
효과를 보고 있다는 신호. 다만 5/10 재실행에서는 ±2-4 케이스 흔들림이 있어
(§7 참조), LLM 비결정성 노이즈를 감안할 필요가 있다.

### 6.2 Rule leg는 라틴 외 언어에서 크게 떨어짐

| | Rule hit | Rule pass | Rule miss → LLM에 위임 | hit 중 fail (rule이 잘못 매칭) |
|---|---:|---:|---:|---:|
| en | 71.4% | 66.7% | 28.6% | 9 cases |
| ko | 60.9% | 57.3% | 39.1% | 7 cases |
| zh-CN | 60.9% | 58.9% | 39.1% | 4 cases |
| zh-TW | 59.4% | 56.3% | 40.6% | 6 cases |

원인: **빌더가 카테고리 키워드를 영어로만 생성한다**. translate stage는 카테고리
**이름**과 **이벤트 summary**는 번역하지만 keyword 배열은 그대로 영어. 따라서
한국어/중국어 event가 영어 keyword와 substring match할 가능성이 거의 없고,
LLM leg에 더 많이 위임된다(영어 28.6% → 한국어 39.1%, 중국어 39–40%).

이것은 production 시나리오와 **동일한 동작**이다 — production에서도 사용자가
한국어 카테고리 + 한국어 event를 쓰면 rule leg가 잡고, 한국어 event + 영어
카테고리(혹은 그 반대)면 LLM이 잡는 구조. eval 데이터셋이 후자 시나리오를
주로 측정한다.

### 6.3 회귀 가드 (Layer 3) — 19/20 (95%)

`tasks/classification-semantic.json`의 20개 hand-crafted 케이스 중 1개 fail.
`user-report-*` 태그 케이스는 모두 pass (merge gate green). 단일 fail의 원인은
ledger notes에 별도로 기록되지 않음 — 추후 prompt 개정 시 §5 분석을 활용해 추적
필요.

## 7. 오류 분석 (fail 케이스 분류)

> §7는 2026-05-10 재실행 stdout(`/tmp/eval-rerun-{lang}.log`)에서 추출.
> 비결정성 때문에 §6 baseline 숫자와 ±2-4 케이스 차이가 있음(en 170/192,
> ko 164/192, zh-CN 163/192, zh-TW 165/192). fail 패턴 자체는 동일하므로
> 분류 분석에는 영향 없음.

총 fail: en 22, ko 28, zh-CN 29, zh-TW 27 = 106 incident.

### 7.1 패턴 A — Boundary cases (silhouette 하위 5%)

`tag` 에 `,boundary` 가 들어간 케이스. 빌더가 의도적으로 "어려운" 케이스로 표시한
영역이며, 실제로 4개 언어에서 16건 fail (전체 fail의 ~15%).

| case id | summary (en) | expected | got 패턴 |
|---|---|---|---|
| `base-be2b321c` | "3D printing workshop" | Work Activities | Collaborative Sessions / Academic Classes |
| `var-bdf42f1c` | (paraphrase of 위) | Work Activities | Collaborative Sessions / Academic Classes |
| `base-5e4fd8c6` | "Drone building hackathon" | Work Activities | Collaborative Sessions / Tech Talks |
| `var-071cbf6a, var-4af6b893, var-6c47c334` | (paraphrases) | Work Activities | Collaborative Sessions / Tech Talks |

이 항목들은 c6 (Work Activities)의 silhouette 하위 멤버 — `clusters.json`의
silhouette per member: 3D printing workshop = -0.0297, Drone building hackathon
= -0.0524. 음수 silhouette은 "이 멤버는 다른 클러스터 중심에 더 가깝다"는 뜻이며,
LLM도 같은 결론(c3 / c0)에 도달했다. 즉 **분류기 오류라기보다 ground-truth
라벨링이 흔들리는 영역**.

### 7.2 패턴 B — Cross-cluster confusion (의미상 인접한 클러스터 간)

가장 큰 fail 카테고리. 24개 fail 중 ~14건이 여기 해당:

- **c3 ↔ c5 (Collaborative Sessions ↔ Concert Events)**: "Jam session"
  (`base-5e1dc511`)이 4개 언어 모두 Concert Events로 분류. "jam session"은 음악
  즉흥연주의 의미가 강해 LLM이 c5(Concert)로 매칭. ground truth가 c3로 돼있는 건
  HF source의 cluster bias — 즉 빌더 단계의 silhouette 0.0213(c3 평균보다 약간
  높음)이지만 의미적으로는 c5에 더 가까운 케이스.
- **c3 ↔ c7 (Collaborative Sessions ↔ Social Plans)**: "Brainstorming with Luke
  and Patrick" 패턴. 사람 이름이 들어간 협업이 c7(친구 만남)로 분류됨. zh-CN/zh-TW
  에서 5건씩.
- **c6 ↔ c0 (Work Activities ↔ Tech Talks)**: "Web3 panel discussion"
  (`base-c2fe008d`), "Web3 panel talk" (`var-d4eea8d1`)이 4개 언어 모두 Tech Talks로.
  "panel discussion"이 직장 활동보다 기술 발표 컨텍스트로 강하게 학습된 듯. c0
  키워드에 `keynote`/`async`/`python` 등이 있어 매칭 surface가 c6보다 강함.
- **c7 ↔ c2 (Social Plans ↔ Home Wellness)**: "Yoga class with Emily"
  (`base-9dbc6608`), "Yoga with Emily" (`var-c540648e`)이 Home Wellness로. "yoga"
  자체가 c2(home wellness)와 의미적으로 더 가까워 사람 이름의 비중이 약화됨.

### 7.3 패턴 C — Translation drift (특정 언어에서만 fail)

영어에서는 pass인데 번역 후 일부 언어에서만 fail나는 경우. 빌더의 translate
stage 한계에서 비롯된다.

| case | event (zh-TW) | expected | 영어/한국어 결과 | zh-TW 결과 |
|---|---|---|---|---|
| `var-ba96308d` | 在圖書館做研究 | **戶外 errands** ⚠ | en/ko/zh-CN PASS | FAIL → 學術課程 |

**버그성 발견**: zh-TW의 카테고리 이름 "Outdoor Errands"가 `戶外 errands`로
부분 번역됨. `errands`가 그대로 영어로 남아 있어 LLM이 "도서관 = 학술" 매칭으로
빠진다. translate stage가 카테고리 이름을 단어 단위가 아닌 문자열 전체로 보내야
하는데, 이 경우는 모델 출력에서 collapse가 일어난 것으로 보인다. `_meta`
번역 ledger 검수 + re-translate가 follow-up으로 필요.

ko에서만 fail나는 패턴:

| case | event (ko) | expected | en/zh 결과 | ko 결과 |
|---|---|---|---|---|
| `base-5a5f4c94` | "Bella와 산책" | 사교 일정 | en PASS | FAIL → 야외 심부름 |
| `var-2d8840bb, var-25764116, var-38001a09` | (paraphrases) | 사교 일정 | en PASS | FAIL → 야외 심부름 |

"Walking with Bella"가 한국어로 "산책"으로 번역되면서 "함께"의 사회적 신호가
약해졌고, "산책"이라는 한국어 단어는 야외 활동(Outdoor Errands)의 의미가 강하게
연상돼 c4로 분류됐다.

### 7.4 패턴 D — Paraphrase drift

`gpt-5.5`가 만든 variant가 base보다 의미적으로 모호해진 경우. 단독 패턴은 적지만
패턴 B의 fail case 다수가 paraphrase에 몰린다 — 예: `var-c540648e` ("Yoga with
Emily")는 base인 "Yoga class with Emily"보다 사회적 신호가 약해 c2(Home Wellness)
hit 확률이 더 높아진다.

### 7.5 패턴 E — `<bad_response>` / `<error>`

**0건**. 4개 언어 768 호출 모두 schema-valid JSON으로 응답. structured output +
`max_completion_tokens=64` cap 조합이 견고하게 동작.

### 7.6 fail 패턴 분포 요약

| 패턴 | en | ko | zh-CN | zh-TW | 합계 | 비고 |
|---|---:|---:|---:|---:|---:|---|
| A. Boundary | 2 | 5 | 4 | 5 | 16 | ground-truth 모호 영역 |
| B. Cross-cluster (인접) | 18 | 18 | 19 | 19 | 74 | LLM이 surface는 맞지만 ground truth와 다른 클러스터 선택 |
| C. Translation drift | 0 | 4 | 5 | 1 | 10 | translate stage 한계 |
| D. Paraphrase drift | 2 | 1 | 1 | 2 | 6 | augment stage 한계 |
| E. bad_response | 0 | 0 | 0 | 0 | 0 | — |

(분류는 각 fail을 1개 패턴에만 할당; 경계 케이스는 가장 강한 신호 우선.)

가장 큰 비중인 **패턴 B의 70% 이상이 c3/c6/c7**에 몰려 있어, 분류기 prompt
개선보다는 **빌더 단계에서 c3, c7을 재라벨링하거나 해당 클러스터의 멤버를
재분배**하는 쪽이 ROI가 높을 것으로 보인다.

## 8. 재현 & 한계

### 8.1 재현 명령

```bash
# 1) 데이터셋 빌드 (operator only — OPENAI_API_KEY 필요, ~$3, source revision pinned)
cd evals/dataset-builder && uv sync && uv run build-dataset all

# 2) 4개 언어 평가 (~$0.5 each, ledger row 1줄씩 추가)
for L in en ko zh-CN zh-TW; do
  pnpm tsx evals/scripts/run-classification-eval.ts \
    --task-file "evals/datasets/$L/classification.json" --include-rule-leg
done

# 3) 회귀 가드 (~$0.02, 90% gate)
pnpm tsx evals/scripts/run-classification-eval.ts
```

각 실행은 `evals/agent-results.json` ledger에 append-only 1행씩 기록한다. 비교는
`docs/ai-readiness-map.html` 또는 ledger raw로.

### 8.2 알려진 한계 (빌더 README 기반 + 본 평가에서 추가 확인)

1. **소스 vocabulary가 작다.** HF `anakin87/events-scheduling`은 50개 unique
   타이틀에서 dedup되며, augment로 ~150 paraphrase를 더해 192 cases로 늘린 것.
   per-category 정확도 신뢰구간이 그만큼 넓다.
2. **Translation collapse.** 영어 paraphrase 중 22–25%가 같은 한국어/중국어
   문자열로 번역돼 동일 case id가 사실상 N회 카운트된다. 통계가 "가장 자연스러운
   번역" 쪽으로 편향됨.
3. **summary-only events.** HF source가 description/location을 안 만든다.
   production 분류기는 셋 다 읽으므로 본 평가는 **prompt 품질의 lower bound**.
4. **Hard negative 부재.** schema는 `expected="none"`을 지원하지만 50-base
   소스에서 안전하게 hard negative를 합성할 수 없어, silhouette 하위 5%를
   `,boundary` 태그로 대체했다. 진짜 "관련 없음" 케이스 측정은 회귀 데이터셋의
   negative 케이스 4종에 의존한다.
5. **Rule keyword 영어 고정 (본 평가 추가 확인).** translate stage는 카테고리
   이름과 event summary는 번역하지만 keyword 배열은 영어 그대로다. 한국어/중국어
   event는 rule leg miss → LLM leg에 위임되는 비율이 영어보다 9–11%p 높다.
   production 시나리오와 일치하므로 결함은 아니지만, eval 결과 해석 시 인지
   필요.
6. **Translation 단어 누락 (본 평가 신규 발견).** zh-TW의 "Outdoor Errands"
   카테고리가 `戶外 errands` 로 부분 번역되어 LLM 매칭 신호가 약해짐 (§7.3 표).
   `_meta` 번역 ledger를 단어 단위로 검수하고 affected 카테고리 re-translate
   필요 — follow-up.

### 8.3 모델 변경 시 회귀 비교 절차

1. 같은 `evals/datasets/{lang}/classification.json` (revision SHA 동일)에
   대해 새 모델로 위 명령 재실행.
2. ledger의 새 row와 2026-05-09 baseline row를 `tool` + `lang` 키로 조인해
   delta 계산.
3. delta가 -2%p 초과면 §7 패턴별 stdout grep으로 어느 패턴에서 후퇴했는지
   회귀 분석.

## 부록 — 관련 파일

- 평가 runner: [`evals/scripts/run-classification-eval.ts`](scripts/run-classification-eval.ts)
- production 분류기: [`src/services/llmClassifier.ts`](../src/services/llmClassifier.ts), [`src/services/classifier.ts`](../src/services/classifier.ts)
- 데이터셋: [`evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json`](datasets/)
- 회귀 데이터셋: [`evals/tasks/classification-semantic.json`](tasks/classification-semantic.json)
- 빌더: [`evals/dataset-builder/`](dataset-builder/) — [`label_clusters.py`](dataset-builder/src/dataset_builder/label_clusters.py), [`augment.py`](dataset-builder/src/dataset_builder/augment.py), [`translate.py`](dataset-builder/src/dataset_builder/translate.py), [`config.py`](dataset-builder/src/dataset_builder/config.py)
- 빌더 메타: [`evals/datasets/_meta/clusters.json`](datasets/_meta/clusters.json), [`source.json`](datasets/_meta/source.json)
- 결과 ledger: [`evals/agent-results.json`](agent-results.json)
- 상위 README: [`evals/README.md`](README.md)

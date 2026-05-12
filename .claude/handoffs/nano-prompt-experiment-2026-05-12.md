# gpt-5-nano 프롬프트 차원 실험 — Handoff (2026-05-12)

## How to use this handoff

You are picking up after a `/grill-with-docs` planning session that extends the
RCA in `evals/report-2026-05-12-nano-rca.md`. Read this entire file, then start
with §10. Decisions in §4 are settled — do not re-litigate them. The closest
prior artefact is the RCA report; the closest prior handoff is
`.claude/handoffs/nano-prompt-rca-2026-05-12.md`. ADR-0002
(`docs/decisions/0002-llm-classifier-model.md`) is **not superseded** by this
experiment — Frame B means this experiment _measures_ ADR-0002's tentativeness
without forcing a swap.

## Goal

The RCA's §2.3 + §7 explicitly preserved **H3 semantic side** (lang-native
prompt) and the "lighter prompt than v3" hypothesis as unmeasured. The RCA
itself only varied `reasoning_effort` (Wave 1/5 `minimal`, Wave 6 `low`) — no
prompt-level change. This experiment closes that measurement gap with two
orthogonal prompt-level variables (lighter / lang-native), staged across three
gates so that negative results cost ~$0.45 and positive results justify ~$1.60.

The outcome is **not** a production swap PR. It is a follow-up report that
either (a) strengthens ADR-0002's lock by quantifying the prompt-side null
result, or (b) provides a strong trigger for a follow-up ADR-0003 by showing
prompt-level recovery on CJK. Either way, ADR-0002's `LLM_MODEL = "gpt-5.4-nano"`
default stays untouched in this experiment's PRs.

User's narrative anchor (Q1 reply):
> "gpt-5-nano에서 적당한 비용으로 최대한의 성능을 내보고자 하는 게 목표야. 그래야지 다른 모델들도 상향평준화가 가능하니까."

Scope β (5.4-nano backport 2 cells) materialises that "다른 모델도 상향평준화"
narrative as data — same prompt transplanted to 5.4-nano measures whether the
relative gap closes or both models lift together.

## Scope

**In scope**
- Extend `evals/scripts/run-classification-eval.ts` to capture `reasoning_tokens`
  and `completion_tokens` from `usage.completion_tokens_details`, aggregate per
  run (mean, max), and write a 4-tuple `(accuracy, bad_response_rate,
  mean_reasoning_tokens, mean_completion_tokens)` into the ledger row's `notes`.
- Six new prompt files under `prompts/classifier/`:
  - `system.v4-light-A.md` (Radical, ~25 lines, 3 examples)
  - `system.v4-light-B.md` (Surgical, ~70 lines, 5 examples)
  - `system.v4-light-C.md` (Compress, ~85 lines, 6 examples)
  - `system.v4-ko.md` (Bilingual Korean of v3, lighter not applied)
  - (Stage 2 only, after winner X fixed) `system.v4-{ko,zh-CN,zh-TW}-light-X.md`,
    `system.v4-zh-CN.md`, `system.v4-zh-TW.md` — created in PR-γ once Stage 1
    settles X.
- `src/services/prompts/classifierPrompts.ts` — extend
  `ClassifierPromptVersion` union; regenerate `_generated.ts` via
  `pnpm tsx scripts/embed-prompts.ts`.
- Three PRs (α / β / γ) — see §4 "PR / 보고서 구조".
- Two reports:
  - `evals/report-2026-05-13-nano-prompt-stage1.md` (Stage 1 mini-report,
    PR-β)
  - `evals/report-2026-05-13-nano-prompt-final.md` (Stage 1 + 2 + β合本,
    PR-γ; absorbs Stage 1 mini-report by reference)
- Optional addition: ADR-0002's `## References` extended with a link to the
  final report, in a tiny separate commit (no ADR text change).

**Out of scope / non-goals**
- Changing `LLM_MODEL` in `src/services/llmClassifier.ts:68`, or any production
  surface in `src/`. This is eval-only.
- Changing `DEFAULT_CLASSIFIER_PROMPT_VERSION` (stays at `v2`).
- Cross-lingual measurement (e.g. ko event + en categories). Dataset analysis
  confirmed all 4 lang × 192 cases are monolingual; production cross-lingual
  reality is a separate dataset build, out of scope.
- `reasoning_effort = medium / high` sweep. RCA §3.3 ruled out by asymmetric
  truncation-resurfacing risk + cost-advantage erosion. Not re-tested here.
- 5.4-nano sweep beyond 2 backport cells (η, θ). The 2 cells are
  representative; full 4-lang 5.4-nano matrix is a future ADR-0003 trigger
  measurement, not part of this run.
- `reasoning.summary` capture (handoff `nano-prompt-rca-2026-05-12.md` §3
  decision). Skipped — the RCA pre-flight already proved `minimal` produces
  `reasoning_tokens=0`, and the 4-tuple ledger note covers the
  cost-vs-accuracy framing without per-call summaries.
- Touching the 20-case regression guard (`evals/tasks/classification-semantic.json`).
- Re-running gpt-5.4-nano baselines on new prompts beyond η/θ — `v2` baselines
  from `evals/report-2026-05-11-prompt-rewrite.md` are reused as reference.
- Production cross-lingual prompt design (Korean prompt that handles ko event +
  en categories deliberately). Logged as open question §8.

## Decisions

Every decision below is the result of an in-grilling Q&A; the linked Q
reference is for traceability into the conversation log.

### Frame B — measurement augmentation, not promotion (Q1)

**Decision:** Treat the experiment as a measurement that closes RCA §7's
preserved hypotheses. Do **not** target overturning ADR-0002. No promotion
gate, no -1%p production gate. Hard gates are _entry gates_ for the next
stage, not pass/fail for production.

**Why:** ADR-0002's three re-evaluation triggers (new nano snapshot / 30% cost
drop / 6-month stagnation) are not satisfied today. Running with a promotion
mindset weakens the trigger definition. A measurement frame still produces a
strong promotion trigger _if_ the data is sufficiently positive — the report
becomes the trigger, not the gate.

**Alternatives considered:** Frame A (overturn ADR-0002 with promotion gates)
— rejected because it presupposes the answer; the measurement should be
allowed to come back null.

### Matrix structure E — staged A → C with gates (Q2)

**Decision:** Three-stage measurement. Each stage's outcome gates the next.
Stage 1 isolates each variable on its native language; Stage 2 measures
interaction across all CJK; Scope β measures cross-model transfer.

| Stage | Cells | Cost | Trigger to next |
|-------|-------|------|-----------------|
| Stage 1 | 4 (3× lighter on en, 1× v4-ko on ko) | ~$0.45 | both lighter winner AND v4-ko pass §4 "Winner selection 기준 R" gates |
| Stage 2 | 6 (symmetric — see §4 Design B) | ~$0.85 | at least 1 of α / ζ passes gate |
| Scope β | 2 (5.4-nano backport η, θ) | ~$0.30 | terminal |

**Why:** Cost grows linearly with information value. Negative results stop at
Stage 1 ($0.45). Strong positive results unlock Scope β's cross-model claim.

**Alternatives considered:** Full grid (32 cells × $0.075 = $2.40) — rejected,
the `prompt × effort` interaction is expected small (prior: RCA's `low` vs
`minimal` gap is a function of reasoning budget, orthogonal to prompt). Single
combined cell (lang-native + lighter in one prompt) — rejected, confounds two
variables.

### Lighter philosophies A / B / C tested in parallel on en (Q3)

**Decision:** Stage 1 tests three lighter variants on en simultaneously. No
single chosen philosophy upfront; let measurement pick.

- **A — Radical (~25 lines, 3 examples)**: TLDR-style. Keep Task + Critical
  rule (3 matching rules, no rejection subsection) + Output format + 3
  examples. Drop Inputs, Exact step order, Edge cases / tie-breakers entirely.
- **B — Surgical (~70 lines, 5 examples)**: handoff `nano-prompt-rca-2026-05-12.md`
  §4's original cut, slightly expanded for easy-majority examples. Keep Task,
  Critical rule (3 rules + 2 rejection), Inputs, Output format, 5 examples.
  Drop Exact step order + Edge cases / tie-breakers a-f entirely.
- **C — Compress (~85 lines, 6 examples)**: Same sections as v3 but
  prose-compressed. Critical rule subsections merged. Tie-breakers as a table.
  6 easy-majority examples.

**Why:** A / B / C span the design axis from "minimum task definition" to
"v3 in compressed prose". Each isolates a different hypothesis about why v3
might be over-engineered for nano. Cost of testing all three is $0.30 — a
fraction of the experiment.

**Alternatives considered:** Choose one upfront and iterate — rejected by user
("셋 다 en에서 먼저 테스트해보고 제일 잘 나온 걸로 고정해서 진행하자").

### Examples are easy-majority + 1 negative anchor (MZ), monolingual only (Q4 lead-up, Q8)

**Decision:** All variants' examples follow:
- Majority (≥67%) clear/direct positive matches: direct keyword hit,
  single hypernym, paraphrase, morphology.
- Exactly **1 negative anchor** (preferred: aspirational "Plan to run for
  president" → "none") to suppress nano's over-prediction tendency
  documented in RCA §3.1.
- **Zero cross-lingual examples.** All examples are monolingual (event
  language = category language) — matches dataset reality (all 768 eval cases
  are monolingual; cross-lingual case count = 0).

The 5-example base set (used in B; A uses indices 1, 2, 5; C uses all 5 plus
1 morphology example):

```
1. Direct keyword hit:    Yoga class with Emily → Wellness
2. Hypernym:              Team lunch at 12pm    → Meal
3. Paraphrase:            Working out at the gym → Exercise
4. Obvious "none":        Quarterly tax filing reminder → none
5. Aspirational negative: Plan to run for president → none
```

For lang-native variants (`v4-ko`, `v4-zh-CN`, `v4-zh-TW`, and after Stage 1
the `v4-{lang}-light-X` set), translate the 5 base examples into the target
language, preserving the same structural meaning. **No cross-lingual examples
are reintroduced in the translated versions.**

**Why:** User's instruction: "쉬운 케이스의 비중을 더 먼저, 그리고 더 많이
가져가는 게 맞다." User's anti-cross-lingual: "cross-lingual case는 그렇게
사례가 많지도 않을 것 같아서 그냥 예제에서 지워도 될 것 같아."

Dataset analysis (in-session) confirmed 0 cross-lingual cases across all 4 ×
192 datasets, justifying the removal at the prompt level too.

**Alternatives considered:** Pure-easy without negative anchor — rejected
because RCA §3.1 documented cross-cluster confusion (c0↔c3, c6↔c0, c8↔c9) as
the dominant fail mode under nano + `low`, which a negative anchor partially
suppresses.

### Critical rule's cross-lingual sentence also removed (Q5 lead-up)

**Decision:** Drop both (a) the cross-lingual examples (per Q4 user
instruction) AND (b) the Critical rule paragraph that states "Treat languages
as equivalent when meaning aligns" and the cross-lingual subrule in the
"How meaning can match" list. Keep exactly **one disclaimer line** at the
bottom of Critical rule: "If the event language differs from the category
language, match by meaning regardless of script." This preserves production
safety (Worker may receive ko event + en categories in deployment) without
inflating the prompt.

**Why:** User's logic ("그렇게 사례 많지 않다") applies symmetrically to rule
text and examples — dataset analysis confirmed monolingual-only distribution.
Removing the cross-lingual rule also reduces v4-light's token count
meaningfully and makes structure Y (bilingual Korean) closer to monolingual,
improving variable isolation.

**Consequence:** The four matching rules in v3 become three in all v4 variants
— hypernym, morphology, paraphrase. The cross-lingual rule is dropped from
the enumeration.

### lang-native `v4-ko` uses bilingual structure Y (Q4) — modified by Q5

**Decision:** `v4-ko` translates **instructions, Critical rule, Output format,
and examples** into Korean. The JSON output schema itself stays in English
(`{"category_name": "..."}`). After Q5's cross-lingual rule removal, structure
Y's "preserve cross-lingual rule explicitly in Korean" point is overridden —
only the 1-line disclaimer is preserved, translated into Korean.

**Why:** Korean reasoning chain on Korean input is the H3 semantic hypothesis.
JSON schema must stay English because parsed by production code that expects
English keys. The disclaimer keeps production deployability (Worker can
receive en categories with ko events).

**Alternatives considered:** Monolingual Korean (structure X) — rejected,
loses production cross-lingual handling. Hybrid English-task + Korean-rationale
(structure Z) — rejected, contradicts GPT-5 prompt guide's "direct
unambiguous instructions" principle.

### Winner selection criterion R — hard gates first, then accuracy-cost lex (Q5)

**Decision:** Among Stage 1's A / B / C en cells, the winner is determined
deterministically by:

1. **Hard gate 1**: `bad_response_rate = 0`.
2. **Hard gate 2**: `accuracy ≥ baseline_en − 5%p` (= ≥ 85.1%, where
   `baseline_en = 90.1%` from `evals/report-2026-05-11-prompt-rewrite.md`).
3. Among candidates passing both, **prefer those with `accuracy ≥ baseline_en
   − 2%p` (= ≥ 88.1%)**; among those, the candidate with **minimum
   `mean_reasoning_tokens`** wins (cost-optimal among accurate).
4. If no candidate passes the ≥ 88.1% cohort, the candidate with **maximum
   `accuracy`** among gate-1+2 passes wins.
5. If no candidate passes gates 1 + 2, Stage 1 _terminates_ — Stage 2 does not
   fire.

Cell 1.2 (`v4-ko` on ko) is independently gated:
- Hard gate 1: `bad_response_rate = 0`.
- Hard gate 2: `accuracy ≥ 82.1%` (= Wave 6 ko `low` 77.1% + 5%p, "meaningful
  lang-native signal").

**Stage 2 trigger:** Stage 1 winner X exists (Cells 1.1a/b/c) AND Cell 1.2
v4-ko passes its gate.

**Why:** Frame B requires deterministic decision criteria. Cost narrative
(reasoning_tokens) must influence the choice because user's narrative is
explicit about cost. baseline−5%p safety + baseline−2%p cost-tradeoff cohort
are RCA-relative anchors.

### Stage 2 design B — symmetric 6 cells across all CJK (Q6)

**Decision:** Stage 2 measures both lang-native-only and lang-native + lighter
on every CJK language, plus the en `minimal` cost cell.

| Cell | lang | prompt | effort | hard gate (production-relevance) |
|------|------|--------|--------|----------------------------------|
| α | ko | `v4-ko-light-X` | `low` | `bad_response = 0` AND `accuracy ≥ 83.5%` (baseline−5%p) |
| β | zh-CN | `v4-zh-CN` (lang-native only, structure Y, lighter NOT applied) | `low` | same form, baseline 89.1% → ≥ 84.1% |
| γ | zh-CN | `v4-zh-CN-light-X` | `low` | same, ≥ 84.1% |
| δ | zh-TW | `v4-zh-TW` (lang-native only) | `low` | same, ≥ 84.1% |
| ε | zh-TW | `v4-zh-TW-light-X` | `low` | same, ≥ 84.1% |
| ζ | en | `v4-light-X` | `minimal` | `bad_response = 0` AND `accuracy ≥ 87.0%` (Wave 1 en) |

**Strong-positive condition:** at least 2 of {α, γ, ε} pass + ζ passes.
**Negative-but-informative:** α passes alone → "lang-native + lighter works
only on ko."

**Why:** Symmetric (vs Aggressive 4-cell) isolates lang-native effect from
interaction across CJK; +$0.30 cost was acceptable to user. Production-realistic
prompts (lang-native + lighter combined) are the deploy candidates if Frame B
turns positive enough to trigger an ADR-0003.

**Alternatives considered:** Aggressive 4-cell (Design A) — rejected, can't
isolate lang-native effect on zh-CN/TW. Production-staged (Design C) —
rejected, Stage 1 already provides staging; adding more stages complicates
audit trail.

### Scope β — 5.4-nano backport 2 cells, staged (Q7)

**Decision:** After Stage 2 settles, if at least one of {α, ζ} passes the
hard gate, run two additional cells on **`gpt-5.4-nano`** with the winning
prompts:

| Cell | model | prompt | effort | cap | lang | reference baseline |
|------|-------|--------|--------|-----|------|---------------------|
| η | gpt-5.4-nano | `v4-light-X` (Stage 1 winner) | _omitted_ (default) | 64 | en | 90.1% (production, v2) |
| θ | gpt-5.4-nano | `v4-ko-light-X` (Stage 2 winner) | _omitted_ (default) | 64 | ko | 88.5% (production, v2) |

`cap=64` and omitted `reasoning_effort` mirror 5.4-nano production conditions.
If neither α nor ζ passes Stage 2, Scope β is skipped ($0 added).

**Why:** User explicitly stated the experiment's broader purpose: "다른
모델들도 상향평준화가 가능하니까". η/θ quantifies whether the
prompt-side optimisation generalises to 5.4-nano or is nano-specific. Two
narratives the η/θ table produces (a) 5.4-nano doesn't move → nano-specific
optimisation → strong ADR-0003 trigger; (b) 5.4-nano lifts too → general
optimisation → 5.4-nano prompt swap PR enters scope (separate, out of this
experiment).

**Alternatives considered:** Scope α (no backport, nano-only) — rejected,
user narrative warrants quantification. Scope γ (full 5.4-nano matrix, 6
cells) — rejected, marginal value for +$0.55.

### PR structure — Option 3, three PRs (Q9)

**Decision:** Land work as three chained PRs.

**PR-α (Infrastructure)**:
- Edit `evals/scripts/run-classification-eval.ts`: capture
  `usage.completion_tokens_details.reasoning_tokens` and `completion_tokens`,
  aggregate (mean, max) into the per-run summary, write 4-tuple
  `(accuracy, bad_response_rate, mean_reasoning_tokens,
  mean_completion_tokens)` into the ledger row's `notes` field.
- Create `prompts/classifier/system.v4-light-A.md`,
  `system.v4-light-B.md`, `system.v4-light-C.md`, `system.v4-ko.md` —
  Stage 1's 4 prompts.
- Edit `src/services/prompts/classifierPrompts.ts`: extend
  `ClassifierPromptVersion = "v2" | "v3" | "v4-light-A" | "v4-light-B" |
  "v4-light-C" | "v4-ko"`; update `REGISTRY`.
- Run `pnpm tsx scripts/embed-prompts.ts` to regenerate `_generated.ts`.
- Update `evals/scripts/run-classification-eval.ts`'s `VALID_PROMPT_VERSIONS`
  to include the new keys.
- Smoke test: `pnpm tsx evals/scripts/run-classification-eval.ts --model
  gpt-5-nano --prompt-version v4-light-B --reasoning-effort low
  --max-completion-tokens 1024 --task-file evals/datasets/en/classification.json`
  on ~10 cases to confirm wiring (use `--include-rule-leg` off,
  `--langfuse-dataset autocolor-classification-en` if Langfuse keys present).
- No measurement, no ledger rows, no report.

**PR-β (Stage 1 measurement)**:
- Run all 4 Stage 1 cells against `gpt-5-nano` (`--model gpt-5-nano
  --reasoning-effort low --max-completion-tokens 1024`).
- Append 4 ledger rows to `evals/agent-results.json`.
- 4 Langfuse run URLs.
- Author `evals/report-2026-05-13-nano-prompt-stage1.md` — cell-by-cell
  results table, winner selection trace, Stage 2 entry decision.
- If gate fails (winner X undetermined OR v4-ko fails its ko gate), PR-β is
  the **terminal** PR — report concludes "ADR-0002 lock further reinforced",
  PR-γ does not open.

**PR-γ (Stage 2 + Scope β)**:
- Only opens if PR-β's report concludes Stage 2 should fire.
- Create `prompts/classifier/system.v4-ko-light-X.md`,
  `system.v4-zh-CN.md`, `system.v4-zh-CN-light-X.md`,
  `system.v4-zh-TW.md`, `system.v4-zh-TW-light-X.md` — 5 new prompts based
  on the X identity from PR-β.
- Extend `ClassifierPromptVersion` and regenerate `_generated.ts`.
- Run 6 Stage 2 cells. If ≥ 1 of {α, ζ} passes, also run η + θ (Scope β).
- Append 6 (Stage 2) + up to 2 (Scope β) ledger rows.
- Author `evals/report-2026-05-13-nano-prompt-final.md` — full results, the
  3D matrix table (model × prompt × lang), recommendation.
- Optional separate commit: append a "See also" link in
  `docs/decisions/0002-llm-classifier-model.md`'s References section. Do
  not modify ADR-0002 text.

**Why:** Three-PR cadence matches the staged measurement structure. Negative
results stop at PR-β with minimum overhead. PR-γ's prompt contents become
deterministic only after PR-β fixes X, so writing them upfront in PR-α would
require placeholders.

**Alternatives considered:** Single mega-PR (Option 1) — rejected, branch life
too long; negative result wastes mass. Two PRs (Option 2) — rejected, requires
placeholder Stage 2 prompts before X is known.

### File naming convention

**Decision:** Follow existing pattern `prompts/classifier/system.v{N}.md` —
new files:
- `system.v4-light-A.md`, `system.v4-light-B.md`, `system.v4-light-C.md`
- `system.v4-ko.md`, `system.v4-zh-CN.md`, `system.v4-zh-TW.md`
- After Stage 1: `system.v4-ko-light-X.md`, `system.v4-zh-CN-light-X.md`,
  `system.v4-zh-TW-light-X.md` — where `X` is literally the winner letter,
  e.g. `system.v4-ko-light-B.md` if B wins.

`ClassifierPromptVersion` union member names mirror filename suffix:
`"v4-light-A"`, `"v4-ko"`, etc.

**Why:** Existing handoff `nano-prompt-rca-2026-05-12.md` already planned
`v4-stripped` / `v4-ko` / `v4-zh-CN` etc. — this is a refinement.
`prompts/README.md` "Never delete prior versions" rule preserved.

### Langfuse dataset / run naming

**Decision:** Reuse the 4 existing Langfuse datasets
(`autocolor-classification-{en,ko,zh-CN,zh-TW}`); do not create new ones.
Run names follow the pattern:
`nano-prompt-{stage}-{cell}-{prompt}-{lang}` —
e.g. `nano-prompt-stage1-1.1a-v4-light-A-en`,
`nano-prompt-stage2-alpha-v4-ko-light-B-ko`,
`nano-prompt-scope-beta-theta-v4-ko-light-B-ko-on-5.4nano`.

**Why:** Datasets are stable (768 monolingual cases). Run name encodes the
3-tuple (stage, cell, prompt-variant) needed for cross-run comparison in the
final report.

## Domain terms

- **Frame B** — Measurement frame for this experiment (Q1). The experiment
  produces a follow-up report, never a production swap PR. Distinguishes from
  Frame A (which the RCA itself initially used).
- **Stage 1 / Stage 2 / Scope β** — Three measurement stages, gated by §4
  decisions. Stage 1 = 4 cells on en/ko, Stage 2 = 6 CJK cells +
  cost-narrative en cell, Scope β = 2 5.4-nano backport cells.
- **Cell** — One measurement unit: a (model, prompt-version, reasoning_effort,
  cap, lang, dataset) tuple producing one Langfuse run + one ledger row.
- **Variant** — A specific prompt design (`v4-light-A`, `v4-ko`, etc.).
  Variants are stored as files in `prompts/classifier/` and registered in
  `classifierPrompts.ts`.
- **Winner X** — The single Stage 1 lighter variant (A / B / C) selected by
  the §4 "Winner selection 기준 R". `X` is one of `A` / `B` / `C` and
  parameterises Stage 2's prompt names.
- **Easy-majority + 1 negative anchor (Design MZ)** — Examples design
  philosophy: ≥ 67% of examples are clear positive matches, exactly 1 is a
  negative "none" anchor (aspirational rejection).
- **Structure Y (Bilingual Korean), modified** — `v4-ko` design where
  instructions are Korean, JSON schema stays English, and the cross-lingual
  rule is reduced to a 1-line disclaimer (after the Q5 cross-lingual rule
  removal decision).
- **Hard gate** — Per-cell entry criterion for the next stage. Not a
  production gate. Defined per cell in §4.
- **4-tuple ledger note** — Per-run ledger entry: `(accuracy,
  bad_response_rate, mean_reasoning_tokens, mean_completion_tokens)`. Used
  by winner selection R and the final cost-narrative table.

Full glossary: this repo has no `CONTEXT.md`. Canonical LLM-side
terminology is in `src/CLAUDE.md` §5.3 ("LLM semantic matching policy") and
§6 ("Observability tables").

## ADRs created this session

None. ADR-0002 stays in force. ADR-0003 may be created in a follow-up PR if
PR-γ's final report's data warrants it — but that is not part of the
experiment's PR scope.

## Open questions

1. **Does `embed-prompts.ts` automatically regen `_generated.ts`, or does the
   CI gate require manual run?** — `prompts/README.md` §"Adding a new
   version" lists `pnpm tsx scripts/embed-prompts.ts` as step 4 with no
   automated trigger description. Resolution: run manually in PR-α; verify CI
   has a sync check that fails if `_generated.ts` is stale.
2. **Does `reasoning_effort = low` work on gpt-5-nano consistently in
   2026-05?** — RCA Wave 6 succeeded with `low`, so this is empirically
   resolved for the eval date. Re-check if PR-β runs more than ~2 weeks after
   the RCA's 2026-05-12 run.
3. **Production cross-lingual case prevalence — what does the live traffic
   look like?** — This experiment assumes the eval's monolingual-only
   distribution is representative. If `llm_calls` table data later reveals
   meaningful cross-lingual traffic (ko event + en category), the
   cross-lingual rule removal in v4 variants needs revisiting in a separate
   measurement.

## Files to touch

**Edit (PR-α):**
- `evals/scripts/run-classification-eval.ts` — `reasoning_tokens` + 4-tuple
  capture, ledger note format, optional `--langfuse-run-name-prefix` flag if
  not already supported.
- `src/services/prompts/classifierPrompts.ts` — extend
  `ClassifierPromptVersion`, update `REGISTRY` and `VALID_PROMPT_VERSIONS`.
- `src/services/prompts/_generated.ts` — regenerated by
  `pnpm tsx scripts/embed-prompts.ts`.

**Create (PR-α):**
- `prompts/classifier/system.v4-light-A.md`
- `prompts/classifier/system.v4-light-B.md`
- `prompts/classifier/system.v4-light-C.md`
- `prompts/classifier/system.v4-ko.md`

**Edit (PR-β):**
- `evals/agent-results.json` — append 4 rows.

**Create (PR-β):**
- `evals/report-2026-05-13-nano-prompt-stage1.md`

**Create (PR-γ, only if Stage 1 succeeds):**
- `prompts/classifier/system.v4-ko-light-X.md`
- `prompts/classifier/system.v4-zh-CN.md`
- `prompts/classifier/system.v4-zh-CN-light-X.md`
- `prompts/classifier/system.v4-zh-TW.md`
- `prompts/classifier/system.v4-zh-TW-light-X.md`
- `evals/report-2026-05-13-nano-prompt-final.md`

**Edit (PR-γ):**
- `src/services/prompts/classifierPrompts.ts` — add 5 new variants.
- `src/services/prompts/_generated.ts` — regenerate.
- `evals/agent-results.json` — append 6 (Stage 2) + up to 2 (Scope β) rows.
- (Optional, separate commit) `docs/decisions/0002-llm-classifier-model.md`
  — append link to final report in "References" section. Do not edit body.

## Implementation plan

1. **PR-α — Infrastructure (~3 hours)**
   1. Read `evals/scripts/run-classification-eval.ts` end-to-end to understand
      the OpenAI call shape, ledger note construction, and Langfuse sink.
   2. Add `reasoning_tokens` + `completion_tokens` capture from
      `response.usage.completion_tokens_details`. Aggregate `mean`, `max` per
      run; write 4-tuple `(accuracy, bad_response_rate,
      mean_reasoning_tokens, mean_completion_tokens)` into the ledger row's
      `notes` field (extend existing `noteParts.push(...)` block).
   3. Write `prompts/classifier/system.v4-light-A.md` with full frontmatter
      (`version: v4-light-A`, `supersedes: v3`, `notes: "Radical TLDR variant
      for gpt-5-nano experiment 2026-05-13"`). Body per §4 "Lighter
      philosophies" — A's spec.
   4. Repeat for B and C.
   5. Write `prompts/classifier/system.v4-ko.md` per §4 "lang-native v4-ko"
      decision. Korean instructions, English JSON schema, 5 monolingual
      Korean examples, 1-line cross-lingual disclaimer in Korean.
   6. Extend `ClassifierPromptVersion` in `classifierPrompts.ts`. Run
      `pnpm tsx scripts/embed-prompts.ts`. Verify
      `src/services/prompts/_generated.ts` updated.
   7. Smoke test: run on ~10 cases from `evals/datasets/en/classification.json`
      with `--prompt-version v4-light-B` on `gpt-5-nano` + `--reasoning-effort
      low`. Verify Langfuse trace shows up + ledger row's 4-tuple is captured.
   8. Run `pnpm test && pnpm typecheck && pnpm lint`.
   9. Open PR-α.

2. **PR-β — Stage 1 measurement (~2 hours)**
   1. After PR-α merge. Cell 1.1a: `--model gpt-5-nano --prompt-version
      v4-light-A --reasoning-effort low --max-completion-tokens 1024
      --task-file evals/datasets/en/classification.json
      --langfuse-dataset autocolor-classification-en` etc.
   2. Same for 1.1b (v4-light-B) and 1.1c (v4-light-C).
   3. Cell 1.2: `--prompt-version v4-ko --task-file evals/datasets/ko/classification.json
      --langfuse-dataset autocolor-classification-ko`.
   4. Apply §4 "Winner selection R" to determine X.
   5. Write `evals/report-2026-05-13-nano-prompt-stage1.md` — cell table,
      winner selection trace, Stage 2 entry decision.
   6. Open PR-β.
   7. If Stage 2 entry is _no_, PR-β is terminal. Skip steps 3.

3. **PR-γ — Stage 2 + Scope β (~3 hours)**
   1. After PR-β merge. Create 5 new prompts per §4 file naming convention,
      using `v4-{lang}-light-X` where X is the winner letter (e.g. if B wins,
      create `system.v4-ko-light-B.md`).
   2. Extend `ClassifierPromptVersion`, regenerate `_generated.ts`.
   3. Run Cells α / β / γ / δ / ε / ζ per §4 Stage 2 table. Cell ζ uses
      `--reasoning-effort minimal` instead of `low`.
   4. Apply hard gates. If ≥ 1 of {α, ζ} passes, run Cells η, θ on
      `gpt-5.4-nano` per §4 Scope β.
   5. Write `evals/report-2026-05-13-nano-prompt-final.md` — full 3D matrix
      (model × prompt × lang), winner narrative, ADR-0003 trigger
      recommendation (or null-result statement).
   6. Optional separate commit: edit
      `docs/decisions/0002-llm-classifier-model.md`'s "References" section
      to append a link to the final report.
   7. Open PR-γ.

## First action

Open `evals/scripts/run-classification-eval.ts` at line ~315 (where
`max_completion_tokens` is set) and ~520 (where the OpenAI request body is
built). Then locate the response handling site (search for `usage` or
`completion_tokens`) — currently the runner does **not** parse
`completion_tokens_details.reasoning_tokens` at all (verified during
grilling: only `max_completion_tokens` is referenced in the file). Add a
type for the response's `usage` field including
`completion_tokens_details: { reasoning_tokens?: number }`, capture per case,
aggregate in the run summary, and extend the ledger note format. Once
captured, write the 4 v4 prompt files. Open PR-α.

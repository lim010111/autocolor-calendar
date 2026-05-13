# Handoff — gpt-5.4-nano Prompt Tuning Stage 1

- **Worktree:** `.claude/worktrees/gpt-5.4-nano-prompt-tuning/` (branch `main` at SHA `6aa77f5`).
- **Grill session date:** 2026-05-13 (KST).
- **Predecessor reports:**
  - `evals/report-2026-05-11-prompt-rewrite.md` — V2 baseline measurement.
  - `evals/report-2026-05-12-nano-rca.md` — gpt-5-nano RCA + ADR-0002 lock.
  - `evals/report-2026-05-13-nano-prompt-stage1.md` — gpt-5-nano Stage 1 (terminal PR-β).
  - `evals/report-2026-05-13-nano-prompt-stage1-zh.md` — zh follow-up.

---

## 1. How to use this handoff

You are picking up after a `/grill-with-docs` planning session for **gpt-5.4-nano prompt-tuning**. Read this entire file, then start with §10 "First action". Decisions in §4 are settled — do not re-litigate them. The grill session weighed alternatives at length (production-identical params vs boosted cap, V2-무관 의미, 4 vs 5 vs 8 cells, langfuse 사용 강도, winner gate 디자인); the conclusions below are the lockdown.

Operate from the worktree path above. All paths in this doc are relative to that worktree unless otherwise stated.

---

## 2. Goal

Measure how four prompt-design dimensions from the OpenAI `gpt-5.4-nano` prompt-guidance doc affect classification accuracy on the production model (`gpt-5.4-nano`) against our 4-language Langfuse dataset. The four dimensions are the gaps identified in V2 (the current production prompt): follow-up suppression, action/report separation, "one correct example" extreme, and literal-first matching. Two `reasoning_effort` levels (production default + `minimal`) are crossed against V2 control and the follow-up variant to also sanity-check what gpt-5.4-nano's production default actually does.

Outcome shape (per the (D) goal locked in grill §1): a **lever characterization report** that records each dimension's directional effect on accuracy and reasoning_tokens, **plus** a conditional **winner declaration** (γ Quality or γ Cost-Pareto) if any cell beats V2 on the gated criteria in §4 "Winner gate."

---

## 3. Scope

### In scope (Stage 1 = PR-α + PR-β)

- Author 4 new prompt files under `prompts/classifier/`: `system.v5-L1.md`, `system.v5-L2.md`, `system.v5-L4.md`, `system.v5-L5.md` (naming: `v5` family, lever suffix).
- Run **8 cells × 4 languages × 192 cases** = 6144 calls on `gpt-5.4-nano` at `max_completion_tokens=512`, `response_format=json_schema strict`. Capture `usage.completion_tokens_details.reasoning_tokens` per call.
- Active use of Langfuse: **(a)** Prompt Management upload + runner fetch path, **(b)** custom scores (`accuracy`, `mean_reasoning_tokens`, `p95_reasoning_tokens`, `bad_response_rate`, `lever_id`, `reasoning_effort`) on each dataset run, **(d)** cross-variant trace diff via (b) as side-effect.
- Append 8 ledger rows to `evals/agent-results.json`.
- Write `evals/report-2026-05-13-gpt-5.4-nano-prompt-tuning.md` with results, winner-gate trace (§4), open questions.
- Draft **ADR-0003** at `docs/decisions/0003-langfuse-prompt-management-eval-only.md`.

### Out of scope / non-goals

- **Production prompt change.** PR-γ (DEFAULT_CLASSIFIER_PROMPT_VERSION bump, src/CLAUDE.md §5.3 contract-index update, full §5.3 3-gate run) is **conditional** on a winner firing in §4 and is a **separate PR**, not part of this handoff. Stage 1 = eval-only, `DEFAULT_CLASSIFIER_PROMPT_VERSION = "v2"` stays.
- **Schema or dataset changes.** Dataset builder is frozen. We measure against the existing `evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json` (same SHA as V2 baseline).
- **Production parameter changes.** `LLM_MAX_COMPLETION_TOKENS = 64` in `src/services/llmClassifier.ts:91` is NOT touched. The eval-side cap=512 is a measurement window only; if a Cost-Pareto winner ships, it must pass `p95 reasoning_tokens ≤ 60` so cap=64 production is unchanged.
- **gpt-5-nano experimentation.** ADR-0002 locks production on `gpt-5.4-nano`; gpt-5-nano variants stay where the Stage 1 (terminal) report left them.
- **XML structural tags** or **Decision-rule-first** (L6/L7 candidates raised in grill) — out: not in the OpenAI nano-doc, so violate the "V2-무관 = doc-lever-driven" framing locked in grill §2.
- **LLM-as-judge** Langfuse evaluator (option c in grill §3) — out: deterministic gold answers exist; LLM judge has zero information value.
- **`reasoning_effort` axes beyond `default` and `minimal`.** `low/medium/high/xhigh` are out of scope this stage — they require cap=512+ and the doc-driven hypothesis is "narrow task ⇒ less effort," not more.

---

## 4. Decisions

### 4.1 Goal shape — (D) lever characterization + conditional winner detection

- **Decision:** Run all variants regardless of whether any beats V2. Two outputs: directional lever report + winner declaration (or no-winner terminal verdict).
- **Why:** V2 already at 88.5–90.1 % means a winner-only goal carries high failure risk (same-day re-run nondeterminism = ±1.0–2.1 %p per `evals/report.md` §6.1) and a pure characterization goal makes "so what for production" ambiguous. Mixed gives both artifacts at one cost.
- **Alternatives:** (A) winner-only, (B) Pareto-only, (C) characterization-only. All single-axis; (D) covers both.

### 4.2 Lever set — L1 + L2 + L4 + L5 + V2 control

- **Decision:** Five prompts total, expanded to 8 cells by crossing two `reasoning_effort` settings on V2 and L1 only.

  | Cell | Prompt | `reasoning_effort` | Doc-doctrine being tested |
  |------|--------|--------------------|---------------------------|
  | C0a  | V2 (production verbatim) | unset (production default) | same-day baseline + reproduction of 2026-05-11 numbers |
  | C0b  | V2 | `minimal` | sanity on what gpt-5.4-nano's default actually is |
  | C1a  | **L1** — follow-up suppression | unset | doc: *"By default, it may try to keep the conversation going with a follow-up question unless you suppress that behavior explicitly"* |
  | C1b  | L1 | `minimal` | follow-up suppression × explicit effort, orthogonality |
  | C2   | **L2** — action/report separation | unset | doc: *"Separate 'do the action' from 'report the action'"* — primary upside candidate |
  | C4   | **L4** — one correct example | unset | doc: *"Good default pattern: ... 6. One correct example"* taken at face value (V2 has 6 examples) |
  | C5   | **L5** — literal-first | unset | doc: *"more literal, makes fewer assumptions"* — paraphrase/hypernym rules removed; trade-off probe |

- **Why:** L1 (null hypothesis), L4 (degradation hypothesis), L5 (trade-off hypothesis), L2 (upside hypothesis) cover four orthogonal directional signals. V2 same-day control absorbs nondeterminism. The minimal cross (C0b, C1b) is the cheapest way to learn whether production default is `medium`/`low`/`minimal`/`none`, which the doc does not specify for `gpt-5.4-nano`.
- **Alternatives rejected:**
  - **L3 (termination instruction "after JSON, output nothing further"):** `response_format=json_schema strict` already enforces this; measurable effect ≈ 0 unless schema is disabled, which violates prompt-only scope.
  - **L6 (decision-rule-first / step-order-first):** V2 already keeps Critical rule + Exact step order adjacent; reordering = V2-near, breaks "V2-무관" intent.
  - **L7 (XML tag wrapping):** not in OpenAI nano doc; violates doc-lever framing.
  - **Fewer cells:** the 8-cell shape was challenged in grill §4 (5-cell simpler alternative offered); user picked the 8-cell shape to also pin reasoning_effort.

### 4.3 V2-무관 = doc-lever-driven, not clean-room

- **Decision:** "V2 와 무관하게" means each variant exercises a doc-recommended lever that V2 does **not** currently apply (or applies in the opposite direction). It does **not** mean clean-room rewrites that ignore V2's structure.
- **Why:** V2 is itself derived from the same doc (`evals/report-2026-05-11-prompt-rewrite.md` §2.2). A literally V2-disjoint prompt would just abandon doc compliance, which is the opposite of the experiment's framing.
- **Alternatives rejected:** Clean-room rewrites of the Task / Output format sections — would change too many axes at once for a directional measurement.

### 4.4 Parameter design — eval-boosted cap, `reasoning_effort` as an axis

- **Decision:** `max_completion_tokens=512` for every cell. `reasoning_effort` varied as the table in §4.2. Capture `usage.completion_tokens_details.reasoning_tokens` per call (mean / p50 / p95 / max).
- **Why:**
  - The OpenAI reasoning guide states reasoning tokens count inside the output cap, recommends "at least 25,000 tokens for reasoning and outputs" when experimenting, and warns that hitting cap returns `status: "incomplete"` with **costs already incurred and no visible response**. Our production cap=64 fitting V2 is a happy coincidence of "V2 + gpt-5.4-nano default" producing minimal reasoning, not a safety margin.
  - At cap=64, a lever that increases reasoning length even by a few tokens could cause silent JSON truncation that we'd misattribute to "the prompt is bad." Cap=512 gives ~8× headroom — well below the 25 k recommendation but absolutely safe for our 4-token-typical output shape.
  - Cap=1024 (what gpt-5-nano Stage 1 used) saw `v4-ko` hit max=1024 and produce a `bad_response` — the cap itself became a side effect of measurement. 512 is the sweet spot.
  - reasoning_effort variation is justified once the reasoning doc is in play: it lists `none/minimal/low/medium/high/xhigh` and the gpt-5.4-nano default is **not specified**. Two settings (default + minimal) is the cheapest probe.
- **Alternatives rejected:**
  - **(A) Production-identical cap=64** — initially recommended in grill round 4, withdrawn after reading the reasoning doc. Silent-truncation risk + measurement information loss.
  - **(B) cap=512 with `reasoning_effort` unset only** — cheaper at 5 cells / $0.77, but leaves the reasoning_effort axis unmeasured.
  - **(C) cap=64 with post-hoc boosted re-run** — two-stage measurement adds complexity; grill rounds 4–5 collapsed it into a single-stage cap=512 with conditional Stage 2 (§4.6).

### 4.5 Langfuse usage — Prompt Management (a) + custom scores (b) + cross-variant diff (d)

- **Decision:** Three additions on top of the existing Langfuse dataset + trace sink:
  - **(a) Prompt Management:** upload V2 + L1 + L2 + L4 + L5 to Langfuse Prompts API as versioned prompts; runner accepts a `--prompt-source langfuse` flag and resolves prompt body from Langfuse rather than `prompts/classifier/*.md`. Production code path stays file-only (no production fetch from Langfuse).
  - **(b) Custom scores:** runner emits per-run scores (`accuracy`, `bad_response_rate`, `mean_reasoning_tokens`, `p95_reasoning_tokens`) and per-trace metadata (`lever_id`, `reasoning_effort`). Used by Langfuse's Run Comparison chart to auto-segregate cells.
  - **(d) Cross-variant diff:** falls out of (b) as a UI side-effect — same `case_id` across 8 cells can be inspected side-by-side in Langfuse.
- **Why:** the user's grill prompt explicitly asked for "langfuse 적극 이용." The status quo (ADR-0001) makes Langfuse the dataset source-of-truth + run sink. (a) brings prompt versioning into the same surface, which is the natural extension. (b) is ~10 LOC and unlocks the Run Comparison chart's value. (d) is free given (b).
- **Alternatives rejected:**
  - **(c) LLM-as-judge evaluator** — deterministic gold answers exist; zero information value.
  - **(e) Status quo** — explicitly fails the user's "적극 이용" requirement.

### 4.6 Winner gate — γ Quality + γ Cost-Pareto, with cap=64 verification subset

- **Decision:** Two parallel gates with explicit numeric thresholds. No-winner is the documented fallback.

  ```
  Pre-gates (computed for every cell):
    P1. bad_response_rate = 0       (no cap=512 truncation)
    P2. reasoning_tokens p95 ≤ 60   (eligible for production cap=64 deployment)

  Quality winner (γ2):
    Q1. accuracy ≥ V2_control(same-day) + 2 %p  on EVERY of 4 langs
    Q2. P1 holds
    Q3. On firing → Stage 2 verification: re-run winner at cap=64 → ship if still
        passes Q1 + Q2 at cap=64. If Stage 2 fails, downgrade to "Quality candidate
        pending cap raise" — opens PR-γ deliberation but does not auto-ship.

  Cost-Pareto winner (γ1):
    C1. accuracy ≥ V2_control - 1 %p  on EVERY of 4 langs
    C2. mean reasoning_tokens ≤ V2_control mean × 0.7  (≥30 % reduction)
    C3. P1 holds
    C4. P2 holds (no cap raise needed)
    C5. On firing → Stage 2 verification at cap=64 → ship if both still hold.

  Conflict (γ1 AND γ2 fire on different cells):
    Quality winner wins. Cost-Pareto candidate is appended to the report
    "Open questions" for a separate PR.

  Fallback:
    No cell passes either gate → PR-α (this work) is terminal.
    Report records lever directional signals only. No PR-γ.
  ```

- **Why:** V2's 88.5–90.1 % baseline is partly dataset-noise-bounded (Pattern B residuals in `evals/report-2026-05-11-prompt-rewrite.md` §6.2 are structurally unfixable in some cells), so a quality-only gate is high-risk for null. Cost-Pareto rewards "same score, cheaper reasoning" which is a real production lever at our cap=64 chokepoint without requiring an accuracy breakthrough. The 4-langs-simultaneous criterion enforces nondeterminism robustness — Stage 1's report §5.1 rule that single-language wins are noise applies here too.
- **Alternatives rejected:**
  - **(α) Absolute lift, no Pareto:** misses cost-driven shippability.
  - **(β) Weighted average across langs:** allows a -2 %p regression on one lang to be averaged out — operationally unfair.
  - **(δ) No winner gate at all:** abandons the (D) goal's winner-detection half.

### 4.7 PR slicing

- **Decision:** Three PRs.
  - **PR-α (infra):** 4 new prompt files + 1 upload script + runner `--prompt-source langfuse` flag + custom scores emission + ADR-0003 draft. Production unchanged. Gates: `pnpm typecheck` + `pnpm lint` + `pnpm test` + regression eval (`evals/scripts/run-classification-eval.ts` → 20/20 + `user-report-*` 0 fail). Merge before measurement runs.
  - **PR-β (measurement + report):** 8-cell run + 8 ledger rows + `evals/report-2026-05-13-gpt-5.4-nano-prompt-tuning.md`. Stage 2 verification at cap=64 inline if a winner fires. Production unchanged.
  - **PR-γ (ship, conditional):** only opens if PR-β winner verdict is "ship." Bumps `DEFAULT_CLASSIFIER_PROMPT_VERSION`, updates `src/CLAUDE.md` §5.3 contract index, must pass the §5.3 3-gate (regression / 4-lang baseline / Pattern B grep). Out of scope for this handoff.
- **Why:** PR-α is reusable infra independent of the experiment result; PR-β is the actual experiment but has zero production risk; PR-γ has production risk and gets its own review surface. Stage 1 ran the same `α/β/γ` slicing in the gpt-5-nano experiment (`evals/report-2026-05-13-nano-prompt-stage1.md` §4 reference) so reviewers recognize the pattern.
- **Alternatives rejected:** Single bundled PR — too large, too many gates merged, hard to revert PR-β without disturbing infra.

---

## 5. Domain terms

These are the load-bearing terms for this work; new-session agent can start without reading `CONTEXT.md` first.

- **V2 prompt** — Current production classifier system prompt at `prompts/classifier/system.v2.md`, registered in `src/services/prompts/classifierPrompts.ts` as `DEFAULT_CLASSIFIER_PROMPT_VERSION`. Produced 2026-05-10 by rewriting the prior 4-rule prompt against the OpenAI gpt-5.4-nano prompt-guidance doc. Reference: `evals/report-2026-05-11-prompt-rewrite.md`.
- **V2 control (C0a) / same-day baseline** — V2 measured today in the same run batch as the variants, used as the comparison anchor. Distinct from the 2026-05-11 historical V2 numbers because LLM nondeterminism contributes ±2–4 cases per 192 (`evals/report.md` §6.1).
- **Lever (L1–L5)** — A single doc-recommended prompt-design dimension exercised in isolation. L1 = follow-up suppression, L2 = action/report separation, L4 = one-example extreme, L5 = literal-first. L3, L6, L7 were considered and rejected (§4.2 alternatives).
- **Cell (C0a–C5)** — A unique (prompt, reasoning_effort) pair run against the full 4-lang dataset. 8 cells in this experiment.
- **`reasoning_effort`** — OpenAI Chat Completions parameter accepting `none/minimal/low/medium/high/xhigh`. gpt-5.4-nano default is not specified by the reasoning doc; default vs `minimal` is one of the experimental axes (§4.2).
- **`max_completion_tokens` (cap)** — Output token ceiling **inclusive of reasoning tokens**. Production = 64. This experiment = 512 (eval-only headroom); winner must verify at cap=64 for ship eligibility (§4.6 Stage 2).
- **Pre-gates P1/P2 — γ Quality (γ2) — γ Cost-Pareto (γ1)** — Numeric criteria a cell must pass to be declared a winner. Verbatim in §4.6.
- **Pattern B** — `evals/report.md` §7.2 names four cross-cluster confusion patterns (`c3↔c5`, `c3↔c7`, `c6↔c0`, `c7↔c2`) that V2 partially fixed. Pattern B grep is one of the three §5.3 production-ship gates (out of scope here, relevant only to PR-γ).
- **Production-identical** — Means the runner uses `model=gpt-5.4-nano` + production prompt file via `loadClassifierPrompt` + `response_format=json_schema strict`. Cap and reasoning_effort are NOT included in "production-identical" for this experiment because we deliberately boost the cap; the runner already accepts both as CLI flags (`evals/scripts/run-classification-eval.ts:336-337`).
- **Lever characterization** — The (D) goal's non-winner half: per-lever directional table that says "L1 = null effect on accuracy", "L4 = -X %p degradation", etc. Survives even if no winner fires.

Full glossary: there is no `CONTEXT.md` in this repo. The closest equivalents are `CLAUDE.md` (root) and `src/CLAUDE.md` (backend rules, §5.3 LLM semantic matching policy in particular).

---

## 6. ADRs created this session

None **yet** — but ADR-0003 (*Langfuse Prompt Management — eval-side only, file = production source-of-truth*) is the deliverable of PR-α. Path will be `docs/decisions/0003-langfuse-prompt-management-eval-only.md`. ADR-0001 (`docs/decisions/0001-langfuse-eval-only.md`) is its parent; ADR-0003 extends 0001's "eval-only" boundary to include prompt storage, not just dataset + traces.

ADR-0003 outline:

- **Decision:** Upload all classifier prompt versions to Langfuse Prompt Management; eval runner accepts `--prompt-source langfuse`; production keeps reading from the `_generated.ts` bundle (file source-of-truth).
- **Status:** Accepted at 2026-05-13.
- **Context:** Multi-variant prompt experiments need UI-comparable prompt versioning; current `prompts/classifier/*.md` works for git history but loses the Langfuse Run Comparison segregation.
- **Decision rationale:** Mirrors ADR-0001's eval-only boundary. Production cannot fetch from Langfuse (network dependency in the Worker hot path is unacceptable per ADR-0001 §"Why eval-only"); but eval can.
- **Consequences:**
  - Eval has a Langfuse-source mode (`--prompt-source langfuse`) and a file-source mode (`--prompt-source file`, default). File-source must remain functional as the fallback.
  - When uploading a new variant, the operator runs `scripts/upload-prompts-to-langfuse.ts <version>`, which is idempotent.
  - Drift: the Langfuse prompt and the `.md` file can diverge if someone edits Langfuse directly. The upload script is the only sanctioned writer; src/CLAUDE.md §5.3 "Prompt body lives in versioned `.md` files" still holds, with Langfuse as a downstream replica.

---

## 7. Open questions

- **Langfuse Prompt Management SDK shape** — `@langfuse/client` exists in the runner (`evals/scripts/run-classification-eval.ts:32`). Verify whether the same client exposes `prompt.create()` / `prompt.get()`, or if a different package is needed. **Action:** check `node_modules/@langfuse/client/dist/*.d.ts` first; fall back to the Langfuse Cloud docs if unclear. Decision can be deferred to PR-α implementation; not a blocker for §10.
- **gpt-5.4-nano default `reasoning_effort` value** — The reasoning doc doesn't specify. The experiment will measure this empirically via C0a vs C0b. If C0a reasoning_tokens distribution matches C0b (`minimal`), default ≈ minimal. If C0a > C0b by a lot, default is heavier. Either way, **report.md §"Findings"** records the answer.
- **L4 example choice** — The doc says "one correct example." V2 has six (cross-lingual KO/EN, cross-lingual ZH/EN, anti-aspirational, priority tie, setting-beats-topic, participant-conditional). Which **one** survives? **Recommendation (subject to confirmation during PR-α authoring):** the cross-lingual KO→EN example (V2 example #1 — "아침식사 약속" → "Meal"), because cross-lingual coverage is the broadest single-axis demonstrator and the doc emphasizes "one correct example" as a coverage primitive, not a worked-out solution.

---

## 8. Files to touch

### Create

- `prompts/classifier/system.v5-L1.md` — Follow-up suppression variant. Author from V2 + insert near the top of `# Critical rule`: `"Suppress follow-up questions. Do not ask the user anything. Output only the JSON object, then stop."`
- `prompts/classifier/system.v5-L2.md` — Action/report separation variant. Rewrite `# Exact step order` to label internal steps (`internal: identify nucleus`, `internal: select category`, `output: emit JSON`). Keep other sections intact.
- `prompts/classifier/system.v5-L4.md` — One-example variant. Strip `# Examples` down to a single cross-lingual KO→EN example (or per §7 final choice). Otherwise V2.
- `prompts/classifier/system.v5-L5.md` — Literal-first variant. In `# Critical rule`, replace the "four ways meaning can match" enumeration with: *"Match only when the event text explicitly names an activity that the category enumerates. If you must infer or paraphrase to reach a match, the answer is 'none'."* Remove all paraphrase/hypernym/morphology rules. Keep cross-lingual equivalence (it's not "paraphrase" — it's translation). Few-shot accordingly trimmed to literal-match examples + one cross-lingual.
- `scripts/upload-prompts-to-langfuse.ts` — Idempotent upserter: reads `prompts/classifier/system.v<X>.md`, computes a content hash, calls Langfuse Prompts API to create or no-op. Mirrors `evals/scripts/sync-langfuse-dataset.ts` discipline (operator-side only, never injected into Worker secrets).
- `docs/decisions/0003-langfuse-prompt-management-eval-only.md` — ADR per §6 outline.
- `evals/report-2026-05-13-gpt-5.4-nano-prompt-tuning.md` — Final report. Use the structure of `evals/report-2026-05-13-nano-prompt-stage1.md` as a template (§1 TL;DR table → §2 per-cell details → §3 Winner gate trace → §4 PR-α/β/γ decision → §5 findings → §6 open questions → §7 references).

### Edit

- `src/services/prompts/classifierPrompts.ts` — Add `v5-L1`, `v5-L2`, `v5-L4`, `v5-L5` to the `ClassifierPromptVersion` union and the `REGISTRY` constant. Do NOT change `DEFAULT_CLASSIFIER_PROMPT_VERSION` (stays `"v2"`).
- `src/services/prompts/_generated.ts` — Regenerate via `pnpm embed-prompts` after the new `.md` files exist. `pnpm verify-prompts` (CI guard) must pass.
- `evals/scripts/run-classification-eval.ts` — Add:
  - `--prompt-source <file|langfuse>` flag (default `file`).
  - When `langfuse`, fetch prompt body via Langfuse Prompts API by `(version, label="production")` or equivalent.
  - Emit per-run scores: `accuracy`, `bad_response_rate`, `mean_reasoning_tokens`, `p95_reasoning_tokens`.
  - Emit per-trace metadata: `lever_id` (derived from `--prompt-version`), `reasoning_effort` (value passed via `--reasoning-effort`).
  - Existing flags `--prompt-version`, `--reasoning-effort`, `--max-completion-tokens` already exist; just extend the `VALID_PROMPT_VERSIONS` allowlist.
- `evals/agent-results.json` — Append 8 ledger rows during PR-β. Format mirrors prior runs (see `2026-05-12-classification-multilingual-en-gpt-5-nano-prompt-v4-light-A-effort-low-cap1024` for shape; this run is `2026-05-13-classification-multilingual-<lang>-gpt-5.4-nano-prompt-v5-<lever>-effort-<default|minimal>-cap512`).
- `src/__tests__/llmClassifier.test.ts` — Pin tests must still pass with V2 default. If a test references V2 prompt body keywords, no change needed. If you must touch this file, double-check the eight test-assertion keywords listed in `src/CLAUDE.md` §"Prompt body lives in versioned `.md` files."

---

## 9. Implementation plan (PR-α + PR-β tracer-bullet steps)

### PR-α — Infrastructure (no production change, no measurement run yet)

1. **Author 4 prompt files + regenerate bundle.** Write `prompts/classifier/system.v5-{L1,L2,L4,L5}.md` per §8 specs (keep the V2 frontmatter shape — `id: classifier/system`, `version: v5-LX`, `model_target: gpt-5.4-nano`, `created: 2026-05-13`, `supersedes: v2`, `eval_baseline: evals/report-2026-05-11-prompt-rewrite.md`, `guide_source: https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.4`, `notes: ...`). Add the four versions to `ClassifierPromptVersion` and `REGISTRY` in `src/services/prompts/classifierPrompts.ts`. Run `pnpm embed-prompts` to refresh `_generated.ts`. **Verify:** `pnpm verify-prompts` passes; `pnpm test` passes (V2 still the default; eight required test-assertion keywords intact in V2).
2. **Upload script.** Write `scripts/upload-prompts-to-langfuse.ts` per §8. Confirm Langfuse client API surface (§7 open question). Test the script in dry-run mode against the Langfuse dev project; verify idempotency (second run = no-op). **Verify:** Langfuse UI shows v2 + v5-L1 + v5-L2 + v5-L4 + v5-L5 as Prompt entries with content hashes.
3. **Runner extension.** In `evals/scripts/run-classification-eval.ts`: extend `VALID_PROMPT_VERSIONS`, add `--prompt-source` flag, plumb Langfuse Prompts fetch, emit custom scores + trace metadata. Run the existing regression eval (V2) against both `--prompt-source file` and `--prompt-source langfuse` — output must be byte-identical for the same case. **Verify:** `pnpm tsx evals/scripts/run-classification-eval.ts` (V2 default, file source) → 20/20 + `user-report-*` 0 fail. Same command with `--prompt-source langfuse` → identical pass count.
4. **ADR-0003.** Write `docs/decisions/0003-langfuse-prompt-management-eval-only.md` per §6 outline. Cross-link from ADR-0001 (`docs/decisions/0001-langfuse-eval-only.md`) "Consequences" section if it references prompt storage at all (verify; non-blocking if not).
5. **Gates + commit.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `python3 scripts/check-context-paths.py`. Open PR-α with the title `feat(evals): gpt-5.4-nano 프롬프트 차원 실험 인프라 (PR-α — L1/L2/L4/L5 + Langfuse Prompt Management)`. Merge before PR-β.

### PR-β — Measurement + Report

6. **8-cell measurement.** Loop through 8 (prompt, reasoning_effort) cells × 4 langs = 32 sub-runs. Each sub-run is one invocation of `run-classification-eval.ts` with the right `--task-file`, `--prompt-version`, `--reasoning-effort`, `--max-completion-tokens=512`, `--include-rule-leg`, `--prompt-source=langfuse`. Capture stdout to `evals/_runs/2026-05-13/<lang>-<cell>.log`. **Verify:** all 32 runs produce a Langfuse run URL, all 32 append one row to `evals/agent-results.json`, no run shows `bad_response_rate > 0`. Total wall time estimate: ~30–60 min serial; cost ≈ $1.2.
7. **Apply winner gate.** Compute the eight cells' P1/P2 + Q1–Q3 + C1–C5 per §4.6. Trace each verdict in the report as a table (mirror `evals/report-2026-05-13-nano-prompt-stage1.md` §3 structure).
8. **Stage 2 verification (conditional).** If any cell fires γ Quality or γ Cost-Pareto, re-run that cell at `--max-completion-tokens=64` against all 4 langs. Append 4 more ledger rows tagged `cap64-verify`. Update the report §"Winner gate trace" with verification result.
9. **Write the report.** `evals/report-2026-05-13-gpt-5.4-nano-prompt-tuning.md` covering: TL;DR table (8 cells), per-cell details, winner gate trace (§3-style), lever characterization findings (one paragraph per lever — directional verdict + reasoning_tokens commentary), reasoning_effort findings (C0a vs C0b answer), open questions, references. End with a PR-γ-or-terminal decision sentence.
10. **Gates + commit.** Same as PR-α gates + `python3 scripts/check-context-paths.py` (the new report file's links must resolve). Open PR-β with the title `feat(evals): gpt-5.4-nano 프롬프트 차원 실험 측정 + 보고서 (PR-β — L1/L2/L4/L5 × {default, minimal})`.

---

## 10. First action

Run these three reads in parallel from the worktree root before writing anything:

```bash
# 1. Confirm the Langfuse client surface (settles §7 open question 1)
ls node_modules/@langfuse/client/dist | head
# 2. Re-verify V2 prompt body so v5-L1.md frontmatter + structure copies cleanly
cat prompts/classifier/system.v2.md
# 3. Re-verify the existing runner's `--prompt-version` / `--reasoning-effort` plumbing
sed -n '100,160p' evals/scripts/run-classification-eval.ts
```

Then proceed to **step 1 of §9: author `prompts/classifier/system.v5-L1.md`**. Frontmatter shape from V2; body = V2 minus paraphrase/hypernym variations? No — that's L5. For **L1 specifically**: V2 verbatim, but prepend a new bullet to the top of `# Critical rule` (or insert as a leading paragraph): *"Suppress follow-up questions. Do not ask the user anything. Output only the JSON object, then stop. Do not append explanations, confidences, or alternative categories."*

That single edit on a V2 copy is the entire L1 variant. Author it first because it's the smallest delta — verifies the frontmatter / `pnpm embed-prompts` / `pnpm verify-prompts` toolchain end-to-end before you commit to the larger L2/L4/L5 rewrites.

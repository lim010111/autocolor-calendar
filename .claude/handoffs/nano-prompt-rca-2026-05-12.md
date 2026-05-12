# gpt-5-nano 분류 실패 RCA + 프롬프트 변형 실험 — Handoff

## How to use this handoff

You are picking up after a `/grill-with-docs` planning session. Read this entire
file, then start with §10. Decisions in §4 are settled — do not re-litigate them.
The original plan file is at `/home/shine/.claude/plans/grill-polished-wave.md` if
you want the long version, but everything you need to execute is in this handoff.

## Goal

`evals/report-2026-05-11-gpt-5-nano-migration.md` showed gpt-5-nano + system.v3 +
cap=1024 fails the production -1%p gate in all 4 languages on the classification
eval. The dominant failure mode is `bad_response` (39–60% of cases) where the
JSON output is truncated by reasoning-token exhaustion — when responses do
complete, semantic accuracy is 90–96%, identical to baseline. The investigation
goal is **Outcome B**: find a prompt variant or API-parameter combo that brings
gpt-5-nano above the gate (bad_response ≤ 5% AND accuracy ≥ baseline−1%p) on all
4 languages, so we can adopt it (gpt-5-nano is materially cheaper than
gpt-5.4-nano). If 4 waves of variants all fail, transition to **Outcome C**:
write `docs/adr/0001-llm-classifier-model.md` locking gpt-5.4-nano as the
production model and document the RCA. Either branch produces
`evals/report-2026-05-12-nano-rca.md`.

## Scope

**In scope**
- Extend `evals/scripts/run-classification-eval.ts` with Langfuse SDK,
  `reasoning_effort=minimal` support, `reasoning.summary` capture,
  `incomplete_details.reason` extraction, and new CLI flags (`--wave`,
  `--variant-id`, `--reasoning-summary`, `--langfuse-dataset`).
- New idempotent uploader `evals/scripts/upload-langfuse-datasets.ts` that pushes
  the 4 existing language datasets into Langfuse.
- Wave 1–4 experiments (English-only first; CJK only in Wave 4) per the wave
  table in §4.
- New prompt files in `prompts/classifier/` per the wave table.
- Final RCA report `evals/report-2026-05-12-nano-rca.md`.
- Conditional: `docs/adr/0001-llm-classifier-model.md` if Outcome C triggers.

**Out of scope / non-goals**
- Changing `LLM_MODEL` in `src/services/llmClassifier.ts:68`. If Outcome B wins,
  the model swap is a **separate PR**, not part of this experiment.
- Wiring Langfuse into the Cloudflare Worker — the existing deferral
  (`src/CLAUDE.md §6.3`) stands; Langfuse lives operator-side only.
- `verbosity` parameter sweep — one new dimension at a time.
- Touching the 20-case regression guard.
- Any change to production classification behavior.
- Re-running the existing `reasoning_effort low/medium/high/xhigh` sweep on
  gpt-5.4-nano (already in `evals/report-2026-05-11-prompt-rewrite.md`).

## Decisions

### Outcome B is the primary goal; C is the fallback only if all waves fail

**Decision:** Pursue a viable gpt-5-nano configuration first. Only if all 4
waves fail the promotion gate, transition to writing an ADR that locks
gpt-5.4-nano.

**Why:** User explicitly asked for B with C fallback: "일단 B를 시도하는 게
맞아. 실제 비용은 따져봐야겠지만 gpt-5-nano가 훨씬 저렴하니까. 다만 가능성이
전혀 보이지 않으면 C로 가자."

**Alternatives considered:** Going straight to C (cheaper, faster) was
discussed but rejected — the previous report identified the failure as
token-budget exhaustion, not semantic error, which leaves real headroom for a
parameter/prompt fix.

### Use Langfuse Dataset + Experiment, not Session

**Decision:** Model the experiment in Langfuse using `Dataset` + `Experiment`
primitives. One Dataset per language (4 total, 192 items each). One Experiment
per `(wave × variant × language)` run, named `nano-rca-{wave}-{variant_id}-{lang}`.
`sessionId` is not set.

**Why:** Langfuse Sessions are designed for conversation replay (the docs say
"see a simple session replay of the entire interaction"). Our 192 calls per run
are independent classifications; Sessions UI does not buy us anything. Datasets +
Experiments give native per-item diff and aggregate comparison across variants —
the exact shape we need. The user accepted this redirect from the literal
"session" wording in their original ask.

**Alternatives considered:** (1) Use Session per variant — rejected, wrong
abstraction. (2) Use only flat traces with metadata filtering — workable but
loses the Dataset binding for per-item comparison.

### Wave structure: cheap signal first, English-only until last wave

**Decision:** Four iterative waves on English (192 cases each), then Wave 5 to
verify the winning variant on all 4 languages.

| Wave | Variant | Change vs v3 | Hypothesis |
|---|---|---|---|
| W1 | V1 | v3 + `reasoning_effort=minimal`, cap=1024 | H5: only token budget was wrong |
| W2 | V2-stripped | Remove `## Exact step order` + `## Edge cases and tie-breakers`, shot 6→2, default effort | H1+H2: prompt induces reasoning |
| W3 | V3-combined | V2-stripped + `reasoning_effort=minimal` | combination |
| W4 | V4-localized | V3-combined translated into ko / zh-CN / zh-TW, that language only | H3: prompt-language mismatch on CJK |
| W5 | winner | run winner across all 4 langs, 192 each | final -1%p gate |

**Why:** Cost is trivial (~$2 total) — the value of iteration is **fast signal
to decide the next wave or trigger C**. H5 is the single coordinate the previous
sweep never tested (`minimal` was not in `low/medium/high/xhigh`). If H5 alone
fixes it, the code change is one line and no prompt work is needed at all.

**Alternatives considered:** (1) One-shot grid of 8 variants × 4 langs — wastes
budget when promotion conditions short-circuit early. (2) Start with Korean to
test H3 first — rejected because if it doesn't work in English (the most
favorable language), it won't work in CJK; English-first isolates token-budget
from language-mismatch.

### Promotion gate

**Decision:** After each wave, decide using:

| `bad_response` rate | `accuracy` (excluding bad_response) | Action |
|---|---|---|
| ≤ 5% | ≥ baseline − 1%p | Jump to Wave 5 (4-language verification) |
| ≤ 5% | < baseline − 1%p | **Transition to Outcome C immediately** — token fixed but semantics broke, prompt is over-stripped |
| > 5% | (any) | Continue to next wave |

Per-language baseline (from existing report):
- en 90.1% → gate ≥ 89.1%
- ko 88.5% → gate ≥ 87.5%
- zh-CN 89.1% → gate ≥ 88.1%
- zh-TW 89.1% → gate ≥ 88.1%

**Why:** The -1%p accuracy bar is the existing production gate; bad_response ≤
5% is the threshold below which "token exhaustion is no longer the dominant
failure mode."

### Capture `reasoning.summary` on every call

**Decision:** Every OpenAI call passes `reasoning: { summary: "concise" }` and
the returned summary string is stored on the Langfuse trace metadata as
`reasoning_summary`. Also captured: `reasoning_tokens`, `completion_tokens`,
`incomplete_reason`.

**Why:** Without mechanism evidence, the RCA can only say "variant X worked,"
not why. With reasoning summaries, the report can quote actual nano internal
text — necessary for an honest B-vs-C decision and for future readers.
Per-call cost ~50 tokens (negligible).

**Alternatives considered:** Skip and infer from token counts only — rejected,
cheaper but uninformative.

### Use `incomplete_details.reason` to detect bad_response

**Decision:** Treat `response.incomplete_details.reason === "max_output_tokens"`
as the canonical bad_response signal. JSON parse failure stays as a secondary
signal recorded separately under `notes.failure_breakdown` in the ledger.

**Why:** OpenAI's reasoning guide explicitly documents this field. The current
runner detects bad_response only via JSON parse failure, which conflates
truncation with other malformed outputs.

### Fall back to `low` if `minimal` is rejected on gpt-5-nano

**Decision:** If the OpenAI API returns 400 on `reasoning_effort=minimal` for
gpt-5-nano, fall back to `low` for that variant and record
`effort_fallback: minimal_rejected → low` in the ledger row's `notes`. Continue
the experiment.

**Why:** Docs guarantee `minimal` exists for the GPT-5 family generally; a
community report from August 2025 saw a 400 on gpt-5-nano specifically. Today's
status (2026-05) is uncertain. Defensive fallback keeps the experiment moving.

### Extend the existing TS runner; don't build a parallel Python one

**Decision:** All experiment work happens in
`evals/scripts/run-classification-eval.ts`. The Python `evals/dataset-builder/`
pipeline stays as the dataset producer; classification inference remains TS so
the prompt loader, OpenAI call shape, and ledger format match production.

**Why:** Same prompt loader (`src/services/prompts/classifierPrompts.ts`), same
OpenAI request shape as `src/services/llmClassifier.ts:329-366`. Reusing this
guarantees parity with production; a new Python runner would drift.

### Langfuse env vars live operator-side, not in the Worker

**Decision:** Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`
in a local `.env` or shell export. Not in `.dev.vars` or `wrangler` secrets.

**Why:** The Worker integration remains deferred (`src/CLAUDE.md §6.3`). The
eval runner is operator-side TS — no Workers SDK constraint.

## Domain terms

- **bad_response** — A classification call whose response was not a valid
  category-name JSON. Primary cause: reasoning-token budget exhausted before
  output was generated, surfaced as
  `response.incomplete_details.reason === "max_output_tokens"`. Secondary: JSON
  parse failure. See `src/services/llmClassifier.ts:378-394` for the existing
  parser.
- **Promotion gate** — Wave-level pass criterion: `bad_response ≤ 5%` AND
  `accuracy (excluding bad_response) ≥ baseline − 1%p`.
- **Outcome B / Outcome C** — Defined in §2.
- **Wave** — One iteration of the experiment: one variant tested on (initially)
  English only. Promotion to next wave or to Wave 5 is automatic per the gate.
- **Variant** — A specific `(prompt_version, reasoning_effort, max_completion_tokens)`
  triple. Tagged with an id like `V1`, `V2-stripped`, etc., and surfaced in
  Langfuse experiment name + ledger note.
- **Langfuse Dataset** — A versioned collection of items (one per language;
  classification cases). Created once; experiments bind to it.
- **Langfuse Experiment** — One execution of a variant against a Dataset, with
  per-item traces and aggregate scoring.
- **Reasoning summary** — String returned by OpenAI when
  `reasoning: { summary: "concise" }` is sent; describes what the model
  internally reasoned about. Stored on each Langfuse trace metadata.
- **Baseline** — gpt-5.4-nano + system.v2 + cap=64 + no `reasoning_effort` flag,
  numbers from `evals/report-2026-05-11-prompt-rewrite.md`.

Full glossary: this repo has no `CONTEXT.md`. The closest canonical source for
LLM-side terminology is `src/CLAUDE.md` §5.3 ("LLM semantic matching policy")
and §6 ("Observability tables").

## ADRs created this session

None. (`docs/adr/0001-llm-classifier-model.md` will be created **only if
Outcome C triggers**.)

## Open questions

1. **Does `reasoning_effort=minimal` work on gpt-5-nano today (2026-05)?** —
   Docs say "supported on GPT-5 family," but a 2025-08 community report saw a
   400. Resolution: try it in Step 3; if rejected, fall back to `low` per the
   decision above and note the rejection in the report.
2. **Does `prompts/_generated/` have an automated build flow, or do new prompt
   files need manual loader registration?** — `prompts/README.md` mentions
   `src/services/prompts/classifierPrompts.ts` and `_generated.ts` but the
   trigger is unclear. Resolution: inspect during Step 4 (first time a new
   prompt file is added).

## Files to touch

**Edit:**
- `evals/scripts/run-classification-eval.ts` — add Langfuse SDK init, new CLI
  flags (`--reasoning-summary`, `--wave`, `--variant-id`, `--langfuse-dataset`),
  trace + metadata emission, `reasoning.summary` request + capture,
  `incomplete_details.reason` extraction, ledger `notes.failure_breakdown`
  enrichment, `effort_fallback` handling.

**Create:**
- `evals/scripts/upload-langfuse-datasets.ts` — idempotent uploader for the 4
  language datasets.
- `prompts/classifier/system.v4-stripped.md` — Wave 2 / 3 prompt (v3 minus
  `## Exact step order` and `## Edge cases and tie-breakers`, shots 6→2).
  Frontmatter per `prompts/README.md`.
- `prompts/classifier/system.v4-ko.md` — Wave 4 Korean translation of
  v4-stripped, with shots rewritten naturally in Korean (not literal).
- `prompts/classifier/system.v4-zh-CN.md` — Wave 4, same shape, Simplified Chinese.
- `prompts/classifier/system.v4-zh-TW.md` — Wave 4, Traditional Chinese.
- `evals/report-2026-05-12-nano-rca.md` — final RCA report. Cite Langfuse
  experiment URLs, ledger row git_sha, and quote `reasoning_summary` samples.
- **Outcome C only:** `docs/adr/0001-llm-classifier-model.md` — first ADR in
  the repo (the `docs/adr/` directory does not exist yet).

## Implementation plan

1. **Add Langfuse SDK + dataset uploader.** Install `langfuse@^3`. Create
   `evals/scripts/upload-langfuse-datasets.ts`. Run it once; verify the 4
   datasets appear in Langfuse UI with 192 items each. Confirm env vars work
   from shell.
2. **Extend `evals/scripts/run-classification-eval.ts`.** Wire Langfuse trace
   creation around the OpenAI call. Add the new CLI flags. Add
   `reasoning: { summary: "concise" }` to the request body. Extract
   `incomplete_details.reason` and the reasoning summary from the response.
   Update the ledger note schema to include `wave`, `variant_id`,
   `failure_breakdown` (split bad_response into `truncated` vs `parse_error`),
   and `effort_fallback`. Flush Langfuse on exit. Run a smoke test with `--wave
   smoke --variant-id smoke --task-file evals/datasets/en/classification.json
   --model gpt-5.4-nano --prompt-version v2 --max-completion-tokens 64` and
   verify all 192 traces show up in Langfuse with full metadata.
3. **Wave 1 — V1.** Run `--model gpt-5-nano --prompt-version v3
   --reasoning-effort minimal --max-completion-tokens 1024 --wave W1
   --variant-id V1 --langfuse-dataset classification-en` against English
   dataset. If 400 on `minimal`, fall back to `low` and note it. Apply
   promotion gate. If pass → jump to Step 6.
4. **Wave 2 — V2-stripped.** If W1 failed, create
   `prompts/classifier/system.v4-stripped.md`. Run with `--prompt-version
   v4-stripped --wave W2 --variant-id V2`, default effort, cap=1024, English.
   Apply gate. If pass → Step 6. If `bad_response ≤ 5%` but accuracy fell
   below the gate → transition to Outcome C, jump to Step 7.
5. **Wave 3 / Wave 4 as needed.** W3 = V2-stripped + `reasoning_effort=minimal`.
   W4 = create `system.v4-{ko,zh-CN,zh-TW}.md` and run each only on its own
   language. If W4 still fails the gate → Outcome C.
6. **Wave 5 — winner.** Run the winning variant on all 4 language datasets,
   192 cases each. Verify each language passes its own -1%p gate. If any
   language fails, mark as a conditional win and document in the report.
7. **Write the RCA.** Create `evals/report-2026-05-12-nano-rca.md` with the
   wave table, Langfuse experiment URLs, ledger git_sha references, quoted
   reasoning-summary samples, and recommendation. If Outcome B: name the
   winning variant and recommend a follow-up PR to flip `LLM_MODEL`. If
   Outcome C: create `docs/adr/0001-llm-classifier-model.md` locking
   gpt-5.4-nano and cross-reference the RCA.

## First action

Open `evals/scripts/run-classification-eval.ts` and read the full file to
understand the existing CLI, ledger-row construction, and OpenAI call shape —
then install `langfuse@^3` and start the new
`evals/scripts/upload-langfuse-datasets.ts` uploader.

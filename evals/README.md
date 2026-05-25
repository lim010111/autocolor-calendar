# Agent Evaluations

`evals/` tracks how well coding agents (Claude Code, plus future skills /
subagents) perform against this repo. The aim is **not** to benchmark Claude
itself — Anthropic does that. The aim is to measure whether the *repository's
context fabric* (CLAUDE.md, runbooks, hooks, tests) is keeping agent runs
correct over time.

## What lives here

- `agent-results.json` — the latest scoreboard. One row per measurement.
  Consumed by `docs/ai-readiness-map.html` and trended over time. Today's
  baseline measurement comes from the AI-readiness audit (rubric v2-100pt);
  task pass-rate suites land in subsequent passes.
- `tasks/` — *pending.* Reproducible task prompts agents are scored on
  (e.g., "add a new category route", "rotate `TOKEN_ENCRYPTION_KEY`",
  "patch a sync bug given a failing test"). Each task pairs a prompt
  with a verifier (typecheck + targeted test).

## How a run is scored

1. Run the AI-readiness scorer (the `score.py` shipped with the
   `ai-readiness-cartography` Claude Code skill) — gives the structural
   baseline (Categories A–G, 100 pts).
2. Per task in `tasks/`, dispatch an agent with the task prompt as its only
   input plus the repo state at HEAD; capture stdout + diff.
3. Verify with `pnpm test`, `pnpm typecheck`, and any task-specific
   assertions; record pass / fail / partial.
4. Append a row to `agent-results.json` (do not overwrite — the file is a
   ledger). Keep the prior rows so drift is visible.

## Layer 3 — semantic-classification eval

Reproducible regression suite for the §5.3 LLM matching policy (see
`src/CLAUDE.md` "LLM semantic matching policy (§5.3)"). Each case in
`tasks/classification-semantic.json` is fired against the live OpenAI API
using the production prompt builder + parser (`src/services/llmClassifier.ts`),
so any prompt regression — surface-level lapse, false-positive
anti-overstretch break, cross-lingual drop — is visible the moment it lands.

### Run

```bash
# OPENAI_API_KEY can come from env or .dev.vars
pnpm tsx evals/scripts/run-classification-eval.ts
```

Prints `PASS` / `FAIL` per case and appends one row to `agent-results.json`.
Exit code is `1` when any case tagged `user-report-*` fails OR overall
pass-rate falls below 90% — suitable as a manual pre-merge gate for prompt
edits. Otherwise `0`.

Set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` in `.dev.vars` to mirror
each case into Langfuse as a per-case trace; the runner prints a
`Langfuse run: <url>` line on success. Soft-dep — eval still runs and
gates without it. See [ADR-0001](../docs/adr/0001-langfuse-eval-only.md).

### Cost

Per run: ~20 cases × (~3K input + ≤64 completion tokens) ≈ 60K input +
1.3K output tokens. With current `gpt-5.4-nano` pricing this is well under
$0.02 per run. The script **bypasses `reserveLlmCall`** (the per-user
runtime quota) — operator OpenAI budget is metered separately and does
not consume `llm_usage_global_daily` / `llm_usage_daily` rows.

### Adding cases

Append to `tasks/classification-semantic.json#cases`. Each case is:

- `id` — slug used in the per-row PASS/FAIL line.
- `tag` — comma-separated labels (e.g. `hypernym,user-report-2026-05-08`).
  Cases tagged `user-report-*` are merge-blocking.
- `categories` — `{name, keywords[], colorId}[]`, ordered by user-defined
  priority (the chain delivers them this way).
- `event` — `{summary?, description?, location?}`. Same fields the prompt
  builder reads; PII redaction is automatically applied through
  `buildPrompt`.
- `expected.category_name` — `"Meal"` / `"none"` / etc. Compared with
  strict equality against the parsed model response (`parseCategoryName`
  reused from the runtime path).

### Ledger row shape

The script appends to the existing append-only `agent-results.json` ledger
using the schema below. Don't overwrite earlier rows — prompt drift over
time is the entire point.

```json
{
  "run_id": "2026-05-08-classification-semantic",
  "timestamp": "2026-05-08T...",
  "git_sha": "<short HEAD>",
  "kind": "task_pass_rate",
  "tool": "classification-semantic-eval",
  "score": 18,
  "max": 20,
  "grade": null,
  "categories": null,
  "task_pass_rate": 0.9,
  "notes": "model=gpt-5.4-nano; cases tagged user-report-2026-05-08 must all pass"
}
```

## Layer 4 — multilingual classification eval

Per-language baseline measurement for the 4 supported locales
(`en` / `ko` / `zh-CN` / `zh-TW` per `gas/i18n.js`). Built once-per-source
from HuggingFace `anakin87/events-scheduling`, then translated; case ids are
1:1 across the 4 lang siblings so cross-lingual deltas are visible at a
glance. Builder lives at [`dataset-builder/`](./dataset-builder/) (Python /
UV) — operator-only, **not in CI**.

### Run

```bash
# Build (once per source revision; idempotent per stage)
cd evals/dataset-builder && uv sync && uv run build-dataset all

# Score a language (reads dataset's evaluator.threshold + blocking_tags)
pnpm tsx evals/scripts/run-classification-eval.ts \
  --task-file evals/datasets/en/classification.json --include-rule-leg
```

`--include-rule-leg` adds rule-leg hit / pass numbers alongside the LLM leg
in stdout and in the ledger row's `notes`. `--task-file` is opt-in; calling
the runner with no args still drives the original
`evals/tasks/classification-semantic.json` regression suite (same 90% gate,
same `user-report-*` blocking).

Before the first Layer 4 invocation, upload the per-language datasets
into Langfuse via `pnpm tsx evals/scripts/sync-langfuse-dataset.ts all`
(idempotent upsert by `case.id`, rerun after every dataset rebuild). With
`LANGFUSE_*` keys present in `.dev.vars`, the runner then links each
trace to its dataset item and prints a `Langfuse run: <url>` line that
groups all 192 traces — see
[ADR-0001](../docs/adr/0001-langfuse-eval-only.md). Same soft-dep
posture as Layer 3.

Per-run cost (Layer 4): ~192 cases × 4 langs × ≤300 tokens against
`gpt-5.4-nano` ≈ $0.5 total. Build cost: < $3 (embed + label + augment +
translate via Batch API).

### Ledger row shape (Layer 4)

```json
{
  "run_id": "<date>-classification-multilingual-<lang>",
  "tool":   "classification-multilingual-<lang>-eval",
  "kind":   "task_pass_rate",
  "score":  168, "max": 192, "task_pass_rate": 0.875,
  "notes":  "model=gpt-5.4-nano; dataset=evals/datasets/<lang>/...; lang=<lang>; rule_hit=137/192; rule_pass=128/192"
}
```

The Layer 3 ledger schema is unchanged — Layer 4 just lands as additional
rows with their own `tool` / `run_id` and `lang` in `notes`.

### Limits to keep in mind

- Source dedups to 50 unique titles → augmented to ~192 cases via
  gpt-5.5 paraphrasing. Per-category accuracy CIs are correspondingly wide.
- Translations collapse ~22–25% of English paraphrases onto the same target
  string — 1:1 case id mapping is preserved, but per-lang stats lean toward
  the most "natural" target phrasing.
- Cases have only `summary` (no `description` / `location`); the prod
  classifier reads all three. Treat these as a lower bound.
- See the [builder README](./dataset-builder/README.md) "Known
  limitations" for the full list.

## Telemetry

- **Session log.** Claude Code session JSONLs live under
  `~/.claude/projects/-home-shine-projects-autocolor-for-calendar/` and
  carry per-tool token + duration data. A skill to aggregate them into a
  session-cost dashboard is planned, not yet built.
- **Worker request log.** `src/middleware/logger.ts` is the single
  redaction point — the agent log path on the runtime side. Anything
  added here must respect the `src/CLAUDE.md` "Log redaction contract"
  (no event payloads, no query strings).
- **Score trend.** `docs/ai-readiness-score.json` is the durable trend
  point; CI re-runs the scorer on demand and writes a fresh snapshot.
- **Per-case trace UI (Langfuse, eval-only).** When `LANGFUSE_PUBLIC_KEY`
  is set in `.dev.vars`, `run-classification-eval.ts` mirrors each case
  into Langfuse Cloud (EU) as one trace linked to a dataset item.
  Datasets `autocolor-classification-{en,ko,zh-CN,zh-TW}` are populated
  via a dedicated `sync-langfuse-dataset` step under `evals/scripts/`,
  run once per dataset rebuild (idempotent upsert by `case.id`).
  The integration is **soft-dep**: SDK failure or unset env never
  affects the merge-gate exit code or `agent-results.json` ledger row —
  Langfuse is augmentation, the ledger remains canonical. Scope and
  trade-offs: [`../docs/adr/0001-langfuse-eval-only.md`](../docs/adr/0001-langfuse-eval-only.md).
  The runtime / Worker path **does NOT** use Langfuse — see
  [`../src/CLAUDE.md`](../src/CLAUDE.md) "Langfuse trade-off note".

## Why the bar is "task pass-rate", not "rubric score"

A high rubric score means the repo *should* be agent-friendly. A high
pass-rate confirms it actually is. The two diverge when tribal rules are
written but unenforced (high B / C, low pass-rate) or when the structure
is sparse but the code is small enough to fit in context (low B, high
pass-rate). Tracking both prevents Goodhart's law on either axis.

## See also

- [../docs/ai-readiness-map.html](../docs/ai-readiness-map.html) — the
  AI-Ready dashboard (HTML view of `agent-results.json` plus rubric).
- [../docs/ai-readiness-score.json](../docs/ai-readiness-score.json) —
  raw rubric scorecard (machine-readable trend point).
- [../scripts/check-context-paths.py](../scripts/check-context-paths.py)
  — reference-accuracy gate (an upstream input to E1).

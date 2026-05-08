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

## Telemetry

- **Session log.** Claude Code session JSONLs live under
  `~/.claude/projects/-home-shine-projects-autocolor-for-calendar/` and
  carry per-tool token + duration data; the `improve-token-efficiency`
  skill aggregates them into a session-cost dashboard.
- **Worker request log.** `src/middleware/logger.ts` is the single
  redaction point — the agent log path on the runtime side. Anything
  added here must respect the `src/CLAUDE.md` "Log redaction contract"
  (no event payloads, no query strings).
- **Score trend.** `docs/ai-readiness-score.json` is the durable trend
  point; CI re-runs the scorer on demand and writes a fresh snapshot.

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

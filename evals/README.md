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

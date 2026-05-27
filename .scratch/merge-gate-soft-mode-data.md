# Merge-gate soft-mode data — autocolor_for_calendar

> Lite informational tracker. **Not counted toward** the harness project's
> `#10` (`claude-harness-work/.scratch/merge-gate/issues/10-soft-to-hard-promotion.md`),
> which is scoped to `chess_transformer` only. This file holds autocolor's own
> soft-mode observations as a parallel, secondary dataset.

## Why this exists

`merge-gate` was installed via PR #100 (`chore/setup-ci-harnesses`). Soft-mode
shipping means every PR generates Codex adversarial-review + Claude validator
output even though nothing blocks. That data is informative on its own and
provides a cross-codebase signal back to the harness project:

- Does the gate behave similarly on a codebase with different AGENTS.md depth,
  domain vocabulary, and PR style than `chess_transformer`?
- Are the same finding categories surfaced organically?
- Where does Codex / validator drift on autocolor that it didn't on
  chess_transformer? (A divergence is information the harness team can use.)

## Soft-mode entries

Legend — **FP**: gate said block, human said no-block (validator over-firing).
**FN**: gate said pass, human said should-have-blocked (validator missed it).
Hard-flip criteria: FPR ≤ 1 across N≥10 entries (see
`docs/merge-gate-operations.md` §2).

Tally: **1 / 10** measured · FPR 0 · FNR 0

| # | PR | Date | Codex | Validator | Gate (hard) | Human verdict | FP? | FN? |
|---|---|---|---|---|---|---|---|---|
| 1 | [#100](https://github.com/lim010111/autocolor-calendar/pull/100) | 2026-05-27 | `needs-attention`, 1 high (`docs-only globs include gate enforcement code`) | `uphold` | block | should-block | No | No |

### Entry 1 — notes

Self-protection finding on the gate's own install PR. Codex noticed that
`docs_only_globs` blanket-matched `**/*.md`, so the validator agent
definition (`.claude/agents/codex-review-validator.md`) and runtime skill
(`.claude/skills/run-codex-validators/SKILL.md`) would have qualified for
the docs-only short-circuit — a clean bypass route around the gate's own
enforcement. Validator (Claude) upheld; fix landed in commit `8a13573`
narrowing the globs to a positive allowlist that excludes `.claude/**`.

This is a true positive — *not* a false positive against the soft→hard
criteria. The gate behaved exactly as intended.

## Hard-flip decision

autocolor's branch protection / `harness.toml [merge-gate].soft_mode_default`
flip is governed by `docs/merge-gate-operations.md §2` (same criteria as
chess_transformer: N ≥ 10, FPR ≤ 1, human sign-off). When/if met, append the
sign-off block here and re-run `/setup-merge-gate` with
`--soft-mode-default false`.

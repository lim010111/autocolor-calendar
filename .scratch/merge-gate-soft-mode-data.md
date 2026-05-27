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

PR-level counting — one PR = one entry, even if multiple Codex runs across
its commits surface different findings. Run-by-run notes are recorded
under the entry's narrative block.

| # | PR | Date | Codex (latest run) | Validator | Gate (hard) | Human verdict | FP? | FN? |
|---|---|---|---|---|---|---|---|---|
| 1 | [#100](https://github.com/lim010111/autocolor-calendar/pull/100) | 2026-05-27 | `needs-attention`, 2 high + 1 medium + 1 low (validator fallback fail-open · workflow trust boundary · workflow_dispatch BASE_REF · missing ADR link) | `uphold` ×4 (2 blocking) | block | should-block | No | No |

### Entry 1 — notes

The gate surfaced **two separate self-protection finding classes** across
two runs on this PR. Both were true positives — not false positives
against the soft→hard criteria.

**Run 1 (commit `0c8056f` — initial merge-gate install)** — Codex found
that `docs_only_globs` blanket-matched `**/*.md`, so the validator agent
definition (`.claude/agents/codex-review-validator.md`) and runtime
skill (`.claude/skills/run-codex-validators/SKILL.md`) would have
qualified for the docs-only short-circuit — a clean bypass route around
the gate's own enforcement. Validator upheld; fix landed in commit
`8a13573` narrowing the globs to a positive allowlist that excludes
`.claude/**`.

**Run 2 (commit `1a2f491` — after the globs fix)** — with the surface
bypass closed, Codex went deeper and surfaced **4 findings, all upheld
by the validator**, 2 of them blocking:

1. *[high]* `.claude/skills/run-codex-validators/scripts/aggregate.py:327`
   — fallback writer emits empty `aggregate[]` and returns success, so
   if the validator subagent dies mid-run the workflow's
   `[.aggregate[] | select(.block==true)] | length` evaluates to 0 and
   hard mode passes even when Codex itself produced critical/high. The
   gate fails open instead of fail-closed.
2. *[high]* `.github/workflows/codex-review.yml:195` — workflow is
   `pull_request`-triggered, injects `CODEX_API_KEY`, runs
   `codex exec --dangerously-bypass-approvals-and-sandbox`, and feeds
   the PR diff into the prompt. Fork PRs don't get secrets but
   same-repo collaborator branches do — that's enough for prompt-
   injection-based secret exfil to be a real boundary issue.
3. *[medium]* `.github/workflows/codex-review.yml:20` —
   `workflow_dispatch` path runs the PR-only review command with a
   broken BASE_REF resolution.
4. *[low]* `docs/merge-gate-operations.md:9` — links to an ADR that
   isn't published.

Both high findings are **vendored harness code** (snapshots of the
global layer, not autocolor-authored), so they cannot be fixed in this
repo without diverging from the upstream skill. Tracked upstream as
`claude-harness-work/.scratch/merge-gate/issues/24-validator-fallback-fail-open.md`
and `…/25-workflow-trust-boundary.md`. PR #100 waits on at least the
fallback fix before merge; the workflow trust-boundary fix has more
options to weigh and may land asynchronously.

### Cross-codebase signal back to harness `#10`

Run 2 is the kind of data point the PRD's `## Deployments` section
called out: a parallel deployment finding flaws that the primary
(`chess_transformer`) hasn't seen yet, because chess's only PR #25 was
a clean 0-finding pass. autocolor's denser AGENTS.md and broader
surface area gave Codex more to work with on the gate's own
installation diff.

## Hard-flip decision

autocolor's branch protection / `harness.toml [merge-gate].soft_mode_default`
flip is governed by `docs/merge-gate-operations.md §2` (same criteria as
chess_transformer: N ≥ 10, FPR ≤ 1, human sign-off). When/if met, append the
sign-off block here and re-run `/setup-merge-gate` with
`--soft-mode-default false`.

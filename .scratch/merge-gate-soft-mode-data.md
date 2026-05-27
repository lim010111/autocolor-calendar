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
| 1 | [#100](https://github.com/lim010111/autocolor-calendar/pull/100) | 2026-05-27 | `needs-attention`, 2 high + 2 medium (workflow trust boundary · docs-only context bypass · workflow_dispatch BASE_REF · orphan-i hard-mode blocker) | `uphold` ×4 (2 blocking) | block | should-block | No | No |

### Entry 1 — notes

The gate surfaced **four progressive self-protection finding layers** across
four codex runs on this PR. Each fix → re-run cycle peeled back to a
deeper layer, all true positives. This is the canonical "validator
hardens itself" pattern that soft-mode shipping is designed to produce.

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
and `…/25-workflow-trust-boundary.md`.

**Run 3 (commit `762b1c7` — after `#24` fail-closed fix vendored)** —
position-only pairing finding surfaces. Codex run `26513634294`:

- `aggregate.py:238` *[high]* — `cmd_write_outputs` pairs validator
  output to Codex findings by index. Reordered validator output
  silently swaps verdicts. Codex reproduced locally. Tracked as
  `claude-harness-work/.scratch/merge-gate/issues/26-validator-verdict-pairing-by-position.md`.
- `codex-review.yml:195` *[high]* — workflow trust boundary (same as
  run-2; `#25` still ADR-pending).
- `codex-review.yml:20` *[medium]* — `workflow_dispatch` BASE_REF
  (same as run-2; carried forward).
- `aggregate.py:332` *[medium]* — sticky-comment-only (resolved by
  `#24`'s land in subsequent run).

**Run 4 (commit `5f8dfd7` — after `#26` id-based pairing vendored)** —
docs-only context bypass + orphan-i blocker surface. Codex run
`26520623070`:

- ✓ `aggregate.py:238` (position-only pairing) — **gone**, confirming
  `#26` fix effective. This is the AC #18 verification evidence for
  `#26`.
- `codex-review.yml:43` *[high, upheld, blocking]* — `DOCS_ONLY_GLOBS`
  catches `AGENTS.md`, `CONTEXT-MAP.md`, `docs/adr/**`. A PR can
  weaken validator trust/context inputs without the gate reviewing
  the change. Same family as `8a13573`'s narrowing but deeper layer
  (semantic content of docs-only set, not just glob syntax). Tracked
  as `claude-harness-work/.scratch/merge-gate/issues/27-docs-only-context-bypass.md`.
- `aggregate.py:352` *[medium, upheld, non-blocking]* — orphan-i
  path's `decide_block(severity, verdict)` contradicts the in-code
  comment ("orphan lines do not block"). Validator can author its
  own blockers via a `[HIGH] uphold id=made-up …` line — scope
  contract violation. Tracked as `claude-harness-work/.scratch/merge-gate/issues/28-orphan-validator-line-can-block-hard-mode.md`.
- `codex-review.yml:195` *[high, upheld]* — workflow trust boundary
  (same as run-2/3; `#25` still ADR-pending).
- `codex-review.yml:20` *[medium]* — `workflow_dispatch` BASE_REF
  (carried forward).

### Cross-codebase signal back to harness PRD `## Deployments`

The four-run cascade on this PR is exactly the deeper-layer-finding
pattern the PRD's `## Deployments` section anticipated: each fix peels
back the gate's onion. Findings unique to autocolor's surface so far:

- Run-1 (`**/*.md` blanket docs-only) — surfaced because autocolor's
  install diff was first to touch the gate's own vendored code under
  `.claude/**`. chess_transformer's `#08` install diff didn't include
  the validator skill (vendored later in `#05`).
- Run-2 (`#24` fail-open + `#25` trust boundary) — surfaced because
  autocolor was the first PR to exercise the gate's *enforcement*
  code paths in a structured review against another PR's diff.
- Run-3 (`#26` position-pairing) — surfaced because the validator
  parsed lines from a non-trivial finding set (4 findings). chess
  PR #25 had 0 findings, so the pairing code never got real exercise.
- Run-4 (`#27` docs-only context + `#28` orphan-i blocker) —
  surfaced because the `#26` fix introduced the orphan-i path. New
  code, new attack surface.

`chess_transformer`'s next non-canary PR will inherit `#24`/`#26`/(when
they land) `#27`/`#28` via the global → vendored path. Whether the
chess surface organically exercises the new code well enough to
produce comparable findings is the open question — chess's PR #25
suggests its codex-review payload tends to run thin (0-finding
clean passes), so divergence in finding count between the two
deployments is itself worth noting for `#10`'s soft → hard analysis.

## Hard-flip decision

autocolor's branch protection / `harness.toml [merge-gate].soft_mode_default`
flip is governed by `docs/merge-gate-operations.md §2` (same criteria as
chess_transformer: N ≥ 10, FPR ≤ 1, human sign-off). When/if met, append the
sign-off block here and re-run `/setup-merge-gate` with
`--soft-mode-default false`.

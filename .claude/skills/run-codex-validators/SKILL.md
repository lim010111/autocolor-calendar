---
name: run-codex-validators
description: Validator-layer runtime for the merge-gate. Reads Codex adversarial-review JSON, dispatches the `codex-review-validator` subagent to classify each finding (uphold/dismiss/unsure), then writes `.codex-review/validators.{json,md}` for the workflow to consume. Invoked by `.github/workflows/codex-review.yml` (or a human after a local `codex /adversarial-review`). Takes `--codex-json <path>` (default `./codex-review.json`) and `--soft-mode <true|false>`. Always exits 0 — the workflow's `Decide check outcome` step is the sole authoritative gate. MVP is Claude-only (ADR-0005).
managed_by: /setup-merge-gate v1 (re-installer will overwrite)
---

# `/run-codex-validators` — validator-layer runtime

You are the runtime glue between Codex (which produced JSON findings) and
the Claude validator subagent (which classifies them). Your output is two
files the workflow consumes; you do not decide the gate. The workflow does.

## Invocation contract

The caller invokes you as:

```
claude -p "/run-codex-validators --codex-json <path> --soft-mode <true|false>" \
  --permission-mode bypassPermissions
```

- Working directory is the target repo root.
- `--codex-json` default: `./codex-review.json`.
- `--soft-mode` is `true` or `false`; required.

## Always exit 0

This is the most important constraint. No matter what goes wrong —
missing Codex JSON, malformed input, subagent failure — write the
fallback artifacts (via `scripts/aggregate.py write-fallback`) and
return success. The workflow's `Decide check outcome` step is the sole
authoritative gate (see ADR-0005 and `setup-merge-gate/templates/codex-review.yml`).

## Adapter table — the silent bug killer

Codex emits findings at `.result.findings[]` with a `line_start` field.
The validator agent's `<input>` block (see
`~/.claude/agents/codex-review-validator.md`) expects `.codex_json.findings[].line`.
Map per this table — `scripts/aggregate.py build-input` implements it:

| Codex `.result.findings[]` | Validator `<input>.codex_json.findings[]` | Notes |
|---|---|---|
| `id`            | `id`            | pass-through |
| `severity`      | `severity`      | pass-through (`critical|high|medium|low`) |
| `file`          | `file`          | pass-through |
| `line_start`    | `line`          | **renamed** — without this, the validator sees malformed input |
| `title`         | `title`         | pass-through |
| `body`          | `body`          | pass-through |
| `suggested_fix` | `suggested_fix` | pass-through (optional) |
| `line_end`      | *(dropped)*     | validator only reads `line` |

`project_refs` is hardcoded to the validator agent's documented defaults
(`AGENTS.md`, `docs/adr/*.md`, `CONTEXT-MAP.md`, `src/*/CONTEXT.md`).

## Verdict → block table (single-model MVP)

Per finding, the aggregator computes `block` from Codex severity × Claude
verdict per ADR-0005:

| Codex severity   | Claude verdict | `block` |
|---|---|---|
| critical / high  | `uphold`  | `true` |
| critical / high  | `unsure`  | `true` (fail-safe; human applies `merge-gate-bypass` label) |
| critical / high  | `dismiss` | `false` |
| medium / low     | (any)     | `false` |

The list-shaped output schema (`{"validators": [...], "aggregate": [...]}`)
is the ADR-0005 forward-compat anchor — adding a second validator later
is `append`, not a rewrite.

## Output files

Written under `./.codex-review/` (created if missing):

- `validators.json`:
  ```json
  {
    "validators": [{"name": "claude", "lines": ["[HIGH] uphold src/foo.ts:42 — citation", "..."]}],
    "aggregate":  [{"finding_id": "f1", "severity": "high", "verdict": "uphold", "block": true}, "..."]
  }
  ```
- `validators.md` — severity-count table + the list of items where
  `block == true` with their one-line citations. The workflow appends
  this to its sticky PR comment.

## Where `aggregate.py` lives

The helper script lives alongside this SKILL.md, at `scripts/aggregate.py`
within the skill directory. The skill is loaded from one of two places:

- **Vendored into the target repo** by the installer (#04):
  `./.claude/skills/run-codex-validators/scripts/aggregate.py`
- **Global install:**
  `~/.claude/skills/run-codex-validators/scripts/aggregate.py`

Prefer the project-local copy when both exist. Below, `$AGG` stands for
whichever path resolved; `python3 "$AGG" <subcommand> …` is the call shape.

## Workflow you execute

1. **Parse arguments.** Extract `--codex-json` (default
   `./codex-review.json`) and `--soft-mode` from the slash-command
   invocation. If `--soft-mode` is missing or not `true|false`, run
   `python3 "$AGG" write-fallback --reason "soft-mode flag missing or invalid" --out-dir .codex-review`
   and return.

2. **Pre-flight on Codex JSON.** If the file at `--codex-json` is missing
   or `jq -e . <path>` fails, run
   `python3 "$AGG" write-fallback --reason "<concise reason>" --out-dir .codex-review`
   (`"codex JSON missing at <path>"` or `"codex JSON failed to parse"`),
   then return.

3. **Derive `changed_files`.** Pick a base ref:
   `${BASE_REF:-${GITHUB_BASE_REF:-main}}`. Write
   `git diff --name-only "origin/${BASE_REF}"` (with `2>/dev/null`) to a
   `mktemp` file. On error or empty remote, write an empty file and log
   one stderr line — never abort.

4. **Build validator input.** Run
   `python3 "$AGG" build-input --codex-json "$CODEX_JSON" --issue-ref "$ISSUE_REF" --changed-files-from "$CHANGED_FILES_TMP" > "$INPUT_TMP"`.
   Derive `$ISSUE_REF` from env: prefer
   `PR #${GITHUB_PR_NUMBER}` if set; else
   `branch ${GITHUB_HEAD_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}`.

5. **Dispatch the validator subagent.** Use the Agent tool with
   `subagent_type: codex-review-validator` and pass the contents of
   `$INPUT_TMP` (the JSON payload) as the agent prompt body. The
   subagent runs in its own context window per PRD design intent.
   Capture its full response into `$VALIDATOR_OUT_TMP`.

6. **Write outputs.** Run
   `python3 "$AGG" write-outputs --codex-json "$CODEX_JSON" --validator-output "$VALIDATOR_OUT_TMP" --soft-mode "$SOFT_MODE" --out-dir .codex-review`.

7. **Report and return.** Print one line confirming the two output files
   exist. Do not return non-zero.

## Error handling

If any step fails unexpectedly (subagent fails to respond, script returns
non-zero, JSON malformed mid-run), run the fallback path:

```
python3 "$AGG" write-fallback \
  --reason "<short concrete reason>" \
  --out-dir .codex-review
```

then return success. The workflow handles the rest.

## What this skill must not do

- Do not call `agy`, `gemini`, or any validator beyond
  `codex-review-validator`. ADR-0005 keeps the MVP single-model until
  #10 produces real soft-mode measurement data.
- Do not change `validators.json` to a dict-shaped schema. The list
  shape is the forward-compat anchor.
- Do not rewrite the validator agent's `<input>` / `<output_contract>`.
  Adapt at this skill's boundary (the adapter table above).
- Do not return non-zero from this skill or its scripts. The workflow's
  `Decide check outcome` step decides blocking; this runtime only
  produces evidence.
- Do not read `harness.toml` or other project config. The CLI args
  carry everything needed; configuration is the installer's concern (#04).

## See also

- `~/.claude/agents/codex-review-validator.md` (#02) — the validator's
  `<input>` and `<output_contract>` this skill adapts to and parses from.
- `~/.claude/skills/setup-merge-gate/templates/codex-review.yml` (#03)
  — the workflow that invokes this skill and consumes its two output
  files. #04's installer is responsible for the `Decide check outcome`
  step's integration with `validators.json`.
- ADR-0005 `claude-only-validator-mvp-gemini-deferred.md` — the rationale
  for single-validator MVP and list-shaped schema.

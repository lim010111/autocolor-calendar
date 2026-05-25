# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`. (GitHub is used for PRs only — issues do not live on GitHub.)

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD, if any, is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status: <label>` line on line 1 of each issue file (see `triage-labels.md` for the role strings)
- The issue body uses `## What to build`, `## Acceptance criteria`, `## Blocked by`
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

The `STATUS.md` issue table is generated from these files by `~/.claude/scripts/status.py` — never hand-edit the generated section.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/issues/` (creating the directory if needed), following the conventions above. Pick the next `NN` by listing existing files.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or `<feature>/<NN>` directly.

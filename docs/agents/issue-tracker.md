# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Status harness contract

`STATUS.md` at the repo root is regenerated from these issue files by the
status harness (`scripts/status.py`, vendored into the repo; the global
`Stop` hook also runs `~/.claude/scripts/status.py` so the board stays
fresh between commits). The harness parses each issue *structurally* — so
the following elements are a contract. Renaming a heading or changing the
bullet shape silently breaks the generated table; nothing errors.

- **`## Acceptance criteria`** — a section with this exact heading. Every
  `- [ ]` / `- [x]` line under it is one criterion. The harness counts these
  for the progress bar and derives the issue's lifecycle state from them, so
  an issue with no such section shows as `0/0` / `unknown`.
- **`## Blocked by`** — a section with this exact heading. A blocker is a
  bullet that references the blocking issue by number; the harness accepts
  any of `- Issue 03 (Real Base model training)`, `- #03`, and
  `- 03-slug.md`. Prose that is not a bullet ("independent of issues 02-05")
  is ignored, so write each real blocker as its own `-` bullet. Use
  `None — can start immediately.` when there are no blockers.
- **The `<NN>` in the filename** is the issue number the table and "Blocked
  by" references resolve against — not any number written in the body.
- **The `Status:` line** is the triage label. Issues triaged `wontfix` stay
  in the table but are excluded from the progress bar.

The `to-issues` skill's issue template already emits the two headings but
leaves the blocker-bullet shape unspecified; the harness therefore accepts
any of the common forms above rather than requiring one exact spelling.

## STATUS.md editing rules

`STATUS.md` at the project root has two parts with different owners:

- **Mechanical sections** — the issue table, progress bar, and any
  banners. Generated every run by the status harness (`scripts/status.py`,
  re-run by the global `Stop` hook). Never hand-edit; your changes will
  be wiped on the next regeneration.
- **Narrative block** — the section between `<!-- narrative:start -->`
  and `<!-- narrative:end -->`. Owned by a human (or the `/status`
  skill). Holds *Current focus*, *Start here next session*, and
  *Open decisions* — the judgement the issue files cannot express.

Edit only the narrative block, or run `/status` to refresh it.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## AC checkbox discipline — flip `[x]` in the same PR

The status harness has no view into git history, PR descriptions, or
merged GitHub state. **The only signal it reads is the checkbox state on
disk.** So an AC is "complete" only when its `- [x]` is flipped in the
issue file *and that change is committed in the same PR that satisfied
it* — not after merge, not in a follow-up chore.

Required of every PR that lands implementation work:

1. As part of the PR's commits, edit `.scratch/<feature>/issues/NN-*.md`
   and flip every AC checkbox the PR satisfies from `- [ ]` to `- [x]`.
2. If the PR only partially satisfies an issue, flip only the boxes it
   satisfies and leave the rest `- [ ]`. The issue stays open.
3. If a criterion was split out into a follow-up issue, leave the box
   unchecked and append `*(deferred to #NN)*` so the table reflects the
   split rather than the original scope.
4. If the PR unblocks a downstream issue, also remove the now-resolved
   bullet from that issue's `## Blocked by` section in the same PR.
5. Update the `Status:` triage label inline too when the PR moves the
   issue along the state machine.
6. Optionally append a `> **Resolution:**` line at the end of the AC
   section pointing at the PR / commit — cheap cross-link for future
   readers.

A PR that merges without ticking its boxes leaves STATUS silently
misrepresenting the work as `todo`. There is no CI gate that catches
this, so it is **reviewer responsibility on the PR**. If you discover an
already-merged PR that skipped step 1, fix it by editing the issue file
directly on `main` (no PR needed for the checkbox flip — the work
landed, the file just needs to catch up).

This is not the `/status` skill's job — that regenerates the table *from*
your checkboxes, not the other way round.

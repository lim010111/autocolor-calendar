#!/usr/bin/env python3
"""Regenerate STATUS.md for whatever project is the current working directory.

Global status harness. Invoked by the Stop hook in every project and by the
/status skill. It is project-agnostic and opt-in:

- The project root is the current git toplevel (falling back to cwd).
- It acts ONLY when the project has issue files at `.scratch/*/issues/*.md`
  (the local-markdown issue-tracker convention). Any other repo is a silent
  no-op, so the global Stop hook is harmless everywhere.

The mechanical sections (issue table, progress bar) are fully regenerated, and
a staleness banner is added when the narrative provably contradicts the issue
state. The narrative block between the two markers is preserved verbatim — that
is the only part a human or the /status skill edits. Drift is impossible by
construction: the table is always a projection of the issue files.
"""
import re
import subprocess
from pathlib import Path

NARRATIVE_START = "<!-- narrative:start -->"
NARRATIVE_END = "<!-- narrative:end -->"

DEFAULT_NARRATIVE = """\
## Current focus

_(What is being worked on right now — one or two sentences. Edit this, or run /status.)_

## Start here next session

- _(The concrete next action. Name the issue number.)_

## Open decisions

- _(Unresolved questions worth not forgetting. Empty is fine.)_
"""

EMOJI = {
    "done": "✅ done",
    "in-progress": "🔵 in-progress",
    "blocked": "⛔ blocked",
    "todo": "⬜ todo",
    "wontfix": "🚫 wontfix",
    "?": "❔ unknown",
}


def project_root() -> Path:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        return Path(out.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd()


def parse_issue(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    m = re.match(r"\d+", path.stem)
    num = m.group(0) if m else "??"

    title = next((l[2:].strip() for l in lines if l.startswith("# ")), None)
    if title is None:
        # to-issues' issue template emits no H1; derive a readable title
        # from the "<NN>-<slug>" filename instead of showing the raw stem.
        slug = re.sub(r"^\d+[-_]", "", path.stem).replace("-", " ").replace("_", " ")
        title = slug.strip().capitalize() or path.stem

    sm = re.search(r"^Status:\s*(.+)$", text, re.M)
    triage = sm.group(1).strip() if sm else "—"

    # Count acceptance-criteria checkboxes.
    done = total = 0
    section = None
    for l in lines:
        if l.startswith("## "):
            section = l[3:].strip().lower()
            continue
        if section == "acceptance criteria":
            if re.match(r"\s*- \[[xX]\]", l):
                done += 1
                total += 1
            elif re.match(r"\s*- \[ \]", l):
                total += 1

    # Blockers — only bullet lines under "## Blocked by" count, in any of the
    # forms "- Issue 03 (...)", "- #03", or "- 03-slug.md". Prose mentions of
    # issue numbers ("independent of issues 02-05") are not bullets, so are
    # ignored — the leading "- " anchor is what keeps prose from false-firing.
    bm = re.search(r"^## Blocked by\s*\n(.*?)(?=\n## |\Z)", text, re.S | re.M)
    blockers = []
    if bm:
        blockers = sorted(set(re.findall(
            r"^\s*-\s+(?:[Ii]ssues?\s+)?#?\s*0*(\d+)\b", bm.group(1), re.M)))
        blockers = [b.zfill(2) for b in blockers]

    return {"num": num, "title": title, "triage": triage,
            "done": done, "total": total, "blockers": blockers}


def lifecycle(issue: dict, by_num: dict, _path: frozenset = frozenset()) -> str:
    # A wontfix issue is dead by triage decision, regardless of its checkboxes.
    if issue["triage"] == "wontfix":
        return "wontfix"
    if issue["total"] == 0:
        return "?"
    if issue["done"] == issue["total"]:
        return "done"
    if issue["done"] > 0:
        return "in-progress"
    if issue["num"] in _path:
        return "todo"  # blocker cycle — break it rather than recurse forever
    _path = _path | {issue["num"]}
    for b in issue["blockers"]:
        blk = by_num.get(b)
        if blk and lifecycle(blk, by_num, _path) != "done":
            return "blocked"
    return "todo"


def bar(frac: float, width: int = 22) -> str:
    filled = round(frac * width)
    return "█" * filled + "░" * (width - filled)


def read_narrative(status: Path) -> str:
    if not status.exists():
        return DEFAULT_NARRATIVE
    text = status.read_text(encoding="utf-8")
    m = re.search(re.escape(NARRATIVE_START) + r"\n(.*?)\n" + re.escape(NARRATIVE_END),
                  text, re.S)
    return m.group(1) if m else DEFAULT_NARRATIVE


def stale_warning(narrative: str, state_by_num: dict) -> str:
    """Return a one-line staleness banner for the narrative, or '' if current.

    Only two falsifiable signals fire it (see the status-harness grill, Q5);
    a mere issue-state change never does, because that is not proof the
    narrative is wrong and false positives train the reader to ignore it:

      (a) the narrative is still the unedited template;
      (b) every issue '## Start here next session' names is done, wontfix, or
          missing, so the section points at no live work.

    Prose staleness with no issue reference is left to a human or the /status
    skill by design — the narrative is the authored half of the document.
    """
    if narrative.strip() == DEFAULT_NARRATIVE.strip():
        return ("> ⚠️ **Narrative not written yet** — the block below is still "
                "the template. Run `/status` to fill it in.")

    m = re.search(r"^## Start here next session\s*\n(.*?)(?=\n## |\Z)",
                  narrative, re.S | re.M)
    if not m:
        return ""
    nums = [n.zfill(2) for n in re.findall(r"(?:issue\s+|#)\s*0*(\d+)",
                                           m.group(1), re.I)]
    if not nums:
        return ""
    if any(state_by_num.get(n) not in (None, "done", "wontfix") for n in nums):
        return ""  # at least one referenced issue is still live
    refs = ", ".join(f"#{n}" for n in sorted(set(nums)))
    return ("> ⚠️ **Narrative may be stale** — \"Start here next session\" "
            f"points to {refs}, now done or no longer present. Run `/status`.")


def feature_section(feature: str, files: list[Path]) -> tuple[str, int, int, dict]:
    """Render one feature's progress bar + issue table.

    Returns (markdown, criteria_done, criteria_total, state_by_num). Blocker
    resolution is scoped to this feature, so issue numbers never collide
    across features.
    """
    issues = [parse_issue(p) for p in sorted(files)]
    by_num = {i["num"]: i for i in issues}

    # wontfix issues stay in the table but are dead work — exclude their
    # criteria from the progress bar so they do not deflate the percentage.
    counted = [i for i in issues if i["triage"] != "wontfix"]
    done = sum(i["done"] for i in counted)
    total = sum(i["total"] for i in counted)
    frac = done / (total or 1)

    rows = []
    states = {}
    for i in issues:
        state = lifecycle(i, by_num)
        states[i["num"]] = state
        blk = ", ".join(f"#{b}" for b in i["blockers"]) or "—"
        rows.append(f"| {i['num']} | {i['title']} | `{i['triage']}` | "
                    f"{i['done']}/{i['total']} | {EMOJI[state]} | {blk} |")

    md = f"""## {feature}

`{bar(frac)}` {done}/{total} acceptance criteria met ({frac:.0%})

| # | Issue | Triage | Criteria | State | Blocked by |
|---|-------|--------|----------|-------|-----------|
{chr(10).join(rows)}"""
    return md, done, total, states


def main() -> None:
    root = project_root()
    issue_files = sorted((root / ".scratch").glob("*/issues/*.md"))
    if not issue_files:
        return  # Opt-in: no local-markdown issues here — silent no-op.

    status = root / "STATUS.md"

    # Group issues by feature directory: .scratch/<feature>/issues/*.md
    by_feature: dict[str, list[Path]] = {}
    for p in issue_files:
        by_feature.setdefault(p.parent.parent.name, []).append(p)

    sections = []
    state_by_num: dict[str, str] = {}
    total_done = total_crit = 0
    for feature in sorted(by_feature):
        md, done, total, states = feature_section(feature, by_feature[feature])
        sections.append(md)
        total_done += done
        total_crit += total
        # Cross-feature number collisions are rare and narrative refs are
        # feature-agnostic; last write wins.
        state_by_num.update(states)

    narrative = read_narrative(status)
    warning = stale_warning(narrative, state_by_num)
    banner = f"\n\n{warning}" if warning else ""

    content = f"""# Project Status

_Generated by the status harness (`~/.claude/scripts/status.py`) — do not hand-edit
outside the narrative block; mechanical sections are regenerated every run._{banner}

{NARRATIVE_START}
{narrative}
{NARRATIVE_END}

{(chr(10) + chr(10)).join(sections)}

State is derived: all criteria checked → `done`; some → `in-progress`; none
with an unfinished blocker → `blocked`; otherwise → `todo`. Issues triaged
`wontfix` show as `wontfix` and are excluded from the progress bar.
"""
    # Only write when something changed, so the Stop hook does not produce a
    # no-op diff every session. Generated content is now date-free, so an
    # unchanged project yields byte-identical output run after run.
    old = status.read_text(encoding="utf-8") if status.exists() else ""
    if content == old:
        print(f"STATUS.md unchanged — {total_done}/{total_crit} criteria.")
        return
    status.write_text(content, encoding="utf-8")
    print(f"STATUS.md regenerated — {total_done}/{total_crit} criteria, "
          f"{len(issue_files)} issues, {len(by_feature)} feature(s).")


if __name__ == "__main__":
    main()

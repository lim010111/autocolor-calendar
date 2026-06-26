#!/usr/bin/env python3
"""Mirror local-markdown issues to GitHub Issues (one-way: local is canonical).

The local `.scratch/<feature>/issues/<NN>-<slug>.md` files are the source of
truth — the status harness (`scripts/status.py`) reads them to generate
STATUS.md. This script *pushes* each file to a GitHub issue and records the
issue number back into the file as an inert `GitHub: #N` marker line. Re-running
updates existing mirrors in place. It never pulls GitHub edits back: edit the
local file and re-run.

Mapping
  Status: <value>          -> GitHub label (one of the managed status labels)
  feature directory         -> `feature:<dir>` label
  Status: done / wontfix    -> issue closed (completed / not planned)
  all acceptance criteria x -> issue closed (completed)
  file body                 -> issue body, verbatim, under a mirror banner
                               (`## Acceptance criteria` renders as a task list)

Usage
  python3 scripts/sync-issues-to-github.py --dry-run   # print the plan only
  python3 scripts/sync-issues-to-github.py             # create / update issues
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

# Managed status labels (value in the issue's `Status:` line -> label color).
STATUS_COLORS = {
    "ready-for-agent": "0e8a16",
    "ready-for-human": "1d76db",
    "needs-triage": "fbca04",
    "needs-info": "d93f0b",
    "wontfix": "e6e6e6",
    "done": "c5def5",
}
FEATURE_COLOR = "5319e7"

BANNER = (
    "> 🔁 **Mirror of a local markdown issue — do not edit here.**\n"
    "> Source of truth: `{path}`. Edits on GitHub are **not** synced back; "
    "change the local file and re-run `scripts/sync-issues-to-github.py`."
)


def run(args, *, input=None, check=True):
    return subprocess.run(
        args, input=input, capture_output=True, text=True, check=check
    )


def repo_root() -> Path:
    out = run(["git", "rev-parse", "--show-toplevel"])
    return Path(out.stdout.strip())


def derive_title(stem: str) -> str:
    slug = re.sub(r"^\d+[-_]", "", stem).replace("-", " ").replace("_", " ")
    return slug.strip().capitalize() or stem


def parse_issue(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    nm = re.match(r"\d+", path.stem)
    num = nm.group(0) if nm else "??"

    status_m = re.search(r"^Status:\s*(.+)$", text, re.M)
    status = status_m.group(1).strip() if status_m else "needs-triage"

    marker_m = re.search(r"^GitHub:\s*#(\d+)\s*$", text, re.M)
    gh_num = marker_m.group(1) if marker_m else None

    # Count acceptance-criteria checkboxes the same way status.py does.
    done = total = 0
    section = None
    for line in lines:
        if line.startswith("## "):
            section = line[3:].strip().lower()
            continue
        if section == "acceptance criteria":
            if re.match(r"\s*- \[[xX]\]", line):
                done += 1
                total += 1
            elif re.match(r"\s*- \[ \]", line):
                total += 1

    return {
        "path": path,
        "feature": path.parent.parent.name,
        "num": num,
        "title": derive_title(path.stem),
        "status": status,
        "gh_num": gh_num,
        "all_done": total > 0 and done == total,
        "text": text,
    }


def desired_state(issue: dict) -> tuple[bool, str | None]:
    """Return (closed, close_reason)."""
    if issue["status"] == "wontfix":
        return True, "not planned"
    if issue["status"] == "done" or issue["all_done"]:
        return True, "completed"
    return False, None


def build_body(issue: dict, rel: str) -> str:
    body = re.sub(r"^GitHub:\s*#\d+\s*\n?", "", issue["text"], flags=re.M)
    return BANNER.format(path=rel) + "\n\n---\n\n" + body


def insert_marker(text: str, num: str) -> str:
    return re.sub(
        r"^Status:.*$", lambda m: m.group(0) + f"\nGitHub: #{num}",
        text, count=1, flags=re.M,
    )


def ensure_labels(features: set[str], dry: bool) -> None:
    wanted = [(name, color) for name, color in STATUS_COLORS.items()]
    wanted += [(f"feature:{f}", FEATURE_COLOR) for f in sorted(features)]
    for name, color in wanted:
        if dry:
            print(f"  label: ensure {name} (#{color})")
            continue
        run(["gh", "label", "create", name, "--color", color, "--force"], check=False)


def current_labels(num: str) -> set[str]:
    out = run(["gh", "issue", "view", num, "--json", "labels",
               "-q", ".labels[].name"], check=False)
    return {l for l in out.stdout.splitlines() if l}


def current_state(num: str) -> str:
    out = run(["gh", "issue", "view", num, "--json", "state",
               "-q", ".state"], check=False)
    return out.stdout.strip().upper()


def reconcile_state(num: str, closed: bool, reason: str | None, dry: bool) -> None:
    state = "?" if dry else current_state(num)
    if closed and state != "CLOSED":
        args = ["gh", "issue", "close", num]
        if reason:
            args += ["--reason", reason]
        print(f"    close (#{num}, {reason})")
        if not dry:
            run(args, check=False)
    elif not closed and state == "CLOSED":
        print(f"    reopen (#{num})")
        if not dry:
            run(["gh", "issue", "reopen", num], check=False)


def sync_issue(issue: dict, root: Path, dry: bool) -> None:
    rel = str(issue["path"].relative_to(root))
    title = f"{issue['feature']}/{issue['num']}: {issue['title']}"
    body = build_body(issue, rel)
    feature_label = f"feature:{issue['feature']}"
    desired = {feature_label, issue["status"]}
    managed = set(STATUS_COLORS) | {feature_label}
    closed, reason = desired_state(issue)

    if issue["gh_num"]:
        num = issue["gh_num"]
        print(f"  UPDATE #{num}  ←  {rel}")
        if not dry:
            run(["gh", "issue", "edit", num, "--title", title,
                 "--body-file", "-"], input=body)
            have = current_labels(num)
            for lbl in sorted(desired - have):
                run(["gh", "issue", "edit", num, "--add-label", lbl], check=False)
            for lbl in sorted((have & managed) - desired):
                run(["gh", "issue", "edit", num, "--remove-label", lbl], check=False)
        reconcile_state(num, closed, reason, dry)
        return

    print(f"  CREATE       ←  {rel}   ({', '.join(sorted(desired))})")
    if dry:
        if closed:
            print(f"    then close ({reason})")
        return
    out = run(["gh", "issue", "create", "--title", title, "--body-file", "-",
               "--label", feature_label, "--label", issue["status"]], input=body)
    num = out.stdout.strip().rstrip("/").rsplit("/", 1)[-1]
    issue["path"].write_text(insert_marker(issue["text"], num), encoding="utf-8")
    print(f"    created #{num}, wrote `GitHub: #{num}` back to {rel}")
    reconcile_state(num, closed, reason, dry)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="print the plan without creating or editing anything")
    args = ap.parse_args()

    root = repo_root()
    files = sorted((root / ".scratch").glob("*/issues/*.md"))
    if not files:
        print("No local issue files under .scratch/*/issues/ — nothing to mirror.")
        return

    issues = [parse_issue(p) for p in files]
    features = {i["feature"] for i in issues}

    mode = "DRY RUN — no changes" if args.dry_run else "SYNCING"
    print(f"{mode}: {len(issues)} issue(s), {len(features)} feature(s)\n")
    print("Labels:")
    ensure_labels(features, args.dry_run)
    print("\nIssues:")
    for issue in issues:
        sync_issue(issue, root, args.dry_run)
    print("\nDone." if not args.dry_run else "\nDry run complete.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.stderr.write(f"command failed: {' '.join(e.cmd)}\n{e.stderr}\n")
        sys.exit(1)

#!/usr/bin/env python3
"""Validate that path references inside CLAUDE.md / AGENTS.md / README.md actually exist.

Mirrors the `RE_PATH_REF` heuristic used by the AI-readiness scorer
(`~/.claude/skills/ai-readiness-cartography/scripts/score.py`) so that broken
references are caught at PR time rather than during ad-hoc audits.

Exit codes:
  0 — every captured reference resolves (repo-relative or context-file-relative)
  1 — at least one reference is broken (printed to stderr)

Usage:
  python3 scripts/check-context-paths.py            # walks the repo from cwd
  python3 scripts/check-context-paths.py <repo>     # walks a specific root

Why a separate file (not a one-liner inlined in CI): operators occasionally
edit context files locally and want a fast `python3 scripts/check-context-paths.py`
loop without spinning up the full audit skill. Staying stdlib-only keeps the
script trivially portable across any Python 3.10+ environment.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

IGNORE_DIRS = {
    "node_modules", "dist", "build", ".git", ".venv", "venv",
    "__pycache__", ".next", ".cache", "coverage", ".turbo", "target",
}
CONTEXT_FILES = ("CLAUDE.md", "AGENTS.md", "README.md")

# Captures `prefix/path.ext` references. Two intentional divergences from the
# global scorer's regex:
#   1. Longer extensions come before shorter ones (`json` before `js`,
#      `tsx` before `ts`, …) so e.g. `gas/appsscript.json` is not truncated
#      to `gas/appsscript.js` by leftmost-alternative matching.
#   2. The path-prefix alternation accepts `../` before `./` so a markdown
#      link like `[..](../foo.md)` from a nested CLAUDE.md captures the
#      whole `../foo.md` (the older `\./` would match positions 1-2 and
#      report `./foo.md`, which always resolves wrong).
# Order in the prefix alternation matters: `\.\./` must be tried before
# `\./`, otherwise leftmost-success drops the leading dot.
RE_PATH_REF = re.compile(
    r"(?<![A-Za-z0-9_/])"
    r"((?:\.\./|\./|[A-Za-z0-9_]+/)[A-Za-z0-9_./-]+\."
    r"(?:tsx|jsx|json|yaml|yml|toml|html|java|py|ts|js|md|sql|css|sh|go|rs|kt|rb|php))"
)


def find_context_files(repo: Path) -> list[Path]:
    out: list[Path] = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]
        for f in files:
            if f in CONTEXT_FILES:
                out.append(Path(root) / f)
    return out


def main(argv: list[str]) -> int:
    repo = Path(argv[1]).resolve() if len(argv) > 1 else Path.cwd().resolve()
    if not repo.is_dir():
        print(f"error: {repo} is not a directory", file=sys.stderr)
        return 2

    broken: list[tuple[Path, str]] = []
    total = 0
    for ctx in find_context_files(repo):
        text = ctx.read_text(errors="ignore")
        for ref in set(RE_PATH_REF.findall(text)):
            total += 1
            candidates = [repo / ref, ctx.parent / ref]
            if not any(c.exists() for c in candidates):
                broken.append((ctx, ref))

    if broken:
        print(f"context path check: {len(broken)} broken reference(s) out of {total}", file=sys.stderr)
        for ctx, ref in broken:
            try:
                rel = ctx.relative_to(repo)
            except ValueError:
                rel = ctx
            print(f"  {rel}: {ref}", file=sys.stderr)
        return 1

    print(f"context path check: OK ({total} references verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

"""Loader for prompts stored under ``<repo>/prompts/dataset-builder/``.

Mirrors the TypeScript-side loader (``src/services/prompts/classifierPrompts.ts``),
except the Python side reads the ``.md`` directly from disk — there is no
Cloudflare-Workers-style "no fs" constraint to work around.
"""

from __future__ import annotations

from .config import REPO_ROOT

_PROMPT_DIR = REPO_ROOT / "prompts" / "dataset-builder"


def _strip_frontmatter(raw: str) -> str:
    if not raw.startswith("---\n"):
        return raw
    end = raw.find("\n---\n", 4)
    if end == -1:
        return raw
    return raw[end + 5 :]


def load_prompt(name: str, version: str = "v1") -> str:
    """Return the system-prompt body for ``name``/``version``.

    Frontmatter (YAML block at the top of the file) is stripped so the model
    never sees the metadata. Trailing whitespace is normalised, matching the
    TypeScript ``embed-prompts.ts`` behavior, so prompt parity holds across
    languages.
    """
    path = _PROMPT_DIR / f"{name}.system.{version}.md"
    raw = path.read_text(encoding="utf-8")
    return _strip_frontmatter(raw).rstrip() + "\n"

"""Ledger: local `runs.jsonl` (canonical SoT) + the wandb send-gate (PII firewall).

Two surfaces, two rules (AC #9, merge-gate finding-1):

- ``runs.jsonl`` (local, git-ignored)  — full aggregate run record. No raw titles
  or seeds ever appear in it (the record is aggregate-only by construction), but it
  may carry the raw prompt_prefix (a public model string) and exact thresholds.
- **wandb** (third-party SaaS)          — config · scalar metrics · thresholds ·
  **synthetic cat_N confusion only**. NO category names, seeds, titles, keywords,
  or raw prompt_prefix. Enforced by a deny-by-default allowlist *projection* +
  assertion before anything leaves the machine.

The gate is the bedrock of the PII contract: it builds the cloud payload by
projecting onto an allowlist (not by stripping forbidden keys), then asserts no
forbidden key/shape survived. A raw string can only reach wandb through a bug that
also trips ``assert_wandb_safe`` → the call raises instead of leaking.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from . import config

# Keys permitted to leave the machine for wandb. Deliberately excludes the raw
# `prompt_prefix` (only its sha256_16 goes) and anything name/seed/title-shaped.
WANDB_ALLOWED_KEYS = frozenset(
    {
        "run_id",
        "git_sha",
        "kind",
        "tool",
        "model",
        "dim",
        "prompt_arm",
        "prompt_prefix_sha256_16",
        "keyword_form_arm",
        "include_examples",
        "gold_set_version",
        "manifest_sha256",
        "n_categories",
        "n_held_out_none",
        "n_seeds",
        "n_queries",
        "split",
        "seed",
        "determinism",
        "embedding_backend",
        "model_revision",
        "k",
        "agg",
        "metric",
        "thresholds",
        "metrics",
        "wai_parity",
        "selected",
    }
)

# Any dict key matching this (at any depth) is a leak vector → reject.
_FORBIDDEN_KEY = re.compile(r"(title|seed_text|seed|keyword|name|label|text|prefix)(?!_sha256_16)", re.I)
# Confusion / per-category keys must be synthetic IDs, never category names.
_SYNTHETIC_ID = re.compile(r"^(cat_\d+|none)$")


class PiiGateError(RuntimeError):
    """Raised when a payload bound for wandb would leak raw or name-level data."""


def _assert_no_forbidden_keys(obj, path: str = "") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _FORBIDDEN_KEY.search(str(k)):
                raise PiiGateError(f"forbidden key '{path}{k}' would leak PII to wandb")
            _assert_no_forbidden_keys(v, path=f"{path}{k}.")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _assert_no_forbidden_keys(v, path=f"{path}{i}.")


def to_wandb_payload(record: dict) -> dict:
    """Project a run record onto the wandb allowlist and assert it is PII-safe."""
    payload = {k: record[k] for k in WANDB_ALLOWED_KEYS if k in record}
    assert_wandb_safe(payload)
    return payload


def assert_wandb_safe(payload: dict) -> None:
    """Raise PiiGateError unless ``payload`` is safe for the cloud.

    1. every top-level key ∈ allowlist (so vetted names like `seed`,
       `keyword_form_arm` are accepted by name, not by pattern)
    2. no *nested* key matches the forbidden pattern (title/seed/keyword/name/text/…) —
       catches a stray raw-text key smuggled inside metrics/thresholds/etc.
    3. per_category / any confusion dict is keyed by synthetic IDs only
    """
    extra = set(payload) - WANDB_ALLOWED_KEYS
    if extra:
        raise PiiGateError(f"non-allowlisted keys for wandb: {sorted(extra)}")
    for k, v in payload.items():  # top-level keys are allowlist-vetted; scan nested only
        _assert_no_forbidden_keys(v, path=f"{k}.")
    per_cat = payload.get("metrics", {}).get("per_category", {})
    for key in per_cat:
        if not _SYNTHETIC_ID.match(str(key)):
            raise PiiGateError(f"per_category key '{key}' is not a synthetic ID (cat_N/none)")


# --- run record assembly --------------------------------------------------


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=config.REPO_ROOT, text=True
        ).strip()
    except Exception:  # noqa: BLE001 — best-effort provenance, never fatal
        return "unknown"


def make_run_record(
    *,
    run_id: str,
    model: str,
    dim: int,
    prompt_arm: str,
    prompt_prefix: str,
    prompt_prefix_sha256_16: str,
    keyword_form_arm: str,
    include_examples: bool,
    gold_set_version: str,
    manifest_sha256: str,
    n_categories: int,
    n_held_out_none: int,
    n_seeds: int,
    n_queries: int,
    split: str,
    embedding_backend: str,
    model_revision: str,
    thresholds,
    metrics: dict,
    wai_parity: dict | None,
    selected: bool = False,
) -> dict:
    """Assemble one run record exactly per design §5-견고화 항목2.

    `include_examples` is added beyond the design list so the config fully
    determines the run (AC #10 reproducibility) — cold-start arms set it False.
    """
    return {
        "run_id": run_id,
        "git_sha": git_sha(),
        "kind": "embedding_knn_sweep",
        "tool": config.TOOL_NAME,
        "model": model,
        "dim": dim,
        "prompt_arm": prompt_arm,
        "prompt_prefix": prompt_prefix,  # local-only (stripped before wandb)
        "prompt_prefix_sha256_16": prompt_prefix_sha256_16,
        "keyword_form_arm": keyword_form_arm,
        "include_examples": include_examples,
        "gold_set_version": gold_set_version,
        "manifest_sha256": manifest_sha256,
        "n_categories": n_categories,
        "n_held_out_none": n_held_out_none,
        "n_seeds": n_seeds,
        "n_queries": n_queries,
        "split": split,
        "seed": config.SEED,
        "determinism": config.DETERMINISM,
        "embedding_backend": embedding_backend,
        "model_revision": model_revision,
        "k": config.KNN_K,
        "agg": config.KNN_AGG,
        "metric": config.KNN_METRIC,
        "thresholds": {
            "T_verified": thresholds.t_verified,
            "T_declared": thresholds.t_declared,
            "margin": thresholds.margin,
        },
        "metrics": metrics,
        "wai_parity": wai_parity or {"checked": False, "mean_cosine": None, "provisional": True},
        "selected": selected,
    }


def append_runs(records: list[dict], path: Path | None = None) -> Path:
    """Append records to the local canonical ledger (one JSON object per line)."""
    path = path or config.RUNS_JSONL
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return path


def log_to_wandb(records: list[dict], *, project: str, run_name: str) -> bool:
    """Send aggregates-only payloads to wandb. Soft dep (ADR-0001 Langfuse pattern).

    Returns False (no-op) if WANDB_API_KEY is unset or the SDK is missing. Every
    payload passes ``to_wandb_payload`` (allowlist projection + assert) first, so a
    leak is impossible without raising.
    """
    if not config.load_secret("WANDB_API_KEY"):
        return False
    try:
        import wandb
    except ModuleNotFoundError:
        return False
    safe = [to_wandb_payload(r) for r in records]  # raises before any network call
    run = wandb.init(project=project, name=run_name, reinit=True)
    try:
        for payload in safe:
            wandb.log({**payload["metrics"], **{k: v for k, v in payload.items() if k != "metrics"}})
    finally:
        run.finish()
    return True

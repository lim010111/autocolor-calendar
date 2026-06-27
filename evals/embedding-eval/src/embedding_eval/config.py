"""Pinned constants + paths for the embedding-eval harness.

Everything here is data-blind: candidate models, prompt-arm prefix strings (public
model conventions, *not* PII), the threshold grid, and filesystem paths. The gold
set, name↔ID map, ledger, and forensics all live under ``_local/`` (git-ignored) —
this module only points at them.
"""

from __future__ import annotations

import os
from pathlib import Path

# --- Paths ----------------------------------------------------------------
# This package lives at evals/embedding-eval/src/embedding_eval; the eval root
# (evals/embedding-eval) is two parents up, the repo root four.
PKG_ROOT = Path(__file__).resolve().parent
EVAL_ROOT = PKG_ROOT.parents[1]
REPO_ROOT = EVAL_ROOT.parents[1]

LOCAL_DIR = EVAL_ROOT / "_local"  # git-ignored — raw PII never leaves here
GOLD_DIR = LOCAL_DIR / "gold"  # operator drops <version>.json here
RUNS_JSONL = LOCAL_DIR / "runs.jsonl"  # aggregate ledger = canonical SoT
NAME_ID_MAP = LOCAL_DIR / "name-id-map.json"  # category-name ↔ cat_N (local-only)
FORENSICS_DIR = LOCAL_DIR / "forensics"  # per-case predictions (PII) — local-only

MANIFEST_PATH = EVAL_ROOT / "manifest.json"  # committed: counts + single digest, 0 titles
PARITY_PROBES_PATH = EVAL_ROOT / "parity_probes.txt"  # committed: non-PII probe strings
REPORT_TEMPLATE = EVAL_ROOT / "REPORT.md.tmpl"

DOTENV_PATH = REPO_ROOT / ".dev.vars"  # WANDB_* / CF_* live here, never injected into the Worker

# --- Candidate models -----------------------------------------------------
# The three Workers AI multilingual general-purpose embedding models (2026-06
# catalogue). prod inference is Workers AI; the 3080 runs the same HF weights
# locally for measurement only (ADR-0004). `dim` is fixed per the issue spec
# (MRL truncation is out of scope unless the operator opts in).
CANDIDATES: dict[str, dict] = {
    "@cf/baai/bge-m3": {"hf_repo": "BAAI/bge-m3", "dim": 1024, "instruction_free": True},
    "@cf/qwen/qwen3-embedding-0.6b": {
        "hf_repo": "Qwen/Qwen3-Embedding-0.6B",
        "dim": 1024,
        "instruction_free": False,
    },
    "@cf/google/embeddinggemma-300m": {
        "hf_repo": "google/embeddinggemma-300m",
        "dim": 768,
        "instruction_free": False,
    },
}

# Excluded (recorded for the report / catalogue-drift re-eval — AC "후보군 ... 제외"):
#   bge-*-en-v1.5 (English-only), @cf/pfnet/plamo-embedding-1b (Japanese-only),
#   reranker/cross-encoder family (violates ADR-0004 bi-encoder dense contract).
EXCLUDED_MODELS: dict[str, str] = {
    "@cf/baai/bge-base-en-v1.5": "english-only",
    "@cf/baai/bge-large-en-v1.5": "english-only",
    "@cf/baai/bge-small-en-v1.5": "english-only",
    "@cf/pfnet/plamo-embedding-1b": "japanese-only",
    "@cf/baai/bge-reranker-base": "cross-encoder — no kNN index (ADR-0004)",
}

# --- Prompt / prefix arms (AC "프롬프트/프리픽스 arm") ---------------------
# Symmetric / STS prefixes only — our use case is title↔seed symmetric, so the
# asymmetric retrieval (query/doc) prompts are deliberately excluded. The prefix
# is prepended uniformly to EVERY embedded string (seeds AND titles). The harness
# records whatever is configured here verbatim + sha256_16 — it never paraphrases
# (AC #6); the winner's exact string is frozen as a prod invariant (AC #7).
#
# Strings pinned 2026-06-27 from the HF model cards (sources below). OPERATOR:
# re-verify on catalogue drift — an inexact prefix silently biases the arm.
PROMPT_ARMS: dict[str, dict[str, str]] = {
    # bge-m3 is instruction-free → only arm (a); (b) would be identical.
    "@cf/baai/bge-m3": {"none": ""},
    "@cf/google/embeddinggemma-300m": {
        "none": "",
        # CONFIRMED verbatim from model card: "task: sentence similarity | query: {content}"
        # https://huggingface.co/google/embeddinggemma-300m
        "sts": "task: sentence similarity | query: ",
    },
    "@cf/qwen/qwen3-embedding-0.6b": {
        "none": "",
        # Format CONFIRMED verbatim: get_detailed_instruct → f"Instruct: {task}\nQuery:{query}"
        #   (note: NO space after "Query:"). https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
        # Qwen ships NO official STS instruction (only retrieval examples) — the task
        # description below is the common MTEB-style STS instruction, applied
        # symmetrically to seeds AND titles. OPERATOR: swap if you prefer another STS task.
        "sts": "Instruct: Retrieve semantically similar text\nQuery:",
    },
}

# --- Keyword-form arms (AC "Declared-seed-form arm") ----------------------
# Cold-start comparison (Declared only, no examples): does keyword buy value over
# name, and in which form? Gold-set schema carries declared_seeds.{word,phrase};
# the arm selects which list joins [name] in the seed pool.
KEYWORD_FORM_ARMS: tuple[str, ...] = ("name_only", "name_word", "name_phrase")

# --- Threshold sweep grid -------------------------------------------------
# Coarse default; the operator narrows around the feasible region from a first
# pass. T_verified < T_declared is enforced when the grid is expanded (metrics).
DEFAULT_T_VERIFIED_GRID: tuple[float, ...] = (0.40, 0.45, 0.50, 0.55, 0.60, 0.65)
DEFAULT_T_DECLARED_GRID: tuple[float, ...] = (0.55, 0.60, 0.65, 0.70, 0.75, 0.80)
DEFAULT_MARGIN_GRID: tuple[float, ...] = (0.0, 0.02, 0.05, 0.08)

# --- Selection objective (AC "임계값 선정 목표함수 = 정밀도 우선") ---------
# PLACEHOLDERS — the real floor/ceiling get pinned from the sweep (AC: "바닥선·
# 상한의 실제 수치는 sweep 결과로 박는다"). Winner = max coverage s.t. these hold.
DEFAULT_VERIFIED_PRECISION_FLOOR = 0.95
DEFAULT_NONE_FALSE_APPLY_CEILING = 0.05

# --- Fixed kNN hyperparameters (ADR-0004) ---------------------------------
KNN_K = "all-seeds"  # k = entire seed pool of the Rule
KNN_AGG = "max"  # score = max cosine over the Rule's seeds
KNN_METRIC = "cosine"
DETERMINISM = {"dtype": "fp32", "normalize": "l2"}
SEED = 42

# --- WAI parity -----------------------------------------------------------
# Below this mean cosine, the local↔Workers-AI transfer is suspect → thresholds
# stay provisional (AC "3080 ↔ Workers AI 전이 타당성").
WAI_PARITY_PROVISIONAL_BELOW = 0.98

TOOL_NAME = "embedding-model-eval"


def gold_path(version: str) -> Path:
    return GOLD_DIR / f"{version}.json"


def load_secret(name: str) -> str | None:
    """Read a secret from process env, falling back to .dev.vars (dotenv).

    Mirrors the ADR-0001 LANGFUSE_* pattern: WANDB_* / CF_* live in .dev.vars
    only and are never injected into the Worker or CI.
    """
    if name in os.environ:
        return os.environ[name]
    try:
        from dotenv import dotenv_values
    except ModuleNotFoundError:
        return None
    if not DOTENV_PATH.exists():
        return None
    return dotenv_values(DOTENV_PATH).get(name)

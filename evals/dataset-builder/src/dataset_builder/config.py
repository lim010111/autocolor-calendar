"""Shared constants for the dataset-builder pipeline.

Pinning these (HF revision via env, model snapshots, RNG seed) is what makes the
build reproducible end-to-end.
"""

from __future__ import annotations

import os
from pathlib import Path

# --- Paths ----------------------------------------------------------------
# This package lives at evals/dataset-builder/src/dataset_builder; the eval
# tree root is three parents up.
PKG_ROOT = Path(__file__).resolve().parent
EVALS_ROOT = PKG_ROOT.parents[2]
REPO_ROOT = EVALS_ROOT.parent

DATASETS_DIR = EVALS_ROOT / "datasets"
META_DIR = DATASETS_DIR / "_meta"
DATA_DIR = EVALS_ROOT / "dataset-builder" / "data"

SOURCE_TITLES_PATH = META_DIR / "source-titles.jsonl"
SOURCE_META_PATH = META_DIR / "source.json"
EMBEDDINGS_PATH = DATA_DIR / "embeddings.npz"
CLUSTERS_DRAFT_PATH = META_DIR / "clusters-draft.json"
CLUSTERS_PATH = META_DIR / "clusters.json"
EN_DATASET_PATH = DATASETS_DIR / "en" / "classification.json"

DOTENV_PATH = REPO_ROOT / ".dev.vars"

# --- Source dataset -------------------------------------------------------
HF_DATASET = "anakin87/events-scheduling"
HF_REVISION = os.environ.get("HF_DATASET_REVISION", "main")
HF_LICENSE = "Apache-2.0"

# --- Models ---------------------------------------------------------------
EMBEDDING_MODEL = "text-embedding-3-small"
LABEL_MODEL = "gpt-5.5"
TRANSLATE_MODEL = "gpt-5.5"
LABEL_REASONING_EFFORT = "low"

# --- Clustering -----------------------------------------------------------
KMEANS_K_CANDIDATES: tuple[int, ...] = (7, 8, 9, 10)
KMEANS_SEED = 42
MEDOID_SAMPLES_PER_CLUSTER = 30

# --- Dataset shape --------------------------------------------------------
TARGET_TRAIN_SAMPLES = 300  # cluster-stratified
NEGATIVE_RATIO = 0.05  # silhouette bottom 5% → expected="none"
EVALUATOR_THRESHOLD = 0.70

# --- Languages ------------------------------------------------------------
TARGET_LANGUAGES: tuple[str, ...] = ("ko", "zh-CN", "zh-TW")
ALL_LANGUAGES: tuple[str, ...] = ("en",) + TARGET_LANGUAGES

# --- Batch API ------------------------------------------------------------
BATCH_POLL_INTERVAL_SECONDS = 15
BATCH_MAX_WAIT_SECONDS = 60 * 60 * 24  # 24h SLA
BATCH_TERMINAL_STATUSES = frozenset({"completed", "failed", "expired", "cancelled"})


def dataset_path(lang: str) -> Path:
    return DATASETS_DIR / lang / "classification.json"

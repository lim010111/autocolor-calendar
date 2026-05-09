"""Stage 5 — emit ``evals/datasets/en/classification.json``.

Combines the labelled clusters (:mod:`label_clusters`) with the paraphrased
cases (:mod:`augment`) into a runner-compatible suite. Schema mirrors the
existing ``evals/tasks/classification-semantic.json`` (``schema_version: 1``)
plus root-level ``lang``/``source``/``generator``/``evaluator`` metadata that
the extended TS runner reads.

Note on negatives: the ``expected="none"`` field is supported by the schema,
but the 50-base HF source is too small to safely synthesise hard negatives
(every case sits inside one of our 10 clusters). We instead tag the lowest
5% of silhouette cases ``boundary`` so they can be inspected separately
without polluting the ground truth.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, datetime

from .augment import AUGMENTED_PATH
from .config import (
    CLUSTERS_PATH,
    EMBEDDING_MODEL,
    EN_DATASET_PATH,
    EVALUATOR_THRESHOLD,
    KMEANS_SEED,
    LABEL_MODEL,
    NEGATIVE_RATIO,
    SOURCE_META_PATH,
)


def _short_id(prefix: str, *parts: str) -> str:
    h = hashlib.sha1("\x00".join(parts).encode("utf-8")).hexdigest()[:8]
    return f"{prefix}-{h}"


def run(*, force: bool = False) -> None:
    if EN_DATASET_PATH.exists() and not force:
        print(f"[build-en] skip — {EN_DATASET_PATH.relative_to(EN_DATASET_PATH.parents[3])} exists")
        return
    for path in (CLUSTERS_PATH, AUGMENTED_PATH, SOURCE_META_PATH):
        if not path.exists():
            raise RuntimeError(f"missing {path}")

    clusters_doc = json.loads(CLUSTERS_PATH.read_text(encoding="utf-8"))
    source_doc = json.loads(SOURCE_META_PATH.read_text(encoding="utf-8"))
    augmented = [
        json.loads(line)
        for line in AUGMENTED_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    categories = [
        {"name": c["name"], "keywords": c["keywords"], "colorId": c["colorId"]}
        for c in clusters_doc["categories"]
    ]
    cluster_name_by_id = {c["cluster_id"]: c["name"] for c in clusters_doc["categories"]}

    silhouettes = [r["silhouette"] for r in augmented if r["silhouette"] is not None]
    silhouettes.sort()
    cutoff_index = max(0, math.floor(len(silhouettes) * NEGATIVE_RATIO) - 1)
    boundary_threshold = silhouettes[cutoff_index] if silhouettes else float("-inf")

    cases: list[dict] = []
    for rec in augmented:
        cluster_id = rec["cluster_id"]
        category_name = cluster_name_by_id[cluster_id]
        sil = rec["silhouette"]
        boundary = sil is not None and sil <= boundary_threshold

        # Base case
        base_tags = ["base", cluster_id]
        if boundary:
            base_tags.append("boundary")
        cases.append(
            {
                "id": _short_id("base", cluster_id, rec["base_title"]),
                "tag": ",".join(base_tags),
                "categories": categories,
                "event": {"summary": rec["base_title"]},
                "expected": {"category_name": category_name},
            }
        )

        # Variants
        for v_idx, variant in enumerate(rec["variants"]):
            variant_tags = ["paraphrase", cluster_id]
            if boundary:
                variant_tags.append("boundary")
            cases.append(
                {
                    "id": _short_id("var", cluster_id, rec["base_title"], str(v_idx)),
                    "tag": ",".join(variant_tags),
                    "categories": categories,
                    "event": {"summary": variant},
                    "expected": {"category_name": category_name},
                }
            )

    payload = {
        "schema_version": 1,
        "task": "classification-multilingual",
        "lang": "en",
        "description": (
            "Multilingual classification eval — English dataset built from "
            f"{source_doc['dataset']}@{source_doc['revision']} "
            f"({source_doc['unique_title_count']} unique titles, "
            f"paraphrased ~3× via {LABEL_MODEL}). Same case ids appear in "
            "the ko / zh-CN / zh-TW siblings for cross-lingual comparison."
        ),
        "source": {
            "dataset": source_doc["dataset"],
            "revision": source_doc["revision"],
            "license": source_doc["license"],
            "attribution": source_doc["attribution"],
        },
        "generator": {
            "embedding_model": EMBEDDING_MODEL,
            "label_model": LABEL_MODEL,
            "k": clusters_doc["k"],
            "selected_silhouette": clusters_doc["selected_silhouette"],
            "seed": KMEANS_SEED,
            "negative_ratio": NEGATIVE_RATIO,
            "boundary_threshold": round(boundary_threshold, 4)
            if boundary_threshold != float("-inf")
            else None,
            "built_at": datetime.now(UTC).isoformat(),
        },
        "evaluator": {"threshold": EVALUATOR_THRESHOLD, "blocking_tags": []},
        "cases": cases,
    }

    EN_DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    EN_DATASET_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    boundary_count = sum(1 for c in cases if "boundary" in c["tag"])
    print(
        f"[build-en] wrote {len(cases)} cases ({len(categories)} categories, "
        f"{boundary_count} boundary-tagged) → {EN_DATASET_PATH.name}"
    )

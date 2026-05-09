"""Stage 3 — KMeans + silhouette sweep over the dedup'd title embeddings.

Picks the ``k`` in :data:`config.KMEANS_K_CANDIDATES` with the highest
silhouette score, then assigns each title to its cluster and computes a
per-title silhouette so :mod:`build_en_dataset` can flag the most
boundary-ambiguous titles as ``expected="none"`` negatives.
"""

from __future__ import annotations

import json

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_samples, silhouette_score

from .config import (
    CLUSTERS_DRAFT_PATH,
    EMBEDDINGS_PATH,
    KMEANS_K_CANDIDATES,
    KMEANS_SEED,
    MEDOID_SAMPLES_PER_CLUSTER,
)


def _load() -> tuple[np.ndarray, list[str]]:
    if not EMBEDDINGS_PATH.exists():
        raise RuntimeError(f"missing {EMBEDDINGS_PATH} — run `build-dataset embed` first")
    archive = np.load(EMBEDDINGS_PATH, allow_pickle=True)
    return archive["embeddings"].astype(np.float32), [str(t) for t in archive["titles"]]


def _sweep(emb: np.ndarray) -> tuple[int, dict[int, float], KMeans]:
    scores: dict[int, float] = {}
    best_k = -1
    best_score = -2.0
    best_model: KMeans | None = None
    for k in KMEANS_K_CANDIDATES:
        if k >= len(emb):
            # silhouette needs k < n_samples
            continue
        model = KMeans(n_clusters=k, random_state=KMEANS_SEED, n_init=10)
        labels = model.fit_predict(emb)
        score = float(silhouette_score(emb, labels))
        scores[k] = round(score, 4)
        if score > best_score:
            best_score = score
            best_k = k
            best_model = model
    if best_model is None:
        raise RuntimeError("no valid k found — embedding count too small")
    return best_k, scores, best_model


def run(*, force: bool = False) -> None:
    if CLUSTERS_DRAFT_PATH.exists() and not force:
        print(f"[cluster] skip — {CLUSTERS_DRAFT_PATH.name} exists")
        return

    emb, titles = _load()
    k, sweep_scores, model = _sweep(emb)
    labels = model.predict(emb)
    sample_silhouettes = silhouette_samples(emb, labels)

    centers = model.cluster_centers_
    clusters_payload = []
    for cluster_id in range(k):
        member_idxs = np.where(labels == cluster_id)[0]
        # Distance from each member to its centroid; lowest = most central.
        dists = np.linalg.norm(emb[member_idxs] - centers[cluster_id], axis=1)
        order = np.argsort(dists)
        medoid_idxs = member_idxs[order[:MEDOID_SAMPLES_PER_CLUSTER]]
        members = [
            {
                "title": titles[i],
                "silhouette": round(float(sample_silhouettes[i]), 4),
                "centroid_distance": round(float(np.linalg.norm(emb[i] - centers[cluster_id])), 4),
            }
            for i in member_idxs
        ]
        members.sort(key=lambda m: m["centroid_distance"])
        clusters_payload.append(
            {
                "cluster_id": f"c{cluster_id}",
                "size": int(len(member_idxs)),
                "medoid_titles": [titles[i] for i in medoid_idxs],
                "members": members,
            }
        )

    payload = {
        "k": k,
        "k_sweep_silhouette": sweep_scores,
        "selected_silhouette": sweep_scores[k],
        "seed": KMEANS_SEED,
        "clusters": clusters_payload,
    }

    CLUSTERS_DRAFT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CLUSTERS_DRAFT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    sizes = [c["size"] for c in clusters_payload]
    print(f"[cluster] k={k} silhouette={sweep_scores[k]} sweep={sweep_scores}")
    print(f"[cluster] cluster sizes: {sizes} → {CLUSTERS_DRAFT_PATH.name}")

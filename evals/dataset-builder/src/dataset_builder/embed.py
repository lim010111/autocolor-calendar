"""Stage 2 — embed dedup'd titles via OpenAI ``/v1/embeddings`` (sync).

The HF source yields only ~50 unique titles after dedup, so a Batch round-trip
would dominate over the actual embedding work. We use the sync endpoint here
and reserve Batch for the multi-hundred translation calls in stage 6.
"""

from __future__ import annotations

import json

import numpy as np

from .config import EMBEDDING_MODEL, EMBEDDINGS_PATH, SOURCE_TITLES_PATH
from .openai_client import get_client


def _load_titles() -> list[dict]:
    if not SOURCE_TITLES_PATH.exists():
        raise RuntimeError(f"missing {SOURCE_TITLES_PATH} — run `build-dataset fetch` first")
    return [json.loads(line) for line in SOURCE_TITLES_PATH.read_text(encoding="utf-8").splitlines() if line]


def run(*, force: bool = False) -> None:
    if EMBEDDINGS_PATH.exists() and not force:
        cached = np.load(EMBEDDINGS_PATH, allow_pickle=False)
        print(f"[embed] skip — cached {cached['embeddings'].shape} at {EMBEDDINGS_PATH.name}")
        return

    EMBEDDINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    titles = _load_titles()
    inputs = [t["title"] for t in titles]
    print(f"[embed] requesting {len(inputs)} embeddings from {EMBEDDING_MODEL}")

    resp = get_client().embeddings.create(model=EMBEDDING_MODEL, input=inputs)
    if len(resp.data) != len(inputs):
        raise RuntimeError(f"embedding count mismatch: got {len(resp.data)}, expected {len(inputs)}")

    embeddings = np.array([d.embedding for d in resp.data], dtype=np.float32)
    np.savez(
        EMBEDDINGS_PATH,
        embeddings=embeddings,
        titles=np.array(inputs, dtype=object),
        model=np.array(EMBEDDING_MODEL),
    )
    print(f"[embed] saved {embeddings.shape} → {EMBEDDINGS_PATH.relative_to(EMBEDDINGS_PATH.parents[3])}")

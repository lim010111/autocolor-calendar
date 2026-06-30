"""Embedding backends — the seam between the data-blind harness and real models.

Three implementations, all returning ``(n, dim)`` float32 **L2-normalized** arrays
with the prompt prefix prepended uniformly:

- ``LocalBackend``     — sentence-transformers on the 3080 (lazy-imports torch).
- ``WorkersAiBackend`` — Cloudflare Workers AI REST (for wai_parity; lazy requests).
- ``FakeBackend``      — dependency-free, deterministic; for tests + smoke runs.

Cosine reduces to a dot product because every vector is L2-normalized here, so the
rest of the harness never re-normalizes.
"""

from __future__ import annotations

import hashlib
from typing import Protocol

import numpy as np

from .config import CANDIDATES


def _l2_normalize(mat: np.ndarray) -> np.ndarray:
    mat = mat.astype(np.float32, copy=False)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return mat / norms


class EmbeddingBackend(Protocol):
    name: str  # "local-3080" | "workers-ai" | "fake"
    model_revision: str

    def embed(self, texts: list[str], *, prefix: str) -> np.ndarray: ...


class LocalBackend:
    """sentence-transformers on the local 3080. Operator-run (needs GPU + weights)."""

    name = "local-3080"

    def __init__(self, model_id: str, *, device: str | None = None):
        if model_id not in CANDIDATES:
            raise ValueError(f"unknown model {model_id}")
        self.model_id = model_id
        self.hf_repo = CANDIDATES[model_id]["hf_repo"]
        self.dim = CANDIDATES[model_id]["dim"]
        self._device = device
        self._model = None
        self.model_revision = "unknown"

    def _ensure(self):
        if self._model is not None:
            return
        import torch  # lazy — keeps the harness importable without a GPU stack
        from sentence_transformers import SentenceTransformer

        torch.manual_seed(0)
        # Best-effort determinism; GPU kernels are not bit-identical run-to-run,
        # so model_revision is pinned in the ledger as the real reproducibility anchor.
        torch.use_deterministic_algorithms(True, warn_only=True)
        self._model = SentenceTransformer(self.hf_repo, device=self._device)
        rev = getattr(getattr(self._model, "_model_config", None), "_commit_hash", None)
        self.model_revision = rev or self.hf_repo

    def embed(self, texts: list[str], *, prefix: str) -> np.ndarray:
        self._ensure()
        inputs = [prefix + t for t in texts]
        vecs = self._model.encode(
            inputs, convert_to_numpy=True, normalize_embeddings=False, show_progress_bar=False
        )
        out = _l2_normalize(np.asarray(vecs))
        if out.shape[1] != self.dim:
            raise RuntimeError(f"{self.model_id}: expected dim {self.dim}, got {out.shape[1]}")
        return out


class WorkersAiBackend:
    """Cloudflare Workers AI REST. Used by wai_parity on non-PII probes only."""

    name = "workers-ai"

    def __init__(self, model_id: str, *, account_id: str, api_token: str):
        if model_id not in CANDIDATES:
            raise ValueError(f"unknown model {model_id}")
        self.model_id = model_id
        self.dim = CANDIDATES[model_id]["dim"]
        self._account_id = account_id
        self._api_token = api_token
        self.model_revision = "workers-ai"

    def embed(self, texts: list[str], *, prefix: str) -> np.ndarray:
        import requests  # lazy

        url = f"https://api.cloudflare.com/client/v4/accounts/{self._account_id}/ai/run/{self.model_id}"
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {self._api_token}"},
            json={"text": [prefix + t for t in texts]},
            timeout=60,
        )
        resp.raise_for_status()
        body = resp.json()
        data = body.get("result", {}).get("data")
        if not isinstance(data, list) or len(data) != len(texts):
            raise RuntimeError(f"workers-ai returned {data and len(data)} vectors for {len(texts)} texts")
        return _l2_normalize(np.asarray(data, dtype=np.float32))


class FakeBackend:
    """Deterministic, dependency-free embeddings for tests + smoke runs.

    Hashes character 3-grams into a fixed-dim bag-of-features so that identical or
    overlapping strings land close in cosine space — enough structure to exercise
    the decision logic without any model weights or PII.
    """

    name = "fake"

    def __init__(self, dim: int = 64):
        self.dim = dim
        self.model_revision = "fake-v1"

    def _vec(self, text: str, prefix: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        s = prefix + text
        toks = [s[i : i + 3] for i in range(max(1, len(s) - 2))]
        for tok in toks:
            h = int.from_bytes(hashlib.sha1(tok.encode("utf-8")).digest()[:4], "big")
            v[h % self.dim] += 1.0
        return v

    def embed(self, texts: list[str], *, prefix: str) -> np.ndarray:
        return _l2_normalize(np.stack([self._vec(t, prefix) for t in texts]))

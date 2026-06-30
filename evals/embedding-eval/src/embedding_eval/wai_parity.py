"""3080 ↔ Workers AI transfer-validity probe (AC "3080 ↔ Workers AI 전이 타당성").

The eval's output (model + thresholds) is consumed by prod, which embeds on
Workers AI — but the local 3080 embeddings are not guaranteed bit-identical
(quantization / runtime / pooling can differ). This embeds a set of **non-PII**
probe strings on both backends and records the mean paired cosine. Below
``WAI_PARITY_PROVISIONAL_BELOW`` the thresholds stay flagged provisional; the
winner's final thresholds are re-measured directly on Workers AI (inside the PII
boundary) to confirm.

Probes are committed (``parity_probes.txt``) — generic strings, no calendar data.
"""

from __future__ import annotations

import numpy as np

from . import config
from .backends import EmbeddingBackend


def load_probes() -> list[str]:
    if not config.PARITY_PROBES_PATH.exists():
        raise FileNotFoundError(f"missing probe set: {config.PARITY_PROBES_PATH}")
    out = []
    for line in config.PARITY_PROBES_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    if not out:
        raise ValueError("parity_probes.txt has no probe lines")
    return out


def run_parity(
    model: str,
    *,
    local: EmbeddingBackend,
    workers_ai: EmbeddingBackend,
    prefix: str = "",
) -> dict:
    probes = load_probes()
    a = local.embed(probes, prefix=prefix)
    b = workers_ai.embed(probes, prefix=prefix)
    if a.shape != b.shape:
        raise RuntimeError(f"shape mismatch local {a.shape} vs workers-ai {b.shape}")
    cos = (a * b).sum(axis=1)  # both L2-normalized → paired cosine
    mean_cosine = float(np.mean(cos))
    return {
        "kind": "wai_parity",
        "model": model,
        "n_probes": len(probes),
        "checked": True,
        "mean_cosine": round(mean_cosine, 4),
        "min_cosine": round(float(np.min(cos)), 4),
        "provisional": mean_cosine < config.WAI_PARITY_PROVISIONAL_BELOW,
    }

"""arch-judgment cosine grid — Stage-1 scores for every (title, category) pair.

Embeds all ko-v1 gold titles plus every category seed (ko name, en name,
declared word/phrase keywords) with the production embedding model and the
frozen prod prefix, then writes per-pair max-cosines split by seed group:

  name_ko  — cosine(title, ko category name)          -> "min" state, ko conditions
  name_en  — cosine(title, en category name)          -> "min" state, en conditions
  kw_max   — max cosine over word+phrase seeds        -> "full" adds this to name_ko

Any Stage-1 threshold policy (current bars, hard-none band, evidence gate…)
is then a pure arithmetic sweep over this grid — zero model calls afterwards.

Backend: Workers AI REST — the literal production model+endpoint (higher fidelity
than a local mirror; prod already ships every event title through this exact API,
so real-title transmission stays within the existing processor relationship).
Requires CF_ACCOUNT_ID / CF_API_TOKEN in .dev.vars.

Run with the embedding-eval venv (has numpy + requests + embedding_eval):
  evals/embedding-eval/.venv/bin/python evals/arch-judgment/build_cosine_grid.py

Output is local-only (real titles): _local/arch-judgment/cosine-grid.json
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals" / "embedding-eval" / "src"))

from embedding_eval.backends import WorkersAiBackend  # noqa: E402

LOCAL = ROOT / "evals" / "embedding-eval" / "_local"
GOLD = LOCAL / "gold" / "ko-v1.json"
EN_NAMES = LOCAL / "arch-judgment" / "en-names.json"
OUT = LOCAL / "arch-judgment" / "cosine-grid.json"

MODEL_ID = "@cf/google/embeddinggemma-300m"
# Frozen prod prefix — src/config/embedding.ts, sha256_16 793518b01601c92e.
PREFIX = "task: sentence similarity | query: "


def l2(mat: np.ndarray) -> np.ndarray:
    return mat / np.clip(np.linalg.norm(mat, axis=1, keepdims=True), 1e-12, None)


def read_dev_var(name: str) -> str:
    text = (ROOT / ".dev.vars").read_text()
    for line in text.splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"{name} not found in .dev.vars")


def embed_chunked(backend: WorkersAiBackend, texts: list[str], prefix: str, chunk: int = 64) -> np.ndarray:
    parts = []
    for i in range(0, len(texts), chunk):
        parts.append(backend.embed(texts[i : i + chunk], prefix=prefix))
        print(f"  embedded {min(i + chunk, len(texts))}/{len(texts)}")
    return np.vstack(parts)


def main() -> None:
    gold = json.loads(GOLD.read_text())
    en_names: dict[str, str] = json.loads(EN_NAMES.read_text())
    titles = [q["title"] for q in gold["queries"]]

    # Seed inventory: (category, group) -> list of texts.
    seeds: list[tuple[str, str, str]] = []  # (cat_name, group, text)
    for cat in gold["categories"]:
        name = cat["name"]
        seeds.append((name, "name_ko", name))
        seeds.append((name, "name_en", en_names[name]))
        for grp in ("word", "phrase"):
            for kw in cat.get("declared_seeds", {}).get(grp, []):
                seeds.append((name, "kw", kw))

    backend = WorkersAiBackend(
        MODEL_ID,
        account_id=read_dev_var("CF_ACCOUNT_ID"),
        api_token=read_dev_var("CF_API_TOKEN"),
    )
    texts = titles + [s[2] for s in seeds]
    print(f"embedding {len(texts)} texts ({len(titles)} titles, {len(seeds)} seeds)…")
    vecs = l2(np.asarray(embed_chunked(backend, texts, PREFIX), dtype=np.float32))
    tvecs, svecs = vecs[: len(titles)], vecs[len(titles) :]

    sims = tvecs @ svecs.T  # (titles, seeds)

    cat_names = [c["name"] for c in gold["categories"]]
    grid: dict[str, dict] = {}
    for i, title in enumerate(titles):
        tkey = hashlib.sha256(title.encode()).hexdigest()[:8]
        per_cat = {}
        for cname in cat_names:
            entry = {"name_ko": -1.0, "name_en": -1.0, "kw_max": -1.0}
            for j, (sc, grp, _text) in enumerate(seeds):
                if sc != cname:
                    continue
                v = float(sims[i, j])
                if grp == "kw":
                    entry["kw_max"] = max(entry["kw_max"], v)
                else:
                    entry[grp] = max(entry[grp], v)
            per_cat[cname] = {k: round(v, 6) for k, v in entry.items()}
        grid[tkey] = {"title": title, "expected": gold["queries"][i]["expected"], "cats": per_cat}

    out = {
        "model": MODEL_ID,
        "model_revision": backend.model_revision,
        "prefix": PREFIX,
        "gold_version": gold["version"],
        "built_at": datetime.now(timezone.utc).isoformat(),
        "categories": cat_names,
        "en_names": en_names,
        "titles": grid,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False) + "\n")
    print(f"grid written: {OUT} ({len(grid)} titles × {len(cat_names)} categories)")


if __name__ == "__main__":
    main()

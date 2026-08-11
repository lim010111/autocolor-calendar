"""arch-judgment wave-3b — description-seed cosines for every (title, category).

Embeds the ko-v1 gold titles plus the 11 rule descriptions (ko + en) with the
production model/prefix and writes per-pair cosines:

  desc_ko — cosine(title, ko rule description)
  desc_en — cosine(title, en rule description)

Merged with cosine-grid.json by the scorer to synthesize "description as an
embedding seed" Stage-1 variants — pure arithmetic, zero LLM calls.

Run with the embedding-eval venv:
  evals/embedding-eval/.venv/bin/python evals/arch-judgment/build_desc_cosines.py

Output is local-only (real titles): _local/arch-judgment/desc-cosines.json
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

from build_cosine_grid import (  # noqa: E402
    MODEL_ID,
    PREFIX,
    embed_chunked,
    l2,
    read_dev_var,
)

LOCAL = ROOT / "evals" / "embedding-eval" / "_local"
GOLD = LOCAL / "gold" / "ko-v1.json"
DESC_KO = LOCAL / "arch-judgment" / "rule-descriptions.json"
DESC_EN = LOCAL / "arch-judgment" / "rule-descriptions.en.json"
OUT = LOCAL / "arch-judgment" / "desc-cosines.json"


def main() -> None:
    gold = json.loads(GOLD.read_text())
    desc_ko: dict[str, str] = json.loads(DESC_KO.read_text())
    desc_en: dict[str, str] = json.loads(DESC_EN.read_text())
    titles = [q["title"] for q in gold["queries"]]
    cat_names = sorted(desc_ko)  # active categories only (held-out has no desc)

    seeds: list[tuple[str, str, str]] = []  # (cat, group, text)
    for c in cat_names:
        seeds.append((c, "desc_ko", desc_ko[c]))
        seeds.append((c, "desc_en", desc_en[c]))

    backend = WorkersAiBackend(
        MODEL_ID,
        account_id=read_dev_var("CF_ACCOUNT_ID"),
        api_token=read_dev_var("CF_API_TOKEN"),
    )
    texts = titles + [s[2] for s in seeds]
    print(f"embedding {len(texts)} texts ({len(titles)} titles, {len(seeds)} descriptions)…")
    vecs = l2(np.asarray(embed_chunked(backend, texts, PREFIX), dtype=np.float32))
    tvecs, svecs = vecs[: len(titles)], vecs[len(titles) :]
    sims = tvecs @ svecs.T

    grid: dict[str, dict] = {}
    for i, title in enumerate(titles):
        tkey = hashlib.sha256(title.encode()).hexdigest()[:8]
        per_cat: dict[str, dict] = {c: {} for c in cat_names}
        for j, (c, grp, _t) in enumerate(seeds):
            per_cat[c][grp] = round(float(sims[i, j]), 6)
        grid[tkey] = per_cat

    OUT.write_text(
        json.dumps(
            {
                "model": MODEL_ID,
                "model_revision": backend.model_revision,
                "prefix": PREFIX,
                "gold_version": gold["version"],
                "built_at": datetime.now(timezone.utc).isoformat(),
                "titles": grid,
            },
            ensure_ascii=False,
        )
        + "\n"
    )
    print(f"desc cosines written: {OUT} ({len(grid)} titles × {len(cat_names)} categories)")


if __name__ == "__main__":
    main()

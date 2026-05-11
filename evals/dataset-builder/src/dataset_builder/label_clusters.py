"""Stage 4 — gpt-5.5 produces a category name + keyword list for each cluster.

Sync calls (one per cluster, k≤10) — Batch overhead would dwarf the actual
work at this scale. Output schema mirrors the runtime ``Category`` shape so
:mod:`build_en_dataset` can drop it straight into the eval suite without
remapping.
"""

from __future__ import annotations

import json

from .config import (
    CLUSTERS_DRAFT_PATH,
    CLUSTERS_PATH,
    LABEL_MODEL,
    LABEL_REASONING_EFFORT,
)
from .openai_client import get_client
from .prompts import load_prompt

# Google Calendar color IDs are 1..11; cluster index + 1 keeps us in range
# without a stable lookup table — the IDs themselves don't matter for the
# classifier, but the schema requires a string in {"1".."11"}.
_COLOR_IDS = [str(i + 1) for i in range(11)]

# Source of truth: prompts/dataset-builder/label-clusters.system.v1.md
_SYSTEM_PROMPT = load_prompt("label-clusters")

_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "keywords"],
    "properties": {
        "name": {"type": "string"},
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}


def _label_one(client, cluster_titles: list[str]) -> tuple[str, list[str]]:
    user = "Cluster members:\n" + "\n".join(f"- {t}" for t in cluster_titles)
    resp = client.chat.completions.create(
        model=LABEL_MODEL,
        reasoning_effort=LABEL_REASONING_EFFORT,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "cluster_label", "strict": True, "schema": _RESPONSE_SCHEMA},
        },
    )
    payload = json.loads(resp.choices[0].message.content)
    name = payload["name"].strip()
    seen: set[str] = set()
    keywords: list[str] = []
    for k in payload["keywords"]:
        k = k.strip().lower()
        if not k or k in seen:
            continue
        seen.add(k)
        keywords.append(k)
    if len(keywords) < 6:
        raise RuntimeError(f"cluster '{name}' returned only {len(keywords)} keywords; expected ≥6")
    return name, keywords[:10]


def run(*, force: bool = False) -> None:
    if CLUSTERS_PATH.exists() and not force:
        print(f"[label] skip — {CLUSTERS_PATH.name} exists")
        return
    if not CLUSTERS_DRAFT_PATH.exists():
        raise RuntimeError(f"missing {CLUSTERS_DRAFT_PATH} — run `build-dataset cluster` first")

    draft = json.loads(CLUSTERS_DRAFT_PATH.read_text(encoding="utf-8"))
    client = get_client()

    used_names: set[str] = set()
    labelled = []
    for idx, c in enumerate(draft["clusters"]):
        titles = c["medoid_titles"]
        print(f"[label] {c['cluster_id']} (size={c['size']}) → gpt-5.5")
        name, keywords = _label_one(client, titles)
        # Deduplicate names across clusters — the runner uses category name as
        # the ground-truth key, so two clusters sharing a name would collide.
        original = name
        suffix = 2
        while name.lower() in used_names:
            name = f"{original} {suffix}"
            suffix += 1
        used_names.add(name.lower())

        labelled.append(
            {
                "cluster_id": c["cluster_id"],
                "name": name,
                "keywords": keywords,
                "colorId": _COLOR_IDS[idx % len(_COLOR_IDS)],
                "size": c["size"],
                "members": [m["title"] for m in c["members"]],
                "silhouette_per_member": {
                    m["title"]: m["silhouette"] for m in c["members"]
                },
            }
        )

    payload = {
        "k": draft["k"],
        "model": LABEL_MODEL,
        "reasoning_effort": LABEL_REASONING_EFFORT,
        "k_sweep_silhouette": draft["k_sweep_silhouette"],
        "selected_silhouette": draft["selected_silhouette"],
        "seed": draft["seed"],
        "categories": labelled,
    }
    CLUSTERS_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[label] wrote {len(labelled)} categories → {CLUSTERS_PATH.name}")
    for c in labelled:
        print(f"  {c['cluster_id']}: {c['name']:<20} keywords={c['keywords']}")

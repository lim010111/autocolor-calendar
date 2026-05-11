"""Stage 4.5 — paraphrase each base title 2–3 ways via gpt-5.5.

Why: the HF source dedups to only 50 unique titles (it's a synthetic
scheduling-puzzle dataset built from a small base vocabulary). Without this
stage we'd ship a 50-case eval — too small for meaningful per-category
accuracy. We expand to ~150–200 cases by asking gpt-5.5 for natural rewrites
that *preserve the activity/intent*, then label each variant with the same
cluster as its base so the ground truth stays grounded.
"""

from __future__ import annotations

import json

from .config import CLUSTERS_PATH, LABEL_REASONING_EFFORT, META_DIR, TRANSLATE_MODEL
from .openai_client import get_client
from .prompts import load_prompt

AUGMENTED_PATH = META_DIR / "augmented-cases.jsonl"

_VARIANTS_PER_BASE = 3

# Source of truth: prompts/dataset-builder/augment.system.v1.md
# ({n} is substituted via .replace at call-site, because the body intentionally
# contains no other braces — switching to .format would be equivalent today but
# fragile against future edits.)
_SYSTEM_PROMPT = load_prompt("augment")

_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["variants"],
    "properties": {
        "variants": {"type": "array", "items": {"type": "string"}},
    },
}


def _augment_one(client, base_title: str, category_name: str, n: int) -> list[str]:
    user = (
        f"Title: {base_title}\n"
        f"Category: {category_name}\n"
        f"Return exactly {n} natural rewrites."
    )
    resp = client.chat.completions.create(
        model=TRANSLATE_MODEL,
        reasoning_effort=LABEL_REASONING_EFFORT,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT.replace("{n}", str(n))},
            {"role": "user", "content": user},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "paraphrases", "strict": True, "schema": _RESPONSE_SCHEMA},
        },
    )
    payload = json.loads(resp.choices[0].message.content)
    seen = {base_title.casefold()}
    variants: list[str] = []
    for v in payload["variants"]:
        v = (v or "").strip()
        key = v.casefold()
        if not v or key in seen:
            continue
        seen.add(key)
        variants.append(v)
    return variants[:n]


def run(*, force: bool = False) -> None:
    if AUGMENTED_PATH.exists() and not force:
        n = sum(1 for _ in AUGMENTED_PATH.read_text(encoding="utf-8").splitlines() if _.strip())
        print(f"[augment] skip — {AUGMENTED_PATH.name} already has {n} records")
        return
    if not CLUSTERS_PATH.exists():
        raise RuntimeError(f"missing {CLUSTERS_PATH} — run `build-dataset label` first")

    clusters = json.loads(CLUSTERS_PATH.read_text(encoding="utf-8"))["categories"]
    client = get_client()
    AUGMENTED_PATH.parent.mkdir(parents=True, exist_ok=True)

    records = []
    total_variants = 0
    for cat in clusters:
        for base_title in cat["members"]:
            print(f"[augment] {cat['cluster_id']} ← {base_title}")
            variants = _augment_one(client, base_title, cat["name"], _VARIANTS_PER_BASE)
            records.append(
                {
                    "base_title": base_title,
                    "cluster_id": cat["cluster_id"],
                    "category_name": cat["name"],
                    "silhouette": cat["silhouette_per_member"].get(base_title),
                    "variants": variants,
                }
            )
            total_variants += len(variants)

    with AUGMENTED_PATH.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(
        f"[augment] {len(records)} bases × ~{_VARIANTS_PER_BASE} variants → "
        f"{total_variants} variants ({len(records) + total_variants} total cases) → {AUGMENTED_PATH.name}"
    )

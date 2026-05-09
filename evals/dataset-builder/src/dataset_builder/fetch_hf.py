"""Stage 1 — pull the HF dataset and emit deduplicated event titles.

Outputs
-------
- ``evals/datasets/_meta/source-titles.jsonl`` — one JSON per line with
  ``{title, split, source_index, event_index}``. The split + position keys
  let downstream stages reference back to the original row, and the natural
  test-split slice is preserved so we can use it intact for held-out cases.
- ``evals/datasets/_meta/source.json`` — provenance record (HF revision pin,
  license, counts). Pinning the revision is what makes the build
  reproducible — without it, the upstream dataset can drift silently.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from datasets import load_dataset
from huggingface_hub import HfApi

from .config import (
    HF_DATASET,
    HF_LICENSE,
    HF_REVISION,
    SOURCE_META_PATH,
    SOURCE_TITLES_PATH,
)


def _resolve_revision(requested: str) -> str:
    """Pin a concrete commit sha for ``requested`` (which may be ``main``)."""
    info = HfApi().dataset_info(HF_DATASET, revision=requested)
    return info.sha or requested


def _iter_titles(splits: dict):
    """Yield ``(split, source_index, event_index, title)`` for every event."""
    for split_name, split in splits.items():
        for row_idx, row in enumerate(split):
            events = row.get("events") or []
            for ev_idx, ev in enumerate(events):
                # Each event is [name, start, end].
                if not ev:
                    continue
                title = ev[0] if isinstance(ev, (list, tuple)) else ev
                if not isinstance(title, str):
                    continue
                title = title.strip()
                if not title:
                    continue
                yield split_name, row_idx, ev_idx, title


def run(*, force: bool = False) -> None:
    if SOURCE_TITLES_PATH.exists() and SOURCE_META_PATH.exists() and not force:
        print(f"[fetch] skip — {SOURCE_TITLES_PATH.relative_to(SOURCE_TITLES_PATH.parents[3])} exists")
        return

    SOURCE_TITLES_PATH.parent.mkdir(parents=True, exist_ok=True)

    revision = _resolve_revision(HF_REVISION)
    print(f"[fetch] {HF_DATASET}@{revision}")

    splits = load_dataset(HF_DATASET, revision=revision)

    seen: dict[str, dict] = {}
    raw_total = 0
    for split_name, source_idx, event_idx, title in _iter_titles(splits):
        raw_total += 1
        key = title.casefold()
        # First-write-wins so the dedup is stable across re-runs.
        if key not in seen:
            seen[key] = {
                "title": title,
                "split": split_name,
                "source_index": source_idx,
                "event_index": event_idx,
            }

    titles = list(seen.values())
    titles.sort(key=lambda r: (r["split"], r["source_index"], r["event_index"]))

    with SOURCE_TITLES_PATH.open("w", encoding="utf-8") as f:
        for rec in titles:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    by_split = {}
    for rec in titles:
        by_split[rec["split"]] = by_split.get(rec["split"], 0) + 1

    SOURCE_META_PATH.write_text(
        json.dumps(
            {
                "dataset": HF_DATASET,
                "revision": revision,
                "license": HF_LICENSE,
                "fetched_at": datetime.now(UTC).isoformat(),
                "raw_event_count": raw_total,
                "unique_title_count": len(titles),
                "unique_by_split": by_split,
                "attribution": (
                    f"Source: HuggingFace dataset {HF_DATASET} (license: {HF_LICENSE}). "
                    "Used for evaluation only; not redistributed."
                ),
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"[fetch] wrote {len(titles)} unique titles (raw={raw_total}) → {SOURCE_TITLES_PATH.name}")
    print(f"[fetch] split breakdown: {by_split}")

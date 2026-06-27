"""Sweep orchestration: per-model config grid → embed once → threshold sweep.

Embedding is the expensive step, thresholding is cheap — so for each
(model, prompt_arm, keyword_form_arm, include_examples) we embed seeds + queries
**once**, precompute the per-query grade-split cosine maxima, then sweep the whole
threshold grid over those cached sims. One run record is emitted per
(config × threshold) cell.

The grid is *per-model* valid, not a naive product: bge-m3 is instruction-free so
it contributes only the "none" prompt arm (AC #6).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass

from . import config, ledger
from .backends import EmbeddingBackend
from .dataset import GoldSet, build_seed_pool, synthetic_id_map
from .metrics import (
    STAGE2,
    Outcome,
    Thresholds,
    compute_metrics,
    decide,
    sims_by_category,
)


def sha256_16(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class SweepConfig:
    model: str
    prompt_arm: str
    keyword_form_arm: str
    include_examples: bool

    @property
    def prefix(self) -> str:
        return config.PROMPT_ARMS[self.model][self.prompt_arm]

    def signature(self) -> str:
        return sha256_16(
            json.dumps(
                [self.model, self.prompt_arm, self.keyword_form_arm, self.include_examples],
                ensure_ascii=False,
            )
        )


def enumerate_configs(
    models: list[str],
    *,
    keyword_form_arms: tuple[str, ...],
    include_examples_values: tuple[bool, ...],
) -> list[SweepConfig]:
    out: list[SweepConfig] = []
    for model in models:
        if model not in config.PROMPT_ARMS:
            raise ValueError(f"unknown model {model}")
        for prompt_arm in config.PROMPT_ARMS[model]:  # per-model valid arms
            for kf in keyword_form_arms:
                for incl in include_examples_values:
                    out.append(SweepConfig(model, prompt_arm, kf, incl))
    return out


def run_sweep(
    gold: GoldSet,
    configs: list[SweepConfig],
    thresholds: list[Thresholds],
    *,
    backend_factory: Callable[[str], EmbeddingBackend],
    manifest_sha256: str,
    split: str = "temporal",
    wai_parity: dict | None = None,
) -> list[dict]:
    id_map = synthetic_id_map(gold)
    queries = gold.queries
    n_held_out_none = len(gold.held_out_categories)

    backends: dict[str, EmbeddingBackend] = {}
    query_cache: dict[tuple[str, str], object] = {}
    records: list[dict] = []

    for cfg in configs:
        backend = backends.setdefault(cfg.model, backend_factory(cfg.model))
        qkey = (cfg.model, cfg.prompt_arm)
        if qkey not in query_cache:
            query_cache[qkey] = backend.embed([q.title for q in queries], prefix=cfg.prefix)
        qvecs = query_cache[qkey]

        seeds = build_seed_pool(
            gold, keyword_form_arm=cfg.keyword_form_arm, include_examples=cfg.include_examples
        )
        if not seeds:
            continue
        svecs = backend.embed([s.text for s in seeds], prefix=cfg.prefix)
        sims_per_query = [sims_by_category(qvecs[i], seeds, svecs) for i in range(len(queries))]

        for th in thresholds:
            outcomes = [
                Outcome(
                    expected=queries[i].expected,
                    decision=(decide(sims_per_query[i], th)[0] or STAGE2),
                )
                for i in range(len(queries))
            ]
            metrics = compute_metrics(outcomes, id_map)
            run_id = f"{gold.version}-{cfg.signature()}-{sha256_16(repr(th))[:8]}"
            records.append(
                ledger.make_run_record(
                    run_id=run_id,
                    model=cfg.model,
                    dim=config.CANDIDATES[cfg.model]["dim"],
                    prompt_arm=cfg.prompt_arm,
                    prompt_prefix=cfg.prefix,
                    prompt_prefix_sha256_16=sha256_16(cfg.prefix),
                    keyword_form_arm=cfg.keyword_form_arm,
                    include_examples=cfg.include_examples,
                    gold_set_version=gold.version,
                    manifest_sha256=manifest_sha256,
                    n_categories=len(gold.rule_categories),
                    n_held_out_none=n_held_out_none,
                    n_seeds=len(seeds),
                    n_queries=len(queries),
                    split=split,
                    embedding_backend=backend.name,
                    model_revision=getattr(backend, "model_revision", "unknown"),
                    thresholds=th,
                    metrics=metrics,
                    wai_parity=wai_parity,
                )
            )
    return records


def write_forensics(run_id: str, queries, outcomes: list[Outcome], id_map: dict[str, str]) -> None:
    """Per-case predictions for one run → local scratchpad only (raw titles, PII).

    Never committed, never sent to wandb. Use sparingly (e.g. the winning config).
    """
    config.FORENSICS_DIR.mkdir(parents=True, exist_ok=True)
    path = config.FORENSICS_DIR / f"{run_id}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for q, o in zip(queries, outcomes, strict=True):
            fh.write(
                json.dumps(
                    {
                        "title": q.title,  # PII — local-only
                        "expected": q.expected,
                        "decision": o.decision,
                        "correct": (o.decision == o.expected) if o.decision != STAGE2 else None,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

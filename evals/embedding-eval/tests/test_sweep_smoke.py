"""End-to-end harness mechanics on a synthetic non-PII fixture (FakeBackend).

Exercises dataset loading, the per-model config grid, embed→sims→threshold sweep,
the run-record schema, reproducibility, and that every record passes the wandb gate.
No GPU, no models, no real data.
"""

from __future__ import annotations

from pathlib import Path

from embedding_eval.backends import CANDIDATES, FakeBackend
from embedding_eval.dataset import load_gold_set
from embedding_eval.ledger import to_wandb_payload
from embedding_eval.manifest import build_manifest, corpus_digest
from embedding_eval.metrics import threshold_grid
from embedding_eval.sweep import enumerate_configs, run_sweep

FIXTURE = Path(__file__).parent / "fixtures" / "gold_synth.json"

REQUIRED_KEYS = {
    "run_id", "git_sha", "kind", "tool", "model", "dim", "prompt_arm",
    "prompt_prefix", "prompt_prefix_sha256_16", "keyword_form_arm", "include_examples",
    "gold_set_version", "manifest_sha256", "n_categories", "n_held_out_none",
    "n_seeds", "n_queries", "split", "seed", "determinism", "embedding_backend",
    "model_revision", "k", "agg", "metric", "thresholds", "metrics", "wai_parity", "selected",
}


def _fake_factory(model):
    return FakeBackend(dim=CANDIDATES[model]["dim"])


def _run():
    gold = load_gold_set(FIXTURE)
    configs = enumerate_configs(
        ["@cf/baai/bge-m3"],  # instruction-free → single prompt arm, fast
        keyword_form_arms=("name_only", "name_word", "name_phrase"),
        include_examples_values=(True, False),
    )
    grid = threshold_grid((0.3, 0.5), (0.6, 0.8), (0.0,))
    return gold, run_sweep(
        gold, configs, grid, backend_factory=_fake_factory, manifest_sha256=corpus_digest(gold)
    )


def test_sweep_produces_well_formed_records():
    _, records = _run()
    # 3 keyword-form arms × 2 include_examples × 4 thresholds (tv<td)
    assert len(records) == 3 * 2 * 4
    for r in records:
        assert set(r) == REQUIRED_KEYS
        assert r["kind"] == "embedding_knn_sweep"
        assert r["dim"] == 1024
        assert r["thresholds"]["T_verified"] < r["thresholds"]["T_declared"]


def test_sweep_is_deterministic():
    _, a = _run()
    _, b = _run()
    assert a == b  # same (config, gold) → identical records


def test_every_record_passes_wandb_gate():
    _, records = _run()
    for r in records:
        payload = to_wandb_payload(r)  # raises if any leak slips through
        assert "prompt_prefix" not in payload
        for key in payload["metrics"]["per_category"]:
            assert key.startswith("cat_")


def test_cold_start_arm_excludes_examples():
    gold, records = _run()
    cold = [r for r in records if not r["include_examples"]]
    warm = [r for r in records if r["include_examples"]]
    assert cold and warm
    # name_only cold-start has the fewest seeds (just the Rule names).
    name_only_cold = min(r["n_seeds"] for r in cold if r["keyword_form_arm"] == "name_only")
    assert name_only_cold == len(gold.rule_categories)


def test_manifest_has_no_raw_titles():
    import json

    gold = load_gold_set(FIXTURE)
    manifest = build_manifest(gold)
    digest = manifest["manifest_sha256"]
    # Check the counts/labels portion; the opaque hash is excluded since a short
    # toy title could coincidentally be a hex substring (the hash is one-way anyway).
    body = dict(manifest)
    body.pop("manifest_sha256")
    blob = json.dumps(body, ensure_ascii=False)
    for q in gold.queries:
        assert q.title not in blob  # digest + counts only, never the title
    assert len(digest) == 64
    assert manifest["n_rule_categories"] == 2  # gamma is held-out

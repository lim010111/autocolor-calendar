"""wandb send-gate (PII firewall) tests — the security-critical allowlist."""

from __future__ import annotations

import pytest

from embedding_eval.ledger import (
    PiiGateError,
    assert_wandb_safe,
    make_run_record,
    to_wandb_payload,
)
from embedding_eval.metrics import Thresholds


def _clean_record():
    return make_run_record(
        run_id="synth-v0-abcd",
        model="@cf/baai/bge-m3",
        dim=1024,
        prompt_arm="none",
        prompt_prefix="",
        prompt_prefix_sha256_16="e3b0c44298fc1c14",
        keyword_form_arm="name_word",
        include_examples=True,
        gold_set_version="synth-v0",
        manifest_sha256="deadbeef",
        n_categories=2,
        n_held_out_none=1,
        n_seeds=10,
        n_queries=6,
        split="temporal",
        embedding_backend="fake",
        model_revision="fake-v1",
        thresholds=Thresholds(0.5, 0.7, 0.05),
        metrics={
            "coverage": 0.5,
            "verified_precision": 0.96,
            "none_false_apply": 0.02,
            "macro_f1": 0.7,
            "per_category": {"cat_0": {"n_queries": 3, "tp": 2, "precision": 1.0, "recall": 0.66}},
        },
        wai_parity={"checked": False, "mean_cosine": None, "provisional": True},
    )


def test_clean_record_projects_and_passes_gate():
    payload = to_wandb_payload(_clean_record())
    assert "prompt_prefix" not in payload  # raw prefix stripped — only sha256_16 goes
    assert payload["prompt_prefix_sha256_16"] == "e3b0c44298fc1c14"
    assert payload["seed"] == 42  # legit key accepted by name despite matching /seed/
    assert payload["keyword_form_arm"] == "name_word"  # legit despite matching /keyword/
    assert set(payload["metrics"]["per_category"]) == {"cat_0"}


def test_gate_rejects_raw_title_key():
    bad = {"metrics": {"per_category": {}}, "title": "여자친구와 스타벅스"}
    with pytest.raises(PiiGateError):
        assert_wandb_safe(bad)


def test_gate_rejects_category_name_in_per_category():
    bad = {"metrics": {"per_category": {"개발": {"tp": 1}}}}
    with pytest.raises(PiiGateError, match="synthetic ID"):
        assert_wandb_safe(bad)


def test_gate_rejects_nested_seed_text_key():
    bad = {"metrics": {"per_category": {"cat_0": {"seed_text": "스크럼"}}}}
    with pytest.raises(PiiGateError):
        assert_wandb_safe(bad)


def test_gate_rejects_non_allowlisted_top_key():
    bad = {"metrics": {"per_category": {}}, "category_name": "운동"}
    with pytest.raises(PiiGateError, match="non-allowlisted"):
        assert_wandb_safe(bad)


def test_gate_allows_none_bucket_in_per_category():
    ok = {"metrics": {"per_category": {"cat_0": {"tp": 1}, "none": {"tp": 0}}}}
    assert_wandb_safe(ok)  # must not raise

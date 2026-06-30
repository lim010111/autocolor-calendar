"""Merge-gate finding-3 reproduction — wandb PII gate scope holes.

These tests assert the *documented* contract of ``assert_wandb_safe``, NOT the
current code behavior. They are expected to FAIL on HEAD; each failure proves the
documented invariant is not actually enforced.

Documented contract (the oracle):
- ``ledger.py`` docstring (assert_wandb_safe): "per_category / **any confusion
  dict** is keyed by synthetic IDs only".
- ``ledger.py`` module docstring: "A raw string can only reach wandb through a bug
  that also trips ``assert_wandb_safe`` → the call raises instead of leaking."
- ``README.md`` PII contract: "Category names / seeds / titles / keywords / raw
  prefix are **rejected** by ``ledger.assert_wandb_safe`` before any network call."

Reality on HEAD: the synthetic-ID check runs only on ``metrics.per_category``
(ledger.py ~L105-108), and ``_assert_no_forbidden_keys`` inspects dict KEYS only
(ASCII-only ``_FORBIDDEN_KEY`` regex), never string VALUES. So a Korean category
name keyed under a *different* confusion dict, or any raw string carried as a
VALUE, slips through the gate and would leak to wandb.
"""

from __future__ import annotations

import pytest

from embedding_eval.ledger import PiiGateError, assert_wandb_safe


def test_gate_rejects_category_name_key_in_non_per_category_confusion():
    """A category name keyed under a confusion dict OTHER than per_category.

    Docstring claims "any confusion dict is keyed by synthetic IDs only", and the
    README says category names are rejected. HEAD only checks
    ``metrics.per_category``, so this Korean category-name key leaks.
    """
    bad = {"metrics": {"confusion": {"개발": 3}}}
    with pytest.raises(PiiGateError):
        assert_wandb_safe(bad)


def test_gate_rejects_raw_string_value_under_metrics():
    """A raw title carried as a VALUE (not a key) under metrics.

    Module docstring claims a raw string can only reach wandb by tripping the
    assert. HEAD inspects keys only, never values, so the raw title leaks.
    """
    bad = {"metrics": {"hardest_case": "여자친구와 스타벅스 데이트"}}
    with pytest.raises(PiiGateError):
        assert_wandb_safe(bad)

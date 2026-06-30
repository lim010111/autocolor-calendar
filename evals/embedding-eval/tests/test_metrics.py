"""Pure decision-logic + metrics + selector tests (no backend, no PII)."""

from __future__ import annotations

import math

from embedding_eval.dataset import DECLARED, VERIFIED
from embedding_eval.metrics import (
    STAGE2,
    Outcome,
    Thresholds,
    compute_metrics,
    decide,
    select_winner,
    threshold_grid,
)


def test_threshold_grid_enforces_verified_below_declared():
    grid = threshold_grid((0.4, 0.7), (0.5, 0.6), (0.0,))
    pairs = {(t.t_verified, t.t_declared) for t in grid}
    assert pairs == {(0.4, 0.5), (0.4, 0.6)}  # 0.7 never < 0.5/0.6


def test_decide_verified_low_bar_clears():
    sims = {"alpha": {VERIFIED: 0.62, DECLARED: math.nan}}
    cat, via = decide(sims, Thresholds(t_verified=0.60, t_declared=0.80, margin=0.0))
    assert (cat, via) == ("alpha", VERIFIED)


def test_decide_declared_needs_high_bar():
    sims = {"alpha": {VERIFIED: math.nan, DECLARED: 0.62}}
    th = Thresholds(t_verified=0.50, t_declared=0.80, margin=0.0)
    assert decide(sims, th) == (None, STAGE2)  # 0.62 < T_declared 0.80 → handoff


def test_decide_margin_ambiguous_hands_off():
    sims = {
        "alpha": {VERIFIED: 0.70, DECLARED: math.nan},
        "beta": {VERIFIED: 0.69, DECLARED: math.nan},
    }
    th = Thresholds(t_verified=0.60, t_declared=0.80, margin=0.05)
    assert decide(sims, th) == (None, STAGE2)  # 0.70 - 0.69 < margin


def test_decide_clear_winner_over_margin():
    sims = {
        "alpha": {VERIFIED: 0.90, DECLARED: math.nan},
        "beta": {VERIFIED: 0.60, DECLARED: math.nan},
    }
    th = Thresholds(t_verified=0.50, t_declared=0.80, margin=0.05)
    assert decide(sims, th) == ("alpha", VERIFIED)


def test_compute_metrics_basic():
    id_map = {"alpha": "cat_0", "beta": "cat_1"}
    outcomes = [
        Outcome("alpha", "alpha"),  # correct apply
        Outcome("beta", "alpha"),  # wrong apply
        Outcome("beta", STAGE2),  # handed off
        Outcome("none", "alpha"),  # false apply
        Outcome("none", STAGE2),  # correctly withheld
    ]
    m = compute_metrics(outcomes, id_map)
    assert m["coverage"] == 0.6  # 3 of 5 auto-applied
    assert m["verified_precision"] == round(1 / 3, 4)  # 1 correct of 3 applied
    assert m["none_false_apply"] == 0.5  # 1 of 2 none queries applied
    assert m["per_category"]["cat_0"]["tp"] == 1
    assert set(m["per_category"]) == {"cat_0", "cat_1"}


def test_select_winner_precision_first():
    def rec(cov, prec, none_fp):
        return {"metrics": {"coverage": cov, "verified_precision": prec, "none_false_apply": none_fp}}

    records = [
        rec(0.90, 0.80, 0.01),  # high coverage but precision below floor
        rec(0.50, 0.97, 0.02),  # feasible
        rec(0.70, 0.96, 0.10),  # none-FP above ceiling
        rec(0.60, 0.98, 0.03),  # feasible, higher coverage than the 0.50 one
    ]
    winner, feasible = select_winner(records, precision_floor=0.95, none_ceiling=0.05)
    assert len(feasible) == 2
    assert winner["metrics"]["coverage"] == 0.60  # max coverage among feasible


def test_select_winner_none_when_infeasible():
    records = [{"metrics": {"coverage": 0.9, "verified_precision": 0.5, "none_false_apply": 0.0}}]
    winner, feasible = select_winner(records, precision_floor=0.95, none_ceiling=0.05)
    assert winner is None and feasible == []

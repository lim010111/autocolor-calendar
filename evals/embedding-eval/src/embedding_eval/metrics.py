"""Pure scoring + metrics — the data-blind, GPU-free, fully-testable core.

Decision logic (ADR-0004 §신뢰 등급 2개, lines 51-63), grade-aware:

  For query q and Rule r, with cosine sims to r's seeds split by grade:
    s_verified(r) = max cos(q, verified seed of r)   (or -inf if none)
    s_declared(r) = max cos(q, declared seed of r)   (or -inf if none)
  r is *eligible* iff  s_verified(r) ≥ T_verified  OR  s_declared(r) ≥ T_declared.
  Among eligible Rules (ranked by their best cleared score):
    - none eligible                          → Stage 2 (handoff)
    - best - second < margin (ambiguous)     → Stage 2 (Stage 1 never guesses)
    - else                                   → assign best Rule

`margin` is evaluated over *eligible* Rules — only contenders that cleared their
own grade bar compete. The verified bar is the low bar, declared the high bar
(T_verified < T_declared), per ADR-0004.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .dataset import DECLARED, NONE, VERIFIED, Query, Seed

STAGE2 = "__stage2__"  # sentinel: handed off to the LLM leg (not auto-applied)


@dataclass(frozen=True)
class Thresholds:
    t_verified: float
    t_declared: float
    margin: float


def threshold_grid(
    t_verified_grid, t_declared_grid, margin_grid
) -> list[Thresholds]:
    """Cartesian grid, enforcing T_verified < T_declared (ADR-0004)."""
    out: list[Thresholds] = []
    for tv in t_verified_grid:
        for td in t_declared_grid:
            if not tv < td:
                continue
            for m in margin_grid:
                out.append(Thresholds(t_verified=tv, t_declared=td, margin=m))
    return out


def sims_by_category(query_vec: np.ndarray, seeds: list[Seed], seed_vecs: np.ndarray) -> dict:
    """{cat: {VERIFIED: max_cos|nan, DECLARED: max_cos|nan}} for one query.

    Vectors are pre-normalized so cosine == dot product.
    """
    cos = seed_vecs @ query_vec  # (n_seeds,)
    acc: dict[str, dict[str, float]] = {}
    for i, s in enumerate(seeds):
        slot = acc.setdefault(s.cat, {VERIFIED: math.nan, DECLARED: math.nan})
        c = float(cos[i])
        cur = slot[s.grade]
        if math.isnan(cur) or c > cur:
            slot[s.grade] = c
    return acc


def decide(sims_by_cat: dict, th: Thresholds) -> tuple[str | None, str]:
    """Return (assigned_cat_or_None, via_grade) for one query.

    via_grade ∈ {VERIFIED, DECLARED} when assigned, else "stage2".
    """
    eligible: list[tuple[float, str, str]] = []  # (best_cleared_score, cat, via)
    for cat, g in sims_by_cat.items():
        sv = g.get(VERIFIED, math.nan)
        sd = g.get(DECLARED, math.nan)
        best = -math.inf
        via = ""
        if not math.isnan(sv) and sv >= th.t_verified and sv > best:
            best, via = sv, VERIFIED
        if not math.isnan(sd) and sd >= th.t_declared and sd > best:
            best, via = sd, DECLARED
        if via:
            eligible.append((best, cat, via))
    if not eligible:
        return None, STAGE2
    eligible.sort(reverse=True)
    best_score, best_cat, best_via = eligible[0]
    if len(eligible) >= 2 and (best_score - eligible[1][0]) < th.margin:
        return None, STAGE2  # ambiguous
    return best_cat, best_via


@dataclass(frozen=True)
class Outcome:
    expected: str  # category name or NONE
    decision: str  # assigned category name or STAGE2


def outcomes_for(
    queries: list[Query],
    query_vecs: np.ndarray,
    seeds: list[Seed],
    seed_vecs: np.ndarray,
    th: Thresholds,
) -> list[Outcome]:
    out: list[Outcome] = []
    for i, q in enumerate(queries):
        sims = sims_by_category(query_vecs[i], seeds, seed_vecs)
        cat, _ = decide(sims, th)
        out.append(Outcome(expected=q.expected, decision=cat if cat is not None else STAGE2))
    return out


def compute_metrics(outcomes: list[Outcome], id_map: dict[str, str]) -> dict:
    """Aggregate metrics keyed by synthetic IDs only (cat_N / none).

    - coverage          = auto-applied / total queries (auto-application rate)
    - verified_precision = of auto-applied queries, fraction with the correct
      category. "Verified" = the auto-apply we commit to the user's calendar;
      this is the precision floored by the selection objective (AC #12).
    - none_false_apply  = of expected=none queries, fraction auto-applied (≤ ceiling)
    - macro_f1          = macro-averaged F1 over Rule categories (reported, NOT the selector)
    - per_category      = {cat_N: {n_queries, tp, precision, recall}}
    """
    n = len(outcomes)
    assigned = [o for o in outcomes if o.decision != STAGE2]
    coverage = len(assigned) / n if n else 0.0

    correct = sum(1 for o in assigned if o.decision == o.expected)
    verified_precision = correct / len(assigned) if assigned else 0.0

    none_q = [o for o in outcomes if o.expected == NONE]
    none_applied = [o for o in none_q if o.decision != STAGE2]
    none_false_apply = len(none_applied) / len(none_q) if none_q else 0.0

    per_category: dict[str, dict] = {}
    f1s: list[float] = []
    for name, cid in id_map.items():
        gold = [o for o in outcomes if o.expected == name]
        pred = [o for o in outcomes if o.decision == name]
        tp = sum(1 for o in pred if o.expected == name)
        precision = tp / len(pred) if pred else 0.0
        recall = tp / len(gold) if gold else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        per_category[cid] = {
            "n_queries": len(gold),
            "tp": tp,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
        }
        if gold:  # only categories present in queries count toward macro-F1
            f1s.append(f1)
    macro_f1 = sum(f1s) / len(f1s) if f1s else 0.0

    return {
        "coverage": round(coverage, 4),
        "verified_precision": round(verified_precision, 4),
        "none_false_apply": round(none_false_apply, 4),
        "macro_f1": round(macro_f1, 4),
        "per_category": per_category,
    }


def select_winner(
    records: list[dict],
    *,
    precision_floor: float,
    none_ceiling: float,
) -> tuple[dict | None, list[dict]]:
    """Precision-first selector (AC #12 / design §5 item4).

    Among records meeting (verified_precision ≥ floor) AND
    (none_false_apply ≤ ceiling), pick max coverage. Returns (winner, feasible_set).
    Ties on coverage break toward higher verified_precision then lower
    none_false_apply for determinism. macro_f1 is deliberately NOT used.
    """
    feasible = [
        r
        for r in records
        if r["metrics"]["verified_precision"] >= precision_floor
        and r["metrics"]["none_false_apply"] <= none_ceiling
    ]
    if not feasible:
        return None, []
    winner = max(
        feasible,
        key=lambda r: (
            r["metrics"]["coverage"],
            r["metrics"]["verified_precision"],
            -r["metrics"]["none_false_apply"],
        ),
    )
    return winner, feasible

"""Finding: select_winner gates feasibility on 4dp-ROUNDED metrics.

compute_metrics rounds none_false_apply / verified_precision to 4 decimals, and
select_winner compares those already-rounded values against the ceiling/floor.
A config whose TRUE none_false_apply is strictly above none_ceiling can therefore
be admitted as feasible when 4dp rounding nudges it down across the boundary.
This breaches the precision-first objective (the selector must NEVER admit a
config that violates the floor/ceiling).

Construction (all real outcomes, no fabricated metrics dict):
  1999 expected=none queries, 100 auto-applied → true none_false_apply
  = 100/1999 = 0.05002501... which is strictly > the 0.05 ceiling, yet
  round(0.05002501..., 4) == 0.0500. So compute_metrics emits 0.05, and the
  rounded-value gate lets it pass.
"""

from __future__ import annotations

from embedding_eval.metrics import (
    STAGE2,
    Outcome,
    compute_metrics,
    select_winner,
)

NONE_CEILING = 0.05


def test_rounded_none_false_apply_must_not_admit_true_ceiling_breach():
    # --- Demonstrate the rounding is the CAUSE (not a fabricated dict) -------
    # 100 of 1999 none-queries auto-applied. True ratio strictly breaches 0.05.
    true_ratio = 100 / 1999
    assert true_ratio > NONE_CEILING  # genuine breach: 0.05002501... > 0.05
    assert round(true_ratio, 4) == NONE_CEILING  # but 4dp rounding masks it

    outcomes = (
        [Outcome("none", "alpha") for _ in range(100)]  # false applies
        + [Outcome("none", STAGE2) for _ in range(1899)]  # correctly withheld
    )
    m = compute_metrics(outcomes, {"alpha": "cat_0"})

    # compute_metrics itself emits the rounded 0.0500 — proving the round() in
    # the metric, fed to a gate that also reads the rounded value, is the defect.
    assert m["none_false_apply"] == NONE_CEILING
    assert m["none_false_apply"] != true_ratio  # the true value was lost

    # --- The actual gate behaviour ------------------------------------------
    # precision_floor=0.0 isolates none_false_apply as the only binding gate.
    records = [{"thresholds": "cfg", "metrics": m}]
    winner, feasible = select_winner(
        records, precision_floor=0.0, none_ceiling=NONE_CEILING
    )

    # The config's TRUE none_false_apply (0.05002501...) exceeds the ceiling, so
    # the selector MUST reject it. On HEAD it is admitted because the gate sees
    # the 4dp-rounded 0.0500 <= 0.05 — this assertion fails, proving the finding.
    assert feasible == [], (
        "config breaching the true none_false_apply ceiling was admitted as "
        f"feasible (true={true_ratio!r}, rounded={m['none_false_apply']!r})"
    )
    assert winner is None

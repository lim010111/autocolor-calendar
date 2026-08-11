"""arch-judgment hard-slice gate scorer (ADR-0008 Accepted gate #1).

Reproduces the acceptance check that was previously run inline (merge-gate
finding-2): on the mined disagreement slice (cases where the wave-1 candidates
split), score the CURRENT architecture A (declared Stage-1 assignment → LLM)
against the ACCEPTED policy C+2vote(desc) and report non-degradation.

Gate criterion (verdict draft "판정 기준"): the accepted policy must not be
worse than A on the hard slice. Exit 1 if it is.

Usage: python3 evals/arch-judgment/score_hard_slice.py
Inputs: _local scores/disagreements.json + fixtures + run/desc call tables.
"""

from __future__ import annotations

import json
import sys

from score import AJ, T_DECLARED, current_chain, llm_only, load_cases
from score_desc_stage1 import build, stage1_of
from score_wave2 import recheck, tally

BASE_RUNS = ["run1", "run2", "run3"]
DESC_RUNS = ["desc1", "desc2"]


def mean(stats: list[dict]) -> dict:
    return {k: sum(s[k] for s in stats) / len(stats) for k in stats[0]}


def chain_a(run: str):
    return lambda c: (
        g if (g := stage1_of(c["ranked"], T_DECLARED)) != "none" else c["llm"][run]
    )


def fmt(name: str, s: dict) -> str:
    return (
        f"| {name} | {s['utility']:+.4f} | {s['false_apply']:.1%} "
        f"| {s['miss']:.1%} | {s['accuracy']:.1%} |"
    )


def main() -> None:
    hard_ids = {
        r["id"] for r in json.loads((AJ / "scores" / "disagreements.json").read_text())
    }
    cases = load_cases(BASE_RUNS + DESC_RUNS)
    build(cases)
    hard = [c for c in cases if c["id"] in hard_ids]
    if len(hard) != len(hard_ids):
        raise SystemExit(f"hard slice mismatch: {len(hard)}/{len(hard_ids)} ids matched")
    print(f"hard slice: {len(hard)} cases\n")

    a_base = mean([tally(hard, chain_a(r)) for r in BASE_RUNS])
    rows = [
        ("A current-chain (base)", a_base),
        ("C llm-only (base)", mean([tally(hard, lambda c, r=r: c["llm"][r]) for r in BASE_RUNS])),
        ("A current-chain (desc)", mean([tally(hard, chain_a(r)) for r in DESC_RUNS])),
        ("C llm-only (desc)", mean([tally(hard, lambda c, r=r: c["llm"][r]) for r in DESC_RUNS])),
    ]
    for label, base_fn in (("A+2vote (desc)", current_chain), ("C+2vote (desc, accepted)", llm_only)):
        stats = [
            tally(hard, lambda c, b=base_fn, a=a, x=x: recheck(c, b, a, [x], 1))
            for a, x in [tuple(DESC_RUNS), tuple(reversed(DESC_RUNS))]
        ]
        rows.append((label, mean(stats)))

    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    for name, s in rows:
        print(fmt(name, s))

    accepted = rows[-1][1]
    ok = accepted["utility"] >= a_base["utility"] and (
        accepted["false_apply"] <= a_base["false_apply"]
    )
    print(
        f"\ngate: accepted C+2vote(desc) {accepted['utility']:+.4f}/fa {accepted['false_apply']:.1%} "
        f"vs A(base) {a_base['utility']:+.4f}/fa {a_base['false_apply']:.1%} -> "
        + ("PASS (non-degrading)" if ok else "FAIL")
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

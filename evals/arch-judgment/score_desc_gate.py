"""arch-judgment wave-3c — description cosine as a PAINT-VETO gate (user idea).

Hypothesis under test: when Stage 1 paints (declared assignment), a low
description cosine — in particular "original seed cosine > description
cosine" — flags a likely false apply; vetoing those paints (deferring to
the LLM instead) should cut Stage-1 false applies without giving up the
call savings of the assignments that survive.

Zero model calls: everything is re-synthesized from cosine-grid.json,
desc-cosines.json and the existing LLM call tables.

Reported:
  1. signal separation among ASSIGNED cases — feature distributions for
     correct vs false-apply paints (desc cosine d, delta s-d, desc-rank)
  2. the user's exact rule (veto iff s > d): FP rate given s>d vs s<=d
  3. gate sweep — pass rate, fa-of-passed, correct paints lost to veto
  4. chain utility per gate (paint if gate passes, else LLM) on desc runs
     and base runs, vs A (no gate) and C (veto everything = llm-only)
  5. head-to-head on each gate's PASSED subset: paint vs LLM on the same
     cases — the decisive number for whether any gate can beat C

Usage: python3 evals/arch-judgment/score_desc_gate.py
"""

from __future__ import annotations

import statistics as st

from score import T_DECLARED, judge, load_cases
from score_desc_stage1 import build, stage1_of

DESC_RUNS = ["desc1", "desc2"]
BASE_RUNS = ["run1", "run2", "run3"]


def annotate(cases: list[dict]) -> list[dict]:
    """Attach c["_gate"] = features of the Stage-1 assignment (or None)."""
    assigned = []
    for c in cases:
        got = stage1_of(c["ranked"], T_DECLARED)
        if got == "none":
            c["_gate"] = None
            continue
        s = dict(c["ranked"])[got]
        dmap = {disp: d for disp, _m, d in c["ranked_desc"]}
        d = dmap[got]
        others = [v for k, v in dmap.items() if k != got]
        feat = {
            "got": got,
            "s": s,
            "d": d,
            "delta": s - d,
            "rank1": (not others) or d >= max(others),
            "kind": judge(got, c["expected"])[1],
        }
        c["_gate"] = feat
        assigned.append(feat)
    return assigned


GATES = {
    "no-gate (A)": lambda f: True,
    "veto-all (C)": lambda f: False,
    "user: pass iff d>=s": lambda f: f["d"] >= f["s"],
    "d>=0.45": lambda f: f["d"] >= 0.45,
    "d>=0.50": lambda f: f["d"] >= 0.50,
    "d>=0.55": lambda f: f["d"] >= 0.55,
    "d>=0.60": lambda f: f["d"] >= 0.60,
    "desc-rank1": lambda f: f["rank1"],
    "rank1 & d>=0.50": lambda f: f["rank1"] and f["d"] >= 0.50,
    "s-d<=0.05": lambda f: f["delta"] <= 0.05,
    "s-d<=0.10": lambda f: f["delta"] <= 0.10,
}


def quant(xs: list[float]) -> str:
    if len(xs) < 20:
        return f"n={len(xs)} (too few for quantiles) mean={st.mean(xs):.3f}"
    qs = st.quantiles(xs, n=20)
    return f"p5={qs[0]:.3f} p25={qs[4]:.3f} p50={qs[9]:.3f} p75={qs[14]:.3f} p95={qs[18]:.3f} (n={len(xs)})"


def tally(cases, decide) -> dict:
    n = len(cases)
    util = 0.0
    kinds = {"correct": 0, "false_apply": 0, "miss": 0}
    for c in cases:
        u, k = judge(decide(c), c["expected"])
        util += u
        kinds[k] += 1
    return {
        "utility": util / n,
        "false_apply": kinds["false_apply"] / n,
        "miss": kinds["miss"] / n,
        "accuracy": kinds["correct"] / n,
    }


def main() -> None:
    cases = load_cases(BASE_RUNS + DESC_RUNS)
    build(cases)
    assigned = annotate(cases)

    n_as = len(assigned)
    fa = [f for f in assigned if f["kind"] == "false_apply"]
    ok = [f for f in assigned if f["kind"] == "correct"]
    print(
        f"Stage-1 assigned: {n_as}/{len(cases)} ({n_as/len(cases):.1%}) — "
        f"correct {len(ok)} ({len(ok)/n_as:.1%}), false-apply {len(fa)} ({len(fa)/n_as:.1%})"
    )

    # 1. Signal separation among assigned paints.
    print("\n## 1. feature distributions — correct paints vs false-apply paints\n")
    for name, key in (("desc cosine d", "d"), ("delta s-d", "delta")):
        print(f"{name}  correct : {quant([f[key] for f in ok])}")
        print(f"{name}  false-ap: {quant([f[key] for f in fa])}")
    r1_ok = sum(f["rank1"] for f in ok)
    r1_fa = sum(f["rank1"] for f in fa)
    print(f"desc-rank1 share  correct: {r1_ok/len(ok):.1%}   false-apply: {r1_fa/len(fa):.1%}")

    # 2. The user's exact rule.
    print("\n## 2. user rule — veto iff original cosine s > desc cosine d\n")
    hi = [f for f in assigned if f["s"] > f["d"]]
    lo = [f for f in assigned if f["s"] <= f["d"]]
    for label, grp in (("s > d (veto side)", hi), ("s <= d (keep side)", lo)):
        if not grp:
            print(f"{label}: n=0")
            continue
        g_fa = sum(f["kind"] == "false_apply" for f in grp)
        print(f"{label}: n={len(grp)} ({len(grp)/n_as:.1%} of paints), FP rate {g_fa/len(grp):.1%}")

    # 3. Gate sweep — what each gate keeps and loses.
    print("\n## 3. gate sweep on assigned paints\n")
    print("| gate | pass rate | fa of passed | correct vetoed | fa vetoed |")
    print("|---|---|---|---|---|")
    for name, g in GATES.items():
        passed = [f for f in assigned if g(f)]
        p_fa = sum(f["kind"] == "false_apply" for f in passed)
        veto_ok = sum(1 for f in ok if not g(f))
        veto_fa = sum(1 for f in fa if not g(f))
        fa_share = f"{p_fa/len(passed):.1%}" if passed else "—"
        print(
            f"| {name} | {len(passed)/n_as:.1%} | {fa_share} "
            f"| {veto_ok}/{len(ok)} | {veto_fa}/{len(fa)} |"
        )

    # 4. Chain utility per gate: paint iff assigned & gate passes, else LLM.
    def chain_rows(runs: list[str], label: str) -> None:
        print(f"\n## 4. chain utility — {label}\n")
        print("| gate | utility | false-apply | miss | accuracy | LLM calls/case |")
        print("|---|---|---|---|---|---|")
        for name, g in GATES.items():
            stats = []
            for r in runs:
                stats.append(
                    tally(
                        cases,
                        lambda c, g=g, r=r: (
                            c["_gate"]["got"]
                            if c["_gate"] is not None and g(c["_gate"])
                            else c["llm"][r]
                        ),
                    )
                )
            m = {k: sum(s[k] for s in stats) / len(stats) for k in stats[0]}
            saved = sum(1 for c in cases if c["_gate"] is not None and g(c["_gate"]))
            calls = 1 - saved / len(cases)
            print(
                f"| {name} | {m['utility']:+.4f} | {m['false_apply']:.1%} "
                f"| {m['miss']:.1%} | {m['accuracy']:.1%} | {calls:.3f} |"
            )

    chain_rows(DESC_RUNS, "desc runs (desc in LLM prompt), mean of 2")
    chain_rows(BASE_RUNS, "base runs (no desc in prompt), mean of 3")

    # 5. Head-to-head on each gate's passed subset: paint vs LLM (desc mean).
    print("\n## 5. passed-subset head-to-head — paint vs LLM on the SAME cases (desc runs)\n")
    print("| gate | n | paint util | LLM util | paint fa | LLM fa |")
    print("|---|---|---|---|---|---|")
    for name, g in GATES.items():
        sub = [c for c in cases if c["_gate"] is not None and g(c["_gate"])]
        if not sub:
            print(f"| {name} | 0 | — | — | — | — |")
            continue
        p = tally(sub, lambda c: c["_gate"]["got"])
        l_stats = [tally(sub, lambda c, r=r: c["llm"][r]) for r in DESC_RUNS]
        l = {k: sum(s[k] for s in l_stats) / 2 for k in l_stats[0]}
        print(
            f"| {name} | {len(sub)} | {p['utility']:+.4f} | {l['utility']:+.4f} "
            f"| {p['false_apply']:.1%} | {l['false_apply']:.1%} |"
        )


if __name__ == "__main__":
    main()

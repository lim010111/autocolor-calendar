"""arch-judgment wave-3b scorer — description as an EMBEDDING seed.

Wave 3 measured descriptions in the LLM prompt only. This scorer answers the
follow-up: do the same descriptions help Stage 1? It merges desc-cosines.json
into each case's ranked list (score = max(original seeds, description seed))
and re-synthesizes the Stage-1 candidates — zero model calls.

Reported:
  1. desc-cosine separation (correct-cat vs wrong-cat distributions)
  2. B1 embedding-only bar sweep — original vs +desc seeds
  3. Stage-1 assignment quality at prod thresholds (assign rate, fa-of-assigned)
  4. chain composition under full desc adoption (stage1+desc → LLM desc runs)

Usage: python3 evals/arch-judgment/score_desc_stage1.py
"""

from __future__ import annotations

import json
from collections import defaultdict

from score import AJ, MARGIN, T_DECLARED, judge, load_cases

DESC_RUNS = ["desc1", "desc2"]
BASE_RUNS = ["run1", "run2", "run3"]


def build(cases: list[dict]) -> None:
    desc = json.loads((AJ / "desc-cosines.json").read_text())["titles"]
    grid = json.loads((AJ / "cosine-grid.json").read_text())
    ko_of = {v: k for k, v in grid["en_names"].items()}
    for c in cases:
        grp = "desc_en" if c["lang"] == "en" else "desc_ko"
        ranked = []
        for disp, s in c["ranked"]:
            ko = ko_of.get(disp, disp) if c["lang"] == "en" else disp
            d = desc[c["tkey"]][ko][grp]
            ranked.append((disp, max(s, d), d))
        c["ranked_desc"] = sorted(ranked, key=lambda t: -t[1])


def stage1_of(ranked, bar: float, margin: float = MARGIN) -> str:
    if not ranked:
        return "none"
    if ranked[0][1] < bar:
        return "none"
    if len(ranked) > 1 and ranked[0][1] - ranked[1][1] < margin:
        return "none"
    return ranked[0][0]


def tally(cases, decide) -> dict:
    n = len(cases)
    util = 0
    kinds = defaultdict(int)
    for c in cases:
        u, k = judge(decide(c), c["expected"])
        util += u
        kinds[k] += 1
    return {
        "utility": round(util / n, 4),
        "false_apply": round(kinds["false_apply"] / n, 4),
        "miss": round(kinds["miss"] / n, 4),
        "accuracy": round(kinds["correct"] / n, 4),
    }


def row(name, s):
    return (
        f"| {name} | {s['utility']:+.4f} | {s['false_apply']:.1%} "
        f"| {s['miss']:.1%} | {s['accuracy']:.1%} |"
    )


def main() -> None:
    cases = load_cases(BASE_RUNS + DESC_RUNS)
    build(cases)

    # 1. Separation: desc cosine of the CORRECT offered cat vs the best WRONG one.
    cor, wrong = [], []
    for c in cases:
        for disp, _s, d in c["ranked_desc"]:
            if disp == c["expected"]:
                cor.append(d)
            else:
                wrong.append(d)
    import statistics as st

    for label, xs in (("correct-cat", cor), ("wrong-cat", wrong)):
        qs = st.quantiles(xs, n=20)
        print(f"desc cosine {label}: p5={qs[0]:.3f} p50={qs[9]:.3f} p95={qs[18]:.3f} (n={len(xs)})")

    # 2. B1 embedding-only sweep, original vs +desc.
    print("\n## B1 embedding-only — original seeds vs +description seed\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    for bar in (0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90):
        print(row(f"B1 orig bar={bar:.2f}", tally(cases, lambda c, b=bar: stage1_of(c["ranked"], b))))
        print(row(f"B1 +desc bar={bar:.2f}", tally(cases, lambda c, b=bar: stage1_of(c["ranked_desc"], b))))

    # 3. Assignment quality at prod thresholds.
    print("\n## Stage-1 assignment quality (bar=0.55, margin=0.10)\n")
    print("| variant | assign rate | fa share of assigned | correct share of assigned |")
    print("|---|---|---|---|")
    for label, key in (("original", "ranked"), ("+desc", "ranked_desc")):
        assigned = fa = ok = 0
        for c in cases:
            got = stage1_of(c[key], T_DECLARED)
            if got == "none":
                continue
            assigned += 1
            _, kind = judge(got, c["expected"])
            fa += kind == "false_apply"
            ok += kind == "correct"
        n = len(cases)
        print(
            f"| {label} | {assigned / n:.1%} | {fa / max(assigned, 1):.1%} "
            f"| {ok / max(assigned, 1):.1%} |"
        )

    # 4. Chains under full desc adoption (LLM answers from the desc call tables).
    print("\n## chains — Stage-1 variant + LLM(desc runs, mean of 2)\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")

    def mean2(decide_for_run):
        stats = [tally(cases, decide_for_run(r)) for r in DESC_RUNS]
        return {k: round(sum(s[k] for s in stats) / 2, 4) for k in stats[0]}

    print(row("C llm-only (desc prompt)", mean2(lambda r: lambda c: c["llm"][r])))
    for label, key in (("A chain orig-stage1", "ranked"), ("A chain +desc-stage1", "ranked_desc")):
        for bar in (T_DECLARED, 0.75):
            s = mean2(
                lambda r, k=key, b=bar: lambda c: (
                    stage1_of(c[k], b) if stage1_of(c[k], b) != "none" else c["llm"][r]
                )
            )
            print(row(f"{label} bar={bar:.2f}", s))


if __name__ == "__main__":
    main()

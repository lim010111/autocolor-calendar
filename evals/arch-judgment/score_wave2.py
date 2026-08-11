"""arch-judgment wave-2 scorer — paint-recheck votes (D3), judgment cache
(D8) vs ratchet@k=3, and the Stage-1 margin sweep wave 1 skipped.

Reuses score.py's `load_cases` / `stage1` / `judge` (and the two base
policies) unchanged — score.py is not modified.

D3 semantics (sequential re-check, per 2026-08-08 wave-2 brief):
  first-pass = the base policy's decision on the primary run. If it is
  "none" the case is accepted as none immediately (safe side, no re-check).
  If it paints X, extra LLM sample(s) — the OTHER run(s)' raw LLM answer
  for the same case — must also say X for the paint to go through:
    2vote  : 1 confirm sample, must match        (pairs: r1r2 / r1r3 / r2r3)
    3vote  : 2 confirm samples, both must match  (primary run1)
    2of3   : 2 confirm samples, >=1 must match   (primary run1; reference)
  Note for base A: a Stage-1 paint is deterministic, so its confirm sample
  is a *new* LLM call in prod — the extra-call rate below counts it.

D8-cache: the first observation's (run1) decision is frozen — repeat
classification never re-rolls. Compared against ratchet@k=3 (painting is
one-way; false if any of the three runs false-applies).

Usage: python3 evals/arch-judgment/score_wave2.py --runs run1 run2 run3
Output: aggregate tables on stdout (no titles), scores/wave2-detail.json.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict

from score import (
    AJ,
    current_chain,
    fmt_row,
    judge,
    llm_only,
    load_cases,
    ratchet_score,
    stage1,
)

BASES = {
    "C-llm-only": llm_only,
    "A-current-chain": current_chain,
}

PAIRS = [("run1", "run2"), ("run1", "run3"), ("run2", "run3")]


# --- D3 policies (case -> painted, using multiple runs) ---------------------

def recheck(case: dict, base, primary: str, confirms: list[str], need: int) -> str:
    fp = base(case, case["llm"][primary])
    if fp == "none":
        return "none"
    hits = sum(1 for r in confirms if case["llm"][r] == fp)
    return fp if hits >= need else "none"


# --- scoring ----------------------------------------------------------------

def tally(cases: list[dict], decide) -> dict:
    n = len(cases)
    util = 0
    kinds = defaultdict(int)
    for c in cases:
        u, kind = judge(decide(c), c["expected"])
        util += u
        kinds[kind] += 1
    return {
        "n": n,
        "utility": round(util / n, 4),
        "false_apply": round(kinds["false_apply"] / n, 4),
        "miss": round(kinds["miss"] / n, 4),
        "accuracy": round(kinds["correct"] / n, 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", default=["run1", "run2", "run3"])
    args = ap.parse_args()
    runs = args.runs
    assert len(runs) == 3, "wave-2 scoring needs exactly three runs"
    cases = load_cases(runs)
    n = len(cases)
    detail: dict = {"runs": runs, "n_cases": n}

    # Baseline reference: each base per run (single-shot).
    print("\n## baselines — single-shot per run\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    detail["baselines"] = {}
    for bname, base in BASES.items():
        for r in runs:
            s = tally(cases, lambda c, b=base, r=r: b(c, c["llm"][r]))
            detail["baselines"][f"{bname}@{r}"] = s
            print(fmt_row(f"{bname}@{r}", s))

    # D3 vote variants.
    print("\n## D3 — paint-recheck votes\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    detail["d3"] = {}
    for bname, base in BASES.items():
        for a, b in PAIRS:
            name = f"D3-2vote[{bname}] {a}+{b}"
            s = tally(cases, lambda c, ba=base, a=a, b=b: recheck(c, ba, a, [b], 1))
            detail["d3"][name] = s
            print(fmt_row(name, s))
        name = f"D3-3vote[{bname}]"
        s = tally(cases, lambda c, ba=base: recheck(c, ba, runs[0], runs[1:], 2))
        detail["d3"][name] = s
        print(fmt_row(name, s))
        name = f"D3-2of3[{bname}]"
        s = tally(cases, lambda c, ba=base: recheck(c, ba, runs[0], runs[1:], 1))
        detail["d3"][name] = s
        print(fmt_row(name, s))

    # D3 extra-call cost: fraction of cases whose first-pass decision was a
    # paint (each such case triggers 1 extra LLM sample for 2vote, 2 for
    # 3vote/2of3). Also the base's own first-pass call rate for context.
    print("\n## D3 extra-call cost — first-pass paint rate (re-check trigger)\n")
    print("| base | run | first-pass paint rate | first-pass LLM-call rate |")
    print("|---|---|---|---|")
    detail["d3_cost"] = {}
    s1_fallthrough = sum(1 for c in cases if stage1(c) == "none") / n
    for bname, base in BASES.items():
        for r in runs:
            paint = sum(1 for c in cases if base(c, c["llm"][r]) != "none") / n
            call = 1.0 if bname == "C-llm-only" else s1_fallthrough
            detail["d3_cost"][f"{bname}@{r}"] = {
                "first_pass_paint_rate": round(paint, 4),
                "first_pass_llm_call_rate": round(call, 4),
                "calls_per_case_2vote": round(call + paint, 4),
                "calls_per_case_3vote": round(call + 2 * paint, 4),
            }
            print(f"| {bname} | {r} | {paint:.1%} | {call:.1%} |")
    detail["stage1_fallthrough_rate"] = round(s1_fallthrough, 4)

    # D8 cache vs ratchet@k=3.
    print("\n## D8-cache (freeze run1 decision) vs ratchet@k=3 (paint is one-way)\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    detail["d8"] = {}
    for bname, base in BASES.items():
        s = tally(cases, lambda c, ba=base: ba(c, c["llm"][runs[0]]))
        detail["d8"][f"D8-cache[{bname}]"] = s
        print(fmt_row(f"D8-cache[{bname}]", s))
        s = ratchet_score(cases, base, runs)
        detail["d8"][f"ratchet@k=3[{bname}]"] = s
        print(fmt_row(f"ratchet@k=3[{bname}]", s))

    # Margin sweep on the current chain (Stage-1 margin x assign bar).
    print("\n## margin sweep — current chain, Stage-1(bar, margin) -> LLM fall-through")
    print("(mean over 3 runs; per-run in wave2-detail.json)\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    detail["margin_sweep"] = {}
    for margin in (0.05, 0.10, 0.15):
        for bar in (0.55, 0.65, 0.75):
            def chain_mb(c, llm, b=bar, m=margin):
                s1 = stage1(c, bar=b, margin=m)
                return s1 if s1 != "none" else llm
            per_run = {
                r: tally(cases, lambda c, r=r: chain_mb(c, c["llm"][r])) for r in runs
            }
            mean = {
                k: round(sum(per_run[r][k] for r in runs) / 3, 4)
                for k in ("utility", "false_apply", "miss", "accuracy")
            }
            mean["n"] = n
            name = f"A-chain margin={margin:.2f} bar={bar:.2f}"
            detail["margin_sweep"][name] = {"mean": mean, "per_run": per_run}
            print(fmt_row(name, mean))

    # Raw-LLM agreement across the three runs (nondeterminism floor).
    agree3 = sum(1 for c in cases if len({c["llm"][r] for r in runs}) == 1)
    agree2 = sum(1 for c in cases if len({c["llm"][r] for r in runs}) == 2)
    split3 = n - agree3 - agree2
    detail["llm_agreement"] = {
        "all3_same": round(agree3 / n, 4),
        "two_same": round(agree2 / n, 4),
        "all_differ": round(split3 / n, 4),
    }
    print(
        f"\nraw LLM 3-run agreement: all-same {agree3/n:.1%} / "
        f"2-of-3 {agree2/n:.1%} / all-differ {split3/n:.1%}"
    )

    out_dir = AJ / "scores"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "wave2-detail.json").write_text(json.dumps(detail, indent=1) + "\n")
    print(f"\nwrote {out_dir / 'wave2-detail.json'}")


if __name__ == "__main__":
    main()

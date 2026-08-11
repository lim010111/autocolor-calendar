"""arch-judgment wave-4 scorer — keywords:[] and merged-field arms vs the
measured ko-11 cells (ADR-0008 trigger 3 / min(0) relaxation gate).

Cells (all C llm-only, ko-11 list, mean over runs):
  measured   : min (keywords=[name]) base/desc, full (name+kw) base/desc
  wave-4 new : empty (keywords=[]) no-desc / desc, merged (kw folded into desc)

Questions answered:
  1. min(0) safety — does keywords:[] degrade vs the [name] fallback it replaces?
  2. merge verdict — does one merged field match the both-fields cell (+0.5707)?
Also reports 2vote recheck on the wave-4 pair for the headline cells.

Usage: python3 evals/arch-judgment/score_wave4.py
"""

from __future__ import annotations

import json
from pathlib import Path

from score import AJ, load_cases, judge
from score_wave2 import tally

W4 = ("ko-11-empty", "ko-11-empty-desc", "ko-11-merged")
W4_RUNS = ["w4r1", "w4r2"]


def load_w4(runs: list[str]) -> list[dict]:
    """W4 fixtures/results live in their own dirs; mirror score.load_cases
    minimally (no cosine grid — these arms are LLM-only by design)."""
    fix_dir = AJ / "fixtures-w4"
    cases: dict[str, dict] = {}
    for cond in W4:
        fx = json.loads((fix_dir / f"{cond}.json").read_text())
        for c in fx["cases"]:
            cases[c["id"]] = {
                "id": c["id"],
                "cond": cond,
                "expected": c["expected"]["category_name"],
                "llm": {},
            }
    for run in runs:
        for cond in W4:
            res = json.loads((AJ / "results" / run / f"{cond}.json").read_text())
            for r in res["cases"]:
                cases[r["id"]]["llm"][run] = r["got"]
    out = list(cases.values())
    missing = [c["id"] for c in out for r in runs if r not in c["llm"]]
    if missing:
        raise SystemExit(f"missing results for {len(missing)} case-runs (e.g. {missing[:3]})")
    return out


def mean_llm(sub: list[dict], runs: list[str]) -> dict:
    stats = [tally(sub, lambda c, r=r: c["llm"][r]) for r in runs]
    return {k: sum(s[k] for s in stats) / len(stats) for k in stats[0]}


def recheck2(sub: list[dict], runs: list[str]) -> dict:
    """2vote on the pair: paint only if both runs agree; none accepted at once."""
    stats = []
    for a, b in [(runs[0], runs[1]), (runs[1], runs[0])]:
        def decide(c, a=a, b=b):
            first = c["llm"][a]
            if first == "none":
                return "none"
            return first if c["llm"][b] == first else "none"
        stats.append(tally(sub, decide))
    return {k: sum(s[k] for s in stats) / len(stats) for k in stats[0]}


def fmt(name: str, s: dict) -> str:
    return (
        f"| {name} | {s['utility']:+.4f} | {s['false_apply']:.1%} "
        f"| {s['miss']:.1%} | {s['accuracy']:.1%} |"
    )


def main() -> None:
    w4 = load_w4(W4_RUNS)
    base = load_cases(["run1", "run2", "run3"])
    desc = load_cases(["desc1", "desc2"])

    def cell(cases_, cond, runs):
        sub = [c for c in cases_ if c["cond"] == cond]
        return mean_llm(sub, runs)

    print("## C llm-only, ko-11 cells (mean over runs)\n")
    print("| cell | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    rows = [
        ("min  = keywords:[name]        ", cell(base, "ko-11-min", ["run1", "run2", "run3"])),
        ("empty= keywords:[]        (W4)", cell(w4, "ko-11-empty", W4_RUNS)),
        ("min  + desc                   ", cell(desc, "ko-11-min", ["desc1", "desc2"])),
        ("empty+ desc               (W4)", cell(w4, "ko-11-empty-desc", W4_RUNS)),
        ("full = name+keywords          ", cell(base, "ko-11-full", ["run1", "run2", "run3"])),
        ("full + desc  (both fields)    ", cell(desc, "ko-11-full", ["desc1", "desc2"])),
        ("merged single field       (W4)", cell(w4, "ko-11-merged", W4_RUNS)),
    ]
    for name, s in rows:
        print(fmt(name, s))

    print("\n## 2vote recheck on the wave-4 pair\n")
    print("| cell | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    for cond in W4:
        sub = [c for c in w4 if c["cond"] == cond]
        print(fmt(f"{cond} +2vote", recheck2(sub, W4_RUNS)))

    detail = {
        "runs": W4_RUNS,
        "cells": {name.strip(): s for name, s in rows},
    }
    out = AJ / "scores" / "wave4-detail.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(detail, indent=1) + "\n")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()

"""arch-judgment wave-3 scorer — rule-description variant vs the no-description
baseline runs.

The desc call tables (results/desc1, desc2) were produced from fixtures-desc/
(same subsets/expected by construction — build_fixtures.py --descriptions);
score.py's load_cases reads fixtures/ for ground truth + offered lists, which
are identical, so the unchanged loader scores desc runs directly.

Reports:
  1. full wave-1 candidate table on each desc run (same synthesis as score.py)
  2. desc-vs-base delta for headline candidates (desc mean vs base-run mean)
  3. paint-recheck (2vote) on the desc pair, vs the base runs' 2vote mean
  4. slice deltas (min/full seeds, en names, full-list vs sparse)
  5. ratchet@k=2 + raw flip rate on the desc pair

Usage: python3 evals/arch-judgment/score_wave3.py \
           --desc-runs desc1 desc2 --base-runs run1 run2 run3
Output: stdout aggregates (no titles), scores/wave3-detail.json.
"""

from __future__ import annotations

import argparse
import json
from itertools import combinations

from score import (
    AJ,
    SPARSE,
    candidates,
    current_chain,
    fmt_row,
    llm_only,
    load_cases,
    ratchet_score,
    score_slice,
)
from score_wave2 import recheck, tally

BASES = {"C-llm-only": llm_only, "A-current-chain": current_chain}

HEADLINE = [
    "C-llm-only", "F-seedaware-stage1", "A2-chain-bar=0.75", "A-current-chain",
    "D2-agreement", "E-evidence-gate", "B1-stage1-only-bar=0.65",
    "B2-count-gate<4", "D1-band-tnone=0.60",
]


def mean_stats(stats: list[dict]) -> dict:
    keys = ("utility", "false_apply", "miss", "accuracy")
    out = {k: round(sum(s[k] for s in stats) / len(stats), 4) for k in keys}
    out["n"] = stats[0]["n"]
    return out


def slices_of(cases: list[dict]) -> dict:
    return {
        "min-seeds": [c for c in cases if c["richness"] == "min"],
        "full-seeds": [c for c in cases if c["richness"] == "full"],
        "en-names": [c for c in cases if c["lang"] == "en"],
        "full-list(11)": [c for c in cases if c["cond"] not in SPARSE],
        "sparse(6/3/2)": [c for c in cases if c["cond"] in SPARSE],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--desc-runs", nargs=2, default=["desc1", "desc2"])
    ap.add_argument("--base-runs", nargs="+", default=["run1", "run2", "run3"])
    args = ap.parse_args()

    desc_cases = load_cases(args.desc_runs)
    base_cases = load_cases(args.base_runs)
    cands = candidates()
    detail: dict = {"desc_runs": args.desc_runs, "base_runs": args.base_runs}

    # 1. Full candidate table per desc run.
    detail["per_run"] = {}
    for run in args.desc_runs:
        print(f"\n## desc run={run} — all wave-1 candidates\n")
        print("| candidate | utility | false-apply | miss | accuracy |")
        print("|---|---|---|---|---|")
        rows = {}
        for name, policy in cands.items():
            s = score_slice(desc_cases, policy, run)
            rows[name] = s
            print(fmt_row(name, s))
        detail["per_run"][run] = rows

    # 2. Desc-vs-base delta, headline candidates (mean over runs each side).
    print("\n## desc vs base — headline candidates (mean over runs)\n")
    print("| candidate | base util | desc util | Δutil | base fa | desc fa | Δfa |")
    print("|---|---|---|---|---|---|---|")
    detail["delta"] = {}
    for name in HEADLINE:
        b = mean_stats([score_slice(base_cases, cands[name], r) for r in args.base_runs])
        d = mean_stats([score_slice(desc_cases, cands[name], r) for r in args.desc_runs])
        detail["delta"][name] = {"base": b, "desc": d}
        print(
            f"| {name} | {b['utility']:+.4f} | {d['utility']:+.4f} "
            f"| {d['utility'] - b['utility']:+.4f} | {b['false_apply']:.1%} "
            f"| {d['false_apply']:.1%} | {(d['false_apply'] - b['false_apply']) * 100:+.1f}%p |"
        )

    # 3. Paint-recheck 2vote on the desc pair (both directions), vs base pairs.
    print("\n## 2vote paint-recheck — desc pair vs base pairs\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    detail["recheck"] = {}
    for bname, base in BASES.items():
        d_stats = []
        for a, b in [tuple(args.desc_runs), tuple(reversed(args.desc_runs))]:
            s = tally(desc_cases, lambda c, ba=base, a=a, b=b: recheck(c, ba, a, [b], 1))
            d_stats.append(s)
        d_mean = mean_stats(d_stats)
        b_stats = [
            tally(base_cases, lambda c, ba=base, a=a, b=b: recheck(c, ba, a, [b], 1))
            for a, b in combinations(args.base_runs, 2)
        ]
        b_mean = mean_stats(b_stats)
        detail["recheck"][bname] = {"desc_2vote": d_mean, "base_2vote": b_mean}
        print(fmt_row(f"D3-2vote[{bname}] desc", d_mean))
        print(fmt_row(f"D3-2vote[{bname}] base", b_mean))

    # 4. Slice deltas for the two bases.
    detail["slices"] = {}
    for bname, base in BASES.items():
        print(f"\n## slices — {bname} (desc mean vs base mean)\n")
        print("| slice | base util | desc util | Δutil | base fa | desc fa |")
        print("|---|---|---|---|---|---|")
        detail["slices"][bname] = {}
        d_sl = slices_of(desc_cases)
        b_sl = slices_of(base_cases)
        for sl in d_sl:
            b = mean_stats([score_slice(b_sl[sl], base, r) for r in args.base_runs])
            d = mean_stats([score_slice(d_sl[sl], base, r) for r in args.desc_runs])
            detail["slices"][bname][sl] = {"base": b, "desc": d}
            print(
                f"| {sl} | {b['utility']:+.4f} | {d['utility']:+.4f} "
                f"| {d['utility'] - b['utility']:+.4f} | {b['false_apply']:.1%} "
                f"| {d['false_apply']:.1%} |"
            )

    # 5. Ratchet@k=2 + flip rate on the desc pair.
    print("\n## desc pair — ratchet@k=2 + nondeterminism floor\n")
    print("| candidate | utility | false-apply | miss | accuracy |")
    print("|---|---|---|---|---|")
    detail["ratchet_k2"] = {}
    for bname, base in BASES.items():
        s = ratchet_score(desc_cases, base, args.desc_runs)
        detail["ratchet_k2"][bname] = s
        print(fmt_row(f"ratchet@k=2[{bname}]", s))
    flips = sum(1 for c in desc_cases if len({c["llm"][r] for r in args.desc_runs}) > 1)
    detail["flip_rate"] = round(flips / len(desc_cases), 4)
    print(f"\nraw LLM flip rate (desc pair): {flips}/{len(desc_cases)} ({flips/len(desc_cases):.1%})")

    out_dir = AJ / "scores"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "wave3-detail.json").write_text(json.dumps(detail, indent=1) + "\n")
    print(f"\nwrote {out_dir / 'wave3-detail.json'}")


if __name__ == "__main__":
    main()

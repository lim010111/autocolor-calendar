"""arch-judgment scorer — synthesizes every wave-1 candidate from the call
tables + cosine grid and scores them under the settled utility.

Utility per case (2026-08-08 grilling, Q2): correct +1 / miss 0 / false-apply −2
(false-apply = any painted category that is not the expected answer, including
painting when the expected answer is "none").

Candidate synthesis mirrors src/services/stage1.ts `decideStage1` exactly:
one ranked row per rule (its best seed), bar T_DECLARED=0.55 (all judgment
seeds are declared-grade), margin 0.10, best<bar → LLM leg, best−second<margin
→ LLM leg, else Stage-1 assign.

Inputs (all local-only): fixtures/, results/<run>/, cosine-grid.json.
Output: aggregate tables on stdout (no titles — safe to paste into reports),
full detail JSON + disagreement-case list under scores/ (local-only).

Usage: python3 evals/arch-judgment/score.py --runs run1 [run2]
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AJ = ROOT / "evals" / "embedding-eval" / "_local" / "arch-judgment"

T_DECLARED = 0.55
MARGIN = 0.10

CONDITIONS = [
    "ko-11-full", "ko-11-min", "ko-6-min", "ko-3-full",
    "ko-3-min", "ko-2-min", "en-11-min", "en-2-min",
]
SPARSE = {"ko-6-min", "ko-3-full", "ko-3-min", "ko-2-min", "en-2-min"}


def load_cases(runs: list[str]) -> list[dict]:
    grid = json.loads((AJ / "cosine-grid.json").read_text())
    en_names: dict[str, str] = grid["en_names"]
    ko_of = {v: k for k, v in en_names.items()}  # en display -> ko
    cases = []
    for cond in CONDITIONS:
        fixture = json.loads((AJ / "fixtures" / f"{cond}.json").read_text())
        lang = "en" if cond.startswith("en-") else "ko"
        richness = "full" if cond.endswith("-full") else "min"
        results_by_run = {}
        for run in runs:
            res = json.loads((AJ / "results" / run / f"{cond}.json").read_text())
            results_by_run[run] = {c["id"]: c for c in res["cases"]}
        for fc in fixture["cases"]:
            tkey = fc["id"].rsplit("-", 1)[-1]
            gcats = grid["titles"][tkey]["cats"]
            offered_display = [c["name"] for c in fc["categories"]]
            offered_ko = [ko_of.get(n, n) if lang == "en" else n for n in offered_display]
            # Stage-1 score per offered rule (display-name keyed).
            scores = {}
            for disp, ko in zip(offered_display, offered_ko):
                g = gcats[ko]
                if lang == "en":
                    s = g["name_en"]  # min-only conditions in en
                else:
                    s = g["name_ko"] if richness == "min" else max(g["name_ko"], g["kw_max"])
                scores[disp] = s
            ranked = sorted(scores.items(), key=lambda kv: -kv[1])
            llm_by_run = {}
            for run in runs:
                got = results_by_run[run][fc["id"]]["got"]
                if got.startswith("<"):  # <bad_response> / <error:…> → prod-silent miss
                    got = "none"
                llm_by_run[run] = got
            cases.append(
                {
                    "cond": cond,
                    "lang": lang,
                    "richness": richness,
                    "n_offered": len(offered_display),
                    "id": fc["id"],
                    "tkey": tkey,
                    "expected": fc["expected"]["category_name"],
                    "ranked": ranked,  # [(display_name, score) desc]
                    "llm": llm_by_run,
                }
            )
    return cases


# --- candidate policies -----------------------------------------------------
# Each returns the painted category name or "none", given a case + one run's
# LLM answer. `stage1(case)` reproduces decideStage1.

def stage1(case: dict, bar: float = T_DECLARED, margin: float = MARGIN) -> str:
    r = case["ranked"]
    if not r:
        return "none"
    best_name, best = r[0]
    if best < bar:
        return "none"
    if len(r) > 1 and best - r[1][1] < margin:
        return "none"
    return best_name


def stage1_fell_through(case: dict) -> bool:
    return stage1(case) == "none"


def current_chain(case: dict, llm: str) -> str:
    s1 = stage1(case)
    return s1 if s1 != "none" else llm


def llm_only(case: dict, llm: str) -> str:
    return llm


def count_gate(case: dict, llm: str, n: int) -> str:
    if case["n_offered"] < n:
        return stage1(case)
    return current_chain(case, llm)


def hard_none_band(case: dict, llm: str, t_none: float) -> str:
    r = case["ranked"]
    if not r or r[0][1] < t_none:
        return "none"
    return current_chain(case, llm)


def agreement_gate(case: dict, llm: str) -> str:
    s1 = stage1(case)
    if s1 != "none":
        return s1
    if llm == "none":
        return "none"
    top1 = case["ranked"][0][0] if case["ranked"] else None
    return llm if llm == top1 else "none"


def band_plus_agreement(case: dict, llm: str, t_none: float) -> str:
    r = case["ranked"]
    if not r or r[0][1] < t_none:
        return "none"
    return agreement_gate(case, llm)


def evidence_gate(case: dict, llm: str) -> str:
    # Judgment fixtures encode evidence via condition richness: "min" = every
    # offered rule is name-only (the onboarding state). Gate: no LLM there.
    if case["richness"] == "min":
        return stage1(case)
    return current_chain(case, llm)


def seedaware_stage1(case: dict, llm: str) -> str:
    # Inverse of evidence_gate: with name-only evidence Stage-1 ASSIGNMENT is
    # the untrusted leg (compressed name-cosine space) — skip it and go
    # straight to the LLM; with full seeds run the normal chain.
    if case["richness"] == "min":
        return llm
    return current_chain(case, llm)


def chain_raised_bar(case: dict, llm: str, bar: float) -> str:
    s1 = stage1(case, bar=bar)
    return s1 if s1 != "none" else llm


def candidates() -> dict:
    c: dict = {
        "A-current-chain": current_chain,
        "C-llm-only": llm_only,
        "D2-agreement": agreement_gate,
        "E-evidence-gate": evidence_gate,
    }
    c["F-seedaware-stage1"] = seedaware_stage1
    for n in (3, 4, 7):
        c[f"B2-count-gate<{n}"] = lambda case, llm, n=n: count_gate(case, llm, n)
    # Sweep ranges calibrated to the measured best-cosine distribution:
    # name-only p5=0.53 / p50=0.62 / p95=0.83 — below 0.50 a hard-none band
    # never fires, so the informative region is 0.50–0.65.
    for t in (0.50, 0.55, 0.58, 0.60, 0.62, 0.65):
        c[f"D1-band-tnone={t:.2f}"] = lambda case, llm, t=t: hard_none_band(case, llm, t)
        c[f"D1+D2-tnone={t:.2f}"] = lambda case, llm, t=t: band_plus_agreement(case, llm, t)
    for bar in (0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85):
        c[f"B1-stage1-only-bar={bar:.2f}"] = lambda case, llm, b=bar: stage1(case, bar=b)
    for bar in (0.65, 0.75):
        c[f"A2-chain-bar={bar:.2f}"] = lambda case, llm, b=bar: chain_raised_bar(case, llm, b)
    return c


# --- scoring ----------------------------------------------------------------

def judge(painted: str, expected: str) -> tuple[int, str]:
    if painted == expected:
        return 1, "correct"
    if painted == "none":
        return 0, "miss"
    return -2, "false_apply"


def score_slice(cases: list[dict], policy, run: str) -> dict:
    n = len(cases)
    util = 0
    kinds = defaultdict(int)
    for case in cases:
        painted = policy(case, case["llm"][run])
        u, kind = judge(painted, case["expected"])
        util += u
        kinds[kind] += 1
    return {
        "n": n,
        "utility": round(util / n, 4),
        "false_apply": round(kinds["false_apply"] / n, 4),
        "miss": round(kinds["miss"] / n, 4),
        "accuracy": round(kinds["correct"] / n, 4),
    }


def ratchet_score(cases: list[dict], policy, runs: list[str]) -> dict:
    # Repeat-classification: painting is one-way in prod (§5.4 — a later
    # "none" never unpaints). Over k observations a case ends false-applied
    # if ANY run's outcome was a false-apply; it ends correct-applied only
    # if some run applied the right category and no run false-applied first…
    # order matters, but with k=2 we report the pessimistic bound: false if
    # ever false.
    n = len(cases)
    util = 0
    kinds = defaultdict(int)
    for case in cases:
        outcomes = [judge(policy(case, case["llm"][r]), case["expected"]) for r in runs]
        if any(k == "false_apply" for _, k in outcomes):
            u, kind = -2, "false_apply"
        elif any(k == "correct" and case["expected"] != "none" for _, k in outcomes):
            u, kind = 1, "correct"
        elif all(k == "correct" for _, k in outcomes):  # stable correct none
            u, kind = 1, "correct"
        else:
            u, kind = 0, "miss"
        util += u
        kinds[kind] += 1
    return {
        "n": n,
        "utility": round(util / n, 4),
        "false_apply": round(kinds["false_apply"] / n, 4),
        "miss": round(kinds["miss"] / n, 4),
        "accuracy": round(kinds["correct"] / n, 4),
    }


def fmt_row(name: str, s: dict) -> str:
    return (
        f"| {name} | {s['utility']:+.4f} | {s['false_apply']:.1%} "
        f"| {s['miss']:.1%} | {s['accuracy']:.1%} |"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", default=["run1"])
    args = ap.parse_args()
    cases = load_cases(args.runs)
    cands = candidates()

    slices = {
        "ALL": cases,
        "sparse(6/3/2)": [c for c in cases if c["cond"] in SPARSE],
        "full-list(11)": [c for c in cases if c["cond"] not in SPARSE],
        "min-seeds": [c for c in cases if c["richness"] == "min"],
        "full-seeds": [c for c in cases if c["richness"] == "full"],
        "en-names": [c for c in cases if c["lang"] == "en"],
    }

    detail: dict = {"runs": args.runs, "per_run": {}, "ratchet_k2": {}}
    for run in args.runs:
        print(f"\n## run={run} — utility (correct +1 / miss 0 / false-apply −2)\n")
        print("| candidate | utility | false-apply | miss | accuracy |")
        print("|---|---|---|---|---|")
        rows = {}
        for name, policy in cands.items():
            s = score_slice(cases, policy, run)
            rows[name] = {"ALL": s}
            print(fmt_row(name, s))
        detail["per_run"][run] = rows
        # slice tables for the headline candidates only (keep stdout readable)
        headline = [
            "A-current-chain", "C-llm-only", "D2-agreement", "E-evidence-gate",
            "F-seedaware-stage1", "A2-chain-bar=0.75",
            "D1-band-tnone=0.60", "D1+D2-tnone=0.60", "B1-stage1-only-bar=0.65",
        ]
        for sl_name, sl_cases in slices.items():
            if sl_name == "ALL":
                continue
            print(f"\n### run={run} slice={sl_name} (n={len(sl_cases)})\n")
            print("| candidate | utility | false-apply | miss | accuracy |")
            print("|---|---|---|---|---|")
            for name in headline:
                s = score_slice(sl_cases, cands[name], run)
                rows[name][sl_name] = s
                print(fmt_row(name, s))

    if len(args.runs) >= 2:
        print("\n## ratchet@k=2 — outcome after both runs, painting is one-way\n")
        print("| candidate | utility | false-apply | miss | accuracy |")
        print("|---|---|---|---|---|")
        for name, policy in cands.items():
            s = ratchet_score(cases, policy, args.runs)
            detail["ratchet_k2"][name] = s
            print(fmt_row(name, s))

        # run-to-run flip rate of the raw LLM answer (nondeterminism floor)
        flips = sum(
            1 for c in cases if len({c["llm"][r] for r in args.runs}) > 1
        )
        print(f"\nraw LLM answer flip rate across runs: {flips}/{len(cases)} ({flips/len(cases):.1%})")

    # Disagreement mining for the hard slice: cases where headline candidates
    # split between painting and none (titles stay in the local file only).
    headline_pols = [cands[n] for n in ("A-current-chain", "F-seedaware-stage1", "D2-agreement", "C-llm-only")]
    disagreements = []
    run0 = args.runs[0]
    for case in cases:
        outs = {p(case, case["llm"][run0]) for p in headline_pols}
        if len(outs) > 1:
            disagreements.append({"id": case["id"], "cond": case["cond"], "expected": case["expected"], "outcomes": sorted(outs)})
    out_dir = AJ / "scores"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "detail.json").write_text(json.dumps(detail, indent=1) + "\n")
    (out_dir / "disagreements.json").write_text(json.dumps(disagreements, ensure_ascii=False, indent=1) + "\n")
    print(f"\ndisagreement cases (hard-slice candidates): {len(disagreements)} → scores/disagreements.json")


if __name__ == "__main__":
    main()

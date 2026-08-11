"""arch-judgment fixture builder — 8 condition slices from the local ko-v1 gold set.

Data-blind by construction: every real title / category name / seed word lives in
`evals/embedding-eval/_local/` (gitignored); this script only encodes the condition
grid and the sampling procedure. Outputs land next to their inputs, local-only.

Condition grid (settled in the 2026-08-08 grilling session):
  list size 12 / 6 / 3 / 2 — sparse sizes reproduce the prod onboarding pathology;
  seeds "min" (keywords=[name] fallback, the state all 4 prod harms occurred in)
  vs "full" (declared word+phrase seeds, the settled-user state), both measured at
  sizes {12, 3}; en-name variants (names translated, membership truth unchanged)
  at sizes {12, 2}, min only.

Subset sampling: deterministic per (condition, title) via sha256-seeded Random.
For sparse conditions the query's true category is included with p=0.5, so the
expected answer becomes "none" for the excluded half — manufacturing none cases
from real data without any synthesis.

Usage (from repo root):
  python3 evals/arch-judgment/build_fixtures.py [--smoke N]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / "evals" / "embedding-eval" / "_local"
GOLD = LOCAL / "gold" / "ko-v1.json"
EN_NAMES = LOCAL / "arch-judgment" / "en-names.json"
OUT_DIR = LOCAL / "arch-judgment" / "fixtures"
# --descriptions (wave 3): same 8 conditions + a user-authored one-line intent
# note per category. Same filenames in a sibling dir; subsets are identical by
# construction (case_rng keys on size+title only), so desc vs no-desc runs are
# a pure prompt-content comparison scorable by the unchanged score.py.
DESC_KO = LOCAL / "arch-judgment" / "rule-descriptions.json"
DESC_EN = LOCAL / "arch-judgment" / "rule-descriptions.en.json"
OUT_DIR_DESC = LOCAL / "arch-judgment" / "fixtures-desc"

GLOBAL_SEED = 42
INCLUDE_TRUE_P = 0.5

# (key, size, seed richness, name language). Size 11 = the full active pool:
# held-out categories (ko-v1: 알바) are excluded — their titles are gold-labeled
# "none" under the category-absent premise, so offering the category would
# invert those cases' ground truth.
CONDITIONS: list[tuple[str, int, str, str]] = [
    ("ko-11-full", 11, "full", "ko"),
    ("ko-11-min", 11, "min", "ko"),
    ("ko-6-min", 6, "min", "ko"),
    ("ko-3-full", 3, "full", "ko"),
    ("ko-3-min", 3, "min", "ko"),
    ("ko-2-min", 2, "min", "ko"),
    ("en-11-min", 11, "min", "en"),
    ("en-2-min", 2, "min", "en"),
]


def case_rng(size: int, title: str) -> random.Random:
    # Keyed on list SIZE, not condition key: conditions sharing a size (e.g.
    # ko-3-full / ko-3-min, ko-2-min / en-2-min) draw identical subsets, so the
    # richness and name-language comparisons are not confounded by subset luck.
    h = hashlib.sha256(f"{GLOBAL_SEED}|size{size}|{title}".encode()).hexdigest()
    return random.Random(int(h[:16], 16))


def pick_subset(
    rng: random.Random, all_names: list[str], expected: str, size: int
) -> list[str]:
    if size >= len(all_names):
        return list(all_names)
    if expected != "none":
        others = [n for n in all_names if n != expected]
        if rng.random() < INCLUDE_TRUE_P:
            chosen = set(rng.sample(others, size - 1)) | {expected}
        else:
            chosen = set(rng.sample(others, size))
    else:
        chosen = set(rng.sample(all_names, size))
    # Stable gold order — keeps LLM tie-breaker (e) order-noise out of the data.
    return [n for n in all_names if n in chosen]


def build_keywords(cat: dict, richness: str, display_name: str) -> list[str]:
    if richness == "min":
        return [display_name]
    seen: list[str] = [display_name]
    for group in ("word", "phrase"):
        for kw in cat.get("declared_seeds", {}).get(group, []):
            if kw not in seen:
                seen.append(kw)
    return seen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", type=int, default=0, help="also emit first-N smoke files")
    parser.add_argument(
        "--descriptions",
        action="store_true",
        help="emit the description-variant fixtures into fixtures-desc/",
    )
    args = parser.parse_args()

    gold = json.loads(GOLD.read_text())
    en_names: dict[str, str] = json.loads(EN_NAMES.read_text())
    active = [c for c in gold["categories"] if not c.get("held_out")]
    cats = {c["name"]: c for c in active}
    all_names = [c["name"] for c in active]
    missing = [n for n in all_names if n not in en_names]
    if missing:
        raise SystemExit(f"en-names.json missing translations for: {missing}")

    desc_ko: dict[str, str] = {}
    desc_en: dict[str, str] = {}
    out_dir = OUT_DIR
    if args.descriptions:
        desc_ko = json.loads(DESC_KO.read_text())
        desc_en = json.loads(DESC_EN.read_text())
        for label, d in (("rule-descriptions", desc_ko), ("rule-descriptions.en", desc_en)):
            empty = [n for n in all_names if not d.get(n, "").strip()]
            if empty:
                raise SystemExit(f"{label}.json missing/empty for: {empty}")
        out_dir = OUT_DIR_DESC

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict = {
        "gold_version": gold["version"],
        "global_seed": GLOBAL_SEED,
        "include_true_p": INCLUDE_TRUE_P,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "conditions": {},
    }

    for cond_key, size, richness, lang in CONDITIONS:
        cases = []
        n_none = 0
        for q in gold["queries"]:
            title, expected = q["title"], q["expected"]
            rng = case_rng(size, title)
            subset = pick_subset(rng, all_names, expected, size)
            expected_out = expected if expected in subset else "none"
            if expected_out == "none":
                n_none += 1
            categories = []
            for idx, ko_name in enumerate(subset):
                display = en_names[ko_name] if lang == "en" else ko_name
                cat_entry = {
                    "name": display,
                    "keywords": build_keywords(cats[ko_name], richness, display),
                    "colorId": str((idx % 11) + 1),
                }
                if args.descriptions:
                    src = desc_en if lang == "en" else desc_ko
                    cat_entry["description"] = src[ko_name]
                categories.append(cat_entry)
            if lang == "en" and expected_out != "none":
                expected_out = en_names[expected_out]
            tag = f"arch-judgment,{cond_key}" + (",expected-none" if expected_out == "none" else "")
            cases.append(
                {
                    "id": f"aj-{cond_key}-{hashlib.sha256(title.encode()).hexdigest()[:8]}",
                    "tag": tag,
                    "categories": categories,
                    "event": {"summary": title},
                    "expected": {"category_name": expected_out},
                }
            )

        suite = {
            "schema_version": 1,
            "task": f"arch-judgment-{cond_key}",
            "lang": "ko" if lang == "ko" else "ko-title-en-names",
            "description": (
                f"arch-judgment condition {cond_key}: list size {size}, seeds={richness}, "
                f"names={lang}. Built from local ko-v1 gold (real titles, local-only)."
            ),
            # threshold 0 + empty blocking_tags: the runner must never exit(1) on
            # these files — pass-rate is not the metric here, the scorer is.
            "evaluator": {"threshold": 0, "blocking_tags": []},
            "cases": cases,
        }
        out = out_dir / f"{cond_key}.json"
        out.write_text(json.dumps(suite, ensure_ascii=False, indent=1) + "\n")
        manifest["conditions"][cond_key] = {
            "size": size,
            "seeds": richness,
            "names": lang,
            "n_cases": len(cases),
            "n_expected_none": n_none,
            "none_share": round(n_none / len(cases), 3),
        }
        if args.smoke:
            smoke = dict(suite, cases=cases[: args.smoke])
            (out_dir / f"{cond_key}.smoke.json").write_text(
                json.dumps(smoke, ensure_ascii=False, indent=1) + "\n"
            )

    manifest_name = "fixtures-desc-manifest.json" if args.descriptions else "fixtures-manifest.json"
    (out_dir.parent / manifest_name).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"
    )
    for k, v in manifest["conditions"].items():
        print(f"{k}: {v['n_cases']} cases, none={v['n_expected_none']} ({v['none_share']:.0%})")


if __name__ == "__main__":
    main()

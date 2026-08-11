"""arch-judgment wave-4 fixtures — the two unmeasured states from the 3rd-party
review (ADR-0008 trigger 3): the `keywords: []` onboarding posture that a
keywords.min(0) relaxation would create, and the keyword→description merged
single-field variant.

Conditions (all ko names, full 11-category list, same gold/expected as ko-11):
  ko-11-empty       keywords=[]  no description   (min(0) worst onboarding)
  ko-11-empty-desc  keywords=[]  description      (min(0) + desc adopted)
  ko-11-merged      keywords=[]  description + appended keyword list (merge arm)

Comparison cells already measured: ko-11-min (keywords=[name]), ko-11-full,
and their desc variants — wave-4 adds the missing columns only.

Usage: python3 evals/arch-judgment/build_fixtures_wave4.py
Output: _local/arch-judgment/fixtures-w4/ (real titles, local-only)
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from build_fixtures import DESC_KO, GOLD, LOCAL

OUT_DIR = LOCAL / "arch-judgment" / "fixtures-w4"

CONDITIONS = ("ko-11-empty", "ko-11-empty-desc", "ko-11-merged")


def full_keywords(cat: dict) -> list[str]:
    seen: list[str] = []
    for group in ("word", "phrase"):
        for kw in cat.get("declared_seeds", {}).get(group, []):
            if kw not in seen:
                seen.append(kw)
    return seen


def main() -> None:
    gold = json.loads(GOLD.read_text())
    desc_ko: dict[str, str] = json.loads(DESC_KO.read_text())
    active = [c for c in gold["categories"] if not c.get("held_out")]
    all_names = [c["name"] for c in active]
    cats = {c["name"]: c for c in active}
    missing = [n for n in all_names if not desc_ko.get(n, "").strip()]
    if missing:
        raise SystemExit(f"rule-descriptions.json missing/empty for: {missing}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict = {
        "gold_version": gold["version"],
        "built_at": datetime.now(timezone.utc).isoformat(),
        "conditions": {},
    }

    for cond_key in CONDITIONS:
        cases = []
        for q in gold["queries"]:
            title, expected = q["title"], q["expected"]
            categories = []
            for idx, ko_name in enumerate(all_names):
                entry: dict = {"name": ko_name, "keywords": [], "colorId": str((idx % 11) + 1)}
                if cond_key == "ko-11-empty-desc":
                    entry["description"] = desc_ko[ko_name]
                elif cond_key == "ko-11-merged":
                    kws = full_keywords(cats[ko_name])
                    entry["description"] = (
                        f"{desc_ko[ko_name]} 키워드: {', '.join(kws)}" if kws else desc_ko[ko_name]
                    )
                categories.append(entry)
            tag = f"arch-judgment,{cond_key}" + (",expected-none" if expected == "none" else "")
            cases.append(
                {
                    "id": f"aj-{cond_key}-{hashlib.sha256(title.encode()).hexdigest()[:8]}",
                    "tag": tag,
                    "categories": categories,
                    "event": {"summary": title},
                    "expected": {"category_name": expected},
                }
            )
        suite = {
            "schema_version": 1,
            "task": f"arch-judgment-{cond_key}",
            "lang": "ko",
            "description": (
                f"arch-judgment wave-4 condition {cond_key}: 11 categories, keywords=[], "
                "built from local ko-v1 gold (real titles, local-only)."
            ),
            "evaluator": {"threshold": 0, "blocking_tags": []},
            "cases": cases,
        }
        out = OUT_DIR / f"{cond_key}.json"
        out.write_text(json.dumps(suite, ensure_ascii=False, indent=1) + "\n")
        manifest["conditions"][cond_key] = {"n_cases": len(cases)}
        print(f"{cond_key}: {len(cases)} cases -> {out}")

    (OUT_DIR / "fixtures-w4-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"
    )


if __name__ == "__main__":
    main()

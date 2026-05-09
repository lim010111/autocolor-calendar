"""Stage 7 — schema + cross-language sanity checks for the built datasets.

Hard checks (exit 1 on failure):
- All four lang files exist with the same schema_version.
- ``cases[].id`` set is identical across all langs (1:1 cross-lang mapping).
- Each case's ``expected.category_name`` is one of that file's ``categories``.

Soft checks (warnings only):
- Translated summary length distribution within 0.3×–3× of English.
- Per-lang summary uniqueness ratio (translation collapse — recorded so the
  reader knows that some paraphrase pairs land on the same target string).
"""

from __future__ import annotations

import json
import statistics

from .config import ALL_LANGUAGES, dataset_path

_HARD_FAIL_PREFIX = "FAIL"
_WARN_PREFIX = "WARN"


def _load_all() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for lang in ALL_LANGUAGES:
        path = dataset_path(lang)
        if not path.exists():
            print(f"{_HARD_FAIL_PREFIX}: missing dataset for lang={lang} ({path})")
            return {}
        out[lang] = json.loads(path.read_text(encoding="utf-8"))
    return out


def run() -> int:
    docs = _load_all()
    if not docs:
        return 1

    failures: list[str] = []
    warnings: list[str] = []

    schema_versions = {lang: d["schema_version"] for lang, d in docs.items()}
    if len(set(schema_versions.values())) != 1:
        failures.append(f"schema_version mismatch: {schema_versions}")

    id_sets = {lang: {c["id"] for c in d["cases"]} for lang, d in docs.items()}
    en_ids = id_sets["en"]
    for lang, ids in id_sets.items():
        if ids != en_ids:
            missing = en_ids - ids
            extra = ids - en_ids
            failures.append(
                f"{lang}: case id set differs from en — missing={list(missing)[:3]}, extra={list(extra)[:3]}"
            )

    for lang, d in docs.items():
        # Every dataset uses categories[] shared on every case (build_en_dataset
        # / translate.apply both keep this invariant).
        category_names = {c["name"] for c in d["cases"][0]["categories"]}
        for case in d["cases"]:
            expected = case["expected"]["category_name"]
            if expected != "none" and expected not in category_names:
                failures.append(
                    f"{lang}: case {case['id']} expected={expected!r} not in categories={sorted(category_names)}"
                )
                break

    en_summary_lens = [len(c["event"]["summary"]) for c in docs["en"]["cases"]]
    en_mean = statistics.mean(en_summary_lens)
    for lang in ALL_LANGUAGES[1:]:
        lens = [len(c["event"]["summary"]) for c in docs[lang]["cases"]]
        ratio = statistics.mean(lens) / en_mean if en_mean else 0.0
        if not 0.3 <= ratio <= 3.0:
            warnings.append(f"{lang}: mean summary length ratio {ratio:.2f}× outside [0.3, 3.0]")

    uniq_summary: dict[str, tuple[int, int]] = {}
    for lang, d in docs.items():
        sums = [c["event"]["summary"] for c in d["cases"]]
        uniq_summary[lang] = (len(set(sums)), len(sums))

    print("Datasets validated:")
    for lang, d in docs.items():
        u, t = uniq_summary[lang]
        print(
            f"  {lang}: cases={t}  unique_summary={u}/{t} ({u/t:.0%})  "
            f"categories={len(d['cases'][0]['categories'])}"
        )

    if warnings:
        for w in warnings:
            print(f"{_WARN_PREFIX}: {w}")
    if failures:
        for f in failures:
            print(f"{_HARD_FAIL_PREFIX}: {f}")
        return 1
    print("OK — all hard checks passed.")
    return 0

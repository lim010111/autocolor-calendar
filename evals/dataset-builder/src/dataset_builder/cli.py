"""CLI entrypoint for the dataset-builder pipeline.

Usage:
    uv run build-dataset fetch
    uv run build-dataset embed [--force]
    uv run build-dataset cluster [--force]
    uv run build-dataset label [--force]
    uv run build-dataset build-en [--force]
    uv run build-dataset translate [ko zh-CN zh-TW] [--force]
    uv run build-dataset validate
    uv run build-dataset all
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from .config import TARGET_LANGUAGES


def _add_force(p: argparse.ArgumentParser) -> None:
    p.add_argument("--force", action="store_true", help="Re-run even if outputs exist.")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="build-dataset")
    sub = parser.add_subparsers(dest="step", required=True)

    _add_force(sub.add_parser("fetch", help="Pull HF dataset → source-titles.jsonl"))
    _add_force(sub.add_parser("embed", help="Embed titles via OpenAI Batch"))
    _add_force(sub.add_parser("cluster", help="KMeans + silhouette sweep"))
    _add_force(sub.add_parser("label", help="gpt-5.5 → name + keywords per cluster"))
    _add_force(sub.add_parser("augment", help="gpt-5.5 → 2–3 paraphrases per base title"))
    _add_force(sub.add_parser("build-en", help="Build evals/datasets/en/classification.json"))

    p_translate = sub.add_parser("translate", help="Translate en → other langs")
    p_translate.add_argument(
        "langs",
        nargs="*",
        default=list(TARGET_LANGUAGES),
        help=f"Target language codes (default: {' '.join(TARGET_LANGUAGES)})",
    )
    _add_force(p_translate)

    sub.add_parser("validate", help="Schema + cross-lang sanity checks")
    sub.add_parser("all", help="Run every step in order (skips already-built outputs)")

    args = parser.parse_args(argv)

    # Imports are lazy so that `--help` and unrelated steps don't pull in heavy
    # ML deps (datasets, sklearn) until needed.
    if args.step == "fetch":
        from . import fetch_hf

        fetch_hf.run(force=args.force)
    elif args.step == "embed":
        from . import embed

        embed.run(force=args.force)
    elif args.step == "cluster":
        from . import cluster

        cluster.run(force=args.force)
    elif args.step == "label":
        from . import label_clusters

        label_clusters.run(force=args.force)
    elif args.step == "augment":
        from . import augment

        augment.run(force=args.force)
    elif args.step == "build-en":
        from . import build_en_dataset

        build_en_dataset.run(force=args.force)
    elif args.step == "translate":
        from . import translate

        translate.run(args.langs, force=args.force)
    elif args.step == "validate":
        from . import validate

        return validate.run()
    elif args.step == "all":
        from . import (
            augment,
            build_en_dataset,
            cluster,
            embed,
            fetch_hf,
            label_clusters,
            translate,
            validate,
        )

        fetch_hf.run(force=False)
        embed.run(force=False)
        cluster.run(force=False)
        label_clusters.run(force=False)
        augment.run(force=False)
        build_en_dataset.run(force=False)
        translate.run(list(TARGET_LANGUAGES), force=False)
        return validate.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())

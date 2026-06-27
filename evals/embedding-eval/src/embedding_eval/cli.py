"""CLI entrypoint: validate-gold · manifest · sweep · parity.

The data-blind harness; the operator runs these locally against the real ko gold
set. Output is aggregates only — no command echoes a raw title or seed.
"""

from __future__ import annotations

import argparse
import json
import sys

from . import config, ledger
from .backends import CANDIDATES, FakeBackend, LocalBackend, WorkersAiBackend
from .dataset import load_gold_set, synthetic_id_map
from .manifest import build_manifest, corpus_digest
from .metrics import select_winner, threshold_grid
from .sweep import enumerate_configs, run_sweep
from .wai_parity import run_parity


def _load(version: str):
    path = config.gold_path(version)
    if not path.exists():
        sys.exit(f"gold set not found: {path}\n  drop the operator-built <version>.json there first.")
    return load_gold_set(path)


def cmd_validate_gold(args) -> None:
    gold = _load(args.version)
    id_map = synthetic_id_map(gold)
    print(f"[validate-gold] {gold.version} OK")
    print(f"  rule categories : {len(gold.rule_categories)}  → {sorted(id_map.values())}")
    print(f"  held-out (none) : {len(gold.held_out_categories)}")
    print(f"  queries         : {len(gold.queries)}")
    print("  (category names + titles withheld — local PII)")


def cmd_manifest(args) -> None:
    gold = _load(args.version)
    manifest = build_manifest(gold)
    config.MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[manifest] wrote {config.MANIFEST_PATH.relative_to(config.REPO_ROOT)}")
    print(f"  manifest_sha256 : {manifest['manifest_sha256']}")
    print(f"  blind labels    : {[c['name'] for c in manifest['categories']]}")
    print("  → review, then commit. (counts + single digest only; 0 raw titles)")


def _backend_factory(kind: str):
    if kind == "fake":
        return lambda model: FakeBackend(dim=CANDIDATES[model]["dim"])
    if kind == "local":
        return lambda model: LocalBackend(model)
    sys.exit(f"unknown --backend {kind} (use: fake | local)")


def _verify_manifest(gold) -> str:
    """Recompute the corpus digest and cross-check the committed manifest (finding-2).

    Runs are pinned to ``manifest_sha256`` (AC #2/#10). If a committed
    ``manifest.json`` exists, its digest MUST match the gold set being swept —
    otherwise the run would be pinned to a digest that was never reviewed/committed
    (the committed manifest is the only reviewable evidence; raw gold is local-only).
    Drift → hard stop; no committed manifest yet → warn but allow exploratory sweeps.
    """
    digest = corpus_digest(gold)
    if config.MANIFEST_PATH.exists():
        committed = json.loads(config.MANIFEST_PATH.read_text(encoding="utf-8")).get("manifest_sha256")
        if committed != digest:
            sys.exit(
                "gold-set drift: committed manifest.json digest != current gold set.\n"
                f"  committed={committed}\n  current  ={digest}\n"
                "  re-run `embedding-eval manifest` and commit, or check the gold-set version."
            )
    else:
        print("  warning: no committed manifest.json pins this run — run `manifest` first.")
    return digest


def cmd_sweep(args) -> None:
    gold = _load(args.version)
    digest = _verify_manifest(gold)
    models = args.models or list(CANDIDATES)
    configs = enumerate_configs(
        models,
        keyword_form_arms=tuple(args.keyword_form_arms),
        include_examples_values=(True, False) if args.cold_start else (True,),
    )
    grid = threshold_grid(
        config.DEFAULT_T_VERIFIED_GRID, config.DEFAULT_T_DECLARED_GRID, config.DEFAULT_MARGIN_GRID
    )
    records = run_sweep(
        gold,
        configs,
        grid,
        backend_factory=_backend_factory(args.backend),
        manifest_sha256=digest,
    )
    winner, feasible = select_winner(
        records,
        precision_floor=args.precision_floor,
        none_ceiling=args.none_ceiling,
    )
    if winner is not None:
        winner["selected"] = True

    ledger.append_runs(records)
    sent = ledger.log_to_wandb(
        records, project=config.load_secret("WANDB_PROJECT") or "autocolor-embedding-eval",
        run_name=f"{gold.version}-sweep",
    ) if args.wandb else False

    print(f"[sweep] {len(records)} records → {config.RUNS_JSONL.relative_to(config.REPO_ROOT)}")
    print(f"  configs={len(configs)} thresholds={len(grid)} backend={args.backend} wandb={'sent' if sent else 'off'}")
    print(f"  feasible (precision≥{args.precision_floor}, none-FP≤{args.none_ceiling}): {len(feasible)}")
    if winner:
        m = winner["metrics"]
        print(
            f"  winner: model={winner['model']} dim={winner['dim']} arm={winner['prompt_arm']}/"
            f"{winner['keyword_form_arm']} T=({winner['thresholds']['T_verified']},"
            f"{winner['thresholds']['T_declared']},{winner['thresholds']['margin']}) "
            f"coverage={m['coverage']} verified_precision={m['verified_precision']} "
            f"none_false_apply={m['none_false_apply']}"
        )
    else:
        print("  winner: NONE met the objective constraints — widen the grid or relax floors.")


def cmd_parity(args) -> None:
    acct = config.load_secret("CF_ACCOUNT_ID")
    token = config.load_secret("CF_API_TOKEN")
    if not acct or not token:
        sys.exit("CF_ACCOUNT_ID / CF_API_TOKEN missing in .dev.vars (Workers AI REST).")
    result = run_parity(
        args.model,
        local=LocalBackend(args.model),
        workers_ai=WorkersAiBackend(args.model, account_id=acct, api_token=token),
        prefix=config.PROMPT_ARMS[args.model].get(args.prompt_arm, ""),
    )
    ledger.append_runs([result])
    print(f"[parity] {args.model}: mean_cosine={result['mean_cosine']} "
          f"min={result['min_cosine']} provisional={result['provisional']} (n={result['n_probes']})")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="embedding-eval", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("validate-gold", help="schema-check the local gold set (counts only)")
    v.add_argument("--version", default="ko-v1")
    v.set_defaults(func=cmd_validate_gold)

    m = sub.add_parser("manifest", help="write committable manifest.json (counts + digest)")
    m.add_argument("--version", default="ko-v1")
    m.set_defaults(func=cmd_manifest)

    s = sub.add_parser("sweep", help="run the model/prompt/keyword × threshold sweep")
    s.add_argument("--version", default="ko-v1")
    s.add_argument(
        "--backend",
        required=True,
        choices=("fake", "local"),
        help="local = 3080 real measurement; fake = no-GPU smoke only (records are "
        "backend-tagged but still append to the canonical ledger). Required — no "
        "default, so a real sweep can never silently run on fake embeddings.",
    )
    s.add_argument("--models", nargs="*", default=None, help="subset of CANDIDATES (default: all)")
    s.add_argument("--keyword-form-arms", nargs="*", default=list(config.KEYWORD_FORM_ARMS),
                   dest="keyword_form_arms")
    s.add_argument("--cold-start", action="store_true",
                   help="also run include_examples=False configs (keyword-form cold-start arm)")
    s.add_argument("--precision-floor", type=float, default=config.DEFAULT_VERIFIED_PRECISION_FLOOR)
    s.add_argument("--none-ceiling", type=float, default=config.DEFAULT_NONE_FALSE_APPLY_CEILING)
    s.add_argument("--wandb", action="store_true", help="also send aggregates-only payloads to wandb")
    s.set_defaults(func=cmd_sweep)

    pa = sub.add_parser("parity", help="3080 ↔ Workers AI cosine parity on non-PII probes")
    pa.add_argument("--model", required=True, choices=list(CANDIDATES))
    pa.add_argument("--prompt-arm", default="none", dest="prompt_arm")
    pa.set_defaults(func=cmd_parity)
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()

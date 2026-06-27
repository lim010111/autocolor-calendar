# embedding-eval

Data-blind eval harness for **embedding-classifier #01** — selects the embedding
model + vector dimension for the ADR-0004 Stage-1 kNN classifier and sweeps the
2-grade trust thresholds, on the operator's **real ko gold set** (synthetic 0 rows).

Spec `01-embedding-model-selection-eval.md` + design `01-dataset-design.md`, both
under `.scratch/embedding-classifier/` (`issues/` for the spec).

**운영자 HITL 런북 (한국어):** [OPERATOR-GUIDE.md](OPERATOR-GUIDE.md) — 골드셋 구축 →
매니페스트 → 3080 sweep/parity → 결정+ADR 까지, 당신이 해야 하는 단계만.

## HITL seam — who runs what

| Agent-scaffolded (this package, committed) | Operator-only (local 3080, PII) |
|---|---|
| sweep runner · metrics · ledger + wandb gate · WAI-parity probe · manifest builder · report template · tests | build the gold set · label · run the local sweep · review + commit the aggregates |

The package ships **no raw calendar data**. The gold set, run ledger, name↔ID map,
and forensics all live under `_local/` (git-ignored) — only aggregates are emitted.

## Layout

```
src/embedding_eval/
  config.py      candidates · prompt-arm prefixes · keyword-form arms · threshold grid · paths · secrets
  dataset.py     gold-set schema/loader/validator · category-name → cat_N map (local-only) · seed-pool builder
  backends.py    EmbeddingBackend: LocalBackend (3080, lazy torch) · WorkersAiBackend (REST) · FakeBackend (tests)
  metrics.py     grade-aware kNN decision · coverage/precision/none-FP/macro-F1 · precision-first selector
  ledger.py      runs.jsonl (canonical SoT) + wandb send-gate (deny-by-default allowlist)
  sweep.py       per-model config grid → embed once → threshold sweep → run records
  manifest.py    committable manifest.json: counts + single corpus digest (0 titles)
  wai_parity.py  3080 ↔ Workers AI cosine parity on non-PII probes
  cli.py         validate-gold · manifest · sweep · parity
parity_probes.txt  committed non-PII probe strings
REPORT.md.tmpl     output report skeleton (→ #01 follow-up measurement ADR)
tests/             metrics · gate · sweep-smoke (FakeBackend + synthetic fixture)
```

## Setup

```bash
cd evals/embedding-eval
uv sync                      # core (numpy, dotenv) — harness mechanics + tests
uv sync --extra local        # + torch + sentence-transformers (3080 embedding)
uv sync --extra remote       # + requests (Workers AI parity)
uv sync --extra wandb        # + wandb (aggregates-only sink)
```

`WANDB_*` / `CF_ACCOUNT_ID` / `CF_API_TOKEN` are read from the repo-level `.dev.vars`
(dotenv) — never injected into the Worker or CI (ADR-0001 `LANGFUSE_*` pattern).

## Gold-set contract

Operator drops `_local/gold/<version>.json` (e.g. `ko-v1.json`). Schema — form-split
declared seeds so all three keyword-form arms run from one file / one manifest digest:

```json
{
  "version": "ko-v1",
  "categories": [
    { "name": "<blind label>",
      "declared_seeds": { "word": ["..."], "phrase": ["..."] },
      "example_seeds": ["..."],
      "held_out": false }
  ],
  "queries": [ { "title": "<raw title>", "expected": "<category name>|none" } ]
}
```

- `name` — PII-free common noun (no person/org/client). Local-only; mapped to `cat_N`.
- `declared_seeds.word` / `.phrase` — blind-authored (no peeking at titles).
- `example_seeds` — Verified past titles. `held_out: true` → not a Rule; its queries
  are labelled `none` (false-apply guard).

## Run order (operator)

```bash
uv run embedding-eval validate-gold --version ko-v1      # schema-check (counts only)
uv run embedding-eval manifest      --version ko-v1      # → manifest.json (review + commit)
uv run embedding-eval sweep --version ko-v1 --backend local --cold-start --wandb
uv run embedding-eval parity --model @cf/google/embeddinggemma-300m
pytest                                                   # harness mechanics (no GPU/PII)
```

`sweep` appends to the local `runs.jsonl` ledger under `_local/` (canonical) and
prints the precision-first winner. Lift the aggregates into `REPORT.md.tmpl` →
externalize as the #01 follow-up measurement ADR (0002 form). `--backend fake` runs
the full mechanics with no GPU.

## PII contract (non-negotiable)

- **git**: code + `manifest.json` (counts + single digest + blind labels) + report.
  **No raw titles, no per-title hashes** (a 7-char ko title's unsalted hash is
  reversible — merge-gate finding-0).
- **wandb**: config · scalar metrics · thresholds · synthetic `cat_N` confusion only.
  Category names / seeds / titles / keywords / raw prefix are **rejected** by
  `ledger.assert_wandb_safe` before any network call (finding-1).
- **`_local/`**: everything PII — gold set, `runs.jsonl`, name↔ID map, forensics.

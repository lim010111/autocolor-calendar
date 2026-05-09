# dataset-builder

Builds the per-language classification eval datasets that live under
`evals/datasets/{en,ko,zh-CN,zh-TW}/classification.json`. Operator-only — the
build calls OpenAI APIs and is **not** wired into CI.

## Pipeline

| Step | Command | Output |
|------|---------|--------|
| 1 | `uv run build-dataset fetch`     | `evals/datasets/_meta/{source.json,source-titles.jsonl}` |
| 2 | `uv run build-dataset embed`     | `evals/dataset-builder/data/embeddings.npz` |
| 3 | `uv run build-dataset cluster`   | `evals/datasets/_meta/clusters-draft.json` |
| 4 | `uv run build-dataset label`     | `evals/datasets/_meta/clusters.json` |
| 5 | `uv run build-dataset augment`   | `evals/datasets/_meta/augmented-cases.jsonl` |
| 6 | `uv run build-dataset build-en`  | `evals/datasets/en/classification.json` |
| 7 | `uv run build-dataset translate` | `evals/datasets/{ko,zh-CN,zh-TW}/classification.json` |
| 8 | `uv run build-dataset validate`  | exit code 0/1 |

`uv run build-dataset all` runs the chain. Every step is idempotent — pass
`--force` to rebuild a single artefact.

## Setup

```bash
cd evals/dataset-builder
uv sync                                  # installs pinned deps into .venv
# OPENAI_API_KEY is read from the repo-level .dev.vars (same file the
# TS eval runner uses); no new secret needed.
```

Python 3.12 is pinned via `.python-version`.

## Models / knobs

- Embedding: `text-embedding-3-small` (sync; only ~50 unique inputs)
- Cluster labels: `gpt-5.5`, `reasoning_effort=low`, structured JSON
- Paraphrase / translation: `gpt-5.5` (translation runs on Batch API for the
  ~870-request fan-out)
- KMeans: k ∈ {7,8,9,10}, seed 42, k chosen by silhouette
- Color IDs: cluster index + 1 (no semantic meaning, just a valid `"1".."11"`)

## What ends up in a dataset file

Backwards-compatible with `evals/tasks/classification-semantic.json`
(`schema_version: 1`) plus root-level metadata:

```json
{
  "schema_version": 1,
  "task": "classification-multilingual",
  "lang": "en",
  "source": { "dataset": "...", "revision": "<sha>", "license": "Apache-2.0", ... },
  "generator": { "embedding_model": "...", "label_model": "gpt-5.5", "k": 10, "seed": 42, ... },
  "evaluator": { "threshold": 0.7, "blocking_tags": [] },
  "cases": [ { "id": "...", "tag": "base|paraphrase,c<idx>[,boundary]",
               "categories": [...], "event": { "summary": "..." },
               "expected": { "category_name": "..." } } ]
}
```

`cases[].id` is identical across the 4 lang siblings — pair them up by id
for cross-lingual analysis.

## Known limitations

1. **Source vocabulary is small.** `anakin87/events-scheduling` is a synthetic
   scheduling-puzzle dataset built from ~50 base titles. The augment stage
   asks gpt-5.5 for ~3 paraphrases per base, yielding ~192 English cases —
   smaller than the 300–500 originally targeted. Per-category accuracy
   confidence intervals are correspondingly wider.
2. **Translation collapse.** Several English paraphrases land on the same
   target string in ko / zh-CN / zh-TW (~22–25%). The case ids are still
   1:1 across languages, so the translated case effectively counts the
   identical translation N times. This biases the translated stats toward
   the most "natural" target phrasing.
3. **`summary`-only events.** The HF source has no description / location.
   Real Calendar events often do, and the production classifier reads all
   three. Treat these datasets as a lower bound on prompt quality.
4. **No hard negatives.** The schema supports `expected="none"`, but the
   50-base source can't safely synthesise titles that fall outside all 10
   clusters. We mark the lowest-silhouette ~5% with `tag=boundary` instead.

## License / attribution

Source dataset: [`anakin87/events-scheduling`](https://huggingface.co/datasets/anakin87/events-scheduling)
under Apache-2.0. The exact revision is pinned in
`evals/datasets/_meta/source.json` for reproducibility. Generated artefacts
(translations, paraphrases) are derived data and inherit the upstream
license; we use them for evaluation only and do not redistribute the raw
source.

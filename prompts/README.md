# Prompts — versioned source of truth

This directory is the **versioned source-of-truth** for every LLM prompt the project ships.
TypeScript (Cloudflare Worker) reads them through a code-generated bundle
(`src/services/prompts/_generated.ts`); Python (eval dataset builder) reads
them directly via `evals/dataset-builder/src/dataset_builder/prompts.py`.

## Layout

```
prompts/
├── classifier/
│   ├── system.v2.md            # 2026-05-10 baseline (gpt-5.4-nano)
│   └── system.v3.md            # 2026-05-11 gpt-5-nano-targeted rewrite
└── dataset-builder/
    ├── label-clusters.system.v1.md
    ├── augment.system.v1.md
    └── translate.system.v1.md
```

## Frontmatter

Every `.md` here starts with a YAML frontmatter block. The loader strips it
before returning the body, so the model never sees the frontmatter — it is
metadata for humans and tooling.

```markdown
---
id: classifier/system
version: v3
model_target: gpt-5-nano
created: 2026-05-11
supersedes: v2
eval_baseline: evals/report-2026-05-11-gpt-5-nano-migration.md
guide_source: https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5
notes: short rationale, fits on one line
---

# Task
...
```

| field            | purpose                                                                  |
|------------------|--------------------------------------------------------------------------|
| `id`             | logical name (`classifier/system`, `dataset-builder/augment`, …)         |
| `version`        | `vN` — bump for any semantic change                                      |
| `model_target`   | the model this prompt is tuned for                                       |
| `created`        | ISO date when the file was authored                                      |
| `supersedes`     | previous `vN` (or omitted for v1)                                        |
| `eval_baseline`  | report that measured this version (optional but recommended)             |
| `guide_source`   | URL of the provider's prompt-design guide that informed the rewrite      |
| `notes`          | one-line rationale                                                       |

## Adding a new version

1. Copy the latest file under a new `vN` suffix (one greater than the current latest — `v3` → `v4`, etc.); `prompts/classifier/system.v3.md` is the current head.
2. Update the frontmatter (`version`, `created`, `supersedes`, `notes`).
3. Rewrite the body.
4. Regenerate the TypeScript bundle: `pnpm tsx scripts/embed-prompts.ts`.
5. Register the new version in `src/services/prompts/classifierPrompts.ts`
   (`ClassifierPromptVersion`, `REGISTRY`). The Python loader picks up new
   builder versions automatically by filename — no registration step.
6. Run the eval-gate procedure from `src/CLAUDE.md` §5.3 "Decision rule edits
   are eval-gated".
7. **Never delete prior versions** — older `vN` files are the rollback path.
   `--prompt-version v2` on the runner reproduces a prior baseline without a
   git checkout.

## Loaders

- **TypeScript** — `src/services/prompts/classifierPrompts.ts` exposes
  `loadClassifierPrompt(version)` against a registry hydrated from
  `_generated.ts`. Run `pnpm tsx scripts/embed-prompts.ts` after editing any
  `prompts/classifier/*.md`; CI checks `_generated.ts` is in sync with the
  `.md` sources.
- **Python** — `evals/dataset-builder/src/dataset_builder/prompts.py` exposes
  `load_prompt(name, version="v1")`. Reads `.md` directly via
  `pathlib.Path.read_text` against `REPO_ROOT / "prompts" / "dataset-builder"`.

Both strip the YAML frontmatter before returning the body.

## Why a separate directory (not inline)

Inline template literals make it hard to (a) keep old versions around,
(b) compare prompts across PRs without git plumbing, and (c) share a prompt
between TypeScript and Python tooling. The `.md` source + loader pair fixes
all three at the cost of a one-shot codegen step on the TypeScript side
(Cloudflare Workers has no `fs` so the prompt has to ship inside the bundle).

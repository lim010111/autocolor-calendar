# Handoff — Langfuse eval-only instrumentation (2026-05-11)

## How to use this handoff

You are picking up after a `/grill-with-docs` planning session. Read this entire file, then start with §10. Decisions in §4 are settled — do not re-litigate them. The authoritative artefact is `docs/adr/0001-langfuse-eval-only.md` — every Decision in §4 is a restatement of that ADR, not a competing source. If something in this handoff disagrees with the ADR, the ADR wins; if the ADR disagrees with `src/CLAUDE.md`, `src/CLAUDE.md` wins (per `docs/adr/README.md` drift policy).

## Goal

Wire Langfuse Cloud (Hobby tier, EU project — region chosen in the Langfuse console) into the operator-side classification eval runner so that every case in a `pnpm tsx evals/scripts/run-classification-eval.ts` invocation lands as one Langfuse trace linked to a dataset item. This unlocks click-to-inspect prompt/response/latency forensics for the failing cases that today only surface as a `FAIL` line on stdout — the bottleneck for prompt iteration once the multilingual dataset grew to 192 × 4 cases. The integration is a soft addition: `evals/agent-results.json` and the merge-gate exit code remain canonical, Langfuse is augmentation.

## Scope

In scope:
- `evals/scripts/run-classification-eval.ts` — trace each case run against OpenAI as one Langfuse trace, link to a dataset item, score it 1/0, optionally print the run URL to stdout.
- New `evals/scripts/sync-langfuse-dataset.ts` — operator script that uploads / upserts the 4 per-language `evals/datasets/{lang}/classification.json` files into 4 Langfuse datasets (`autocolor-classification-{en,ko,zh-CN,zh-TW}`), idempotent by `case.id`.
- `.dev.vars.example` — already updated; just verify the implementation reads exactly the three keys present.
- Light dependency add: `@langfuse/client` + `@langfuse/tracing` (both fetch-only Universal JS). No `@langfuse/otel`.

Out of scope / non-goals:
- **Runtime/Worker integration.** The Worker path (`src/services/llmClassifier.ts`, preview route, `llm_calls` table writers) does NOT call Langfuse. The `src/CLAUDE.md` §6.3 trade-off note remains in force for the runtime surface; trying to instrument it is a separate ADR.
- **dataset-builder Python pipeline** (`evals/dataset-builder/`). Augment / translate / label LLM calls there are one-shot generation, not PASS/FAIL, and are explicitly de-scoped — adding Python SDK is a separate decision.
- **LLM-as-judge / graded scoring.** Today's pass criterion stays strict equality on `category_name`. The numeric Langfuse score is `1 | 0`, not a model-judged grade.
- **Replacing the file-based prompt registry.** `prompts/classifier/system.v{N}.md` + `pnpm verify-prompts` stays canonical. Langfuse Prompt Management is NOT used.
- **CI wiring.** `.github/workflows/ci.yml` is untouched. The eval is a manual operator gate, same as today. No GitHub Actions secrets required.
- **`scripts/sync-secrets.ts` REQUIRED_SECRETS update.** The three `LANGFUSE_*` keys are deliberately NOT injected into the Worker (mirror of `DIRECT_DATABASE_URL`).
- **Rule-leg traces.** `--include-rule-leg` adds deterministic rule-hit/pass counts; those do not produce LLM calls and do not get a Langfuse trace. Only the LLM leg traces.

## Decisions

### Motivation: failing-case forensics, not aggregate metrics

**Decision:** Langfuse is adopted solely to give operators a clickable per-case prompt/response/latency view. The aggregate `score / max / pass_rate` line in `agent-results.json` already covers regression detection.

**Why:** With the multilingual dataset at 192 × 4 cases, identifying *which* cases failed and *why* via stdout + grep + manual re-runs against `raw_response` became the iteration bottleneck. A trace UI shortens the failure-investigation loop.

**Alternatives considered:** Run-to-run prompt-version diff, LLM-as-judge, Langfuse Prompt Management. All rejected — first two are downstream of forensics and not blocked today; the third would regress the file-based + git-controlled prompt versioning that already has CI guards (`pnpm verify-prompts`).

### Scope: classification eval runner only

**Decision:** Instrument exclusively `evals/scripts/run-classification-eval.ts` (both Layer 3 regression suite and Layer 4 multilingual dataset). dataset-builder, runtime classifier, preview route — none of them call Langfuse.

**Why:** The chosen motivation maps 1:1 to the eval runner. dataset-builder's LLM calls are one-shot generation and Python; runtime cannot host Langfuse SDK without contradicting `src/CLAUDE.md` §6.3's Workers-incompatibility note.

**Alternatives considered:** Add dataset-builder (rejected: Python SDK cost ≫ value, prompt iteration on the build pipeline is rare). Layer 4 only (rejected: forces split SDK wiring across two code paths). Defer until LLM-judge lands (rejected: judge has no concrete plan).

### Hosting: Langfuse Cloud Hobby

**Decision:** Langfuse Cloud, Hobby (free) tier. EU project. Self-host explicitly rejected.

**Why:** Hobby = 50k units/month, 30d retention, 2 users — current load (~768 cases × monthly few runs × 2 units/case ≈ 15k units/month) fits with 3× headroom. Eval data is synthetic (HuggingFace + paraphrase) and has no PII, so SaaS residency is acceptable. Self-host v3 requires Postgres + Clickhouse + Redis + S3 — operational overkill for one operator.

**Alternatives considered:** Self-host (rejected: 4-service dependency for trivial scale). US region (acceptable but EU was preferred for clearer downstream compliance posture if features ramp). Cloud → self-host migration plan (deferred: migration is the budget-breach trigger, not the launch shape).

### Failure isolation: soft dep

**Decision:** Langfuse calls are non-blocking. If `LANGFUSE_*` env is unset OR if any SDK call fails (init, span create, score, flush), the eval still produces stdout `PASS`/`FAIL` per case and appends one row to `evals/agent-results.json`. The merge-gate exit code (blocking-tag fail OR pass-rate < threshold) is determined exclusively from in-memory case results — never from Langfuse state.

**Why:** Mirrors the existing §6 Wave A/B observability discipline pinned in `src/CLAUDE.md`: "observability writes must NEVER cause [the work] to retry." Network blips at langfuse.com or expired keys must not block prompt-edit PRs from being verifiable.

**Alternatives considered:** Strict dep (rejected: contradicts existing pattern, breaks CI/PR loop during third-party outages). Hybrid "if key present then strict" (rejected: same downside on outages without offsetting benefit).

### Dataset sync: dedicated operator script

**Decision:** A new `evals/scripts/sync-langfuse-dataset.ts` script uploads local dataset JSON into Langfuse. Dataset name = `autocolor-classification-{lang}`. Item ID = `case.id` (1:1 across languages because the existing `case.id` mapping is the cross-lingual anchor). Run manually after every `dataset-builder` rebuild. Idempotent: re-running with unchanged source = no-op. The eval runner reads from Langfuse and never writes dataset items.

**Why:** dataset rebuilds are rare (per evals/README.md "once per source revision, idempotent per stage"). Auto-upserting 768 items on every eval run wastes Langfuse units and conflates two different lifecycles (data shape vs. evaluation invocation).

**Alternatives considered:** Auto-upsert on every eval (rejected: budget waste, lifecycle coupling). Web UI manual upload (rejected: not reproducible). No dataset uploads, traces only (rejected: kills the cross-run dataset-diff UI that motivates the whole feature).

**Drift handling:** If `case.id` differs between local JSON and the existing Langfuse dataset, the sync script must refuse to silently mutate. Either (a) bail with a diff report demanding explicit `--allow-id-drift`, or (b) require the operator to bump the dataset name (e.g. `autocolor-classification-en-v2`). Pick one in the implementation PR — the ADR records the constraint, not the mechanism.

### Trace payload: full debug, prompt by reference

**Decision:** Each case = one Langfuse trace with one span. Shape:
- `input` = post-`redactEventForLlm` user-message JSON object (the same JSON `buildPrompt` produces as the user message) + the `categories[]` array the model saw.
- `output` = `{ parsed: <category_name | null>, raw_response: <OpenAI body as text> }`.
- `expected` = `case.expected.category_name` (on the linked dataset item).
- `metadata` = `{ prompt_version, prompt_sha256_prefix, model, reasoning_effort, max_completion_tokens, lang, case_id, case_tag, attempts, latency_ms, http_status, outcome }`.
- `score` = `{ name: "pass", value: 1 | 0 }` posted via `langfuse.score.trace`.
- The system prompt body is NOT embedded — only `prompt_version` + the first 16 hex chars of its sha256 land in metadata. The git-tracked `prompts/classifier/system.v{N}.md` is the source of truth.

**Why:** Forensics requires raw_response to diagnose `bad_response` / truncation. Embedding the system prompt in 768 traces every run is redundant and unit-wasteful when the file is already in git. The hash lets operators verify which prompt produced a trace without trusting the version string alone.

**Alternatives considered:** Embed system prompt in every trace (rejected: redundant). Minimal payload (summary + parsed only, rejected: loses bad_response forensics). Send pre-redaction raw event (rejected: contradicts §5.3 redaction discipline and breaks prod-parity).

### Secrets surface: `.dev.vars` only

**Decision:** Three keys in `.dev.vars` (already added by user, final names locked):
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_BASE_URL` (blank string ⇒ SDK falls back to `https://cloud.langfuse.com`)

These keys are NOT added to `scripts/sync-secrets.ts` `REQUIRED_SECRETS` or any optional-skip list. They are read locally via the existing `loadEnv({ path: ".dev.vars" })` call inside the eval runner. CI does not receive them.

**Why:** Direct mirror of the `DIRECT_DATABASE_URL` pattern documented in `.dev.vars.example` ("never injected into the Worker runtime"). Keeps the eval-only / runtime-excluded boundary mechanically enforced by the secrets pipeline, not just by convention.

**Alternatives considered:** Inject into Worker (rejected: contradicts the whole ADR). Add to GitHub Actions secrets for eval-in-CI (rejected: eval-in-CI is a separate, unmade decision; bundling them entangles two reversal paths).

**Env-var-name note:** Langfuse SDK conventionally reads `LANGFUSE_BASEURL` (no underscore). Since `.dev.vars` uses `LANGFUSE_BASE_URL`, the implementation must pass the value explicitly to the SDK constructor (`new LangfuseClient({ baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com", ... })`) rather than relying on the SDK's env auto-discovery.

## Domain terms

Most of these come from the existing repo glossary scattered across `src/CLAUDE.md` and `evals/README.md`; pinned here because the new session must reason about them without re-reading those long docs first.

- **Layer 3 eval** — The ~20-case regression suite at `evals/tasks/classification-semantic.json`, exercised by the default `run-classification-eval.ts` invocation. `user-report-*` tagged cases are merge-blocking; overall threshold = 90%.
- **Layer 4 eval** — The 192-case multilingual baseline per language at `evals/datasets/{lang}/classification.json`. Threshold and blocking tags read from the dataset's `evaluator` field. Runner is the same script with `--task-file` pointed at the lang JSON.
- **Ledger row** — One JSON object appended to `evals/agent-results.json` per eval invocation. Aggregate-only (`score / max / task_pass_rate / notes`), never per-case. Append-only; this is canonical for trend tracking.
- **Merge gate** — The eval runner's process exit code. 0 = mergeable, 1 = blocking-tag fail OR pass-rate below threshold. Used as a manual pre-merge check on any PR that edits prompts under `prompts/classifier/`.
- **Prompt SoT (Source of Truth)** — `prompts/classifier/system.v{N}.md` files plus the codegen `pnpm embed-prompts` → `src/services/prompts/_generated.ts` chain, CI-guarded by `pnpm verify-prompts`. Versions never deleted; `--prompt-version v2` reproduces older baselines without git checkout.
- **redactEventForLlm** — The whitelist redactor (`src/services/piiRedactor.ts` + caller in `llmClassifier.ts`) that strips email/URL/phone from event summary/description/location before they enter the prompt builder. Both the prod path and the eval path must pass through this — any new code that ships event data to a third party must respect it.
- **Soft-dep observability** — The repo-wide pattern (`llm_calls`, `rollback_runs`, `sync_runs`, `tokenRotation`, `dailyCostReport`) where observability writes are wrapped in `.catch(warn)` and never cause retries or block the main work. Langfuse inherits this discipline.
- **Operator-only secret** — A `.dev.vars` entry that is deliberately NOT in `REQUIRED_SECRETS`, hence never reaches the Worker. Precedent: `DIRECT_DATABASE_URL`. Mechanism: `scripts/sync-secrets.ts` only forwards listed keys, so omission is the protection.

Full glossary: CONTEXT.md (does not exist in this repo — `src/CLAUDE.md`, `evals/README.md`, and `docs/architecture-guidelines.md` are the de-facto glossary surface).

## ADRs created this session

- `docs/adr/0001-langfuse-eval-only.md`

## Open questions

- **Drift mechanism for `case.id` changes between dataset rebuilds.** ADR records the *constraint* (no silent mutation) but leaves the implementation choice to the PR: (a) sync script aborts with diff report unless `--allow-id-drift` is passed, OR (b) sync script forces operator to bump the Langfuse dataset name. Decide during implementation; both are honest, neither is hard to reverse.
- **`runName` convention.** Operator-chosen `--run-name` CLI flag with a default formula (suggested: `<short-sha>-<lang>-<prompt-version>-<reasoning-effort?>`). Lock the default during implementation; trivial to revise.
- **Score name.** Pinned to `pass` in §4, but if the implementation discovers Langfuse has a reserved-name conflict or convention (e.g. `accuracy`), rename freely — this is not load-bearing.

None of these block §10.

## Files to touch

Edit:
- `evals/scripts/run-classification-eval.ts` — wire Langfuse client init, per-case trace + span, dataset-item link, score post, end-of-run flush, optional stdout `Langfuse run: <url>` line.
- `package.json` (root) — add `@langfuse/client` and `@langfuse/tracing` to dependencies (NOT devDependencies — script ships with the repo). Confirm `pnpm install --frozen-lockfile` still passes.
- `evals/README.md` — already updated this session (Telemetry bullet exists). After implementation, append a 1-line "Run" instruction under Layer 3/4 sections noting the Langfuse env-var requirement is optional.

Create:
- `evals/scripts/sync-langfuse-dataset.ts` — operator dataset upsert script. CLI: `pnpm tsx evals/scripts/sync-langfuse-dataset.ts <lang>` where `<lang> ∈ {en, ko, zh-CN, zh-TW}` or `all`. Reads `evals/datasets/{lang}/classification.json`, asserts Langfuse dataset exists (create if not), upserts items by `case.id` with `{ input: <event + categories>, expectedOutput: { category_name: ... }, metadata: { tag, lang } }`. Bails on `case.id` drift per the open-question resolution.

Do not touch:
- `scripts/sync-secrets.ts` — intentionally unchanged. Verify via diff that `LANGFUSE_*` strings are absent.
- `.github/workflows/ci.yml` — intentionally unchanged.
- `src/services/llmClassifier.ts`, any route handler, anything under `src/` — Langfuse is eval-side only.

## Implementation plan

1. **Add deps + smoke test SDK init.** `pnpm add @langfuse/client @langfuse/tracing`. In a one-off scratch script (or a temp top-of-`run-classification-eval.ts` block), call `new LangfuseClient({...})` with a real `.dev.vars` key pair, do `await client.api.health()` (or list datasets), confirm 200. Roll back the scratch but keep the deps in `package.json`. Verifies the SDK fits in tsx/Node without dragging `@langfuse/otel`.

2. **Create `sync-langfuse-dataset.ts`.** Read one lang's `classification.json`, idempotently create the dataset, idempotently upsert each item by `case.id`. Implement drift detection per the chosen open-question resolution. Manual verify: run for `en`, confirm 192 items appear in Langfuse UI; re-run, confirm zero new units written.

3. **Refactor eval runner to emit per-case telemetry.** Without Langfuse yet, factor out the per-case loop body into a `caseResult` object with all the fields §4 trace-payload requires (parsed, raw, latency, http_status, attempts, prompt_sha256_prefix). Keep stdout + ledger behavior bit-identical. Verify by running once on the Layer 3 suite and diffing the ledger row against pre-refactor output.

4. **Add Langfuse trace emission, soft-wrapped.** Inside the loop, after `caseResult` is built, fire span create + dataset-item link + score post inside a `try/catch(warn)` block. Init Langfuse client lazily on first case; if init throws (missing key), set a sentinel and skip thereafter — log warn once. End-of-run `await client.flush().catch(warn)`. Verify: run Layer 3 with keys present → traces appear in Langfuse UI with correct linkage to dataset items.

5. **Verify soft-dep contract.** Run Layer 3 twice: (a) with both `LANGFUSE_*` keys deliberately empty, (b) with valid keys but `LANGFUSE_BASE_URL=http://127.0.0.1:1` to force a connection refused. In both cases, confirm exit code matches the pre-Langfuse exit code, ledger row is appended identically, only difference is a warn line on stderr. This is the merge-gate-isolation acceptance test.

6. **Print run URL + final docs polish.** On successful flush, print `Langfuse run: https://cloud.langfuse.com/.../runs/<run-id>` to stdout immediately after the existing summary. Update `evals/README.md` Layer 3 + Layer 4 run blocks with the one-line note that `LANGFUSE_*` keys in `.dev.vars` enable the per-case UI. Update `package.json` with a brief `"description"` field bump if conventional in the repo (skip otherwise).

## First action

Run `pnpm add @langfuse/client @langfuse/tracing` from the repo root, then write a 20-line scratch script that initialises `LangfuseClient` with `.dev.vars` keys and lists datasets — purely to confirm the SDK boots under tsx/Node 20 without pulling `@langfuse/otel`.

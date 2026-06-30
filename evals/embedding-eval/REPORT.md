# Embedding model selection eval — REPORT (ko-v1)

> Output of embedding-classifier #01. Filled from the sweep ledger
> `_local/runs.jsonl` (local SoT; aggregates only, no raw titles). The decision is
> externalized as **ADR-0005** (0002 form — a follow-up measurement ADR, NOT an
> ADR-0004 supersede). wandb mirrors these aggregates only.
>
> **Provisional pin.** Model is provisional (the pgvector dimension freeze is
> *deferred* — see §8 and ADR-0005), and the thresholds are provisional (the `sts`
> prefix's Workers-AI parity is re-measured per §6). All numbers below are over a
> **single-persona, ko-only** gold set — read them as a relative ranking signal and
> a conservative cold-start floor, not a production hit-rate.

## 1. Decision

- **Selected model**: `@cf/google/embeddinggemma-300m` — **dim 768** (provisionally
  pins `rule_seeds.embedding vector(768)`; freeze *deferred*, §8).
- **Frozen prompt-prefix invariant** (AC #7): arm `sts`, exact string
  `task: sentence similarity | query: ` (`sha256_16=793518b01601c92e`). **prod
  invariant** — the `rule_seeds` backfill job AND the title hot-path MUST embed with
  this exact prefix; a mismatch corrupts every stored seed vector (costly
  re-backfill). Verbatim from the embeddinggemma-300m model card.
- **Provisional thresholds** (provisional — dimension freeze deferred + `sts`-prefix
  WAI re-measure pending, §6): `T_verified=0.30`, `T_declared=0.55`
  (T_verified < T_declared), `margin=0.10`.
  - **`T_verified` is NOT exercised by this measurement.** The winner is cold-start
    (ex=0 — no Verified example seeds exist yet), so the verified-seed score is `nan`
    for every category and the `T_verified` gate never fires (`metrics.py` `decide()`).
    `T_verified=0.30` is therefore a **structural** value, not a measured one — it only
    activates once Instant-Feedback examples exist (post-OAuth, §8). Only `T_declared`
    and `margin` are exercised at cold-start.

## 2. Candidates + exclusions (AC #4)

| Model | dim | Result |
|-------|-----|--------|
| `@cf/baai/bge-m3` | 1024 | **Dominated.** Lowest micro *and* macro at every floor (macro-recall 0.353 vs gemma 0.553 @ floor 0.90; cold-start name_phrase best coverage 0.119). Not selected. |
| `@cf/qwen/qwen3-embedding-0.6b` | 1024 | **Competitive on micro, not on macro.** Its micro-coverage edge is entirely `cat_0` (the 47% catch-all); macro-recall trails gemma (0.450 vs 0.553 @ floor 0.90), a gap inside tiny-n single-query noise (§8). Last of the three on MIRACL-ko/zh (§5). Not selected. |
| `@cf/google/embeddinggemma-300m` | 768 | **Selected (provisional).** Highest macro-recall at every floor; strongest cold-start Declared path (n=106 @ 90.6% declared-precision). 768d (lighter). Mid on MIRACL-ko (above qwen3), top on MIRACL-zh (§5). |

Excluded: `bge-*-en-v1.5` (English-only) · `@cf/pfnet/plamo-embedding-1b`
(Japanese-only) · reranker/cross-encoder (ADR-0004 bi-encoder dense — no kNN index).
Catalogue drift (new ko-specialized model) → re-run the harness.

## 3. Threshold objective (AC #12 — precision-first)

Winner rule = **max coverage** s.t. **verified_precision ≥ 0.90** (auto-apply
precision floor) AND **none_false_apply ≤ 0.05** (false-apply ceiling). `T_declared`
tunes Stage-2 handoff recall. macro-F1 **not** used (equal cost to false-apply/miss →
rejected).

- Achieved at winner (gemma, `sts/name_phrase`, cold-start ex=0, `T=(0.30, 0.55,
  0.10)`): coverage **0.341** · verified_precision **0.906** · none_false_apply
  **0.000** (0/13) · macro_f1 **0.633** (reported, not optimized).

**Floor rationale (operator, 2026-06-30).** Pinned at **0.90** over the conservative
0.95 alternative (which yields coverage 0.167 / precision 0.981 at `T=(0.30, 0.825,
0.0)`). Stage-1 exists to cut LLM cost; 0.95's 16.7% cold-start coverage hands the
large majority of events to the LLM fallback and undercuts that purpose. 0.90 roughly
doubles coverage; its higher false-apply rate is acceptable because each false-apply
is *correctable* (the user's correction becomes a Verified seed that prevents
recurrence — the learnability ADR-0004 bought by replacing substring), and thresholds
are provisional and will be re-derived on a richer gold set. **Caveat carried** (§8):
that correction loop is the OAuth-gated Instant-Feedback path (#05), so in the
pre-OAuth cold-start-only ship window the false-applies have no *in-product*
correction yet — only the user manually recoloring.

**Weak-none-gate caveat (state every time).** `none_false_apply = 0.000` is **0/13**
none-cases, not a verified zero: the 95% upper bound on the true none-false-apply rate
is ~**20–25%**. A two-digit real mis-apply rate could still pass this gate. The
held-out negative path (`알바`, held_out=true) carries 0 queries — all 13 negatives
are hand-labeled `none`. Do not read the ceiling as "verified safe."

## 4. Keyword-form arm (AC #5 — ADR-0004 follow-up finding)

Cold-start (Declared only, no examples), gemma @ floor 0.90, none-FP ≤ 0.05:

| arm | coverage | verified_precision | none_false_apply |
|-----|----------|--------------------|------------------|
| name_only | 0.074 | 0.913 | 0.000 |
| name_word | — (no feasible point) | — | — |
| name_phrase | 0.341 | 0.906 | 0.000 |

→ Finding: keyword **kept**; form = **phrase**. `name_phrase` (0.341) ≫ `name_only`
(0.074), so phrase keywords buy large cold-start coverage. `name_word` yields **no
feasible operating point** at floor 0.90 or 0.95 for any model — single-token
keywords add no usable signal over the name alone (they pull in surface-token false
matches faster than coverage). The 11/11 rule categories carry both word and phrase
seeds, so the arm is not a name-only confound. (#03 input: keep keyword seeds, store
them as phrases, drop the single-word form.)

## 5. Multilingual safety cross-check + flip rule (AC #14)

ko-gold winner (gemma) vs public MTEB-multilingual / MIRACL ko+zh. **Flip rule, N=2**:
if the ko-gold winner sits ≥ 2 ranks below the runner-up on MIRACL-ko → red-flag
(ko-overfit guard). No en/zh synthetic data generated. Source: MTEB
`MIRACLRetrievalHardNegatives` (nDCG@10, dev) + model cards + the embeddings-benchmark
results repo, snapshot 2026-06-29.

| model | MTEB-mult (rank/3) | MIRACL-ko (rank/3) | MIRACL-zh (rank/3) |
|-------|---|---|---|
| bge-m3 | 59.56 (3rd) | **0.701 (1st)** | 0.636 (2nd) |
| qwen3-0.6b | **64.33 (1st)** | 0.620 (3rd) | 0.592 (3rd) |
| embeddinggemma-300m | 61.15 (2nd) | 0.661 (2nd) | **0.649 (1st)** |

- **Flip triggered: NO.** ko-gold winner gemma is **2nd** on MIRACL-ko, *above* the
  ko-gold runner-up qwen3 (**3rd**) — 0 ranks below (1 above). gemma is also 1st on
  MIRACL-zh and on Belebele ko+zh. The headline multilingual-mean ordering (qwen3 >
  gemma > bge-m3) *inverts* the Korean-retrieval ordering (bge-m3 > gemma > qwen3) —
  exactly the overfit trap N guards against; gemma sits on the safe side of it.
- **Watch-item (not a blocker):** embeddinggemma-300m is sensitive to the
  `transformers` version — a stale bidirectional-attention bug tanks its Korean score
  (Belebele-ko 0.719 broken vs 0.9414 official). Pin the `transformers`/runtime
  version identically in the backfill job and the title hot-path.

## 6. 3080 ↔ Workers AI transfer (AC #15)

`wai_parity.py` on non-PII probes (`parity_probes.txt`, ko/en/zh mix): gemma mean
cosine **1.0** (min **1.0**, n **30**); bge-m3 1.0/1.0/30; qwen3 0.9998/0.9987/30. All
above the provisional threshold 0.98 → high-confidence local↔Workers-AI transfer.

- **Winner's final thresholds re-measured on Workers AI: PENDING.** The parity probes
  were embedded with the **empty** prefix; the winner uses the non-empty `sts` prefix
  (`task: sentence similarity | query: `), so the *exact-prefix* WAI transfer is not
  yet confirmed. mean cosine 1.0 is a strong transfer signal but **not** a
  boundary-bit guarantee (qwen3 min 0.9987 shows non-trivial drift exists). Re-measure
  the winner's thresholds on Workers AI (inside the PII boundary) with the `sts`
  prefix before lifting `provisional`.

## 7. Tracking methodology (fold-in — replaces a standalone ADR)

- wandb adopted **eval-only**, **aggregates-only** PII contract: config · scalar
  metrics · thresholds · synthetic `cat_N` confusion. Category names, seeds, titles,
  keywords, raw prefix → **never** sent (enforced by `ledger.assert_wandb_safe`,
  deny-by-default allowlist).
- Canonical ledger = local append-only `runs.jsonl`; wandb is augmentation
  (ADR-0001 "tracker=augmentation, ledger=SoT").
- **Divergence rationale** vs ADR-0001 consequence (b) "PII dataset → SaaS re-eval":
  the gold set is PII, but only aggregates over synthetic IDs cross the boundary, so
  the SaaS-send concern is structurally avoided. `WANDB_*` keys: `.dev.vars` only,
  never injected into the Worker/CI (ADR-0001 LANGFUSE_* pattern).

## 8. Known limitations + roadmap (AC #17, design §6)

- **Single annotator** (no inter-annotator κ): `self_consistency_mismatch` = **not
  measured**. The cooling-period re-label was **descoped** by the operator on
  2026-06-30 (labels judged sufficiently reliable; gold set only 1 day old, genuine
  cooling not yet elapsed). Single-annotator reliability is externalized here as a
  known-limitation rather than quantified.
- **Persona skew** (operator-1, student/dev-heavy; `cat_0`=공부 is 47% of queries) +
  **ko-only**: en/zh thresholds ship as ko-borrowed **provisional·unverified**.
- **Accepted downward clip**: the winner sits at `T_verified=0.30` / `T_declared=0.55`
  — both grid MIN — with `margin=0.10` carrying precision. Deeper `T_declared` (< 0.55)
  is untested (grid floor). Accepted as a known-limitation (operator, 2026-06-29); not
  chased.
- **Weak none gate**: 0/13 none → ~20–25% upper bound on the true none-false-apply
  rate; a two-digit real mis-apply could still pass (§3).
- **Tiny-n macro noise**: tail categories run n=2–9, so a single flipped query moves a
  category's recall by ±0.5 → the gemma↔qwen3 macro gap (~0.05) is inside that noise.
  This is why the dimension freeze is **deferred** — 768 vs 1024 must not be pinned on
  a single-persona, ko-only, cat_0-dominated gold set. `#02–#06` proceed on
  provisional gemma(768); the freeze waits for a multi-persona / multilingual set.
- **OAuth-gated correction loop**: the Instant-Feedback path (#05) that turns
  corrections into Verified seeds — the mechanism that lifts cold-start precision over
  time — is gated on OAuth verification. Pre-OAuth, Stage-1 ships Declared-only with no
  in-product correction loop (§3 floor rationale).
- Roadmap (gated on OAuth pass for in-product opt-in): consenting-peer offline
  export → post-OAuth anonymous contribution; en/zh receive *real* data via the same
  mechanism (no synthetic generation); multi-persona expansion unblocks the dimension
  freeze.

## Provenance

gold_set_version `ko-v1` · manifest_sha256
`d9bf2ddd53a0dbe2dbef5edab3b8a252cb45d249a9edfc46c078341ee49fcae2` · git_sha `b081d97`
(+ dirty `config.py` expanded grid, below) · seed `42` · determinism `fp32 / l2` · k
`all-seeds` · agg `max` · metric `cosine`.

**Grid actually swept** (expanded, recorded here so the winner is reproducible from
the repo even though `config.py`'s expanded grid is committed as a dirty-intentional
diff — see ADR-0005): `T_verified ∈ {0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65}`
× `T_declared ∈ {0.55, 0.60, 0.65, 0.70, 0.725, 0.75, 0.775, 0.80, 0.825, 0.85}` ×
`margin ∈ {0.0, 0.02, 0.05, 0.08, 0.10, 0.12}` = 444 threshold combos (after
T_verified < T_declared) × 30 arm-combos = **13,320** sweep records. The coarse first
pass is a strict subset (shared run_ids bit-identical → no drift).

**Integrity** (re-verified post-expansion): gold-split leak 0; query dedup OK; 296
unique example titles; declared∩query exact overlap = 13 queries = **4.2%** of queries
(8.3% of declared seeds) — a small Declared-precision optimism + a #03 keyword-form
sensitivity flag, identical input across all models so model *ranking* is unaffected.

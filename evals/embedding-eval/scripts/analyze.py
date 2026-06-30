import json, collections

RUNS = "_local/runs.jsonl"
_raw = [json.loads(l) for l in open(RUNS) if l.strip()]
# Keep only sweep records, dedup by run_id. Re-running an expanded grid appends
# (handoff: never mv/archive the ledger); the coarse grid is a strict subset of
# the expanded one, so shared points collapse by their deterministic run_id and
# only new points add. (Also drops kind=="wai_parity" records, which carry a
# model but no metrics.)
_by_id = {r["run_id"]: r for r in _raw if r.get("kind") == "embedding_knn_sweep"}
recs = list(_by_id.values())
print(f"records: {len(recs)} (deduped by run_id from {len(_raw)} raw ledger lines)")

NONE_CEIL = 0.05

def feasible(r, floor, ceil=NONE_CEIL):
    m = r["metrics"]
    return m["verified_precision_exact"] >= floor and m["none_false_apply_exact"] <= ceil

def best_at(rows, floor, ceil=NONE_CEIL):
    cand = [r for r in rows if feasible(r, floor, ceil)]
    if not cand:
        return None
    # max coverage, tie-break high precision, low none-FP
    return max(cand, key=lambda r: (r["metrics"]["coverage"],
                                    r["metrics"]["verified_precision_exact"],
                                    -r["metrics"]["none_false_apply_exact"]))

def short(r):
    if r is None: return "—"
    m = r["metrics"]; t = r["thresholds"]
    return (f"cov={m['coverage']:.3f} prec={m['verified_precision']:.3f} "
            f"noneFP={m['none_false_apply']:.3f} | {r['prompt_arm']}/{r['keyword_form_arm']}"
            f" ex={int(r['include_examples'])} T=({t['T_verified']},{t['T_declared']},{t['margin']})")

MODELS = ["@cf/baai/bge-m3", "@cf/qwen/qwen3-embedding-0.6b", "@cf/google/embeddinggemma-300m"]
DIM = {"@cf/baai/bge-m3":1024, "@cf/qwen/qwen3-embedding-0.6b":1024, "@cf/google/embeddinggemma-300m":768}
FLOORS = [1.00, 0.98, 0.97, 0.95, 0.92, 0.90, 0.85, 0.80]

print("\n================ PER-MODEL: max coverage @ none-FP<=0.05, by precision floor ================")
for mdl in MODELS:
    rows = [r for r in recs if r["model"] == mdl]
    print(f"\n## {mdl}  (dim {DIM[mdl]})   [{len(rows)} cells]")
    for f in FLOORS:
        b = best_at(rows, f)
        print(f"  floor {f:.2f}: {short(b)}")

print("\n================ OVERALL best (any model) by floor ================")
for f in FLOORS:
    b = best_at(recs, f)
    mdl = b["model"] if b else "—"
    print(f"  floor {f:.2f}: {mdl.split('/')[-1]:28s} {short(b)}")

print("\n================ COLD-START keyword-form arm (include_examples=False) ================")
print("AC#5: does keyword buy value over name, in which form? max-cov @ floor 0.90, none-FP<=0.05")
for mdl in MODELS:
    print(f"\n## {mdl.split('/')[-1]} (dim {DIM[mdl]})")
    for kf in ["name_only","name_word","name_phrase"]:
        rows = [r for r in recs if r["model"]==mdl and r["keyword_form_arm"]==kf and r["include_examples"]==False]
        for fl in [0.95, 0.90]:
            b = best_at(rows, fl)
            print(f"   {kf:11s} floor {fl:.2f}: {short(b)}")

print("\n================ include_examples effect (best @ floor 0.90) ================")
for mdl in MODELS:
    print(f"## {mdl.split('/')[-1]}")
    for incl in [True, False]:
        rows = [r for r in recs if r["model"]==mdl and r["include_examples"]==incl]
        b = best_at(rows, 0.90)
        print(f"   examples={int(incl)}: {short(b)}")

print("\n================ prompt_arm effect (best @ floor 0.90, examples=True) ================")
for mdl in MODELS:
    arms = sorted(set(r["prompt_arm"] for r in recs if r["model"]==mdl))
    print(f"## {mdl.split('/')[-1]}: arms={arms}")
    for arm in arms:
        rows = [r for r in recs if r["model"]==mdl and r["prompt_arm"]==arm and r["include_examples"]==True]
        b = best_at(rows, 0.90)
        print(f"   arm {arm:5s}: {short(b)}")

# Unconstrained max coverage at perfect-ish precision, to show ceiling of the gold set
print("\n================ ceiling check: max coverage at various floors, ANY config, none-FP<=0.10 ================")
for f in [0.95, 0.90, 0.85]:
    b = best_at(recs, f, ceil=0.10)
    print(f"  floor {f:.2f} (noneFP<=0.10): {b['model'].split('/')[-1] if b else '—'} {short(b)}")

# ---- GRADE-SPLIT (via_grade passthrough) : direct evidence for the T_declared bar ----
# `verified_precision` is the MIXED auto-apply precision (the gate). These split it by
# the grade that cleared. Cold-start (ex=0) has no verified seeds → every apply is
# declared-via, so this isolates the Declared / cold-start bar (n = cases it's over).
HAS_VIA = any("declared_via_precision" in r["metrics"] for r in recs)
def vex(m, k): return m.get(k + "_exact", m.get(k, 0))
if HAS_VIA:
    print("\n================ DECLARED-ONLY (cold-start ex=0): max declared-via coverage by declared-precision floor, none-FP<=0.05 ================")
    for mdl in MODELS:
        rows = [r for r in recs if r["model"] == mdl and r["include_examples"] is False]
        print(f"\n## {mdl.split('/')[-1]} (dim {DIM[mdl]})")
        for fl in (0.95, 0.90, 0.85):
            cand = [r for r in rows if vex(r["metrics"], "declared_via_precision") >= fl
                    and vex(r["metrics"], "none_false_apply") <= NONE_CEIL and r["metrics"]["declared_via_n"] > 0]
            if not cand:
                print(f"   declared-floor {fl:.2f}: —"); continue
            b = max(cand, key=lambda r: (r["metrics"]["declared_via_n"], vex(r["metrics"], "declared_via_precision")))
            m, t = b["metrics"], b["thresholds"]
            print(f"   declared-floor {fl:.2f}: n={m['declared_via_n']:3d} declared_prec={m['declared_via_precision']:.3f} "
                  f"cov={m['coverage']:.3f} | {b['prompt_arm']}/{b['keyword_form_arm']} Td={t['T_declared']} m={t['margin']}")
    print("\n================ ex=1 grade split at per-model gate winners (mixed vs verified-via vs declared-via) ================")
    for mdl in MODELS:
        b = best_at([r for r in recs if r["model"] == mdl and r["include_examples"] is True], 0.90)
        if not b:
            print(f"   {mdl.split('/')[-1]:22s}: —"); continue
        m = b["metrics"]
        print(f"   {mdl.split('/')[-1]:22s}: cov={m['coverage']:.3f} MIXED={m['verified_precision']:.3f} | "
              f"verified-via n={m['verified_via_n']:3d} p={m['verified_via_precision']:.3f}  "
              f"declared-via n={m['declared_via_n']:3d} p={m['declared_via_precision']:.3f}")
else:
    print("\n(grade-split via_grade fields absent — re-run sweep after the metrics passthrough to populate.)")

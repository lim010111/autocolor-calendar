import json

recs = [json.loads(l) for l in open("_local/runs.jsonl") if l.strip()]

def find(model, arm, kf, ex, tv, td, mg):
    for r in recs:
        if r.get("kind") != "embedding_knn_sweep":  # skip wai_parity (no thresholds)
            continue
        t = r["thresholds"]
        if (r["model"]==model and r["prompt_arm"]==arm and r["keyword_form_arm"]==kf
            and r["include_examples"]==ex and t["T_verified"]==tv and t["T_declared"]==td
            and t["margin"]==mg):
            return r
    return None

# category sizes (from the first sweep record's per_category n_queries)
pc0 = next(r for r in recs if r.get("kind") == "embedding_knn_sweep")["metrics"]["per_category"]
sizes = {c: pc0[c]["n_queries"] for c in pc0}
print("category query sizes:", json.dumps(sizes))
print("total queries in cats:", sum(sizes.values()), "(+ none queries not shown)")

# Operating points the REPORT/ADR-0005 actually cite (expanded-grid winners, not the
# coarse-era placeholders). gemma floor-0.90 is the SELECTED winner; floor-0.95 is the
# conservative alternative; qwen3 floor-0.90 is the cross-model frontier point.
OPS = [
    ("gemma768 @ floor0.90 (SELECTED)",      "@cf/google/embeddinggemma-300m","sts","name_phrase",False,0.30,0.55,0.10),
    ("gemma768 @ floor0.95 (conservative)",  "@cf/google/embeddinggemma-300m","sts","name_phrase",False,0.30,0.825,0.0),
    ("qwen3   @ floor0.90 (frontier)",       "@cf/qwen/qwen3-embedding-0.6b", "none","name_phrase",True, 0.40,0.55,0.08),
]
for label, *args in OPS:
    r = find(*args)
    if not r:
        print(f"\n{label}: NOT FOUND"); continue
    m = r["metrics"]
    print(f"\n== {label} :: cov={m['coverage']} prec={m['verified_precision']} noneFP={m['none_false_apply']} ==")
    for c in sorted(m["per_category"], key=lambda x:-sizes[x]):
        pcc = m["per_category"][c]
        print(f"   {c:7s} n={sizes[c]:3d}  recall={pcc['recall']:.2f}  prec={pcc['precision']:.2f}  tp={pcc['tp']}")

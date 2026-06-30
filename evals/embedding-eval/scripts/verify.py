import json, unicodedata, re, sys
from collections import Counter
from embedding_eval import config
from embedding_eval.dataset import load_gold_set, build_seed_pool

_WS = re.compile(r"\s+")
def norm(s): return _WS.sub(" ", unicodedata.normalize("NFC", s).strip())

gold = load_gold_set(config.gold_path("ko-v1"))
print("="*70); print("(A) GOLD SPLIT INTEGRITY"); print("="*70)

# collect texts
ex_by_cat, decl_by_cat = {}, {}
for c in gold.categories:
    ex_by_cat[c["name"]] = [norm(t) for t in c.get("example_seeds",[])]
    ds = c.get("declared_seeds",{})
    decl_by_cat[c["name"]] = [norm(t) for t in ds.get("word",[])+ds.get("phrase",[])]

all_examples = [t for v in ex_by_cat.values() for t in v]
all_declared = [t for v in decl_by_cat.values() for t in v]
q_titles = [norm(q.title) for q in gold.queries]
q_norm_set = set(q_titles)

print(f"queries={len(q_titles)}  example_seeds={len(all_examples)}  declared_seeds={len(all_declared)}")
print(f"  none queries: {sum(1 for q in gold.queries if q.expected=='none')}")
print(f"  rule cats: {len(gold.rule_categories)}  held-out: {len(gold.held_out_categories)}")

# 1) train==test leak: any example_seed == any query title (normalized)?
leak = q_norm_set & set(all_examples)
print(f"\n[1] example_seed ∩ query (train==test leak): {len(leak)}  -> {'OK (0)' if not leak else 'LEAK!'}")

# 2) query dedup: duplicate normalized query titles?
dups = [t for t,n in Counter(q_titles).items() if n>1]
print(f"[2] duplicate query titles (post-dedup): {len(dups)}  -> {'OK' if not dups else 'DUP!'}")

# 3) example_seed dedup + cross-membership: any title both example and query in ANY cat
ex_unique = len(all_examples) == len(set(all_examples))
print(f"[3] example titles unique: {ex_unique}  (n={len(all_examples)}, uniq={len(set(all_examples))})")

# 4) declared ∩ query exact overlap (the 4.2% confound claim — 13/311 queries)
dq = q_norm_set & set(all_declared)
print(f"[4] declared_seed ∩ query exact overlap: {len(dq)} distinct declared hit "
      f"({len(dq)/max(1,len(all_declared))*100:.1f}% of declared)")
# how many QUERIES are exactly hit by a declared seed (the optimistic-bias surface)
q_hit_by_decl = sum(1 for t in q_titles if t in set(all_declared))
print(f"    queries exactly == a declared seed: {q_hit_by_decl}/{len(q_titles)} = {q_hit_by_decl/len(q_titles)*100:.1f}%")

print("\n"+"="*70); print("(A.b) NAME_PHRASE CONFOUND: empty phrase lists reduce to name_only"); print("="*70)
for arm in ("name_word","name_phrase"):
    form = "word" if arm=="name_word" else "phrase"
    empty = [c["name"] for c in gold.categories if not c.get("held_out") and not c.get("declared_seeds",{}).get(form)]
    nonempty = [c["name"] for c in gold.categories if not c.get("held_out") and c.get("declared_seeds",{}).get(form)]
    print(f"  {arm}: {len(nonempty)}/{len(gold.rule_categories)} cats have {form} seeds; "
          f"{len(empty)} reduce to name-only")

print("\n"+"="*70); print("(B) GRID-BOUNDARY CLIPPING"); print("="*70)
_raw = [json.loads(l) for l in open(config.RUNS_JSONL) if l.strip()]
# dedup by run_id (expanded re-run appends; coarse ⊂ expanded → identical points collapse;
# fake-backend smoke records excluded — run_id excludes the backend, so a fake run could
# otherwise shadow a real one)
recs = list({r["run_id"]: r for r in _raw
             if r.get("kind")=="embedding_knn_sweep" and r.get("embedding_backend")!="fake"}.values())
print(f"sweep records: {len(recs)} (deduped by run_id from {len(_raw)} raw ledger lines)")
TV = config.DEFAULT_T_VERIFIED_GRID; TD = config.DEFAULT_T_DECLARED_GRID; MG = config.DEFAULT_MARGIN_GRID
print(f"grid: T_verified {TV}  T_declared {TD}  margin {MG}")

def exact(m,k): return m.get(f"{k}_exact", m[k])
def best_at(rows, floor, ceil=0.05):
    cand=[r for r in rows if exact(r['metrics'],'verified_precision')>=floor and exact(r['metrics'],'none_false_apply')<=ceil]
    return max(cand, key=lambda r:(r['metrics']['coverage'],r['metrics']['verified_precision'],-r['metrics']['none_false_apply'])) if cand else None

for floor in (0.95, 0.90):
    print(f"\n floor {floor}: winner threshold positions (is it pinned at a grid edge?)")
    for mdl in config.CANDIDATES:
        rows=[r for r in recs if r['model']==mdl]
        b=best_at(rows,floor)
        if not b: print(f"   {mdl.split('/')[-1]:22s}: —"); continue
        t=b['thresholds']; ex=b['include_examples']
        tv_edge = "MIN!" if t['T_verified']==min(TV) else ("max" if t['T_verified']==max(TV) else "")
        td_edge = "MAX!" if t['T_declared']==max(TD) else ("min" if t['T_declared']==min(TD) else "")
        mg_edge = "MAX!" if t['margin']==max(MG) else ("min" if t['margin']==min(MG) else "")
        relevant_tv = "(N/A: ex=0, no verified seeds)" if not ex else f"Tv={t['T_verified']}{tv_edge}"
        print(f"   {mdl.split('/')[-1]:22s}: cov={b['metrics']['coverage']:.3f} ex={int(ex)} "
              f"{relevant_tv} Td={t['T_declared']}{td_edge} m={t['margin']}{mg_edge}")

print("\n"+"="*70); print("(C) MODEL-RANKING ROBUSTNESS to cat_0 dominance (47% of queries)"); print("="*70)
# Recompute a coverage-like ranking but MACRO over categories (each cat weighted equally),
# to see if the model ranking is just 'who fits cat_0 best'.
# Use per_category recall as proxy: micro = overall coverage; macro = mean per-cat recall.
import math
def macro_recall(r):
    pc=r['metrics']['per_category']; rs=[pc[c]['recall'] for c in pc if pc[c]['n_queries']>0]
    return sum(rs)/len(rs) if rs else 0.0
for floor in (0.95,0.90):
    print(f"\n floor {floor}: micro-coverage vs macro-recall (winner config per model)")
    for mdl in config.CANDIDATES:
        b=best_at([r for r in recs if r['model']==mdl],floor)
        if not b: print(f"   {mdl.split('/')[-1]:22s}: —"); continue
        pc=b['metrics']['per_category']
        cat0_recall = pc.get('cat_0',{}).get('recall')
        print(f"   {mdl.split('/')[-1]:22s}: micro-cov={b['metrics']['coverage']:.3f} "
              f"macro-recall={macro_recall(b):.3f} cat_0-recall={cat0_recall}")

# Exit non-zero if any (A) gold-split integrity invariant failed, so a caller/CI can
# gate on it (the script printed LEAK!/DUP! but the process used to exit 0). (A.b)/(B)/(C)
# are diagnostics, not pass/fail gates.
sys.exit(1 if (leak or dups or not ex_unique) else 0)

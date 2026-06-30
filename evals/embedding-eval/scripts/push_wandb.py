"""Push the EXISTING runs.jsonl aggregates to wandb (no re-run, no ledger append).

Reuses the harness's vetted PII gate (ledger.to_wandb_payload via log_to_wandb).
Exports WANDB_* from .dev.vars into the env so wandb.init can authenticate.
"""
import json, os
from embedding_eval import config, ledger

# 1) hoist secrets from .dev.vars into the process env (wandb.init reads env)
for k in ("WANDB_API_KEY", "WANDB_PROJECT"):
    v = config.load_secret(k)
    if v and k not in os.environ:
        os.environ[k] = v

project = os.environ.get("WANDB_PROJECT") or "autocolor-embedding-eval"
print("WANDB_API_KEY loaded:", bool(os.environ.get("WANDB_API_KEY")))
print("project:", project)

# 2) read the canonical ledger (do NOT modify it)
records = [json.loads(l) for l in open(config.RUNS_JSONL) if l.strip()]
# only the sweep records (exclude any parity rows that lack 'metrics')
sweep_records = [r for r in records if r.get("kind") == "embedding_knn_sweep"]
print(f"records total={len(records)} sweep={len(sweep_records)}")

# 3) push through the vetted gate (raises PiiGateError on any leak)
sent = ledger.log_to_wandb(sweep_records, project=project, run_name="ko-v1-sweep")
print("sent:", sent)

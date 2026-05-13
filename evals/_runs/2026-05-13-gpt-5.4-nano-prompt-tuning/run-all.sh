#!/usr/bin/env bash
# PR-β driver — 7 cells × 4 langs = 28 sub-runs of run-classification-eval.ts.
# Each cell fans out across en/ko/zh-CN/zh-TW in parallel; cells run sequentially.
# Logs land at evals/_runs/2026-05-13-gpt-5.4-nano-prompt-tuning/<lang>-<cell>.log.

set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

LOG_DIR="evals/_runs/2026-05-13-gpt-5.4-nano-prompt-tuning"
mkdir -p "$LOG_DIR"

# cell -> "<prompt-version>|<reasoning-effort or '-' for unset>"
declare -A CELLS=(
  [C0a]="v2|-"
  [C0b]="v2|minimal"
  [C1a]="v5-L1|-"
  [C1b]="v5-L1|minimal"
  [C2]="v5-L2|-"
  [C4]="v5-L4|-"
  [C5]="v5-L5|-"
)
ORDER=(C0a C0b C1a C1b C2 C4 C5)
LANGS=(en ko zh-CN zh-TW)

run_one() {
  local cell="$1" lang="$2" pv="$3" effort="$4"
  local log="$LOG_DIR/$lang-$cell.log"
  local args=(
    evals/scripts/run-classification-eval.ts
    --task-file "evals/datasets/$lang/classification.json"
    --include-rule-leg
    --prompt-version "$pv"
    --prompt-source langfuse
    --max-completion-tokens 512
  )
  if [ "$effort" != "-" ]; then
    args+=(--reasoning-effort "$effort")
  fi
  echo "[start] $cell/$lang prompt=$pv effort=$effort" >&2
  # The runner exits 1 on threshold/blocking miss — that's a measurement
  # outcome, not a driver error. Capture exit code, never abort.
  pnpm tsx "${args[@]}" >"$log" 2>&1
  local rc=$?
  echo "[done ] $cell/$lang rc=$rc" >&2
}

START_TS=$(date -Iseconds)
echo "==== PR-β batch start $START_TS ====" >&2

for cell in "${ORDER[@]}"; do
  IFS='|' read -r pv effort <<<"${CELLS[$cell]}"
  pids=()
  for lang in "${LANGS[@]}"; do
    run_one "$cell" "$lang" "$pv" "$effort" &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
  echo "==== $cell complete ====" >&2
done

echo "==== PR-β batch end $(date -Iseconds) ====" >&2

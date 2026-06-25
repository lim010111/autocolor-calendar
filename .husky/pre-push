#!/bin/sh
# merge-gate-local — git pre-push hook (claude-harness-work #30).
#
# Installed by `/setup-merge-gate` (local profile) into <repo>/.git/hooks/pre-push.
# Calls ONLY `merge-gate-local verify`: it reads the cached review's
# summary.json, checks freshness + pass state, and exits 0/1. It runs NO Codex,
# NO Claude, and writes NO artefact (the asymmetric-privilege contract — #30 D1).
#
# Enforcement is read from harness.toml ([merge-gate.local].enforcement_policy):
#   * advisory               → always exits 0 (reports only)
#   * client-side-blocking   → exits 1 on a missing/stale/failing review unless
#                              the tip commit carries a bypass trailer; or push
#                              with `git push --no-verify` (unaudited).
#
# git feeds one line per pushed ref on stdin:
#   <local_ref> <local_sha> <remote_ref> <remote_sha>

WRAPPER="${MERGE_GATE_WRAPPER:-$HOME/.claude/scripts/merge_gate_local.py}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO_ROOT" ] && exit 0
# Wrapper not installed → do not block the push (fail open on infra absence;
# the gate is only as strong as its install, and a missing wrapper is an
# operator/setup problem, not an unreviewed-change problem).
[ -f "$WRAPPER" ] || { echo "merge-gate: wrapper not found at $WRAPPER — skipping" >&2; exit 0; }

ZERO="0000000000000000000000000000000000000000"
status=0
seen=0
while read -r local_ref local_sha remote_ref remote_sha; do
  seen=1
  # Branch/tag delete (local all-zeroes): nothing to review.
  [ "$local_sha" = "$ZERO" ] && continue
  # Tags are unsupported in v1 — skip.
  case "$local_ref" in
    refs/tags/*) continue ;;
  esac
  # remote_sha all-zeroes = first push of a new branch; verify resolves the
  # base to merge-base(default) when it sees the zero sha. Force-push passes
  # the old remote tip, so verify checks the exact published range.
  python3 "$WRAPPER" --cwd "$REPO_ROOT" verify \
    --base-sha "$remote_sha" --tip-sha "$local_sha" || status=1
done

# No refs on stdin (e.g. up-to-date push) → nothing to gate.
[ "$seen" = "0" ] && exit 0
exit $status

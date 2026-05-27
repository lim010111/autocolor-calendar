#!/usr/bin/env python3
# managed by /setup-merge-gate v1; re-installer will overwrite
"""run-codex-validators / aggregate.py

Deterministic helper for the /run-codex-validators skill. Three subcommands:

  build-input     emit validator <input> JSON on stdout
  write-outputs   parse validator stdout + codex JSON, write the
                  validators.{json,md} artifacts the workflow consumes
  write-fallback  emit "Codex did not run" artifacts and return

All commands return exit code 0 unless argparse itself rejects the args.
The contract "the runtime never blocks" lives partly here and partly in
SKILL.md — see issue #05 acceptance criteria and ADR-0005.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Hardcoded defaults for the validator agent's <input>.project_refs.
# Matches ~/.claude/agents/codex-review-validator.md exactly.
PROJECT_REFS = {
    "agents_md": "AGENTS.md",
    "adr_glob": "docs/adr/*.md",
    "context_map": "CONTEXT-MAP.md",
    "per_context_glob": "src/*/CONTEXT.md",
}

# Adapter table — canonical doc lives in SKILL.md. Codex emits
# .result.findings[].line_start; the validator <input> expects .line.
ADAPTER_PASSTHROUGH = ("id", "severity", "file", "title", "body", "suggested_fix")

LINE_RE = re.compile(
    r"^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s+(uphold|dismiss|unsure)\s+(\S+):(\d+)\s+—\s+(.+)$"
)

SEVERITY_ORDER = ("critical", "high", "medium", "low")


def err(msg: str) -> None:
    sys.stderr.write(f"run-codex-validators: {msg}\n")


def _findings_from_result_doc(doc: object) -> list[dict] | None:
    """Extract findings[] from a single-doc payload of the workflow's
    normalize-step shape: {result: {findings: [...]}, codex: {...}}.

    Returns None if `doc` is not that shape (caller falls back to JSONL).
    Returns [] if shape matches but findings are absent/empty.
    """
    if not isinstance(doc, dict):
        return None
    result = doc.get("result")
    if not isinstance(result, dict):
        return None
    findings = result.get("findings", [])
    return findings if isinstance(findings, list) else []


def _findings_from_jsonl_stream(lines: list[str]) -> list[dict]:
    """Extract findings from raw Codex `--json` JSONL output.

    Matches the workflow's "Normalize Codex JSONL" jq expression: filter
    item.completed[agent_message] events, take the last one, json.loads
    its .item.text, return result.findings[]. Returns [] on any failure
    (missing event, malformed payload, etc.) — same fail-safe as the
    workflow's fallback branches.
    """
    last_agent_msg: dict | None = None
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(ev, dict):
            continue
        if ev.get("type") != "item.completed":
            continue
        item = ev.get("item")
        if isinstance(item, dict) and item.get("type") == "agent_message":
            last_agent_msg = item
    if last_agent_msg is None:
        return []
    text = last_agent_msg.get("text")
    if not isinstance(text, str):
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, dict):
        return []
    findings = payload.get("findings", [])
    return findings if isinstance(findings, list) else []


def load_codex_findings(path: str) -> list[dict]:
    """Return Codex findings[] from either a single-doc payload (workflow
    case — what the normalize step writes) or a raw JSONL stream (defensive
    path for direct local invocation, regression tests, alternative hosts).

    The two paths must produce identical findings for equivalent input.
    Both fail safely (empty list + stderr note) rather than raising — the
    runtime contract is "never block from inside this script."
    """
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except Exception as e:
        err(f"could not read codex JSON at {path}: {e}")
        return []
    if not raw.strip():
        return []
    # Try single-doc first — this is the normalized-payload case the
    # workflow installs after #18. json.load on a JSONL file raises
    # JSONDecodeError ("Extra data") on the second top-level value, so
    # this never silently picks up only the first event.
    try:
        doc = json.loads(raw)
        single = _findings_from_result_doc(doc)
        if single is not None:
            return single
    except json.JSONDecodeError:
        pass
    # Fall back to JSONL stream interpretation.
    return _findings_from_jsonl_stream(raw.splitlines())


def adapt_finding(f: dict) -> dict:
    out = {k: f[k] for k in ADAPTER_PASSTHROUGH if k in f}
    if "line_start" in f:
        out["line"] = f["line_start"]
    elif "line" in f:
        out["line"] = f["line"]
    return out


def cmd_build_input(args: argparse.Namespace) -> int:
    findings = [adapt_finding(f) for f in load_codex_findings(args.codex_json)]
    changed_files: list[str] = []
    if args.changed_files_from:
        try:
            with open(args.changed_files_from, encoding="utf-8") as fh:
                changed_files = [ln.strip() for ln in fh if ln.strip()]
        except Exception as e:
            err(f"could not read changed-files list at {args.changed_files_from}: {e}")
    payload = {
        "issue_ref": args.issue_ref,
        "changed_files": changed_files,
        "codex_json": {"findings": findings},
        "project_refs": PROJECT_REFS,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


def parse_validator_output(text: str) -> list[dict]:
    """Parse the validator stdout. Returns one dict per matched finding line.

    Scans the entire stdout for lines matching LINE_RE; non-matching lines
    (blank lines, the three summary lines, and any stray prose) are skipped.

    Why not stop at the first blank line: the validator agent's contract
    forbids prose preamble, but the agent has been observed (PR #8 run
    `26380160257`, fixture validator-prose-preamble.txt) to write a paragraph
    of analysis BEFORE the first `[SEV]` line, separated by a blank line.
    Stopping at the first blank line then parses only prose, returns zero
    matches, and trips the fail-safe `unsure` branch in cmd_write_outputs.
    Full-text scan is robust to prose-before, prose-after, and lines-only
    cases. The summary block (`block_count:`, `bypass_eligible:`, `action:`)
    is naturally rejected by LINE_RE. See claude-harness-work#22.
    """
    parsed: list[dict] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = LINE_RE.match(line)
        if not m:
            continue
        sev, verdict, file_, line_no, citation = m.groups()
        parsed.append({
            "sev": sev.lower(),
            "verdict": verdict,
            "file": file_,
            "line": int(line_no),
            "citation": citation,
            "raw": line,
        })
    return parsed


def decide_block(severity: str, verdict: str) -> bool:
    """Single-model MVP verdict→block table (handoff §5, ADR-0005)."""
    if severity not in ("critical", "high"):
        return False
    # uphold + unsure both block on critical/high; unsure is the fail-safe
    # HITL bypass case (human applies merge-gate-bypass label).
    return verdict in ("uphold", "unsure")


def cmd_write_outputs(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    findings = load_codex_findings(args.codex_json)
    try:
        with open(args.validator_output, encoding="utf-8") as fh:
            validator_text = fh.read()
    except Exception as e:
        err(f"could not read validator output at {args.validator_output}: {e}")
        validator_text = ""
    parsed = parse_validator_output(validator_text)

    if len(findings) != len(parsed):
        err(
            f"validator emitted {len(parsed)} per-finding line(s); "
            f"codex has {len(findings)} finding(s) — fail-safe applied"
        )

    n = max(len(findings), len(parsed))
    aggregate: list[dict] = []
    lines: list[str] = []
    rendered_locations: list[tuple[str, int, str]] = []  # (file, line, citation)

    for i in range(n):
        f = findings[i] if i < len(findings) else None
        p = parsed[i] if i < len(parsed) else None

        if f is not None and p is not None:
            severity = (f.get("severity") or p["sev"]).lower()
            verdict = p["verdict"]
            finding_id = f.get("id") or f"finding-{i}"
            lines.append(p["raw"])
            rendered_locations.append((p["file"], p["line"], p["citation"]))
        elif p is not None:
            # Validator emitted a line we cannot map to a Codex finding.
            severity = p["sev"]
            verdict = p["verdict"]
            finding_id = f"orphan-{i}"
            lines.append(p["raw"])
            rendered_locations.append((p["file"], p["line"], p["citation"]))
        else:
            # Codex finding with no validator verdict — fail-safe to unsure.
            severity = (f.get("severity") or "low").lower()
            verdict = "unsure"
            finding_id = f.get("id") or f"finding-{i}"
            file_ = f.get("file", "?")
            line_no = f.get("line_start", f.get("line", 0))
            citation = "validator output missing for this finding (fail-safe)"
            sev_label = severity.upper()
            lines.append(f"[{sev_label}] {verdict} {file_}:{line_no} — {citation}")
            rendered_locations.append((file_, int(line_no) if isinstance(line_no, (int, str)) and str(line_no).isdigit() else 0, citation))

        block = decide_block(severity, verdict)
        aggregate.append({
            "finding_id": finding_id,
            "severity": severity,
            "verdict": verdict,
            "block": block,
        })

    validators_json = {
        "validators": [{"name": "claude", "raw_stdout": validator_text, "lines": lines}],
        "aggregate": aggregate,
    }
    (out_dir / "validators.json").write_text(
        json.dumps(validators_json, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    counts = {sev: 0 for sev in SEVERITY_ORDER}
    for a in aggregate:
        if a["severity"] in counts:
            counts[a["severity"]] += 1

    block_items: list[str] = []
    for i, a in enumerate(aggregate):
        if not a["block"]:
            continue
        file_, line_no, citation = rendered_locations[i]
        sev_label = a["severity"].upper()
        block_items.append(
            f"- **[{sev_label}] {a['verdict']}** `{file_}:{line_no}` — {citation}"
        )

    soft = args.soft_mode == "true"
    mode_line = (
        "**Mode:** SOFT (report-only — validator verdicts shown, not blocking)"
        if soft
        else "**Mode:** HARD (blocking on upheld/unsure critical/high)"
    )
    md_lines = [
        "### `merge-gate / codex-review` — validator layer",
        "",
        mode_line,
        "",
        "| Severity | Count |",
        "|---|---:|",
        f"| critical | {counts['critical']} |",
        f"| high     | {counts['high']} |",
        f"| medium   | {counts['medium']} |",
        f"| low      | {counts['low']} |",
        "",
    ]
    if block_items:
        md_lines.append(f"**Blocking validator verdicts ({len(block_items)}):**")
        md_lines.append("")
        md_lines.extend(block_items)
        md_lines.append("")
    else:
        md_lines.append("_No blocking validator verdicts._")
        md_lines.append("")

    (out_dir / "validators.md").write_text("\n".join(md_lines), encoding="utf-8")
    return 0


def cmd_write_fallback(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "validators": [],
        "aggregate": [],
        "fallback": args.reason,
    }
    (out_dir / "validators.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    md = (
        "### `merge-gate / codex-review` — validator layer\n"
        "\n"
        f"_Codex did not run; nothing to validate. ({args.reason})_\n"
    )
    (out_dir / "validators.md").write_text(md, encoding="utf-8")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="run-codex-validators deterministic helper")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build-input", help="emit validator <input> JSON on stdout")
    b.add_argument("--codex-json", required=True)
    b.add_argument("--issue-ref", required=True)
    b.add_argument("--changed-files-from", default=None,
                   help="file with one path per line; empty list if missing")
    b.set_defaults(func=cmd_build_input)

    w = sub.add_parser("write-outputs", help="write validators.json + validators.md")
    w.add_argument("--codex-json", required=True)
    w.add_argument("--validator-output", required=True)
    w.add_argument("--soft-mode", required=True, choices=["true", "false"])
    w.add_argument("--out-dir", required=True)
    w.set_defaults(func=cmd_write_outputs)

    fb = sub.add_parser("write-fallback", help="write fallback validators.{json,md}")
    fb.add_argument("--reason", required=True)
    fb.add_argument("--out-dir", required=True)
    fb.set_defaults(func=cmd_write_fallback)

    try:
        args = p.parse_args(argv)
    except SystemExit:
        # argparse already wrote the usage error to stderr; honor the
        # "always exit 0" runtime contract (#05 AC, ADR-0005). The
        # workflow's `Decide check outcome` step is the sole gate.
        return 0
    try:
        return args.func(args)
    except Exception as e:
        err(f"unexpected error in {args.cmd}: {e}")
        out_dir = getattr(args, "out_dir", None)
        if out_dir:
            try:
                d = Path(out_dir)
                d.mkdir(parents=True, exist_ok=True)
                (d / "validators.json").write_text(
                    json.dumps(
                        {"validators": [], "aggregate": [], "fallback": f"internal error: {e}"},
                        indent=2,
                    ) + "\n",
                    encoding="utf-8",
                )
                (d / "validators.md").write_text(
                    "### `merge-gate / codex-review` — validator layer\n\n"
                    f"_Validator layer hit an internal error: {e}_\n",
                    encoding="utf-8",
                )
            except Exception:
                pass
        return 0


if __name__ == "__main__":
    sys.exit(main())

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
    r"^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s+(uphold|dismiss|unsure)\s+id=(\S+)\s+(\S+):(\d+)\s+—\s+(.+)$"
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


def synthesize_id(f: dict, idx: int) -> str:
    """Canonical finding id: Codex's own id when present, else synthesized.

    Used by both build-input (to populate the validator's <input>) and
    write-outputs (to build the findings_by_id lookup). The two callers
    MUST agree on this synthesis or pairing breaks. See ADR-0008.
    """
    fid = f.get("id")
    if isinstance(fid, str) and fid:
        return fid
    return f"finding-{idx}"


def adapt_finding(f: dict, idx: int) -> dict:
    out = {k: f[k] for k in ADAPTER_PASSTHROUGH if k in f}
    out["id"] = synthesize_id(f, idx)
    if "line_start" in f:
        out["line"] = f["line_start"]
    elif "line" in f:
        out["line"] = f["line"]
    return out


def cmd_build_input(args: argparse.Namespace) -> int:
    findings = [adapt_finding(f, i) for i, f in enumerate(load_codex_findings(args.codex_json))]
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
        sev, verdict, fid, file_, line_no, citation = m.groups()
        parsed.append({
            "sev": sev.lower(),
            "verdict": verdict,
            "id": fid,
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

    # Build the identity-based lookup. Each finding's canonical id is what
    # cmd_build_input handed the validator; the validator echoes it back
    # in the `id=<id>` token of LINE_RE. Positional pairing is gone —
    # ADR-0008.
    findings_with_id: list[tuple[str, dict]] = [
        (synthesize_id(f, i), f) for i, f in enumerate(findings)
    ]
    findings_by_id: dict[str, dict] = {fid: f for fid, f in findings_with_id}

    # Group parsed lines by id so the duplicate-id case is observable
    # before we visit each finding.
    parsed_by_id: dict[str, list[dict]] = {}
    for p in parsed:
        parsed_by_id.setdefault(p["id"], []).append(p)

    aggregate: list[dict] = []
    lines: list[str] = []
    rendered_locations: list[tuple[str, int, str]] = []  # (file, line, citation)

    # First pass — Codex findings in input order. Each finding's verdict
    # comes from parsed_by_id[<its id>]; sanity check on (file, line,
    # severity) demotes mismatched verdicts to unsure.
    consumed_parsed_ids: set[str] = set()
    for fid, f in findings_with_id:
        codex_sev = (f.get("severity") or "low").lower()
        codex_file = f.get("file", "?")
        codex_line_raw = f.get("line_start", f.get("line", 0))
        try:
            codex_line = int(codex_line_raw)
        except (TypeError, ValueError):
            codex_line = 0
        matches = parsed_by_id.get(fid, [])

        if len(matches) > 1:
            # Duplicate id from the validator — fail-safe demote.
            consumed_parsed_ids.add(fid)
            err(
                f"validator emitted {len(matches)} lines with id={fid!r}; "
                f"demoting to fail-safe unsure"
            )
            severity = codex_sev
            verdict = "unsure"
            citation = (
                f"duplicate id in validator output (count={len(matches)})"
            )
            sev_label = severity.upper()
            lines.append(
                f"[{sev_label}] {verdict} id={fid} {codex_file}:{codex_line} — {citation}"
            )
            rendered_locations.append((codex_file, codex_line, citation))
        elif len(matches) == 1:
            p = matches[0]
            consumed_parsed_ids.add(fid)
            divergent: list[str] = []
            if p["file"] != codex_file:
                divergent.append("file")
            if p["line"] != codex_line:
                divergent.append("line")
            if p["sev"] != codex_sev:
                divergent.append("severity")
            if divergent:
                # Sanity check tripped — id matched but attributes diverged.
                err(
                    f"sanity check failed for id={fid!r} on "
                    f"{','.join(divergent)} "
                    f"(validator={p['sev']}/{p['file']}:{p['line']}, "
                    f"codex={codex_sev}/{codex_file}:{codex_line}); "
                    f"demoting to fail-safe unsure"
                )
                severity = codex_sev
                verdict = "unsure"
                citation = (
                    f"sanity check failed on {','.join(divergent)} "
                    f"(validator='{p['file']}:{p['line']}', "
                    f"codex='{codex_file}:{codex_line}')"
                )
                sev_label = severity.upper()
                lines.append(
                    f"[{sev_label}] {verdict} id={fid} {codex_file}:{codex_line} — {citation}"
                )
                rendered_locations.append((codex_file, codex_line, citation))
            else:
                # Clean pair. Verdict from validator; severity from Codex
                # (already verified equal to p["sev"]).
                severity = codex_sev
                verdict = p["verdict"]
                lines.append(p["raw"])
                rendered_locations.append((p["file"], p["line"], p["citation"]))
        else:
            # No validator verdict for this Codex finding — preserve the
            # #22 fail-safe path.
            severity = codex_sev
            verdict = "unsure"
            citation = "validator output missing for this finding (fail-safe)"
            sev_label = severity.upper()
            lines.append(
                f"[{sev_label}] {verdict} id={fid} {codex_file}:{codex_line} — {citation}"
            )
            rendered_locations.append((codex_file, codex_line, citation))

        block = decide_block(severity, verdict)
        aggregate.append({
            "finding_id": fid,
            "severity": severity,
            "verdict": verdict,
            "block": block,
        })

    # Second pass — orphan parsed lines whose id matched no Codex finding.
    # Orphans never block, regardless of validator-supplied severity/verdict
    # (refs claude-harness-work#28). The validator's scope contract is
    # `classify Codex findings`, not `author new findings`; an orphan id is
    # a protocol violation, so trusting its severity/verdict to drive
    # `decide_block` would give the validator a side channel to invent its
    # own blockers. The entry is still recorded in `validators.json` as an
    # audit trail of the protocol violation.
    for orphan_idx, p in enumerate(parsed):
        if p["id"] in findings_by_id and p["id"] in consumed_parsed_ids:
            continue
        if p["id"] in findings_by_id:
            # Already consumed under a duplicate-id case.
            continue
        err(
            f"validator emitted id={p['id']!r} with no matching Codex "
            f"finding — recording as orphan (block forced false)"
        )
        severity = p["sev"]
        verdict = p["verdict"]
        finding_id = f"orphan-{orphan_idx}"
        lines.append(p["raw"])
        rendered_locations.append((p["file"], p["line"], p["citation"]))
        aggregate.append({
            "finding_id": finding_id,
            "severity": severity,
            "verdict": verdict,
            "block": False,
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

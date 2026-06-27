"""Committable manifest builder — counts + a single corpus digest, zero titles.

AC #2 / design §4 item7. The manifest pins every run to a gold-set version
(``manifest_sha256``) **without** any raw title leaving the machine:

- per-category seed/query counts, keyed by PII-free blind labels (committable);
- ONE ``sha256`` over the normalized·sorted·concatenated *whole* corpus.

**No per-title hashing** (finding-0): a 7-char-mean ko title's unsalted per-item
hash is dictionary-/brute-force-reversible, so committing per-item hashes would
effectively leak the raw titles into git. Only the single whole-corpus digest is
emitted; per-item identity (if ever needed) is a local keyed-HMAC, never committed.
"""

from __future__ import annotations

import hashlib
import unicodedata

from .dataset import NONE, GoldSet, corpus_strings


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()


def corpus_digest(gold: GoldSet) -> str:
    """sha256 over the normalized, sorted, newline-joined corpus (single digest)."""
    blob = "\n".join(sorted(_normalize(s) for s in corpus_strings(gold)))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def build_manifest(gold: GoldSet) -> dict:
    categories = []
    for c in gold.categories:
        name = c["name"]
        ds = c.get("declared_seeds", {})
        categories.append(
            {
                "name": name,  # blind label — PII-free common noun (§3)
                "held_out": c.get("held_out", False),
                "n_declared_word": len(ds.get("word", [])),
                "n_declared_phrase": len(ds.get("phrase", [])),
                "n_examples": len(c.get("example_seeds", [])),
                "n_queries": sum(1 for q in gold.queries if q.expected == name),
            }
        )
    return {
        "gold_set_version": gold.version,
        "manifest_sha256": corpus_digest(gold),
        "n_rule_categories": len(gold.rule_categories),
        "n_held_out": len(gold.held_out_categories),
        "n_queries_total": len(gold.queries),
        "n_queries_none": sum(1 for q in gold.queries if q.expected == NONE),
        "categories": categories,
        "note": (
            "Aggregates only — zero raw titles. Single whole-corpus digest; "
            "per-title hashing is forbidden (merge-gate finding-0). "
            "self_consistency_mismatch is the operator's cooling-period re-label rate "
            "(single-annotator guard, AC '단일 annotator 라벨 신뢰도 가드')."
        ),
        "self_consistency_mismatch": None,  # operator fills after cooling-period re-label
    }

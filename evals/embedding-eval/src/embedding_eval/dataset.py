"""Gold-set contract: schema, loader/validator, synthetic-ID map, seed-pool builder.

The gold set is the operator's real ko corpus and is PII — it lives under
``_local/gold/<version>.json`` and is never committed. This module is data-blind:
it validates *shape* and maps category names to synthetic IDs (``cat_0`` …) so the
rest of the harness can emit aggregates without the names ever reaching the cloud.

Gold-set schema (form-split, confirmed 2026-06-27)::

    {
      "version": "ko-v1",
      "categories": [
        {
          "name": "<blind label>",            # PII-free common noun (§3); local-only
          "declared_seeds": {                 # cold-start arms — blind-authored
            "word":   ["...", ...],           # arm name_word
            "phrase": ["...", ...]            # arm name_phrase
          },
          "example_seeds": ["...", ...],      # Verified (past confirmed titles)
          "held_out": false                   # true → not a Rule; its queries = none
        },
        ...
      ],
      "queries": [
        {"title": "<raw title>", "expected": "<category name>|none"}
      ]
    }
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# Grades (ADR-0004 §신뢰 등급 2개)
VERIFIED = "verified"  # example_seeds
DECLARED = "declared"  # name + keyword/phrase

NONE = "none"


@dataclass(frozen=True)
class Seed:
    cat: str  # category name (local-only)
    text: str  # seed text (PII)
    grade: str  # VERIFIED | DECLARED


@dataclass(frozen=True)
class Query:
    title: str  # PII
    expected: str  # category name or NONE


@dataclass(frozen=True)
class GoldSet:
    version: str
    categories: list[dict]
    queries: list[Query]

    @property
    def rule_categories(self) -> list[str]:
        """Category names that become Rules (held_out excluded)."""
        return [c["name"] for c in self.categories if not c.get("held_out", False)]

    @property
    def held_out_categories(self) -> list[str]:
        return [c["name"] for c in self.categories if c.get("held_out", False)]


class GoldSetError(ValueError):
    """Raised when a gold set violates the schema contract."""


def load_gold_set(path: Path) -> GoldSet:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return _validate(raw)


def _validate(raw: dict) -> GoldSet:
    if not isinstance(raw, dict):
        raise GoldSetError("gold set must be a JSON object")
    version = raw.get("version")
    if not isinstance(version, str) or not version:
        raise GoldSetError("missing/empty 'version' string")

    categories = raw.get("categories")
    if not isinstance(categories, list) or not categories:
        raise GoldSetError("'categories' must be a non-empty list")

    names: list[str] = []
    for i, c in enumerate(categories):
        name = c.get("name")
        if not isinstance(name, str) or not name:
            raise GoldSetError(f"category[{i}] missing 'name'")
        if name == NONE:
            raise GoldSetError("category name 'none' is reserved")
        ds = c.get("declared_seeds", {})
        if not isinstance(ds, dict) or set(ds) - {"word", "phrase"}:
            raise GoldSetError(f"category '{name}' declared_seeds must be {{word?, phrase?}}")
        for form in ("word", "phrase"):
            if not all(isinstance(s, str) and s for s in ds.get(form, [])):
                raise GoldSetError(f"category '{name}' declared_seeds.{form} must be non-empty strings")
        if not all(isinstance(s, str) and s for s in c.get("example_seeds", [])):
            raise GoldSetError(f"category '{name}' example_seeds must be non-empty strings")
        names.append(name)

    if len(set(names)) != len(names):
        raise GoldSetError("category names must be unique")
    rule_names = {c["name"] for c in categories if not c.get("held_out", False)}
    held_out = {c["name"] for c in categories if c.get("held_out", False)}
    if not rule_names:
        raise GoldSetError("at least one non-held-out category is required")

    queries_raw = raw.get("queries")
    if not isinstance(queries_raw, list) or not queries_raw:
        raise GoldSetError("'queries' must be a non-empty list")
    queries: list[Query] = []
    for i, q in enumerate(queries_raw):
        title = q.get("title")
        expected = q.get("expected")
        if not isinstance(title, str) or not title:
            raise GoldSetError(f"query[{i}] missing 'title'")
        if expected not in rule_names and expected != NONE:
            # A held-out category's title must be labelled none, not its own name.
            if expected in held_out:
                raise GoldSetError(
                    f"query[{i}] expected '{expected}' is held-out → must be labelled 'none'"
                )
            raise GoldSetError(f"query[{i}] expected '{expected}' is not a Rule category or 'none'")
        queries.append(Query(title=title, expected=expected))

    return GoldSet(version=version, categories=categories, queries=queries)


def synthetic_id_map(gold: GoldSet) -> dict[str, str]:
    """Deterministic category-name → ``cat_N`` map (Rule categories, file order).

    Held-out categories are not prediction targets; their queries surface as
    ``none``. The map is local-only — only the IDs may reach wandb (AC #9).
    """
    return {name: f"cat_{i}" for i, name in enumerate(gold.rule_categories)}


def build_seed_pool(gold: GoldSet, *, keyword_form_arm: str, include_examples: bool) -> list[Seed]:
    """Seeds for the non-held-out categories under one (keyword_form, examples) config.

    - name_only   → Declared = [name]
    - name_word   → Declared = [name] + declared_seeds.word
    - name_phrase → Declared = [name] + declared_seeds.phrase
    Verified example_seeds are added iff ``include_examples`` (cold-start arms pass False).
    """
    if keyword_form_arm not in ("name_only", "name_word", "name_phrase"):
        raise GoldSetError(f"unknown keyword_form_arm: {keyword_form_arm}")
    pool: list[Seed] = []
    for c in gold.categories:
        if c.get("held_out", False):
            continue
        name = c["name"]
        declared = [name]
        if keyword_form_arm == "name_word":
            declared += c.get("declared_seeds", {}).get("word", [])
        elif keyword_form_arm == "name_phrase":
            declared += c.get("declared_seeds", {}).get("phrase", [])
        for text in declared:
            pool.append(Seed(cat=name, text=text, grade=DECLARED))
        if include_examples:
            for text in c.get("example_seeds", []):
                pool.append(Seed(cat=name, text=text, grade=VERIFIED))
    return pool


def corpus_strings(gold: GoldSet) -> list[str]:
    """Every seed + query string in the gold set (for the manifest digest)."""
    out: list[str] = []
    for c in gold.categories:
        out.append(c["name"])
        ds = c.get("declared_seeds", {})
        out += ds.get("word", [])
        out += ds.get("phrase", [])
        out += c.get("example_seeds", [])
    out += [q.title for q in gold.queries]
    return out

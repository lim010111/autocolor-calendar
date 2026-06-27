"""Gold-set builder: ``.ics`` → deduped title worksheet → assembled gold set.

Collapses the operator's manual gold-set authoring (OPERATOR-GUIDE §A) down to two
*judgement* inputs; everything mechanical is done here:

  operator input            this module (mechanical)
  ----------------------    -------------------------------------------------
  author blind categories   .ics parse · §3 noise filter · signal-window clip ·
    + declared_seeds         dedup-before-split · temporal split (early=example,
  label each title            late=query) · JSON assembly · schema validation

Flow (two commands, blind-authoring kept structurally separate):

  1. ``gold-ingest --ics <path> --version ko-v1``
       → ``_local/gold/ko-v1.titles.tsv`` (one row per deduped title, column 1 blank)
       → ``_local/gold/ko-v1.categories.json`` template (if absent)
  2. operator authors ``categories.json`` FROM MEMORY (never reverse-engineered from
     the titles — design §4.3) and fills column 1 of the ``.tsv``
  3. ``gold-assemble --version ko-v1`` → ``_local/gold/ko-v1.json`` (validated)

Every file lives under ``_local/gold/`` (git-ignored). Raw titles never leave it.
"""

from __future__ import annotations

import json
import random
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from . import config
from .dataset import load_gold_set

# Signal window (design §3 / OPERATOR-GUIDE A.2): 2025-09 .. 2026-06 inclusive.
DEFAULT_WINDOW = ("2025-09", "2026-06")
EXAMPLE_FRAC = 0.5  # early fraction of a category's titles → example_seeds (Verified)
MIN_TEMPORAL = 6  # below this, split randomly not temporally (design §4.2 fallback)
SPLIT_SEED = config.SEED

_PLACEHOLDER = "?"  # unlabeled marker in column 1 of the worksheet
_AUTO_BIRTHDAY = re.compile(r"생일\s*축하합니다|님의\s*생일$")  # Google auto-birthday events
_WS = re.compile(r"\s+")


class GoldBuildError(ValueError):
    """Raised when the worksheet / categories file cannot be assembled into a gold set."""


# --- .ics parsing ---------------------------------------------------------


@dataclass(frozen=True)
class Event:
    summary: str
    date8: str  # DTSTART as YYYYMMDD ("" if unparseable)
    all_day: bool


def _unfold(text: str) -> list[str]:
    """RFC 5545 line unfolding: a leading space/tab continues the previous line."""
    out: list[str] = []
    for line in text.splitlines():
        if line[:1] in (" ", "\t") and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def _unescape(v: str) -> str:
    return (
        v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
    )


def parse_ics(text: str) -> list[Event]:
    events: list[Event] = []
    in_ve = False
    summary = ""
    date8 = ""
    all_day = False
    for line in _unfold(text):
        if line.rstrip() == "BEGIN:VEVENT":
            in_ve, summary, date8, all_day = True, "", "", False
            continue
        if line.rstrip() == "END:VEVENT":
            if in_ve:
                events.append(Event(summary=summary.strip(), date8=date8, all_day=all_day))
            in_ve = False
            continue
        if not in_ve or ":" not in line:
            continue
        head, _, value = line.partition(":")
        name = head.split(";", 1)[0].upper()
        if name == "SUMMARY":
            summary = _unescape(value)
        elif name == "DTSTART":
            digits = re.sub(r"\D", "", value)[:8]
            date8 = digits if len(digits) == 8 else ""
            all_day = "VALUE=DATE" in head.upper() and "DATE-TIME" not in head.upper()
    return events


# --- noise + window (design §3) -------------------------------------------


def _ym(date8: str) -> str:
    return f"{date8[:4]}-{date8[4:6]}" if len(date8) == 8 else ""


def is_noise(e: Event) -> bool:
    """Conservative auto-drop (design §3): empty title, future-projected all-day
    birthday repeats (≥2027 종일), Google auto-birthday events. Ambiguous all-day
    (공휴일 vs 중간고사) is NOT auto-dropped — it flows to labelling where the
    operator can mark it ``x``."""
    if not e.summary:
        return True
    if e.all_day and e.date8[:4] >= "2027":
        return True
    if _AUTO_BIRTHDAY.search(e.summary):
        return True
    return False


def in_window(e: Event, start: str, end: str) -> bool:
    ym = _ym(e.date8)
    return bool(ym) and start <= ym <= end


# --- dedup-before-split (design §4.1) -------------------------------------


def normalize_title(s: str) -> str:
    return _WS.sub(" ", unicodedata.normalize("NFC", s).strip())


@dataclass
class TitleRow:
    title: str  # representative surface form (the earliest occurrence)
    earliest: str  # YYYYMMDD
    count: int


def dedup(events: list[Event]) -> list[TitleRow]:
    """Fold to unique normalized titles; keep the earliest occurrence's surface
    form + earliest date + raw count. (Exact-duplicate habit titles collapse to
    one representative so a seed can't exact-match its own query — design §4.1.)"""
    by_norm: dict[str, TitleRow] = {}
    for e in events:
        key = normalize_title(e.summary)
        if not key:
            continue
        row = by_norm.get(key)
        if row is None:
            by_norm[key] = TitleRow(title=e.summary.strip(), earliest=e.date8, count=1)
        else:
            row.count += 1
            if e.date8 and (not row.earliest or e.date8 < row.earliest):
                row.earliest = e.date8
                row.title = e.summary.strip()
    return sorted(by_norm.values(), key=lambda r: (r.earliest or "99999999", r.title))


# --- worksheet (titles.tsv) + categories template ------------------------


def titles_tsv_path(version: str) -> Path:
    return config.GOLD_DIR / f"{version}.titles.tsv"


def categories_path(version: str) -> Path:
    return config.GOLD_DIR / f"{version}.categories.json"


def write_titles_tsv(rows: list[TitleRow], path: Path) -> None:
    lines = [
        "# embedding-eval gold-set labelling worksheet — fill column 1 (replace ?).",
        "#   <category name>  use a name from the *.categories.json you author",
        "#   none             irrelevant / held-out title → negative query (expected=none)",
        "#   x                noise → drop entirely (not in the gold set)",
        "#   ?                still to do",
        "# edit COLUMN 1 ONLY. blind-author categories.json from memory BEFORE peeking here.",
        "category\ttitle\tearliest\tcount",
    ]
    for r in rows:
        lines.append(f"{_PLACEHOLDER}\t{r.title}\t{r.earliest}\t{r.count}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def read_titles_tsv(path: Path) -> list[tuple[str, str, str]]:
    """→ list of (label, title, earliest). Comments / header / blank lines skipped."""
    rows: list[tuple[str, str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#") or line.startswith("category\t"):
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            raise GoldBuildError(f"malformed worksheet row (need 4 tab columns): {parts[:1]}")
        rows.append((parts[0].strip(), parts[1], parts[2].strip()))
    return rows


def categories_template(version: str) -> dict:
    return {
        "version": version,
        "categories": [
            {
                "name": "<블라인드 일반명사 라벨 — 인명·기관 금지>",
                "declared_seeds": {"word": [], "phrase": []},
                "held_out": False,
            }
        ],
    }


# --- temporal split (design §4.2) -----------------------------------------


def temporal_split(
    items: list[tuple[str, str]],
    *,
    example_frac: float = EXAMPLE_FRAC,
    min_temporal: int = MIN_TEMPORAL,
    seed: int = SPLIT_SEED,
) -> tuple[list[str], list[str]]:
    """Split one category's (title, date8) items into (example_seeds, query_titles).

    ≥ ``min_temporal`` items → sort by date, early ``example_frac`` = examples (the
    "confirmed past"), late = queries (prod causality + style-drift test). Smaller
    categories fall back to a seeded shuffle (date order is noise at small n).
    n==1 → the single title is a query (a Rule still stands on its declared seeds).
    """
    n = len(items)
    if n == 0:
        return [], []
    if n >= min_temporal:
        ordered = sorted(items, key=lambda t: (t[1] or "99999999", t[0]))
    else:
        ordered = list(items)
        random.Random(seed).shuffle(ordered)
    n_ex = 0 if n == 1 else max(1, min(round(n * example_frac), n - 1))
    return [t[0] for t in ordered[:n_ex]], [t[0] for t in ordered[n_ex:]]


# --- assembly -------------------------------------------------------------


def assemble(
    version: str,
    *,
    example_frac: float = EXAMPLE_FRAC,
    min_temporal: int = MIN_TEMPORAL,
    allow_unlabeled: bool = False,
) -> dict:
    cats_raw = json.loads(categories_path(version).read_text(encoding="utf-8"))
    rows = read_titles_tsv(titles_tsv_path(version))
    cat_names = {c["name"] for c in cats_raw["categories"]}
    held_out = {c["name"] for c in cats_raw["categories"] if c.get("held_out", False)}

    by_cat: dict[str, list[tuple[str, str]]] = {name: [] for name in cat_names}
    none_titles: list[str] = []
    unlabeled = 0
    unknown: set[str] = set()
    for label, title, earliest in rows:
        if label in ("", _PLACEHOLDER):
            unlabeled += 1
        elif label in ("x", "X", "drop"):
            continue
        elif label == "none":
            none_titles.append(title)
        elif label in cat_names:
            by_cat[label].append((title, earliest))
        else:
            unknown.add(label)
    if unknown:
        raise GoldBuildError(
            f"unknown category labels in worksheet: {sorted(unknown)} "
            f"— not declared in {version}.categories.json"
        )
    if unlabeled and not allow_unlabeled:
        raise GoldBuildError(
            f"{unlabeled} titles still unlabeled (?) — finish labelling or pass --allow-unlabeled"
        )

    queries: list[dict] = []
    out_categories: list[dict] = []
    for c in cats_raw["categories"]:
        name = c["name"]
        ds = c.get("declared_seeds", {})
        entry = {
            "name": name,
            "declared_seeds": {"word": ds.get("word", []), "phrase": ds.get("phrase", [])},
            "example_seeds": [],
            "held_out": bool(c.get("held_out", False)),
        }
        items = by_cat.get(name, [])
        if name in held_out:
            queries += [{"title": t, "expected": "none"} for t, _ in items]  # held-out → negatives
        else:
            examples, q = temporal_split(items, example_frac=example_frac, min_temporal=min_temporal)
            entry["example_seeds"] = examples
            queries += [{"title": t, "expected": name} for t in q]
        out_categories.append(entry)
    queries += [{"title": t, "expected": "none"} for t in none_titles]

    return {"version": cats_raw.get("version", version), "categories": out_categories, "queries": queries}


def assemble_and_write(version: str, **kw) -> tuple[dict, Path, object]:
    """Assemble, write ``_local/gold/<version>.json``, then validate by loading it."""
    gold = assemble(version, **kw)
    out = config.gold_path(version)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(gold, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return gold, out, load_gold_set(out)  # raises GoldSetError on bad shape


def ingest_ics(ics_path: str | Path, version: str, *, window: tuple[str, str] = DEFAULT_WINDOW) -> dict:
    text = Path(ics_path).read_text(encoding="utf-8", errors="replace")
    events = parse_ics(text)
    kept = [e for e in events if not is_noise(e) and in_window(e, *window)]
    rows = dedup(kept)
    config.GOLD_DIR.mkdir(parents=True, exist_ok=True)
    write_titles_tsv(rows, titles_tsv_path(version))
    cpath = categories_path(version)
    wrote_template = not cpath.exists()
    if wrote_template:
        cpath.write_text(
            json.dumps(categories_template(version), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return {
        "n_vevent": len(events),
        "n_kept": len(kept),
        "n_unique": len(rows),
        "titles_tsv": titles_tsv_path(version),
        "categories_json": cpath,
        "wrote_template": wrote_template,
    }

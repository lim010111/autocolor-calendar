"""Builder mechanics — parse/noise/window/dedup + temporal-split assembly.

All fixtures are synthetic ascii (no PII). Asserts the assembled gold set passes
the real ``dataset._validate`` so the worksheet path can never emit a bad shape.
"""

from __future__ import annotations

import json

from embedding_eval import build_gold as bg
from embedding_eval.dataset import load_gold_set

ICS = """\
BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:lunch
DTSTART:20251001T120000
END:VEVENT
BEGIN:VEVENT
SUMMARY:lunch
DTSTART:20251115T120000
END:VEVENT
BEGIN:VEVENT
SUMMARY:gym session
DTSTART:20251002T070000
END:VEVENT
BEGIN:VEVENT
SUMMARY:
DTSTART:20251003T090000
END:VEVENT
BEGIN:VEVENT
SUMMARY:Alice님의 생일
DTSTART;VALUE=DATE:20251004
END:VEVENT
BEGIN:VEVENT
SUMMARY:projected birthday
DTSTART;VALUE=DATE:20270404
END:VEVENT
BEGIN:VEVENT
SUMMARY:out of window
DTSTART:20240101T120000
END:VEVENT
BEGIN:VEVENT
SUMMARY:study\\, evening
DTSTART:20251201T200000
END:VEVENT
END:VCALENDAR
"""


def test_parse_and_unescape():
    events = bg.parse_ics(ICS)
    summaries = {e.summary for e in events}
    assert "study, evening" in summaries  # \, unescaped
    birthday = next(e for e in events if e.summary == "Alice님의 생일")
    assert birthday.all_day is True and birthday.date8 == "20251004"


def test_noise_and_window_filter():
    events = bg.parse_ics(ICS)
    kept = [e for e in events if not bg.is_noise(e) and bg.in_window(e, *bg.DEFAULT_WINDOW)]
    titles = {e.summary for e in kept}
    assert titles == {"lunch", "gym session", "study, evening"}
    # dropped: empty summary, auto-birthday, ≥2027 all-day, 2024 out-of-window


def test_dedup_keeps_earliest_and_counts():
    events = [e for e in bg.parse_ics(ICS) if not bg.is_noise(e) and bg.in_window(e, *bg.DEFAULT_WINDOW)]
    rows = {r.title: r for r in bg.dedup(events)}
    assert rows["lunch"].count == 2
    assert rows["lunch"].earliest == "20251001"  # earliest of the two occurrences


def test_temporal_split_early_is_example():
    items = [("late", "20260601"), ("mid", "20260301"), ("early", "20260101")]
    # n < MIN_TEMPORAL falls back to seeded shuffle; force temporal by lowering the bar
    ex, q = bg.temporal_split(items, example_frac=0.5, min_temporal=2)
    assert "early" in ex and "late" in q  # earliest → example, latest → query


def test_temporal_split_singleton_is_query():
    ex, q = bg.temporal_split([("solo", "20260101")], min_temporal=2)
    assert ex == [] and q == ["solo"]


def test_assemble_roundtrips_through_validator(tmp_path, monkeypatch):
    monkeypatch.setattr(bg.config, "GOLD_DIR", tmp_path)
    monkeypatch.setattr(bg.config, "LOCAL_DIR", tmp_path)
    version = "synth-v1"

    # worksheet: two rule categories, one held-out, one none, one drop
    rows = [
        bg.TitleRow("breakfast", "20251001", 1),
        bg.TitleRow("dinner", "20260101", 1),
        bg.TitleRow("squats", "20251002", 1),
        bg.TitleRow("deadlift", "20260102", 1),
        bg.TitleRow("night shift", "20251005", 1),
        bg.TitleRow("random noise", "20251006", 1),
        bg.TitleRow("unrelated", "20251007", 1),
    ]
    bg.write_titles_tsv(rows, bg.titles_tsv_path(version))
    # operator labels column 1
    labelled = "\n".join(
        [
            "meals\tbreakfast\t20251001\t1",
            "meals\tdinner\t20260101\t1",
            "workout\tsquats\t20251002\t1",
            "workout\tdeadlift\t20260102\t1",
            "shift\tnight shift\t20251005\t1",
            "x\trandom noise\t20251006\t1",
            "none\tunrelated\t20251007\t1",
        ]
    )
    bg.titles_tsv_path(version).write_text(labelled + "\n", encoding="utf-8")

    bg.categories_path(version).write_text(
        json.dumps(
            {
                "version": version,
                "categories": [
                    {"name": "meals", "declared_seeds": {"word": ["food"], "phrase": []}, "held_out": False},
                    {"name": "workout", "declared_seeds": {"word": ["gym"], "phrase": []}, "held_out": False},
                    {"name": "shift", "declared_seeds": {"word": [], "phrase": []}, "held_out": True},
                ],
            }
        ),
        encoding="utf-8",
    )

    gold, out, loaded = bg.assemble_and_write(version, example_frac=0.5, min_temporal=2)
    reloaded = load_gold_set(out)  # full schema validation
    assert reloaded.version == version
    assert set(reloaded.rule_categories) == {"meals", "workout"}
    assert reloaded.held_out_categories == ["shift"]
    expecteds = {q.expected for q in reloaded.queries}
    assert "none" in expecteds  # held-out + unrelated → negatives
    # earliest title of each rule category became its example_seed
    meals = next(c for c in gold["categories"] if c["name"] == "meals")
    assert meals["example_seeds"] == ["breakfast"]


def test_assemble_rejects_unlabeled(tmp_path, monkeypatch):
    monkeypatch.setattr(bg.config, "GOLD_DIR", tmp_path)
    version = "synth-v2"
    bg.write_titles_tsv([bg.TitleRow("todo", "20251001", 1)], bg.titles_tsv_path(version))
    bg.categories_path(version).write_text(
        json.dumps({"version": version, "categories": [{"name": "m", "declared_seeds": {}, "held_out": False}]}),
        encoding="utf-8",
    )
    try:
        bg.assemble(version)
        raise AssertionError("expected GoldBuildError on unlabeled rows")
    except bg.GoldBuildError as e:
        assert "unlabeled" in str(e)


def test_assemble_rejects_unknown_label(tmp_path, monkeypatch):
    monkeypatch.setattr(bg.config, "GOLD_DIR", tmp_path)
    version = "synth-v3"
    bg.titles_tsv_path(version).write_text(
        "category\ttitle\tearliest\tcount\nmystery\tx\t20251001\t1\n", encoding="utf-8"
    )
    bg.categories_path(version).write_text(
        json.dumps({"version": version, "categories": [{"name": "m", "declared_seeds": {}, "held_out": False}]}),
        encoding="utf-8",
    )
    try:
        bg.assemble(version)
        raise AssertionError("expected GoldBuildError on unknown label")
    except bg.GoldBuildError as e:
        assert "unknown category" in str(e)

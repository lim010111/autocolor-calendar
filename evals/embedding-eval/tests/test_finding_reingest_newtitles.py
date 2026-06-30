"""Finding repro: a second ``gold-ingest`` of a NEW export silently drops new titles.

The prior fix (see ``test_finding_overwrite.py``) made ``ingest_ics`` write-guard the
worksheet: ``wrote_worksheet = not tpath.exists()`` and ``write_titles_tsv(...)`` only
runs when the worksheet is absent. That preserves operator labels on re-ingest — good —
but it also means the EXISTING worksheet is left completely untouched. So if the operator
re-exports their calendar to a NEW ``.ics`` containing titles that weren't in the first
export and re-runs ``gold-ingest``, those new titles are never added to the worksheet, and
``gold-assemble`` (which reads only the preserved worksheet) never sees them.

This test proves the defect: it ingests A+B, labels them, then re-ingests A+B+C and asserts
BOTH that C appears (as a fresh ``?`` row) AND that A/B keep their operator labels. On HEAD
the C assertion FAILS (worksheet preserved unchanged, new title dropped). It does not
contradict the frozen oracle ``test_finding_overwrite.py``: labels must still survive.
"""

from __future__ import annotations

from embedding_eval import build_gold as bg

# First export: two ascii titles, both inside the signal window (2025-09 .. 2026-06).
ICS1 = """\
BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:lunch
DTSTART:20251001T120000
END:VEVENT
BEGIN:VEVENT
SUMMARY:gym session
DTSTART:20251002T070000
END:VEVENT
END:VCALENDAR
"""

# Second export: A and B again, PLUS a brand-new title C (also inside the window).
ICS2 = """\
BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:lunch
DTSTART:20251001T120000
END:VEVENT
BEGIN:VEVENT
SUMMARY:gym session
DTSTART:20251002T070000
END:VEVENT
BEGIN:VEVENT
SUMMARY:dentist appointment
DTSTART:20260103T090000
END:VEVENT
END:VCALENDAR
"""


def test_second_ingest_picks_up_new_titles(tmp_path, monkeypatch):
    monkeypatch.setattr(bg.config, "GOLD_DIR", tmp_path)
    version = "synth-reingest"

    ics1 = tmp_path / "export1.ics"
    ics1.write_text(ICS1, encoding="utf-8")
    ics2 = tmp_path / "export2.ics"
    ics2.write_text(ICS2, encoding="utf-8")

    # 1) First ingest → worksheet with column 1 = "?" placeholders for A and B.
    bg.ingest_ics(ics1, version)
    tsv = bg.titles_tsv_path(version)
    first = bg.read_titles_tsv(tsv)
    assert {t for _, t, _ in first} == {"lunch", "gym session"}
    assert all(label == "?" for label, _, _ in first)  # nothing labelled yet

    # 2) Operator labels column 1 — same rows, "?" → real category labels.
    labels = {"lunch": "meals", "gym session": "workout"}
    rows = bg.dedup(bg.parse_ics(ICS1))
    labelled = "\n".join(
        ["category\ttitle\tearliest\tcount"]
        + [f"{labels[r.title]}\t{r.title}\t{r.earliest}\t{r.count}" for r in rows]
    )
    tsv.write_text(labelled + "\n", encoding="utf-8")

    # 3) Operator re-exports their calendar (now with a NEW event "dentist appointment")
    #    and re-runs gold-ingest to fold the new title into the worksheet.
    bg.ingest_ics(ics2, version)

    after = {t: label for label, t, _ in bg.read_titles_tsv(tsv)}

    # 3a) The operator's labels MUST survive (frozen-oracle requirement, #01 finding 1).
    assert after.get("lunch") == "meals" and after.get("gym session") == "workout", (
        f"operator labels were clobbered by the second ingest: {after}"
    )

    # 3b) The NEW title MUST be picked up as an unlabeled ("?") row so gold-assemble
    #     can see it. On HEAD this FAILS: the worksheet is preserved untouched and the
    #     new title is silently dropped.
    assert "dentist appointment" in after, (
        f"new title from the re-export was silently dropped: {sorted(after)}"
    )
    assert after["dentist appointment"] == "?", (
        f"new title should land unlabeled (?), got: {after['dentist appointment']!r}"
    )

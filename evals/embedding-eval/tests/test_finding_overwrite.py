"""Finding repro: a second ``gold-ingest`` silently destroys operator labels.

``ingest_ics`` write-guards the categories template (``wrote_template = not
cpath.exists()``) but writes the title worksheet UNCONDITIONALLY via
``write_titles_tsv(...)``. So re-running ``gold-ingest`` (e.g. to fold in a newly
exported ``.ics``, or by mistake) AFTER column 1 has been labelled overwrites the
worksheet with fresh ``?`` placeholders — the labelling judgement is lost.

This test proves the defect: it labels the worksheet, re-ingests, and asserts the
labels survive. On HEAD the assertion FAILS (labels replaced by ``?``).
"""

from __future__ import annotations

from embedding_eval import build_gold as bg

# Two ascii titles, both inside the signal window (2025-09 .. 2026-06).
ICS = """\
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


def test_second_ingest_preserves_operator_labels(tmp_path, monkeypatch):
    monkeypatch.setattr(bg.config, "GOLD_DIR", tmp_path)
    version = "synth-overwrite"

    ics_path = tmp_path / "export.ics"
    ics_path.write_text(ICS, encoding="utf-8")

    # 1) First ingest → worksheet with column 1 = "?" placeholders.
    bg.ingest_ics(ics_path, version)
    tsv = bg.titles_tsv_path(version)
    first = bg.read_titles_tsv(tsv)
    assert {t for _, t, _ in first} == {"lunch", "gym session"}
    assert all(label == "?" for label, _, _ in first)  # nothing labelled yet

    # 2) Operator labels column 1 — same rows, "?" → real category labels.
    labels = {"lunch": "meals", "gym session": "workout"}
    rows = bg.dedup([e for e in bg.parse_ics(ICS)])
    labelled = "\n".join(
        ["category\ttitle\tearliest\tcount"]
        + [f"{labels[r.title]}\t{r.title}\t{r.earliest}\t{r.count}" for r in rows]
    )
    tsv.write_text(labelled + "\n", encoding="utf-8")

    # 3) Second ingest with the SAME args (operator re-runs to fold in new export,
    #    or by mistake). The labelled worksheet already exists on disk.
    bg.ingest_ics(ics_path, version)

    # 4) The operator's labels MUST survive. On HEAD they do not — write_titles_tsv
    #    overwrites column 1 with "?" placeholders, destroying the labelling work.
    after = {t: label for label, t, _ in bg.read_titles_tsv(tsv)}
    assert after == {"lunch": "meals", "gym session": "workout"}, (
        f"operator labels were destroyed by the second ingest: {after}"
    )

"""Finding repro — TSV worksheet round-trip is not newline/tab safe.

``parse_ics`` legitimately produces titles with embedded newlines (iCalendar
``SUMMARY`` escapes ``\\n`` → real newline via ``_unescape``). ``write_titles_tsv``
interpolates the raw title into a ``\\t``-joined, ``\\n``-joined line with no
escaping, and ``read_titles_tsv`` parses one physical line at a time and requires
>=4 tab columns. A title with an embedded newline therefore splits one logical
row into two physical lines on read-back; a title with an embedded tab shifts the
columns. Either way the round-trip does not recover the original title.

These tests assert the round-trip is faithful (exactly one row, title preserved).
On current HEAD they FAIL, proving the corruption.
"""

from __future__ import annotations

from embedding_eval import build_gold as bg


def test_round_trip_preserves_embedded_newline(tmp_path):
    # parse_ics(_unescape) turns an iCalendar SUMMARY "\n" into a real newline,
    # so this is a title the pipeline can genuinely produce.
    title = "line one\nline two"
    row = bg.TitleRow(title=title, earliest="20251001", count=1)
    path = tmp_path / "ko.titles.tsv"

    bg.write_titles_tsv([row], path)
    parsed = bg.read_titles_tsv(path)  # raises GoldBuildError on HEAD (split row)

    assert len(parsed) == 1, f"newline split one logical row into {len(parsed)} physical rows"
    label, got_title, earliest = parsed[0]
    assert got_title == title  # truncated to "line one" on HEAD
    assert earliest == "20251001"


def test_round_trip_preserves_embedded_tab(tmp_path):
    # iCalendar does not escape TAB, so a literal tab in a SUMMARY survives parse
    # and lands verbatim in the title.
    title = "before\tafter"
    row = bg.TitleRow(title=title, earliest="20251002", count=3)
    path = tmp_path / "ko.titles.tsv"

    bg.write_titles_tsv([row], path)
    parsed = bg.read_titles_tsv(path)

    assert len(parsed) == 1
    label, got_title, earliest = parsed[0]
    assert label == bg._PLACEHOLDER  # column 1 is the label, not "after"/title fragment
    assert got_title == title  # tab shifts columns; title is misread on HEAD

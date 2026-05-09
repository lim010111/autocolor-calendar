"""Stage 6 — translate the en suite into ko / zh-CN / zh-TW via Batch API.

Strategy:
1. Collect every unique English string we need translated for the requested
   languages (category names, keywords, event summaries).
2. Emit one JSONL request per (lang, string) into a single Batch job. Custom
   IDs encode ``L<lang_index>-S<string_index>`` so we can rebuild a per-lang
   translation map from the unordered output.
3. After completion, rebuild each ``{lang}/classification.json`` by walking
   the en suite and substituting strings — preserving every other field
   (id, tag, expected, colorId) so case ids stay 1:1 across languages.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from .config import (
    BATCH_MAX_WAIT_SECONDS,
    BATCH_POLL_INTERVAL_SECONDS,
    BATCH_TERMINAL_STATUSES,
    DATA_DIR,
    EN_DATASET_PATH,
    LABEL_REASONING_EFFORT,
    TRANSLATE_MODEL,
    dataset_path,
)
from .openai_client import get_client

_LANG_NAMES = {
    "ko": "Korean (한국어)",
    "zh-CN": "Simplified Chinese (简体中文)",
    "zh-TW": "Traditional Chinese (繁體中文)",
}

_SYSTEM_PROMPT = (
    "You translate short English calendar text into {lang_name} for an "
    "evaluation dataset. Keep the translation natural, concise, and faithful "
    "to the activity. Do not transliterate; do not add commentary; preserve "
    "proper nouns (people, brands, song titles) when they would not be "
    "translated in normal usage. Output only the translation in JSON."
)

_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["translation"],
    "properties": {"translation": {"type": "string"}},
}


def _collect_strings(en_doc: dict) -> list[str]:
    """Unique English strings (preserving first-seen order) for translation."""
    seen: dict[str, None] = {}
    for cat in en_doc["cases"][0]["categories"]:
        seen.setdefault(cat["name"], None)
        for kw in cat["keywords"]:
            seen.setdefault(kw, None)
    for case in en_doc["cases"]:
        seen.setdefault(case["event"]["summary"], None)
    return list(seen.keys())


def _build_request(custom_id: str, lang: str, text: str) -> dict:
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": TRANSLATE_MODEL,
            "reasoning_effort": LABEL_REASONING_EFFORT,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT.format(lang_name=_LANG_NAMES[lang])},
                {"role": "user", "content": text},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "translation",
                    "strict": True,
                    "schema": _RESPONSE_SCHEMA,
                },
            },
        },
    }


def _await_batch(client, batch_id: str) -> None:
    started = time.monotonic()
    last_status = ""
    while True:
        batch = client.batches.retrieve(batch_id)
        if batch.status != last_status:
            print(f"[translate] batch {batch_id[:12]}… status={batch.status}")
            last_status = batch.status
        if batch.status in BATCH_TERMINAL_STATUSES:
            if batch.status != "completed":
                raise RuntimeError(f"batch {batch_id} ended with status={batch.status}")
            return
        if time.monotonic() - started > BATCH_MAX_WAIT_SECONDS:
            raise RuntimeError(f"batch {batch_id} did not complete within 24h")
        time.sleep(BATCH_POLL_INTERVAL_SECONDS)


def _download(client, file_id: str) -> list[dict]:
    raw = client.files.content(file_id).read()
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def _parse_translation(line: dict) -> str:
    body = line.get("response", {}).get("body", {})
    content = body["choices"][0]["message"]["content"]
    return json.loads(content)["translation"].strip()


def _apply(en_doc: dict, lang: str, table: dict[str, str]) -> dict:
    def t(s: str) -> str:
        out = table.get(s)
        if not out:
            raise RuntimeError(f"no translation produced for {s!r} in {lang}")
        return out

    out = json.loads(json.dumps(en_doc))  # deep copy
    out["lang"] = lang
    out["generator"]["translate_model"] = TRANSLATE_MODEL
    out["generator"]["translated_at"] = datetime.now(UTC).isoformat()
    out["description"] = (
        out["description"] + f" Translated to {_LANG_NAMES[lang]} via {TRANSLATE_MODEL}."
    )
    for cat in out["cases"][0]["categories"]:
        cat["name"] = t(cat["name"])
        cat["keywords"] = [t(k) for k in cat["keywords"]]
    # categories[] is shared by reference across cases; rewrite only on the
    # first case then re-link the same list onto every other case so equality
    # is preserved.
    shared_categories = out["cases"][0]["categories"]
    name_map = {en_cat["name"]: t_cat["name"] for en_cat, t_cat in zip(en_doc["cases"][0]["categories"], shared_categories, strict=False)}
    for case in out["cases"]:
        case["categories"] = shared_categories
        case["event"]["summary"] = t(case["event"]["summary"])
        expected = case["expected"]["category_name"]
        if expected in name_map:
            case["expected"]["category_name"] = name_map[expected]
        # "none" passes through untouched
    return out


def run(langs: Iterable[str], *, force: bool = False) -> None:
    if not EN_DATASET_PATH.exists():
        raise RuntimeError(f"missing {EN_DATASET_PATH} — run `build-dataset build-en` first")

    requested = [lang for lang in langs if lang in _LANG_NAMES]
    if not requested:
        raise RuntimeError(f"no recognised target language in {list(langs)} (allowed: {list(_LANG_NAMES)})")

    todo = [lang for lang in requested if force or not dataset_path(lang).exists()]
    if not todo:
        print(f"[translate] skip — all of {requested} already built; pass --force to rebuild")
        return

    en_doc = json.loads(EN_DATASET_PATH.read_text(encoding="utf-8"))
    strings = _collect_strings(en_doc)

    # Build request payload for all (lang, string) pairs.
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    requests_path = DATA_DIR / f"translate-input-{int(time.time())}.jsonl"
    with requests_path.open("w", encoding="utf-8") as f:
        for li, lang in enumerate(todo):
            for si, s in enumerate(strings):
                cid = f"L{li}-S{si}"
                f.write(json.dumps(_build_request(cid, lang, s), ensure_ascii=False) + "\n")
    request_count = len(todo) * len(strings)
    print(f"[translate] {request_count} requests across {len(todo)} langs × {len(strings)} strings → {requests_path.name}")

    client = get_client()
    upload = client.files.create(file=open(requests_path, "rb"), purpose="batch")
    print(f"[translate] uploaded {upload.id}; creating batch…")
    batch = client.batches.create(
        input_file_id=upload.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        metadata={"task": "dataset-builder.translate", "langs": ",".join(todo)},
    )
    _await_batch(client, batch.id)
    batch = client.batches.retrieve(batch.id)
    if batch.error_file_id:
        errors = _download(client, batch.error_file_id)
        sample = errors[:3]
        raise RuntimeError(f"batch {batch.id} produced {len(errors)} errors; sample={sample}")

    output_lines = _download(client, batch.output_file_id)
    print(f"[translate] downloaded {len(output_lines)} responses")

    # Map back: lang_index → string_index → translation
    per_lang: dict[int, dict[int, str]] = {i: {} for i in range(len(todo))}
    for line in output_lines:
        cid = line["custom_id"]
        li_str, si_str = cid.split("-")
        li = int(li_str[1:])
        si = int(si_str[1:])
        per_lang[li][si] = _parse_translation(line)

    for li, lang in enumerate(todo):
        table = {strings[si]: tr for si, tr in per_lang[li].items()}
        if len(table) != len(strings):
            missing = set(range(len(strings))) - set(per_lang[li].keys())
            raise RuntimeError(f"{lang}: {len(missing)} translations missing (custom_ids={missing})")
        translated = _apply(en_doc, lang, table)
        path = dataset_path(lang)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(translated, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[translate] {lang}: {len(translated['cases'])} cases → {Path(*path.parts[-3:])}")

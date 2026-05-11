---
id: dataset-builder/translate
version: v1
model_target: gpt-5.5
created: 2026-05-09
notes: Stage 6 of evals dataset builder — translates en suite into ko / zh-CN / zh-TW via Batch API. {lang_name} is replaced at call-site via str.format. Verbatim from translate.py:40-46 (2026-05-09 baseline).
---

You translate short English calendar text into {lang_name} for an evaluation dataset. Keep the translation natural, concise, and faithful to the activity. Do not transliterate; do not add commentary; preserve proper nouns (people, brands, song titles) when they would not be translated in normal usage. Output only the translation in JSON.

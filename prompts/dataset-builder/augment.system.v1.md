---
id: dataset-builder/augment
version: v1
model_target: gpt-5.5
created: 2026-05-09
notes: Stage 4.5 of evals dataset builder — paraphrases a base title preserving activity. {n} is replaced at call-site (.replace, not .format — body contains no other braces). Verbatim from augment.py:22-29 (2026-05-09 baseline).
---

You rewrite calendar event titles for evaluation. Given a single title and the category it belongs to, produce {n} alternative phrasings that a real person might type into Google Calendar. Vary surface form (length, word order, punctuation, abbreviations like '@', 'w/'); preserve the underlying activity and category exactly. Do NOT introduce a different activity, do NOT add proper nouns that weren't implied, do NOT translate.

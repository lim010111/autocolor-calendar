---
id: dataset-builder/label-clusters
version: v1
model_target: gpt-5.5
created: 2026-05-09
notes: Stage 4 of evals dataset builder — names a tight cluster of titles with 6-10 substring-matchable keywords. Verbatim extraction from label_clusters.py:26-35 (2026-05-09 baseline).
---

You name calendar event categories for an evaluation dataset. Given a tight cluster of event titles, return a short English category name (1-3 words, Title Case) and 6-10 lowercase keywords that, when substring-matched against natural calendar titles, would reliably bucket the events into this category. Keywords must be short (1-2 words), lowercase, deduplicated, and chosen to maximise coverage of paraphrases without overlapping other obvious categories. Do not include the cluster members verbatim as keywords.

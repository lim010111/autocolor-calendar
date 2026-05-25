# ADR-0002: LLM 분류기 모델은 `gpt-5.4-nano` 유지 — `gpt-5-nano` 마이그레이션 보류

- Status: Accepted (2026-05-12)
- Context: 5/11 PR 에서 `gpt-5-nano + system.v3 + cap=1024` 도입을 측정했으나 4 lang 모두 `bad_response` 39 – 60 % 로 collapse 했다 (`evals/report-2026-05-11-gpt-5-nano-migration.md`). 후속 RCA (`evals/report-2026-05-12-nano-rca.md`) 가 단일 root cause 를 좁히고 viable 변수를 1 차원 (effort × cap 의 cap=1024 단면) 에 한정해 4 lang 측정을 마쳤다. 본 ADR 은 그 RCA 의 결정을 외부화한다.

  **측정 요약** (4 lang × 192 case, gpt-5-nano 후보 vs gpt-5.4-nano baseline):

  | Lang  | baseline (5.4 + cap=64) | nano + `minimal` + cap=1024 | nano + `low` + cap=1024 | gate (≥ baseline−1%p) | gate pass? |
  |-------|--------------------------|------------------------------|-------------------------|------------------------|-----------|
  | en    | **90.1 %**               | 87.0 %                       | _untested_              | 89.1 %                 | ❌ (−2.1 %p) |
  | ko    | **88.5 %**               | 70.8 %                       | **77.1 %**              | 87.5 %                 | ❌ (−10.4 %p) |
  | zh-CN | **89.1 %**               | 68.8 %                       | **75.0 %**              | 88.1 %                 | ❌ (−13.1 %p) |
  | zh-TW | **89.1 %**               | 66.1 %                       | _untested_              | 88.1 %                 | ❌ (−22.0 %p w/ minimal) |

  4 lang × 6 runs (총 1152 측정) 에서 `bad_response = 0`. truncation layer 는 해결됐고, 남는 −10 ~ −14 %p 갭은 5-nano 의 CJK 분류 자체 한계로 lock-in. `medium` / `high` 로의 effort escalation 은 5/11 의 truncation collapse 를 재현시킬 위험 + cost 우위 소거 (cap 상향 필요) 의 비대칭 risk 로 측정 SCOPE 밖.

- Decision: production `src/services/llmClassifier.ts:68` 의 `LLM_MODEL = "gpt-5.4-nano"` 를 **유지** 한다. `DEFAULT_CLASSIFIER_PROMPT_VERSION = "v2"` 도 유지. `prompts/classifier/system.v3.md` 는 rollback path 로 보존 (`--prompt-version v3` 으로 eval 재현 가능).
  - **Scope**: production `LLM_MODEL` / `LLM_MAX_COMPLETION_TOKENS` / `DEFAULT_CLASSIFIER_PROMPT_VERSION` 변경 없음. 본 ADR 은 _바꾸지 않는다_ 는 결정의 외부화.
  - **회귀 가드**: 본 ADR 은 production 코드 변경 0 줄이므로 `src/CLAUDE.md` §5.3 "Decision rule edits are eval-gated" 절차는 트리거되지 않는다. RCA 의 측정 ledger 6 rows 가 결정 근거이며 회귀 베이스라인은 그대로.
  - **Re-evaluation triggers** — 다음 셋 중 하나가 발생하면 본 ADR 의 결정을 재검토하고, 결과에 따라 새 ADR (ADR-0003 형식) 으로 supersede 한다:
    1. OpenAI 가 새 `gpt-5-nano` snapshot 을 release 했고 (`gpt-5-nano-2025-XX-XX` 새 ID), RCA 의 ko + zh-CN 측정을 재실행했을 때 두 lang 모두 baseline−2.5 %p 이내로 회복.
    2. gpt-5-nano 의 토큰 단가가 gpt-5.4-nano 의 **30 % 이하** 로 떨어지고 CJK 갭이 ±5 %p 이내로 좁혀짐 — `cost × accuracy` 가 swap 을 정당화하는 영역.
    3. 본 ADR 의 결정이 **6 개월** 이상 정체된 경우 (2026-11-12 이후), Layer 4 dataset 재빌드 cycle 과 동기해 RCA 의 ko + zh-CN 측정 1 회 재실행. 결과가 trigger 1 의 조건을 만족하면 ADR-0003 로 supersede.
- Consequences:
  - 운영 cost 측면: gpt-5-nano 가 더 저렴할 가능성을 알면서도 채택하지 않는다 = potential cost-down 의 일부를 명시적으로 포기. 본 RCA 가 측정한 production traffic 비중 (LLM leg 가 전체 cost 의 일부) 을 감안하면 acceptable trade.
  - 정확도 측면: CJK 3 lang (한국 + 중화권) production 사용자에게 baseline 정확도 (88.5 – 89.1 %) 를 그대로 제공. swap 시의 −10 ~ −14 %p hit 을 피한다.
  - 운영 surface: `src/services/llmClassifier.ts` 에 `reasoning_effort` 파라미터를 추가하는 follow-up 도 보류. 5.4-nano + cap=64 + no-effort-flag 의 조합이 baseline 그대로 유지된다.
  - prompt asset 보존: `prompts/classifier/system.v3.md` 는 5-nano 재평가 시 즉시 사용 가능. `pnpm tsx evals/scripts/run-classification-eval.ts --model gpt-5-nano --prompt-version v3 --reasoning-effort low --max-completion-tokens 1024 --task-file evals/datasets/{ko,zh-CN}/classification.json` 가 re-evaluation 의 canonical 명령.
  - 측정 자산 보존: 본 RCA 에서 추가된 6 ledger rows (Wave 1 + Wave 5 + Wave 6) 와 Langfuse run 6 개가 향후 trigger 발동 시 비교 baseline 으로 재사용 가능.
- References:
  - `evals/report-2026-05-12-nano-rca.md` — 본 ADR 의 측정 근거 (Wave 1 / Wave 5 / Wave 6)
  - `evals/report-2026-05-11-gpt-5-nano-migration.md` — 5/11 의 failure baseline (RCA trigger)
  - `evals/report-2026-05-11-prompt-rewrite.md` — gpt-5.4-nano + v2 의 4 lang baseline 수치 source
  - `src/CLAUDE.md` §5.3 "LLM semantic matching policy" — production 분류 정책 (본 ADR 로 무변경)
  - `prompts/classifier/system.v3.md` — 5-nano 재평가용 보존된 prompt asset
  - `docs/adr/0001-langfuse-eval-only.md` — Langfuse 도입 ADR (본 측정의 trace UI surface)
  - Langfuse runs (Wave 1 + Wave 5 + Wave 6, 6 runs total) — 본 ADR 의 측정 raw audit

# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§5 후속 LLM preview (on-demand)**
  - **문제**: 현재 `POST /api/classify/preview`는 비용·지연 이유로 rule-only. 규칙에 안 잡히는 이벤트는 "다음 동기화 시 AI 분류 시도"라는 안내만 보여줘서, 사용자가 규칙을 튜닝하기 전에 LLM이 어떤 카테고리를 고를지 즉시 확인할 방법이 없다.
  - **해결**: `POST /api/classify/preview`에 optional `{ llm: true }` body 플래그 추가. Rule hit이면 기존과 동일하게 short-circuit, rule miss + `llm=true` + `OPENAI_API_KEY` 설정 + categories ≥ 1이면 `classifierChain`의 LLM leg를 재사용해 `classifyWithLlm` 1회 호출(현재 `reserveLlmCall` 동일 일일 상한 공유). GAS `onEventOpen` 카드에 "🤖 AI 분류 확인" 버튼 추가 → 동일 endpoint를 `llm=1`로 재호출해 결과를 제자리에 렌더. 실패(timeout/quota/키 부재) 시 rule-miss 기존 메시지로 fallback.
  - **주요 변경**: `src/routes/classify.ts` (Zod 스키마 `llm?: boolean`, LLM leg 분기, classifierChain 재사용), `src/__tests__/classifyRoute.test.ts` (llm 플래그 off→기존 회귀 / on + 키 없음→fallback / on + rule hit→LLM 미호출 / on + LLM hit→응답 shape / on + quota→fallback 메시지 4~5 케이스), `gas/addon.js` `onEventOpen`에 `actionClassifyWithLlm` 버튼 + 토스트·카드 갱신 핸들러, `gas/CLAUDE.md`에 "preview LLM 버튼" 노트 1줄.
  - **문서**: `src/CLAUDE.md`에 LLM preview가 `reserveLlmCall` 상한을 공유한다는 사실 1~2줄 추가, `docs/architecture-guidelines.md` Hybrid 불릿에 "sync 경로 외 preview 경로도 quota 공유" 명시. TODO.md §5 후속의 `LLM preview (on-demand)` 체크.
  - **의존성**: 없음 (§5.3 LLM fallback · dev `OPENAI_API_KEY` 모두 동작 중).
  - **사이즈**: M (route 1 + test 5 + GAS UI 1).

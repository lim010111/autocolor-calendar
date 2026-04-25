# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§3 Sub-processors 표 작성 (Marketplace Admin 답변)**
  - **선정 근거**:
    - **Momentum**: 방금 쉽핑한 §2 scope justifications에 이어 `docs/marketplace-readiness.md` §3 status 테이블에서 다음으로 가장 구체적인 미작성 행 — line 180 "Sub-processors list — Three-row Cloudflare / Supabase / OpenAI table to draft"을 직결 처리. Marketplace Admin 검토 스레드를 한 번 더 전진.
    - **Independence**: 외부 blocker 없음. 정본 데이터는 이미 레포 안에 — Cloudflare는 `wrangler.toml` + `docs/project-overview.md`, Supabase는 `src/CLAUDE.md` "DB connectivity", OpenAI는 `src/services/llmClassifier.ts` + `docs/architecture-guidelines.md` "Hybrid Classification Engine". 법무·외부 검토 불필요 (factual roll-up).
    - **Size**: S — 단일 신규 doc + `docs/marketplace-readiness.md` §3 status 1행 갱신.
  - **문제**: `docs/marketplace-readiness.md:180` §3 status 테이블 "Sub-processors list" 행이 `미작성`이고 detail이 "This document"로만 표시돼 있다 (인덱스 자체가 비어 있음). Marketplace Admin이 도메인-와이드 install을 평가할 때 "어떤 외부 처리자가 user data를 다루는가?"는 필수 답변 항목이며, 답이 없으면 listing 검수가 막힌다.
  - **해결**: `docs/assets/marketplace/sub-processors.md` 신규 작성 — 3행 표(Cloudflare / Supabase / OpenAI) 각각 처리자명, 역할(Workers runtime + Hyperdrive + Queues / 관리형 Postgres / `gpt-5.4-nano` LLM), 처리 데이터의 종류, 데이터 위치/리전, 보존 정책 포인터를 담는다. `docs/security-principles.md` 패턴(Promise / Canonical pointers / 본문 중복 없이 포인팅)을 따라 Cloudflare는 `wrangler.toml`·`src/CLAUDE.md` "DB connectivity"로, Supabase는 동일 surface 및 Hyperdrive 경로로, OpenAI는 `src/services/llmClassifier.ts`와 Principle 2(PII Masking)로 포인팅. Conditional/optional 처리자(`OPENAI_API_KEY` 미설정 시 OpenAI는 호출 자체가 일어나지 않음)도 명시. `docs/marketplace-readiness.md:180` §3 status 행 `미작성` → `초안`, detail pointer "This document" → 신규 파일 경로.
  - **주요 변경**: (1) `docs/assets/marketplace/sub-processors.md` 신규 — 머리말 + 3행 표 + 각 sub-processor 1섹션(역할 / 데이터 종류 / 위치 / 정본 포인터) + 공통 데이터 보호 풋터(Principle 1·2·5 인용). (2) `docs/marketplace-readiness.md:180` §3 status 1행 `미작성` → `초안`, detail pointer 갱신. 소스 코드 변경 없음.
  - **문서**: `docs/assets/marketplace/sub-processors.md` 신규. `docs/marketplace-readiness.md` §3 status 행 갱신. `TODO.md` home checkbox flip 없음 (§7 portmanteau 항목 내부 보조 자료).
  - **의존성**: 없음.
  - **사이즈**: S.

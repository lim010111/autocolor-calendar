# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§7 / Reviewer Demo Scenarios — 슬라이스 3: `03-event-preview-rule-hit.md` (Event-open preview, rule hit)**
  - **선정 근거**:
    - **Momentum**: 직전 PR 사이클 두 번이 슬라이스 1·2를 정본화. 슬라이스 3은 동일 골격으로 Marketplace-install 면의 `calendar.addons.current.event.read` 스코프(read-only 사이드바 preview)를 정당화 — 같은 규약·드리프트 가드 위에서 한 칸 더 진전.
    - **Visibility**: HIGH — OAuth Consent Screen 검수의 핵심은 "각 Sensitive·Restricted 스코프가 어떤 코드 경로에서 어떻게 사용되는가"이고, `calendar.addons.current.event.read`는 사이드바 preview가 이벤트 본문을 읽어야 하는 이유를 reviewer에게 답하는 정본 deliverable.
    - **Independence**: 외부 결정 / 외부 시스템 의존 0. `gas/addon.js` `onEventOpen` 핸들러 + `src/routes/classify.ts` POST `/api/classify/preview`(llm 플래그 없는 rule-only 경로) + `src/services/classifierChain.ts` rule short-circuit 분기가 모든 facts의 정본. README scenario matrix는 이미 행 3을 예약(`미작성`).
  - **문제**: `docs/assets/marketplace/reviewer-demo/README.md` "Scenario matrix" 행 3(`03-event-preview-rule-hit.md`)이 `미작성`. `docs/marketplace-readiness.md`도 같은 행이 `미작성`. Marketplace-install 면에서 부여되는 `calendar.addons.current.event.read`(read-only) 사용 정당화는 reviewer가 "왜 사이드바가 이벤트 본문을 읽어야 하는가"에 답하는 핵심 walkthrough인데, 정본이 없다.
  - **해결**: `docs/assets/marketplace/reviewer-demo/03-event-preview-rule-hit.md` 신규. 슬라이스 1·2와 동일 골격(Scopes 콜아웃 → Pre-conditions → 단계별 `## N.` → Failure modes → Cross-references). 4~5단계 walkthrough — (1) 슬라이스 2에서 만든 규칙(키워드 `회의`)이 살아 있는 상태로 reviewer가 매칭 이벤트를 Calendar에서 직접 클릭, (2) 사이드바 자동 오픈 — `onEventOpen` 트리거(`gas/appsscript.json` `eventOpenTrigger` 매니페스트)가 `e.calendar.event.{id,title,...}`을 GAS에 전달, (3) 사이드바가 home-card preview / `actionPreviewClassification` 핸들러를 통해 POST `/api/classify/preview`(body: `{ title, description?, location? }` — `llm` 플래그 없음) 호출, (4) 백엔드 rule-chain이 substring 매칭으로 hit → 응답 `{ source: "rule", colorId, categoryId, matchedKeyword }` (no Google API call, no LLM call), (5) 사이드바가 예상 색상 + 매칭 키워드 + 카테고리 이름을 카드로 렌더 — **PATCH는 일어나지 않음**(read-only preview). Failure modes 3개: (a) 401 → AUTH_EXPIRED → buildReconnectCard (슬라이스 2와 동일 surface; 인용만 재사용), (b) rule miss → `source: "no_match"`로 응답해 사이드바가 "🤖 AI 분류 확인" 버튼을 노출 (슬라이스 4의 cross-link), (c) 알 수 없는 `categoryId`(예: 카테고리 삭제 이후 캐시 stale) → graceful degrade. Cross-references: `src/CLAUDE.md` "Preview LLM (§5 후속)" (preview의 unified quota / fire-and-forget 디스이플린 컨텍스트), `docs/architecture-guidelines.md` Hybrid Classification Engine 불릿, `01-install.md`의 인증된 세션 전제. **`docs/marketplace-readiness.md` 해당 행 status `미작성` → `초안`**, README scenario matrix 행 3도 `미작성` → `초안`로 mirror 동기화.
  - **주요 변경**:
    1. `docs/assets/marketplace/reviewer-demo/03-event-preview-rule-hit.md` 신규 — 4~5단계 walkthrough + Failure modes (3개) + Cross-references (3개). 모든 인용은 `gas/addon.js:NN` (onEventOpen / preview 핸들러 / 카드 렌더 카피) / `gas/appsscript.json:NN` (eventOpenTrigger 매니페스트) / `src/routes/classify.ts:NN` (POST `/api/classify/preview` 핸들러) / `src/services/classifierChain.ts:NN` (rule hit short-circuit) / `src/services/piiRedactor.ts:NN` 기반이며, 드리프트 가드(`grep -n` 통과)를 만족.
    2. `docs/marketplace-readiness.md` 해당 행 status `미작성` → `초안`, Source of truth `docs/add-on-ui-plan.md` Screen 3 → `docs/assets/marketplace/reviewer-demo/03-event-preview-rule-hit.md`.
    3. `docs/assets/marketplace/reviewer-demo/README.md` "Scenario matrix" 행 3 status `미작성` → `초안` (mirror 동기화).
    4. 테스트 변경 없음 (순수 문서 작업; backend / GAS 코드 무변경).
  - **문서**:
    - `docs/marketplace-readiness.md` — 슬라이스 3 status flip + Source of truth pointer 갱신.
    - `docs/assets/marketplace/reviewer-demo/README.md` — Scenario matrix 행 3 status flip.
    - `docs/architecture-guidelines.md` — 변경 없음.
    - `src/CLAUDE.md` / `gas/CLAUDE.md` — 변경 없음.
    - `TODO.md` — 슬라이스 시리즈는 §7 행에 묶이지 않으므로 체크박스 flip 없음. `marketplace-readiness.md` Launch Gate "Reviewer demo bundle"은 ≥4 슬라이스 도달 전까지 `미작성` 유지(슬라이스 1·2 결정 규칙 그대로); 슬라이스 4(`04-event-preview-ai-fallback.md`)와 함께 시리즈 마무리되면 그 시점에 launch gate flip 검토.
  - **의존성**: 없음. (외부 의존 0, 코드 변경 0, 테스트 통과 변경 무관.)
  - **사이즈**: M.

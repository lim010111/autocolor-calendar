# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§7 / Reviewer Demo Scenarios — 슬라이스 2: `02-rule-to-color.md` (Create rule → color applied)**
  - **선정 근거**:
    - **Momentum**: 직전 슬라이스 1(`README.md` + `01-install.md`)에서 bundle 디렉토리·파일명 규약·"Two consent surfaces"·드리프트 가드(`gas/addon.js:LINE` 인용 패턴)를 모두 확정. 같은 규약 위에서 row 2를 채우는 것이 최저 마찰로 OAuth 검수 deliverable을 한 칸 더 진전시킨다.
    - **Visibility**: HIGH — 이 슬라이스는 Sensitive `calendar.events` scope의 정본 demo. `events.patch` 호출 + §5.4 색상 ownership 마커가 실제 동작하는 모습이 reviewer의 "왜 calendar.events가 필요한가"에 대한 답.
    - **Independence**: 외부 결정 / 외부 시스템 의존 0. 기존 `gas/addon.js` rule manager UI / `src/routes/categories.ts` POST 핸들러 / `src/services/calendarSync.ts` `processEvent` 분기 / `src/CLAUDE.md` "Color ownership marker (§5.4)" 절이 모든 facts의 정본. README scenario matrix는 이미 `02-rule-to-color.md` 행을 예약해 둔 상태.
  - **문제**: `docs/assets/marketplace/reviewer-demo/README.md` "Scenario matrix" 행 2가 `미작성`. `docs/marketplace-readiness.md:217`도 `미작성`. Sensitive `calendar.events` 사용 정당화는 OAuth Consent Screen 검수의 핵심 질문이지만, 현재 reviewer에게 줄 수 있는 단계별 walkthrough가 없다.
  - **해결**: `docs/assets/marketplace/reviewer-demo/02-rule-to-color.md` 신규. 슬라이스 1과 동일 골격(Scopes 콜아웃 → Pre-conditions → 단계별 `## N.` → Failure modes → Cross-references). 단계 구성 4~5개 — (1) Home 카드 "매핑 규칙 관리" 진입, (2) 카테고리·키워드·색상 추가 (POST `/api/categories`), (3) 합성 fixture 이벤트 생성, (4) "지금 즉시 동기화" → `/sync/run` → `events.list` + `events.patch` (`autocolor_v` / `autocolor_color` / `autocolor_category` 3-키 마커 포함), (5) Calendar UI에서 색상 적용 확인 + 재동기화 시 `skipped_equal`로 멱등 검증. 인용은 `src/routes/categories.ts:NN` / `src/services/calendarSync.ts:NN` / `src/services/googleCalendar.ts:NN` (AUTOCOLOR_KEYS) / `gas/addon.js:NN` (rule manager card · 합성 이벤트 안내 카피). `docs/marketplace-readiness.md:217` status `미작성` → `초안`. README scenario matrix 행 2도 `미작성` → `초안`로 동기화.
  - **주요 변경**:
    1. `docs/assets/marketplace/reviewer-demo/02-rule-to-color.md` 신규 — 4~5단계 walkthrough + Failure modes (인증 만료 → 401 → reconnect 카드, `events.patch` 5xx → DLQ 경로 포인터) + Cross-references (`src/CLAUDE.md` "Color ownership marker (§5.4)", `docs/architecture-guidelines.md` "Color Ownership", `02`의 데모 fixture가 `01-install.md`의 인증된 세션을 전제로 함을 명시).
    2. `docs/marketplace-readiness.md:217` 행 status `미작성` → `초안`, Source of truth `docs/add-on-ui-plan.md` Screen 4 → `docs/assets/marketplace/reviewer-demo/02-rule-to-color.md` (Screen 4는 cross-ref로 유지).
    3. `docs/assets/marketplace/reviewer-demo/README.md` "Scenario matrix" 행 2 status `미작성` → `초안` (mirror 동기화).
    4. 테스트 변경 없음 (순수 문서 작업; backend / GAS 코드 무변경).
  - **문서**:
    - `docs/marketplace-readiness.md` — line 217 갱신.
    - `docs/assets/marketplace/reviewer-demo/README.md` — Scenario matrix 행 2 status flip.
    - `docs/architecture-guidelines.md` — 변경 없음.
    - `src/CLAUDE.md` / `gas/CLAUDE.md` — 변경 없음.
    - `TODO.md` — `:131` ("OAuth Consent Screen 검수…")는 여전히 1/8(현재) → 2/8(이 슬라이스 후)로 launch gate 미달; 체크박스 flip 금지. `marketplace-readiness.md:260` Launch Gate "Reviewer demo bundle"도 ≥4 슬라이스 도달 전까지 `미작성` 유지(슬라이스 1 결정 규칙 그대로).
  - **의존성**: 없음. (외부 의존 0, 코드 변경 0, 테스트 통과 변경 무관.)
  - **사이즈**: M.

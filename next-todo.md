# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§7 / Reviewer Demo Scenarios — 첫 슬라이스: bundle scaffold + `01-install.md` (Install + first-time OAuth)**
  - **선정 근거**:
    - **Momentum**: 직전 §3 row 179(Account-deletion endpoint)에 이어, 같은 `docs/marketplace-readiness.md`의 §4 "Reviewer Demo Scenarios" 8행이 모두 `미작성`. 한 행씩 라이브로 채워가는 것이 자연스러운 다음 단계.
    - **Independence**: 외부 결정 / 외부 시스템 의존 없음. 모든 facts는 이미 `src/CLAUDE.md`·`docs/add-on-ui-plan.md`·`gas/addon.js`에서 추출 가능. `docs/assets/marketplace/reviewer-demo/` 디렉토리는 신규 생성, 충돌 없음.
    - **Visibility**: HIGH — Google OAuth Consent Screen 검수(Verification)의 **재현 가능한 walkthrough** 묶음. `TODO.md:131` ("OAuth Consent Screen 검수 신청을 위한 데모/문서 준비")와 직접 정렬되며 sensitive scope justification의 정본 surface.
  - **문제**: `docs/marketplace-readiness.md:184-223` §4 "Reviewer Demo Scenarios"는 index + canonical pointers + 8-row status 테이블만 있고 모든 row가 `미작성`. line 210의 "Demo bundle path: **TBD** `docs/assets/marketplace/reviewer-demo/`"는 디렉토리조차 존재하지 않음 (`grep`으로 0 hits). Marketplace 검수가 sensitive scope 정당화를 묻는 시점에 답할 surface가 없다.
  - **해결**: `docs/assets/marketplace/reviewer-demo/` 디렉토리를 생성하고 (1) `README.md` (bundle 인덱스 + 사용법 + 테스트 계정 자리표시자 + 8개 시나리오 매트릭스), (2) `01-install.md` (Install + first-time OAuth 시나리오 — Welcome card → consent screen → callback → onboarding 카드까지의 단계별 walkthrough, 각 단계의 Google API call + 요청한 scope + 관찰 가능한 outcome 명시). `marketplace-readiness.md:210` "Demo bundle path: **TBD**" → 실제 경로로 갱신, `:216` "Install + first-time OAuth" 행 status `미작성` → `초안`. 나머지 7개 시나리오는 후속 슬라이스로 이월 (각자 독립 PR 가능, 중간 어느 시점에서 멈춰도 부분 가치 있음).
  - **주요 변경**:
    1. `docs/assets/marketplace/reviewer-demo/README.md` 신규 — bundle 인덱스 / 시나리오 매트릭스 / 테스트 계정 placeholder.
    2. `docs/assets/marketplace/reviewer-demo/01-install.md` 신규 — Install + first-time OAuth 시나리오 (단계 / 요청 scope / 관찰 outcome).
    3. `docs/marketplace-readiness.md:210` Demo bundle path TBD → `docs/assets/marketplace/reviewer-demo/`로 교체.
    4. `docs/marketplace-readiness.md:216` 행 status `미작성` → `초안`, Source of truth는 신규 `01-install.md`.
    5. 테스트 변경 없음 (순수 문서 작업; backend / GAS 코드 무변경).
  - **문서**:
    - `docs/marketplace-readiness.md` — line 210 + 216 갱신 (위 4 / 5).
    - `docs/architecture-guidelines.md` — 변경 없음 (시나리오는 cross-cutting 불변식이 아니라 검수 walkthrough).
    - `src/CLAUDE.md` / `gas/CLAUDE.md` — 변경 없음.
    - `TODO.md` — `:131` ("OAuth Consent Screen 검수…")는 첫 슬라이스만으로는 완결 아님; 체크박스 flip 금지. 8개 시나리오 모두 `초안` 도달 시점에 §7 행 갱신 검토.
  - **의존성**: 없음. (외부 의존 0, 코드 변경 0, 테스트 통과 변경 무관.)
  - **사이즈**: M.

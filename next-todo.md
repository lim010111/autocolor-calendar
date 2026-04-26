# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§7 / Reviewer Demo Scenarios — 슬라이스 8: `08-test-account.md` (Test account credentials)**
  - **선정 근거**:
    - **Momentum**: HIGHEST — 직전 7번의 PR 사이클이 슬라이스 1~7을 정본화. 슬라이스 8은 시리즈 종결편이며 README:20 "Run scenarios in order" 흐름의 마지막 칸. 동일 골격(축소판) 위에서 8/8 매트릭스 완성.
    - **Visibility**: MEDIUM-HIGH — `docs/marketplace-readiness.md` §4 행 8 (`Test account credentials`, 현재 `미작성` / Source of truth: `TBD (shared secure note)`)을 `초안`으로 flip. README "Scenario matrix" 행 8 mirror 동기화. Bundle 8/8 모든 슬라이스 `초안+` 도달 — `docs/marketplace-readiness.md:260` "Reviewer demo bundle" Launch Gate를 향한 추가 신호 (실제 자격증명은 여전히 submission-time TBD).
    - **Independence**: 외부 결정 / 외부 시스템 의존 0. 실제 자격증명은 secure-note out-of-band 전달이므로 placeholder doc + delivery protocol explainer만 작성. README §46-56이 이미 inline으로 동일 콘텐츠를 정의 중이라 슬라이스 8은 이를 별도 파일로 분리·정본화하는 작업.
  - **문제**: `docs/assets/marketplace/reviewer-demo/08-test-account.md`이 아직 `미작성`. README scenario matrix 행 8과 §4 행 8이 모두 `미작성`이며 `08-test-account.md` 파일을 클릭하는 reviewer는 404를 본다. 슬라이스 1~7이 모두 `초안`인 상태에서 8번 자리만 비어 있어 bundle 완성도 7/8에 머문다. README §46-56에 inline-defined된 delivery protocol(secrets out of git, secure-note out-of-band, submission-time 전달, install부터 시작하는 fresh account 요건)이 별도 reviewer-facing 파일로 노출되어야 한다.
  - **해결**: `docs/assets/marketplace/reviewer-demo/08-test-account.md` 신규 — 슬라이스 1~7과 다른 thin doc 구조 (no scenario walkthrough — credentials 자체는 walkthrough 대상이 아님). 4-블록 구조: (a) Rationale ("왜 이 슬라이스는 placeholder인가" — secrets out of git + 자격증명은 submission-time secure-note로 out-of-band 전달), (b) Delivery protocol (어떤 Google account state로 전달 — Workspace Marketplace 미설치 / 슬라이스 1 install부터 시작 가능한 깨끗한 상태 / 캘린더에 fixture 가능한 권한), (c) Submission-time checklist (`docs/marketplace-readiness.md` §5 "Reviewer demo bundle" Launch Gate 행이 어느 시점에 어떤 secure-note pointer로 graduate되는지), (d) Cleanup posture (slice 7로 reviewer가 자체 검증 후 OPS-side cleanup 또는 next submission 사이의 account state 관리). README §46-56 inline 콘텐츠를 별도 파일로 옮기고 README는 "see `08-test-account.md`"로 짧게 포인터만 남김. 그리고 `docs/marketplace-readiness.md` §4 행 8 + README "Scenario matrix" 행 8 두 mirror status flip.
  - **주요 변경**:
    1. `docs/assets/marketplace/reviewer-demo/08-test-account.md` 신규 — 짧은 thin doc (∼60-90줄): 4-블록 구조(Rationale / Delivery protocol / Submission-time checklist / Cleanup posture). 슬라이스 1~7과 달리 `## N.` numbered walkthrough · Failure modes · 두-consent-surface 콜아웃 없음 (scenario 아님). Cross-references는 유지(README + §4 행 8 + §5 Launch Gate "Reviewer demo bundle" 행). 모든 인용은 `docs/assets/marketplace/reviewer-demo/README.md:NN` / `docs/marketplace-readiness.md:NN` / `docs/assets/marketplace/reviewer-demo/01-install.md` 기반이며 드리프트 가드(`grep -n` 통과) 만족.
    2. `docs/marketplace-readiness.md` §4 행 8 status `미작성` → `초안`, Source of truth `TBD (shared secure note)` → `docs/assets/marketplace/reviewer-demo/08-test-account.md`.
    3. `docs/assets/marketplace/reviewer-demo/README.md` "Scenario matrix" 행 8 status `미작성` → `초안` (mirror 동기화) + §46-56 "Test account credentials" inline 본문을 짧은 포인터(`08-test-account.md`로의 see-also 1~3줄)로 축소 — 정본 분리 후 inline 본문이 같은 표면을 두 번 정의하면 drift hazard.
    4. 테스트 변경 없음 (순수 문서; backend / GAS 코드 무변경).
  - **문서**:
    - `docs/marketplace-readiness.md` — 슬라이스 8 status flip + Source of truth pointer 갱신.
    - `docs/assets/marketplace/reviewer-demo/README.md` — Scenario matrix 행 8 status flip + §46-56 본문 축소(see-also pointer로 대체).
    - `docs/architecture-guidelines.md` — 변경 없음.
    - `src/CLAUDE.md` / `gas/CLAUDE.md` — 변경 없음.
    - `TODO.md` — 슬라이스 시리즈는 §7 단일 행에 묶이지 않으므로 체크박스 flip 없음. 8/8 도달은 `docs/marketplace-readiness.md:260` "Reviewer demo bundle" Launch Gate 진척의 추가 신호일 뿐 자동 `완료`로 승급되진 않음 (실제 secure-note credentials는 여전히 submission-time TBD).
  - **의존성**: 없음. (외부 의존 0, 코드 변경 0.)
  - **사이즈**: S.

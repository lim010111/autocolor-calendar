# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§3 row 174 / row 175 Admin-voice 합성 — `admin-data-handling.md` (What user data is read? + What user data is stored?)**
  - **선정 근거**:
    - **Momentum**: HIGH — 직전 9 PR(reviewer-demo bundle 슬라이스 1~8 + processing-region 슬라이스 9)이 모두 marketplace-artifact 문서. 본 작업은 같은 `docs/assets/marketplace/` 표면의 다음 인접 행 2개(§3 row 174 "What user data is read?", row 175 "What user data is stored?")를 동시에 다룬다. 슬라이스 9가 정착시킨 "thin-doc 한 파일이 §3의 행 1-N개를 정본으로 묶는" 패턴을 재사용.
    - **Independence**: HIGH — 두 행 모두 정본(Principles 1+2 / `src/CLAUDE.md` "Observability tables")이 기존에 작성돼 있어 외부 결정·승인 0건. row 174 Notes의 "Admin-voice phrasing 미작성"은 본 슬라이스로 직접 닫을 수 있고, row 175(현 `초안`)는 같은 파일로 통합되어 Admin-voice 단일 진입점 확보.
    - **Visibility**: HIGH — Workspace admin이 `domain-wide install` 결정 전 가장 먼저 묻는 두 질문("앱이 무엇을 읽고 무엇을 저장하나?")을 한 파일로 답하는 surface. §5 "Data handling / Admin answers drafted" Launch Gate의 핵심 deliverable이며, gate 자체는 graduate되지 않더라도 그 본문 빈자리를 메우는 작업.
  - **문제**: `docs/marketplace-readiness.md` §3 row 174 (`What user data is read?`)의 Notes 컬럼은 "Admin-voice phrasing 미작성"으로 명시 결손 표기 중이며, Source-of-truth가 `Principles 1 + 2`(추상 포인터)에 머물러 있다. row 175 (`What user data is stored?`)는 status `초안`이지만 Source-of-truth가 `src/CLAUDE.md` "Observability tables" — 운영 계약 문서이지 admin-voice가 아님. 두 질문은 admin이 가장 먼저 묻는 쌍이지만 현재는 각각 별개의 추상 포인터에 흩뿌려져 admin이 합성된 답을 받지 못한다.
  - **해결**: `docs/assets/marketplace/sub-processors.md` / `processing-region.md`와 동일한 thin-doc 패턴 — `docs/assets/marketplace/admin-data-handling.md`를 ~100-140줄 신규 작성. 4-블록 구조: (a) "What user data is read?" Admin-voice 답 (Principles 1+2를 admin 어조로 합성, 본문 중복 없이 정본 포인터 유지), (b) "What user data is stored?" Admin-voice 답 (Observability tables 4개 surface + oauth_tokens 암호화 + sessions를 1-페이지 admin 요약으로), (c) Boundary clarifications (각 질문의 out-of-scope: 디바이스 입력, 사용자 가공 데이터, vendor-side handling — `sub-processors.md` §4 / `processing-region.md` Out-of-scope과 일관), (d) Cross-references (sub-processors.md / processing-region.md / security-principles.md / src/CLAUDE.md의 운영 계약 섹션). `marketplace-readiness.md` row 174 Source-of-truth `Principles 1 + 2` → `docs/assets/marketplace/admin-data-handling.md`; row 174 Notes "Admin-voice phrasing 미작성" → "Admin-voice synthesis at `admin-data-handling.md`"; row 175 Source-of-truth `src/CLAUDE.md "Observability tables"` → `docs/assets/marketplace/admin-data-handling.md` (운영 계약은 그대로 정본; admin-voice surface가 별도). row 174 status `초안` 유지 (admin-voice phrasing은 추가 작성됐지만 row 자체의 status는 launch gate 기준 그대로); row 175 status `초안` 유지.
  - **주요 변경**:
    1. `docs/assets/marketplace/admin-data-handling.md` 신규 — ~100-140줄, 4-블록 구조(Read / Stored / Boundary clarifications / Cross-references). slice 8/9 thin-doc 톤. 정본 포인터(Principles 1+2 / Observability tables 4개 surface) 본문 중복 없음. 코드/테스트 변경 없음.
    2. `docs/marketplace-readiness.md` row 174 / 175 — Source of truth 둘 다 새 파일로 갱신; row 174 Notes의 "Admin-voice phrasing 미작성" 문구 제거 또는 새 파일 위임 1줄로 축약; row 175 Notes는 그대로(이미 적절).
    3. 테스트 변경 없음(순수 문서; backend / GAS 코드 무변경).
  - **문서**:
    - `docs/marketplace-readiness.md` — §3 row 174 / row 175 Source of truth 갱신 + row 174 Notes 정리.
    - `docs/assets/marketplace/admin-data-handling.md` 신규.
    - `docs/architecture-guidelines.md` / `src/CLAUDE.md` / `gas/CLAUDE.md` — 변경 없음.
    - `TODO.md` — 슬라이스 시리즈는 §7 line 131 marketplace 검수 묶음의 일부. row 174 / 175 Admin-voice 통합은 §5 "Data handling / Admin answers drafted" Launch Gate(현 `초안`) graduate를 가깝게 만들지만 단독으로 graduate시키지 않음 — gate는 §3 모든 행 `초안+` AND prod 활성화 등 추가 조건 필요(Retention policy / Domain-wide install posture 두 행이 여전히 `미작성`).
  - **의존성**: 없음. (외부 결정 0건, 코드 변경 0건. row 175가 인용하는 `src/CLAUDE.md` "Observability tables (§6 Wave A)" / "(§6 Wave B)" 섹션은 §6 Wave A·B 작업으로 이미 존재.)
  - **사이즈**: M.

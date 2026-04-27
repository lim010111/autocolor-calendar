# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§3 row 176 / §5 admin-disclosure consistency — `processing-region.md` placeholder + `sub-processors.md` staleness sync**
  - **선정 근거**:
    - **Independence**: HIGH — Cloudflare Workers의 global-edge 모델과 OpenAI의 published policy는 외부 사실 확인 없이 서술 가능. Supabase prod region은 §3 후속 "Prod 환경 활성화"에 gate되어 있어 그 부분은 placeholder 처리(슬라이스 8과 동일한 thin-doc 패턴). 외부 결정 0건.
    - **Momentum**: HIGH — 직전 8 PR(reviewer-demo bundle 슬라이스 1~8)이 marketplace-artifact 문서 시리즈. 본 작업은 같은 `docs/assets/marketplace/` 표면의 다음 미작성 행(§3 row 176)을 초안 단계로 끌어올림. 슬라이스 8이 정착시킨 "thin placeholder for gated artifact" 패턴을 재사용.
    - **Visibility**: MEDIUM-HIGH — Workspace admin 직접 조회 행. 또한 `sub-processors.md`의 3개 region cell이 §3 row 176을 정본으로 인용 중이라 자기 흐름 안에서 stale `미작성` 주석 4건을 동기화(region 행 3개 + 슬라이스 7 이월분 1개).
  - **문제**: `docs/marketplace-readiness.md` §3 row 176 (`Processing region`)이 `미작성`이며 Source of truth가 추상 포인터(`docs/project-overview.md + wrangler.toml`)에 머물러 있다. 두 정본 모두 처리 region을 명시적으로 서술하지 않으며, `wrangler.toml`은 region을 carry하지 않는다(Workers는 region pin이 없음). 동시에 `docs/assets/marketplace/sub-processors.md`는 line 18-22에서 §3 row 176을 region 정본으로 명시 위임 중이고, 본문 lines 88 / 131 / 170 (3개 processor의 Region/location subsection)이 모두 "currently `미작성`"으로 stale 인용 중. 추가로 `sub-processors.md` line 49는 슬라이스 7 머지 후 §3 row 179가 `초안`으로 바뀐 시점에 동기화되지 못해 "currently `미작성`"인 채로 남아 있음.
  - **해결**: 슬라이스 8과 동일한 thin-placeholder 패턴 — `docs/assets/marketplace/processing-region.md`를 ~70-100줄 신규 작성. 5-블록 구조: (a) Cloudflare Workers + Hyperdrive + Queues 처리 region 모델(global edge, region pinning 없음 — Cloudflare published model 인용), (b) Supabase Postgres region(`docs/marketplace-readiness.md` §3 후속 "Prod 환경 활성화"에 gate, 본 슬라이스가 초안 단계만 처리), (c) OpenAI `gpt-5.4-nano` 처리 region(vendor published policy, OPENAI_API_KEY 미설정 시 호출 0건), (d) Logs / observability(Cloudflare Workers per-request 스트리밍, 중앙 aggregation 없음 — `src/CLAUDE.md` "Log redaction contract" 표면), (e) Out-of-scope(사용자 디바이스 위치, Google Calendar API region — 본 disclosure 범위 밖). Cross-references는 `wrangler.toml`, `src/CLAUDE.md` "DB connectivity", `sub-processors.md`, `docs/marketplace-readiness.md` §3 row 176 / §5 row 252. 그리고 (i) `marketplace-readiness.md` row 176 Source of truth 포인터를 새 파일로 갱신 + Status `미작성` → `초안`, (ii) `sub-processors.md` 4개 stale 인용(lines 49, 88, 131, 170)을 모두 `초안`으로 동기화.
  - **주요 변경**:
    1. `docs/assets/marketplace/processing-region.md` 신규 — ~70-100줄, 5-블록 구조(Cloudflare / Supabase / OpenAI / Logs / Out-of-scope) + Cross-references. 슬라이스 8과 동일한 thin-doc 톤. 코드/테스트 인용 없음(순수 disclosure 문서).
    2. `docs/marketplace-readiness.md` row 176 — Source of truth `docs/project-overview.md + wrangler.toml` → `docs/assets/marketplace/processing-region.md`; Status `미작성` → `초안`; Notes는 그대로 또는 새 파일 위임 1줄로 축약.
    3. `docs/assets/marketplace/sub-processors.md` — 4개 stale 인용 동기화: lines 88 / 131 / 170 ("Region/location" subsection의 "currently `미작성`")을 `초안`으로, line 49 ("Deletion on account revoke" 주석의 "currently `미작성`")를 `초안`으로(슬라이스 7 머지 후 §3 row 179 `초안` 전환 반영).
    4. 테스트 변경 없음(순수 문서; backend / GAS 코드 무변경).
  - **문서**:
    - `docs/marketplace-readiness.md` — §3 row 176 status flip + Source of truth 갱신.
    - `docs/assets/marketplace/processing-region.md` 신규.
    - `docs/assets/marketplace/sub-processors.md` — 4개 stale 인용 동기화.
    - `docs/architecture-guidelines.md` — 변경 없음.
    - `src/CLAUDE.md` / `gas/CLAUDE.md` — 변경 없음.
    - `TODO.md` — 슬라이스 시리즈는 §3 row 176 단일 행에 묶이지 않음(§7 line 131 marketplace 검수 묶음의 일부). `초안` 도달은 `docs/marketplace-readiness.md` §5 "Data handling / Admin answers drafted" Launch Gate(현 `초안`)와 §5 "Reviewer demo bundle"(현 `초안`) 어느 쪽도 graduate시키지 않음 — 두 gate 모두 §3 모든 행 `초안+` AND prod 활성화 등 추가 조건이 필요.
  - **의존성**: 없음. (외부 의존 0, 코드 변경 0. Supabase prod region 사실 확인이 필요한 부분은 §3 후속 "Prod 환경 활성화"에 명시적으로 gate 처리 — 본 슬라이스는 placeholder 단계만 처리.)
  - **사이즈**: S.

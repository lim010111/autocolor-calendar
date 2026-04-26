# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§7 / Reviewer Demo Scenarios — 슬라이스 7: `07-account-deletion.md` (Service disconnect / account deletion)**
  - **선정 근거**:
    - **Momentum**: HIGHEST — 직전 6번의 PR 사이클이 슬라이스 1~6을 정본화. 슬라이스 7은 시리즈의 자연 연속이며 README:20 "Run scenarios in order" 흐름에서 슬라이스 6 다음 칸. 동일 골격·동일 드리프트 가드 위에서 한 칸 더 진전.
    - **Visibility**: HIGH — `docs/marketplace-readiness.md` §4 행 7 (`all` scope, source-of-truth `TBD`, 상태 `미작성`)을 `초안`으로 flip. 이 행은 OAuth Consent Screen reviewer가 **유저가 어떻게 데이터를 지울 수 있는가**를 검증하는 surface. `docs/architecture-guidelines.md:21`의 "User-initiated deletion" 정책(`DELETE FROM users` cascade + best-effort Google revoke + `channels.stop`)이 어떤 user-visible flow로 노출되는지 reviewer가 확인할 walkthrough가 정본화되어 있지 않다.
    - **Independence**: 외부 결정 / 외부 시스템 의존 0. `src/routes/account.ts`의 `POST /api/account/delete` 정본 + `src/CLAUDE.md` "Account deletion (§3 row 179)" 정본 contract + 9-table cascade FK 정본 + `gas/addon.js`의 deletion-trigger 버튼·confirmation 카드 — 모두 코드/문서 정본이 존재. `accountRoute.test.ts` "schema cascade contract" regex 가드가 cascade 9-table 불변식을 핀하고 있어 reviewer가 검증할 수 있는 surface가 완비됨.
  - **문제**: `docs/assets/marketplace/reviewer-demo/README.md` "Scenario matrix" 행 7 (`07-account-deletion.md`)이 `미작성`. `docs/marketplace-readiness.md` §4 같은 행도 `미작성` (Source of truth: `TBD`). 슬라이스 1~6까지 정상·실패·복구 경로를 다뤘지만, **사용자가 명시적으로 "탈퇴"를 선택했을 때의 데이터 삭제 + 외부 정리(Google revoke + watch channels stop)** 경로는 walkthrough가 없다. 마켓플레이스 privacy review의 핵심 요구 사항인 "유저 데이터 삭제 경로"가 reviewer-demo 번들 안에 정본화되어 있지 않다.
  - **해결**: `docs/assets/marketplace/reviewer-demo/07-account-deletion.md` 신규. 슬라이스 1~6과 동일 골격(Scopes 콜아웃 → Pre-conditions → "Two consent surfaces" pre-read → 단계별 `## N.` → Failure modes → Cross-references). 4단계 walkthrough — (1) reviewer가 사이드바에서 "탈퇴" 류 버튼을 탭 → confirmation 카드. (2) reviewer가 confirmation 시 `POST /api/account/delete` 호출. (3) backend 순서: Google refresh-token revoke (best-effort) → 활성 watch row마다 `channels.stop` (best-effort) → `DELETE FROM users WHERE id = ?` (authoritative writer, 9-table cascade FK fan-out: oauth_tokens / sessions / categories / sync_state / llm_usage_daily / sync_failures / llm_calls / rollback_runs / sync_runs) → 명시적 session revoke (defense-in-depth, post-cascade no-op). (4) GAS 사이드바: 응답 처리 후 home card가 logged-out / install-prompt 상태로 복귀 — 이후 호출은 401 (`Bearer no longer resolves a session`) → 정상 install 경로 복귀. Failure modes 5개: (a) Google refresh-token revoke 실패 (warn-only, 삭제 차단 안 함, 사용자 명시 의사가 우선), (b) `channels.stop` 실패 (warn-only, 7일 내 자동 만료 + `lookupChannelOwner` null 반환으로 무해), (c) 동시성 — 삭제 중에 cron의 `renewExpiringWatches`가 직전 row에 신규 channel 등록 → 7일 내 만료 (observed-not-prevented), (d) idempotency — 두 번째 호출은 401 (auth gate가 보장, 라우트 자체는 idempotent 아님), (e) 삭제 후 webhook 도착 → `lookupChannelOwner` null → no-op. **`docs/marketplace-readiness.md` 행 7 status `미작성` → `초안`** + Source of truth pointer `TBD` → `docs/assets/marketplace/reviewer-demo/07-account-deletion.md`, README scenario matrix 행 7 mirror 동기화.
  - **주요 변경**:
    1. `docs/assets/marketplace/reviewer-demo/07-account-deletion.md` 신규 — 4단계 walkthrough + Failure modes (5개) + Cross-references (5~6개). 모든 인용은 `src/routes/account.ts:NN` (route handler + best-effort revoke/channels.stop + DELETE FROM users + explicit session revoke 순서) / `src/db/schema.ts:NN` (9-table FK cascade `onDelete: "cascade"` 정의들) / `src/services/watchChannel.ts:NN` (`lookupChannelOwner` null-safe 처리) / `gas/addon.js:NN` (탈퇴 버튼 + confirmation 카드 + 응답 처리) / `src/CLAUDE.md` "Account deletion (§3 row 179)" 인용 기반이며, 드리프트 가드(`grep -n` 통과)를 만족.
    2. `docs/marketplace-readiness.md` §4 행 7 status `미작성` → `초안`, Source of truth `TBD` → `docs/assets/marketplace/reviewer-demo/07-account-deletion.md`.
    3. `docs/assets/marketplace/reviewer-demo/README.md` "Scenario matrix" 행 7 status `미작성` → `초안` (mirror 동기화).
    4. 테스트 변경 없음 (순수 문서; backend / GAS 코드 무변경).
  - **문서**:
    - `docs/marketplace-readiness.md` — 슬라이스 7 status flip + Source of truth pointer 갱신.
    - `docs/assets/marketplace/reviewer-demo/README.md` — Scenario matrix 행 7 status flip.
    - `docs/architecture-guidelines.md` — 변경 없음 (slice 7은 `:21`의 "User-initiated deletion" 정책을 user-visible proof로 보여주는 슬라이스이며 새 정책을 추가하지 않음).
    - `src/CLAUDE.md` / `gas/CLAUDE.md` — 변경 없음.
    - `TODO.md` — 슬라이스 시리즈는 §7 행에 묶이지 않으므로 체크박스 flip 없음. Launch Gate "Reviewer demo bundle"은 이미 `초안` (슬라이스 4 PR에서 도달). 다음 임계는 8-슬라이스 완료 시 `완료` 승급.
  - **의존성**: 없음. (외부 의존 0, 코드 변경 0.)
  - **사이즈**: M.

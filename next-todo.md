# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§3 status row 179 / Account-deletion endpoint (`POST /api/account/delete`)**
  - **선정 근거**:
    - **Visibility**: 사용자 노출 privacy 기능 — Marketplace listing 검수가 "user can revoke + delete data" 흐름을 직접 확인. 가장 사용자 가시적인 §3 행.
    - **Independence**: 외부 결정 / 외부 시스템 의존 없음. 스키마는 이미 9개 user-scoped 테이블 모두 `onDelete: "cascade"` 설정됨 (`src/db/schema.ts`) — DB cascade는 자동.
    - **Size**: M — `docs/marketplace-readiness.md:179` Notes 컬럼이 "Must exist before submission" 명시한 path-critical 항목. §3 미작성 행 중 외부 결정·구현 차단이 없는 유일한 항목.
  - **문제**: `docs/marketplace-readiness.md:179` §3 status 행 `Deletion on account revoke`가 `미작성`이며 Notes가 "Must exist before submission". `src/routes/`·`gas/`에 계정 삭제 surface가 전혀 없어 (grep 0 hits) Marketplace 검수의 필수 답변(사용자가 어떻게 데이터를 삭제하는가?)이 불가능. §6.4 후속 manual rate limit과는 별개 — privacy 기능 자체.
  - **해결**: 백엔드 `POST /api/account/delete` (인증 필수) 추가 — (1) 사용자의 `oauth_tokens.encrypted_refresh_token` 복호화 후 Google 토큰 revocation 엔드포인트(`https://oauth2.googleapis.com/revoke`)로 best-effort revoke, (2) `sync_state` 행의 활성 watch 채널이 있으면 `channels.stop`으로 정리 (best-effort, 에러 무시), (3) `DELETE FROM users WHERE id = ?` — 9개 cascade FK가 자동 정리(oauth_tokens / sessions / categories / sync_state / sync_failures / llm_calls / rollback_runs / sync_runs / llm_usage_daily). 세션 쿠키 무효화 후 200 반환. 멱등 — 두 번째 호출은 세션이 이미 없어 401. GAS Add-on에 "계정 삭제 / 데이터 삭제" 버튼 추가 (확인 dialog 후 POST). 성공 시 onboarding 카드로 복귀. `docs/marketplace-readiness.md:179` 행 `미작성` → `초안`, Answer source는 신규 라우트, Notes는 "POST /api/account/delete; FK cascade로 9개 테이블 정리 + Google revoke + 세션 무효화".
  - **주요 변경**:
    1. `src/routes/account.ts` 신규 — `POST /api/account/delete` 핸들러. 인증 미들웨어 통과 후 위 3단계 실행.
    2. `src/services/googleOAuth.ts` (또는 기존 OAuth 유틸 위치) — `revokeRefreshToken(token)` 헬퍼.
    3. `src/services/watchRenewal.ts` 또는 기존 channels.stop 코드 재사용 — 활성 watch 정리.
    4. `src/index.ts` 라우터 등록.
    5. `gas/addon.js` — 계정 삭제 버튼 + 확인 dialog + POST. 위치는 settings/home card 하단.
    6. 테스트: `src/__tests__/accountRoute.test.ts` (인증, cascade, 멱등, Google revoke 실패 시 graceful continue).
    7. `docs/marketplace-readiness.md:179` Notes 컬럼 갱신.
  - **문서**:
    - `src/CLAUDE.md` — 신규 "Account deletion (§3 row 179)" 섹션 추가. cascade 정책, Google revoke의 best-effort 성격, 멱등 시맨틱, Watch 채널 정리 의무 명시.
    - `docs/architecture-guidelines.md` — 필요 시 "User-initiated deletion" 불릿 추가 (cascade FK 의존, Google API best-effort).
    - `docs/marketplace-readiness.md:179` — 행 status 갱신.
    - `TODO.md` — 해당 항목이 §3 후속 또는 §7에 있다면 체크박스 flip; grep으로 확인.
  - **의존성**: 없음. (Schema cascade 이미 설정, OAuth 토큰 암호화 이미 구현, Google revocation은 공개 API.)
  - **사이즈**: M.

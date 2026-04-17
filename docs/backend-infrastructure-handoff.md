# Section 3 Backend Infrastructure — Session Handoff

브랜치: `setup/backend-infrastructure`

이 문서는 현재 세션에서 완료한 작업과 **다음 세션에서 이어서 진행할 작업**을 정리한다. 상세 설계는 `docs/setup-backend-infrastructure-plan.md`에 이미 박제되어 있으며, 이 핸드오프는 "지금 어디까지 왔고, 다음에 무엇을 하면 되는지"만 본다.

## 완료된 작업 (현재 세션)

| Step | 커밋 | 내용 |
|---|---|---|
| §3.1 (Step 1) | `c17efaa` | Python 스캐폴딩(`main.py`, `pyproject.toml`, `uv.lock`, `.python-version`, `.venv/`) 제거 + Node/Workers용 `.gitignore` 재작성 |
| §3.2 + §3.2a (Step 2) | `729231c` | pnpm + TypeScript + Hono 스캐폴드 (`src/index.ts` `GET /healthz`), ESLint(flat)/Prettier/Vitest 하네스, `wrangler.toml` 공통+env 블록, `.dev.vars.example`, `tsconfig.json` |

**검증 완료**: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm dev` → `curl http://127.0.0.1:8787/healthz` → `{"ok":true,"env":"dev"}`.

## 현재 리포 상태 스냅샷 (다음 세션 진입 시 확인용)

- 루트 TS/pnpm 프로젝트 (`package.json`, `pnpm-lock.yaml`, `tsconfig.json`)
- `src/index.ts`, `src/env.ts`, `src/__tests__/sanity.test.ts`
- `wrangler.toml`에 `[env.dev]`/`[env.prod]` 블록 존재(시크릿·redirect URI는 아직 비어 있음)
- **아직 없음**: `src/db/*`, `src/routes/*` (healthz 제외), `src/services/*`, `src/lib/*`, `src/middleware/*`, `src/config/*`, `drizzle/`, `drizzle.config.ts`, `scripts/gen-secrets.ts`, `.dev.vars` (실제 값)

## 다음 세션 진입 전 — 사용자 수동 작업 (외부 리소스 셋업)

Step 3(DB 연결) 진입에 아래 3가지가 선행되어야 한다. 완료 후 획득한 값들을 다음 세션에 전달한다.

### A. Supabase `autocolor-dev` 프로젝트 생성
1. https://supabase.com → **New Project**
   - Name: `autocolor-dev`
   - Region: `Northeast Asia (Seoul)` 권장
   - Database Password: 강력한 값 생성 후 1Password 등에 보관
2. 프로젝트 생성 후 **Database → Extensions** 로 이동
   - `vector` 활성화 (섹션 5 임베딩용)
   - `pgcrypto` 활성화 (UUID 생성용)
3. **Settings → Database → Connection string** 에서 두 URL 복사:
   - **Transaction pooler (port 6543)** → `?sslmode=require` 포함 확인 → `DATABASE_URL`
   - **Direct connection (port 5432)** → `DIRECT_DATABASE_URL`
4. 두 URL + DB 비밀번호를 팀 보관소에 저장

> ⚠️ Pooler URL(6543)은 런타임 전용, Direct URL(5432)은 마이그레이션/DDL 전용. 두 용도를 섞어 쓰지 않는다.

### B. Google Cloud Console OAuth 2.0 Web Client
1. https://console.cloud.google.com → 프로젝트 선택 또는 새로 생성
2. **APIs & Services → Library** 에서 활성화:
   - Google Calendar API
   - (userinfo 용) `openid`·`email` scope만 쓰면 별도 API 활성화 불필요
3. **OAuth consent screen** (왼쪽 메뉴)
   - User Type: **External**
   - 앱 이름, 지원 이메일 입력
   - **Scopes** 추가:
     - `openid`
     - `email`
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/calendar.events`
   - Test users 에 본인 이메일 추가(검수 전 테스트 단계)
4. **Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `autocolor-dev`
   - **Authorized redirect URIs**: 지금은 비워두고, Step 6에서 `wrangler deploy --env dev` 후 얻는 `https://autocolor-dev.<acct>.workers.dev/oauth/google/callback` 추가 예정
5. 생성된 **Client ID**, **Client Secret** 을 보관

### C. Cloudflare `wrangler login`
터미널에서 직접 실행 (브라우저 인증 필요 — Claude가 수행 불가):

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

`whoami` 출력에서 **워커 서브도메인**(`<acct>.workers.dev`) 을 확인 후 다음 세션에 전달.

### 다음 세션에 전달할 값 요약

| 이름 | 출처 | 용도 |
|---|---|---|
| `DATABASE_URL` | Supabase Pooler (6543, `?sslmode=require`) | 런타임 DB 연결 |
| `DIRECT_DATABASE_URL` | Supabase Direct (5432) | drizzle-kit 마이그레이션 |
| `GOOGLE_CLIENT_ID` | GCP OAuth Web Client | OAuth 플로우 |
| `GOOGLE_CLIENT_SECRET` | GCP OAuth Web Client | OAuth 플로우 |
| Cloudflare 워커 서브도메인 | `wrangler whoami` | Step 6 Redirect URI 조립 |

전달 방법은 `.dev.vars` 로컬 파일 직접 작성 권장(리포에는 절대 커밋되지 않음 — `.gitignore`에 이미 등록). 비밀 값을 대화에 직접 붙이지 말 것.

## 다음 세션 실행 계획 (Step 3–6)

원본 계획(`docs/setup-backend-infrastructure-plan.md`)의 "구현 순서" 3·4·5·6번을 그대로 실행한다. 요약만 아래에 둔다.

### Step 3 — DB 연결 (§3.3)
1. `drizzle.config.ts` 작성 (`DIRECT_DATABASE_URL` 사용, out: `./drizzle`)
2. `src/db/client.ts`: per-request `postgres(DATABASE_URL, { prepare: false })` 팩토리
3. `src/db/index.ts`: re-export
4. 임시 스모크 라우트 `GET /db-ping` → `SELECT 1` 왕복 검증 후 제거(또는 `/healthz` 통합)
5. 커밋: `feat(backend): wire Supabase (postgres.js pooler) + drizzle config`

### Step 4 — 스키마 + RLS (§3.4)
원본 계획 §"DB 스키마"를 그대로 구현:
- `src/db/schema.ts`: `users`, `oauth_tokens`, `sessions`, `categories`, `sync_state`
- `pnpm db:generate` → `drizzle/0000_init.sql`
- `drizzle/9999_rls.sql` 수기 작성 (5개 테이블 RLS enable + `auth.uid()` 정책)
- `pnpm db:migrate` (Direct URL) 후 Supabase Studio에서 테이블·RLS 확인
- 커밋: `feat(db): initial schema + manual RLS policies`

> ⚠️ **RLS는 Workers 경로에서 작동하지 않음** — Workers는 `postgres` DB role(BYPASSRLS)로 접속. 멀티 테넌트 격리는 전적으로 `where(eq(table.user_id, ctx.userId))` 애플리케이션 로직 책임.

### Step 5 — OAuth 플로우 + 보호 라우트 (§3.5 + §3.5a)
**선행**: `wrangler deploy --env dev` 1회 실행 → 고정 URL 확보 → GCP OAuth Redirect URI 등록 → GAS ScriptProperties `BACKEND_BASE_URL`/`OAUTH_AUTH_URL` 반영.

파일 구현:
- `src/lib/crypto.ts` — AES-256-GCM (IV 12B, AAD=`"user:"+user_id`), HMAC-SHA256, 상수시간 비교
- `src/lib/random.ts` — base64url 32B 토큰
- `src/lib/state.ts` — OAuth state HMAC 서명/검증 (TTL 10분)
- `src/config/constants.ts` — scope, TTL(abs 60일 / roll 30일), 에러 코드
- `src/services/googleOAuth.ts`, `sessionService.ts`, `userService.ts`, `oauthTokenService.ts`
- `src/middleware/auth.ts`, `logger.ts` (JSON + redaction), `errorHandler.ts`
- `src/routes/oauth.ts` (`/oauth/google`, `/oauth/google/callback`)
- `src/routes/auth.ts` (`POST /auth/logout`)
- `src/routes/me.ts` (보호된 `GET /me` → `{userId, email, needs_reauth}`)
- Vitest: `src/__tests__/`에 crypto 왕복, state HMAC 상수시간, sessionHash HMAC-SHA256 테스트
- 커밋: `feat(backend): Google OAuth flow + session mgmt + protected /me + structured logs`

### Step 6 — 환경 분리 + 시크릿 부트스트랩 (§3.6 + §3.6a)
- `scripts/gen-secrets.ts` (tsx) — dev/prod 각각 `TOKEN_ENCRYPTION_KEY`/`SESSION_HMAC_KEY`/`SESSION_PEPPER` 3종 base64(32B) 생성
- 모든 시크릿 `wrangler secret put <NAME> --env {dev|prod}` 로 주입 (dev 먼저)
- 팀 보관소에 즉시 백업 (**분실 시 복구 불가**)
- `wrangler deploy --env prod` 빈 셸 배포로 prod 도메인·redirect URI 확보
- 커밋: `chore(backend): dev/prod env split + secret rotation runbook`

### Step 7 — 사후 작업
- 루트 `CLAUDE.md`에 `- Backend Module: @src/CLAUDE.md` 추가
- `src/CLAUDE.md` 신규 작성: RLS-not-in-Workers 경고, GAS `/exec` URL 고정 규칙, 마이그레이션 방식, 시크릿 로테이션 영향, 로그 redaction 필수 필드
- `TODO.md` §3 체크박스(6 + 3 sub) 완료 표시
- `docs/architecture-guidelines.md` "Halt on Failure"에 `invalid_grant` 예외 한 문장 보강
- GAS UX 개선·`buildHomeCard` property 검증·세션 GC pg_cron은 **별도 TODO 이월**

## 검증 체크리스트 (Step 6까지 완료 후)

1. `pnpm dev` → `/healthz` 200 OK
2. `pnpm db:migrate` 후 Supabase Studio에서 5테이블 + RLS 활성 확인
3. GAS 로그인 → Google Consent → `doGet(?token=...)` → `UserProperties.ACFC_SESSION_TOKEN` 저장; DB에 `users`/`oauth_tokens`/`sessions` 각 1 row + `encrypted_refresh_token`이 평문이 아님을 확인
4. `GET /me`: 유효 세션 200, 무토큰/잘못된 토큰 401
5. `POST /auth/logout` 후 동일 토큰 `GET /me` → 401 (+ `sessions.revoked_at` 세팅)
6. OAuth 실패 경로: state 위조 → `?error=state_invalid`; consent 취소 → `?error=consent_denied`
7. `pnpm test` green (crypto/state/sessionHash)
8. `pnpm lint` 에러 0
9. `wrangler deploy --env dev` 성공 + 실배포 URL에서 1–6 반복
10. `wrangler deploy --env prod` 빈 셸 성공

## 다음 세션 시작 시 안내 프롬프트 템플릿

다음 세션에서 이 작업을 재개할 때, 아래 내용을 Claude에게 전달하면 바로 Step 3부터 진입할 수 있다:

> `setup/backend-infrastructure` 브랜치에서 백엔드 인프라 §3 작업을 이어서 한다.
> `docs/backend-infrastructure-handoff.md`와 `docs/setup-backend-infrastructure-plan.md` 를 먼저 읽어라.
> 외부 리소스 셋업은 완료됐고, `.dev.vars`에 `DATABASE_URL`, `DIRECT_DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 값을 직접 넣어 두었다.
> Cloudflare 워커 서브도메인은 `<여기에_입력>.workers.dev` 이다.
> Step 3(DB 연결)부터 Step 6(환경 분리·시크릿) 순서로 진행해라.

## 참고 문서

- 전체 아키텍처·설계 결정·리스크: `docs/setup-backend-infrastructure-plan.md`
- GAS 클라이언트 계약(변경 금지): `gas/api.js`, `gas/auth.js`, `gas/addon.js`
- 아키텍처 가이드라인: `docs/architecture-guidelines.md`

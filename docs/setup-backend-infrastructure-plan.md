# Section 3 — Backend (Cloudflare Workers + Supabase) Infrastructure Setup

Branch: `setup/backend-infrastructure`

## Context

`TODO.md` 섹션 3의 6개 서브태스크를 완료하여 백엔드 인프라 기반을 구축한다. 현재 GAS 클라이언트는 완성되어 있으나(`gas/api.js`, `gas/auth.js`, `gas/addon.js`) 백엔드가 존재하지 않아 OAuth 로그인·세션 발급·동기화 로직(섹션 4, 5)을 구현할 기반이 없다. 또한 이전 스캐폴딩이 Python(FastAPI) 기반으로 남아 있어 TypeScript/Workers 스택으로 교체가 필요하다.

최종 산출물: `wrangler dev`로 로컬 기동되며 dev Supabase에 마이그레이션이 적용되고, GAS 로그인 → `/oauth/google` → Google Consent → `/oauth/google/callback` → GAS `doGet(?token=...)` 왕복이 end-to-end로 성공하는 상태.

## GAS 클라이언트 계약 (변경 없이 유지)

- 세션 토큰 헤더: `Authorization: Bearer <opaque token>` — `gas/api.js:23`
- OAuth 시작 URL: `ScriptProperties.OAUTH_AUTH_URL` — `gas/addon.js:572`
- 백엔드 베이스 URL: `ScriptProperties.BACKEND_BASE_URL` — `gas/api.js:5`
- 콜백 처리: GAS 웹앱 `doGet(e)`가 `?token=` 쿼리를 수신하여 `UserProperties.ACFC_SESSION_TOKEN`에 저장 — `gas/addon.js:582`, `gas/auth.js:5`
- 401 시 토큰 자동 삭제 → 재로그인 — `gas/api.js:44-46`

백엔드는 위 계약을 준수해야 한다.

## 아키텍처 결정

- **라우팅**: Hono (Workers 네이티브, ~14KB, 타입 안전한 `c.env` 바인딩).
- **DB 드라이버**: `postgres.js` + Supabase Transaction Pooler(6543, `?sslmode=require`, `prepare: false`). `nodejs_compat` 플래그 필수. 리스크 발생 시 Hyperdrive 바인딩으로 대체.
- **ORM**: Drizzle + `drizzle-kit`. 마이그레이션은 생성 SQL + 수기 RLS 파일로 구성.
- **세션 토큰**: 불투명(Opaque) 32바이트 랜덤 + DB 해시 저장(`HMAC-SHA256(SESSION_PEPPER, token)`). JWT 미채용 — 취소 가능성·단순성 우위. **TTL**: absolute 60일 + rolling 30일(사용 시 `expires_at` 갱신). 상수는 `src/config/constants.ts`.
- **Refresh Token 암호화**: AES-256-GCM (Web Crypto), IV 12B 랜덤, AAD = `"user:" + user_id`로 row-swap 방어. `iv`·`encrypted_refresh_token` 2개 bytea 컬럼(태그는 ciphertext 뒤에 결합). `token_version` 컬럼으로 키 로테이션 지원.
- **OAuth `state`**: HMAC-SHA256 서명(`SESSION_HMAC_KEY`)된 `{nonce, iat}` — 서버 저장소 불필요, TTL 10분. **서명 비교는 상수시간**(`crypto.subtle` 기반 timing-safe compare)로 구현.
- **환경 분리**: 단일 코드베이스, `wrangler.toml`의 `[env.dev]`/`[env.prod]`로 스위치. 워커 이름 `autocolor-dev`, `autocolor-prod`.

## 파일 레이아웃

```
/
├─ package.json, pnpm-lock.yaml, tsconfig.json
├─ wrangler.toml
├─ drizzle.config.ts
├─ .dev.vars (gitignored), .dev.vars.example
├─ .eslintrc.cjs, .prettierrc
├─ vitest.config.ts
├─ scripts/
│  └─ gen-secrets.ts            # 32B base64 키(TOKEN/HMAC/PEPPER) 생성
├─ src/
│  ├─ index.ts                  # Hono app + route mount
│  ├─ env.ts                    # Env/Bindings 타입
│  ├─ routes/
│  │   ├─ oauth.ts              # /oauth/google, /oauth/google/callback
│  │   ├─ auth.ts               # POST /auth/logout (현재 세션 revoke)
│  │   ├─ me.ts                 # 보호된 GET /me (needs_reauth 필드 포함)
│  │   └─ health.ts             # /healthz
│  ├─ middleware/
│  │   ├─ auth.ts               # Bearer → user_id 로더
│  │   ├─ errorHandler.ts       # OAuth 실패 → GAS_REDIRECT_URL?error= 302
│  │   └─ logger.ts             # JSON structured + redaction(Authorization/token/code/refresh_token/email/sub)
│  ├─ services/
│  │   ├─ googleOAuth.ts        # code/token 교환, invalid_grant 감지
│  │   ├─ sessionService.ts     # 세션 발급/검증/폐기(rolling TTL)
│  │   ├─ userService.ts        # google_sub upsert
│  │   └─ oauthTokenService.ts  # 암/복호화 + 영속
│  ├─ db/
│  │   ├─ client.ts             # per-request drizzle factory
│  │   ├─ schema.ts             # 모든 테이블 + 관계
│  │   └─ index.ts
│  ├─ lib/
│  │   ├─ crypto.ts             # AES-256-GCM, HMAC-SHA256, 상수시간 비교
│  │   ├─ random.ts             # base64url 32B 토큰 생성
│  │   └─ state.ts              # OAuth state HMAC (상수시간 검증)
│  ├─ config/constants.ts       # scope, 세션 TTL, 에러 코드 등
│  └─ __tests__/                # Vitest: crypto, state, sessionHash
└─ drizzle/
   ├─ 0000_init.sql             # generated
   ├─ 9999_rls.sql              # 수기 RLS
   └─ meta/
```

## DB 스키마 (Drizzle, `src/db/schema.ts`)

- **`users`**: `id uuid pk`, `google_sub text unique`, `email text`, `created_at`, `updated_at`.
- **`oauth_tokens`**: `id uuid pk`, `user_id fk cascade`, `provider text default 'google'`, `encrypted_refresh_token bytea`, `iv bytea`, `scope text`, `token_version int default 1`, `created_at`, `updated_at`, `rotated_at timestamptz`. `UNIQUE(user_id, provider)`.
- **`sessions`**: `id uuid pk`, `user_id fk`, `token_hash bytea unique`, `expires_at`, `created_at`, `revoked_at`, `user_agent text`.
- **`categories`**: `id uuid pk`, `user_id fk`, `name`, `color_id text`(Google Calendar 1–11), `keywords text[]`, `priority int default 100`, `created_at`, `updated_at`. Index `(user_id, priority)`.
- **`sync_state`**: `id uuid pk`, `user_id fk`, `calendar_id text`, `next_sync_token text`, `watch_channel_id`, `watch_resource_id`, `watch_expiration timestamptz`, `last_full_resync_at`, `updated_at`. `UNIQUE(user_id, calendar_id)`.

**수기 RLS (`drizzle/9999_rls.sql`)**: 5개 테이블 전부 `ENABLE ROW LEVEL SECURITY` + `auth.uid() = user_id` (users는 `auth.uid() = id`) 정책.

> ⚠️ **중요 — RLS는 Workers 경로에서 작동하지 않음.** Workers는 `DATABASE_URL`(Supabase pooler)을 통해 `postgres` DB role로 직접 접속하며, 이 role은 BYPASSRLS 속성을 가져 RLS가 완전히 무시된다. RLS는 `auth.uid()`를 세팅하는 Supabase GoTrue JWT 기반 접속(Studio, Edge Function, `supabase-js` with anon key)에서만 의미를 가진다.
>
> **따라서 Workers 경로에서 멀티 테넌트 격리는 100% 애플리케이션 로직(모든 쿼리에 `where(eq(table.user_id, ctx.userId))`)이 책임진다.** "RLS가 켜져 있으니 안전하다"는 오해 금지. RLS 정책은 Studio 수동 작업·향후 Edge Function 확장 대비 방어선이며, 기본 보호가 아니다.
>
> (대안 — 필요 시) Workers 접속용으로 RLS가 적용되는 별도 role(`app_user`)을 만들어 `SET ROLE`·`set_config('request.jwt.claims', ...)`를 매 트랜잭션마다 세팅하는 패턴이 가능하지만, Pooler Transaction 모드 호환성과 성능 비용이 있어 섹션 3에서는 채택하지 않는다. 섹션 6(관측성) 이후 재평가.

**Extensions**: `create extension if not exists pgcrypto;` (uuid용).

## OAuth 플로우 (`src/routes/oauth.ts`)

**`GET /oauth/google`**
1. HMAC 서명된 `state` 생성(`SESSION_HMAC_KEY`, TTL 10분).
2. Google Consent URL로 302 redirect. 파라미터: `client_id`, `redirect_uri` = `${WORKER_BASE_URL}/oauth/google/callback`, `response_type=code`, `access_type=offline`, **`prompt=consent`** (refresh_token 보장), `scope=openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events`.

**`GET /oauth/google/callback`**
1. `state` HMAC/TTL 검증(상수시간 비교).
2. `https://oauth2.googleapis.com/token`에 code 교환 → refresh_token 필수.
3. `openidconnect.googleapis.com/v1/userinfo`로 `sub`, `email` 조회.
4. `users` upsert (by `google_sub`).
5. refresh_token을 AES-256-GCM 암호화 후 `oauth_tokens` upsert (on conflict by `(user_id, provider)` → 재암호화 덮어쓰기).
6. opaque 세션 토큰 발급 → `sessions` insert(`HMAC-SHA256(SESSION_PEPPER, token)` 저장).
7. `GAS_REDIRECT_URL + '?token=' + encodeURIComponent(token)`로 302 (GAS `doGet` 웹앱 URL).

**에러 처리 규약** — 실패 시 `GAS_REDIRECT_URL + '?error=<code>'`로 302:
- `state_invalid` — state 서명/TTL 실패
- `consent_denied` — Google이 `?error=access_denied` 반환(사용자 취소)
- `token_exchange_failed` — Google token endpoint 4xx/5xx
- `invalid_grant` — refresh_token 폐기 감지 시 `oauth_tokens` 해당 row 삭제 + 세션 revoke 후 이 코드로 리다이렉트
- `server_error` — 기타 내부 예외

GAS `doGet`은 `?token=` 성공 경로와 `?error=` 실패 경로를 분기한다. 성공 경로의 `authCallback.html`은 `history.replaceState`로 URL에서 토큰을 즉시 제거하고 창 자동 닫힘/애드온 복귀 안내를 표시해야 한다(사후 작업).

**`POST /auth/logout`** — Bearer 세션 토큰을 받아 `sessions.revoked_at = now()` 기록. 200. GAS는 응답 후 로컬 `ACFC_SESSION_TOKEN` 삭제.

## Wrangler 설정

`wrangler.toml` 공통:
```toml
name = "autocolor"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]
```
`[env.dev]`: `name = "autocolor-dev"`, vars `ENV=dev`, `GOOGLE_OAUTH_REDIRECT_URI=https://autocolor-dev.<acct>.workers.dev/oauth/google/callback`.
`[env.prod]`: `name = "autocolor-prod"`, custom domain (추후 Search Console 인증 도메인) 사용.

**Secrets** (`wrangler secret put <NAME> --env {dev|prod}`):
- `DATABASE_URL` — Supabase **Pooler** URL(6543, `?sslmode=require`) — 런타임 전용
- `DIRECT_DATABASE_URL` — Supabase **Direct** URL(5432) — 마이그레이션/DDL 전용(로컬 `.dev.vars`에만; Worker 시크릿으로 주입하지 않음)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY` — base64(32B), `scripts/gen-secrets.ts`로 생성
- `SESSION_HMAC_KEY` — base64(32B)
- `SESSION_PEPPER` — base64(32B)
- `GAS_REDIRECT_URL` — GAS 웹앱 `/exec` URL (env별)

**§3 범위에서는 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`를 Worker 시크릿에 주입하지 않는다**(최소 권한 원칙). 필요 시 섹션 4 이후 재평가.

로컬 `.dev.vars`에 동일 키 dev 값 + `DIRECT_DATABASE_URL`. `.dev.vars.example` 템플릿 커밋.

## 의존성

**Runtime**: `hono`, `drizzle-orm`, `postgres`, `zod`
**Dev**: `typescript`, `wrangler`, `@cloudflare/workers-types`, `drizzle-kit`, `@types/node`, `tsx`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier`, `eslint-config-prettier`

package.json scripts:
- `dev` → `wrangler dev --env dev`
- `deploy:dev`, `deploy:prod` → `wrangler deploy --env {dev|prod}`
- `db:generate` → `drizzle-kit generate`
- `db:migrate` → `drizzle-kit migrate` (Direct URL 사용)
- `db:push` → `drizzle-kit push` (dev 전용, Direct URL)
- `test`, `test:watch` → Vitest
- `lint`, `format` → ESLint / Prettier
- `gen-secrets` → `tsx scripts/gen-secrets.ts`

## 구현 순서

1. **정리 (3.1)** — `git rm main.py pyproject.toml uv.lock .python-version`; `rm -rf .venv`; `.gitignore`에서 Python 섹션 제거, Node/Workers 섹션 추가(`node_modules/`, `.wrangler/`, `.dev.vars`, `dist/`, `.env*`, `!.env.example`).
2. **Workers 스캐폴드 (3.2)** — `pnpm init`; deps 설치; `wrangler.toml` 수기 작성; `tsconfig.json` 설정; `src/index.ts`로 Hono 앱 + `/healthz` 라우트; `wrangler dev`로 200 OK 확인.
   - **3.2a** — 린트/포맷/테스트 하네스 스캐폴드(ESLint, Prettier, Vitest + `vitest.config.ts`). 이후 `src/lib/crypto.ts`·`src/lib/state.ts` 작성 시 유닛 테스트(HMAC 상수시간 비교, AES-GCM 왕복, 세션 해시 HMAC-SHA256 검증)를 함께 커밋.
3. **DB 연결 (3.3)** — Supabase dev 프로젝트 수동 생성, pooler/direct URL 획득; `drizzle.config.ts` 작성. **`drizzle.config.ts`는 `DIRECT_DATABASE_URL`(포트 5432)을 사용**하고, 런타임(`DATABASE_URL`, Pooler 6543, `prepare: false`)과 분리한다(Pooler Transaction 모드에서 DDL/prepared statement 이슈 회피). `src/db/client.ts`는 `postgres(DATABASE_URL, { prepare: false })`; `SELECT 1` 스모크 테스트 라우트로 연결 검증. 마이그레이션 실행은 **개발자 로컬에서 `pnpm db:migrate` 수동 실행**(dev/prod 모두).
4. **스키마 + RLS (3.4)** — `src/db/schema.ts` 작성 → `pnpm db:generate` → `drizzle/9999_rls.sql` 수기 작성 → `pnpm db:migrate` → Supabase Studio에서 테이블/RLS 확인.
5. **OAuth 플로우 (3.5)** — `lib/crypto.ts`, `lib/state.ts`, `services/googleOAuth.ts`, `services/sessionService.ts`, `routes/oauth.ts` 구현; `middleware/auth.ts`로 Bearer 검증. Dev 검증은 **`wrangler deploy --env dev`로 `autocolor-dev.<acct>.workers.dev` 고정 URL** 확보 후 Google Redirect URI·GAS ScriptProperties에 반영하여 end-to-end 로그인 수행(`wrangler dev`는 단위/부분 테스트용).
   - **3.5a** — 보호된 `src/routes/me.ts`(응답에 `{ userId, email, needs_reauth: boolean }` 예약) + `src/routes/auth.ts`(`POST /auth/logout` — 현재 세션 `revoked_at` 기록) + `src/middleware/logger.ts`(JSON + `Authorization`/`token`/`code`/`state`/`refresh_token`/`access_token`/`email`/`sub` redaction) + `src/middleware/errorHandler.ts`에 OAuth 에러 → `GAS_REDIRECT_URL?error=<code>` 302 리다이렉트 규약 반영.
6. **환경 분리 (3.6)** — `[env.dev]`/`[env.prod]` 확정; 모든 시크릿을 dev/prod 양쪽에 `wrangler secret put`; prod 빈 셸 `wrangler deploy --env prod`로 배포하여 도메인·리디렉트 URI 확보.
   - **3.6a** — `scripts/gen-secrets.ts`(tsx)로 dev/prod 각각 TOKEN/HMAC/PEPPER 3종을 생성 → `wrangler secret put ... --env {dev|prod}` 주입 → 즉시 팀 보관소(1Password 등)에 백업. `src/CLAUDE.md`에 **시크릿 로테이션 절차**(`SESSION_PEPPER` 교체 = 전 세션 무효화 / `TOKEN_ENCRYPTION_KEY` 교체 = 전 `oauth_tokens` 재암호화 배치 필요, 실제 배치는 섹션 6) 박제.

## 수동 작업 (코드 외)

- **Supabase**: `autocolor-dev`, `autocolor-prod` 두 프로젝트 생성. 각각 `pgcrypto` extension 활성화. Pooler(6543) + Direct(5432) URL 모두 확보.
- **Google Cloud Console**: OAuth 2.0 Web Client 생성(또는 기존 업데이트), Redirect URIs에 dev/prod 콜백 등록, Calendar API + People API(userinfo) 활성화, Consent Screen scopes 등록.
- **Cloudflare**: `wrangler login`, dev/prod 워커 이름 확보.
- **Dev Worker 배포 URL 확보**: 3.6 이전이라도 `wrangler deploy --env dev`를 1회 실행하여 `autocolor-dev.<acct>.workers.dev` URL을 확보 → Google Redirect URI 등록 → GAS ScriptProperties `BACKEND_BASE_URL`·`OAUTH_AUTH_URL`에 반영. (로컬 `wrangler dev`는 공개 HTTPS가 아니므로 Google OAuth 콜백을 end-to-end 검증할 수 없다.)
- **GAS ScriptProperties 체크리스트**: dev/prod 각각 `BACKEND_BASE_URL`, `OAUTH_AUTH_URL` **양쪽 필수 설정**. 미설정 시 애드온이 `gas/api.js`의 fallback(`https://api.example.com`)으로 요청 → 404. `buildHomeCard`에서 property 존재를 사전 검증하여 "백엔드 구성 필요" 카드를 표시하도록 개선(사후 작업).
- **시크릿 생성·백업**: `pnpm gen-secrets`로 dev/prod 각각 TOKEN/HMAC/PEPPER 3종 생성 → `wrangler secret put ... --env {dev|prod}` → 팀 공통 보관소(1Password 등)에 즉시 백업. **분실 시 복구 불가**(전 사용자 재로그인 + 암호화된 refresh_token 폐기).
- **GAS 측**: 현행 `doGet(e)`가 `?token=` 수신하도록 되어 있음을 확인(`addon.js:582`). `?error=<code>` 분기 처리 및 `authCallback.html`의 `history.replaceState`/자동 창 닫힘 개선은 사후 작업.
  - ⚠️ **GAS 웹앱 URL 고정 가이드**: 코드 변경 시 "새 배포(New Deployment)"를 만들지 말고, **Apps Script 편집기 → 배포 → 배포 관리 → 기존 배포의 연필(Edit) → 버전을 '새 버전(New Version)'으로 선택 → 배포**. 이 방식은 `/exec` URL을 유지하므로 `GAS_REDIRECT_URL` 시크릿과 Google Cloud Console의 OAuth 콜백·승인된 URL을 매번 갱신할 필요가 없다. 반드시 이 절차를 런북/팀 규약(`src/CLAUDE.md`)에 명시.

## 리스크

- **`postgres.js` + Pooler**: SCRAM 인증·Buffer 이슈 간헐. 스모크 테스트 우선 검증; 실패 시 Hyperdrive 또는 `@neondatabase/serverless`로 전환.
- **GAS `/exec` URL 변동**: "새 배포"가 아닌 "기존 배포 버전 업데이트"로 배포하면 URL 고정(수동 작업 섹션 참조). 이 규칙 미준수 시 시크릿·OAuth redirect URI 갱신 필요.
- **도메인 인증**: 섹션 3 비블로킹이나 섹션 4 Watch API 위해 prod custom domain 조기 확보 권장.
- **세션 GC**: §3에서는 TTL(abs 60일/roll 30일) 설정 + `token_hash` 인덱스까지만. `pg_cron` 주간 정리는 섹션 6(관측성) 이관.
- **Refresh token 로테이션(deferred)**: `token_version` 컬럼만 준비. 키 교체 시 전 row 재암호화 배치는 섹션 6 범위. §3은 절차 문서화(`src/CLAUDE.md`)만 수행.
- **OAuth 스코프 축소 검토**: 현행 `calendar + calendar.events`는 캘린더 목록 full access 포함. 향후 `calendar.readonly + calendar.events`로 축소 가능한지 사용자 동의 화면·기능 영향 평가 필요. §3는 원안 유지.
- **Rate limiting**: `/oauth/*`, `/me`, `/auth/logout`의 DoS/brute-force 노출. 섹션 6 관측성/보호 범위로 이월.
- **세션 토큰 URL 전달 리스크**: `?token=`은 브라우저 히스토리·Referer·GAS 로그에 남을 수 있음. 완화책: TTL 상한(abs 60일), `authCallback.html`에서 `history.replaceState`로 URL 즉시 정리, HTTPS 전용.

## 검증 (Verification)

1. `pnpm dev` → `curl http://localhost:8787/healthz` → `200 OK`.
2. `pnpm db:migrate`(Direct URL) 후 Supabase Studio에서 5개 테이블 + RLS 활성 확인.
3. GAS dev 배포 → Add-on에서 로그인 → Google Consent → `doGet` 콜백 → `UserProperties.ACFC_SESSION_TOKEN` 저장 확인. DB: `users`, `oauth_tokens`, `sessions` 각 1 row 생성 + `oauth_tokens.encrypted_refresh_token`이 평문이 아님을 확인.
4. `GET /me`: 유효 세션 토큰으로 200(`{ userId, email, needs_reauth: false }`), 무토큰/잘못된 토큰으로 401.
5. `POST /auth/logout`: 200 후 동일 토큰으로 `GET /me` 호출 시 401(`sessions.revoked_at` 세팅 확인).
6. OAuth 실패 경로 시뮬레이션: (a) state 위조 → `?error=state_invalid`, (b) Google consent 취소 → `?error=consent_denied`. GAS `authError.html`이 분기 메시지를 표시(사후 작업 검증).
7. `pnpm test` → crypto(AES-GCM 왕복)·state(HMAC 상수시간)·sessionHash(HMAC-SHA256) 유닛 테스트 green.
8. `pnpm lint` → 오류 0.
9. `wrangler deploy --env dev` 성공 + 실배포 환경에서 1~6 반복.
10. `wrangler deploy --env prod` (빈 셸) 성공 확인.

## 사후 작업

- 루트 `CLAUDE.md`에 `- Backend Module: @src/CLAUDE.md` 참조 추가.
- `src/CLAUDE.md` 신규 작성: 백엔드 전용 규칙 박제
  - **"RLS는 Workers 경로에서 적용되지 않으며 모든 쿼리의 `where(eq(table.user_id, ctx.userId))`가 유일 격리 수단"**
  - **GAS `/exec` URL 고정 규칙**(새 배포 금지, 기존 배포 Edit → New Version)
  - **마이그레이션은 `DIRECT_DATABASE_URL`로 로컬 `pnpm db:migrate` 수동 실행** (런타임은 Pooler)
  - **시크릿 로테이션 영향**: `SESSION_PEPPER` 교체 → 전 세션 무효화; `TOKEN_ENCRYPTION_KEY` 교체 → 전 `oauth_tokens` 재암호화 배치 필요(섹션 6)
  - **로그 redaction 필수 필드** 목록
- `TODO.md` 섹션 3 체크박스(6 + 3 sub) 완료 표시.
- `gas/authCallback.html`·`gas/authError.html` UX 개선 티켓 생성(섹션 3 범위 밖, 별도 TODO):
  - `authCallback.html`: `history.replaceState`로 URL에서 `?token=` 제거 + "다시 애드온으로 돌아가세요" + 자동 창 닫힘 스크립트
  - `authError.html`: `?error=` 쿼리 파라미터별 한국어 메시지(`state_invalid` / `consent_denied` / `token_exchange_failed` / `invalid_grant` / `server_error`)
- `gas/addon.js` `buildHomeCard`에서 `BACKEND_BASE_URL`·`OAUTH_AUTH_URL` 사전 검증 카드 추가(별도 TODO).
- `docs/architecture-guidelines.md`의 "Halt on Failure" 조항에 "OAuth `invalid_grant` 감지 시는 예외적으로 재로그인 유도 경로로 종료(로컬 fallback 금지 원칙은 유지)" 한 문장 보강.
- **세션 GC 잡(TODO)**: Supabase `pg_cron` extension 활성화 후 주 1회 `DELETE FROM sessions WHERE expires_at < now() - interval '7 days'` 스케줄 등록. MVP에서는 선택이지만 누적 방지를 위해 섹션 6(관측성) 범위에 포함 권장. (MVP 단계에서는 TODO 메모만 추가.)

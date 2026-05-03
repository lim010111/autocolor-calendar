# 02 — Prod environment activation

> 이 runbook은 [`TODO.md` §3 후속 line 35](../../TODO.md) "Prod 환경 활성화"의
> 정본 절차다. 현재 `autocolor-prod` Worker는 URL-reserving shell —
> `[env.prod.vars]`에 `ENV` / `GOOGLE_OAUTH_REDIRECT_URI` 자리만 있고
> 시크릿 / Hyperdrive / Queue / cron 모두 미주입
> ([`src/CLAUDE.md` "Environments"](../../src/CLAUDE.md)). runbook이 끝나면
> `/healthz` / `/oauth/google/callback` / `/me`가 prod에서 200을 응답하고
> sync 1회가 `sync_runs` 1행 ok로 마무리된다.
>
> Owner: Eng. 시작 시점은 G1 (Domain) Step 1-3 완료 권장 (verified 도메인
> → Watch API 즉시 활성화). 미완 시 prod도 `WEBHOOK_BASE_URL` 미주입으로
> 시작 가능 — verified 후 갱신.

- **Pre-conditions**:
  - Cloudflare 계정 보유, GCP 콘솔 접근 권한.
  - 로컬 `.dev.vars`로 dev Worker가 정상 동작 (`/healthz` 200 + OAuth 플로우)
    검증된 상태 — 같은 흐름을 prod에 복제하는 작업이다.
  - `pnpm install` 완료, `pnpm wrangler whoami`가 본인 계정 응답.
- **Acceptance**:
  - `curl https://<prod>/healthz` → 200
  - test 계정 OAuth 플로우 1회 성공
  - 카테고리 1개 추가 후 sync 트리거 → `sync_runs` 1행 (outcome=`ok`) +
    Calendar에서 색상 변경 시각 확인

## Step 1 — Supabase prod 프로젝트 생성

Supabase Dashboard → New project. region 선택 가이드:

- 한국 사용자 → `ap-northeast-2` (Seoul) 또는 `ap-northeast-1` (Tokyo).
- dev는 `ap-southeast-1` (Singapore) — 라이브 카탈로그
  [`docs/backend-infrastructure-handoff.md`](../backend-infrastructure-handoff.md)
  line 37 참조.
- prod는 사용자 다수가 한국이라면 Seoul, 글로벌 분포면 Tokyo / Singapore.
  같은 vendor / 가까운 지역이 latency 안정적.

생성 후 콘솔의 "Database password"를 안전한 곳에 즉시 저장 (Supabase 콘솔에서
재발급은 가능하나 즉시 다른 surface 갱신 부담).

## Step 2 — Postgres extension / 마이그레이션

- Supabase Dashboard → Database → Extensions → `pgcrypto` enable. dev와
  동일 (drizzle 마이그레이션이 `gen_random_uuid()` 등 의존).
- 로컬 `.prod.vars`에 prod `DIRECT_DATABASE_URL` 작성 (Supabase Session Pooler
  URL — 포트 5432, IPv4):
  ```
  DIRECT_DATABASE_URL=postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres
  ```
- 마이그레이션 적용:
  ```bash
  DIRECT_DATABASE_URL="$(grep ^DIRECT_DATABASE_URL .prod.vars | cut -d= -f2-)" pnpm db:migrate
  ```
- 적용 결과 확인 (`drizzle/` journal의 모든 파일이 `__drizzle_migrations`에
  들어왔는지):
  ```sql
  SELECT count(*) FROM __drizzle_migrations;
  -- drizzle/ journal의 파일 개수와 일치해야 함.
  ```

## Step 3 — RLS / 시드 검증

```sql
SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
```

`drizzle/0001_rls.sql`이 정의한 policy가 모두 있는지 확인. Workers는
BYPASSRLS 역할이라 동작 자체에는 영향 없으나 defense-in-depth 보존
(`src/CLAUDE.md` "Tenant isolation").

## Step 4 — GCP prod OAuth Web Client

- GCP Console → APIs & Services → Credentials → "Create credentials" →
  "OAuth client ID" → Application type: "Web application".
- Name: `autocolor-prod`.
- Authorized redirect URIs:
  - G1 verified 후: `https://<prod-domain>/oauth/google/callback`
  - G1 미완 시 임시: `https://autocolor-prod.autocolor-lim.workers.dev/oauth/google/callback`
- 생성 후 client_id / client_secret을 안전한 곳에 저장 (즉시 다른 surface
  갱신 부담 회피).

권장: dev client를 그대로 production 모드로 전환하지 말고 **별도 client 생성**.
이유: dev 시점의 test users / scope 설정이 prod 운영과 충돌하면 dev 흐름이
깨지므로.

## Step 5 — prod 시크릿 생성

```bash
pnpm gen-secrets prod
# → TOKEN_ENCRYPTION_KEY / SESSION_HMAC_KEY / SESSION_PEPPER 3종 키를
#   .prod.vars에 추가 + 팀 보관소 백업
```

`.prod.vars`에 다음을 모두 채운다 (`.gitignore`로 git untracked 보장 —
`docs/backend-infrastructure-handoff.md` line 50 / `.dev.vars` 패턴 동일):

```bash
# .prod.vars (git untracked)
DIRECT_DATABASE_URL=postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_URL=postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres
GOOGLE_CLIENT_ID=<step 4 client_id>
GOOGLE_CLIENT_SECRET=<step 4 client_secret>
GAS_REDIRECT_URL=<Step 11에서 채움>
TOKEN_ENCRYPTION_KEY=<gen-secrets 출력>
SESSION_HMAC_KEY=<gen-secrets 출력>
SESSION_PEPPER=<gen-secrets 출력>
# OPENAI_API_KEY=<선택 — 비우면 LLM 단계 자동 skip>
# WEBHOOK_BASE_URL=<G1 verified 후 채움>
```

## Step 6 — prod Hyperdrive config

```bash
pnpm wrangler hyperdrive create autocolor-prod-db \
  --connection-string="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres"
# → 출력: Created Hyperdrive config <UUID>
```

UUID 캡처 (참고: dev는 `0adfbd41c67e4225a63894c3768bb837`).

`pool` 설정 (`prepare:false`, `max:1`, ...) 은 코드 측에서 관리되므로 추가
설정 불필요 (`src/CLAUDE.md` "DB connectivity").

## Step 7 — `wrangler.toml` 갱신

이 PR에서 추가한 placeholder 주석 위치(`# [[env.prod.hyperdrive]]` 등)에
실제 값을 채워 넣는다. **이 단계는 이 PR이 머지된 이후 별도 commit으로 처리**
— 시크릿 / 실제 ID는 PR에 포함하지 않는다.

```toml
[[env.prod.hyperdrive]]
binding = "HYPERDRIVE"
id = "<step 6 UUID>"

[[env.prod.queues.producers]]
binding = "SYNC_QUEUE"
queue = "autocolor-sync-prod"

[[env.prod.queues.consumers]]
queue = "autocolor-sync-prod"
max_batch_size = 10
max_batch_timeout = 5
max_concurrency = 5
max_retries = 5
dead_letter_queue = "autocolor-sync-dlq-prod"

[[env.prod.queues.consumers]]
queue = "autocolor-sync-dlq-prod"
max_batch_size = 10
max_retries = 0

[env.prod.triggers]
crons = ["0 */6 * * *", "0 3 * * *"]
```

(설정 값은 dev 패턴 미러링 — `wrangler.toml` `[env.dev.*]` 블록 참조.)

## Step 8 — prod Queue 생성

```bash
pnpm wrangler queues create autocolor-sync-prod
pnpm wrangler queues create autocolor-sync-dlq-prod
```

생성 후 Cloudflare Dashboard → Queues에서 두 Queue 확인.

## Step 9 — prod cron triggers

`wrangler.toml`의 `[env.prod.triggers].crons`에 dev와 동일한 두 cron 명시
(Step 7에 포함됨):

- `0 */6 * * *` — Watch channel renewal (`WATCH_RENEWAL_CRON`).
- `0 3 * * *` — `TOKEN_ENCRYPTION_KEY` 로테이션 배치 (`TOKEN_ROTATION_CRON`).

`src/index.ts`의 cron 분기 로직(`scheduled()` → `WATCH_RENEWAL_CRON` /
`TOKEN_ROTATION_CRON` 매칭)은 그대로 작동. 두 cron 모두 prod에서 자동 실행
시작.

`WEBHOOK_BASE_URL`이 prod에 미주입이면 Watch renewal cron은 watch 채널 등록
없이 no-op (`src/services/watchChannel.ts`).

## Step 10 — `pnpm sync-secrets prod`

```bash
pnpm sync-secrets prod
# → .prod.vars의 모든 시크릿을 Wrangler에 일괄 주입
```

확인:

```bash
pnpm wrangler secret list --env prod
# DATABASE_URL / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / TOKEN_ENCRYPTION_KEY /
# SESSION_HMAC_KEY / SESSION_PEPPER / GAS_REDIRECT_URL (Step 11 후) 등이 표시
```

`OPENAI_API_KEY`를 `.prod.vars`에 비워두면 `sync-secrets`는 skip — `src/services/llmClassifier.ts`가
키 없으면 LLM 단계 자동 skip.

## Step 11 — GAS prod 배포

`src/CLAUDE.md` "GAS deployment URL must stay stable" 계약에 따라:

- GAS 편집기 → Deploy → New deployment → Type: "Add-on" → Edit + New version
  → Deploy.
- prod /exec URL을 캡처: `https://script.google.com/macros/s/.../exec`.

본 step에서는 dev /exec와 분리된 별도 prod /exec 배포가 맞다 (dev는 internal
test, prod는 marketplace 상장용). dev 배포는 손대지 않음 — 같은 deployment
의 새 version 발행 룰은 **단일 deployment 내**에서만 적용된다.

`.prod.vars`의 `GAS_REDIRECT_URL`에 prod /exec URL 채움 + `pnpm sync-secrets
prod` 다시 실행 (이번엔 GAS_REDIRECT_URL 1개만 새로 주입).

## Step 12 — 검증 시퀀스 (사용자 플로우 단계별)

### A. /healthz — sanity

```bash
curl -i https://autocolor-prod.autocolor-lim.workers.dev/healthz
# 또는 G1 verified 시: curl -i https://<prod-domain>/healthz
# HTTP/2 200 + JSON body 응답
```

DB 연결 / 시크릿 / Hyperdrive 모두 살아있다는 sanity. 실패 시:
- 401/500 → `pnpm wrangler tail --env prod`로 stack 확인.
- DB 연결 실패 → Hyperdrive config의 connection string / Supabase password
  재확인.

### B. OAuth 플로우 1회 (test 계정)

1. test Google 계정으로 GAS Add-on이 설치된 Calendar를 연다.
2. Add-on 사이드바에서 "백엔드 연결" 버튼.
3. Google Consent Screen → "허용".
4. callback 완료까지 대기, GAS 카드 갱신.
5. Worker 로그(`pnpm wrangler tail --env prod`)에서
   `GET /oauth/google/callback?...` 200 응답 확인.
6. `/me` 호출 → 200 + `needs_reauth: false`.
7. DB에서 `users` / `sessions` / `oauth_tokens` 행 1건씩 생성 확인:
   ```sql
   SELECT count(*) FROM users;       -- = 1
   SELECT count(*) FROM sessions;    -- = 1
   SELECT count(*) FROM oauth_tokens;-- = 1
   ```

### C. 카테고리 + sync 검증

1. GAS Add-on UI에서 카테고리 1개 추가 (예: 이름 "회의", 키워드
   `["meeting", "회의"]`, 색 색상번호 11).
2. test 계정 Calendar에 매칭 이벤트 1개("팀 회의 9시") + 미매칭 이벤트 1개
   ("점심") 생성.
3. "지금 동기화" 버튼 트리거 → Worker 로그에서 `POST /sync/run` 200 +
   Queue enqueue 로그 확인.
4. 30초~수분 대기 → Calendar에서 매칭 이벤트의 색상이 카테고리 색으로 변경
   됐는지 시각 확인. 미매칭 이벤트 색상은 변경되지 않음.
5. DB 확인:
   ```sql
   SELECT outcome, summary FROM sync_runs ORDER BY started_at DESC LIMIT 1;
   -- outcome='ok', summary에 updated/skipped_equal counters
   ```
6. `sync_state.last_run_summary`도 같은 counters 채움.

### D. (G1 verified 시) Watch API 등록

```bash
# 수동 등록 경로
curl -X POST https://<prod-domain>/sync/bootstrap \
  -H "Authorization: Bearer <session token>"
# runWatchBootstrap 호출 — src/routes/sync.ts
```

자동 등록 경로: 6시간 cron이 다음 tick에 expiring watch / 미등록 상태를 잡아
등록. 24h 내 자동 활성화.

확인:
```sql
SELECT calendar_id, watch_channel_id, watch_expiration FROM sync_state
WHERE user_id = '<test user id>' AND watch_channel_id IS NOT NULL;
```

이후 Calendar에서 이벤트 변경 → Worker가 webhook 받으면 (`/webhooks/calendar` 200)
자동 sync 트리거.

### E. (선택) Account deletion 검증

```bash
curl -X POST https://<prod-domain>/api/account/delete \
  -H "Authorization: Bearer <session token>"
# 200 응답 후 cascade 9 테이블 삭제 + Google revoke + watch channel stop
```

두번째 호출:
```bash
curl -X POST https://<prod-domain>/api/account/delete \
  -H "Authorization: Bearer <same session token>"
# 401 — 세션이 cascade로 삭제되어 auth gate가 막음
# (idempotency는 route가 아닌 auth 미들웨어가 보장 — src/CLAUDE.md "Account deletion (§3 row 179)")
```

## Step 13 — 세션 GC pg_cron 활성화

`TODO.md:38` "세션 GC". prod 활성화 직후 묶어 처리하는 것이 깔끔하다 (Retention
정책의 prerequisite — `marketplace-readiness.md` row 178).

- Supabase Dashboard → Database → Extensions → `pg_cron` enable.
- SQL Editor:
  ```sql
  SELECT cron.schedule(
    'session-gc',
    '0 4 * * *',
    $$DELETE FROM sessions WHERE expires_at < now() - interval '7 days'$$
  );
  ```
- 등록 확인:
  ```sql
  SELECT * FROM cron.job WHERE jobname='session-gc';
  ```

dev에서는 활성화하지 않는 것이 일반적 (sessions 테이블 작아 무관).

## Step 14 — Watch API 활성화 (G1 후행 — 도메인 verified 필수)

**Prerequisite**: G1 runbook 완료, prod 도메인 GSC verified, prod
`GOOGLE_OAUTH_REDIRECT_URI` / `WEBHOOK_BASE_URL` 모두 새 도메인.

`WEBHOOK_BASE_URL` 시크릿 주입:

```bash
pnpm wrangler secret put WEBHOOK_BASE_URL --env prod
# 입력값: https://<prod-domain>
```

이후 Step 12 D ("Watch API 등록") 시퀀스 그대로 실행 — 수동 또는 cron 자동
등록. 등록 성공 시 `sync_state.watch_channel_id` non-null + Calendar 이벤트
변경 시 webhook 도착 + 자동 sync.

## 롤백 시나리오

prod 활성화 도중 실패하면 다음 순서로 회수한다. **dev 환경은 모든 시점에서
영향 없음** (별도 시크릿 / Hyperdrive / Queue / cron — `wrangler.toml`은
env scoping으로 격리).

- **단계 중간 실패 시 (시크릿 미주입 상태)**: `.prod.vars`에 작성한 시크릿은
  로컬 폐기. Wrangler secret 미주입 상태에서 작성 자체는 사이드이펙트 없음.
- **Hyperdrive까지 만든 상태**:
  ```bash
  pnpm wrangler hyperdrive delete <UUID>
  ```
  무료 자원이라 비용 영향 없음. Supabase 프로젝트는 Pause로 두고 분석 후
  재시작 권장.
- **시크릿까지 주입한 상태**:
  ```bash
  pnpm wrangler secret list --env prod
  # 일괄 회수 — 각 secret을 한 번씩
  pnpm wrangler secret delete <name> --env prod
  ```
- **GAS prod 배포까지 한 상태**: GAS 편집기 → Manage deployments → 해당
  deployment Archive. URL은 보존됨 (`src/CLAUDE.md` "GAS deployment URL
  must stay stable") — 재시도 시 같은 URL로 다시 publish.
- **데이터까지 들어간 상태**: Supabase 프로젝트를 Pause → 새 prod 프로젝트
  재생성. 사용자 데이터가 본격 들어오기 전이라면 비용 거의 없다.

## Submission-time 영향

- `docs/marketplace-readiness.md` §5 row 252 (Prod Supabase + Worker activated)
  status `미작성` → `완료`.
- §3 row 178 (Retention policy) status `미작성` → `초안` (pg_cron session-gc
  등록 후).
- prod cron 활성화로 `TOKEN_ENCRYPTION_KEY` 로테이션 cron도 자동 작동
  (`src/CLAUDE.md` "Token rotation (§3 후속)") — `TARGET_TOKEN_VERSION` bump
  + `TOKEN_ENCRYPTION_KEY_PREV` injection 절차는 별도 운영 체크리스트.

## Cross-references

- [`TODO.md` §3 후속 line 35](../../TODO.md) — 작업 정본
- [`TODO.md` §3 후속 line 38](../../TODO.md) — 세션 GC
- [`TODO.md` §4 후속 line 52](../../TODO.md) — prod Watch API 활성화 (G1 의존)
- [`docs/backend-infrastructure-handoff.md`](../backend-infrastructure-handoff.md) — 라이브 카탈로그 / 자격증명 로테이션 이력
- [`src/CLAUDE.md` "Environments"](../../src/CLAUDE.md) — prod URL-reserving shell 현재 상태
- `src/CLAUDE.md` "DB connectivity" — Hyperdrive pool 설정 / 마이그레이션 계약
- `src/CLAUDE.md` "Secret rotation impact" — 시크릿 회전 절차
- `src/CLAUDE.md` "Account deletion (§3 row 179)" — Step 12 E 검증
- `src/CLAUDE.md` "GAS deployment URL must stay stable" — Step 11 / 롤백
- [`wrangler.toml`](../../wrangler.toml) — `[env.prod.*]` 블록
- `src/services/watchChannel.ts` — `WEBHOOK_BASE_URL` gating
- [`docs/runbooks/01-domain-and-search-console.md`](./01-domain-and-search-console.md) — Step 7 / 14 prerequisite
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) — §3 / §5

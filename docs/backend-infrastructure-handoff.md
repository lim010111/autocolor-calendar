# Backend Infrastructure Handoff — §3 완료 / §4 진입 준비

브랜치: `setup/backend-infrastructure` (PR #5, base `main`)

이 문서는 "§3이 지금 어디까지 왔고, 다음 세션이 무엇부터 집어들어야 하는지"만 정리한다. 상세 설계는 `docs/setup-backend-infrastructure-plan.md`, 백엔드 모듈 불변식은 `src/CLAUDE.md`를 단일 소스로 참조한다.

## §3 완료 상태 (merge-ready)

**PR**: https://github.com/lim010111/autocolor-calendar/pull/5 — 15 commits · 58+ files · OPEN.

핵심 커밋:
| 커밋 | 내용 |
|---|---|
| `c17efaa` | Python 스캐폴딩 제거 + Node/Workers `.gitignore` |
| `729231c` | pnpm + TS + Hono 스캐폴드, ESLint/Prettier/Vitest 하네스 |
| `8796cfb` | Supabase 연결 (drizzle + postgres.js) |
| `9e87791` | 스키마 5 테이블 + RLS 정책 |
| `a0daea5` | Google OAuth + 세션 + `/me` + 구조화 로그 |
| `fa7d96f` | Cloudflare Hyperdrive 전환 (subrequest 한도 해결) |
| `6234bb1` | `src/CLAUDE.md` 런북 + TODO 갱신 (비밀번호 평문 제거 rebase 반영본) |
| `004fbde` | GAS placeholder 링크 제거 (render 차단 해제) |
| `1250553` | 코드 리뷰 대응 (OAuth 계약, HYPERDRIVE optional, 테스트, CHECK, 로그 문서) |
| `3162c50` | `.prod.vars` gitignore |
| `aa872b0` | 2차 리뷰 대응 (세션 TTL 임계값·waitUntil, bearer dedup, sync-secrets polish) |
| `93bcf3d` | GAS auth UX — replaceState, 에러 코드 분기, 백엔드 구성 필요 카드 |

**검증 상태**: `pnpm typecheck`·`pnpm lint` clean, `pnpm test` 26/26 green, 로그인 e2e (사용자→GAS→Consent→callback→세션 토큰 저장→홈 카드) 성공.

## 라이브 리소스 카탈로그

| 자원 | 식별자 / 위치 | 비고 |
|---|---|---|
| Cloudflare 계정 | `Limwoohyun01@gmail.com's Account` · `c855da959680cad78ed7c4219361ac5c` | `wrangler whoami` |
| 워커 서브도메인 | `autocolor-lim.workers.dev` | |
| dev Worker | `https://autocolor-dev.autocolor-lim.workers.dev` | live; Hyperdrive + 6 secrets 주입 |
| prod Worker | `https://autocolor-prod.autocolor-lim.workers.dev` | 빈 셸; `/healthz`만 응답, 시크릿/Hyperdrive 없음 |
| Hyperdrive config (dev) | `0adfbd41c67e4225a63894c3768bb837` — `autocolor-dev-db` | origin: Supabase Session Pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432` |
| Supabase project | `tdbyaaedrvkjxidchvpa` (Northeast Asia) | extensions: `pgcrypto` enabled |
| GCP OAuth client (dev) | `500584277254-8l6atjhcvdil3r434qbe7dcf62o92603` | redirect URI 등록됨 |
| GAS web app `/exec` | `https://script.google.com/macros/s/AKfycbzmpZKgeaXn4QDsUdYpXsKl8IiJSvUWpAzk8j2wiHMSNNAghyZ-8BfNw73HMr5GxUsYlA/exec` | HEAD test 배포 + versioned @2 |
| GAS script ID | `13puaHq87p_yvDhDoVk9JDW6RHUxvHyXwIiuSKkY8wbdCkXjTIlkKBrbc` | `gas/.clasp.json` |

## 자격증명 로테이션 이력

Session 종료 시점에 **Supabase DB password**와 **Google OAuth client secret**이 §3 작업 중 한 차례 대화에 노출되어 로테이션했다. 로테이션 후 현재 값은 사용자 로컬 `.dev.vars`에만 존재하며, Hyperdrive config / Worker secrets도 모두 갱신 완료.

- Supabase 새 password → `.dev.vars`(DATABASE_URL / DIRECT_DATABASE_URL 모두) + `pnpm wrangler hyperdrive update 0adfbd41c67e4225a63894c3768bb837 --connection-string=...` (Session Pooler URL 기준)
- 새 `GOOGLE_CLIENT_SECRET` → `.dev.vars` + `pnpm sync-secrets dev`

`.dev.vars`는 `.gitignore`에 묶여 있어 커밋되지 않고, 과거 노출 값은 이전 rebase에서 git 히스토리에서도 제거됨 (`6234bb1`).

## 다음 세션 재개 전 사전 체크리스트

1. `git pull origin setup/backend-infrastructure` — 원격 tip 일치.
2. `pnpm install` — lockfile 변경 반영.
3. `.dev.vars` 존재·전체 12개 키 채움 상태 확인 (없으면 이전 세션 값 복구).
4. `pnpm wrangler whoami` — Cloudflare 계정 재인증 필요 시 `pnpm wrangler login`.
5. `pnpm typecheck && pnpm lint && pnpm test` — 로컬 기준선 26/26.
6. `curl https://autocolor-dev.autocolor-lim.workers.dev/healthz` → 200 확인.
7. (DB 수정이 필요한 작업일 때) `pnpm db:migrate` — 현재 journal은 0000/0001/0002까지 적용됨.

## 남은 §3 후속 작업 (이월)

`TODO.md` §3 후속 섹션 참조. 현재 미완료:

- **Prod 환경 활성화** — Supabase prod 프로젝트 생성 + 마이그레이션, GCP prod OAuth Web Client + redirect URI, `pnpm gen-secrets` + `pnpm sync-secrets prod`, prod Hyperdrive config 생성 및 `[[env.prod.hyperdrive]]` 바인딩 추가. §4에서 Watch API 수신 엔드포인트가 필요해지면 prod custom domain 인증까지 같이 잡는 게 효율적.
- **세션 GC** — Supabase `pg_cron` extension 활성화 후 주 1회 `DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`. §6 관측성 범위에서 처리 권장.
- **`TOKEN_ENCRYPTION_KEY` 배치 로테이션** — `token_version` 기반 전 `oauth_tokens` 재암호화 job. §6에서 구현. 이 job이 있어야 `TOKEN_ENCRYPTION_KEY` 실 로테이션이 가능.

로테이션 후속 조치(§3 세션 중 노출된 자격증명 재발급)는 이번 세션에서 완료됨.

## §4 진입점

`TODO.md` §4: 핵심 동기화 로직 및 Watch API 안정화.

1. **Incremental Sync 이식** — 기존 `gas/sync.js` 로직(나중 확인)을 TypeScript Worker로 이식. `sync_state.next_sync_token` 사용, 멱등 보장. 새 라우트 예: `POST /sync/run` (인증 필요, `/me`와 같은 auth middleware 재사용).
2. **Watch API 엔드포인트** — `POST /webhooks/calendar` 신설, `X-Goog-*` 헤더 검증, 즉각 2xx 응답 후 비동기 처리(Cloudflare Queues 또는 Durable Objects 시그널 큐). 이 단계 전에 `GOOGLE_WEBHOOK_TOKEN` 류 채널 검증용 시크릿 도입 검토.
3. **Watch 채널 수명주기** — Cron Triggers(`wrangler.toml [triggers]`)로 만료 임박 채널 갱신. `sync_state.watch_expiration` 사용.
4. **DLQ/재시도** — Cloudflare Queues의 DLQ 설정 + Exponential backoff. §6 관측성 범위와 겹침.
5. **410 Gone 복구** — `next_sync_token`이 410 반환 시 `sync_state`의 `last_full_resync_at` 기준 Full Resync 트리거.

§4에서는 Watch API 수신을 위해 **verified custom domain이 필요**(`workers.dev`는 Watch API가 신뢰 안 함). 따라서 §4 시작 시 prod custom domain 확보 작업을 병행해야 함 → `TODO.md` §1의 "운영용 도메인 확보 및 Google Search Console 소유권 인증" 연결.

## 중요 불변식 (다시 훑기)

`src/CLAUDE.md`를 꼭 한 번 읽고 들어갈 것. 요약:

- Workers 경로는 BYPASSRLS. 모든 유저 데이터 쿼리에 `where(eq(table.user_id, ctx.userId))` 의무.
- Hyperdrive origin 변경은 DB password 로테이션 경로 (Worker 시크릿 아님).
- Pool 설정 (`prepare:false`, `max:1`, `idle_timeout:0`, `fetch_types:false`)은 변경 전에 `/me`·`/oauth/google/callback` 부하 재검증.
- GAS 웹앱은 "기존 배포 Edit → New Version"으로만 재배포 — `/exec` URL 고정.
- 로그 redaction은 query string 한정, body는 로그 기록 자체를 하지 않음.
- 시크릿 로테이션 영향: `SESSION_PEPPER`→전 세션 무효, `TOKEN_ENCRYPTION_KEY`→전 `oauth_tokens` 재암호화 필요 (§6 전까지 교체 금지).

## 다음 세션 시작 프롬프트 템플릿

> `setup/backend-infrastructure` 브랜치에서 §3 백엔드 인프라가 완료됐고 PR #5가 오픈 상태다. §4(핵심 동기화 로직) 진입을 준비한다.
> `docs/backend-infrastructure-handoff.md`(이 문서)와 `src/CLAUDE.md`를 먼저 읽어라.
> 사전 체크리스트를 실행하여 `/healthz`가 응답하는지 확인한 뒤, §4의 첫 작업 — 기존 `gas/sync.js` 로직의 TypeScript Worker 이식 — 부터 착수한다. 이 작업 전에 prod custom domain 확보(§1) 진행 가능 여부도 함께 결정한다.

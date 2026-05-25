# Live resource catalog

운영 중인 외부 자원(Cloudflare / Supabase / GCP / GAS)의 식별자 단일 카탈로그.
세부 운영 절차는 각 항목의 _운영 절차_ 열 참조.

> 비밀(시크릿 / DB 비밀번호 / OAuth client secret 등)은 이 문서에 적지 않는다.
> 모든 비밀은 `.dev.vars` / `.prod.vars` (gitignored) 와 Wrangler secret store
> 에만 존재한다. 시크릿 회전 절차는
> [`src/CLAUDE.md` "Secret rotation impact"](../src/CLAUDE.md) 참조.

## Cloudflare

| 자원 | 식별자 | 운영 절차 |
|---|---|---|
| 계정 | `Limwoohyun01@gmail.com's Account` · `c855da959680cad78ed7c4219361ac5c` | `pnpm wrangler whoami` |
| Workers 서브도메인 | `autocolor-lim.workers.dev` | — |
| Worker (dev) | `https://autocolor-dev.autocolor-lim.workers.dev` | `wrangler.toml [env.dev]` |
| Worker (prod) | `https://autocolorcal.app` (custom domain) · `https://autocolor-prod.autocolor-lim.workers.dev` (workers.dev fallback) | `wrangler.toml [env.prod]` · PR #43 (2026-05-04) 활성화 |
| Hyperdrive (dev) | `0adfbd41c67e4225a63894c3768bb837` — `autocolor-dev-db` | origin: Supabase Session Pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432` |
| Hyperdrive (prod) | `fc99980ace44497da83cfa99906f3bcb` — `autocolor-prod-db` | origin: Supabase Tokyo Session Pooler |
| Queue (dev) | `autocolor-sync-dev` + DLQ `autocolor-sync-dlq-dev` | `wrangler.toml [[env.dev.queues]]` |
| Queue (prod) | `autocolor-sync-prod` + DLQ `autocolor-sync-dlq-prod` | `wrangler.toml [[env.prod.queues]]` |

## Supabase

| 자원 | 식별자 | 비고 |
|---|---|---|
| Project (dev) | `tdbyaaedrvkjxidchvpa` — `ap-southeast-1` (Singapore) | extensions: `pgcrypto` |
| Project (prod) | `ap-northeast-1` (Tokyo) — project ref 는 `.prod.vars` `DIRECT_DATABASE_URL` | extensions: `pgcrypto`, `pg_cron` · region 변경 시 [`docs/legal/privacy-policy.md`](legal/privacy-policy.md) §3·§4·§4.1 본문 동시 갱신 |

## GCP — Google OAuth Web Client

| 자원 | 식별자 | 비고 |
|---|---|---|
| Client (dev) | `500584277254-8l6atjhcvdil3r434qbe7dcf62o92603` | redirect URI: `https://autocolor-dev.autocolor-lim.workers.dev/oauth/google/callback` |
| Client (prod) | client_id 는 `.prod.vars` `GOOGLE_CLIENT_ID` | redirect URI: `https://autocolorcal.app/oauth/google/callback` · 별도 client (dev 전환 금지) — 사유 [`runbooks/02`](runbooks/02-prod-environment-activation.md) Step 4 |

## Google Apps Script (Add-on)

| 자원 | 식별자 | 비고 |
|---|---|---|
| Web app `/exec` URL | `https://script.google.com/macros/s/AKfycbzmpZKgeaXn4QDsUdYpXsKl8IiJSvUWpAzk8j2wiHMSNNAghyZ-8BfNw73HMr5GxUsYlA/exec` | **URL must stay stable** — 재배포는 "Manage deployments → Edit existing → New Version → Deploy" 로만. 새 deployment 생성 금지 ([`src/CLAUDE.md`](../src/CLAUDE.md) "GAS deployment URL must stay stable") |
| Script ID | `13puaHq87p_yvDhDoVk9JDW6RHUxvHyXwIiuSKkY8wbdCkXjTIlkKBrbc` | `gas/.clasp.json` |

## 자격증명 회전 이력

§3 백엔드 인프라 구축 (2026-02) 중 **Supabase DB password** 와 **Google OAuth
client secret** (dev) 이 한 차례 대화 로그에 노출되어 회전을 수행했다. 회전 후
값은 `.dev.vars` 와 Wrangler secret store 에만 존재하며, Hyperdrive config /
Worker secrets 모두 갱신 완료. 노출 값은 git rebase (commit `6234bb1`) 로 히스토리에서도
제거됨. 회전 절차 표준은 [`src/CLAUDE.md`](../src/CLAUDE.md) "Secret rotation impact" 참조.

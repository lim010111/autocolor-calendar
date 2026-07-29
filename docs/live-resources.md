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
| Project (dev) | `tdbyaaedrvkjxidchvpa` — `ap-southeast-1` (Singapore) | extensions: `pgcrypto`, `vector`(public, 2026-07-17 수동 설치 — 0000 의 CREATE EXTENSION 이 dev 에 미반영이었음) |
| Project (prod) | `ap-northeast-1` (Tokyo) — project ref 는 `.prod.vars` `DIRECT_DATABASE_URL` | extensions: `pgcrypto`, `pg_cron` · region 변경 시 [`docs/legal/privacy-policy.md`](legal/privacy-policy.md) §3·§4·§4.1 본문 동시 갱신 |

## GCP — Google OAuth Web Client

| 자원 | 식별자 | 비고 |
|---|---|---|
| Client (dev) | `500584277254-8l6atjhcvdil3r434qbe7dcf62o92603` | redirect URI: `https://autocolor-dev.autocolor-lim.workers.dev/oauth/google/callback` |
| Client (prod) | client_id 는 `.prod.vars` `GOOGLE_CLIENT_ID` | redirect URI: `https://autocolorcal.app/oauth/google/callback` · 별도 client (dev 전환 금지) — 사유 [`runbooks/02`](runbooks/02-prod-environment-activation.md) Step 4 |

## Google Apps Script (Add-on)

| 자원 | 식별자 | 비고 |
|---|---|---|
| Script ID | `13puaHq87p_yvDhDoVk9JDW6RHUxvHyXwIiuSKkY8wbdCkXjTIlkKBrbc` | `gas/.clasp.json` |

### Deployment 3종 — 역할이 다르다 (2026-07-28 실측 정정)

하나의 스크립트에 deployment 가 셋이고 **각각 다른 소비자**를 가진다. 예전
표기(“`/exec` URL” 한 줄 + “`AKfycbxKZ…` 는 무관”)는 **틀렸다** — dev 웹앱
URL 을 유일한 `/exec` 인 것처럼 적어 두어 prod 리다이렉트 대상을 가렸다.
정본은 `.dev.vars` / `.prod.vars` 의 `GAS_REDIRECT_URL` 이다.

| Deployment ID | 역할 | 정본 | 버전 |
|---|---|---|---|
| `AKfycbxfHV5JvpRF…` | **설치본 Add-on** — 사용자가 Calendar 에서 실행하는 코드 | 2026-07-07 v49 잔류 사고로 확인 | @57 (2026-07-29) |
| `AKfycbxKZDXL9_vy…` | **prod 웹앱** — Worker 가 OAuth 결과를 되던지는 `/exec` | `.prod.vars` `GAS_REDIRECT_URL` | @54 |
| `AKfycby_UpX9PLFS…` | HEAD 추적 배포 — 코드 push 즉시 반영 | `clasp deployments` | @HEAD |

> **(2026-07-29 실측 정정)** `.dev.vars` `GAS_REDIRECT_URL` 이 가리키는
> `AKfycbzmpZKgeaXn…` 은 **현재 존재하지 않는다** — `clasp deployments` 에
> 없다. 언젠가 삭제됐고 `.dev.vars` 만 남았다. dev Worker 의 OAuth 콜백은
> 그래서 죽어 있을 것이다(dev 전용이라 prod 영향 0). 되살리려면 새 URL 이
> 생기므로 `.dev.vars` + GCP dev 리다이렉트를 함께 갱신해야 한다 — dev 는
> URL 고정 계약의 대상이 아니다.

- **URL must stay stable** — 세 개 모두. 재배포는 `clasp deploy -i <위 ID> -V <n>`
  (또는 "Manage deployments → Edit existing → New Version → Deploy") 로만.
  **새 deployment 생성 금지** ([`src/CLAUDE.md`](../src/CLAUDE.md) "GAS deployment URL must stay stable").
- **코드 변경 시 무엇을 올려야 하나**: 애드온 UI(카드·i18n·액션 핸들러)만 바뀌면
  설치본 하나로 충분하다. `doGet` / `auth.js` / `authCallback.html` /
  `authError.html` / `config.js` 처럼 **OAuth 콜백 경로**가 바뀌면 prod 웹앱도
  같이 올려야 한다 — 안 그러면 애드온과 콜백이 서로 다른 버전을 돈다.
- 2026-07-28 배포 시점의 드리프트: 설치본 @56 vs prod 웹앱 @54. 콜백 경로
  파일은 `e5cd859`(PR #71) 이후 무변경이라 **기능적 문제 없음**. 정렬하고
  싶으면 `clasp deploy -i AKfycbxKZDXL9_vy… -V 56` 한 줄.

## 자격증명 회전 이력

§3 백엔드 인프라 구축 (2026-02) 중 **Supabase DB password** 와 **Google OAuth
client secret** (dev) 이 한 차례 대화 로그에 노출되어 회전을 수행했다. 회전 후
값은 `.dev.vars` 와 Wrangler secret store 에만 존재하며, Hyperdrive config /
Worker secrets 모두 갱신 완료. 노출 값은 git rebase (commit `6234bb1`) 로 히스토리에서도
제거됨. 회전 절차 표준은 [`src/CLAUDE.md`](../src/CLAUDE.md) "Secret rotation impact" 참조.

# 01 — Domain & Google Search Console verification

> 이 runbook은 [`TODO.md` §1 line 8](../../TODO.md) "운영용 도메인 확보 및
> Google Search Console 소유권 인증"의 정본 절차다. 무엇을 unblock하는지:
> prod Watch API (`TODO.md:52`), Workspace Marketplace 제출의 Support URL /
> App home URL / Privacy URL / ToS URL (모두 같은 도메인 호스팅 권장),
> OAuth Consent Screen verification.
>
> Owner: Ops. 시작 시점은 G4 (Legal) 동시 착수와 G2 (Prod 활성화 일부)
> 병행 가능. 외부 대기 시간(DNS propagation 24-48h, GSC 인증 즉시~24h)이
> 가장 길어 가장 먼저 시작하는 것이 효율적.

- **Pre-conditions**: Cloudflare 계정 보유 (라이브 카탈로그는
  [`docs/backend-infrastructure-handoff.md`](../backend-infrastructure-handoff.md)
  참조), GCP 콘솔 접근 권한, 도메인 구매 예산.
- **Acceptance**: `curl https://<prod-domain>/healthz` → 200 + GSC가
  "Verified" + GCP OAuth Consent Screen Authorized domains에 새 도메인 등록.

## Step 1 — 도메인 선택 기준

prod Worker · Privacy URL · Terms URL · Support URL을 **같은 도메인 하위**
에 두는 것을 권장한다. consent 화면 / Marketplace listing의 시각적 일관성
때문이다.

권장 패턴:

```
https://<chosen>.app/healthz                       # prod Worker
https://<chosen>.app/oauth/google/callback         # OAuth callback
https://<chosen>.app/webhooks/calendar             # Watch API
https://<chosen>.app/api/...                       # 인증된 API
https://<chosen>.app/privacy                       # Privacy Policy 호스팅
https://<chosen>.app/terms                         # ToS 호스팅
```

한국어 친화 도메인이 별도 필요하면 분리 운영하지 않는다 (consent / Privacy
URL 통일 위해). apex 도메인(`<chosen>.app`)을 권장 — subdomain (예:
`app.<chosen>.com`)은 시각적 일관성이 약하다.

## Step 2 — Cloudflare DNS 위임

도메인 등록사에서 네임서버를 Cloudflare로 변경한다. propagation 24-48h
가능성이 있으므로 가장 먼저 시작한다. 등록사별 메뉴 경로는 등록사 콘솔
참조.

확인:

```bash
dig +short ns <chosen>.app
# Cloudflare 네임서버 (예: arya.ns.cloudflare.com / aaron.ns.cloudflare.com)가
# 응답되면 propagation 완료.
```

## Step 3 — Cloudflare 측 Worker 도메인 연결 (Custom Domains 권장)

본 프로젝트는 prod Worker가 도메인 전체 트래픽을 받으므로 **Custom Domains
방식**을 권장한다.

**Custom Domains 방식**:

- Cloudflare Dashboard → Workers & Pages → `autocolor-prod` → Custom Domains
  → "Add Custom Domain" → `<chosen>.app` 입력.
- SSL/TLS 인증서는 Cloudflare Universal SSL이 자동 발급.
- `Host` 헤더가 사용자 도메인 그대로 들어와 `c.req.url` 파싱이 일관됨.
- apex 도메인 그대로 매핑 가능.

**Routes 방식 (대안 — 본 프로젝트는 비추천)**:

기존 zone에 다른 트래픽이 있어 path별 분기가 필요한 경우. 예: `<chosen>.app/oauth/*`

- `<chosen>.app/webhooks/*` + `<chosen>.app/api/*` + `<chosen>.app/healthz`.
  URL 패턴 분기가 필요해 운영 복잡도 증가. 본 프로젝트는 prod Worker가 전체
  트래픽 처리이므로 Custom Domains 방식만 사용.

확인:

```bash
curl -I https://<chosen>.app/healthz
# HTTP/2 200 OK + cf-ray 헤더 (Cloudflare edge POP가 응답)
```

## Step 4 — Google Search Console 소유권 인증

- Search Console → 속성 추가 → "Domain" property 선택 (URL prefix가 아닌
  Domain — Domain property는 하위 subdomain까지 인정).
- DNS TXT 토큰 발급 (예: `google-site-verification=...`).
- Cloudflare DNS → DNS Records → "Add record" → Type: TXT, Name: `@`,
  Content: 발급받은 토큰 → "Save".
- Search Console로 돌아가 "확인" 버튼.

확인:

```bash
dig +short TXT <chosen>.app
# google-site-verification=... 라인이 보이면 propagation 완료. GSC 콘솔이
# "Verified" 표시될 때까지 즉시~24h.
```

## Step 5 — GCP OAuth Consent Screen 갱신

- GCP Console → APIs & Services → OAuth consent screen → "EDIT APP".
- **App domain** 섹션:
  - Application home page: `https://<chosen>.app`
  - Application privacy policy link: G4 호스팅 후 `https://<chosen>.app/privacy`
    (G1 verified 직후엔 placeholder OK; G4 호스팅 완료 후 실제 URL로 업데이트)
  - Application terms of service link: 동일 패턴, `https://<chosen>.app/terms`
- **Authorized domains**: `<chosen>.app` 추가 (apex만; subdomain은 자동 인정).
- **Publishing status**:
  - dev는 "Testing" 모드 (test 사용자 추가) 가정.
  - prod 활성화 시점에 "In production"으로 publish — 단 Marketplace 상장 전
    이라면 Restricted Scope 검수(`TODO.md:133`) 통과 후. **이 단계가 G6
    (OAuth Consent Screen 검수) 신청의 prerequisite**, 검수 신청 자체는
    G4 (Privacy / ToS 호스팅) 완료 후 §7로.

본 step은 G1 verified 직후 즉시 진행 가능 — 검수 신청은 별도이므로 publishing
status는 일단 "Testing" 유지.

## Step 6 — Calendar Watch API 도메인 인증 확인

Calendar Push Notifications (Watch API)는 **verified custom domain이 필수**다
— `*.workers.dev`는 거부된다. `WEBHOOK_BASE_URL` 환경변수가 비어 있으면
prod Worker는 watch 채널 등록을 skip한다 (`src/services/watchChannel.ts`,
`TODO.md:52`). 이 step은 도메인이 GSC verified 후에만 의미 있다.

## Step 7 — 코드 사이드 갱신

verified 후 다음 변경을 별도 commit으로 묶어 처리한다 (이 PR에는 포함되지
않음 — 시크릿 / 실제 도메인은 PR 단위 외에서 관리):

```toml
# wrangler.toml
[env.prod.vars]
ENV = "prod"
GOOGLE_OAUTH_REDIRECT_URI = "https://<chosen>.app/oauth/google/callback"
# ↑ workers.dev에서 verified 도메인으로 교체.
```

```bash
# WEBHOOK_BASE_URL 시크릿 주입 (verified 후)
pnpm wrangler secret put WEBHOOK_BASE_URL --env prod
# 입력값: https://<chosen>.app
```

GCP OAuth Web Client 측의 redirect URI 등록도 동일 URL로 갱신:

- GCP Console → APIs & Services → Credentials → prod Web Client → Edit
  → Authorized redirect URIs → `https://<chosen>.app/oauth/google/callback`
  추가 (기존 `*.workers.dev` URI는 잠시 유지하다가 검증 완료 후 제거).

GAS prod 배포 /exec URL은 변경 불필요 (Google domains이라 사용자 도메인과
독립).

**G2 runbook의 Step 7-12와 묶어 진행하는 것이 효율적** — wrangler.toml prod
블록 채우기 commit 시점에 G1 verified domain도 같이 반영.

## Submission-time 영향

- `docs/marketplace-readiness.md` §5 row 251 (Owned domain + Search Console
  verification) status `미작성` → `완료`(verified 직후 graduate 가능).
- §1 row 78-79 (Support email/URL) unblock — `<chosen>.app/support` 또는
  `support@<chosen>.app` 사용 가능.
- §2 row 120 (App home page URL) unblock — `<chosen>.app` 그대로.
- §2 row 123 (Authorized domains) — Step 5에서 추가 완료.
- §4 후속 (`TODO.md:52`) prod Watch API 활성화 prerequisite 충족.

## Cross-references

- [`TODO.md` §1 line 8](../../TODO.md) — 작업 정본
- [`docs/completion-roadmap.md`](../completion-roadmap.md) — G1 절
- [`docs/runbooks/00-user-action-checklist.md`](./00-user-action-checklist.md) — 사용자 진입점
- [`docs/backend-infrastructure-handoff.md`](../backend-infrastructure-handoff.md) — 라이브 리소스 카탈로그
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) — §1 / §2 / §5
- [`wrangler.toml`](../../wrangler.toml) — `[env.prod.vars]` 갱신 자리
- `src/services/watchChannel.ts` — `WEBHOOK_BASE_URL` 미주입 시 watch 등록 skip
- [`docs/runbooks/02-prod-environment-activation.md`](./02-prod-environment-activation.md) — Step 7과 묶어 진행

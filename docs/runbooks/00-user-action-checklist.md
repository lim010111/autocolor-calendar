# 00 — 사용자 액션 체크리스트 (G1 / G2 / G4 동시 착수)

> 이 문서는 **사용자 진입점**이다. AutoColor for Calendar를 Workspace
> Marketplace public listing 활성 상태까지 끌어올리려면 외부 작업(도메인 등록,
> prod 콘솔, Legal 자문)이 필요한데, 그 작업들의 owner / 대기 시간 / 결과
> 확인 방법이 게이트별 runbook에 흩어져 있다. 이 파일은 한 화면에서 "지금
> 내가 어떤 외부 작업을 해야 하나"를 보고 바로 실행할 수 있도록 G1·G2·G4
> 모든 사용자 액션을 통합 체크박스로 정리한다.
>
> 게이트 분류 / 의존성 그래프의 정본은 [`docs/completion-roadmap.md`](../completion-roadmap.md).
> 절차 상세는 [`01-domain-and-search-console.md`](./01-domain-and-search-console.md)
> · [`02-prod-environment-activation.md`](./02-prod-environment-activation.md).
> 본 파일은 무엇을 체크할지의 박스만, 본문 runbook은 어떻게 할지의 명령어.

## 왜 동시 착수인가

외부 의존성이 각각 며칠~몇 주 단위라 직렬화하면 시간 낭비다.

- **G1 (도메인 + GSC)**: 도메인 구매·DNS propagation 24-48h, GSC 인증 즉시
  ~24h. owner = Ops.
- **G2 (Prod 활성화)**: Supabase 프로비저닝·콘솔 작업 2-3시간, 외부 대기 거의
  없음. owner = Eng.
- **G4 (Privacy + ToS)**: 자문 의뢰 즉시, 검토 회신 1-3주. owner = Legal.

세 게이트의 owner가 다르고 외부 시스템이 충돌하지 않는다. **자문 검토 1-3주
대기 윈도**가 가장 길어, 이 윈도 안에 G1·G2와 비-critical 항목(테스트 보강
§6.1·§6.2)을 동시 진행하는 것이 효율적이다.

## 예산 / 시간 추정

| 게이트 | 외부 비용 | 작업 시간 | 외부 대기 시간 |
|---|---|---|---|
| G1 도메인 + GSC | 도메인 1-3만원/년 (`*.app` 류) | DNS 설정 ~1시간 + Custom Domain 연결 ~30분 + Authorized domains 갱신 ~10분 | DNS propagation 24-48h, GSC 인증 즉시~24h |
| G2 Prod 활성화 | Supabase Free tier 가능 / Pro $25월 (사용자 증가 후) | 콘솔 작업 + 시크릿 ~2-3시간 (체계적으로) | 거의 없음 (Hyperdrive/Queue 즉시) |
| G4 Privacy + ToS | 자문비 (사무소별 견적) | 의뢰서 작성 ~1시간 + 회신 검토 후 본문 반영 | 자문 회신 1-3주 |

총 cash 비용 (최소): 도메인 1-3만원 + Supabase Free + 자문비 (별도 견적).
도메인은 즉시 결제, 자문비는 사무소별 견적 후 결제.

## 진행 권장 순서

이 PR(`feature/gates-1-2-4-kickoff`)이 머지된 직후 시작:

- **Day 1 (병렬 시작)**:
  - G1: 도메인 후보 결정 + 구매 → DNS를 Cloudflare로 위임 (대기 시작).
  - G4: 자문 의뢰서 초안 작성 (`docs/legal/privacy-policy.md` /
    `terms-of-service.md`의 `자문 검토 시 우선 확인 항목` H3 그대로 첨부)
    → 사무소 발송 (대기 시작).
  - G2: Supabase prod 프로젝트 생성 + `pgcrypto` 활성화 + 마이그레이션 (즉시
    실행 가능).
- **Day 2-3 (G1 대기 동안 G2 진행)**:
  - GSC 인증 / DNS propagation 대기 동안 G2 Step 5-12 (시크릿 / Hyperdrive /
    Queue / cron / GAS prod 배포 / 검증) 진행. prod Watch API는 도메인 verified
    까지 OFF.
- **Day 7-21 (자문 회신 대기)**:
  - 이 윈도에 [`docs/completion-roadmap.md`](../completion-roadmap.md) 비-
    critical path (§6.1 테스트 보강 / §6.2 통합 테스트 하네스) 진행 가능.
- **자문 회신 후**:
  - Privacy / ToS 본문 반영 (별도 PR) → 호스팅 publish → URL 캡처 → §1 rows
    121-122 status `초안` → `완료` (별도 commit).
  - `gas/addon.js:119` "정식 링크는 출시 시점에 제공됩니다" placeholder를 실제
    URL로 교체 (별도 PR — GAS는 새 version 배포).

## G1 — 도메인 + Search Console

**외부 시스템**: 도메인 등록사 (가비아 / Cloudflare Registrar / Google
Domains 등) + Cloudflare Dashboard + Google Search Console + GCP Console.

**선결 조건**: Cloudflare 계정 보유 (`backend-infrastructure-handoff.md` 라이브
리소스 카탈로그 참조), GCP 콘솔 접근 권한, 도메인 구매 예산.

**작업 단위 체크박스** (절차 상세는 [`01-domain-and-search-console.md`](./01-domain-and-search-console.md)):

- [ ] 도메인 후보 결정 + 구매 (예: `<chosen>.app`)
- [ ] 도메인 DNS를 Cloudflare로 위임 (네임서버 변경)
- [ ] Cloudflare Dashboard → Workers & Pages → `autocolor-prod` →
      Custom Domains에 도메인 연결
- [ ] Google Search Console 속성 추가 ("Domain" property) → DNS TXT 인증
- [ ] GCP OAuth Consent Screen → Authorized domains에 새 도메인 추가
- [ ] (Verified 후) `wrangler.toml` `[env.prod.vars].GOOGLE_OAUTH_REDIRECT_URI`
      를 새 도메인으로 변경 + commit
- [ ] 새 도메인의 redirect URI를 GCP OAuth Web Client에 등록
- [ ] `WEBHOOK_BASE_URL` 시크릿을 prod에 추가
      (`pnpm wrangler secret put WEBHOOK_BASE_URL --env prod`)

**결과 확인**:
- `curl https://<prod-domain>/healthz` → 200
- GSC 콘솔이 "Verified" 표시
- `wrangler tail --env prod`에서 OAuth 플로우 1회 시 `/oauth/google/callback`
  200 응답

**Unblock**: prod Watch API (`TODO.md:52`), §1 Support URL (row 78-79) /
§2 App home URL (row 120) / §2 Authorized domains (row 123) 채울 자리 확보.

## G2 — Prod 환경 활성화

**외부 시스템**: Supabase Dashboard + GCP Console + Cloudflare Dashboard
(Hyperdrive + Queues + Workers + Secrets) + GAS Editor.

**선결 조건**: G1 도메인 verified 권장 (Watch API 즉시 활성화). 미완 시 prod도
`WEBHOOK_BASE_URL` 미주입으로 시작 가능 — verified 후 갱신.

**작업 단위 체크박스** (절차 상세는 [`02-prod-environment-activation.md`](./02-prod-environment-activation.md)):

- [ ] Supabase prod 프로젝트 생성 (region 결정: `ap-northeast-2` Seoul 권장)
- [ ] `pgcrypto` extension 활성화
- [ ] `pnpm db:migrate` (prod `DIRECT_DATABASE_URL` 사용)
- [ ] RLS 정책 적용 확인 (`SELECT * FROM pg_policies;`)
- [ ] GCP prod OAuth Web Client 생성 + redirect URI 등록 (G1 verified 전
      이라면 `*.workers.dev` URL로 임시 등록 → verified 후 교체)
- [ ] `pnpm gen-secrets prod` 실행 + `.prod.vars` 작성
      (DB / Hyperdrive / GCP / 3종 키 — `TOKEN_ENCRYPTION_KEY` /
      `SESSION_HMAC_KEY` / `SESSION_PEPPER`)
- [ ] `pnpm wrangler hyperdrive create autocolor-prod-db --connection-string=...`
      + 출력 UUID 캡처
- [ ] `wrangler.toml`의 prod placeholder 주석 위치에 실제 값 채움 + commit
- [ ] `pnpm wrangler queues create autocolor-sync-prod` /
      `pnpm wrangler queues create autocolor-sync-dlq-prod`
- [ ] `pnpm sync-secrets prod` 실행 (시크릿 일괄 주입)
- [ ] GAS 편집기에서 prod 배포 (Edit existing / New version,
      **신규 배포 금지** — `src/CLAUDE.md` "GAS deployment URL must stay
      stable")
- [ ] prod /exec URL을 `GAS_REDIRECT_URL_PROD` 시크릿으로 등록
- [ ] 검증 시퀀스 실행 (`/healthz` → OAuth → 카테고리 + sync → Watch →
      account deletion 옵션 — 상세 02 runbook Step 12)
- [ ] 세션 GC pg_cron 등록 (`SELECT cron.schedule('session-gc',
      '0 4 * * *', $$DELETE FROM sessions WHERE expires_at < now() -
      interval '7 days'$$);`)
- [ ] (G1 verified 시) `WEBHOOK_BASE_URL` 시크릿 주입 + Watch 등록
      (`POST /sync/bootstrap` 또는 6시간 cron 자동 갱신 대기)

**결과 확인**:
- `curl https://<prod>/healthz` → 200
- OAuth 플로우 성공 (test 계정 1회) + DB의 `users` / `sessions` /
  `oauth_tokens` 행 1건씩
- 카테고리 1개 추가 후 sync 트리거 → `sync_runs` 1행 (outcome=`ok`) +
  `sync_state.last_run_summary` counters 채움 + Calendar에서 색상 변경 확인

**Unblock**: §5 row 252 graduate, §3 row 178 Retention 부분 (`초안`).

**롤백 시나리오** (실패 시): 02 runbook의 `롤백 시나리오` H2 섹션 참조 — dev
환경은 모든 시점에서 영향 없음.

## G4 — Privacy Policy + Terms of Service

**외부 시스템**: 법률 자문 사무소 + (호스팅 결정 후) Cloudflare Pages /
GitHub Pages / 자체 정적 페이지.

**호스팅 옵션 비교**:

| 옵션 | 장점 | 단점 |
|---|---|---|
| **Cloudflare Pages** (권장) | G1 도메인과 같은 Cloudflare 계정 → DNS / SSL / 도메인 매핑 단일 콘솔. 무료 plan 충분. | Cloudflare Pages 별도 프로젝트 1개 추가. |
| GitHub Pages | repo와 직결 — Privacy 본문 변경 = git push. | Cloudflare 도메인을 GitHub Pages CNAME으로 연결 — 추가 콘솔 1개. |
| 자체 정적 (prod Worker 라우트) | 인프라 추가 없음. | 코드 변경 발생 — `/privacy` / `/terms` 라우트 + 정적 HTML 응답. 후속 작업으로 분리 권장. |

**작업 단위 체크박스**:

- [ ] [`docs/legal/privacy-policy.md`](../legal/privacy-policy.md) /
      [`terms-of-service.md`](../legal/terms-of-service.md) 1차 초안 검토
      (이 PR에 포함된 본문)
- [ ] 자문 의뢰서 작성 (적용 법 결정 / 자문 영역 명시 — Privacy / ToS의
      `자문 검토 시 우선 확인 항목` H3 그대로 첨부 가능)
- [ ] 자문 의뢰 발송 + 회신 대기 (1-3주)
- [ ] 자문 회신 후 본문 반영 → **별도 PR** (이 PR과 분리)
- [ ] 호스팅 옵션 결정 (Cloudflare Pages 권장)
- [ ] 호스팅 publish + URL 캡처 (`https://<prod-domain>/privacy`,
      `https://<prod-domain>/terms`)
- [ ] `docs/marketplace-readiness.md` row 121-122 status `초안` → `완료` +
      URL 추가 (별도 PR)
- [ ] `gas/addon.js:119` "정식 링크는 출시 시점에 제공됩니다" placeholder를
      실제 URL로 교체 (별도 PR — GAS는 새 version 배포로 publish)
- [ ] GCP OAuth Consent Screen → App domain 섹션의 Privacy policy URL /
      Terms of service URL을 실제 URL로 갱신

**법률 자문 영역 (의뢰 시 우선 확인 항목)**: `docs/legal/privacy-policy.md`
및 `docs/legal/terms-of-service.md` 각 파일 끝의 `자문 검토 시 우선 확인 항목`
H3에 정리되어 있다. 의뢰서에 그대로 첨부 가능.

**Unblock**: §5 row 254-255 graduate (자문 + 호스팅 후 `초안` → `완료`),
§1 OAuth Consent Screen 검수 (`TODO.md:131`)의 prerequisite — 검수 신청에는
Privacy / ToS URL이 등록되어 있어야 한다.

## 이 PR이 끝난 직후 사용자 시작점

1. **이 PR을 먼저 머지**하여 runbook / 초안이 main에 안정적으로 들어와야
   외부 작업 시작 시 reference 깨짐 없음.
2. 진행 권장 1순위: G2 Step 1-4 (Supabase prod 생성 + 마이그레이션) — 즉시
   실행 가능, 외부 대기 없음.
3. 동시에 G1 Step 1-3 (도메인 구매 + DNS 설정 + GSC 인증 시작) 백그라운드.
4. 동시에 G4 자문 의뢰서 발송.

진행 상황을 추적하려면 이 파일의 체크박스를 직접 fork / 별도 issue tracker로
복사해 사용한다. 본 파일은 **무엇을 체크할지의 hub**일 뿐, 사용자별 진행
상태는 별도 surface (issue tracker · 노션 · Linear)에서 관리하는 것이 깔끔
하다.

## Cross-references

- 게이트 분류 / 의존성 그래프: [`docs/completion-roadmap.md`](../completion-roadmap.md)
- 사용자 진입점: 이 파일
- 절차 상세: [`01-domain-and-search-console.md`](./01-domain-and-search-console.md)
  · [`02-prod-environment-activation.md`](./02-prod-environment-activation.md)
- 법률 초안: [`docs/legal/privacy-policy.md`](../legal/privacy-policy.md)
  · [`docs/legal/terms-of-service.md`](../legal/terms-of-service.md)
- 정본 작업 항목: [`TODO.md` §1 line 8](../../TODO.md) /
  [§3 후속 line 35](../../TODO.md) / [§3 후속 line 38](../../TODO.md) /
  [§7 line 132](../../TODO.md)
- 라이브 리소스 카탈로그: [`docs/backend-infrastructure-handoff.md`](../backend-infrastructure-handoff.md)
- 제출 자료 인덱스: [`docs/marketplace-readiness.md`](../marketplace-readiness.md)

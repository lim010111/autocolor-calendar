# 04 — Legal hosting (Privacy Policy + Terms of Service)

> 이 runbook은 [`TODO.md` §7 line 132](../../TODO.md) "개인정보처리방침,
> 서비스 약관 작성 및 Google Workspace Marketplace 등록"의 **legal 호스팅
> 부분**을 다룬다. Marketplace 등록 자체는 [08 runbook](./08-marketplace-submission.md)
> 으로 분리. 본 runbook의 산출물은 `https://<prod-domain>/privacy` /
> `https://<prod-domain>/terms` 공개 URL이며, 이 URL이 G6 (OAuth Consent
> Screen 검수)와 G5 (Marketplace listing)의 강제 입력 필드.
>
> Owner: Legal + Eng. Step 1 (자문 검토)은 외부 의존이 가장 길다 — 며칠~몇
> 주. **G1 (도메인) 직후 즉시 시작 권장.** Step 2-6 (호스팅 / DNS /
> verification)은 자문 회신 도착과 병행 가능.
>
> **이 runbook의 범위 밖**: 본문 작성. 한국어 1차 초안은
> [`docs/legal/privacy-policy.md`](../legal/privacy-policy.md) /
> [`docs/legal/terms-of-service.md`](../legal/terms-of-service.md)에 이미
> 커밋 (`15ea4ba`). 본 runbook은 검토 → 호스팅 → 정합성 갱신만 다룬다.

- **Pre-conditions**:
  - [01 runbook](./01-domain-and-search-console.md) 완료 (verified
    `<prod-domain>` + Cloudflare DNS 위임).
  - [`docs/legal/`](../legal/) 1차 초안 commit 존재.
  - 본인이 Cloudflare 계정 owner 또는 Workers/Pages admin 권한 보유.
- **Acceptance**:
  - `curl -I https://<prod-domain>/privacy` → 200 + `content-type: text/html`.
  - `curl -I https://<prod-domain>/terms` → 200 + `content-type: text/html`.
  - 두 URL의 본문이 (자문 회신 반영 후의) `docs/legal/*.md` 본문과 **의미
    동등** (포맷 차이 OK, 내용 등치).
  - GCP OAuth Consent Screen "Application privacy policy link" / "Terms of
    service link" 칸이 placeholder가 아닌 실제 URL로 갱신됨.
  - `gas/addon.js:119`의 "정식 링크는 출시 시점에 제공됩니다." placeholder가
    실제 URL로 교체 + GAS 새 version 배포 완료.

## Step 1 — 법률 자문 검토 (Legal owner — 외부 의존, 가장 긴 리드타임)

[`docs/legal/README.md`](../legal/README.md)에 명시된 자문 우선 확인 영역을
체크리스트로 의뢰한다:

- **관할법 및 분쟁해결** — 한국 PIPA / GDPR / CCPA 적용 범위. 본 서비스는
  Workspace Marketplace 글로벌 listing이라 EU·캘리포니아 거주자 사용 가능.
- **미성년자 정책** — Google Workspace는 통상 성인/B2B이라 단순 명시면
  충분할지 자문이 판단.
- **면책조항 / 책임 한계** — 색상 잘못 적용으로 인한 사용자 손해 면책 범위.
- **사용자 권리 행사 절차** — 데이터 열람 / 삭제 요청 (UI 측 `POST
  /api/account/delete` 외 별도 절차 필요한지).
- **약관 변경 통지 방식** — 이메일 / Add-on 카드 내 알림 / 웹 게시 중 어떤
  형태가 한국 PIPA 요구를 충족하는지.
- **Sub-processors 변경 통지** — Cloudflare / Supabase / OpenAI 외에 추가
  vendor가 들어올 때의 통지 의무 범위.

자문 회신을 받으면 **별도 PR로** 본문에 반영. 본 runbook은 회신 후 진행되는
publish 절차만 책임진다.

리드타임 단축 팁: 1차 초안에 "TBD — 자문 검토 영역" 마크가 있는 부분을
회신 시 한 번에 처리하도록 자문 측에 명시 패치 단위로 의뢰.

## Step 2 — 호스팅 옵션 비교 + 결정

| 옵션 | 장점 | 단점 | 추천 |
|---|---|---|---|
| **Cloudflare Pages** | 도메인 이미 Cloudflare Registrar / DNS, custom domain 매핑 1단계, 비용 0, 자동 SSL, GitHub 연결로 자동 배포 | Cloudflare 계정 의존, Pages 빌드 환경 학습 필요 | ✅ 권장 |
| Worker static asset (Hono `serveStatic`) | prod Worker 안에서 `/privacy` / `/terms` 라우트 직접 처리, vendor 추가 0 | Worker 메모리에 정적 자원 상주 — Marketplace 변경 시마다 Worker deploy 동반, 비용·복잡도 증가 | ❌ 비추천 |
| GitHub Pages | 가장 단순한 정적 사이트, 무료 | apex 도메인 매핑 불가 (subdomain만 — `legal.<prod-domain>`처럼 별도 시각적 일관성 깨짐), DNS 분리 부담 | ❌ |
| 외부 SaaS (Notion / 블로그 등) | 빠름 | URL이 vendor 도메인이라 시각적 일관성 깨짐, Privacy URL이 자체 도메인 아니면 OAuth 검수 거절 가능 | ❌ |

**결정: Cloudflare Pages.** 이미 `<prod-domain>`이 Cloudflare에 위임돼
있으므로 (`docs/runbooks/01-domain-and-search-console.md` Step 2) DNS /
SSL 추가 작업 0. Step 4의 custom domain 매핑이 1메뉴 클릭으로 끝난다.

## Step 3 — Cloudflare Pages 프로젝트 생성

본 저장소를 GitHub origin으로 사용 중이라 가장 단순한 빌드는
**`docs/legal/`의 markdown 2개를 정적 HTML로 변환**하는 패턴이다.

옵션 A — **Pages Markdown 직접 렌더 (권장, 빌드 step 0)**:

`docs/legal/`을 publish 디렉터리로 직접 사용. Cloudflare Pages는 markdown
을 자동 렌더하지 않으므로 **사전에 HTML 변환**이 필요. 가장 단순한 두 가지:

- **Pages 빌드 명령으로 1회 변환 — 구현 완료**: [`scripts/build-legal.ts`](../../scripts/build-legal.ts)
  + `package.json`의 `legal:build` script가 이미 존재
  ([`pnpm legal:build`](../../package.json) 단독 실행 가능). `marked`
  18.x 의존, 출력은 `dist/legal/{privacy,terms}.html` 한 쌍 (라이트 /
  다크 자동 전환 inline CSS 포함, 약 ~15-20KB).

  Pages 프로젝트 설정:
  - **Build command**: `pnpm install --frozen-lockfile && pnpm legal:build`
  - **Build output directory**: `dist/legal`

  로컬 검증:

  ```bash
  pnpm legal:build
  # → dist/legal/privacy.html (~19KB) / terms.html (~14KB)
  open dist/legal/privacy.html  # 브라우저에서 라이트/다크 렌더 확인
  ```

- **GitHub Actions로 사전 변환 + Pages는 정적 호스팅만** — `[03 runbook]`
  의 CI 워크플로에 `legal-build` job 추가, `gh-pages-legal` 브랜치에
  결과물 push, Pages를 그 브랜치로 연결. 빌드 의존성을 prod 워커와 분리할
  수 있어 실수 영향 격리 우수.

옵션 B — **외부 정적 사이트 generator (`mdbook` / `docusaurus`)**: 추후
운영 매뉴얼·도움말도 같은 도메인 하위에 publish할 계획이 생기면 검토.
현재 게이트로는 과잉 — 본 runbook 범위 밖.

생성 절차 (옵션 A 기준):

1. Cloudflare Dashboard → Workers & Pages → "Create" → Pages → "Connect to
   Git".
2. GitHub 저장소 인증 → `autocolor_for_calendar` 선택.
3. **Project name**: `autocolor-legal` (URL이 `autocolor-legal.pages.dev`
   임시 발급. Step 4에서 custom domain 매핑.)
4. **Production branch**: `main`.
5. **Build command**: `pnpm install --frozen-lockfile && pnpm legal:build`.
6. **Build output directory**: `dist/legal`.
7. "Save and Deploy". 첫 빌드가 1-2분 내 끝나야 정상.
8. `https://autocolor-legal.pages.dev/privacy` / `/terms` 응답 확인.

## Step 4 — Custom domain 매핑

`<prod-domain>/privacy` / `<prod-domain>/terms`가 Pages 프로젝트로
가도록 한다. `<prod-domain>` 자체는 prod Worker가 Custom Domain으로
잡고 있어 (`docs/runbooks/01-domain-and-search-console.md` Step 3)
**path별 분기 충돌**이 발생한다.

해결: **Pages를 별도 subdomain (예: `legal.<prod-domain>`)에 매핑하지
말고**, prod Worker 안에서 `/privacy` / `/terms` 라우트를 Pages로 redirect.

다음 두 가지 방식 중 택1:

### 4A — Worker가 Pages로 reverse-proxy (권장)

`src/index.ts`의 라우터에 다음을 prod 한정으로 추가 (이 PR에는 포함하지
않고 별도 commit):

```ts
// src/routes/legal.ts (신규)
import { Hono } from "hono";
import type { Bindings } from "../env";
const legal = new Hono<{ Bindings: Bindings }>();
const PAGES_ORIGIN = "https://autocolor-legal.pages.dev";
legal.get("/privacy", async (c) => {
  const res = await fetch(`${PAGES_ORIGIN}/privacy`);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
legal.get("/terms", async (c) => {
  const res = await fetch(`${PAGES_ORIGIN}/terms`);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
export default legal;
```

Worker가 Pages 콘텐츠를 그대로 반환. SSL / CDN은 Pages가, 도메인 일관성은
Worker가 책임. 본문 변경 시 Pages만 redeploy하면 즉시 반영.

### 4B — Pages를 `legal.<prod-domain>`에 매핑 + Worker가 redirect

Pages → Custom Domains → `legal.<prod-domain>` 추가. `src/routes/legal.ts`
는 redirect만:

```ts
legal.get("/privacy", (c) => c.redirect("https://legal.<prod-domain>/privacy", 301));
legal.get("/terms", (c) => c.redirect("https://legal.<prod-domain>/terms", 301));
```

장점: Pages CDN 직접. 단점: OAuth Consent Screen에 입력하는 URL이
redirect 거치면 Google이 "Final URL must match" 거절할 위험. 본 옵션은
검수 통과까지 4A 운영 권장.

권장: **4A (reverse-proxy)** — OAuth 검수 측 위험 회피 우선.

## Step 5 — 검증

```bash
curl -I https://<prod-domain>/privacy
# HTTP/2 200 + content-type: text/html; charset=utf-8

curl -I https://<prod-domain>/terms
# HTTP/2 200 + content-type: text/html; charset=utf-8

# 본문 spot-check
curl -s https://<prod-domain>/privacy | grep -E "(개인정보처리방침|Privacy)"
curl -s https://<prod-domain>/terms | grep -E "(서비스 이용약관|Terms)"
```

브라우저로 두 URL 직접 열어 시각적 점검:
- 모바일 뷰에서도 가독성 OK.
- 모든 H2 / H3 헤더가 `docs/legal/*.md`와 1:1 대응.
- 외부 vendor URL 인라인 0 (`docs/legal/README.md`의 글로벌 컨벤션 유지).

## Step 6 — 정합성 갱신 (다른 surface 갱신)

본 runbook의 마지막은 **publish된 URL을 다른 surface에 반영**:

### 6A — `docs/marketplace-readiness.md`

§2 row 121-122 status `초안` → `완료` + URL 추가. §5 row 254-255 동일 변경.

### 6B — `gas/addon.js:119` placeholder 교체

```js
// gas/addon.js (수정 전)
.setText("정식 링크는 출시 시점에 제공됩니다.")

// 수정 후
.setText("개인정보처리방침: https://<prod-domain>/privacy\n이용약관: https://<prod-domain>/terms")
```

정확한 위치는 `gas/addon.js:119` (PR 시점에 line 번호가 바뀔 수 있으니
"정식 링크는 출시 시점에" grep으로 위치 확인). GAS 편집기에서:

- `src/CLAUDE.md` "GAS deployment URL must stay stable" 계약 준수 — 새 deployment
  생성 금지, **기존 deployment의 New version 발행**.
- 절차: Editor → Deploy → Manage deployments → 기존 deployment 행의
  연필 아이콘 (Edit) → Version: "New version" → Description: "G4 legal URLs
  반영" → Deploy.

### 6C — GCP OAuth Consent Screen 갱신

GCP Console → APIs & Services → OAuth consent screen → "EDIT APP":

- **Application privacy policy link**: `https://<prod-domain>/privacy`
- **Application terms of service link**: `https://<prod-domain>/terms`

Save. 다음 사용자 OAuth 흐름부터 새 URL이 consent 화면에 표시.

### 6D — `docs/legal/README.md`의 publish 후 PR 절차 표시

해당 README는 "publish 끝나면 별도 PR로 처리한다" 4 step을 이미 명시
(`docs/legal/README.md:11-19`). 이 step들이 본 runbook의 6A-6C로
실현됐음을 README에 한 줄 추가하거나 README 본문 그대로 유지하고 본
runbook이 정본임을 알리는 cross-reference만 추가.

## 롤백 시나리오

- **Pages 빌드 실패**: 새 commit이 빌드 깨면 Cloudflare Pages는 직전
  성공 빌드를 자동 유지 (rollback 자동). Cloudflare Dashboard → Pages
  프로젝트 → Deployments → "Rollback to this deployment" 메뉴로 명시적
  롤백도 가능.
- **본문 오류 publish**: `docs/legal/*.md` 본문 fix → main에 push →
  Pages 자동 재배포. `<prod-domain>/privacy` 캐시 TTL 짧아 (Pages 기본
  몇 분) 빠른 반영.
- **Worker reverse-proxy 라우트 실패 (Step 4A 옵션)**: prod Worker의
  `src/routes/legal.ts` 임포트 제거 + redeploy. Pages는 무영향 — `/privacy` /
  `/terms` 가 Worker 404로 fall-through되며 OAuth 검수가 깨질 수 있어
  **Pages 직접 URL을 임시 placeholder로 OAuth Consent에 등록 → 본 라우트
  복구 후 다시 도메인 URL로**.
- **자문 검토 도중 본문 대규모 수정 필요**: `docs/legal/`의 별도
  branch에서 작업, publish 시점까지 main 본문 유지 (Pages는 main을
  보고 있음). 또는 자문 회신 단위로 작은 PR을 빠르게 묶어 main 머지.

## Submission-time 영향

- `docs/marketplace-readiness.md` §2 row 121-122 status `초안` → `완료`.
- §5 row 254-255 동일.
- §2 row 120 (App home page URL) — `<prod-domain>` 자체로 unblock 가능
  (현재 `/healthz`만 응답이라 `/`가 비어 있음 — 별도 `/`에 home 카드
  추가 또는 `/`에서 `<prod-domain>/privacy`로 redirect할지 결정. OAuth
  검수 직전 정리 권장).
- §2 row 131 (Onboarding-card 카피 refresh) — 6B에서 처리.
- `TODO.md:132` 부분 unblock — Marketplace 등록(08 runbook)이 정식 시점.

## Cross-references

- [`TODO.md` §7 line 132](../../TODO.md) — 작업 정본
- [`docs/completion-roadmap.md`](../completion-roadmap.md) — G4 절
- [`docs/legal/README.md`](../legal/README.md) — 1차 초안 보관 정책
- [`docs/legal/privacy-policy.md`](../legal/privacy-policy.md)
- [`docs/legal/terms-of-service.md`](../legal/terms-of-service.md)
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) — §2 / §5
- [`docs/runbooks/01-domain-and-search-console.md`](./01-domain-and-search-console.md) — `<prod-domain>` 정의
- [`docs/runbooks/06-oauth-verification.md`](./06-oauth-verification.md) — Step 6C가 G6 입력 필드 채우는 prerequisite
- [`docs/runbooks/08-marketplace-submission.md`](./08-marketplace-submission.md) — Step 6A가 G8 사전 점검에 반영
- [`gas/addon.js`](../../gas/addon.js) — Step 6B 위치
- `src/CLAUDE.md` "GAS deployment URL must stay stable" — Step 6B 절차

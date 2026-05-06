# 00 — 사용자 액션 체크리스트 (출시까지)

> 이 파일은 **AutoColor for Calendar를 Marketplace public 출시까지 끌어
> 올리려면 사용자가 직접 클릭 / 녹화 / 결제 / 제출해야 하는 모든 외부
> 작업의 정본 hub**다. 코드 변경은 모두 끝났고, 남은 것은 외부 콘솔 작업
> 과 Google 검수 대기뿐.
>
> 절차 상세는 게이트별 runbook (`01-08`)에 있고, 본 파일은 **무엇을 언제
> 체크할지의 박스**만 담는다. Claude가 자동화/대신할 수 있는 항목은
> "Claude 도움" 라인에 명시 — 콘솔 작업 들어가기 전에 그 산출물을 받아
> 둘 수 있다.

---

## 게이트 진행 상황 (2026-05-05 기준)

| 게이트                       | 상태             | 비고                                                    |
| ---------------------------- | ---------------- | ------------------------------------------------------- |
| G1 — 도메인 + Search Console | ✅ 완료          | `autocolorcal.app` GSC verified 2026-05-04              |
| G2 — Prod 환경 활성화        | ✅ 완료          | PR #43 머지 (Hyperdrive / Queue / cron 바인딩)          |
| G3 — CI/CD 파이프라인        | ⚠️ 거의 완료     | PR #45 머지 — `main` 보호 브랜치 룰 1건만 잔존 (작업 ①) |
| G4 — Privacy/ToS 호스팅      | ✅ 완료          | `legal.autocolorcal.app/{privacy,terms}` publish 2026-05-05 + GCP Consent Screen 갱신 (③ 완료 / ⑥ self-publish 채택) |
| G5 — Listing assets          | ⏳ 대기          | description 정본 OK, 아이콘·스크린샷 미완               |
| G6 — OAuth 검수              | ⏳ critical path | scope 정당화 final, 데모 영상·Submit 미완               |
| G7 — 백업/복구               | ⏳ 대기          | Supabase Pro 업그레이드 + PITR 활성화                   |
| G8 — Marketplace publish     | ⏳ G6 의존       | 마지막 단계, 검수 1-3주                                 |

---

## ⏱️ 오늘 30분이면 끝나는 것

### ① GitHub `main` 보호 브랜치 룰 (5분)

- **어디서**: GitHub repo → ⚙️ Settings → Branches → `Add branch ruleset`
- **설정**:
  - Rule name: `protect-main`
  - Target branches: `main` (Default branch)
  - ✅ Restrict deletions
  - ✅ Require a pull request before merging (Required approvals: 0)
  - ✅ Require status checks to pass — `test` / `typecheck` / `lint` / `migration-drift` 4개 추가
  - ✅ Require branches to be up to date before merging
  - ✅ Block force pushes
- **왜 사용자만**: repo Settings 접근 권한
- **Claude 도움**: 절차서 `docs/runbooks/03-cicd-pipeline.md` Step 3 참조
- [ ] 룰 추가 완료 + 일부러 깨진 PR 1회로 게이트 동작 확인

### ② Supabase Pro 업그레이드 + PITR (15분, $25/월)

- **어디서**: supabase.com → 프로젝트 → Settings → Billing → **Upgrade to Pro**
- **그 다음**: Database → Backups → **Point in Time Recovery 토글 ON**
- **왜 사용자만**: 결제 카드 + Supabase 계정 owner
- **Claude 도움**: `docs/runbooks/07-backup-and-recovery.md` Step 1-2
- [ ] Pro plan 결제
- [ ] PITR 활성화 확인 (Backups 탭에 PITR 옵션 표시)

---

## 📅 이번 주 (반나절~하루)

### ③ Cloudflare Pages로 `/privacy` `/terms` 호스팅 (1시간) — ✅ 2026-05-05 완료

- **어디서**: dash.cloudflare.com → Pages → **Create project** → Connect to Git
- **설정**:
  - GitHub repo 선택 → Build output: `dist/legal/`
  - Custom domain: `legal.autocolorcal.app/privacy`, `/terms`
    (apex `autocolorcal.app` 은 prod Worker 가 점유 중이라 path 충돌 회피 위해 `legal.` subdomain 분리 — `04-legal-hosting.md` Step 4)
- **검증**: `curl -I https://legal.autocolorcal.app/privacy` → 200, body가 `docs/legal/privacy-policy.md`와 일치
- **왜 사용자만**: Cloudflare 계정 + GitHub OAuth 인증
- **Claude 도움**: 빌드 스크립트 작성, Markdown→HTML 변환 설정, redirect 규칙
- **상세**: `docs/runbooks/04-legal-hosting.md`
- [x] Cloudflare Pages 프로젝트 생성
- [x] custom domain 매핑 + 200 응답 확인
- [x] `gas/addon.js:119` placeholder URL을 실제 URL로 교체 (commit `ae85980` — GAS 새 version 배포는 운영자 수동 단계로 잔존)

### ④ 스크린샷 4장 촬영 (1시간)

실제 Google Calendar에서 Add-on 패널 캡처:

| #   | 장면           | 어떻게                                   |
| --- | -------------- | ---------------------------------------- |
| 1   | Welcome 카드   | OAuth 미연결 상태로 Add-on 첫 진입       |
| 2   | Home 카드      | 카테고리 2-3개 추가된 상태               |
| 3   | 규칙 추가 카드 | 키워드 + 색상 입력 중 화면               |
| 4   | 색칠된 일정    | 캘린더 메인 뷰에서 자동 색상 적용된 일정 |

- **해상도**: 1280×800 권장 (Marketplace 스펙)
- **저장**: `docs/assets/marketplace/screenshots/0X-name.png`
- **왜 사용자만**: 본인 Google 계정 + prod 환경 캡처
- **Claude 도움**: 사전 데이터 셋업 가이드 (어떤 카테고리·일정을 미리 만들어둘지), 촬영 후 리뷰
- **상세**: `docs/runbooks/05-marketplace-listing-assets.md` Step 3
- [ ] 사전 데이터 셋업 (카테고리 / 규칙 / 일정)
- [ ] 4장 촬영 + 리사이즈
- [ ] `docs/assets/marketplace/screenshots/`에 저장

### ⑤ 아이콘 디자인 (직접 채택, 8종 일습 commit 완료)

- **사양**: 128×128 + 32×32 PNG, 투명 배경 또는 brand background
- **저장**: `docs/assets/marketplace/icons/` (1024 / 480 / 128 / 32 / 16 + mono-dark/light + source.svg = 8종)
- **그 다음**: `gas/appsscript.json:22` `logoUrl` 교체 완료 (`https://legal.autocolorcal.app/icon-128.png`) → 아이콘은 `scripts/build-legal.ts`가 `dist/legal/`로 함께 publish하므로 ③ Cloudflare Pages 새 deploy 1회로 라이브
- **옵션 A — 외주** ($30-150, 5-7일): 크몽 / Fiverr ← 미채택
- **옵션 B — 직접** (Figma / Canva): 캘린더 + 색상 팔레트 모티프 ← **채택 (`scripts/generate-marketplace-icons.py`로 재생성 가능, commit `aa4ff62`)**
- **왜 사용자만**: 브랜드 미감 결정
- **Claude 도움**: 디자인 브리프 (외주 전달용), 컨셉 스케치, 컬러 팔레트 제안
- **상세**: `docs/runbooks/05-marketplace-listing-assets.md` Step 2
- [x] 옵션 결정 (외주 / 직접) — **직접**
- [x] 아이콘 PNG 8종 + SVG 1종 생성 (commit `aa4ff62`)
- [x] `gas/appsscript.json:22` `logoUrl` 교체 (코드 commit, GAS 새 version 배포는 ③ Pages deploy 후 운영자 수동 단계로 잔존)

---

## 🔄 외부 회신 대기 (1-2주, 일찍 시작)

### ⑥ 법무 검토 의뢰 — ✅ self-publish 경로 채택 2026-05-05 (외부 변호사 발주 미진행)

- **결정**: 외부 변호사 발주 대신 sub-agent self-review (`docs/legal/legal-review-opinion.md`) + Round 2 self-publish 보완 (commit `6080763`) 으로 publish-ready 판단. publish 자체는 ③에서 완료.
- **재사용 가능성**: 향후 본문 변경 시 (privacy-policy §9.1 후속 K-12 OAuth 차단 90일 약속, sub-processor 추가 등) 외부 자문 path 가 다시 검토될 가능성이 있어 절차서로 본 섹션 유지. 동일 변호사 path 재가동 시 아래 기존 점검 항목을 그대로 활용한다.
- **점검 항목 (절차서, 외부 자문 재가동 시 활용)**:
  - 한국 PIPA (개인정보보호법)
  - GDPR (EU 사용자 받을 시)
  - CCPA (캘리포니아 사용자 받을 시)
  - 본문 끝 `자문 검토 시 우선 확인 항목` H3 그대로 첨부
- **상세**: `docs/runbooks/04-legal-hosting.md` Step 1 (banner 참조 — Step 1 미채택, Step 2-6 완료)

---

## ⭐ critical path — 가장 먼저 시계 돌리기

### ⑦ 데모 영상 촬영 (반나절)

**Submit하는 순간 Google 검수 4-6주 시계가 시작됨** → ③④⑤⑥과 병행해도 무방.
다른 작업 다 끝내고 영상 찍기 시작하면 출시가 4-6주 늦춰진다.

- **사양**: 60-90초, 720p+, 영어 자막, prod 환경 (`autocolorcal.app`)
- **시나리오** (5단계):
  1. Marketplace에서 Install
  2. OAuth 동의 화면 (4개 scope 표시)
  3. Add-on 열기 → 카테고리 1개 추가 → 규칙 1개 추가
  4. 캘린더에 색상 자동 적용된 일정 보여주기
  5. **계정 삭제 흐름** (Privacy 검수 필수 항목)
- **녹화 도구**: OBS Studio / QuickTime (Mac) / 클로바노트
- **저장 후 업로드**: YouTube unlisted 또는 Google Drive shared link
- **왜 사용자만**: 화면 녹화 + 본인 OAuth 계정
- **Claude 도움**: 분 단위 콘티 + 영문 자막 스크립트, 사전 데이터 셋업 가이드
- **상세**: `docs/runbooks/06-oauth-verification.md` Step 2
- [ ] 사전 데이터 셋업 (test 계정 + 빈 캘린더)
- [ ] 1차 촬영
- [ ] 자막 입히기
- [ ] YouTube/Drive 업로드 + URL 캡처

### ⑧ GCP OAuth Consent Screen Submit (30분)

영상 촬영 직후 바로 진행. 여기서부터 4-6주 외부 대기.

- **어디서**: console.cloud.google.com → APIs & Services → **OAuth consent screen** → Edit App
- **입력**:
  - App home URL → `https://autocolorcal.app`
  - Privacy URL → `https://legal.autocolorcal.app/privacy` (③ 완료 — 2026-05-05)
  - ToS URL → `https://legal.autocolorcal.app/terms` (③ 완료 — 2026-05-05)
  - Authorized domains → `autocolorcal.app` (subdomain `legal.` 자동 포함)
  - Scopes → 4개 + per-scope 정당화 텍스트 (`docs/assets/marketplace/scope-justifications.md` 본문 복붙)
  - Demo video URL → ⑦에서 받은 URL
- **클릭**: **Submit for verification**
- **그 다음**: Google 응답 4-6주 대기. 추가 정보 요청 메일 오면 빠르게 응답 (지연 시 검수 큐 뒤로 밀림)
- **왜 사용자만**: GCP 프로젝트 owner 권한
- **상세**: `docs/runbooks/06-oauth-verification.md` Step 3-4
- [ ] App Configuration 입력 완료
- [ ] Submit 버튼 클릭 + 접수 메일 수신 확인
- [ ] (회신 시) 추가 정보 요청 응답 / 재제출

---

## 🚀 마지막 — G6 검수 통과 후

### ⑨ Marketplace Publish (30분 + 검수 1-3주)

- **어디서**: GCP Console → APIs & Services → **Marketplace SDK** → App Configuration
- **입력**: 모든 필드 (앱 이름·아이콘·description·screenshots·support URL·privacy URL·ToS URL·distribution)
- **권장**: 처음에는 **Unlisted**(URL 아는 사람만) 며칠 운영 → 안정성 확인 후 **Public** 전환
- **검수 기간**: 1-3주
- **출시 직후 모니터링**: `wrangler tail --env prod`, `/api/stats`, `sync_failures` 테이블, 첫 공개 사용자 OAuth 흐름 30분 내 1건 직접 검증
- **왜 사용자만**: GCP/Marketplace 콘솔 권한
- **Claude 도움**: 사전 점검 체크리스트 (모든 게이트 status 일치 확인)
- **상세**: `docs/runbooks/08-marketplace-submission.md`
- [ ] 사전 점검 — `docs/marketplace-readiness.md` §5 표 모든 행이 `완료`
- [ ] App Configuration 입력
- [ ] Publish 클릭 (Unlisted 시작)
- [ ] 검수 통과 후 Public 전환
- [ ] 출시 직후 30분 모니터링

---

## 권장 진행 순서

```
이번 주    ─┐ ① GitHub 보호 룰 (5분)
            │ ② Supabase Pro + PITR (15분)
            │ ③ Cloudflare Pages /privacy /terms (1시간)
            │ ⑤ 아이콘 외주 의뢰 (외주 시계 시작)
            │ ⑥ 법무 의뢰 메일 (회신 시계 시작)
            ─┘
+1주        ⑦ 데모 영상 촬영 + ④ 스크린샷 동시 촬영
+1주 (이어) ⑧ GCP Submit ◄── 4-6주 시계 가동, 가장 중요
+1-2주      ⑥ 법무 회신 → 본문 반영 → ③ 호스팅 갱신
+1-2주      ⑤ 아이콘 회수 → ④ 스크린샷 finalize
+5-7주      ⑧ G6 검수 통과
+7-8주      ⑨ G8 Submit → 검수
+9-10주     정식 출시 🎉
```

**핵심 1건만 고른다면 → ⑦ 데모 영상 + ⑧ Submit**. 4-6주 시계가 가장 일찍
시작되는 게 critical path 최단화의 전부.

**병행 가능한 작업**: ①②③⑤⑥은 서로 독립이라 같은 날 다 시작해도 OK.
④ 스크린샷은 ⑦ 데모 영상과 같은 prod 환경 셋업을 공유하니 같이 찍는 게
효율적.

---

## Claude가 바로 만들어줄 수 있는 산출물 (콘솔 작업 들어가기 전 준비)

콘솔 작업 시작하기 전에 손에 쥐고 있으면 시간 절약되는 것들:

- 📋 **데모 영상 분 단위 콘티 + 영문 자막 스크립트** (작업 ⑦)
- 📋 **스크린샷 촬영 체크리스트 + 사전 캘린더 데이터 가이드** (작업 ④)
- 📋 **변호사 검토 의뢰 체크리스트** (작업 ⑥, 메일 첨부용)
- 📋 **아이콘 디자인 브리프** (작업 ⑤, 외주 전달용)
- 🔧 **Cloudflare Pages 빌드 설정 + Markdown→HTML 변환** (작업 ③)
- 📊 **`marketplace-readiness.md` §5 표 status 갱신** (G2/G3=완료, account-deletion=완료)

원하는 항목 말하면 그 즉시 작성해서 저장.

---

## Cross-references

- 게이트 분류 / 의존성: [`docs/completion-roadmap.md`](../completion-roadmap.md)
- 게이트별 절차서:
  - [`01-domain-and-search-console.md`](./01-domain-and-search-console.md) — G1 (완료, 참고용)
  - [`02-prod-environment-activation.md`](./02-prod-environment-activation.md) — G2 (완료, 참고용)
  - [`03-cicd-pipeline.md`](./03-cicd-pipeline.md) — G3 (작업 ①)
  - [`04-legal-hosting.md`](./04-legal-hosting.md) — G4 (작업 ③⑥)
  - [`05-marketplace-listing-assets.md`](./05-marketplace-listing-assets.md) — G5 (작업 ④⑤)
  - [`06-oauth-verification.md`](./06-oauth-verification.md) — G6 (작업 ⑦⑧)
  - [`07-backup-and-recovery.md`](./07-backup-and-recovery.md) — G7 (작업 ②)
  - [`08-marketplace-submission.md`](./08-marketplace-submission.md) — G8 (작업 ⑨)
- 제출 자료 인덱스: [`docs/marketplace-readiness.md`](../marketplace-readiness.md)
- 법률 초안: [`docs/legal/privacy-policy.md`](../legal/privacy-policy.md) · [`docs/legal/terms-of-service.md`](../legal/terms-of-service.md)
- 정본 작업 항목: [`TODO.md`](../../TODO.md) §7

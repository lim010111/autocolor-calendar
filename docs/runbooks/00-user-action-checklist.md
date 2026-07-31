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

## 게이트 진행 상황 (2026-07-30 기준)

| 게이트                       | 상태             | 비고                                                    |
| ---------------------------- | ---------------- | ------------------------------------------------------- |
| G1 — 도메인 + Search Console | ✅ 완료          | `autocolorcal.app` GSC verified 2026-05-04              |
| G2 — Prod 환경 활성화        | ✅ 완료          | PR #43 머지 (Hyperdrive / Queue / cron 바인딩)          |
| G3 — CI/CD 파이프라인        | ✅ 완료          | PR #45 머지 + `main` classic branch protection 활성화 확인 2026-05-06 (4 status check + PR review 1명 + force-push/delete 차단; `enforce_admins: false`는 1인 개발자 emergency push 대비 의도적) |
| G4 — Privacy/ToS 호스팅      | ✅ 완료          | `legal.autocolorcal.app/{privacy,terms}` publish 2026-05-05 + GCP Consent Screen 갱신 (③ 완료 / ⑥ self-publish 채택) |
| G5 — Listing assets          | ⏳ 대기          | description·아이콘·데모 영상 완료. **스크린샷 4장은 존재하나 무효** — 2026-05-09 촬영분이라 native-labels #03 편집기 개편(07-28)·legal clickwrap(07-29) 이전 UI 다. 재촬영 필요 (작업 ④) |
| G6 — OAuth 검수              | ✅ 완료          | 2026-07-24 승인 — `script.external_request` / `calendar` / `calendar.events` 3종. 데모 영상·Submit 모두 종료. 재검수 트리거는 신규 스코프 또는 consent screen **설정** 변경뿐 |
| G7 — 백업/복구               | ⚠️ 후퇴함        | Pro 결제 2026-05-06 → **2026-07-01 billing 중단으로 prod 가 임시 Free** (pause → Restore). Free 는 **백업 0 + 7일 무활동 자동 pause** 라 G7 은 사실상 미충족이다. PITR 은 애초에 보류 결정(2026-05-06). 실트래픽 전 Pro 복구 필요 — 접속기록 1년 보관(처리방침 §8.2 후속)의 Audit Log Drain 도 Pro 애드온이라 같은 결제에 묶인다 |
| G8 — Marketplace publish     | ⏳ G5·G7 의존    | G6 은 07-24 로 해제됐다. 남은 선행조건은 **G5 스크린샷 재촬영**과 **G7 Pro 복구** 둘뿐. 마지막 단계, 검수 1-3주 |

---

## ⏱️ 오늘 30분이면 끝나는 것

### ① GitHub `main` 보호 브랜치 룰 (5분) — ✅ 2026-05-06 완료

- **어디서**: GitHub repo → ⚙️ Settings → Branches
- **확인된 상태** (`gh api repos/.../branches/main/protection`):
  - ✅ `required_status_checks.contexts`: `test` / `typecheck` / `lint` / `migration-drift`
  - ✅ `required_pull_request_reviews.required_approving_review_count: 1`
  - ✅ `allow_force_pushes: false`, `allow_deletions: false`
  - ⚠️ `enforce_admins: false` — 1인 개발자 emergency push 대비 의도적 (PR push 시 `Bypassed rule violations` 메시지로 자동 통과)
- **왜 사용자만이었음**: repo Settings 접근 권한
- **Claude 도움**: 절차서 `docs/runbooks/03-cicd-pipeline.md` Step 3 참조
- [x] 룰 추가 완료 (4 status check + PR review 1명 + force-push/delete 차단)

### ② Supabase Pro **재결제** (15분, $25/월) — ⚠️ 후퇴, 재실행 필요

> **PITR 은 하지 않는다.** 2026-05-06 에 보류 결정됐고(월 $115+ 추가,
> pre-revenue 부적합 — `07-backup-and-recovery.md` Step 1) 그 결정은 지금도
> 유효하다. 이 항목이 요구하는 것은 **Pro plan 자체**다: daily snapshot 7일
> 보존과 Audit Log Drain(접속기록 1년 보관)이 둘 다 Pro 에 묶여 있다.

- **어디서**: supabase.com → 프로젝트 → Settings → Billing → **Upgrade to Pro**
- **왜 다시**: 2026-05-06 결제분이 2026-07-01 billing 중단으로 끊겨 prod 가
  임시 Free 다(pause → Restore). Free 는 **백업 0 + 7일 무활동 자동 pause** —
  실사용자가 들어오는 publish 직후를 이 상태로 맞을 수는 없다.
- **왜 사용자만**: 결제 카드 + Supabase 계정 owner
- **Claude 도움**: `docs/runbooks/07-backup-and-recovery.md` Step 1-2
- [x] ~~Pro plan 결제 (2026-05-06)~~ → 2026-07-01 중단, 무효
- [ ] Pro plan 재결제 + Backups 탭에 daily snapshot 재생성 확인
- [ ] daily snapshot 기반 복구 리허설 1회 (`07` runbook Step 3B)
- [ ] Audit Log Drain 가동 — 접속기록 1년 보관(처리방침 §8.2)

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

### ④ 리스팅 이미지 5장 제작 — 캡처 촬영 + 디자인 합성

> **1차 촬영분(2026-05-09, `1f41184`)은 무효다.** 그 뒤 UI 가 두 번 바뀌었다:
> native-labels #03 편집기 개편(07-28 — 이름·색 읽기 전용, 11색 팔레트 →
> 라벨 칩, 이벤트 사이드바 색 선택도 칩 목록) 과 legal clickwrap(07-29 —
> welcome 카드에 약관·방침 링크 추가, 설정 카드의 정책 체크박스 3개 제거).
>
> **장면 구성도 바뀌었다 (2026-07-30).** 애드온 카드 4종을 생 스크린샷으로
> 올리던 계획을 폐기하고, **사용자가 설치하고 싶어지는 장면 5종**을 실 캡처
> 인셋 + 디자인 캔버스로 만든다. 상위 애드온(Zoom·Reclaim·Mailmeteor)이
> 전부 그 형태이고, 생 캡처는 카탈로그에서 1/3로 축소돼 읽히지 않는다.
> 4로케일 증거 촬영은 nl#03 AC 제거와 함께 사라졌다 — 이제 이 작업 하나뿐이다.

정본 명세: **[`docs/assets/marketplace/listing-image-specs.md`](../assets/marketplace/listing-image-specs.md)**
— 장별 Claude design 프롬프트와 필요한 캡처 목록이 짝으로 들어 있다.

| #   | 장면                        | 답하는 질문                       |
| --- | --------------------------- | --------------------------------- |
| 01  | Before → After 주간 뷰      | "이게 뭐 하는 앱인데?" (썸네일)   |
| 02  | 생성 → 5-10초 → 채색        | "매번 내가 눌러야 하나?"          |
| 03  | 규칙 1개 ↔ 다른 표현 4건    | "키워드를 다 등록해야 하나?"      |
| 04  | Google 색 선택창 ↔ 규칙목록 | "캘린더에 진짜 남나?"             |
| 05  | 이벤트 사이드바 + 통제 문구 | "내 캘린더를 마음대로 칠하나?"    |

- **해상도**: 1280×800 PNG (Marketplace 스펙, full-bleed)
- **저장**: `docs/assets/marketplace/screenshots/0X-name.png`
- **왜 사용자만**: 본인 Google 계정 + prod 환경 캡처
- **Claude 도움**: 명세·프롬프트 작성(완료), 시드 데이터 가이드, 합성 후 리뷰
- **상세**: 위 명세 문서 + `docs/runbooks/05-marketplace-listing-assets.md` Step 3
- [ ] 사전 데이터 셋업 (시드 규칙 5개 + 이벤트)
- [ ] 캡처 8종 촬영 (명세 §2)
- [ ] Claude design 으로 5장 합성 + 1280×800 export
- [ ] `docs/assets/marketplace/screenshots/`에 저장 + SDK 콘솔 교체

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

### ⑦ 데모 영상 촬영 — ✅ 2026-05-09 완료 (07-17 재편집, 07-24 승인)

> **다시 찍지 않는다.** `https://youtu.be/5hzXGmM_dQc` 하나가 G6(Restricted
> Scope 데모)와 G5(Promotional video, **optional**) 양쪽의 정본이다 —
> `docs/marketplace-readiness.md` §1 row 76 / §2 row 129 / §6 row 258 이
> 같은 URL 을 공유한다. 2026-07-03 반려(consent 화면 미노출) → 07-17
> 재편집본 제출 → **07-24 스코프 승인**으로 소임을 다했다.
>
> 영상은 native-labels #03 편집기 개편(07-28)과 legal clickwrap(07-29)
> **이전**에 촬영돼 현재 UI 와 일부 다르다. 그러나 승인 메일의 재검수
> 트리거는 "신규 스코프 요청 또는 consent screen 설정 변경" 뿐이므로 UI
> 변경은 재제출 사유가 아니다. G8 리스팅 품질 차원에서 재촬영하고 싶다면
> 선택 사항이며, 그때는 ④와 같은 셋업을 공유한다.

아래는 촬영 당시의 사양 — 재촬영을 택할 경우의 참조로만 남긴다.

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
- [x] 사전 데이터 셋업 (test 계정 + 빈 캘린더)
- [x] 1차 촬영 (2026-05-09) + 재편집 (2026-07-17, consent 화면 포함)
- [x] 자막 입히기
- [x] YouTube unlisted 업로드 + URL 캡처 — `https://youtu.be/5hzXGmM_dQc`

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
- [x] App Configuration 입력 완료
- [x] Submit 버튼 클릭 + 접수 메일 수신 확인
- [x] (회신 시) 추가 정보 요청 응답 / 재제출 — 3라운드(brand 05-09 / demo video 07-03 / 스코프 불일치 07-20) 대응
- [x] **G6 통과 (2026-07-24)** — `script.external_request`·`calendar`·`calendar.events` 승인

---

## 🚀 마지막 — G6 검수 통과 후 ← **여기부터 시작 (2026-07-24 해제)**

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

> **(2026-07-29) 위 타임라인은 소진됐다.** ⑦·⑧·G6 은 2026-07-24 승인으로
> 끝났고, 4-6주 외부 시계도 함께 닫혔다. 지금 남은 critical path 는
> **④ 스크린샷 재촬영 → G5 → ⑨ G8 Submit** 이며, 4-6주짜리 대기는 G8
> 검수 하나뿐이다.
>
> **(2026-07-30 보강)** 위 순서의 ②는 "Pro + PITR" 이 아니라 **Pro 재결제**
> 로 읽어야 한다(PITR 은 보류 결정 유지). ④와 ②는 서로 의존하지 않으므로
> 병렬로 돌리고, ⑨ 앞에서 둘 다 닫혀 있어야 한다 — G8 Submit 의 선행조건은
> 이제 이 둘뿐이다.

**핵심 1건만 고른다면 → ④ 스크린샷 재촬영**. G5 를 막고 있는 유일한 항목이고,
native-labels #03 의 마지막 AC 와 같은 화면이라 한자리에서 둘 다 닫힌다.

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

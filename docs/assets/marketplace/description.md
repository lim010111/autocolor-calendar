# Marketplace Listing — Description Copy (KR / EN)

> Google Workspace Marketplace SDK → App Configuration 화면에 입력하는
> Short description / Long description 정본. Short는 ≤ 80자, Long은
> ≤ 16,000자 한도 내에서 작성한다 (`docs/runbooks/05-marketplace-listing-assets.md`
> Step 1).
>
> Source-of-truth: 사용자 카피의 단어/톤은 `gas/addon.js:95-115` (3-step
> 온보딩 카드) + `docs/add-on-ui-plan.md` Screen 1·2 + `docs/security-principles.md`
> Principle 2 (PII 마스킹) 본문에서 파생. 본 문서는 publish 전 마지막 카피
> 검토 surface며, Marketplace SDK 콘솔에 그대로 복붙된다.
>
> Audience: 운영자가 콘솔에 입력하는 정본 카피. 카피 변경은 본 파일 수정
> + commit으로 추적 (Marketplace SDK 콘솔 자체는 변경 이력을 남기지 않음).

## Pre-conditions for publish

- [ ] 법무 검토 (`docs/runbooks/04-legal-hosting.md` Step 1) — privacy
  posture 단락이 Privacy Policy / ToS와 정합한지 cross-read.
- [ ] 한국어 카피의 존댓말 / 영어 카피의 voice (we / you) 일관성 회독.
- [ ] App name (`gas/appsscript.json:16` → `"AutoColor"`)과 본문 첫 줄 명칭
  일치 — drift 시 reviewer가 일관성 결함으로 거절할 수 있음.
- [ ] Privacy Policy URL / Terms of Service URL이 본문에 인라인되지 않음
  (콘솔의 별도 입력 칸이 정본 — drift surface 줄이기).

---

## Korean (한국어)

### Short description (≤ 80자)

```
키워드 규칙과 AI로 Google 캘린더 일정에 자동으로 색상을 입혀주는 Add-on.
```

(현재 글자 수: 41자.)

### Long description

```
AutoColor for Calendar는 사용자가 정의한 키워드 규칙과 AI 분석을 결합해
Google 캘린더의 일정에 자동으로 색상을 입혀주는 Workspace Add-on입니다.
일정이 추가되거나 수정될 때마다 백그라운드에서 분류가 실행되며, 사용자는
Calendar 사이드바에서 규칙을 관리하고 결과를 확인할 수 있습니다.

■ 이렇게 사용하세요
1. 규칙 만들기 — 키워드(예: "회의")와 원하는 색상을 선택해 나만의 규칙을
   만듭니다.
2. 일정 등록하기 — 평소처럼 캘린더에 일정을 등록합니다. 제목이나 설명에
   키워드가 포함되면 됩니다.
3. 자동 색상 적용 — 백그라운드에서 AutoColor가 자동으로 일정을 찾아
   색상을 입혀줍니다.

■ 두 단계 분류 엔진
- 1단계 (규칙): 사용자가 등록한 키워드를 일정의 제목·설명·위치에서
  찾아 일치하는 색상을 적용합니다. 데이터는 사용자의 캘린더 밖으로
  나가지 않습니다.
- 2단계 (AI): 1단계에서 일치하는 규칙이 없을 때만 AI 분류를 시도합니다.
  AI에 보내기 전 이메일·전화번호 등 개인정보는 자동 마스킹되며,
  이름·참석자·생성자·관리자 정보는 아예 전송되지 않습니다.

■ 개인정보 보호
- 일정의 본문(제목·설명·위치 등)은 로그·대시보드·관리자 화면 어디에도
  기록되지 않습니다.
- Google이 발급한 갱신 토큰은 AES-256-GCM으로 암호화해 저장됩니다.
- "계정 삭제"를 누르면 모든 사용자 데이터(규칙, 토큰, 동기화 상태,
  관측 로그)가 단일 트랜잭션으로 삭제되며, Google 측 OAuth 권한 회수와
  Watch 채널 정리도 함께 실행됩니다.
- AutoColor가 직접 색상을 입힌 일정만 다음 동기화에서 다시 평가합니다.
  사용자가 직접 색상을 바꾼 일정은 자동 분류 대상에서 제외됩니다.

■ 시작하기
설치 후 Google Calendar 사이드바에서 AutoColor 아이콘을 누르면 안내가
시작됩니다. Google 계정 연동(OAuth) 한 번이면 됩니다. 자세한 내용은
설치 후 사이드바의 도움말 카드에서 확인할 수 있습니다.
```

(권장 길이: 약 700-1,000자.)

---

## English

### Short description (≤ 80 chars)

```
Auto-color your Google Calendar events using keyword rules and AI.
```

(Current length: 65 chars.)

### Long description

```
AutoColor for Calendar is a Google Workspace Add-on that automatically
applies colors to your Google Calendar events, using a combination of
keyword rules you define and an AI fallback. Classification runs in the
background whenever events are added or updated, and you can manage rules
and review results from the Calendar sidebar.

■ How it works
1. Create a rule — pick a keyword (e.g. "meeting") and a color.
2. Add events as usual — anywhere the keyword appears in the title or
   description.
3. AutoColor handles the rest — matching events get colored automatically
   in the background.

■ Two-stage classification engine
- Stage 1 (rule): your keyword rules are matched against the event's
  summary, description, and location. No data leaves your calendar.
- Stage 2 (AI): only invoked when no rule matches. Before any data is sent
  to the AI, emails and phone numbers are automatically redacted, and
  attendee / creator / organizer fields are removed entirely.

■ Privacy posture
- Event content (summary, description, location, attendees) is never
  written to logs, dashboards, or admin views.
- Google refresh tokens are stored at rest under AES-256-GCM.
- "Delete account" removes all of your data (rules, tokens, sync state,
  audit logs) in a single transaction, and revokes the Google OAuth grant
  and webhook channels at the same time.
- Only events that AutoColor itself colored are re-evaluated on the next
  sync. Events you've recolored by hand are left alone.

■ Get started
Install the Add-on, open Google Calendar, and click the AutoColor icon in
the sidebar. One Google sign-in (OAuth) and you're set. The sidebar has a
short tutorial for first-time users.
```

(Recommended length: ~700-1,000 chars.)

---

## Tone notes / future-edit guardrails

- **Two-stage 분류 / Two-stage classification** 단락은 OAuth 검수 데모
  영상의 시나리오 narration과 정합 (`docs/runbooks/06-oauth-verification.md`
  Step 2 시나리오 표). 카피 변경 시 영상 자막도 동시 갱신.
- **"AI"라는 단어는 일부러 단순화한 표현**이다. 본문은 LLM (구체 모델명) 비
  공개 — 모델 제공자 변경 시 description 수정 불요. 모델 정보는
  `docs/assets/marketplace/sub-processors.md`가 정본.
- **숫자 / 정량 promise 금지** ("99.9% 가용성", "100% 정확도" 등). 미흡 시
  Google 검수와 한국 PIPA 동시 위배 위험.
- **Google 브랜드 표기 가이드 준수**: "Google Calendar" / "Google
  Workspace" — 띄어쓰기 / 대소문자 변경 금지. "G Suite" 같은 구 브랜드명
  사용 금지.
- **Marketplace SDK 콘솔의 카피 입력 칸은 plain text** — Markdown 렌더링
  없음. ■ 같은 1바이트 글머리 기호는 그대로 노출되며 줄바꿈은 보존된다.
  본문에 포함된 코드 펜스(```)는 본 파일의 가독성을 위해서만 존재하고
  콘솔 입력 시 펜스 안의 텍스트만 복사한다.

## Cross-references

- [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md)
  — 본 카피가 입력되는 콘솔 절차 (Step 1 → Step 6).
- [`docs/runbooks/06-oauth-verification.md`](../../runbooks/06-oauth-verification.md)
  — 데모 영상 시나리오와 본 카피 narration 정합.
- [`gas/addon.js`](../../../gas/addon.js) (95-115행) — 3단계 온보딩 카드
  카피 source.
- [`docs/add-on-ui-plan.md`](../../add-on-ui-plan.md) — Screen 1·2 카피
  source.
- [`docs/security-principles.md`](../../security-principles.md) — Principle
  2 (PII 마스킹) 본문, "Privacy posture" 단락의 source-of-truth.
- [`docs/legal/privacy-policy.md`](../../legal/privacy-policy.md) —
  Privacy Policy 본문이 description의 privacy 단락과 사실 일치해야 함.
- [`docs/assets/marketplace/sub-processors.md`](./sub-processors.md) — AI
  벤더 / 데이터 처리자 정본.
- [`docs/marketplace-readiness.md`](../../marketplace-readiness.md) — §1
  status 표 row "Short description" / "Long description".

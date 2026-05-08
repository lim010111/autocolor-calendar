# Marketplace Listing — Description Copy (KR / EN)

> Google Workspace Marketplace SDK → App Configuration 화면에 입력하는
> Short description / Long description 정본. Short는 ≤ 80자, Long은
> ≤ 16,000자 한도 내에서 작성한다 (`docs/runbooks/05-marketplace-listing-assets.md`
> Step 1).
>
> Source-of-truth: 사용자 카피의 단어/톤은 `gas/addon.js:95-115` (3-step
> 온보딩 카드) + `docs/add-on-ui-plan.md` Screen 1·2 + `docs/security-principles.md`
> Principle 2 (PII 마스킹) 본문에서 파생. 다국어(en / ko / zh-CN / zh-TW)
> 본문은 `gas/i18n.js` 번들의 `welcome.*` / `home.info` 톤과 정합해야
> 한다. 본 문서는 publish 전 마지막 카피 검토 surface며, Marketplace SDK
> 콘솔에 그대로 복붙된다.
>
> Audience: 운영자가 콘솔에 입력하는 정본 카피. 카피 변경은 본 파일 수정
> + commit으로 추적 (Marketplace SDK 콘솔 자체는 변경 이력을 남기지 않음).
>
> 지원 언어: Add-on UI가 다국어화된 4개 로케일과 동일 (`gas/i18n.js`
> 번들 = en / ko / zh-CN / zh-TW). 그 외 로케일에 대해서는 Marketplace
> SDK가 자동으로 영어(en) fallback을 노출한다.

## Pre-conditions for publish

- [ ] 법무 검토 (`docs/runbooks/04-legal-hosting.md` Step 1) — privacy
  posture 단락이 Privacy Policy / ToS와 정합한지 cross-read.
- [ ] 한국어 카피의 존댓말 / 영어 카피의 voice (we / you) / 중국어 간체·
  번체 카피 톤 일관성 회독 — 4개 언어 모두 동일 의미 단위로 정렬되어
  있어야 함.
- [ ] App name은 모든 언어에서 `"AutoColor"` 라틴 표기 고정
  (`gas/appsscript.json:16`). 콘솔의 언어별 "App display name" 칸은 모두
  동일 문자열 입력 — drift 시 reviewer가 일관성 결함으로 거절할 수 있음.
- [ ] Privacy Policy URL / Terms of Service URL이 본문에 인라인되지 않음
  (콘솔의 별도 입력 칸이 정본 — drift surface 줄이기).

---

## Korean (한국어, locale `ko`)

### App display name

```
AutoColor
```

(브랜드명은 모든 언어에서 라틴 표기 그대로 유지. Marketplace SDK 콘솔
의 `ko` 로케일 칸도 동일 문자열 입력.)

### Short description (≤ 80자)

```
키워드 규칙과 AI로 Google 캘린더 일정에 자동으로 색상을 입혀주는 Add-on.
```

(현재 글자 수: 41자.)

### Long description

```
AutoColor for Calendar는 사용자가 정의한 키워드 규칙과 AI 분석을 결합해
Google 캘린더의 일정에 자동으로 색상을 입혀주는 Workspace Add-on입니다.
일정이 추가되거나 수정되는 즉시 백그라운드에서 분류가 실행되며, 사용자는
Calendar 사이드바에서 규칙을 관리하고 결과를 확인할 수 있습니다.

■ 이렇게 사용하세요
1. 규칙 만들기 — 키워드(예: "회의")와 원하는 색상을 선택해 나만의 규칙을
   만듭니다.
2. 일정 등록하기 — 평소처럼 캘린더에 일정을 등록합니다. 제목이나 설명에
   키워드가 포함되면 됩니다.
3. 자동 색상 적용 — 일정을 저장하는 즉시 AutoColor가 백그라운드에서
   분류를 수행해 곧바로 색상을 입혀줍니다. 동기화 버튼을 누르거나 다음
   주기를 기다릴 필요가 없습니다.

■ PC와 모바일 모두 동일하게 동작
PC 웹 캘린더뿐 아니라 iOS / Android Google 캘린더 앱에서 일정을 새로
만들거나 기존 일정을 수정해도 동일한 규칙이 적용됩니다. 모든 분류는 서버
쪽에서 진행되므로, 사이드바를 열고 있지 않거나 모바일에서만 캘린더를
사용하는 경우에도 색상이 자동으로 입혀집니다.

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
시작됩니다. Google 계정 연동(OAuth) 한 번이면 됩니다. 이후에는 PC 웹
캘린더든 모바일(iOS / Android) Google 캘린더 앱이든, 새 일정을 등록하거나
기존 일정을 수정하는 즉시 동일한 규칙으로 자동 색상이 적용됩니다. 자세한
내용은 설치 후 사이드바의 도움말 카드에서 확인할 수 있습니다.
```

(권장 길이: 약 700-1,000자.)

---

## English (locale `en`, default fallback)

### App display name

```
AutoColor
```

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
background the moment an event is added or updated, and you can manage
rules and review results from the Calendar sidebar.

■ How it works
1. Create a rule — pick a keyword (e.g. "meeting") and a color.
2. Add events as usual — anywhere the keyword appears in the title or
   description.
3. AutoColor handles the rest — as soon as you save the event,
   classification runs in the background and the color is applied right
   away. No manual sync button or scheduled refresh needed.

■ Works the same on desktop and mobile
Whether you create or edit events from the desktop web Calendar or the
Google Calendar mobile app on iOS / Android, the same rules apply.
Classification runs on our server, so events still get colored even if
you never open the sidebar — including when you only use Calendar from
your phone.

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
the sidebar. One Google sign-in (OAuth) and you're set. From then on,
every event you create or edit — from the desktop web Calendar or the
Google Calendar mobile app on iOS / Android — is auto-colored the same
way, the moment you save it. The sidebar has a short tutorial for
first-time users.
```

(Recommended length: ~700-1,000 chars.)

---

## Simplified Chinese (简体中文, locale `zh-CN`)

### App display name

```
AutoColor
```

### Short description (≤ 80 字符)

```
通过关键词规则和 AI 自动为 Google 日历日程上色的 Add-on。
```

(当前长度: 30 字符。)

### Long description

```
AutoColor for Calendar 是一款 Google Workspace Add-on,结合您自定义的
关键词规则与 AI 分析,自动为 Google 日历的日程上色。日程添加或修改的
瞬间,分类即在后台执行;您可以在日历侧边栏管理规则并查看结果。

■ 使用方法
1. 创建规则 — 选择关键词(例如:「会议」)和您喜欢的颜色,定义您自己
   的规则。
2. 添加日程 — 像往常一样在日历中添加日程,标题或描述包含关键词即可。
3. 自动应用颜色 — 保存日程的瞬间,AutoColor 即在后台进行分类并立即
   上色。无需点击同步按钮或等待下一个同步周期。

■ 桌面端与移动端体验一致
无论您是在桌面网页版日历,还是在 iOS / Android 的 Google 日历移动应用
中创建或修改日程,都会应用相同的规则。所有分类都在我们的服务器端处
理,因此即使您不打开侧边栏,或只用手机使用日历,日程也会自动上色。

■ 两阶段分类引擎
- 第 1 阶段(规则):用您注册的关键词匹配日程的标题、描述和地点,匹
  配成功即应用对应颜色。数据不会离开您的日历。
- 第 2 阶段(AI):仅在第 1 阶段没有规则匹配时调用。在数据发送给 AI
  之前,电子邮箱、电话号码等个人信息会被自动遮蔽,参与者、创建者、
  组织者等字段则完全不发送。

■ 隐私保护
- 日程的正文(标题、描述、地点等)不会写入任何日志、仪表板或管理员
  视图。
- Google 颁发的刷新令牌以 AES-256-GCM 加密保存。
- 点击「删除帐号」会在单一事务中删除您的所有数据(规则、令牌、同步
  状态、审计日志),并同时撤销 Google 端的 OAuth 授权和 Watch 通道。
- 只有 AutoColor 自己上过色的日程,才会在下一次同步中被重新评估。
  您手动改过颜色的日程不会被自动分类覆盖。

■ 开始使用
安装后,在 Google 日历的侧边栏中点击 AutoColor 图标即可开始引导。
只需进行一次 Google 帐号授权(OAuth)即可。之后无论您是在桌面网页版
日历,还是在 iOS / Android 的 Google 日历移动应用中创建或修改日程,
保存的瞬间都会以相同的规则自动上色。安装后侧边栏的帮助卡片中有详细
说明。
```

(推荐长度: 约 700-1,000 字符。)

---

## Traditional Chinese (繁體中文, locale `zh-TW`)

### App display name

```
AutoColor
```

### Short description (≤ 80 字元)

```
透過關鍵字規則與 AI 自動為 Google 日曆活動上色的 Add-on。
```

(目前長度: 30 字元。)

### Long description

```
AutoColor for Calendar 是一款 Google Workspace Add-on,結合您自訂的
關鍵字規則與 AI 分析,自動為 Google 日曆的活動上色。活動新增或修改
的瞬間,分類即在背景執行;您可以在日曆側邊欄管理規則並查看結果。

■ 使用方式
1. 建立規則 — 選擇關鍵字(例如:「會議」)和您喜歡的顏色,建立您自
   己的規則。
2. 新增活動 — 像平常一樣在日曆中新增活動,標題或描述包含關鍵字即
   可。
3. 自動套用顏色 — 儲存活動的瞬間,AutoColor 即在背景進行分類並立即
   上色。不需點擊同步按鈕或等待下一個同步週期。

■ 桌機與行動裝置體驗一致
無論您是在桌機網頁版日曆,或是在 iOS / Android 的 Google 日曆行動應
用程式中建立或修改活動,都會套用相同的規則。所有分類都在我們的伺服
器端處理,因此即使您不開啟側邊欄,或只用手機使用日曆,活動也會自動
上色。

■ 兩階段分類引擎
- 第 1 階段(規則):以您註冊的關鍵字比對活動的標題、描述與地點,符
  合即套用對應顏色。資料不會離開您的日曆。
- 第 2 階段(AI):僅在第 1 階段無規則符合時呼叫。資料送出給 AI 前,
  電子郵件、電話號碼等個人資料會自動遮蔽,參與者、建立者、組織者等
  欄位則完全不傳送。

■ 隱私保護
- 活動正文(標題、描述、地點等)不會寫入任何記錄、儀表板或管理員畫
  面。
- Google 核發的更新權杖以 AES-256-GCM 加密儲存。
- 點選「刪除帳號」會在單一交易中刪除您的所有資料(規則、權杖、同步
  狀態、稽核記錄),並同時撤銷 Google 端的 OAuth 授權與 Watch 頻道。
- 只有 AutoColor 自己上過色的活動,才會在下次同步時重新評估。您手動
  改過顏色的活動不會被自動分類覆蓋。

■ 開始使用
安裝後,在 Google 日曆的側邊欄點選 AutoColor 圖示即可開始導覽。
只需進行一次 Google 帳號授權(OAuth)即可。之後無論您是在桌機網頁
版日曆,或是在 iOS / Android 的 Google 日曆行動應用程式中建立或修改
活動,儲存的瞬間都會以相同規則自動上色。安裝後側邊欄的說明卡片有
詳細介紹。
```

(建議長度: 約 700-1,000 字元。)

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
- **다국어 카피 동기화**: `gas/i18n.js`의 4개 번들(en / ko / zh-CN /
  zh-TW)에 새 키를 추가하거나 톤을 바꿀 때, 본 파일의 동일 언어 카피도
  같은 commit에서 갱신해 drift를 방지한다. 특히 `welcome.step3` /
  `home.info`의 "즉시 / 5–10초 / 모바일에서도 동작" 의미는 본 파일의
  Step 3 + "PC와 모바일 모두 동일하게 동작" 단락과 같은 사실을 가리킨다.
- **중국어 간체·번체는 별도 카피**: 동일 한자라도 어휘·표현이 다르므로
  zh-CN ↔ zh-TW를 자동 번환으로 처리하지 않는다. 예: "日程"(zh-CN) /
  "活動"(zh-TW), "桌面"(zh-CN) / "桌機"(zh-TW), "帐号"(zh-CN) /
  "帳號"(zh-TW). 카피 변경 시 양쪽을 함께 검토.

## Cross-references

- [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md)
  — 본 카피가 입력되는 콘솔 절차 (Step 1 → Step 6).
- [`docs/runbooks/06-oauth-verification.md`](../../runbooks/06-oauth-verification.md)
  — 데모 영상 시나리오와 본 카피 narration 정합.
- [`gas/addon.js`](../../../gas/addon.js) (95-115행) — 3단계 온보딩 카드
  카피 source.
- [`gas/i18n.js`](../../../gas/i18n.js) — UI 다국어 번들 (en / ko / zh-CN
  / zh-TW). 본 파일의 4개 언어 카피와 톤·사실 정합 필수.
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

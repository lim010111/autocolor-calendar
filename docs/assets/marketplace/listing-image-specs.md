# Marketplace 리스팅 이미지 — 디자인 명세 (Claude design 프롬프트)

> **이 문서의 용도.** Marketplace 스토어 리스팅에 올릴 홍보 이미지 5장의
> 제작 명세다. 각 장마다 ① 사람이 찍어야 하는 실 스크린샷 목록과 ②
> Claude design 에 그대로 붙여넣을 **영문 프롬프트**가 짝으로 들어 있다.
>
> **왜 생 스크린샷이 아닌가.** 2026-07-30 조사: Zoom·Reclaim.ai·Mailmeteor
> 등 상위 애드온은 예외 없이 브랜드 배경 + 헤드라인 + UI 인셋으로 구성된
> **디자인된 캔버스**를 올린다. 카탈로그에서 1280×800 이 400px 남짓으로
> 축소되기 때문에, 화면 전체를 그대로 올리면 아무것도 읽히지 않는다.
> 반대로 UI 를 회색으로 뭉개는 상위 앱들의 그리킹은 우리에겐 손해다 —
> 우리 제품의 가치가 **색 그 자체**라서 색칠된 격자는 진짜 픽셀로 크게
> 보여야 한다. 그래서 채택안은 **실 캡처 인셋 + 디자인 캔버스**다.
>
> 선행 문서: [`screenshot-guide.md`](./screenshot-guide.md) (촬영 셋업·PII
> 마스킹·거절 사유 — 여전히 유효), [`05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md)
> Step 3 (정본 절차).

---

## 0. 파이프라인

```
① 사람: 실 스크린샷 촬영 (§2 목록, 1회 세션)
      ↓
② Claude design: §1 컨텍스트 블록 + 장별 프롬프트 + 캡처 파일 첨부
      ↓  → 1280×800 self-contained HTML 1개
③ 사람: 브라우저 1280×800 뷰포트에서 PNG 로 export
      ↓
④ docs/assets/marketplace/screenshots/ 에 commit → SDK 콘솔 업로드
```

### 절대 규칙 — UI 는 지어내지 않는다

Claude design 은 **배경·헤드라인·주석·레이아웃만** 만든다. 제품 UI 픽셀은
반드시 첨부한 실 캡처를 그대로 배치한다. 존재하지 않는 버튼·수치·화면을
그리게 두면 안 된다. 이유는 두 가지고 둘 다 무겁다:

- Google 검수 기준이 *"Screenshots and images... accurately represent the
  app"* 이다. 목업이 실물과 다르면 거절 사유가 된다.
- 우리가 아직 안 만든 기능을 광고하게 된다.

각 프롬프트 끝에 이 제약이 영문으로 박혀 있으니 지우지 말 것.

---

## 1. 컨텍스트 블록 (세션 시작 시 1회 붙여넣기)

```
# Project context — AutoColor for Google Calendar

## What the product is
A Google Workspace Marketplace add-on that colors Google Calendar events
automatically. The user defines a rule once (a name, a color, optionally a
few example phrases); from then on every event that fits that rule gets
that color — without the user touching anything.

Under the hood: a Cloudflare Workers backend watches the calendar and runs
a two-stage classifier (embedding k-NN, then an LLM for the leftovers).
The add-on sidebar is UI only. Rules are stored as native Google Calendar
labels, so renaming or recoloring a label in Google flows straight back
into the rules.

## Who the images are for
People browsing the Google Workspace Marketplace who have a messy,
single-color calendar and don't know this category of tool exists. The
images must, in about three seconds, make them think "wait — my calendar
could look like that?" Not feature enumeration. Desire, then proof.

## What makes it different from the alternatives
1. Fully automatic and retroactive. No button to press per event; new
   events get colored in 5-10 seconds, including events created on the
   mobile Google Calendar app, and one action recolors the existing
   calendar from 30 days back to 365 days ahead.
2. It matches meaning, not literal keywords. Competing tools do
   "title contains X". Ours embeds the rule and the event and compares
   meaning, so one rule covers many phrasings.
3. Rules ARE Google Calendar labels — not a private color scheme locked
   inside the add-on.
4. The user always wins. Colors set by hand are never overwritten, any
   event can be excluded, and a manual correction can be remembered.

## Brand
Palette (from the app icon):
  indigo gradient  #6c82ff -> #7895ff   (primary background)
  deep slate       #262b38 / #4b5366    (text on light)
  off-white        #f7f9ff -> #eef3f9   (card surfaces)
  accents          #ff5579 coral, #ffc42f amber, #55cd89 green
Tone: calm, precise, a little delightful. Not playful, not enterprise-grey.

## Output contract (every image)
- One self-contained HTML file. Inline CSS. No external fonts, scripts,
  or network requests. No JavaScript needed.
- The page body renders exactly 1280x800 CSS pixels, full-bleed, square
  corners, no page margin, no scrollbars. I will screenshot it at
  1280x800 and upload the PNG.
- Font stack: system sans (-apple-system, "Segoe UI", Roboto, sans-serif).
- All copy in English.
- Every one of the five images shares the same background treatment and
  the same headline position, so the carousel reads as one set.
- The image will be viewed at roughly one-third scale in a catalog grid.
  Headline must survive that; body-level UI text does not have to.

## Hard constraints
- Product UI pixels come only from the screenshot files I attach. Never
  draw, redraw, mock, or "clean up" the app's interface, and never invent
  numbers, buttons, or states that aren't in the attached capture.
- Google trademark: write "Google Calendar" (not "GCal"), never imply
  Google endorses or built this, never use Google's logo or wordmark as
  our own brand element.
- No fake testimonials, no invented install counts, no star ratings.
- No user PII: the captures are from a seeded test account, but if you
  spot an email address or avatar in one, cover it with a solid chip.
```

---

## 2. 사람이 찍어야 하는 캡처

한 세션에 몰아 찍는다. 셋업(테스트 계정·시드 데이터·브라우저 정리·PII
마스킹)은 [`screenshot-guide.md`](./screenshot-guide.md) "사전 셋업" 을
그대로 따르되, **카테고리는 현행 규칙 생성 플로우**(이름 + 24색 스와치 +
키워드)로 만든다 — 그 문서의 11색 팔레트 서술은 native-labels #03 이전
것이다.

시드 규칙은 **5개, 색이 서로 충분히 먼 것**으로:

| 규칙 이름 | 색 | 왜 |
|---|---|---|
| Team meetings | `#039be5` (파랑) | 가장 많이 매칭될 규칙 |
| Deep work | `#8e24aa` (보라) | #3 장면의 주인공 |
| 1:1s | `#33b679` (초록) | 소수 매칭 |
| Personal | `#f6bf26` (노랑) | 업무 외 대비 |
| Interviews | `#ff5579`계열 `#d81b60` | **미실측 1색** — 이 자리에서 육안 확인 |

| # | 파일명 | 무엇을 | 촬영 지시 |
|---|---|---|---|
| 1 | `cap-week-before.png` | 규칙 적용 **전** 주간 뷰 | 시드 이벤트 10건이 전부 기본색인 상태. 사이드바 닫고 격자만. 1280×800 이상 |
| 2 | `cap-week-after.png` | 규칙 적용 **후** 같은 주 | "Apply rules to all events" 실행 후 **동일 주·동일 스크롤 위치**에서 재촬영. 프레임이 1px도 안 움직여야 before/after 가 성립한다 |
| 3 | `cap-event-create.png` | 이벤트 생성 중 | 제목만 입력한 상태의 생성 다이얼로그(색 지정 안 함). 예: `Sprint planning` |
| 4 | `cap-event-colored.png` | 그 이벤트가 칠해진 뒤 | 5–10초 후 격자에서 해당 이벤트만 타이트 크롭 |
| 5 | `cap-rules-list.png` | 애드온 규칙 목록 | "Manage color rules" → `My rules` 5행 + 라벨 칩이 보이게. 사이드바만 크롭 |
| 6 | `cap-rule-create.png` | 규칙 생성 화면 | 같은 카드 상단 — 이름 입력 + 24색 스와치 그리드 + Keywords 필드 |
| 7 | `cap-google-picker.png` | **Google 자체** 색 선택창 | 캘린더 새로고침 후, 이벤트 우클릭 또는 편집 화면의 색 목록. 우리가 만든 5개 라벨 이름이 Google UI 안에 떠 있는 장면 — 이게 #4 장면의 증거다 |
| 8 | `cap-event-sidebar.png` | 애드온 이벤트 카드 | 칠해진 이벤트 열고 사이드바. `Event color analysis` / 적용 라벨 / 라벨 피커 / exclude 버튼이 한 화면에 |
| 9 | `cap-mobile.jpg` *(선택)* | 모바일 캘린더 | 폰에서 Google Calendar 앱, 색칠된 주간/일간 뷰. 없으면 #2 장면에서 폰 요소를 빼고 문구만 유지 |

> 캡처는 **크게** 찍는다. 축소는 되지만 확대는 안 된다. 사이드바만 필요한
> 컷도 브라우저를 넓게 열고 찍은 뒤 크롭할 것.

---

## 3. 장별 명세

배치 규칙은 5장 공통이다 (프롬프트마다 반복해 넣었다):

```
canvas   1280 x 800
margin   64px 좌우
headline block   y 88 ~ 250   (헤드라인 최대 2줄 + 서브헤드 1줄)
stage            y 280 ~ 736  (인셋 카드 영역)
배경     #6c82ff → #7895ff 대각 그라데이션 + 아주 옅은 노이즈/광원
카드     흰색, radius 20, shadow 0 24px 60px rgba(20,24,40,.28)
헤드라인 56px / 700 / line-height 1.12 / #ffffff
서브헤드 24px / 400 / rgba(255,255,255,.82) / 최대 92자
주석칩   18px / 600 / 흰 배경 pill 또는 accent 색 pill
```

---

### 01 — Before → After (썸네일이 되는 장)

**답하는 질문:** "이게 뭐 하는 앱인데?" — 캐러셀 첫 장이자 카탈로그 카드
썸네일이라, 이 한 장이 클릭률을 정한다.

**필요 캡처:** `cap-week-before.png`, `cap-week-after.png`

```
Build listing image 01 of 5: the hook.

Canvas: 1280x800, background = diagonal gradient #6c82ff -> #7895ff with a
faint radial light source at top-center. 64px side margins.

Headline block (y 88-250), centered:
  H1  "Your calendar colors itself."
  Sub "Set a rule once. Every event that fits gets its color —
       automatically, forever."
  H1: 56px/700/1.12, white. Sub: 24px/400, rgba(255,255,255,.82).

Stage (y 280-736): two white cards side by side, equal width, 40px gap,
radius 20, shadow 0 24px 60px rgba(20,24,40,.28). Each card holds one
attached screenshot, cropped to fill, top-aligned:
  LEFT  = cap-week-before.png
  RIGHT = cap-week-after.png
Above each card, a small pill label: "Before" (white pill, #4b5366 text)
and "After" (#55cd89 pill, white text).

Between the two cards, vertically centered on the stage, a circular white
badge 72px with a right-pointing chevron in #6c82ff. It must overlap both
card edges slightly so the eye reads left-to-right as one motion.

The two screenshots are the same calendar week, so the reader should be
able to compare them event by event. Do not crop them differently from
each other — identical crop rectangle on both.

Nothing else on the canvas. No feature bullets, no logo lockup, no
decorative calendar illustrations.

Constraint: the two card contents are the attached PNGs, placed as
images. Do not redraw, recolor, or stylize the calendar inside them.
```

**검수 체크:** before/after 프레임이 어긋나면 "조작"으로 읽힌다. 크롭
직사각형을 두 장에 동일하게 적용할 것.

---

### 02 — 자동이라는 것 (손이 안 간다)

**답하는 질문:** "이벤트마다 내가 눌러야 하나?"

**필요 캡처:** `cap-event-create.png`, `cap-event-colored.png`,
`cap-mobile.jpg`(선택)

```
Build listing image 02 of 5: automatic, hands-off.

Canvas + background + margins: identical to image 01 (same gradient, same
64px margins, same headline position) — these five images must read as one
set.

Headline block (y 88-250), centered:
  H1  "You add the event. The color just appears."
  Sub "It runs on our servers, not in your browser — so it works with the
       sidebar closed, and on the mobile app too."

Stage (y 280-736): a three-beat sequence, left to right, on one baseline.
  Beat 1 (x 64-500):  white card, radius 20, holding cap-event-create.png
                      Caption pill below the card: "You type a title"
  Beat 2 (x 540-740): no card — a vertical connector zone. Centered: a
                      pill in #ffc42f with dark text reading "5-10 sec",
                      with a thin dashed arrow in rgba(255,255,255,.7)
                      running through it from beat 1 to beat 3.
  Beat 3 (x 780-1216): white card, radius 20, holding
                      cap-event-colored.png
                      Caption pill below: "AutoColor colors it"
Caption pills: 18px/600, white background, #262b38 text.

If cap-mobile.jpg is attached, place it as a small phone-proportioned card
(about 150x300) overlapping the bottom-right corner of beat 3, rotated
about -4 degrees, with its own shadow. If it is not attached, omit it
entirely and do not substitute a drawn phone.

Constraint: card contents are the attached PNGs placed as images. Do not
draw a fake calendar UI, a fake cursor, or a fake mobile screen.
```

**검수 체크:** "5-10 sec" 은 제품 문구(`home.info`)에 있는 실제 값이다.
바꾸지 말 것.

---

### 03 — 의미로 매칭한다 (핵심 차별점)

**답하는 질문:** "키워드를 내가 다 등록해야 하나?" — 경쟁 애드온
(Caldense 등)이 `Title contains "interview"` 로 동작하는 지점이라, 이
장이 우리를 다른 카테고리에 놓는다.

**필요 캡처:** `cap-rule-create.png`, `cap-week-after.png`

```
Build listing image 03 of 5: semantic matching.

Canvas + background + margins: identical to images 01-02.

Headline block (y 88-250), centered:
  H1  "It matches what the event means."
  Sub "Not a keyword list. One rule catches \"Sprint planning\",
       \"Standup\", and \"Design review sync\" on its own."

Stage (y 280-736): asymmetric two-column.
  LEFT column (x 64-540): a white card, radius 20, holding
  cap-rule-create.png — this is the single rule the user defined.
  Under it a caption pill: "One rule"

  RIGHT column (x 600-1216): four stacked "event chips" — small rounded
  rectangles that look like calendar events, each 100% width of the
  column, 76px tall, 16px apart, each filled with the SAME color
  (#8e24aa) at full opacity with white text inside:
      "Sprint planning        Mon 10:00"
      "Standup                Tue 09:30"
      "Design review sync     Wed 14:00"
      "Retro + planning       Fri 16:00"
  These four chips are the one element you may draw rather than
  screenshot — they are generic calendar events, not app UI. Match Google
  Calendar's event-chip proportions: 4px left radius, 13px semibold title,
  12px regular time, 8px inner padding.

  From the left card, draw four thin curved connectors (2px,
  rgba(255,255,255,.55)) fanning out to the left edge of each chip.

Bottom-right of the stage, a small pill in rgba(255,255,255,.16) with
white text: "No keyword list to maintain."

Constraint: the left card content is the attached PNG. Do not invent
extra rule fields, sliders, confidence scores, or an "AI" badge that
isn't in the capture.
```

**촬영 주의:** 이 장을 찍기 전에 **네 이벤트가 실제로 같은 색으로
분류되는지 확인**해야 한다. 확인 없이 그리면 광고가 거짓이 된다. 확인
방법: 네 이벤트를 캘린더에 넣고 sync 1회 → `cap-week-after.png` 에서 네
건이 모두 Deep work 색인지 육안 확인. 하나라도 어긋나면 그 문구를 실제
분류된 제목으로 교체할 것.

---

### 04 — Google 라벨 그 자체

**답하는 질문:** "이 앱 안에서만 쓰는 색인가? 캘린더에 진짜 남나?"

**필요 캡처:** `cap-google-picker.png`, `cap-rules-list.png`

```
Build listing image 04 of 5: native Google Calendar labels.

Canvas + background + margins: identical to images 01-03.

Headline block (y 88-250), centered:
  H1  "Your rules are Google Calendar labels."
  Sub "Rename or recolor a label in Google and the rule follows. Nothing
       is locked inside the add-on."

Stage (y 280-736): two white cards, radius 20, of unequal width, with a
tie between them.
  LEFT  (x 64-640):   cap-google-picker.png
                      caption pill: "In Google Calendar"
  RIGHT (x 700-1216): cap-rules-list.png
                      caption pill: "In AutoColor"

Between the cards, centered vertically, a horizontal double-headed arrow
(2px, white, arrowheads both ends) with a small white pill on it reading
"same labels" in 16px/600 #4b5366.

Cards are top-aligned; if the two captures have different heights, pad the
shorter card rather than stretching its image.

Constraint: both card contents are attached PNGs. Do not draw Google's
color picker from memory, and do not place a Google logo anywhere on the
canvas.
```

**검수 체크:** Google UI 를 우리 것처럼 보이게 배치하면 브랜드 가이드
위반이다. 좌측 카드에는 반드시 "In Google Calendar" 캡션을 남긴다.

---

### 05 — 통제권은 사용자에게

**답하는 질문:** "설치하면 내 캘린더를 마음대로 칠하는 거 아냐?" — 설치
직전 마지막 망설임을 없애는 장. 캐러셀 마지막에 둔다.

**필요 캡처:** `cap-event-sidebar.png`

```
Build listing image 05 of 5: you stay in control.

Canvas + background + margins: identical to images 01-04.

Headline block (y 88-250), centered:
  H1  "You always get the last word."
  Sub "Colors you set by hand are never overwritten, and you can exclude
       any single event from auto-coloring."

Stage (y 280-736): one white card, radius 20, centered horizontally,
about 520px wide, holding cap-event-sidebar.png at a comfortable scale —
this capture is a narrow sidebar, so it should be the tallest element on
the canvas rather than being stretched wide.

To the left and right of the card, three annotation pills stacked
vertically in the empty gutters, each connected to the relevant part of
the card by a short 2px white leader line. Pills: white background,
#262b38 text, 18px/600.
  "Manual colors are preserved"
  "Exclude a single event"
  "Corrections are remembered"
Place each pill's leader line so it points at the corresponding control in
the capture; if a control isn't visible in the capture, drop that pill
rather than pointing at nothing.

Constraint: the card content is the attached PNG. Do not add checkmarks,
badges, or UI affordances on top of the screenshot.
```

**검수 체크:** "Corrections are remembered" 는 예시 저장 동의(§12) 를
켠 사용자에게만 해당한다. 동의 UI 가 캡처에 없다면 이 pill 은 빼는 쪽이
안전하다 — 프롬프트에 그 규칙을 넣어뒀다. 같은 이유로 Sub 카피에도 이
주장을 넣지 않는다 — 저장 개시(2026-08-28) 전에는 누구에게도 참이 아니라,
헤드라인에 박으면 조건부로 뺄 수도 없는 거짓 광고가 된다.

---

### (선택) 06 — 4개 언어

리스팅을 영어 1벌로 가는 지금은 **불필요**하다. 나중에 로케일별 리스팅을
낼 때, 규칙 편집기를 en/ko/zh-CN/zh-TW 로 각 1장 찍어 2×2 그리드에
얹으면 된다. 헤드라인 안: `"Works in your language."` / 서브:
`"English, 한국어, 简体中文, 繁體中文."`

---

## 4. 산출물

```
docs/assets/marketplace/screenshots/
├── 01-hook-before-after.png     # 1280×800
├── 02-automatic.png             # 1280×800
├── 03-semantic-matching.png     # 1280×800
├── 04-native-labels.png         # 1280×800
└── 05-you-control.png           # 1280×800
```

기존 `01-welcome.png` ~ `04-event-preview.png` 는 2026-05-09 촬영분이고
UI 가 두 번 바뀌어 무효다 — 새 5장으로 **교체**하고, SDK 콘솔에 올라간
낡은 자료도 같이 갈아끼운다.

**업로드 전 최종 확인:**

- [ ] 5장 모두 정확히 1280×800 PNG, 라운드 코너·여백 없음
- [ ] 캐러셀에서 5장이 한 세트로 보인다 (배경·헤드라인 위치 동일)
- [ ] dev URL(`*.workers.dev`) 노출 0 — prod 에서만 촬영
- [ ] 실 사용자 PII 0 (이메일·아바타·타인 캘린더 이름)
- [ ] 캡처에 없는 UI 를 그려 넣은 곳 0
- [ ] 03 의 네 이벤트가 **실제로** 같은 규칙으로 분류됨을 확인
- [ ] `#d81b60` 스와치 육안 확인 (미실측 1색 — `scripts/gen-swatch-assets.py` TODO 해제)

## Cross-references

- [`screenshot-guide.md`](./screenshot-guide.md) — 촬영 셋업·PII 마스킹·자주 거절되는 결함
- [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md) Step 3 — 정본 절차
- [`docs/runbooks/00-user-action-checklist.md`](../../runbooks/00-user-action-checklist.md) ④ — 사람 작업 체크리스트
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) §1 row 77 — 완료 시 status 갱신 대상
- [`gas/i18n.js`](../../../gas/i18n.js) — 인용한 제품 문구의 정본 (`home.info`, `rules.manageInGoogle` 등)

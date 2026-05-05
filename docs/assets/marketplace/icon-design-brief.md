# 아이콘 디자인 브리프 — AutoColor for Calendar

> 본 문서는 [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md)
> Step 2 "App icon" 요구사항을 외주 디자이너에게 그대로 의뢰할 수 있도록
> 정리한 작업 브리프다. 1024×1024 마스터 + 파생 사이즈(128 / 32)와 컬러 /
> 모노크롬 / 라이트·다크 variant 일습이 deliverable. 본문 끝의 "체크리스트"
> 를 함께 첨부하면 검수 round를 줄일 수 있다.
>
> Owner: Product (브리프 발주) + Design (외주). 회신 typical 1-2주.
> 자체 제작 시 Figma 등에서 2-3시간 작업.

## 1. 의뢰 요약 (One-pager)

| 항목 | 내용 |
|---|---|
| **앱 이름** | AutoColor for Calendar |
| **앱 한 줄 설명** | "Google Calendar 일정에 키워드 규칙 또는 AI로 색상을 자동 적용하는 Workspace Add-on." |
| **사용 surface** | (1) Google Workspace Marketplace listing (≥128px) (2) Google Calendar 사이드바 add-on (32px) (3) GCP OAuth Consent Screen logo (≥120px 권장, 최대 1024px) (4) Privacy / ToS 페이지 favicon (선택) |
| **deliverable** | 1024×1024 PNG 마스터 1장 + 128×128 / 32×32 / favicon (16×16, 선택) PNG + Figma source (선택) |
| **희망 회신 기한** | 발주일 +14일 |
| **검토 round** | redline 1회 + final 1회 권장 |
| **참고 자료** | Google Workspace Marketplace Brand Guidelines (스타일 명) / Material Design Icon Guidelines (스타일 명, 외부 URL 본 문서 인라인 금지 — `docs/runbooks/README.md` "글로벌 컨벤션" 준수) |

---

## 2. 디자인 요구사항

### 2.1 사이즈 일습

| 사이즈 | 용도 | 형식 | 배경 |
|---|---|---|---|
| 1024×1024 | 마스터 / OAuth Consent Screen | PNG (lossless) | 투명 또는 단색 |
| 480×480 | OAuth Consent Screen alt | PNG | 위와 동일 |
| 128×128 | Marketplace listing primary | PNG | 위와 동일 |
| 32×32 | GAS Add-on 사이드바 favicon | PNG | 위와 동일 |
| 16×16 (선택) | favicon (Privacy / ToS 페이지) | PNG | 위와 동일 |

> **다중 사이즈 일관성 필수**: 32×32 축소 시 시인성을 위해 디테일을
> 단순화해야 함. 1024 마스터에서 자동 축소만 하면 32에서 라인 깨짐
> 가능 — 32 전용 simplified variant 권장.

### 2.2 스타일

- **모서리 둥근 사각형** (Material Design / Workspace Add-on 표준). 현재
  `gas/appsscript.json:17`의 `gstatic palette_black_48dp` placeholder가
  정확히 이 스타일 — Marketplace 내 다른 add-on과 조화.
- **단순함**: 32px에서 식별 가능한 silhouette. 디테일 과다는 favicon에서
  blob으로 보임.
- **Google Workspace 톤**: 화려한 그라데이션 / 3D rendering 회피.
  flat 또는 subtle gradient 권장.
- **Material 컬러 팔레트와 조화**: Calendar의 brand blue (`#1A73E8`),
  Material color samples (Sage / Tangerine / Lavender 등 우리가 시드
  카테고리로 쓰는 색)과 충돌하지 않을 것.

### 2.3 컨셉 방향성 (택1 또는 조합)

다음 중 1개 또는 조합으로 시각화:

1. **컬러 팔레트** — 화가의 팔레트 또는 페인트 스플랫. "Color"의 직접
   환기. 가장 직관적이지만 디자인 surface가 흔함.
2. **컬러휠 + 캘린더 그리드** — 동그란 컬러휠을 캘린더 grid 위에 겹친
   composition. "AutoColor for Calendar"의 두 단어를 동시에 환기.
3. **자동화 환기** — magic wand / sparkle / 자동 페인팅 효과. "Auto-"
   접두사를 명시적으로 시각화.
4. **단순 캘린더 + 컬러 dot** — 작은 캘린더 도형 + 4-5개 컬러 dot이
   row로 배치. 가장 단정하고 32px에서도 식별 가능.

권장: **2 또는 4**. 1은 너무 흔하고 3은 "AI 마케팅 클리셰" 우려.

### 2.4 컬러 variant 일습

| variant | 용도 |
|---|---|
| **컬러 (default)** | 모든 surface |
| **모노크롬 — 진한 회색** | 라이트 모드 메뉴 토글 / 텍스트 inline |
| **모노크롬 — 흰색** | 다크 모드 / 컬러 배경 위 |

OAuth Consent Screen은 컬러 variant만 받으나, GAS Add-on은 향후 다크
모드 surface에 배치될 수 있음 — 모노크롬 2종 함께 deliverable 요청
권장.

### 2.5 Negative space / safe area

- 1024 마스터의 시각 요소는 중앙 96% (양쪽 상하좌우 2% 이상 padding).
  Marketplace의 일부 surface가 둥근 mask로 crop하므로 모서리에 시각
  요소 배치 회피.
- 텍스트 (앱 이름) 포함 금지 — 32px에서 가독성 손상.

---

## 3. 컬러 가이드

### 3.1 Brand color (확정 시)

현재 brand color 확정값 없음 — 본 브리프 발주 시 디자이너 제안 받기.
참고 후보:

- Calendar blue (`#1A73E8`) — Google 일관성, 단 다른 Calendar add-on과
  구별 어려움.
- Tangerine / Sage 등 시드 카테고리 색 — 시드 데이터 색상과 일관 시각화,
  단 일관 brand identity 부재.
- Custom palette (예: `#7C4DFF` 보라 + accent) — 차별화, 단 bias 위험.

권장: 디자이너가 시안 단계에서 3개 후보 제시 → 발주자 측 채택 → final.

### 3.2 다크 / 라이트 모드 호환성

1024 마스터의 단색 배경이 흰색 또는 옅은 색이면 다크 모드 surface에서
"흰 박스"로 보임. 권장:

- **투명 배경** + 시각 요소만. 모든 surface가 자체 배경 위 합성.
- 단점: Marketplace listing의 일부 surface가 흰 배경이라 흰색 요소
  invisible. 이 경우 옅은 outline 또는 subtle drop shadow 추가.

---

## 4. Deliverable 패키지

### 4.1 필수 파일 (5종)

```
docs/assets/marketplace/icons/
├── icon-1024.png       # 마스터 (OAuth Consent Screen용)
├── icon-128.png        # Marketplace listing primary
├── icon-32.png         # GAS Add-on 사이드바
├── icon-mono-dark.png  # 1024px 모노크롬 (다크 surface 위 흰)
└── icon-mono-light.png # 1024px 모노크롬 (라이트 surface 위 진한 회색)
```

### 4.2 선택 파일

- `icon-source.fig` — Figma source (라이센스 양도 시).
- `icon-source.svg` — 벡터 source (변형 자유도).
- `icon-16.png` — favicon용.
- `icon-480.png` — OAuth Consent Screen alt 사이즈.

### 4.3 라이센스

- 디자인 결과물의 IP 양도 또는 영구 사용 라이센스. Workspace Marketplace
  publish 후 임의 사용 가능해야 함.
- 디자이너가 다른 클라이언트에게 동일 디자인 재판매 금지 조항 필요.

---

## 5. 사용 컨텍스트 (디자이너가 보고 작업할 surface)

### 5.1 Workspace Marketplace listing

Marketplace 검색 결과 page에서:
- 카드 형태로 노출 — 좌측 상단에 128×128 아이콘 + 우측에 앱 이름 + short
  description.
- listing 상세 page에서는 더 큰 사이즈로 노출 (≥256px 영역).

다른 Calendar / Productivity 카테고리 add-on의 평균 디자인 quality:
대체로 단정한 flat 또는 단순 gradient. 우리 디자인이 너무 복잡하면
"clutter"로 보임.

### 5.2 Google Calendar 사이드바

Calendar 사이드바 우측의 add-on 아이콘 row:
- 32px 크기로 9-10개 아이콘이 column 정렬.
- Google 기본 add-on (Tasks / Keep) 아이콘과 동일 row에 배치.
- 사용자가 "AutoColor"임을 32px에서 즉시 식별 가능해야 함.

### 5.3 OAuth Consent Screen

Google OAuth 동의 화면 상단:
- ≥120px 영역에 아이콘 노출 + 앱 이름 + 권한 목록.
- "AutoColor wants to access your Google Account" 문구와 시각적 일관성
  필요.
- Material Design 위반 시 검수 거절 사유 — "App logo doesn't match
  Material Design guidelines" ([06 runbook](../../runbooks/06-oauth-verification.md)
  Step 4 자주 거절 사유).

---

## 6. 발주 시 제공 자료

디자이너에게 첨부:

| 자료 | 용도 |
|---|---|
| 본 브리프 (`docs/assets/marketplace/icon-design-brief.md`) | 요구사항 정본 |
| [`docs/assets/marketplace/description.md`](./description.md) | 앱 정체성 / tone |
| [`docs/add-on-ui-plan.md`](../../add-on-ui-plan.md) | UI 컨텍스트 (5개 화면 카피) |
| [`gas/appsscript.json`](../../../gas/appsscript.json) | 현재 placeholder URL |
| (선택) 경쟁/유사 add-on 아이콘 5-10개 스크린샷 | 디자인 surface 컨벤션 reference |

---

## 7. 검수 체크리스트

디자이너가 회신 시 발주자가 확인:

- [ ] **사이즈 일습**: 1024 / 128 / 32 / mono-dark / mono-light 5종 PNG 모두 도착
- [ ] **사이즈별 시인성**: 32px에서 silhouette 식별 가능 (눈을 가늘게 떠도 무엇인지 알아볼 수 있음)
- [ ] **스타일**: 모서리 둥근 사각형 / Material Design 톤 / 텍스트 미포함
- [ ] **컬러 일관성**: 1024 / 128 / 32에서 컬러가 깨지지 않음 (sub-pixel rendering 확인)
- [ ] **다크 / 라이트 호환**: 흰색 배경과 검은 배경 위에 각각 합성해 invisible / clipping 없음
- [ ] **OAuth Consent Screen 시뮬**: 1024 마스터를 GCP Console preview에 업로드해 실 surface 시각 확인 ([06 runbook](../../runbooks/06-oauth-verification.md) Step 3 "App logo" 시점에)
- [ ] **GAS 사이드바 시뮬**: 32px을 Google Calendar 사이드바 prototype (Figma 또는 직접 GAS 배포 후) 위에 합성해 row 정렬 시 인접 아이콘과 조화
- [ ] **Marketplace listing 시뮬**: 128px을 Workspace Marketplace 검색 결과 mockup 위에 합성해 다른 listing과 조화
- [ ] **PII / 상표 위반**: Google logo / Calendar 공식 마크의 직접 인용 없음 (Marketplace 정책 위반)
- [ ] **라이센스 확정**: IP 양도 또는 영구 사용 라이센스 합의서 수령

---

## 8. 회신 후 운영자 측 작업

1. PNG 5종을 `docs/assets/marketplace/icons/`에 commit (별도 PR).
2. [`docs/runbooks/04-legal-hosting.md`](../../runbooks/04-legal-hosting.md)
   Step 3의 Cloudflare Pages 빌드 결과물에 `icon-128.png` / `icon-32.png`
   포함되도록 빌드 스크립트 업데이트.
3. [`gas/appsscript.json:17`](../../../gas/appsscript.json) `logoUrl`을
   `https://autocolorcal.app/icon-128.png`으로 교체. GAS 새 version 배포
   ([`src/CLAUDE.md`](../../../src/CLAUDE.md) "GAS deployment URL must
   stay stable" 준수 — 기존 deployment의 New version만, 신규 deployment
   금지).
4. [`docs/marketplace-readiness.md`](../marketplace-readiness.md) §1 row
   74 (App icon) status `미작성` → `완료`.
5. 디자이너에게 final 결과물 publish 권한 (포트폴리오 공개 가능 여부)
   확인.

---

## Cross-references

- [`docs/runbooks/05-marketplace-listing-assets.md`](../../runbooks/05-marketplace-listing-assets.md) Step 2 — 본 문서의 정본 절차
- [`docs/runbooks/04-legal-hosting.md`](../../runbooks/04-legal-hosting.md) Step 3 — 아이콘 자체 호스팅 빌드 결과물
- [`docs/runbooks/06-oauth-verification.md`](../../runbooks/06-oauth-verification.md) Step 3 — OAuth Consent Screen logo 입력
- [`gas/appsscript.json`](../../../gas/appsscript.json) — manifest 갱신 대상
- [`src/CLAUDE.md`](../../../src/CLAUDE.md) "GAS deployment URL must stay stable" — manifest 변경 시 배포 절차
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) §1 row 74 — 갱신 대상 status

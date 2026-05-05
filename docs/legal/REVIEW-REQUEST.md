# 법률 자문 검토 의뢰서 — AutoColor for Calendar (Privacy / ToS 초안)

> 본 문서는 [`docs/legal/privacy-policy.md`](./privacy-policy.md)과
> [`docs/legal/terms-of-service.md`](./terms-of-service.md) 1차 초안을
> 외부 법률 자문에게 검토 의뢰할 때 그대로 첨부 / 송부할 수 있도록
> 정리한 패키지다. [`docs/runbooks/04-legal-hosting.md`](../runbooks/04-legal-hosting.md)
> Step 1 "법무 검토 의뢰"의 정본 산출물이며, 자문 회신 후 본문 반영 →
> publish → `marketplace-readiness.md` §2 row 121-122 status 갱신으로
> 이어진다.
>
> 회신 typical 리드타임은 1-2주. 의뢰 직후 외주 발주가 critical path
> ([G6 OAuth 검수 4-6주](../runbooks/06-oauth-verification.md)와 병렬
> 진행 가능)임을 의식해 가능한 한 일찍 의뢰 권장.

## 의뢰 요약 (One-pager)

| 항목 | 내용 |
|---|---|
| **의뢰자** | AutoColor for Calendar 운영자 (개인 사업자 / 법인 — TBD) |
| **검토 대상** | (1) 개인정보처리방침 초안 1건 (262줄, 한국어) (2) 서비스 이용약관 초안 1건 (221줄, 한국어) |
| **검토 적용 법** | 한국 개인정보보호법 / 정보통신망법 / 약관규제법 (1차) + GDPR / CCPA (2차, 글로벌 노출 시) |
| **희망 회신 형태** | (a) 본문 직접 redline + (b) 의견서 1건 (수정 사유 / 잔존 리스크 / publish 가능 여부 의견) |
| **희망 회신 기한** | 의뢰일 +14일 |
| **publish 채널** | Cloudflare Pages 정적 호스팅 (`autocolorcal.app/privacy` / `/terms`). 본문 수정만 필요, 외부 시스템 통합 불요 |
| **참고 산출물** | 본 의뢰서 §3 "서비스 사실 요약" — 자문이 코드를 직접 읽지 않아도 되도록 정리 |

---

## 1. 검토 의뢰 범위

### 1.1 In scope

- 한국 개인정보보호법 / 정보통신망법 동의 양식 / 처리 항목 / 처리 목적 /
  보유 기간 / 위탁 / 국외 이전 동의 양식 충족 여부.
- 약관규제법 위반 표현 점검 (소비자에게 부당하게 불리한 조항 식별).
- GDPR (EU) — DPO 지정 / DPIA 수행 / 적정성 결정 의무 여부 + 적정성 미충족
  시 SCC 권고.
- CCPA (캘리포니아) — 소비자 권리 (열람 / 삭제 / opt-out) 본문 충족 여부.
- 미성년자 정책 — 한국 14세 / COPPA 13세 / GDPR-K 16세 적용 line 검수.
- 분쟁 해결 / 관할법 / 면책 조항 / 책임 제한 표현의 법적 효력.
- 외부 vendor (Google / Cloudflare / Supabase / OpenAI) 의존성에 대한
  종속 리스크 면책 표현 적합성.

### 1.2 Out of scope

- 코드 보안 감사 (Google CASA security assessment과 무관).
- 영문 번역 — 자문 회신 기반 본문 한국어 final fix 후 별도 진행.
- 상표 / 도메인 / 회사명 등록 — 별도 의뢰.
- 서비스 자체의 사업적 적법성 (Google Workspace Marketplace 정책 / 약관
  검토는 본 의뢰의 부수 항목만).

---

## 2. 자문 회신 시 우선 확인 항목 (체크리스트)

자문이 본문을 검토하면서 항목별 결론을 회신해 주십사 부탁드리는 점검표.
[`docs/legal/privacy-policy.md`](./privacy-policy.md) 마지막 H3 "자문 검토 시 우선 확인 항목" 섹션 + [`docs/legal/terms-of-service.md`](./terms-of-service.md) 동일 섹션을 통합 정리.

### 2.1 개인정보처리방침

- [ ] **적용 법 매트릭스** — 한국 사용자 한정 vs 글로벌 노출. 본 서비스는
      Google Workspace Marketplace (글로벌)이므로 글로벌 노출 가정 권고.
- [ ] **DPO 지정 의무** — GDPR Art. 37 기준. calendar metadata 처리량 +
      OAuth identifier 저장 패턴이 "regular and systematic monitoring" /
      "large scale" 기준에 해당하는지.
- [ ] **DPIA 수행 의무** — calendar 메타데이터의 in-transit 처리 + LLM
      위탁이 high-risk processing에 해당하는지.
- [ ] **CPO (개인정보 보호책임자) 지정** — 한국법상 의무 / 권고 line.
- [ ] **미성년자 정책 본문** — 한국 14세 / COPPA 13세 / GDPR-K 16세 중
      어느 line을 publish 본문에 명시할지.
- [ ] **국외 이전 동의** — 한국 → 미국 (Cloudflare 본사) / 한국 → EU
      (Supabase region 선택 시) / 한국 → 미국 (OpenAI). 적정성 결정 미충족
      시 SCC 또는 본인 동의 명시 절차.
- [ ] **사용자 권리 행사 채널** — CPO 지정 / 분쟁조정위원회 안내 / EU DPO
      연락처 (해당 시) 본문 명시.
- [ ] **데이터 보유 기간 법적 충족성** — 세션 7일 / token revoke까지 /
      counters 무기한이 한국법 권고 보유 기간과 정합한지.
- [ ] **본문 표현의 법적 효력** — "best-effort" / "silent skip" 등 엔지
      니어링 용어가 한국 법률 문서로 부적합한 지점.
- [ ] **위탁 동의** — 사용자가 sub-processor 4사 (Google / Cloudflare /
      Supabase / OpenAI)에 대한 위탁 동의를 OAuth 시점에 명시적으로 받는
      양식이 정합한지.

### 2.2 서비스 이용약관

- [ ] **관할법 / 준거법** — 한국법 single 또는 한국법 + 영문본 분리 정책.
- [ ] **분쟁 해결 절차** — 중재 / 소송 / 관할법원 / class-action waiver
      적용 여부.
- [ ] **면책 조항 / 책임 제한** — §5.5 본문이 한국 약관규제법 / 소비자
      보호법 위반에 해당하는지. 책임 한도 (예: 12개월 결제액 또는 손해액)
      적정성.
- [ ] **서비스 가용성 / SLA** — "베타 / MVP 단계" 표현의 법적 효력. 정식
      SLA 도입 시 약관 갱신 절차.
- [ ] **종료 조건** — 사업자 임의 종료 §8.2의 "정당 사유 없는 일방적
      해지" 무효 리스크. 사용자 위반 시 종료 절차 (사전 통지 의무 여부).
- [ ] **약관 변경 통지** — 30일 사전 통지의 법적 충분성. 동의 간주 vs
      명시 동의 정책.
- [ ] **3자 종속 리스크** — Google Calendar API / OAuth IdP / Workspace
      Marketplace 정책 변경에 따른 서비스 중단 면책 표현 적합성.
- [ ] **라이선스 / IP** — 사용자 입력(카테고리 이름 / 키워드)의 IP 귀속,
      서비스 코드 / 디자인 / 상표의 사용자 측 라이선스 범위.

---

## 3. 서비스 사실 요약 (자문이 코드 미열람으로도 판단 가능하도록)

### 3.1 서비스 한 줄 정의

> AutoColor for Calendar는 사용자가 정의한 키워드 규칙(또는 보조적
> AI 분류)을 기반으로 Google Calendar 이벤트의 색상을 자동 적용하는
> Workspace Add-on이다.

### 3.2 데이터 흐름 (사용자 → 서비스)

| 단계 | 처리 데이터 | 저장 여부 | 처리 위치 |
|---|---|---|---|
| OAuth 동의 | `sub` (Google 사용자 식별자), `email`, `name` | **저장** (Supabase `users`) | Cloudflare Workers (edge) → Supabase (region 사용자 선택 — Seoul/Tokyo/Singapore 권고) |
| OAuth refresh token 보관 | refresh token (Google 발급) | **저장** (AES-GCM 암호화) | Supabase `oauth_tokens` |
| 캘린더 동기화 (incremental) | `summary` / `description` / `location` / `start` / `end` / `colorId` | **미저장** (in-transit only) | Cloudflare Workers 메모리 |
| 분류 — 규칙 (1단계) | 키워드 substring 매치 | (해당 없음, 사용자 키워드는 저장됨) | Cloudflare Workers |
| 분류 — LLM (2단계, 선택) | PII 제거된 `summary` / `description` / `location` | **미저장** (요청 단위, OpenAI 전송) | OpenAI 미국 |
| 색상 PATCH | `colorId` write + `extendedProperties.private` 3-key marker | (해당 없음, Google 측 이벤트 메타에만 기록) | Google Calendar |
| 관측 카운터 | 동기화 outcome / LLM call outcome / 롤백 outcome (집계만) | **저장** | Supabase `sync_runs` / `llm_calls` / `rollback_runs` |
| 계정 삭제 | (사용자 요청) | **DB cascade로 9개 테이블 일괄 삭제** + Google refresh token revoke + 활성 watch 채널 stop | — |

### 3.3 sub-processor 4사 disclosure

| Sub-processor | 역할 | 데이터 | 위치 |
|---|---|---|---|
| Google LLC | OAuth IdP / Calendar API | OAuth 동의 + 이벤트 메타 | 글로벌 |
| Cloudflare Inc. | Worker 실행 / Hyperdrive (DB 프록시) / Queue (DLQ) | 모든 in-transit | 글로벌 엣지 (미국 본사) |
| Supabase Inc. | PostgreSQL (관리형) | 사용자 식별자 + OAuth token + 카테고리 + 동기화 상태 + 관측 카운터 | 사용자 선택 region |
| OpenAI L.L.C. | LLM 분류 (선택) | PII 제거된 이벤트 메타 (요청 단위) | 미국 |

자세한 본문은 [`docs/assets/marketplace/sub-processors.md`](../assets/marketplace/sub-processors.md).

### 3.4 PII 보호 핵심 invariant

- **이벤트 본문은 영구 저장소에 저장하지 않는다.** Cloudflare Workers
  메모리에서 분류·색상 변경 후 즉시 폐기. 로그 / 큐 메시지 / 관측 테이블
  모두 본문 미포함 (집계 카운터 + Google API 에러 envelope만).
- **LLM 호출 전 PII 마스킹 강제.** `attendees` / `creator.email` /
  `organizer.email` 필드는 `destructure-and-omit`으로 제거되어 OpenAI에
  전송되지 않음. `summary` / `description` / `location`만 전송.
- **OAuth refresh token AES-GCM 암호화.** 운영자도 평문 token에 접근
  불가 (rotation 절차로 키 교체 가능).
- **로그에 token / 사용자 식별자 미기록.** query string redactor가
  `authorization` / `token` / `code` / `state` / `email` / `sub` 등
  10개 필드 자동 마스킹.

### 3.5 사용자가 행사 가능한 권리 (코드 동작)

| 권리 | 코드 경로 | 응답 |
|---|---|---|
| OAuth 권한 철회 | Google Account 설정 → "Apps with access" → AutoColor 제거 | 다음 동기화 시점에 `invalid_grant` → 자동 재로그인 유도 |
| 데이터 삭제 | 사이드바 "계정 삭제 / 데이터 삭제" 버튼 → `POST /api/account/delete` | DB cascade로 9개 user-scoped 테이블 즉시 삭제 + Google token revoke + 활성 watch 채널 stop |
| 카테고리 / 규칙 삭제 | 사이드바 "규칙 관리" → 삭제 | DB 즉시 삭제 + 해당 규칙으로 색칠된 이벤트 색상 자동 롤백 (Google 기본 색으로 복원) |
| 동기화 일시 중지 | (현재 미제공 — 향후 추가) | 회신 시 본 항목의 publish 명시 권고 검토 |

---

## 4. 자문 회신 deliverable 요청

다음 두 형태로 회신 부탁드립니다.

### 4.1 본문 직접 redline

[`docs/legal/privacy-policy.md`](./privacy-policy.md) 및
[`docs/legal/terms-of-service.md`](./terms-of-service.md) 본문 사본에
직접 수정 (Word track changes 또는 Google Docs suggesting mode).
수정한 사유를 inline comment로 부연.

### 4.2 의견서 1건

다음 항목을 cover하는 1-3페이지 의견서:

1. **publish 가능 의견**: 본문 수정 후 한국 + 글로벌 publish 가능 여부.
2. **잔존 리스크**: publish 후 발생 가능한 클레임 / 규제 리스크 우선
   순위 5건 이내.
3. **선택적 보강 권고**: 의무는 아니나 권장되는 본문 보강 (예: cookie
   정책 / DPO 지정 / DPIA 수행 / SCC 적용 등).
4. **재검토 권고 시점**: GDPR / CCPA / Korean PIPA 갱신 또는 본 서비스의
   기능 확장 시 재의뢰 권고 트리거.

---

## 5. 첨부

본 의뢰서와 함께 송부하는 자료:

| 파일 | 용도 |
|---|---|
| [`docs/legal/privacy-policy.md`](./privacy-policy.md) | 검토 대상 1차 초안 — 개인정보처리방침 (262줄) |
| [`docs/legal/terms-of-service.md`](./terms-of-service.md) | 검토 대상 1차 초안 — 서비스 이용약관 (221줄) |
| [`docs/assets/marketplace/sub-processors.md`](../assets/marketplace/sub-processors.md) | sub-processor 4사 disclosure (정본) |
| [`docs/assets/marketplace/processing-region.md`](../assets/marketplace/processing-region.md) | 처리 위치 disclosure (정본) |
| [`docs/assets/marketplace/scope-justifications.md`](../assets/marketplace/scope-justifications.md) | OAuth scope별 정당화 본문 (정본 — Google 검수 제출용) |
| (본 의뢰서) `docs/legal/REVIEW-REQUEST.md` | 의뢰 요약 + 사실 정리 + 체크리스트 |

GitHub repository 단위 접근이 가능하시면 위 경로 그대로 회신해 주시면
됩니다. PDF / Markdown / Word 등 회신 형식은 자문 측 편의에 따라.

---

## 6. 회신 후 운영자 측 작업

자문 회신 도착 후 운영자가 처리하는 흐름 (운영자 메모, 자문 측 무관):

1. 본문에 자문 redline 반영 → 별도 PR로 commit (제목 예: `legal: apply
   counsel review (round 1)`).
2. [`docs/runbooks/04-legal-hosting.md`](../runbooks/04-legal-hosting.md)
   Step 2 호스팅 실행.
3. [`gas/addon.js:119`](../../gas/addon.js)의 placeholder URL을 publish
   본문 URL로 교체 + GAS 새 version 배포.
4. [`docs/marketplace-readiness.md`](../marketplace-readiness.md) §2 row
   121-122 + §5 row 254-255 status `초안` → `완료`.
5. 의견서를 `docs/legal/review-rounds/round-1.md` 등 별도 보관소에 저장
   (잔존 리스크 / 재검토 트리거 추적).

---

## 7. 연락처

| 항목 | 값 |
|---|---|
| 의뢰자 회신 채널 | (운영자 본인 이메일 — 의뢰 시점 기재) |
| support 이메일 | `support@autocolorcal.app` (G1 도메인 verified — 2026-05-04) |
| GitHub repository | (private — 의뢰 시점 협의 후 reviewer 초대) |

자문 fee 견적 / 계약은 별도 협의.

---

## Cross-references

- [`docs/runbooks/04-legal-hosting.md`](../runbooks/04-legal-hosting.md) Step 1 — 본 의뢰서를 첨부할 정본 절차
- [`docs/legal/README.md`](./README.md) — `docs/legal/` 디렉터리 목적 / 회신 후 publish 흐름
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) §2 row 121-122 — Privacy / ToS URL status pointer
- [`docs/runbooks/00-user-action-checklist.md`](../runbooks/00-user-action-checklist.md) ⑥ — 외부 대기 work item

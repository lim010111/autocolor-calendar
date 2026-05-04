# AutoColor for Calendar — 서비스 이용약관 (초안)

> 본 문서는 **법률 자문 검토 전의 1차 초안**이다. 코드 / 아키텍처 ground
> truth (E2E 백엔드 의존, halt-on-failure, 색상 ownership marker, LLM
> quota, retry/DLQ 정책)에 기반한 사실 기술만 담고 있으며, 관할법 / 분쟁해결
> 절차 / 면책조항 / 책임제한 / 약관 변경 통지 양식 등은 자문이 검토 후 최종
> 확정한다.
>
> 이 초안의 책임은 코드와의 정합성 유지이며, 실제 publish 시점에는 자문 회신
> 을 반영한 본문으로 교체된다. 자문 검토 시 우선 확인 항목은 본 문서 마지막
> H3 섹션에 정리되어 있다.

본 약관은 AutoColor for Calendar(이하 "서비스") 사용에 관한 운영자와 사용자
간의 권리·의무를 규정한다.

## 1. 서비스 정의

본 서비스는 Google Workspace Add-on으로 동작하며, Google Calendar 이벤트에
사용자 정의 규칙(키워드 매칭) 또는 AI(LLM) 분류로 자동 색상을 부여한다.
Cloudflare Workers 기반 백엔드와 Supabase PostgreSQL을 사용하며, AI 단계는
선택적 OpenAI `gpt-5.4-nano` 호출로 수행된다 (`docs/project-overview.md`).

## 2. 자격 요건

- 유효한 Google 계정을 보유한 자.
- Google Workspace Add-on 설치 동의 + 본 약관 / 개인정보처리방침 동의.
- 미성년자의 경우 자문 검토 시 우선 확인 항목 — 미성년자 정책 결과 반영.

## 3. 권한 (Scope)

서비스는 다음 OAuth scope을 요청한다 (`src/config/constants.ts` /
`gas/appsscript.json`):

- `openid` — OpenID Connect 인증.
- `email` — 사용자 이메일.
- `https://www.googleapis.com/auth/calendar` — 캘린더 읽기.
- `https://www.googleapis.com/auth/calendar.events` — 이벤트 색상 변경.

각 권한이 왜 필요한지에 대한 사용자용 설명은 [`docs/assets/marketplace/scope-justifications.md`](../assets/marketplace/scope-justifications.md)에 정리되어 있다.
서비스는 본 목록 외의 scope을 opportunistic하게 요청하지 않는다 (Principle
3 — Scope Minimization, `docs/security-principles.md`).

## 4. 사용자 의무

- 본인 Google 계정으로만 접근.
- 자동화 도구 / 스크립트로 본 서비스의 API를 우회 호출하지 않는다.
- 다른 사용자 / 본 서비스 운영을 방해하는 행위 금지.
- 색상 분류 규칙(카테고리 / 키워드)은 본인이 등록·관리하며, 분류 결과의
  업무적 정확성은 사용자가 검토한다 (서비스는 분류 결과를 보장하지 않는다 —
  §5 참조).

## 5. 서비스의 한계 / 책임 제한

### 5.1 E2E 백엔드 의존

본 서비스는 Cloudflare Workers 백엔드 + Supabase에 전적으로 의존한다. 백엔드
통신 실패 시 처리는 silent skip되며 **로컬 fallback이 없다**
(`docs/architecture-guidelines.md` "Halt on Failure"). 사용자 측 로컬 트리거
는 deprecated 상태로 사용 금지.

OAuth `invalid_grant`(refresh token revoke)만 narrow exception으로 처리되어
사용자에게 재로그인 prompt가 표시된다.

### 5.2 수동 색상 변경 보존

사용자가 캘린더에서 직접 변경한 이벤트 색상은 본 서비스가 덮어쓰지 않는다
(`docs/architecture-guidelines.md` §5.4 / `src/CLAUDE.md` "Color ownership
marker (§5.4)"). 색상 ownership은 `extendedProperties.private`에 저장된 3-key
marker로 판별된다.

### 5.3 LLM 일일 quota

LLM 분류는 사용자별 일일 호출 한도(default 200 calls/user, `LLM_DAILY_LIMIT`
runtime override)에 의해 제한된다 (`src/services/llmClassifier.ts`). 한도
초과 시 해당 이벤트는 `no_match`로 처리되어 색상 변경 없이 다음 동기화 주기
까지 대기한다.

### 5.4 재시도 / DLQ

일시적 오류(네트워크 / API 5xx / 429)는 자동 재시도 (Exponential backoff),
영구 실패는 Dead Letter Queue로 이송되어 운영자 진단 대상이 된다
(`src/services/calendarSync.ts`). 사용자 측 처리는 다음 동기화까지 자동
재개된다.

### 5.5 책임 제한

본 서비스는 "있는 그대로(as-is)" 제공되며, 다음 사유로 인한 손해에 대해
운영자는 자문 회신 회의 결과에 따라 정의될 책임 한도 내에서 책임진다:

- Google Calendar API / OAuth IdP / OpenAI / Cloudflare / Supabase 등 외부
  서비스의 가용성 / 응답 지연 / 결과.
- LLM 분류 결과의 정확성 (서비스는 LLM의 정확성을 보장하지 않으며, 사용자
  가 결과를 검토한다).
- 일시적 색상 적용 지연 또는 누락 (silent skip 시).

(구체적 표현은 §10 자문 검토 영역.)

## 6. 데이터 처리

데이터 수집 / 처리 / 저장 / 삭제 정책은 [`docs/legal/privacy-policy.md`](./privacy-policy.md)
"개인정보처리방침"으로 위임한다. 본 약관과 충돌하면 개인정보처리방침이
우선한다.

## 7. 가용성 / SLA

본 서비스는 베타 / MVP 단계에서 제공된다. 정식 SLA는 보장되지 않으며, 운영자
는 점검 / 장애 / 서비스 중단을 사전 통지 없이 수행할 수 있다 (단 5.5의 책임
한도 내). 정식 SLA 도입 시 본 약관에 별도 조항으로 추가된다.

## 8. 종료

### 8.1 사용자에 의한 종료

- GAS Add-on 제거 → OAuth 권한 자동 해제 (Google이 처리).
- `POST /api/account/delete` 호출 → 9개 사용자 스코프 테이블 cascade 삭제 +
  Google revoke + watch channel stop (`src/CLAUDE.md` "Account deletion (§3
  row 179)"). 본 작업은 즉시·완전 삭제로 복구 불가.

### 8.2 사업자에 의한 종료

운영자는 다음 사유로 사용자 계정을 종료할 수 있다 (자문 검토 영역 — 정당
사유 명확화 필요):

- 본 약관 위반 (§4).
- 부정 사용 (다중 계정 quota 우회, 자동화 우회).
- 법령 위반.

종료 시점에 §8.1과 동일한 cascade 삭제가 수행된다.

## 9. 약관 변경

본 약관 개정 시 GAS Add-on 내 공지 + 변경일자 명시 + 변경 30일 전 사전 통지.
사용자가 동의하지 않을 경우 §8.1 종료 옵션 제공. (사전 통지 / 동의 양식의
법적 충분성은 §10 자문 검토 영역.)

## 10. 분쟁 해결 / 관할법

[자문 검토 영역 — 자리만 표시.] 자문 회신 후 다음을 결정해 본 섹션을 채운다:

- 준거법.
- 분쟁해결 절차 (중재 vs 소송, 관할법원).
- 집단 소송 가능성 / class-action waiver 적용 여부.

## 11. 연락처

[support email TBD per docs/runbooks/01-domain-and-search-console.md] — G1
도메인 verified 후 `support@<chosen>.app` 형태로 채워질 예정.

---

본 약관 시행일: [TBD — publish 시점].

## Cross-references

- 본 약관 본문이 인용한 코드 ground truth 위치:
  - `src/config/constants.ts` / `gas/appsscript.json` — OAuth scope
  - `src/services/llmClassifier.ts` — LLM quota / `OPENAI_API_KEY` gating
  - `src/services/calendarSync.ts` — retry / DLQ / sync 흐름
  - `src/CLAUDE.md` "Color ownership marker (§5.4)" — 수동 색상 보존
  - `src/CLAUDE.md` "Account deletion (§3 row 179)" — 종료 절차
  - `docs/architecture-guidelines.md` "Halt on Failure" / "E2E Backend
    Mandatory" / "Hybrid Classification Engine"
  - `docs/security-principles.md` Principle 3 — Scope Minimization
- 동반 문서:
  - [`docs/legal/privacy-policy.md`](./privacy-policy.md) — 개인정보처리
    방침 (초안)
  - [`docs/assets/marketplace/scope-justifications.md`](../assets/marketplace/scope-justifications.md)
    — scope별 정당화 (정본)

## 자문 검토 시 우선 확인 항목

법률 자문에게 의뢰서로 그대로 첨부 가능. 자문이 검토 후 본문 갱신.

### 관할법 / 준거법

- 한국 사용자 한정: 한국법.
- 글로벌 노출 (Workspace Marketplace는 글로벌): 영문본 별도 + 각 적용 가능
  법 (EU 소비자보호 / 캘리포니아 소비자보호 등).
- 한국법 적용 시 약관규제법 준수 검토 (소비자에게 부당하게 불리한 조항
  무효).

### 분쟁 해결 절차

- 중재 vs 소송.
- 관할법원 (서울중앙지방법원 / 사용자 주소지 등).
- 집단 소송 가능성 / class-action waiver 적용 가능 여부.

### 면책 조항 / 책임 제한

- §5.5 표현이 한국 약관규제법 / 소비자보호법 위반에 해당하는지 점검.
- 책임 한도 (예: 12개월 내 결제액 또는 손해액 중 적은 금액).
- 외부 서비스 가용성에 의한 손해의 면책 표현.

### 서비스 가용성 / SLA

- "베타 / MVP 단계" 표현의 법적 효력.
- 사전 통지 없이 점검 / 중단 가능 표현이 사용자 기대권과 충돌하는지.
- 정식 SLA 도입 시점의 약관 갱신 절차.

### 종료 조건

- 사업자 임의 종료 (§8.2)의 정당 사유 명확화 — 한국 약관규제법은 "정당한
  사유 없는 일방적 해지"를 무효 사유로 둔다.
- 사용자 위반 시 종료 절차 (사전 통지 의무 여부, 즉시 해지 사유 enumeration).

### 약관 변경 통지 절차

- 30일 사전 통지의 법적 충분성.
- 동의 간주 vs 명시 동의.
- 사용자가 동의 거부 시 자동 계정 종료 절차의 법적 효력.

### 3자 서비스(Google) 가용성에 의한 종속 리스크

- Google Calendar API / OAuth IdP / Workspace Marketplace 정책 변경에 따른
  서비스 중단의 면책 표현.
- "Google이 본 서비스를 차단할 경우" 시나리오 (예: Marketplace 상장 철회).

### 라이선스 / IP

- 사용자가 본 서비스에 입력하는 카테고리 이름 / 키워드의 IP 귀속.
- 본 서비스의 코드 / 디자인 / 상표 IP의 사용자 측 라이선스 범위.

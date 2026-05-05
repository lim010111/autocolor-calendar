# AutoColor for Calendar — 개인정보처리방침 (초안 / Legal-Review Round 1 redline)

> 본 문서는 **법률 자문 검토 전의 1차 초안**이며, 2026-05-05 자 Legal Reviewer
> 1차 redline이 반영되어 있다. 코드 / 아키텍처 ground truth (PII 마스킹, 토큰
> 암호화, sub-processors, 계정 삭제, observability 계약)에 기반한 사실 기술
> 위에, 한국 개인정보보호법(PIPA) §30·§22의2·§28의8, 정보통신망법(ITNA),
> GDPR Art. 6·13·28·44, CCPA/CPRA 의 처리방침 필수 기재사항을 보강했다.
> 관할법·DPO 지정 의무·EU 대리인 지정·법인격 결정 등은 외부 자문이 최종
> 확정한다.
>
> Redline 관례: 추가 문장은 그대로 본문에 추가, 삭제 권고 문장은 `~~취소선~~`
> 으로 표시, 변경 의도가 비자명한 경우 `<!-- LEGAL-REVIEW: ... -->` HTML
> 주석으로 사유를 부연한다. 자문 검토 시 우선 확인 항목은 본 문서 마지막
> H3 섹션에 정리되어 있다.

본 개인정보처리방침(이하 "본 정책")은 AutoColor for Calendar(이하 "서비스")의
운영자(이하 "회사" — 법인격은 publish 시점에 확정)가 「개인정보 보호법」
제30조 및 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」에 따라 정보주체
의 개인정보를 어떻게 수집·이용·제공·파기하는지 알리고 정보주체의 권리를
보장하기 위해 수립·공개한다. 본 서비스는 Google Workspace Marketplace를 통해
글로벌로 배포되므로, 한국 외 거주 정보주체에 대해서는 GDPR(EU/EEA),
CCPA/CPRA(미국 캘리포니아) 및 각 거주국의 적용 가능한 개인정보 보호 법령을
함께 준수한다.

<!-- LEGAL-REVIEW: PIPA §30 1항은 처리방침의 수립·공개 근거를 명시할 것을
요구하며, 정보통신망법 §27의2 또한 동일 취지의 공개 의무를 둔다. 글로벌
배포 사실을 본문에 명시해야 GDPR Art. 13(1)(a)/(c) 및 CCPA §1798.130 의
"카테고리·목적·법적 근거" 통지 의무 충족 기반이 마련된다. -->

## 0. 처리방침 핵심 요약 (At-a-Glance)

정보주체가 빠르게 확인할 수 있도록 본 정책의 핵심 사항을 요약한다.

- **수집 항목**: Google 계정 식별자(`sub`, 이메일, 이름 일부), Google
  Calendar 이벤트 메타데이터(in-transit 처리, 영구 미저장), 사용자가 입력한
  카테고리/키워드/색상.
- **수집 목적**: Google Calendar 이벤트의 자동 색상 분류, 사용자 인증·세션
  관리, 서비스 안전성 확보 및 통계.
- **법적 근거**:
  - PIPA §15 1항 4호(계약의 이행) — 서비스 이용계약(약관 동의) 이행을 위한
    필수 처리.
  - PIPA §15 1항 1호 — 정보주체 동의(OAuth 동의 + 본 처리방침 동의 시점).
  - GDPR Art. 6(1)(b) — 계약 이행. LLM 분류 옵션은 Art. 6(1)(a) 동의 기반.
- **보유·이용기간**: 계정 활성 기간 또는 정보주체 삭제 요청 시까지(아래 §6
  표 참조).
- **제3자 제공**: 제공하지 않음. 단, 처리위탁(§4)으로 Google LLC, Cloudflare,
  Inc., Supabase, Inc., OpenAI, L.L.C. 가 있으며 일부는 국외이전(§4.1)에
  해당한다.
- **정보주체 권리**: 열람·정정·삭제·처리정지 등(§7).
- **개인정보 보호책임자**: §10 연락처 참조.

<!-- LEGAL-REVIEW: PIPA §30 1항 각 호를 충족하는 핵심 요약을 도입해 정보주체
가 5초 안에 핵심 사항을 파악할 수 있도록 했다. 개인정보보호위원회의 처리방침
표준 양식(2024 개정) 권장 항목이다. -->

## 1. 수집하는 개인정보의 항목 및 수집 방법

<!-- LEGAL-REVIEW: PIPA §30 1항 1호(처리 목적), 2호(처리 항목)와 정합되도록
H2 제목을 "수집·이용 항목"으로 명시화. -->

### 1.1 Google 계정 식별자 (필수)

서비스는 사용자 인증 및 Calendar 연동을 위해 Google OAuth 2.0 동의 절차를
거쳐 다음 정보를 수집한다.

| 수집 항목 | 출처 | 수집 시점 |
|---|---|---|
| `sub` (Google 발급 안정적 사용자 식별자, 비-개인 PII) | Google OAuth IdP | OAuth 최초 동의 시 |
| 이메일 주소 | Google OAuth IdP | OAuth 최초 동의 시 |
| 이름(`name`) 일부 | Google OAuth IdP | OAuth 최초 동의 시 |
| OAuth refresh token (AES-GCM 암호화 후 저장) | Google OAuth IdP | OAuth 최초 동의 시 |

서비스가 Google에 요청하는 OAuth 권한 범위(scope)는 다음과 같다
(`src/config/constants.ts`):

- `openid` — OpenID Connect 인증 표준.
- `email` — 사용자 이메일 주소(인증·식별 용도).
- `https://www.googleapis.com/auth/calendar` — Calendar 목록·이벤트 읽기 및
  Push Notification(Watch) 등록.
- `https://www.googleapis.com/auth/calendar.events` — 이벤트 `colorId` 및
  `extendedProperties.private` 의 색상 소유권 마커 3개(`autocolor_v` /
  `autocolor_color` / `autocolor_category`)를 쓰기 위함. 이벤트 본문(제목·
  설명·장소·참석자·시간 등) 은 본 권한으로 절대 수정하지 않는다.

각 권한별 사용 근거는 [`docs/assets/marketplace/scope-justifications.md`](../assets/marketplace/scope-justifications.md)
에 상세히 정리되어 있으며, 본 서비스는 Google API Services User Data Policy
의 **Limited Use** 정책을 준수한다(§5.4 참조).

### 1.2 Google Calendar 이벤트 메타데이터 (필수, 일시적 처리)

서비스는 분류 처리 목적의 범위 내에서 다음 이벤트 메타데이터를 Google
Calendar API로부터 일시적으로 읽어들인다. **본 데이터는 영구 저장되지
않으며**, 분류·색상 적용 직후 Cloudflare Workers 메모리에서 폐기된다(§2.1).

- `summary` (이벤트 제목)
- `description` (이벤트 본문)
- `location` (이벤트 장소)
- `start`, `end`, `colorId`, `status`, `extendedProperties.private`(서비스의
  색상 소유권 마커 검증용)
- `attendees`, `creator.email`, `organizer.email` — 백엔드에 일시 도달하나
  LLM 분류 단계 진입 **전** `destructure-and-omit` 으로 제거되어 OpenAI 등
  외부 LLM 처리자에게 전송되지 않는다 (`src/services/piiRedactor.ts`).

<!-- LEGAL-REVIEW: PIPA §3 1항(개인정보 최소수집 원칙) / GDPR Art. 5(1)(c)
data minimisation 원칙에 정합. attendees/creator/organizer는 서비스 처리
필수에는 해당하나 LLM 단계로는 흘러가지 않음을 분명히 한다. -->

### 1.3 위치정보의 처리 (해당 없음)

본 서비스는 「위치정보의 보호 및 이용 등에 관한 법률」 상의 "개인위치정보"
(이동성 단말기로부터 자동 수집되는 위치정보)는 수집·이용·제공하지 않는다.
이벤트의 `location` 필드는 사용자가 캘린더 이벤트에 직접 입력한 텍스트(예:
"서울회의실 A")로서 위치정보법상 위치정보가 아닌 PIPA 상의 일반 개인정보로
취급한다.

<!-- LEGAL-REVIEW: 위치정보법 §15(개인위치정보 수집 동의) 회피 기재. 단말기
GPS·기지국 자동수집이 아니라 사용자 입력 텍스트라는 점을 명시해 위치정보
사업자 신고 의무 트리거를 차단. -->

### 1.4 사용자 정의 데이터 (필수)

- 카테고리 이름 / 키워드 / 색상 — 사용자가 사이드바 UI에서 명시적으로 입력.
- 동기화 상태(`sync_state`) — 캘린더별 동기화 토큰, watch 채널 정보(서비스
  자동 생성).

### 1.5 자동 수집 정보 (서비스 운영 목적)

서비스 안전성 확보 및 통계 목적으로 다음 집계 정보를 자동 생성·저장한다.
이벤트 본문 내용은 포함되지 않는다 (§2.3 참조).

- 동기화 결과 카운터(`sync_runs`)
- LLM 호출 outcome 및 latency(`llm_calls`)
- 색상 롤백 outcome(`rollback_runs`)
- 일일 LLM 사용량(`llm_usage_daily`)

### 1.6 수집하지 않는 정보

서비스는 다음 정보를 수집하지 않는다.

- 주민등록번호, 운전면허번호, 여권번호 등 PIPA §24의2 의 고유식별정보.
- 사상·신념, 노동조합·정당의 가입·탈퇴, 정치적 견해, 건강, 성생활 등
  민감정보(PIPA §23, GDPR Art. 9, CCPA 의 Sensitive Personal Information).
- 단말기 GPS·IP 기반 위치정보(위치정보법 적용 대상).
- 만 14세 미만 아동의 개인정보(§9 미성년자 정책 참조).

<!-- LEGAL-REVIEW: 미수집 항목의 명시는 PIPA 표준 처리방침 양식 권장사항이며,
GDPR Art. 9 / CCPA Sensitive PI 의 처리 미해당을 분명히 해 둔다. -->

## 1A. 개인정보의 처리 목적 및 법적 근거

서비스는 수집한 개인정보를 다음 목적의 범위 내에서만 이용하며, 목적이 변경
되는 경우 사전 동의를 받는다(PIPA §18, GDPR Art. 5(1)(b)).

| 처리 목적 | 처리 항목 | 법적 근거 |
|---|---|---|
| (1) 회원 인증 및 세션 관리 | `sub`, 이메일, 이름, 세션 토큰 해시 | PIPA §15①4호(계약 이행) / GDPR Art. 6(1)(b) |
| (2) Google Calendar 이벤트 자동 색상 분류 | 이벤트 메타데이터(in-transit), 카테고리·키워드 | PIPA §15①4호(계약 이행) / GDPR Art. 6(1)(b) |
| (3) LLM 기반 보조 분류 (선택 기능) | PII 마스킹된 `summary`/`description`/`location` | PIPA §15①1호(동의) / GDPR Art. 6(1)(a) — 사용자가 사이드바 "AI로 분류" 버튼을 누른 시점에 동의로 간주 |
| (4) 서비스 안전성 확보 및 부정 사용 방지 | 동기화·LLM·롤백 카운터(집계) | PIPA §15①7호(정당한 이익) / GDPR Art. 6(1)(f) |
| (5) 법령상 의무 이행 (이용내역 보관 등) | 동의 이력, 처리 카운터 | PIPA §15①2호(법률 의무) / GDPR Art. 6(1)(c) |

서비스는 위 목적을 벗어난 마케팅·광고·프로파일링·자동화된 결정에는 사용
자 데이터를 사용하지 않으며, Google API에서 받은 사용자 데이터를 광고 목적
또는 제3자 ML 모델 학습에 사용하지 않는다(§5.4 Google Limited Use 정책).

<!-- LEGAL-REVIEW: PIPA §30 1항 1호(처리 목적), GDPR Art. 13(1)(c) 처리
근거 명시, GDPR Art. 6 lawful basis 매핑 충족. LLM 호출의 법적 근거를
계약 이행이 아닌 동의로 분리한 이유: 사용자가 명시적으로 "AI 분류" 버튼을
눌러야 LLM 단계가 동작하며, 거부해도 규칙 기반 분류로 핵심 서비스가 작동
하므로 contract necessity 가 아닌 consent 가 더 적절하다. 자문 회의 시
재검토 필요. -->

## 2. 정보의 처리 및 저장

### 2.1 캘린더 이벤트 본문은 저장하지 않는다

이벤트 metadata는 동기화 처리 중 **in-transit**으로만 다뤄진다 — Cloudflare
Workers의 메모리에서 분류·색상 변경 후 즉시 폐기되며, 영구 저장소(데이터
베이스 / 로그 / 큐 메시지)에 저장되지 않는다 (`docs/assets/marketplace/sub-processors.md` §1).

### 2.2 OAuth 토큰은 암호화 후 저장한다

Google OAuth refresh token은 `TOKEN_ENCRYPTION_KEY`로 AES-GCM 암호화되어
Supabase PostgreSQL의 `oauth_tokens` 테이블에 저장된다. 키 회전 절차는
운영자 측 무중단 dual-key fallback이 구현되어 있다 (`src/CLAUDE.md`
"Secret rotation impact" / "Token rotation (§3 후속)").

### 2.3 관측성 카운터만 저장한다

서비스는 다음 집계 카운터만 저장하며 이벤트 내용은 포함하지 않는다
(`src/CLAUDE.md` "Observability tables (§6 Wave A)" / "(§6 Wave B)"):

- `sync_runs` — 동기화 1회당 결과 (성공/실패 outcome, 처리 이벤트 수,
  업데이트/스킵 카운터).
- `llm_calls` — LLM 호출 1회당 결과 (outcome, latency, 카테고리 수, 시도 수,
  카테고리 이름).
- `rollback_runs` — 카테고리 삭제 시 색상 롤백 작업의 outcome 로그.
- `sync_failures.summary_snapshot` — DLQ 이송 시 마지막 실패 요약 (집계
  카운터 + Google API 에러 envelope, 이벤트 본문 없음).

### 2.4 로그 redaction

운영자 로그 접근(`wrangler tail`)은 query-string 기반 redactor를 통과하며,
다음 필드는 자동 마스킹된다 (`src/CLAUDE.md` "Log redaction contract"):
`authorization`, `token`, `code`, `state`, `refresh_token`, `access_token`,
`id_token`, `email`, `sub`, `password`. 요청 / 응답 body, Authorization
헤더는 구조적으로 로그에 들어가지 않는다.

## 3. 개인정보의 처리 위치 (Region)

처리 위치 정보의 정본은 [`docs/assets/marketplace/processing-region.md`](../assets/marketplace/processing-region.md)에 있다. 요약:

- **Cloudflare Workers / Hyperdrive / Queues**: 글로벌 엣지, region 핀 없음
  (`wrangler.toml` 에 `region` 설정 없음). 정보주체 요청은 가장 가까운
  Cloudflare PoP에서 처리되며, 결과적으로 한국 정보주체의 데이터는 한국
  PoP에서, EU 정보주체의 데이터는 EU PoP에서 주로 처리된다.
- **Supabase Postgres**: prod 리전은 출시 시점에 확정된다(Seoul
  `ap-northeast-2` 적용 예정). 확정된 리전은 본 정책 개정으로 통지한다.
- **OpenAI `gpt-5.4-nano`**: OpenAI L.L.C. 의 미국 데이터센터에서 처리된다
  (`OPENAI_API_KEY` 미설정 시 어떤 요청도 발생하지 않는다).

<!-- LEGAL-REVIEW: PIPA §28의8 ②항(국외이전 사실의 공개) 충족 기재. Supabase
prod region 미확정 상태로는 PIPA 국외이전 동의서 양식이 완성되지 않으므로
publish 직전 §4.1 표를 확정값으로 갱신해야 한다. -->

## 4. 개인정보의 처리위탁 및 국외이전 (Sub-processors)

서비스는 안정적이고 효율적인 운영을 위해 다음과 같이 개인정보 처리업무를
위탁하고 있다(PIPA §26, GDPR Art. 28). 위탁 계약 체결 시 PIPA §26 ①항 각 호
및 GDPR Art. 28(3) 의 사항을 명시한 데이터 처리 부속서(DPA)를 통해 수탁자
의 개인정보 보호 의무를 명시한다.

| 수탁자 | 위탁업무 | 처리 데이터 envelope | 처리 국가 | 보관기간 |
|---|---|---|---|---|
| Google LLC | OAuth 인증, Calendar API, Workspace Add-on 런타임 | OAuth 동의 정보, 이벤트 메타 | 미국 외 글로벌 | 회원탈퇴 시까지 |
| Cloudflare, Inc. | 엣지 런타임(Workers) + DB 연결 broker(Hyperdrive) + 큐(Queues + DLQ) | in-transit 이벤트 페이로드 / DLQ는 Google API 에러 envelope만 | 글로벌 엣지(미국 본사) | 회원탈퇴 시까지 |
| Supabase, Inc. | 관리형 PostgreSQL (OAuth 토큰 암호화 저장, 동기화 상태, 관측 카운터, 세션) | 집계 카운터 / 동기화 상태 / 카테고리 / 암호화 refresh token / 에러 envelope (이벤트 본문 없음) | (Seoul `ap-northeast-2` 적용 예정 — publish 직전 확정) | 회원탈퇴 시까지 |
| OpenAI, L.L.C. | 선택적 LLM fallback (`gpt-5.4-nano`) — 사용자가 "AI로 분류" 기능 활성화 시에만 호출 | PII 마스킹된 `summary`/`description`/`location` 3개 필드만 | 미국 | 보관하지 않음 (요청 단위 in-transit) |

정본 disclosure는 [`docs/assets/marketplace/sub-processors.md`](../assets/marketplace/sub-processors.md)에 있다.

### 4.1 국외이전 (Cross-border Transfer) 별도 동의

PIPA §28의8 및 GDPR Art. 44–49 에 따라 다음과 같이 국외이전 사실을 고지한다.
정보주체는 회원가입(OAuth 동의) 시점에 본 처리방침에 동의함으로써 아래
국외이전에 동의한 것으로 간주되며, 동의를 거부할 권리가 있으나 거부 시
서비스의 핵심 기능(Cloudflare/Supabase 의존) 을 제공할 수 없다.

| 이전받는 자 | 이전 국가 | 이전 일시·방법 | 이전 항목 | 이용 목적 | 보유·이용 기간 | 적정성·이전 근거 |
|---|---|---|---|---|---|---|
| Google LLC | 미국 외 글로벌 | OAuth 동의 시 / API 호출 시점에 TLS 1.2+ 네트워크 전송 | OAuth 동의 정보, 이벤트 메타 | 인증 IdP, Calendar API | 회원탈퇴 시까지 | EU 적정성 결정(2023, EU-US Data Privacy Framework) / Google 표준 DPA |
| Cloudflare, Inc. | 미국 (본사) + 글로벌 엣지 | 모든 요청 시점 / TLS 1.2+ | in-transit 이벤트 페이로드 | 엣지 런타임 | 회원탈퇴 시까지 | EU 적정성 결정(EU-US DPF) / Cloudflare 표준 DPA + SCCs |
| Supabase, Inc. | (확정 예정 — 한국 사용자에 대해 Seoul region 적용 시 국외이전 미해당. EU/미국 사용자는 해당 region 적용) | 회원가입·이용 시점 / TLS 1.2+ | 집계 카운터, 암호화 refresh token, 카테고리, 동기화 상태 | 관리형 DB | 회원탈퇴 시까지 | Supabase 표준 DPA + SCCs (필요 시) |
| OpenAI, L.L.C. | 미국 | 사용자가 "AI 분류" 기능을 트리거하는 시점에 TLS 1.2+ 전송 | PII 마스킹된 3개 필드 | LLM 분류 | 보관하지 않음 | EU 적정성 결정(EU-US DPF) / OpenAI Enterprise DPA + SCCs |

<!-- LEGAL-REVIEW: PIPA §28의8 ②항이 요구하는 통지 항목 6개(이전받는 자,
국가, 일시·방법, 항목, 목적, 보유기간)를 표 컬럼으로 모두 채웠다. PIPA
§28의8 ①항 적법요건은 (1) 동의 또는 (2) SCC 등 안전조치이며, 본 표는 동의
경로 + 보강적 SCC 양쪽을 모두 명시한다. publish 직전 Supabase prod region
확정값으로 표를 갱신해야 한다.

GDPR Art. 45–49: EU-US Data Privacy Framework 인증 여부는 자문 측에서
publish 직전 vendor 별로 재확인 필요(특히 Cloudflare/OpenAI/Supabase).
미인증 시 SCC(2021/914 EU 표준 계약 조항) 단독 의존으로 폴백한다. -->

### 4.2 처리위탁에 대한 정보주체의 거부권

정보주체는 본 처리위탁에 동의하지 않을 권리가 있다. 다만, Cloudflare 및
Supabase 위탁은 서비스의 본질적 기반이므로 거부 시 회원가입을 진행할 수
없으며, OpenAI 위탁(LLM 분류)은 사용자가 사이드바의 "규칙 기반 분류만 사용"
모드를 선택함으로써 거부할 수 있다.

<!-- LEGAL-REVIEW: PIPA §22 ⑤항(필수/선택 구분 의무) + 약관규제법 §6
(부당하게 불리한 약관) 회피. LLM 위탁은 거부 가능 옵션을 명시함으로써
필수가 아닌 선택 동의로 구성. -->

### 4.3 제3자 제공의 부재

서비스는 위 §4 처리위탁 외에 정보주체의 개인정보를 제3자에게 제공하거나
판매하지 않는다. 미국 캘리포니아 거주 정보주체에 대해 CCPA/CPRA 상의 "Sale
or Share of Personal Information" 또한 발생하지 않으며, 이에 따라 별도의
"Do Not Sell or Share My Personal Information" 옵트아웃 채널을 운영하지
않는다(처리행위 자체가 부재). 향후 정책이 변경될 경우 본 정책 개정 및
별도 옵트아웃 채널 제공으로 통지한다.

<!-- LEGAL-REVIEW: CCPA §1798.120 / CPRA §1798.135 의 "Do Not Sell or Share"
disclosure 의무 충족. 본 서비스는 광고 식별자 수집·판매·공유가 없으므로
Sale/Share 미발생을 명시하는 부정적 disclosure 가 적절. 향후 광고 도입 시
재검토 트리거. -->

## 5. PII 마스킹 (LLM 처리 전)

규칙 기반 매칭이 실패한 이벤트만 LLM 단계로 진입하며, 진입 **전**에 다음
redaction이 mandatory 적용된다(우회 경로 없음 — `src/services/piiRedactor.ts`,
`docs/architecture-guidelines.md` "Hybrid Classification Engine"):

- 이메일 주소 → `[email]` 토큰
- URL → `[url]` 토큰
- 전화번호 (한국 모바일 / 유선 / 1588 대표번호 / 국제번호) → `[phone]` 토큰
- `attendees`, `creator.email`, `organizer.email` 필드는 destructure-and-omit
  으로 완전 제거.

prompt 빌더는 `summary` / `description` / `location` 3개 필드만 whitelist
하며, 그 외 필드는 LLM에 도달하지 않는다.

### 5.1 자동화된 결정 / 프로파일링 미해당

본 서비스의 LLM 분류는 사용자가 입력한 카테고리 명칭에 이벤트를 매핑하는
**색상 표시 보조 처리**이며, 정보주체의 권리·의무에 중대한 영향을 미치는
자동화된 결정(PIPA §37의2, GDPR Art. 22) 에 해당하지 않는다. 정보주체는
언제든 사이드바에서 LLM 모드를 끄고 규칙 기반 분류만 사용할 수 있다.

<!-- LEGAL-REVIEW: PIPA §37의2 (2024 시행, 자동화된 결정에 대한 정보주체의
거부·설명요구권) / GDPR Art. 22 의 적용 트리거 회피 disclosure. 색상
변경은 "법적 효과 또는 유사하게 중대한 영향" 에 해당하지 않는다는 입장
이며, 자문 측 최종 확인 필요. -->

### 5.2 LLM 학습 데이터로의 이용 금지 (Limited Use)

서비스가 OpenAI 에 전송하는 PII 마스킹 데이터는 OpenAI 의 **API 데이터 사용
정책**에 따라 OpenAI 의 모델 학습에 사용되지 않는다. 또한 서비스는 Google
API Services User Data Policy 의 **Limited Use** 정책을 준수하여, Google
Calendar API 로부터 받은 사용자 데이터를 다음 목적으로는 사용하지 않는다.

- 광고(advertising) 표시 또는 광고 타게팅 목적.
- 서비스 운영자 또는 제3자의 ML/AI 모델 학습 목적.
- 인간 직원의 검토(human review) 목적 — 단, (a) 정보주체가 명시적으로 동의
  한 경우, (b) 보안 목적, (c) 법령상 의무 이행, (d) 익명·집계 처리는 예외.
- 서비스의 사용자에게 제공하는 사용자 대면 기능 외의 목적.

<!-- LEGAL-REVIEW: Google API Services User Data Policy → Limited Use
Requirements 4개 항목을 본문에 명시. 이는 OAuth Restricted Scope 검수
통과의 핵심 요건이며, Marketplace Listing 의 Privacy Policy URL 본문에서
검증된다. 명시 누락 시 OAuth 검수 차단 위험. -->

## 6. 개인정보의 보유·이용 기간 및 파기

서비스는 정보주체로부터 동의받은 개인정보 보유·이용 기간 또는 법령에 따른
보유·이용기간 내에서 개인정보를 처리·보유한다(PIPA §21).

| 항목 | 보유 기간 | 파기 트리거 |
|---|---|---|
| 세션 토큰 해시 (`sessions`) | 발급 후 7일 | `pg_cron session-gc` 일일 삭제 |
| OAuth refresh token (암호화 저장) | 회원탈퇴 또는 정보주체의 Google 계정 권한 회수 시까지 | 계정 삭제 시 즉시 파기 / Google 보안 페이지 revoke |
| 카테고리 / 키워드 / 동기화 상태 | 회원탈퇴 시까지 | 계정 삭제 시 즉시 파기 |
| 관측성 카운터 (`sync_runs` / `llm_calls` / `rollback_runs` / `llm_usage_daily`) | 회원탈퇴 시까지 (집계 카운터, 이벤트 본문 미포함) | 계정 삭제 시 cascade 파기 |
| DLQ 실패 요약 (`sync_failures.summary_snapshot`) | 회원탈퇴 시까지 | 계정 삭제 시 cascade 파기 |
| 동의 이력 (회원가입·약관 동의 시점·본 정책 버전) | 회원탈퇴 후 3년 (전자상거래법 §6 ③항 준용 — 서비스 이용 관련 분쟁 해결 목적) | 보존기간 경과 후 즉시 파기 |

<!-- LEGAL-REVIEW: 종전 "관측성 카운터 무기한" 표현은 PIPA §21 ①항(보유기간
경과 시 즉시 파기) 위반 위험. 회원탈퇴 시 cascade 파기로 정확히 기재. 동의
이력 3년 보관은 자문 회신에 따라 조정 가능 (전자상거래법 §6 ③항 1호:
계약/청약철회 기록 5년이지만 무료 서비스라 적용 여부 불명확). -->

### 6.1 파기 절차 및 방법

- **전자적 파일 형태**: 복원이 불가능한 방법으로 영구 삭제(DB cascade DELETE +
  Cloudflare 임시 메모리 폐기).
- **종이 출력물**: 본 서비스는 종이 출력물 형태로 개인정보를 보관하지 않는다.

### 6.2 정보주체 자기-삭제 요청

정보주체는 GAS Add-on 사이드바의 "계정 삭제 / 데이터 삭제" 메뉴 또는 직접
`POST /api/account/delete` (인증 필요) 호출로 모든 데이터의 즉시 삭제를
요청할 수 있다(`src/CLAUDE.md` "Account deletion (§3 row 179)").

1. Google OAuth refresh token revoke (Google 측 재시도 가능 — 일시적 외부
   장애 시에도 본 서비스 측 삭제는 진행).
2. 활성 watch 채널 stop (Google 측 재시도 가능 — 미스톱 채널은 7일 내
   Google에 의해 자동 만료).
3. `DELETE FROM users WHERE id = ?` — 외래키 cascade로 9개 사용자 스코프
   테이블(`oauth_tokens` / `sessions` / `categories` / `sync_state` /
   `llm_usage_daily` / `sync_failures` / `llm_calls` / `rollback_runs` /
   `sync_runs`)이 즉시 일괄 파기된다.
4. 세션 무효화(cascade로 이미 파기됨; defense-in-depth 로 명시 revoke).

<!-- LEGAL-REVIEW: 종전 "best-effort" 표현은 한국 법률 문서 부적합. 정보주체
관점에서 "즉시 파기" 라는 결론을 흐리지 않도록 표현 변경. 외부 의존(Google
revoke / channels.stop) 실패가 본 서비스 측 파기를 차단하지 않는다는 사실은
보존하되, 표현을 정보주체 친화적으로 정리. -->

본 절차는 30일 이내(PIPA §35의 열람·파기 응답 기한 30일, GDPR Art. 12(3)
1개월 응답 기한)에 처리되며, 실제 운영상으로는 즉시(<1초) 처리된다.

## 7. 정보주체의 권리·의무 및 행사 방법

정보주체는 본인의 개인정보 처리에 관하여 다음 권리를 행사할 수 있다(PIPA
§35–§37의2, GDPR Art. 15–22, CCPA §1798.100·.105·.106·.110·.115·.120).

| 권리 | 한국법 근거 | GDPR 근거 | CCPA/CPRA 근거 | 행사 방법 |
|---|---|---|---|---|
| 개인정보 열람 요구권 | PIPA §35 | Art. 15 | §1798.100, .110 | GAS Add-on 사이드바 / `support@autocolorcal.app` |
| 정정·삭제 요구권 | PIPA §36 | Art. 16, 17 | §1798.105, .106 | 사이드바 카테고리 관리 / 계정 삭제 메뉴 |
| 처리정지 요구권 | PIPA §37 | Art. 18, 21 | §1798.120 | Google 계정 보안 페이지의 OAuth 권한 회수 또는 support 이메일 |
| 자동화된 결정 거부·설명 요구권 | PIPA §37의2 | Art. 22 | — | 사이드바에서 "AI 분류" 모드 끄기 (규칙 기반 분류로만 운영) |
| 개인정보 이동권 | — (한국법상 일반 의무 미정립) | Art. 20 | — | support 이메일 — JSON 형식 export 제공 (요청 후 30일 이내) |
| 동의 철회권 | PIPA §37 | Art. 7(3) | §1798.135 | OAuth 권한 회수 또는 계정 삭제 |
| Sale/Share 옵트아웃 | — | — | §1798.120, .135 | 처리행위 부재(§4.3) — 별도 옵트아웃 채널 미운영 |
| 차별 금지 (Non-Discrimination) | — | — | §1798.125 | 권리 행사를 이유로 서비스 차별·불이익 제공 금지 (§7.1) |

<!-- LEGAL-REVIEW: PIPA §35–§37의2 / GDPR Art. 15–22 / CCPA §1798 series
의 모든 권리 매트릭스를 표로 통합. 데이터 이동권(Art. 20)은 본 서비스가
저장하는 데이터가 카테고리/키워드 위주이긴 하나 GDPR 의무이므로 JSON
export 채널 제공 의무를 명시. 자문 회신 시 export endpoint 구현 우선순위
재검토. -->

### 7.1 권리 행사 시 비차별 약속 (CCPA §1798.125)

정보주체가 본 §7 의 권리를 행사한다는 사실을 이유로 서비스는 가격·품질·
서비스 수준을 차별하거나 회원탈퇴를 강요하지 않는다.

### 7.2 권리 행사의 대리인

정보주체는 법정대리인 또는 위임장을 받은 대리인을 통해 위 권리를 행사할
수 있다(PIPA §38 ①항, GDPR Art. 80, CCPA §1798.135). 이 경우 회사는 위임
장과 대리인의 신분증 사본 제출을 요청할 수 있다.

### 7.3 응답 기한

회사는 정보주체의 권리 행사 요구를 다음 기한 내에 처리한다.

- 한국법(PIPA §35–§37): 10일 이내, 부득이한 경우 사유 통지 후 연장 가능.
- GDPR Art. 12(3): 1개월 이내, 복잡성에 따라 추가 2개월 연장 가능(연장
  사실은 1개월 내 통지).
- CCPA §1798.130: 45일 이내, 추가 45일 연장 가능.

### 7.4 권리 행사가 거부될 수 있는 경우

다음의 경우 회사는 권리 행사를 거부하거나 제한할 수 있다(PIPA §35 ④항·§36
①항 단서, GDPR Art. 12(5) 명백히 부당한 요구, CCPA §1798.130(a)(2)
verifiable consumer request 미충족).

- 법률에서 열람·정정·삭제를 금지·제한하는 경우.
- 다른 정보주체의 권리를 부당하게 침해할 우려가 있는 경우.
- 동일·유사한 요구를 명백히 반복적으로 제기하여 부당한 부담을 초래하는
  경우(GDPR Art. 12(5)(b)).

## 8. 개인정보의 안전성 확보 조치

회사는 「개인정보 보호법」 제29조 및 「개인정보의 안전성 확보조치 기준」
(개인정보보호위원회 고시) 에 따라 다음과 같은 기술적·관리적 보호조치를
취하고 있다.

### 8.1 관리적 조치

- **개인정보 보호책임자(CPO) 지정** — §10 참조.
- **취급자 최소화**: 개인정보를 취급하는 인원을 운영자 본인 + 외부 자문
  으로 제한.
- **접근 권한 관리**: Cloudflare/Supabase 운영 콘솔 접근은 2단계 인증
  필수.
- **개인정보 처리방침의 수립·공개** — 본 정책.

### 8.2 기술적 조치

- **OAuth Scope 최소화**: 본 서비스는 Google API Services User Data Policy
  의 Limited Use 정책에 따라 calendar 분류·색상 변경에 필요한 최소
  scope 만 요청한다(`docs/security-principles.md` Principle 3).
- **테넌트 격리**: 모든 DB 쿼리는 사용자 ID 단위로 분리된다(`src/CLAUDE.md`
  "Tenant isolation"). 토큰 암호화 회전 cron 의 cross-user SELECT 는 유일
  한 명시적 예외이며, 다른 모든 쿼리는 `where(eq(table.user_id, ...))` 가
  강제된다.
- **OAuth 토큰 암호화**: `TOKEN_ENCRYPTION_KEY` 로 AES-GCM 암호화 저장
  (`src/CLAUDE.md` "Token rotation (§3 후속)"). 키 회전 시 dual-key
  fallback 으로 무중단 회전 지원.
- **전송 구간 암호화**: 모든 외부 API 호출 및 정보주체 통신은 TLS 1.2
  이상으로 암호화.
- **백엔드 의존(E2E) 강제**: 백엔드 통신 실패 시 처리 중단 — 로컬 fallback
  이 없어 PII 가 우회 경로로 처리되지 않음(`docs/architecture-guidelines.md`).
- **로그 마스킹**: 본 정책 §2.4 에 명시된 10개 필드의 자동 마스킹 + 요청·
  응답 본문 / Authorization 헤더 / 캘린더 이벤트 페이로드의 로그 기록 금지.
- **접근 기록 보관** — 「안전성 확보조치 기준」 §8 에 따라 개인정보 처리
  시스템 접근기록을 1년 이상 보관(Cloudflare/Supabase 의 audit log 활용).

<!-- LEGAL-REVIEW: 「개인정보의 안전성 확보조치 기준」 (개인정보보호위원회
고시 2023-6) 의 9개 분야(내부 관리계획·접근 권한·접근 통제·암호화·접속기록·
악성프로그램·물리적 안전·재해·재난·기타) 매핑. 서비스 규모(개인 운영자급)
에 따라 의무 적용 범위 차이가 있어 자문 검토 필요. -->

## 9. 미성년자(아동·청소년)의 개인정보 보호

### 9.1 만 14세 미만 아동의 가입 제한 (PIPA §22의2)

회사는 만 14세 미만 아동의 개인정보를 수집·이용·제공할 수 없다. 본 서비
스는 Google Workspace Add-on 으로서 통상 만 14세 이상의 직장인·학생을 대상
으로 하며, 회원가입 시점에 다음 절차로 만 14세 미만 가입을 차단한다.

- Google Workspace for Education(K-12) 도메인의 만 14세 미만 학생 계정으로
  부터의 가입 시도는 자동 차단. (운영자가 Google Workspace Admin Console
  의 도메인 정보를 통해 K-12 도메인 여부를 확인하고, 차단 트리거를 운영
  한다 — 자세한 기술적 차단 로직은 publish 직전 구현 예정.)
- 가입 시 만 14세 미만임이 사후 확인된 경우 즉시 회원탈퇴 처리 및 수집된
  개인정보 파기.

### 9.2 만 13세 미만 미국 거주 아동 (COPPA)

회사는 미국 「Children's Online Privacy Protection Act」(COPPA) 에 따라 만
13세 미만 아동의 개인정보를 고의로 수집·이용하지 않는다. 만 13세 미만임을
인지한 경우 즉시 데이터 파기.

### 9.3 만 16세 미만 EU 거주 아동 (GDPR Art. 8)

회사는 GDPR Art. 8 에 따라 만 16세 미만 EU 거주 정보주체에 대해 정보사회
서비스를 제공할 때 친권자·법정대리인의 동의를 받아야 하나, 본 서비스는
만 16세 미만 사용자를 대상으로 하지 않는다(Workspace Add-on 의 일반적 사용
대상은 직장인·고등학생 이상). 회원국별 14–16세 별도 기준이 적용될 수 있다.

<!-- LEGAL-REVIEW: 미성년자 정책 본문은 자문이 검토 후 publish 본문에서
"K-12 도메인 자동 차단 구현 완료" 시점까지의 운영 리스크를 평가해야 한다.
미구현 상태로 publish 하면 PIPA §22의2 위반·COPPA $51,744/violation 위험
(2026 미국 FTC 인플레 조정 기준)을 노출한다. 출시 직전 차단 로직 구현이
실무적으로 가장 빠른 미티게이션. -->

## 10. 개인정보 보호책임자 (CPO) 및 연락처

회사는 정보주체의 개인정보를 보호하고 개인정보와 관련한 불만 처리·피해
구제 등을 위해 다음과 같이 개인정보 보호책임자(Chief Privacy Officer)를
지정한다.

| 구분 | 정보 |
|---|---|
| 개인정보 보호책임자 | (성명 — publish 시점에 운영자 본인 명의로 확정) |
| 직책 | 운영자 |
| 연락처 (이메일) | `support@autocolorcal.app` |
| 처리방침 일반 문의 | 동일 |

GDPR 이 요구하는 EU 대리인(Art. 27) 및 데이터 보호 책임자(Art. 37) 의 지정
의무는 자문 회신 시 본 서비스의 처리량·처리 성격에 따라 최종 결정한다.
(잠정 결론: 정기적·체계적 모니터링 또는 대규모 처리에 해당하지 않을 가능성
이 있으나, calendar 메타데이터의 LLM 처리가 "대규모" 에 해당하는지 자문
판단 필요.)

<!-- LEGAL-REVIEW:
1) PIPA §31 ①항은 CPO 지정을 의무화하고 있으며, 「안전성 확보조치 기준」 별표
   상 일정 규모 이하 사업자도 사업주(개인사업자) 가 CPO 를 겸임할 수 있다.
2) GDPR Art. 27 EU 대리인 지정은 EU 거주 정보주체에게 정기적으로 서비스를
   제공하는 비-EU 사업자의 의무이며, Workspace Marketplace 글로벌 배포 시
   EU 사용자 노출 가능성이 있어 자문 측 결론에 따라 EU 대리인 지정 검토
   필요.
3) DPO 지정 의무(Art. 37) 는 (a) 공공기관, (b) 정기적·체계적 대규모 모니터링,
   (c) 민감정보 대규모 처리 중 하나에 해당해야 하며, 본 서비스는 (b)·(c) 가
   양가적이라 자문 판단 필요. -->

## 11. 권익침해 구제방법

정보주체는 개인정보침해로 인한 구제를 받기 위해 다음 기관에 분쟁해결·상담
등을 신청할 수 있다(아래 기관은 회사와 별개의 기관으로, 회사의 자체적인
개인정보 불만처리, 피해구제 결과에 만족하지 못하시거나 보다 자세한 도움이
필요하신 경우 문의하여 주시기 바랍니다).

- **개인정보 분쟁조정위원회**: (국번 없이) 1833-6972 / [www.kopico.go.kr](https://www.kopico.go.kr)
- **개인정보 침해신고센터 (한국인터넷진흥원, KISA)**: (국번 없이) 118 / [privacy.kisa.or.kr](https://privacy.kisa.or.kr)
- **대검찰청**: (국번 없이) 1301 / [www.spo.go.kr](https://www.spo.go.kr)
- **경찰청 사이버범죄 신고시스템**: (국번 없이) 182 / [ecrm.police.go.kr](https://ecrm.police.go.kr)

EU 거주 정보주체는 거주 회원국의 감독기관(Supervisory Authority) 에 GDPR
Art. 77 에 따라 진정을 제기할 수 있다.

<!-- LEGAL-REVIEW: PIPA §30 ①항 8호 + 「개인정보 처리방침 작성지침」 권고
사항. 4개 기관 enumeration 은 표준 양식. 외부 기관 URL 인라인 정책은 본
처리방침이 사용자 대면 산출물이라 README §4 의 "vendor URL 인라인 금지" 와
다르게 취급 가능 — 다만 자문 측 최종 확정 필요. -->

## 12. 개정 및 통지

본 정책의 내용 추가·삭제 및 수정이 있을 경우 시행 30일 전부터 GAS Add-on
공지사항 및 본 처리방침 게시 페이지(`https://autocolorcal.app/privacy`) 를
통해 사전 통지한다. 다만, 정보주체의 권리에 중대한 영향을 미치는 변경의
경우 시행 30일 전부터 명확하게 통지하고 정보주체의 명시적 동의를 다시
받는다.

정보주체가 변경된 정책에 동의하지 않을 경우 §6.2 자기-삭제 절차를 통해
회원탈퇴할 수 있다.

<!-- LEGAL-REVIEW: PIPA §30 ②항(처리방침 변경 시 통지 의무) + 약관규제법
§3 ②항(중요한 사항의 명시·설명 의무) 정합. 30일 사전 통지는 표준이나,
"중대한 변경" 의 정의가 자문 검토 영역. -->

---

**시행일**: 본 정책은 publish 일자부터 시행된다(시행일 — `[YYYY-MM-DD]`).
**최종 개정일**: 2026-05-05 (1차 자문 검토 redline).
**버전**: v0.1-draft-rev1.

## Cross-references

- 본 정책 본문이 인용한 코드 ground truth 위치:
  - `src/config/constants.ts` — OAuth scope 목록
  - `src/services/piiRedactor.ts` — PII 마스킹 구현
  - `src/CLAUDE.md` "Account deletion (§3 row 179)" — 계정 삭제 절차
  - `src/CLAUDE.md` "Token rotation (§3 후속)" — 토큰 암호화 회전
  - `src/CLAUDE.md` "Observability tables (§6 Wave A)" / "(§6 Wave B)" —
    저장 데이터 enumeration
  - `src/CLAUDE.md` "Log redaction contract" — 로그 마스킹 필드 목록
  - `src/CLAUDE.md` "Tenant isolation" — DB 쿼리 격리 invariant
  - `docs/architecture-guidelines.md` "Halt on Failure" / "Hybrid
    Classification Engine"
  - `docs/security-principles.md` Principles 1-5
- 동반 문서:
  - [`docs/legal/terms-of-service.md`](./terms-of-service.md) — 서비스 이용
    약관 (초안)
  - [`docs/assets/marketplace/sub-processors.md`](../assets/marketplace/sub-processors.md)
    — sub-processor disclosure (정본)
  - [`docs/assets/marketplace/processing-region.md`](../assets/marketplace/processing-region.md)
    — 처리 위치 disclosure (정본)

## 자문 검토 시 우선 확인 항목 (Round 1 redline 후 잔존)

법률 자문에게 의뢰서로 그대로 첨부 가능. 자문이 검토 후 본문 갱신.
(2026-05-05 1차 redline 에서 일부 항목은 본문에 직접 반영되었으며, 본 섹션
은 잔존 자문 영역을 가리킨다.)

### 적용 법 매트릭스

- **한국 사용자 한정**: 개인정보보호법 / 정보통신망 이용촉진 및 정보보호 등에
  관한 법률 적용. 동의 절차 / 처리 항목 명시 / 처리 목적 / 보유 기간 / 위탁
  / 국외 이전 동의 양식.
- **한국 + 해외 노출** (Workspace Marketplace는 글로벌): GDPR (EU) / CCPA
  (캘리포니아) / LGPD (브라질) 등 추가 검토. 본 서비스는 가입 자체에 글로벌
  Google 계정이 사용되므로 글로벌 노출 가능성 매우 높음.

### GDPR DPO 의무 여부

- 처리량 / 민감 정보 여부 기준. 본 서비스는 calendar 메타데이터(이벤트
  본문)를 in-transit으로만 처리하나, OAuth identifier는 저장됨.
- DPO 지정 의무 / DPIA 수행 의무 검토 필요.

### 미성년자 정책

- 한국: 만 14세 미만 동의 절차 (법정대리인 동의).
- COPPA (미국): 만 13세 미만 차단.
- GDPR-K (EU): 만 16세 미만 (회원국별로 13-16세 사이에서 자유 설정 가능).
- 본 서비스는 Google Workspace Add-on이라 일반적으로 만 18세 이상의 직장인
  / 학생이 사용하나, 정책상 명시 필요.

### 국외 이전

- Cloudflare 글로벌 엣지: 미국 본사 + 글로벌 PoP.
- Supabase: 사용자 선택 region (한국 사용자라면 Seoul / Tokyo / Singapore).
- OpenAI: 미국 (선택적, `OPENAI_API_KEY` 설정 시).
- 한국 → EU / 미국 국외 이전 동의서 양식 / 적정성 결정.

### 사용자 권리 행사 채널

- 한국 개인정보 보호책임자 지정 (CPO) 의무 / 법인 표시.
- 분쟁조정위원회 안내 (`개인정보 분쟁조정위원회 / 한국인터넷진흥원 (KISA)
  개인정보침해신고센터`).
- EU DPO 의무 시 DPO 연락처.

### 데이터 보유 기간 법적 충족성

- 세션 7일 — 적절한가, 더 짧아야 하는가.
- OAuth token revoke 또는 삭제까지 — 명시적 사용자 통제 흐름.
- counters 무기한 — 익명 집계라도 보존 기간 명시 권고 검토.

### 본문 표현의 법적 효력 검수

- "best-effort" / "silent skip" 표현이 한국 법률 문서로 적합한지.
- 면책조항 / 책임 제한 (한국 약관규제법 위반 표현 점검).
- 가용성 / SLA 표현 ("MVP 단계" 등)의 법적 효력 / 사용자 기대권 충돌.
- 시행일 / 개정 표시 양식.

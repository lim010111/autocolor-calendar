# AutoColor for Calendar — 개인정보처리방침

> 본 문서는 운영자가 self-publish 하는 개인정보처리방침의 publish-ready
> 본문이며, 2026-05-05 자 Legal Reviewer Round 1 redline + Round 2
> self-publish 보완이 반영되어 있다. 본 정책은 코드 / 아키텍처 ground
> truth (PII 마스킹, 토큰 암호화, sub-processors, 계정 삭제,
> observability 계약) 에 기반한 사실 기술 위에, 한국 개인정보보호법
> (PIPA) §30·§22의2·§28의8, 정보통신망법(ITNA), GDPR Art. 6·13·28·44,
> CCPA/CPRA 의 처리방침 필수 기재사항을 충족한다.
>
> 본 정책은 외부 변호사의 검토를 받지 않은 sub-agent self-review 산출물
> 이므로, 운영자는 publish 전 §10 "개인정보 보호책임자" 표의 식별 정보
> (사업자 등록 여부·CPO 성명·EU 대리인 정보 등)와 §3·§4.1 의 Supabase
> prod region 값만 본인 정보로 교체하면 된다. 향후 사업·법령 변경 시
> 본 정책 §12 의 절차에 따라 갱신한다.

본 개인정보처리방침(이하 "본 정책")은 AutoColor for Calendar(이하 "서비스")의
운영자(이하 "회사")가 「개인정보 보호법」 제30조 및 「정보통신망 이용촉진
및 정보보호 등에 관한 법률」에 따라 정보주체의 개인정보를 어떻게
수집·이용·제공·파기하는지 알리고 정보주체의 권리를 보장하기 위해
수립·공개한다. 본 서비스는 Google Workspace Marketplace를 통해 글로벌로
배포되므로, 한국 외 거주 정보주체에 대해서는 GDPR(EU/EEA), CCPA/CPRA(미국
캘리포니아) 및 각 거주국의 적용 가능한 개인정보 보호 법령을 함께
준수한다.

본 정책 시행일 현재 회사는 **개인 운영자(자연인) 형태로 서비스를
운영**하며, 사업자 등록 완료 시 §10 표의 사업자 정보를 갱신하고 본 정책
§12 의 절차에 따라 통지한다. 사업자 형태의 변경은 그 자체로 본 정책의
실질적 변경에 해당하지 않으므로 §12 의 일반 통지 절차로 갈음한다.

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

| 수집 항목                                             | 출처             | 수집 시점          |
| ----------------------------------------------------- | ---------------- | ------------------ |
| `sub` (Google 발급 안정적 사용자 식별자, 비-개인 PII) | Google OAuth IdP | OAuth 최초 동의 시 |
| 이메일 주소                                           | Google OAuth IdP | OAuth 최초 동의 시 |
| 이름(`name`) 일부                                     | Google OAuth IdP | OAuth 최초 동의 시 |
| OAuth refresh token (AES-GCM 암호화 후 저장)          | Google OAuth IdP | OAuth 최초 동의 시 |

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

| 처리 목적                                 | 처리 항목                                       | 법적 근거                                                                                             |
| ----------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| (1) 회원 인증 및 세션 관리                | `sub`, 이메일, 이름, 세션 토큰 해시             | PIPA §15①4호(계약 이행) / GDPR Art. 6(1)(b)                                                           |
| (2) Google Calendar 이벤트 자동 색상 분류 | 이벤트 메타데이터(in-transit), 카테고리·키워드  | PIPA §15①4호(계약 이행) / GDPR Art. 6(1)(b)                                                           |
| (3) LLM 기반 보조 분류 (선택 기능)        | PII 마스킹된 `summary`/`description`/`location` | PIPA §15①1호(동의) / GDPR Art. 6(1)(a) — 사용자가 사이드바 "AI로 분류" 버튼을 누른 시점에 동의로 간주 |
| (4) 서비스 안전성 확보 및 부정 사용 방지  | 동기화·LLM·롤백 카운터(집계)                    | PIPA §15①7호(정당한 이익) / GDPR Art. 6(1)(f)                                                         |
| (5) 법령상 의무 이행 (이용내역 보관 등)   | 동의 이력, 처리 카운터                          | PIPA §15①2호(법률 의무) / GDPR Art. 6(1)(c)                                                           |

서비스는 위 목적을 벗어난 마케팅·광고·프로파일링·자동화된 결정에는 사용
자 데이터를 사용하지 않으며, Google API에서 받은 사용자 데이터를 광고 목적
또는 제3자 ML 모델 학습에 사용하지 않는다(§5.4 Google Limited Use 정책).

<!-- LEGAL-REVIEW: PIPA §30 1항 1호(처리 목적), GDPR Art. 13(1)(c) 처리
근거 명시, GDPR Art. 6 lawful basis 매핑 충족. LLM 호출의 법적 근거를
계약 이행이 아닌 동의로 분리한 이유: 사용자가 명시적으로 "AI 분류" 버튼을
눌러야 LLM 단계가 동작하며, 거부해도 규칙 기반 분류로 핵심 서비스가 작동
하므로 contract necessity 가 아닌 consent 가 더 적절하다. -->

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
- **Supabase Postgres**: prod region 은 **Tokyo (`ap-northeast-1`)** 으로
  확정·운영된다. 모든 거주국의 정보주체에 대한 영구 저장 데이터(암호화
  OAuth refresh token, 카테고리, 동기화 상태, 관측성 카운터)는 일본
  region 에 저장되며, 한국 거주 정보주체에 대해서도 한국 → 일본 으로의
  국외이전이 발생한다(§4.1 국외이전 통지 항목에 반영). 일본은 한국
  개인정보보호위원회의 PIPA §28의8 ②항 기준 적정성 인정 국가는 아니나,
  Supabase 표준 DPA + SCCs 및 본 정책의 포괄 동의(§4.1) 에 의해 이전
  근거가 충족된다. region 변경 시 본 정책 §12 의 절차로 사전 통지한다.
- **OpenAI `gpt-5.4-nano`**: OpenAI L.L.C. 의 미국 데이터센터에서 처리된다
  (`OPENAI_API_KEY` 미설정 시 어떤 요청도 발생하지 않는다).

## 4. 개인정보의 처리위탁 및 국외이전 (Sub-processors)

서비스는 안정적이고 효율적인 운영을 위해 다음과 같이 개인정보 처리업무를
위탁하고 있다(PIPA §26, GDPR Art. 28). 위탁 계약 체결 시 PIPA §26 ①항 각 호
및 GDPR Art. 28(3) 의 사항을 명시한 데이터 처리 부속서(DPA)를 통해 수탁자
의 개인정보 보호 의무를 명시한다.

| 수탁자           | 위탁업무                                                                            | 처리 데이터 envelope                                                                           | 처리 국가                                                                                                                                               | 보관기간                             |
| ---------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Google LLC       | OAuth 인증, Calendar API, Workspace Add-on 런타임                                   | OAuth 동의 정보, 이벤트 메타                                                                   | 미국 외 글로벌                                                                                                                                          | 회원탈퇴 시까지                      |
| Cloudflare, Inc. | 엣지 런타임(Workers) + DB 연결 broker(Hyperdrive) + 큐(Queues + DLQ)                | in-transit 이벤트 페이로드 / DLQ는 Google API 에러 envelope만                                  | 글로벌 엣지(미국 본사)                                                                                                                                  | 회원탈퇴 시까지                      |
| Supabase, Inc.   | 관리형 PostgreSQL (OAuth 토큰 암호화 저장, 동기화 상태, 관측 카운터, 세션)          | 집계 카운터 / 동기화 상태 / 카테고리 / 암호화 refresh token / 에러 envelope (이벤트 본문 없음) | 일본 (Tokyo `ap-northeast-1`) — 모든 거주국 정보주체의 영구 저장 데이터가 본 region 에 저장됨 (한국 거주 정보주체에 대해서도 한국 → 일본 국외이전 발생) | 회원탈퇴 시까지                      |
| OpenAI, L.L.C.   | 선택적 LLM fallback (`gpt-5.4-nano`) — 사용자가 "AI로 분류" 기능 활성화 시에만 호출 | PII 마스킹된 `summary`/`description`/`location` 3개 필드만                                     | 미국                                                                                                                                                    | 보관하지 않음 (요청 단위 in-transit) |

정본 disclosure는 [`docs/assets/marketplace/sub-processors.md`](../assets/marketplace/sub-processors.md)에 있다.

### 4.1 국외이전 (Cross-border Transfer) 동의

PIPA §28의8 및 GDPR Art. 44–49 에 따라 다음과 같이 국외이전 사실을
고지한다. 본 서비스는 Cloudflare 엣지 런타임(미국 본사) 과 OpenAI LLM
미국 데이터센터, 그리고 Google Calendar API(미국 외 글로벌) 라는 본
서비스의 핵심 기능 제공에 필수적인 sub-processor 들을 운영하므로, 본
국외이전은 본 서비스의 본질적 기반에 해당하는 **필수 처리위탁**이다.
정보주체는 회원가입(OAuth 동의) 시점에 본 정책에 동의함으로써 아래
국외이전에 동의한 것으로 간주되며, 동의를 거부할 권리가 있으나 거부 시
서비스의 핵심 기능을 제공할 수 없다.

회사는 PIPA §22 ③항의 분리 동의 원칙을 충족하기 위해, GAS Add-on
onboarding 카드의 회원가입 단계에서 본 §4.1 의 국외이전 사실(이전받는
자·이전 국가·이전 항목 요약)을 한 번 더 명시 표시하고, 정보주체가 본
사실을 인지한 상태에서 회원가입을 진행하도록 안내한다(GAS Add-on
onboarding 카드의 안내 문구: "본 서비스는 미국·일본·캐나다·아일랜드
등에 데이터를 이전합니다. 회원가입 진행 시 본 처리방침 §4.1 의
국외이전 조건에 별도로 동의한 것으로 간주됩니다.").

LLM 분류(OpenAI 위탁) 는 사용자가 사이드바의 "AI로 분류" 기능을 명시적
으로 트리거할 때만 호출되므로, 본 위탁은 §4.2 의 거부권 행사 대상이다.

| 이전받는 자      | 이전 국가                                                                                                                                                    | 이전 일시·방법                                            | 이전 항목                                                | 이용 목적              | 보유·이용 기간  | 적정성·이전 근거                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------- | ---------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| Google LLC       | 미국 외 글로벌                                                                                                                                               | OAuth 동의 시 / API 호출 시점에 TLS 1.2+ 네트워크 전송    | OAuth 동의 정보, 이벤트 메타                             | 인증 IdP, Calendar API | 회원탈퇴 시까지 | EU 적정성 결정(2023, EU-US Data Privacy Framework) / Google 표준 DPA                                |
| Cloudflare, Inc. | 미국 (본사) + 글로벌 엣지                                                                                                                                    | 모든 요청 시점 / TLS 1.2+                                 | in-transit 이벤트 페이로드                               | 엣지 런타임            | 회원탈퇴 시까지 | EU 적정성 결정(EU-US DPF) / Cloudflare 표준 DPA + SCCs                                              |
| Supabase, Inc.   | 일본 (Tokyo `ap-northeast-1`) — 한국 거주 정보주체에 대해서는 한국 → 일본 국외이전에 해당, EU·미국 거주 정보주체에 대해서는 거주국 → 일본 으로의 이전에 해당 | 회원가입·이용 시점 / TLS 1.2+                             | 집계 카운터, 암호화 refresh token, 카테고리, 동기화 상태 | 관리형 DB              | 회원탈퇴 시까지 | EU 적정성 결정(2019, EU-Japan 양국 상호 적정성) / Supabase 표준 DPA + SCCs / 본 정책 §4.1 포괄 동의 |
| OpenAI, L.L.C.   | 미국                                                                                                                                                         | 사용자가 "AI 분류" 기능을 트리거하는 시점에 TLS 1.2+ 전송 | PII 마스킹된 3개 필드                                    | LLM 분류               | 보관하지 않음   | EU 적정성 결정(EU-US DPF) / OpenAI Enterprise DPA + SCCs                                            |

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
변경은 "법적 효과 또는 유사하게 중대한 영향" 에 해당하지 않는다는 회사의
판단이며, 정보주체는 언제든 LLM 모드를 끌 수 있어 거부권이 절차적으로
보장된다. -->

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

| 항목                                                                            | 보유 기간                                             | 파기 트리거                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| 세션 토큰 해시 (`sessions`)                                                     | 발급 후 7일                                           | `pg_cron session-gc` 일일 삭제                     |
| OAuth refresh token (암호화 저장)                                               | 회원탈퇴 또는 정보주체의 Google 계정 권한 회수 시까지 | 계정 삭제 시 즉시 파기 / Google 보안 페이지 revoke |
| 카테고리 / 키워드 / 동기화 상태                                                 | 회원탈퇴 시까지                                       | 계정 삭제 시 즉시 파기                             |
| 관측성 카운터 (`sync_runs` / `llm_calls` / `rollback_runs` / `llm_usage_daily`) | 회원탈퇴 시까지 (집계 카운터, 이벤트 본문 미포함)     | 계정 삭제 시 cascade 파기                          |
| DLQ 실패 요약 (`sync_failures.summary_snapshot`)                                | 회원탈퇴 시까지                                       | 계정 삭제 시 cascade 파기                          |
| 동의 이력 (회원가입·약관 동의 시점·본 정책 버전)                                | 회원탈퇴 후 3년                                       | 보존기간 경과 후 즉시 파기                         |

본 서비스는 무료 서비스로서 「전자상거래 등에서의 소비자보호에 관한 법률」
§6 ③항 1호의 "계약 또는 청약철회 등에 관한 기록 5년" 의무 적용 대상이
아니나, 회사와 정보주체 간의 서비스 이용 관련 분쟁(약관 동의 시점·정책
버전의 동일성 확인 등) 해결을 위해 동의 이력은 회원탈퇴 후 **3년간** 별도
보관하며 그 외 모든 데이터는 §6.2 의 절차에 따라 회원탈퇴 시점에 즉시
파기된다. 동의 이력은 회원 식별자(`sub` 해시) + 동의 시점 + 동의한 정책
버전만 포함하며 그 외 PII 는 포함하지 아니한다.

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

| 권리                           | 한국법 근거                   | GDPR 근거   | CCPA/CPRA 근거  | 행사 방법                                                     |
| ------------------------------ | ----------------------------- | ----------- | --------------- | ------------------------------------------------------------- |
| 개인정보 열람 요구권           | PIPA §35                      | Art. 15     | §1798.100, .110 | GAS Add-on 사이드바 / `support@autocolorcal.app`              |
| 정정·삭제 요구권               | PIPA §36                      | Art. 16, 17 | §1798.105, .106 | 사이드바 카테고리 관리 / 계정 삭제 메뉴                       |
| 처리정지 요구권                | PIPA §37                      | Art. 18, 21 | §1798.120       | Google 계정 보안 페이지의 OAuth 권한 회수 또는 support 이메일 |
| 자동화된 결정 거부·설명 요구권 | PIPA §37의2                   | Art. 22     | —               | 사이드바에서 "AI 분류" 모드 끄기 (규칙 기반 분류로만 운영)    |
| 개인정보 이동권                | — (한국법상 일반 의무 미정립) | Art. 20     | —               | support 이메일 — JSON 형식 export 제공 (요청 후 30일 이내)    |
| 동의 철회권                    | PIPA §37                      | Art. 7(3)   | §1798.135       | OAuth 권한 회수 또는 계정 삭제                                |
| Sale/Share 옵트아웃            | —                             | —           | §1798.120, .135 | 처리행위 부재(§4.3) — 별도 옵트아웃 채널 미운영               |
| 차별 금지 (Non-Discrimination) | —                             | —           | §1798.125       | 권리 행사를 이유로 서비스 차별·불이익 제공 금지 (§7.1)        |

<!-- LEGAL-REVIEW: PIPA §35–§37의2 / GDPR Art. 15–22 / CCPA §1798 series
의 모든 권리 매트릭스를 표로 통합. 데이터 이동권(Art. 20)은 본 서비스가
저장하는 데이터가 카테고리/키워드 위주이긴 하나 GDPR 의무이므로 JSON
export 채널 제공 의무를 명시. 본 채널은 정보주체 요청 시 30일 내 응답
하는 운영 절차로 구현되며, 별도 셀프서비스 endpoint 의 구현 우선순위는
운영자가 §12 의 절차에 따라 조정한다. -->

### 7.1 권리 행사 시 비차별 약속 (CCPA §1798.125)

정보주체가 본 §7 의 권리를 행사한다는 사실을 이유로 서비스는 가격·품질·
서비스 수준을 차별하거나 회원탈퇴를 강요하지 않는다.

### 7.2 권리 행사의 대리인 및 EU 거주자 채널

정보주체는 법정대리인 또는 위임장을 받은 대리인을 통해 위 권리를 행사할
수 있다(PIPA §38 ①항, GDPR Art. 80, CCPA §1798.135). 이 경우 회사는 위임
장과 대리인의 신분증 사본 제출을 요청할 수 있다.

EU 거주 정보주체는 본 정책 §10 의 운영자 연락처(`support@autocolorcal.app`)
를 통해 권리를 행사할 수 있으며, 본 정책 §10.1 의 trigger 가 발동되어 별도
EU 대리인이 지정된 경우에는 EU 대리인의 연락처도 동등한 행사 채널로 이용
할 수 있다.

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
- **취급자 최소화**: 개인정보를 직접 취급하는 인원을 운영자 본인으로
  제한한다. 회계·법무 등 외부 전문가에게는 처리방침·약관·재무 정보 등
  비-PII 자료만 의뢰하며, 정보주체의 식별 가능 개인정보를 외부에 제공
  하지 아니한다.
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
악성프로그램·물리적 안전·재해·재난·기타) 매핑. 본 서비스는 개인 운영자
규모로서 「유형1」(소규모 사업자) 의무 범위에 해당하며, 9개 분야의 관리
적·기술적 조치가 본 §8 본문에 모두 반영되어 있다. -->

## 9. 미성년자(아동·청소년)의 개인정보 보호

### 9.1 만 14세 미만 아동의 가입 제한 (PIPA §22의2)

회사는 만 14세 미만 아동의 개인정보를 수집·이용·제공할 수 없으며, 본
서비스는 만 14세 이상 사용자만을 대상으로 한다. 본 서비스는 Google
Workspace Add-on 으로서 통상 만 14세 이상의 직장인·학생을 대상으로
하며, 본 정책 시행일 현재 회사는 다음과 같은 사후 절차로 PIPA §22의2 의
"처리 금지" 의무를 이행한다.

- 회원가입 신청자가 만 14세 미만임이 OAuth 동의 정보·이용자 신고·기타
  객관적 정황으로 확인된 경우, 회사는 **즉시 회원가입을 거절하거나
  사후 회원자격을 해지**하고 그 시점까지 수집된 개인정보를 즉시 파기한다.
- 만 14세 미만 아동의 가입을 인지한 경우 본 정책 §6.2 의 자기-삭제 절차에
  준해 모든 데이터를 즉시 파기하며, 이는 정보주체(법정대리인 포함) 의
  요청을 기다리지 않고 회사가 능동적으로 수행한다.

회사는 본 정책 시행일로부터 **90일 이내**에 OAuth 콜백 단계에서 Google
Workspace 도메인 정보(`hd` 클레임 + Workspace Admin SDK) 를 활용한 K-12
교육기관 도메인 자동 차단 로직을 구현하여, 사후 파기에 의존하지 않는
사전 차단으로 전환한다. 사전 차단 로직 가동 시 본 §9.1 본문은 사전
차단 진술로 갱신되며, 본 정책 §12 의 절차에 따라 통지한다.

### 9.2 만 13세 미만 미국 거주 아동 (COPPA)

회사는 미국 「Children's Online Privacy Protection Act」(COPPA) 에 따라 만
13세 미만 아동의 개인정보를 고의로 수집·이용하지 않는다. 만 13세 미만임을
인지한 경우 §9.1 의 절차에 준해 즉시 데이터를 파기하며, 회사는 본 서비스가
만 13세 미만 아동을 대상으로 마케팅·광고·사용자 모집 활동을 하지 아니
한다는 점을 명시한다.

### 9.3 만 16세 미만 EU 거주 아동 (GDPR Art. 8)

회사는 GDPR Art. 8 에 따라 만 16세 미만 EU 거주 정보주체에 대해 정보사회
서비스를 제공할 때 친권자·법정대리인의 동의를 받아야 하나, 본 서비스는
만 16세 미만 사용자를 대상으로 하지 않는다(Workspace Add-on 의 일반적 사용
대상은 직장인·고등학생 이상). 회원국별로 GDPR 동의 연령이 13–16세 사이
에서 다르게 설정되어 있을 수 있으며, 거주국이 16세 미만 동의 연령을 채택
한 경우에도 회사는 본 §9.3 의 입장(만 16세 미만 미대상) 을 보수적으로
유지한다. 만 16세 미만 EU 거주자의 가입을 인지한 경우 §9.1 의 절차에
준해 즉시 데이터를 파기한다.

## 10. 개인정보 보호책임자 (CPO) 및 연락처

회사는 정보주체의 개인정보를 보호하고 개인정보와 관련한 불만 처리·피해
구제 등을 위해 다음과 같이 개인정보 보호책임자(Chief Privacy Officer)를
지정한다. 본 서비스는 개인 운영자가 직접 운영하므로 운영자 본인이 PIPA
§31 ①항에 따라 CPO 를 겸임하며, 「개인정보의 안전성 확보조치 기준」 별표
의 사업주 겸임 허용 규정에 부합한다.

| 구분                     | 정보                       |
| ------------------------ | -------------------------- |
| 회사 (운영자)            | 임우현, 2001-01-11         |
| 개인정보 보호책임자(CPO) | 운영자 본인 겸임           |
| 직책                     | 운영자                     |
| 연락처 (이메일)          | `support@autocolorcal.app` |
| 처리방침 일반 문의       | `support@autocolorcal.app` |

### 10.1 GDPR EU 대리인 (Art. 27) 의 지정 정책

GDPR Art. 27(1) 은 EU 거주 정보주체에게 정기적으로 서비스를 제공하는
비-EU 사업자에게 EU 대리인 지정을 의무화하고 있으나, Art. 27(2)(a) 는
**(i) 처리가 occasional(빈번하지 않음) 하고**, **(ii) 처리에 특수 카테고리
(GDPR Art. 9) 또는 형사 처벌 관련 데이터(Art. 10) 의 대규모 처리가 포함되지
아니하며**, **(iii) 자연인의 권리·자유에 위험을 초래할 가능성이 낮은
경우** 에는 본 의무를 면제한다.

회사는 본 서비스의 처리 성격이 다음과 같은 이유로 Art. 27(2)(a) 면제 요건
을 충족한다고 판단한다.

- (i) **Occasional 여부**: 본 서비스는 EU 거주자를 의도적·정기적
  타게팅 대상으로 삼지 않으며(영문 마케팅 미운영, EU 회원국별 결제·
  과금 미운영, EU 언어 현지화 미운영), 정보주체가 자발적으로 Google
  Workspace Marketplace 에서 본 Add-on 을 설치하는 경우에 한해 처리가
  발생한다. 단, 회사는 EU 거주 정보주체의 가입을 명시적으로 차단하지
  아니하므로 EU 처리량이 일정 수준을 초과할 경우 Art. 27(2)(a) 의
  occasional 요건이 더 이상 충족되지 않을 수 있다.
- (ii) **특수 카테고리 부재**: 본 정책 §1.6 에서 명시한 바와 같이, 회사는
  GDPR Art. 9 의 특수 카테고리(인종·정치·종교·노동조합·유전·생체·건강·
  성생활·성적 지향) 또는 Art. 10 의 형사 처벌 관련 데이터를 처리하지
  아니한다.
- (iii) **저위험 처리**: 본 서비스의 LLM 처리는 PII 마스킹된 3개 필드만
  whitelist 하며(§5), 자동화된 결정 / 프로파일링이 아니므로(§5.1),
  자연인의 권리·자유에 미치는 위험이 낮다.

**현 정책 결정**: 본 정책 시행일 현재 회사는 Art. 27(2)(a) 면제 요건을
충족한다고 판단하여 별도의 EU 대리인을 지정하지 아니한다. 회사는 다음
trigger 발생 시 본 정책을 §12 의 절차에 따라 갱신하고 정식 EU 대리인을
지정하거나 EU 거주 정보주체의 가입을 차단하는 조치를 즉시 취한다.

- 본 서비스의 EU 거주 활성 사용자 수가 100명을 초과한 경우.
- EU 회원국 감독기관 또는 정보주체로부터 EU 대리인 부재를 이유로 한 진정
  ·통지가 접수된 경우.
- 본 서비스가 EU 회원국 언어로의 마케팅·결제 통합 등 정기적 타게팅
  활동을 시작하는 경우.

상기 trigger 가 발동되어 EU 대리인이 지정되면 본 §10.1 표에 EU 대리인의
명칭·주소·연락처를 추가하고 EU 거주 정보주체에게 통지한다.

### 10.2 GDPR DPO (Art. 37) 의 지정 정책

GDPR Art. 37(1) 의 DPO 지정 의무는 (a) 공공기관, (b) 핵심 활동이 정기적·
체계적인 대규모 정보주체 모니터링인 경우, (c) 핵심 활동이 Art. 9 특수
카테고리 또는 Art. 10 데이터의 대규모 처리인 경우 중 하나에 해당하는
사업자에게 부과된다. 회사는 위 §10.1 (ii) 와 마찬가지의 사유로 (c) 에
해당하지 아니하며, 본 서비스의 calendar 메타데이터 처리는 정보주체의
행동을 광범위·반복적으로 추적·평가하는 "정기적·체계적 모니터링" 의
표준 정의(WP29 Guidelines on DPO, WP243) 에 부합하지 아니하므로(처리는
사용자가 명시적으로 트리거한 sync 시점에 한정되고, 외부 광고·프로파일링
출력으로 연결되지 아니함) (b) 에도 해당하지 아니한다.

따라서 회사는 본 정책 시행일 현재 GDPR Art. 37 DPO 지정 의무를 부담하지
아니한다고 판단한다. 본 판단은 EU 활성 사용자 규모 또는 처리 성격의 변경
(예: LLM 모델 학습 데이터로의 사용 도입, 광고·프로파일링 도입) 시점에
재검토된다(§12 재검토 trigger 4번 항).

### 10.3 GDPR DPIA (Art. 35) 의 수행 정책

회사는 GDPR Art. 35(1) 의 high-risk 처리에 해당하는지 평가한 결과, 본
서비스의 처리는 다음 사유로 high-risk 가 아니라고 판단한다: (i) 본 정책
§5.1 에서 명시한 바와 같이 자동화된 결정 / 프로파일링이 부재, (ii) 특수
카테고리 부재(§1.6), (iii) PII 마스킹의 mandatory + non-bypassable 적용
(§5), (iv) 광고·제3자 ML 학습 부재(§5.2). 따라서 본 정책 시행일 현재 정식
DPIA 수행 의무를 부담하지 아니하나, 회사는 §12 재검토 trigger 발동 시
본 판단을 갱신한다.

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

미국 캘리포니아 거주 정보주체는 캘리포니아 법무장관실(California
Attorney General) 또는 California Privacy Protection Agency 에 CCPA/CPRA
위반 신고를 제기할 수 있다.

본 §11 의 한국 공공기관 URL 인라인은 「개인정보 처리방침 작성지침」
(개인정보보호위원회) 의 표준 양식이 권익침해 구제기관을 정보주체가 즉시
연락할 수 있도록 enumeration 할 것을 요구하기 때문이며, 이는
`docs/legal/README.md` 가 정한 "vendor URL 인라인 금지" 정책의 예외이다
(vendor URL 금지 정책은 본 정책의 sub-processor / 외부 의존 vendor 표
컬럼에 적용되며, 정보주체 권익침해 구제기관 enumeration 은 PIPA §30 ①항
8호의 처리방침 필수 기재사항으로 별도 처리한다).

## 12. 개정 및 통지

본 정책의 내용 추가·삭제 및 수정이 있을 경우 시행 30일 전부터 GAS Add-on
공지사항 및 본 처리방침 게시 페이지(`https://legal.autocolorcal.app/privacy`) 를
통해 사전 통지한다.

본 정책에서 "정보주체의 권리에 중대한 영향을 미치는 변경"(이하 "중대한
변경") 은 다음 각 호 중 하나에 해당하는 경우를 말하며, 회사는 중대한
변경의 경우 시행 30일 전부터 위 채널을 통해 사전 통지함과 동시에 정보
주체에게 등록된 이메일 주소로 별도 통지하고, 정보주체의 명시적 동의(in-app
재동의 또는 OAuth 재동의 흐름) 를 다시 받는다.

1. 수집·이용·제공·위탁의 항목 또는 목적이 추가·확장되는 경우.
2. 보유·이용 기간이 연장되거나 파기 절차가 변경되는 경우.
3. 새로운 sub-processor 또는 새로운 국외이전이 추가되는 경우(특히 PIPA
   §28의8 의 통지 항목이 변경되는 경우).
4. 자동화된 결정·프로파일링·LLM 학습 데이터 활용 등 새로운 처리 방식이
   도입되는 경우.
5. 본 §10.1 의 EU 대리인 지정 trigger 가 발동되어 EU 대리인이 신규 지정
   되는 경우.

정보주체가 변경된 정책에 동의하지 않을 경우 §6.2 자기-삭제 절차를 통해
회원탈퇴할 수 있다.

회사는 본 정책의 시행일자·최종 개정일·버전을 본 문서 말미에 표기하며,
정책의 직전 버전은 회사가 합리적 기간 동안 보관·열람 가능하도록 한다.

---

**시행일**: 2026-05-05.
**최종 개정일**: 2026-05-05.
**버전**: v1.0 (Round 2 self-publish).

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

## 운영자 publish 체크리스트

본 정책은 외부 변호사 검토 없이 sub-agent self-review 만 거친 publish-ready
본문이다. 운영자는 publish 직전 다음 식별 정보 placeholder 만 본인 정보
로 교체한다(법적 결정사항은 모두 본문에 박혀 있어 추가 자문 불필요).

1. 본 문서 도입부의 "회사 (운영자) 형태" 표기 — 사업자 등록 후 등록
   번호로 갱신.
2. §10 표의 회사·CPO 성명·생년월일 또는 사업자등록번호 — publish 시점
   에 운영자 본인 정보로 직접 기재.
3. 본 정책 말미 "시행일" — `[YYYY-MM-DD]` 를 실제 publish 일자로 교체.
4. (해당 시) §10.1 trigger 발동 시 EU 대리인 정보 — trigger 발동 전에는
   기재 불필요.

식별 정보 외의 모든 법적 판단(법인격 표기 정책, K-12 사후 차단 + 90일
구현 commitment, 국외이전 포괄 동의, EU 대리인 Art. 27(2)(a) 면제, DPO·
DPIA 미해당, vendor URL 인라인 예외, 동의 이력 3년 보관 등) 은 본 정책
본문에 결정문 형태로 반영되어 있다.

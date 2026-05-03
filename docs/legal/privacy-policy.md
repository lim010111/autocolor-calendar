# AutoColor for Calendar — 개인정보처리방침 (초안)

> 본 문서는 **법률 자문 검토 전의 1차 초안**이다. 코드 / 아키텍처 ground
> truth (PII 마스킹, 토큰 암호화, sub-processors, 계정 삭제, observability
> 계약)에 기반한 사실 기술만 담고 있으며, 법적 효력을 위한 표현 / 관할법 /
> 면책조항 / 분쟁해결 절차 / 미성년자 정책 / GDPR·CCPA 적용 여부 등은 자문이
> 검토 후 최종 확정한다.
>
> 이 초안의 책임은 코드와의 정합성을 유지하는 것이며, 실제 publish 시점에는
> 자문 회신을 반영한 본문으로 교체된다. 자문 검토 시 우선 확인 항목은 본
> 문서 마지막 H3 섹션에 정리되어 있다.

본 개인정보처리방침은 AutoColor for Calendar(이하 "서비스")의 운영자가 사용자
의 개인정보를 어떻게 수집·처리·저장·삭제하는지 사실 그대로 기술한다.

## 1. 수집하는 정보

### 1.1 Google 계정 식별자

서비스는 사용자 인증을 위해 다음 OAuth 권한을 요청한다 (`src/config/constants.ts`):

- `openid` — OpenID Connect 인증 표준.
- `email` — 사용자 이메일 주소(인증 식별 용도).
- `https://www.googleapis.com/auth/calendar` — Calendar 읽기.
- `https://www.googleapis.com/auth/calendar.events` — Calendar 이벤트 색상
  변경.

Google이 발급하는 `sub` (안정적 사용자 식별자), `email`, `name` 일부가 인증
세션 생성 시점에 수신된다.

### 1.2 Google Calendar 이벤트 메타데이터

서비스는 사용자가 등록한 캘린더의 이벤트 metadata를 읽어 색상 분류 규칙을
적용한다. 처리 대상 필드:

- `summary` (이벤트 제목)
- `description` (이벤트 본문)
- `location` (이벤트 장소)
- `attendees`, `creator.email`, `organizer.email` — LLM 분류 단계 진입 전
  **`destructure-and-omit`으로 제거**되어 OpenAI에 전송되지 않는다
  (`src/services/piiRedactor.ts`).

### 1.3 사용자 정의 데이터

- 카테고리 이름 / 키워드 / 색상 — 사용자가 명시적으로 입력.
- 동기화 상태(`sync_state`) — 캘린더별 동기화 토큰, watch 채널 정보.

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

## 3. 처리 위치 (Region)

처리 위치 정보의 정본은 [`docs/assets/marketplace/processing-region.md`](../assets/marketplace/processing-region.md)에 있다. 요약:

- **Cloudflare Workers / Hyperdrive / Queues**: 글로벌 엣지, region 핀 없음
  (`wrangler.toml`에 `region` 설정 없음).
- **Supabase Postgres**: prod 리전은 `TODO.md` §3 후속 "Prod 환경 활성화"
  완료 시점에 결정된다 (Seoul `ap-northeast-2` 권장).
- **OpenAI `gpt-5.4-nano`**: 벤더 published 정책에 따른다. `OPENAI_API_KEY`
  미설정 시 OpenAI에 어떤 요청도 가지 않는다.

## 4. 제3자 (Sub-processors)

서비스가 사용자 데이터를 전달하는 제3자 sub-processor의 정본 disclosure는
[`docs/assets/marketplace/sub-processors.md`](../assets/marketplace/sub-processors.md)에 있다. 요약:

| Sub-processor | 역할 | 데이터 envelope |
|---|---|---|
| Cloudflare | 엣지 런타임 + DB 연결 broker (Hyperdrive) + 큐 (Queues + DLQ) | 이벤트 페이로드 in-transit only; DLQ는 Google API 에러 envelope |
| Supabase | 관리형 PostgreSQL — OAuth 토큰(암호화), 동기화 상태, 카운터, 세션 | 집계 카운터 / 동기화 상태 / 카테고리 / 암호화된 refresh token / 에러 envelope (이벤트 본문 없음) |
| OpenAI | 선택적 LLM fallback (`gpt-5.4-nano`) | 3개 필드만 (`summary` / `description` / `location`) — PII 마스킹 후. `OPENAI_API_KEY` 미설정 시 호출 없음 |

## 5. PII 마스킹 (LLM 처리 전)

규칙 기반 매칭이 실패한 이벤트만 LLM 단계로 진입하며, 진입 전에 다음 redaction
이 mandatory 적용된다 (`src/services/piiRedactor.ts`, `docs/architecture-guidelines.md`
"Hybrid Classification Engine"):

- 이메일 주소 → `[email]` 토큰
- URL → `[url]` 토큰
- 전화번호 (한국 모바일 / 유선 / 1588 대표번호 / 국제번호) → `[phone]` 토큰
- `attendees`, `creator.email`, `organizer.email` 필드는 destructure-and-omit
  으로 완전 제거.

prompt 빌더는 `summary` / `description` / `location` 3개 필드만 whitelist
하며, 그 외 필드는 LLM에 도달하지 않는다.

## 6. 보존 및 삭제

| 항목 | 보존 기간 | 삭제 트리거 |
|---|---|---|
| 세션 (`sessions`) | 7일 | `pg_cron session-gc` 일일 삭제 (`TODO.md` §3 후속) |
| OAuth refresh token | 사용자 revoke 또는 계정 삭제까지 | 계정 삭제 / Google 보안 페이지 revoke |
| 카테고리 / 동기화 상태 | 계정 활성 동안 | 계정 삭제 |
| 관측성 카운터 (`sync_runs` / `llm_calls` / `rollback_runs`) | 무기한 (집계 데이터, 개인 식별 불가) | 계정 삭제 시 cascade |
| `sync_failures.summary_snapshot` | 무기한 | 계정 삭제 시 cascade |

### 6.1 사용자 자기-삭제

사용자는 `POST /api/account/delete` (인증 필요)로 즉시 모든 데이터를 삭제할
수 있다 (`src/CLAUDE.md` "Account deletion (§3 row 179)"):

1. Google OAuth refresh token revoke (best-effort).
2. 활성 watch 채널 stop (best-effort).
3. `DELETE FROM users WHERE id = ?` — FK cascade로 9개 사용자 스코프 테이블
   (`oauth_tokens` / `sessions` / `categories` / `sync_state` /
   `llm_usage_daily` / `sync_failures` / `llm_calls` / `rollback_runs` /
   `sync_runs`)이 일괄 삭제.
4. 세션 무효화 (cascade로 이미 삭제됨; defense-in-depth로 명시 revoke).

## 7. 사용자 권리

사용자는 다음 권리를 행사할 수 있다:

- **열람권**: GAS Add-on의 카테고리 관리 카드에서 등록한 카테고리 / 키워드를
  확인.
- **정정권**: 같은 카드에서 카테고리 수정 / 삭제.
- **삭제권**: `POST /api/account/delete` (계정 전체) 또는 카테고리 단위
  삭제 (해당 카테고리가 색칠한 이벤트는 자동 색상 롤백 — `src/services/colorRollback.ts`).
- **처리 거부권**: Google 계정 보안 페이지에서 OAuth revoke 시 즉시 모든
  처리 중단 (`docs/architecture-guidelines.md` "Halt on Failure"의 narrow
  exception).
- **데이터 이동권**: 본 서비스가 저장하는 데이터는 카테고리 / 키워드뿐이며,
  별도 export 엔드포인트는 제공하지 않는다 (저장량이 작고, GAS Add-on UI를
  통해 즉시 열람 가능). 추가 export가 필요한 사용자는 support 채널로 문의.

## 8. 보안 조치

- **Scope 최소화**: OAuth는 calendar 권한 외 추가 scope을 요청하지 않는다
  (`docs/security-principles.md` Principle 3).
- **테넌트 격리**: 모든 DB 쿼리는 사용자 ID 단위로 분리된다 (`src/CLAUDE.md`
  "Tenant isolation"). 토큰 회전 cron의 cross-user SELECT는 유일한 명시적
  예외이며, 다른 모든 query는 `where(eq(table.user_id, ...))` 가 강제된다.
- **토큰 암호화**: `TOKEN_ENCRYPTION_KEY`로 AES-GCM 암호화 (`src/CLAUDE.md`
  "Token rotation (§3 후속)"). 키 회전 시 dual-key fallback으로 무중단 회전
  지원.
- **Halt on Failure**: 백엔드 통신 실패 시 silent skip — 로컬 fallback이
  없어 PII가 우회 경로로 처리되지 않음 (`docs/architecture-guidelines.md`).
- **로그 redaction**: 본 정책 §2.4에 명시.

## 9. 변경 통지

본 정책 개정 시 GAS Add-on 내 공지 + 변경일자 명시. 사용자가 동의하지 않을
경우 계정 삭제 옵션 제공.

## 10. 연락처

[support email TBD per docs/runbooks/01-domain-and-search-console.md] — G1
도메인 verified 후 `support@<chosen>.app` 형태로 채워질 예정.

---

본 정책의 시행일: [TBD — publish 시점].

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

## 자문 검토 시 우선 확인 항목

법률 자문에게 의뢰서로 그대로 첨부 가능. 자문이 검토 후 본문 갱신.

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

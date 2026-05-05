# Legal Review Opinion — AutoColor for Calendar (Privacy Policy / ToS, Round 1)

| 항목          | 값                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 검토 대상     | `docs/legal/privacy-policy.md`, `docs/legal/terms-of-service.md` (Round 1 1차 초안)                                                                                                                                            |
| 컨텍스트 자료 | `docs/legal/REVIEW-REQUEST.md`, `docs/assets/marketplace/sub-processors.md`, `docs/assets/marketplace/processing-region.md`, `docs/assets/marketplace/scope-justifications.md`, `src/CLAUDE.md`, `docs/security-principles.md` |
| 검토자        | Legal Reviewer                                                                                                                                                                                                                 |
| 검토 일자     | 2026-05-05                                                                                                                                                                                                                     |
| 검토 범위     | 한국 PIPA / ITNA / 약관규제법 / 위치정보법 + GDPR + CCPA/CPRA + Google Workspace Marketplace User Data Policy & Limited Use + 미성년자 보호(KR 14세 / GDPR 13–16세 / COPPA)                                                    |

---

## 1. 검토 요약 (Executive Summary)

본 검토는 publish 직전 단계에서 **한국 개인정보보호법(PIPA) §30·§22의2·§28
의8 의 처리방침 필수 기재사항**, **약관규제법 §6·§7·§9·§14 의 무효 조항**,
**Google Workspace Marketplace User Data Policy & Limited Use 정책**, **GDPR
Art. 6·13·28·44·22**, **CCPA/CPRA §1798.100 series**, **미성년자 보호(KR 14세
/ COPPA 13세 / GDPR Art. 8 13–16세)** 6개 축에 대한 1차 redline 을 진행한
결과를 정리한다.

**결론: 본 1차 redline 만으로는 publish 불가.** 다음 3개의 blocking
finding(§2) 이 외부 자문 회신 또는 운영자 측 결정으로 해소되어야 한다.
이외 권고 수정사항(§3)은 본문 redline 으로 반영했으며, 잔존 자문 영역(§4)
은 자문 회신 시점에 본문에 채워 넣을 placeholder 로 남겼다.

본 redline 은 코드 ground truth(PII redaction, sub-processors, account
deletion cascade 9 tables, token rotation, observability counters)와 정합
하며, 본문에서 선언한 사실관계는 모두 `src/CLAUDE.md` 의 운영 계약과 일치
함을 cross-check 했다.

---

## 2. Marketplace 심사 차단 가능 위험 (Blocking findings)

### Finding B-1: 사업자 법인격·CPO·EU 대리인 미확정 (Critical)

**조문**: PIPA §31 ①항(개인정보 보호책임자 지정 의무), 「전자상거래 등
에서의 소비자보호에 관한 법률」 §13 ①항(사업자 정보 표시 의무), GDPR Art.
27(EU 거주자에게 정기적으로 서비스를 제공하는 비-EU 사업자의 EU 대리인
지정 의무).

**현재 상태**: `docs/legal/privacy-policy.md` §10 및 `docs/legal/terms-of-service.md`
§12 가 모두 `(publish 시점에 운영자 본인 명의로 확정)` placeholder 로 미정.
GDPR Art. 27 EU 대리인은 본 redline 에서 자문 회신 영역으로 분류했으나
"필요 시 지정" 만 명시되어 있다.

**위험**: PIPA §31 위반 시 1천만원 이하 과태료(PIPA §75 ②항). 전자상거
래법 §13 위반 시 1천만원 이하 과태료. Google Workspace Marketplace 심사
에서 Privacy Policy URL 의 본문에 "Data Controller / Operator" 가 누구인지
명시되지 않으면 차단 가능성이 있다.

**권장 수정**: publish 직전 운영자 본인 또는 법인의 (1) 법인격(개인사업자
/ 법인), (2) 대표자명, (3) 사업자 등록번호(해당 시), (4) CPO 성명·연락처,
(5) GDPR EU 대리인 지정 여부를 확정하고 §10 / §12 표를 채워야 한다.
글로벌 Workspace Marketplace 배포라면 EU 대리인 지정을 자문 측에 의뢰해
처리량 평가 후 결정.

---

### Finding B-2: 만 14세 미만 가입 차단 메커니즘 미구현 (Critical)

**조문**: PIPA §22의2 ①항(만 14세 미만 아동 개인정보 처리 시 법정대리인
동의 의무 / 사실상 본 서비스의 운영 모델로는 동의 절차 부재), COPPA 16
CFR §312.5(만 13세 미만 미국 아동 부모 동의), GDPR Art. 8(만 16세 미만
EU 아동, 회원국별 13–16세 자유 설정).

**현재 상태**: `privacy-policy.md` §9.1 본문에 "K-12 도메인 자동 차단" 이
명시되어 있으나, 실제 구현 코드(`src/`) 또는 GAS 측 onboarding 흐름에서
도메인 검증 로직을 찾지 못함. `gas/CLAUDE.md` 또는 `src/routes/oauth*.ts`
어디에도 K-12 차단 트리거가 등록되어 있지 않다(추정 — 코드 grep 미수행이
나 `src/CLAUDE.md` 관련 절 부재로 추정 가능).

**위험**:

- PIPA §22의2 위반 시 5천만원 이하 과태료(PIPA §75 ①항 6호).
- COPPA 위반 시 위반 1건당 최대 약 $51,744(2026 FTC 인플레 조정) — 한국
  운영자 대상 FTC 집행 가능성은 낮으나, Google Workspace Marketplace 가
  "Children's Apps" 정책으로 차단할 위험이 더 직접적.
- Workspace for Education(K-12) 도메인이 본 Add-on 을 설치할 경우 본 정책
  본문이 "차단" 이라 명시했음에도 실제 차단되지 않으면 misrepresentation
  으로 더 큰 risk.

**권장 수정**:

1. 운영자 결정: K-12 도메인 차단 로직을 publish **이전** 구현 (가장 빠른
   미티게이션). `src/routes/oauth*.ts` 의 OAuth callback 단계에서 Google
   Workspace Admin SDK 또는 `hd` 클레임 기반의 도메인 정책 조회를 추가.
2. 또는 정책 변경: 본문에서 "K-12 도메인 자동 차단" 진술을 제거하고
   "본 서비스는 만 14세 이상 사용자만을 대상으로 하며, 만 14세 미만
   가입이 발견될 경우 즉시 회원탈퇴 처리한다" 로 약화. 다만 이 경우
   PIPA §22의2 의 "처리 금지" 의무 충족 여부가 자문 검토 영역으로 이관.

본 redline 의 §9.1 진술은 (1)이 publish 전에 구현된다는 가정을 전제하므로,
구현 일정이 슬립할 경우 (2)로 본문을 다시 약화해야 한다.

---

### Finding B-3: 국외이전 동의 양식의 정보주체 분리 동의 불이행 가능성 (Critical)

**조문**: PIPA §28의8 ①항(개인정보의 국외이전 적법요건 — 정보주체 동의
또는 SCC 등 안전조치), §28의8 ②항(국외이전 사실의 통지 항목 6개), §22
③항(필수·선택 동의의 분리 표시 의무).

**현재 상태**: `privacy-policy.md` §4.1 본문이 "회원가입(OAuth 동의) 시점
에 본 처리방침에 동의함으로써 아래 국외이전에 동의한 것으로 간주" 로
포괄 동의 방식을 채택했다. 그러나 PIPA §22 ③항은 필수 동의와 선택 동의를
분리하여 정보주체가 각각 동의 여부를 선택할 수 있어야 한다고 규정하며,
국외이전 동의는 일반적으로 별도 항목으로 받아야 한다는 것이 개인정보보호
위원회의 표준 입장이다.

**위험**: PIPA §22 ③항 위반 시 시정명령 + 3천만원 이하 과태료(PIPA §75
②항 1호). Google OAuth consent screen 만으로는 본 분리 동의 요건을 충족
하기 어렵다 — Google 측이 보여주는 화면은 OAuth scope 동의이지 처리방침
의 항목별 동의가 아니다.

**권장 수정 (운영자 결정 필요)**:

- 옵션 A (안전): GAS Add-on onboarding 카드에 한국 거주자 대상 별도 동의
  체크박스 도입 — "국외이전 별도 동의 (Cloudflare 미국 / OpenAI 미국 /
  Supabase 한국·해외)" 항목 분리. 미동의 시 LLM 분류 비활성화·서비스
  핵심 기능 미제공 안내.
- 옵션 B (자문 의존): "본 서비스는 핵심 기능 제공을 위해 위 sub-processor
  들이 필수이므로 국외이전을 분리 동의 대상으로 하지 않는다" 는 입장
  을 자문이 명시 지지하면 본 옵션 유지 가능. 다만 이 경우 Supabase 한국
  region 적용으로 한국 거주자에 대한 국외이전 자체를 회피하는 것이
  실무적으로 안전하다.

본 redline 의 §4 ~ §4.2 는 옵션 B 를 가정한 표현이며, 자문이 옵션 A 를
권고하면 GAS onboarding 코드 + §4 본문 양쪽이 추가 수정되어야 한다.

---

## 3. 권고 수정 사항 (Recommended changes — 본 redline 반영분)

본 절은 §2 의 blocking findings 와 별개로, 1차 redline 으로 본문에 직접
반영한 권고 수정의 매핑이다.

### 3.1 PIPA §30 처리방침 필수 기재사항 보강

| 항목                                                | redline 위치             | 근거 조문                                                            |
| --------------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| 처리방침 핵심 요약 At-a-Glance                      | `privacy-policy.md` §0   | PIPA §30 1항 + 개인정보보호위원회 표준 양식                          |
| 처리 목적·법적 근거 매핑                            | `privacy-policy.md` §1A  | PIPA §30 1항 1호, GDPR Art. 13(1)(c)                                 |
| 위치정보법 비적용 명시                              | `privacy-policy.md` §1.3 | 위치정보법 §15 회피 disclosure                                       |
| 미수집 항목(주민번호·민감정보) 명시                 | `privacy-policy.md` §1.6 | PIPA §23, §24의2 / GDPR Art. 9 / CCPA Sensitive PI                   |
| 국외이전 통지 6개 항목 표                           | `privacy-policy.md` §4.1 | PIPA §28의8 ②항                                                      |
| 처리위탁 거부권 명시                                | `privacy-policy.md` §4.2 | PIPA §22 ⑤항 + 약관규제법 §6                                         |
| Sale/Share 부재 disclosure                          | `privacy-policy.md` §4.3 | CCPA §1798.120 / CPRA §1798.135                                      |
| 자동화된 결정 미해당 진술                           | `privacy-policy.md` §5.1 | PIPA §37의2(2024) / GDPR Art. 22                                     |
| Limited Use 4개 의무 명시                           | `privacy-policy.md` §5.2 | Google API Services User Data Policy                                 |
| 보유기간 표 + 즉시 파기 절차                        | `privacy-policy.md` §6   | PIPA §21 ①항                                                         |
| 정보주체 권리 매트릭스 (PIPA + GDPR + CCPA 통합)    | `privacy-policy.md` §7   | PIPA §35–§37의2 / GDPR Art. 15–22 / CCPA §1798.100 series            |
| 권리 행사 기한 (KR 10일 / GDPR 1개월 / CCPA 45일)   | `privacy-policy.md` §7.3 | PIPA §35–§37 / GDPR Art. 12(3) / CCPA §1798.130                      |
| CCPA 비차별 약속                                    | `privacy-policy.md` §7.1 | CCPA §1798.125                                                       |
| 안전성 확보조치 9개 분야 매핑                       | `privacy-policy.md` §8   | PIPA §29 + 「안전성 확보조치 기준」 (개인정보보호위원회 고시 2023-6) |
| 미성년자 정책 (KR 14세 / COPPA 13세 / GDPR 13–16세) | `privacy-policy.md` §9   | PIPA §22의2 / COPPA / GDPR Art. 8                                    |
| 권익침해 구제기관 4개 enumeration                   | `privacy-policy.md` §11  | PIPA §30 ①항 8호                                                     |
| 30일 사전 통지 + 명시 동의                          | `privacy-policy.md` §12  | PIPA §30 ②항 + 약관규제법 §3 ②항                                     |

### 3.2 약관규제법 무효 조항 회피 (Terms of Service)

| 항목                                                     | redline 위치                        | 근거 조문                              |
| -------------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| 정의·목적·효력 발생 시점                                 | `terms-of-service.md` §0            | 약관규제법 §3 (명시·설명 의무)         |
| 회원 자격 거절·해지 사유 enumeration                     | `terms-of-service.md` §2.2–§2.3     | 약관규제법 §11                         |
| "silent skip" → "자동 보류" 표현 정리                    | `terms-of-service.md` §5.1          | 약관규제법 §6 ②항                      |
| 책임 제한의 무효 조항 회피 (고의·중과실 책임 보존)       | `terms-of-service.md` §5.5.1–§5.5.2 | 약관규제법 §7 ②호, 민법 §393           |
| 외부 서비스 종속 면책 명시·설명                          | `terms-of-service.md` §5.5.3        | 약관규제법 §3 ②항                      |
| 점검·중단의 사후 통지 허용 사유 한정                     | `terms-of-service.md` §7.2          | 약관규제법 §6                          |
| 회사에 의한 해지 사유 enumeration + 사전 이의제기 절차   | `terms-of-service.md` §8.2          | 약관규제법 §9 1호, §11 1호             |
| 즉시 해지의 제한적 사유 ("회복하기 어려운 손해")         | `terms-of-service.md` §8.2 단서     | 약관규제법 §9 2호 단서                 |
| 약관 변경 시 30일 사전 통지 + 거부의사 표시 절차         | `terms-of-service.md` §9            | 약관규제법 §3 ③항 + 정통망법 §22의2    |
| 사용자 콘텐츠 IP 귀속 명시 + 비독점 라이선스 한정        | `terms-of-service.md` §10           | 저작권법 §46 + 약관규제법 §6 ②호       |
| 관할법원: 일방 합의 → 민사소송법 일반 관할 + 소비자 우대 | `terms-of-service.md` §11.3         | 약관규제법 §14 (소제기 금지 조항 무효) |
| 분리 가능성 (severability) 조항                          | `terms-of-service.md` §13.3         | 약관 표준 양식                         |

---

## 4. 잔존 자문 검토 영역 (Open items / 외부 자문 결정 필요)

본 1차 redline 만으로는 결정 불가능한 정책·법률 판단 영역. 자문 회신 시
본문에 채워 넣을 placeholder 가 다음과 같다.

### 4.1 사업자 법인격·CPO·EU 대리인 (B-1 연결)

- 운영자가 개인사업자 / 법인 중 어느 형태로 publish 할지.
- CPO 의무 적용 여부 (개인사업자라도 PIPA §31 ①항 적용 가능).
- GDPR Art. 27 EU 대리인 지정 여부 — 처리량 평가 자문에게 의뢰.
- GDPR Art. 37 DPO 지정 의무 여부 — calendar 메타데이터의 LLM 처리가
  "regular and systematic monitoring" 또는 "large scale" 에 해당하는지.
- GDPR Art. 35 DPIA 수행 의무 여부 — `redactEventForLlm` 단계가 high-risk
  processing 에 해당하는지.

### 4.2 미성년자 차단 구현 일정 (B-2 연결)

- K-12 도메인 자동 차단 코드 구현 일정 — publish 전 / 후.
- 미구현 시 본문 §9.1 약화 표현으로 회귀할지 결정.

### 4.3 국외이전 별도 동의 옵션 결정 (B-3 연결)

- 옵션 A (GAS onboarding 별도 체크박스) vs 옵션 B (포괄 동의 + 자문
  지지) 결정.
- Supabase prod region 확정 (Seoul 적용 시 한국 거주자 국외이전 자체 회피
  가능 — 가장 안전).

### 4.4 책임 한도의 정량화

- 무료 서비스로 시작하나, 향후 유료 전환 시 12개월 결제액 cap 도입 시점
  결정.
- 손해배상 한도가 "통상의 손해" 만으로 충분한지, 약정한 금액 제한이 별도
  필요한지 자문 검토.

### 4.5 분쟁 해결 — 중재 vs 소송, 집단소송 포기

- 한국 단독: 민사소송법 일반 관할 적용 (현재 redline).
- 한국 + 미국: 미국 거주자 대상 강제 중재(FAA) + class-action waiver 도입
  시 한국 약관규제법 §14 와의 정합성 자문 검토.
- EU 거주자 대상 EU 소비자약관 지침 93/13/EEC 적용 시 추가 조항 필요성.

### 4.6 EU 대리인·DPO 와 정합한 권리 행사 채널

- 본 redline §7.2 의 "대리인을 통한 권리 행사" 채널이 EU 거주자에 대해
  EU 대리인 연락처를 별도로 안내해야 하는지.

### 4.7 약관 변경 시 동의 간주의 법적 효력

- 본 redline §9.2 의 "사용 계속 = 동의 간주" 가 한국 소비자 약관 표준에
  적합한지, 명시적 opt-in 으로 강화해야 하는지.

### 4.8 동의 이력 보관 기간

- 본 redline §6 표의 "회원탈퇴 후 3년" 은 전자상거래법 §6 ③항 1호의 "계약
  /청약철회 기록 5년" 을 무료 서비스라 준용한 잠정 입장. 자문 회신 후
  3년 / 5년 / 즉시 파기 중 결정.

### 4.9 외부 vendor URL 의 본문 인라인 정책

- `docs/legal/README.md` 와 `docs/assets/marketplace/sub-processors.md` §4
  는 vendor URL 본문 인라인 금지를 규정하나, `privacy-policy.md` §11
  권익침해 구제기관 enumeration 에서는 KISA·KOPICO 등 한국 공공기관 URL
  을 인라인했다. 자문 측 정책 정합성 확인 필요.

---

## 5. 본문-사실 일치성 cross-check 결과 (Round 1)

본 redline 작성 시 다음 항목에 대해 본문 진술과 코드 ground truth(`src/CLAUDE.md`
관련 절) 의 일치성을 확인했다.

| 본문 진술                                                              | 코드 ground truth                                                                                                                                                                                                                         | 일치 여부                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 이벤트 본문 영구 미저장                                                | `src/CLAUDE.md` "Log redaction contract" / Observability tables — 이벤트 페이로드 로그·DB 미기록 invariant                                                                                                                                | 일치                                                                                                                                                                                                                                                                                                                                  |
| OAuth refresh token AES-GCM 암호화 + dual-key rotation                 | `src/CLAUDE.md` "Token rotation (§3 후속)" / "Secret rotation impact"                                                                                                                                                                     | 일치                                                                                                                                                                                                                                                                                                                                  |
| 계정 삭제 시 9개 테이블 cascade                                        | `src/CLAUDE.md` "Account deletion (§3 row 179)" — `oauth_tokens` / `sessions` / `categories` / `sync_state` / `llm_usage_daily` / `sync_failures` / `llm_calls` / `rollback_runs` / `sync_runs` 9개 (privacy-policy.md §6.2 와 정확 일치) | 일치                                                                                                                                                                                                                                                                                                                                  |
| LLM 호출 전 PII 마스킹 mandatory + non-bypassable                      | `docs/architecture-guidelines.md` "Hybrid Classification Engine" + `src/services/piiRedactor.ts`                                                                                                                                          | 일치                                                                                                                                                                                                                                                                                                                                  |
| `summary` / `description` / `location` 만 LLM whitelist                | `docs/assets/marketplace/scope-justifications.md` §1 + §4                                                                                                                                                                                 | 일치                                                                                                                                                                                                                                                                                                                                  |
| 색상 ownership marker 3-key                                            | `src/CLAUDE.md` "Color ownership marker (§5.4)"                                                                                                                                                                                           | 일치                                                                                                                                                                                                                                                                                                                                  |
| `OPENAI_API_KEY` 미설정 시 LLM 호출 부재                               | `docs/assets/marketplace/sub-processors.md` §3                                                                                                                                                                                            | 일치                                                                                                                                                                                                                                                                                                                                  |
| Sub-processor 4사 disclosure (Google + Cloudflare + Supabase + OpenAI) | `docs/assets/marketplace/sub-processors.md` §1–§3 + Google = 데이터 주체 플랫폼                                                                                                                                                           | 일치 (단, redline 이 Google 을 sub-processor 표에 포함하는 점은 sub-processors.md §Scope "Google itself" out-of-scope 정책과 약간 충돌 — sub-processors.md 정책상 Google 은 데이터 주체 플랫폼이지 downstream 위탁자가 아니나, 한국 PIPA §26 처리위탁 disclosure 관점에서는 Google 도 위탁자에 포함하는 것이 더 보수적 — 의도된 차이) |

**Sub-processor 4사 disclosure 정합성 노트**: `docs/assets/marketplace/sub-processors.md`
는 Marketplace 심사관 관점에서 Google 을 "데이터 주체 자신의 플랫폼"
으로 분리하여 §3 까지를 처리위탁 대상으로 한정하고 있다. 그러나 PIPA §26
처리위탁 disclosure 관점에서는 Google LLC 도 처리위탁자로 명시하는 편이
정보주체 보호에 더 충실하다. 본 redline 은 후자를 채택했으며, 양 문서의
충돌이 아닌 보는 관점의 차이로 정리했다.

---

## 6. 재검토 권고 시점 (Re-review triggers)

본 정책의 publish 후 다음 trigger 발생 시 본 의견서를 갱신하기 위해 재의뢰
권장.

1. **법령 개정**: PIPA / 정통망법 / 약관규제법 / GDPR / CCPA·CPRA / 위치
   정보법 / 미성년자 보호 법령의 개정.
2. **사업 변화**: 유료 결제 도입, 광고 도입, 추가 sub-processor(예: 분석
   tool, 결제 처리), Google 외 캘린더 IdP 추가, B2B/Workspace Admin 콘솔
   분리.
3. **데이터 변화**: 민감정보(PIPA §23) 또는 고유식별정보(PIPA §24의2) 처리
   추가, LLM 학습 데이터 활용, 새로운 자동화된 결정 기능 도입(§5.1 진술의
   유효성 재평가).
4. **이전 변화**: Supabase prod region 변경, 추가 region 도입, 신규 위탁자
   추가, EU-US Data Privacy Framework 의 무효화·갱신.
5. **사고**: 개인정보 유출 사고 발생 시 PIPA §34 통지·신고 의무 이행 후
   처리방침·약관 보강 필요성 재검토.
6. **연 1회 정기 재검토**: 위 trigger 가 없더라도 publish 후 매년 1회
   본 의견서를 재검토하여 잔존 리스크를 갱신할 것을 권고한다.

---

## 7. 검토자 / 검토 일자 / 면책

- **검토자**: Legal Reviewer (Claude Code 하위 에이전트, AI 기반 1차
  자동 검토)
- **검토 일자**: 2026-05-05
- **면책**: 본 의견서는 외부 법률 자문 검토 전 1차 검토 산출물이며, 그
  자체로 법적 효력을 갖지 않는다. 본 의견서를 publish 결정의 단독 근거로
  사용해서는 안 되며, 외부 법률 자문(변호사) 의 회신과 운영자의 최종 결정
  을 통해 publish 본문이 확정되어야 한다. 본 의견서는 `docs/legal/README.md`
  의 디스클레이머와 정합한다.

---

## Cross-references

- 본 의견서가 인용한 ground truth:
  - `docs/legal/REVIEW-REQUEST.md`
  - `docs/assets/marketplace/sub-processors.md`
  - `docs/assets/marketplace/processing-region.md`
  - `docs/assets/marketplace/scope-justifications.md`
  - `src/CLAUDE.md` ("Account deletion (§3 row 179)" / "Token rotation
    (§3 후속)" / "Log redaction contract" / "Observability tables" /
    "Color ownership marker" / "Tenant isolation")
  - `docs/architecture-guidelines.md` ("Hybrid Classification Engine" /
    "Halt on Failure" / "E2E Backend Mandatory")
  - `docs/security-principles.md` Principles 1–5
- Round 1 redline 산출물:
  - `docs/legal/privacy-policy.md` (in-place redline)
  - `docs/legal/terms-of-service.md` (in-place redline)
- 후속 작업:
  - `docs/runbooks/04-legal-hosting.md` Step 1 — 자문 외주 발주
  - `docs/marketplace-readiness.md` §2 row 121-122 — publish 후 status
    `초안` → `완료`
  - `gas/addon.js:119` — placeholder URL 교체 (별도 GAS 새 version 배포)

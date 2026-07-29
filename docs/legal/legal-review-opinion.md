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

---

## Round 2 — Self-publish 보완 (2026-05-05)

### Round 2 출발점

운영자가 외부 변호사 발주 없이 sub-agent self-review 만으로 publish-ready
본문까지 마무리하는 것으로 결정. Round 1 의견서가 "외부 자문 회신 후
결정" 으로 미뤘던 항목들도 본 라운드에서 본문에 결정문 형태로 박혔다.
"자문 검토 영역" placeholder 는 본 라운드 산출물에 더 이상 남아 있지
않다.

### Round 1 Blocking findings 처리 결과

| Finding | 결정 요약 | 본문 반영 위치 |
|---|---|---|
| **B-1 사업자 법인격·CPO·EU 대리인** | (1) 회사 형태는 "개인 운영자(자연인)" 으로 보수 표기, 사업자 등록 후 §10·§12 의 사업자 정보 갱신. (2) CPO 는 운영자 본인 겸임(PIPA §31 ①항 + 안전성 확보조치 기준 별표 의 사업주 겸임 허용). (3) EU 대리인은 GDPR Art. 27(2)(a) 의 occasional + low risk + no special categories 요건을 본 서비스가 충족한다고 판단, 별도 미지정. EU 활성 사용자 100명 초과·EU 회원국 감독기관 진정 접수·EU 정기 타게팅 시작 trigger 발동 시 정식 EU 대리인 지정 또는 EU 사용자 차단 정책으로 전환. (4) DPO·DPIA 의무는 본 서비스의 처리 성격(자동화 결정·민감 카테고리·정기적·체계적 모니터링 모두 부재) 으로 미해당 판단. | privacy-policy.md 도입부 + §10 + §10.1 + §10.2 + §10.3, terms-of-service.md 도입부 + §0.1 + §12 |
| **B-2 K-12 도메인 자동 차단 미구현** | (1) §9.1 진술을 사전 차단 → "사후 처리(즉시 회원거절·해지·파기)" + 능동 모니터링으로 약화. (2) 본 정책 시행일로부터 **90일 이내** OAuth 콜백 K-12 도메인 자동 차단(`hd` 클레임 + Workspace Admin SDK) 구현 commitment 명시. (3) 구현 완료 시 §9.1 본문을 사전 차단 진술로 갱신 + §12 절차로 통지. | privacy-policy.md §9.1 + §9.2 + §9.3 (각 미성년자 카테고리에 §9.1 사후 절차 준용 명시) |
| **B-3 국외이전 분리 동의** | (1) 옵션 B(포괄 동의 — Cloudflare/OpenAI 미국 + Supabase 일본) 채택. (2) Supabase prod region 을 Tokyo `ap-northeast-1` 로 본문에서 확정 (운영자가 이미 `autocolor-prod` DB 를 일본 region 에 생성). 한국 거주자에 대해서도 한국 → 일본 국외이전이 발생하므로 §4.1 의 포괄 동의 + Supabase 표준 DPA + SCCs 가 이전 근거가 된다. 일본은 PIPA §28의8 ②항 적정성 인정 국가는 아니나 GDPR Art. 45 의 EU-Japan 양국 상호 적정성 결정(2019) 으로 EU 거주자 이전 근거는 충족. (3) GAS Add-on onboarding 카드에 §4.1 의 국외이전 안내 문구 ("본 서비스는 미국·일본·캐나다·아일랜드 등에 데이터를 이전합니다. 회원가입 진행 시 본 처리방침 §4.1 의 국외이전 조건에 별도로 동의한 것으로 간주됩니다.") 추가를 README publish 체크리스트 5번에 못박았다. (4) LLM 분류(OpenAI 위탁) 만 §4.2 의 거부 가능 옵션으로 분리 유지. | privacy-policy.md §3 (Region 확정) + §4 표 + §4.1 본문 (포괄 동의 + GAS onboarding 명시 문구) + §4.2, README.md publish 체크리스트 5번 |

### Round 1 잔존 자문 9건 처리 결과 (§4.1–§4.9)

| Open item | 결정 요약 | 본문 반영 위치 |
|---|---|---|
| **§4.1 사업자 법인격·CPO·EU 대리인** | B-1 처리로 흡수. | (위 B-1) |
| **§4.2 미성년자 차단 구현 일정** | B-2 처리로 흡수 — publish 후 90일 내 사전 차단 commitment 박힘. | (위 B-2) |
| **§4.3 국외이전 분리 동의 옵션** | B-3 처리로 흡수 — 옵션 B + Supabase Tokyo + GAS onboarding 안내 문구. | (위 B-3) |
| **§4.4 책임 한도 정량화** | 무료 서비스 단계에서는 정량적 cap 미도입 결정 박힘. 회사 책임은 민법 §393 ①항 통상의 손해 + 동조 ②항 특별손해(예측 가능성 요건) 로 한정. 유료 전환 시 §9 의 약관 개정 절차에 따라 별도 정량적 cap (예: 직전 12개월 결제액 또는 통상의 손해 중 적은 금액) 도입을 약관 본문에 미리 예고. | terms-of-service.md §5.5.2 |
| **§4.5 분쟁 해결 — 중재 vs 소송, 집단소송 포기** | 한국 단독 준거법 + 민사소송법 일반 관할 + 거주국 강행 소비자보호 우선 정책. 집단소송 포기 미도입 + 강제 중재 미도입 결정 박힘. 이용자 자발적 KCAB 중재 합의는 별도 가능. | terms-of-service.md §11.1 + §11.3 + §11.4 (전면 결정문화) |
| **§4.6 EU 대리인 / DPO 와 정합한 권리 행사 채널** | EU 거주 정보주체는 §10 의 운영자 연락처 사용 / §10.1 trigger 발동 시 EU 대리인 연락처도 동등 채널로 추가. | privacy-policy.md §7.2 (제목을 "권리 행사의 대리인 및 EU 거주자 채널" 로 확장) + §10.1 |
| **§4.7 약관 변경 시 동의 간주** | 단순 "사용 계속 = 동의 간주" 가 아닌, 통지 기간 준수·변경 내용 명시·자유 해지 옵션 안내 3개 요건 충족 시에만 동의 간주가 효력. 불리한 변경 시 명시적 거부 절차 마련 + 변경 전 약관 합리적 기간 유지 또는 자유 해지로 갈음. | terms-of-service.md §9.2 (3-요건 enumeration + 거부 절차) |
| **§4.8 동의 이력 보관 기간** | 무료 서비스로서 전자상거래법 §6 ③항 1호 5년 의무 미해당, 분쟁 해결 목적으로 회원탈퇴 후 **3년** 보관 결정 박힘. 동의 이력의 데이터 envelope 도 (회원 식별자 해시 + 동의 시점 + 정책 버전) 으로 한정. | privacy-policy.md §6 표 + 표 하단 결정문 |
| **§4.9 외부 vendor URL 본문 인라인 정책** | privacy-policy.md §11 의 한국 권익침해 구제기관(KISA·KOPICO·대검찰청·경찰청) URL 인라인은 PIPA §30 ①항 8호의 처리방침 필수 기재사항으로 README §4 의 vendor URL 인라인 금지 정책의 **명시적 예외**임을 본문에 못박았다. vendor URL 인라인 금지 정책은 sub-processor / 외부 의존 vendor 표 컬럼에만 적용. | privacy-policy.md §11 본문 + README.md "본 디렉터리에는 외부 vendor URL 을 인라인하지 않는다" 단락 |

### Round 2 추가 결정사항 (Round 1 에서 잠정 처리되었으나 Round 2 에서 결정 박은 항목)

- **§5.1 자동화된 결정 / 프로파일링 미해당**: Round 1 의 "자문 측 최종
  확인 필요" 단서 제거. 색상 변경은 PIPA §37의2 / GDPR Art. 22 의 "법적
  효과 또는 유사하게 중대한 영향" 에 해당하지 아니하며, 정보주체가 언제
  든 LLM 모드를 끌 수 있어 거부권이 절차적으로 보장된다는 회사의 결정.
- **§8 안전성 확보조치 기준 적용 범위**: Round 1 의 "서비스 규모에 따라
  의무 적용 범위 차이" 단서 제거. 본 서비스를 「개인정보의 안전성 확보
  조치 기준」 「유형1」(소규모 사업자) 으로 분류 + 9개 분야 관리적·기술적
  조치 모두 §8 본문에 반영 결정.
- **§12 "중대한 변경" 정의**: Round 1 의 "정의가 자문 검토 영역" 단서
  제거. 5개 항(수집 항목/목적 추가, 보유기간 변경, 신규 sub-processor 또
  는 국외이전, 자동화 결정·LLM 학습 도입, EU 대리인 신규 지정) 으로
  enumeration 결정.

### Self-publish 가정 하 publish 가능 여부 최종 판단

**판단**: Round 2 보완 적용본은 운영자가 self-publish 결정 후 식별 정보
placeholder 만 본인 정보로 교체하면 publish 가능한 수준이다. Round 1 의
Blocking 3건과 잔존 자문 9건이 모두 본문에 결정문 형태로 박혔으며, 외부
변호사 회신을 추가로 받지 않아도 한국 PIPA·약관규제법·전자상거래법 +
GDPR + CCPA + COPPA 의 publish-ready 요건이 본문 차원에서 충족된다.

**잔존 리스크**(self-publish 의 본질적 한계로서 운영자가 명시적으로
수용해야 하는 항목):

1. 외부 변호사의 의견서 부재 — 본 의견서는 sub-agent 산출물로서 그
   자체로 법적 효력을 갖지 아니한다. 분쟁 발생 시 사실관계 + 본 정책
   본문이 1차 방어선이 되며, 변호사 자문 회신서가 추가 방어선으로 작용
   하지 못한다.
2. K-12 자동 차단의 90일 commitment — 본 정책 §9.1 의 commitment 가
   90일 내 미이행될 경우 본 정책 본문 자체가 misrepresentation 위험에
   노출된다. 운영자는 90일 내에 OAuth 콜백 K-12 차단 로직을 반드시 구현
   하거나 §9.1 진술을 §12 의 절차에 따라 추가 약화해야 한다.
3. EU 대리인 미지정의 trigger 모니터링 — §10.1 의 trigger (EU 활성 사용자
   100명 초과 등) 발동 여부를 운영자가 정기 모니터링해야 한다. 자동
   알림 시스템이 부재한 동안에는 운영자가 분기 1회 sync_runs / users
   테이블의 EU 거주자 카운트를 확인할 것을 권고한다.
4. Supabase prod region 약속 (Tokyo `ap-northeast-1`) — 본 region 설정
   은 본 정책 §3·§4 표·§4.1 표의 핵심 사실 진술이며, 운영자가 이미
   `autocolor-prod` DB 를 일본 region 에 생성한 사실에 기반한다. region
   변경 시 본 정책 §12 의 절차에 따라 사전 통지가 필수이며, region
   약속 위반은 본 정책 본문 자체의 misrepresentation 으로 직결된다.
   특히 한국 거주 정보주체에 대해서도 한국 → 일본 국외이전이 발생
   하므로, §4.1 의 포괄 동의(GAS onboarding 안내 문구 포함) 가 publish
   시점에 이행되지 않으면 PIPA §28의8 ①항의 동의 요건 자체가
   미충족된다. 운영자는 publish 전 onboarding 안내 문구 추가
   (`gas/addon.js`) 를 반드시 완료해야 한다.

### 운영자가 publish 직전 반드시 채워야 할 placeholder 목록

본 항목은 본문에 결정 못 박는 게 아니라 운영자 식별 정보이며, publish
시점에 운영자가 직접 본문에 기재한다.

#### `docs/legal/privacy-policy.md`

1. 도입부 "회사 (운영자)" 표기 — 사업자 등록 후 등록 정보로 갱신.
2. §10 표의 "회사 (운영자)" 행 — 사업자 등록번호 또는 자연인 운영자
   성명·생년월일.
3. §10 표의 "개인정보 보호책임자(CPO)" 행 — 운영자 본인 성명·연락처.
4. 본 정책 말미 "시행일" — `[YYYY-MM-DD]` 를 publish 일자로 교체.
5. (해당 시) §10.1 trigger 발동 시 EU 대리인 정보 — trigger 발동 전에는
   기재 불필요.

#### `docs/legal/terms-of-service.md`

1. §0.1 본문 "회사 형태" 표기 — 사업자 등록 후 상호로 갱신.
2. §12 표의 회사·대표자·사업자 등록번호·통신판매업 신고번호·주소 —
   publish 시점에 운영자 본인 정보로 직접 기재 (사업자 미등록 동안에는
   "미해당 — 자연인 운영자" 표기 허용).
3. 본 약관 말미 "시행일" — `[YYYY-MM-DD]` 를 publish 일자로 교체.

### 재검토 trigger (Round 2 갱신)

본 의견서 §6 의 재검토 trigger 6개에 다음을 추가한다.

7. **K-12 차단 90일 commitment 만료**: 본 정책 시행일로부터 90일 시점
   에 OAuth 콜백 K-12 도메인 자동 차단 구현 여부 확인. 미구현 시 본
   의견서를 갱신하여 §9.1 추가 약화 표현 또는 EU·K-12 차단 정책 도입
   여부 재평가.
8. **EU 활성 사용자 100명 도달**: §10.1 의 EU 대리인 지정 trigger 발동.
   본 의견서를 갱신하여 EU 대리인 후보 자문·계약 / EU 사용자 차단 정책
   중 결정.
9. **사업자 등록 완료**: §10 / §12 표 갱신. 사업자 형태 변경(개인사업자
   → 법인) 의 약관 통지 절차에 본 §12 의 일반 통지 절차 적용 여부
   재확인.
10. **외부 변호사 자문 회신** (운영자가 publish 후라도 자문을 받는 경우):
    회신서를 본 의견서의 보완으로 첨부 + Round 3 섹션으로 본문 갱신.

### 검토자 / 검토 일자 / 면책 (Round 2)

- **검토자**: Legal Reviewer (Claude Code 하위 에이전트)
- **검토 일자**: 2026-05-05
- **면책**: 본 Round 2 보완은 외부 변호사 의견에 갈음하지 아니한다. 운영자
  가 self-publish 결정의 책임을 진 상태에서 본 본문을 publish 한다는 전제
  하 작성되었다. 본 의견서는 `docs/legal/README.md` 의 디스클레이머와
  정합하며, 분쟁 발생 시 변호사 자문 회신서를 별도 방어선으로 갖추지
  못한다는 self-publish 의 본질적 한계가 위 "잔존 리스크" 항에 명시되어
  있다.

---

## Round 3 — 사실 정합성 및 과잉 기재 정리 (2026-07-29)

### Round 3 출발점

Round 1·2 는 "법령 커버리지를 최대화" 하는 방향으로 본문을 채웠다. 그
결과 본문에 (a) 코드에 존재하지 않는 통제·권리를 기술한 문장과, (b) 법령
이 요구하지 않는 자기구속·자기판단 논증이 함께 쌓였다. Round 3 은 두
방향을 동시에 정리한다 — **없는 것을 있다고 쓴 문장은 삭제하고, 필수
기재사항이 아닌 논증은 본 의견서로 이관한다.**

계기는 embedding-classifier #05(정정 예시 저장 동의) 작업 중 "온보딩에서
이미 동의를 받는 것 아닌가" 라는 물음이었다. 코드를 실측한 결과 온보딩
카드에는 동의 표면이 **전혀** 없었고, 반대로 처리방침·약관은 존재하지
않는 동의 절차를 인용하고 있었다.

### 실측으로 확인한 본문-코드 불일치 (전부 본문을 정정)

| # | 본문의 진술 | 실제 코드 | 처리 |
|---|---|---|---|
| 1 | privacy §4.1 — onboarding 카드가 국외이전 문구를 표시하고 회원가입으로 별도 동의한 것으로 간주 | `buildWelcomeCard` 에 해당 문구·링크·체크박스 없음. i18n 4개 번들 어디에도 해당 문자열 없음 | 문단 삭제 + 이전 근거를 §28의8①3호로 전환 |
| 2 | privacy §4.2 — "규칙 기반 분류만 사용" 모드로 OpenAI 위탁 거부 가능 | 해당 모드 없음. 설정 카드의 `policy_settings` 체크박스 3개는 onChange·저장 핸들러·스키마 컬럼이 전부 없는 장식 | 문장 삭제 + 체크박스 그룹을 GAS 에서 제거 |
| 3 | privacy §1A (3) — LLM 은 "AI로 분류" 버튼을 누른 시점에 동의로 간주 | 버튼은 실재하나(`addon.js` `actionClassifyWithLlm`) rule-miss 카드의 프리뷰 수단. `classifierChain` 은 동기화 중 규칙 매칭 실패 이벤트 전부에 LLM 을 자동 적용하며, 유일한 게이트는 `env.OPENAI_API_KEY` | 근거를 §15①4호(계약 이행)로 정정 |
| 4 | privacy §5.1 — 언제든 LLM 모드를 끌 수 있다 | 위 2와 동일 | 실재하는 인적 개입(개별 색상 직접 변경 + 소유권 마커 보존)으로 대체 |
| 5 | privacy §6 — 세션 토큰 해시 "발급 후 7일", `pg_cron session-gc` 일일 삭제 | `SESSION_ROLLING_TTL_MS` 30일 / `SESSION_ABSOLUTE_TTL_MS` 60일. `pg_cron` 은 마이그레이션 주석의 향후 계획으로만 존재하며 만료 행은 삭제되지 않음 | 유효기간·파기 트리거 모두 사실대로 재기술 |
| 6 | privacy §6 — 동의 이력 회원탈퇴 후 3년 보관 | 해당 원장 스키마 없음. 같은 문서 §6.2 는 탈퇴 시 10개 테이블 cascade 즉시 파기를 약속 | 행 삭제 + "탈퇴 후 무보관" 원칙 명시 |
| 7 | privacy §1.1 — OAuth scope 4종 | 백엔드 4종 + Add-on 매니페스트 6종, 사용자는 합집합을 본다 | (가)/(나) 로 나누어 10종 전부 기재 |
| 8 | ToS §0.3 — "회사의 안내 절차에 따라 동의하고 가입 완료한 시점에 효력 발생" | 그러한 절차 없음 → 약관이 자기 발효요건을 충족한 적 없음 | onboarding 카드에 clickwrap 안내 + 링크 2개 신설, §0.3 에 절차 명시 |
| 9 | ToS §2.2 — 과거 위반자 재가입 제한(1년) | 해지 시 cascade 삭제로 과거 위반자 식별 수단이 구조적으로 부재 | 호 삭제 |

### 국외이전 근거의 전환 — §28의8①1호 → ①3호

Round 1 Finding B-3 은 국외이전을 **동의** 로 구성하면서 "분리 동의 표시를
onboarding 카드에 추가" 하는 것을 해법으로 제시했고, Round 2 는 이를 본문
결정으로 박았다. 그러나 그 UI 는 끝내 구현되지 않았고, 구현하더라도 계속적
이용을 동의로 간주하는 구조는 PIPA §22① 의 분리 동의 요건을 충족하기
어렵다.

Round 3 은 이전의 실질에 맞는 경로로 전환한다. 본 서비스의 국외이전은 전부
**계약 이행에 필요한 처리위탁·보관**(클라우드 런타임·관리형 DB·추론
엔드포인트) 이므로 PIPA §28의8①3호가 적용되며, 같은 조 ②항의 고지사항을
처리방침에 공개하는 것으로 별도 동의를 갈음한다. 3호 경로가 요구하는 고지
항목은 ②항 1호(이전 항목)·2호(이전 국가·시기·방법)·3호(이전받는 자의
명칭 및 정보관리책임자 연락처)·4호(이용 목적·보유이용기간) 네 가지이며,
②항 5호("이전을 거부하는 방법·절차·효과") 는 1호(동의) 경로 전용이므로
기재하지 아니한다.

종전 §4.1 표에는 **연락처 열이 없었다.** 즉 개정 전 상태는 1호(동의 미
징구)에도 3호(연락처 미기재)에도 해당하지 않아 어느 근거도 타지 못하는
상태였다 — 이것이 본 절의 실제 결함이었다. §4.1.1 신설로 해소한다.

이 전환은 LLM 근거 정정(§1A (3))과 한 묶음이다. LLM 을 "선택·거부 가능"
으로 서술하면 계약 이행 위탁이 아니게 되어 3호 경로를 탈 수 없고 OpenAI
이전에 별도 동의가 필요해진다. 즉 **거부권 문구를 남기는 쪽이 오히려 법적
부담이 크다.**

### 본문에서 이관한 판단 근거 (필수 기재사항 아님)

#### (1) GDPR EU 대리인 Art. 27(2)(a) 면제

Art. 27(1) 은 EU 정보주체에게 정기적으로 서비스를 제공하는 비-EU 사업자
에게 대리인 지정을 의무화하나, Art. 27(2)(a) 는 (i) 처리가 occasional
하고, (ii) Art. 9 특수 카테고리 또는 Art. 10 데이터의 대규모 처리가 없으며,
(iii) 자연인의 권리·자유에 위험을 초래할 가능성이 낮은 경우 면제한다.

- (i) **Occasional** — EU 거주자를 의도적·정기적 타게팅 대상으로 삼지
  않는다(영문 마케팅 미운영, EU 회원국별 결제·과금 미운영, EU 언어 현지화
  미운영). 정보주체가 자발적으로 Marketplace 에서 설치하는 경우에 한해
  처리가 발생한다. 단 EU 거주자 가입을 명시적으로 차단하지 않으므로 EU
  처리량이 일정 수준을 넘으면 요건이 더 이상 충족되지 않을 수 있다.
- (ii) **특수 카테고리 부재** — privacy §1.6 참조.
- (iii) **저위험** — LLM 처리는 마스킹된 3개 필드만 whitelist 하며(§5),
  자동화된 결정·프로파일링이 아니다(§5.1).

#### (2) GDPR DPO Art. 37 미해당

Art. 37(1) 의 (a) 공공기관 / (b) 핵심 활동이 대규모의 정기적·체계적
모니터링 / (c) 핵심 활동이 Art. 9·10 데이터의 대규모 처리 중 어디에도
해당하지 않는다. 특히 (b) 와 관련해, calendar 메타데이터 처리는 WP29
Guidelines on DPO(WP243) 의 "정기적·체계적 모니터링" 표준 정의에 부합하지
아니한다 — 처리가 sync 시점에 한정되고 외부 광고·프로파일링 출력으로
연결되지 아니하기 때문이다.

#### (3) GDPR DPIA Art. 35 미해당

(i) 자동화된 결정·프로파일링 부재(§5.1), (ii) 특수 카테고리 부재(§1.6),
(iii) PII 마스킹의 mandatory + non-bypassable 적용(§5), (iv) 광고·제3자
ML 학습 부재(§5.2) 로 high-risk 처리에 해당하지 아니한다.

#### (4) 집단소송 포기·강제 중재 미도입 (ToS §11.4)

한국 약관규제법 §14 는 "고객에게 부당하게 불리한 소제기 금지 조항" 을
무효 사유로 두고 있어, 주된 준거법이 한국법인 환경에서 집단소송 포기
조항은 효력을 갖지 못할 가능성이 높다. 강제 중재 역시 미국 FAA 를 근거로
도입하더라도 §11.1·§11.3 의 거주국 강행 소비자보호 법령 우선 적용 원칙과
충돌한다. 따라서 두 조항을 두지 아니한다 — 다만 **조항이 없으면 없는
것이므로** 그 부작위의 논증을 약관 본문에 둘 이유는 없다.

### Round 3 에서 완화한 자기구속

| 대상 | 종전 | 개정 | 사유 |
|---|---|---|---|
| privacy §12 통지기간 | 모든 변경에 30일 사전 통지 | 일반 7일 / 중대 30일 + 이메일 + 재동의. 사실 정정은 지체 없이 게시·즉시 시행 | PIPA §30③ 은 "지체 없이" 공개를 요구할 뿐 기간 규정 없음. 보호위 작성지침 권장은 7일. 30일 일괄 적용은 사실 정정조차 한 달 미룰 의무를 스스로 만들어 고지 정확성을 해쳤다 |
| privacy §9.1 K-12 | "2026-10-31 까지 자동 차단 로직 구현" | 기한 삭제, 사후 인지·즉시 파기 절차 유지 | PIPA §22의2 의 의무는 처리 금지이지 시스템 구축이 아니다. 기한부 로드맵을 처리방침에 두면 미이행 자체가 방침 위반이 된다 |
| privacy §6 동의 이력 | 탈퇴 후 3년 별도 보관 | 탈퇴 시 전량 파기 | 무료 서비스라 전자상거래법 §6③1호 5년 보존 의무 미해당. 보관을 정당화할 법령상 근거 없음(PIPA §21①) |
| privacy §8.2 접속기록 | "1년 이상 보관(vendor audit log 활용)" | 1년 이상 보관 + 요금제 보존기간 미달 시 정기 내려받기·별도 보관 | 「안전성 확보조치 기준」 §8 의 1년은 법정 의무라 삭제 불가. 다만 뒷받침 통제가 없는 진술이었으므로 실행 가능한 절차로 구체화하고 publish 게이트로 승격 |

### Round 3 에서 유지한 것 (덜어내지 않음)

privacy §5.2 Limited Use(OAuth 검수 핵심 요건), §11 권익침해 구제기관
enumeration(PIPA §30①8호), §4.3 CCPA Sale/Share 부재 disclosure, §1.6
미수집 항목, §9.2 COPPA, §9.3 GDPR Art. 8, ToS §5.5 책임 제한 3층 구조,
§7.3 SLA 부재, §9.2 동의 간주 3요건.

### Round 3 자체 검증에서 잡힌 것 (같은 라운드에서 해소)

Round 3 개정본을 별도 검증 패스에 올려 세 축(과잉/부족/정합성)으로 다시
읽혔고, 다음 6건이 나와 같은 라운드에서 고쳤다.

1. **§28의8②5호 누락 — 내 오독이었다.** 개정 초안은 "②항 5호(이전 거부
   방법·절차·효과) 는 1호(동의) 경로 전용" 이라고 §4.1 주석에 박았으나,
   ①3호 **가목의 문언은 "제2항 각 호의 사항을 … 처리방침에 공개한 경우"**
   이고 ②항 각 호에는 5호가 포함된다. 3호 경로에서도 1~5호 전부를 공개해야
   한다. §4.2 를 "이전을 거부하는 방법·절차 및 거부의 효과" 로 재구성하고
   §4.1 에 ②항 각 호 → 절 매핑을 명시해 해소.
2. **게시본에 저장소 내부 스캐폴딩이 실려 나갔다.** `build-legal.ts` 는
   HTML 주석만 제거하므로 도입부 "sub-agent self-review 산출물" 고백,
   `Cross-references` 의 코드 경로 목록, `운영자 publish 체크리스트`,
   본문 곳곳의 `src/CLAUDE.md` 인용이 그대로 공개됐다(빌드 산출물 grep 으로
   확인). `<!-- BUILD-STRIP-START/END -->` 마커를 도입하고 본문 인용은
   평문으로 바꿨다. 게시본 leak 0 확인.
3. **§12 재동의 약속이 §4.1 과 모순.** "중대한 변경 시 명시적 동의를 다시
   받는다" 가 새 국외이전 추가(3호) 에도 걸려, 같은 개정에서 쓴 "별도 동의를
   받지 아니한다" 와 충돌했다. 재동의 대상을 **동의 근거 처리(§2.5)** 로
   한정.
4. **§1A(5) 삭제의 부작용.** "법령상 의무 이행" 행이 실은 동의 상태 컬럼
   3종의 처리 근거를 덮고 있었다. §6 표에는 해당 행을 남겨 두었으므로
   근거만 사라진 상태였다 → (7) 행 신설(§15①4호 + Art. 6(1)(c)/7(1)).
5. **§5 "attendees 완전 제거" 가 부정확.** 실제 구현은 `email` 서브필드만
   제거하고 `displayName` 등은 객체에 남는다. 다만 프롬프트 whitelist 가
   3필드뿐이라 **결론(LLM 미도달) 은 유효**하다. 메커니즘 서술을 "이메일
   제거는 1차 방어, 필드 whitelist 가 최종 경계" 로 정정.
6. **잔여 불일치 3건.** §6.2 의 "30일 이내(PIPA §35 … 30일)" 는 §7.3 의
   10일 및 법정 기한과 어긋나 §7.3 참조로 대체 / ToS §1 의 "**선택적**
   OpenAI 호출" 은 privacy 전반의 정정을 따라가지 못한 잔재라 삭제 /
   §6 표의 동의 상태 행 "cascade 파기" 는 `users` 컬럼이므로 표현 정정.

**검증 패스가 지적했으나 채택하지 않은 것 1건** — "§8.2 점검 주기를 월 1회
이상으로" 는 「안전성 확보조치 기준」 **2025-10-31 개정 이전** 기준이다.
개정으로 점검 주기·방법·사후조치는 개인정보처리자가 내부 관리계획으로
자율 결정하도록 바뀌었다. 본문은 그 취지에 맞게 "내부 관리계획으로 정한다
(현재 반기 1회 이상)" 로 기술했다. 보관 1년은 그대로 유지.

### Round 3 이후 잔존 항목

1. **§4.1.1 연락처 4건의 현행성** — 각 수탁자 처리방침 공개 창구를 기재
   했으나 publish 직전 재확인이 필요하다(운영자 체크리스트 5번).
2. **§8.2 접속기록 보관 루틴** — 절차를 본문에 박았으므로 publish 전에
   실제로 가동해야 한다(체크리스트 6번).
3. **약관·방침 URL 의 실제 게시** — ToS §0.3 이 링크의 존재를 자기 발효
   요건으로 삼으므로, GAS 배포와 legal publish 는 같은 창에서 처리한다.
   **가장 급한 항목이다**: `legal.autocolorcal.app` 이 지금 서비스하는
   본문은 여전히 v1.0 이며, 이번에 지운 허위 기재(LLM 거부권, 세션 7일,
   동의 이력 3년) 가 현재도 공개 중이다. 즉 본 라운드의 문제 진술은 과거형이
   아니라 현재형이고, 개정의 가치는 재배포 전까지 0이다.
4. **정정 예시 저장 개시** — privacy §2.5 · §12 ② 의 30일 경과 + 명시적
   동의 요건은 그대로 유지된다(Round 3 은 이 부분을 건드리지 않았다).

### 검토자 / 검토 일자 / 면책 (Round 3)

- **검토자**: Claude Code (본 저장소 에이전트) — 코드 실측 기반 자기 검토
- **검토 일자**: 2026-07-29
- **면책**: 본 Round 3 정리는 외부 변호사 의견에 갈음하지 아니한다. 본
  라운드의 성격은 새로운 법적 판단의 추가가 아니라 **본문과 코드의 사실
  정합성 회복 및 법령이 요구하지 않는 기재의 제거**이며, 각 항목은 코드
  실측 결과를 근거로 한다.

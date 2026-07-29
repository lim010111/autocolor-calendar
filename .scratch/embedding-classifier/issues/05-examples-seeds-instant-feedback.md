Status: ready-for-human
GitHub: #117

## What to build

`example` 씨앗(Verified 등급)을 도입하고 Instant Feedback(idea 2)을 그 위에
착지시킨다. example 은 사용자가 "이 일정은 이 Rule 이었다"고 확정한 실제 과거
제목으로, 이 시스템 최초의 **durable 캘린더 내용 저장**이다.

end-to-end 범위:

- `rule_seeds` 에 `seed_type='example'` 행 — Verified 등급. Stage 1 결정
  로직에서 example 씨앗 적중은 낮은 바 `T_verified` 로 평가된다 (이슈 #02 가
  깐 결정 로직의 `T_verified` 경로가 여기서 활성화).
- 사이드바 "Event color analysis" 화면 — 분류가 사용자 의도와 어긋났을 때
  사용자가 올바른 Rule 을 지목 → 그 이벤트 제목이 해당 Rule 의 example 로
  추가되고 임베딩되어 `rule_seeds` 에 기록.
- examples 생애주기 — Rule 당 캡 10개, FIFO eviction, 한 제목은 한 Rule 의
  example 만(다른 Rule 에 같은 제목 example 이 있으면 제거, last-write-wins).
- redaction — example 은 저장 전 `consentExample()`(= `redactString` +
  `ConsentReceipt` 검증)를 통과해 durable 저장된다(`redactEventForLlm` 이 아니다 —
  그건 transient LLM 입력용). redaction 이 제목을 과하게 망가뜨리면(빈 문자열/≥50%
  placeholder) 그 정정은 example 로 부적합 — 조용히 버린다 (키워드 추가 경로는
  여전히 가능).
- LLM user-메시지의 카테고리 JSON 에 examples 가 구조화 필드로 합류 (산문
  프롬프트 아님); system 프롬프트엔 "examples 필드 사용법" 1줄만 전역 추가.

## Provisional dependencies (ADR-0005) — 상속

#05 는 #02/#03 이 흡수한 세 잠정 결정을 **그대로 상속**한다(재-흡수 불요): 모델·
차원 `gemma`(768) provisional / 임계값 `T=(0.30,0.55,0.10)` provisional / 프리픽스
= prod 불변항. example 임베딩은 반드시 #02 의 `embedTexts` 헬퍼(고정 프리픽스 강제,
`src/services/embeddings.ts`)를 경유한다 — 독립 임베딩 경로/프리픽스 금지(불일치 시
저장 씨앗 벡터 전수 오염, ADR-0005 §prefix).

## 기존 prep seam (이미 존재 — 이 seam 안에서 구현)

- `piiRedactor.ts`: `ConsentedExample`/`ConsentReceipt` 타입 + `consentExample()`
  민터(= `redactString` + receipt 검증). **durable 저장 민터는 이것**이지
  `redactEventForLlm`(transient LLM 입력)이 아니다.
- `ruleService.ts`: `addExample(db, _example: ConsentedExample)` 싱크(현재
  **stub** — `_example` 미사용) + `SeedType`/`SeedGrade`/`synthesizeSeeds`.
- src/AGENTS.md §5.2 불변항: 새 redactor·out-of-file `as ConsentedExample`
  캐스트 금지 — `consentExample` 이 유일 민터.

## OAuth 게이트 — 다크 빌드 후 해제

`ConsentReceipt` 는 개인정보처리방침 없이 mint 될 수 없다(타입 게이트) → 검수 전엔
example durable 저장이 **구조적으로** 일어나지 않는다. 착지 전략: **백엔드·seams·
테스트를 pre-OAuth 다크 빌드**로 머지(저장 0), **Instant Feedback UI 표면화 + 동의
흐름 + 개인정보처리방침 변경분**은 OAuth 검수(2026-05-14 재제출분) 통과 후 별도 PR.
통과까지 oauthScopes/consent/redirect/GAS deploy URL 동결.

## Acceptance criteria

### 저장 경로 (씨앗 write) — 다크 빌드 가능

- [x] **`consentExample`→`addExample` 경로로 저장** — example 은 `consentExample()`
      (≡ `redactString` + `ConsentReceipt` 검증)로 민팅되어 `addExample(db,
      ConsentedExample)` 로 저장된다. `addExample` stub 을 실동작으로 채운다:
      임베딩(`embedTexts`, 고정 프리픽스) → `rule_seeds(seed_type='example')` insert.
      `redactEventForLlm` 직접 경로 사용 금지(src/AGENTS.md §5.2).
- [x] **과도 redaction drop 기준** — `redactString` 후 제목이 (a) 빈 문자열이거나
      (b) 문자의 **≥50% 가 placeholder 토큰**이면 example 로 부적합 → **조용히
      버린다**(저장 0, keyword 추가 경로는 여전히 제공). 임계 로직 단위 테스트.
- [x] **kNN 풀 자동 합류 (테스트 고정)** — example 씨앗이 seed-type-무관
      `DISTINCT ON (rule_id)` max-코사인 풀에 자동 합류함을 테스트로 고정(read-path
      코드 변경 0 — #02/#03 이 이미 커버, 회귀 방지 목적).

### examples 생애주기 (3 불변항 — 각각 검증)

- [x] **캡 = Rule 당 example 10개** — 11번째 추가 시 캡 초과분을 정리한다.
- [x] **FIFO eviction** — 캡 초과 시 `created_at` 기준 가장 오래된 example 행부터
      밀어낸다(씨앗 행 삭제 = 임베딩도 함께 소멸). eviction 순서 단위 테스트.
- [x] **제목당 단일 Rule (last-write-wins)** — 같은 (redacted) 제목이 다른 Rule 의
      example 로 이미 있으면 그 행을 제거하고 새 Rule 로 이동한다. 제거는 **테넌트
      스코프**(`where user_id=? AND seed_type='example' AND seed_text=?` — RLS 는
      Worker 경로 무효). CONTEXT.md "한 제목은 최대 한 Rule 의 Example".

### 결정 로직 (`T_verified` 활성화)

- [x] **Verified 경로 활성 + grade-aware 바** — `decideStage1` 은 풀 전체 max-코사인
      **승자 씨앗의 seed_type** 으로 바를 고른다: example→verified→`T_verified`(낮은
      바), name/keyword→declared→`T_declared`. 별도 verified-only 집계 없음.
- [x] **cold-start nan 비이슈 테스트** — example 0개 Rule 은 verified 씨앗이 승자가
      될 수 없어 `T_verified` 가 발화하지 않는다 → ADR-0005 REPORT §1 의 "verified
      score nan" 은 max-over-pool 설계에서 발생하지 않음을 테스트로 고정.
- [x] **cross-grade margin 테스트** — best=verified(rule A) · second=declared(rule
      B) 가 `margin` 이내면 여전히 모호 → Stage 2. margin 은 등급 무관 전 풀에 적용.

### 실패 거동

- [x] **embed-before-mutate + 실패 시 UI 표면화** — example 임베딩을 행 변경 이전에
      수행; 실패 시 정정 미저장 + **Instant Feedback UI 에 소프트 실패 표면화**.
      (직접 사용자 행위 → #02/#03 의 fan-out warn-only-silent 와 **구별**: 정정이
      안 붙었음을 사용자가 알아야 함.)

### LLM 프롬프트

- [ ] **examples 구조화 필드** — LLM user-메시지 카테고리 JSON 에 examples 가 구조화
      필드로 합류(산문 프롬프트 아님) + system 프롬프트에 "examples 필드 사용법"
      1줄 전역 추가. 프롬프트 **버전 범프** + eval-gate 3-gate 통과.
      *(남은 일이 바뀌었다 — 필드·v6 프롬프트·레지스트리는 이미 있고, ADR-0007 의
      버전 인터록 때문에 **eval-gate 를 통과해 기본 버전을 v6 로 올리는 것**이
      곧 이 AC 다. `OPENAI_API_KEY` 블로커는 실재하지 않았음이 ec#07 에서 실측됨.)*

### 동의·법무 (OAuth 게이트 — UI/출시는 검수 후)

- [x] **동의 모델 = 1회 동의** — 첫 Instant Feedback 정정 시 저장 동의를 1회 수집,
      이후 `ConsentReceipt` 가 모든 example 을 커버(철회 전까지). 철회 시 신규 저장
      중단(기존 행 처리는 개인정보처리방침 결정을 따른다).
      *(ADR-0007. `users` 3개 컬럼 + `consentReceiptFrom` 타입 게이트. 철회 시
      기존 행 **즉시 전량 삭제**로 확정 — 사용자 결정, 2026-07-28.)*
- [x] **사이드바 Instant Feedback UI** — "Event color analysis" 에서 Rule 지목 →
      example 추가가 end-to-end 동작한다. **OAuth 검수 통과 후 표면화**(다크 빌드
      단계에선 백엔드 경로만, 저장 0).
      *(코드 완료 — rememberExample 체크박스 + 동의 카드 + 철회 카드 + i18n 28키
      ×4. **배포는 미실행**: 이번 세션 범위가 코드·문서까지이고, §12 30일 통지가
      선행돼야 한다.)*
- [ ] **개인정보처리방침/동의 표면 변경분** — "동의 시 정정 제목(redacted)이 durable
      저장됨"을 명시. `legal-reviewer` 게이트 통과. OAuth 검수 통과 후 출시.
- [x] **동의 모델 결정 기록** — 1회 동의 모델 + durable 저장 disclosure 를
      개인정보처리방침 문서(또는 ADR-0004 amendment)에 기록. **신규 durable-storage
      ADR 은 불필요** — 저장 결정은 ADR-0004 §범위 + src/AGENTS.md §5.2 가 이미 외부화.
      *(ADR-0007 로 기록 — 사용자 결정. durable-storage ADR 이 아니라 **동의 모델**
      ADR 이므로 위 금지에 저촉되지 않는다. ADR-0004 는 본문 동결 정책에 따라
      `[개정 …]` 포인터 한 줄만 추가. 정본 불변항은 src/AGENTS.md, 고지는 §2.5.)*

### lockstep + 범위 명시

- [x] **src/AGENTS.md §5.2 lockstep** — `ConsentedExample` 를 "type only" →
      **활성 durable 경로**로 갱신하고, §5-classifier 의 "`T_verified` inert until
      #05" 서술을 갱신한다(이 PR 에서 동시).
- [x] **exact-match shortcut = 이연 (명시)** — CONTEXT.md/ADR-0004 가 언급하는 제목
      완전일치 shortcut 은 **이 이슈 범위 밖**. #05 는 example 을 임베딩 씨앗으로만
      다룬다 — 완전일치 direct-hit 는 별도 후속 이슈로 남긴다.
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

- #03
- ~~출시는 OAuth 검수 통과 후에만 가능~~ — 해소 (2026-07-24 승인)
- ~~eval-gate 가 `OPENAI_API_KEY` 재발급 대기~~ — **블로커 부재로 확인**
  (2026-07-28, ec#07 실측: 68회 호출 전부 200)

## Comments

### 2026-07-17 — 다크 빌드 범위 구현 (agent)

브랜치 `embedding-classifier/05-examples-dark-build`. 백엔드·seams·테스트만
머지, durable 저장 0 (`ConsentReceipt` 프로덕션 민터 부재 = 타입 게이트 유지).

- **저장 경로**: `consentExample(title, ruleId, userId, receipt)` →
  `ConsentedExample | null` (unfit 시 null = 조용한 drop). unfit 판정은
  `isUnfitExample` (trim 후 빈 문자열 or placeholder 문자 비율 ≥50%).
  `addExample(db, embed, example)` 실동작: embed-before-mutate →
  last-write-wins 테넌트 스코프 delete → insert → 캡 10 초과분 FIFO 축출.
- **실패 거동 AC 해석 (다크 빌드)**: `addExample` 이 embed 실패를
  `{stored:false, reason:"embed_failed"}` 로 **호출자에 표면화** (#02/#03
  warn-only-silent 와 구별). "Instant Feedback UI 에 표면화" 절반은 OAuth
  후 UI PR 이 이 반환값을 소비하며 완성 — seam 은 이 PR 로 완결.
- **LLM 프롬프트 AC 미체크 사유**: `examples` 구조화 필드(`buildPrompt`) +
  `listRules` example 씨앗 합류 + system v6 프롬프트(v2 + 사용법 1줄) +
  버전 등록까지 완료했으나, **eval-gate 3-gate 실행이 환경 문제로 차단** —
  `.dev.vars` 의 `OPENAI_API_KEY` 가 401 (Incorrect API key, 폐기/회전된
  키). 지시대로 우회하지 않음. `DEFAULT_CLASSIFIER_PROMPT_VERSION` 은
  §5.3 규칙("eval-gate 통과 시에만 범프")에 따라 v2 유지 — 다크 빌드에선
  examples 가 항상 `[]` 이라 v2 유지가 동작 차이 0. **후속(사람)**: OpenAI
  키 재발급 → ①회귀 가드(≥90% + user-report-* 0 fail) ②4로케일
  `--include-rule-leg` 델타 ≥ -1%p (최신 v2 베이스라인 2026-05-13: en
  0.885 / ko 0.891 / zh-CN 0.875 / zh-TW 0.880) ③Pattern B 4건 grep →
  통과 시 DEFAULT v6 범프. 401 노이즈 ledger 행은 append 직후 revert 함.
- Status `ready-for-human`: 잔여 = eval-gate 재실행(키 재발급 필요) + OAuth
  게이트 4개 AC (동의·법무·UI).

### 2026-07-18 — merge-gate findings pass 1 (agent, ADR-0027)

PR #154 push 의 advisory 리뷰 findings 1건 (codex:finding-0, high/uphold):
`addExample` delete-then-insert 비원자성.

- **(a) insert 실패 시 example 전멸** — 재현 서브가 오라클
  (`ruleService.finding0.repro.test.ts`, HEAD 에서 fail) 로 **입증** →
  분리 fix 서브가 `reconcileKeywordSeeds` 와 동일한 **insert-before-delete**
  로 수정 (클라이언트 민팅 id + `ne(id)` 제외; 중간 실패 = 일시적 중복
  over-inclusive 로 완화, 다음 write 자가 치유). 오라클 동결 검증 완료.
- **(b) 동시 정정 중복 / txn·partial unique index 권고** — 미수정.
  ADR-0004 #03 이 명시 채택한 eventually-consistent·observed-not-prevented
  정책과 동일 클래스 (락/제약 없음, 중복 시 ambiguous→Stage 2 degradation).
  `(user_id, seed_text) WHERE seed_type='example'` partial unique index 는
  스키마 마이그레이션 — 원하면 별도 이슈로 (사람 판단).

### 2026-07-24 — OAuth 게이트 해제 (외부)

Google Trust & Safety 승인 통보(project `autocolor-dev`): `script.external_request`
/ `calendar` / `calendar.events` 3종. 위 "OAuth 게이트 — 다크 빌드 후 해제"
절의 외부 조건이 **충족** — 동의·법무·UI 4개 AC 착수 가능.

- 동결 해제: oauthScopes / consent / redirect / GAS deploy URL 동결은 종료.
  단 GAS `/exec` URL 안정성은 별개 프로젝트 룰이라 계속 유지(AGENTS.md).
- **신규 제약**: 승인 메일 조건 — 신규 스코프 요청 또는 consent screen *설정*
  변경 시 재검수 필요. 본 이슈의 개인정보처리방침 *본문* 갱신은 URL 이 그대로면
  consent screen 설정 변경이 아니므로 재검수 트리거 아님(URL 을 바꾸면 트리거).
- 잔여 non-OAuth 게이트는 그대로: eval-gate 3-gate (OPENAI_API_KEY 재발급 필요).

### 2026-07-28 — OAuth AC 4건 구현 (agent)

브랜치 `embedding-classifier/05-examples-consent-ui`. 커밋 2개(백엔드 / 문서·GAS).
663 tests(+41) / typecheck / lint / check-context-paths / legal:build 통과.

**사람이 내린 결정 3건** (착수 전 확인):
1. 철회 시 기존 example 행 → **즉시 전량 삭제**.
2. 결정 기록 위치 → **신규 ADR-0007**. (AC 가 금지한 것은 *durable-storage*
   ADR 이고 이것은 *동의 모델* ADR 이라 저촉되지 않는다. ADR-0004 는 본문 동결
   정책상 `[개정 …]` 포인터 한 줄만 추가.)
3. eval-gate 는 이번 세션 범위 밖 — AC 1 실측 보고 후 정지.

**에이전트가 내린 기술 판단 4건** (되돌리기 쉬운 것들, 명시):
- receipt 를 정책 버전 일치까지 게이트(§12 재동의의 기계적 집행).
- `embed_failed` 를 5xx 가 아니라 200+reason 으로 — 5xx 면 `gas/api.js` 의
  3회 백오프에 걸려 사이드바가 멈추고 소프트 실패가 장애와 구분되지 않는다.
- rememberExample 체크박스 기본 OFF.
- `POST /api/examples` 에 2초 throttle(`users.last_example_at`) 추가 — AC 요구
  사항은 아니지만 호출당 Workers AI embed 1회를 태우는 인증 엔드포인트다.

**착수 중 발견한 것 — 이 이슈의 설계를 바꿨다.**

example → 프롬프트 체인이 **이미 전부 배선돼 있었고**, 저장이 0이라서만
무해했다: `addExample` → `listRules`(:167-189) → `buildPrompt`(:222-224) →
`llm_calls.prompt_summary`. 코드 주석이 그 전제를 명시하고 있었다
(llmClassifier.ts:217-218 "dark build stores zero examples"). 저장을 켜는
순간 두 가지가 조용히 따라온다:

1. **eval-gate 우회** — 현행 기본 프롬프트는 v2 이고 v2 는 examples 필드를
   설명한 적이 없다. 필드를 채우면 §5.3 상 eval-gate 대상인 모델 입력 변경이
   뒷문으로 나간다.
2. **철회 purge 가 닿지 않는 사본** — 동의한 제목이
   `llm_calls.prompt_summary` 에 durable 복제되어 "즉시 전량 삭제" 가 거짓이
   된다.

**조치**: `buildPrompt` 가 필드를 문서화한 프롬프트 버전에만 examples 를
싣도록 게이팅(`promptVersionSendsExamples`). 피처 플래그가 아니라 **버전
키잉**이라 eval-gate 를 통과해 기본 버전을 올려야만 켜진다. eval 러너는
`--prompt-version v6` 로 그대로 델타 측정 가능하므로 위 프롬프트 AC 가 잃는
것은 없다. 회귀 테스트로 고정(v2 → `[]`, v6 → 채워짐).

부수 효과로 example 이 이번 PR 에서 **OpenAI 에 도달하지 않으므로** §4.1
국외이전 항목이 하나 줄고, 새로 고지할 수탁자는 Cloudflare Workers AI 하나만
남는다.

**같은 diff 에서 시정한 기존 부정확 기재 2건** (이번 작업이 만든 것이 아니라
드러낸 것 — 편집 대상 절에 있던 사실오류라 방치할 수 없었다):
- 처리방침 §2.3 이 `llm_calls` 를 "집계 카운터만, 이벤트 내용 미포함" 으로
  기술했으나 `prompt_summary` / `raw_response` 가 마스킹된 이벤트 텍스트를
  durable 저장한다(migration 0015, 현재 라이브).
- Cloudflare **Workers AI** 가 동기화 읽기 경로에서 이벤트 제목을 처리하는데
  §4 에도 `sub-processors.md` 에도 없었다.

**배포하지 않은 것**: `clasp push` / `wrangler deploy` / `db:migrate`.
마이그레이션은 파일만(`drizzle/0020_dark_thor_girl.sql`). 처리방침 v1.1 은
§12 **중대한 변경**(1·2·3호 해당)이라 시행 30일 전 사전 통지 + 이메일 별도
통지가 선행돼야 하고, 그 전까지 §2.5 저장은 구조적으로 개시되지 않는다
(동의 없이는 저장 경로 호출 불가). 매니페스트 무변경이라 OAuth 재검수
트리거는 아니다.

### 2026-07-29 — legal-reviewer 게이트 1패스: 조건부 미통과 → Critical 5건 해소

**판정: 조건부 미통과** (Critical 5 / Warning 14 / Nit 6). Critical 5건 중
**3건이 이 세션 작업의 결함**이었다. 전부 해소하고 커밋했다(`613cb22`).

| # | 내용 | 성격 |
|---|---|---|
| C1 | v1.1 "시행일 미정" 구조가 **허위 기재를 30일 더 유지**시킨다 | 내 결함 |
| C3 | "이벤트 본문 미포함" 잔재 2곳(§1.5, §6 표) — §2.3 시정과 정면 충돌 | 내 결함 |
| C4 | 임베딩 leg 는 제목 **원문**을 마스킹 없이 Workers AI 로 보낸다 | 기존+내 무기재 |
| C5 | ToS §10.3 in-transit 확약이 §2.5·§2.3 과 충돌 (+ "9개 테이블") | 기존 |
| C6 | 동의 성립 **전에** 제목이 서버 경계를 넘음 — ADR-0007 근거를 코드가 부정 | 내 결함 |

**C1 이 가장 아팠다.** diff 에 (a) 이미 살아 있는 처리에 대한 *기재 시정*과
(b) *신설 처리*가 섞여 있는데 둘을 하나의 30일 시계에 묶었다. 정정분에는
사전 통지 기간이 존재하지 않는다 — 정확한 고지가 즉시 이행 의무이기 때문.
그대로 publish 했으면 "현재 유효한 정책은 여전히 허위 기재된 v1.0 이고
사업자는 그것이 틀렸음을 인정한 채 30일을 끈다" 가 됐다.

**C6 는 설계-코드 불일치.** ADR-0007 이 동의 엔드포인트를 분리한 근거가
"동의 기록 생성 전에 제목이 경계를 넘지 않는다" 인데, 라우트는 본문을 먼저
파싱한 뒤 403 을 냈다. 동의 확인을 본문 파싱 앞으로 옮기고, 깨진 본문에도
400 이 아니라 403 이 나오는 것으로 오라클을 걸었다.

**§12 30일에 대한 명시적 판정 (질문 1의 답).**
- PIPA 에 처리방침 변경의 30일 사전 통지 의무는 **없다**(§30② 는 "변경 시
  공개", 보호위 지침 권고는 최소 7일). 30일은 **본 정책 §12 의 자기구속**.
- 따라서 구속 대상은 **v1.0 을 신뢰하고 이미 가입한 정보주체뿐 = 현재
  운영자 1명**. 게시 후 가입자에게 v1.1 은 수집 시점의 최초 고지다.
- **결론: 런치는 30일에 걸리지 않는다. 걸리는 것은 §2.5 저장 기능 하나뿐.**
  D+0 게시·통지·런치 가능, D+30 이후 저장 개시. 트레일러에 이 구분을 박았다.

**질문 3(동의 이력 3년) 판정**: 모순 **맞음**, 다만 Critical 아닌 Warning
(방향이 "더 오래 보관하겠다는 약속의 미이행" 이라 정보주체 피해가 아님).
v1.1 이 만든 게 아니라 드러냈고, 모순되는 두 행을 나란히 놓아 **가시성은
악화**시켰다. 권고는 "구현 없는 약속을 내려라" — W5 로 이월.

**남은 Warning 14 / Nit 6 은 이월한다.** 이번 세션 범위(코드·문서)를 넘거나
사람 판단이 필요한 것들이다. 우선순위 높은 것:
- **W8**: 리뷰어가 게이트를 돌린 시점에 GAS 동의 카드가 아직 커밋 전이라
  "문안 미존재" 로 잡혔다. **지금은 존재한다**(`ca905cf`) — 카드 문안에 대한
  게이트 1패스가 별도로 필요하다. PIPA §15② 4대 고지사항 체크리스트를
  리뷰어가 제시해 뒀다.
- **W12**: 프롬프트 기본값을 v6 로 올리면 저장된 예시가 OpenAI 로 나가
  §4.1 이전 항목과 §2.5 "전량 삭제" 가 **조용히 거짓이 된다**. 엔지니어링
  인터록(ADR-0007)은 있는데 **법적 트리거가 어느 문서에도 없다**. §2.5 에
  "전송 개시는 §12 중대한 변경" 문장을 넣어야 한다. → 위 프롬프트 AC 와
  직결되므로 그 AC 착수 시 동시 처리할 것.
- **N4**: `src/routes/home.ts:127` 이 Stage 1 에 대해 "Data never leaves
  Calendar" 라고 말하는데 C4 대로 거짓이다. 공개 홈페이지 = consent screen
  링크 대상이라 리뷰어 노출 표면.
- **N1**: `<!-- LEGAL-REVIEW: … -->` 주석 15개가 게시 HTML 소스에 그대로
  실려 있다("…회피 disclosure", "OAuth 검수 차단 위험" 등). 빌드에서 스트립.
- W1(§22·§37 조문 번호가 구 체계), W4(`llm_calls` 목적·근거가 §1A 표에 없음),
  W9/W10(processing-region.md·sub-processors.md 정합), W11(민감정보 전제
  변화 + mini-DPIA), W13(`pg_cron session-gc` 미구현).

**AC(:112)는 여전히 미체크.** Critical 은 해소했으나 (a) 확인 패스를 돌리지
않았고 (b) W8 대로 이제 존재하는 동의 카드 문안이 미검토다. 다음 세션에서
게이트 2패스 후 확정할 것.

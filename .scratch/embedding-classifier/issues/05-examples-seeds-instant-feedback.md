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
- [x] **개인정보처리방침/동의 표면 변경분** — "동의 시 정정 제목(redacted)이 durable
      저장됨"을 명시. `legal-reviewer` 게이트 통과. OAuth 검수 통과 후 출시.
      *(privacy §1.7·§2.5 신설 + v1.1. 게이트는 **Round 4 재검증**으로 닫았다 —
      수정본을 그대로 다시 읽혀 Round 3 이 고친 9건이 재현되지 않음을 확인하고,
      새로 잡힌 8건 + 운영자 실측 2건을 `7825e12` 로 해소했다. 게시본 leak 0.
      잔존은 게시·배포 실행뿐이며 텍스트 게이트는 아니다 —
      `docs/legal/legal-review-opinion.md` Round 4.)*
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

### 2026-07-29 — legal-reviewer 2패스: 잔여 Critical 해소, 사람 결정 2건 남음

1패스 수정분을 다시 받아 본 결과 놓친 것들이 나왔다. 해소분 (`e5b0f2b`):

- **C1 잔여 — §0 요약이 세 번째 잔재였다.** §1.5·§6 만 고치고 §0 을 놓쳤다.
  durable 저장 2건 중 §2.5 만 노출하고 §2.3 을 빠뜨려, 요약만 읽는 정보주체는
  마스킹된 이벤트 텍스트 저장 사실을 알 수 없었다.
- **C2 — `llm_calls` 의 처리목적·법적 근거가 §1A 에 없었다.** §2.3 에서 사실은
  인정하고 근거 행은 없는 상태. 행 (7) 신설(정당한 이익).
- **N2 — Limited Use 참조가 §5.4 를 가리킨다** (실제 §5.2). OAuth 심사에서
  리뷰어가 따라가는 링크.
- **W6 — PIPA §22·§37 조번호가 2023 개정 전 기준** 5곳.
- **§12 경과 문언 추가** — 30일 자기구속의 수범자를 "통지 시점의 기존
  이용자" 로 한정 + 별도 명시적 동의로 갈음. 이게 없으면 30일 미준수가
  형식적 자기 약관 위반이 된다.
- **N1 — LEGAL-REVIEW 주석 15건이 게시 HTML 에 실려 있었다.** 빌드 스트립(→0).
- **C4 — 공개 홈페이지 2문장이 정책과 정면 모순.** `home.ts:127` "Data never
  leaves Calendar"(임베딩 leg 가 원문 전송), `:142` "never written to …
  dashboards"(`llm_calls` 진단 컬럼 존재). brand-verified 홈페이지 =
  consent screen 링크 대상이라 상시 반려 리스크였다.

**§12 30일에 대한 최종 판정 — 런치는 막히지 않는다.** PIPA §30② 은 "변경 시
공개" 만 요구하고 30일은 §12 의 자기구속이다. 수범자는 기존 이용자(=운영자
1명)뿐이고, 게시 후 가입자에게 v1.1 은 수집 시점의 최초 고지다. 신규 처리의
적법성은 통지기간이 아니라 동의에서 나오며, `consentReceiptFrom` 이 없으면
저장 경로 호출 자체가 불가능하다. 경과 문언까지 넣었으므로 **D+0 publish ·
D+0 런치 가능, 30일 대기 불필요.**

**남은 사람 결정 2건:**
1. **K-12 90일 커밋 (§9.1)** — 원래 "시행일로부터 90일" 이라 v1.0 기준
   **2026-08-03 만기이고 미구현**이었다. 개정할 때마다 시계가 리셋되는 구조라
   clock-shopping 으로 읽혀서, 고정 일자 **2026-10-31** + "개정은 본 기한을
   연장하지 아니한다" 로 바꿨다. **날짜는 임의로 정한 것이니 확정 필요.**
2. **동의 이력 3년 약속 (§6 `:442`)** — 구현이 0이고 §6 표 안에서 바로 위
   행과 모순된다. 리뷰어 권고는 **약속을 내리는 것**(무료 서비스라 전자상거래법
   보존 의무 대상 아님 → 탈퇴 시 일괄 파기로 문구 정리). 반대 선택은 탈퇴 후
   살아남는 pseudonymous 원장을 실제로 구현하는 것인데 별도 설계가 필요하다.
   **약속을 유지한 채 미구현으로 두는 것만이 유일하게 나쁜 선택지다.**

**이월 (publish 전 권장, 이번 범위 밖):** W3(동의 카드와 철회 설정은 **같은**
GAS version 으로 배포 — grant 만 있고 revoke UI 가 없는 구간은 GDPR Art. 7(3)
위반 구간), W2(프롬프트 v6 flip 시 §2.5·§4.1 이 거짓이 됨 — 정책에 트리거
문장 필요), W4(`processing-region.md` 가 §3 의 정본인데 §3 과 모순 + Workers AI
미기재), W5(`security-principles.md:49-53` 이 C4 거짓 진술의 상류),
W7(`pg_cron session-gc` 미구현인데 §6 이 "일일 삭제" 로 단정), W10(제3자 보관
여부 단정 완화), Q4 보완(§2.5 에 국외이전 포인터·보유기간·재동의 시 미복구·
support 대체 채널), C5 부수(ToS §8.1 "9개" → 10, `marketplace-readiness.md:180`,
`account.ts:21` 주석).

**AC(:112)는 여전히 미체크.** 2패스 Critical 은 해소했으나 (a) 3패스 확인이
없었고 (b) **동의 카드 문안 자체는 아직 한 번도 게이트를 통과하지 않았다**
(1·2패스 모두 카드 커밋 전 상태를 봤다). 카드에 PIPA §15② 4대 고지사항
(목적·항목·보유기간·거부권과 불이익)과 "철회 시 전량 삭제·재동의해도 미복구"
가 들어 있는지 확인받는 것이 다음 세션 첫 작업이다.

### 2026-07-29 — C7: 온보딩 동의 표면이 **아예 없다** (사용자 질문에서 발견)

"온보딩에서 이미 동의를 받는데 examples 에서 또 받는 것 아니냐" 는 질문을
코드로 확인한 결과, **정반대의 결함**이 나왔다. examples 동의는 중복이 아니라
**제품 전체에서 유일한 명시적 동의 표면**이다.

**측정 (코드 기준):**
- `buildWelcomeCard` (`gas/addon.js:92-121`) 의 전부 = 헤더 + 튜토리얼 3문단
  (`welcome.step1~3`) + "Google 계정으로 시작하기" 버튼. 처리방침 링크 없음,
  약관 링크 없음, 체크박스 없음, 국외이전 문구 없음.
- Add-on 전체에서 처리방침 링크는 `addon.js:1512` **단 한 곳** — 이번에 만든
  examples 동의 카드 안이다.
- `actionStartOAuth` → Worker `/oauth/google` → 곧장 Google 동의 화면
  (`prompt=consent`). 콜백은 바로 upsert + bootstrap. 중간에 동의 단계 없음.
- `authCallback.html` 에도 관련 문구 없음.

즉 온보딩이 받는 것은 **Google OAuth 권한 부여**뿐이고, 이는 PIPA §15 동의와
다른 도구다 — 상대방(Google vs 사업자), 고지 항목(스코프 목록 vs 목적·항목·
보유기간·거부권) 이 모두 다르다.

**그래서 문서 3곳이 존재하지 않는 동의 시점을 단정하고 있다:**

1. **`privacy-policy.md` §4.1 (`:337-343`)** — 가장 구체적이고 가장 나쁘다.
   온보딩 카드가 표시한다고 **문구를 그대로 인용**한다: *"본 서비스는 미국·
   일본·캐나다·아일랜드 등에 데이터를 이전합니다…"*. 이 문자열은 `i18n.js`
   4개 번들 어디에도 없다. 장식 문단이 아니라 **PIPA §22① 분리 동의를
   충족하는 기제**로 정책이 스스로 지목한 문단이고, 국외이전(§28의8)은 분리
   동의 대상이다.
2. **`privacy-policy.md` §1A (`:53`)** — "정보주체 동의(OAuth 동의 + 본
   처리방침 동의 시점)". 처리방침 동의 시점이 존재하지 않는다.
3. **`terms-of-service.md` §0.3 (`:38-40`)** — "본 약관에 동의하고 …
   회원가입을 완료한 시점에 효력을 발생한다." 약관 동의 절차가 없으므로
   **약관 자신의 문언에 의해 효력이 발생한 적이 없다.**

**§6 3년 약속(위 사람 결정 ②)의 성격도 바뀐다.** 원장이 없어서 미구현인 게
아니라 **기록할 이벤트 자체가 존재하지 않는다.** 두 건은 같은 뿌리다.

**비대칭이 핵심:** 선택 기능(examples)은 타입 게이트·버전 고정·철회·4대
고지사항까지 갖춘 반면, 훨씬 많은 데이터를 처리하는 **본 서비스**(모든 일정
제목·설명·장소 읽기, 제목 **원문**의 Workers AI 국외이전)에는 동의 표면이
0이다.

**심사가 잡아주지 않는다** — OAuth/마켓플레이스 심사는 consent screen 구성과
처리방침 URL 존재를 보고, 이 결함은 문서와 코드를 **대조해야만** 보인다.
2패스 legal-reviewer 도 못 잡았다(문서만 검토).

**권고 = 온보딩에 동의 단계 추가 (문서가 이미 약속한 쪽).** welcome 카드에
(a) 처리방침·약관 링크, (b) §4.1 국외이전 요약 문구, (c) CTA 를 "동의하고
시작하기" 로, 그리고 동의 시각·정책 버전 기록. 반대 방향(문서를 현실에 맞춤)
은 국외이전이 계약이행으로 갈음되지 않으므로 순수하게는 불가능하다.
`consentService` 배관을 방금 만들어놨으므로 재사용 가능하고, 스코프·consent
screen 설정 변경이 아니라 **OAuth 재검수 트리거는 아니다**.

**배포 제약에 합류한다:** W3(동의 카드 + 철회 UI 동시 배포)에 온보딩 카드까지
묶어 **한 GAS version 으로** 나가야 한다. 범위·일정은 사람 결정.

#### 정정 (같은 날, 법령 조사 후) — 위 권고는 과잉이었다

**틀린 문장:** "국외이전이 계약이행으로 갈음되지 않으므로 문서를 현실에 맞추는
것은 불가능하다." **PIPA §28의8①3호가 정확히 그것을 허용한다.**

- **§15①4호** — 계약 이행에 필요한 수집·이용은 **동의 없이 가능**. 2023-09-15
  시행 개정에서 '불가피하게' 가 삭제되어 적용 폭이 넓어졌다. 본 서비스의 핵심
  처리(일정 읽기·색칠·토큰 보관)는 여기에 해당하므로 **§15 동의는 애초에
  법적으로 불필요**하다.
- **§28의8①3호** — 계약 체결·이행을 위한 처리위탁·보관이면 **별도 동의 대신
  처리방침 공개로 갈음**. 기재 요구: ①이전 항목 ②이전 국가·시기·방법
  ③이전받는 자의 명칭 **및 정보관리책임자의 연락처** ④이용목적·보유이용기간.
  (1호 동의 경로에만 필요한 "거부 방법·절차·효과" 는 3호에서 불요.)
  클라우드 sub-processor 를 쓰는 사업자의 표준 경로다.

**따라서 결함의 크기가 셋으로 쪼개지고, 하나는 새로 발견됐다:**

**C7-A — §4.1 이 잘못된 경로를 탄다 (문서만 수정, 코드 0).** 현재 1호(동의)
경로를 주장하며 그 근거로 존재하지 않는 온보딩 카드 문구를 인용한다. **3호로
갈아타면** 그 문단이 통째로 삭제되고, 표에 **연락처 1열만 추가**하면 요건이
충족된다. 지금은 1호도 3호도 아닌 상태라 어느 근거도 못 타고 있는 게 문제이지,
동의 표면이 없는 것 자체가 문제가 아니다.

**C7-B — 약관 동의 절차 부재 (PIPA 아닌 계약 성립 문제).** ToS §0.3 이 "본
약관에 동의하고 회원가입을 완료한 시점에 효력을 발생한다" 고 자기 발효요건을
규정했는데 그 절차가 없다 → **약관이 발효된 적 없음** = 면책·책임제한 조항이
집행 불가. 글로벌 SaaS 표준 패턴(clickwrap-lite: CTA 옆 "시작하면 약관 및
개인정보처리방침에 동의하는 것으로 봅니다" + 링크 2개)이면 충분하다. 위젯 1~2개.

**C7-C — LLM 거부권이 코드에 없다 (신규 발견, 셋 중 가장 나쁨).**
- `buildSettingsCard` 의 `policy_settings` 체크박스 3개(`prevent_overwrite`,
  `use_llm`, `use_description`, `addon.js:1652-1658`)는 **onChange 핸들러도
  저장 컬럼도 없다.** 순수 장식이다 — 스키마에 대응 컬럼이 없음을 확인했다.
- 처리방침 **§4.2** 는 "OpenAI 위탁은 사용자가 '규칙 기반 분류만 사용' 모드를
  선택함으로써 거부할 수 있다" 고 하는데 **그 모드가 존재하지 않는다.**
- **§1A (3)** 은 "사용자가 사이드바 'AI로 분류' 버튼을 누른 시점에 동의로 간주"
  라는데, `classifierChain.ts:139` 가 **동기화 파이프라인에서 버튼 없이 자동
  호출**한다. 즉 OpenAI(미국) 국외이전이 사용자 조작 없이 상시 발생한다.
- 정책 스스로 LLM 을 "선택 기능 / 거부 가능" 으로 규정했으므로 **3호(계약이행
  필수)로 덮을 수 없다.** A·B 가 "문서가 앞서갔다" 인 반면 C 는 **약속한
  거부권이 실재하지 않는다** — 성격이 다르고 더 무겁다.
- 권고: 설정 토글을 **실제로 구현**(컬럼 + 핸들러 + 체인 분기). 반대로 정책에서
  거부권 주장을 삭제하고 LLM 을 필수로 재규정하는 길은 §4.2·§1A(3)·§2.3 을 모두
  다시 써야 하고 사용자에게 더 나쁘다.

**examples 동의는 그대로 둔다 — 오히려 이번 조사가 설계를 확증했다.** 예시
저장은 계약이행이 아니고(예시 0건이어도 서비스가 완전히 동작) §15①1호 동의가
유일한 근거다. "제품 유일의 동의 표면" 인 것은 결함이 아니라 **정확히 맞는
그림**이었다 — 본 서비스는 동의가 불필요하고 examples 만 필요하기 때문이다.

#### 처리 완료 (2026-07-29) — C7-A/B/C + 과잉 정리 한 묶음

**C7-C 의 권고를 뒤집었다: 토글 구현이 아니라 문구 삭제 + 장식 제거.** 추가
실측 결과 두 가지가 드러났다. (1) `actionClassifyWithLlm` 버튼은 **실재**한다
(`addon.js:653`, rule-miss + `llmAvailable` 조건부) — 위 진단의 "버튼이 없다"
는 부정확했고, 정확히는 **그 버튼이 LLM 진입의 유일한 트리거가 아니다.**
(2) sync 경로의 유일한 게이트는 `classifierChain.ts:84` 의 `env.OPENAI_API_KEY`
이므로 LLM 은 운영자 수준 스위치이지 사용자 수준 선택지가 아니다.

토글을 구현하지 않고 삭제한 이유: 2단계 분류는 ToS §0.2·§1 이 정의한 서비스
기능 그 자체라 §15①4호(계약이행)로 근거를 옮길 수 있고, §5.1 의 Art. 22
미해당 논거는 거부권이 아니라 "색상 표시는 중대한 영향이 아니다" 에 있어
무너지지 않으며, 무엇보다 **"선택·거부 가능"으로 남겨두면 §28의8①3호를 탈 수
없어 OpenAI 이전에 별도 동의가 필요해진다** — 문구를 남기는 쪽이 법적으로 더
무겁다.

**같이 나온 더 무거운 결함 — §6 세션 행이 두 군데 다 거짓.** "발급 후 7일" ↔
실제 `SESSION_ROLLING_TTL_MS` 30일 / `SESSION_ABSOLUTE_TTL_MS` 60일, 파기
트리거로 지목한 `pg_cron session-gc` 는 마이그레이션 주석의 향후 계획으로만
존재하고 만료 행은 삭제되지 않는다. 보유기간은 PIPA §30①3호 필수 기재사항이라
C7-C 보다 노출도가 높다.

**적용 내역**

| 구분 | 파일 | 내용 |
|---|---|---|
| A | privacy §3·§4.1·§4.1.1 | 국외이전 근거 §28의8①1호(동의 간주) → ①3호(계약이행 위탁·처리방침 공개). onboarding 카드 문구 인용 문단 삭제, "포괄 동의" 삭제, 수탁자 정보관리책임자 연락처 표 신설(②3호) |
| B | `gas/addon.js` `buildWelcomeCard`, `config.js`, i18n ×4 | 로그인 버튼 **위에** clickwrap 안내 + 약관/방침 링크 2개. ToS §0.3 에 안내 절차 명문화 → 약관이 발효요건을 충족 |
| C | privacy §0·§1A(3)·§4·§4.1·§4.2·§5.1·§7, `gas/addon.js` `buildSettingsCard`, i18n ×4 | LLM 거부권 문구 전면 삭제 + 근거 §15①4호 전환. 장식 체크박스 3개(`policy_settings`) 및 i18n 4키 ×4 제거 |
| 신규 | privacy §6 | 세션 보유기간·파기 트리거를 코드 실측대로 재기술 |
| 사실 | privacy §1.1, ToS §3 | Add-on 매니페스트 scope 6종 추가(사용자가 보는 것은 합집합) |
| 사실 | `src/routes/home.ts` | N4 — 한국어 "데이터는 캘린더 밖으로 나가지 않습니다" 정정(영문은 기수정) |
| 사실 | `src/routes/account.ts` | cascade 테이블 주석 9 → 10 |
| 과잉 | privacy §10.1–10.3 | EU 대리인·DPO·DPIA 면제 논증 67줄 → 결론 + trigger 만 남기고 `legal-review-opinion.md` Round 3 으로 이관 |
| 과잉 | privacy §12 | 전 변경 30일 → 일반 7일 / 중대 30일. 사실 정정은 지체 없이 게시·즉시 시행 |
| 과잉 | privacy §9.1 | K-12 `2026-10-31` 기한부 구현 약속 삭제(§22의2 는 처리 금지 의무이지 시스템 구축 의무가 아님) |
| 과잉 | privacy §6, §1A(5) | "동의 이력 회원탈퇴 후 3년" 행 + 법령상 의무 이행 목적 행 삭제 → 탈퇴 후 무보관 원칙 |
| 과잉 | ToS §2.2, §11.4 | 재가입 제한(집행 불가) 삭제, 집단소송·중재 부작위 논증 18줄 → 2줄 |
| 통제 | privacy §8.2 | 접속기록 1년 진술을 실행 가능한 절차(요금제 보존기간 미달 시 정기 내려받기)로 구체화 + publish 게이트 승격 |
| 기록 | ADR-0007, `gas/AGENTS.md`, `docs/legal/README.md` | 3년 약속 해소 개정 주석, welcome 카드 clickwrap 의 load-bearing 성격, publish 절차 4·5·6 교체 |

**게이트:** 666 tests green · typecheck · lint · `check-context-paths` 169 refs
OK · `legal:build` 성공. 배포는 하지 않았다.

**사람 결정 2건은 해소됨** — ① K-12 날짜는 커밋 자체를 삭제해 결정 대상이
사라졌다. ② 동의 이력 3년은 삭제로 확정(ADR-0007 에 개정 주석).

**남은 publish 게이트 3건** (전부 사람): §4.1.1 수탁자 연락처 4건 현행성
재확인 / §8.2 접속기록 보관 루틴 가동 / legal publish 와 GAS 새 version 을
같은 창에서 처리(ToS §0.3 이 링크 존재를 발효요건으로 삼음).

#### 검증 패스 (2026-07-29, general-purpose 에이전트) — 6건 발견, 같은 세션에서 해소

개정본을 3축(과잉 / 부족 / 정합성)으로 다시 읽혔다. 판정은 **조건부 publish
가능**, Critical 4건 중 3건이 코드·문서 범위라 즉시 고쳤다.

**내가 틀린 것 1건 — §28의8②5호.** 개정 초안이 "②항 5호(이전 거부 방법·
절차·효과)는 1호(동의) 경로 전용" 이라고 §4.1 주석에 박았는데, ①**3호
가목의 문언이 "제2항 각 호의 사항을 … 처리방침에 공개한 경우"** 다(조문
원문 확인). ②항 각 호에는 5호가 포함되므로 3호 경로도 1~5호 전부를 공개
해야 한다. 실질 내용은 §4.2 에 이미 있었으므로 §4.2 를 "이전을 거부하는
방법·절차 및 거부의 효과" 로 재구성하고 §4.1 에 ②항 각 호 → 절 매핑을
명시해 해소.

**게시본 leak — 이번 정리의 논리를 문서 자신에게는 적용하지 않았던 지점.**
`build-legal.ts` 가 HTML 주석만 제거해서, 도입부 "외부 변호사 검토를 받지
않은 sub-agent self-review 산출물" 고백 · `Cross-references` 의 코드 경로
목록 · `운영자 publish 체크리스트` · 본문의 `src/CLAUDE.md` 인용 12곳이
공개 페이지에 그대로 실려 나가고 있었다(빌드 산출물 grep 으로 실증).
`<!-- BUILD-STRIP-START/END -->` 마커를 도입하고 본문 인용은 평문화 →
게시본 leak 0.

| # | 발견 | 조치 |
|---|---|---|
| 1 | §28의8②5호 배제는 조문에 반함 | §4.2 재구성 + §4.1 에 ②항 매핑 명시 |
| 2 | 게시본에 저장소 내부 스캐폴딩 노출 | `BUILD-STRIP` 마커 + `build-legal.ts` 2단 스트립 + 본문 평문화 |
| 3 | §12 "중대한 변경 시 명시적 재동의" ↔ §4.1 "별도 동의를 받지 아니한다" 모순 | 재동의 대상을 동의 근거 처리(§2.5)로 한정 |
| 4 | §1A(5) 삭제로 동의 상태 컬럼 3종의 처리 근거가 사라짐 | (7) 행 신설 — §15①4호 + GDPR Art. 6(1)(c)·7(1) |
| 5 | §5 "attendees 완전 제거" 부정확(email 서브필드만 제거, displayName 잔존) | "이메일 제거는 1차 방어, 필드 whitelist 가 최종 경계" 로 정정 — 결론(LLM 미도달)은 유효 |
| 6 | §6.2 "30일 이내(§35 30일)" ↔ §7.3 "10일" / ToS §1 "선택적 OpenAI" 잔재 / §6 동의 상태 "cascade" 표현 | 각각 §7.3 참조·삭제·표현 정정 |

**추가 감량** (검증 패스 축 1): §10.1 면제 논증 3 bullet → 결론 1문단(근거는
요청 시 제공) / §11 의 저장소 내부 vendor-URL 정책 해설 삭제 / 말미 개정의
성질 blockquote 자기 유·불리 평가 삭제 / §7.2 "신분증 사본" → "대리 관계
확인 최소 자료 + 목적 달성 즉시 파기" / §10 표 생년월일 삭제 / §7 이동권
"30일" → §7.3 참조 / ToS §5.5.2 유료전환 예고 문단 삭제.

**채택하지 않은 지적 1건** — "§8.2 점검 주기를 월 1회 이상으로" 는
「안전성 확보조치 기준」 **2025-10-31 개정 이전** 기준이다. 개정으로 점검
주기·방법·사후조치는 내부 관리계획으로 자율 결정하게 바뀌었다(보관 1년은
유지). 본문을 그 취지대로 기술.

**남은 Critical 1건 = 배포** — `legal.autocolorcal.app` 이 지금 서비스하는
본문은 **여전히 v1.0** 이고, 이번에 지운 허위 기재가 현재도 공개 중이다.
개정의 가치는 재배포 전까지 0이며, ToS §0.3 이 welcome 카드 링크의 존재를
자기 발효요건으로 삼으므로 **legal publish 와 GAS 새 version 배포는 같은
창에서** 처리해야 한다.

**게이트 재확인:** 666 tests green · typecheck · lint · check-context-paths
170 refs OK · `legal:build` 성공 · 게시본 leak 0.

## Round 4 + 배포 (2026-07-29)

### 검증 패스 2회차 — AC(:120) 종료

Round 3 수정본을 **그대로 다시 읽힌** 패스. Round 3 이 고친 본문-코드 불일치
9건은 전부 재현되지 않았고(통제·권리·보유기간·삭제 동작 주장이 모두 코드에
근거), 새로 8건이 잡혔다. Critical 1건은 **§4.1 의 검토 이력 문단이 여는
`<!--` 없이 작성돼 게시본에 본문으로 렌더**되고 있던 것 — 저장소 경로와
직전 게시본의 허위 기재 자인이 공개 중이었다. 전부 `7825e12` 로 해소, 게시본
leak 0. 상세는 `docs/legal/legal-review-opinion.md` Round 4.

운영자 실측으로 2건 추가 확인:

- **§4.1.1 Supabase 창구 오기재** — `privacy@supabase.io` → 현행
  `privacy@supabase.com`. PIPA §28의8②3호 필수 기재라 오기재는 이전 근거의
  흠결이 된다. 나머지 3건(Cloudflare / OpenAI / Google)은 현행 확인.
  → 종전 "publish 전 사람 확인" 2건 중 1건 해소.
- **§8.2 "감사 로그 1년 이상 보관" 은 이행 불가능한 약속이었다** — Cloudflare
  18개월은 충족하나 Supabase 는 요금제상 7일이고 대시보드 export 경로가 없다
  (Log Drains 는 Pro 애드온, 현재 prod 는 임시 Free). 단정을 걷어내고 보관
  의무는 구현 백로그로 이관. → 나머지 1건도 게시 차단 사유가 아님이 확정.

### §12 30일 통지를 코드로 강제 (`e3c3835`)

처리방침 §12 는 "게시일부터 30일 경과 + 명시적 동의 이후에만 정정 예시 저장을
개시한다" 고 자기구속한다. 그 약속을 지키는 것이 운영자의 기억뿐이면 Worker 를
하루 일찍 배포하는 것만으로 게시된 처리방침이 조용히 거짓이 된다.

`EXAMPLE_STORAGE_OPENS_AT = 2026-08-28` 을 두고 창 이전의 grant 를 409
`storage_not_open_yet` 으로 거절한다. 게이트는 grant 한 곳으로 충분하다 —
살아 있는 동의가 없으면 `consentReceiptFrom` 이 receipt 를 발행하지 않으므로
`POST /api/examples` 도 `addExample` 에 닿지 못한다. GAS 는 같은 날짜를
미러링해 `rememberExample` 체크박스와 설정 카드의 예시 동의 섹션을 창 이전에는
그리지 않는다 — 백엔드가 거절할 컨트롤을 노출하는 것은 방금 제거한
`policy_settings` 체크박스와 같은 결함이기 때문이다.

`promptVersionSendsExamples` 와 같은 계열의 인터록이다: 사람의 기억이 아니라
구조가 약속을 지킨다.

### 배포 시퀀싱

Cloudflare Pages `autocolor-legal` 은 **`main` 브랜치에 git-connected** 라
legal publish = main 머지다(대시보드 작업 없음). Worker 는 CI 에 배포 잡이
없어 머지로 나가지 않는다. 따라서 이번 창의 형태:

1. main 머지 → Pages 재빌드 → 개정 처리방침·약관 게시
2. `clasp push` + 기존 deployment 에 새 version → welcome 카드 clickwrap 라이브
   (ToS §0.3 이 링크의 존재를 자기 발효요건으로 삼으므로 1과 같은 창)
3. Worker 배포·`0020` 마이그레이션은 **하지 않는다** — 예시 저장 UI 가 창
   이전에는 그려지지 않으므로 백엔드 경로가 필요 없고, 미배포 상태가 그 자체로
   fail-closed 다. 2026-08-28 이후 별도 창에서 처리.

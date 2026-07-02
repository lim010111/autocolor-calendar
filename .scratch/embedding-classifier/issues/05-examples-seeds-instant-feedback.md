Status: ready-for-agent
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

- [ ] **`consentExample`→`addExample` 경로로 저장** — example 은 `consentExample()`
      (≡ `redactString` + `ConsentReceipt` 검증)로 민팅되어 `addExample(db,
      ConsentedExample)` 로 저장된다. `addExample` stub 을 실동작으로 채운다:
      임베딩(`embedTexts`, 고정 프리픽스) → `rule_seeds(seed_type='example')` insert.
      `redactEventForLlm` 직접 경로 사용 금지(src/AGENTS.md §5.2).
- [ ] **과도 redaction drop 기준** — `redactString` 후 제목이 (a) 빈 문자열이거나
      (b) 문자의 **≥50% 가 placeholder 토큰**이면 example 로 부적합 → **조용히
      버린다**(저장 0, keyword 추가 경로는 여전히 제공). 임계 로직 단위 테스트.
- [ ] **kNN 풀 자동 합류 (테스트 고정)** — example 씨앗이 seed-type-무관
      `DISTINCT ON (rule_id)` max-코사인 풀에 자동 합류함을 테스트로 고정(read-path
      코드 변경 0 — #02/#03 이 이미 커버, 회귀 방지 목적).

### examples 생애주기 (3 불변항 — 각각 검증)

- [ ] **캡 = Rule 당 example 10개** — 11번째 추가 시 캡 초과분을 정리한다.
- [ ] **FIFO eviction** — 캡 초과 시 `created_at` 기준 가장 오래된 example 행부터
      밀어낸다(씨앗 행 삭제 = 임베딩도 함께 소멸). eviction 순서 단위 테스트.
- [ ] **제목당 단일 Rule (last-write-wins)** — 같은 (redacted) 제목이 다른 Rule 의
      example 로 이미 있으면 그 행을 제거하고 새 Rule 로 이동한다. 제거는 **테넌트
      스코프**(`where user_id=? AND seed_type='example' AND seed_text=?` — RLS 는
      Worker 경로 무효). CONTEXT.md "한 제목은 최대 한 Rule 의 Example".

### 결정 로직 (`T_verified` 활성화)

- [ ] **Verified 경로 활성 + grade-aware 바** — `decideStage1` 은 풀 전체 max-코사인
      **승자 씨앗의 seed_type** 으로 바를 고른다: example→verified→`T_verified`(낮은
      바), name/keyword→declared→`T_declared`. 별도 verified-only 집계 없음.
- [ ] **cold-start nan 비이슈 테스트** — example 0개 Rule 은 verified 씨앗이 승자가
      될 수 없어 `T_verified` 가 발화하지 않는다 → ADR-0005 REPORT §1 의 "verified
      score nan" 은 max-over-pool 설계에서 발생하지 않음을 테스트로 고정.
- [ ] **cross-grade margin 테스트** — best=verified(rule A) · second=declared(rule
      B) 가 `margin` 이내면 여전히 모호 → Stage 2. margin 은 등급 무관 전 풀에 적용.

### 실패 거동

- [ ] **embed-before-mutate + 실패 시 UI 표면화** — example 임베딩을 행 변경 이전에
      수행; 실패 시 정정 미저장 + **Instant Feedback UI 에 소프트 실패 표면화**.
      (직접 사용자 행위 → #02/#03 의 fan-out warn-only-silent 와 **구별**: 정정이
      안 붙었음을 사용자가 알아야 함.)

### LLM 프롬프트

- [ ] **examples 구조화 필드** — LLM user-메시지 카테고리 JSON 에 examples 가 구조화
      필드로 합류(산문 프롬프트 아님) + system 프롬프트에 "examples 필드 사용법"
      1줄 전역 추가. 프롬프트 **버전 범프** + eval-gate 3-gate 통과.

### 동의·법무 (OAuth 게이트 — UI/출시는 검수 후)

- [ ] **동의 모델 = 1회 동의** — 첫 Instant Feedback 정정 시 저장 동의를 1회 수집,
      이후 `ConsentReceipt` 가 모든 example 을 커버(철회 전까지). 철회 시 신규 저장
      중단(기존 행 처리는 개인정보처리방침 결정을 따른다).
- [ ] **사이드바 Instant Feedback UI** — "Event color analysis" 에서 Rule 지목 →
      example 추가가 end-to-end 동작한다. **OAuth 검수 통과 후 표면화**(다크 빌드
      단계에선 백엔드 경로만, 저장 0).
- [ ] **개인정보처리방침/동의 표면 변경분** — "동의 시 정정 제목(redacted)이 durable
      저장됨"을 명시. `legal-reviewer` 게이트 통과. OAuth 검수 통과 후 출시.
- [ ] **동의 모델 결정 기록** — 1회 동의 모델 + durable 저장 disclosure 를
      개인정보처리방침 문서(또는 ADR-0004 amendment)에 기록. **신규 durable-storage
      ADR 은 불필요** — 저장 결정은 ADR-0004 §범위 + src/AGENTS.md §5.2 가 이미 외부화.

### lockstep + 범위 명시

- [ ] **src/AGENTS.md §5.2 lockstep** — `ConsentedExample` 를 "type only" →
      **활성 durable 경로**로 갱신하고, §5-classifier 의 "`T_verified` inert until
      #05" 서술을 갱신한다(이 PR 에서 동시).
- [ ] **exact-match shortcut = 이연 (명시)** — CONTEXT.md/ADR-0004 가 언급하는 제목
      완전일치 shortcut 은 **이 이슈 범위 밖**. #05 는 example 을 임베딩 씨앗으로만
      다룬다 — 완전일치 direct-hit 는 별도 후속 이슈로 남긴다.
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

- #03
- 출시는 OAuth 검수(2026-05-14 재제출분) 통과 후에만 가능 — 외부 게이트

Status: ready-for-agent

## What to build

PII 표면의 type-invisible 문제 해결. `redactEventForLlm(event:
CalendarEvent): CalendarEvent`는 입력과 출력 타입이 같아서 컴파일러가
raw / redacted를 구분할 수 없다 — `src/CLAUDE.md`의 §5.2 redaction 계약은
prose + grep test로만 강제된다 (실제 §5.2라는 heading은 src/CLAUDE.md에
존재하지 않고, `piiRedactor.ts`의 `// §5.2` 주석으로만 anchor 되어
있다 — 본 PR이 정식 heading으로 승격한다).

ADR-0004의 Examples durable 저장이 들어오면 PII 표면은 *두 갈래*가 된다
— (1) LLM 입력 (redaction 필요), (2) `rule_seeds.seed_text` durable
저장 (consent 필요). 같은 패턴으로 한 번에 prep한다.

### 설계 결정

- **Phantom `unique symbol` 브랜드 — 0 런타임 비트.** issue 초안의
  `{ __brand: 'redacted' }` literal property는 **버그**다 — object spread /
  `JSON.stringify`가 `__brand` 키를 prompt body 와 `llm_calls.prompt_summary`
  DB 컬럼까지 흘려보내고, 손으로 쓴 literal이 falsely type-check 한다. 본
  PR은 `declare const x: unique symbol`로 mint 되는 phantom brand 패턴을
  사용한다:
  ```ts
  declare const RedactedBrand: unique symbol;
  export type RedactedEvent =
    CalendarEvent & { readonly [RedactedBrand]: "redacted" };
  ```
  - `declare const`는 코드 emit 0. `{ readonly [B]: 'redacted' }`는 순수
    type-level 추가 — 런타임 객체에 키가 붙지 않는다.
  - mint는 `redactEventForLlm` 안의 `return obj as RedactedEvent` 단일
    cast로만 가능. 다른 어떤 모듈도 unique symbol 키를 명명할 수 없다 →
    구조적 forge 불가능.
- **세 branded type 모두 `src/services/piiRedactor.ts`에 co-locate.**
  brand symbol의 "단일 minter" 불변항이 한 grep target에 모이도록 한다.
  새 `src/types/` 디렉토리는 만들지 않는다.
  - `RedactedEvent` — LLM 입력 전용 brand. minter: `redactEventForLlm`.
  - `ConsentedExample` — `rule_seeds.seed_text` durable 저장 전용 brand.
    minter: `consentExample`. brand는 "consented AND redacted" 결합 불변항
    — `consentExample()` 본체가 `redactString` 호출 + consent receipt
    검증 두 가지를 모두 책임진다 (별도 `RedactedString` brand 도입은
    minter 3개로 늘어나 비용 대비 효용 낮음).
  - `ConsentReceipt` — `consentExample()`의 필수 3번째 인자. 본 PR은
    **type 정의만**, exposed minter 없음. ADR-0004 #05 시점에 consent log
    insert + 영수증 발급 코드가 첫 minter를 도입.
- **유일한 적격 변환자**:
  - `redactEventForLlm(raw: CalendarEvent): RedactedEvent` — 반환 타입만
    좁아짐, body 변경 없음 (마지막 `return redacted as RedactedEvent`).
  - `consentExample(title: string, ruleId: string, consent: ConsentReceipt):
    ConsentedExample` — body는 `redactString(title)` + 결과 객체 brand cast.
    `ConsentReceipt`는 본 PR에서 mint 불가하므로 본 PR에서는 사실상 호출
    site가 없다 (signature만 정착, ADR-0004 #05가 receipt 발급 + 실제 호출
    경로를 깐다).
- **강제 지점 (signature 변경)**:
  - `classifyWithLlm(event: RedactedEvent, ...)` — raw `CalendarEvent`
    호출은 컴파일 reject. **그 결과 `classifyWithLlm` 내부의
    `const redacted = redactEventForLlm(event)` 한 줄을 callsite로 옮긴다**
    — `classifierChain.ts`의 LLM leg가 `redactEventForLlm(event)`를 먼저
    호출하고 그 결과를 `classifyWithLlm`에 넘긴다. redactor는 idempotent
    하므로 prompt 출력 bytes 동일 — "동작 변경 0줄" 유지.
  - `buildPrompt(event: RedactedEvent, ...)` — 위 변경에 맞춰 signature
    동반 좁힘.
  - `ruleService.addExample` signature를 **`addExample(db, example:
    ConsentedExample): Promise<void>`로 좁힘**. 기존 `(_db, _ruleId, _title)`
    stub은 ADR-0004 #05 진입점으로 이미 pin 되어 있어 — 별도
    `insertExampleSeed` helper를 신설하지 않는다 (sink 2개로 갈라지면
    brand bypass surface가 다시 열림). body는 여전히 no-op.
- **runtime guard / wrapper class 없음** — phantom symbol brand 만으로 95%
  효과, 비용 0. wrapper class는 serialization (Hono response, Workers queue
  body)을 복잡하게 만들 뿐 추가 안전성 거의 없음.
- **`src/CLAUDE.md`에 `## PII redaction contract (§5.2)` heading 신설.**
  `## Log redaction contract` 직후, `## Color ownership marker (§5.4)`
  직전에 배치 — §-번호 순서 유지. 한 문단으로 brand 강제 사실을 기록한다
  (regex 내부는 piiRedactor.ts 주석에 두고, §5.2는 type 계약에 집중).
  `piiRedactor.ts`의 `// §5.2` 주석이 이제 실제 heading을 가리킨다.
- **동작 변경 0줄** — signature만 좁아짐, redactor 호출 위치만 chain으로
  올라옴.

### 범위 외

- Instant Feedback 핸들러 본체 — ADR-0004 구현 이슈 #05.
- consent log 테이블 / `ConsentReceipt` minter — ADR-0004 구현 이슈 #05
  (또는 별도 OAuth 검수 통과 후 작업). 본 PR은 receipt **type만** 정의.
- `rule_seeds` 테이블 자체 — ADR-0004 구현 이슈 #02.
- 별도 `RedactedString` brand — 비용 대비 효용 낮아 도입하지 않음.

## Acceptance criteria

- [ ] `RedactedEvent` phantom-symbol branded type을 `src/services/piiRedactor.ts`
      에 정의 (`declare const ... : unique symbol` + `readonly [B]: 'redacted'`)
- [ ] `ConsentedExample` phantom-symbol branded type을 같은 파일에 정의
      (`{ readonly text: string; readonly ruleId: string; readonly [B]:
      'consented-example' }`)
- [ ] `ConsentReceipt` phantom-symbol branded type을 같은 파일에 정의
      (exposed minter **없음** — ADR-0004 #05 가 첫 minter 도입)
- [ ] `redactEventForLlm` 반환 타입을 `RedactedEvent`로 변경 (body 변화는
      마지막 `return ... as RedactedEvent` cast 추가만)
- [ ] `consentExample(title: string, ruleId: string, consent: ConsentReceipt):
      ConsentedExample` 변환자 신설 (body: `redactString(title)` + brand cast)
- [ ] `classifyWithLlm` signature가 `RedactedEvent` 받도록 변경 + 함수 본문
      에서 `const redacted = redactEventForLlm(event)` 한 줄 제거
- [ ] `classifierChain.ts` LLM leg가 `redactEventForLlm(event)`를 먼저
      호출하고 결과를 `classifyWithLlm`에 넘기도록 갱신
- [ ] `buildPrompt` signature도 `RedactedEvent` 받도록 좁힘 (호출자는
      `classifyWithLlm` 단 한 곳이므로 ripple 최소)
- [ ] `ruleService.addExample` signature를 `(db, example: ConsentedExample):
      Promise<void>` 로 좁힘 — body는 여전히 no-op stub, ADR-0004 #05 enable
- [ ] `src/CLAUDE.md`에 `## PII redaction contract (§5.2)` 신설
      (`## Log redaction contract` 직후, `## Color ownership marker (§5.4)`
      직전), branded type 강제 한 문단 작성
- [ ] piiRedactor.ts의 `// §5.2` 헤더 주석 갱신 — 이제 src/CLAUDE.md 의
      실제 heading 을 가리킨다는 사실 명시
- [ ] `pnpm typecheck`가 raw `CalendarEvent`를 `classifyWithLlm`에 넘기는
      가짜 호출을 reject 한다 — `@ts-expect-error` 한 줄로 contract pin
      (기존 test 파일 내에 inline)
- [ ] 동작 변경 0줄 — 기존 단위 test 그대로 통과 (test의 fixture event는
      필요시 `redactEventForLlm`을 거치도록 thread, redactor idempotent
      특성상 prompt bytes 동일)
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

- #02

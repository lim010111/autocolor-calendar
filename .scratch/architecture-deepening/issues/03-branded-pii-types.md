Status: ready-for-agent

## What to build

PII 표면의 type-invisible 문제 해결. `redactEventForLlm(event:
CalendarEvent): CalendarEvent`는 입력과 출력 타입이 같아서 컴파일러가
raw / redacted를 구분할 수 없다 — `src/CLAUDE.md` §5.2 redaction 계약은
prose + grep test로만 강제된다.

ADR-0004의 Examples durable 저장이 들어오면 PII 표면은 *두 갈래*가 된다
— (1) LLM 입력 (redaction 필요), (2) `rule_seeds.seed_text` durable
저장 (consent 필요). 같은 패턴으로 한 번에 prep한다.

### 설계 결정

- **TypeScript branded type 도입** — runtime overhead 0, compile-time만
  강제:
  - `type RedactedEvent = CalendarEvent & { __brand: 'redacted' }`
    — LLM 입력 전용
  - `type ConsentedExample = { text: string; ruleId: string; __brand:
    'consented-example' }` — `rule_seeds.seed_text` durable 저장 전용
    (ADR-0004 examples)
- **유일한 적격 변환자**:
  - `redactEventForLlm(raw: CalendarEvent): RedactedEvent` — 기존 함수의
    반환 타입만 변경. 다른 어떤 코드도 brand를 부여할 수 없다.
  - `consentExample(title: string, ruleId: string, consentToken):
    ConsentedExample` — Instant Feedback 핸들러 한 곳에서만 호출. consent
    log + DB insert를 한 트랜잭션. 핸들러 본체는 ADR-0004 구현 이슈 #05
    시점에 enable, 본 이슈는 타입 + 변환자만 도입.
- **강제 지점 (signature 변경)**:
  - LLM 호출 함수: `classifyWithLlm(event: RedactedEvent, ...)` — raw
    `CalendarEvent` 호출은 컴파일 reject.
  - `rule_seeds` insert (`seed_type='example'`) helper signature:
    `insertExampleSeed(example: ConsentedExample, ...)` — raw title 저장은
    컴파일 reject. 본 PR은 signature만 정착, 실제 insert는 ADR-0004 구현
    이슈 #05 시점.
- **runtime guard / wrapper class 없음** — over-engineered. branded type
  만으로 95% 효과, 비용 0. wrapper class는 serialization (Hono response,
  Workers queue body)을 복잡하게 만들 뿐 추가 안전성 거의 없음.
- **`src/CLAUDE.md` §5.2 갱신**: "redaction is enforced by branded type
  `RedactedEvent` — `classifyWithLlm` signature가 raw `CalendarEvent`
  호출을 컴파일러 단에서 reject한다." 한 문단 추가. prose-only contract
  → type contract 승격.
- **동작 변경 0줄** — signature만 좁아짐.

### 범위 외

- Instant Feedback 핸들러 본체 — ADR-0004 구현 이슈 #05.
- consent log 테이블 / consent token issuance — ADR-0004 구현 이슈 #05
  (또는 별도 OAuth 검수 통과 후 작업).

## Acceptance criteria

- [ ] `RedactedEvent` branded type 정의 (`src/services/piiRedactor.ts` 또는
      `src/types/redacted.ts`)
- [ ] `redactEventForLlm` 반환 타입을 `RedactedEvent`로 변경
- [ ] `classifyWithLlm` signature가 `RedactedEvent` 받도록 변경 — 모든
      호출 site가 redactor 경유 강제
- [ ] `ConsentedExample` branded type 정의 + `consentExample()` 변환자
      (단일 진입점, 본 PR은 stub 가능 — signature만 정착)
- [ ] `rule_seeds` insert (`seed_type='example'`) helper signature가
      `ConsentedExample` require — enforcement 활성은 ADR-0004 #05 시점
- [ ] `src/CLAUDE.md` §5.2에 branded type 강제 한 문단 추가
- [ ] 동작 변경 0줄 — 기존 단위 test 그대로 통과
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

- #02

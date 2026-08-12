Status: ready-for-agent
GitHub: #175

## What to build

ADR-0008 묶음 1: 규칙 description 필드를 **LLM 프롬프트 전용**으로
도입한다 (임베딩 씨앗 반려 — 3b 실측). 측정 근거: 전 후보 utility +0.05,
상승분 전부 미배정→정답, 최대 이득 지점은 키워드 없는 온보딩 상태
(+0.077). 선택 입력 — 미입력 규칙은 기존 자세로 동작(점진 채택).

설계 노트:

- **스키마**: `categories.description` 옵셔널 text 컬럼 (`src/db/schema.ts`
  → `pnpm db:generate`). `rule_seeds` 에는 절대 넣지 않는다(임베딩 씨앗
  금지 — ADR-0008).
- **API/서비스**: `listRules` 가 컬럼을 `Rule.description` 으로 적재,
  categories 라우트 Zod 에 옵셔널 필드. 32KB 캘린더 필드와 달리 사용자
  입력이므로 길이 캡(예: 200자) 권장.
- **프롬프트 게이트 (필수 — merge-gate finding-1 규율)**: 전송은
  `promptVersionSendsRuleDescriptions` 에 **등재된 버전만**. 새 프롬프트
  버전(v9?)에 필드를 문서화하고 §5.3 eval-gate 로 승격 — 문서화 arm vs
  비문서화 arm 재측정 포함(ADR-0008 측정 한계: 측정된 +0.05 는 비문서화
  arm 값). `event.description` 과의 동명 필드 공존 케이스도 eval 픽스처에
  포함할 것(미실행 경로였음).
- **편집기 UI**: ec#04 편집기에 선택 텍스트 입력 1개 — 온보딩 화면에는
  keyword 와 동시 노출하지 않는다(하나만, ADR-0008 Consequences).
  4로케일 라벨.
- **§2.5 고지**: 설명 텍스트가 OpenAI 로 전송됨을 처리방침에 1줄 추가
  (기존 키워드와 동일 채널이라 §12 중대변경 아님 — 확인 필요).

## Acceptance criteria

- [ ] `categories.description` 마이그레이션 + `listRules` 적재 +
      라우트 Zod (길이 캡 포함)
- [ ] 필드를 문서화한 프롬프트 버전 + `promptVersionSendsRuleDescriptions`
      등재가 §5.3 eval-gate(문서화 arm 재측정, event.description 공존
      케이스 포함)와 같은 PR 로 승격
- [ ] 편집기에 description 입력 (온보딩 화면 단일 노출 원칙, 4로케일)
- [ ] §2.5 에 설명 전송 고지 1줄
- [ ] descGate 오라클(`llmClassifier.descGate.test.ts`) green 유지 —
      게이트 우회 경로 재도입 금지

## Blocked by

None — can start immediately. (편집기 AC 는 ec#04 진행과 합류)

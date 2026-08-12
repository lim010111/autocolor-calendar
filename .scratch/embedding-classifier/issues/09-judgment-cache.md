Status: ready-for-agent
GitHub: #176

## What to build

ADR-0008 묶음 4: 판정 캐시 — 같은 분류 입력의 재판정을 캐시로 응답해
반복 sync 의 래칫 열화(§5.4 마커 위 오적용 누적)와 resync 콜 스파이크를
막는다. **배포 순서 1번** — 2표(#11)보다 먼저 들어가야 한다.

설계 노트 (ADR-0008 결정 4 + 3자 리뷰 반영):

- **키 = 분류 입력 전체의 해시** (제목만으로 부족 — prod 프롬프트는
  `summary`+`description`+`location` 3필드 전송): redacted 이벤트 3필드
  × 규칙 입력(이름·키워드·규칙 description·전송 examples) × 프롬프트
  버전 × **판정 정책 버전**(2표 도입 등 정책 변경도 무효화되도록).
  tenant 분리 필수.
- **§12 제약 (open decision 해소 겸)**: 원문 제목을 durable 키/행으로
  저장하지 않는다 — 철회 purge 가 닿지 않는 두 번째 사본 금지
  (`sanitizePromptSummary` 가 막은 구멍의 재발 경로). 해시(HMAC) 키로
  설계하고, 구현 전 §12 검토를 이슈 코멘트로 남길 것.
- **무효화**: 규칙 단위 targeted(변경된 규칙 관련 항목만 — 전면 무효화는
  cold resync 스파이크 유발) + Instant Feedback 정정 시 해당 항목 즉시
  + TTL. description 기능 출시 직후의 편집→무효화 물결을 배포 계획에
  반영.
- **한계 명시**: 캐시는 후속 오답 유입을 막는 동시에 최초 오답의 자동
  교정도 차단한다(래칫 채점은 비관적 상한) — IF 무효화와 TTL 이 교정
  경로.

## Acceptance criteria

- [ ] 캐시 테이블/스토리지 + 해시 키(입력 전체 canonicalize, tenant 분리,
      원문 제목 durable 저장 없음)
- [ ] 판정 정책 버전이 키에 포함 — 정책 변경 시 자연 무효화
- [ ] targeted 무효화(규칙 단위) + Instant Feedback 정정 즉시 무효화 + TTL
- [ ] 분류 경로 통합: 캐시 hit 시 LLM 콜 0 (관측 테이블에 hit 기록)
- [ ] §12 검토 결과(원문 미저장 확인) 코멘트 기록

## Blocked by

None — can start immediately.

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
- redaction — example 은 저장 전 `redactEventForLlm` 과 동일한 redaction 을
  통과한다. redaction 이 제목을 과하게 망가뜨리면 그 정정은 example 로
  부적합 — 조용히 버린다 (키워드 추가 경로는 여전히 가능).
- LLM user-메시지의 카테고리 JSON 에 examples 가 구조화 필드로 합류 (산문
  프롬프트 아님); system 프롬프트엔 "examples 필드 사용법" 1줄만 전역 추가.

출시 게이트: example 저장은 캘린더 제목의 최초 durable 저장이므로 개인정보
처리방침/동의 표면 변경을 동반한다. OAuth 검수(2026-05-14 재제출분) 통과
**전에는 출시 불가** — 통과까지 oauthScopes/consent/redirect/GAS deploy URL
동결.

## Acceptance criteria

- [ ] `seed_type='example'` 씨앗이 임베딩되어 `rule_seeds` 에 기록되고 Stage 1
      kNN 의 max-코사인 풀에 합류한다
- [ ] Stage 1 결정 로직의 Verified 경로(`T_verified`, 낮은 바)가 활성화되고
      테스트로 검증된다
- [ ] 사이드바 "Event color analysis" 에서 Rule 지목 → example 추가가
      end-to-end 동작한다
- [ ] examples 캡 10 + FIFO eviction + 제목당 단일 Rule(last-write-wins)이
      구현·검증된다
- [ ] example 은 `redactEventForLlm` redaction 을 통과해 저장되고, 과도
      redaction 시 조용히 버려진다
- [ ] LLM user-메시지 JSON 에 examples 구조화 필드가 추가되고 system 프롬프트에
      사용법 1줄이 전역 추가된다 (프롬프트 eval-gate 3-gate 통과)
- [ ] 개인정보처리방침/동의 표면 변경분이 준비되고 OAuth 검수 통과 후 출시
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과

## Blocked by

- #03
- 출시는 OAuth 검수(2026-05-14 재제출분) 통과 후에만 가능 — 외부 게이트

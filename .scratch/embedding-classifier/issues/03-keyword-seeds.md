Status: ready-for-agent

## What to build

`keyword` 를 임베딩 씨앗으로 합류시킨다. 이슈 #02 가 `name` 씨앗으로 깐 임베딩
경로를 `seed_type='keyword'` 행까지 확장하는 슬라이스.

end-to-end 범위:

- Rule 생성/수정 시 그 Rule 의 keyword 0~N개 각각을 임베딩해 `rule_seeds` 에
  `seed_type='keyword'` 로 upsert. keyword 추가/삭제가 씨앗 행 추가/삭제와
  동기화된다.
- 기존 사용자 keyword 일괄 backfill 임베딩 (이슈 #02 의 name backfill 잡 재사용
  또는 확장).
- keyword 씨앗은 Declared 등급 — `name` 과 동일하게 `T_declared` 바를 통과해야
  적중. keyword 는 example 이 아직 없는 신규 Rule 의 콜드 스타트 신호다.

ADR-0004: keyword 는 더 이상 문자열 매칭에 쓰이지 않는다 — 씨앗으로 용도
변경되어 존속하며 마이그레이션은 무손실이다.

**OAuth 검수 게이트: 해당 없음.** `keyword` 씨앗은 사용자가 직접 입력한 비-PII
텍스트이며 새 캘린더 내용을 durable 저장하지 않는다 — OAuth 검수 출시 게이트는
examples 씨앗(#05/#06)에만 적용된다. 이 이슈는 검수 통과 전에 빌드·배포
가능하다 (ADR-0004 "범위").

## Acceptance criteria

- [ ] Rule 생성/수정 시 keyword 씨앗이 임베딩되어 `rule_seeds` 에 기록되고,
      keyword 삭제 시 해당 씨앗 행이 제거된다
- [ ] 기존 사용자 keyword backfill 임베딩이 동작·검증된다
- [ ] Stage 1 kNN 이 name + keyword 씨앗을 함께 후보로 본다 (max 코사인 풀에
      keyword 벡터 포함)
- [ ] keyword 씨앗이 Declared 등급(`T_declared`)으로 평가됨이 테스트로 검증된다
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과

## Blocked by

- #02

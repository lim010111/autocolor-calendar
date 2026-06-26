Status: ready-for-agent
GitHub: #114

## What to build

ADR-0004 의 임베딩 kNN 분류기를 가장 얇은 end-to-end 경로로 구현한다 —
`name` 씨앗만 다루는 tracer bullet. 한 Rule 의 이름을 임베딩해 저장하고, sync
시 이벤트 제목을 임베딩해 max 코사인으로 매칭하며, 기존 substring Stage 1 을
완전히 폐기한다.

end-to-end 범위:

- 신규 `rule_seeds` 테이블 — `(id, rule_id FK, user_id, seed_type
  enum('name'|'keyword'|'example'), seed_text, embedding vector(N),
  created_at)`. 씨앗당 1행, HNSW 인덱스, `user_id` 테넌트 스코프. 이 슬라이스는
  `seed_type='name'` 행만 기록한다.
- Workers AI 임베딩 쓰기 경로 — Rule 생성/수정 시 그 Rule 의 name 을 임베딩해
  `rule_seeds` 에 upsert.
- 기존 사용자 name 일괄 backfill 임베딩 1회성 잡.
- Stage 1 읽기 경로 — sync 시 이벤트 제목을 임베딩(sync run 당 배치, 저장
  안 함)하고, 해당 사용자 씨앗 벡터에 대한 max 코사인을 score 로 계산.
- 2등급 결정 로직 — `score(best) < T_low` → Stage 2 LLM fallback,
  `best - second < margin` → 모호 → Stage 2 fallback, 그 외 → best Rule 배정.
  이 슬라이스의 씨앗은 전부 Declared 등급이므로 `T_declared` 만 활성;
  `T_verified` 경로는 examples 슬라이스에서 활성화된다.
- substring 매처 폐기 — Stage 1 이 더 이상 키워드 부분문자열을 보지 않는다.

Stage 2 LLM fallback 은 그대로 존속한다 (ADR-0002 모델 결정 유효). 임베딩
호출은 Cloudflare 플랫폼 내부 호출이라 PII 경계를 넘지 않는다.

**OAuth 검수 게이트: 해당 없음.** 이 슬라이스의 씨앗(`name`)은 사용자가 직접
입력한 비-PII 텍스트이며 새 캘린더 내용을 durable 저장하지 않는다 — OAuth 검수
출시 게이트는 examples 씨앗(#05/#06)에만 적용된다. 이 이슈는 검수 통과 전에
빌드·배포 가능하다 (ADR-0004 "범위").

## Acceptance criteria

- [ ] `rule_seeds` 테이블 + HNSW 인덱스 drizzle 마이그레이션이 생성·적용된다
      (벡터 차원은 이슈 #01 선정값)
- [ ] Rule 생성/수정 시 name 씨앗이 임베딩되어 `rule_seeds` 에 기록된다
- [ ] 기존 사용자 name 을 backfill 임베딩하는 1회성 잡이 동작·검증된다
- [ ] sync 경로의 Stage 1 이 임베딩 max-코사인 kNN 으로 동작하고 substring
      코드 경로가 제거된다
- [ ] 2등급 결정 로직(`T_declared` / `margin` → Stage 2 fallback)이 구현되고
      테스트로 검증된다
- [ ] 모든 `rule_seeds` 쿼리가 `where userId` 테넌트 스코프를 유지한다
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

- #01

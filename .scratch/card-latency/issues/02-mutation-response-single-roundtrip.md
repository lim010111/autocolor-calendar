Status: done
GitHub: #132

## What to build

규칙 **추가·삭제 시 GAS↔백엔드 왕복을 2회에서 1회로** 줄인다. 현재
`actionAddRule`은 `POST /api/categories`(쓰기) 후 카드를 재빌드하면서
`GET /api/categories`(재조회)를 한 번 더 탄다 — 직렬 왕복 2회.
`actionDeleteRule`도 DELETE 후 GET으로 동일.

동작 목표: mutation 라우트(`POST` / `DELETE /api/categories/:id`)가 갱신된
카테고리 목록을 응답 본문에 실어 반환하고, GAS는 후속 GET 없이 그 응답으로
카드를 재빌드한다. #01의 prefactor(카드 빌더가 목록 스냅샷을 인자로 받음) 위에
자연스럽게 얹힌다.

기존 응답 필드는 backward-compatible하게 유지(추가만). name-seed 임베딩
부수효과는 `waitUntil`로 응답을 막지 않는 현재 계약을 그대로 지킨다 — 응답이
임베딩 완료를 기다리게 만들면 안 된다.

## Acceptance criteria

- [x] `POST /api/categories` 응답에 갱신된 카테고리 목록 포함 (기존 필드
      backward-compat, 추가만)
- [x] `DELETE /api/categories/:id` 응답에 갱신된 목록 포함
- [x] `actionAddRule` — POST 응답 목록으로 재빌드, 후속 GET 제거 (add 시 왕복 1회,
      `wrangler tail`로 검증 — 2026-07-14 라이브 실증, 하단 기록)
- [x] `actionDeleteRule` — 동일하게 후속 GET 제거 (delete 시 왕복 1회)
- [x] 라우트 테스트 — POST / DELETE 응답에 목록이 실리는지 assertion
- [x] 에러 경로 동작 보존 — duplicate_name(409) / AUTH_EXPIRED / 저장 실패 시 기존
      토스트·재연결 흐름 그대로
- [x] name-seed 임베딩 부수효과 타이밍 불변 — 응답이 `waitUntil` 임베딩을 기다리지
      않음 (route의 close() 체이닝 계약 유지)
- [x] 기존 deployment "New version"으로 배포 — `/exec` URL·scopes 불변
      (`clasp deploy -i AKfycbxfHV5… -V 55`, deployments 목록으로 @55 확인)
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

None — #01 done (prefactor 머지됨), can start immediately.

## 기록

**2026-07-14 (human+agent) — 라이브 검증 완료, done.**

- PR #134 머지(CI 5/5). Worker `pnpm deploy:prod`(464e2436) → GAS v55 를 설치본
  deployment(AKfycbxfHV5…, /exec URL 불변)에 배포.
- **왕복 1회 실증** (`wrangler tail --env prod`, 18:49~18:52 KST):
  편집기 진입 `GET /api/categories` 1회(09:49:54Z) → 규칙 추가
  `POST /api/categories` 201 1회(09:51:17Z, 후속 GET 없음) → 규칙 삭제
  `DELETE /api/categories/:id` 200 1회(09:51:48Z, 후속 GET 없음). 신 GAS 코드가
  구코드(POST/DELETE 후 GET 재조회)와 달리 mutation 응답 목록으로 재빌드함을
  행동으로 증명 — v55 반영도 이로써 확인.
- **에러 경로 실증**: duplicate name 추가 시도 → `POST /api/categories` 409
  (09:52:31Z), 기존 토스트 흐름 유지.
- 부수 확인: 삭제한 카테고리의 `color_rollback` 큐 잡 정상 완료 — DELETE 204→200
  상태코드 변경이 부수효과 파이프라인에 영향 없음.

> **Resolution:** PR #134 (`src/routes/categories.ts` mutation 응답에 목록 동봉,
> `gas/addon.js` 후속 GET 제거+폴백) + Worker/GAS v55 배포 + tail 실증.

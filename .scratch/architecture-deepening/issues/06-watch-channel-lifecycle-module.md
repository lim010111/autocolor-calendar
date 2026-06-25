Status: done

## What to build

Google Calendar Watch 채널의 (재)등록 경로를 `src/services/watch/` 한
Module 안으로 모으고, bare `registerWatchChannel` / `stopWatchChannel` 를
**Module 외부에서 호출 불가능**하게 만든다.

지금 `src/CLAUDE.md`("Watch self-heal")는 *prose* 로 "진입점은
`/sync/bootstrap` 또는 `maybeSelfHealWatch` 뿐 — `registerWatchChannel` 을
직접 부르지 말라"고 못박는다. 그런데 `src/routes/sync.ts:238-239`(`/heal-
watch`)가 정확히 그 규칙을 어기고 register/stop 을 직접 부른다. **prose
seam 이 이미 production 에서 깨졌다** — 이 이슈는 그 규칙을 구조적
(folder seam + lint)으로 강제한다. 부차적으로, 4개 등록 경로가 각자
복제하던 *공통 코어*(WEBHOOK guard → token → stop→register → error
classify ≈ 15줄)를 `reRegisterWatch` 하나로 모은다.

`/grill-with-docs` (improve-codebase-architecture) 세션으로 설계 확정.
deletion test: `reRegisterWatch` 를 지우면 guard + token + reauth 매핑 +
stop→register + classify 가 4개 호출자(bootstrap/selfHeal/renewal/
reconnect)에 다시 흩어진다 → 복잡도가 *집중*된다(=keep). seam 은 실재
(4 adapter 가 이미 정책별로 분기).

## 설계 결정

- **Module 형태 = core + lint-enforced privacy** (grill fork 1).
  `src/services/watch/` 폴더:
  - `core.ts` — `reRegisterWatch` + **module-private** `registerWatchChannel`
    / `stopWatchChannel` + `classify` / `throwWatchError` / `WATCH_EXPIRATION_MS`.
  - `index.ts` — barrel. **진입점만** re-export (register/stop 비노출).
  - `bootstrap.ts` / `selfHeal.ts` / `renewal.ts` / `reconnect.ts` /
    `teardown.ts` — 진입점 adapter (각자 정책 보유).
  - `receipt.ts` — `lookupChannelOwner` / `verifyChannelToken` (inbound
    webhook 검증, 등록과 무관 → 공개 유지).

- **경계 범위 = full lifecycle** (grill fork 2). `register` + `stop`
  **둘 다** core-private. account 삭제의 stop-only 루프도 bare 호출 금지 →
  `teardownWatchesForUser` 진입점으로 흡수.

- **코어 인터페이스**:
  ```
  reRegisterWatch(db, env, userId, calendarId): Promise<ReRegisterResult>
  type ReRegisterResult =
    | { ok: true; expiration: Date }
    | { skipped: 'webhook_unconfigured' }
    | { failed: 'reauth_required' }
    | { failed: 'api_error'; kind: CalendarApiError['kind'] }
  ```
  코어가 `WEBHOOK_BASE_URL` guard + `getValidAccessToken`(+`ReauthRequiredError`
  → `failed:'reauth_required'` 매핑) + `stop → register` + `classify` 를
  소유한다. `oauth_tokens.needs_reauth` *컬럼* precheck 은 호출자에 남긴다
  (round-trip 절약 최적화이자 호출자별 정책: self-heal 은 조용히 return,
  reconnect 은 503).

- **진입점 7개 (`watch/index.ts` 공개 표면)**:
  | 진입점 | 출처 | 코어 위에 얹는 정책 |
  |--------|------|----------------------|
  | `bootstrapUserSync` | 기존 syncBootstrap | row upsert + `full_resync` enqueue |
  | `maybeSelfHealWatch` | 기존 watchSelfHeal | active/expiring 판정 + 10분 cooldown + `last_self_heal_at` stamp |
  | `renewExpiringWatches` | 기존 watchRenewal | 배치 SELECT + per-row `claimWatchRenewal`/release |
  | `reconnectWatch` | **신설** (`/heal-watch` 본문 추출) | active gate, `{expiration}` 반환 |
  | `teardownWatchesForUser` | **신설** (`account.delete` stop loop 흡수) | active watch row SELECT + stop loop + warn |
  | `lookupChannelOwner` | 기존 receipt | (공개 유지) |
  | `verifyChannelToken` | 기존 receipt | (공개 유지) |

- **enforcement = ESLint `no-restricted-imports`** — `register`/`stop`
  심볼을 `watch/core.ts` 밖에서 import 하면 lint fail. prose 규칙이
  컴파일·lint 강제로 승격. (capability-brand 안은 기각 — grill fork 1:
  과한 추상화.)

- **테스트 = module-mock, DI 없음** (코드베이스 idiom). 어댑터 test 는
  `vi.mock("../services/watch/core")` 로 `reRegisterWatch` 한 개만 모킹
  (현재 register+stop 두 개 모킹보다 단순). 코어 test 가 guard / reauth /
  stop→register / classify 케이스를 **1회** 소유.

- **불변항 보존 (동작 변경 0줄)**:
  - sole-writer 컬럼 그대로: `last_self_heal_at`(selfHeal), `watch_renewal_
    in_progress_at`(renewal claim, ms-precision probe). reconnect 은 여전히
    `last_self_heal_at` 미stamp.
  - "observed, not prevented" race 정책 유지 — claim 컬럼 신설/optimistic
    concurrency 추가 없음.
  - **응답 shape byte 보존** — GAS deploy 동결(OAuth 검수): `/heal-watch`
    `{ok, expiresAt}` + 전 error code(`webhook_unconfigured`/`reauth_required`
    /`not_bootstrapped`/`calendar_inactive`/`forbidden`/`calendar_not_found`
    /`rate_limited`/`upstream_unavailable`), `/bootstrap` `watchRegistered`
    동일.
  - **account 삭제 순서 보존** (§3 row 179): revoke → `teardownWatchesForUser`
    → `DELETE users` → session revoke. teardown 은 step 2 위치 그대로,
    warn 라인 shape 보존. 9-table cascade regex 계약은 무관(컬럼/테이블
    변경 없음).

## 범위 외

- **candidate `CalendarApiErrorFactory`** — `watch/core.ts` 의 `classify`/
  `throwWatchError` 가 `googleCalendar.ts` 와 중복(별도 deepening 후보).
  이 PR 은 코드를 *옮기되* dedup 하지 않는다 (surgical scope).
- **candidate `mapCalendarErrorToHttp`** — `/heal-watch` 라우트의
  `kind → HTTP` switch 는 별도 후보. 본 PR 에서 `reconnectWatch` result →
  HTTP 매핑은 라우트에 thin 하게 유지; 매퍼 추출은 별도 PR.
- **ADR-0004 embedding** — 무관, 미접촉.

## Acceptance criteria

- [x] `src/services/watch/` 신설 — `core.ts`(`reRegisterWatch` +
      module-private `register`/`stop` + `classify`/`throwWatchError` +
      `WATCH_EXPIRATION_MS`) + `index.ts` barrel(진입점만 노출)
- [x] `ReRegisterResult` union 구현 — guard + token(+reauth 매핑) +
      stop→register + classify 를 코어가 흡수
- [x] 4개 등록 진입점(`bootstrapUserSync`/`maybeSelfHealWatch`/
      `renewExpiringWatches`/`reconnectWatch`)이 `reRegisterWatch` 사용,
      각자 정책(enqueue / cooldown stamp / claim / active gate) 유지
- [x] `reconnectWatch` 신설 — `/heal-watch` 본문 추출, 라우트는
      result→HTTP thin adapter (응답 shape byte 보존)
- [x] `teardownWatchesForUser` 신설 — `account.delete` stop loop 흡수,
      삭제 순서 + warn shape 보존
- [x] `lookupChannelOwner`/`verifyChannelToken` receipt 공개 유지
      (`webhooks` 라우트 동작 불변)
- [x] ESLint `no-restricted-imports` — `watch/core` 밖에서 `register`/
      `stop` 직접 import 시 lint fail
- [x] 어댑터 test 를 `reRegisterWatch` module-mock 으로 전환; 코어 test 가
      guard/reauth/stop→register/classify 케이스 1회 소유
- [x] `src/CLAUDE.md` "Watch self-heal" / "Watch renewal concurrency"
      prose → 구조적 강제 + 진입점 목록으로 lockstep 갱신
- [x] 동작 변경 0줄 — 응답 shape 및 기존 test 그대로 통과
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] `python3 scripts/check-context-paths.py` 통과

## Blocked by

None — can start immediately.

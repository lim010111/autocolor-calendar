Status: done
GitHub: #157

## What to build

Google Calendar API 에러 파싱·분류 3종 세트(`GoogleErrorBody` 타입 +
`classify()` + throw 헬퍼)가 `src/services/googleCalendar.ts`
(`throwApiError`, 6개 op)와 `src/services/watch/core.ts`
(`throwWatchError`, 2개 op)에 중복돼 있다 — #06 이 코드를 *옮기며* 명시적
범위 외로 남긴 후보(#06 "범위 외" 첫 항목). 하나의 공유 factory 로
dedup 한다.

**중복은 이미 부식했다** (grill 실측, 2026-07-18):

- watch 쪽 `classify` 엔 `410 || reason === "fullSyncRequired"` →
  `full_sync_required` 분기가 없다 (410 은 `unknown` 으로 떨어짐).
- watch 쪽 `throwWatchError` 는 `retry-after` 헤더를 파싱하지 않는다
  (`retryAfterSec` 항상 undefined).

deletion test: factory 를 지우면 parse+classify+throw 가 두 모듈로 다시
흩어지고, 위 드리프트가 재발한다 → 복잡도가 집중된다(=keep). seam 은
실재 — 8개 op 콜사이트가 두 모듈에 걸쳐 있다.

## 설계 결정

- **위치 = `googleCalendar.ts` 내 export** (신규 파일 없음).
  `CalendarApiError` / `CalendarErrorKind` 가 이미 이 파일의 공개 표면이고
  (8+ 파일이 import), `watch/core.ts` 는 이미 `CalendarApiError` 를 여기서
  import 한다. leaf 모듈이라 순환 없음. 별도 `lib/` 모듈 신설은 기각 —
  에러 어휘와 분류는 Calendar API 클라이언트 도메인의 vocabulary 이므로
  클래스 옆이 맞다.

- **시그니처**: `throwCalendarApiError(res: Response, op: string):
  Promise<never>` — 기존 private `throwApiError` 를 rename-export.
  body 안전 파싱(`parseError`) + `retry-after` 헤더 + `classify` + throw 를
  한 몸으로 유지. `classify` / `parseError` 는 private 유지 (분류 규칙의
  단일 enforcement point — 콜러가 status/reason 을 직접 만질 수 없다).

- **`watch/core.ts` 는 로컬 3종 세트 삭제** — `GoogleErrorBody` /
  `classify` / `throwWatchError` (~40줄) 제거, 2개 콜사이트
  (`channels.watch` / `channels.stop`)를 `throwCalendarApiError` 로 전환.

- **수용된 delta 1건 (관측 가능, 의도적)**: watch op 의 410 /
  `fullSyncRequired` 가 `unknown` → `full_sync_required` 로 분류된다.
  - 유일한 HTTP 소비자인 `routes/sync.ts` reconnect switch 는 두 kind 를
    **같은 case 팔**(502 `upstream_unavailable`)로 처리 — HTTP 불변.
  - renewal / selfHeal / bootstrap 은 kind 를 warn 로그 `code` 문자열로만
    소비 — 로그 문자열만 변화, 그것도 Google 이 watch op 에 410 을 주는
    실질적 dead branch 에서만.
  - 기존 테스트 핀 없음 (watchCore 는 401/403/500 만 핀).
  - 새 테스트로 이 delta 를 **명시적으로 핀**해 의도를 기록한다.

- **불가시 delta**: watch 에러가 `retryAfterSec` 을 갖게 되지만
  `ReRegisterResult` 가 kind 만 운반하고 teardown 은 err 를 warn-only
  swallow — 어떤 소비자에게도 도달하지 않는다.

- **4대 매핑 의미 보존 (동작 불변의 핵심)**: auth(401) / forbidden(403) /
  not_found(404) / rate_limited(403 reason·429) / server(5xx) 분기는 두
  classify 가 자구 동일 — 통합으로 변화 0. 기존
  `googleCalendar.test.ts` + `watchCore.test.ts` 분류 핀이 무수정 green
  이어야 한다.

- **주석 lockstep**: `routes/sync.ts` 의 "Watch's throwWatchError never
  sets Retry-After" 주석은 stale 해짐 → "ReRegisterResult 가 kind 만
  운반" 근거로 갱신. `watch/core.ts` 헤더의 "the CalendarApiError
  classify" 서술도 factory 위임으로 손질.

## 범위 외

- **OAuth token endpoint 에러** (`tokenRefresh.ts` / `googleOAuth.ts`) —
  `oauth2.googleapis.com` 은 RFC 6749 에러 shape(`{error:
  "invalid_grant"}`)로 도메인이 다르다. 이 factory 의 대상이 아님.
- **`kind → HTTP` 매퍼 추출** (`routes/sync.ts` switch) — #06 이 남긴
  별도 후보(`mapCalendarErrorToHttp`). 미접촉.
- **`retryAfterSec` 를 `ReRegisterResult` 로 전파** — 동작 변경이므로
  범위 외. 현행 fixed 1s 유지.
- **분류기 계열 파일** (`ruleService` / `llmClassifier` / `stage1` /
  `classifierChain` 등) — #05 다크 빌드 병행 중, 미접촉.

## Acceptance criteria

- [x] `googleCalendar.ts` 가 `throwCalendarApiError(res, op)` 를 export —
      기존 `throwApiError` rename, `classify`/`parseError` 는 private 유지
- [x] `watch/core.ts` 로컬 `GoogleErrorBody`/`classify`/`throwWatchError`
      삭제, 2개 콜사이트가 공유 factory 사용
- [x] 4대 매핑(auth/forbidden/not_found/rate_limited/server) 의미 보존 —
      기존 `googleCalendar.test.ts`·`watchCore.test.ts` 분류 핀 무수정 green
- [x] 수용된 delta 를 새 테스트로 핀 — watch leg 410 →
      `full_sync_required` (구 `unknown`), `watchCore.test.ts` 에 1건
- [x] stale 주석 갱신 — `routes/sync.ts` Retry-After 근거,
      `watch/core.ts` 헤더
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] 분류기 계열 파일 무접촉 (#05 다크 빌드 병행 안전)

## Blocked by

None — 순수 내부 리팩터, pre-OAuth 머지 가능.

Status: ready-for-human
GitHub: #149

## What to build

기존 자산을 라벨 세계로 1회 이행하고 colorId 레거시를 제거한다 —
ADR-0006 Decision 4 (깨끗한 컷오버, 이중 모드 없음).

설계 노트 (구현 세션 재량):

- **카테고리 → 라벨 생성**: 사용자×캘린더별로 기존 카테고리마다 named
  라벨 append (`{name: category.name, backgroundColor: colorId 의 클래식
  hex}`) → `categories.labelId` 채움. **unnamed 시스템 슬롯을 개명하지
  않는다** — 그 슬롯은 사용자의 수동 팔레트 공유 자산이므로 append 가
  안전. 클래식 11색 hex 표는 colors.get 실값으로 고정.
- **이벤트 재각인**: 이행 후 full resync 가 마커 v1 이벤트를 v2 라벨로
  재적용 (v1 판정 하위호환은 #02 가 이미 보장 — 브리지 덕에 colorId
  동등성이 유지되므로 소유권 오판 없음).
- **레거시 제거**: `categories` colorId CHECK(`'1'..'11'`) drop
  마이그레이션, `routes/categories.ts` ColorIdSchema → hex/labelId 계약,
  `routes/events.ts` regex 제거, 마커 v1 판정 경로 제거(재각인 완료
  후), `src/AGENTS.md` §5.4 를 v2 정본으로 개정.
- **게이트**: full resync fan-out 은 Workers Free 50-fetch 캡을 정면으로
  밟는다 — **sync-reliability #01(플랜 결정) 또는 #02(예산 가드) 선행
  필수**. 실사용자 유입 전(OAuth 검수 통과 직후 창)이 컷오버 최적기.
- 운영 절차: 이행 스크립트는 운영자 워크스테이션 실행(backfill-seeds
  전례), 실행 전 카테고리 수 × 캘린더 200 캡 사전 검사, dry-run 모드.

## Acceptance criteria

- [x] 이행 스크립트: dry-run + 실행, append-only·200 캡 검사, 재실행
      멱등 *(scripts/cutover-labels{,-core}.ts + 테스트 15개 — pre-OAuth
      선작업 완료, 2026-07-18)*
- [ ] 기존 카테고리 전부 `labelId` 보유 + Google 색 창에 칩 노출 (육안)
      *(컷오버 창 — 사람)*
- [ ] full resync 후 표본 이벤트의 마커 v2 재각인 확인 *(컷오버 창)*
- [ ] colorId 레거시(CHECK·Zod·regex·v1 판정) 제거, `pnpm test`/`typecheck`
      통과 *(컷오버 창 — PR-B)*
- [ ] §5.4 문서 v2 개정 + `python3 scripts/check-context-paths.py` 통과
      *(컷오버 창 — PR-B)*

> **Resolution (부분 — AC 1):** feat/native-labels-04-cutover-migration.
> 이행 스크립트 + 코어 분리 + 테스트 15개. 실행 게이트 = OAuth 통과 →
> Workers Paid 전환 → Worker/GAS co-deploy 직후 창에서
> `pnpm tsx scripts/cutover-labels.ts --env .prod.vars` (dry-run 확인 후
> `--execute`) → full resync → AC 2·3 육안 → PR-B(레거시 제거). dev
> dry-run 스모크 통과(pending 0건, 읽기 전용). 상세 설계 결론은 아래
> Comments.

## Blocked by

- #02 (마커 v2 + 라벨 쓰기) — 해소 (머지됨)
- #03 (편집기 A2 재배선) — 해소 (머지됨)
- sync-reliability #01 또는 #02 — 해소 (#02 예산 가드 머지, 트랙 24/24)

## Comments

### 2026-07-18 grill 결론 (pre-OAuth 선작업 세션, 코드베이스 실측 기반)

**세션 범위 = AC 1(이행 스크립트 + 테스트)만.** AC 2·3(실행·육안)과
AC 4·5(colorId 레거시 제거·§5.4 개정)는 컷오버 창(OAuth 통과 → Paid 전환
직후)의 몫. 설계 후보별 결론:

1. **스크립트 구조** — `scripts/cutover-labels.ts`(CLI, I/O) +
   `scripts/cutover-labels-core.ts`(순수 planner/apply, vitest 대상) 2파일.
   src 재사용(임포트만, src 수정 0): `appendEventLabel`/`EventLabelCapError`
   (eventLabels.ts — labelProperties 의 유일 공인 writer 계약 유지),
   `getCalendarLabelProperties`(googleCalendar.ts — 임포트 0개의 순수 fetch
   모듈이라 tsx 안전), `CLASSIC_EVENT_COLOR_HEX`(labelReconcile.ts),
   `getGoogleRefreshToken`(oauthTokenService.ts — 키 로테이션 폴백 +
   needsReauth 포함 정본 복호화). access token 교환은 label-probe.ts 전례의
   직접 fetch(`getValidAccessToken` 은 Bindings 결합이라 부적합). env 는
   probe 전례의 `--env .dev.vars|.prod.vars` 플래그(컷오버 대상은 prod).
2. **대상 선정** — 사용자 × primary 캘린더 고정(sync 파이프라인이
   primary-단일, routes/categories.ts `LABEL_CALENDAR_ID` 전례). 대상
   카테고리 = `label_id IS NULL AND label_deleted_at IS NULL`(삭제 룰 부활
   금지 — Decision 4). 토큰 없음/needsReauth/refresh 실패 사용자는 skip +
   리포트.
3. **dry-run 범위** — 기본 모드 = dry-run(안전 기본값), `--execute` 로 실행.
   dry-run 도 DB SELECT + 사용자별 labelProperties GET 1회는 수행(읽기
   전용) — plan(link/append/skip/cap)을 실값으로 출력하고 토큰 건강도
   사전 점검을 겸한다. Google 쓰기·DB 쓰기 0.
4. **멱등성 전략** — 2단: (a) `labelId` 있는 카테고리는 대상에서 제외,
   (b) append 전 fresh labelProperties 에서 동명(trim) named 라벨 발견 시
   append 대신 **link** — 절반 실패(라벨 생성 후 DB 갱신 전 크래시) 재실행이
   중복 append 없이 수렴. labelReconcile 의 same-name pairing 과 동일
   규칙이라 sync reconcile 과 경합해도 동일 상태로 수렴(우리가 append 한
   라벨을 reconcile 이 동명 룰에 link = 우리가 하려던 일). DB 갱신은
   `WHERE label_id IS NULL` 가드. backfill-seeds 급 quiesce 는 불요(경합이
   수렴적)이나 컷오버 창 실행이 전제.
5. **클래식 11색 hex 고정** — labelReconcile.ts 의 `CLASSIC_EVENT_COLOR_HEX`
   임포트(단일 정본, colors.get 실값 고정은 #02 에서 완료). 라이브
   colors.get 재검증 불요. AC 4 레거시 제거 시 이 표가 src 에서 빠지면
   표를 스크립트로 이관(컷오버 PR 의 일).
6. **200 캡 사전 검사** — plan 단계에서 `existing + appends > 200` 이면
   해당 사용자의 append 전체 보류(capExceeded — link 는 라벨 수 불변이라
   진행). `appendEventLabel` 자체 캡 체크는 백스톱.
7. **엣지** — category name Zod max(100) > 라벨 name 캡 50(API 문서):
   `name_too_long` skip 으로 표면화, 자동 truncate 안 함(이름 정본은
   Google, 운영자가 수동 해결). 동명 라벨이 이미 다른 룰에 link 된 경우
   `label_claimed` skip(모호 — 운영자 판단). 실패는 사용자/항목 단위
   격리, 요주의 사항 있으면 exit 1.
8. **PR 분할** — PR-A(이번) = scripts 2파일 + 테스트, src 무변경이라
   pre-OAuth 머지 가능. PR-B(컷오버 창) = 스크립트 실행·육안(AC 2·3) 후
   colorId 레거시 제거 + §5.4 v2 개정(AC 4·5) — CHECK drop 마이그레이션,
   Zod/regex/v1 판정 제거, CLASSIC_EVENT_COLOR_HEX 이관 포함.
9. **테스트 배치** — vitest include 가 `src/**` 한정이므로 테스트는
   `src/__tests__/cutoverLabels.test.ts` 에 두고 `../../scripts/` 임포트
   (tsconfig rootDir 제약 없음 실측). vitest.config 무변경.

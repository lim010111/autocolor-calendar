Status: ready-for-human

## What to build

애드온이 민팅한 Google 라벨을 규칙 삭제와 함께 지울 수 있게 한다
([ADR-0008](../../../docs/adr/0008-addon-owned-label-deletion.md)).
ADR-0006 Decision 3 의 삭제 비대칭을 **좁히는** 변경 — 뒤집는 게 아니다.

배경: 생성은 쌍방향(라벨 + 규칙)인데 삭제는 단방향이라, 규칙을 지우면 죽은
색상 라벨이 Google 색 선택기에 영구히 남았다. 지우지 않은 진짜 이유는
"구분 불가"가 아니라 **blast radius** — 사용자가 Google 에서 만든 라벨은
우리가 한 번도 건드리지 않은 일정 수백 개에 붙어 있을 수 있고,
`color_rollback` 은 마커 있는 일정만 방문하므로 그것들은 롤백도 경고도 없이
색을 잃는다.

구현 요지:

- `categories.label_origin` (`'addon'|'discovered'|'unknown'`, 기본
  `'unknown'`). 3값인 이유는 기존 행을 진짜 모르기 때문 — 컷오버 CLI 가
  민팅·발견을 모두 생산했고 사후 구분 불가.
- `DELETE /api/categories/:id?deleteLabel=1` — 서버가 게이트를 재검증하고,
  툼스톤 후 best-effort 로 `removeEventLabel`. 항상 200 +
  `labelDeleted`/`labelDeleteError`.
- `colorRollback` 순서 독립 절 — 마커는 있는데 색이 없는 일정은 clear.
  라벨 삭제와 큐 롤백의 순서를 무관하게 만든다(이 기능의 안전 전제).
- GAS: 규칙 행의 삭제 버튼 → 확인 카드(모든 삭제에). 라벨 삭제는 카드 안
  체크박스, `labelDeletable` 일 때만 노출, 기본 체크.

## Acceptance criteria

- [x] `label_origin` 컬럼 + CHECK, 마이그레이션 `drizzle/0023_mushy_electro.sql`
- [x] `'addon'` 은 POST 민팅 경로만, reconcile create/link 는 `'discovered'`
      명시, 컷오버 CLI 는 `origin` 인자로 두 분기 분리
- [x] DELETE 게이트 4가지 동작 (addon 삭제 / discovered·unknown 무시 /
      플래그 없음 무시 / Google 실패 시에도 200 + 툼스톤 유지)
- [x] `colorRollback` 순서 독립 절 + `cleared_orphan_marker` 카운터,
      회귀 테스트가 변경 전에는 실패함을 확인
- [x] GAS 확인 카드 + 4로케일 i18n + `rules.manageInGoogle` 재작성
- [x] i18n 4번들 키 파리티 테스트 (`src/__tests__/gasI18nParity.test.ts`) —
      기존에 강제 장치가 없었다
- [x] `pnpm test` / `typecheck` / `lint` / `check-context-paths.py` 통과
- [x] **P1/P2 실측** *(2026-07-31, `spike/dangling-label-probe.ts`)*: 사용 중인
      라벨도 `calendars.patch` 로 제거된다(200). 이벤트는 dangling
      `eventLabelId` 를 유지하고 마커도 온전해 `appOwned` 가 참으로 남으므로
      롤백이 평소대로 동작한다. dangling 위의 `clearEventLabel` 도 200
- [ ] dev 마이그레이션 + 배포 후 E2E: 규칙 생성 → `label_origin='addon'` →
      "라벨도 삭제" 체크 후 삭제 → `calendars.get` 에서 라벨 소멸 확인
- [ ] prod 마이그레이션 + Worker 배포 + GAS **기존 배포 편집 → 새 버전**
      (URL 동결)
- [ ] **육안 (사람)**: Google 캘린더 색 선택기에서 라벨이 실제로 사라지는지

## Blocked by

- 없음. #04 컷오버와 독립 — 컷오버 CLI 는 `origin` 인자만 받도록 바뀌었고
  실행 게이트는 그대로다.

## Comments

### 2026-07-31 — 기존 규칙은 영구히 삭제 대상이 아님

운영자 본인 계정의 규칙 6개 포함 모든 pre-ADR-0008 행이 `'unknown'` 으로
찍힌다. 그 라벨들이 원래 애드온 민팅이었다 해도 DB 에 기록이 없으므로
추측 백필은 하지 않기로 했다(사용자 확인 2026-07-30). 회복 경로는
"규칙을 지우고 새로 만든다" — 새 규칙부터 provenance 가 정확하다.

### 2026-07-31 — 머지게이트 findings 패스 1: blocking 2건 모두 진짜였다

둘 다 **마커를 커밋한 뒤 정리가 따라오는 비원자적 순서**였고, 둘 다 직전
세션의 툼스톤 수정이 들여온 것이다. 각각 HEAD 에서 실패하는 오라클로 증명한
뒤 고쳤다.

- **finding-0 `deleteRule`** — 툼스톤 UPDATE 가 autocommit 된 뒤 `rule_seeds`
  purge 가 별개 문장으로 돈다. purge 가 실패하면 규칙은 사용자에게 숨겨진 채
  씨앗이 `knnByUser` 에서 계속 점수를 내고("사용자에겐 삭제, 분류기에겐 생존"),
  재시도는 `isNull(rule_deleted_at)` 가드에 걸려 404 라 복구 경로가 없다.
  → 툼스톤·purge·캘린더 조회를 **하나의 `db.transaction`** 으로 묶었다
  (`src/` 최초의 트랜잭션). 큐 fan-out 만 밖에 남는다 — Postgres 가 되돌릴 수
  없는 네트워크 쓰기라서. 동시 삭제 가드는 그대로: 여전히 같은 단일 guarded
  UPDATE 이고, 경쟁에서 진 쪽은 행 잠금 뒤 술어를 재평가해 0행을 받는다.
- **finding-1 `labelReconcile`** — `label_deleted_at` 스탬프 후 purge. purge 가
  던지면 warn-only 핸들러가 삼키고, 이후 모든 런은 `labelDeletedAt` 가드에서
  purge 전에 skip 한다. → **purge 를 스탬프보다 먼저** 로 순서를 바꿨다.
  `revokeExampleConsent` 가 이미 쓰는 규율과 동일(실측 확인).

오라클 2개는 회귀 테스트로 함께 커밋했다. fakeDb 는 `failSeedDeleteWith`
훅과 `transaction` arm 을 얻었고, 후자는 **비원자적 수정을 통과시키지 못한다**
— purge 를 트랜잭션 밖으로 빼는 변이를 넣으면 오라클이 다시 빨개진다(확인).
드리즐 트랜잭션 자체도 `getDb` 와 동일한 드라이버 옵션으로 실제 Postgres 에
대해 rollback/commit 을 실측했다.

### 2026-07-31 — 라벨까지 지운 뒤 Google 에서 동명 라벨을 새로 만들면

`deletedRuleNames` 블랙리스트가 영원히 무시한다(부활 금지 장치). 회복은
애드온에서 규칙을 새로 만드는 것. 블랙리스트를 손대면 부활 버그가 되살아나므로
코드가 아니라 문구로 해결한다 — ADR-0008 Consequences 참조.

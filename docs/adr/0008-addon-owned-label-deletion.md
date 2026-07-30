# ADR-0008: 애드온이 민팅한 Google 라벨은 애드온이 삭제한다 — `categories.label_origin`

- Status: Accepted (2026-07-31)
- Context: [ADR-0006](0006-native-labels-adoption.md) Decision 3 은 "생성은
  쌍방향, 권한은 비대칭 — 개명·색 변경·**삭제**는 Google UI 로 안내한다"로
  정했다. 그 결과 규칙 생성은 두 개(Google 라벨 + `categories` 행)를 만드는데
  삭제는 하나만 지운다. 사용자가 애드온에서 규칙을 지우면 **죽은 색상 라벨이
  Google 캘린더 색 선택기에 영구히 남고**, 애드온에는 그것을 없앨 경로가 없다.
  캘린더당 200 라벨 캡도 계속 잠식된다.

  당시 근거는 "우리가 만든 라벨과 사용자가 Google 에서 만든 라벨을 구분할 수
  없다"였다. 이는 **스키마의 상태였을 뿐 원리적 한계가 아니다** —
  `categories.label_id` 가 채워지는 경로는 코드상 완전히 분리돼 있다:
  민팅은 `src/routes/categories.ts` 의 `createLabelForRule` →
  `appendEventLabel`, 발견은 `src/services/labelReconcile.ts` 의 create/link
  분기, 그리고 `scripts/cutover-labels-core.ts` 는 **양쪽을 다** 만든다
  (append 후 링크 = 우리 것, 이름 매칭 링크 = 사용자 것).

  **그러나 구분 가능성은 이 결정의 근거가 아니다.** 사용자가 삭제 카드에서
  명시적으로 확인하는 순간, 권한 문제는 이미 해소된다. 진짜 근거는
  **blast radius** 다:

  - 애드온이 민팅한 라벨은 (거의) 우리가 칠한 일정에만 붙어 있다.
  - 사용자가 Google 에서 만든 라벨은 우리가 한 번도 건드린 적 없는 수백 개
    일정에 붙어 있을 수 있다. `color_rollback` 은 `autocolor_category` 마커가
    있는 일정만 방문하므로, 그 일정들은 **롤백도 경고도 없이** 색을 잃는다.
    `patchEventLabelManual`(사이드바 수동 지정)이 마커를 일부러 지운 일정,
    즉 우리가 "건드리지 않겠다"고 약속한 집합도 여기 포함된다.

- Decision:
  1. **`categories.label_origin` 신설** — `text NOT NULL DEFAULT 'unknown'`,
     `CHECK IN ('addon','discovered','unknown')`
     (`drizzle/0023_mushy_electro.sql`). 값이 **3개**인 이유: 기존 행은 진짜로
     모른다. 컷오버 CLI 가 민팅·발견을 모두 생산했고 사후 구분이 불가능하므로,
     기존 행을 `'discovered'` 로 찍는 것은 **갖고 있지 않은 사실의 단정**이다.
     `'unknown'` 은 게이트에서 `'discovered'` 와 동일하게 동작하되, 훗날
     승격 패스가 "기록한 적 없음"과 "확인했고 사용자 것"을 구분할 수 있게
     남겨둔다.
  2. **기록은 아는 경로가 명시적으로 한다.** `createRule` 은 `labelId` 가
     넘어온 경우에만 `'addon'`(그 값은 POST 라우트의 민팅에서만 온다).
     `labelReconcile` 의 create/link 분기는 `'discovered'` 를 **직접 쓴다** —
     기본값에 위임하지 않는다. 컷오버 CLI 의 `linkCategory` 는 `origin`
     인자를 받아 두 분기를 갈라 쓴다.
  3. **삭제는 `?deleteLabel=1` + 서버 재검증.** 게이트는
     `label_origin === 'addon' && label_id !== null && label_deleted_at IS NULL`.
     쿼리 플래그는 **요청이지 권한이 아니다** — 서버가 방금 툼스톤한 행을 상대로
     `toWire.labelDeletable` 이 공표한 것과 같은 술어를 다시 계산한다.
  4. **순서: 툼스톤 → 목록 → 라벨 제거(best-effort) → 200.** Google 실패는
     HTTP 상태를 바꾸지 않는다(항상 200 + `labelDeleted:false` + 사유).
     사용자의 1차 의도(규칙 삭제)는 Google 이 죽어도 관철된다.
  5. **await, `waitUntil` 아님.** 툼스톤 후 rule id 는 모든 목록에서 사라지므로
     **이 라벨을 다시 찾아올 코드 경로가 시스템에 없다.** 조용히 실패하는
     `waitUntil` 은 이 기능이 없애려던 고아 라벨을, 이번엔 보이지도 않게
     만든다. 대가는 옵트인 분기에서만 발생하는 Google fetch 3회
     (토큰 갱신 + `calendars.get` + `calendars.patch`).
  6. **확인 카드는 모든 삭제에.** 라벨 삭제 선택지가 없을 때도 띄운다 —
     삭제는 되돌릴 수 없고(툼스톤 절대 미해제) 규칙의 `rule_seeds`, 즉
     ADR-0007 정정 예시까지 가져가는데 그때까지 확인 절차가 **없었다**.
     라벨 삭제는 카드 안 체크박스(기본 체크)이며, `labelDeletable` 이 거짓이면
     대신 "Google 캘린더에서 지우세요" 안내가 그 자리에 온다.

- Alternatives considered:
  - **boolean `label_minted_by_addon`**: 상태가 2개라면 맞다. 실제로는 3개이고,
    기존 행을 `false` 로 몰면 안전한 *동작*을 얻는 대신 거짓 *사실*을 남기며
    승격 패스의 근거를 영구히 파괴한다. 기각.
  - **컬럼 이름을 `label_deletable_by_addon` 로**: 용도는 정직해지지만 오늘의
    정책을 컬럼 이름에 박제한다 — 아래 Option B 가 리네임 마이그레이션을
    요구하게 된다. 출처는 안정적 사실, 삭제 가능성은 파생 정책. 분리 유지.
  - **enum 을 wire 에 노출**: GAS 투영 지점이 2곳(`mapWireCategoriesToRules`,
    `serializeCategoriesSnapshot`)이라 계약이 두 곳으로 샌다. 파생 boolean
    `labelDeletable` 만 실어 정책을 서버가 소유한다.
  - **`color_rollback` 완료 후에 라벨 삭제(순서 맞추기)**: 큐 지연이 무제한이고
    캘린더별 fan-out 에 join barrier 가 없다. 순서 독립(아래)으로 대체.
  - **현상 유지 + 문구 개선만**: 사용자가 라벨을 지우려면 Google 캘린더로
    가야 한다는 사실은 정확히 전달되지만, 애드온이 만든 쓰레기를 사용자가
    치우는 구조는 그대로다. 기각.

- Consequences:
  - **`color_rollback` 순서 독립 불변식 (필수 동반 변경).** 소유권 게이트는
    `appOwned` 가 거짓이면 무조건 `skipped_manual_override` 로 빠져
    `clearEventLabel` 을 영원히 발행하지 않았다. 라벨 정의가 사라진 뒤 Google 이
    `eventLabelId` 를 비운다면, 우리 `autocolor_*` 마커 4개가 사용자 일정에
    **영구 잔류**한다(툼스톤된 규칙은 롤백을 재트리거할 사용자 경로가 없다 —
    `colorRollback.ts` 헤더의 막다른 길). 그래서 게이트에 절을 추가했다:
    **마커는 있는데 색이 아예 없는**(`eventLabelId`·`colorId` 둘 다 빈) 일정은
    보존할 사용자 선택이 없으므로 clear 대상이다. 새 카운터
    `cleared_orphan_marker` 로 실제 clear 와 구분한다(`rollback_runs` 컬럼은
    추가하지 않음 — 소비자 완료 로그가 summary 전체를 직렬화한다).
    이 절은 **단독으로도 옳다**: "사용자가 색을 직접 없앤 일정에 마커만 남는"
    기존 누수도 같이 막는다. 덕분에 라벨 삭제와 롤백의 **순서가 무관해진다.**
  - **기존 행은 영구히 삭제 대상이 아니다.** 운영자 본인의 컷오버 규칙 포함
    모든 pre-ADR-0008 행이 `'unknown'` 이다. 회복 경로는 추측 백필이 아니라
    "규칙을 지우고 새로 만든다"이며, 새 규칙부터 provenance 가 정확하다.
  - **삭제된 이름의 라벨을 Google 에서 새로 만들면 reconcile 이 영원히
    무시한다.** `deletedRuleNames` 블랙리스트(`labelReconcile.ts`)는 툼스톤된
    규칙의 이름을 전부 모아 동명 라벨의 INSERT 를 막는다 — 부활 버그를 막는
    장치다. 라벨까지 지우는 동선이 생기면서 "Google 에서 다시 만들어 볼까"가
    자연스러운 시도가 됐지만 그건 조용히 아무 일도 하지 않는다. 회복 경로는
    **애드온에서 규칙을 새로 만드는 것**(이름 unique 가 partial 이라 동작).
    블랙리스트를 손대면 부활 버그가 되살아나므로 **코드가 아니라 문구로**
    해결한다.
  - **툼스톤의 `label_id` 는 null 로 만들지 않는다.** 그 값이 reconcile 의
    `rulesByLabelId` 조회 키이자 `attached.ruleDeletedAt` skip 의 근거다.
    라벨이 실제로 사라졌을 때는 `label_deleted_at` 을 함께 스탬프해 행이
    "살아있는 백킹 라벨"을 주장하지 않게 한다.
  - **`removeEventLabel` 의 sanctioned caller 가 2개가 된다** — 생성 실패 시
    orphan 회수, 그리고 이 삭제 경로. `labelProperties` 는 ETag 가 없어
    쓰기 직전 재읽기가 lost-update 창을 좁힐 뿐 닫지 못한다는 사실은 그대로다
    (append 경로와 동일한 "관측은 되나 예방은 안 되는" 자세).
  - **실측 (2026-07-31, 운영자 prod 계정,
    `.scratch/native-labels/spike/dangling-label-probe.ts`)**:
    ① `calendars.patch` 는 **사용 중인 라벨의 제거를 거부하지 않는다**(HTTP 200,
    항목이 `labelProperties` 에서 사라짐). ② 그 라벨을 달고 있던 이벤트는
    **dangling `eventLabelId` 를 그대로 유지한다** — v0/v1 읽기 모두 삭제 전과
    동일한 UUID 를 반환하고 `colorId` 는 비어 있으며 `autocolor_*` 마커 3종도
    온전하다. 즉 `appOwned` 판정이 **참으로 유지되므로 `color_rollback` 은
    평소대로 동작한다.** ③ dangling 참조 위의 `clearEventLabel` PATCH 도 200.
    따라서 위 순서 독립 절은 이 경로에서는 **보험**이지 필수 조건이 아니다 —
    남겨두는 이유는 (a) 그것이 고치는 "사용자가 색을 직접 지운 일정의 마커
    잔류"가 독립적으로 실재하는 누수이고, (b) 문서화되지 않은 Google 동작이
    바뀌어도 설계가 무너지지 않게 하기 위해서다.
    **미실측으로 남는 것**: Google UI 가 dangling 참조를 어떤 색으로 그리는지
    (API 로는 알 수 없다). 롤백이 곧 참조를 떼어내므로 창은 짧다.
  - **후속 (Option B)**: `discovered`/`unknown` 라벨도 "이 라벨은 이 앱이 한
    번도 건드리지 않은 일정에 붙어 있을 수 있습니다" 급의 더 강한 경고 뒤에서
    삭제를 허용하는 안. 기존 행 문제를 정면으로 푸는 유일한 길이지만, 사용자
    데이터 파괴 범위가 원리적으로 무한하므로 별도 결정으로 남긴다.

- References:
  - [`../../src/AGENTS.md`](../../src/AGENTS.md) "Rule deletion is a TOMBSTONE"
    (live invariant — ADR 와 어긋나면 그쪽이 우위)
  - [`../../src/db/schema.ts`](../../src/db/schema.ts) `categories.labelOrigin`
  - [`../../src/routes/categories.ts`](../../src/routes/categories.ts)
    `removeLabelForRule` / `toWire.labelDeletable`
  - [`../../src/services/colorRollback.ts`](../../src/services/colorRollback.ts)
    순서 독립 절
  - [`../../src/services/eventLabels.ts`](../../src/services/eventLabels.ts)
    `removeEventLabel` 계약
  - [`0006-native-labels-adoption.md`](0006-native-labels-adoption.md)
    Decision 3 (본 ADR 이 좁힌다), Decision 2 (출처 불문 동일 취급 — 분류
    측면에서는 불변)

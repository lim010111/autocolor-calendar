Status: ready-for-agent
GitHub: #115

## What to build

`keyword` 를 임베딩 씨앗으로 합류시킨다. 이슈 #02 가 `name` 씨앗으로 깐 임베딩
경로를 `seed_type='keyword'` 행까지 확장하는 슬라이스.

**#02 가 이미 깔아둔 것 (이 슬라이스에서 코드 0줄):**

- `rule_seeds` 테이블·CHECK enum(`'name'|'keyword'|'example'`)·HNSW·user 인덱스는
  `0017` 에서 이미 keyword 행을 수용 → **신규 마이그레이션 불필요**.
- Stage-1 kNN 읽기 경로(`src/services/stage1.ts:knnByUser`)는 **seed-type 무관** —
  `SELECT DISTINCT ON (rule_id) … FROM rule_seeds WHERE user_id=…` 에 `seed_type`
  필터가 없다. keyword 행이 생기는 즉시 rule 별 max-코사인 풀(name+keyword 통합
  best)에 자동 합류한다. → read-path 코드 변경 0줄.
- `gradeOf()` 가 이미 `keyword → declared → T_DECLARED` 로 매핑 → keyword 는
  Declared 등급으로 평가된다(#02 에 이미 존재). → 로직 변경 없음, 테스트만 추가.
- preview 라우트는 이미 `matchedSeed`/`score` 를 방출(#02). GAS `formatMatchLine`
  만 사멸한 `matchedKeyword` 를 읽음(아래 AC 로 정리).

**따라서 #03 의 실제 작업은 write 쪽에 있다.** `name` 은 rule 당 1행
create-or-replace(partial-unique)였지만 `keyword` 는 **0..N·uniqueness 없음** →
`writeNameSeed` 가 못 다루는 **집합 재조정(set reconciliation)**. keyword 추가/삭제가
씨앗 행 추가/삭제와 동기화된다.

end-to-end 범위:

- keyword write = **incremental diff**(add→임베딩·insert, remove→delete,
  unchanged→건드리지 않음). 기존 `RuleSideEffects` seam 재사용.
- 기존 사용자 keyword 일괄 backfill — #02 의 name backfill 스크립트를 **name+keyword
  둘 다** 심도록 확장.
- keyword 씨앗은 Declared 등급 — `name` 과 동일하게 `T_declared` 바를 통과해야
  적중. keyword 는 example 이 아직 없는 신규 Rule 의 콜드 스타트 신호다.
- GAS 사이드바 카피(`matchedSeed`) 정리 + reconciliation/grade 테스트.

ADR-0004: keyword 는 더 이상 문자열 매칭에 쓰이지 않는다 — 씨앗으로 용도
변경되어 존속하며 마이그레이션은 무손실이다. (keyword 의 *존속/폐기·형태* 판정은
ADR-0004 §7 의 open follow-up 이며 — ADR-0005 콜드스타트 승자 arm=`name_phrase` 은
그 finding 을 완결하지 않았다 — #03 은 ADR-0004 의 **accepted** 결정
"keyword 는 Stage 1 에 남되 높은 바를 통과" 위에서 진행한다. #03 은 그 follow-up 을
재개하지 않는다.)

**OAuth 검수 게이트: 해당 없음.** `keyword` 씨앗은 사용자가 직접 입력한 비-PII
텍스트이며 새 캘린더 내용을 durable 저장하지 않는다 — OAuth 검수 출시 게이트는
examples 씨앗(#05/#06)에만 적용된다. 이 이슈는 검수 통과 전에 빌드·배포
가능하다 (ADR-0004 "범위").

## Provisional dependencies (ADR-0005) — 상속

#03 은 #02 가 흡수한 세 잠정 결정을 **그대로 상속**한다(재-흡수 불요):

- **모델·차원 `gemma`(768) provisional / 임계값 `T=(0.30,0.55,0.10)` provisional** —
  keyword 는 기존 `src/config/embedding.ts` 상수를 참조만 한다(신규 상수 없음).
- **프리픽스 = prod 불변항** — keyword write·backfill 은 반드시 #02 의
  `embedTexts` 헬퍼(고정 프리픽스 강제, `src/services/embeddings.ts`)를 경유한다.
  독립 임베딩 경로/프리픽스 금지(ADR-0005 §prefix: backfill·create/update·title
  hot-path 동일 프리픽스 — 불일치 시 저장 씨앗 벡터 전수 오염).

## Acceptance criteria

- [x] **마이그레이션 불필요 (확인)** — keyword 는 `rule_seeds` 테이블/enum/인덱스를
      변경하지 않는다(`0017` 이 이미 수용). incremental-diff 가 existing 대비 diff
      하므로 uniqueness 제약도 불요 — 동시 편집으로 인한 keyword 중복 행은
      low-risk known-limitation 으로 남긴다(제약 추가 안 함).
- [x] **keyword write = incremental diff** — 단일 헬퍼(예: `reconcileKeywordSeeds`)를
      `createRule`/`updateRule` 의 기존 `RuleSideEffects` seam(→ 라우트 `waitUntil`)
      에서 호출. `updateRule` 은 `patch.keywords !== undefined` 일 때만 발화
      (colorId/priority-only 는 keyword 재조정 안 함 — #02 `writeNameSeed` 규율 정합).
      `createRule` 은 `input.keywords` 전량을 add 로 처리.
- [x] **diff 로직 분해** — 기존 keyword 씨앗 행(`SELECT seed_text WHERE rule_id=? AND
      seed_type='keyword'`) 대비 계산: `new = dedupe(비어있지 않은 keywords)`,
      `toAdd = new − existing`, `toRemove = existing − new`. **unchanged 는
      재임베딩·재작성 안 함**(#02 "텍스트 바뀔 때만 재임베딩" 규율 정합 — replace-all
      이 아니라 diff 인 이유).
- [x] **동일 임베딩 경로 재사용** — `toAdd` 는 #02 의 `embedTexts` 헬퍼로 **1배치**
      임베딩(고정 프리픽스 강제). 새 임베딩 함수·프리픽스 경로를 만들지 않는다
      (ADR-0005 §prefix 불변항).
- [x] **embed-before-mutate 순서 + 실패 거동** — `toAdd` 임베딩을 **행 변경 이전**에
      수행한다; 임베딩 실패 시 **warn-only, 행 미변경**(기존 keyword 씨앗 보존) —
      `writeNameSeed` 와 동일한 fan-out 실패 모델(요청은 성공, 복구=다음 편집/backfill).
      delete/insert 는 임베딩 성공 후에만.
- [x] **delete 는 테넌트 스코프** — `toRemove` 삭제는
      `where rule_id=? AND user_id=? AND seed_type='keyword' AND seed_text IN (…)`
      (src/AGENTS.md "Tenant isolation" — RLS 는 Worker 경로에서 무효). 빈 리스트
      (`keywords=[]`)면 그 rule 의 keyword 씨앗 전량 제거.
- [x] **backfill 단일 스크립트로 확장** — `scripts/backfill-name-seeds.ts` 를
      name+keyword 둘 다 심도록 확장(`backfill-seeds.ts` 로 개명). **재실행 안전**
      (idempotent — 768→1024 flip 재-backfill 이 이 잡의 재실행). 검증:
      `name 행 수 == categories 수` **AND** `keyword 행 수 == Σ rule 별 distinct
      keyword 수`; 불일치 시 non-zero exit.
- [x] **backfill 개명 lockstep** — 스크립트 개명 시 참조를 동일 PR 에서 갱신:
      `drizzle/0017_*.sql` flip 절차 헤더(현재 `scripts/backfill-name-seeds.ts` 명시)·
      `src/AGENTS.md` §5 "Existing rules are seeded once via …"·루트 `AGENTS.md`
      quick-commands. (`check-context-paths.py` 가 깨진 참조를 잡는다.)
- [x] **kNN read = 변경 없음 (테스트로 고정)** — `stage1.ts:knnByUser` 는 seed-type
      무관이라 keyword 행이 자동으로 rule 별 max-코사인 풀(`DISTINCT ON (rule_id)`)에
      합류함을 **테스트로 고정**한다(read-path 코드 변경 0줄; 회귀 방지 목적).
- [x] **keyword=Declared 등급 테스트** — 승자 씨앗이 keyword 일 때 `gradeOf`→declared
      →`T_DECLARED` 바로 평가됨을 `decideStage1` 단위 테스트로 검증. (등급 파생은
      #02 에 이미 존재 — keyword 경로 테스트만 추가.)
- [x] **reconciliation 단위 테스트** — add / remove / unchanged / empty-list 4 케이스
      + **embed-실패-시-행-보존** 케이스를 검증.
- [x] **GAS `formatMatchLine` matchedSeed 갱신** — 사멸한 `matchedKeyword` 분기를
      `matchedSeed`(+`score`) 로 교체하고 신규 i18n 키 `match.byRule.withSeed` 를
      4개 로케일(en/ko/zh-CN/zh-TW)에 추가. #02 가 preview 를 `matchedSeed` 로 바꾼
      뒤 남은 dead-branch(rule 매칭 시 씨앗 텍스트 미표시 degrade)를 닫는다.
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 통과
- [x] `python3 scripts/check-context-paths.py` 통과 (backfill 개명 → 문서 경로 참조 갱신 검증)

## Blocked by

None — #02 (name seeds) resolved. `rule_seeds` 테이블·enum·seed-type-무관 kNN
read·grade 파생·`embedTexts` 헬퍼가 모두 존재하므로 keyword write/backfill/테스트
착수 가능.

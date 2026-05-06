# 07 — Backup and recovery

> 이 runbook은 [`TODO.md` §7 line 132](../../TODO.md) "Supabase 데이터베
> 이스 백업/복구 정책 수립" 정본 절차다. Workspace Marketplace admin
> 검수에서 자주 묻는 "데이터 복구 절차" 항목 (`docs/marketplace-readiness.md`
> §3 row 178)의 prerequisite.
>
> **현 단계 정책 (2026-05-06 결정): PITR add-on 활성화 보류, Pro plan
> daily snapshot (7일 보존)만으로 운영 시작.** RPO 24h 허용. 근거 +
> 도입 트리거는 Step 1 "PITR 보류 결정" 절 참조. 본 runbook의 1회성
> 작업은 **G2 직후 즉시 daily snapshot 기반 복구 리허설 1회** —
> PITR 활성화 단계 (Step 3A)는 트리거 충족 시점까지 미실행.
>
> Owner: Eng. 본 runbook은 Supabase Dashboard 콘솔 작업 + 1회 복구 리허설
> 까지 책임. 정기 복구 검증 (분기 1회) 절차는 [08 runbook](./08-marketplace-submission.md)
> Step 6의 출시 후 운영 트리거에 인용.
>
> **이 runbook의 범위 밖**: Cloudflare Workers 코드 / Wrangler 설정 백업.
> 코드는 GitHub origin이 source of truth, Wrangler 설정은
> `wrangler.toml` + `pnpm sync-secrets`로 재구성 가능 (`src/CLAUDE.md`
> "Secret rotation impact" 운영 절차). DB만이 본 runbook의 영역.

- **Pre-conditions**:
  - [02 runbook](./02-prod-environment-activation.md) Step 1-2 완료 —
    prod Supabase 프로젝트 + drizzle 마이그레이션 적용.
  - Supabase 프로젝트 owner 또는 admin 권한.
  - Supabase Pro plan 결제 (daily snapshot 7일 보존 prerequisite).
- **Acceptance** (현 단계, PITR 보류):
  - 복구 리허설 1회 성공 — 본 runbook Step 3B 시퀀스 (daily snapshot
    기반) 완수.
  - RPO / RTO 본 문서에 명시 (= Step 2 결과, 현재 RPO 24h).
  - `docs/marketplace-readiness.md` §5 row 262 status note에 "PITR 보류
    + daily snapshot only" 명시.
- **PITR 활성화 단계 추가 Acceptance** (도입 트리거 충족 후):
  - PITR 활성화 — Supabase Dashboard → Project → Settings → Database →
    Backups 탭에서 "Point in Time Recovery" 체크 표시.
  - PITR 기반 복구 리허설 1회 성공 — Step 3A 시퀀스 완수.
  - RPO 갱신 (24h → 초 단위), Step 2 / Step 5A 답변 본문 동시 갱신.

## Step 1 — Backup 정책 결정 + Supabase plan 점검

### Supabase 자동 백업 기본 동작 (모든 plan)

- **Daily snapshot**: 매일 1회 자동, 7일 보존. Free / Pro / Team / Enterprise
  공통.
- **다운로드 가능**: Dashboard → Database → Backups → "Download backup"
  버튼. SQL dump 파일.
- **Restore 버튼**: 같은 프로젝트 또는 새 프로젝트로 시점 복구.

### Point-in-Time Recovery (PITR)

- **Pro plan 이상 전용**.
- **초 단위 RPO**: 마지막 commit까지 복구 가능.
- **보존 기간**: Pro 7일, Team 14일, Enterprise 28일.

### plan 비교 (개략 — 정확한 가격은 Supabase 콘솔의 현재 가격표 참조,
vendor URL 인라인 금지)

| Plan | Daily snapshot | PITR | Storage / Bandwidth quota | 권장 시점 |
|---|---|---|---|---|
| Free | 7일 보존 | ❌ | tight | dev 환경만 |
| Pro | 7일 보존 | ✅ 7일 (add-on) | moderate | **prod 1단계 — PITR add-on은 보류** |
| Team | 14일 보존 | ✅ 14일 | larger | 사용자 100+ 또는 contractual SLA 시 |
| Enterprise | 28일 보존 | ✅ 28일 | custom | 대규모·계약 단위 |

### PITR 보류 결정 (2026-05-06)

**현 단계 권장: Pro plan만 결제, PITR add-on은 보류.** 이유:

- **비용 vs 단계 부적합**: PITR 7d add-on은 Compute Small 업그레이드
  (~$15/mo) + PITR 자체 (~$100/mo) = 매월 $115+ 추가. pre-revenue 단계
  ROI 미정합.
- **아키텍처상 데이터 자가복구**: `architecture-guidelines.md` "Source of
  Truth" — Google Calendar incremental sync (`nextSyncToken`)이 사실상
  source of truth. `sync_state` / `oauth_tokens` / `sessions` /
  관찰성 4종 (`llm_calls` / `sync_runs` / `sync_failures` /
  `rollback_runs`)은 재로그인 또는 full resync로 회복.
- **비가역 손실 surface = `categories`만**: 사용자 정의 룰 행. 24h RPO
  손실 허용 가능 (Marketplace 초기 단계).
- **Marketplace 심사 의무 아님**: review-only 단계는 daily snapshot으로
  통과.

### PITR 도입 트리거 (보류 해제 조건)

다음 중 하나 충족 시 Step 3A로 진행:

- **유료 Pro 사용자 수십~수백 명**: 단일 row 손실 사고가 매출/평판에
  실질 임팩트가 될 규모. 정확한 임계는 운영자 판단.
- **매출 흡수 가능**: 월 매출이 PITR 추가 비용 $115+를 흡수 가능한 시점.
- **계약/SLA 의무**: 특정 고객 또는 Marketplace 후속 심사가 초 단위
  RPO를 요구하는 경우.

도입 시 본 runbook Step 3A + Step 5A를 동시 실행하고 §5 row 262 note를
갱신.

### 결정 기록

현재 결정 (Pro plan + PITR 보류)을 [`docs/marketplace-readiness.md` §5 row 262](../marketplace-readiness.md)
note에 1줄로 기록. PITR 활성화 시 같은 row만 갱신.

## Step 2 — RPO / RTO 정의

### 목표 (현 단계, daily snapshot only)

| 지표 | 정의 | 이 서비스의 목표값 |
|---|---|---|
| **RPO** (Recovery Point Objective) | 사고 시점 대비 잃을 수 있는 데이터 최대 시간 | **24시간** (마지막 daily snapshot 시점까지) |
| **RTO** (Recovery Time Objective) | 사고 발생부터 복구 완료까지 최대 시간 | **30-60분** (단순 데이터 손상) / **2-4시간** (전면 손실) |

PITR 활성화 시 RPO를 **초 단위**로 갱신 (§Step 1 "PITR 도입 트리거"
충족 후). RTO 목표는 변동 없음.

### 근거

- RPO 24h는 daily snapshot only의 직접 결과. PITR 활성화 시 초 단위로
  단축됨.
- RTO 30-60분은 **단일 user / 단일 row 복구** 시나리오: 직전 daily
  snapshot을 새 프로젝트로 복구 (~10-30분) + 원하는 row export → 운영
  프로젝트 import (~10분) + 검증 (~10분).
- RTO 2-4시간은 **전면 손실** (Supabase 프로젝트 자체가 사라진 시나리오):
  새 Supabase 프로젝트 생성 + drizzle 마이그레이션 (~10분) + 직전 daily
  snapshot 복구 (~30-60분) + Hyperdrive `wrangler hyperdrive update` 새
  connection string 주입 (~5분) + Worker redeploy (~5분) + smoke 검증
  (~30분).

### Marketplace admin 답변용 한 줄 요약

> "AutoColor 백엔드는 Supabase managed Postgres에서 daily snapshot (7일
> 보존)을 운영합니다. 단일 row 손실 30-60분 내 복구, 전면 손실 2-4시간 내
> 복구를 목표합니다. 사용자 규모 확대 시 Point-in-Time Recovery (초 단위
> RPO)로 단계별 업그레이드 예정입니다."

이 문장은 [`docs/marketplace-readiness.md`](../marketplace-readiness.md)
§5 row 262 status 채울 때 사용. PITR 활성화 시점에 RPO 문구를 초 단위로
갱신하고 "단계별 업그레이드 예정" 절을 활성화 사실로 바꿈.

## Step 3 — PITR 활성화 (보류) + 복구 리허설

> 현 단계 실행 범위: **3B만**. 3A는 §Step 1 "PITR 도입 트리거" 충족
> 후 별도 PR로 진행.

### 3A — PITR 활성화 (현재 보류)

> ⚠️ **현 단계 미실행.** §Step 1 "PITR 보류 결정"에 따라 daily snapshot
> only로 운영 시작. 도입 트리거 (유료 사용자 규모 / 매출 / SLA) 충족
> 시점에 본 절차 실행하고 §Step 5A 답변 본문 갱신.

Supabase Dashboard → 프로젝트 선택 → Settings → Database → Backups
(또는 "Add-ons" 또는 콘솔 개편 시 다른 위치 — 메뉴 텍스트 변경 흡수):

1. "Point in Time Recovery" 토글 ON. PITR add-on은 Compute Small 이상
   요구 — Compute upgrade 결제 동시 진행.
2. 보존 기간 선택 (Pro 7일).
3. 활성화 후 **첫 PITR 가능 시점은 활성화 시점 + 약 30분 후** (WAL 수집
   초기화 시간).

검증:

```sql
-- Supabase Dashboard → SQL Editor:
SELECT * FROM pg_stat_archiver;
-- archived_count > 0 + last_archived_time이 최근이면 WAL 수집 중.
```

활성화 후 PITR 기반 복구 리허설 (Step 3B에서 "Restore to a point in
time" 사용 + timestamp 단위 입력) 1회 추가 실행 권장.

### 3B — 복구 리허설 (현 단계 실행 — daily snapshot 기반)

> 현 단계는 daily snapshot 기반으로 진행. PITR 활성화 후 같은 절차에서
> "Restore to a point in time" 메뉴 사용 + timestamp 정밀도만 변경
> (snapshot 단위 → 초 단위).

리허설은 **별도 새 프로젝트로 복구**해 운영 데이터 무영향:

1. 운영 프로젝트의 임의 user → categories 1개를 SQL Editor에서 삭제
   (또는 직전 daily snapshot 직후 시점에 의도적으로 추가 후 삭제 — daily
   snapshot 단위라 "삭제 1분 전" 같은 미세 시점 복구는 불가):
   ```sql
   DELETE FROM categories WHERE id = '<test-category-id>';
   -- 시각 기록: 정확한 timestamp (예: 2026-05-04 15:30:42 UTC).
   ```

2. Supabase Dashboard → Database → Backups → 직전 **daily snapshot 행
   선택 → "Restore"** (PITR 비활성 상태에서는 "Restore to a point in
   time" 메뉴가 없음 — snapshot 단위만).

3. 복구 대상: **새 프로젝트** 선택 (기존 프로젝트 덮어쓰기 절대 금지 — 운영
   데이터 손실).

4. 복구 완료 (~10-30분) 후 새 프로젝트의 SQL Editor:
   ```sql
   SELECT * FROM categories WHERE id = '<test-category-id>';
   -- 1행 반환 — 삭제 전 (snapshot 시점) 데이터 복구 성공.
   ```

5. (선택) 운영 프로젝트로 row 복구:
   ```sql
   -- 새 프로젝트에서 export
   COPY (SELECT * FROM categories WHERE id = '<test-category-id>') TO STDOUT;
   -- 운영 프로젝트에서 import 또는 단순 INSERT 재실행.
   ```

6. 새 프로젝트는 리허설 후 즉시 삭제 (비용 발생):
   - Supabase Dashboard → 새 프로젝트 → Settings → General →
     "Delete Project".

**daily snapshot only 환경의 한계 인지**: snapshot 직후의 데이터 변경은
24h RPO 안에서 손실 가능. 이 한계를 알고 있다는 사실 자체가
Marketplace admin 답변 품질에 도움 (Step 2 한 줄 요약의 "단계별
업그레이드 예정" 구문이 이 인지를 표현).

리허설 결과 본 runbook의 마지막 부록 또는 별도 issue에 timestamp +
복구 시간 + 데이터 일치 결과 기록. 분기 1회 재리허설 (`docs/runbooks/08-marketplace-submission.md`
Step 6).

## Step 4 — Disaster recovery 시나리오

운영 중 사고 발생 시 의사결정 트리:

### 시나리오 A — 단일 row 손상 / 잘못 삭제

**증상**: 사용자 1명이 "내 카테고리 사라짐" 보고. DB에서 행 부재 확인.

**대응** (현 단계, daily snapshot only):
1. 정확한 손실 시점 추정 (사용자 보고 시점 + sessions 또는 sync_runs
   타임스탬프로 narrow).
2. 손실 시점이 직전 daily snapshot 시각보다 **이후**인지 확인 — 이후라면
   해당 row는 snapshot에 없음 (24h RPO 한계). 사용자에게 직접 재생성
   안내. **이전**이라면 Step 3 진행.
3. 직전 daily snapshot으로 복구 → **새 프로젝트** (운영 무영향).
4. 새 프로젝트 SQL Editor에서 해당 user의 행 export.
5. 운영 프로젝트에 INSERT (FK 제약 점검 — `users.id` 존재 여부 등).
6. 사용자에게 복구 완료 알림.

**대응** (PITR 활성화 후):
1. 정확한 손실 시점 추정.
2. 추정 시점 직전으로 PITR 복구 → **새 프로젝트** (운영 무영향).
3. 새 프로젝트 SQL Editor에서 해당 user의 행 export.
4. 운영 프로젝트에 INSERT (FK 제약 점검).
5. 사용자에게 복구 완료 알림.

**예상 시간**: 30-60분 (Step 2 RTO 단순 데이터 손상 케이스).

### 시나리오 B — 운영 프로젝트 전면 손실 / Supabase 인프라 장애

**증상**: `/healthz` 200이지만 `/me` 5xx, `wrangler tail --env prod`에
DB 연결 실패. Supabase Dashboard 접근 불가 또는 프로젝트 status "Inactive".

**대응**:
1. **Supabase 측 장애 확인** — Supabase status page 확인. vendor 측이라면
   복구 대기 (별다른 액션 불요, 사용자에게는 "잠시 후 재시도" 안내).
2. **프로젝트 자체가 삭제됐다면** (인프라 사고):
   1. 새 Supabase 프로젝트 생성 ([02 runbook] Step 1 절차).
   2. `pgcrypto` extension enable.
   3. 직전 daily snapshot SQL dump를 새 프로젝트에 import (PITR 활성화
      후라면 직전 PITR 시점으로 복구).
   4. drizzle 마이그레이션이 복구된 데이터와 정합성 있는지 점검 (마이
      그레이션 journal `__drizzle_migrations` 행 개수가 `drizzle/` 파일
      개수와 일치하면 OK).
   5. 새 connection string으로 Hyperdrive 갱신:
      ```bash
      pnpm wrangler hyperdrive update <prod-hyperdrive-id> \
        --connection-string="postgresql://postgres.<new-ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres"
      ```
   6. Worker 재배포 (`pnpm deploy:prod`) — Hyperdrive 변경분이 자동
      반영 안 되면 재배포로 강제.
   7. `/healthz` / `/me` 확인.

**예상 시간**: 2-4시간 (Step 2 RTO 전면 손실 케이스).

### 시나리오 C — Hyperdrive 자체 장애 (DB 정상, Worker 측 routing 오류)

**증상**: `/healthz` 5xx, Supabase Dashboard SQL Editor는 정상.

**대응**:
1. `pnpm wrangler hyperdrive list` → prod config 상태 확인.
2. config 손상이면 재생성:
   ```bash
   pnpm wrangler hyperdrive create autocolor-prod-db \
     --connection-string="<prod connection string>"
   # 새 UUID 발급 — wrangler.toml [[env.prod.hyperdrive]].id 수정
   pnpm deploy:prod
   ```
3. 단순 connection string drift라면 update:
   ```bash
   pnpm wrangler hyperdrive update <prod-hyperdrive-id> \
     --connection-string="<corrected>"
   ```

`src/CLAUDE.md` "Secret rotation impact" → "Supabase DB password" 항목
참조.

## Step 5 — 정합성 갱신

### 5A — `docs/marketplace-readiness.md` §5 row 262 (Backup / recovery policy)

기존 `미작성` → `초안` 또는 `완료`. status note는 현 단계에서 다음
형태:

> "Pro plan + daily snapshot (7일 보존). PITR 보류 (사용자 규모 확보
> 시 도입). 복구 리허설 1회 완료 ([07 runbook](docs/runbooks/07-backup-and-recovery.md))."

PITR 활성화 시 같은 row note를 "Pro + PITR 7d 활성화"로 갱신.

### 5B — `docs/security-principles.md` Principle 5 cross-reference

Principle 5는 secret 암호화 / 토큰 보호 영역이지만 백업 정책도 정합 보호의
한 axis. Principle 5 본문에 "백업 정책은 [07 runbook](docs/runbooks/07-backup-and-recovery.md)
참조" 1줄 추가 권장.

### 5C — `TODO.md:132` (Supabase 데이터베이스 백업/복구 정책 수립)

현 단계 (PITR 보류 결정 + daily snapshot 리허설 완료) 시점에는 체크박스
`[ ]` → `[x]` 가능. 도입 트리거 충족 → PITR 활성화 시 별도 후속
follow-up TODO를 새로 추가 (현재 항목을 `[ ]`로 되돌리지 말 것 —
체크박스는 "현 단계 정책 수립 완료"의 의미로 사용).

## 정기 운영 트리거 (출시 후)

본 runbook의 "1회 활성화"는 본격 출시 전 마쳐야 하는 일회성 작업이지만
출시 후에도 다음 정기 트리거:

- **분기 1회 복구 리허설**: Step 3B 시퀀스를 분기 단위로 재실행. 운영자
  교체 / Supabase 콘솔 메뉴 변경에 적응. 결과 기록.
- **PITR 도입 트리거 점검**: 매월 또는 분기 1회 사용자 수 / 매출 추이를
  §Step 1 "PITR 도입 트리거" 조건과 대조. 충족 시 Step 3A 실행.
- **plan 점검**: 사용자 수 / 데이터 양 증가 추이를 보고 Pro → Team
  upgrade 결정 (PITR 활성화와는 별개 축).

이 정기 트리거는 [08 runbook](./08-marketplace-submission.md) Step 6의
출시 후 운영 체크리스트에 인용된다.

## 롤백 시나리오

본 runbook은 mutation이 거의 없다 — PITR 활성화는 일방향 정책 변경
(현재 미실행), 복구 리허설은 새 프로젝트 격리.

- **PITR 활성화 후 plan 비용 부담** (현 단계 미해당 — 도입 후 적용):
  PITR 토글 OFF로 daily snapshot only로 환원 가능. 단 RPO가 24시간으로
  늘어남 — Marketplace admin 답변 본문 갱신 필요 (Step 5A).
- **복구 리허설 새 프로젝트 삭제 누락**: Supabase Dashboard에서 사용
  중인 프로젝트가 누적되면 plan별 프로젝트 개수 제한 / 비용 누적. 분기
  점검 시 정리.
- **복구 리허설 도중 운영 프로젝트 덮어쓰기 실수**: 복구 대상은 반드시
  "새 프로젝트". 운영 프로젝트 덮어쓰기는 콘솔이 명시적 경고를 띄우지만,
  실수 시 운영 데이터 손실. 리허설 시 두 사람이 cross-check 권장.

## Submission-time 영향

- `docs/marketplace-readiness.md` §5 row 262 (Backup / recovery policy)
  `초안` → `완료` (현 단계 정책 수립 + 리허설 완료 시점).
- `TODO.md:132` 체크박스 `[ ]` → `[x]` (PITR 보류 + daily snapshot 리허설
  완료 시점).
- 본 runbook 자체는 G8 (Marketplace 등록)을 unblock하지 않지만 admin 답변
  품질을 향상시켜 검수 통과 신뢰도 증가.

## Cross-references

- [`TODO.md` §7 line 132](../../TODO.md) — 작업 정본
- [`docs/completion-roadmap.md`](../completion-roadmap.md) — G7 절
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) — §5 row 262 (현 단계 정합성 갱신 대상)
- [`docs/security-principles.md`](../security-principles.md) — Principle 5 cross-reference
- [`docs/runbooks/02-prod-environment-activation.md`](./02-prod-environment-activation.md) — Step 1 prod Supabase 프로젝트 prerequisite, Step 13 세션 GC pg_cron (Retention 정책 일부)
- [`docs/runbooks/08-marketplace-submission.md`](./08-marketplace-submission.md) — Step 6 정기 운영 트리거에 인용
- [`src/CLAUDE.md` "Secret rotation impact"](../../src/CLAUDE.md) — 시나리오 C Hyperdrive 갱신 절차
- [`drizzle/`](../../drizzle/) — 마이그레이션 journal (시나리오 B 정합성 점검)

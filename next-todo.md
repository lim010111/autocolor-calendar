# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§7 Supabase 데이터베이스 백업/복구 정책 수립**
  - **선정 근거**:
    - **Momentum**: 방금 쉽핑한 `docs/marketplace-readiness.md` §5 Launch Gate 테이블에 "Backup / recovery policy — 미작성 — `TODO.md:130`" 행이 걸려 있어 런치 준비 문서 스레드를 직결 이어 붙일 수 있다.
    - **Blast radius**: 순수 문서 작업(Supabase PITR·복구 드릴 정책 runbook). 소스/스키마/GAS 변경 없음.
    - **Size**: S/M — 단일 operational policy doc + 상태 테이블 1행 갱신 + `TODO.md` 체크박스 1개.
  - **문제**: §7의 "Supabase 데이터베이스 백업/복구 정책 수립"(`TODO.md:130`)은 Marketplace Admin 리뷰와 운영 incident response 모두에서 필수이지만, 레포에 현재 백업/복구 절차를 문서화한 곳이 없다. `docs/marketplace-readiness.md` §5 Launch Gate에서도 `미작성`로 걸려 있어 launch blocker이다.
  - **해결**: `docs/backup-recovery-policy.md` 신규 작성. Supabase Point-in-Time Recovery(PITR) 가용성·RTO/RPO 목표·복구 드릴 절차·시크릿 복구 경로(`scripts/gen-secrets.ts`·`scripts/sync-secrets.ts`)·Hyperdrive origin 재구성 순서를 operational runbook으로 모은다. `docs/security-principles.md` / `docs/marketplace-readiness.md` 포맷을 따라 본문 중복 없이 포인팅. `docs/marketplace-readiness.md` §5 Launch Gate "Backup / recovery policy" 행의 detail pointer를 새 doc로 연결하고 status를 `초안`으로 갱신.
  - **주요 변경**: (1) `docs/backup-recovery-policy.md` 신규 — 섹션: Scope / RTO·RPO 목표 / DB 복구 절차(PITR · manual snapshot) / 시크릿 복구(3종 Worker secret + Hyperdrive origin update + GCP OAuth 재주입) / 복구 드릴 주기 및 owner / 미충족 gap 목록. (2) `docs/marketplace-readiness.md` §5 Launch Gate 테이블 "Backup / recovery policy" 행 status `미작성` → `초안`, detail pointer를 `TODO.md:130` → `docs/backup-recovery-policy.md`로 교체. (3) `TODO.md:130` 체크박스 flip + pointer. 소스 코드 변경 없음.
  - **문서**: `docs/backup-recovery-policy.md` 신규 runbook. `docs/marketplace-readiness.md` §5 행 갱신. `TODO.md:130` 체크박스 갱신.
  - **의존성**: 없음 (현재 Supabase tier에서 PITR이 즉시 활성화되지 않았다면 "PITR 활성화는 prod tier 전환 시 별도 작업"으로 doc 내 TBD 플래그; prod tier 전환 자체는 `TODO.md:35` §3 후속에서 이미 추적 중).
  - **사이즈**: S/M — 단일 operational policy doc + 상태 테이블 1행 갱신.

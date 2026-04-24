# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§2 OAuth Scope justification 문서 작성**
  - **선정 근거**:
    - **Momentum**: 방금 쉽핑한 `docs/backup-recovery-policy.md`에 이어 `docs/marketplace-readiness.md` §5 Launch Gate 테이블의 다음 `미작성` 행(Scope justifications written, line 256)을 연속 처리 — Marketplace 심사 제출 스레드를 한 번 더 전진시킨다.
    - **Independence**: 외부 blocker 없음(도메인·prod Supabase·법무 아티팩트 모두 불필요). `src/config/constants.ts:1-8`와 `gas/appsscript.json:5-12`가 정본이고, `docs/security-principles.md` Principle 3이 이미 scope minimization contract를 보유하고 있어 인용만 하면 된다.
    - **Size**: S — 단일 신규 문서 + `docs/marketplace-readiness.md` §2 status table 3행 갱신 + §5 Launch Gate 1행 갱신.
  - **문제**: `docs/marketplace-readiness.md:126-128` §2 status 테이블의 세 OAuth scope(`calendar` Restricted / `calendar.events` Sensitive / `userinfo.email`) justification 본문이 `미작성`이고, §5 Launch Gate line 256 "Scope justifications written" 행도 `미작성`이다. OAuth Consent Screen verification 제출 시 Google은 각 Sensitive / Restricted scope에 대한 목적·범위 증빙을 요구하므로 이 문서 없이는 §7 Consent Screen 검수(`TODO.md:131`) 진행 불가.
  - **해결**: `docs/assets/marketplace/scope-justifications.md` 신규 작성(`docs/marketplace-readiness.md:126` placeholder 경로 그대로). 세 scope 각각에 대해 (a) 이 scope를 왜 요청하는가 — 어떤 기능이 이 scope 없이는 작동 불가한가, (b) 어떤 데이터 최소 집합만 다루는가(`summary`/`description`/`location` 화이트리스트; attendee/creator/organizer destructure-and-omit), (c) `docs/security-principles.md` Principle 3(Scope Minimization)과 Principle 2(PII Masking)의 정본 인용 — 본문 중복 없이 포인팅. 구조는 `docs/security-principles.md` 인덱스 패턴(Promise / Canonical pointers / 추가로 이 문서 전용 Scope usage narrative) 준수.
  - **주요 변경**: (1) `docs/assets/marketplace/scope-justifications.md` 신규 — 머리말 + 세 scope 각 1섹션(§1 `calendar` / §2 `calendar.events` / §3 `userinfo.email` / §4 공통 PII 방어선 / 사용법 풋터). (2) `docs/marketplace-readiness.md:126-128` §2 status 3행 `미작성` → `초안`, detail pointer TBD → 신규 파일. (3) `docs/marketplace-readiness.md:256` §5 Launch Gate "Scope justifications written" 행 `미작성` → `초안`, detail pointer `§2` → 신규 파일. 소스 코드 변경 없음.
  - **문서**: `docs/assets/marketplace/scope-justifications.md` 신규. `docs/marketplace-readiness.md` §2 status + §5 Launch Gate 행 갱신. 홈 섹션 TODO는 `TODO.md:131`(§7 Consent Screen 검수 준비) 내부 하위 항목이지만 별도 체크박스가 아니므로 이번 PR에서는 flip 없음 — §7 `TODO.md:131` 전체는 Consent Screen submission 시점에 flip될 포괄 task.
  - **의존성**: 없음.
  - **사이즈**: S.

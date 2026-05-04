# Operational Runbooks

`docs/runbooks/`는 **운영자가 콘솔/CLI에서 sequential하게 실행하는 절차**
모음이다. 외부 시스템에 mutation을 일으키는 작업(도메인 등록·DNS·Cloudflare
Workers·Supabase·GCP·GAS Editor)이 단계 단위로 정리되어 있다. 코드 / 테스트
규약은 `docs/architecture-guidelines.md` · `src/CLAUDE.md`, 제출 자료는
`docs/marketplace-readiness.md` · `docs/assets/marketplace/`로 분리되며 이
디렉터리와 직접 중복되지 않는다.

## 어디서부터 읽어야 하나

- **사용자 (혹은 launch owner)**: 먼저 `00-user-action-checklist.md`. G1·G2·
  G4 동시 착수의 통합 진입점이며, 각 게이트의 작업을 체크박스 단위로 한 화면
  에 정리한다.
- **운영 작업 시작 시**: 도메인 작업이면 `01-…md`, prod 활성화 작업이면
  `02-…md` 순서로. 각 runbook은 step 단위 명령어 / SQL / 콘솔 메뉴 경로를
  포함한다.

## Index

- [00 — 사용자 액션 체크리스트 (G1 / G2 / G4 동시 착수)](./00-user-action-checklist.md)
  — 외부 작업 hub. 예산·시간 추정, 권장 진행 순서, 게이트별 체크박스.
- [01 — Domain & Google Search Console verification](./01-domain-and-search-console.md)
  — 도메인 구매·Cloudflare DNS 위임·Custom Domain 연결·GSC TXT 인증·GCP
  OAuth Consent Screen 갱신·Watch API 활성화.
- [02 — Prod environment activation](./02-prod-environment-activation.md)
  — Supabase prod 프로젝트·GCP prod OAuth client·시크릿·Hyperdrive·Queues·
  cron·GAS prod 배포·검증 시퀀스·세션 GC pg_cron·Watch 등록·롤백 시나리오.

## 글로벌 컨벤션

- **외부 vendor URL은 인라인하지 않는다** (`docs/assets/marketplace/sub-processors.md` §4).
  Cloudflare / Supabase / GCP / OpenAI 콘솔의 메뉴 경로는 명시하지만 직접
  링크는 걸지 않는다 — vendor가 메뉴를 개편할 때 업데이트 비용이 더 크다.
- **시크릿 / 도메인 / GCP ID 실제 값은 절대 commit하지 않는다.** runbook은
  자리(예: `<chosen>.app`, `<prod-domain>`)만 명시한다.
- **상태 라벨**(`미작성` / `초안` / `진행중` / `완료`)은 `docs/marketplace-
  readiness.md`의 status 표 라벨과 동일.

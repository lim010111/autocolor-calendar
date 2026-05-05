# 03 — CI/CD pipeline

> 이 runbook은 [`TODO.md` §7 line 131](../../TODO.md) "Cloudflare Workers
> 배포 및 CI/CD 파이프라인 (GitHub Actions) 구축"의 정본 절차다. 외부 의존
> 0, 즉시 가능 — G1·G2와 병행 권장. PR 시점에 자동으로 `pnpm test` /
> `pnpm typecheck` / `pnpm lint`를 강제해 main 브랜치 회귀를 사전 차단한다.
> [`docs/completion-roadmap.md`](../completion-roadmap.md) "게이트 3"의 정본
> 이며, §6.1 E2E 테스트(`TODO.md:110`)의 prerequisite이기도 하다.
>
> Owner: Eng. 본 runbook의 Step 1-3은 코드 push 1회 + GitHub 콘솔 설정 1회
> 로 완결되며 G2 (prod 활성화) 진행과 병행 가능. 자동 deploy job (Step 5)은
> G6 (OAuth verification) 통과 후로 의도적으로 미룬다.
>
> **이 runbook의 범위 밖**: 자동 prod deploy. 검수 통과 전까지 운영자가
> 로컬에서 `wrangler deploy --env prod`을 수동 실행하는 정책을 유지한다.
> 검수 통과 후 §6 절차로 자동 deploy를 묶어 처리.

- **Pre-conditions**:
  - 저장소가 GitHub origin (`origin/main`)에 push되어 있음.
  - 본인이 저장소 owner 또는 보호 브랜치 정책 변경 권한 보유.
  - 로컬에서 `pnpm test` / `pnpm typecheck` / `pnpm lint`가 모두 통과
    (현재 상태 — 332/332 테스트, 0 type 에러, 0 lint 위반).
- **Acceptance**:
  - `main` 브랜치 직접 push 차단 (보호 브랜치 정책 적용).
  - 임의 PR을 열면 `test` / `typecheck` / `lint` 3개 check가 자동 실행.
  - 3개 모두 green이 아니면 "Merge" 버튼이 비활성화.
  - 일부러 type 에러를 추가한 PR이 빨간 X로 머지 차단됨을 1회 검증.

## Step 1 — `.github/workflows/ci.yml` 작성

본 저장소의 `package.json` script와 1:1 미러 (`pnpm test` / `pnpm typecheck`
/ `pnpm lint` — `package.json:18-20,24` 참조).

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
```

설계 메모:

- **3 job 분리** — `test` 실패 시에도 `typecheck`/`lint` 결과를 같이 보고
  싶다. 단일 job에 chaining하면 첫 실패에서 멈춘다.
- **pnpm 10 + Node 20** — `package.json:8-10`의 `engines` / `packageManager`
  와 일치. drift 시 lockfile 검증이 깨진다. `pnpm/action-setup@v4`에
  `version:` 인자를 **주지 않는다** — `package.json:packageManager` 필드
  (`pnpm@10.33.0`)가 있으면 둘 다 명시 시 `ERR_PNPM_BAD_PM_VERSION` 등
  버전 충돌로 install 자체가 fail (PR #45 첫 발화에서 검증됨).
- **`--frozen-lockfile`** — `pnpm-lock.yaml` 변경분이 commit되지 않은
  상태로 PR이 올라오면 fail. lockfile drift 방지.
- **`actions/setup-node@v4`의 `cache: pnpm`** — 두 번째 PR부터
  `~/.local/share/pnpm/store`가 GitHub Actions cache로 복원돼 install
  시간 단축.
- **wrangler 사이드 작업 0** — 본 step의 어느 job도 wrangler에 secret을
  요구하지 않음. CI는 코드 검증만, deploy는 별개.

## Step 2 — Drizzle migration drift 가드 (선택, 권장)

스키마 변경(`src/db/schema.ts`) 후 `pnpm db:generate`를 잊고 PR 올리는
실수를 차단한다.

`.github/workflows/ci.yml`에 4번째 job 추가:

```yaml
  migration-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate
      - name: Verify no drift
        run: git diff --exit-code drizzle/
```

`pnpm db:generate`는 schema.ts와 `drizzle/` 마이그레이션 파일이 일치하면
no-op. 일치하지 않으면 새 마이그레이션 파일을 생성하고, 그 결과 `git diff
--exit-code` 가 실패 코드로 종료해 CI fail.

## Step 3 — GitHub 보호 브랜치 정책

GitHub 저장소 → Settings → Branches → "Add branch ruleset" (또는 legacy
"Branch protection rules"):

- **Rule name**: `protect-main`
- **Target branches**: `main` (Default branch)
- **Bypass list**: 비움 (admin도 bypass 금지 권장; 필요 시 본인만 추가).
- **Rules**:
  - ✅ "Restrict deletions"
  - ✅ "Require a pull request before merging"
    - "Required approvals": 0 (1인 개발이라; 팀이 늘면 1+로 상향).
    - ✅ "Require approval of the most recent reviewable push"
  - ✅ "Require status checks to pass"
    - ✅ "Require branches to be up to date before merging"
    - **Required status checks**: `test`, `typecheck`, `lint` (Step 2를
      추가했다면 `migration-drift`도). job 이름은 `.github/workflows/ci.yml`
      의 `jobs.<job-id>` 그대로.
  - ✅ "Block force pushes"

저장. 적용 즉시 다음 PR부터 게이트 작동.

## Step 4 — 검증

의도적으로 깨진 변경을 PR로 올려 게이트 작동 확인:

```bash
git checkout -b test/ci-gate
echo "const x: number = 'string'" >> src/__tests__/sanity.test.ts
git commit -am "test: trigger ci gate"
git push -u origin test/ci-gate
gh pr create --title "test: ci gate" --body "verifying ci"
```

GitHub PR 페이지에서:

1. `test` / `typecheck` 빨간 X 확인 (typecheck가 string→number 거절).
2. "Merge pull request" 버튼이 회색·비활성화 확인.
3. PR 페이지의 "Required status checks" 섹션에 모든 check 이름이 표시.

검증 완료 후:

```bash
gh pr close test/ci-gate
git checkout main
git branch -D test/ci-gate
git push origin --delete test/ci-gate
```

## Step 5 — 자동 deploy job (G6 통과 후 — 미룸)

본 runbook의 의도적 범위 밖. 이유:

- 자동 deploy는 `CLOUDFLARE_API_TOKEN` GitHub Secret을 필요로 하며,
  토큰 노출 리스크 vs. 수동 deploy 운영 부담의 트레이드오프 발생.
- prod이 정식 출시(`docs/completion-roadmap.md` 게이트 6 통과) 전에는
  실제 사용자 트래픽이 없어 자동화 ROI가 낮다.
- OAuth 검수 통과 전에는 운영자가 prod에 의도적으로 새 빌드를 올릴
  일이 드물고, 매 deploy마다 검수 영향(scope 변경 / consent 카피 변경)을
  체크하는 것이 더 중요.

검수 통과 후 다음 PR로 묶어 처리:

```yaml
  deploy-prod:
    needs: [test, typecheck, lint]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm wrangler deploy --env prod
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

`CLOUDFLARE_API_TOKEN`은 Cloudflare Dashboard → My Profile → API Tokens
→ "Edit Cloudflare Workers" template으로 발급, GitHub 저장소 → Settings
→ Secrets and variables → Actions에 등록.

이 job 활성화 시 운영 정책 변경: "main 머지 = prod 즉시 반영"이 된다.
검수 통과 후 1주일은 의도적으로 수동 deploy 유지하며 모니터링 결과 본
후 활성화.

## 롤백 시나리오

CI 도입 자체에는 mutation이 없다 (코드는 추가만, 외부 시스템 변경 0).

- **`.github/workflows/ci.yml`이 false-positive로 실패 (예: 일시적
  GitHub Actions 인프라 장애)**: 보호 브랜치 정책에서 해당 check를
  "Required" 목록에서 일시적으로 제거 → 머지 → 복원. Settings 한 곳에서
  토글로 가능.
- **CI 자체를 잠시 끄고 싶다**: 보호 브랜치 정책의 "Require status checks
  to pass" 룰을 비활성화하거나 ruleset을 "Disabled"로. 워크플로 파일은
  유지.
- **Migration drift 가드가 false-positive (예: drizzle-kit 업그레이드 후
  formatting 미세 변경)**: `migration-drift` job을 일시 제거하고 별도 PR로
  drizzle-kit 형식 정렬 commit을 추가한 뒤 재활성화.

## Submission-time 영향

- `docs/marketplace-readiness.md` §5 row 261 (CI/CD pipeline) status
  `미작성` → `완료`(Step 1-4 완결 후).
- `TODO.md:131` 체크박스 `[ ]` → `[x]`.
- §6.1 E2E 테스트(`TODO.md:110`) unblock — CI에 e2e job을 추가할 토대가
  생긴다.

## Cross-references

- [`TODO.md` §7 line 131](../../TODO.md) — 작업 정본
- [`docs/completion-roadmap.md`](../completion-roadmap.md) — G3 절
- [`package.json`](../../package.json) — `test` / `typecheck` / `lint`
  / `db:generate` script 정의
- [`docs/runbooks/02-prod-environment-activation.md`](./02-prod-environment-activation.md) — 자동 deploy job 활성화 시 prerequisite (prod 시크릿 정합성)
- [`docs/runbooks/06-oauth-verification.md`](./06-oauth-verification.md) — Step 5 자동 deploy 활성화 시점
- [`src/CLAUDE.md` "Environments"](../../src/CLAUDE.md) — dev/prod 분리 정책
- [`docs/marketplace-readiness.md`](../marketplace-readiness.md) — §5 launch gates 표

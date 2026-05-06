> 다음에 실행할 작업은 [`next-todo.md`](./next-todo.md)에서 관리됩니다. (`/next-todo` 스킬 전용)

## 1. 기획 및 아키텍처 확정

- [x] PRD 및 시스템 아키텍처(SaaS 확장 모델) 최종 리뷰 (Cloudflare Workers + Supabase 하이브리드 모델로 확정)
- [ ] UI/UX 와이어프레임 작성 (Add-on Card UI, 설정 페이지)
- [x] 데이터 저장 최소화, PII 마스킹, 권한(Scope) 최소화 등 보안/컴플라이언스 원칙 수립 — `docs/security-principles.md` 신규 인덱스 문서 (6개 원칙 × 정본 포인터 anchored reference; 본문 중복 없이 기존 CLAUDE.md / architecture-guidelines.md로 포인팅).
- [x] 운영용 도메인 확보 및 Google Search Console 소유권 인증 (Webhook용) — `autocolorcal.app` Cloudflare Registrar 등록 → Worker `autocolor-prod` Custom Domain 연결(`/healthz` 200) → GSC Domain property TXT verified(2026-05-04) → GCP OAuth Consent Screen Authorized domains 등록 + App home/Privacy/Terms URL 등록 (App home placeholder, Privacy/Terms 는 G4 publish 후 `legal.autocolorcal.app/{privacy,terms}` 로 갱신 — 2026-05-05). `wrangler.toml` `[env.prod.vars] GOOGLE_OAUTH_REDIRECT_URI`도 verified 도메인으로 교체. GCP prod Web Client redirect URI 등록과 `WEBHOOK_BASE_URL` 시크릿 주입은 §3 후속 "Prod 환경 활성화" / §4 후속 "Prod Watch API 활성화"로 이월.
- [x] Google Workspace Marketplace 퍼블리싱 정책 및 제약사항, 심사 대비 시나리오 검토 — `docs/marketplace-readiness.md` 신규 인덱스 (5개 섹션 × 상태 테이블; 본문은 `docs/security-principles.md`·`src/CLAUDE.md`로 포인팅).

## 2. Google Apps Script (Add-on 클라이언트) 개발

- [x] 기존 `gas/` 코드를 활용하여 Google Workspace Add-on 스캐폴딩
- [x] Add-on UI (CardService) 개발: 사이드바 기본 요약 및 설정 진입부
- [x] Add-on UI 디자인 개선
- [ ] 복잡한 규칙 설정을 위한 별도 Web UI (HTML Service 또는 외부 링크) 개발(Addon UI로 충분히 기능 수행 가능하다고 판단되어, 추후에 필요 시 개발 예정)
- [x] 최초 온보딩, 권한 부족/토큰 만료 시 재연결 UI, 서비스 해지 플로우 구현
- [x] 사용자 OAuth 인증 및 백엔드 API 통신(URL Fetch App) 연동 모듈 작성
- [x] **[출시 차단]** 규칙 추가 카드 폼 상태 유실 버그 — 키워드 입력 후 색상 선택 시 키워드가 초기화됨, 색상 먼저 선택 후 키워드 입력하면 "색상을 선택하세요" 에러. CardService 액션 콜백마다 카드 재빌드되는 구조에서 `formInputs` 미보존이 원인. `gas/addon.js` 규칙 추가 카드 빌더 + 색상 선택 액션 핸들러 수정 — `5aee099` (PR #44, merge `a8ac839`)에서 `buildRuleManagementCard`가 `e.formInput.rule_keyword`/`e.commonEventObject.formInputs`로 직전 키워드 복원 + `setParameters({selectedColorIdForRule})`로 선택 색상 결박, `actionSelectColorForRule`이 UserProperties 영속 저장 제거하고 `e.parameters` stash 후 카드 재빌드.
  - [x] 같이 처리: **현재 선택된 캘린더 색상 시각 표시(체크 표시 등)** — 색상 버튼 11개 중 어느 게 선택됐는지 사용자가 한눈에 알 수 있어야 함. 같은 PR `5aee099`에서 (a) 그리드 아이템의 `text=%20` → `text=%E2%9C%93` 치환으로 선택 색상에 ✓ 표시 + (b) 그리드 위에 "선택된 색상: <b>...</b>" 라벨 위젯 추가로 이중 시각 표시 적용.

## 3. 백엔드 (Cloudflare Workers + Supabase) 인프라 및 기반 구축

- [x] 기존 Python(FastAPI) 파일(`pyproject.toml`, `main.py` 등) 삭제 및 정리
- [x] `wrangler`를 활용한 Cloudflare Workers 프로젝트 초기화 및 TypeScript 셋업
  - [x] 3.2a 린트·포맷·테스트 하네스(ESLint/Prettier/Vitest) 스캐폴드 + crypto/state 유닛 테스트
- [x] Supabase 프로젝트 생성 및 Drizzle ORM 연동, 스키마 마이그레이션 도구 설정 (Direct URL 로컬 실행)
- [x] 사용자, Category, SyncState, OAuthToken 정보 저장을 위한 DB 스키마 작성 (RLS 적용 — Workers 경로는 애플리케이션 `where(user_id)`가 유일 격리 수단)
- [x] Google OAuth 2.0 서버사이드 연동 (Refresh token 애플리케이션 암호화 및 격리 저장)
  - [x] 3.5a 보호된 `GET /me` 스텁(`needs_reauth` 필드 포함) + `POST /auth/logout` + 구조화 JSON 로깅 미들웨어(redaction) + OAuth 에러 리다이렉트 규약(`?error=<code>`)
- [x] Secret 관리(Wrangler secrets) 및 Dev/Prod 환경 분리
  - [x] 3.6a `scripts/gen-secrets.ts`로 dev/prod 키 3종(TOKEN/HMAC/PEPPER) 생성·주입·팀 보관소 백업 + 로테이션 절차 문서화(`src/CLAUDE.md`)

### 3 후속 작업 (§3 범위 밖 이월)

- [x] **채팅 노출 자격증명 로테이션** — Supabase DB password와 `GOOGLE_CLIENT_SECRET` 재발급 + `.dev.vars` 갱신 + `pnpm wrangler hyperdrive update 0adfbd41c67e4225a63894c3768bb837 --connection-string=<session pooler URL>` + `pnpm sync-secrets dev`로 전체 6개 Worker secret 재주입 완료. 배포 dev Worker에서 `/healthz`·`/me`(DB 경로)·callback 재검증 성공.
- [x] **Prod 환경 활성화** — Supabase prod 프로젝트 생성 + 마이그레이션, GCP prod OAuth Web Client(별도 Consent Screen 또는 production 전환) + prod redirect URI 등록, `gen-secrets.ts`로 prod 3종 키 생성, `sync-secrets.ts prod`로 시크릿 일괄 주입, prod Hyperdrive config 생성 + 바인딩, GAS prod `/exec` URL로 `GAS_REDIRECT_URL` 설정 완료 (PR #43 `a01bde7` — Hyperdrive / Queue / cron bindings 활성화; 운영 절차는 `docs/runbooks/02-prod-environment-activation.md`).
- [x] **GAS UX 개선** — `gas/authCallback.html`에 `history.replaceState`로 `?token=` 쿼리 제거 + 자동 창 닫힘; `gas/authError.html`에 `google.script.url.getLocation` 기반 `?error=<code>`별 한국어 메시지 분기 (state_invalid / consent_denied / provider_error / token_exchange_failed / invalid_grant / server_error) 완료 (`93bcf3d`).
- [x] **`buildHomeCard` 사전 검증** — `buildAddOn` 진입점에 `missingBackendProperties()` gate 추가. `BACKEND_BASE_URL`·`OAUTH_AUTH_URL` 미설정 시 "백엔드 구성 필요" 카드 렌더 (`93bcf3d`).
- [ ] **세션 GC** — Supabase `pg_cron` 활성화 후 주 1회 `DELETE FROM sessions WHERE expires_at < now() - interval '7 days'` 스케줄 (§6 관측성 범위).
- [x] **`TOKEN_ENCRYPTION_KEY` 배치 로테이션** — `src/services/tokenRotation.ts` `rotateBatch` + `oauth_tokens.token_version` 정본화. Dual-key fallback in `getGoogleRefreshToken` (`TOKEN_ENCRYPTION_KEY_PREV` optional binding) + `[env.dev.triggers].crons` 추가 `0 3 * * *` + `scheduled()` cron 분기 (`WATCH_RENEWAL_CRON` / `TOKEN_ROTATION_CRON`). `drizzle/0013_material_avengers.sql`로 `oauth_tokens_token_version_idx` 추가. 운영 절차는 `src/CLAUDE.md` "Secret rotation impact" / "Token rotation (§3 후속)" + `docs/architecture-guidelines.md` invariant 새 불릿. Prod cron 활성화는 §3 후속 "Prod 환경 활성화"로 분리.

## 4. 핵심 동기화(Sync) 로직 및 Watch API 안정화

- [x] 기존 `gas/sync.js`의 Incremental Sync 로직을 TypeScript Worker로 이식 (멱등성 보장)
- [x] Google Calendar Webhook (Watch API) 엔드포인트 구현 (즉각 2xx 응답 및 Queue/Durable Objects 전송)
- [x] Watch 채널 수명주기 관리 (Cron Triggers를 활용한 갱신 및 만료 처리)
- [x] 비동기 Worker(Cloudflare Queues 등)를 활용한 캘린더별 동시성 제어 및 동기화 처리
- [x] `410 Gone` (Invalid Sync Token) 에러 발생 시 Full Resync 등 복구 전략 구현
- [x] 작업 실패 시 재시도(Exponential Backoff) 및 DLQ(Dead Letter Queue) 처리 전략

### 4 후속 작업 (§4 범위 밖 이월)

- [ ] **Prod Watch API 활성화** — verified custom domain 확보(§1) 후 `WEBHOOK_BASE_URL`을 prod `env.prod.vars`에 설정. 그 전까지 prod `/sync/bootstrap`은 Watch 채널 등록을 skip함.
- [x] **DLQ 감사 필드 확장** — `drizzle/0009`에 `sync_failures.summary_snapshot jsonb` + `sync_state.last_failure_summary jsonb` 추가. `applyResult`가 retryable 실패 시 `last_failure_summary`에 summary 기록, 성공 시 null 클리어. `dlqConsumer`가 DLQ 적재 시 `last_failure_summary`를 SELECT해 `summary_snapshot`에 복사(SELECT 실패 시 null로 fallback해도 감사 행은 항상 기록). error_body는 이미 `CalendarApiError` 경로로 Google API 에러만 저장 중이라 추가 작업 없음.

## 5. 하이브리드 분류(Classification) 엔진 구현 (2-stage: Rule → LLM)

> 현재 `src/services/classifier.ts`의 `classifyEvent`는 §5.1에서 rule-based first-match 구현으로 교체 완료. sync 파이프라인(`src/services/calendarSync.ts:181`, `:195-196`)은 `loadCategories` + `classifyCtx`로 훅 배선이 끝나 있다. `categories` 테이블은 `keywords text[]`, `priority`, 및 `UNIQUE (user_id, name)` 제약(§5.1 `drizzle/0006`)을 보유. 전체 아키텍처 선언은 `docs/architecture-guidelines.md`의 "Hybrid Classification Engine" 규칙을 정본으로 삼는다.

### 5.1 Rule-based 매칭 (Step 1) ✅

- [x] `POST/GET/PATCH/DELETE /api/categories` CRUD 라우트 (`src/routes/categories.ts`). 테넌트 스코프 compound WHERE + Zod 검증 + 23505 → 409 duplicate_name 맵핑.
- [x] `src/services/classifier.ts` stub을 `priority ASC, created_at ASC` first-match 대소문자 무시 substring 매칭(summary + description)으로 구현.
- [x] GAS `gas/addon.js`의 mock `getMockRules()`를 `/api/categories` 백엔드 호출로 교체 + `actionSyncNow`를 실제 `/sync/run` POST로 연결. 규칙 관리 카드에 부분 일치·수동 색상 보존 안내 위젯 추가.
- [x] Vitest `classifier.test.ts` (11 케이스) + `categoriesRoute.test.ts` (22 케이스 — 인증 게이트, 테넌트 격리, Zod 거절, 409 duplicate, 라운드트립).
- [x] **Acceptance 충족:** 규칙 추가 → 동기화 트리거 → `SyncSummary.updated` 증가 + 이벤트 색 적용; 재실행 시 `skipped_equal`로 멱등성.

### 5.2 PII 마스킹 (Step 2 전제) ✅

- [x] `src/services/piiRedactor.ts` — `summary`/`description`/`location`의 email·URL·전화번호(KR mobile/landline/1588 대표번호/국제번호 `+`·괄호 표기 포함)를 `[email]`/`[url]`/`[phone]` 토큰으로 치환 + `creator.email`/`organizer.email`/`attendees[].email`을 destructure-and-omit으로 제거. 파일 상단 SECURITY 주석으로 "DO NOT LOG OUTPUT" + regex-clone footgun 경고 명시. `redactEventForLlm(event)` 순수 함수 + `PII_TOKENS`·`PII_REGEXES` export. `src/CLAUDE.md`의 "calendar event payload 로깅 금지" 계약과 충돌 없음 (redactor는 §5.3 LLM 경로에서만 호출, 로깅 경로 미사용).
- [x] Vitest — `src/__tests__/piiRedactor.test.ts` (38 케이스, 5 그룹): NL redaction false-negative (18: ko+en email, https/www URL, KR mobile/landline 괄호 표기 `(02)`/`(031)` 포함, 국제번호 +82/+1/+81 및 `+1 (415) 555-2671` 괄호 표기, 1588 대표번호, multi-PII, 한국어 조사 보존 `에서`, 닫는 괄호 보존) + over-redaction 가드 (9) + structured email 필드 (6) + 순수성·idempotency (3) + 골든 acceptance (2: fixture 제약 pre-condition + acceptance 단언).
- [x] **Acceptance:** 골든 테스트가 `JSON.stringify(redacted)`에 `/@/`, `/http/i`, phone regex 매치 0건을 단언 — §5.2 수용 기준을 코드로 인코딩. `pnpm vitest run` 162/162 통과 + `pnpm tsc --noEmit` 에러 0.

### 5.3 LLM Fallback (Step 2) ✅

- [x] `OPENAI_API_KEY` (및 optional `LLM_DAILY_LIMIT`) secret 주입 — `scripts/sync-secrets.ts`는 `REQUIRED_SECRETS` / `OPTIONAL_SECRETS` 분리로 키 부재 시 skip. `.dev.vars.example`에 placeholder + "비어 있으면 LLM disabled" 주석 추가. `src/env.ts` `Bindings`에 `OPENAI_API_KEY?` / `LLM_DAILY_LIMIT?` optional 필드 추가 (prod shell 호환).
- [x] `src/services/llmClassifier.ts` — OpenAI `gpt-5.4-nano` Chat Completions + structured outputs JSON schema. `redactEventForLlm` → `buildPrompt`(whitelist: summary/description/location, attendees/creator/organizer는 PII 우려로 제외) → fetch(`AbortSignal.timeout(5s)`) → retry once on transient(TypeError/429/5xx/timeout). `mapCategoryNameToClassification` 서버 측 enum 검증으로 prompt-injection 방어. `reserveLlmCall` UPSERT+INCREMENT로 fetch 전 per-user 일일 상한(default 200, `LLM_DAILY_LIMIT` override) 체크.
- [x] `src/services/classifierChain.ts` — `buildDefaultClassifier({db, env, userId, onLlm*})` 팩토리. rule hit → short-circuit, rule miss + `OPENAI_API_KEY` 존재 + categories ≥ 1 → LLM leg. narrow counter callback으로 `SyncSummary` 의존성 역전.
- [x] `calendarSync.runPagedList` 배선 — `ctx.classifyEvent ?? buildDefaultClassifier({...})`로 체인 주입, `SyncSummary`에 `llm_attempted` / `llm_succeeded` / `llm_timeout` / `llm_quota_exceeded` 카운터 추가. `processEvent` 본문 무변경 (no_match 경로로 자연 귀속).
- [x] `drizzle/0008_llm_usage_daily.sql` — PK `(user_id, day)` 테이블 + RLS policy. `src/db/schema.ts`에 `llmUsageDaily` drizzle 정의 추가.
- [x] `docs/architecture-guidelines.md` Hybrid 불릿 — "timeouts / http errors / quota / missing key 모두 no_match 귀속" 명시. `docs/project-overview.md`는 Gemini 예시 → OpenAI `gpt-5.4-nano`로 명시.
- [x] Vitest — `llmClassifier.test.ts` (26 케이스: buildPrompt PII whitelist / mapCategoryName enum 방어 / reserve quota / 9 classifyWithLlm 시나리오 + 로깅 회귀 가드), `classifierChain.test.ts` (7 케이스: rule-hit short-circuit / LLM-hit / timeout / bad_response / quota / disabled / empty cats), `calendarSync.test.ts`에 §5.3 카운터 wiring 회귀 가드 2 케이스 추가.
- [x] **Acceptance 충족:** rule miss 이벤트가 LLM 경로로 category 배정; LLM 실패(timeout/5xx/429/파싱/quota/키 부재) 시 `no_match`로 silent skip. `sync_state.last_run_summary`에 4개 `llm_*` 카운터 JSON 키 노출. `pnpm vitest run` 전체 통과 + `pnpm tsc --noEmit` 에러 0.

### 5.4 색상 적용 정책 및 멱등성 ✅

- [x] 수동 override 보존 정책 정의 — `extendedProperties.private`에 `autocolor_v="1"` / `autocolor_color=<colorId>` / `autocolor_category=<categoryId>` 3-key 마커 (`src/services/googleCalendar.ts`의 `AUTOCOLOR_KEYS` / `AUTOCOLOR_MARKER_VERSION` 상수). `autocolor_color`가 현재 `event.colorId`와 일치할 때만 "앱 소유"로 인정 — 사용자가 PATCH 이후 색을 바꿨거나 마커가 없으면 사용자 수동 변경으로 간주하고 건드리지 않음.
- [x] `calendarSync.ts:131-143` `processEvent` 분기를 truth table 기반으로 재작성 — `current === target` → `skipped_equal` (마커가 없으면 retro-claim하지 않음), `current === ""` 또는 `appOwned` → `patchEventColor`에 마커 payload 동봉, 이외 모두 `skipped_manual`. `patchEventColor`에 5번째 optional `extendedPrivate` 파라미터 추가, 기존 단일 호출자 외 호출 부위 시그니처 비-파괴적.
- [x] Vitest — `googleCalendar.test.ts`에 PATCH body 회귀 가드 2 케이스(5번째 인자 미전달 시 `extendedProperties` 없음 / 전달 시 `private` 맵 정확) 추가. `calendarSync.test.ts`에 §5.4 ownership 신규 describe 4 케이스(empty-color PATCH 본문 마커 검증 / app-owned 재적용 / stale 마커 skip / no-marker retro-claim 금지). 기존 410·429·500 PATCH 회귀 테스트는 body shape를 단언하지 않아 회귀 없음. `pnpm vitest run` 208/208 통과 + `pnpm tsc --noEmit` 에러 0.
- [x] `docs/architecture-guidelines.md`에 "Color Ownership (§5.4)" 불릿 추가 + `src/CLAUDE.md`에 "Color ownership marker" 섹션(키 의미 / per-key 머지 의미론 / `autocolor_*` prefix 외부 쓰기 금지 invariant) 신설.
- [x] **Acceptance 충족:** 사용자가 수동 변경한 이벤트(마커 없음 또는 `autocolor_color !== current`)는 재분류 없이 `skipped_manual`. 앱이 마지막에 PATCH한 이벤트만(`autocolor_color === current`) 규칙 변경 시 새 색으로 재적용 + 마커 갱신.

### 5 후속 작업 (§5 범위 밖 이월)

- [x] **`onEventOpen` 실제 매칭 규칙 표시** — `POST /api/classify/preview` (`src/routes/classify.ts`) + `gas/addon.js` `onEventOpen` 리라이팅. rule-only(저지연 · LLM 쿼터 비소진). rule hit이면 카테고리명·매칭 키워드, no_match + OPENAI_API_KEY 설정 시 "다음 동기화 시 AI 분류 시도" 안내. 인증 실패 시 reconnect 카드로 이동.
- [x] **규칙 삭제 후 기존 이벤트 색상 롤백** — `DELETE /api/categories/:id`가 per-calendar `color_rollback` 큐 잡을 팬아웃. `src/services/colorRollback.ts`가 `privateExtendedProperty=autocolor_category=<id>` 필터로 이벤트를 페이징하며 §5.4 ownership 검증(`current colorId === autocolor_color`) 통과한 이벤트만 `clearEventColor`로 colorId·마커 3키 전부 null로 복귀. 수동 재색칠 이벤트는 건드리지 않음. 시간 윈도우는 runFullResync와 동일(30d/365d).
- [x] **짧은 키워드 false-positive 완화** — 규칙 관리 카드 키워드 입력 직후 `TextParagraph`로 "⚠️ 2자 이하 키워드는 의도치 않은 이벤트까지 매칭될 수 있습니다" 경고 렌더. §5.3 LLM 단계는 Rule-miss(=no-match) 케이스에서만 작동하므로 이 false-positive는 구조적으로 해결하지 않으며, 추후 사용자 피드백 기반으로 별도 완화책을 검토한다.
- [x] **LLM preview (on-demand)** — `POST /api/classify/preview`에 optional `{ llm: true }` 플래그 추가(`src/routes/classify.ts`). Rule hit이면 chain 내부에서 short-circuit, rule miss + llm=true이면 `buildDefaultClassifier`로 `classifierChain` LLM leg 1회 재사용 — `reserveLlmCall` 일일 상한을 sync와 공유해 별도 preview cap 없음. 응답 shape: LLM hit → `source:"llm"`, LLM miss/실패 → `source:"no_match" + llmTried:true` (Halt-on-Failure 준수). §6 Wave A 병행성 유지를 위해 preview도 route handler에서 `execCtx.waitUntil(db.insert(llmCalls)...catch(warn))`로 1행 insert. GAS `onEventOpen`에 "🤖 AI 분류 확인" 버튼(rule-miss + OPENAI_API_KEY 설정 + `!llmTried` gate) + `actionClassifyWithLlm` 핸들러 추가 — 결과를 `e.parameters.llmPreviewJson`에 stash해 `updateCard(onEventOpen(e))`로 제자리 렌더. `classifyRoute.test.ts` 5 신규 케이스(플래그 omit 회귀 / 키 없음 / rule hit via chain / LLM hit + `llm_calls` insert / LLM miss + `llm_calls` insert). `src/CLAUDE.md` "Preview LLM (§5 후속)" 섹션 + `docs/architecture-guidelines.md` Hybrid 불릿에 preview-quota-sharing 명시.
- [ ] **팀/공유 캘린더 ownership 충돌 정책** — 여러 사용자가 같은 캘린더의 색을 서로 덮어쓰는 문제. §5.4 메타데이터 + 사용자별 ownership 정책 별도 설계 필요.

## 6. 테스트 및 관측성(Observability) 확보

### 6.1 회귀/단위·E2E 테스트 커버리지

- [ ] `Vitest` 단위 테스트 및 모킹 (OAuth 토큰 갱신 실패, Sync Token 410 에러 등)
- [ ] Webhook 대량 발생 시 Queue 부하 분산, 캘린더 락(Lock) 및 동시성 제어 테스트
- [x] **실패 재시도 및 DLQ 적재 동작 검증 테스트** — §6 Wave A 계약 감사 결과 `dlqConsumer.test.ts`의 4 케이스(`summary_snapshot` 복사 / NULL 처리 / SELECT 실패 fallback / INSERT 실패 시 ack·no-retry)와 `syncConsumer.test.ts`의 retryable 쪽 2 케이스(behavioral + source-level regex guard)가 이미 구현되어 있음을 확인. 유일하게 비어 있던 슬롯 — `calendarSync.runPagedList` mid-chunk continuation 분기(`calendarSync.ts:431-447`)의 `lastFailureSummary: null` 클리어 — 에 대해 `calendarSync.test.ts`에 1 케이스(`mid-chunked full_resync UPDATE also clears last_failure_summary to null`) 추가. 변형 드릴(소스 line 438 삭제 → 테스트 fail 확인 → 원복)로 가드가 실제로 작동함을 검증.
- [ ] Rule → LLM 각 단계별 정확도/비용/지연 추적 및 PII 마스킹 단위 테스트.
- [ ] Add-on <-> Worker <-> Supabase 전체 흐름 E2E 테스트 (→ Wave 3: §7 CI/CD 파이프라인 선행조건)

### 6.2 통합 테스트 하네스 (postgres-in-container / Hyperdrive 에뮬레이터)

- [ ] **claim/release Postgres round-trip 통합테스트** (§4A 리뷰 Finding #2) — 현재 `syncConsumer.test.ts`의 `syncClaim — precision invariant` 블록은 소스 파일 regex 가드일 뿐 실제 `date_trunc('milliseconds', now())` → JS `Date` → `eq(inProgressAt, claimedAt)` round-trip을 검증하지 않는다. postgres-in-container 또는 Hyperdrive 에뮬레이터 도입 시 실제 round-trip 테스트 추가.
- [ ] **Watch 채널 DB round-trip 통합테스트** (§4B 리뷰 m4) — `lookupChannelOwner`, `registerWatchChannel`의 UPDATE 테넌트 스코프, `drizzle/0005`의 partial `UNIQUE (watch_channel_id, watch_resource_id)` 충돌 거동을 실제 Postgres에 대해 검증. 현재 mock-only 테스트로는 인덱스/컬럼 레벨 실수를 잡지 못한다. §4A Finding #2 해법과 같은 harness 재사용.

### 6.3 Wave B 관측성 (대시보드·롤업 엔드포인트)

- [x] **LLM 호출 로그·비용 대시보드** (§5 후속에서 이월) — **Wave A 완료**: `drizzle/0009`에 `llm_calls` 테이블 + `classifyWithLlm.finish()` 단일 emission + `classifierChain.onLlmCall` 전달 + `calendarSync.runPagedList` 버퍼 + `syncConsumer.execCtx.waitUntil(...).catch(warn)` fire-and-forget. **Wave B 완료**: `GET /api/stats?window=7d|30d`가 `llm_calls`를 outcome별(hit/miss/timeout/quota_exceeded/http_error/bad_response/disabled) 집계 + `AVG`/`percentile_cont(0.95) FILTER (WHERE outcome='hit')`로 hit-only 지연 지표 노출 + `llm_usage_daily` 오늘자 row 조인해 `dailyQuotaRemaining` 포함. 비용 환산(토큰×가격), 전용 관리자 UI, retention/TTL(pg_cron)은 Wave B 후속으로 이월.
- [x] **규칙 적용 카운터 노출** (§5 후속에서 이월) — `drizzle/0010`에 `sync_runs` 테이블 추가(`SyncSummary` unfold + outcome 6종 check). `calendarSync.runPagedList`에 `finalize(result)` 헬퍼 도입 — 모든 early-return을 경유하므로 모든 outcome(ok/reauth_required/forbidden/not_found/full_sync_required/retryable)이 정확히 1 row 기록. `syncConsumer.handleOne`이 `execCtx.waitUntil(db.insert(syncRuns)...catch(warn))` fire-and-forget로 주입(Wave A와 동일 격리). `GET /api/stats`의 `classification.updated` 필드를 `gas/addon.js` 홈카드 "최근 7일 분류된 일정: N건" 라이브 카운터로 연결(mock 제거), `lastSync.finishedAt`으로 "최근 동기화: M분 전" 렌더링. `sync_state.last_run_summary`는 `/me` 스냅샷 surface로 의도적 병존.
- [x] **`color_rollback` 텔레메트리** — `drizzle/0009`에 `rollback_runs` 테이블 추가. `applyRollbackResult`가 모든 outcome(ok/reauth_required/forbidden/not_found/retryable)에 대해 `attempt=msg.attempts`로 insert, insert 실패 시 warn 로그만 내고 `msg.retry`로 번지지 않아 중복 PATCH 방지. DLQ 적재 모니터링 대시보드는 Wave B(sync_failures 대시보드와 묶음)로 이월.

### 6.4 설계 후속 (레이트리밋·동시성·rate limit 통합)

- [ ] **사용자별 rate limit 확장** (§5 후속에서 이월) — §5.3에서 `LLM_DAILY_LIMIT`(per-user daily)만 구현. 분당/시간당 rate limit, preview endpoint throttle, `/sync/run` manual trigger rate limit, `/api/stats`(§6.3 Wave B 이후 GAS homecard render마다 호출) throttle을 통합 관리.
- [x] **`/sync/run` 레이트리밋 컬럼 분리** (§4A 리뷰 Finding #7) — `drizzle/0011`에 `sync_state.last_manual_trigger_at timestamptz` 추가. `POST /sync/run`만 이 컬럼을 성공 시 스탬프(enqueue 이후), consumer의 `updated_at` 터치와 완전히 분리. 기존 row NULL → `updated_at` fallback으로 pre-deploy 동작 유지. `syncRoute.test.ts`에 §6.4 suite 6 케이스(fresh×stale 매트릭스 4칸 + coalesce-no-stamp + enqueue-fail-no-stamp). `src/CLAUDE.md`에 "Manual-trigger rate limit (§6.4)" 계약 섹션 추가 — consumer가 이 컬럼을 절대 쓰지 않도록 invariant 못 박음.
- [x] **Watch 갱신 동시성 가드** (§4B 리뷰 M4) — `drizzle/0012`에 `sync_state.watch_renewal_in_progress_at timestamptz` 신규 컬럼(기존 `in_progress_at`(sync consumer 전용)과 의도적 분리 — Google API 표면이 다르므로 단일 lock은 인위적 serialization). `src/lib/watchClaim.ts`에 `claimWatchRenewal`/`releaseWatchRenewal` 헬퍼 신설 — `syncClaim.ts` 1:1 미러링 + 10분 stale TTL + `date_trunc('milliseconds', now())` ownership 정밀도 유지. `src/services/watchRenewal.ts` per-row 루프를 `try { claim → stop+register } catch { failed++ } finally { release }` 구조로 감싸서 claim 실패 시 skip, 릴리스는 모든 에러 경로에서 발화. `watchRenewal.test.ts`에 concurrency describe 7 케이스(claim acquired + claimedAt round-trip pin / claim skip / stop fail release / register fail release / 연속 row 독립 claim / stale TTL takeover / source-level regex guard). `src/CLAUDE.md`에 "Watch renewal concurrency (§6.4)" 섹션 + `docs/architecture-guidelines.md` 불릿 추가 — 이 컬럼을 sync consumer나 다른 writer가 절대 touch하지 않도록 invariant 못 박음.

## 7. 배포 및 출시

- [x] Cloudflare Workers 배포 및 CI/CD 파이프라인 (GitHub Actions) 구축 (→ §6.1 E2E 테스트의 선행조건) — `.github/workflows/ci.yml` 4 job(test/typecheck/lint/migration-drift) + `main` classic branch protection(4 status check + PR review 1명 + force-push/delete 차단) 활성화. `enforce_admins: false`는 1인 개발자 emergency push 대비 의도적. 자동 deploy job은 G6 통과 후로 미룸 (`docs/runbooks/03-cicd-pipeline.md` Step 5).
- [ ] Supabase 데이터베이스 백업/복구 정책 수립 — Supabase Pro 결제 완료 (2026-05-06). **PITR add-on 보류 결정 (2026-05-06)** — daily snapshot (7일 보존) only 운영, RPO 24h. 도입 트리거(유료 사용자 규모/매출/SLA)는 `docs/runbooks/07-backup-and-recovery.md` Step 1 "PITR 보류 결정" 절 참조. daily snapshot 기반 복구 리허설 1회 잔여.
- [ ] Google Cloud Console: OAuth Consent Screen 검수(Verification) 신청을 위한 데모/문서 준비 (체크리스트: `docs/marketplace-readiness.md`)
- [ ] 개인정보처리방침, 서비스 약관 작성 및 Google Workspace Marketplace 등록 (체크리스트: `docs/marketplace-readiness.md`)

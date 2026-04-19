# AutoColor for Calendar - Project TODO

## 1. 기획 및 아키텍처 확정

- [x] PRD 및 시스템 아키텍처(SaaS 확장 모델) 최종 리뷰 (Cloudflare Workers + Supabase 하이브리드 모델로 확정)
- [ ] UI/UX 와이어프레임 작성 (Add-on Card UI, 설정 페이지)
- [ ] 데이터 저장 최소화, PII 마스킹, 권한(Scope) 최소화 등 보안/컴플라이언스 원칙 수립
- [ ] 운영용 도메인 확보 및 Google Search Console 소유권 인증 (Webhook용) — §4 후속 "Prod Watch API 활성화"의 `WEBHOOK_BASE_URL` 설정을 gate함
- [ ] Google Workspace Marketplace 퍼블리싱 정책 및 제약사항, 심사 대비 시나리오 검토

## 2. Google Apps Script (Add-on 클라이언트) 개발

- [x] 기존 `gas/` 코드를 활용하여 Google Workspace Add-on 스캐폴딩
- [x] Add-on UI (CardService) 개발: 사이드바 기본 요약 및 설정 진입부
- [x] Add-on UI 디자인 개선
- [ ] 복잡한 규칙 설정을 위한 별도 Web UI (HTML Service 또는 외부 링크) 개발(Addon UI로 충분히 기능 수행 가능하다고 판단되어, 추후에 필요 시 개발 예정)
- [x] 최초 온보딩, 권한 부족/토큰 만료 시 재연결 UI, 서비스 해지 플로우 구현
- [x] 사용자 OAuth 인증 및 백엔드 API 통신(URL Fetch App) 연동 모듈 작성

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
- [ ] **Prod 환경 활성화** — Supabase prod 프로젝트 생성 + 마이그레이션, GCP prod OAuth Web Client(별도 Consent Screen 또는 production 전환) + prod redirect URI 등록, `gen-secrets.ts`로 prod 3종 키 생성, `sync-secrets.ts prod`로 시크릿 일괄 주입, prod Hyperdrive config 생성 + 바인딩, GAS prod `/exec` URL로 `GAS_REDIRECT_URL` 설정. (§4 Watch API는 verified custom domain이 필요하므로 이 작업과 병행 권장.)
- [x] **GAS UX 개선** — `gas/authCallback.html`에 `history.replaceState`로 `?token=` 쿼리 제거 + 자동 창 닫힘; `gas/authError.html`에 `google.script.url.getLocation` 기반 `?error=<code>`별 한국어 메시지 분기 (state_invalid / consent_denied / provider_error / token_exchange_failed / invalid_grant / server_error) 완료 (`93bcf3d`).
- [x] **`buildHomeCard` 사전 검증** — `buildAddOn` 진입점에 `missingBackendProperties()` gate 추가. `BACKEND_BASE_URL`·`OAUTH_AUTH_URL` 미설정 시 "백엔드 구성 필요" 카드 렌더 (`93bcf3d`).
- [ ] **세션 GC** — Supabase `pg_cron` 활성화 후 주 1회 `DELETE FROM sessions WHERE expires_at < now() - interval '7 days'` 스케줄 (§6 관측성 범위).
- [ ] **`TOKEN_ENCRYPTION_KEY` 배치 로테이션** — `token_version` 컬럼 기반 전 `oauth_tokens` 재암호화 job (§6 관측성 범위, 키 교체 전 선행 필수).

## 4. 핵심 동기화(Sync) 로직 및 Watch API 안정화

- [x] 기존 `gas/sync.js`의 Incremental Sync 로직을 TypeScript Worker로 이식 (멱등성 보장)
- [x] Google Calendar Webhook (Watch API) 엔드포인트 구현 (즉각 2xx 응답 및 Queue/Durable Objects 전송)
- [x] Watch 채널 수명주기 관리 (Cron Triggers를 활용한 갱신 및 만료 처리)
- [x] 비동기 Worker(Cloudflare Queues 등)를 활용한 캘린더별 동시성 제어 및 동기화 처리
- [x] `410 Gone` (Invalid Sync Token) 에러 발생 시 Full Resync 등 복구 전략 구현
- [x] 작업 실패 시 재시도(Exponential Backoff) 및 DLQ(Dead Letter Queue) 처리 전략

### 4 후속 작업 (§4 범위 밖 이월)

- [ ] **Prod Watch API 활성화** — verified custom domain 확보(§1) 후 `WEBHOOK_BASE_URL`을 prod `env.prod.vars`에 설정. 그 전까지 prod `/sync/bootstrap`은 Watch 채널 등록을 skip함.
- [ ] **DLQ 감사 필드 확장** — 현재 `sync_failures`는 job envelope + error_code만 저장. SyncSummary·google error_body 상세 기록은 §6(관측성)에서 처리. (주요 작업: `sync_failures`에 `summary_snapshot jsonb` 컬럼 추가 — consumer는 이미 SyncSummary를 보유하므로 스키마/라이터 확장만 필요)

## 5. 3단계 하이브리드 분류(Classification) 엔진 구현

> 현재 `src/services/classifier.ts`의 `classifyEvent`는 §5.1에서 rule-based first-match 구현으로 교체 완료. sync 파이프라인(`src/services/calendarSync.ts:181`, `:195-196`)은 `loadCategories` + `classifyCtx`로 훅 배선이 끝나 있다. `categories` 테이블은 `keywords text[]`, `embedding vector(1536)`, `priority`, 및 `UNIQUE (user_id, name)` 제약(§5.1 `drizzle/0006`)을 보유.

### 5.1 Rule-based 매칭 (Step 1) ✅

- [x] `POST/GET/PATCH/DELETE /api/categories` CRUD 라우트 (`src/routes/categories.ts`). 테넌트 스코프 compound WHERE + Zod 검증 + 23505 → 409 duplicate_name 맵핑.
- [x] `src/services/classifier.ts` stub을 `priority ASC, created_at ASC` first-match 대소문자 무시 substring 매칭(summary + description)으로 구현.
- [x] GAS `gas/addon.js`의 mock `getMockRules()`를 `/api/categories` 백엔드 호출로 교체 + `actionSyncNow`를 실제 `/sync/run` POST로 연결. 규칙 관리 카드에 부분 일치·수동 색상 보존 안내 위젯 추가.
- [x] Vitest `classifier.test.ts` (11 케이스) + `categoriesRoute.test.ts` (22 케이스 — 인증 게이트, 테넌트 격리, Zod 거절, 409 duplicate, 라운드트립).
- [x] **Acceptance 충족:** 규칙 추가 → 동기화 트리거 → `SyncSummary.updated` 증가 + 이벤트 색 적용; 재실행 시 `skipped_equal`로 멱등성.

### 5.2 Embedding 유사도 매칭 (Step 2)

- [ ] 임베딩 제공자 결정 (OpenAI `text-embedding-3-small` vs Supabase 내장). 비용/latency/Worker egress trade-off 문서화
- [ ] 규칙 생성·수정 시 `categories.embedding` 채우는 서비스 (`src/services/categoryEmbedder.ts` 신규). 동기 API 응답 시점 vs Queue 비동기 중 선택
- [ ] `CREATE INDEX categories_embedding_idx ON categories USING ivfflat (embedding vector_cosine_ops)` 마이그레이션 + threshold 상수 정의
- [ ] `classifyEvent` 체인에 Step 2 삽입: Step 1 miss → 이벤트 텍스트 임베딩 → cosine top-1 ≥ threshold 시 해당 category 반환
- [ ] **Acceptance:** 키워드에 없는 "스탠드업 미팅"이 "주간회의" 임베딩과 유사도 매칭되어 동일 색상 적용

### 5.3 PII 마스킹 (Step 3 전제)

- [ ] `src/services/piiRedactor.ts` — email / URL / 전화번호 / `attendees.email` 제거. `src/CLAUDE.md`의 "calendar event payload 로깅 금지" 계약과 충돌 없는지 검증 (redactor 출력이 로그 경로로 새지 않아야 함)
- [ ] Vitest — ko/en 샘플셋으로 false negative / over-redaction 회귀 테스트
- [ ] **Acceptance:** LLM 입력에 `@`, `http`, 전화번호 패턴이 100% 제거됨

### 5.4 LLM Fallback (Step 3)

- [ ] `OPENAI_API_KEY` secret 주입 (`scripts/sync-secrets.ts` 키 목록 추가, `.dev.vars.example` 업데이트)
- [ ] `src/services/llmClassifier.ts` — 마스킹된 event + 사용자 categories를 프롬프트로 전달, `colorId | null` 반환. timeout / 1회 재시도 / 일일 호출 상한 cost guard 포함
- [ ] `docs/architecture-guidelines.md`의 "Halt on Failure" 규칙 준수: LLM 실패 시 local rule 폴백 금지, `no_match` 카운터 증가로 조용히 종료
- [ ] **Acceptance:** rule/embedding 모두 miss인 이벤트가 LLM으로 적절한 category 배정되거나, LLM 실패 시 no_match로 silent skip

### 5.5 색상 적용 정책 및 멱등성

- [ ] 수동 override 보존 정책 정의 — `event.colorId`가 규칙과 다르게 수동 설정된 경우 덮어쓸지 판단 (metadata flag / `extendedProperties.private` 활용 검토)
- [ ] `calendarSync.ts`의 기존 color-equality 단락(`:118-127` 영역)을 확장해 "auto-applied 색상만 덮어쓰기" 정책 반영. 기존 멱등성 보장 회귀 없는지 검증
- [ ] **Acceptance:** 사용자가 수동 변경한 이벤트는 재분류되지 않음. 앱이 칠한 이벤트만 규칙 변경 시 재적용됨

### 5 후속 작업 (§5 범위 밖 이월)

- [ ] LLM 호출 로그·비용 대시보드 (§6 관측성)
- [ ] 사용자별 rate limit / 일 단위 분류 상한 (§6)
- [ ] **`onEventOpen` 실제 매칭 규칙 표시** — `gas/addon.js:260`의 "매칭된 규칙: '주간회의'"는 현재 하드코딩. 단일 이벤트 classify preview 엔드포인트(예: `POST /api/classify/preview`) 추가 후 실제 매칭 결과 렌더링. §5.2 전후에 분리 처리.
- [ ] **규칙 삭제 후 기존 이벤트 색상 롤백** — 사용자가 규칙을 지우면 이미 칠해진 이벤트는 원상복구 기대. §5.5의 "앱이 칠한 색상만 덮어쓰기" 메타데이터(`extendedProperties.private`)가 선행돼야 안전한 롤백 가능.
- [ ] **짧은 키워드 false-positive 완화** — 2자 이하 한국어 키워드의 과매칭은 §5.2 embedding 단계가 부분적으로 해결. §5.1은 UX 안내 문구로 경고만 처리.
- [ ] **규칙 적용 카운터 노출** — `gas/addon.js:159`의 "이번 주 분류된 일정: 15건"이 mock. 실제 카운터는 §6 관측성에서 `SyncSummary` 집계 소스로 연동.
- [ ] **팀/공유 캘린더 ownership 충돌 정책** — 여러 사용자가 같은 캘린더의 색을 서로 덮어쓰는 문제. §5.5 메타데이터 + 사용자별 ownership 정책 별도 설계 필요.

## 6. 테스트 및 관측성(Observability) 확보

- [ ] `Vitest` 단위 테스트 및 모킹 (OAuth 토큰 갱신 실패, Sync Token 410 에러 등)
- [ ] Webhook 대량 발생 시 Queue 부하 분산, 캘린더 락(Lock) 및 동시성 제어 테스트
- [ ] 실패 재시도 및 DLQ 적재 동작 검증 테스트
- [ ] Rule -> Embedding -> LLM 각 단계별 정확도 추적 및 PII 마스킹 단위 테스트
- [ ] Add-on <-> Worker <-> Supabase 전체 흐름 E2E 테스트
- [ ] **claim/release Postgres round-trip 통합테스트** (§4A 리뷰 Finding #2) — 현재 `syncConsumer.test.ts`의 `syncClaim — precision invariant` 블록은 소스 파일 regex 가드일 뿐 실제 `date_trunc('milliseconds', now())` → JS `Date` → `eq(inProgressAt, claimedAt)` round-trip을 검증하지 않는다. postgres-in-container 또는 Hyperdrive 에뮬레이터 도입 시 실제 round-trip 테스트 추가.
- [ ] **`/sync/run` 레이트리밋 컬럼 분리 검토** (§4A 리뷰 Finding #7) — 현재 `sync_state.updated_at` 기반 30초 coalesce window는 consumer의 claim/release/요약 쓰기까지 전부 밀어 "방금 끝난 직후 변경사항 추가" 재트리거 UX가 429로 막힌다. `last_manual_trigger_at` 컬럼 분리로 consumer 쓰기와 수동 트리거 레이트리밋을 분리 고려.
- [ ] **Watch 채널 DB round-trip 통합테스트** (§4B 리뷰 m4) — `lookupChannelOwner`, `registerWatchChannel`의 UPDATE 테넌트 스코프, `drizzle/0005`의 partial `UNIQUE (watch_channel_id, watch_resource_id)` 충돌 거동을 실제 Postgres에 대해 검증. 현재 mock-only 테스트로는 인덱스/컬럼 레벨 실수를 잡지 못한다. §4A Finding #2 해법과 같은 harness 재사용.
- [ ] **Watch 갱신 동시성 가드 검토** (§4B 리뷰 M4) — Cloudflare cron은 동일 schedule 중복 실행을 하지 않지만, 수동 어드민 재트리거 경로가 생기면 `renewExpiringWatches`가 같은 row set에 대해 overlap할 수 있다. stop→register 구간에서 신규 채널을 죽이는 race가 가능. row-level `in_progress_at` 스탬프 또는 짧은 dedup window 도입 검토.

## 7. 배포 및 출시

- [ ] Cloudflare Workers 배포 및 CI/CD 파이프라인 (GitHub Actions) 구축
- [ ] Supabase 데이터베이스 백업/복구 정책 수립
- [ ] Google Cloud Console: OAuth Consent Screen 검수(Verification) 신청을 위한 데모/문서 준비
- [ ] 개인정보처리방침, 서비스 약관 작성 및 Google Workspace Marketplace 등록

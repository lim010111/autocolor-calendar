# AutoColor for Calendar - Project TODO

## 1. 기획 및 아키텍처 확정

- [x] PRD 및 시스템 아키텍처(SaaS 확장 모델) 최종 리뷰 (Cloudflare Workers + Supabase 하이브리드 모델로 확정)
- [ ] UI/UX 와이어프레임 작성 (Add-on Card UI, 설정 페이지)
- [ ] 데이터 저장 최소화, PII 마스킹, 권한(Scope) 최소화 등 보안/컴플라이언스 원칙 수립
- [ ] 운영용 도메인 확보 및 Google Search Console 소유권 인증 (Webhook용)
- [ ] Google Workspace Marketplace 퍼블리싱 정책 및 제약사항, 심사 대비 시나리오 검토

## 2. Google Apps Script (Add-on 클라이언트) 개발

- [x] 기존 `gas/` 코드를 활용하여 Google Workspace Add-on 스캐폴딩
- [x] Add-on UI (CardService) 개발: 사이드바 기본 요약 및 설정 진입부
- [x] Add-on UI 디자인 개선
- [ ] 복잡한 규칙 설정을 위한 별도 Web UI (HTML Service 또는 외부 링크) 개발(Addon UI로 충분히 기능 수행 가능하다고 판단되어, 추후에 필요 시 개발 예정)
- [ ] 최초 온보딩, 권한 부족/토큰 만료 시 재연결 UI, 서비스 해지 플로우 구현
- [ ] 사용자 OAuth 인증 및 백엔드 API 통신(URL Fetch App) 연동 모듈 작성

## 3. 백엔드 (Cloudflare Workers + Supabase) 인프라 및 기반 구축

- [ ] 기존 Python(FastAPI) 파일(`pyproject.toml`, `main.py` 등) 삭제 및 정리
- [ ] `wrangler`를 활용한 Cloudflare Workers 프로젝트 초기화 및 TypeScript 셋업
- [ ] Supabase 프로젝트 생성 및 Drizzle ORM 연동, 스키마 마이그레이션 도구 설정
- [ ] 사용자, Category, SyncState, OAuthToken 정보 저장을 위한 DB 스키마 작성 (RLS 적용)
- [ ] Google OAuth 2.0 서버사이드 연동 (Refresh token 애플리케이션 암호화 및 격리 저장)
- [ ] Secret 관리(Wrangler secrets) 및 Dev/Prod 환경 분리

## 4. 핵심 동기화(Sync) 로직 및 Watch API 안정화

- [ ] 기존 `gas/sync.js`의 Incremental Sync 로직을 TypeScript Worker로 이식 (멱등성 보장)
- [ ] Google Calendar Webhook (Watch API) 엔드포인트 구현 (즉각 2xx 응답 및 Queue/Durable Objects 전송)
- [ ] Watch 채널 수명주기 관리 (Cron Triggers를 활용한 갱신 및 만료 처리)
- [ ] 비동기 Worker(Cloudflare Queues 등)를 활용한 캘린더별 동시성 제어 및 동기화 처리
- [ ] `410 Gone` (Invalid Sync Token) 에러 발생 시 Full Resync 등 복구 전략 구현
- [ ] 작업 실패 시 재시도(Exponential Backoff) 및 DLQ(Dead Letter Queue) 처리 전략

## 5. 3단계 하이브리드 분류(Classification) 엔진 구현

- [ ] **Step 1 (Rule-based):** Supabase DB에서 사용자 규칙 조회 후 즉시 매칭하는 로직 구현
- [ ] **Step 2 (Embedding):** Rule 실패 시, Supabase Vector를 활용한 임베딩 유사도 기반 매칭 구현
- [ ] 캘린더 이벤트 설명(Description) 내 민감정보(PII: 이메일, URL 등) 마스킹(Redaction) 구현
- [ ] **Step 3 (LLM Fallback):** 마스킹된 데이터를 기반으로 소형 LLM(Gemini API 등) Fallback 추론 클라이언트 연동
- [ ] 색상 적용 정책 구현 (수동 설정 덮어쓰기 방지 여부, 적용 필드 제한 등)

## 6. 테스트 및 관측성(Observability) 확보

- [ ] `Vitest` 단위 테스트 및 모킹 (OAuth 토큰 갱신 실패, Sync Token 410 에러 등)
- [ ] Webhook 대량 발생 시 Queue 부하 분산, 캘린더 락(Lock) 및 동시성 제어 테스트
- [ ] 실패 재시도 및 DLQ 적재 동작 검증 테스트
- [ ] Rule -> Embedding -> LLM 각 단계별 정확도 추적 및 PII 마스킹 단위 테스트
- [ ] Add-on <-> Worker <-> Supabase 전체 흐름 E2E 테스트

## 7. 배포 및 출시

- [ ] Cloudflare Workers 배포 및 CI/CD 파이프라인 (GitHub Actions) 구축
- [ ] Supabase 데이터베이스 백업/복구 정책 수립
- [ ] Google Cloud Console: OAuth Consent Screen 검수(Verification) 신청을 위한 데모/문서 준비
- [ ] 개인정보처리방침, 서비스 약관 작성 및 Google Workspace Marketplace 등록

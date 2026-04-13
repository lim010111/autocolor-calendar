# Web UI for Complex Rules - Implementation Plan (v2)

## 1. 개요 및 기술 스택 (Overview & Tech Stack)
본 문서는 **AutoColor for Calendar (Stage 2)**의 대규모 규칙 관리 및 통계 시각화를 담당하는 외부 웹 대시보드 구축 계획입니다. 기존 Add-on의 좁은 UI를 탈피하여, 쾌적하고 인터랙티브한 SaaS 형태의 사용자 경험을 제공합니다.

- **위치 (Location):** 레포지토리 내 `web/` 디렉토리
- **프레임워크 (Framework):** React 18+ 와 Vite (TypeScript) 기반의 SPA
- **스타일링 및 UI (Styling & UI):** Tailwind CSS + **shadcn/ui** (복잡한 대시보드 컴포넌트의 생산성과 디자인 퀄리티 확보)
- **상태 관리 및 데이터 페칭 (State & API):** React Query
- **아키텍처 패턴:** BFF (Backend for Frontend). 브라우저는 Supabase에 직접 접근하지 않고, 오직 Cloudflare Workers API만 호출합니다.
- **호스팅 (Hosting):** Cloudflare Pages

## 2. 핵심 연동 아키텍처 (Auth & Integration Flow)
보안성 강화 및 URL 토큰 노출 방지를 위해 **1회용 Auth Code와 Server-side Cookie 기반의 인증**을 사용합니다. (Magic Link 대체)

1. **토큰 발급 (Add-on):** 사용자가 Add-on에서 [대시보드 열기] 클릭 시, Add-on이 Worker API를 호출하여 짧은 수명(30~60초)의 **1회용 Auth Code** 발급.
2. **리다이렉트:** 브라우저 새 창을 통해 `https://web.autocolor.com/auth/callback?code=...` 로 이동.
3. **세션 교환 (Server-side):** 콜백 라우트는 브라우저가 아닌 **Worker API**가 가로채어(또는 클라이언트가 즉시 API 호출하여) Code를 검증하고, **HttpOnly Secure SameSite 쿠키**를 응답에 설정.
4. **대시보드 진입:** 인증 쿠키가 설정된 후 `/dashboard` 로 302 리다이렉트. 이후 SPA의 모든 API 호출은 Same-origin 쿠키 기반으로 안전하게 수행됨.

## 3. 핵심 기능 명세 (Key Features)

### A. Analytics Dashboard (`/dashboard`)
비용 절감 및 자동화 성과 시각화 뷰. (UI 구현 전 백엔드의 Event Schema 및 Daily Rollup 집계 파이프라인 설계 선행 필수)
- **주요 지표:** 이달의 자동 분류 일정 수, 처리 시간 절감 효과.
- **비용 절감 차트:** Rule / Embedding 단계 사전 처리로 방어한 LLM 호출 비율 시각화.
- **카테고리 분포도:** 일정 성격(업무, 미팅 등) 파이/바 차트.

### B. Advanced Rule Management (`/rules`)
단계적 도입 전략을 통해 복잡도를 관리하는 캘린더 규칙 데이터 그리드.
- **v1 목표:** 
  - 기본 CRUD, 키워드 검색, 색상별 필터링, 다중 캘린더 선택.
  - 정렬 및 우선순위 변경은 **단순 상하 이동(Up/Down) 버튼** 또는 숫자 입력 기반. (백엔드는 Fractional Indexing / LexoRank 방식 적용 권장)
  - CSV Export (안전한 내보내기 우선 지원).
- **v2 목표 (추후 확장):**
  - 드래그 앤 드롭(DND) 기반 우선순위 변경.
  - CSV Import (업로드 -> 검증 및 미리보기 UI -> 최종 적용 단계 포함하여 부분 실패 및 보안 이슈 방지).

### C. Hybrid Engine Simulator (`/simulator`)
Stage 2의 3단계 분류 엔진 동작을 테스트하는 디버깅 뷰.
- **Dry-run API 기반:** 프론트엔드에서 로직을 재현하지 않고, 백엔드의 `POST /api/simulate` 엔드포인트를 호출하여 실제 엔진과 100% 동일한 실행 Trace 결과를 받아 시각화.
- **보안 제약:** 시뮬레이터 입력값은 저장하지 않으며, PII가 마스킹 처리된 상태로 엔진을 통과하는지 검증. 악용 방지를 위해 Rate Limit 적용 필수.

## 4. UI 컴포넌트 라이브러리 가이드

| UI 요소 | 권장 라이브러리 / 기술 | 비고 |
| :--- | :--- | :--- |
| **기본 컴포넌트** | `shadcn/ui` + `Tailwind CSS` | 일관된 디자인 시스템 신속 구축 |
| **데이터 테이블** | `@tanstack/react-table` | 정렬, 필터, 다중선택 제공 (v1에서는 가상 스크롤 제외하여 안정성 확보) |
| **데이터 시각화** | `Recharts` | React에 최적화된 선언적 차트 |
| **비동기 상태 관리**| `@tanstack/react-query` | Workers API 통신 및 캐싱 처리 |

## 5. 단계별 구현 계획 (Implementation Steps)
1. **Project Init:** `web/` 디렉토리에 Vite 프로젝트 생성 및 Tailwind CSS, shadcn/ui 초기 셋업.
2. **Routing & Layout:** 라우팅 및 사이드바 포함 글로벌 대시보드 레이아웃(Dashboard, Rules, Simulator) 마크업.
3. **Auth & BFF Setup:** `/auth/callback` 흐름 연동 및 Worker API와의 쿠키 기반 통신용 Axios/Fetch 인스턴스 (+ React Query) 설정. (Supabase JS는 브라우저에서 배제)
4. **Feature 1 - Rules Grid (v1):** TanStack Table을 활용한 규칙 테이블 뷰 및 우선순위 수정(Up/Down), CRUD 폼 연동.
5. **Feature 2 - Simulator:** 백엔드 Dry-run API(`POST /api/simulate`)의 응답 Trace를 받아 보여주는 Stepper UI 및 디버깅 뷰 구현.
6. **Feature 3 - Analytics:** 백엔드의 텔레메트리 집계 API가 준비된 후, Recharts를 활용하여 지표 및 차트 구현.
7. **Security & Obs:** PII 마스킹, 에러 트래킹(Sentry 등) 도입 검토 및 통합 테스트(Handoff 흐름) 구성.
8. **Deployment:** GitHub Actions 및 Cloudflare Pages CI/CD 연동.

# Implementation Plan: 사용자 OAuth 인증 및 백엔드 API 통신 연동 모듈 작성

## 1. Background & Motivation
- **Objective:** Stage 2 (SaaS 모델) 확장을 위해 Google Workspace Add-on 클라이언트가 Cloudflare Workers 백엔드와 안전하게 통신할 수 있는 인증 기반(OAuth 2.0 Authorization)과 API 통신 모듈을 구축합니다.
- **Context:** 백엔드는 Background Sync를 수행하기 위해 사용자의 Google Refresh Token이 필요합니다. 따라서 Add-on 내부 권한(Google Apps Script의 기본 토큰)만으로는 불충분하며, 백엔드 주도의 명시적인 OAuth Flow를 거쳐 권한을 위임받아야 합니다.

## 2. Scope & Impact
- **Affected Files:**
  - `gas/auth.js` (New): 사용자의 세션 토큰(API Key)을 저장 및 관리하는 모듈
  - `gas/api.js` (New): `UrlFetchApp`을 활용한 백엔드 통신 유틸리티
  - `gas/addon.js` (Modified): 로그인/로그아웃 UI 및 인증 상태에 따른 화면 분기 처리
  - `gas/triggers.js` (Modified): 백엔드 연동 시 로컬 트리거 비활성화 및 복구 로직 추가
- **Impact:** Stage 1의 로컬 룰 엔진 방식에서, 설정과 로직을 백엔드로 이관하기 위한 필수 통신 계층이 마련됩니다. 기존 로컬 트리거와 백엔드 동기화 간의 충돌(Race Condition)을 방지하는 구조가 포함됩니다.

## 3. Proposed Solution (Backend-Managed OAuth with Standard Add-on Flow)
1. **로그인 시작 (Add-on UI):** 사용자가 Add-on의 "Login" 버튼을 클릭하면 `CardService.newAuthorizationException()` 및 `appsscript.json`의 `authorizationUrl` 설정을 활용하여 표준 Third-party Authorization 플로우 팝업을 엽니다.
2. **백엔드 OAuth Flow:** 백엔드가 Google OAuth 동의 화면으로 리다이렉트하고, Callback을 받아 Refresh Token을 DB(Supabase)에 안전하게 저장합니다.
3. **토큰 발급 및 자동 전달:** 백엔드는 인증 완료 후 콜백 페이지(또는 리다이렉트)를 통해 세션 토큰(API Key)을 발급하고, 팝업이 닫히면서 Add-on으로 콜백이 전달되어 UI가 자동 새로고침됩니다.
4. **Add-on에 토큰 저장 및 트리거 해제:** `gas/auth.js` 모듈은 전달받은 토큰을 `PropertiesService.getUserProperties()`에 암호화/저장합니다. **동시에 Stage 1의 로컬 트리거(Calendar Event, Time-driven)들을 모두 해제**하여 백엔드 Worker와 동일한 이벤트를 중복 처리하지 않도록 방지합니다.
5. **백엔드 API 호출:** 이후 `gas/api.js`의 `fetchBackend()` 함수가 호출될 때마다, 저장된 세션 토큰을 `Authorization: Bearer <token>` 헤더로 실어 `UrlFetchApp`을 통해 백엔드 API와 통신합니다.

## 4. Alternatives Considered
- **수동 토큰 입력 방식 (Copy & Paste):**
  - *기각 사유:* 구현은 가장 단순하나, 사용자가 브라우저에서 토큰을 복사하여 Add-on 설정 창에 붙여넣어야 하므로 UX가 심각하게 저하되며 Google Workspace Marketplace 심사에서 반려될 위험이 큽니다.
- **GAS-Managed OAuth:** `OAuth2 for Apps Script` 라이브러리를 사용.
  - *기각 사유:* 토큰이 클라이언트를 거쳐 전달되므로 보안상 취약할 수 있고, 백엔드 로직이 분산되는 단점이 있어 백엔드 주도 방식으로 결정(사용자 동의 완료).

## 5. Implementation Steps
### Step 1: 인증 모듈 (`gas/auth.js`) 및 트리거 제어 구현
- `saveSessionToken(token)`: `PropertiesService`를 활용해 토큰 저장. 인증 완료 시 `gas/triggers.js`의 **로컬 트리거 비활성화 로직 호출**.
- `getSessionToken()`: 저장된 토큰 조회
- `clearSessionToken()`: 로그아웃 처리 및 토큰 삭제. Stage 1으로 폴백하기 위해 **로컬 트리거 재등록 로직 호출**.
- `isAuthenticated()`: 토큰 존재 여부 확인 로직

### Step 2: API 통신 모듈 (`gas/api.js`) 구현
- `fetchBackend(endpoint, options)`: `UrlFetchApp.fetch`를 래핑한 핵심 함수 구현
- 자동 인증 헤더 삽입 (`Authorization: Bearer ...`)
- **에러 핸들링 (401 Unauthorized):** 401 에러 발생 시 단순 예외 발생에 그치지 않고 **즉시 `clearSessionToken()`을 호출하여 토큰 폐기 및 Add-on UI 상태를 로그인 화면으로 강제 초기화(State Reset)**.
- **재시도 로직(Retry & Exponential Backoff):** 지수 백오프를 적용하되, **GAS 한 번 실행 최대 시간(6분) 및 권장 UI 응답 제한 시간(약 30초 내외)을 초과하여 타임아웃 오류가 나지 않도록 최대 재시도 횟수(예: 3회)와 대기 시간을 보수적으로 제한**.

### Step 3: Add-on UI 반영 (`gas/addon.js`)
- `buildAddOn()`: 진입점(homepageTrigger)에서 `isAuthenticated()`를 체크하여, `false`면 Welcome Card를 반환하고 `true`면 Home Card(대시보드)를 반환하도록 분기를 단순화합니다.
- `buildWelcomeCard()`: 온보딩 화면에서 "시작하기" 버튼 클릭 시 `AuthorizationException`을 발생시켜 백엔드 OAuth 플로우를 시작하도록 변경합니다.
- `buildSettingsCard()`: 기존 설정 화면에 "로그아웃" 버튼을 유지하여, 로그아웃 시 인증 토큰을 삭제하고 UI가 다시 Welcome Card로 돌아갈 수 있도록 합니다.

## 6. Verification
- `gas/auth.js`의 토큰 저장이 정상 수행되며, 인증 성공 시 기존 로컬 `ScriptApp` 트리거들이 확실히 삭제되는지 디버거로 확인.
- `gas/api.js`가 401(Unauthorized) 에러를 받을 경우 토큰이 즉시 삭제되고 UI가 재로그인 화면으로 강제 전환되는지 검증.
- 재시도 로직 동작 시 GAS 실행 제한 시간 및 UI 타임아웃 오류가 발생하지 않는지 E2E 테스트.
- Add-on UI에서 로그인(AuthorizationException 플로우) 및 로그아웃(트리거 복구) 상태 전환이 매끄럽게 이루어지는지 수동 테스트.

## 7. Migration & Rollback
- **단일 진실의 원천(Single Source of Truth):** 백엔드 연동된 사용자의 경우 백엔드(Supabase)를 유일한 기준으로 삼습니다.
- **폴백(Fallback) 전략 수정:** API 모듈 통신 실패나 서버 장애 시, **로컬에 저장된 룰(Stage 1)로 조용히 폴백하여 이중으로 색상을 업데이트하는 방식을 폐기**합니다. 이중화는 데이터 정합성을 해치고 Race Condition을 유발할 수 있습니다. 장애 시 처리 중단(Skip) 및 사용자에게 일시적 장애 알림 표시만 수행합니다.
- 명시적 로그아웃 시에만 토큰을 폐기하고 로컬 모드(트리거 재활성화)로 롤백합니다.

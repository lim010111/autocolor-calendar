# ⏭️ 다음 작업 (Next up)

> 이 파일은 `/next-todo` 스킬이 관리합니다. 한 번에 한 개의 "다음 실행할 작업"만 유지하고, 완료 직후 문서 갱신과 함께 다음 작업으로 rotate됩니다. 홈 섹션(§1~§7)의 체크박스 상태는 계속 `TODO.md`가 정본입니다.

- **§1 Google Workspace Marketplace 퍼블리싱 정책 및 심사 대비 체크리스트**
  - **문제**: §7 "Google Cloud Console: OAuth Consent Screen 검수" 와 §1 Marketplace 등록은 런치 크리티컬 패스이지만, 현재 레포에는 Marketplace listing 요건(브랜딩 자료·개인정보처리방침·데이터 보관/삭제 정책·OAuth verification 비디오·리뷰어 데모 시나리오 등)을 한곳에 모아둔 레퍼런스 문서가 없다. `docs/security-principles.md`가 보안 원칙을 인덱싱하듯, Marketplace 심사 대비 자료도 단일 체크리스트 파일이 필요하다. 런치 직전에 요건이 한꺼번에 터지면 개발 시간이 블로킹된다.
  - **해결**: `docs/marketplace-readiness.md` 신규 작성. Google Workspace Marketplace 심사 공식 요건 + OAuth Verification (민감한 스코프 3종 사용 중 — `calendar.readonly` 대신 `calendar.events`를 쓰는 것으로 보이므로 sensitive scope에 해당할 가능성 ↑)에 필요한 제출 자료를 anchored reference 형태로 카테고리화 — 각 항목의 source-of-truth(예: 개인정보처리방침 본문은 추후 작성, 여기서는 pointer만)와 현재 상태(미작성/초안/완료)를 테이블로. `docs/security-principles.md` 포맷을 템플릿으로 차용해 본문 중복 없이 포인팅.
  - **주요 변경**: (1) `docs/marketplace-readiness.md` 신규 — 최소 5개 섹션: Marketplace Listing 요건(아이콘/스크린샷/카테고리/지원 URL), OAuth Consent Screen 검수(앱 홈페이지/개인정보처리방침/약관/범위/정당화 영상), 데이터 처리 계약(Workspace Admin 관점 — 데이터 위치/암호화/보관/삭제/서브프로세서), 심사 리뷰어 데모 시나리오(테스트 계정·스크립트·샘플 캘린더), 런치 전 Gate 체크리스트(상태 추적 테이블). (2) `docs/project-overview.md`에 Marketplace 체크리스트로의 cross-ref 한 줄 추가. (3) `TODO.md` §1 해당 체크박스 flip + §7 "OAuth Consent Screen 검수" 체크박스에 "(체크리스트: `docs/marketplace-readiness.md`)" 포인터 추가.
  - **문서**: `docs/marketplace-readiness.md` 신규 인덱스. `docs/project-overview.md` cross-ref. `TODO.md` §1/§7 업데이트. 소스 코드 변경 없음.
  - **의존성**: 없음. 외부 확정 필요(개인정보처리방침 URL 최종 확정, 프라이버시 정책 본문, 지원 이메일 등)는 `docs/marketplace-readiness.md`의 "미완료" 상태로 남기고 런치 전 별도 작업으로 분리.
  - **사이즈**: M — 단일 문서 + cross-ref 2개. 리서치(Marketplace 심사 요구 사항 공식 페이지 WebFetch)가 구현 양보다 비중 큼.

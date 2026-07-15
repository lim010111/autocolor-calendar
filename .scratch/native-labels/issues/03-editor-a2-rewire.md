Status: ready-for-agent

## What to build

GAS 규칙 편집기를 A2 모델로 재배선한다: 목록 = Google 라벨(정본) + 우리
분류 설정, 생성 = 기존 플로우가 라벨 생성을 겸임, 관리(개명·색·삭제) =
Google UI 로 안내 (ADR-0006 Decision 2·3 의 UI 절반).

설계 노트 (구현 세션 재량):

- **목록**: 백엔드가 캐시한 라벨+Rule 병합 뷰. 이름 있는 라벨은 전부 Rule
  행(자동 생성분 포함 — #02), "라벨 삭제됨" 상태는 배지. unnamed 슬롯은
  행으로 안 만들고, 홈 카드에 "Google 에서 색에 이름을 붙이면 규칙이
  됩니다" 힌트 1줄 (4로케일).
- **생성 플로우**(기존 화면 유지): 이름 + 색 스와치 + 키워드 → 백엔드
  `appendEventLabel`(#02) + Rule 생성. 색 스와치는 24 기본 hex —
  `scripts/gen-swatch-assets.py` 로 data URI 재생성 (기존 11-swatch
  파이프라인 재사용). 실측 hex 목록은 PRD/probe 산출 참조.
- **이름·색 읽기 전용**: 기존 Rule 편집 화면에서 이름·색 입력 제거,
  "이름·색 변경은 Google Calendar 에서" 안내 문구 (4로케일; 라벨 관리
  다이얼로그 딥링크는 존재하지 않으므로 텍스트 안내만).
- **폐기**: `gas/i18n.js` COLOR_PALETTE 11종 + `colors.*` 4로케일 색
  이름 (라벨엔 색 이름이 없다). 이벤트 사이드바의 색 선택도 라벨 칩
  목록으로 전환.
- **배포**: 기존 deployment 에 새 버전 (URL 동결 준수, v55 전례).
  스코프·consent 무변경 — OAuth 게이트 아님.

## Acceptance criteria

- [ ] 편집기 목록이 라벨 정본 기준으로 렌더 (named=Rule 행, 삭제됨 배지,
      unnamed 힌트)
- [ ] 생성 플로우가 라벨+Rule 을 한 걸음에 만들고, 만든 라벨이 Google
      색 선택 창에 칩으로 보인다 (라이브 육안 확인)
- [ ] 이름·색 읽기 전용 + Google 안내 문구 4로케일
- [ ] 24 hex 스와치 data URI 생성·렌더 (외부 이미지 호스트 없음 —
      card-latency #03 계약 유지)
- [ ] 구 11-팔레트·색 이름 i18n 잔재 제거 (gas/ 내 참조 0)
- [ ] 4로케일 스크린샷 각 1장 첨부 (사람 단계)

## Blocked by

- native-labels #02 (`appendEventLabel`, 라벨 캐시/자동 Rule)

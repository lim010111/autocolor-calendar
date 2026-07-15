# ADR-0006: 분류 출력 공간을 Google 네이티브 이벤트 라벨로 전환 — Google 정본, 깨끗한 컷오버

- Status: Accepted (2026-07-15)
- Context: Google Calendar 가 2026-06-17 "Custom event colors" 로 이벤트 색
  체계를 라벨 기반으로 재편했고(기본 24색 + 캘린더당 최대 200개 커스텀,
  전 계정 유형 기본 ON), 2026-07-07 Calendar API 가 라벨을 GA 했다
  (`Calendars.labelProperties.eventLabels[]`, `Event.eventLabelId`, 쓰기
  파라미터 `eventLabelVersion=1` — 지정 시 legacy `colorId` 무시). Google
  공식 문서가 `colorId` 를 "legacy index-based" 로 규정하고 라벨이 이를
  "supersedes" 한다고 명시한다.

  **운영자 계정 raw API 실측(2026-07-15, 정본:
  `.scratch/native-labels/PRD.md`)으로 확정된 시스템 모델:**
  1. 읽기(events.get/list)는 옵트인 없이 `eventLabelId` 를 반환한다.
  2. "기본 24색"의 정체는 캘린더마다 시스템이 미리 심어둔 **이름 없는 라벨
     슬롯**이다 — UI 의 색 선택은 곧 라벨 할당이다.
  3. legacy `colorId` 쓰기는 Google 이 내부에서 대응 라벨 할당으로 번역해
     저장한다(양방향 브리지). 클래식 11색과 일치하지 않는 라벨은 v0 읽기에서
     `colorId` 가 **빈 값**이 된다.
  4. 결과: 현행 파이프라인(§5.4, `event.colorId` 만 읽음)은 비클래식 색/라벨
     이벤트를 "색 없음"으로 오판해 **사용자의 색 선택을 덮어쓴다** — 실측으로
     재현됨. colorId 유지는 중립적 현상 유지가 아니라 열린 결함이다.

  우리 분류기는 색-무관(카테고리 *이름* 출력)이고, Rule 의 이름+색 구조는
  라벨의 `name`+`backgroundColor` 와 1:1 이다. 라벨 조작(정의는
  `calendars.update`, 할당은 events 쓰기)은 이미 보유한
  `auth/calendar`(Restricted) + `calendar.events` 스코프 안이므로 **OAuth
  검수 동결(스코프/consent 불변)에 저촉되지 않는다.** Google 은 분류 체계
  (taxonomy)만 만들었고 자동 분류(automation)는 비어 있다 — 우리 가치는
  라벨 등장으로 침식된 게 아니라 표면을 얻었다.

- Decision:
  1. **분류 출력 = 네이티브 라벨.** 색 적용은 `eventLabelVersion=1` +
     `eventLabelId` 쓰기로 전환하고, 소유권 마커를 v2 로 승격한다
     (`autocolor_v=2`, `autocolor_label`=labelId 저장·비교).
  2. **정본은 Google (A2).** 라벨의 존재·이름·색은 `labelProperties` 가
     정본이고 우리 `categories` 는 라벨에 부착된 분류 설정(키워드·씨앗·
     우선순위)으로 격하된다(이름·색은 읽기 전용 캐시). 이름 붙은 라벨은
     출처(Google UI / 애드온) 불문 동일 취급 — 발견 즉시 이름 강도의 Rule 이
     된다. 이름 없는 라벨은 분류 대상이 아니다.
  3. **생성은 쌍방향, 권한은 비대칭.** 애드온의 기존 규칙 생성 플로우가
     라벨 생성을 겸한다(append-only read-modify-write). 개명·색 변경·삭제는
     Google UI 로 안내하고 우리는 sync 시 `calendars.get` 대조로 따라간다 —
     삭제된 라벨의 Rule 은 비활성화하고 **절대 부활시키지 않는다**(사용자
     편집이 항상 이긴다).
  4. **이행은 깨끗한 컷오버.** 기존 카테고리마다 대응 라벨을 1회 생성하고
     이후 전 쓰기를 라벨로 통일한다. 이중 모드(colorId 병행) 없음.

- Alternatives considered:
  - **A1 — 우리 카테고리 정본, 라벨은 투영**: 매핑 테이블 + 드리프트 조정 +
    full-replace 쓰기 상시 위험. "사용자 편집 승리" 원칙과 결합하면 결국
    A2 동작으로 수렴하므로 잔여 이점이 캘린더 간 카테고리 동일성뿐인데,
    현행 sync 는 primary 단일 캘린더라 이점이 휴면 상태. 기각.
  - **이중 모드(기존 규칙 colorId 유지)**: §5.4 마커·스킵·롤백이 영구 두 벌.
    실측 3(브리지)이 보여주듯 colorId 경로는 이미 라벨 세계의 우회로에
    불과하다. 기각.
  - **현상 유지 + 방어만**: 위 Context 4 의 결함은 막아도, `colorId` 의
    legacy 궤도와 "이름 있는 200 슬롯" 통합 기회(분류 결과가 Google UI·Time
    Insights 에 이름으로 노출)를 버린다. 경쟁 재료(라벨 + Calendar MCP +
    Gemini)가 모인 시점의 관망 리스크가 더 크다. 기각.

- Consequences:
  - 의무: sync 런당 `labelProperties` 읽기 +1 fetch(Workers 서브리퀘스트
    예산 계상), 개명 시 이름 캐시 갱신 + name 씨앗 재임베딩, 라벨 정의
    쓰기는 append-only + 쓰기 직전 재읽기(**남의 항목을 절대 줄이지 않는다**
    — full-replace 시맨틱 하의 §5.4 급 불변식).
  - 스키마: `categories.labelId` 추가, colorId `'1'..'11'` CHECK·Zod 제거.
    GAS 편집기의 11-스와치 팔레트/4로케일 색 이름 폐기(24 기본 hex 스와치로
    대체).
  - 잔여 리스크(수용): ① "라벨 없이 적용된 커스텀 색"(API 에 어떤 필드로도
    안 보임)은 최초 실측에서 1회 관찰됐으나 재현 불가 — 실존 미확정(유력
    해석은 미적용 사용자 동선, PRD 실측 6). 실존하더라도 원리적 보호 불가·
    저빈도로 수용. ② 마커 v1 과거 이벤트의 best-match colorId 충돌 오판
    가능성은 컷오버 재동기화가 v2 로 재각인하며 해소.
  - 컷오버의 full resync fan-out 은 Workers Free 50-fetch 캡과 충돌 —
    sync-reliability #01/#02 선행 필요(트랙 간 의존, PRD 참조).
  - 이슈 분해: `.scratch/native-labels/issues/01~04`.

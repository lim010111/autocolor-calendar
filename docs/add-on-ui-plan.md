# 📱 AutoColor Add-on 화면 정의서 (디자인 Master 피드백 반영본)

Google Calendar Add-on UI/UX 가이드라인(`google-calendar-addon-ui-ux` 스킬) 및 디자인 Master Agent의 피드백을 반영하여 시각적 직관성과 사용자 경험을 극대화한 UI 고도화 계획입니다.

## 핵심 개선 방향 (UI/UX 가이드라인 및 피드백 반영)
1. **시각화 극대화 (Grid 위젯 도입):** 규칙 추가/수정 시 텍스트 드롭다운 대신, `Grid` 위젯을 활용하여 실제 색상 팔레트(원형 색상 아이콘 등)를 가로로 배열해 직관적인 색상 선택 경험을 제공합니다.
2. **비동기 Toast 피드백 (끊김 없는 UX):** 액션(규칙 저장, 동기화, 오버라이드 등) 수행 후 화면 전체 새로고침을 지양하고, `CardService.newNotification()`을 활용한 가벼운 하단 Toast 팝업으로 피드백을 제공합니다.
3. **Empty & Error State 명확화:** 데이터가 없는 경우(규칙 없음) 뿐만 아니라, LLM 서버 무응답, 동기화 실패 등 에러 상황에 대한 명확한 안내 및 재시도 액션 UI를 추가합니다.
4. **Contextual Awareness 강화:** `eventOpenTrigger`를 통해 캘린더 일정 클릭 시 해당 일정의 분류 상태를 즉시 노출합니다.

---

## Screen 1: Welcome Card (온보딩 및 권한 부여)
*초기 진입 시 권한이 없거나 온보딩(백엔드 연동)이 안 된 상태*

- **[Header]**
  - 이미지: 서비스 로고 배너
  - 타이틀: "AI가 캘린더를 예쁘게 정리해 드립니다."
- **[Section 1: 기능 안내]**
  - `DecoratedText`: "✨ 캘린더 자동 색상 분류"
  - `DecoratedText`: "🔒 안전한 개인정보 보호"
- **[Section 2: 약관 동의]**
  - `DecoratedText`: 개인정보처리방침 및 서비스 약관 링크 안내
- **[FixedFooter]**
  - Primary Button: "Google 계정으로 시작하기" -> *[Action] 클릭 시 백엔드 연동을 위한 OAuth 팝업(AuthorizationException) 실행*

---

## Screen 2: Home Card (메인 대시보드 - homepageTrigger)
*일정을 선택하지 않고 사이드바를 열었을 때의 기본 화면. 백엔드 연동이 완료된 사용자만 접근 가능*

- **[Header]**
  - 타이틀: "AutoColor 대시보드"
- **[Section 1: 상태 요약]**
  - `DecoratedText` (Switch 포함): "자동 분류 활성화" 🟢
  - `DecoratedText` (Icon 포함): "이번 주 분류된 일정: 15건"
  - `DecoratedText` (Icon 포함): "최근 동기화: 10분 전"
- **[Section 2: 빠른 액션]**
  - ButtonSet: 
    - "매핑 규칙 관리" (Secondary, Screen 4로 이동)
    - "상세 설정" (Secondary, Screen 5로 이동)
- **[FixedFooter]**
  - Primary Button: "지금 즉시 동기화" -> *[Action] 완료 시 Toast: "동기화가 완료되었습니다."*

---

## Screen 3: Event Insight Card (일정 상세 - eventOpenTrigger)
*특정 캘린더 일정을 클릭했을 때 컨텍스트에 맞게 표시되는 화면*

- **[Header]**
  - 타이틀: "일정 색상 분석"
  - 서브타이틀: 선택한 일정의 제목 표시
- **[Section 1: 현재 상태]**
  - `DecoratedText`: "적용된 색상: 🔵 파란색" (색상이 없는 경우 Empty State 텍스트 표시)
  - `DecoratedText`: "매칭된 규칙: '주간회의'" (Rule 기반인지 LLM 기반인지 출처 표기)
- **[Section 2: 수동 오버라이드 및 상태 변경]**
  - `Grid` 위젯 (가로 배열): 이 일정에 적용할 색상을 시각적 팔레트에서 직접 선택 (피드백 반영)
  - `TextButton`: "이 일정은 자동 분류에서 제외" (토글)
- **[Section 3: Error State (조건부 노출)]**
  - LLM 서버 무응답 또는 분류 실패 시 노출되는 영역
  - `DecoratedText`: "⚠️ AI 서버 응답이 지연되고 있습니다."
  - `TextButton`: "다시 시도"
- **[FixedFooter]**
  - Primary Button: "변경사항 저장" -> *[Action] 완료 시 Toast: "일정 색상이 업데이트되었습니다."*

---

## Screen 4: Rule Management Card (규칙 관리)
*간단한 규칙을 조회하고 추가/삭제하는 화면*

- **[Navigation]** ← 뒤로 가기
- **[Section 1: 새 규칙 추가 폼]**
  - `TextInput`: 키워드 (예: 주간회의)
  - `Grid` 위젯: 캘린더 색상 선택용 시각적 팔레트 (원형 색상 아이콘 나열)
  - `TextButton` (Primary 형태): "규칙 추가" -> *[Action] 완료 시 Toast: "새 규칙이 저장되었습니다." (화면 깜빡임 없이 리스트만 갱신)*
- **[Section 2: 내 규칙 목록]**
  - **Empty State:** "아직 등록된 규칙이 없습니다. 위에서 첫 규칙을 만들어보세요."
  - `DecoratedText` 리스트 (반복):
    - Top Label: 🔵 파란색
    - Text: 키워드 내용
    - Button: "삭제 🗑️" 아이콘 버튼 -> *[Action] 완료 시 Toast: "규칙이 삭제되었습니다."*
  - 하단 안내: "💡 복잡한 규칙은 [웹 대시보드]에서 관리하세요."

---

## Screen 5: Settings Card (상세 설정)

- **[Navigation]** ← 뒤로 가기
- **[Section 1: 정책 설정]**
  - `SelectionInput` (Checkbox): 
    - ☑️ 수동 색상 덮어쓰기 방지
    - ☑️ AI(LLM) 자동 추론 사용
    - ☐ 설명(Description) 필드도 분석에 포함
- **[Section 2: 계정 관리]**
  - `DecoratedText`: 현재 로그인된 계정 이메일
  - `TextButton` (Red): 로그아웃

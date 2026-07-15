# AutoColor for Calendar — Context

Google Calendar 이벤트에 색을 자동 배정하는 Workspace Marketplace 애드온의
도메인 용어 사전. 구현 세부가 아닌 *언어*만 기록한다.

## Language

**Rule**:
사용자가 정의한 색상 분류 규칙 하나 — 이름·색상·키워드 묶음. 한 사용자는
여러 Rule을 가진다.
결정(2026-07-15, native-labels grilling): Rule은 **Label에 부착된 분류
설정**으로 재정의된다 — 이름·색은 Label(정본 Google)을 따라 읽기 전용이
되고, 키워드·예시·우선순위만 Rule 고유 소유로 남는다. 어디서 만들어졌든
(Google UI / 애드온) 동일하게 취급한다.
_Avoid_: Category (DB 테이블명일 뿐 — 아래 Flagged ambiguities 참고)

**Label**:
Google Calendar 네이티브 라벨 — 배경색(필수)과 이름(선택)의 쌍. 캘린더
단위로 존재하고(같은 이름이라도 캘린더가 다르면 다른 Label), 존재·이름·색의
정본은 항상 Google이다. 이름이 붙은 Label만 분류 대상이 될 수 있다.
_Avoid_: "우리 라벨"/"애드온 라벨" (우리가 소유하는 라벨 개념은 없다 —
우리가 소유하는 건 Rule뿐)

**Keyword**:
사용자가 Rule을 만들 때 직접 입력하는, 그 Rule을 설명하는 의도 문구.
임베딩되어 Rule의 의미 표현(벡터)에 합류한다 — 문자열 매칭에는 쓰이지 않는다.

**Example**:
사용자가 Instant Feedback으로 "이 일정은 이 Rule이었다"라고 확정한 과거
일정 제목 하나. Keyword와 마찬가지로 Rule의 의미 표현에 합류하며, 실제
과거 제목이라는 점에서 제목 완전일치 shortcut에도 쓰일 수 있다.
_Avoid_: Sample, Exemplar (한국어 UI 라벨은 별도 결정)

**Classifier**:
이벤트 하나에 색을 배정하는 2단계 파이프라인 — Stage 1 임베딩 유사도 매칭
(이벤트 제목 임베딩 vs Rule의 의미 표현) → 임계값 미달/모호 시 Stage 2 LLM.

**Instant Feedback**:
분류가 사용자 의도와 어긋났을 때, 사이드바 "Event color analysis" 화면에서
사용자가 올바른 Rule을 지목하는 정정 행위. 그 일정 제목이 해당 Rule의
Example로 추가된다.

## Relationships

- 한 **사용자**는 0개 이상의 **Rule**을 가진다
- 한 **Rule**은 정확히 하나의 **Label**에 부착되고(이름·색은 Label의 것),
  0개 이상의 **Keyword**, 0개 이상의 **Example**을 가진다
- **Classifier**는 이벤트에 매칭되는 **Rule**을 찾아 그 **Label**을 적용한다
- **Instant Feedback**은 한 건의 정정을 한 **Example**로 착지시킨다
- 한 일정 제목은 최대 한 **Rule**의 **Example**이 된다 (Rule 간 중복 불가)

## Flagged ambiguities

- "rule" — DB 테이블/타입은 `categories`/`Category`, 사용자 대면 UI(i18n)는
  "rule"/"규칙"으로 이미 갈라져 있다. **확정: 도메인 용어는 `Rule` 하나.**
  `Category`는 DB 레거시 명칭으로만 잔존 — 신규 코드/문서는 `Rule` 사용.
- "Keyword" vs "Example" — Stage 1을 임베딩으로 교체하기로 한 결정 이후
  둘의 차이는 거의 녹았다. 둘 다 Rule 의미 표현의 *씨앗 텍스트*다. 잔여
  차이: Example만 실제 과거 제목이라 완전일치 shortcut 대상이 된다.
- "라벨링" — 종전에 우리 분류 행위를 느슨하게 "라벨링"이라 부르던 관행
  폐기. **Label은 Google 네이티브 객체만 지칭**하고, 우리 행위는 "분류
  (classification)"와 "색/라벨 적용(apply)"으로 부른다. (2026-07-15,
  Google Calendar 네이티브 라벨 출시에 따른 재정의 — Rule 항목 참고.)

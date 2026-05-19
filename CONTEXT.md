# AutoColor for Calendar — Context

Google Calendar 이벤트에 색을 자동 배정하는 Workspace Marketplace 애드온의
도메인 용어 사전. 구현 세부가 아닌 *언어*만 기록한다.

## Language

**Rule**:
사용자가 정의한 색상 분류 규칙 하나 — 이름·색상·키워드 묶음. 한 사용자는
여러 Rule을 가진다.
_Avoid_: Category (DB 테이블명일 뿐 — 아래 Flagged ambiguities 참고)

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
- 한 **Rule**은 1개의 색상, 0개 이상의 **Keyword**, 0개 이상의 **Example**을 가진다
- **Classifier**는 이벤트에 매칭되는 **Rule**을 찾아 그 색을 적용한다
- **Instant Feedback**은 한 건의 정정을 한 **Example**로 착지시킨다
- 한 일정 제목은 최대 한 **Rule**의 **Example**이 된다 (Rule 간 중복 불가)

## Flagged ambiguities

- "rule" — DB 테이블/타입은 `categories`/`Category`, 사용자 대면 UI(i18n)는
  "rule"/"규칙"으로 이미 갈라져 있다. **확정: 도메인 용어는 `Rule` 하나.**
  `Category`는 DB 레거시 명칭으로만 잔존 — 신규 코드/문서는 `Rule` 사용.
- "Keyword" vs "Example" — Stage 1을 임베딩으로 교체하기로 한 결정 이후
  둘의 차이는 거의 녹았다. 둘 다 Rule 의미 표현의 *씨앗 텍스트*다. 잔여
  차이: Example만 실제 과거 제목이라 완전일치 shortcut 대상이 된다.

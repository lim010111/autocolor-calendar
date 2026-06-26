Status: ready-for-agent
GitHub: #116

## What to build

GAS CardService Rule 편집기를 임베딩 체제에 맞게 재설계한다. 메시지가 뒤집힌
다: substring 시절의 "키워드를 신중히 공학하라" → 임베딩 시절의 "대충 적어도
된다, Instant Feedback 이 가르친다" (idea 1 — 독립 기능이 아니라 편집기에
들어가는 마이크로카피 한두 줄).

end-to-end 범위 (`gas/` CardService UI 한정):

- 키워드 입력 필드의 마이크로카피를 "씨앗" 멘탈 모델로 교체 — 키워드는 의도
  문구이고 문자열 매칭에 쓰이지 않음을 사용자에게 전달.
- name 과 keyword 의 역할 분리를 UI 에서 명확히 — name 은 1개·필수·UI 라벨,
  keyword 는 0~N개·선택.
- `CardService.setCollapsible(true)` 로 Rule 아래 키워드/examples 묶음을 접어
  좁은 카드 UI 클러터를 해소.

GAS 코드 푸시는 OAuth 검수 동결 대상이 아니다 (동결은 oauthScopes/consent/
redirect/GAS deploy URL 한정 — 마이크로카피는 그 어느 것도 건드리지 않는다).
배포는 기존 `/exec` deployment 의 새 버전으로만 — 새 deployment 금지.

## Acceptance criteria

- [ ] 키워드 입력 필드 카피가 "씨앗/의도 문구" 모델로 교체되고, 부분문자열
      공학을 요구하던 문구가 제거된다
- [ ] name / keyword 의 역할 차이가 편집기 UI 에서 구분되어 보인다
- [ ] 키워드/examples 가 `setCollapsible` 로 접힌다
- [ ] i18n 4개 언어(en/ko/zh-CN/zh-TW) 카피가 갱신된다
- [ ] 기존 `/exec` deployment URL 이 그대로 유지된다 (새 deployment 미생성)

## Blocked by

- #03

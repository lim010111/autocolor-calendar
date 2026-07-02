Status: ready-for-human
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
- `CardService.setCollapsible(true)` 로 Rule 아래 키워드 묶음을 접어 좁은 카드
  UI 클러터를 해소. (examples 묶음 접기는 #05 소관 — examples UI 가 거기서 처음
  렌더된다. 이 이슈는 편집기에 아직 없는 examples 를 다루지 않는다.)

GAS 코드 푸시는 OAuth 검수 동결 대상이 아니다 (동결은 oauthScopes/consent/
redirect/GAS deploy URL 한정 — 마이크로카피는 그 어느 것도 건드리지 않는다).
배포는 기존 `/exec` deployment 의 새 버전으로만 — 새 deployment 금지.

## Acceptance criteria

- [x] 키워드 입력 필드 카피가 "씨앗/의도 문구" 멘탈 모델로 교체된다 —
      "임베딩되어 Rule 의미에 합류, 문자열 매칭 아님"(CONTEXT.md Keyword 정의)을
      1~2줄 마이크로카피로 전달하고, substring 공학을 요구하던 기존 카피는
      **전량 제거**한다(옛 카피 i18n 키 잔존 0 을 grep 으로 확인)
- [x] name / keyword 의 역할이 편집기에서 **시각적으로 분리**된다 — name 은
      단일·필수 입력(명시 라벨), keyword 는 0..N·선택 입력(별도 섹션 + "선택"
      헬퍼텍스트). "1개 필수 vs 0~N 선택"이 UI 에서 읽힌다
- [x] keyword 묶음이 `CardService.setCollapsible(true)` 로 접힌다. **examples
      묶음은 범위 밖** — examples UI 는 #05 에서 처음 렌더되며(OAuth 게이트) 그때
      동일 collapse 패턴을 적용한다
- [x] 신규/변경 i18n 키가 4개 로케일(en/ko/zh-CN/zh-TW)에 모두 채워진다. 이
      이슈는 *편집기 입력 필드* 카피만 손대고 **#03 의 사이드바 매치라인 키
      (`match.byRule.withSeed`)와 겹치지 않는다** — 사이드바 매치 표시는 #03 소관
- [ ] GAS UI 는 vitest 하네스 범위 밖이므로 검증은 **코드 존재 + PR 스크린샷**
      (4 로케일 편집기 각 1장)으로 한다
- [ ] 배포는 기존 `/exec` deployment 의 **새 버전**으로만 — 새 deployment 미생성
      (AGENTS.md "GAS deployment URL must stay stable")

## Blocked by

- #03

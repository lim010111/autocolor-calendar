Status: ready-for-agent
GitHub: #133

## What to build

컬러 스와치 그리드의 **외부 이미지 의존과 선택-전환 캐시 미스를 제거**해
렌더 지연을 줄인다. 현재 팔레트는 11개 색을 외부 `placehold.co` PNG로 참조하고,
선택된 스와치는 서로 다른 URL(비선택 `url` ↔ 선택 `selectedUrl`)로 전환되어 색을
고를 때마다 그 스와치가 캐시 미스로 새 외부 이미지를 받아온다. 백엔드와 무관한
순수 렌더 비용이며 #01·#02와 독립적이다.

동작 목표: 11색 스와치를 외부 호스트 왕복 없이 렌더한다. 방식은 구현 세션이
선택 — (a) 안정적인 자체 호스팅 asset/스프라이트, 또는 (b) CardService 기본 색
어포던스. 어느 쪽이든 선택 상태 전환이 신규 외부 fetch/캐시 미스를 유발하지
않아야 한다(예: 선택·비선택 두 상태를 미리 워밍).

팔레트는 규칙 편집기(`buildRuleManagementCard`)와 이벤트 사이드바 색 선택
(`actionSelectColor`)이 공유하므로, 변경은 두 표면 모두에 반영된다.

## Acceptance criteria

- [ ] 11색 스와치가 외부 `placehold.co` 왕복 없이 렌더된다
- [ ] 선택 상태 전환이 신규 외부 fetch / 캐시 미스를 유발하지 않는다
- [ ] 11색의 id·라벨·색상값이 기존과 동일 (Google Calendar colorId 매핑 불변)
- [ ] en/ko/zh-CN/zh-TW 4 로케일 라벨 무변경
- [ ] 규칙 편집기와 이벤트 사이드바 양쪽 색 선택 표면에 동일 팔레트 반영
- [ ] 기존 deployment "New version"으로 배포 — `/exec` URL·scopes 불변
- [ ] `python3 scripts/check-context-paths.py` 통과

## Blocked by

None — can start immediately.

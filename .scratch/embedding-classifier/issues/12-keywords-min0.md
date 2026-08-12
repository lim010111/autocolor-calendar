Status: ready-for-agent
GitHub: #179

## What to build

ADR-0008 파생 (open decision "#04 keyword optional ↔ keywords.min(1)"
해소): Worker Zod `keywords.min(1)` → `min(0)` 완화 + GAS `[name]` 폴백
제거. 측정 근거 (wave-4 실측): `keywords: []` 가 `[name]` 폴백보다 소폭
우세(+0.2283 vs +0.2133, desc 유무 양쪽 동일 방향) — 이름을 키워드로
위장하는 폴백은 무익하며, `rule_seeds` 에 name 과 동일 텍스트의 keyword
행을 중복 생성하고 프롬프트에 거짓 신호를 싣는다.

설계 노트:

- **배포 순서가 본체**: 새 GAS(폴백 제거)가 구 Worker(min(1))에 `[]` 를
  보내면 400 — **Worker Zod 완화를 먼저 배포**하고 GAS 폴백 제거를
  뒤에 배포한다. 구 GAS + 새 Worker 조합(`[name]` 전송)은 무해.
- keyword↔description 병합은 **비채택 확정**(wave-4: 병합 단일 필드가
  양립 대비 단발 −0.015/2표 −0.019 일관 열세) — 이 이슈는 완화만,
  병합 금지.
- `reconcileKeywordSeeds` 는 `keywords=[]` 를 이미 처리(전량 삭제
  시멘틱) — 백엔드 변경은 Zod 한 줄 + 테스트.
- GAS 배포는 기존 deployment 새 버전(URL 동결).

## Acceptance criteria

- [ ] Worker: `keywords.min(0)` + 빈 배열 왕복 테스트 (seeds 정리 포함)
- [ ] GAS: `[name]` 폴백 제거 (Worker 배포 확인 후)
- [ ] 배포 순서 기록: Worker 먼저 → GAS 뒤 (역순 400 방지)
- [ ] 기존 `keywords=[name]` 규칙의 잔존 중복 keyword 씨앗 정리 방침
      결정(일괄 정리 vs 자연 소멸) 및 실행

## Blocked by

None — can start immediately. (description 도입(#08)과 무관하게 wave-4 가
빈 키워드 안전을 실측함)

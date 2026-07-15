Status: needs-triage

## What to build

기존 자산을 라벨 세계로 1회 이행하고 colorId 레거시를 제거한다 —
ADR-0006 Decision 4 (깨끗한 컷오버, 이중 모드 없음).

설계 노트 (구현 세션 재량):

- **카테고리 → 라벨 생성**: 사용자×캘린더별로 기존 카테고리마다 named
  라벨 append (`{name: category.name, backgroundColor: colorId 의 클래식
  hex}`) → `categories.labelId` 채움. **unnamed 시스템 슬롯을 개명하지
  않는다** — 그 슬롯은 사용자의 수동 팔레트 공유 자산이므로 append 가
  안전. 클래식 11색 hex 표는 colors.get 실값으로 고정.
- **이벤트 재각인**: 이행 후 full resync 가 마커 v1 이벤트를 v2 라벨로
  재적용 (v1 판정 하위호환은 #02 가 이미 보장 — 브리지 덕에 colorId
  동등성이 유지되므로 소유권 오판 없음).
- **레거시 제거**: `categories` colorId CHECK(`'1'..'11'`) drop
  마이그레이션, `routes/categories.ts` ColorIdSchema → hex/labelId 계약,
  `routes/events.ts` regex 제거, 마커 v1 판정 경로 제거(재각인 완료
  후), `src/AGENTS.md` §5.4 를 v2 정본으로 개정.
- **게이트**: full resync fan-out 은 Workers Free 50-fetch 캡을 정면으로
  밟는다 — **sync-reliability #01(플랜 결정) 또는 #02(예산 가드) 선행
  필수**. 실사용자 유입 전(OAuth 검수 통과 직후 창)이 컷오버 최적기.
- 운영 절차: 이행 스크립트는 운영자 워크스테이션 실행(backfill-seeds
  전례), 실행 전 카테고리 수 × 캘린더 200 캡 사전 검사, dry-run 모드.

## Acceptance criteria

- [ ] 이행 스크립트: dry-run + 실행, append-only·200 캡 검사, 재실행
      멱등
- [ ] 기존 카테고리 전부 `labelId` 보유 + Google 색 창에 칩 노출 (육안)
- [ ] full resync 후 표본 이벤트의 마커 v2 재각인 확인
- [ ] colorId 레거시(CHECK·Zod·regex·v1 판정) 제거, `pnpm test`/`typecheck`
      통과
- [ ] §5.4 문서 v2 개정 + `python3 scripts/check-context-paths.py` 통과

## Blocked by

- native-labels #02, #03
- sync-reliability #01 또는 #02 (full resync fan-out 이 Free 캡과 충돌)

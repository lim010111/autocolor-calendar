# Completion Roadmap

AutoColor for Calendar를 **Workspace Marketplace public listing 활성** 상태까지
끌어올리는 데 필요한 잔여 작업의 **의존성 순서** 가이드. 항목 자체의 정본은
[`TODO.md`](../TODO.md) (코드/인프라 단위) 와
[`marketplace-readiness.md`](marketplace-readiness.md) (제출 자료/검수 surface)
이며, 이 문서는 그 항목들 사이의 unblock 관계만 표시한다. 항목이 닫힐 때마다
이 문서를 수정할 필요는 없다 — 의존성 구조가 바뀔 때만 갱신.

## 완성 정의

다음 **세 조건이 동시에** 충족된 상태:

1. **Public listing 활성** — Workspace Marketplace에서 일반 사용자가 검색·설치 가능.
2. **Prod 백엔드 활성** — `autocolor-prod` Worker가 실제 OAuth/DB 트래픽을 처리.
   (PR #43 `a01bde7`, 2026-05-04 완료 — [`src/CLAUDE.md` "Environments"](../src/CLAUDE.md).)
3. **OAuth verification 완료** — Google Restricted Scope 검수 통과
   (스코프 정당화 + 데모 영상 + Privacy/ToS).

하나만 빠져도 "출시"가 아니다.

## Critical path

직렬 의존이 강한 순서. 위에서부터 진행 권장.

### 1. 도메인 확보 + Search Console 인증 ✓

- 정본: [`TODO.md` line 8](../TODO.md), [Launch Gate row 1](marketplace-readiness.md#status).
- **단일 최대 unblock 지점.** Privacy URL · ToS URL · App home URL · Support URL ·
  prod Watch API `WEBHOOK_BASE_URL` (§4 후속 line 54)이 전부 이 게이트를 공유.
- 후속 unblock: §4 (Privacy/ToS), §5 (listing), §1.5 (support email/URL row 78-79).

### 2. Prod 환경 활성화 ✓

- 정본: [`TODO.md` §3 후속 line 37](../TODO.md), [Launch Gate row 2](marketplace-readiness.md#status).
- 작업 단위는 line 37에 명시 — Supabase prod, GCP prod OAuth client, secrets 6종,
  Hyperdrive 바인딩, GAS prod `/exec` 매핑.
- 검증: `/healthz` · `/oauth/google/callback` · `/me` 세 엔드포인트 prod에서 200.
- 게이트 1과 **부분 병행 가능**. 단 prod Watch API는 도메인 verified까지 OFF.
- **세션 GC** ([`TODO.md` §3 후속 line 40](../TODO.md))는 prod 활성화 직후
  pg_cron으로 즉시 스케줄 — Retention 정책 (`marketplace-readiness.md` row 178)
  unblock 조건.

### 3. CI/CD 파이프라인 ✓

- 정본: [`TODO.md` §7 line 134](../TODO.md).
- **§6.1 E2E 테스트의 선행조건**(line 110에 명시).
- 최소 단위: `pnpm vitest run` + `pnpm typecheck` + `pnpm lint` GitHub Actions PR gate.
- 권장 추가: `pnpm db:generate` migration drift 검출, 보호 브랜치 정책.

### 4. Privacy Policy + Terms of Service ✓

- 정본: [`TODO.md` §7 line 137](../TODO.md), [`marketplace-readiness.md` §2 row 121-122](marketplace-readiness.md).
- Legal 작업 — 외부 의존성이 가장 큼. **게이트 1과 동시 시작 권장.**
- 본문 작성 → 도메인에 호스팅 → URL을 marketplace-readiness §2에 기록.

### 5. Marketplace listing 자료 번들 (재개 — 스크린샷)

- 정본: [`marketplace-readiness.md` §1](marketplace-readiness.md).
- 짧은/긴 description (KR+EN), 아이콘 128/32, 스크린샷 ≥3, (선택) 홍보 영상,
  카테고리, support email/URL.
- **스크린샷을 제외한 전부 2026-05-09 완료.** 스크린샷 4장은 그 뒤 UI 가 두 번
  바뀌어(편집기 개편 07-28, legal clickwrap 07-29) 무효가 됐고, SDK 콘솔에
  올라간 것도 같은 낡은 자료라 **재촬영 + 교체가 게이트 8 의 유일한 자료
  선행조건**이다. 절차는 [`runbooks/00-user-action-checklist.md`](runbooks/00-user-action-checklist.md) ④.
- 최종 스크린샷은 게이트 2(prod 활성화) 이후 촬영 — 현행 prod UI 기준.

### 6. OAuth Consent Screen + Restricted Scope 검수 ✓

- 정본: [`TODO.md` §7 line 136](../TODO.md), [`marketplace-readiness.md` §2 row 126-130](marketplace-readiness.md).
- **통과 2026-07-24** — `script.external_request` / `calendar` / `calendar.events`.
  제출(05-09)부터 승인까지 11주, 반려 3라운드(brand → demo video → 스코프 불일치).
- **CASA 미트리거** (2026-07-28 Console 실측) — restricted 스코프 0행, `calendar` 는
  sensitive 분류. 게이트 8 앞에 CASA 종속 없음. 100-user cap 도 실효 해제.
- 신규 스코프 또는 consent screen *설정* 변경은 이 게이트를 다시 연다(재검수).

### 7. 백업/복구 정책 (후퇴)

- 정본: [`TODO.md` §7 line 135](../TODO.md).
- **PITR 은 2026-05-06 에 보류 결정**됐다 — 이 게이트가 요구하는 것은 PITR 이
  아니라 **Supabase Pro plan** 이다(daily snapshot 7일 보존 + Audit Log Drain 의
  전제). 2026-07-01 billing 중단으로 prod 가 임시 Free 로 내려앉아 백업 0 +
  7일 무활동 자동 pause 상태이므로, 이 게이트는 한 번 충족됐다가 **후퇴**했다.
- 남은 작업: Pro 복구 → daily snapshot 기반 복구 리허설 1회 → 접속기록 1년
  보관(Audit Log Drain, 처리방침 §8.2) 가동.
- 게이트 2 직후가 가장 저렴 — 데이터가 쌓이기 전.

### 8. Marketplace 등록 제출

- 정본: [`TODO.md` §7 line 137](../TODO.md).
- 게이트 1·2·4·5·6·7 모두 충족 후 제출.
- Google admin 검수 통상 1-3주.

## 비-Critical Path (병행 / 후순위)

| 항목 | 정본 | 메모 |
|---|---|---|
| 테스트 보강 §6.1 | [`TODO.md` line 106-110`](../TODO.md) | 게이트 3(CI) 들어오면 자연 동행 |
| 통합 테스트 하네스 §6.2 | [`TODO.md` line 114-115`](../TODO.md) | postgres-in-container 도입; 단독 작업 |
| Rate limit 통합 §6.4 | [`TODO.md` line 127`](../TODO.md) | 트래픽 증가 전까지 후순위 |
| 팀/공유 캘린더 ownership §5 후속 | [`TODO.md` line 100`](../TODO.md) | 설계 선행; 코드 직진 불가 |
| GAS UX — 와이어프레임 / 별도 Web UI | [`TODO.md` line 6, 16`](../TODO.md) | line 16은 사용자 명시 후순위 |
| Onboarding card 카피 refresh | [`marketplace-readiness.md` §2 row 132](marketplace-readiness.md) | 게이트 4 (Privacy URL) 후 |
| CASA 보안 평가 | [`marketplace-readiness.md` §2 row 131](marketplace-readiness.md) | **해당 없음** — 2026-07-28 Console 실측에서 restricted 스코프 0행으로 확인, CASA 미트리거. restricted 스코프를 추가하면 되살아난다 |

## 의존성 그래프

```mermaid
flowchart TD
  G1[1. 도메인 + Search Console]
  G2[2. Prod 활성화]
  G3[3. CI/CD]
  G4[4. Privacy / ToS]
  G5[5. Listing 번들]
  G6[6. OAuth Consent 검수]
  G7[7. Backup 정책]
  G8[8. Marketplace 등록]
  E1[E2E §6.1 line 108]
  WP[Prod Watch API §4 후속 line 52]

  G1 --> G4
  G1 --> WP
  G1 --> G5
  G2 --> G7
  G2 --> WP
  G2 --> G5
  G2 --> G8
  G3 --> E1
  G4 --> G6
  G5 --> G6
  G6 --> G8
  G7 --> G8
```

## 권장 실행 순서

1. **게이트 1·2·4를 동시 착수** — 외부 의존성(도메인 등록 대기, prod Supabase
   프로비저닝 시간, Legal 작성 시간)이 각각 며칠~몇 주 단위라 직렬화하면 시간
   낭비. 1·2는 운영(Ops), 4는 Legal로 owner가 다르므로 충돌 적음.
2. **게이트 3(CI/CD)는 1·2와 별개로 코드 머지 직전에** — 외부 의존성 0, 즉시
   가능. §6.1 E2E를 풀려면 이 게이트가 우선이지만 §6.1 자체는 비-critical.
3. **게이트 5(listing assets)는 게이트 2 검증 직후** — 스크린샷이 prod에서
   찍혀야 신뢰성 있음.
4. **게이트 6(OAuth verification) 제출 ≪ 검수 통과** 사이의 4-6주는 게이트 7과
   §6.1·§6.2 보강에 사용.
5. **게이트 8(Marketplace 등록) 제출 ≪ 통과** 사이의 1-3주에 운영 모니터링
   대시보드 (`/api/stats` 기반) 정착.

## 상태 추적

- [`TODO.md`](../TODO.md) 체크박스 = 단위 작업 정본.
- [`marketplace-readiness.md` §5 Launch Gates](marketplace-readiness.md#status) =
  검수 surface 단위 정본. 이 문서의 critical-path 번호와 1:1 대응 아님 — 이 문서는
  의존성 순서, Launch Gates는 surface 단위 freshness.
- 이 문서는 **목록 정본 아님.** 항목이 닫혀도 여기는 수정 불필요.

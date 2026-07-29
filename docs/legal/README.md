# Legal artifacts (publish-ready, sub-agent self-review only)

`docs/legal/` 은 외부 변호사 검토를 받지 않고 운영자가 self-publish 하는
publish-ready 본문 보관소다. 본문은 코드 / 아키텍처 ground truth (PII
redaction, sub-processors, account deletion, token encryption,
observability discipline) 에 기반한 사실 기술 위에, sub-agent
legal-reviewer 의 Round 1 redline + Round 2 self-publish 보완을 거쳐
한국 PIPA·약관규제법·전자상거래법 + GDPR + CCPA + COPPA 의 publish-ready
요건을 충족한다. 본 산출물은 외부 변호사 의견에 갈음할 수 없으나, 운영자
가 자기 책임 아래 publish 할 수 있는 수준까지 결정사항이 본문에 박혀
있다.

**중요 (Important):** 본 산출물은 외부 변호사 의견에 갈음하지 못한다.
self-publish 결정의 근거와 잔존 자문 9건은 [`legal-review-opinion.md`](./legal-review-opinion.md)
Round 2 본문 결정 트리에 전부 박혀 있으니 publish 전 그 항목들을
검토하라.

## Publish & verification commands

```bash
# 1. legal 본문을 HTML로 빌드 (Cloudflare Pages 배포 산출물)
pnpm legal:build
# 2. 본문 안의 cross-reference 경로가 살아있는지 확인 (CI gate와 동일)
python3 scripts/check-context-paths.py
```

publish 절차:

1. 운영자가 [`privacy-policy.md`](./privacy-policy.md) 와
   [`terms-of-service.md`](./terms-of-service.md) 말미의 "운영자 publish
   체크리스트" 에 열거된 식별 정보 placeholder (사업자 등록 정보, 운영자
   성명, 주소, 시행일) 를 본인 정보로 교체.
2. 호스팅 위치 (Cloudflare Pages 권장 — `docs/runbooks/00-user-action-checklist.md`
   "G4 — Privacy Policy + Terms of Service" 호스팅 옵션 비교 표 참조) 에
   publish.
3. `docs/marketplace-readiness.md` row 121-122 status `초안` → `완료` +
   URL 추가.
4. **약관·방침 링크가 GAS onboarding 카드에서 살아 있는지 확인.**
   `buildWelcomeCard` 는 로그인 버튼 **위에** 두 링크와 clickwrap 안내
   (`welcome.legal.*`) 를 렌더링하며, 이용약관 §0.3 은 그 절차의 존재를
   자기 발효요건으로 삼는다. 링크가 404 인 상태로 배포하면 약관이 발효
   되지 않는다 — publish 와 GAS 새 version 배포는 같은 창에서 처리한다.
5. **privacy-policy §4.1.1 의 수탁자 정보관리책임자 연락처 4건**의
   현행성 재확인 (PIPA §28의8②3호 필수 고지사항).
6. **privacy-policy §8.2 의 접속기록 보관 절차** 가동 확인 — Cloudflare ·
   Supabase 콘솔 감사 로그의 요금제상 보존기간이 1년에 미치지 못하면
   정기 내려받기·보관 루틴을 publish 전에 시작한다.

**주의:** 본 디렉터리에는 외부 vendor URL 을 인라인하지 않는다
([`../assets/marketplace/sub-processors.md`](../assets/marketplace/sub-processors.md) §4 정책).
단, [`privacy-policy.md`](./privacy-policy.md) 의 다음 두 곳은 법령상 필수
기재사항이므로 본 정책의 명시적 예외에 해당한다.

- §11 한국 권익침해 구제기관 enumeration — PIPA §30 ①항 8호.
- §4.1.1 수탁자 정보관리책임자 연락처 — PIPA §28의8 ②항 3호.

## Index

- [개인정보처리방침](./privacy-policy.md) — 한국어 단독 publish-ready
  본문 (Round 2 self-publish 적용본). 영문 번역은 별도 PR.
- [서비스 이용약관](./terms-of-service.md) — 한국어 단독 publish-ready
  본문 (Round 2 self-publish 적용본). 영문 번역 정책 동일.
- [Legal Review Opinion (Round 1 + Round 2)](./legal-review-opinion.md) —
  2026-05-05 자 sub-agent 검토 의견서. Round 1 의 Blocking 3건 + 잔존 자문
  9건이 Round 2 에서 본문 결정으로 모두 박혔음. 외부 변호사 검토를 갈음
  하지 아니한다.
- [REVIEW-REQUEST.md](./REVIEW-REQUEST.md) — (보존) 외부 자문에 의뢰할
  경우의 의뢰 패키지. self-publish 결정 이후로는 archival reference.

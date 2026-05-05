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
4. `gas/addon.js:119` 의 "정식 링크는 출시 시점에 제공됩니다." placeholder
   를 실제 URL 로 교체 (GAS 새 version 배포).
5. GAS Add-on onboarding 카드에 privacy-policy §4.1 의 국외이전 안내 문구
   ("본 서비스는 미국·일본·캐나다·아일랜드 등에 데이터를 이전합니다.
   회원가입 진행 시 본 처리방침 §4.1 의 국외이전 조건에 별도로 동의한
   것으로 간주됩니다.") 추가.
6. (privacy-policy §9.1 후속) 본 정책 시행일로부터 90일 이내에 OAuth
   콜백의 K-12 도메인 자동 차단 로직을 구현하고, 구현 시점에 §9.1 본문을
   사전 차단 진술로 갱신 + §12 의 절차로 통지.

본 디렉터리에는 외부 vendor URL 을 인라인하지 않는다(`docs/assets/marketplace/sub-processors.md` §4 정책).
단, `privacy-policy.md` §11 의 한국 권익침해 구제기관 enumeration 은 PIPA
§30 ①항 8호의 처리방침 필수 기재사항으로 본 정책의 명시적 예외에 해당
한다(privacy-policy §11 본문 참조).

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

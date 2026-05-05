# Legal artifacts (drafts)

`docs/legal/`은 **법률 자문 검토 전 1차 초안** 보관소다. 본문은 코드 / 아키
텍처 ground truth (PII redaction, sub-processors, account deletion, token
encryption, observability discipline)에 기반한 사실 기술이며, 법적 효력을
위해서는 외부 자문 검토와 호스팅 publish가 필요하다.

자문 검토 + publish가 끝나면 다음을 별도 PR로 처리한다:

1. 본문에 자문 회신 반영 (관할법, 면책조항, 분쟁해결 절차 등 자문 영역).
2. 호스팅 위치 (Cloudflare Pages 권장 — `docs/runbooks/00-user-action-checklist.md`
   "G4 — Privacy Policy + Terms of Service" 호스팅 옵션 비교 표 참조)에
   publish.
3. `docs/marketplace-readiness.md` row 121-122 status `초안` → `완료` + URL
   추가.
4. `gas/addon.js:119`의 "정식 링크는 출시 시점에 제공됩니다." placeholder를
   실제 URL로 교체 (GAS 새 version 배포).

본 디렉터리에는 외부 vendor URL을 인라인하지 않는다 (`docs/assets/marketplace/sub-processors.md` §4 정책).

## Index

- [개인정보처리방침 (초안)](./privacy-policy.md) — 한국어 단독 1차 초안 +
  2026-05-05 Round 1 redline 반영. 영어 번역은 검수 통과 후 별도 PR.
- [서비스 이용약관 (초안)](./terms-of-service.md) — 한국어 단독 1차 초안 +
  2026-05-05 Round 1 redline 반영. 영어 번역 정책 동일.
- [Round 1 Legal Review Opinion](./legal-review-opinion.md) — 2026-05-05
  자 1차 redline 의 의견서. Blocking findings 3건(법인격·CPO 미정 / K-12
  미성년자 차단 미구현 / 국외이전 분리 동의) + 잔존 자문 영역 9건 정리.
  외부 법률 자문 검토 전 1차 검토 산출물로 그 자체로 법적 효력 없음.
- [REVIEW-REQUEST.md](./REVIEW-REQUEST.md) — 외부 자문에게 첨부할 의뢰
  패키지 (사실관계 / 체크리스트 / 첨부 자료 인덱스).

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

- [개인정보처리방침 (초안)](./privacy-policy.md) — 한국어 단독 1차 초안.
  영어 번역은 검수 통과 후 별도 PR.
- [서비스 이용약관 (초안)](./terms-of-service.md) — 한국어 단독 1차 초안.
  영어 번역 정책 동일.

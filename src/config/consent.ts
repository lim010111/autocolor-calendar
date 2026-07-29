// ADR-0007 / ADR-0004 #05 — version of the *example-storage consent surface*.
//
// This is deliberately NOT the privacy-policy document version. The policy
// document is edited for many reasons (typos, contact changes, new
// sub-processors unrelated to examples); every bump of the constant below
// invalidates every stored consent and stops all example storage until each
// user re-consents in the sidebar. Coupling the two would turn a routine
// policy edit into a silent mass de-consent.
//
// **Bump ONLY when the example-storage disclosure itself materially changes**
// — what is stored, how long it is kept, or who receives it. That is exactly
// privacy-policy §12's "중대한 변경 → 재동의" obligation, and
// `consentReceiptFrom` refusing to mint against a stale version is its
// code-level enforcement.
//
// Lockstep: `gas/config.js` `ACFC_CONFIG.EXAMPLE_CONSENT_POLICY_VERSION` must
// carry the identical literal. On drift every grant returns 409
// `policy_version_mismatch` — loud by design, so a stale Add-on deployment
// cannot record consent against disclosure text the user never saw.
export const EXAMPLE_CONSENT_POLICY_VERSION = "example-storage/v1";

// privacy-policy §12 binds the company to a 30-day notice before a 중대한
// 변경 takes effect, and §12's closing note spells out what that means here:
// example storage "본 게시일부터 30일이 경과하고 정보주체가 명시적으로 동의한
// 이후에만 개시된다". The policy was published 2026-07-29, so the window opens
// 2026-08-28T00:00:00Z.
//
// This constant is the code-level enforcement of that self-binding, in the
// same spirit as `promptVersionSendsExamples`: without it the promise would
// depend on an operator remembering a date, and deploying the Worker one week
// early would silently falsify a published policy. `POST /api/consent/examples`
// is the only gate needed — no live consent means `consentReceiptFrom` mints no
// receipt, so `POST /api/examples` cannot reach `addExample` either.
//
// After the window opens this constant becomes inert; leave it in place as the
// record of when storage legitimately began.
export const EXAMPLE_STORAGE_OPENS_AT = Date.parse("2026-08-28T00:00:00Z");

export function exampleStorageIsOpen(now: number = Date.now()): boolean {
  return now >= EXAMPLE_STORAGE_OPENS_AT;
}

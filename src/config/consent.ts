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

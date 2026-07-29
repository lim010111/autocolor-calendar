var ACFC_CONFIG = {
  APP_NAME: 'autocolor-for-calendar',
  APP_VERSION: 'v2',
  // ADR-0007 — version of the example-storage disclosure this Add-on build
  // renders. MUST stay byte-identical to EXAMPLE_CONSENT_POLICY_VERSION in
  // src/config/consent.ts: the backend rejects a grant whose echoed version
  // differs (409 policy_version_mismatch), so a stale deployment cannot
  // record consent against disclosure text the user never saw. On drift,
  // every grant fails loudly — that is the intended behaviour, not a bug.
  EXAMPLE_CONSENT_POLICY_VERSION: 'example-storage/v1',
  // privacy-policy §12 — example storage may not begin until 30 days after
  // the policy was published (2026-07-29). Mirrors EXAMPLE_STORAGE_OPENS_AT
  // in src/config/consent.ts, which is the authority: the backend answers a
  // pre-window grant with 409 storage_not_open_yet regardless of what this
  // Add-on renders. This constant only keeps the surface honest — offering a
  // control that the backend must refuse is the same defect the policy_settings
  // checkboxes were removed for.
  EXAMPLE_STORAGE_OPENS_AT: '2026-08-28T00:00:00Z',
  PRIVACY_POLICY_EXAMPLES_URL: 'https://legal.autocolorcal.app/privacy',
  // ToS §0.3 — the welcome card is the "회사가 정한 안내 절차" the terms name
  // as their own condition of effect. Both links must render *before* the
  // sign-in button, or the terms never take effect by their own wording.
  PRIVACY_POLICY_URL: 'https://legal.autocolorcal.app/privacy',
  TERMS_OF_SERVICE_URL: 'https://legal.autocolorcal.app/terms',
  PROPERTY_KEYS: {
    ONBOARDED: 'acfc.onboarded',
    HOME_FIRST_SEEN_AT: 'acfc.homeFirstSeenAt'
  },
  PRIVATE_KEYS: {
    MANAGED_BY: 'acfcManagedBy',
    RULE_ID: 'acfcRuleId',
    CLASSIFIER_VERSION: 'acfcClassifierVersion',
    COLOR_ID: 'acfcColorId',
    UPDATED_AT: 'acfcUpdatedAt'
  }
};

/**
 * §12 30일 통지 창이 열렸는지. 창 이전에는 정정 예시 관련 UI 를 아예 그리지
 * 않는다 — 백엔드가 어차피 409 로 거절하므로, 노출하면 눌리지 않는 컨트롤이
 * 된다.
 */
function exampleStorageIsOpen() {
  return new Date().getTime() >= new Date(ACFC_CONFIG.EXAMPLE_STORAGE_OPENS_AT).getTime();
}

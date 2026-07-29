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
  PRIVACY_POLICY_EXAMPLES_URL: 'https://legal.autocolorcal.app/privacy',
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

// `getLabelSwatches()` / `getSwatchForHex(hex)` / `getSwatchForRule(rule)` /
// `getSwatchForClassicColorId` and the LABEL_SWATCH_PALETTE /
// CLASSIC_COLOR_ID_HEX data live in gas/i18n.js — all exposed as global
// functions/vars in Apps Script's flat scope.

// Palette-order index for a rule's resolved swatch (native-labels #03: the
// editor list sorts by color). Keyed off the same resolver the row icon uses,
// so the order can never disagree with what is drawn.
function getRuleColorOrderIndex(rule) {
  var idx = getLabelSwatches().indexOf(getSwatchForRule(rule));
  return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
}

/**
 * Entry point for the Google Workspace Add-on (Homepage Trigger).
 *
 * @param {Object} e - The event object.
 * @return {CardService.Card} The constructed Card.
 */
function buildAddOn(e) {
  var L = pickLocale(e);

  var missing = missingBackendProperties();
  if (missing.length > 0) {
    return buildConfigNeededCard(missing, L);
  }

  if (!AutoColorAuth.isAuthenticated()) {
    return buildWelcomeCard(L);
  }

  // backend connected → force local onboarding flag for backwards compat.
  AutoColorStorage.setOnboarded(true);

  return buildHomeCard(L);
}

/**
 * Returns the list of required ScriptProperties that are not set. The
 * Add-on needs both to reach the backend: BACKEND_BASE_URL for every API
 * call in gas/api.js, and OAUTH_AUTH_URL for the login button to open the
 * right /oauth/google endpoint.
 */
function missingBackendProperties() {
  var props = PropertiesService.getScriptProperties();
  var required = ["BACKEND_BASE_URL", "OAUTH_AUTH_URL"];
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    var val = props.getProperty(required[i]);
    if (!val) missing.push(required[i]);
  }
  return missing;
}

/**
 * The Worker's `/oauth/google` entry point. Read at card-build time because
 * the sign-in button carries an AuthorizationAction (a URL baked into the
 * card), not an onClick callback that could resolve it later.
 * `missingBackendProperties()` gates `buildAddOn` on this key, so the
 * fallback only ever shows if a card is rebuilt after the property is
 * cleared mid-session.
 */
function oauthAuthUrl() {
  var scriptProps = PropertiesService.getScriptProperties();
  return scriptProps.getProperty('OAUTH_AUTH_URL') || "https://api.example.com/oauth/google";
}

/**
 * Renders a blocking card instructing the operator to finish backend
 * configuration before end-users can reach the OAuth flow. Shown instead
 * of the welcome/home card when ScriptProperties are incomplete.
 */
function buildConfigNeededCard(missingKeys, L) {
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle(t('config.title', null, L))
    .setSubtitle(t('config.subtitle', null, L)));

  var section = CardService.newCardSection();
  section.addWidget(CardService.newDecoratedText()
    .setText(t('config.body', null, L))
    .setWrapText(true));

  for (var i = 0; i < missingKeys.length; i++) {
    section.addWidget(CardService.newDecoratedText()
      .setText("• " + missingKeys[i])
      .setWrapText(true));
  }

  section.addWidget(CardService.newDecoratedText()
    .setText(t('config.where', null, L))
    .setWrapText(true));

  builder.addSection(section);
  return builder.build();
}

/**
 * Screen 1: Welcome Card (onboarding + OAuth grant).
 */
function buildWelcomeCard(L) {
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle(t('welcome.title', null, L))
    .setSubtitle(t('welcome.subtitle', null, L))
    .setImageUrl("https://legal.autocolorcal.app/icon-128.png"));

  var tutorialSection = CardService.newCardSection().setHeader(t('welcome.section', null, L));

  tutorialSection.addWidget(CardService.newTextParagraph()
    .setText(t('welcome.step1', null, L)));

  tutorialSection.addWidget(CardService.newTextParagraph()
    .setText(t('welcome.step2', null, L)));

  tutorialSection.addWidget(CardService.newTextParagraph()
    .setText(t('welcome.step3', null, L)));

  builder.addSection(tutorialSection);

  // ToS §0.3 — clickwrap-lite. The terms make their own effect conditional on
  // "회사의 안내 절차에 따라 본 약관에 동의" ; without this section the terms
  // have never taken effect by their own wording, so every clause that only
  // matters in a dispute (liability limits, §8.2 termination grounds) is
  // unenforceable. Notice + links must render BEFORE the sign-in button —
  // a link placed after the act of assent is browsewrap, which US courts
  // reject far more often than clickwrap. No manifest change: both URLs are
  // already covered by `openLinkUrlPrefixes` (`https://legal.autocolorcal.app`).
  var consentSection = CardService.newCardSection();
  consentSection.addWidget(CardService.newTextParagraph()
    .setText(t('welcome.legal.notice', null, L)));
  consentSection.addWidget(CardService.newButtonSet()
    .addButton(CardService.newTextButton()
      .setText(t('welcome.legal.terms', null, L))
      .setOpenLink(CardService.newOpenLink().setUrl(ACFC_CONFIG.TERMS_OF_SERVICE_URL)))
    .addButton(CardService.newTextButton()
      .setText(t('welcome.legal.privacy', null, L))
      .setOpenLink(CardService.newOpenLink().setUrl(ACFC_CONFIG.PRIVACY_POLICY_URL))));
  builder.addSection(consentSection);

  // Two-button footer, because the host's auto-reload is best-effort only —
  // see `buildAuthFooter`.
  builder.setFixedFooter(buildAuthFooter(t('welcome.cta.login', null, L), L));

  return builder.build();
}

/**
 * The sign-in / reconnect footer, shared by buildWelcomeCard and
 * buildReconnectCard.
 *
 * **The second button is not optional.** Google's own guide for connecting an
 * add-on to a third-party service ends the flow with "the user is prompted to
 * refresh the add-on" — automatic re-render after the OAuth window closes is
 * NOT a guarantee for Calendar add-ons (only Chat gets it, via
 * `completeRedirectUri`). Measured here: `OnClose.RELOAD_ADD_ON` is deprecated
 * and never fired, and a button-level `AuthorizationAction` did not fire
 * either; the user was left on an authenticated-but-stale card with no way
 * forward except reloading the whole Calendar tab.
 *
 * So the primary button keeps the best-effort auto path (`OnClose.RELOAD`, the
 * non-deprecated enum, the shape Google's own sample uses) and the secondary
 * button is the deterministic one: it re-reads the session token that `doGet`
 * already wrote to UserProperties and navigates to Home. Removing it puts the
 * user back in the dead end. Both widget types are already load-bearing
 * elsewhere in this file, so neither depends on an unverified API.
 */
function buildAuthFooter(primaryText, L) {
  return CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(primaryText)
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOpenLink(CardService.newOpenLink()
        .setUrl(oauthAuthUrl())
        .setOpenAs(CardService.OpenAs.FULL_SIZE)
        .setOnClose(CardService.OnClose.RELOAD)))
    .setSecondaryButton(CardService.newTextButton()
      .setText(t('auth.cta.continue', null, L))
      .setOnClickAction(CardService.newAction().setFunctionName("actionCompleteSignIn")));
}

/**
 * "I've signed in" — the deterministic half of the OAuth return path.
 * `doGet` persisted the session token to UserProperties before the bounce-back
 * page rendered, so by the time the user can press this the token is already
 * there; this just re-renders against it.
 */
function actionCompleteSignIn(e) {
  var L = pickLocale(e);
  if (!AutoColorAuth.isAuthenticated()) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('auth.toast.notYet', null, L)))
      .build();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildHomeCard(L)))
    .setNotification(CardService.newNotification().setText(t('auth.toast.loggedIn', null, L)))
    .build();
}



/**
 * Screen 2: Home Card (main dashboard - homepageTrigger).
 *
 * Fetches /api/stats synchronously on every render (UrlFetchApp is blocking
 * in GAS). AUTH_EXPIRED falls through to the reconnect card so homepage
 * entry from an expired session doesn't show a blank dashboard. Empty-state
 * (no syncs yet): classification.updated = 0 → renders the "applied: 0"
 * line as the sole status line.
 */
function buildHomeCard(L) {
  var stats = fetchStatsOrError();
  if (stats && stats.error === 'AUTH_EXPIRED') {
    return buildReconnectCard(null, L);
  }

  var me = fetchMeOrError();
  if (me && me.error === 'AUTH_EXPIRED') {
    return buildReconnectCard(null, L);
  }

  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle(t('home.title', null, L)));

  // Push-inactive surfaces a silent webhook-path failure with a "reconnect now"
  // button that calls /sync/heal-watch to re-register the watch channel
  // without dragging a full_resync along. The active state renders no top
  // pin — the bottom info section carries the 5~10s expectation instead.
  var pushActive = me && me.push_active === true;
  if (!pushActive) {
    var pushSection = CardService.newCardSection();
    pushSection.addWidget(CardService.newDecoratedText()
      .setText(t('home.push.inactive', null, L))
      .setBottomLabel(t('home.push.inactive.detail', null, L)));
    pushSection.addWidget(CardService.newTextButton()
      .setText(t('home.push.reconnect', null, L))
      .setOnClickAction(CardService.newAction().setFunctionName("actionForceHealWatch")));
    builder.addSection(pushSection);
  }

  var section = CardService.newCardSection();

  var classifiedLine;
  if (!stats || stats.error) {
    classifiedLine = t('home.stats.failed', null, L);
  } else {
    var updatedCount = (stats.classification && stats.classification.updated) || 0;
    classifiedLine = t('home.stats.applied', { count: updatedCount }, L);
  }

  section.addWidget(CardService.newDecoratedText()
    .setText(classifiedLine));

  builder.addSection(section);

  var actionSection = CardService.newCardSection();

  var ruleButton = CardService.newTextButton()
    .setText(t('home.btn.rules', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToRuleManagement"));

  var settingsButton = CardService.newTextButton()
    .setText(t('home.btn.settings', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToSettings"));

  actionSection.addWidget(CardService.newButtonSet()
    .addButton(ruleButton)
    .addButton(settingsButton));

  builder.addSection(actionSection);

  // 첫 진입 후 24h 동안만 onboarding 안내를 노출. backend의
  // next_sync_token_present 신호는 bootstrap full_resync가 1~2초에
  // 끝나면 곧바로 true가 되어 race가 발생하므로, GAS 로컬에 첫 진입
  // 시각을 stamp하고 그 윈도우 안인지로 분기한다 (자세한 근거는
  // storage.js isWithinFirstHomeWindow 주석 참조).
  var inFirstHomeWindow = AutoColorStorage.isWithinFirstHomeWindow();

  var infoText = t('home.info', null, L);
  if (inFirstHomeWindow) {
    infoText = infoText + "\n\n" + t('home.info.firstEventDelay', null, L);
  }
  // native-labels #03 (ADR-0006) — unnamed label slots never become rules;
  // naming a color in Google Calendar is what creates one.
  infoText = infoText + "\n\n" + t('home.hint.nameLabel', null, L);

  var infoSection = CardService.newCardSection();
  infoSection.addWidget(CardService.newDecoratedText()
    .setText(infoText)
    .setWrapText(true));
  builder.addSection(infoSection);

  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(t('home.cta.syncNow', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionSyncNow")));

  builder.setFixedFooter(fixedFooter);

  return builder.build();
}

/**
 * Fetch /api/stats?window=7d. Mirrors fetchCategoriesOrError / fetchPreviewOrError:
 * returns payload JSON on 2xx, { error } on failure so the caller renders
 * an inline fallback instead of throwing out of the homepage trigger.
 */
function fetchStatsOrError() {
  try {
    var res = AutoColorAPI.fetchBackend('/api/stats?window=7d', { method: 'get' });
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    if (err && err.message === 'AUTH_EXPIRED') return { error: 'AUTH_EXPIRED' };
    return { error: err && err.message ? err.message : 'unknown_error' };
  }
}

/**
 * Fetch /me. Used by the home card to read the `push_active` flag for the
 * auto-sync status pill. Same error-as-data convention as
 * fetchStatsOrError so the home render path never throws.
 */
function fetchMeOrError() {
  try {
    var res = AutoColorAPI.fetchBackend('/me', { method: 'get' });
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    if (err && err.message === 'AUTH_EXPIRED') return { error: 'AUTH_EXPIRED' };
    return { error: err && err.message ? err.message : 'unknown_error' };
  }
}

function actionSyncNow(e) {
  var L = pickLocale(e);
  try {
    AutoColorAPI.fetchBackend('/sync/run', {
      method: 'post',
      contentType: 'application/json',
      payload: '{}'
    });
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('sync.toast.running', null, L)))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED' || err.message.indexOf('reauth') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
        .build();
    }
    if (err.message.indexOf('429') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText(t('sync.toast.throttled', null, L)))
        .build();
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('sync.toast.failed', { message: err.message }, L)))
      .build();
  }
}

/**
 * Re-register the user's Watch channel via /sync/heal-watch when the home
 * card's auto-sync inactive pill is showing. Distinct from /sync/run
 * (which only enqueues a sync) and from /sync/bootstrap (which also fires a
 * full_resync). Refreshes the home card so the user sees the pill flip.
 */
function actionForceHealWatch(e) {
  var L = pickLocale(e);
  try {
    AutoColorAPI.fetchBackend('/sync/heal-watch', {
      method: 'post',
      contentType: 'application/json',
      payload: '{}'
    });
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('heal.toast.success', null, L)))
      .setNavigation(CardService.newNavigation().updateCard(buildHomeCard(L)))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED' || err.message.indexOf('reauth') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
        .build();
    }
    // Don't expose raw error text to the user — same policy as the
    // events.ts (manual color override) endpoint.
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('heal.toast.failed', null, L)))
      .build();
  }
}

function actionGoBack(_e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

function actionGoToRuleManagement(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildRuleManagementCard(e)))
    .build();
}

function actionGoToSettings(e) {
  var L = pickLocale(e);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard(L)))
    .build();
}

/**
 * Calls the backend classify preview endpoint. Rule-only classifier — LLM
 * fallback runs during sync, not here, to keep sidebar latency predictable.
 * Returns { source, category?, matchedSeed?, score?, llmAvailable? } on 200 or
 * { error } for auth/network failure so the caller can render an inline
 * fallback message instead of hanging.
 */
function fetchPreviewOrError(payload) {
  try {
    var res = AutoColorAPI.fetchBackend('/api/classify/preview', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
    });
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    if (err && err.message === 'AUTH_EXPIRED') return { error: 'AUTH_EXPIRED' };
    return { error: err && err.message ? err.message : 'unknown_error' };
  }
}

/**
 * ADR-0007 — reads the "remember this correction" checkbox. The value can
 * arrive either as a form input (the click that toggled it) or as an action
 * parameter (a re-render that promoted it), so both are checked. Absent →
 * false, i.e. opt-in.
 */
function readRememberExample(e) {
  var v = readRuleFormValue(e, 'rememberExample');
  if (v === 'on') return true;
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};
  return (p1.rememberExample || p2.rememberExample) === 'on';
}

/**
 * ADR-0007 — stores one Instant Feedback correction. Returns the parsed
 * body ({stored:true} | {stored:false, reason}) or {error} for auth /
 * consent / network failure. Soft outcomes come back as HTTP 200 with a
 * `reason`, so they never reach the `catch` (see src/routes/examples.ts).
 */
function postExampleOrError(payload) {
  try {
    var res = AutoColorAPI.fetchBackend('/api/examples', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
    });
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    if (err && err.message === 'AUTH_EXPIRED') return { error: 'AUTH_EXPIRED' };
    return { error: err && err.message ? err.message : 'unknown_error' };
  }
}

/** ADR-0007 — records the one-time example-storage consent. */
function postExampleConsentOrError() {
  try {
    var res = AutoColorAPI.fetchBackend('/api/consent/examples', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        policyVersion: ACFC_CONFIG.EXAMPLE_CONSENT_POLICY_VERSION,
      }),
    });
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    if (err && err.message === 'AUTH_EXPIRED') return { error: 'AUTH_EXPIRED' };
    return { error: err && err.message ? err.message : 'unknown_error' };
  }
}

/** ADR-0007 — current consent state. Settings card only; the event card
 *  learns consent lazily from the 403 so the sidebar hot path stays fetch-free. */
function fetchExampleConsentOrError() {
  try {
    var res = AutoColorAPI.fetchBackend('/api/consent/examples', { method: 'get' });
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    if (err && err.message === 'AUTH_EXPIRED') return { error: 'AUTH_EXPIRED' };
    return { error: err && err.message ? err.message : 'unknown_error' };
  }
}

/** ADR-0007 — withdraws consent and purges every stored example. */
function deleteExampleConsentOrError() {
  try {
    var res = AutoColorAPI.fetchBackend('/api/consent/examples', { method: 'delete' });
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    if (err && err.message === 'AUTH_EXPIRED') return { error: 'AUTH_EXPIRED' };
    return { error: err && err.message ? err.message : 'unknown_error' };
  }
}

/**
 * Formats an embedding cosine score (0..1) as a rounded percentage for the
 * sidebar. Returns '' for a missing/non-numeric score so the match line
 * degrades gracefully (embedding hits always carry a numeric score).
 */
function formatScore(score) {
  if (typeof score !== 'number' || isNaN(score)) return '';
  return Math.round(score * 100) + '%';
}

/**
 * Builds the matched-rule status line. Mirrors the preview-endpoint
 * outcomes (rule / llm / no_match ± llmTried) plus the network-error
 * fallback. Kept as a pure formatter so UI copy tweaks don't require
 * reaching into onEventOpen's control flow.
 */
function formatMatchLine(preview, L) {
  if (!preview) return t('match.none', null, L);
  if (preview.error) {
    if (preview.error === 'AUTH_EXPIRED') return t('match.reauth', null, L);
    return t('match.fetchFailed', null, L);
  }
  if (preview.source === 'rule' && preview.category) {
    var name = preview.category.name || t('match.fallbackName', null, L);
    // ADR-0004 #03 — the embedding hit surfaces the winning seed (name or
    // keyword) + its cosine score, replacing the dead substring matchedKeyword.
    if (preview.matchedSeed) {
      return t(
        'match.byRule.withSeed',
        { name: name, seed: preview.matchedSeed, score: formatScore(preview.score) },
        L
      );
    }
    return t('match.byRule', { name: name }, L);
  }
  if (preview.source === 'llm' && preview.category) {
    var llmName = preview.category.name || t('match.fallbackName', null, L);
    return t('match.byLlm', { name: llmName }, L);
  }
  if (preview.source === 'no_match' && preview.llmQuotaExceeded) {
    return t('match.llm.quotaExceeded', null, L);
  }
  if (preview.source === 'no_match' && preview.llmTried) {
    return t('match.llm.empty', null, L);
  }
  if (preview.llmAvailable) {
    return t('match.none.willTryLlm', null, L);
  }
  return t('match.none', null, L);
}

/**
 * Fetches the user's categories from the backend.
 * Halt-on-Failure contract: no local fallback / no cache. On error, return
 * { error } and let the caller render an inline error state instead of a
 * silently-stale list.
 */
function fetchCategoriesOrError() {
  try {
    var res = AutoColorAPI.fetchBackend('/api/categories', { method: 'get' });
    var body = JSON.parse(res.getContentText() || '{}');
    return { rules: mapWireCategoriesToRules(body.categories || []) };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Maps the backend wire shape (`{ id, name, colorId, labelId, ... }`) to the
 * trimmed `{ id, keyword, colorId, backgroundColor, labelId, labelDeleted,
 * labelDeletable }`
 * rule rows the
 * card builders consume. Shared by fetchCategoriesOrError and the
 * mutation-response fast path below.
 */
function mapWireCategoriesToRules(categories) {
  return categories.map(function (c) {
    return {
      id: c.id,
      // 다중 키워드 규칙도 사용자가 입력한 원문 라벨(name)을 그대로 보여주도록.
      // 과거에는 keywords[0]만 사용해서 "프로젝트, 개발" 입력이 "프로젝트"로만 표시됐음.
      keyword: c.name || (c.keywords && c.keywords[0]) || "",
      colorId: c.colorId,
      // ADR-0006 — the label's real hex; what every swatch renders from.
      // null on rows the backend has not backfilled yet (reconcile fills
      // them on the next sync) → getSwatchForRule falls back to colorId.
      backgroundColor: c.backgroundColor || null,
      // native-labels #03 (ADR-0006) — labelId drives the sidebar chip POST;
      // labelDeleted renders the editor's "라벨 삭제됨" badge.
      labelId: c.labelId || null,
      labelDeleted: !!c.labelDeletedAt,
      // ADR-0008 — server-derived capability ("may the Add-on delete this
      // rule's Google label too?"), NOT the raw provenance enum. The policy
      // stays on the backend; this side only renders a checkbox from it.
      labelDeletable: !!c.labelDeletable,
    };
  });
}

/**
 * card-latency #02 — reads the updated `categories` list a mutation response
 * (POST / DELETE /api/categories) carries so the card rebuild skips the
 * follow-up GET (2 roundtrips → 1). Returns null when the body is missing,
 * unparsable, or predates the list-carrying Worker — the caller then falls
 * back to buildRuleManagementCard's own fetch. This is NOT a cache: the list
 * comes fresh from the mutation's own response, so Halt-on-Failure holds.
 */
function readCategoriesFromMutationResponse(res) {
  try {
    var body = JSON.parse(res.getContentText() || '{}');
    if (!body || !Array.isArray(body.categories)) return null;
    return mapWireCategoriesToRules(body.categories);
  } catch (_err) {
    return null;
  }
}

/**
 * Screen 3: Event Insight Card (event detail - eventOpenTrigger).
 *
 * Reads the currently displayed event via the Advanced Calendar Service
 * (Calendar.Events.get), which respects the narrow
 * `calendar.addons.current.event.read` scope — keeping the broader
 * `auth/calendar` scope out of Stage 1 consent so Stage 2's backend OAuth
 * renders a fresh consent screen instead of the "signing back in" shortcut.
 */
function onEventOpen(e) {
  var L = pickLocale(e);
  var title = t('event.empty', null, L);
  var eventLabelId = null; // the event's currently applied Google label
  var rules = null; // backend label cache rows (trimmed, see mapWire...)
  var previewResult = null; // { source, category?, matchedSeed?, score?, llmAvailable?, llmTried?, error? }

  // §5 후속 — if actionClassifyWithLlm stashed an on-demand LLM preview in
  // the card parameters, use it instead of re-fetching rule-only. JSON
  // round-trips through parameters so the card re-render shows the LLM
  // result in place without a second network call.
  var stashed = readStashedLlmPreview(e);
  if (stashed) previewResult = stashed;

  if (e && e.calendar && e.calendar.id) {
    var event = null;
    try {
      event = Calendar.Events.get(e.calendar.calendarId, e.calendar.id);
      title = event.summary || t('event.untitled', null, L);
    } catch (err) {
      // Calendar event inaccessible — title stays as the empty fallback,
      // preview won't be fetched.
    }

    if (event) {
      // ADR-0006 — labels supersede colorId; events.get returns
      // `eventLabelId` without opt-in (native-labels PRD 실측 1).
      eventLabelId = event.eventLabelId || null;

      // Label cache for the chip picker + applied-label line. A chip-pick
      // re-render carries the list in the action parameters (card-latency
      // #01 pattern), so pure-UI re-renders stay fetch-free.
      rules = readCategoriesSnapshot(e);
      if (!rules) {
        var fetchedCats = fetchCategoriesOrError();
        if (fetchedCats.error === 'AUTH_EXPIRED') {
          return buildReconnectCard(null, L);
        }
        rules = fetchedCats.rules || null;
      }

      if (!previewResult) {
        previewResult = fetchPreviewOrError({
          summary: title,
          description: event.description || "",
          location: event.location || "",
        });
      }

      if (previewResult && previewResult.error === 'AUTH_EXPIRED') {
        return buildReconnectCard(null, L);
      }
    }
  }

  var builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader()
    .setTitle(t('event.title', null, L))
    .setSubtitle(title));

  var statusSection = CardService.newCardSection()
    .setHeader(t('event.section.status', null, L));

  // Applied-label line: resolve the event's eventLabelId against the label
  // cache. A label that matches no rule (unnamed slot pick / not yet
  // reconciled) renders the "unknown" variant rather than pretending bare.
  var appliedLine;
  if (!eventLabelId) {
    appliedLine = t('event.appliedLabel.none', null, L);
  } else {
    var appliedRule = null;
    if (rules) {
      for (var ai = 0; ai < rules.length; ai++) {
        if (rules[ai].labelId === eventLabelId) {
          appliedRule = rules[ai];
          break;
        }
      }
    }
    appliedLine = appliedRule
      ? t('event.appliedLabel', { name: appliedRule.keyword }, L)
      : t('event.appliedLabel.unknown', null, L);
  }
  statusSection.addWidget(CardService.newDecoratedText()
    .setText(appliedLine));

  statusSection.addWidget(CardService.newDecoratedText()
    .setText(formatMatchLine(previewResult, L))
    .setWrapText(true));

  // §5 후속 — opt-in LLM preview button appears only on rule-miss when the
  // backend has OPENAI_API_KEY AND we haven't already run the LLM leg for
  // this card render. Once AI was tried (hit or miss), no retry button —
  // the result stands and the user can switch events to re-engage.
  if (
    previewResult &&
    previewResult.source === 'no_match' &&
    previewResult.llmAvailable &&
    !(!!previewResult.llmTried) &&
    e && e.calendar && e.calendar.id
  ) {
    statusSection.addWidget(CardService.newTextButton()
      .setText(t('event.btn.classifyLlm', null, L))
      .setOnClickAction(CardService.newAction().setFunctionName("actionClassifyWithLlm")));
  }

  builder.addSection(statusSection);

  var overrideSection = CardService.newCardSection()
    .setHeader(t('event.section.override', null, L));

  // native-labels #03 (ADR-0006) — the picker lists the user's named labels
  // (backend label cache = rules with a live labelId), replacing the retired
  // 11-color palette. Deleted-label rules can't be applied → filtered out.
  var chips = [];
  if (rules) {
    for (var ci = 0; ci < rules.length; ci++) {
      if (rules[ci].labelId && !rules[ci].labelDeleted) chips.push(rules[ci]);
    }
  }

  var selectedLabelId = null;
  if (e && e.parameters && e.parameters.selectedLabelId) {
    selectedLabelId = e.parameters.selectedLabelId;
  } else if (e && e.commonEventObject && e.commonEventObject.parameters && e.commonEventObject.parameters.selectedLabelId) {
    selectedLabelId = e.commonEventObject.parameters.selectedLabelId;
  }

  var chipSnapshotJson = serializeCategoriesSnapshot(rules);

  if (chips.length === 0) {
    overrideSection.addWidget(CardService.newTextParagraph()
      .setText(t('event.labels.empty', null, L)));
  } else {
    // Chip-pick re-render carries the label cache so it stays fetch-free
    // (card-latency #01 pattern; null → the re-render fetches instead).
    var chipAction = CardService.newAction()
      .setFunctionName("actionSelectColor");
    var chipParams = {};
    if (chipSnapshotJson) chipParams.categoriesSnapshotJson = chipSnapshotJson;
    if (rememberChecked) chipParams.rememberExample = 'on';
    if (chipSnapshotJson || rememberChecked) chipAction.setParameters(chipParams);

    var labelGrid = CardService.newGrid()
      .setTitle(t('event.labelPicker', null, L))
      .setNumColumns(2)
      .setOnClickAction(chipAction);

    // Inline data-URI swatches — no external image host (card-latency #03).
    // The chip icon renders the label's real color (`backgroundColor`), same
    // resolver as the editor list.
    chips.forEach(function(chip) {
      var sw = getSwatchForRule(chip);
      var url = (chip.labelId === selectedLabelId) ? sw.selectedUrl : sw.url;
      labelGrid.addItem(CardService.newGridItem()
        .setIdentifier(chip.labelId)
        .setTitle(chip.keyword)
        .setImage(CardService.newImageComponent()
          .setImageUrl(url)
          .setCropStyle(CardService.newImageCropStyle().setImageCropType(CardService.ImageCropType.CIRCLE))));
    });

    overrideSection.addWidget(labelGrid);
  }

  // ADR-0007 — Instant Feedback opt-in. Separate from the label pick on
  // purpose: "make this event this color" (a one-off override) and "learn
  // this pattern" (a correction worth remembering) are different intents,
  // and only the second one stores a title. Defaults OFF — storing on every
  // override without a per-item affirmative act is the riskier default.
  // Form inputs do not survive a CardService re-render, so the current
  // state rides the action parameters (see actionSelectColor).
  // Hidden until the privacy-policy §12 notice window opens — see
  // ACFC_CONFIG.EXAMPLE_STORAGE_OPENS_AT. The backend refuses the grant
  // before then, so rendering the checkbox would only produce a dead control.
  var rememberChecked = exampleStorageIsOpen() && readRememberExample(e);
  if (exampleStorageIsOpen()) {
    overrideSection.addWidget(CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setFieldName("rememberExample")
      .addItem(t('feedback.remember.label', null, L), "on", rememberChecked));
  }

  overrideSection.addWidget(CardService.newTextButton()
    .setText(t('event.btn.exclude', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionExcludeEvent")));

  builder.addSection(overrideSection);

  // The save action carries the current selection (and the label cache for
  // the success-toast name lookup) — CardService rebuilds cards per action,
  // so state must ride the action parameters, not module vars.
  var saveAction = CardService.newAction()
    .setFunctionName("actionSaveEventOverride");
  var saveParams = {};
  if (selectedLabelId) saveParams.selectedLabelId = selectedLabelId;
  if (chipSnapshotJson) saveParams.categoriesSnapshotJson = chipSnapshotJson;
  // Carry the title so the save handler need not re-issue Calendar.Events.get.
  if (title) saveParams.eventTitle = title;
  if (rememberChecked) saveParams.rememberExample = 'on';
  if (selectedLabelId || chipSnapshotJson || title || rememberChecked) {
    saveAction.setParameters(saveParams);
  }

  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(t('event.btn.save', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(saveAction));

  builder.setFixedFooter(fixedFooter);

  return builder.build();
}

function actionSelectColor(e) {
  var L = pickLocale(e);
  // See actionSelectColorForRule comment for why `grid_item_identifier`
  // is the documented-by-empiricism key for GAS Grid click callbacks.
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};

  var selectedLabelId =
    p1.grid_item_identifier || p2.grid_item_identifier ||
    p1.selectedLabelId || p2.selectedLabelId ||
    null;

  if (!selectedLabelId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('color.toast.unrecognized', null, L)))
      .build();
  }

  // Resolve the chip's display name from the carried snapshot (fetch-free;
  // falls back to the generic word when the snapshot was over budget).
  var rules = readCategoriesSnapshot(e);
  var selectedLabel = t('label.fallback', null, L);
  if (rules) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].labelId === selectedLabelId) {
        selectedLabel = rules[i].keyword || selectedLabel;
        break;
      }
    }
  }

  if (!e.parameters) e.parameters = {};
  e.parameters.selectedLabelId = selectedLabelId;
  // The checkbox is a form input, so its value arrives in formInputs on this
  // click and would be lost by the re-render — promote it to a parameter.
  e.parameters.rememberExample = readRememberExample(e) ? 'on' : '';

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(onEventOpen(e)))
    .setNotification(CardService.newNotification().setText(t('color.toast.selected', { label: selectedLabel }, L)))
    .build();
}

function actionExcludeEvent(e) {
  var L = pickLocale(e);
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(t('exclude.toast.done', null, L)))
    .build();
}

/**
 * §5 후속 — reads an LLM preview result that actionClassifyWithLlm stashed
 * in the card parameters. Returns null if none present or JSON parse fails
 * so onEventOpen falls back to a fresh rule-only fetch. Checks both the
 * top-level `e.parameters` and the CardService v2 `commonEventObject.parameters`
 * shapes the framework flips between depending on event source.
 */
function readStashedLlmPreview(e) {
  if (!e) return null;
  var raw = null;
  if (e.parameters && e.parameters.llmPreviewJson) {
    raw = e.parameters.llmPreviewJson;
  } else if (
    e.commonEventObject &&
    e.commonEventObject.parameters &&
    e.commonEventObject.parameters.llmPreviewJson
  ) {
    raw = e.commonEventObject.parameters.llmPreviewJson;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

/**
 * §5 후속 — explicit on-demand LLM classification. Re-sends the currently
 * open event through POST /api/classify/preview with `llm: true` and
 * re-renders onEventOpen with the result stashed in card parameters so the
 * AI outcome shows in place. Failure modes:
 *   - AUTH_EXPIRED → reconnect card (same as other write actions).
 *   - Network / server error → toast only; card unchanged.
 * Shares the backend's per-user daily LLM quota with the sync pipeline.
 */
function actionClassifyWithLlm(e) {
  var L = pickLocale(e);
  if (!e || !e.calendar || !e.calendar.id) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('llm.toast.noEvent', null, L)))
      .build();
  }

  var event = null;
  try {
    event = Calendar.Events.get(e.calendar.calendarId, e.calendar.id);
  } catch (_err) {
    event = null;
  }
  if (!event) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('llm.toast.readFail', null, L)))
      .build();
  }

  var title = event.summary || t('event.untitled', null, L);
  var description = event.description || "";
  var location = event.location || "";

  var preview = fetchPreviewOrError({
    summary: title,
    description: description,
    location: location,
    llm: true,
  });

  if (preview && preview.error === 'AUTH_EXPIRED') {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
      .build();
  }

  if (preview && preview.error) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('llm.toast.error', null, L)))
      .build();
  }

  if (!e.parameters) e.parameters = {};
  e.parameters.llmPreviewJson = JSON.stringify(preview);

  var toastText;
  if (preview && preview.source === 'llm' && preview.category) {
    var name = preview.category.name || t('match.fallbackName', null, L);
    toastText = t('llm.toast.success', { name: name }, L);
  } else {
    toastText = t('llm.toast.empty', null, L);
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(onEventOpen(e)))
    .setNotification(CardService.newNotification().setText(toastText))
    .build();
}

function actionRetryAnalysis(e) {
  var L = pickLocale(e);
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(t('retry.toast.requested', null, L)))
    .build();
}

/**
 * Per-event manual label override. Posts the user's chip pick to
 * `POST /api/events/:calendarId/:eventId/color`, which PATCHes the event's
 * `eventLabelId` (native-labels #02 contract) AND clears the §5.4 ownership
 * marker so the next sync respects the user's choice as `skipped_manual`.
 *
 * Pre-fetch guards: bail with a toast if the user hasn't picked a label
 * or the event context is missing. Success toast fires only AFTER the
 * 200 response — never before — so the user is never told the apply
 * succeeded when it didn't.
 */
function actionSaveEventOverride(e) {
  var L = pickLocale(e);
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};
  var selectedLabelId = p1.selectedLabelId || p2.selectedLabelId || null;

  if (!selectedLabelId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('override.toast.pickFirst', null, L)))
      .build();
  }

  var calendarId = e && e.calendar && e.calendar.calendarId;
  var eventId = e && e.calendar && e.calendar.id;
  if (!calendarId || !eventId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('llm.toast.noEvent', null, L)))
      .build();
  }

  var endpoint =
    '/api/events/' +
    encodeURIComponent(calendarId) +
    '/' +
    encodeURIComponent(eventId) +
    '/color';

  try {
    AutoColorAPI.fetchBackend(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ labelId: selectedLabelId }),
    });
  } catch (err) {
    var msg = (err && err.message) || '';
    if (msg === 'AUTH_EXPIRED' || msg.indexOf('reauth') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
        .build();
    }
    var notice;
    if (msg.indexOf('event_not_found') !== -1 || msg.indexOf('CLIENT_ERROR: 404') === 0) {
      notice = t('override.toast.notFound', null, L);
    } else if (msg.indexOf('forbidden') !== -1 || msg.indexOf('CLIENT_ERROR: 403') === 0) {
      notice = t('override.toast.forbidden', null, L);
    } else if (msg.indexOf('rate_limited') !== -1 || msg.indexOf('429') !== -1) {
      notice = t('override.toast.rateLimited', null, L);
    } else {
      // CLIENT_ERROR / SERVER_ERROR / Fetch failed after N attempts / 그 외 —
      // raw 메시지를 사용자에게 노출하지 않고 친화적으로 매핑.
      notice = t('override.toast.failed', null, L);
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(notice))
      .build();
  }

  // 200 응답 이후에만 success toast 출력. 어떤 라벨이 적용됐는지 이름으로
  // 명확히 표시 (스냅샷이 없으면 일반 명칭으로 대체).
  var rules = readCategoriesSnapshot(e);
  var label = t('label.fallback', null, L);
  if (rules) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].labelId === selectedLabelId) {
        label = rules[i].keyword || label;
        break;
      }
    }
  }
  // ADR-0007 — Instant Feedback. Only after the color actually applied:
  // never remember a correction we failed to carry out.
  if (!readRememberExample(e)) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('override.toast.success', { label: label }, L)))
      .build();
  }
  return finishExampleWrite(e, L, {
    selectedLabelId: selectedLabelId,
    rules: rules,
    successToast: t('override.toast.success', { label: label }, L),
  });
}

/**
 * ADR-0007 — shared tail for "color applied, now try to remember it".
 * Reached from actionSaveEventOverride and, after a first-time consent
 * grant, from actionGrantExampleConsent replaying the same correction.
 */
function finishExampleWrite(e, L, opts) {
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};
  var title = opts.eventTitle || p1.eventTitle || p2.eventTitle || '';

  // Resolve the rule id from the carried snapshot — the snapshot's `id` IS
  // the rule id. No snapshot (over the parameter budget) → fetch once.
  var rules = opts.rules || readCategoriesSnapshot(e);
  if (!rules) {
    var fetched = fetchCategoriesOrError();
    if (fetched.error === 'AUTH_EXPIRED') {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
        .build();
    }
    rules = fetched.rules || null;
  }
  var ruleId = null;
  if (rules) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].labelId === opts.selectedLabelId) { ruleId = rules[i].id; break; }
    }
  }
  if (!ruleId || !title) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('feedback.toast.ruleUnknown', null, L)))
      .build();
  }

  var res = postExampleOrError({ ruleId: ruleId, title: title });

  if (res.error === 'AUTH_EXPIRED') {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
      .build();
  }
  if (res.error && res.error.indexOf('consent_required') !== -1) {
    // First correction: the color already applied, so say so, and push the
    // one-time consent card carrying enough state to replay this write.
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(buildExampleConsentCard(L, {
        pendingRuleId: ruleId,
        pendingTitle: title,
        pendingLabelId: opts.selectedLabelId,
      })))
      .setNotification(CardService.newNotification().setText(opts.successToast))
      .build();
  }

  var notice;
  if (res.stored === true) {
    notice = opts.grantedToast || t('feedback.toast.remembered', null, L);
  } else if (res.reason === 'unfit') {
    notice = t('feedback.toast.unfit', null, L);
  } else if (res.reason === 'embed_failed') {
    notice = t('feedback.toast.embedFailed', null, L);
  } else {
    notice = t('feedback.toast.failed', null, L);
  }
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(notice))
    .build();
}

/**
 * Reads a card form-input value across the two shapes CardService flips
 * between (`e.formInput` vs `e.commonEventObject.formInputs`). Used to
 * re-populate the rule editor's name / keyword fields after a color-grid
 * re-render, and to read them on submit in actionAddRule. Returns "" when
 * absent.
 */
function readRuleFormValue(e, fieldName) {
  if (e && e.formInput && e.formInput[fieldName]) {
    return e.formInput[fieldName];
  }
  if (
    e && e.commonEventObject && e.commonEventObject.formInputs &&
    e.commonEventObject.formInputs[fieldName] &&
    e.commonEventObject.formInputs[fieldName].stringInputs &&
    e.commonEventObject.formInputs[fieldName].stringInputs.value &&
    e.commonEventObject.formInputs[fieldName].stringInputs.value.length > 0
  ) {
    return e.commonEventObject.formInputs[fieldName].stringInputs.value[0];
  }
  return "";
}

// Parameter budget (chars) for the pass-through categories snapshot.
// CardService action-parameter limits are undocumented; 8192 is a
// conservative budget (~70+ rules at ~100 bytes/rule — well past the
// "규칙 수십 개" target population) pending a live measurement. Over
// budget → the parameter is omitted and the color pick falls back to fetch.
var CATEGORIES_SNAPSHOT_PARAM_MAX_CHARS = 8192;

/**
 * card-latency #01 — serializes the trimmed `{id, keyword, colorId,
 * backgroundColor, labelId, labelDeleted, labelDeletable}` rules list for the grid
 * pass-through parameter.
 * Returns null when the list is unavailable (fetch error) or the JSON
 * exceeds the parameter budget, so callers omit the parameter and the
 * re-render fetches instead.
 */
function serializeCategoriesSnapshot(rules) {
  if (!Array.isArray(rules)) return null;
  var json;
  try {
    json = JSON.stringify(rules.map(function (r) {
      return {
        id: r.id,
        keyword: r.keyword,
        colorId: r.colorId,
        backgroundColor: r.backgroundColor || null,
        labelId: r.labelId || null,
        labelDeleted: !!r.labelDeleted,
        labelDeletable: !!r.labelDeletable,
      };
    }));
  } catch (_err) {
    return null;
  }
  if (json.length > CATEGORIES_SNAPSHOT_PARAM_MAX_CHARS) return null;
  return json;
}

/**
 * card-latency #01 — reads the pass-through categories snapshot stashed by
 * buildRuleManagementCard on the color-pick action. Returns null if absent
 * or unparsable so the caller falls back to a fresh fetch. Checks both the
 * `e.parameters` and `commonEventObject.parameters` shapes the framework
 * flips between (same convention as readStashedLlmPreview).
 */
function readCategoriesSnapshot(e) {
  var raw = null;
  if (e && e.parameters && e.parameters.categoriesSnapshotJson) {
    raw = e.parameters.categoriesSnapshotJson;
  } else if (
    e && e.commonEventObject && e.commonEventObject.parameters &&
    e.commonEventObject.parameters.categoriesSnapshotJson
  ) {
    raw = e.commonEventObject.parameters.categoriesSnapshotJson;
  }
  if (!raw) return null;
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Screen 4: Rule Management Card.
 *
 * `categoriesSnapshot` (optional) — a trimmed `[{id, keyword, colorId,
 * backgroundColor, labelId, labelDeleted, labelDeletable}]` list already fetched earlier in
 * the same render
 * cycle (card-latency #01).
 * When present, the builder reuses it instead of re-fetching
 * `/api/categories` — a pure-UI re-render (color pick) must not cost a
 * backend roundtrip. Consecutive color picks re-carry it on purpose:
 * every pick is fetch-free (#01 AC), not just the first — do NOT "fix"
 * this into a one-shot. It is still NOT a cache: it lives only in this
 * card's action parameters; any mutation (add/delete) or card exit
 * discards it — the mutation render uses the fresh list its own response
 * carries (#02), so the Halt-on-Failure "no cache" contract holds. When
 * absent, behavior is unchanged (fetch + AUTH_EXPIRED short-circuit).
 */
function buildRuleManagementCard(e, categoriesSnapshot) {
  var L = pickLocale(e);
  var fetched;
  if (categoriesSnapshot) {
    fetched = { rules: categoriesSnapshot };
  } else {
    // Session check up front — AUTH_EXPIRED short-circuits to the reconnect
    // card so the user gets an OAuth re-login button instead of being stranded
    // on an inline error. Mirrors actionSyncNow / actionAddRule / actionDeleteRule.
    fetched = fetchCategoriesOrError();
    if (fetched.error === 'AUTH_EXPIRED') {
      return buildReconnectCard(null, L);
    }
  }

  var builder = CardService.newCardBuilder();

  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText(t('common.back', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);

  // §5.1 (ADR-0004) — the editor separates the two seed roles the embedding
  // classifier consumes: `name` (1개·필수, the rule's UI label AND a seed) and
  // `keyword` (0..N·선택 intent phrases). Splitting them across sections makes
  // "1 required vs 0..N optional" read visually; the keyword bundle collapses
  // to keep the narrow card uncluttered.
  var priorName = readRuleFormValue(e, 'rule_name');
  var priorKeywords = readRuleFormValue(e, 'rule_keywords');

  var createSection = CardService.newCardSection()
    .setHeader(t('rules.section.create', null, L));

  createSection.addWidget(CardService.newTextInput()
    .setFieldName("rule_name")
    .setTitle(t('rules.name.label', null, L))
    .setHint(t('rules.name.hint', null, L))
    .setValue(priorName));

  builder.addSection(createSection);

  // Keywords are optional intent phrases (CONTEXT.md "Keyword") — embedded into
  // the rule's meaning, never string-matched. Collapsed by default to reduce
  // card clutter. (examples 묶음 collapse는 #05 소관 — examples UI 가 거기서
  // 처음 렌더된다.)
  // Collapsed (0 widgets shown) when empty to de-clutter the narrow card; but
  // when a color-pick re-render carries prior keyword text, show both widgets so
  // the user's typed input isn't hidden behind the collapse (mirrors the rule-
  // card form-state-preservation fix — TODO.md).
  var keywordSection = CardService.newCardSection()
    .setHeader(t('rules.section.keywords', null, L))
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(priorKeywords ? 2 : 0);

  keywordSection.addWidget(CardService.newTextParagraph()
    .setText(t('rules.keywords.help', null, L)));

  keywordSection.addWidget(CardService.newTextInput()
    .setFieldName("rule_keywords")
    .setTitle(t('rules.keywords.label', null, L))
    .setHint(t('rules.keywords.hint', null, L))
    .setValue(priorKeywords));

  builder.addSection(keywordSection);

  // Color + submit trail the create flow (name → keywords → color → add) so the
  // primary action sits at the bottom of the card.
  var colorSection = CardService.newCardSection();

  // card-latency #01 — carry the already-fetched list on the color-pick
  // action so its re-render skips the /api/categories roundtrip. Omitted
  // (→ fetch fallback) when the list errored or exceeds the parameter
  // budget. Only the color-pick action gets it: mutation actions
  // (add/delete) must NOT reuse this stale snapshot — they rebuild from
  // the updated list their own mutation response carries (#02).
  var colorPickAction = CardService.newAction()
    .setFunctionName("actionSelectColorForRule");
  var snapshotJson = serializeCategoriesSnapshot(fetched.rules);
  if (snapshotJson) {
    colorPickAction.setParameters({ categoriesSnapshotJson: snapshotJson });
  }

  var colorGrid = CardService.newGrid()
    .setTitle(t('rules.colorPicker', null, L))
    .setNumColumns(6)
    .setOnClickAction(colorPickAction);

  // native-labels #03 (ADR-0006) — 24 default label-slot hex swatches
  // (inline data URIs, no external image host). The grid identifier is the
  // hex itself; actionAddRule sends it as `backgroundColor` so the backend
  // creates the Google label + Rule in one step.
  var swatches = getLabelSwatches();

  var selectedHex = null;
  if (e && e.parameters && e.parameters.selectedHexForRule) {
    selectedHex = e.parameters.selectedHexForRule;
  } else if (e && e.commonEventObject && e.commonEventObject.parameters && e.commonEventObject.parameters.selectedHexForRule) {
    selectedHex = e.commonEventObject.parameters.selectedHexForRule;
  }

  swatches.forEach(function(c) {
    var url = (c.hex === selectedHex) ? c.selectedUrl : c.url;
    colorGrid.addItem(CardService.newGridItem()
      .setIdentifier(c.hex)
      .setImage(CardService.newImageComponent()
        .setImageUrl(url)
        .setCropStyle(CardService.newImageCropStyle().setImageCropType(CardService.ImageCropType.CIRCLE))));
  });

  colorSection.addWidget(colorGrid);

  var addAction = CardService.newAction().setFunctionName("actionAddRule");
  if (selectedHex) {
    addAction = addAction.setParameters({ selectedHexForRule: selectedHex });
  }
  colorSection.addWidget(CardService.newTextButton()
    .setText(t('rules.btn.add', null, L))
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(addAction));

  builder.addSection(colorSection);

  var listSection = CardService.newCardSection()
    .setHeader(t('rules.section.list', null, L));

  // AUTH_EXPIRED already short-circuited above; only non-auth errors land here.
  var rules = fetched.rules || [];
  if (fetched.error) {
    listSection.addWidget(CardService.newDecoratedText()
      .setText(t('rules.list.loadFailed', { error: fetched.error }, L))
      .setWrapText(true));
  } else if (rules.length === 0) {
    listSection.addWidget(CardService.newDecoratedText()
      .setText(t('rules.list.empty', null, L))
      .setWrapText(true));
  } else {
    rules.sort(function(a, b) {
      return getRuleColorOrderIndex(a) - getRuleColorOrderIndex(b);
    });
    rules.forEach(function(rule) {
      // Row icon renders the label's real color (read-only under ADR-0006 —
      // the canonical value lives in Google Calendar and reaches us as
      // `backgroundColor`; the legacy colorId is too lossy to draw from).
      var colorUrl = getSwatchForRule(rule).url;

      // ADR-0008 — the row button no longer deletes; it opens a confirm card.
      // Deletion is irreversible (the backend tombstone is never cleared) and
      // takes the rule's saved correction examples with it, none of which is
      // visible from this row. The card also hosts the "delete the Google
      // label too" choice, so one surface covers both variants.
      // Action parameters must be strings.
      var deleteButton = CardService.newTextButton()
        .setText(t('rules.btn.delete', null, L))
        .setOnClickAction(CardService.newAction()
          .setFunctionName("actionGoToRuleDeleteConfirm")
          .setParameters({
            id: rule.id,
            name: rule.keyword || '',
            labelDeletable: rule.labelDeletable ? '1' : ''
          }));

      var rowText = CardService.newDecoratedText()
        .setStartIcon(CardService.newIconImage().setIconUrl(colorUrl).setImageCropType(CardService.ImageCropType.CIRCLE))
        .setText(rule.keyword)
        .setButton(deleteButton);
      // native-labels #03 — the backing Google label is gone; the rule is
      // excluded from classification and shown with a badge (부활 금지).
      if (rule.labelDeleted) {
        rowText.setBottomLabel(t('rules.badge.labelDeleted', null, L));
      }
      listSection.addWidget(rowText);
    });
  }

  listSection.addWidget(CardService.newDivider());
  listSection.addWidget(CardService.newDecoratedText()
    .setText(t('rules.list.note', null, L))
    .setWrapText(true));
  // ADR-0006 관리 비대칭 — rename/recolor/delete of labels happens in
  // Google Calendar (no deep link exists for the label dialog; text only).
  listSection.addWidget(CardService.newDecoratedText()
    .setText(t('rules.manageInGoogle', null, L))
    .setWrapText(true));

  builder.addSection(listSection);

  return builder.build();
}

function actionSelectColorForRule(e) {
  var L = pickLocale(e);
  // GAS CardService Grid clicks deliver the GridItem.setIdentifier() value
  // under the key `grid_item_identifier` (verified empirically — the docs
  // do not name the key). `selectedHexForRule` is also accepted for
  // forward-compat with any future setParameters-based path.
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};

  var selectedHex =
    p1.grid_item_identifier || p2.grid_item_identifier ||
    p1.selectedHexForRule || p2.selectedHexForRule ||
    null;

  if (!selectedHex) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('color.toast.unrecognized', null, L)))
      .build();
  }

  if (!e.parameters) e.parameters = {};
  e.parameters.selectedHexForRule = selectedHex;

  // card-latency #01 — reuse the list this render already carries; null
  // (absent / over budget / unparsable) falls back to the builder's fetch.
  var categoriesSnapshot = readCategoriesSnapshot(e);

  // Labels have no color names (ADR-0006) — the toast is generic.
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e, categoriesSnapshot)))
    .setNotification(CardService.newNotification().setText(t('rules.toast.colorPicked', null, L)))
    .build();
}

function actionAddRule(e) {
  var L = pickLocale(e);
  var nameRaw = readRuleFormValue(e, 'rule_name');
  if (!nameRaw || !nameRaw.trim()) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.nameRequired', null, L)))
      .build();
  }
  var name = nameRaw.trim();

  // Keywords are optional intent-phrase seeds (CONTEXT.md "Keyword"; §5.1) —
  // embedded into the rule's meaning, no longer substring needles, so a comma
  // just separates independent seeds. Empty is allowed: the rule name is itself
  // a seed (#02 name create-or-replace), so we fall back to [name] to satisfy
  // the backend CreateBody `keywords.min(1)` contract without a backend change.
  var keywords = readRuleFormValue(e, 'rule_keywords')
    .split(',')
    .map(function (k) { return k.trim(); })
    .filter(function (k) { return k.length > 0; });
  if (keywords.length === 0) {
    keywords = [name];
  }

  var selectedHex = (e.parameters && e.parameters.selectedHexForRule)
    || (e.commonEventObject && e.commonEventObject.parameters
        ? e.commonEventObject.parameters.selectedHexForRule
        : null);
  if (!selectedHex) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.colorFirst', null, L)))
      .build();
  }

  try {
    // native-labels #03 — `backgroundColor` (hex) makes the backend create
    // the Google label AND the Rule in one step (labelId linked; colorId
    // cache filled server-side). Label-create failure → no Rule (에러 반환).
    var res = AutoColorAPI.fetchBackend('/api/categories', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        name: name,
        backgroundColor: selectedHex,
        keywords: keywords
      })
    });
    // card-latency #02 — rebuild from the POST response's updated list;
    // null (missing/unparsable) falls back to the builder's own fetch.
    var updatedRules = readCategoriesFromMutationResponse(res);
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e, updatedRules)))
      .setNotification(CardService.newNotification().setText(t('rules.toast.added', null, L)))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED' || err.message.indexOf('reauth') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
        .build();
    }
    if (err.message.indexOf('duplicate_name') !== -1 || err.message.indexOf('409') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText(t('rules.toast.duplicate', null, L)))
        .build();
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.saveFailed', { message: err.message }, L)))
      .build();
  }
}

/**
 * ADR-0008 — reads an action parameter across the two shapes the framework
 * flips between (same convention as `readCategoriesSnapshot`).
 */
function readActionParam(e, key) {
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};
  return p1[key] || p2[key] || '';
}

/**
 * ADR-0008 — rule deletion confirm card.
 *
 * Two reasons this card exists, and both matter:
 *  1. Deletion is irreversible. The backend writes a tombstone that is never
 *     auto-cleared (부활 금지), and it drops the rule's `rule_seeds` — which
 *     include the correction examples the user taught it. None of that is
 *     visible from the row's Delete button, which until now fired instantly.
 *  2. It hosts the "delete the Google colour label too" choice.
 *
 * The checkbox is rendered ONLY when the backend says `labelDeletable` — i.e.
 * the Add-on minted that label. A label the user made in Google Calendar may
 * be worn by events this app has never touched, so removing it is theirs to
 * do; that case gets an explanatory line instead. Default CHECKED: rule
 * creation makes the name and the colour in one step, so deletion mirroring
 * it is the least surprising default, and the hint spells out the cost.
 */
function buildRuleDeleteConfirmCard(L, params) {
  var builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader()
    .setTitle(t('rules.delete.title', null, L))
    .setSubtitle(t('rules.delete.subtitle', { name: params.name }, L)));

  var warnSection = CardService.newCardSection();
  warnSection.addWidget(CardService.newDecoratedText()
    .setText(t('rules.delete.warning', null, L))
    .setWrapText(true));

  if (params.labelDeletable) {
    var checkbox = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setFieldName("deleteLabel")
      .addItem(t('rules.delete.alsoDeleteLabel', null, L), "on", true);
    warnSection.addWidget(checkbox);
    warnSection.addWidget(CardService.newDecoratedText()
      .setText(t('rules.delete.alsoDeleteLabel.hint', null, L))
      .setWrapText(true));
  } else {
    warnSection.addWidget(CardService.newDecoratedText()
      .setText(t('rules.delete.labelFromGoogle', null, L))
      .setWrapText(true));
  }
  builder.addSection(warnSection);

  // Same shape as buildAccountDeleteConfirmCard: cancel first and plain,
  // destructive action last and FILLED.
  var actionSection = CardService.newCardSection();
  actionSection.addWidget(CardService.newButtonSet()
    .addButton(CardService.newTextButton()
      .setText(t('rules.delete.btn.cancel', null, L))
      .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack")))
    .addButton(CardService.newTextButton()
      .setText(t('rules.delete.btn.confirm', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction()
        .setFunctionName("actionDeleteRule")
        .setParameters({ id: params.id }))));
  builder.addSection(actionSection);

  return builder.build();
}

function actionGoToRuleDeleteConfirm(e) {
  var L = pickLocale(e);
  var id = readActionParam(e, 'id');
  if (!id) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.deleteIdMissing', null, L)))
      .build();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildRuleDeleteConfirmCard(L, {
      id: id,
      name: readActionParam(e, 'name'),
      labelDeletable: readActionParam(e, 'labelDeletable') === '1'
    })))
    .build();
}

/**
 * ADR-0008 — confirmed rule deletion. Reached from the confirm card, so the
 * checkbox (when rendered) arrives as a form input on this very click.
 */
function actionDeleteRule(e) {
  var L = pickLocale(e);
  var id = readActionParam(e, 'id');
  if (!id) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.deleteIdMissing', null, L)))
      .build();
  }
  // Absent checkbox (label not ours) reads as "" → no flag. The backend
  // re-checks provenance regardless; this only asks.
  var alsoDeleteLabel = readRuleFormValue(e, 'deleteLabel') === 'on';
  // `fetchBackend` has no params option — the query string is part of the path.
  var endpoint = '/api/categories/' + encodeURIComponent(id) +
    (alsoDeleteLabel ? '?deleteLabel=1' : '');
  try {
    var res = AutoColorAPI.fetchBackend(endpoint, { method: 'delete' });
    // card-latency #02 — rebuild from the DELETE response's updated list;
    // null (missing/unparsable) falls back to the builder's own fetch.
    var updatedRules = readCategoriesFromMutationResponse(res);
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popCard().updateCard(buildRuleManagementCard(e, updatedRules)))
      .setNotification(CardService.newNotification().setText(ruleDeleteToast(res, alsoDeleteLabel, L)))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
        .build();
    }
    // A 404 here means the rule is already gone, which is the outcome the
    // user asked for — not a failure. `api.js` retries 5xx three times, so a
    // Worker that committed the delete and then dropped the connection gets a
    // second DELETE that trips the tombstone guard and 404s. Reporting that
    // as "삭제 실패" on an irreversible action would be actively misleading;
    // the route's 404 contract stays as-is and is absorbed here.
    if (err.message && err.message.indexOf('CLIENT_ERROR: 404') === 0) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popCard().updateCard(buildRuleManagementCard(e, null)))
        .setNotification(CardService.newNotification().setText(t('rules.toast.deleted', null, L)))
        .build();
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.deleteFailed', { message: err.message }, L)))
      .build();
  }
}

/**
 * ADR-0008 — picks the delete toast from what the backend actually did, not
 * from what was asked. `labelDeleted` is authoritative: the request may have
 * carried the flag and still been declined (provenance) or failed (Google).
 */
function ruleDeleteToast(res, alsoDeleteLabel, L) {
  if (!alsoDeleteLabel) return t('rules.toast.deleted', null, L);
  var labelDeleted = false;
  try {
    var body = JSON.parse(res.getContentText() || '{}');
    labelDeleted = !!(body && body.labelDeleted);
  } catch (_err) {
    // Unparsable body — fall through to the conservative message rather than
    // claiming a deletion we cannot confirm.
  }
  return labelDeleted
    ? t('rules.toast.deletedWithLabel', null, L)
    : t('rules.toast.deletedLabelFailed', null, L);
}

/**
 * Screen 5: Settings Card.
 */
/**
 * ADR-0007 — the one-time example-storage consent surface. Pushed the first
 * time a user saves a correction with "remember" ticked; the backend's 403
 * `consent_required` is the sole trigger, so this card cannot be bypassed by
 * a stale client. Carries the pending correction so agreeing replays it.
 */
function buildExampleConsentCard(L, params) {
  var builder = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle(t('feedback.consent.title', null, L))
      .setSubtitle(t('feedback.consent.subtitle', null, L)));

  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph()
    .setText(t('feedback.consent.body', null, L)));
  ['what', 'where', 'retention', 'revoke'].forEach(function (k) {
    section.addWidget(CardService.newTextParagraph()
      .setText('• ' + t('feedback.consent.bullet.' + k, null, L)));
  });
  section.addWidget(CardService.newTextButton()
    .setText(t('feedback.consent.policyLink', null, L))
    .setOpenLink(CardService.newOpenLink()
      .setUrl(ACFC_CONFIG.PRIVACY_POLICY_EXAMPLES_URL)));
  builder.addSection(section);

  var grantAction = CardService.newAction()
    .setFunctionName("actionGrantExampleConsent")
    .setParameters({
      pendingRuleId: (params && params.pendingRuleId) || '',
      pendingTitle: (params && params.pendingTitle) || '',
      pendingLabelId: (params && params.pendingLabelId) || '',
    });

  builder.setFixedFooter(CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(t('feedback.consent.btn.agree', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(grantAction))
    .setSecondaryButton(CardService.newTextButton()
      .setText(t('feedback.consent.btn.cancel', null, L))
      .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));

  return builder.build();
}

function actionGrantExampleConsent(e) {
  var L = pickLocale(e);
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};

  var res = postExampleConsentOrError();
  if (res.error === 'AUTH_EXPIRED') {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
      .build();
  }
  if (res.error) {
    // A version mismatch means this Add-on build renders disclosure text the
    // backend no longer considers current — refuse rather than record it.
    var msg = res.error.indexOf('policy_version_mismatch') !== -1
      ? t('feedback.consent.toast.versionMismatch', null, L)
      : t('feedback.consent.toast.failed', null, L);
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popCard())
      .setNotification(CardService.newNotification().setText(msg))
      .build();
  }

  // Consent recorded — replay the correction that triggered this card.
  var ruleId = p1.pendingRuleId || p2.pendingRuleId || '';
  var title = p1.pendingTitle || p2.pendingTitle || '';
  if (!ruleId || !title) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popCard())
      .setNotification(CardService.newNotification().setText(t('feedback.consent.toast.granted', null, L)))
      .build();
  }

  var stored = postExampleOrError({ ruleId: ruleId, title: title });
  var notice;
  if (stored.stored === true) {
    notice = t('feedback.consent.toast.granted', null, L);
  } else if (stored.reason === 'unfit') {
    notice = t('feedback.toast.unfit', null, L);
  } else if (stored.reason === 'embed_failed') {
    notice = t('feedback.toast.embedFailed', null, L);
  } else {
    notice = t('feedback.toast.failed', null, L);
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .setNotification(CardService.newNotification().setText(notice))
    .build();
}

/**
 * ADR-0007 — withdrawal confirm. The warning must state that withdrawal
 * deletes every stored example immediately and irreversibly; that is the
 * commitment privacy-policy §2.5 makes to the user.
 */
function buildExampleConsentRevokeCard(L) {
  var builder = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle(t('revokeExamples.title', null, L)));

  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph()
    .setText(t('revokeExamples.warning', null, L)));
  builder.addSection(section);

  builder.setFixedFooter(CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(t('revokeExamples.btn.confirm', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionRevokeExampleConsent")))
    .setSecondaryButton(CardService.newTextButton()
      .setText(t('common.back', null, L))
      .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));

  return builder.build();
}

function actionGoToExampleConsentRevokeConfirm(e) {
  var L = pickLocale(e);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildExampleConsentRevokeCard(L)))
    .build();
}

function actionRevokeExampleConsent(e) {
  var L = pickLocale(e);
  var res = deleteExampleConsentOrError();
  if (res.error === 'AUTH_EXPIRED') {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
      .build();
  }
  if (res.error) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('revokeExamples.toast.failed', null, L)))
      .build();
  }
  var count = typeof res.purgedExamples === 'number' ? res.purgedExamples : 0;
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildSettingsCard(L)))
    .setNotification(CardService.newNotification().setText(t('revokeExamples.toast.done', { count: count }, L)))
    .build();
}

function buildSettingsCard(L) {
  var builder = CardService.newCardBuilder();

  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText(t('common.back', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);

  // (2026-07-29) The "정책 설정" checkbox group that used to live here —
  // prevent_overwrite / use_llm / use_description — was decoration: no
  // onChange, no save handler, and no backing column anywhere in
  // `src/db/schema.ts`. Meanwhile the privacy policy promised a "규칙 기반
  // 분류만 사용" opt-out on the strength of it. Rendering a toggle that
  // cannot be honoured is a misrepresentation in the UI itself, so the group
  // is removed and the policy's LLM opt-out claim was withdrawn in the same
  // change (privacy-policy §4.2 / §5.1). A real per-user LLM switch, if ever
  // wanted, is a schema + chain-gate + settings-write feature — not a
  // checkbox.

  // ADR-0007 — example-storage consent state + withdrawal entry point.
  // Skipped entirely before the §12 notice window opens: no consent can exist
  // yet, so the section would render "동의한 적 없음" and spend a backend
  // round-trip to learn it.
  if (exampleStorageIsOpen()) {
    var examplesSection = CardService.newCardSection()
      .setHeader(t('settings.section.examples', null, L));
    var consent = fetchExampleConsentOrError();
    if (consent && consent.granted === true) {
      var when = '';
      try {
        when = consent.grantedAt ? new Date(consent.grantedAt).toLocaleDateString() : '';
      } catch (_err) {}
      examplesSection.addWidget(CardService.newDecoratedText()
        .setText(t('settings.examples.granted', { date: when }, L))
        .setWrapText(true));
      examplesSection.addWidget(CardService.newTextButton()
        .setText(t('settings.btn.revokeExamples', null, L))
        .setOnClickAction(CardService.newAction().setFunctionName("actionGoToExampleConsentRevokeConfirm")));
    } else {
      // Covers "never granted", "withdrawn" and a fetch failure alike — the
      // withdrawal button is only meaningful against a confirmed live consent.
      examplesSection.addWidget(CardService.newDecoratedText()
        .setText(t('settings.examples.notGranted', null, L))
        .setWrapText(true));
    }
    builder.addSection(examplesSection);
  }

  var accountSection = CardService.newCardSection()
    .setHeader(t('settings.section.account', null, L));

  var email = "user@example.com";
  try {
    email = Session.getActiveUser().getEmail() || email;
  } catch (err) {}

  accountSection.addWidget(CardService.newDecoratedText()
    .setText(email)
    .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.PERSON)));

  accountSection.addWidget(CardService.newTextButton()
    .setText(t('settings.btn.logout', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionLogout")));

  accountSection.addWidget(CardService.newTextButton()
    .setText(t('settings.btn.deleteAccount', null, L))
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToAccountDeleteConfirm")));

  builder.addSection(accountSection);

  return builder.build();
}

function actionLogout(e) {
  var L = pickLocale(e);
  AutoColorAuth.clearSessionToken();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard(L)))
    .setNotification(CardService.newNotification().setText(t('auth.toast.loggedOut', null, L)))
    .build();
}

function actionGoToAccountDeleteConfirm(e) {
  var L = pickLocale(e);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildAccountDeleteConfirmCard(L)))
    .build();
}

function buildAccountDeleteConfirmCard(L) {
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle(t('delete.title', null, L))
    .setSubtitle(t('delete.subtitle', null, L)));

  var warningSection = CardService.newCardSection();
  warningSection.addWidget(CardService.newDecoratedText()
    .setText(t('delete.warning', null, L))
    .setWrapText(true));

  builder.addSection(warningSection);

  var actionSection = CardService.newCardSection();
  actionSection.addWidget(CardService.newButtonSet()
    .addButton(CardService.newTextButton()
      .setText(t('delete.btn.cancel', null, L))
      .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack")))
    .addButton(CardService.newTextButton()
      .setText(t('delete.btn.confirm', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionConfirmDeleteAccount"))));

  builder.addSection(actionSection);

  return builder.build();
}

function actionConfirmDeleteAccount(e) {
  var L = pickLocale(e);
  try {
    AutoColorAPI.fetchBackend('/api/account/delete', { method: 'post' });
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('delete.toast.failed', { message: err.message }, L)))
      .build();
  }
  // Clear local state AFTER the 200 so a transient network failure leaves
  // the GAS client able to retry without a re-login. clearAllState 도 함께
  // 호출해 같은 Google 계정으로 즉시 재온보딩할 때 onboarding 안내가
  // 새 24h 윈도우로 다시 노출되도록 한다.
  AutoColorStorage.clearAllState();
  AutoColorAuth.clearSessionToken();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard(L)))
    .setNotification(CardService.newNotification().setText(t('delete.toast.done', null, L)))
    .build();
}

/**
 * doGet renders the OAuth bounce-back HTML (callback success or error).
 * Locale comes from Session.getActiveUserLocale() since the bounce-back
 * page is served outside the add-on event flow. The HTML files are
 * `HtmlTemplate`s with scriptlets that pull translations via t() at
 * render time — see authCallback.html / authError.html.
 */
function doGet(e) {
  var L = pickLocale(null);
  var token = e && e.parameter && e.parameter.token;
  if (token) {
    AutoColorAuth.saveSessionToken(token);
    var okTpl = HtmlService.createTemplateFromFile('authCallback');
    okTpl.locale = L;
    return okTpl.evaluate();
  }
  var errTpl = HtmlService.createTemplateFromFile('authError');
  errTpl.locale = L;
  errTpl.errorBundle = getAuthErrorBundle(L);
  return errTpl.evaluate();
}

function buildReconnectCard(errorMsg, L) {
  L = L || 'en';
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle(t('reconnect.title', null, L))
    .setSubtitle(t('reconnect.subtitle', null, L)));

  var msgSection = CardService.newCardSection();
  msgSection.addWidget(CardService.newDecoratedText()
    .setText(errorMsg || t('reconnect.body', null, L))
    .setWrapText(true));

  builder.addSection(msgSection);

  // Same footer contract as buildWelcomeCard — a re-auth that did not reload
  // the add-on left the user on this card with no signal that the reconnect
  // had already succeeded.
  builder.setFixedFooter(buildAuthFooter(t('reconnect.cta', null, L), L));

  return builder.build();
}

/**
 * Event Update Trigger
 */
function onEventUpdate(e) {
  var L = pickLocale(e);
  var builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader().setTitle(t('eventUpdate.title', null, L)));

  var section = CardService.newCardSection();
  section.addWidget(CardService.newDecoratedText()
    .setText(t('eventUpdate.body', null, L))
    .setWrapText(true));

  builder.addSection(section);
  return builder.build();
}

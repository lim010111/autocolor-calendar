// `getCalendarColors(locale)` and `COLOR_PALETTE` live in gas/i18n.js — both
// are exposed as global functions/vars in Apps Script's flat scope.

function getColorOrderIndex(colorId) {
  for (var i = 0; i < COLOR_PALETTE.length; i++) {
    if (COLOR_PALETTE[i].id === colorId) return i;
  }
  return Number.MAX_SAFE_INTEGER;
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

  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(t('welcome.cta.login', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionStartOAuth")));

  builder.setFixedFooter(fixedFooter);

  return builder.build();
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
    var rules = (body.categories || []).map(function (c) {
      return {
        id: c.id,
        // 다중 키워드 규칙도 사용자가 입력한 원문 라벨(name)을 그대로 보여주도록.
        // 과거에는 keywords[0]만 사용해서 "프로젝트, 개발" 입력이 "프로젝트"로만 표시됐음.
        keyword: c.name || (c.keywords && c.keywords[0]) || "",
        colorId: c.colorId,
      };
    });
    return { rules: rules };
  } catch (err) {
    return { error: err.message };
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
  var appliedColorLabel = t('colors.default', null, L);
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
      var rawColorId = event.colorId;
      if (rawColorId) {
        var colors = getCalendarColors(L);
        for (var ci = 0; ci < colors.length; ci++) {
          if (colors[ci].id === rawColorId) {
            appliedColorLabel = colors[ci].label;
            break;
          }
        }
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

  statusSection.addWidget(CardService.newDecoratedText()
    .setText(t('event.appliedColor', { label: appliedColorLabel }, L)));

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

  // Use Grid widget for visualizing colors
  var colorGrid = CardService.newGrid()
    .setTitle(t('event.colorPicker', null, L))
    .setNumColumns(6)
    .setOnClickAction(CardService.newAction().setFunctionName("actionSelectColor"));

  // Mock placeholders for color icons
  var colors = getCalendarColors(L);

  var selectedColorId = null;
  if (e && e.parameters && e.parameters.selectedColorId) {
    selectedColorId = e.parameters.selectedColorId;
  } else if (e && e.commonEventObject && e.commonEventObject.parameters && e.commonEventObject.parameters.selectedColorId) {
    selectedColorId = e.commonEventObject.parameters.selectedColorId;
  }

  colors.forEach(function(c) {
    var url = (c.id === selectedColorId) ? c.selectedUrl : c.url;
    colorGrid.addItem(CardService.newGridItem()
      .setIdentifier(c.id)
      .setImage(CardService.newImageComponent()
        .setImageUrl(url)
        .setCropStyle(CardService.newImageCropStyle().setImageCropType(CardService.ImageCropType.CIRCLE))));
  });

  overrideSection.addWidget(colorGrid);

  overrideSection.addWidget(CardService.newTextButton()
    .setText(t('event.btn.exclude', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionExcludeEvent")));

  builder.addSection(overrideSection);

  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(t('event.btn.save', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionSaveEventOverride")));

  builder.setFixedFooter(fixedFooter);

  return builder.build();
}

function actionSelectColor(e) {
  var L = pickLocale(e);
  // See actionSelectColorForRule comment for why `grid_item_identifier`
  // is the documented-by-empiricism key for GAS Grid click callbacks.
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};

  var selectedColorId =
    p1.grid_item_identifier || p2.grid_item_identifier ||
    p1.selectedColorId || p2.selectedColorId ||
    null;

  if (!selectedColorId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('color.toast.unrecognized', null, L)))
      .build();
  }

  var colors = getCalendarColors(L);
  var selectedLabel = t('colors.fallback', null, L);
  for (var i = 0; i < colors.length; i++) {
    if (colors[i].id === selectedColorId) {
      selectedLabel = colors[i].label;
      break;
    }
  }

  if (!e.parameters) e.parameters = {};
  e.parameters.selectedColorId = selectedColorId;

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
 * Per-event manual color override. Posts the user's grid pick to
 * `POST /api/events/:calendarId/:eventId/color`, which PATCHes the
 * event's `colorId` AND clears the §5.4 ownership marker so the next
 * sync respects the user's choice as `skipped_manual`.
 *
 * Pre-fetch guards: bail with a toast if the user hasn't picked a color
 * or the event context is missing. Success toast fires only AFTER the
 * 200 response — never before — so the user is never told the apply
 * succeeded when it didn't.
 */
function actionSaveEventOverride(e) {
  var L = pickLocale(e);
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};
  var selectedColorId = p1.selectedColorId || p2.selectedColorId || null;

  if (!selectedColorId) {
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
      payload: JSON.stringify({ colorId: selectedColorId }),
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

  // 200 응답 이후에만 success toast 출력. 색상 라벨 포함해서 어떤 색이
  // 적용됐는지 사용자에게 명확히 표시.
  var colors = getCalendarColors(L);
  var label = t('colors.fallback', null, L);
  for (var i = 0; i < colors.length; i++) {
    if (colors[i].id === selectedColorId) {
      label = colors[i].label;
      break;
    }
  }
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(t('override.toast.success', { label: label }, L)))
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
 * card-latency #01 — serializes the trimmed `{id, keyword, colorId}` rules
 * list for the color-grid pass-through parameter. Returns null when the
 * list is unavailable (fetch error) or the JSON exceeds the parameter
 * budget, so callers omit the parameter and the re-render fetches instead.
 */
function serializeCategoriesSnapshot(rules) {
  if (!Array.isArray(rules)) return null;
  var json;
  try {
    json = JSON.stringify(rules.map(function (r) {
      return { id: r.id, keyword: r.keyword, colorId: r.colorId };
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
 * `categoriesSnapshot` (optional) — a trimmed `[{id, keyword, colorId}]`
 * list already fetched earlier in the same render cycle (card-latency #01).
 * When present, the builder reuses it instead of re-fetching
 * `/api/categories` — a pure-UI re-render (color pick) must not cost a
 * backend roundtrip. This is NOT a cache: the snapshot lives only in the
 * current card's action parameters and dies with the render cycle, so the
 * Halt-on-Failure "no cache" contract holds. When absent, behavior is
 * unchanged (fetch + AUTH_EXPIRED short-circuit).
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
  // (add/delete) must re-fetch to show the updated list.
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

  var colors = getCalendarColors(L);

  var selectedColorId = null;
  if (e && e.parameters && e.parameters.selectedColorIdForRule) {
    selectedColorId = e.parameters.selectedColorIdForRule;
  } else if (e && e.commonEventObject && e.commonEventObject.parameters && e.commonEventObject.parameters.selectedColorIdForRule) {
    selectedColorId = e.commonEventObject.parameters.selectedColorIdForRule;
  }

  colors.forEach(function(c) {
    var url = (c.id === selectedColorId) ? c.selectedUrl : c.url;
    colorGrid.addItem(CardService.newGridItem()
      .setIdentifier(c.id)
      .setImage(CardService.newImageComponent()
        .setImageUrl(url)
        .setCropStyle(CardService.newImageCropStyle().setImageCropType(CardService.ImageCropType.CIRCLE))));
  });

  colorSection.addWidget(colorGrid);

  var addAction = CardService.newAction().setFunctionName("actionAddRule");
  if (selectedColorId) {
    addAction = addAction.setParameters({ selectedColorIdForRule: selectedColorId });
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
      return getColorOrderIndex(a.colorId) - getColorOrderIndex(b.colorId);
    });
    rules.forEach(function(rule) {
      var colorObj = null;
      for (var i = 0; i < colors.length; i++) {
        if (colors[i].id === rule.colorId) {
          colorObj = colors[i];
          break;
        }
      }
      var colorUrl = colorObj ? colorObj.url : "";

      var deleteButton = CardService.newTextButton()
        .setText(t('rules.btn.delete', null, L))
        .setOnClickAction(CardService.newAction()
          .setFunctionName("actionDeleteRule")
          .setParameters({id: rule.id}));

      listSection.addWidget(CardService.newDecoratedText()
        .setStartIcon(CardService.newIconImage().setIconUrl(colorUrl).setImageCropType(CardService.ImageCropType.CIRCLE))
        .setText(rule.keyword)
        .setButton(deleteButton));
    });
  }

  listSection.addWidget(CardService.newDivider());
  listSection.addWidget(CardService.newDecoratedText()
    .setText(t('rules.list.note', null, L))
    .setWrapText(true));

  builder.addSection(listSection);

  return builder.build();
}

function actionSelectColorForRule(e) {
  var L = pickLocale(e);
  // GAS CardService Grid clicks deliver the GridItem.setIdentifier() value
  // under the key `grid_item_identifier` (verified empirically — the docs
  // do not name the key). `selectedColorIdForRule` is also accepted for
  // forward-compat with any future setParameters-based path.
  var p1 = (e && e.parameters) || {};
  var p2 = (e && e.commonEventObject && e.commonEventObject.parameters) || {};

  var selectedColorId =
    p1.grid_item_identifier || p2.grid_item_identifier ||
    p1.selectedColorIdForRule || p2.selectedColorIdForRule ||
    null;

  if (!selectedColorId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('color.toast.unrecognized', null, L)))
      .build();
  }

  var colors = getCalendarColors(L);
  var selectedLabel = t('colors.fallback', null, L);
  for (var i = 0; i < colors.length; i++) {
    if (colors[i].id === selectedColorId) {
      selectedLabel = colors[i].label;
      break;
    }
  }

  if (!e.parameters) e.parameters = {};
  e.parameters.selectedColorIdForRule = selectedColorId;

  // card-latency #01 — reuse the list this render already carries; null
  // (absent / over budget / unparsable) falls back to the builder's fetch.
  var categoriesSnapshot = readCategoriesSnapshot(e);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e, categoriesSnapshot)))
    .setNotification(CardService.newNotification().setText(t('color.toast.selected', { label: selectedLabel }, L)))
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

  var selectedColorId = (e.parameters && e.parameters.selectedColorIdForRule)
    || (e.commonEventObject && e.commonEventObject.parameters
        ? e.commonEventObject.parameters.selectedColorIdForRule
        : null);
  if (!selectedColorId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.colorFirst', null, L)))
      .build();
  }

  try {
    AutoColorAPI.fetchBackend('/api/categories', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        name: name,
        colorId: selectedColorId,
        keywords: keywords
      })
    });
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e)))
      .setNotification(CardService.newNotification().setText(t('rules.toast.added', null, L)))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
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

function actionDeleteRule(e) {
  var L = pickLocale(e);
  var id = e.parameters && e.parameters.id;
  if (!id) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.deleteIdMissing', null, L)))
      .build();
  }
  try {
    AutoColorAPI.fetchBackend('/api/categories/' + encodeURIComponent(id), {
      method: 'delete'
    });
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e)))
      .setNotification(CardService.newNotification().setText(t('rules.toast.deleted', null, L)))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard(null, L)))
        .build();
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(t('rules.toast.deleteFailed', { message: err.message }, L)))
      .build();
  }
}

/**
 * Screen 5: Settings Card.
 */
function buildSettingsCard(L) {
  var builder = CardService.newCardBuilder();

  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText(t('common.back', null, L))
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);

  var section = CardService.newCardSection()
    .setHeader(t('settings.section.policy', null, L));

  var policyGroup = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .setFieldName("policy_settings");

  policyGroup.addItem(t('settings.policy.preventOverwrite', null, L), "prevent_overwrite", true);
  policyGroup.addItem(t('settings.policy.useLlm', null, L), "use_llm", true);
  policyGroup.addItem(t('settings.policy.useDescription', null, L), "use_description", false);

  section.addWidget(policyGroup);
  builder.addSection(section);

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

function actionStartOAuth(e) {
  var L = pickLocale(e);
  if (AutoColorAuth.isAuthenticated()) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildHomeCard(L)))
      .setNotification(CardService.newNotification().setText(t('auth.toast.loggedIn', null, L)))
      .build();
  }

  var scriptProps = PropertiesService.getScriptProperties();
  var authUrl = scriptProps.getProperty('OAUTH_AUTH_URL') || "https://api.example.com/oauth/google";

  return CardService.newActionResponseBuilder()
    .setOpenLink(CardService.newOpenLink()
      .setUrl(authUrl)
      .setOpenAs(CardService.OpenAs.FULL_SIZE)
      .setOnClose(CardService.OnClose.RELOAD_ADD_ON))
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

  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText(t('reconnect.cta', null, L))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionReconnectOAuth")));

  builder.setFixedFooter(fixedFooter);

  return builder.build();
}

function actionReconnectOAuth(e) {
  // Reconnect logic delegates to normal OAuth flow
  return actionStartOAuth(e);
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

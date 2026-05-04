function getCalendarColors() {
  return [
    { id: "11", label: "토마토", url: "https://placehold.co/48x48/D50000/D50000.png?text=%20&radius=24" },
    { id: "4", label: "플라밍고", url: "https://placehold.co/48x48/E67C73/E67C73.png?text=%20&radius=24" },
    { id: "6", label: "귤", url: "https://placehold.co/48x48/F4511E/F4511E.png?text=%20&radius=24" },
    { id: "5", label: "바나나", url: "https://placehold.co/48x48/F6BF26/F6BF26.png?text=%20&radius=24" },
    { id: "2", label: "세이지", url: "https://placehold.co/48x48/33B679/33B679.png?text=%20&radius=24" },
    { id: "10", label: "바질", url: "https://placehold.co/48x48/0B8043/0B8043.png?text=%20&radius=24" },
    { id: "7", label: "공작", url: "https://placehold.co/48x48/039BE5/039BE5.png?text=%20&radius=24" },
    { id: "9", label: "블루베리", url: "https://placehold.co/48x48/3F51B5/3F51B5.png?text=%20&radius=24" },
    { id: "1", label: "라벤더", url: "https://placehold.co/48x48/7986CB/7986CB.png?text=%20&radius=24" },
    { id: "3", label: "포도", url: "https://placehold.co/48x48/8E24AA/8E24AA.png?text=%20&radius=24" },
    { id: "8", label: "회연필", url: "https://placehold.co/48x48/616161/616161.png?text=%20&radius=24" }
  ];
}

/**
 * Entry point for the Google Workspace Add-on (Homepage Trigger).
 *
 * @param {Object} e - The event object.
 * @return {CardService.Card} The constructed Card.
 */
function buildAddOn(e) {
  var missing = missingBackendProperties();
  if (missing.length > 0) {
    return buildConfigNeededCard(missing);
  }

  if (!AutoColorAuth.isAuthenticated()) {
    return buildWelcomeCard();
  }

  // 백엔드 연동된 상태에서는 로컬 스토리지 상의 온보딩 여부도 true로 강제 설정 (하위 호환 및 일관성)
  AutoColorStorage.setOnboarded(true);

  return buildHomeCard();
}

/**
 * Returns the list of required ScriptProperties that are not set. The
 * Add-on needs both to reach the backend: BACKEND_BASE_URL for every API
 * call in gas/api.js, and OAUTH_AUTH_URL for the "로그인" button to open
 * the right /oauth/google endpoint.
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
function buildConfigNeededCard(missingKeys) {
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle("백엔드 구성 필요")
    .setSubtitle("관리자 설정이 완료되지 않았습니다"));

  var section = CardService.newCardSection();
  section.addWidget(CardService.newDecoratedText()
    .setText("이 애드온은 외부 백엔드에 연결되어 동작합니다. Apps Script 프로젝트의 스크립트 속성에서 아래 값이 설정되어야 합니다:")
    .setWrapText(true));

  for (var i = 0; i < missingKeys.length; i++) {
    section.addWidget(CardService.newDecoratedText()
      .setText("• " + missingKeys[i])
      .setWrapText(true));
  }

  section.addWidget(CardService.newDecoratedText()
    .setText("설정 위치: Apps Script 편집기 → 프로젝트 설정(⚙) → 스크립트 속성 → 스크립트 속성 추가")
    .setWrapText(true));

  builder.addSection(section);
  return builder.build();
}

/**
 * Screen 1: Welcome Card (온보딩 및 권한 부여)
 */
function buildWelcomeCard() {
  var builder = CardService.newCardBuilder();
  
  builder.setHeader(CardService.newCardHeader()
    .setTitle("AutoColor 사용 가이드")
    .setSubtitle("AI가 캘린더를 예쁘게 정리해 드립니다.")
    .setImageUrl("https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png"));
    
  var tutorialSection = CardService.newCardSection().setHeader("💡 이렇게 사용해보세요!");
  
  tutorialSection.addWidget(CardService.newDecoratedText()
    .setTopLabel("1단계. 규칙 만들기")
    .setText("키워드(예: '회의')와 원하는 색상을 선택해 나만의 규칙을 만드세요.")
    .setWrapText(true));
    
  tutorialSection.addWidget(CardService.newDecoratedText()
    .setTopLabel("2단계. 일정 등록하기")
    .setText("평소처럼 캘린더에 일정을 등록합니다. 제목이나 설명에 키워드가 포함되면 됩니다.")
    .setWrapText(true));
    
  tutorialSection.addWidget(CardService.newDecoratedText()
    .setTopLabel("3단계. 자동 색상 적용")
    .setText("백그라운드에서 AutoColor가 자동으로 일정을 찾아 예쁜 색상을 입혀줍니다! ✨")
    .setWrapText(true));
    
  builder.addSection(tutorialSection);

  var authSection = CardService.newCardSection();
  authSection.addWidget(CardService.newDecoratedText()
    .setText("시작하려면 Google 계정 연동이 필요합니다. 진행하면 개인정보처리방침 및 서비스 약관에 동의하는 것으로 간주됩니다. (정식 링크는 출시 시점에 제공됩니다.)")
    .setWrapText(true));
    
  builder.addSection(authSection);
  
  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText("Google 계정으로 시작하기")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionStartOAuth")));
      
  builder.setFixedFooter(fixedFooter);
  
  return builder.build();
}



/**
 * Screen 2: Home Card (메인 대시보드 - homepageTrigger)
 *
 * Fetches /api/stats synchronously on every render (UrlFetchApp is blocking
 * in GAS). AUTH_EXPIRED falls through to the reconnect card so homepage
 * entry from an expired session doesn't show a blank dashboard. Empty-state
 * (no syncs yet): classification.updated = 0 + lastSync = null → renders
 * "아직 분류된 일정이 없습니다" + "아직 동기화하지 않았습니다".
 */
function buildHomeCard() {
  var stats = fetchStatsOrError();
  if (stats && stats.error === 'AUTH_EXPIRED') {
    return buildReconnectCard();
  }

  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle("AutoColor 대시보드"));

  var section = CardService.newCardSection();

  var switchControl = CardService.newSwitch()
    .setFieldName("auto_color_enabled")
    .setValue("true")
    .setSelected(true)
    .setOnChangeAction(CardService.newAction().setFunctionName("actionToggleAutoColor"));

  section.addWidget(CardService.newDecoratedText()
    .setText("자동 분류 활성화")
    .setSwitchControl(switchControl));

  var classifiedLine;
  var syncLine;
  var llmLine = null;
  if (!stats || stats.error) {
    classifiedLine = "통계를 불러오지 못했습니다";
    syncLine = "잠시 후 다시 시도해주세요";
  } else {
    var updatedCount = (stats.classification && stats.classification.updated) || 0;
    classifiedLine = updatedCount > 0
      ? "최근 7일 분류된 일정: " + updatedCount + "건"
      : "아직 분류된 일정이 없습니다";

    var finishedAt = stats.lastSync && stats.lastSync.finishedAt;
    syncLine = finishedAt
      ? "최근 동기화: " + formatRelativeTime(finishedAt)
      : "아직 동기화하지 않았습니다";

    var hits = stats.llm && stats.llm.hits;
    var avg = stats.llm && stats.llm.avgLatencyMs;
    if (hits && hits > 0) {
      llmLine = avg != null
        ? "AI 분류: " + hits + "건 성공 / 평균 " + avg + "ms"
        : "AI 분류: " + hits + "건 성공";
    }
  }

  section.addWidget(CardService.newDecoratedText()
    .setText(classifiedLine)
    .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.BOOKMARK)));

  section.addWidget(CardService.newDecoratedText()
    .setText(syncLine)
    .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.CLOCK)));

  if (llmLine) {
    section.addWidget(CardService.newDecoratedText()
      .setText(llmLine)
      .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.STAR)));
  }

  builder.addSection(section);

  var actionSection = CardService.newCardSection();

  var ruleButton = CardService.newTextButton()
    .setText("매핑 규칙 관리")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToRuleManagement"));

  var settingsButton = CardService.newTextButton()
    .setText("상세 설정")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToSettings"));

  actionSection.addWidget(CardService.newButtonSet()
    .addButton(ruleButton)
    .addButton(settingsButton));

  builder.addSection(actionSection);

  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText("지금 즉시 동기화")
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
 * ISO timestamp → "방금" / "N분 전" / "N시간 전" / "N일 전".
 * Used only by the homecard; deliberately coarse so the label stays stable
 * across render/rerender cycles within a minute.
 */
function formatRelativeTime(iso) {
  var ms = Date.now() - Date.parse(iso);
  if (!isFinite(ms) || ms < 0) return "방금";
  var minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return minutes + "분 전";
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "시간 전";
  var days = Math.floor(hours / 24);
  return days + "일 전";
}

function actionToggleAutoColor(e) {
  var isEnabled = e.formInput.auto_color_enabled === "true";
  var msg = isEnabled ? "자동 분류가 활성화되었습니다." : "자동 분류가 비활성화되었습니다.";
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(msg))
    .build();
}

function actionSyncNow(e) {
  try {
    AutoColorAPI.fetchBackend('/sync/run', {
      method: 'post',
      contentType: 'application/json',
      payload: '{}'
    });
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("동기화를 시작했습니다. 잠시 후 반영됩니다."))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED' || err.message.indexOf('reauth') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard()))
        .build();
    }
    if (err.message.indexOf('429') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText("조금 전 동기화했습니다. 잠시 후 다시 시도해주세요."))
        .build();
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("동기화 실패: " + err.message))
      .build();
  }
}

function actionGoBack(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

function actionGoToRuleManagement(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildRuleManagementCard()))
    .build();
}

function actionGoToSettings(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard()))
    .build();
}

/**
 * Calls the backend classify preview endpoint. Rule-only classifier — LLM
 * fallback runs during sync, not here, to keep sidebar latency predictable.
 * Returns { source, category?, matchedKeyword?, llmAvailable? } on 200 or
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
 * Builds the "매칭된 규칙" status line. Mirrors the preview-endpoint
 * outcomes (rule / llm / no_match ± llmTried) plus the network-error
 * fallback. Kept as a pure formatter so UI copy tweaks don't require
 * reaching into onEventOpen's control flow.
 */
function formatMatchLine(preview) {
  if (!preview) return "매칭된 규칙 없음";
  if (preview.error) {
    if (preview.error === 'AUTH_EXPIRED') return "재로그인이 필요합니다";
    return "분류 정보를 가져오지 못했습니다";
  }
  if (preview.source === 'rule' && preview.category) {
    var name = preview.category.name || "규칙";
    if (preview.matchedKeyword) {
      return "매칭된 규칙: '" + name + "' (키워드: '" + preview.matchedKeyword + "')";
    }
    return "매칭된 규칙: '" + name + "'";
  }
  if (preview.source === 'llm' && preview.category) {
    var llmName = preview.category.name || "규칙";
    return "🤖 AI 분류: '" + llmName + "'";
  }
  if (preview.source === 'no_match' && preview.llmTried) {
    return "🤖 AI 분류 결과 없음";
  }
  if (preview.llmAvailable) {
    return "매칭된 규칙 없음 — 다음 동기화 시 AI 분류 시도";
  }
  return "매칭된 규칙 없음";
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
 * Screen 3: Event Insight Card (일정 상세 - eventOpenTrigger)
 *
 * Status section renders three live facts: event title (from CalendarApp),
 * applied colorId (from event.getColor()), and the current classification
 * (via POST /api/classify/preview). Preview is rule-only — if it misses,
 * we surface "다음 동기화 시 AI 분류 시도" when the backend has
 * OPENAI_API_KEY, otherwise "매칭된 규칙 없음".
 */
function onEventOpen(e) {
  var title = "선택된 일정 없음";
  var appliedColorLabel = "기본";
  var previewResult = null; // { source, category?, matchedKeyword?, llmAvailable?, llmTried?, error? }

  // §5 후속 — if actionClassifyWithLlm stashed an on-demand LLM preview in
  // the card parameters, use it instead of re-fetching rule-only. JSON
  // round-trips through parameters so the card re-render shows the LLM
  // result in place without a second network call.
  var stashed = readStashedLlmPreview(e);
  if (stashed) previewResult = stashed;

  if (e && e.calendar && e.calendar.id) {
    var event = null;
    try {
      event = CalendarApp.getCalendarById(e.calendar.calendarId).getEventById(e.calendar.id);
      title = event.getTitle() || "제목 없음";
    } catch (err) {
      // Calendar event inaccessible — title stays "선택된 일정 없음",
      // preview won't be fetched.
    }

    if (event) {
      // getColor() returns the CalendarApp.EventColor enum VALUE, which is
      // the raw colorId string ("1"-"11") or "" for the calendar default.
      try {
        var rawColorId = event.getColor();
        if (rawColorId) {
          var colors = getCalendarColors();
          for (var ci = 0; ci < colors.length; ci++) {
            if (colors[ci].id === rawColorId) {
              appliedColorLabel = colors[ci].label;
              break;
            }
          }
        }
      } catch (err) {
        // Leave default label on any EventColor access failure.
      }

      if (!previewResult) {
        previewResult = fetchPreviewOrError({
          summary: title,
          description: (function () {
            try { return event.getDescription() || ""; } catch (_) { return ""; }
          })(),
          location: (function () {
            try { return event.getLocation() || ""; } catch (_) { return ""; }
          })(),
        });
      }

      if (previewResult && previewResult.error === 'AUTH_EXPIRED') {
        return buildReconnectCard();
      }
    }
  }

  var builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader()
    .setTitle("일정 색상 분석")
    .setSubtitle(title));

  var statusSection = CardService.newCardSection()
    .setHeader("현재 상태");

  statusSection.addWidget(CardService.newDecoratedText()
    .setText("적용된 색상: " + appliedColorLabel));

  statusSection.addWidget(CardService.newDecoratedText()
    .setText(formatMatchLine(previewResult))
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
      .setText("🤖 AI 분류 확인")
      .setOnClickAction(CardService.newAction().setFunctionName("actionClassifyWithLlm")));
  }

  builder.addSection(statusSection);
  
  var overrideSection = CardService.newCardSection()
    .setHeader("수동 오버라이드 및 상태 변경");
    
  // Use Grid widget for visualizing colors
  var colorGrid = CardService.newGrid()
    .setTitle("색상 선택")
    .setNumColumns(6)
    .setOnClickAction(CardService.newAction().setFunctionName("actionSelectColor"));
    
  // Mock placeholders for color icons
  var colors = getCalendarColors();
  
  var selectedColorId = null;
  if (e && e.parameters && e.parameters.selectedColorId) {
    selectedColorId = e.parameters.selectedColorId;
  } else if (e && e.commonEventObject && e.commonEventObject.parameters && e.commonEventObject.parameters.selectedColorId) {
    selectedColorId = e.commonEventObject.parameters.selectedColorId;
  }

  colors.forEach(function(c) {
    var url = c.url;
    if (c.id === selectedColorId) {
      url = url.replace("text=%20", "text=%E2%9C%93");
    }
    colorGrid.addItem(CardService.newGridItem()
      .setIdentifier(c.id)
      .setImage(CardService.newImageComponent()
        .setImageUrl(url)
        .setCropStyle(CardService.newImageCropStyle().setImageCropType(CardService.ImageCropType.CIRCLE))));
  });
  
  overrideSection.addWidget(colorGrid);
  
  overrideSection.addWidget(CardService.newTextButton()
    .setText("이 일정은 자동 분류에서 제외")
    .setOnClickAction(CardService.newAction().setFunctionName("actionExcludeEvent")));
    
  builder.addSection(overrideSection);
  
  // Example of Error State section
  // var errorSection = CardService.newCardSection();
  // errorSection.addWidget(CardService.newDecoratedText()
  //   .setText("⚠️ AI 서버 응답이 지연되고 있습니다.")
  //   .setWrapText(true));
  // errorSection.addWidget(CardService.newTextButton()
  //   .setText("다시 시도")
  //   .setOnClickAction(CardService.newAction().setFunctionName("actionRetryAnalysis")));
  // builder.addSection(errorSection);
  
  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText("변경사항 저장")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionSaveEventOverride")));
      
  builder.setFixedFooter(fixedFooter);
  
  return builder.build();
}

function actionSelectColor(e) {
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
      .setNotification(CardService.newNotification().setText("색상을 인식하지 못했습니다. 다시 시도해주세요."))
      .build();
  }

  var colors = getCalendarColors();
  var selectedLabel = "색상";
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
    .setNotification(CardService.newNotification().setText(selectedLabel + " 색상이 선택되었습니다."))
    .build();
}

function actionExcludeEvent(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("자동 분류에서 제외되었습니다."))
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
  if (!e || !e.calendar || !e.calendar.id) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("선택된 일정을 찾지 못했습니다."))
      .build();
  }

  var event = null;
  try {
    event = CalendarApp.getCalendarById(e.calendar.calendarId).getEventById(e.calendar.id);
  } catch (_err) {
    event = null;
  }
  if (!event) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("일정 정보를 읽지 못했습니다."))
      .build();
  }

  var title = event.getTitle() || "제목 없음";
  var description = (function () {
    try { return event.getDescription() || ""; } catch (_) { return ""; }
  })();
  var location = (function () {
    try { return event.getLocation() || ""; } catch (_) { return ""; }
  })();

  var preview = fetchPreviewOrError({
    summary: title,
    description: description,
    location: location,
    llm: true,
  });

  if (preview && preview.error === 'AUTH_EXPIRED') {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard()))
      .build();
  }

  if (preview && preview.error) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("AI 분류 중 오류가 발생했습니다."))
      .build();
  }

  if (!e.parameters) e.parameters = {};
  e.parameters.llmPreviewJson = JSON.stringify(preview);

  var toastText;
  if (preview && preview.source === 'llm' && preview.category) {
    toastText = "AI 분류 완료: '" + (preview.category.name || "규칙") + "'";
  } else {
    toastText = "AI 분류 결과 없음";
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(onEventOpen(e)))
    .setNotification(CardService.newNotification().setText(toastText))
    .build();
}

function actionRetryAnalysis(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("재분석을 요청했습니다."))
    .build();
}

function actionSaveEventOverride(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("일정 색상이 업데이트되었습니다."))
    .build();
}

/**
 * Screen 4: Rule Management Card (규칙 관리)
 */
function buildRuleManagementCard(e) {
  // Session check up front — AUTH_EXPIRED short-circuits to the reconnect
  // card so the user gets an OAuth re-login button instead of being stranded
  // on an inline error. Mirrors actionSyncNow / actionAddRule / actionDeleteRule.
  var fetched = fetchCategoriesOrError();
  if (fetched.error === 'AUTH_EXPIRED') {
    return buildReconnectCard();
  }

  var builder = CardService.newCardBuilder();

  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText("⬅ 뒤로 가기")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);
  
  var addSection = CardService.newCardSection()
    .setHeader("새 규칙 추가");
    
  var priorKeyword = "";
  if (e && e.formInput && e.formInput.rule_keyword) {
    priorKeyword = e.formInput.rule_keyword;
  } else if (e && e.commonEventObject && e.commonEventObject.formInputs &&
             e.commonEventObject.formInputs.rule_keyword &&
             e.commonEventObject.formInputs.rule_keyword.stringInputs &&
             e.commonEventObject.formInputs.rule_keyword.stringInputs.value &&
             e.commonEventObject.formInputs.rule_keyword.stringInputs.value.length > 0) {
    priorKeyword = e.commonEventObject.formInputs.rule_keyword.stringInputs.value[0];
  }

  addSection.addWidget(CardService.newTextInput()
    .setFieldName("rule_keyword")
    .setTitle("키워드 (예: 회의, 미팅)")
    .setHint("콤마(,)로 여러 개 입력 가능")
    .setValue(priorKeyword));

  addSection.addWidget(CardService.newTextParagraph()
    .setText("<font color=\"#B06000\">⚠️ 2자 이하 키워드는 의도치 않은 이벤트까지 매칭될 수 있습니다.</font>"));

  var colorGrid = CardService.newGrid()
    .setTitle("캘린더 색상 선택")
    .setNumColumns(6)
    .setOnClickAction(CardService.newAction().setFunctionName("actionSelectColorForRule"));
    
  var colors = getCalendarColors();
  
  var selectedColorId = null;
  if (e && e.parameters && e.parameters.selectedColorIdForRule) {
    selectedColorId = e.parameters.selectedColorIdForRule;
  } else if (e && e.commonEventObject && e.commonEventObject.parameters && e.commonEventObject.parameters.selectedColorIdForRule) {
    selectedColorId = e.commonEventObject.parameters.selectedColorIdForRule;
  }

  var selectedColorLabel = null;
  colors.forEach(function(c) {
    var url = c.url;
    if (c.id === selectedColorId) {
      url = url.replace("text=%20", "text=%E2%9C%93");
      selectedColorLabel = c.label;
    }
    colorGrid.addItem(CardService.newGridItem()
      .setIdentifier(c.id)
      .setImage(CardService.newImageComponent()
        .setImageUrl(url)
        .setCropStyle(CardService.newImageCropStyle().setImageCropType(CardService.ImageCropType.CIRCLE))));
  });

  if (selectedColorLabel) {
    addSection.addWidget(CardService.newTextParagraph()
      .setText("선택된 색상: <b>" + selectedColorLabel + "</b>"));
  }

  addSection.addWidget(colorGrid);

  var addAction = CardService.newAction().setFunctionName("actionAddRule");
  if (selectedColorId) {
    addAction = addAction.setParameters({ selectedColorIdForRule: selectedColorId });
  }
  addSection.addWidget(CardService.newTextButton()
    .setText("규칙 추가")
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(addAction));

  addSection.addWidget(CardService.newDecoratedText()
    .setText("💡 키워드가 제목·설명에 부분 일치하면 색상이 적용됩니다. 수동으로 바꾼 색상은 보존됩니다.")
    .setWrapText(true));

  builder.addSection(addSection);

  var listSection = CardService.newCardSection()
    .setHeader("내 규칙 목록");

  listSection.addWidget(CardService.newDecoratedText()
    .setText("ℹ️ 이미 색이 지정된 일정은 자동 변경되지 않습니다. 규칙 추가 후 홈의 '지금 즉시 동기화'를 눌러 적용하세요.")
    .setWrapText(true));

  // AUTH_EXPIRED already short-circuited above; only non-auth errors land here.
  var rules = fetched.rules || [];
  if (fetched.error) {
    listSection.addWidget(CardService.newDecoratedText()
      .setText('⚠️ 규칙 목록을 불러오지 못했습니다: ' + fetched.error)
      .setWrapText(true));
  } else if (rules.length === 0) {
    listSection.addWidget(CardService.newDecoratedText()
      .setText("아직 등록된 규칙이 없습니다. 위에서 첫 규칙을 만들어보세요.")
      .setWrapText(true));
  } else {
    var colors = getCalendarColors();
    rules.forEach(function(rule) {
      var colorObj = null;
      for (var i = 0; i < colors.length; i++) {
        if (colors[i].id === rule.colorId) {
          colorObj = colors[i];
          break;
        }
      }
      var colorName = colorObj ? colorObj.label : "색상 없음";
      var colorUrl = colorObj ? colorObj.url : "";

      var deleteButton = CardService.newTextButton()
        .setText("삭제")
        .setOnClickAction(CardService.newAction()
          .setFunctionName("actionDeleteRule")
          .setParameters({id: rule.id}));

      listSection.addWidget(CardService.newDecoratedText()
        .setStartIcon(CardService.newIconImage().setIconUrl(colorUrl).setImageCropType(CardService.ImageCropType.CIRCLE))
        .setText(rule.keyword)
        .setBottomLabel(colorName)
        .setButton(deleteButton));
    });
  }
    
  builder.addSection(listSection);
  
  return builder.build();
}

function actionSelectColorForRule(e) {
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
      .setNotification(CardService.newNotification().setText("색상을 인식하지 못했습니다. 다시 시도해주세요."))
      .build();
  }

  var colors = getCalendarColors();
  var selectedLabel = "색상";
  for (var i = 0; i < colors.length; i++) {
    if (colors[i].id === selectedColorId) {
      selectedLabel = colors[i].label;
      break;
    }
  }

  if (!e.parameters) e.parameters = {};
  e.parameters.selectedColorIdForRule = selectedColorId;

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e)))
    .setNotification(CardService.newNotification().setText(selectedLabel + " 색상이 선택되었습니다."))
    .build();
}

function actionAddRule(e) {
  var keywordRaw = e.formInput && e.formInput.rule_keyword;
  if (!keywordRaw || !keywordRaw.trim()) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("키워드를 입력해주세요."))
      .build();
  }

  // 콤마(,)로 구분된 입력을 개별 키워드 배열로 split. backend `classifier.ts`는
  // `keywords[]` 각 원소를 substring 매칭하므로, 단일 문자열로 보내면
  // "프로젝트, 개발" 전체가 needle이 되어 어떤 이벤트에도 매칭되지 않음.
  var keywords = keywordRaw
    .split(',')
    .map(function (k) { return k.trim(); })
    .filter(function (k) { return k.length > 0; });
  if (keywords.length === 0) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("키워드를 입력해주세요."))
      .build();
  }

  var selectedColorId = (e.parameters && e.parameters.selectedColorIdForRule)
    || (e.commonEventObject && e.commonEventObject.parameters
        ? e.commonEventObject.parameters.selectedColorIdForRule
        : null);
  if (!selectedColorId) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("색상을 먼저 선택해주세요."))
      .build();
  }

  try {
    AutoColorAPI.fetchBackend('/api/categories', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        name: keywordRaw.trim(),
        colorId: selectedColorId,
        keywords: keywords
      })
    });
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard()))
      .setNotification(CardService.newNotification().setText("새 규칙이 저장되었습니다."))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard()))
        .build();
    }
    if (err.message.indexOf('duplicate_name') !== -1 || err.message.indexOf('409') !== -1) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText("이미 같은 이름의 규칙이 있습니다."))
        .build();
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("규칙 저장 실패: " + err.message))
      .build();
  }
}

function actionDeleteRule(e) {
  var id = e.parameters && e.parameters.id;
  if (!id) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("삭제할 규칙을 찾을 수 없습니다."))
      .build();
  }
  try {
    AutoColorAPI.fetchBackend('/api/categories/' + encodeURIComponent(id), {
      method: 'delete'
    });
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e)))
      .setNotification(CardService.newNotification().setText("규칙이 삭제되었습니다. 적용된 색상은 곧 원상복구됩니다."))
      .build();
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildReconnectCard()))
        .build();
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("규칙 삭제 실패: " + err.message))
      .build();
  }
}

/**
 * Screen 5: Settings Card (상세 설정)
 */
function buildSettingsCard() {
  var builder = CardService.newCardBuilder();
  
  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText("⬅ 뒤로 가기")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);
  
  var section = CardService.newCardSection()
    .setHeader("정책 설정");
    
  var policyGroup = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .setFieldName("policy_settings");
    
  policyGroup.addItem("수동 색상 덮어쓰기 방지", "prevent_overwrite", true);
  policyGroup.addItem("AI(LLM) 자동 추론 사용", "use_llm", true);
  policyGroup.addItem("설명(Description) 필드도 분석에 포함", "use_description", false);
  
  section.addWidget(policyGroup);
  builder.addSection(section);
  
  var accountSection = CardService.newCardSection()
    .setHeader("계정 관리");

  var email = "user@example.com";
  try {
    email = Session.getActiveUser().getEmail() || email;
  } catch (err) {}

  accountSection.addWidget(CardService.newDecoratedText()
    .setText(email)
    .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.PERSON)));

  accountSection.addWidget(CardService.newTextButton()
    .setText("로그아웃")
    .setOnClickAction(CardService.newAction().setFunctionName("actionLogout")));

  accountSection.addWidget(CardService.newTextButton()
    .setText("서비스 해지 (Cancel Service)")
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToCancelConfirm")));

  accountSection.addWidget(CardService.newTextButton()
    .setText("계정 삭제 / 데이터 삭제")
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToAccountDeleteConfirm")));

  builder.addSection(accountSection);

  return builder.build();
}

function actionLogout(e) {
  // 로그아웃 시 토큰 폐기
  AutoColorAuth.clearSessionToken();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard()))
    .setNotification(CardService.newNotification().setText("로그아웃 되었습니다."))
    .build();
}

function actionGoToCancelConfirm(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildCancelConfirmCard()))
    .build();
}

function buildCancelConfirmCard() {
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle("서비스 해지")
    .setSubtitle("정말 해지하시겠습니까?"));

  var warningSection = CardService.newCardSection();
  warningSection.addWidget(CardService.newDecoratedText()
    .setText("⚠️ <b>주의</b>: 모든 설정과 연동된 규칙이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.")
    .setWrapText(true));

  builder.addSection(warningSection);

  var actionSection = CardService.newCardSection();
  actionSection.addWidget(CardService.newButtonSet()
    .addButton(CardService.newTextButton()
      .setText("⬅ 취소")
      .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack")))
    .addButton(CardService.newTextButton()
      .setText("네, 해지합니다")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionConfirmCancelService"))));

  builder.addSection(actionSection);

  return builder.build();
}

function actionConfirmCancelService(e) {
  AutoColorStorage.clearAllState();

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard()))
    .setNotification(CardService.newNotification().setText("서비스가 해지되었습니다."))
    .build();
}

function actionGoToAccountDeleteConfirm(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildAccountDeleteConfirmCard()))
    .build();
}

function buildAccountDeleteConfirmCard() {
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle("계정 삭제")
    .setSubtitle("정말 삭제하시겠습니까?"));

  var warningSection = CardService.newCardSection();
  warningSection.addWidget(CardService.newDecoratedText()
    .setText("⚠️ <b>주의</b>: 모든 데이터가 영구 삭제됩니다. 카테고리·동기화 상태·OAuth 연결·세션이 모두 제거되며, 이 작업은 되돌릴 수 없습니다.")
    .setWrapText(true));

  builder.addSection(warningSection);

  var actionSection = CardService.newCardSection();
  actionSection.addWidget(CardService.newButtonSet()
    .addButton(CardService.newTextButton()
      .setText("⬅ 취소")
      .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack")))
    .addButton(CardService.newTextButton()
      .setText("네, 삭제합니다")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionConfirmDeleteAccount"))));

  builder.addSection(actionSection);

  return builder.build();
}

function actionConfirmDeleteAccount(e) {
  try {
    AutoColorAPI.fetchBackend('/api/account/delete', { method: 'post' });
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("계정 삭제 실패: " + err.message))
      .build();
  }
  // Clear local state AFTER the 200 so a transient network failure leaves
  // the GAS client able to retry without a re-login.
  AutoColorAuth.clearSessionToken();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard()))
    .setNotification(CardService.newNotification().setText("계정이 삭제되었습니다."))
    .build();
}

function actionStartOAuth(e) {
  if (AutoColorAuth.isAuthenticated()) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildHomeCard()))
      .setNotification(CardService.newNotification().setText("인증이 완료되었습니다."))
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

function doGet(e) {
  var token = e.parameter.token;
  if (token) {
    AutoColorAuth.saveSessionToken(token);
    return HtmlService.createHtmlOutputFromFile('authCallback');
  }
  return HtmlService.createHtmlOutputFromFile('authError');
}

function buildReconnectCard(errorMsg) {
  var builder = CardService.newCardBuilder();

  builder.setHeader(CardService.newCardHeader()
    .setTitle("재연결 필요")
    .setSubtitle("권한 부족 또는 토큰 만료"));

  var msgSection = CardService.newCardSection();
  msgSection.addWidget(CardService.newDecoratedText()
    .setText(errorMsg || "세션이 만료되었거나 권한이 부족합니다. 다시 연결해주세요.")
    .setWrapText(true));

  builder.addSection(msgSection);

  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText("OAuth 연동 (재로그인)")
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
  var builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader().setTitle("일정 업데이트"));
  
  var section = CardService.newCardSection();
  section.addWidget(CardService.newDecoratedText()
    .setText("일정 변경 사항이 적용되었습니다.")
    .setWrapText(true));
    
  builder.addSection(section);
  return builder.build();
}

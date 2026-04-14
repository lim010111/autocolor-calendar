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
  if (!AutoColorAuth.isAuthenticated()) {
    return buildWelcomeCard();
  }
  
  // 백엔드 연동된 상태에서는 로컬 스토리지 상의 온보딩 여부도 true로 강제 설정 (하위 호환 및 일관성)
  AutoColorStorage.setOnboarded(true);
  
  return buildHomeCard();
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
    .setText("시작하려면 Google 계정 연동이 필요합니다. 가입 시 <a href='https://example.com/privacy'>개인정보처리방침</a> 및 <a href='https://example.com/terms'>서비스 약관</a>에 동의하는 것으로 간주됩니다.")
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
 */
function buildHomeCard() {
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
    
  section.addWidget(CardService.newDecoratedText()
    .setText("이번 주 분류된 일정: 15건")
    .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.BOOKMARK)));
    
  section.addWidget(CardService.newDecoratedText()
    .setText("최근 동기화: 10분 전")
    .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.CLOCK)));
    
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

function actionToggleAutoColor(e) {
  var isEnabled = e.formInput.auto_color_enabled === "true";
  var msg = isEnabled ? "자동 분류가 활성화되었습니다." : "자동 분류가 비활성화되었습니다.";
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(msg))
    .build();
}

function actionSyncNow(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("동기화가 완료되었습니다."))
    .build();
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

function getMockRules() {
  return [
    { keyword: "주간회의", colorId: "9" },
    { keyword: "개인 일정", colorId: "2" }
  ];
}

/**
 * Screen 3: Event Insight Card (일정 상세 - eventOpenTrigger)
 */
function onEventOpen(e) {
  var title = "선택된 일정 없음";
  if (e && e.calendar && e.calendar.id) {
    try {
      var event = CalendarApp.getCalendarById(e.calendar.calendarId).getEventById(e.calendar.id);
      title = event.getTitle() || "제목 없음";
    } catch(err) {
      // Cannot access event or event doesn't exist
    }
  }

  var builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader()
    .setTitle("일정 색상 분석")
    .setSubtitle(title));
  
  var statusSection = CardService.newCardSection()
    .setHeader("현재 상태");
    
  statusSection.addWidget(CardService.newDecoratedText()
    .setText("적용된 색상: 🔵 파란색"));
    
  statusSection.addWidget(CardService.newDecoratedText()
    .setText("매칭된 규칙: '주간회의' (규칙 기반)"));
    
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
  var selectedColorId = e.parameters.selectedColorId || (e.commonEventObject && e.commonEventObject.parameters ? e.commonEventObject.parameters.selectedColorId : null) || e.parameters.id;

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
  var builder = CardService.newCardBuilder();
  
  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText("⬅ 뒤로 가기")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);
  
  var addSection = CardService.newCardSection()
    .setHeader("새 규칙 추가");
    
  addSection.addWidget(CardService.newTextInput()
    .setFieldName("rule_keyword")
    .setTitle("키워드 (예: 주간회의)"));
    
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
  
  addSection.addWidget(colorGrid);
  
  addSection.addWidget(CardService.newTextButton()
    .setText("규칙 추가")
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName("actionAddRule")));
    
  builder.addSection(addSection);
  
  var listSection = CardService.newCardSection()
    .setHeader("내 규칙 목록");
    
  var rules = getMockRules();
  
  if (rules.length === 0) {
    listSection.addWidget(CardService.newDecoratedText()
      .setText("아직 등록된 규칙이 없습니다. 위에서 첫 규칙을 만들어보세요.")
      .setWrapText(true));
  } else {
    var colors = getCalendarColors();
    rules.forEach(function(rule, index) {
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
          .setParameters({index: index.toString()}));
          
      listSection.addWidget(CardService.newDecoratedText()
        .setStartIcon(CardService.newIconImage().setIconUrl(colorUrl).setImageCropType(CardService.ImageCropType.CIRCLE))
        .setText(rule.keyword)
        .setBottomLabel(colorName)
        .setButton(deleteButton));
    });
  }
  
  listSection.addWidget(CardService.newDecoratedText()
    .setText("💡 복잡한 규칙은 <a href='https://example.com'>웹 대시보드</a>에서 관리하세요.")
    .setWrapText(true));
    
  builder.addSection(listSection);
  
  return builder.build();
}

function actionSelectColorForRule(e) {
  var selectedColorId = e.parameters.selectedColorId || (e.commonEventObject && e.commonEventObject.parameters ? e.commonEventObject.parameters.selectedColorId : null) || e.parameters.id;

  var colors = getCalendarColors();

  var selectedLabel = "색상";
  for (var i = 0; i < colors.length; i++) {
    if (colors[i].id === selectedColorId) {
      selectedLabel = colors[i].label;
      break;
    }
  }

  // Update properties to save the selected color for this rule
  if (selectedColorId) {
      try {
        var userProps = PropertiesService.getUserProperties();
        userProps.setProperty("selectedColorIdForRule", selectedColorId);
      } catch (err) {}
  }
  
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard()))
    .setNotification(CardService.newNotification().setText(selectedLabel + " 색상이 선택되었습니다."))
    .build();
}

function actionAddRule(e) {
  var keyword = e.formInput.rule_keyword;
  if (!keyword) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("키워드를 입력해주세요."))
      .build();
  }
  
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard()))
    .setNotification(CardService.newNotification().setText("새 규칙이 저장되었습니다."))
    .build();
}

function actionDeleteRule(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard(e)))
    .setNotification(CardService.newNotification().setText("규칙이 삭제되었습니다."))
    .build();
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

  builder.addSection(accountSection);

  return builder.build();
}

function actionLogout(e) {
  // 로그아웃 시 토큰 폐기 및 로컬 폴백.
  AutoColorAuth.clearSessionToken();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard()))
    .setNotification(CardService.newNotification().setText("로그아웃 되었습니다. Stage 1 모드로 전환됩니다."))
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
  try {
    AutoColorTriggers.clearManagedTriggers();
  } catch (err) {
    console.error("Failed to clear triggers:", err);
  }
  AutoColorStorage.clearAllState();

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard()))
    .setNotification(CardService.newNotification().setText("서비스가 해지되었습니다."))
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

  CardService.newAuthorizationException()
    .setAuthorizationUrl(authUrl)
    .setResourceDisplayName("AutoColor Backend")
    .setCustomUiCallback("buildWelcomeCard")
    .throwException();
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

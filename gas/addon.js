/**
 * Entry point for the Google Workspace Add-on (Homepage Trigger).
 *
 * @param {Object} e - The event object.
 * @return {CardService.Card} The constructed Card.
 */
function buildAddOn(e) {
  // For MVP/testing, we default to the Home Card.
  // In a full implementation, you'd check a user property here to see if they are onboarded,
  // and if not, return buildWelcomeCard() instead.
  var isOnboarded = true; // Mock state
  
  if (!isOnboarded) {
    return buildWelcomeCard();
  }
  return buildHomeCard();
}

/**
 * Screen 1: Welcome Card (온보딩 및 권한 부여)
 */
function buildWelcomeCard() {
  var builder = CardService.newCardBuilder();
  
  builder.setHeader(CardService.newCardHeader()
    .setTitle("AI가 캘린더를 예쁘게 정리해 드립니다.")
    .setImageUrl("https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png"));
    
  var section = CardService.newCardSection();
  
  section.addWidget(CardService.newDecoratedText()
    .setText("✨ 캘린더 자동 색상 분류")
    .setWrapText(true));
    
  section.addWidget(CardService.newDecoratedText()
    .setText("🔒 안전한 개인정보 보호")
    .setWrapText(true));
  
  section.addWidget(CardService.newDecoratedText()
    .setText("가입 시 <a href='https://example.com/privacy'>개인정보처리방침</a> 및 <a href='https://example.com/terms'>서비스 약관</a>에 동의하는 것으로 간주됩니다.")
    .setWrapText(true));
    
  builder.addSection(section);
  
  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText("Google 계정으로 시작하기")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName("actionCompleteOnboarding")));
      
  builder.setFixedFooter(fixedFooter);
  
  return builder.build();
}

function actionCompleteOnboarding(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildHomeCard()))
    .setNotification(CardService.newNotification().setText("환영합니다!"))
    .build();
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
    { keyword: "회의", colorLabel: "🔵 파란색" },
    { keyword: "개인", colorLabel: "🟢 초록색" }
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
    .setNumColumns(4)
    .setOnClickAction(CardService.newAction().setFunctionName("actionSelectColor"));
    
  // Mock placeholders for color icons
  var colors = [
    { id: "1", label: "파랑", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" },
    { id: "2", label: "초록", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" },
    { id: "4", label: "주황", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" },
    { id: "11", label: "빨강", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" }
  ];
  
  colors.forEach(function(c) {
    colorGrid.addItem(CardService.newGridItem()
      .setIdentifier(c.id)
      .setTitle(c.label)
      .setImage(CardService.newImageComponent().setImageUrl(c.url)));
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
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("색상이 선택되었습니다."))
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
function buildRuleManagementCard() {
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
    .setNumColumns(4)
    .setOnClickAction(CardService.newAction().setFunctionName("actionSelectColorForRule"));
    
  var colors = [
    { id: "1", label: "파랑", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" },
    { id: "2", label: "초록", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" },
    { id: "4", label: "주황", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" },
    { id: "11", label: "빨강", url: "https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png" }
  ];
  
  colors.forEach(function(c) {
    colorGrid.addItem(CardService.newGridItem()
      .setIdentifier(c.id)
      .setTitle(c.label)
      .setImage(CardService.newImageComponent().setImageUrl(c.url)));
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
    rules.forEach(function(rule, index) {
      var deleteButton = CardService.newTextButton()
        .setText("삭제 🗑️")
        .setOnClickAction(CardService.newAction()
          .setFunctionName("actionDeleteRule")
          .setParameters({index: index.toString()}));
          
      listSection.addWidget(CardService.newDecoratedText()
        .setTopLabel(rule.colorLabel)
        .setText(rule.keyword)
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
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("규칙 색상이 선택되었습니다."))
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
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard()))
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
    
  builder.addSection(accountSection);
  
  return builder.build();
}

function actionLogout(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard()))
    .setNotification(CardService.newNotification().setText("로그아웃 되었습니다."))
    .build();
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

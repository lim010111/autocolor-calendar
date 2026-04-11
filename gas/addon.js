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
  
  // Header
  builder.setHeader(CardService.newCardHeader()
    .setTitle("AI가 캘린더를 예쁘게 정리해 드립니다.")
    .setImageUrl("https://www.gstatic.com/images/icons/material/system/1x/palette_black_48dp.png"));
    
  var section = CardService.newCardSection();
  
  section.addWidget(CardService.newDecoratedText()
    .setText("AutoColor를 사용하려면 캘린더 접근 권한이 필요합니다.")
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

/**
 * Action: Complete onboarding and navigate to Home.
 */
function actionCompleteOnboarding(e) {
  // Mock saving onboarding state
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildHomeCard()))
    .setNotification(CardService.newNotification().setText("환영합니다!"))
    .build();
}

/**
 * Screen 2: Home Card (메인 대시보드)
 */
function buildHomeCard() {
  var builder = CardService.newCardBuilder();
  var section = CardService.newCardSection();
  
  // Auto-categorization toggle
  var switchControl = CardService.newSwitch()
    .setFieldName("auto_color_enabled")
    .setValue("true")
    .setSelected(true)
    .setOnChangeAction(CardService.newAction().setFunctionName("actionToggleAutoColor"));
    
  section.addWidget(CardService.newDecoratedText()
    .setText("자동 분류")
    .setSwitchControl(switchControl));
    
  // Stats
  section.addWidget(CardService.newTextParagraph()
    .setText("이번 주 자동 분류된 일정: <b>15건</b>"));
    
  builder.addSection(section);
  
  var actionSection = CardService.newCardSection();
  
  var ruleButton = CardService.newTextButton()
    .setText("매핑 규칙 관리")
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToRuleManagement"));
    
  var settingsButton = CardService.newTextButton()
    .setText("상세 설정")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoToSettings"));
    
  actionSection.addWidget(CardService.newButtonSet()
    .addButton(ruleButton)
    .addButton(settingsButton));
    
  builder.addSection(actionSection);
  return builder.build();
}

/**
 * Action: Toggle auto color (Mock)
 */
function actionToggleAutoColor(e) {
  var isEnabled = e.formInput.auto_color_enabled === "true";
  var msg = isEnabled ? "자동 분류가 켜졌습니다." : "자동 분류가 꺼졌습니다.";
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(msg))
    .build();
}

/**
 * Action: Go Back
 */
function actionGoBack(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

/**
 * Action: Navigate to Rule Management (Screen 3)
 */
function actionGoToRuleManagement(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildRuleManagementCard()))
    .build();
}

/**
 * Action: Navigate to Settings (Screen 4)
 */
function actionGoToSettings(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard()))
    .build();
}

/**
 * Mock Data for Rules
 */
function getMockRules() {
  return [
    { keyword: "회의", colorLabel: "🔵 파란색" },
    { keyword: "개인", colorLabel: "🟢 초록색" }
  ];
}

/**
 * Screen 3: Rule Management Card (규칙 관리 및 전체 목록)
 */
function buildRuleManagementCard() {
  var builder = CardService.newCardBuilder();
  
  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText("⬅ 뒤로 가기")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);
  
  // Input Section
  var addSection = CardService.newCardSection()
    .setHeader("새 규칙 추가");
    
  addSection.addWidget(CardService.newTextInput()
    .setFieldName("rule_keyword")
    .setTitle("키워드 (예: 주간회의)"));
    
  var colorSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("캘린더 색상 선택")
    .setFieldName("rule_color");
    
  colorSelect.addItem("🔵 파란색", "1", true);
  colorSelect.addItem("🟢 초록색", "2", false);
  colorSelect.addItem("🔴 빨간색", "11", false);
  
  addSection.addWidget(colorSelect);
  builder.addSection(addSection);
  
  // List Section
  var listSection = CardService.newCardSection()
    .setHeader("내 규칙 목록");
    
  var rules = getMockRules();
  
  rules.forEach(function(rule, index) {
    var deleteButton = CardService.newTextButton()
      .setText("삭제")
      .setOnClickAction(CardService.newAction()
        .setFunctionName("actionDeleteRule")
        .setParameters({index: index.toString()}));
        
    listSection.addWidget(CardService.newDecoratedText()
      .setText(rule.keyword)
      .setBottomLabel(rule.colorLabel)
      .setButton(deleteButton));
  });
  
  listSection.addWidget(CardService.newDecoratedText()
    .setText("💡 일괄 업로드 등 대규모 규칙 관리는 <a href='https://example.com'>웹 대시보드</a>에서도 가능합니다.")
    .setWrapText(true));
    
  builder.addSection(listSection);
  
  var fixedFooter = CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText("추가하기")
      .setOnClickAction(CardService.newAction().setFunctionName("actionAddRule")));
      
  builder.setFixedFooter(fixedFooter);
  
  return builder.build();
}

/**
 * Action: Add a new rule (Mock)
 */
function actionAddRule(e) {
  var keyword = e.formInput.rule_keyword;
  if (!keyword) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("키워드를 입력해주세요."))
      .build();
  }
  
  // Re-build card to simulate refresh
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard()))
    .setNotification(CardService.newNotification().setText("규칙이 추가되었습니다."))
    .build();
}

/**
 * Action: Delete a rule (Mock)
 */
function actionDeleteRule(e) {
  // Re-build card to simulate refresh
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRuleManagementCard()))
    .setNotification(CardService.newNotification().setText("규칙이 삭제되었습니다."))
    .build();
}

/**
 * Screen 4: Settings Card (상세 설정)
 */
function buildSettingsCard() {
  var builder = CardService.newCardBuilder();
  
  var navSection = CardService.newCardSection();
  navSection.addWidget(CardService.newButtonSet().addButton(CardService.newTextButton()
    .setText("⬅ 뒤로 가기")
    .setOnClickAction(CardService.newAction().setFunctionName("actionGoBack"))));
  builder.addSection(navSection);
  
  var section = CardService.newCardSection()
    .setHeader("분류 정책 설정");
    
  var policyGroup = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .setFieldName("policy_settings");
    
  policyGroup.addItem("수동 색상 덮어쓰기 방지", "prevent_overwrite", true);
  policyGroup.addItem("AI(LLM) 자동 추론 사용 (규칙 매칭 실패 시)", "use_llm", true);
  policyGroup.addItem("설명(Description) 필드도 분석에 포함", "use_description", false);
  
  section.addWidget(policyGroup);
  
  var calendarSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("적용할 캘린더 선택")
    .setFieldName("target_calendar");
    
  calendarSelect.addItem("기본 캘린더", "primary", true);
  calendarSelect.addItem("업무 캘린더", "work", false);
  
  section.addWidget(calendarSelect);
  builder.addSection(section);
  
  var actionSection = CardService.newCardSection();
  var logoutButton = CardService.newTextButton()
    .setText("로그아웃")
    .setOnClickAction(CardService.newAction().setFunctionName("actionLogout"));
    
  actionSection.addWidget(CardService.newButtonSet().addButton(logoutButton));
  builder.addSection(actionSection);
  
  return builder.build();
}

/**
 * Action: Logout (Mock)
 */
function actionLogout(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildWelcomeCard()))
    .setNotification(CardService.newNotification().setText("로그아웃 되었습니다."))
    .build();
}

/**
 * Event Open Trigger (Contextual Awareness)
 */
function onEventOpen(e) {
  var builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader().setTitle("일정 상세 분석"));
  
  var section = CardService.newCardSection();
  section.addWidget(CardService.newDecoratedText()
    .setText("선택한 일정에 대한 분석 정보를 보여줍니다.")
    .setWrapText(true));
    
  builder.addSection(section);
  return builder.build();
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

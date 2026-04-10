/**
 * Entry point for the Google Workspace Add-on.
 *
 * @param {Object} e - The event object.
 * @return {CardService.Card} The constructed Card.
 */
function buildAddOn(e) {
  var builder = CardService.newCardBuilder();

  var section = CardService.newCardSection()
      .addWidget(CardService.newTextParagraph()
          .setText("Welcome to AutoColor for Calendar! Configure your settings to start auto-coloring your events."));

  var settingsButton = CardService.newTextButton()
      .setText("Open Settings")
      .setOnClickAction(CardService.newAction().setFunctionName("openSettings"));

  section.addWidget(CardService.newButtonSet().addButton(settingsButton));

  builder.addSection(section);

  return builder.build();
}

/**
 * Action to open settings UI.
 *
 * @param {Object} e - The event object.
 * @return {CardService.ActionResponse}
 */
function openSettings(e) {
  // To be implemented: Launch an external web UI or open a dialog/HTML service.
  return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
          .setText("Settings UI will be implemented here."))
      .build();
}

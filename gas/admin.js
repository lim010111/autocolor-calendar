function installStage1Mvp() {
  var defaults = AutoColorStorage.ensureDefaults();
  var installedTriggers = AutoColorTriggers.installManagedTriggers();
  var bootstrap = AutoColorSync.bootstrapConfiguredCalendars(defaults.settings.processExistingEventsOnBootstrap, 'install');

  return logAdminResult_({
    action: 'installStage1Mvp',
    settings: defaults.settings,
    rules: defaults.rules,
    triggers: installedTriggers,
    bootstrap: bootstrap
  });
}

function reinstallManagedTriggers() {
  return logAdminResult_({
    action: 'reinstallManagedTriggers',
    triggers: AutoColorTriggers.installManagedTriggers()
  });
}

function uninstallManagedTriggers() {
  AutoColorTriggers.clearManagedTriggers();

  return logAdminResult_({
    action: 'uninstallManagedTriggers',
    triggers: AutoColorTriggers.listManagedTriggers()
  });
}

function bootstrapSyncState() {
  return logAdminResult_({
    action: 'bootstrapSyncState',
    result: AutoColorSync.bootstrapConfiguredCalendars(false, 'manual-bootstrap')
  });
}

function backfillConfiguredCalendars() {
  return logAdminResult_({
    action: 'backfillConfiguredCalendars',
    result: AutoColorSync.backfillConfiguredCalendars('manual-backfill')
  });
}

function runManualSync() {
  return logAdminResult_({
    action: 'runManualSync',
    result: AutoColorSync.runForConfiguredCalendars('manual')
  });
}

function saveRulesFromJson(jsonString) {
  var rules = AutoColorStorage.saveRules(JSON.parse(jsonString));

  return logAdminResult_({
    action: 'saveRulesFromJson',
    ruleCount: rules.length,
    rules: rules
  });
}

function saveSettingsFromJson(jsonString) {
  var settings = AutoColorStorage.saveSettings(JSON.parse(jsonString));

  return logAdminResult_({
    action: 'saveSettingsFromJson',
    settings: settings
  });
}

function seedDefaultRules() {
  var rules = AutoColorStorage.saveRules(ACFC_CONFIG.defaultRules());

  return logAdminResult_({
    action: 'seedDefaultRules',
    ruleCount: rules.length,
    rules: rules
  });
}

function resetSyncState() {
  AutoColorStorage.clearAllSyncTokens();

  return logAdminResult_({
    action: 'resetSyncState'
  });
}

function clearAllStage1State() {
  AutoColorTriggers.clearManagedTriggers();
  AutoColorStorage.clearAllState();

  return logAdminResult_({
    action: 'clearAllStage1State'
  });
}

function showCurrentConfiguration() {
  return logAdminResult_({
    action: 'showCurrentConfiguration',
    settings: AutoColorStorage.getSettings(),
    rules: AutoColorStorage.getRules(),
    triggers: AutoColorTriggers.listManagedTriggers()
  });
}

function getExampleRulesJson() {
  var exampleRulesJson = JSON.stringify(ACFC_CONFIG.defaultRules(), null, 2);
  Logger.log(exampleRulesJson);
  return exampleRulesJson;
}

function getExampleSettingsJson() {
  var exampleSettingsJson = JSON.stringify(AutoColorStorage.getSettings(), null, 2);
  Logger.log(exampleSettingsJson);
  return exampleSettingsJson;
}

function logAvailableColors() {
  var colorPalette = Calendar.Colors.get().event;
  Logger.log(JSON.stringify(colorPalette, null, 2));
  return colorPalette;
}

function logAdminResult_(payload) {
  Logger.log(JSON.stringify(payload, null, 2));
  return payload;
}

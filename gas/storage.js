var AutoColorStorage = (function () {
  function getUserProperties_() {
    return PropertiesService.getUserProperties();
  }

  function clone_(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseJson_(value, fallback) {
    if (!value) {
      return clone_(fallback);
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error('Failed to parse stored JSON: ' + error.message);
    }
  }

  function normalizeCalendarIds_(calendarIds) {
    var source = Array.isArray(calendarIds) ? calendarIds : (calendarIds ? [calendarIds] : []);
    var seen = {};
    var normalized = [];

    source.forEach(function (calendarId) {
      var next = String(calendarId || '').trim();

      if (!next || seen[next]) {
        return;
      }

      seen[next] = true;
      normalized.push(next);
    });

    return normalized;
  }

  function normalizePeriodicMinutes_(minutes) {
    var value = Number(minutes);

    if (ACFC_CONFIG.SUPPORTED_PERIODIC_MINUTES.indexOf(value) === -1) {
      return ACFC_CONFIG.defaultSettings().periodicSyncMinutes;
    }

    return value;
  }

  function normalizeSyncPageSize_(syncPageSize) {
    var value = Number(syncPageSize);

    if (!value || value < 1) {
      return ACFC_CONFIG.DEFAULT_SYNC_PAGE_SIZE;
    }

    return Math.min(Math.floor(value), 2500);
  }

  function normalizeSettings_(settings) {
    var defaults = ACFC_CONFIG.defaultSettings();
    var normalizedCalendarIds = normalizeCalendarIds_(settings && settings.calendarIds);

    if (!normalizedCalendarIds.length) {
      normalizedCalendarIds = defaults.calendarIds;
    }

    if (!normalizedCalendarIds.length) {
      throw new Error('At least one calendarId is required.');
    }

    return {
      calendarIds: normalizedCalendarIds,
      periodicSyncMinutes: normalizePeriodicMinutes_(settings && settings.periodicSyncMinutes),
      syncPageSize: normalizeSyncPageSize_(settings && settings.syncPageSize),
      processExistingEventsOnBootstrap: Boolean(settings && settings.processExistingEventsOnBootstrap),
      dryRun: Boolean(settings && settings.dryRun),
      logNoMatchEvents: Boolean(settings && settings.logNoMatchEvents),
      classifierVersion: String((settings && settings.classifierVersion) || defaults.classifierVersion)
    };
  }

  function buildSyncTokenKey_(calendarId) {
    var encodedCalendarId = Utilities.base64EncodeWebSafe(String(calendarId)).replace(/=+$/g, '');
    return ACFC_CONFIG.PROPERTY_PREFIXES.SYNC_TOKEN + encodedCalendarId;
  }

  function getSettings() {
    var raw = getUserProperties_().getProperty(ACFC_CONFIG.PROPERTY_KEYS.SETTINGS);
    var parsed = raw ? parseJson_(raw, {}) : ACFC_CONFIG.defaultSettings();
    return normalizeSettings_(parsed);
  }

  function saveSettings(settings) {
    var normalized = normalizeSettings_(settings || {});
    getUserProperties_().setProperty(ACFC_CONFIG.PROPERTY_KEYS.SETTINGS, JSON.stringify(normalized));
    return normalized;
  }

  function getRules() {
    var raw = getUserProperties_().getProperty(ACFC_CONFIG.PROPERTY_KEYS.RULES);
    var parsed = raw ? parseJson_(raw, []) : ACFC_CONFIG.defaultRules();
    return AutoColorRules.normalizeRules(parsed);
  }

  function saveRules(rules) {
    var normalized = AutoColorRules.normalizeRules(rules);
    getUserProperties_().setProperty(ACFC_CONFIG.PROPERTY_KEYS.RULES, JSON.stringify(normalized));
    return normalized;
  }

  function ensureDefaults() {
    var userProperties = getUserProperties_();

    if (!userProperties.getProperty(ACFC_CONFIG.PROPERTY_KEYS.SETTINGS)) {
      saveSettings(ACFC_CONFIG.defaultSettings());
    }

    if (!userProperties.getProperty(ACFC_CONFIG.PROPERTY_KEYS.RULES)) {
      saveRules(ACFC_CONFIG.defaultRules());
    }

    return {
      settings: getSettings(),
      rules: getRules()
    };
  }

  function getSyncToken(calendarId) {
    return getUserProperties_().getProperty(buildSyncTokenKey_(calendarId));
  }

  function setSyncToken(calendarId, syncToken) {
    if (!syncToken) {
      throw new Error('syncToken is required.');
    }

    getUserProperties_().setProperty(buildSyncTokenKey_(calendarId), String(syncToken));
  }

  function clearSyncToken(calendarId) {
    getUserProperties_().deleteProperty(buildSyncTokenKey_(calendarId));
  }

  function clearAllSyncTokens() {
    var userProperties = getUserProperties_();
    var allProperties = userProperties.getProperties();

    Object.keys(allProperties).forEach(function (key) {
      if (key.indexOf(ACFC_CONFIG.PROPERTY_PREFIXES.SYNC_TOKEN) === 0) {
        userProperties.deleteProperty(key);
      }
    });
  }

  function clearAllState() {
    var userProperties = getUserProperties_();
    clearAllSyncTokens();
    userProperties.deleteProperty(ACFC_CONFIG.PROPERTY_KEYS.SETTINGS);
    userProperties.deleteProperty(ACFC_CONFIG.PROPERTY_KEYS.RULES);
  }

  return {
    getSettings: getSettings,
    saveSettings: saveSettings,
    getRules: getRules,
    saveRules: saveRules,
    ensureDefaults: ensureDefaults,
    getSyncToken: getSyncToken,
    setSyncToken: setSyncToken,
    clearSyncToken: clearSyncToken,
    clearAllSyncTokens: clearAllSyncTokens,
    clearAllState: clearAllState
  };
})();

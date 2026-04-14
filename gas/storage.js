var AutoColorStorage = (function () {
  function getUserProperties_() {
    return PropertiesService.getUserProperties();
  }

  function isOnboarded() {
    var raw = getUserProperties_().getProperty(ACFC_CONFIG.PROPERTY_KEYS.ONBOARDED);
    return raw === 'true';
  }

  function setOnboarded(value) {
    getUserProperties_().setProperty(ACFC_CONFIG.PROPERTY_KEYS.ONBOARDED, value ? 'true' : 'false');
  }

  function clearAllState() {
    var userProperties = getUserProperties_();
    userProperties.deleteProperty(ACFC_CONFIG.PROPERTY_KEYS.ONBOARDED);
  }

  return {
    isOnboarded: isOnboarded,
    setOnboarded: setOnboarded,
    clearAllState: clearAllState
  };
})();

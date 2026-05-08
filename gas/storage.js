var AutoColorStorage = (function () {
  var FIRST_HOME_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  // 첫 dashboard 진입 시 timestamp를 stamp하고 24h 윈도우 안인지 반환.
  // backend의 last_sync.next_sync_token_present 신호는 신규 계정의
  // bootstrap full_resync가 1~2초 안에 끝나면 곧바로 true가 되어
  // 첫 진입 안내를 못 띄우는 race가 있다. 이 함수는 GAS 클라이언트가
  // 처음 home card를 본 시각을 기준으로 일정 시간 동안 안내를 노출한다.
  function isWithinFirstHomeWindow() {
    var props = getUserProperties_();
    var raw = props.getProperty(ACFC_CONFIG.PROPERTY_KEYS.HOME_FIRST_SEEN_AT);
    var now = Date.now();
    if (!raw) {
      props.setProperty(ACFC_CONFIG.PROPERTY_KEYS.HOME_FIRST_SEEN_AT, String(now));
      return true;
    }
    var first = Number(raw);
    if (!isFinite(first)) {
      props.setProperty(ACFC_CONFIG.PROPERTY_KEYS.HOME_FIRST_SEEN_AT, String(now));
      return true;
    }
    return (now - first) < FIRST_HOME_WINDOW_MS;
  }

  function clearAllState() {
    var userProperties = getUserProperties_();
    userProperties.deleteProperty(ACFC_CONFIG.PROPERTY_KEYS.ONBOARDED);
    userProperties.deleteProperty(ACFC_CONFIG.PROPERTY_KEYS.HOME_FIRST_SEEN_AT);
  }

  return {
    isOnboarded: isOnboarded,
    setOnboarded: setOnboarded,
    isWithinFirstHomeWindow: isWithinFirstHomeWindow,
    clearAllState: clearAllState
  };
})();

/**
 * Authentication Module for Stage 2 (Backend Integration)
 */
var AutoColorAuth = (function () {
  var TOKEN_KEY = 'ACFC_SESSION_TOKEN';

  function saveSessionToken(token) {
    var userProps = PropertiesService.getUserProperties();
    userProps.setProperty(TOKEN_KEY, token);
    
    // When authenticated, we rely on backend for syncing,
    // so we clear local triggers to prevent race conditions.
    try {
      AutoColorTriggers.clearManagedTriggers();
    } catch (e) {
      console.warn('Failed to clear local triggers on login:', e);
    }
  }

  function getSessionToken() {
    var userProps = PropertiesService.getUserProperties();
    return userProps.getProperty(TOKEN_KEY);
  }

  function clearSessionToken() {
    var userProps = PropertiesService.getUserProperties();
    userProps.deleteProperty(TOKEN_KEY);
    
    // 로그아웃 시 로컬 트리거 재등록 로직을 호출하여 Stage 1으로 폴백합니다.
    try {
      AutoColorTriggers.installManagedTriggers();
    } catch (e) {
      console.warn('Failed to install local triggers on logout:', e);
    }
  }

  function isAuthenticated() {
    return !!getSessionToken();
  }

  return {
    saveSessionToken: saveSessionToken,
    getSessionToken: getSessionToken,
    clearSessionToken: clearSessionToken,
    isAuthenticated: isAuthenticated
  };
})();

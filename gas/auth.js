/**
 * Authentication Module for Backend Integration
 */
var AutoColorAuth = (function () {
  var TOKEN_KEY = 'ACFC_SESSION_TOKEN';

  function saveSessionToken(token) {
    var userProps = PropertiesService.getUserProperties();
    userProps.setProperty(TOKEN_KEY, token);
  }

  function getSessionToken() {
    var userProps = PropertiesService.getUserProperties();
    return userProps.getProperty(TOKEN_KEY);
  }

  function clearSessionToken() {
    var userProps = PropertiesService.getUserProperties();
    userProps.deleteProperty(TOKEN_KEY);
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

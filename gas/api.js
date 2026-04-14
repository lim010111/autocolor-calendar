/**
 * API Module for communicating with the Backend
 */
var AutoColorAPI = (function () {
  var BACKEND_BASE_URL = 'https://api.example.com'; 
  var MAX_RETRIES = 3;
  var INITIAL_BACKOFF_MS = 500;
  
  function getBaseUrl() {
    var scriptProps = PropertiesService.getScriptProperties();
    var url = scriptProps.getProperty('BACKEND_BASE_URL');
    return url || BACKEND_BASE_URL;
  }

  function fetchBackend(endpoint, options) {
    var token = AutoColorAuth.getSessionToken();
    if (!token) {
      throw new Error('AUTH_EXPIRED');
    }

    options = options || {};
    var headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + token;
    options.headers = headers;
    
    // Manage exceptions manually to support retry and custom logic
    options.muteHttpExceptions = true; 

    var url = getBaseUrl() + endpoint;
    var attempt = 0;
    var backoff = INITIAL_BACKOFF_MS;

    while (attempt < MAX_RETRIES) {
      attempt++;
      try {
        var response = UrlFetchApp.fetch(url, options);
        var statusCode = response.getResponseCode();

        if (statusCode >= 200 && statusCode < 300) {
          return response;
        }

        // 401 Unauthorized: clear token and throw specific error
        if (statusCode === 401) {
          AutoColorAuth.clearSessionToken();
          throw new Error('AUTH_EXPIRED'); 
        }

        if (statusCode >= 400 && statusCode < 500) {
          // Client error: DO NOT RETRY
          throw new Error('CLIENT_ERROR: ' + statusCode + ' - ' + response.getContentText());
        }

        // Retry on 5xx errors
        throw new Error('SERVER_ERROR: ' + statusCode + ' - ' + response.getContentText());
        
      } catch (e) {
        if (e.message === 'AUTH_EXPIRED' || e.message.indexOf('CLIENT_ERROR') === 0) {
          throw e; // Bubble up for State Reset or immediate fail (no retry)
        }
        
        if (attempt >= MAX_RETRIES) {
          throw new Error('Fetch failed after ' + MAX_RETRIES + ' attempts: ' + e.message);
        }
        
        Utilities.sleep(backoff);
        backoff *= 2;
      }
    }
  }

  return {
    fetchBackend: fetchBackend
  };
})();

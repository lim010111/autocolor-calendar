# Implementation Plan: User OAuth Authentication and Backend API Integration

## 1. Background & Motivation
- **Objective:** To enable the Google Workspace Add-on client to securely communicate with the Cloudflare Workers backend using an OAuth 2.0 Authorization flow and an API communication module.
- **Context:** The backend requires the user's Google Refresh Token to perform Background Syncs via Webhooks. Therefore, the internal permissions of the Add-on (Google Apps Script's default token) are insufficient. A backend-driven explicit OAuth flow is necessary to obtain these permissions.

## 2. Scope & Impact
- **Affected Files:**
  - `gas/auth.js`: Module for storing and managing the user's session token (API Key).
  - `gas/api.js`: Utility for backend communication using `UrlFetchApp`.
  - `gas/addon.js`: UI handling for login/logout and screen branching based on authentication state.
- **Impact:** Establishes the essential communication layer for delegating configuration and processing logic entirely to the backend, aligning with the End-to-End (E2E) AI service architecture.

## 3. Proposed Solution (Backend-Managed OAuth with Standard Add-on Flow)
1. **Login Initiation (Add-on UI):** When the user clicks the "Login" button, it triggers a `CardService.newAuthorizationException()` or opens an OAuth popup using the `authorizationUrl` configuration.
2. **Backend OAuth Flow:** The backend handles the Google OAuth consent screen redirect and safely stores the resulting Refresh Token in the database (Supabase).
3. **Token Issuance:** Upon successful authentication, the backend issues a session token (API Key) which is passed back to the Add-on.
4. **Token Storage in Add-on:** The `gas/auth.js` module encrypts and stores the received token securely using `PropertiesService.getUserProperties()`.
5. **Backend API Calls:** Subsequent calls using the `fetchBackend()` function in `gas/api.js` include this session token in the `Authorization: Bearer <token>` header to communicate with the backend.

## 4. Implementation Steps
### Step 1: Authentication Module (`gas/auth.js`)
- `saveSessionToken(token)`: Stores the token using `PropertiesService`.
- `getSessionToken()`: Retrieves the stored token.
- `clearSessionToken()`: Deletes the token on logout.
- `isAuthenticated()`: Checks for the token's presence.

### Step 2: API Communication Module (`gas/api.js`)
- `fetchBackend(endpoint, options)`: Core wrapper for `UrlFetchApp.fetch`.
- **Automatic Auth Header:** Injects `Authorization: Bearer ...`.
- **Error Handling (401 Unauthorized):** Instantly calls `clearSessionToken()` on a 401 error, forcing the Add-on UI to reset to the login screen.
- **Retry Logic:** Implements exponential backoff for 5xx errors, respecting Google Apps Script execution time limits.

### Step 3: Add-on UI Updates (`gas/addon.js`)
- `buildAddOn()`: Branches between `buildWelcomeCard()` and `buildHomeCard()` based on `isAuthenticated()`.
- `buildWelcomeCard()`: Starts the OAuth flow.
- `buildSettingsCard()`: Provides a "Logout" mechanism that clears the token and resets the UI state.

## 5. Architecture Enforcement
- **No Local Processing:** The Add-on serves strictly as a UI. It must not run local triggers or evaluate rules.
- **Strict Halt on Failure:** If API communication fails or the backend becomes unreachable, the Add-on must halt and show an error notification. **There is no fallback to legacy local rules.**

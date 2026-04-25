# Scenario 01 — Install + first-time OAuth

> Walks the reviewer through the chronological flow from opening the
> already-installed Add-on to landing on the post-OAuth Home card. Each
> step pins what the reviewer sees, which Google API call (if any) the
> step exercises, and the observable outcome that confirms the step
> succeeded. Cited line numbers should pass a `grep -n` spot-check
> against the source files; the bundle's "drift guard" relies on this.

- **Scopes exercised in this scenario (backend OAuth):** `openid`,
  `email`, `https://www.googleapis.com/auth/calendar`,
  `https://www.googleapis.com/auth/calendar.events`. Citation:
  `src/config/constants.ts:1-6`.
- **Pre-conditions:**
  - Test account from `08-test-account.md` is signed in to Google.
  - Add-on already installed from Workspace Marketplace. Marketplace
    install grants 7 scopes declared in `gas/appsscript.json:5-13` —
    5 framework scopes (`script.external_request` / `script.locale` /
    `calendar.addons.execute` /
    `calendar.addons.current.event.read` /
    `calendar.addons.current.event.write`; justifications under
    `docs/assets/marketplace/scope-justifications.md` "Out of scope")
    plus `calendar` and `userinfo.email` (per-scope justifications at
    `docs/assets/marketplace/scope-justifications.md` §1 / §3).
  - Test account is NOT yet authenticated to the AutoColor backend
    (no `sessions` row, no `oauth_tokens` row).

## Two consent surfaces (pre-read)

The reviewer encounters two distinct scope-prompt surfaces; this
scenario covers the second. Before walking the steps, surface the
distinction:

- **Marketplace install consent** — granted once when the user
  installed the Add-on (before Step 1 below). Lists 7 scopes from
  `gas/appsscript.json` `oauthScopes` (`gas/appsscript.json:5-13`):
  5 framework scopes (`script.*`, `calendar.addons.*`) justified under
  the "Out of scope" list in
  `docs/assets/marketplace/scope-justifications.md`, plus `calendar`
  and `userinfo.email` whose per-scope justifications live at
  `docs/assets/marketplace/scope-justifications.md` §1 / §3.
- **Backend OAuth consent (this scenario)** — granted at Step 3 below
  when the reviewer clicks "Google 계정으로 시작하기". Lists the 4
  backend scopes from `src/config/constants.ts:1-6` (`openid` /
  `email` / `calendar` / `calendar.events`).

The two surfaces overlap on `calendar` — the Marketplace manifest also
requests it, and the backend OAuth flow re-requests it because the
backend (Cloudflare Worker) has its own refresh-token at rest and needs
its own grant. `openid` / `email` / `calendar.events` are unique to the
backend OAuth surface. The Sensitive `calendar.events` scope (which
authorises `events.patch` writes — the AutoColor write surface) is
**only** granted at this surface; see
`docs/assets/marketplace/scope-justifications.md` §2 for the
justification that ties `calendar.events` to the `events.patch` body
and the §5.4 ownership-marker contract.

## 1. Open Add-on → Welcome card renders

- **Reviewer action.** Open Google Calendar, click the AutoColor icon
  in the Calendar sidebar.
- **Surface.**
  - Card title: `"AutoColor 사용 가이드"` (`gas/addon.js:94`).
  - Subtitle: `"AI가 캘린더를 예쁘게 정리해 드립니다."`
    (`gas/addon.js:95`).
  - Three tutorial rows under header `"💡 이렇게 사용해보세요!"`
    (`gas/addon.js:98`):
    - `"1단계. 규칙 만들기"` — `"키워드(예: '회의')와 원하는 색상을
      선택해 나만의 규칙을 만드세요."` (`gas/addon.js:101-103`).
    - `"2단계. 일정 등록하기"` — `"평소처럼 캘린더에 일정을
      등록합니다. 제목이나 설명에 키워드가 포함되면 됩니다."`
      (`gas/addon.js:105-108`).
    - `"3단계. 자동 색상 적용"` — `"백그라운드에서 AutoColor가
      자동으로 일정을 찾아 예쁜 색상을 입혀줍니다! ✨"`
      (`gas/addon.js:110-112`).
  - Disclosure copy: `"시작하려면 Google 계정 연동이 필요합니다.
    진행하면 개인정보처리방침 및 서비스 약관에 동의하는 것으로
    간주됩니다. (정식 링크는 출시 시점에 제공됩니다.)"`
    (`gas/addon.js:119`). Note: at submission time the parenthesised
    placeholder is replaced with concrete links to the published
    Privacy Policy and Terms of Service.
  - Fixed-footer primary button: `"Google 계정으로 시작하기"`
    (`gas/addon.js:126`).
- **Backend / Google API call.** None. The card is rendered entirely
  by the GAS `homepageTrigger` (`gas/appsscript.json:24-27`,
  `gas/appsscript.json:31-34`) which runs `buildAddOn`
  (`gas/addon.js:23-37`). Authentication check is local
  (`AutoColorAuth.isAuthenticated()` returns `false`).
- **Observable outcome.** Reviewer sees the welcome card; the
  primary button is enabled. Nothing has been sent to Google or to
  the AutoColor backend yet.

## 2. Click "Google 계정으로 시작하기" → OAuth start

- **Reviewer action.** Click the fixed-footer button
  `"Google 계정으로 시작하기"`.
- **Surface.** A full-size browser tab opens (the GAS
  `OpenAs.FULL_SIZE` mode, `gas/addon.js:1093`). The Calendar sidebar
  remains; on tab close it will reload via
  `OnClose.RELOAD_ADD_ON` (`gas/addon.js:1094`).
- **Backend / Google API call.**
  1. `actionStartOAuth` (`gas/addon.js:1079-1096`) reads the
     `OAUTH_AUTH_URL` Script Property and opens it
     (`gas/addon.js:1087-1095`). The Script Property points at the
     Cloudflare Worker route `GET /oauth/google`.
  2. The Worker's handler (`src/routes/oauth.ts:18-30`) builds the
     Google authorization URL with base
     `https://accounts.google.com/o/oauth2/v2/auth`
     (`src/config/constants.ts:15`) and the parameters
     `client_id` / `redirect_uri` / `response_type=code` /
     `access_type=offline` (refresh token issued) /
     `prompt=consent` (forces consent re-prompt) /
     `include_granted_scopes=true` /
     `scope=<OAUTH_SCOPE_PARAM>` /
     `state=<HMAC-signed nonce>` (`src/routes/oauth.ts:21-28`).
  3. The Worker returns a 302 to that authorization URL
     (`src/routes/oauth.ts:29`).
- **Scopes carried in the `scope` param.** Four scopes joined by
  spaces (`OAUTH_SCOPE_PARAM` at `src/config/constants.ts:8`):
  `openid` / `email` /
  `https://www.googleapis.com/auth/calendar` /
  `https://www.googleapis.com/auth/calendar.events`
  (`src/config/constants.ts:1-6`).
- **Observable outcome.** Browser navigates to
  `accounts.google.com`; Google's consent screen renders.

## 3. Google consent screen → reviewer clicks Allow

- **Reviewer action.** Review the four backend-OAuth scopes listed on
  Google's consent page; click Allow.
- **Surface.** Google's own consent page — this is hosted by Google,
  so AutoColor has no in-product copy to quote here. The page lists
  exactly the 4 scopes from `src/config/constants.ts:1-6`; the 7
  Marketplace-install scopes were already granted at install time
  and are not re-prompted on this surface (see "Two consent
  surfaces" pre-read above).
- **Pre-verification interstitial.** If the deployment has not yet
  completed OAuth verification (i.e. the verification submission
  this bundle supports), Google additionally renders an
  `"Google hasn't verified this app"` interstitial **before** the
  consent screen. To pass through during testing the reviewer:
  - clicks `"Advanced"` then `"Go to AutoColor (unsafe)"`, or
  - is added as a Test User in the GCP OAuth Consent Screen
    configuration so the interstitial is suppressed.
  This interstitial disappears once verification completes.
- **Backend / Google API call.** Google's identity service. On Allow,
  Google issues a 302 back to the configured redirect URI
  (`GOOGLE_OAUTH_REDIRECT_URI`, the Worker's `/oauth/google/callback`
  route) with `?code=<authorization_code>&state=<state>`. On Deny
  Google sends `?error=access_denied&state=<state>` instead — see
  Failure modes.
- **Observable outcome.** Browser navigates to the Worker's callback
  URL; Step 4 begins automatically.

## 4. Callback → token exchange + session issuance

- **Reviewer action.** None (automatic redirect chain).
- **Surface.** The reviewer sees a brief navigation through the
  Worker's hostname; no rendered page. The Worker's response is a
  302 back to GAS, so the browser does not stop here.
- **Backend / Google API call.**
  `src/routes/oauth.ts:32-87` is the happy-path callback chain:
  1. Parse `code` and `state` query params; reject if either is
     missing (`src/routes/oauth.ts:46-50`).
  2. `verifyState(c.env.SESSION_HMAC_KEY, state)`
     (`src/routes/oauth.ts:52-53`) — HMAC verification of the
     signed nonce; rejects replay / forged `state` values.
  3. `exchangeCode(...)` — POST to
     `https://oauth2.googleapis.com/token`
     (`src/config/constants.ts:16`,
     `src/routes/oauth.ts:55-60`); returns an access token, ID
     token, refresh token, and granted scopes.
  4. `fetchUserInfo(tokens.access_token)` — GET
     `https://openidconnect.googleapis.com/v1/userinfo`
     (`src/config/constants.ts:17`,
     `src/routes/oauth.ts:61`); returns the OIDC `sub` and
     `email` claims.
  5. DB writes inside `getDb` (`src/routes/oauth.ts:63-83`):
     - `upsertUserByGoogleSub({ googleSub, email })` — `users`
       row keyed on `google_sub` (the stable tenant key).
     - `saveGoogleRefreshToken({ userId, refreshToken, scope })`
       — `oauth_tokens` row, refresh token encrypted at rest with
       `TOKEN_ENCRYPTION_KEY` (see `src/CLAUDE.md` "Secret
       rotation impact").
     - `issueSession({ userId, userAgent })` — `sessions` row
       with `token_hash` HMACed via `SESSION_PEPPER`.
  6. 302 to `${GAS_REDIRECT_URL}?token=<sessionToken>`
     (`src/routes/oauth.ts:85-87`).

  Errors out of this happy-path block route through the catch at
  `src/routes/oauth.ts:88-108` — see Failure modes below.
- **Observable outcome.** Browser navigates to the GAS web app
  `/exec?token=<sessionToken>`.

## 5. GAS callback page renders + auto-closes

- **Reviewer action.** None.
- **Surface.** GAS renders `gas/authCallback.html`
  (`gas/addon.js:1102`). Visible copy:
  - Badge: `"✓ 로그인 완료"` (`gas/authCallback.html:14`).
  - Heading: `"AutoColor 연결이 완료되었습니다"`
    (`gas/authCallback.html:15`).
  - Body: `"이 창/탭은 잠시 후 자동으로 닫힙니다."` and
    `"닫히지 않으면 직접 닫고 Google Calendar 애드온으로
    돌아가세요."` (`gas/authCallback.html:16-17`).

  Two side-effects on this page:
  - `?token=` is stripped from the URL via
    `history.replaceState` (`gas/authCallback.html:24-28`) so the
    token does not leak via Referer / browser history.
  - The window auto-closes after 1500 ms via `window.close()` /
    `window.top.close()` (`gas/authCallback.html:33-36`); browsers
    that block programmatic close show the visible copy instructing
    the reviewer to close manually.
- **Backend / Google API call.** GAS `doGet`
  (`gas/addon.js:1098-1105`) runs server-side: persists the bearer
  token to `UserProperties` via
  `AutoColorAuth.saveSessionToken(token)`
  (`gas/addon.js:1101`), then renders the HTML output. No Google
  API call.
- **Observable outcome.** Tab auto-closes; the Calendar sidebar
  reloads via `OnClose.RELOAD_ADD_ON` (`gas/addon.js:1094`),
  triggering Step 6.

## 6. Post-OAuth Home card visible

- **Reviewer action.** None (automatic re-render).
- **Surface.**
  - Card title: `"AutoColor 대시보드"` (`gas/addon.js:155`).
  - Empty-state body, on a fresh account
    (`gas/addon.js:140-145` documents the semantics):
    - Classified-events line: `"아직 분류된 일정이 없습니다"`
      (`gas/addon.js:179`) — fires when
      `stats.classification.updated === 0`.
    - Sync-status line: `"아직 동기화하지 않았습니다"`
      (`gas/addon.js:184`) — fires when `stats.lastSync.finishedAt`
      is null.
  - Action buttons: `"매핑 규칙 관리"` (`gas/addon.js:214`) and
    `"상세 설정"` (`gas/addon.js:218`) in a button-set; primary
    fixed-footer button `"지금 즉시 동기화"` (`gas/addon.js:229`).
- **Backend / Google API call.** `buildAddOn`
  (`gas/addon.js:23-37`) re-runs on Add-on reload, sees
  `AutoColorAuth.isAuthenticated()` returns `true`, dispatches to
  `buildHomeCard` (`gas/addon.js:146-236`). `buildHomeCard` calls
  `fetchStatsOrError()` (`gas/addon.js:147`) which posts to
  `/api/stats?window=7d` with the bearer token (no Google Calendar
  API call yet — the backend reads its own observability tables).
- **Observable outcome.** Reviewer is authenticated; the dashboard
  reflects an empty account ready for rule creation. Pivot point
  to scenario `02-rule-to-color.md`.

### Failure modes

- **User clicks Deny on the consent screen.** Google sends
  `?error=access_denied`; the Worker callback's `if (query["error"])`
  branch (`src/routes/oauth.ts:36-44`) raises
  `OAuthError("consent_denied")`. The error handler redirects to
  `${GAS_REDIRECT_URL}?error=consent_denied`; GAS `doGet` falls
  through to `authError.html` (`gas/addon.js:1104`). Pointer:
  `gas/authError.html` (current generic surface;
  per-error-code branches are tracked at `TODO.md:36`).
- **Provider error / unexpected exception.** Google sends
  `?error=invalid_request` (or similar) →
  `OAuthError("provider_error")` (`src/routes/oauth.ts:43`). A
  thrown non-`OAuthError` from `exchangeCode` /
  `fetchUserInfo` / DB writes is wrapped as
  `OAuthError("server_error")` (`src/routes/oauth.ts:104-107`).
  Both land at GAS `?error=...` for `authError.html`.
- **State HMAC verification failure.** `verifyState` returns
  `false` → `OAuthError("state_invalid")`
  (`src/routes/oauth.ts:52-53`). Same `?error=...` landing.
- **Re-auth on `invalid_grant`.** Out of scope for this scenario;
  see `docs/architecture-guidelines.md` "Halt on Failure" for the
  documented narrow exception, and scenario
  `06-reauth-invalid-grant.md` (pending) for the walkthrough.

### Cross-references

- `docs/add-on-ui-plan.md` Screen 1 — Welcome card design source.
- `docs/assets/marketplace/scope-justifications.md` §1-§3 — per-scope
  justifications for `calendar` / `calendar.events` / `userinfo.email`;
  "Out of scope" section enumerates the 5 GAS framework scopes the
  Marketplace-install consent surface grants beyond `calendar` /
  `userinfo.email`.
- `docs/security-principles.md` Principle 3 — Scope Minimization.
  This scenario demonstrates two of the four scopes (`openid` /
  `email`); scenarios `02` and `05` will demonstrate `calendar.events`,
  scenario `06` will demonstrate `calendar`'s watch surface.
- `docs/marketplace-readiness.md` §4 "Status" row "Install +
  first-time OAuth" — the row this file is the source-of-truth for.
- `gas/appsscript.json:5-13` — Marketplace-install scope manifest
  (the first consent surface; out of this scenario's scope but
  acknowledged in the pre-read).

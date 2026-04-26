# Scenario 06 — Re-auth on `invalid_grant`

> Walks the reviewer through revoking AutoColor's refresh token,
> observing the backend's `markReauthRequired` flip on the next backend
> call, and verifying that the GAS sidebar pops a reconnect card
> instead of silently halting. Slice 6 is the user-visible proof of the
> **only** documented narrow exception to AutoColor's "Halt on Failure"
> rule (`docs/architecture-guidelines.md:17`). Each step pins what the
> reviewer sees, which Google API call (if any) the step exercises,
> and the observable outcome that confirms the step succeeded. Cited
> line numbers should pass a `grep -n` spot-check against the source
> files; the bundle's "drift guard" relies on this.

- **Scopes exercised in this scenario (backend OAuth):**
  No new scope is exercised — slice 6 demonstrates the **failure
  path** of the same backend OAuth scopes already granted at
  `01-install.md` Step 3 (`openid` / `email` / `calendar` /
  `calendar.events` per `src/config/constants.ts:1-6`, the
  `OAUTH_SCOPES` array). The recovery leg re-runs the same consent
  flow as the install scenario; no incremental scope is requested.
- **Pre-conditions:**
  - Scenarios `01-install.md` and `02-rule-to-color.md` completed:
    reviewer holds a valid AutoColor backend session backed by a
    Google refresh token at `oauth_tokens.encrypted_refresh_token`
    (`src/db/schema.ts:44`) with `oauth_tokens.needs_reauth = false`
    (`src/db/schema.ts:51`).
  - Reviewer has access to **either** Google Account permissions
    (https://myaccount.google.com/permissions, the realistic reviewer
    path) **or** direct write access to the `oauth_tokens` row in
    Supabase Studio (the synthetic short-circuit; faster but requires
    DB admin).

## Two consent surfaces (pre-read)

This scenario does not re-explain the framework-vs-backend scope
split; see `01-install.md` "Two consent surfaces (pre-read)" for the
full walkthrough. The single load-bearing fact for this scenario: the
recovery flow re-enters the **same backend OAuth surface** the
reviewer first saw at `01-install.md` Step 3 (the consent screen
listing the four backend scopes from `src/config/constants.ts:1-6`).
Re-granting access in Google's account-permissions page
(https://myaccount.google.com/permissions) is **not** sufficient — see
Failure mode (e) for why.

## 1. Reviewer simulates revocation

- **Reviewer action.** Two options. (a) Open
  https://myaccount.google.com/permissions, find "AutoColor for
  Calendar", and click "Remove access" — the realistic reviewer path.
  (b) UPDATE the `oauth_tokens` row in Supabase Studio to corrupt
  `encrypted_refresh_token` (the AES-GCM ciphertext stays
  decryptable, but the resulting plaintext is no longer a valid
  Google refresh token) — the synthetic short-circuit.
- **Surface.** None inside AutoColor — this step happens entirely in
  Google Account UI (path a) or Supabase Studio (path b). The
  reviewer does **not** see a card change yet; the cached
  `oauth_tokens.needs_reauth` flag is still `false` until step 2
  fires a backend call.
- **Backend / Google API call.** None synchronously. Path (a)
  updates Google's internal grant table; AutoColor will not learn of
  the revocation until the next refresh-token exchange in Step 3.
  Path (b) mutates only the `encrypted_refresh_token` column —
  `needs_reauth` is untouched.
- **Observable outcome.** No reviewer-visible change yet. The
  `oauth_tokens` row for the test user still reads
  `needs_reauth: false` (proof the backend has not detected the
  revocation yet). State: armed, undetected.

## 2. Reviewer triggers any backend call

- **Reviewer action.** Open the AutoColor sidebar in Google Calendar
  and tap the `"지금 동기화"` button on the home card. (Any
  backend-touching action will trigger detection — this is the
  lowest-friction option.) The button is bound to `actionSyncNow`
  (`gas/addon.js:278-303`).
- **Surface.** The sidebar transiently shows the same home card; no
  toast yet because the backend round-trip is still in flight.
- **Backend / Google API call.** GAS `fetchBackend` (`gas/api.js:15`)
  issues `POST /sync/run` with the session bearer. The Worker route
  calls `getValidAccessToken` (`src/services/tokenRefresh.ts:34`)
  before any Google API hop. This is the call site that will fail in
  Step 3.
- **Observable outcome.** Backend latency spike (~Google token
  endpoint round-trip). The route returns HTTP 401 to GAS once
  `ReauthRequiredError` propagates (see Step 3).

## 3. Backend detects `invalid_grant` and flips `needs_reauth`

- **Reviewer action.** None — backend trace.
- **Surface.** None.
- **Backend / Google API call.**
  1. `getValidAccessToken` at `src/services/tokenRefresh.ts:34`
     decrypts the stored refresh token and POSTs to Google's token
     endpoint with `grant_type: "refresh_token"`.
  2. Google rejects with HTTP 4xx + JSON body
     `{ "error": "invalid_grant" }`. The branch at
     `src/services/tokenRefresh.ts:74`
     (`if (errorCode === "invalid_grant")`) fires.
  3. `await markReauthRequired(db, userId, "invalid_grant")` at
     `src/services/tokenRefresh.ts:75` — implementation at
     `src/services/oauthTokenService.ts:119-134` — flips
     `oauth_tokens.needs_reauth = true` and stamps
     `oauth_tokens.needs_reauth_reason = "invalid_grant"` for the
     `(userId, provider="google")` tuple.
  4. `throw new ReauthRequiredError("invalid_grant")` at
     `src/services/tokenRefresh.ts:76`. Class definition at
     `src/services/tokenRefresh.ts:7-12` (extends `Error`, carries
     a `reason` field).
  5. `ReauthRequiredError` propagates out of the Hono handler chain;
     the Worker's error mapping converts it to HTTP 401, which is
     what the GAS client sees.
- **Observable outcome.** One row in `oauth_tokens` now reads
  `needs_reauth: true, needs_reauth_reason: 'invalid_grant'`
  (`src/db/schema.ts:51-52`). The Worker's HTTP response to GAS is
  `401 Unauthorized`. The next `/me` call will return
  `needs_reauth: true` (`src/routes/me.ts:43-48`) — the
  user-visible flag is now armed.

## 4. GAS sidebar pops the reconnect card

- **Reviewer action.** None until the card renders; then the
  reviewer taps the `"OAuth 연동 (재로그인)"` button.
- **Surface.** `fetchBackend` at `gas/api.js:15` sees status 401 and
  throws `Error('AUTH_EXPIRED')` at `gas/api.js:43-47`.
  `actionSyncNow`'s catch at `gas/addon.js:288-293` matches
  `err.message === 'AUTH_EXPIRED'` and returns an `ActionResponse`
  with `setNavigation(...).popToRoot().updateCard(buildReconnectCard())`.
  `buildReconnectCard` is defined at `gas/addon.js:1107`; it shows
  title `"재연결 필요"` (`gas/addon.js:1111`), subtitle
  `"권한 부족 또는 토큰 만료"` (`gas/addon.js:1112`), body
  `"세션이 만료되었거나 권한이 부족합니다. 다시 연결해주세요."`
  (`gas/addon.js:1116`), and a fixed-footer button labeled
  `"OAuth 연동 (재로그인)"` (`gas/addon.js:1123`) bound to
  `actionReconnectOAuth` (`gas/addon.js:1132-1135`, which delegates
  to `actionStartOAuth`).
- **Backend / Google API call.** When the reviewer taps the button,
  the full OAuth flow at `src/routes/oauth.ts` re-runs: redirect to
  Google's authorization endpoint → user re-grants the four backend
  scopes → callback → `exchangeCode` mints a **fresh** refresh
  token → `saveGoogleRefreshToken` overwrites
  `oauth_tokens.encrypted_refresh_token` AND clears the
  `needs_reauth` flag in the same write.
- **Observable outcome.** Reviewer sees the `"재연결 필요"` card →
  completes OAuth → lands back on the AutoColor home card with a
  fresh session and a fresh refresh token.
  `oauth_tokens.needs_reauth` is now `false` again; subsequent
  `/sync/run` and other backend calls succeed. Recovery loop closed.

### Failure modes

- **(a) `invalid_grant` during watch renewal cron.**
  `renewExpiringWatches` runs from cron, not from a user request.
  The `getValidAccessToken` call at
  `src/services/watchRenewal.ts:104-124` throws
  `ReauthRequiredError`; the cron-side catch labels the outcome
  `code: "reauth_required"` (`src/services/watchRenewal.ts:121`)
  and warn-logs. The `oauth_tokens.needs_reauth` flip itself
  happens **inside** `getValidAccessToken` at
  `src/services/tokenRefresh.ts:75`, so the flag flips even when
  the failure surfaces from cron. **No card pops here** — there is
  no user request in flight to attach a `setNavigation` to. The
  reviewer sees the reconnect card on their next sidebar action
  because `/me` returns `needs_reauth: true` and `buildHomeCard`
  short-circuits to `buildReconnectCard()` at
  `gas/addon.js:147-150`.
- **(b) `invalid_grant` during `color_rollback` queue consumer.**
  Triggered when the user deletes a category at the moment Google
  has revoked the token. `runColorRollback` returns
  `{ ok: false, reason: "reauth_required", ... }` from
  `src/services/colorRollback.ts:96` (initial token exchange) or
  `src/services/colorRollback.ts:122` (mid-paging refresh). The
  consumer's `applyRollbackResult` branch at
  `src/queues/syncConsumer.ts:281-286` calls `markReauthRequired`
  and `msg.ack()` — no retry, because reauth is terminal. One row
  in `rollback_runs` with `outcome: 'reauth_required'` (the
  `outcome` column is set at `src/queues/syncConsumer.ts:254` via
  `result.ok ? "ok" : result.reason`). The card surfaces on the
  next sidebar action via the same `/me` → `buildHomeCard` →
  `buildReconnectCard` path as (a).
- **(c) `invalid_grant` during sync consumer mid-run.**
  `runIncrementalSync` / `runFullResync` return
  `{ ok: false, reason: "reauth_required", ... }`; the consumer's
  `applyResult` branch at `src/queues/syncConsumer.ts:356-360`
  calls `markReauthRequired` and `msg.ack()`. One row in
  `sync_runs` with `outcome: 'reauth_required'` (the column is set
  at `src/queues/syncConsumer.ts:154` via `record.outcome` from
  the `finalize(result)` helper inside `runPagedList`). The card
  surfaces on the next sidebar action.
- **(d) Other `?error=<code>` branches in `authError.html`.** When
  the OAuth handshake itself fails (NOT the post-handshake refresh
  path), `gas/authError.html:73-77` parses `?error=` via
  `google.script.url.getLocation` and shows the matching Korean
  message. Six branches at `gas/authError.html:31-54`:
  `state_invalid`, `consent_denied`, `provider_error`,
  `token_exchange_failed`, `invalid_grant` (primary
  `"Google 리프레시 토큰이 무효화되었습니다."` at
  `gas/authError.html:48`), and `server_error`. Four codes are
  thrown from the OAuth callback at
  `src/routes/oauth.ts:38, 43, 49, 53, 108-110` (`consent_denied`
  / `provider_error` / `state_invalid` / `server_error`). The
  remaining two codes (`token_exchange_failed`, `invalid_grant`)
  are post-handshake — surfaced via the
  `oauth_tokens.needs_reauth` flag + reconnect card path described
  in Steps 1–4, **not** via `authError.html`. The `invalid_grant`
  HTML branch is reachable only when the OAuth callback itself
  sees `invalid_grant`, which is rare in practice; the typical
  surface is the reconnect card from Step 4.
- **(e) Reviewer re-grants in Google settings WITHOUT clicking the
  reconnect button.** A re-grant at
  https://myaccount.google.com/permissions does **not** trigger
  AutoColor's `/oauth/google/callback` (no redirect chain runs).
  `oauth_tokens.encrypted_refresh_token` is still the revoked
  token; `oauth_tokens.needs_reauth` is still `true`. On the next
  sidebar action, `/me` returns `needs_reauth: true`
  (`src/routes/me.ts:43-48`) and `buildHomeCard` returns
  `buildReconnectCard()` (`gas/addon.js:147-150`). To verify the
  flag persists, the reviewer can also re-tap `"지금 동기화"` —
  `actionSyncNow` will hit the backend, the same `invalid_grant`
  branch at `src/services/tokenRefresh.ts:74-76` fires, GAS sees a
  fresh 401, and the catch at `gas/addon.js:288-293` re-pops the
  reconnect card. Only the reconnect button's full OAuth re-run
  mints a new refresh token AND clears `needs_reauth` (the same
  row stamped by `saveGoogleRefreshToken` during the original
  install).

### Cross-references

- `docs/architecture-guidelines.md` "Halt on Failure"
  (`docs/architecture-guidelines.md:17`) — the architectural rule
  that names `invalid_grant` as the **only** documented narrow
  exception to halt-on-failure. Slice 6 is the user-visible proof
  of that exception.
- `src/CLAUDE.md` "Secret rotation impact"
  (`src/CLAUDE.md:47-97`, esp. the `TOKEN_ENCRYPTION_KEY_PREV`
  failure-mode bullets at `src/CLAUDE.md:73-97`) — policy
  contrast: per-row PREV decrypt failures are deliberately **not**
  mapped to reauth (they fall through to the original error / lazy
  reauth on next request). Slice 6's `invalid_grant` is the
  opposite policy — eager flip + user-visible reconnect card. The
  two contrasted policies together define the narrow-exception
  boundary.
- `src/CLAUDE.md` "Observability tables (§6 Wave A)"
  `rollback_runs` (`src/CLAUDE.md:233-248`) — the writer-side
  contract for failure mode (b)'s `rollback_runs` row with
  `outcome: 'reauth_required'`; pins the same fire-and-forget
  insert + never-retry-on-insert-failure discipline that the
  consumer at `src/queues/syncConsumer.ts:281-286` upholds.
- `docs/assets/marketplace/reviewer-demo/05-rule-deletion-rollback.md`
  "Failure modes (a)" (`:223-238`) — sibling slice that mentions
  the rollback-side reauth case in passing. Slice 6 is its
  canonical walkthrough.
- `docs/assets/marketplace/reviewer-demo/02-rule-to-color.md`
  "Failure modes" (`:184-203`) — earlier slice that
  forward-references slice 6 as `(pending)`. Slice 02 is the
  **ingress side** (rule create → `events.patch`); slice 6 is the
  **recovery side** for the same backend OAuth path.
- `docs/assets/marketplace/reviewer-demo/01-install.md` "Failure
  modes — Re-auth on `invalid_grant`" (`:272-275`) — earliest
  slice that forward-references slice 6 as `(pending)`. Slice 01
  is the install-time consent surface; slice 6 re-uses that exact
  surface for recovery.
- `docs/marketplace-readiness.md` §4 row 6 — the row this file is
  the canonical source-of-truth for. Status flipped from `미작성`
  to `초안` on slice 6 merge; source-of-truth pointer flipped from
  `gas/authError.html` to this file.

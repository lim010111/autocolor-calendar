# Scenario 07 — Service disconnect / account deletion

> Walks the reviewer through requesting account deletion from the
> AutoColor sidebar, observing the backend's authoritative
> `DELETE FROM users` (FK cascade across 9 user-scoped tables) and the
> best-effort Google API cleanup that runs first (refresh-token revoke +
> per-calendar `channels.stop`), and verifying the sidebar returns to
> the welcome / install-prompt state. Slice 7 is the user-visible proof
> of the data-deletion path required by Marketplace privacy review
> (`docs/marketplace-readiness.md` §3 row 179). Each step pins what the
> reviewer sees, which Google API call (if any) the step exercises, and
> the observable outcome that confirms the step succeeded. Cited line
> numbers should pass a `grep -n` spot-check against the source files;
> the bundle's "drift guard" relies on this.

- **Scopes exercised in this scenario (backend OAuth):**
  No new scope is exercised — slice 7 demonstrates the **deletion path**
  for an account that already holds the four backend scopes granted at
  `01-install.md` Step 3 (`openid` / `email` / `calendar` /
  `calendar.events` per `src/config/constants.ts:1-6`, the
  `OAUTH_SCOPES` array). The deletion itself does not request any
  incremental scope; the `revokeRefreshToken` call (Step 3 sub-bullet 1)
  targets Google's `oauth2/revoke` endpoint and consumes no Calendar
  scope.
- **Pre-conditions:**
  - Scenarios `01-install.md` and (optionally) `02-rule-to-color.md`
    completed: reviewer holds a valid AutoColor backend session backed
    by an `oauth_tokens` row with `needs_reauth: false`
    (`src/db/schema.ts:51`) and zero or more `sync_state` rows
    (`src/db/schema.ts:110-164`) carrying active watch channels (the
    `watch_channel_id` column on `sync_state`).
  - Reviewer can read either Supabase Studio or the Worker logs to
    verify post-DELETE state. A 401 from the next sidebar action is
    the user-visible proxy when DB access is unavailable.

## Two consent surfaces (pre-read)

This scenario does not re-explain the framework-vs-backend scope split;
see `01-install.md` "Two consent surfaces (pre-read)" for the full
walkthrough. The single load-bearing fact for slice 7: deletion does
**not** open a consent surface. The `revokeRefreshToken` call hits
Google's `oauth2/revoke` endpoint with the existing refresh token and
returns a `2xx` (or a benign error envelope on already-revoked tokens,
treated as best-effort) — no card pops, no Allow / Deny prompt. Slice
1's consent surface only re-opens if the **same** user later reinstalls
AutoColor; slice 7 is the **leave** surface, slice 1 is the **enter**
surface.

## 1. Reviewer opens the deletion confirmation card

- **Reviewer action.** From the home card, tap `"상세 설정"`
  (`gas/addon.js:218`, action `actionGoToSettings` set at
  `gas/addon.js:219`; handler at `gas/addon.js:317-320` pushes
  `buildSettingsCard()`). Inside the settings card's account section,
  tap `"계정 삭제 / 데이터 삭제"` (`gas/addon.js:965`), bound to
  `actionGoToAccountDeleteConfirm` (`gas/addon.js:967`; handler at
  `gas/addon.js:1027-1031` pushes `buildAccountDeleteConfirmCard()`).
- **Surface.** Card `buildAccountDeleteConfirmCard` at
  `gas/addon.js:1033-1060` — title `"계정 삭제"` (`gas/addon.js:1037`),
  subtitle `"정말 삭제하시겠습니까?"` (`gas/addon.js:1038`), warning
  body
  `"⚠️ 주의: 모든 데이터가 영구 삭제됩니다. 카테고리·동기화 상태·OAuth 연결·세션이 모두 제거되며, 이 작업은 되돌릴 수 없습니다."`
  (`gas/addon.js:1042`), cancel button `"⬅ 취소"` bound to
  `actionGoBack` (`gas/addon.js:1050-1051`), confirm button
  `"네, 삭제합니다"` bound to `actionConfirmDeleteAccount`
  (`gas/addon.js:1053-1055`).
- **Backend / Google API call.** None — purely client-side card push.
- **Observable outcome.** Confirmation card visible. No DB or Google
  API mutations.

## 2. Reviewer confirms; GAS posts `/api/account/delete`

- **Reviewer action.** Tap `"네, 삭제합니다"`. Handler:
  `actionConfirmDeleteAccount` at `gas/addon.js:1062-1077`.
- **Surface.** Brief loading state. On success the catch block at
  `gas/addon.js:1065-1069` is bypassed,
  `AutoColorAuth.clearSessionToken()` fires at `gas/addon.js:1072`,
  and the navigation chain returns to `buildWelcomeCard()` via
  `popToRoot().updateCard(buildWelcomeCard())` at
  `gas/addon.js:1074`, with a toast
  `"계정이 삭제되었습니다."` at `gas/addon.js:1075`.
- **Backend / Google API call.**
  `AutoColorAPI.fetchBackend('/api/account/delete', { method: 'post' })`
  at `gas/addon.js:1064`. The Worker route at
  `src/routes/account.ts:34` enters with bearer extracted at
  `src/routes/account.ts:36` and `userId` resolved by `authMiddleware`
  registered at `src/routes/account.ts:17`.
- **Observable outcome.** The response is `{ ok: true }`
  (`src/routes/account.ts:122`). On a non-2xx response, GAS catches at
  `gas/addon.js:1065-1069` and surfaces
  `"계정 삭제 실패: " + err.message` toast — local state is **not**
  cleared, so the reviewer can retry.

## 3. Backend executes the four-step deletion order

- **Reviewer action.** None (backend trace).
- **Surface.** None — the sidebar still shows the pre-redirect state
  until the response returns.
- **Backend / Google API call.** Order is required (and documented as
  such at `src/routes/account.ts:25-30`):
  1. **Step 1 — best-effort refresh-token revoke**
     (`src/routes/account.ts:39-58`). `getGoogleRefreshToken`
     (`src/routes/account.ts:41-48`) decrypts the stored token under
     `TOKEN_ENCRYPTION_KEY`; the `TOKEN_ENCRYPTION_KEY_PREV` second
     argument (`src/routes/account.ts:45`) is **optional** — bound
     only during an active rotation window per `src/CLAUDE.md` "Token
     rotation (§3 후속)" / `docs/architecture-guidelines.md` "Token
     encryption rotation invariant", so outside the window deletion
     runs the same single-key path the rest of the codebase uses. On a
     non-null result, `revokeRefreshToken(stored.refreshToken)` at
     `src/routes/account.ts:49` POSTs to Google's `oauth2/revoke`. The
     failure path at `src/routes/account.ts:50-58` warn-logs only — no
     rethrow — so a Google API outage cannot block deletion (failure
     mode (a)).
  2. **Step 2 — best-effort `channels.stop` per active watch row**
     (`src/routes/account.ts:65-98`). The outer `try` at
     `src/routes/account.ts:65-89` calls `getValidAccessToken`
     (`src/routes/account.ts:66`) once; on success it SELECTs
     `sync_state` rows with non-null `watch_channel_id`
     (`src/routes/account.ts:67-75`), then loops
     `stopWatchChannel(db, accessToken, userId, row.calendarId)`
     (`src/routes/account.ts:76-89`). Per-row failures warn-log at
     `src/routes/account.ts:79-87` and the loop continues — one bad
     row does not skip its siblings. The outer catch at
     `src/routes/account.ts:90-98` covers the case where token
     refresh itself fails (e.g. the user already revoked the grant in
     a prior step); the entire watch-cleanup loop is skipped, and
     orphan channels expire ≤ 7d (failure mode (b)).
  3. **Step 3 — authoritative `DELETE FROM users`**
     (`src/routes/account.ts:102`,
     `db.delete(users).where(eq(users.id, userId))`). FK cascade fans
     out to 9 user-scoped tables, each declared with
     `references(() => users.id, { onDelete: "cascade" })` at the
     following lines: `oauth_tokens` (`src/db/schema.ts:42`),
     `sessions` (`src/db/schema.ts:72`), `categories`
     (`src/db/schema.ts:90`), `sync_state` (`src/db/schema.ts:118`),
     `llm_usage_daily` (`src/db/schema.ts:175`), `sync_failures`
     (`src/db/schema.ts:192`), `llm_calls` (`src/db/schema.ts:232`),
     `rollback_runs` (`src/db/schema.ts:279`), `sync_runs`
     (`src/db/schema.ts:339`). This is the **only** path that
     propagates errors to the response — a DB failure here returns
     500, and Step 4 does not run (failure mode (e), pinned by
     `src/__tests__/accountRoute.test.ts:271-280`). The 9-count is
     pinned by the regex test at
     `src/__tests__/accountRoute.test.ts:282-296` (regex literal at
     `:291-293`, count assert `9` at `:295`).
  4. **Step 4 — defense-in-depth session revoke**
     (`src/routes/account.ts:104-120`). `revokeSession(db, c.env.SESSION_PEPPER, bearer)`
     at `src/routes/account.ts:110`. The cascade at Step 3 already
     removed the `sessions` row, so this is a no-op against the
     authoritative state. Wrapped in try/catch at
     `src/routes/account.ts:111-119` so a stray DB error after a
     successful Step 3 cannot turn deletion into a 5xx.
- **Observable outcome.** A `SELECT count(*) FROM users WHERE id = ?`
  for the test user returns `0`; corresponding rows in all 9 cascade
  tables are gone. Worker response body: `{ ok: true }`
  (`src/routes/account.ts:122`). Worker log lines (if any) are
  aggregate-shape only — `op` / `calendarId` / `String(err)` per
  `src/CLAUDE.md` "Account deletion (§3 row 179)" warn-line redaction
  bullet — never event content, never decrypted token material.

## 4. GAS sidebar returns to the welcome / install-prompt state

- **Reviewer action.** None until the card re-renders; subsequent taps
  on any sidebar action re-enter the install path.
- **Surface.** `actionConfirmDeleteAccount` returns an `ActionResponse`
  with `setNavigation(...).popToRoot().updateCard(buildWelcomeCard())`
  (`gas/addon.js:1073-1075`) plus the notification
  `"계정이 삭제되었습니다."` (`gas/addon.js:1075`). `buildWelcomeCard`
  is the same card surface scenario `01-install.md` Step 1 lands on —
  reviewer is back at the install entry point.
- **Backend / Google API call.** Subsequent calls fail with 401 because
  `authMiddleware` (`src/routes/account.ts:17`) cannot resolve the
  bearer — the `sessions` row is cascade-gone. This is the idempotency
  surface: a second call to `/api/account/delete` from the same client
  returns 401 (per `src/CLAUDE.md` "Account deletion (§3 row 179)" —
  "Idempotency is provided by the auth gate, not the route"). GAS
  surfaces this as `"계정 삭제 실패: AUTH_EXPIRED"` toast because
  `AutoColorAPI.fetchBackend` throws `Error('AUTH_EXPIRED')` on 401
  (`gas/api.js:18`, `gas/api.js:46`).
- **Observable outcome.** Reviewer sees the welcome card. Re-installing
  AutoColor on the same Google account walks the full slice 1 install
  flow from scratch — the deletion was complete; nothing carries over.

### Failure modes

- **(a) Google `revokeRefreshToken` failure (Step 3 sub-bullet 1).**
  Best-effort. `src/routes/account.ts:50-58` catches and warn-logs
  `"account.delete revoke failed"` with `String(err)` only. Deletion
  proceeds. The user has explicitly asked to leave; a Google API
  outage MUST NOT block their data deletion. This is the narrow
  exception called out at `docs/architecture-guidelines.md` →
  "User-initiated deletion (§3 row 179)" — distinct from the OAuth
  `invalid_grant` exception that slice 6 walks (`docs/architecture-guidelines.md`
  → "Halt on Failure"). The refresh-token row is cascade-dropped
  seconds later by Step 3 anyway, so a non-revoked Google grant is
  the only residual; reviewers can verify the row was removed
  client-side from https://myaccount.google.com/permissions.
- **(b) `channels.stop` failure (Step 3 sub-bullet 2).** Best-effort.
  Per-row failure warn-logs at `src/routes/account.ts:79-87` (with
  `calendarId` and `String(err)` only — no event content) and the
  loop continues. If `getValidAccessToken` itself throws (e.g. the
  refresh token has already been revoked), the outer catch at
  `src/routes/account.ts:90-98` skips the entire loop. Orphaned
  channels expire ≤ 7d. Inbound webhook deliveries during that window
  land at `lookupChannelOwner` (`src/services/watchChannel.ts:225-253`)
  which returns `null` at `src/services/watchChannel.ts:246` (no
  `sync_state` row matches the `(channelId, resourceId)` pair after
  cascade) — the webhook handler short-circuits, no work happens, no
  error surfaces to Google.
- **(c) Concurrent watch-renewal race.** `renewExpiringWatches` cron
  does not coordinate with deletion. Worst case: cron registers a
  fresh `channels.watch` for a (user, calendar) row immediately
  before / after Step 3's cascade DELETE drops the row. The fresh
  channel is orphaned for ≤ 7d; the next webhook against it walks
  the same `lookupChannelOwner` null path as (b). This matches
  `src/CLAUDE.md` "Account deletion (§3 row 179)" — "observed, not
  prevented." Adding a Step 0 claim of
  `sync_state.watch_renewal_in_progress_at` would pointlessly
  serialise deletion against an unrelated worker, and the column has
  a single sole writer — `src/services/watchRenewal.ts`'s per-row
  loop, per `src/CLAUDE.md` "Watch renewal concurrency (§6.4)" — that
  deletion must not become a second writer to.
- **(d) Idempotency / second call.** The route itself is **not**
  idempotent — `authMiddleware` is. A second client retry carries a
  bearer that no longer resolves a session (the `sessions` row was
  cascade-dropped at Step 3), so `authMiddleware` returns 401 before
  the route handler runs. From the reviewer's perspective the sidebar
  shows `"계정 삭제 실패: AUTH_EXPIRED"` toast on retry (the
  `AutoColorAPI.fetchBackend` 401 path at `gas/api.js:46` throws
  `Error('AUTH_EXPIRED')`), and the welcome card is already visible.
  Source contract: `src/CLAUDE.md` "Account deletion (§3 row 179)" —
  "Idempotency is provided by the auth gate, not the route."
- **(e) Step 3 (`DELETE FROM users`) failure.** This is the only step
  whose error surfaces. The route returns 500; `revokeSession` (Step
  4) is **not** called.
  `src/__tests__/accountRoute.test.ts:271-280` ("users delete failure
  surfaces 500") pins this — the `expect(revokeSessionMock).not.toHaveBeenCalled()`
  assertion at `src/__tests__/accountRoute.test.ts:279` confirms Step
  4 is gated on Step 3's success. The reviewer sees a
  `"계정 삭제 실패: <err.message>"` toast (`gas/addon.js:1066-1068`)
  and the welcome card is **not** shown — local state is preserved so
  the reviewer can retry. A retry with the same valid bearer re-enters
  the route at Step 1; revoke is best-effort (so a re-revoke against
  an already-revoked grant warn-logs and continues), Step 2 re-runs
  against the still-present `sync_state` rows, and Step 3 reattempts.
  The retry converges as soon as the underlying DB error clears.

### Cross-references

- `src/CLAUDE.md` "Account deletion (§3 row 179)"
  (`src/CLAUDE.md:411-456`) — the operational contract this slice
  walks. Pins the four-step order, the 9-table cascade as the sole
  authoritative writer, the best-effort vs authoritative split between
  Google API cleanup and the DELETE, the warn-line redaction stance,
  and the "observed, not prevented" stance toward the watch-renewal
  race in failure mode (c).
- `docs/architecture-guidelines.md` "User-initiated deletion (§3 row
  179)" — the cross-cutting invariant. Calls out best-effort Google
  cleanup + authoritative cascade as a **narrow** exception to "Halt
  on Failure" (the same architectural rule slice 6 walks the canonical
  `invalid_grant` case of). Slice 7 is the user-visible proof of that
  exception.
- `docs/marketplace-readiness.md` §3 row "Deletion on account revoke"
  — the Admin-question shape pointing at this route. Slice 7 is the
  reviewer-facing proof; the §3 row is the Admin-facing index.
- `docs/marketplace-readiness.md` §4 row 7 — the row this file is the
  source-of-truth for. Status: `초안` (flipped from `미작성` on slice
  7 merge); Source of truth: `docs/assets/marketplace/reviewer-demo/07-account-deletion.md`.
- `docs/assets/marketplace/reviewer-demo/06-reauth-invalid-grant.md`
  — sibling slice. Slice 6 is the **recovery** path for a revoked
  token (user wants back in); slice 7 is the **deletion** path (user
  wants out for good). The two close out the lifecycle: install
  (slice 1) → use (slices 2-5) → recover (slice 6) → leave (slice 7).
- `src/__tests__/accountRoute.test.ts` "schema cascade contract"
  (`:282-296`) — pins the 9-count regex that the slice's Step 3
  sub-bullet 3 quotes. Adding a new user-scoped table without
  `references(() => users.id, { onDelete: "cascade" })` would silently
  leak rows on deletion; loosening that regex (or de-narrowing it
  back to a plain `onDelete: "cascade"` count) weakens the contract.

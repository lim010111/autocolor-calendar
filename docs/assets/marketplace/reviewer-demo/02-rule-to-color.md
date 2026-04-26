# Scenario 02 — Create rule → color applied

> Walks the reviewer through the chronological flow from creating the
> first category rule to seeing the configured color land on a synthetic
> calendar event, then re-running the sync to demonstrate idempotency.
> Each step pins what the reviewer sees, which Google API call (if any)
> the step exercises, and the observable outcome that confirms the step
> succeeded. Cited line numbers should pass a `grep -n` spot-check
> against the source files; the bundle's "drift guard" relies on this.

- **Scopes exercised in this scenario (backend OAuth):**
  `https://www.googleapis.com/auth/calendar.events` (Sensitive — the
  scope this scenario justifies). Citation: `src/config/constants.ts:1-6`
  (the `OAUTH_SCOPES` array; this scenario exercises the 4th entry, the
  only Sensitive scope on the backend OAuth surface).
- **Pre-conditions:**
  - Scenario `01-install.md` completed: reviewer holds a valid AutoColor
    backend session (a `sessions` row + `oauth_tokens` row, written by
    the OAuth callback at `src/routes/oauth.ts:63-83`).
  - Reviewer is on the post-OAuth Home card (`gas/addon.js:155`).
  - No categories yet for this user (the rule manager will render its
    empty-state row).

## Two consent surfaces (pre-read)

This scenario does not re-explain the framework-vs-backend scope split;
see `01-install.md` "Two consent surfaces (pre-read)" for the full
walkthrough. The single relevant fact for this scenario: the Sensitive
`calendar.events` scope was granted at `01-install.md` Step 3 (the
backend OAuth consent surface). This scenario is its first **write-side**
exercise — the `events.patch` request that stamps a colorId plus the
§5.4 three-key ownership marker.

## 1. Open rule manager from Home card

- **Reviewer action.** From the post-OAuth Home card, tap the
  `"매핑 규칙 관리"` button (`gas/addon.js:214`).
- **Surface.** GAS dispatches to `buildRuleManagementCard`
  (`gas/addon.js:700`). Card body:
  - Section header: `"새 규칙 추가"` (`gas/addon.js:718`).
  - Keyword input: title `"키워드 (예: 주간회의)"`
    (`gas/addon.js:720-722`).
  - Color grid: title `"캘린더 색상 선택"` (`gas/addon.js:728`).
  - Submit button: `"규칙 추가"` (`gas/addon.js:756`).
  - Helper text under the form:
    `"💡 키워드가 제목·설명에 부분 일치하면 색상이 적용됩니다.
    수동으로 바꾼 색상은 보존됩니다."` (`gas/addon.js:761`).
  - List section header: `"내 규칙 목록"` (`gas/addon.js:767`).
  - List helper text: `"ℹ️ 이미 색이 지정된 일정은 자동 변경되지
    않습니다. 규칙 추가 후 홈의 '지금 즉시 동기화'를 눌러 적용하세요."`
    (`gas/addon.js:770`).
- **Backend / Google API call.** None. The card render runs entirely
  in GAS; `fetchCategoriesOrError()` is called at the top of the
  builder (`gas/addon.js:704`) but for a fresh account it returns an
  empty list and the empty-state branch renders the zero-rules state.
- **Observable outcome.** Rule manager card visible; the `"내 규칙 목록"`
  section is empty (no rules yet).

## 2. Create category (POST /api/categories)

- **Reviewer action.** Type the keyword `회의` into the keyword input,
  pick a color (e.g. the second swatch in the color grid), then tap
  `"규칙 추가"`.
- **Surface.** Card-level submit dispatches `actionAddRule`
  (`gas/addon.js:842`). The handler reads the form inputs, then calls
  `AutoColorAPI.fetchBackend('/api/categories', { method: 'post', ... })`
  (`gas/addon.js:859`).
- **Backend / Google API call.** POST `/api/categories` reaches the
  Hono route at `src/routes/categories.ts:76`. The handler validates
  the request body, then runs the Drizzle insert at
  `src/routes/categories.ts:89` (`db.insert(categories).values({...}).returning(...)`).
  No Google API is touched in this step — category creation is a
  backend-only DB write.
- **Observable outcome.** Backend returns 201; the rule manager
  re-renders with the new rule visible in the `"내 규칙 목록"` section
  (`gas/addon.js:767`).

## 3. Create synthetic fixture event

- **Reviewer action.** Switch to Google Calendar's native UI (NOT the
  AutoColor sidebar). Create a normal calendar event titled
  `"팀 회의 - YYYY-MM-DD HH:MM"` (the canonical synthetic fixture from
  `docs/assets/marketplace/reviewer-demo/README.md:66`). Use any
  near-future time slot on the test account's primary calendar. Do
  not assign a color manually — leave the event in Calendar's default
  color.
- **Surface.** Google Calendar's own event composer; AutoColor has no
  surface here. Per the bundle convention at
  `docs/assets/marketplace/reviewer-demo/README.md:72-76` (the
  `src/CLAUDE.md` "Log redaction contract" extended to documentation),
  the event title must be a synthetic placeholder string — no real
  meeting names, attendees, or event payloads.
- **Backend / Google API call.** The reviewer's normal Calendar event
  write. AutoColor is not invoked at this step. The event lands on
  Google's calendar with no `extendedProperties.private` markers (it
  is unowned; `colorId` is `undefined`).
- **Observable outcome.** Event present on the primary calendar in
  Calendar's default color; no autocolor marker yet (any later
  `events.list` will return this event with no `extendedProperties.private`
  block).

## 4. Trigger sync — events.list + processEvent + events.patch

- **Reviewer action.** Return to the AutoColor sidebar (Home card). Tap
  the fixed-footer button `"지금 즉시 동기화"` (`gas/addon.js:229`).
- **Surface.** GAS dispatches `actionSyncNow` (`gas/addon.js:278`),
  which posts to the backend `/sync/run` endpoint
  (`gas/addon.js:280`).
- **Backend / Google API call.**
  1. The Hono route handler at `src/routes/sync.ts:20` does **not** run
     the sync inline. It validates auth + the rate-limit window, then
     calls `enqueueSync` (`src/routes/sync.ts:95`) to push a Cloudflare
     Queue message and returns immediately. This means the click does
     not block on Google API latency.
  2. Cloudflare's Queue dispatcher then invokes the consumer entry
     `syncConsumer.handleOne` (`src/queues/syncConsumer.ts:31, :35`)
     on the next worker invocation — usually within a few seconds.
     `handleOne` resolves the user's stored refresh token, exchanges
     it for a fresh access token, then calls `runIncrementalSync`
     (`src/services/calendarSync.ts:191`, called at
     `src/queues/syncConsumer.ts:174`).
  3. Inside `runIncrementalSync`, `events.list` is called against
     Google Calendar (`src/services/calendarSync.ts:309`) using the
     `calendar.events` scope (read side). The fixture event is
     returned because it was created after the last sync token.
  4. Each returned event flows through `processEvent`
     (`src/services/calendarSync.ts:133`). For our fixture: the rule
     created in Step 2 matches the keyword `회의` (substring of the
     event title), so `classification` is non-null and the function
     enters the ownership-aware skip block at
     `src/services/calendarSync.ts:164-182`. The fixture has no
     `extendedProperties.private` markers, so `appOwned` evaluates to
     `false`; but `current === ""` (the event has no prior color),
     which means the manual-skip guard at
     `src/services/calendarSync.ts:179` does not fire. The patch path
     proceeds at `src/services/calendarSync.ts:183-187`.
  5. `patchEventColor` (`src/services/googleCalendar.ts:168`) issues
     the `events.patch` request against Google Calendar (the
     `calendar.events` scope's write side — this is the request the
     scope justification covers). The patch body sets `colorId` to
     the rule's color and writes three keys under
     `extendedProperties.private`:
     - `autocolor_v` (the constant `AUTOCOLOR_KEYS.version`,
       `src/services/googleCalendar.ts:11-15`) set to
       `AUTOCOLOR_MARKER_VERSION = "1"`
       (`src/services/googleCalendar.ts:10`).
     - `autocolor_color` (the constant `AUTOCOLOR_KEYS.color`) set to
       the color we just wrote.
     - `autocolor_category` (the constant `AUTOCOLOR_KEYS.category`)
       set to the categoryId that drove the choice.
     The constants identify the keys; the over-the-wire names are the
     literal strings shown above. See `src/CLAUDE.md` "Color ownership
     marker (§5.4)" (`src/CLAUDE.md:87-141`) for the full contract.
  6. `summary.updated` increments (`src/services/calendarSync.ts:188`).
- **Observable outcome.** `/sync/run` returns 202 immediately. The
  queue-side run completes within a few seconds. There is a brief
  delay between the button tap and the color appearing in Calendar
  (Step 5) — this is the queue-processing latency, not a UI freeze.
  After completion, the `updated` counter on the run is `1`.

## 5. Verify color in Calendar UI + idempotent re-sync

- **Reviewer action.** Switch back to Google Calendar. Locate the
  fixture event. Confirm it now wears the rule's color (was Calendar
  default before, now matches the `colorId` configured in Step 2).
  Return to the AutoColor sidebar and tap `"지금 즉시 동기화"` again.
- **Surface.** Same as Step 4 — `actionSyncNow` posts to `/sync/run`,
  which enqueues another sync.
- **Backend / Google API call.** The second sync runs the same
  `events.list` → `processEvent` chain. For our fixture, this time
  `classification.colorId === current` (the marker we wrote in Step 4
  is also the current color), so `processEvent` short-circuits at
  `src/services/calendarSync.ts:160-161` (`summary.skipped_equal +=
  1; return;`). No `events.patch` is issued. The §5.4 contract
  formalises this: when `current === target`, we skip even before
  consulting the marker, because there is nothing to write.
- **Observable outcome.** The event color is unchanged; the second
  run's `skipped_equal` counter is `1`, `updated` is `0`. Idempotency
  demonstrated: re-syncing the same calendar produces no additional
  Google API writes when nothing has changed.

### Failure modes

- **Authentication expired (401 → reconnect card).** This is the
  user-visible surface for both backend session expiry and OAuth
  refresh-token revocation. Upstream cause options:
  (a) backend `sessions` row expired; (b) `src/services/tokenRefresh.ts:67-69`
  detects Google `errorCode === "invalid_grant"`, calls
  `markReauthRequired`, throws `ReauthRequiredError`, which collapses
  to a 401 on the next API call from GAS.
  GAS surface: `actionSyncNow`'s catch block at `gas/addon.js:289-291`
  (and the sibling handlers in the homepage / rule-manager card paths
  at `gas/addon.js:148-149`, `:705-706`, `:874-876`) detects
  `err.message === 'AUTH_EXPIRED'` (thrown by the `fetchBackend`
  helper on a 401 response, `gas/api.js:44-46`) and pops the
  navigation to `buildReconnectCard()` (`gas/addon.js:1107`). The
  reviewer sees a `"재로그인이 필요합니다"` card with a Google re-OAuth
  button instead of a stranded error toast. Per
  `docs/architecture-guidelines.md` "Halt on Failure", `invalid_grant`
  is the documented narrow exception to halt-on-failure: surfacing a
  re-login prompt is the correct behaviour. Pointer to the dedicated
  scenario `06-reauth-invalid-grant.md` (pending) for the full
  walkthrough.
- **`events.patch` 5xx from Google.** Thrown by `patchEventColor`
  inside `processEvent`, caught at
  `src/services/calendarSync.ts:319-338` as `CalendarApiError`.
  Server errors (`err.kind === "server"`,
  `src/services/calendarSync.ts:331`) re-throw to abort the current
  page loop and bubble out of `runIncrementalSync` as a `retryable`
  RunResult. The queue consumer's retryable branch then stamps the
  retry at `src/queues/syncConsumer.ts:378` (`msg.retry`).
  Reviewer-visible: the sync run for that calendar stays in retry;
  once the Queue's native attempt counter is exhausted, the message
  lands in the DLQ and a `sync_failures` row is written with the
  error envelope (see `src/CLAUDE.md` "Failure audit tables (§6 Wave
  A)").
- **User manually changes color after our PATCH.** The next sync
  observes a marker mismatch — the stored `autocolor_color` no longer
  equals the current `colorId`. The §5.4 ownership check at
  `src/services/calendarSync.ts:179-180` triggers `skipped_manual`
  and the function returns without issuing another `events.patch`.
  AutoColor never overwrites a user-edited color; this is the
  load-bearing invariant of the marker scheme. See `src/CLAUDE.md`
  "Color ownership marker (§5.4)" (`src/CLAUDE.md:87-141`) for the
  full contract.

### Cross-references

- `src/CLAUDE.md:87-141` — "Color ownership marker (§5.4)"; the
  contract behind both `skipped_equal` (Step 5) and `skipped_manual`
  (Failure mode 3). Reading this section explains why the three-key
  marker is necessary and why the app refuses to retro-claim a color
  it did not write.
- `docs/architecture-guidelines.md` — "Color Ownership (§5.4)"
  bullet (architectural rationale: idempotency + non-destructive
  writes). Pairs with the `src/CLAUDE.md` section above.
- `docs/assets/marketplace/reviewer-demo/01-install.md` — the
  authenticated-session pre-condition for this scenario, and the
  "Two consent surfaces (pre-read)" framing this file does not
  re-explain. The Sensitive `calendar.events` scope this scenario
  exercises was granted at `01-install.md` Step 3.

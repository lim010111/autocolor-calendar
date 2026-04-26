# Scenario 05 — Rule deletion → color rollback

> Walks the reviewer through deleting a rule from the AutoColor rule
> manager, observing the per-calendar fan-out of `color_rollback` queue
> jobs, and verifying that the §5.4 ownership marker preserves
> user-recolored events while the rule's targeted events revert to
> Calendar default. Each step pins what the reviewer sees, which Google
> API call (if any) the step exercises, and the observable outcome that
> confirms the step succeeded. Cited line numbers should pass a
> `grep -n` spot-check against the source files; the bundle's "drift
> guard" relies on this.

- **Scopes exercised in this scenario (backend OAuth):**
  `https://www.googleapis.com/auth/calendar.events` (Sensitive — same
  scope justified by slice 02's write side; slice 5 exercises the
  *clear* leg of `events.patch`, nulling `colorId` and the three
  `extendedProperties.private` marker keys). Citation:
  `src/config/constants.ts:1-6` (the `OAUTH_SCOPES` array; this
  scenario exercises the same Sensitive scope as slice 02).
- **Pre-conditions:**
  - Scenarios `01-install.md` and `02-rule-to-color.md` completed:
    reviewer holds a valid AutoColor backend session, has at least one
    rule on the `회의` category created in slice 02 step 2, and at
    least one event already PATCHed by a prior sync run (slice 02
    step 4) so the §5.4 marker is present on it.
  - A second rule-matched event whose color has been **manually
    re-painted by the reviewer in Google Calendar after slice 02
    step 4 completed** — this event will demonstrate the §5.4
    ownership-gate skip path. Any `colorId` other than the one slice
    02 wrote is sufficient; the §5.4 gate fires on inequality, not on
    a specific value.
  - At least one row in `sync_state` for the test account (slice 02
    step 4 guarantees this — without it, the per-calendar fan-out in
    Step 2 produces zero queue jobs).

## Two consent surfaces (pre-read)

This scenario does not re-explain the framework-vs-backend scope split;
see `01-install.md` "Two consent surfaces (pre-read)" for the full
walkthrough. The single relevant fact for this scenario: the Sensitive
`calendar.events` scope was granted at `01-install.md` Step 3 (the
backend OAuth consent surface). This scenario is its **clear-side**
counterpart of slice 02's write — the `events.patch` request that
nulls `colorId` and the §5.4 three-key ownership marker.

## 1. Reviewer clicks "삭제" button on a rule row

- **Reviewer action.** From the post-OAuth Home card, tap the
  `"매핑 규칙 관리"` button (`gas/addon.js:214`) to open the rule
  manager (`buildRuleManagementCard` at `gas/addon.js:700`). On the
  rule row created during slice 02 step 2 (the `회의` rule), tap the
  `"삭제"` button.
- **Surface.** The delete button is bound at `gas/addon.js:796-800` to
  `actionDeleteRule` with the rule's `id` parameter; the handler lives
  at `gas/addon.js:890`. On a successful backend response the handler
  surfaces a toast notification reading
  `"규칙이 삭제되었습니다. 적용된 색상은 곧 원상복구됩니다."`
  (`gas/addon.js:903`) — this is the reviewer's first cue that
  rollback runs **asynchronously** and the calendar grid will not
  update in this same tap.
- **Backend / Google API call.** GAS `fetchBackend` issues
  `DELETE /api/categories/<id>` with `method: 'delete'`
  (`gas/addon.js:898`). No Google API call has fired yet — the rule
  removal and queue fan-out happen entirely on the AutoColor backend
  and Google Calendar will not be touched until the queue consumer
  runs in Step 3.
- **Observable outcome.** The rule manager card re-renders without the
  deleted row; the toast appears; the Calendar grid is **unchanged at
  this moment** (rollback PATCHes are issued out-of-band by the queue
  consumer in Step 3, typically within a few seconds).

## 2. Backend handler runs tenant-scoped DELETE + per-calendar queue fan-out

- **Reviewer action.** None — backend trace.
- **Surface.** None.
- **Backend / Google API call.**
  1. Hono route at `src/routes/categories.ts:160` enters
     (`categoriesRoutes.delete("/:id", ...)`). The handler validates
     auth + the path parameter, then runs the tenant-scoped DELETE
     applying `and(eq(categories.userId, userId), eq(categories.id,
     idParse.data))`. Per `src/CLAUDE.md` "Tenant isolation", the
     `userId` predicate is mandatory — `BYPASSRLS` on the Worker's
     postgres role means RLS does not catch a missing predicate, so
     the where clause is the sole defence. On zero rows updated the
     route returns 404 and no fan-out happens.
  2. SELECT all `calendarId`s from `sync_state` for the user at
     `src/routes/categories.ts:185-188`
     (`db.select({ calendarId: syncState.calendarId }).from(syncState).where(eq(syncState.userId, userId))`).
     Deactivated rows are intentionally included — the rationale block
     at `src/routes/categories.ts:173-184` documents why ("events
     painted before deactivation still wear our marker").
  3. `Promise.allSettled` fan-out at
     `src/routes/categories.ts:190` enqueues one `color_rollback`
     queue job per calendar (`type: "color_rollback"` at
     `src/routes/categories.ts:193`) with
     `{ userId, calendarId, categoryId, enqueuedAt }`. Per-calendar
     enqueue failures are caught by `Promise.allSettled` and logged at
     `src/routes/categories.ts:204-214`
     (`console.error` with `level: "error"` + `msg: "color_rollback
     enqueue failed"`) without aborting the remaining fan-out —
     partial fan-out is preferable to a failed deletion that leaves
     stranded rows.
  4. The route returns `204` at `src/routes/categories.ts:220`
     regardless of fan-out outcome (recovery for stranded rows is a
     future cleanup tool; in the steady state, missed calendars
     will be re-evaluated on the next full sync).
- **Observable outcome.** HTTP 204 returned to GAS; one queue message
  lands per `sync_state` row in the `SYNC_QUEUE` Cloudflare Queue.

## 3. Queue consumer pages events.list, applies §5.4 ownership gate, PATCHes owned events

- **Reviewer action.** None — backend trace. The reviewer may verify
  the cited line ranges; no UI interaction occurs.
- **Surface.** None.
- **Backend / Google API call.**
  1. The queue dispatcher invokes `runColorRollback` in
     `src/services/colorRollback.ts`. Filter built at
     `src/services/colorRollback.ts:103`:
     `${AUTOCOLOR_KEYS.category}=${categoryId}` (the
     `autocolor_category` key from the `AUTOCOLOR_KEYS` constant at
     `src/services/googleCalendar.ts:11-15`). Reading the constant
     identifies the key; the over-the-wire name is the literal string
     `autocolor_category`.
  2. Paged `events.list` at
     `src/services/colorRollback.ts:109-114` issues against Google
     Calendar with `privateExtendedProperty: filter`, bounded by a
     rolling `timeMin` / `timeMax` window
     (`src/services/colorRollback.ts:101-102`) and a per-run page cap.
     The filter narrows the candidate set to events the AutoColor
     backend previously stamped with the deleted category's marker.
  3. Per-event §5.4 ownership gate at
     `src/services/colorRollback.ts:165-173`:
     ```
     const ownedColor = priv[AUTOCOLOR_KEYS.color];
     const current = event.colorId ?? "";
     if (!ownedColor || ownedColor !== current) {
       summary.skipped_manual_override += 1;
       continue;
     }
     ```
     The gate is the load-bearing invariant: the marker color we
     wrote at the last PATCH must still equal the event's current
     `colorId`. If the user re-painted the event after our PATCH, the
     two diverge and the consumer skips that event. See `src/CLAUDE.md`
     "Color ownership marker (§5.4)" (`src/CLAUDE.md:122-176`) for the
     full contract — do not re-derive it here.
  4. On gate-pass, `await clearEventColor(accessToken, ctx.calendarId,
     event.id)` at `src/services/colorRollback.ts:176`.
  5. PATCH body at `src/services/googleCalendar.ts:218-227`:
     ```
     {
       colorId: null,
       extendedProperties: {
         private: {
           [AUTOCOLOR_KEYS.version]: null,
           [AUTOCOLOR_KEYS.color]: null,
           [AUTOCOLOR_KEYS.category]: null,
         },
       },
     }
     ```
     All three marker keys are nulled in the same PATCH. Per the
     `src/services/googleCalendar.ts:200-203` comment block, Google
     merges `extendedProperties.private` per-key, so other apps'
     private properties on the same event are preserved. `colorId:
     null` resets the event to Calendar's default color.
- **Observable outcome.** Events whose color the reviewer did **not**
  modify since slice 02 revert to Calendar's default color (the marker
  matched, so the gate passed and `clearEventColor` ran). Events the
  reviewer re-painted after our PATCH stay at their user-chosen color
  (the gate failed, the consumer skipped them). Both states are
  visible side-by-side in the Calendar grid — this is the
  reviewer-visible proof of the §5.4 ownership invariant.

## 4. `applyRollbackResult` writes one `rollback_runs` row per Worker invocation; insert is fire-and-forget

- **Reviewer action.** None — backend trace.
- **Surface.** None.
- **Backend / Google API call.** No Google API call. DB write only.
  1. `applyRollbackResult` at `src/queues/syncConsumer.ts:225` runs
     **before** `msg.ack` / `msg.retry`, so every outcome — including
     retryable attempts that later DLQ — is visible in
     `rollback_runs`.
  2. `db.insert(rollbackRuns).values({...})` at
     `src/queues/syncConsumer.ts:236-257` writes the full per-run
     summary: counters (`pages` / `seen` / `cleared` /
     `skipped_manual_override` / `skipped_stale_marker` /
     `skipped_version_mismatch` / `not_found` / `forbidden_events`),
     `outcome` at `:254`, `attempt: msg.attempts` at `:255`, and an
     optional `errorMessage` for non-`ok` outcomes.
  3. `.catch(...)` at `src/queues/syncConsumer.ts:258-267`
     downgrades insert failures to a warn log
     (`"rollback_runs insert failed"` at line 262) and **never**
     triggers `msg.retry`. The schema-side comment at
     `src/db/schema.ts:263-266` and `src/CLAUDE.md` "Observability
     tables (§6 Wave A)" `rollback_runs` subsection both pin the
     rationale: a retried rollback re-issues `clearEventColor`
     PATCHes on already-cleared events and burns Google API quota,
     so observability writes must never drive that loop.
  4. The 5 outcomes are pinned by the schema check constraint at
     `src/db/schema.ts:300-303`:
     `IN ('ok','reauth_required','forbidden','not_found','retryable')`
     (the SQL clause itself sits on line 302).
     Adding a sixth outcome would require a migration — the constraint
     is the contract.
  5. `category_id` has **no foreign key** at `src/db/schema.ts:281`
     (declared as `uuid("category_id").notNull()` with no
     `.references(...)` clause). Rationale at
     `src/db/schema.ts:263-266`: the trigger for a rollback is the
     category being deleted, so the FK target is already gone by the
     time the consumer writes the audit row. A FK would block the
     write; the no-FK choice keeps the audit trail intact.
- **Observable outcome.** A `rollback_runs` row exists per (Worker
  invocation × calendar). A "retry → retry → DLQ" sequence appears as
  N rows with monotonically increasing `attempt` numbers, so a
  reviewer querying `rollback_runs` sees the full retry arc as
  separate rows. End-to-end: the Calendar grid shows targeted events
  reverted to default color, while user-recolored events remain
  unchanged — the visible proof that §5.4 fired correctly.

### Failure modes

- **(a) `AUTH_EXPIRED` → `reauth_required`.** The user's refresh
  token was revoked between the slice 02 PATCH and the slice 5
  rollback (e.g., the user revoked AutoColor in Google Account
  permissions). `getValidAccessToken` throws `ReauthRequiredError`;
  if the failure surfaces during the initial token exchange, the
  consumer returns `reason: "reauth_required"` at
  `src/services/colorRollback.ts:96`. If the failure surfaces inside
  the `events.list` page loop instead (token expired mid-run), the
  same outcome is returned at `src/services/colorRollback.ts:122`.
  `applyRollbackResult` flips `markReauthRequired`. The reviewer
  sees `buildReconnectCard()` (`gas/addon.js:1107`,
  `"재연결 필요"`) on the next sidebar interaction. One row in
  `rollback_runs` with `outcome: 'reauth_required'`. Per
  `docs/architecture-guidelines.md` "Halt on Failure",
  `invalid_grant` is the documented narrow exception that surfaces a
  re-login prompt instead of silent halt.
- **(b) Calendar permission revoked (whole-calendar 403) →
  `forbidden`.** The user lost ACL access to the calendar between
  the fan-out enqueue and the consumer run (e.g., shared calendar
  was un-shared, or the user's role was demoted). The catch at
  `src/services/colorRollback.ts:128` returns `reason: "forbidden"`,
  ack without retry. One row in `rollback_runs` with `outcome:
  'forbidden'`. Other calendars in the same fan-out are unaffected
  because each is its own queue job.
- **(c) Calendar deleted (404) → `not_found`.** The calendar itself
  was deleted between fan-out and consumer run. The catch at
  `src/services/colorRollback.ts:131` returns `reason: "not_found"`,
  same ack-no-retry pattern. One row in `rollback_runs` with
  `outcome: 'not_found'`. The stale `sync_state` row will be cleaned
  up by a future maintenance job (orthogonal to slice 5's scope).
- **(d) Transient 5xx / rate-limit → `retryable` → DLQ.** Google
  Calendar returned a 5xx, 429, or `rate_limited` error during
  `events.list` or `clearEventColor`. The catch-all retryable arm
  at `src/services/colorRollback.ts:146` returns `reason:
  "retryable"` (with `retryAfterSec` propagated when provided);
  `applyRollbackResult` calls `msg.retry`. Cloudflare Queue's native
  attempt counter increments on each retry; when attempts exhaust,
  the message lands in the DLQ. The **final** `applyRollbackResult`
  invocation still inserts a `rollback_runs` row with `outcome:
  'retryable'` and `attempt: msg.attempts`, so DLQ landings are
  visible as the highest-`attempt` row in the per-job series.
- **(e) User manually re-painted event after our PATCH →
  ownership-check skip.** The §5.4 gate at
  `src/services/colorRollback.ts:165-173` evaluates
  `ownedColor !== current` to true, increments
  `summary.skipped_manual_override += 1` at
  `src/services/colorRollback.ts:171`, and `continue`s past
  `clearEventColor`. The queue job itself still completes `ok` —
  this is a per-event skip, not a job-level failure. AutoColor never
  overwrites a user-edited color; this is the load-bearing
  invariant of the marker scheme. Reviewer-visible: the user-recolored
  event keeps its user-chosen color in the Calendar grid; the
  `rollback_runs` row's `skipped_manual_override` counter is non-zero
  while `outcome` is `ok`. See `src/CLAUDE.md` "Color ownership
  marker (§5.4)" (`src/CLAUDE.md:122-176`) for the full contract.

### Cross-references

- `src/CLAUDE.md` "Color ownership marker (§5.4)"
  (`src/CLAUDE.md:122-176`) — the contract behind the ownership gate
  at `src/services/colorRollback.ts:165-173` and the reason
  `clearEventColor` writes all three marker keys as `null`.
- `src/CLAUDE.md` "Observability tables (§6 Wave A)" `rollback_runs`
  subsection — the writer-side contract this scenario produces rows
  for; pins the fire-and-forget insert discipline,
  `never-retry-on-insert-failure` rationale, and the deliberate
  no-FK-on-`category_id` choice this scenario exercises in Step 4.
- `docs/architecture-guidelines.md` "Color Ownership (§5.4)" bullet
  — architectural rationale (idempotency + non-destructive writes);
  pairs with the `src/CLAUDE.md:122-176` section above.
- `docs/assets/marketplace/reviewer-demo/02-rule-to-color.md` —
  forward-path counterpart (rule create → `events.patch` writes
  `colorId` + 3 marker keys). Slice 5 is its inverse: clear leg of
  the same `events.patch` surface, same Sensitive `calendar.events`
  scope.
- `docs/marketplace-readiness.md` §4 row 5 — the row this file is
  the canonical source-of-truth for. Status flipped from `미작성`
  to `초안` on slice 5 merge.

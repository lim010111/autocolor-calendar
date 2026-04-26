# Scenario 03 — Event-open preview (rule hit)

> Walks the reviewer through opening an existing calendar event and
> watching the AutoColor sidebar render its rule-matched classification
> as a *read-only* preview. The sidebar reads the event via the
> Marketplace-install scope `calendar.addons.current.event.read`, posts
> a synthetic preview body to the backend, and renders the matched
> rule's category + keyword. **No `events.patch` is issued in this
> scenario** — the preview is read-only by design; the write surface is
> the sync pipeline exercised in `02-rule-to-color.md`. Cited line
> numbers should pass a `grep -n` spot-check against the source files;
> the bundle's "drift guard" relies on this.

- **Scopes exercised in this scenario (Marketplace install OAuth):**
  `https://www.googleapis.com/auth/calendar.addons.current.event.read`
  (Sensitive — the scope this scenario justifies). Citation:
  `gas/appsscript.json:5-13` (the `oauthScopes` array; this scenario
  exercises the 5th entry, the only Sensitive scope on the
  Marketplace-install consent surface that is exercised here. The
  paired `calendar.addons.current.event.write` at `gas/appsscript.json:11`
  is NOT exercised by this scenario — it is reserved for the override
  color-picker covered by a future slice).
- **Pre-conditions:**
  - Scenarios `01-install.md` and `02-rule-to-color.md` completed: the
    test account holds a valid AutoColor backend session AND has at
    least one rule whose keyword can match a synthetic event title.
    Specifically, the `회의` keyword on a `주간회의` category created at
    `02-rule-to-color.md` Step 2.
  - At least one calendar event whose summary contains the matched
    keyword. Synthetic fixture from
    `docs/assets/marketplace/reviewer-demo/README.md:66`: an event
    titled `"팀 회의 - YYYY-MM-DD HH:MM"` (the canonical reviewer-fixture
    name) with no real attendees and no real description.
  - Reviewer is on the Calendar week/day view with the AutoColor
    sidebar icon visible in the right-hand strip.

## Two consent surfaces (pre-read)

This scenario does not re-explain the framework-vs-backend scope split;
see `01-install.md` "Two consent surfaces (pre-read)" for the full
walkthrough. The single relevant fact for this scenario: the Sensitive
`calendar.addons.current.event.read` scope was granted at
**Marketplace-install consent** (the *first* of the two surfaces — it
fires once when the user installs the Add-on, before `01-install.md`
Step 1). It is NOT re-prompted on the backend OAuth surface because the
backend OAuth scope set (`src/config/constants.ts:1-6`) does not include
it — only the GAS Add-on side reads the currently open event.

## 1. Reviewer clicks the matched event in Calendar

- **Reviewer action.** From the Calendar week/day view, click the
  synthetic event `"팀 회의 - YYYY-MM-DD HH:MM"` created as the slice-2
  fixture. Google Calendar opens its native event detail popup AND
  fires the GAS `eventOpenTrigger` declared at
  `gas/appsscript.json:35-37` — the AutoColor sidebar opens
  automatically on the right.
- **Surface.** The sidebar renders the AutoColor "Event Insight" card
  (Screen 3) — the function-level documentation lives at
  `gas/addon.js:399-407`. Card body, top-down:
  - Header: `"AutoColor"`.
  - Status section, three live lines:
    - Title: `"팀 회의 - YYYY-MM-DD HH:MM"` — sourced from
      `event.getTitle()` at `gas/addon.js:424`.
    - Applied color line: `"기본"` (the calendar default, since the
      sync pipeline has not yet run on this fresh fixture). Resolved
      from `event.getColor()` and the colors palette lookup at
      `gas/addon.js:434-446`.
    - Matched rule line:
      **`매칭된 규칙: '주간회의' (키워드: '회의')`** — rendered by
      `formatMatchLine` at `gas/addon.js:356-361` from the rule-hit
      response body. **This line is the load-bearing piece of UI for
      the read-scope justification: the only way it can render is by
      reading the currently-open event's `summary` and posting it to
      the backend, which is exactly what the
      `calendar.addons.current.event.read` scope is granted for.**
  - Override section below (color-picker grid + exclude button) is
    out of this scenario's scope; see `gas/addon.js:499-536` (it
    exercises the `current.event.write` scope covered by a future
    slice).
- **Backend / Google API call.** Two distinct call surfaces fire:
  1. **GAS-side (uses `calendar.addons.current.event.read`).** The
     `eventOpenTrigger` payload (`e.calendar.calendarId` and
     `e.calendar.id` — `gas/addon.js:420-423`) is the only thing
     Google passes to GAS. The handler then reads the event through
     CalendarApp's read-only getters:
     `getCalendarById(...).getEventById(...)` at `gas/addon.js:423`,
     `event.getTitle()` at `gas/addon.js:424`, `event.getColor()` at
     `gas/addon.js:434`, `event.getDescription()` at
     `gas/addon.js:452`, `event.getLocation()` at `gas/addon.js:455`.
     All getters; no setters; no PATCH.
  2. **Backend-side (no Google API call).** `fetchPreviewOrError`
     (`gas/addon.js:330-342`) POSTs to the Worker route
     `/api/classify/preview` at `gas/addon.js:332` with body
     `{ summary, description, location }` constructed at
     `gas/addon.js:449-457` — **the `llm` flag is intentionally
     absent** so the route stays on the rule-only short-circuit. The
     Hono handler is `src/routes/classify.ts:38-167`, which:
       a. Validates the body via the `PreviewBody` Zod schema
          (`src/routes/classify.ts:17-27`).
       b. SELECTs `categories` rows scoped to the requesting user
          (`src/routes/classify.ts:53-63` — tenant-isolated
          `where(eq(categories.userId, userId))`, ordered by
          `priority asc, createdAt asc`). Per `src/CLAUDE.md`
          "Tenant isolation".
       c. Calls the lightweight `classifyEvent` function **directly**
          (NOT `buildDefaultClassifier`) because `llm` is omitted —
          `src/routes/classify.ts:92`. Pinned by
          `src/__tests__/classifyRoute.test.ts:317-328` ("llm flag
          omitted — buildDefaultClassifier never called").
       d. `classifyEvent` (`src/services/classifier.ts:47-71`)
          performs case-insensitive substring matching across
          `summary + "\n" + description` against each category's
          `keywords` array. First hit wins
          (`src/services/classifier.ts:56-67`).
       e. Returns the rule-hit response shape at
          `src/routes/classify.ts:149-163`:
          `{ source: "rule", category: { id, name, colorId },
          matchedKeyword }`. **No Google Calendar API call is
          issued from the backend at any point in this path** —
          the route never imports the Google Calendar client.
- **Observable outcome.** Sidebar's "매칭된 규칙" line displays
  `'주간회의' (키워드: '회의')`. The event color on the Calendar grid
  remains the default — **this is preview, not application**. The
  actual color PATCH happens later, only when the sync pipeline runs
  (the surface walked through at `02-rule-to-color.md` Step 4).

## 2. Confirm read-only nature: no PATCH, no observability writes, no LLM call

- **Reviewer action.** None — this step is a passive observation /
  invariant statement. The reviewer can verify each item below by
  inspecting the cited files; no UI interaction occurs.
- **Surface.** None.
- **Backend / Google API call.** What did NOT happen during step 1, and
  why this matters for scope justification:
  - **No `events.patch` call to Google Calendar.** The route handler
    at `src/routes/classify.ts:38-167` never imports or calls the
    Google Calendar client; the GAS handler at
    `gas/addon.js:408-557` never invokes `event.setColor(...)` (the
    only CalendarApp setter that mutates `colorId`). Because no
    PATCH is issued, the paired `current.event.write` scope at
    `gas/appsscript.json:11` is NOT exercised here — `current.event.read`
    is fully sufficient for this scenario's surface.
  - **No `llm_calls` insert.** The route writes to `llm_calls` only
    on the LLM-engaged branch (`src/routes/classify.ts:112-139`),
    gated by `if (llmCallRecord !== null)`. On the rule-only path,
    `llmCallRecord` stays `null` (it is set only inside the
    `useLlm` branch's `onLlmCall` callback at
    `src/routes/classify.ts:88-90`), so the bulk insert never
    fires. Pinned by `src/__tests__/classifyRoute.test.ts:347-373`
    ("llm:true + rule hit (via chain) — onLlmAttempted not
    called"), which covers the more conservative case where `llm:
    true` is sent but the rule still wins.
  - **No `llm_usage_daily` reservation.** `reserveLlmCall` lives
    inside `classifyWithLlm` and is unreachable on the rule-hit
    short-circuit at `src/services/classifierChain.ts:52-53`.
  - **No request-body logging.** The route parses the body with
    `c.req.json().catch(() => null)` at `src/routes/classify.ts:40`
    — the body never enters a log line. Respects the
    "Calendar event payloads (§4+) must never be logged"
    paragraph in `src/CLAUDE.md` "Log redaction contract". The
    middleware-level redactor (`src/middleware/logger.ts`)
    additionally strips sensitive query-string fields by name,
    but this route does not use any of them.
- **Observable outcome.** A reviewer comparing the
  `current.event.read` scope claim on the Marketplace OAuth Consent
  Screen against this code path can verify, by direct inspection of
  the cited line ranges, that this scope is the *minimum* surface
  needed for the sidebar to render its rule-matched classification.

### Forward link to slice 4

If no rule matches the opened event, the route returns
`{ source: "no_match", llmAvailable: <bool> }` at
`src/routes/classify.ts:141-147` (with `llmTried: true` only when the
LLM leg actually engaged — unreachable on the rule-only path). When
`llmAvailable` is true, `formatMatchLine` at `gas/addon.js:370-371`
renders `"매칭된 규칙 없음 — 다음 동기화 시 AI 분류 시도"`, AND the
conditional `"🤖 AI 분류 확인"` button appears in the status section
(`gas/addon.js:485-495`, gated by
`source === 'no_match' && llmAvailable && !llmTried`). The full
walkthrough of pressing that button — including the LLM-engaged
backend path, the unified per-user daily quota, the PII-redaction
boundary, and the `llm_calls` write surface — lives in
`04-event-preview-ai-fallback.md`. Slice 3's scope justification is
**rule-only by design** — do not exercise the AI button while
following this scenario; it crosses a different scope boundary.

### Failure modes

- **AUTH_EXPIRED → 재연결 카드.** If the backend session has expired
  (e.g., test account was logged out from another device, or
  `SESSION_PEPPER` was rotated), the preview POST returns 401.
  `gas/api.js:43-47` translates the 401 into a thrown
  `Error('AUTH_EXPIRED')` after clearing the local session token;
  `fetchPreviewOrError` catches it and surfaces it as
  `{ error: 'AUTH_EXPIRED' }` (`gas/addon.js:338-340`); the
  `onEventOpen` handler short-circuits at `gas/addon.js:460-461` to
  `buildReconnectCard()` (`gas/addon.js:1107-1130`). The reviewer
  sees a `"재연결 필요"` card with copy `"권한 부족 또는 토큰 만료"`
  and a fixed-footer `"OAuth 연동 (재로그인)"` button. Same surface
  as `02-rule-to-color.md` Failure mode 1 — cross-link, do not
  re-screenshot.
- **Rule miss with `OPENAI_API_KEY` configured.** If no rule matches
  the opened event, the route returns
  `{ source: "no_match", llmAvailable: true }`
  (`src/routes/classify.ts:141-147`). `formatMatchLine` at
  `gas/addon.js:370-371` renders `"매칭된 규칙 없음 — 다음 동기화 시
  AI 분류 시도"`, and the conditional `"🤖 AI 분류 확인"` button
  appears (`gas/addon.js:485-495`). The reviewer can press it to
  exercise the LLM-engaged path described in `04-event-preview-ai-fallback.md`,
  OR wait for the next sync cycle to apply LLM classification
  automatically (the `gas/CLAUDE.md` "🤖 AI 분류 확인" paragraph
  documents this gating contract).
- **Rule miss with no `OPENAI_API_KEY`.** The route returns
  `{ source: "no_match", llmAvailable: false }`. `formatMatchLine`
  at `gas/addon.js:373` falls through to the bare
  `"매칭된 규칙 없음"`. The conditional AI button does NOT appear.
  This is the production-without-LLM configuration; reviewers
  testing on `dev` will not see this branch unless `OPENAI_API_KEY`
  is unbound from the dev Worker.
- **Stale category state.** If the test account's rule was deleted
  between slice 02 and slice 03 (e.g., reviewer cleaned up by hand),
  the SELECT at `src/routes/classify.ts:53-63` returns 0 rows; the
  zero-category short-circuit at `src/routes/classify.ts:69-71`
  returns `{ source: "no_match", llmAvailable }` *before*
  `classifyEvent` is even called. Sidebar renders the no-match
  surface above. Recovery: re-create the rule via the slice-02
  walkthrough.

### Cross-references

- `src/CLAUDE.md` "Preview LLM (§5 후속)" — the unified-quota /
  fire-and-forget discipline for the LLM-engaged branch (slice 4
  exercises that path; slice 3 cites it for context only). The
  paragraph "Rule hits short-circuit inside the chain before the LLM
  leg runs — the `llm: true` flag does not suppress rule evaluation,
  and rule-hit responses retain the existing `source: "rule"` shape"
  is the source-of-truth invariant this scenario relies on.
- `docs/architecture-guidelines.md` "Hybrid Classification Engine"
  bullet — confirms the 2-step pipeline (Rule → PII redaction → LLM)
  and that rule-hit short-circuits before any of the LLM-side
  invariants (PII redactor, daily quota, `llm_calls` observability)
  become relevant.
- `gas/CLAUDE.md:9` — the `"🤖 AI 분류 확인"` button-gating paragraph;
  documents that the button hides after one attempt for the current
  card render, which is why a re-clicked rule-hit event never
  re-triggers an LLM attempt even with `OPENAI_API_KEY` set.
- `docs/add-on-ui-plan.md` Screen 3 — design intent for the Event
  Insight Card. This was the slice-3 source-of-truth pointer in
  `docs/marketplace-readiness.md` §4 BEFORE this slice landed; the
  same PR that lands this file flips the row to point at this file
  instead.
- `docs/assets/marketplace/reviewer-demo/02-rule-to-color.md` Step 2
  — where the matched rule was created. Slice 3 assumes that rule
  is still present in the test account.
- `docs/assets/marketplace/reviewer-demo/04-event-preview-ai-fallback.md`
  — the rule-miss + LLM-fallback walkthrough (still `미작성` at the
  time slice 3 ships; this cross-link will resolve once slice 4 is
  drafted).

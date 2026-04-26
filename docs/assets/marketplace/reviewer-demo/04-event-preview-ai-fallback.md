# Scenario 04 — Event-open preview (AI fallback)

> Walks the reviewer through clicking the "🤖 AI 분류 확인" button on a
> rule-miss event's sidebar, watching the AutoColor backend dispatch a
> single PII-redacted OpenAI call, and rendering the LLM's classification
> as a *read-only* preview. The sidebar exercises the same Marketplace-
> install scope as slice 3 (`calendar.addons.current.event.read`); the
> LLM call surface is a backend env binding (`OPENAI_API_KEY`) rather
> than a Google OAuth scope. **No `events.patch` is issued in this
> scenario** — like slice 3, the preview is read-only by design; the
> write surface is the sync pipeline (slice 2). Cited line numbers
> should pass a `grep -n` spot-check against the source files; the
> bundle's "drift guard" relies on this.

- **Scopes exercised in this scenario (Marketplace install OAuth):**
  `https://www.googleapis.com/auth/calendar.addons.current.event.read`
  (Sensitive — same scope justified by slice 3's read of the open event;
  no additional scope is required for the LLM leg). Citation:
  `gas/appsscript.json:5-13`. **The backend LLM call uses the
  `OPENAI_API_KEY` env binding configured at the Cloudflare Worker — it
  is NOT a Google OAuth scope, and therefore does not appear on either
  of the two consent surfaces this bundle covers.**
- **Pre-conditions:**
  - Scenarios `01-install.md`, `02-rule-to-color.md`, and
    `03-event-preview-rule-hit.md` completed: the test account holds a
    valid AutoColor backend session, has at least one rule on the
    `주간회의` category created in slice 2 step 2, and the reviewer has
    already walked the rule-hit branch in slice 3.
  - At least one calendar event whose summary does NOT match any
    configured rule keyword. Synthetic fixture from
    `docs/assets/marketplace/reviewer-demo/README.md:67`: an event
    titled `"John 1:1 - YYYY-MM-DD HH:MM"` (the canonical
    reviewer-fixture name for the LLM-fallback case — `1:1` is not a
    rule keyword on the slice-2 fixture set).
  - `OPENAI_API_KEY` is bound on the Worker. Slice 4 cannot exercise
    the LLM leg otherwise — see Failure mode (a).
  - At least one row in the `categories` table for the test account.
    Slice 4 cannot exercise the LLM leg otherwise — see Failure mode
    (d).
  - Reviewer is on the Calendar week/day view with the AutoColor
    sidebar icon visible in the right-hand strip.

## Two consent surfaces (pre-read)

This scenario does not re-explain the framework-vs-backend scope split;
see `01-install.md` "Two consent surfaces (pre-read)" for the full
walkthrough. The single relevant fact for slice 4: **the backend LLM
call is not a Google scope**. Both consent surfaces (Marketplace install
+ backend OAuth) cover Google APIs only; the OpenAI call surface is a
Worker-side egress to `api.openai.com` authenticated by
`env.OPENAI_API_KEY`. **No additional consent prompt fires when the
reviewer clicks the AI button** — the only Google scope exercised here
is `calendar.addons.current.event.read`, already granted at Marketplace
install (covered by slice 3 step 1).

## 1. Reviewer opens a rule-miss event; AI button appears

- **Reviewer action.** From the Calendar week/day view, click the
  synthetic event `"John 1:1 - YYYY-MM-DD HH:MM"` whose summary does
  not match any keyword on the test account's categories. The AutoColor
  sidebar opens automatically via the same `eventOpenTrigger` exercised
  in slice 3 step 1 — re-cite, do not re-walk.
- **Surface.** The Event Insight card's status section now shows two
  things the reviewer must verify:
  - Matched-rule line:
    **`매칭된 규칙 없음 — 다음 동기화 시 AI 분류 시도`** — rendered by
    `formatMatchLine` at `gas/addon.js:370-371` from the rule-miss
    response body (`source === 'no_match' && llmAvailable === true`).
  - Fixed-footer button:
    **`"🤖 AI 분류 확인"`** — bound at `gas/addon.js:493-494` to
    `actionClassifyWithLlm`. The gating block at
    `gas/addon.js:485-495` is the load-bearing piece: the button is
    rendered only when
    `previewResult.source === 'no_match' &&
    previewResult.llmAvailable && !(!!previewResult.llmTried)` — the
    `!llmTried` guard at line **489** is what makes this a
    one-attempt-per-card-render button (see step 4).
- **Backend / Google API call.** Same surface as slice 3 step 1:
  `fetchPreviewOrError` POSTs `/api/classify/preview` with body
  `{ summary, description, location }` (the `llm` flag is intentionally
  absent on the first POST). The route short-circuits on the rule leg
  and returns `{ source: "no_match", llmAvailable: true }` at
  `src/routes/classify.ts:141-147`. **No LLM call has fired yet** —
  this step is purely the rule-miss surface that exposes the AI button.
  No `events.patch`, no `llm_calls` row, no
  `llm_usage_daily` reservation.
- **Observable outcome.** Sidebar shows the
  `"매칭된 규칙 없음 — 다음 동기화 시 AI 분류 시도"` line plus the
  `"🤖 AI 분류 확인"` button. Calendar grid color is unchanged.

## 2. Reviewer clicks "🤖 AI 분류 확인"; second preview POST fires

- **Reviewer action.** Click the `"🤖 AI 분류 확인"` button. The
  button's `setOnClickAction` at `gas/addon.js:494` invokes the GAS
  function `actionClassifyWithLlm`.
- **Surface.** No new card render in this step — Google's CardService
  re-uses the action's `ActionResponse` to drive the next render in
  step 4. The reviewer sees a brief notification toast while the
  action is in flight.
- **Backend / Google API call.** Two distinct surfaces fire:
  1. **GAS-side (no Google API call).** `actionClassifyWithLlm`
     (`gas/addon.js:623`) reads the open event via the same read-only
     CalendarApp getters slice 3 already justified
     (`event.getTitle()` / `event.getDescription()` /
     `event.getLocation()` at `gas/addon.js:642-648`). All getters; no
     setters; no PATCH. The `current.event.write` scope at
     `gas/appsscript.json:11` is NOT exercised here.
  2. **Backend-side (this is the surface slice 4 justifies).**
     `actionClassifyWithLlm` calls `fetchPreviewOrError` with body
     `{ summary, description, location, llm: true }` constructed at
     `gas/addon.js:650-655`. **The `llm: true` flag is the opt-in
     signal** that engages the LLM leg in the backend; without it the
     route stays on slice 3's rule-only short-circuit.
- **Observable outcome.** None visible to the reviewer until step 4 —
  this step is the dispatch.

## 3. Backend runs the LLM leg through classifierChain

- **Reviewer action.** None — this is a backend trace step. The
  reviewer may verify the cited line ranges; no UI interaction occurs.
- **Surface.** None.
- **Backend / Google API call.** No Google Calendar API call. The
  surface that fires is the OpenAI `chat.completions` egress. Step
  trace:
  1. **Route entry** (`src/routes/classify.ts:38-167`). The Hono
     handler parses the body via the `PreviewBody` Zod schema at
     `src/routes/classify.ts:17-27`. The `llm: true` flag is now part
     of the parsed payload.
  2. **`useLlm` branch selection** at `src/routes/classify.ts:50`:
     `const useLlm = parsed.data.llm === true`. When true, the route
     selects `buildDefaultClassifier` at
     `src/routes/classify.ts:80-92`; otherwise the lightweight
     `classifyEvent` is used (slice 3's path). The branch also wires
     two route-side callbacks:
     `onLlmAttempted` at `classify.ts:85-87` (flips a local
     `llmTried = true` boolean) and `onLlmCall` at `classify.ts:88-90`
     (captures the per-call `LlmCallRecord` for the `llm_calls`
     insert below).
  3. **Tenant-scoped categories SELECT** at
     `src/routes/classify.ts:53-63` — same `where(eq(categories.userId,
     userId))` slice 3 cites. Per `src/CLAUDE.md` "Tenant isolation".
  4. **Chain factory invocation**
     (`src/services/classifierChain.ts:48-99`).
     `buildDefaultClassifier(deps)` returns a fresh closure per
     request:
     - **Rule leg fires first** at `classifierChain.ts:52-53`. On
       rule-miss, the chain falls through.
     - **`OPENAI_API_KEY` + `categories.length > 0` guards** at
       `classifierChain.ts:55-56`. **Both bail the chain BEFORE
       `deps.onLlmAttempted?.()` fires at line 72** — this matters
       for Failure mode (d) below.
     - **`quotaLatched` short-circuit** at
       `classifierChain.ts:57-70`. In the preview path this is a
       **dead branch** (per `src/CLAUDE.md` "Preview LLM (§5 후속)"
       3rd bullet, lines 311-315): the latch only matters for ≥2
       rule-miss events sharing a single closure, and preview builds
       a fresh closure per request.
     - **`deps.onLlmAttempted?.()` callback** at
       `classifierChain.ts:72`. Flips `llmTried = true` via the
       route-side callback at `classify.ts:85-87`. This is what
       populates the `llmTried: true` key on the response.
     - **PII redaction** (`src/services/piiRedactor.ts:88-99`). The
       `redactEventForLlm` helper whitelists `summary`, `description`,
       and `location` fields only — `attendees`, `creator`, and
       `organizer` are dropped before the prompt is built. **PII
       redaction is mandatory and non-bypassable** before any LLM
       call, per `docs/architecture-guidelines.md` "Hybrid
       Classification Engine".
     - **`classifyWithLlm` call** at
       `src/services/llmClassifier.ts:263-352`. This is the actual
       OpenAI `chat.completions` egress. The function reserves a
       `llm_usage_daily` quota slot via `reserveLlmCall` BEFORE
       issuing the HTTP call.
     - **`LlmCallRecord` emission** at
       `src/services/llmClassifier.ts:276-287` — the `finish()`
       helper emits exactly one record via `deps.onCall?.(rec)`
       before every return. **7 outcome kinds**: `hit` / `miss` /
       `timeout` / `quota_exceeded` / `http_error` / `bad_response` /
       `disabled`. The chain's outcome switch at
       `classifierChain.ts:81-97` enumerates all 7 explicitly with
       no `default` arm — TypeScript's exhaustiveness check would
       surface a compile error if a new outcome kind were added
       without extending the switch.
  5. **Response shape**:
     - On `hit`: `source: "llm"` + `category: { id, name, colorId }`
       (no `matchedKeyword`). The hit predicate is
       `isLlmHit = classification.reason.startsWith("llm_match:")`
       at `src/routes/classify.ts:150`. Returned at
       `src/routes/classify.ts:151-163`.
     - On any of the 6 non-`hit` outcomes: the chain returns `null`,
       and the route returns `source: "no_match"` +
       `llmAvailable: true` + `llmTried: true` at
       `src/routes/classify.ts:141-147`.
  6. **`llm_calls` insert** at `src/routes/classify.ts:112-139`:
     `c.executionCtx.waitUntil(db.insert(llmCalls).values(...).
     catch(warn))`. **Fire-and-forget**: a DB write failure
     downgrades to a warn log without retrying the preview (per
     `src/CLAUDE.md` "Preview LLM (§5 후속)" 2nd bullet, lines
     305-310). Exactly one row per preview request, with the same
     **shared `llm_usage_daily` quota** the sync pipeline uses (1st
     bullet, lines 302-304) — there is no separate preview cap. The
     row shape lives at `src/db/schema.ts:224-254`.
- **Observable outcome.** A single row lands in the `llm_calls` table
  carrying the per-call telemetry (`outcome`, `latency_ms`,
  `category_count`, `attempts`, optional `http_status`, optional
  `category_name` on `hit`). PII stance per `src/CLAUDE.md`
  "Observability tables (§6 Wave A)" `llm_calls` subsection: counters
  + `category_name` only; no event content reaches the table because
  `redactEventForLlm` runs upstream.

## 4. Sidebar re-renders with LLM verdict; AI button hides; no PATCH

- **Reviewer action.** None — the action handler returns and
  CardService re-renders the card.
- **Surface.** `actionClassifyWithLlm` stashes the response payload
  onto the action's parameters at `gas/addon.js:670`
  (`e.parameters.llmPreviewJson = JSON.stringify(preview)`). The next
  render of the Event Insight card reads it back at
  `gas/addon.js:597-604` and feeds it into `formatMatchLine`. The
  rendered status line is one of:
  - On `source: "llm"` hit:
    **`"🤖 AI 분류: '<category>'"`** at `gas/addon.js:365`.
  - On `source: "no_match"` + `llmTried: true`:
    **`"🤖 AI 분류 결과 없음"`** at `gas/addon.js:368`.
  The action also surfaces a brief toast notification at
  `gas/addon.js:672-681` summarising the outcome.
- **Backend / Google API call.** None. **`events.patch` is NOT issued
  in this scenario** — the route handler at
  `src/routes/classify.ts:38-167` never imports the Google Calendar
  client, and the GAS handler `actionClassifyWithLlm` never invokes
  `event.setColor(...)`. Slice 4, like slice 3, is preview-only; the
  write surface remains the sync pipeline (slice 2).
- **Observable outcome.** Sidebar's matched-rule line displays the LLM
  result. The `"🤖 AI 분류 확인"` button **does not re-appear** because
  the gating block at `gas/addon.js:489` now sees `llmTried = true`.
  The button-gating contract documented at `gas/CLAUDE.md` "🤖 AI
  분류 확인" paragraph — "hides after one attempt for the current
  card render" — is the source of truth for this behaviour. Calendar
  grid color is unchanged (no PATCH).

### Failure modes

- **(a) `OPENAI_API_KEY` unset.** The first preview POST returns
  `{ source: "no_match", llmAvailable: false }`. The button gating
  block at `gas/addon.js:488` evaluates `previewResult.llmAvailable`
  to false, so the `"🤖 AI 분류 확인"` button never appears.
  Cross-link: slice 3 Failure mode "Rule miss with no
  `OPENAI_API_KEY`". Configuration: unbind `OPENAI_API_KEY` from the
  Worker via `wrangler secret delete OPENAI_API_KEY --env dev`.
- **(b) `quota_exceeded`.** Per-user `llm_usage_daily` budget is
  exhausted before this request lands (typically because the sync
  pipeline used up the day's quota — quota is **shared** with sync,
  no separate preview cap). `classifyWithLlm`'s reservation lives
  inside `reserveLlmCall`, AFTER `onLlmAttempted` already fired at
  `classifierChain.ts:72`. Response is `source: "no_match"` +
  `llmAvailable: true` + `llmTried: true`. One `llm_calls` row lands
  with `outcome: "quota_exceeded"`.
- **(c) `timeout` / `http_error` / `bad_response`.** Network failure,
  OpenAI 4xx/5xx, or a malformed response payload all collapse
  identically to (b) on the response side — same `no_match` shape
  with `llmTried: true`. The `llm_calls` row carries the
  discriminating `outcome` value (and `httpStatus` for
  `http_error`). The chain's outcome switch routes `timeout` at
  `src/services/classifierChain.ts:85-87` and the remaining
  non-quota / non-hit cases (`miss` / `http_error` / `bad_response` /
  `disabled`) at `src/services/classifierChain.ts:92-96` — both
  branches `return null`. Per
  `docs/architecture-guidelines.md` "Halt on Failure", **there is NO
  fallback to local rules** — the LLM leg either succeeds or the
  event is left as `no_match`.
- **(d) `disabled` (categories.length === 0).** The test account has
  no rules / categories yet. The chain bails at
  `src/services/classifierChain.ts:56` BEFORE
  `deps.onLlmAttempted?.()` at line 72 fires — so `llmTried` stays
  `false`. Response is `source: "no_match"` + `llmAvailable: true` —
  **no `llmTried: true` key**. This is the only failure mode where
  the response shape diverges from (b) and (c) on the `llmTried`
  axis. Reviewer-visible difference: the `"🤖 AI 분류 확인"` button
  *would* still appear (because `!llmTried` is satisfied), but
  pressing it from this state still produces a no_match — not because
  the LLM ran and failed, but because the chain never engaged the LLM
  leg in the first place. Recovery: re-create at least one rule via
  the slice-02 walkthrough.
- **(e) AUTH_EXPIRED.** Backend session expired between sidebar opens
  (e.g., `SESSION_PEPPER` rotated, or another device logged out).
  The preview POST returns 401; `gas/api.js:43-47` translates it to
  `Error('AUTH_EXPIRED')`; `actionClassifyWithLlm` catches it at
  `gas/addon.js:657-661` and updates the card to `buildReconnectCard()`
  (`gas/addon.js:1107`). Reviewer sees the same `"재연결 필요"` card
  already exercised in slice 3 Failure mode 1
  (`03-event-preview-rule-hit.md:190-202`) — cross-link, do not
  re-screenshot.

### Cross-references

- `src/CLAUDE.md` "Preview LLM (§5 후속)" (lines 296-328) — the
  unified-quota / fire-and-forget / dead-branch quota-latch contract
  this scenario exercises. The 1st-2nd bullets (lines 302-310) cover
  shared `llm_usage_daily` and the
  `c.executionCtx.waitUntil(...).catch(warn)` discipline; the 3rd
  bullet (lines 311-315) explains why the quota latch is a dead
  branch in preview.
- `src/CLAUDE.md` "Observability tables (§6 Wave A)" `llm_calls`
  subsection — the per-call telemetry contract slice 4 produces the
  preview-side row for. PII stance: `category_name` plus pure
  counters; no event content reaches the table because PII
  redaction runs upstream of the record emission.
- `docs/architecture-guidelines.md` "Hybrid Classification Engine"
  (line 18) and "Halt on Failure" (line 17) — confirms (a) the
  2-step pipeline (Rule → PII redaction → LLM Fallback), (b) PII
  redaction is mandatory and non-bypassable, and (c) on LLM failure
  there is NO fallback to local rules — the event collapses to
  `no_match` per Failure modes (b)(c).
- `gas/CLAUDE.md` "🤖 AI 분류 확인" paragraph — documents the button
  gating contract and the "hides after one attempt for the current
  card render" rule that step 4 relies on.
- `docs/assets/marketplace/reviewer-demo/03-event-preview-rule-hit.md`
  "Forward link to slice 4" (lines 170-186) — the cross-link slice 3
  pre-wrote, explicitly pointing into this scenario for the
  rule-miss + LLM-fallback walkthrough.

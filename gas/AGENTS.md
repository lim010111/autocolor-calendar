# Google Apps Script Add-on — Module Context

## Purpose & Owns

UI-only Google Workspace Add-on (`CardService`): onboarding, OAuth bounce-
back to the backend, and configuration cards. **No local triggers, rules,
or fallbacks** — the backend is the source of truth (see
[../docs/architecture-guidelines.md](../docs/architecture-guidelines.md)
"E2E Backend Mandatory" / "Halt on Failure").

- `addon.js` — card builders (home / event-open / preferences) +
  `actionClassifyWithLlm` (re-posts to `/api/classify/preview`).
- `api.js` — backend HTTP wrapper (bearer + retry + `needs_reauth`).
- `auth.js` + `authCallback.html` + `authError.html` — OAuth UX.
- `config.js` — Script Property keys + frozen Add-on URL constants.
- `storage.js` — `PropertiesService` per-user wrappers.
- `i18n.js` — `pickLocale` / `t` / `MESSAGES` (en, ko, zh-CN, zh-TW) +
  `LABEL_SWATCH_PALETTE` / `getLabelSwatches()` / `getSwatchForHex(hex)` /
  `getNearestSwatchForHex(hex)` / `getSwatchForClassicColorId(colorId)` /
  `getSwatchForRule(rule)` / `getAuthErrorBundle`.
- `appsscript.json` — manifest (scopes / triggers / runtime; already
  declares `useLocaleFromApp: true` + `script.locale` scope).

## Quick commands

```bash
# Push current source to the bound Apps Script project
clasp push

# Tail Stackdriver logs
clasp logs --watch

# Deploy as a new version of the EXISTING deployment
#   Editor → Deploy → Manage deployments → pencil → Version: New version → Deploy
# (NEVER click "New deployment" — see "Non-obvious rules" below.)
```

Reviewer-walkthrough scripts under [../docs/assets/marketplace/reviewer-demo/](../docs/assets/marketplace/reviewer-demo/) exercise each scope live once `clasp push` lands.

## Common patterns

- **New card surface**: build in `addon.js`, wire trigger via
  `appsscript.json` `addOns.calendar`, route HTTP through `api.js`.
- **New backend call**: extend `api.js` (single place that knows how to
  surface `needs_reauth` as a re-login prompt) — never inline `fetch`.
- **New Script Property**: declare in `config.js`, mediate via
  `storage.js` (per-user vs. document-scoped boundary).
- **User-facing strings**: never inline literals in `addon.js` or HTML
  files. Add the key to ALL FOUR bundles in `i18n.js` (`en`, `ko`,
  `zh-CN`, `zh-TW`) and call `t('key', params, L)`. Each card / action
  builder starts with `var L = pickLocale(e);` (HTML render paths use
  `pickLocale(null)` which falls back to `Session.getActiveUserLocale`).
  English is the fallback for unsupported locales.

## Non-obvious rules

- **Why deployment URLs are sacred:** `clasp deploy --description ...` mints
  a *new* `/exec` URL. Every Worker secret (`GAS_REDIRECT_URL`), every GCP
  Authorized Redirect URI, and every Script Property pinned to that URL
  has to be rewired — re-auth spike included. The correct path is
  Editor → Deploy → Manage deployments → ✏️ → "New version" → Deploy. See
  [../src/AGENTS.md](../src/AGENTS.md) "GAS deployment URL must stay stable".
- **Note:** the AI classification button (`event.btn.classifyLlm`) on the
  event-open sidebar shares the sync pipeline's per-user `reserveLlmCall`
  daily quota — there is no separate preview cap. The button is gated on
  rule-miss + the backend returning `llmTried: false`, and hides after
  one click per card render. When the quota is exhausted the backend
  returns `llmQuotaExceeded: true` and `formatMatchLine` renders the
  `match.llm.quotaExceeded` line so the user can distinguish "한도 소진"
  from "AI가 매칭 못 찾음" — both are functionally `no_match`. See
  [../src/AGENTS.md](../src/AGENTS.md) "Preview LLM (§5 후속)".
- **Lockstep:** `ACFC_CONFIG.EXAMPLE_CONSENT_POLICY_VERSION` (`config.js`)
  must stay byte-identical to `EXAMPLE_CONSENT_POLICY_VERSION` in
  [../src/config/consent.ts](../src/config/consent.ts). The backend rejects a
  consent grant whose echoed version differs (409
  `policy_version_mismatch`), so on drift **every** grant fails — loudly, by
  design: a stale deployment must not record consent against example-storage
  disclosure text the user never saw. Bump both together only when that
  disclosure materially changes (ADR-0007).
- **Time-gated surface:** the `rememberExample` checkbox on the event card and
  the settings card's example-consent section are both wrapped in
  `exampleStorageIsOpen()` (`config.js`). Before
  `ACFC_CONFIG.EXAMPLE_STORAGE_OPENS_AT` the backend answers every grant with
  409 `storage_not_open_yet` (privacy-policy §12's 30-day notice), so
  rendering them would produce dead controls — the same defect the
  `policy_settings` checkboxes were removed for. Remove the guards only
  together with the backend constant.
- **Load-bearing:** `buildWelcomeCard` renders `welcome.legal.notice` plus the
  Terms / Privacy links **above** the sign-in button. Terms of Service §0.3
  makes its own effect conditional on "회사의 안내 절차에 따라 본 약관에
  동의" — that section *is* the procedure, so removing it or moving the links
  below the button (browsewrap) silently un-enforces every clause that only
  matters in a dispute. Both URLs come from `config.js` and are already
  covered by `appsscript.json` `openLinkUrlPrefixes`; no manifest change, so
  no OAuth re-review.
- **Post-OAuth re-render is NOT automatic — `buildAuthFooter`'s second button
  is load-bearing (2026-07-30).** Google's
  [connect-third-party-service](https://developers.google.com/workspace/add-ons/guides/connect-third-party-service)
  guide ends the flow with "the user is prompted to refresh the add-on";
  automatic re-render after the auth window closes is a **Chat-only**
  affordance (`completeRedirectUri`). Two host-reload mechanisms were tried
  against the live add-on and neither fired: `OnClose.RELOAD_ADD_ON`
  (deprecated by Google, [issue 268427648](https://issuetracker.google.com/issues/268427648))
  and a button-level `AuthorizationAction`. COOP was measured across the whole
  redirect chain (Worker → `accounts.google.com` → `script.google.com/…/exec`)
  and is `unsafe-none`/report-only throughout, so the documented COOP caveat is
  **not** the cause. So both sign-in surfaces share `buildAuthFooter`: a
  primary `OpenLink` carrying the best-effort `OnClose.RELOAD` (non-deprecated,
  the shape Google's own sample uses) **plus** a secondary "로그인을 마쳤어요"
  button wired to `actionCompleteSignIn`, which re-reads the token `doGet`
  already wrote and navigates Home. Deleting the secondary button restores the
  dead end where an authenticated user is stuck on the Welcome card. The auth
  URL's origin must stay inside `appsscript.json` `openLinkUrlPrefixes`.
- **Removed on purpose (2026-07-29):** the settings card's `policy_settings`
  checkbox group (`prevent_overwrite` / `use_llm` / `use_description`) is
  gone. It had no `onChange`, no save handler, and no backing column — while
  the privacy policy promised a "규칙 기반 분류만 사용" opt-out on the
  strength of it. Do not reintroduce a toggle without the column and the
  chain gate behind it; LLM invocation is decided by `OPENAI_API_KEY` at the
  operator level (`src/services/classifierChain.ts`), not per user.
- **Note:** the event card never fetches consent state. It learns it from
  `POST /api/examples` returning 403 `consent_required` and pushes
  `buildExampleConsentCard` at that point. Do not add a consent probe to the
  `onEventOpen` render path — it would put a `users` read on the sidebar hot
  path for state needed only on a rare action, and the backend's 403 is the
  only authority that honours a withdrawal made on another device.
- **Swatches render from `backgroundColor`, never from `colorId`.** The rule
  wire shape carries both; `colorId` is a legacy nearest-classic cache that
  collapses the 24 label colors onto 11 ids, so drawing from it showed the
  wrong color for 19 of the 24 (cocoa → basil green, wisteria → blue). Use
  `getSwatchForRule(rule)` — never `getSwatchForClassicColorId` directly —
  and keep `CLASSIC_COLOR_ID_HEX` in lockstep with the backend's
  `CLASSIC_EVENT_COLOR_HEX` (pinned by `src/__tests__/gasSwatch.test.ts`,
  which evaluates this module's real source).
- **Gotcha:** `CardService` cannot render arbitrary HTML — every card is
  rebuilt on every action, so do NOT cache view state in module-level vars.
  Per-user state belongs in `storage.js`; per-render state belongs in the
  action callback's parameters.
- **Don't** mix `wrangler` env labels into GAS code paths. The Add-on
  always points at one backend URL (`config.js`); env switching is an
  operator concern handled at the Worker layer.

## Cross-module dependencies

- **Calls** Worker routes: `/oauth/google/start`, `/oauth/google/callback`,
  `/me`, `/api/categories`, `/api/classify/preview`, `/api/account/delete`
  (full inventory: `../src/routes/`).
- **OAuth bounce-back** is the only direct DOM the Add-on owns —
  `authCallback.html` / `authError.html`.
- **Manifest scopes** (`appsscript.json` lines 5-13) drive Marketplace
  install consent — see [../docs/assets/marketplace/scope-justifications.md](../docs/assets/marketplace/scope-justifications.md).

## See also

- [../src/AGENTS.md](../src/AGENTS.md) — backend operational rules (the authority)
- [../docs/architecture-guidelines.md](../docs/architecture-guidelines.md) — sync flow + halt-on-failure contract
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — module map + sequence diagrams
- [../docs/assets/marketplace/reviewer-demo/](../docs/assets/marketplace/reviewer-demo/) — Marketplace reviewer walkthrough

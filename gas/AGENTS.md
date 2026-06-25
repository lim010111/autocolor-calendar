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
  `COLOR_PALETTE` / `getCalendarColors(locale)` / `getAuthErrorBundle`.
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

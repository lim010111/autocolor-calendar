# Google Apps Script Add-on — Module Context

## Purpose & Owns

The `gas/` directory contains the Google Workspace Add-on (UI) code for
AutoColor. Its sole purpose is user onboarding, OAuth connection to the
backend, and configuration UI rendered via `CardService`.

- `addon.js` — `CardService` builders (home / event-open / preferences) +
  the `actionClassifyWithLlm` flow that re-posts to
  `/api/classify/preview` with `{ llm: true }`.
- `api.js` — backend HTTP wrapper (bearer session + retry surface).
- `auth.js` + `authCallback.html` + `authError.html` — OAuth bounce-back
  UX from the backend's `/oauth/google/callback`.
- `config.js` — Script Property keys + frozen Add-on URL constants.
- `storage.js` — wrappers around `PropertiesService` (per-user state).
- `appsscript.json` — Add-on manifest (scopes, calendar trigger, runtime).

**The Add-on MUST NOT contain local Calendar event triggers, local rule
processing, or fallback logic.** All classification + sync work runs on
the backend; see
[../docs/architecture-guidelines.md](../docs/architecture-guidelines.md)
"E2E Backend Mandatory" / "Halt on Failure".

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

The reviewer-walkthrough scripts in
[../docs/assets/marketplace/reviewer-demo/](../docs/assets/marketplace/reviewer-demo/)
exercise each scope live once `clasp push` lands the latest source.

## Common patterns

- **Add a new card surface**: build it in `addon.js` and wire the trigger
  through `appsscript.json` `addOns.calendar`. Keep API calls behind
  `api.js` so the bearer/session shape stays in one place.
- **Add a backend call**: extend `api.js`'s wrapper, never inline `fetch`
  into a card builder. The wrapper is the only place that knows how to
  surface `needs_reauth` to the user as a re-login prompt.
- **Add a Script Property**: declare it in `config.js`, never read raw
  `PropertiesService` inside a card. `storage.js` is the single layer that
  understands which keys are per-user vs. document-scoped.

## Non-obvious rules

- **Why deployment URLs are sacred:** `clasp deploy --description ...` mints
  a *new* `/exec` URL. Every Worker secret (`GAS_REDIRECT_URL`), every GCP
  Authorized Redirect URI, and every Script Property pinned to that URL
  has to be rewired — re-auth spike included. The correct path is
  Editor → Deploy → Manage deployments → ✏️ → "New version" → Deploy. See
  [../src/CLAUDE.md](../src/CLAUDE.md) "GAS deployment URL must stay stable".
- **Note:** the "🤖 AI 분류 확인" button on the event-open sidebar shares the
  sync pipeline's per-user `reserveLlmCall` daily quota — there is no
  separate preview cap. The button is gated on rule-miss + the backend
  returning `llmTried: false`, and hides after one click per card render.
  See [../src/CLAUDE.md](../src/CLAUDE.md) "Preview LLM (§5 후속)".
- **Gotcha:** `CardService` cannot render arbitrary HTML — every card is
  rebuilt on every action, so do NOT cache view state in module-level vars.
  Per-user state belongs in `storage.js`; per-render state belongs in the
  action callback's parameters.
- **Don't** mix `wrangler` env labels into GAS code paths. The Add-on
  always points at one backend URL (`config.js`); env switching is an
  operator concern handled at the Worker layer.

## Cross-module dependencies

- **Calls** the backend Worker: `/oauth/google/start`, `/oauth/google/callback`,
  `/me`, `/api/categories`, `/api/classify/preview`, `/api/account/delete`.
  The full route inventory lives in `../src/routes/`.
- **Sends users to** the backend OAuth surface, then receives them back
  via `authCallback.html` — the only direct DOM the Add-on owns.
- **Manifest scopes** in `appsscript.json` (lines 5-13) drive the
  Marketplace install consent surface; per-scope justifications live in
  [../docs/assets/marketplace/scope-justifications.md](../docs/assets/marketplace/scope-justifications.md).

## See also

- [../src/CLAUDE.md](../src/CLAUDE.md) — backend operational rules (the authority)
- [../docs/architecture-guidelines.md](../docs/architecture-guidelines.md) — sync flow + halt-on-failure contract
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — module map + sequence diagrams
- [../docs/assets/marketplace/reviewer-demo/](../docs/assets/marketplace/reviewer-demo/) — Marketplace reviewer walkthrough

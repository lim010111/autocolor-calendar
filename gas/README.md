# Google Apps Script Add-on (UI)

This folder contains the Google Workspace Add-on source code for **AutoColor for Calendar**.

## Purpose

The Add-on acts as the frontend interface within Google Calendar. Its responsibilities are strictly limited to:
- User onboarding and displaying terms/tutorials.
- Orchestrating external OAuth to connect the user's Google Account with the Cloudflare Workers backend.
- Providing a Configuration UI (e.g., turning on/off the service, viewing connected account status).
- Providing contextual UI when an event is opened.

**Important — what the Add-on DOES NOT do** (re-introducing any of these
breaks the central pipeline's PII / quota / rotation invariants):

- Run local time-driven or calendar event-driven triggers.
- Store or evaluate classification rules locally.
- Keep track of incremental sync tokens (`nextSyncToken`).
- Modify events directly based on content (delegated entirely to the backend).

**Note:** for the deeper module rules (deployment-URL discipline, OAuth
bounce-back, scope manifest), read [`CLAUDE.md`](CLAUDE.md) — this README
is the install / orientation surface; that file is the operational one.

## Setup & Deployment

1. Create a new Google Apps Script project in your Google account.
2. Copy every file from this `gas/` folder into the project.
3. Ensure `appsscript.json` is correctly set.
4. Deploy the script as a **Google Workspace Add-on**.
5. Connect the Add-on to your Cloudflare Workers backend via the OAuth flow.

## Architecture Enforcement
- **E2E Backend Mandatory:** All heavy lifting (webhook processing, rule
  evaluation, LLM fallback) runs on the Cloudflare Workers backend.
- **No Local Fallback:** **Don't** silently fallback to legacy local rules
  or triggers. On backend failure / auth expiry the Add-on halts and
  prompts re-authentication — see
  [`../docs/architecture-guidelines.md`](../docs/architecture-guidelines.md)
  "Halt on Failure" for the exact rule.

## Quick commands

```bash
# Push current source to the bound Apps Script project (operator workstation)
clasp push
clasp logs --watch                                # tail Stackdriver
# Deploy: Editor → Manage deployments → ✏️ → New version → Deploy
# (NEVER mint a new deployment URL — see ./CLAUDE.md "Why deployment URLs are sacred".)
```

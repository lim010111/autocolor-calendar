# Google Apps Script Add-on (UI)

This folder contains the Google Workspace Add-on source code for **AutoColor for Calendar**.

## Purpose

The Add-on acts as the frontend interface within Google Calendar. Its responsibilities are strictly limited to:
- User onboarding and displaying terms/tutorials.
- Orchestrating external OAuth to connect the user's Google Account with the Cloudflare Workers backend.
- Providing a Configuration UI (e.g., turning on/off the service, viewing connected account status).
- Providing contextual UI when an event is opened.

**It DOES NOT:**
- Run local time-driven or calendar event-driven triggers.
- Store or evaluate classification rules locally.
- Keep track of incremental sync tokens (`nextSyncToken`).
- Modify events directly based on content (this is delegated entirely to the backend).

## Setup & Deployment

1. Create a new Google Apps Script project in your Google account.
2. Copy every file from this `gas/` folder into the project.
3. Ensure `appsscript.json` is correctly set.
4. Deploy the script as a **Google Workspace Add-on**.
5. Connect the Add-on to your Cloudflare Workers backend via the OAuth flow.

## Architecture Enforcement
- **E2E Backend Mandatory:** All heavy lifting, including webhook processing, rule evaluation, and LLM fallback, is performed by the Cloudflare Workers backend.
- **No Local Fallback:** If the backend connection fails or authentication expires, the Add-on must halt and prompt the user to re-authenticate. It must never silently fallback to legacy local rules or triggers.

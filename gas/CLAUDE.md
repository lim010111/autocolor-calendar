# Google Apps Script Add-on Context

## Development & Usage

The `gas/` directory contains the Google Workspace Add-on (UI) code for AutoColor.
Its sole purpose is to provide user onboarding, OAuth connection to the backend, and configuration UI.
**It MUST NOT contain any local Calendar event triggers, local rule processing, or fallback logic.**

The "🤖 AI 분류 확인" button on the event-open sidebar re-posts to `/api/classify/preview` with `{ llm: true }`, sharing the sync pipeline's per-user `reserveLlmCall` daily quota (no separate preview cap). The button is gated on rule-miss + `OPENAI_API_KEY` set, and hides after one attempt for the current card render.

To deploy or test the Add-on:
1. Create a new Google Apps Script project.
2. Copy all files from the `gas/` directory into the project.
3. Deploy as a Google Workspace Add-on.

# Google Apps Script Add-on Context

## Development & Usage

The `gas/` directory contains the Google Workspace Add-on (UI) code for AutoColor.
Its sole purpose is to provide user onboarding, OAuth connection to the backend, and configuration UI.
**It MUST NOT contain any local Calendar event triggers, local rule processing, or fallback logic.**

To deploy or test the Add-on:
1. Create a new Google Apps Script project.
2. Copy all files from the `gas/` directory into the project.
3. Deploy as a Google Workspace Add-on.

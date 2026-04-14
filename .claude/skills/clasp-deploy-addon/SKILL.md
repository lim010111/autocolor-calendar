---
name: clasp-deploy-addon
description: Deploy, push, and test Google Calendar Add-on code using clasp. Use when asked to deploy, update, push changes, or test the Calendar Add-on (Stage 1 MVP).
---

# Deploy and Test Google Calendar Add-on

This skill provides the workflow for deploying and testing the Google Calendar Add-on (Stage 1 MVP) located in the `gas/` directory using `clasp`.

## Prerequisites

- The Google Apps Script project files must be located in the `gas/` directory.
- `clasp` (Command Line Apps Script Projects) is required to push code.

## Deployment Workflow

When the user asks to deploy, push, or test the Add-on code, follow these steps:

1. **Navigate and Push**: Deploy the local changes by running `clasp push` in the `gas/` directory. Prefer using `npx @google/clasp` to avoid global installation issues, but fallback to `clasp` if necessary.
   ```bash
   cd gas && npx @google/clasp push
   ```
   *Note: If `npx @google/clasp push` is not found, try `clasp push`.*

2. **Handle Errors**:
   - **Authentication Error**: If the push fails because the user is not authenticated or the Apps Script API is not enabled, explicitly instruct the user to run `clasp login` in their terminal and ensure the API is enabled at https://script.google.com/home/usersettings.
   - **Missing .clasp.json**: If the push fails because `.clasp.json` is missing, inform the user that the project must be cloned or linked to an Apps Script project first (`clasp clone <scriptId>` or `clasp create`).

3. **Provide Testing Instructions**: Once the push is successful, inform the user how to test their changes:
   - Open Google Calendar (https://calendar.google.com).
   - Refresh the page to load the latest deployment.
   - Click on the Add-on icon in the right-hand sidebar to open it.
   - Verify the expected behavior or UI changes.

## Execution / Function Testing (Advanced)

If the user wants to test a specific Google Apps Script function (like `sync()` or `installStage1Mvp()`) directly from the CLI instead of the UI:
```bash
cd gas && npx @google/clasp run <FunctionName>
```
*Be aware that `clasp run` requires the Apps Script API to be fully configured with a GCP project and OAuth credentials. If `clasp run` is not configured, inform the user they can manually run the function from the Apps Script Editor (`clasp open`).*

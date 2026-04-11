---
name: review-calendar-addon
description: Review and validate Google Calendar Add-on code for compliance with CardService API specifications and UI/UX guidelines. Use when evaluating Add-on implementations.
---

# Calendar Add-on Review Skill

This skill provides the process for comprehensively reviewing and validating Google Calendar Add-on code (Google Apps Script `CardService` and `appsscript.json` manifests). 

## Review Process

When asked to review Calendar Add-on code, follow these steps systematically:

1. **Understand the Codebase:**
   - Locate the manifest file (`appsscript.json`).
   - Identify the main UI entry point files (e.g., `addon.js`, `ui.js`).
   - Identify which triggers (`homepageTrigger`, `eventOpenTrigger`, `eventUpdateTrigger`) are implemented.

2. **Execute the Review Checklist:**
   - Read the detailed validation rules in [references/checklist.md](references/checklist.md).
   - Evaluate the code against every single item in the checklist.
   - Pay special attention to strict Google API compliance (e.g., correct parameter types, correct return types like `Card` objects from triggers).

3. **Present the Review Report:**
   - Format your feedback clearly.
   - Separate issues into **Critical API Violations** (things that will break the Add-on), **UX Improvements** (things that violate design guidelines), and **Code Quality**.
   - Provide concrete code examples for how to fix the identified issues.
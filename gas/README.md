# Stage 1 Google Apps Script MVP

This folder contains the Stage 1 single-user Apps Script project for AutoColor for Calendar.

## What Stage 1 does

- stores rules, settings, and sync tokens in `User Properties`
- uses the Advanced Calendar service for full sync and incremental sync
- installs one Calendar change trigger and one periodic time-based trigger
- applies deterministic color rules to changed events
- writes private metadata to avoid thrashing on its own updates

## What Stage 1 does not do

- multi-user SaaS onboarding
- external OAuth or refresh-token storage
- webhook or watch-channel handling
- LLM-based classification

## Setup

1. Create a new Google Apps Script project in your own Google account.
2. Copy every file from this folder into that Apps Script project.
3. Make sure `appsscript.json` is present and the Advanced Calendar service is enabled.
4. Run `logAvailableColors()` once and inspect the logs to confirm which `colorId` values you want to use.
5. Edit the sample rules in `config.js`, or run `saveRulesFromJson()` with your own JSON.
6. Run `installStage1Mvp()`.
7. Optionally run `backfillConfiguredCalendars()` if you want existing events recolored immediately.

If your calendar history is very large, the first bootstrap can take longer because it must walk enough pages to establish a `nextSyncToken`. In that case, start with a narrower `calendarIds` list and keep Stage 1 focused on the calendars you actually want to automate.

## Important public functions

- `installStage1Mvp()`: saves default state if missing, installs triggers, and bootstraps sync tokens
- `runManualSync()`: runs the same incremental sync pipeline manually
- `backfillConfiguredCalendars()`: full-syncs and evaluates existing events
- `showCurrentConfiguration()`: logs rules, settings, and installed triggers
- `saveRulesFromJson(jsonString)`: replaces the current rule set from JSON
- `saveSettingsFromJson(jsonString)`: replaces the current settings from JSON
- `logAvailableColors()`: logs the Calendar color palette returned by the API

## Rule format

Rules are evaluated in order. The first matching rule wins.

```json
[
  {
    "id": "date",
    "label": "데이트",
    "colorId": "11",
    "anyTerms": ["데이트", "date", "anniversary"],
    "allTerms": [],
    "excludeTerms": []
  },
  {
    "id": "study-dev",
    "label": "개인 공부 / 개발 / 프로젝트",
    "colorId": "10",
    "anyTerms": ["개인 공부", "study", "개발", "코딩", "project"],
    "allTerms": [],
    "excludeTerms": []
  }
]
```

`colorId` is what the Calendar API actually stores. Treat the bundled numeric IDs as examples and confirm them with `logAvailableColors()` before relying on them.

## Known Stage 1 limitations

- single-user only
- correctness depends on incremental sync, not on trigger delivery alone
- if an event stops matching all rules, this MVP leaves the existing color unchanged
- Stage 2 is where watch channels, webhook wake-ups, centralized storage, and optional LLM fallback belong

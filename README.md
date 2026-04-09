# AutoColor for Calendar

AutoColor for Calendar assigns Google Calendar event colors from user-defined semantic rules. Stage 1 is a user-owned Google Apps Script MVP that focuses on deterministic, title-heavy matching. Optional LLM support is explicitly deferred until the rule engine proves useful.

## Repository layout

- `docs/architecture-stage1.md`: staged architecture, sync model, and what belongs in Stage 1 versus Stage 2.
- `gas/`: Stage 1 Google Apps Script project files.
- `gas/README.md`: setup and operating notes for the Apps Script MVP.

## Start here

1. Read `docs/architecture-stage1.md` for the product idea, staged architecture, and sync design.
2. Read `gas/README.md` for the concrete Stage 1 setup flow.
3. Copy the files under `gas/` into your own Apps Script project, enable the Advanced Calendar service, and run `installStage1Mvp()`.
# autocolor-calendar

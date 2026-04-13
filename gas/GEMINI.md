# Google Apps Script MVP (Stage 1) Context

## Development & Usage

To deploy or test the existing Stage 1 MVP:

1. Create a new Google Apps Script project.
2. Copy all files from the `gas/` directory into the project.
3. Enable the **Advanced Calendar service**.
4. Run `installStage1Mvp()` to initialize triggers and sync tokens.
5. Refer to `gas/README.md` for more detailed instructions and available manual functions (e.g., `backfillConfiguredCalendars()`).
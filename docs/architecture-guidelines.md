# Architectural Guidelines & Conventions

- **Source of Truth:** Incremental sync (`nextSyncToken`) is the authoritative source of truth. Webhooks should only be treated as wake-up signals, not as complete data records.
- **Sync Flow:** The reliable flow is:
  1. Wake up from a Calendar webhook (Watch API) or scheduled run on the backend.
  2. Call the Calendar API with an incremental sync token or equivalent stored checkpoint.
  3. Fetch the actual changed events.
  4. Re-evaluate color rules for those events.
  5. Update event colors when needed.
  6. Save the new sync state.
- **Idempotency:** Color updates should be idempotent to avoid infinite loops when the app modifies its own calendar events.
- **Workspace Add-on Constraints:** The main Add-on UI MUST be built using `CardService` in the `gas/` directory. Complex configuration UIs can be implemented via `HTMLService` or external Web UIs linked from the cards.
- **Domain Verification:** Real-time sync via Webhooks (Watch API) requires a verified domain via Google Search Console. Ensure the production endpoint is properly registered.
- **E2E Backend Mandatory:** All users MUST complete backend (Supabase/Workers) authentication during onboarding to use the service. Local GAS Triggers for syncing or coloring are **DEPRECATED and MUST NOT BE USED**.
- **Halt on Failure:** If the backend fails or API communication errors occur, processing must halt. There is NO fallback to local rules.
- **Hybrid Classification Engine:** The backend utilizes a 3-step pipeline: Rule-based (Supabase DB) -> Vector Embedding Similarity -> LLM Fallback, prioritizing speed and cost-efficiency while ensuring PII redaction before any LLM calls.

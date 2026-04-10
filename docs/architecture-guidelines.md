# Architectural Guidelines & Conventions

- **Source of Truth:** Incremental sync (`nextSyncToken`) is the authoritative source of truth for both stages. Webhooks and triggers should only be treated as wake-up signals, not as complete data records.
- **Sync Flow:** The reliable flow across stages is:
  1. Wake up from a Calendar trigger, webhook, or scheduled run.
  2. Call the Calendar API with an incremental sync token or equivalent stored checkpoint.
  3. Fetch the actual changed events.
  4. Re-evaluate color rules for those events.
  5. Update event colors when needed.
  6. Save the new sync state.
- **Idempotency:** Color updates should be idempotent to avoid infinite loops when the app modifies its own calendar events.
- **Workspace Add-on Constraints:** For Stage 2, the main Add-on UI MUST be built using `CardService`. Complex configuration UIs can be implemented via `HTMLService` or external Web UIs linked from the cards.
- **Domain Verification:** Real-time sync via Webhooks (Watch API) requires a verified domain via Google Search Console. Ensure the production endpoint is properly registered.
- **Transition to Stage 2:** When working on backend features, ensure that the core incremental sync logic from `gas/sync.js` is accurately ported to TypeScript. Use Cloudflare Queues or Durable Objects for concurrency control and reliable processing (instead of merely `ctx.waitUntil`).
- **Hybrid Classification Engine:** Stage 2 utilizes a 3-step pipeline: Rule-based (Supabase DB) -> Vector Embedding Similarity -> LLM Fallback, prioritizing speed and cost-efficiency while ensuring PII redaction before any LLM calls.
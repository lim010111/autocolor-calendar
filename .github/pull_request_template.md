## Summary

<!-- 1-3 bullets. WHY this change exists, not WHAT line moved where. -->

## Test plan

- [ ] `pnpm test` (or scoped subset) passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `python3 scripts/check-context-paths.py` passes (CLAUDE.md / README.md path refs)
- [ ] If schema changed: `pnpm db:generate` produced no drift

## Invariants reviewed

For non-trivial backend changes, confirm the touched invariants — every
"yes" is a deliberate decision, not a default skip.

- [ ] **Tenant isolation** — every new query carries `where(eq(table.user_id, ctx.userId))` (or explicit cross-user-exception comment per [`src/CLAUDE.md`](../src/CLAUDE.md)).
- [ ] **Halt-on-failure / Idempotency** — backend never falls back to local rules; new mutations are idempotent or have an explicit ownership probe.
- [ ] **Color ownership marker (§5.4)** — any code path that PATCHes `colorId` writes the three `autocolor_*` keys; readers consult marker before re-applying.
- [ ] **Log redaction** — no calendar event payload (`summary` / `description` / `location` / attendees) reaches log lines; new query-string params added to the redactor if needed.
- [ ] **Observability fire-and-forget** — `llm_calls` / `rollback_runs` / `sync_runs` writes use `execCtx.waitUntil(...).catch(warn)`; never trigger `msg.retry`.

## Out of scope / deferred

<!-- Anything intentionally NOT touched in this PR (with the why). Helps
     reviewers see what would otherwise look like a gap. -->

## Linked tickets / context

<!-- TODO §X.Y, plan files, runbook entries, related PRs. -->

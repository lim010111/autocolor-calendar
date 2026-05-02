# Drizzle Migrations — Module Context

## Purpose & Owns

This directory owns Postgres schema migrations for the backend. Configures
`drizzle-kit` against `../src/db/schema.ts` (single schema source).

- `drizzle.config.ts` (repo root): dialect=`postgresql`, schema=`./src/db/schema.ts`,
  out=`./drizzle`, schemaFilter=`["public"]`, strict + verbose.
- Connection: `DIRECT_DATABASE_URL` from `.dev.vars` (Supabase Direct port 5432).
- `0001_rls.sql` is the only hand-written migration (RLS policies); the rest are
  drizzle-kit output. The `meta/` directory holds drizzle-kit's state
  (journal + per-step snapshots) — do not hand-edit.

## Quick commands

```bash
pnpm db:generate   # after editing src/db/schema.ts → emits next NNNN_*.sql
pnpm db:migrate    # apply pending migrations against DIRECT_DATABASE_URL
pnpm db:push       # dev-only DDL push (skips file generation)
```

When each is appropriate is documented in `../src/CLAUDE.md` "DB connectivity".

## Migration patterns

- **Schema change**: edit `../src/db/schema.ts` → `pnpm db:generate` → review
  the new SQL file and matching `meta/` snapshot diff → commit.
- **Hand-written DDL** (RLS, triggers, indexes drizzle-kit can't express):
  follow the `0001_rls.sql` pattern — write SQL directly, append a matching
  journal entry, regenerate the snapshot.
- **Snapshot corruption recovery**: revert both the SQL file and its
  `meta/` snapshot together; never one without the other.

## Non-obvious rules

- **Why**: `0001_rls.sql` enables RLS, but the Worker path bypasses it. The
  Worker connects via Hyperdrive → Supabase Pooler as the `postgres` role
  which has `BYPASSRLS`. RLS here is defense-in-depth for Studio / future
  `supabase-js` clients only. Tenant isolation in the Worker is enforced by
  `where(eq(table.user_id, ctx.userId))` — see `../src/CLAUDE.md`
  "Tenant isolation".
- **Note**: Migrations are run **manually from a developer workstation**.
  The Worker never runs `drizzle-kit migrate` and CI does not run it either
  (no workflow exists at the time of writing). `DIRECT_DATABASE_URL` must
  never be injected as a Worker secret — see `../src/CLAUDE.md`
  "DB connectivity".
- **Gotcha**: drizzle-kit cannot detect every schema/runtime mismatch
  (e.g. column rename collisions, expression-index limits). Always read the
  generated SQL diff before committing.

## Cross-module dependencies

- **Reads** `../src/db/schema.ts` (single input — drizzle-kit treats every
  table/enum/index there as canonical).
- **Output consumed by** `../src/db/client.ts` at runtime (via the Hyperdrive
  binding — this directory's SQL is applied out-of-band, not loaded by the
  Worker).
- **Cron rotation cross-user SELECT exception** to the tenant-isolation rule
  is documented in `../src/CLAUDE.md` "Token rotation (§3 후속)".

## See also

- [../src/CLAUDE.md](../src/CLAUDE.md) — backend operational rules (authority for runtime contracts)
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — module map
- [../drizzle.config.ts](../drizzle.config.ts) — drizzle-kit configuration
- [./0001_rls.sql](./0001_rls.sql) — RLS policy reference (hand-written)

# AutoColor — System Architecture

This document is the entry point for understanding how the four top-level
modules connect. For sync-flow detail (incremental tokens, color
re-evaluation, PII redaction, LLM fallback) see [architecture-diagram.md](architecture-diagram.md).
For invariant rules see [architecture-guidelines.md](architecture-guidelines.md).

## Components

- `gas/` — Google Workspace Add-on (CardService UI, OAuth bridge). See [../gas/CLAUDE.md](../gas/CLAUDE.md).
- `src/` — Cloudflare Workers backend (Hono routes, Queue consumers, services). See [../src/CLAUDE.md](../src/CLAUDE.md).
- `drizzle/` — Postgres schema migrations (drizzle-kit + hand-written RLS). See [../drizzle/CLAUDE.md](../drizzle/CLAUDE.md).
- `scripts/` — Operational scripts (secret generation, secret sync, failure simulator). See [../scripts/CLAUDE.md](../scripts/CLAUDE.md).
- `docs/` — Architecture documents and decision records. See [decisions/README.md](decisions/README.md).

## Module map

```mermaid
flowchart LR
  GAS[gas/<br/>Add-on UI]
  SRC[src/<br/>CF Worker]
  DRZ[drizzle/<br/>Migrations]
  SCR[scripts/<br/>Ops]

  GCAL[Google Calendar API]
  OAI[OpenAI API]
  DB[(Hyperdrive → Supabase)]

  GAS --> SRC
  SRC --> GCAL
  SRC --> OAI
  SRC --> DB
  DRZ -.reads.-> SRC
  DRZ --> DB
  SCR -.> SRC
```

Edges carry direction only. For specific endpoints / methods, the source
files are authoritative — do not re-derive them from this diagram.

## Cross-module dependencies

Verified module-to-module relationships:

- `gas/` → `src/` — authenticated HTTP. Gas sends bearer-session requests
  and receives card payloads (route surface authority: [../src/CLAUDE.md](../src/CLAUDE.md)).
- `src/` → Hyperdrive → Supabase — runtime DB connection (pool authority:
  [../src/CLAUDE.md](../src/CLAUDE.md) "DB connectivity").
- `drizzle/` ↔ `src/db/schema.ts` — build-time only. Migrations are
  applied out-of-band by an operator; the Worker never invokes drizzle-kit.
- `scripts/sync-secrets` → Wrangler secret bindings → `src/` runtime.
- `scripts/sim-failure` mutates rows defined by `drizzle/` (bound to the
  same schema source that `src/` reads).

Internal `src/` sub-directory dependencies (routes / queues / services /
lib / db / middleware) are documented in [../src/CLAUDE.md](../src/CLAUDE.md), not here, so this
document stays stable as internal layout evolves.

## See also

- [architecture-diagram.md](architecture-diagram.md) — sync flow + AI engine detail
- [architecture-guidelines.md](architecture-guidelines.md) — cross-cutting invariants
- [../src/CLAUDE.md](../src/CLAUDE.md) — backend operational rules
- [decisions/README.md](decisions/README.md) — ADR scaffold (none recorded yet)

# AutoColor — System Architecture

This document is the entry point for understanding how the four top-level
modules connect. For invariant rules see [architecture-guidelines.md](architecture-guidelines.md).

## Components

- `gas/` — Google Workspace Add-on (CardService UI, OAuth bridge). See [../gas/CLAUDE.md](../gas/CLAUDE.md).
- `src/` — Cloudflare Workers backend (Hono routes, Queue consumers, services). See [../src/CLAUDE.md](../src/CLAUDE.md).
- `drizzle/` — Postgres schema migrations (drizzle-kit + hand-written RLS). See [../drizzle/CLAUDE.md](../drizzle/CLAUDE.md).
- `scripts/` — Operational scripts (secret generation, secret sync, failure simulator). See [../scripts/CLAUDE.md](../scripts/CLAUDE.md).
- `docs/` — Architecture documents and decision records. See [adr/README.md](adr/README.md).

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

## Sync flow + AI engine

> _Superseded-by-decision (not yet implemented) — see [`docs/adr/0004-embedding-classifier.md`](adr/0004-embedding-classifier.md).
> ADR-0004 (2026-05-20) decided to replace the Stage 1 substring matcher
> with an embedding kNN classifier; the diagram below documents the
> **currently-running** pipeline and stays authoritative until the
> implementation PR lands and rewrites it in lockstep._

```mermaid
flowchart TD
  classDef sync fill:#f3f4f6,stroke:#d1d5db,stroke-width:1px,color:#374151;
  classDef db fill:#dcfce7,stroke:#86efac,stroke-width:1px,color:#166534;
  classDef llm fill:#fee2e2,stroke:#fca5a5,stroke-width:1px,color:#991b1b;
  classDef action fill:#ede9fe,stroke:#c4b5fd,stroke-width:2px,color:#5b21b6;
  classDef cloud fill:#eef2ff,stroke:#c7d2fe,stroke-width:2px,color:#4338ca;

  Cloud[Cloud Backend<br>Workers/Supabase]:::cloud --> WakeUp

  subgraph SyncFlow [Reliable Sync Flow]
    direction TB
    WakeUp([1. Wake Up<br>Webhook / Cron]):::sync --> APICall[2. Call API<br>w/ nextSyncToken]:::sync
    APICall --> FetchEvents[3. Fetch Changed Events]:::sync
    FetchEvents --> Idempotency{Is self-updated<br>by AutoColor?}
    Idempotency -- "Yes (Infinite Loop Prevention)" --> Skip[Skip Event]:::sync
    Idempotency -- "No" --> Rule
  end

  subgraph AIEngine [4. Hybrid AI Engine: Rule → LLM]
    direction TB
    Rule[Step 1. DB Rules<br>Keyword Substring Match]:::db --> RuleCheck{Matched?}
    RuleCheck -- "Yes (Fast, Free)" --> FinalColor([Color Determined])
    RuleCheck -- "No" --> Redact[PII Redaction<br>Masking User Data]
    Redact --> LLM[Step 2. LLM Fallback<br>Context Inference]:::llm
    LLM --> FinalColor
  end

  FinalColor --> UpdateEvent[5. Update Event Colors]:::action
  UpdateEvent --> SaveToken[6. Save New nextSyncToken<br>Source of Truth]:::sync
  Skip --> SaveToken
```

## See also

- [architecture-guidelines.md](architecture-guidelines.md) — cross-cutting invariants
- [../src/CLAUDE.md](../src/CLAUDE.md) — backend operational rules
- [adr/README.md](adr/README.md) — ADR index

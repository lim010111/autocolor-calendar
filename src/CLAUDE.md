# Backend Module — Operational Rules (autocolor backend)

This module runs as the Cloudflare Worker `autocolor-{dev,prod}`, backed by
Supabase (PostgreSQL + pgvector). The rules below are non-obvious invariants
that you must not break when extending this directory. They supersede general
style advice; see `@docs/architecture-guidelines.md` for cross-cutting rules.

## Tenant isolation

RLS policies exist on every table (`drizzle/0001_rls.sql`) but **they do not
protect the Worker path**. The Worker connects through Hyperdrive → Supabase
pooler as the `postgres` role, which has `BYPASSRLS`. The policies are
defense-in-depth for Studio / future `supabase-js` clients.

Every query that touches user-scoped data **must** include
`where(eq(table.user_id, ctx.userId))` — or the equivalent compound key for
tables keyed on `(user_id, ...)`. Never rely on "RLS will catch it."

## DB connectivity

- Runtime path: Hono → `getDb(c.env)` → postgres.js against
  `env.HYPERDRIVE.connectionString`. The Worker never sees the origin DB
  credentials — those live in the Hyperdrive config.
- Pool settings (`max: 1`, `idle_timeout: 0`, `fetch_types: false`) are
  deliberate: postgres.js's defaults burn through the Worker subrequest
  budget during the Supabase pooler handshake. Don't raise `max` without
  re-testing `/me` and `/oauth/google/callback` under load.
- Always wrap DB work in `try { ... } finally { c.executionCtx.waitUntil(close()); }`
  so the socket is released after the response.
- Migrations run locally with `pnpm db:migrate`, using
  `DIRECT_DATABASE_URL` from `.dev.vars` (Supabase Session Pooler, port 5432,
  IPv4). Never inject `DIRECT_DATABASE_URL` as a Worker secret.

## GAS deployment URL must stay stable

The Worker redirects OAuth results to `env.GAS_REDIRECT_URL`, which points at
the GAS web app `/exec`. Do not create a **new** deployment for GAS code
changes — it mints a fresh `/exec` URL and every Worker secret / GCP
authorized redirect / Script Property needs rewiring.

Instead: **GAS editor → Deploy → Manage deployments → pencil/edit on the
existing deployment → Version: "New version" → Deploy**. This publishes the
code under the same `/exec` URL.

## Secret rotation impact

- `SESSION_PEPPER`: all `sessions.token_hash` values become unverifiable →
  every logged-in user is logged out on next request. Expect a re-auth spike;
  schedule rotation outside peak hours.
- `TOKEN_ENCRYPTION_KEY`: every `oauth_tokens.encrypted_refresh_token` row
  stops decrypting. A full re-encryption batch is required (iterate rows,
  decrypt with the old key, encrypt with the new one, bump `token_version`).
  The batch job is a Section 6 (observability) deliverable — do **not** rotate
  this key before that job exists.
- `SESSION_HMAC_KEY`: in-flight OAuth state values fail verification → only
  users mid-login are affected; existing sessions keep working.
- Supabase DB password: update the Hyperdrive origin via
  `wrangler hyperdrive update <id> --connection-string=...`. The Worker
  reconnects on next request.

## Log redaction contract

`src/middleware/logger.ts` redacts these field names when they appear as
**query-string parameters** before emitting each JSON log line:

`authorization`, `token`, `code`, `state`, `refresh_token`, `access_token`,
`id_token`, `email`, `sub`, `password`

The middleware deliberately does not read or log request/response bodies —
that keeps refresh tokens, opaque session tokens, and PII out of the log
stream by construction. If a future route needs body-level diagnostics, add
a body-scoped redactor that covers the same field set and keep the response
body out of the log. Request headers are also excluded because `Authorization:
Bearer …` tokens would otherwise be captured.

## Environments

- `dev`: `autocolor-dev` Worker, `autocolor-dev-db` Hyperdrive, full secrets.
- `prod`: `autocolor-prod` Worker is a **URL-reserving shell**. It has
  `GOOGLE_OAUTH_REDIRECT_URI` configured and answers `/healthz`, but has no
  secrets, no Hyperdrive binding, and no Supabase project yet. `/oauth/*`,
  `/me`, `/auth/logout` will fail until a prod Supabase project, GCP OAuth
  client, and secret bootstrap are added (separate task).

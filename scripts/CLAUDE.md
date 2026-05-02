# Scripts — Module Context

## Purpose & Owns

This directory owns three single-responsibility TypeScript scripts that the
operator runs from a developer workstation. None ships into the Worker
runtime.

- `gen-secrets.ts` — emits `TOKEN_ENCRYPTION_KEY` / `SESSION_HMAC_KEY` /
  `SESSION_PEPPER` as 32-byte base64 `KEY=VALUE` lines on stdout.
- `sync-secrets.ts` — pipes Worker-runtime secrets from `.dev.vars` /
  `.prod.vars` into `wrangler secret put` via stdin (so values never hit
  shell history).
- `sim-failure.ts` — `§4A` failure-path simulator that mutates a single
  user's `sync_state` / `oauth_tokens` rows for manual recovery testing.

## Quick commands

```bash
pnpm gen-secrets                                          # paste output into .dev.vars
pnpm sync-secrets dev                                     # .dev.vars  → wrangler --env dev
pnpm sync-secrets prod                                    # .prod.vars → wrangler --env prod
pnpm tsx scripts/sim-failure.ts inspect <email>           # dump sync_state + oauth_tokens
pnpm tsx scripts/sim-failure.ts corrupt-token <email>     # bogus next_sync_token (forces 410 recovery)
pnpm tsx scripts/sim-failure.ts set-reauth <email>        # toggle needs_reauth flag
```

`sim-failure.ts` also supports `clear-reauth`, `deactivate`, `activate`.

## Common patterns

- **Adding a new required secret**: extend `REQUIRED_SECRETS` in
  `./sync-secrets.ts` **and** add the same key to `../.dev.vars.example`.
  Forgetting either lets a missing secret reach prod silently.
- **Adding a new failure scenario**: add a `case` to the switch in
  `./sim-failure.ts` and document the trigger condition in the file's
  header comment. Keep one mutation per case.

## Non-obvious rules

- **Note**: `sync-secrets.ts` deliberately excludes `ENV` and
  `GOOGLE_OAUTH_REDIRECT_URI` (those live in `../wrangler.toml`
  `[env.*.vars]`) and `DATABASE_URL` / `DIRECT_DATABASE_URL` (Hyperdrive
  binding + drizzle-kit input respectively — never sent to the Worker).
- **Why**: secrets are piped via stdin, not argv, so shell history and
  `ps` output never contain refresh-tokenable material. Wrapping a value
  in quotes (`FOO="bar"`) is **not** unwrapped — quotes get sent verbatim.
- **Gotcha**: `TOKEN_ENCRYPTION_KEY_PREV` is in `OPTIONAL_SECRETS` and must
  be present **only during an active rotation window**. Leaving it set
  after the cron drains stale rows is a security regression. The full
  operator runbook is `../src/CLAUDE.md` "Secret rotation impact" and the
  rotation invariant is `../src/CLAUDE.md` "Token rotation (§3 후속)".

## Cross-module dependencies

- **Reads** `../.dev.vars` / `../.prod.vars` (gitignored) and
  `../.dev.vars.example` (the additive contract).
- **Writes** Wrangler secret bindings consumed by the Worker at runtime.
- `./sim-failure.ts` is bound to the row shapes defined in
  `../src/db/schema.ts` (and therefore tracks `../drizzle/` migrations).
- Operational consequences (re-auth spikes on `SESSION_PEPPER` rotation,
  dual-key fallback during `TOKEN_ENCRYPTION_KEY` rotation) are owned by
  `../src/CLAUDE.md`, not here.

## See also

- [../src/CLAUDE.md](../src/CLAUDE.md) — backend operational rules (rotation runbooks)
- [../.dev.vars.example](../.dev.vars.example) — secret-name contract
- [../wrangler.toml](../wrangler.toml) — env vars vs. secrets split
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — module map

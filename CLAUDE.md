# AutoColor for Calendar — Repo Context

Multi-tenant Workspace Marketplace add-on. Cloudflare Workers backend +
Supabase + 2-stage classifier (Rule → LLM). All sync work happens on the
backend; the GAS Add-on is UI only (no local triggers, no fallback rules).

## Module map

| Path | What it owns | Context file |
|------|--------------|--------------|
| `src/` | Cloudflare Worker (Hono routes, queues, services, DB) | [src/CLAUDE.md](src/CLAUDE.md) |
| `gas/` | Google Apps Script Add-on UI (CardService) | [gas/CLAUDE.md](gas/CLAUDE.md) |
| `drizzle/` | Postgres migrations (schema source: `src/db/schema.ts`) | [drizzle/CLAUDE.md](drizzle/CLAUDE.md) |
| `scripts/` | Operator-side TS scripts (secrets, failure-sim) | [scripts/CLAUDE.md](scripts/CLAUDE.md) |
| `docs/` | Architecture, runbooks, marketplace assets | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

## Project documentation

- 프로젝트 개요 및 기술 스택: [docs/project-overview.md](docs/project-overview.md)
- 아키텍처 가이드라인 및 컨벤션: [docs/architecture-guidelines.md](docs/architecture-guidelines.md)
- Backend 운영 규칙 (가장 길고 권위 있는 문서): [src/CLAUDE.md](src/CLAUDE.md)

## Quick commands

```bash
# Backend (Cloudflare Workers, run from repo root)
pnpm install --frozen-lockfile
pnpm dev                # wrangler dev — local Worker
pnpm test               # vitest
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint

# Database (Drizzle migrations against DIRECT_DATABASE_URL in .dev.vars)
pnpm db:generate        # after editing src/db/schema.ts
pnpm db:migrate         # apply pending migrations
pnpm db:push            # dev-only DDL push (skips file generation)

# Secrets (operator workstation only — never inject into the Worker)
pnpm gen-secrets                  # mint TOKEN_ENCRYPTION_KEY / SESSION_HMAC_KEY / SESSION_PEPPER
pnpm sync-secrets dev             # .dev.vars → wrangler --env dev
pnpm sync-secrets prod            # .prod.vars → wrangler --env prod

# Self-checks
python3 scripts/check-context-paths.py   # broken CLAUDE.md / README.md path refs (also runs in CI)
```

## Non-obvious rules

- **Why backend-mandatory:** all sync + classification runs on the Worker.
  Local GAS triggers are deprecated and MUST NOT be re-introduced — the
  reasoning chain (PII redaction, daily LLM quota, ownership marker, watch
  renewal lock, token rotation) only holds when the pipeline is centralised.
  See [docs/architecture-guidelines.md](docs/architecture-guidelines.md)
  "E2E Backend Mandatory" / "Halt on Failure".
- **GAS deployment URL must stay stable.** Never create a *new* deployment
  for code changes — mint the same `/exec` URL via "Manage deployments →
  edit existing → New version → Deploy". A new URL invalidates every
  Worker secret + GCP redirect + Script Property. See
  [src/CLAUDE.md](src/CLAUDE.md) "GAS deployment URL must stay stable".
- **Calendar event payloads must never be logged.** The middleware redacts
  query params; bodies are not read. Adding any new logger that touches
  request/response bodies must respect this — see
  [src/CLAUDE.md](src/CLAUDE.md) "Log redaction contract".
- **Color ownership marker (§5.4)** is the bedrock invariant of the sync
  pipeline. Three keys under `extendedProperties.private` decide whether
  an event is app-owned and re-applicable; never write `autocolor_*` keys
  from any other code path without bumping `autocolor_v`.

## See also

- [TODO.md](TODO.md) — active work tracker
- [next-todo.md](next-todo.md) — promoted next task
- [docs/marketplace-readiness.md](docs/marketplace-readiness.md) — launch gate index
- [docs/ai-readiness-map.html](docs/ai-readiness-map.html) — agent-friendliness dashboard
- [wrangler.toml](wrangler.toml) — Worker env / secret split

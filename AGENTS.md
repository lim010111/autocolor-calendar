# AutoColor for Calendar — Repo Context

Multi-tenant Workspace Marketplace add-on. Cloudflare Workers backend +
Supabase + 2-stage classifier (Rule → LLM). All sync work happens on the
backend; the GAS Add-on is UI only (no local triggers, no fallback rules).

## Module map

| Path | What it owns | Context file |
|------|--------------|--------------|
| `src/` | Cloudflare Worker (Hono routes, queues, services, DB) | [src/AGENTS.md](src/AGENTS.md) |
| `gas/` | Google Apps Script Add-on UI (CardService) | [gas/AGENTS.md](gas/AGENTS.md) |
| `drizzle/` | Postgres migrations (schema source: `src/db/schema.ts`) | [drizzle/AGENTS.md](drizzle/AGENTS.md) |
| `scripts/` | Operator-side TS scripts (secrets, failure-sim) | [scripts/AGENTS.md](scripts/AGENTS.md) |
| `prompts/` | Versioned LLM prompts (classifier + dataset-builder) | [prompts/README.md](prompts/README.md) |
| `docs/` | Architecture, runbooks, marketplace assets | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

## Project documentation

- 프로젝트 개요 및 기술 스택: [docs/project-overview.md](docs/project-overview.md)
- 아키텍처 가이드라인 및 컨벤션: [docs/architecture-guidelines.md](docs/architecture-guidelines.md)
- Backend 운영 규칙 (가장 길고 권위 있는 문서): [src/AGENTS.md](src/AGENTS.md)

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

- **Why:** backend-mandatory — all sync + classification runs on the Worker.
  Local GAS triggers are deprecated and MUST NOT be re-introduced — the
  reasoning chain (PII redaction, daily LLM quota, ownership marker, watch
  renewal lock, token rotation) only holds when the pipeline is centralised.
  See [docs/architecture-guidelines.md](docs/architecture-guidelines.md)
  "E2E Backend Mandatory" / "Halt on Failure".
- **Important:** GAS deployment URL must stay stable. Never create a *new* deployment
  for code changes — mint the same `/exec` URL via "Manage deployments →
  edit existing → New version → Deploy". A new URL invalidates every
  Worker secret + GCP redirect + Script Property. See
  [src/AGENTS.md](src/AGENTS.md) "GAS deployment URL must stay stable".
- **Calendar event payloads must never be logged.** The middleware redacts
  query params; bodies are not read. Adding any new logger that touches
  request/response bodies must respect this — see
  [src/AGENTS.md](src/AGENTS.md) "Log redaction contract".
- **Color ownership marker (§5.4)** is the bedrock invariant of the sync
  pipeline. Three keys under `extendedProperties.private` decide whether
  an event is app-owned and re-applicable; never write `autocolor_*` keys
  from any other code path without bumping `autocolor_v`.

## Agent telemetry & evals

Agent-run quality is tracked alongside the human runtime: the Worker's
**agent log path** for runtime traffic is `src/middleware/logger.ts`
(query-param redacted, body-blind), and **Claude Code session logs** live
under `~/.claude/projects/-home-shine-projects-autocolor-for-calendar/`
(per-tool token + duration data) — a skill to aggregate them into a
session-cost dashboard is planned, not yet built. The
durable scoreboard lives in [evals/agent-results.json](evals/agent-results.json);
the rubric trend point is [docs/ai-readiness-score.json](docs/ai-readiness-score.json).
The 4-language classification baseline (en/ko/zh-CN/zh-TW) is built by the
operator-side Python pipeline in [evals/dataset-builder/](evals/dataset-builder/)
and lands as `evals/datasets/{lang}/classification.json`.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/issues/NN-slug.md` with a `Status:` line at the top — these are **canonical**. STATUS.md is generated off them, and they are mirrored **one-way** to GitHub Issues via `scripts/sync-issues-to-github.py` (local → GitHub; GitHub edits are not pulled back). See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Canonical role strings (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`) — written into each issue's `Status:` line. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Multi-context — [CONTEXT-MAP.md](CONTEXT-MAP.md) at the root points at the cross-cutting glossary and any per-module `CONTEXT.md` files. ADRs at [docs/adr/](docs/adr/). See [docs/agents/domain.md](docs/agents/domain.md).

### Merge gate

머지 게이트 in-scope 변경을 푸시한 뒤에는 **findings 한 패스를 돌릴 것** — `/handle-merge-findings` (consumer-side reproduce-or-refute 루프, ADR-0027): 어드바이저리 findings 를 재현해 증명되면 고치고 하나로 묶어 푸시한 뒤 핸드오프. pass 2 이후는 사람이 게이트한다.

## See also

- [TODO.md](TODO.md) — active work tracker
- [next-todo.md](next-todo.md) — promoted next task
- [docs/marketplace-readiness.md](docs/marketplace-readiness.md) — launch gate index
- [docs/ai-readiness-map.html](docs/ai-readiness-map.html) — agent-friendliness dashboard
- [evals/README.md](evals/README.md) — agent eval methodology + telemetry pointers
- [wrangler.toml](wrangler.toml) — Worker env / secret split

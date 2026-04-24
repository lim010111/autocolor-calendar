# Backup & Recovery Policy

> This document is an **index** to the backup and disaster-recovery posture of
> AutoColor for Calendar. It names the data classes under protection, points
> at the canonical source of each recovery mechanism in the codebase or
> infrastructure, and lists the drills that keep those mechanisms honest. The
> contract body for secrets, DB connectivity, and environment layout lives
> only at the pointer — if a rule changes, edit the canonical source (almost
> always `src/CLAUDE.md`) first and then update the pointer here. Do not
> restate contracts inside this document; the duplication will drift.
>
> Audience: the Eng on-call during an incident, a Marketplace reviewer asking
> the Admin-facing "retention / deletion / recovery" questions in
> `docs/marketplace-readiness.md` §3, and new contributors who need to reason
> about the dev/prod asymmetry before touching migrations or secrets. Paired
> with `docs/security-principles.md` Principle 5 (Secret Hygiene) — that file
> promises rotation is *audited*; this file promises recovery is *exercised*.

## Scope

In scope:
- Recovery posture for Supabase Postgres (user data, OAuth tokens,
  observability tables).
- Recovery posture for the six Worker runtime secrets and the Hyperdrive
  origin credentials.
- The drill cadence that keeps these procedures operational rather than
  aspirational.
- The dev/prod asymmetry — dev is a real running environment, prod is a
  URL-reserving shell (`src/CLAUDE.md` → `Environments`).

Out of scope (intentionally):
- The full blast-radius matrix for each Worker secret. Canonical source:
  `src/CLAUDE.md` → `Secret rotation impact`. This document references it
  but never restates it.
- The full migration history. Canonical source: `drizzle/0000..0012`. This
  document only documents how those files are *replayed*.
- CI/CD build and deploy pipeline. Tracked separately at `TODO.md:129`.
- The §3 후속 account-deletion endpoint, which is a *feature gap* (see §7),
  not a recovery gap.

## 1. Promise & Targets

**Promise.** On the loss of a single data class (Postgres row, Worker secret,
Hyperdrive origin config, or GCP OAuth client), a known-good state is
reachable through a documented, exercised procedure — without restoring a
backup that has never been test-restored, and without a step that only the
original author remembers.

| Class | Environment | RTO | RPO | Notes |
|---|---|---|---|---|
| Postgres (user data) | dev | 24h ¹ | 24h ¹ | Aligned to Supabase daily-backup baseline |
| Postgres (user data) | prod | TBD | TBD | Blocked on `TODO.md:35` — no prod Supabase yet |
| Worker secrets (3× keys + 3× OAuth/URL values) | dev | < 1h | 0 | Regenerate + re-inject via scripts; see §5 |
| Worker secrets | prod | TBD | 0 | Same script path, blocked on prod activation |
| Hyperdrive origin | dev | < 15m | 0 | Single `wrangler hyperdrive update` call |
| GCP OAuth client | either | external | 0 | Re-authorization is a Google Cloud Console action, not a repo operation |

¹ Numbers assume Supabase's free/standard daily-backup baseline. The project
tier (and thus PITR availability) is not recorded in-repo; confirm on tier
audit. Tighter RPO requires confirmed PITR — see §7.

## 2. Canonical pointers

- Secret rotation impact matrix (what breaks when each key rotates):
  `src/CLAUDE.md` → `Secret rotation impact`.
- DB connectivity contract (Hyperdrive → pooler, `prepare: false`,
  `DIRECT_DATABASE_URL` for migrations only): `src/CLAUDE.md` →
  `DB connectivity`.
- Environment layout (dev real, prod shell): `src/CLAUDE.md` →
  `Environments`. Hyperdrive binding id recorded at `wrangler.toml:30-32`.
  Dev-only Queue bindings at `wrangler.toml:34-49`.
- Secret generation: `scripts/gen-secrets.ts` (emits the three Worker keys —
  `TOKEN_ENCRYPTION_KEY`, `SESSION_HMAC_KEY`, `SESSION_PEPPER` — on stdout).
- Secret injection: `scripts/sync-secrets.ts`. `REQUIRED_SECRETS` = 6 keys;
  `OPTIONAL_SECRETS` = `OPENAI_API_KEY`. Excludes `DATABASE_URL` /
  `DIRECT_DATABASE_URL` by construction.
- Migration replay: `drizzle/0000..0012` via `pnpm db:migrate` (uses
  `DIRECT_DATABASE_URL`, Supabase Session Pooler, port 5432, IPv4).
- Upstream security index: `docs/security-principles.md` Principle 5
  (Secret Hygiene) — companion document.
- Launch gate row this document closes: `docs/marketplace-readiness.md` §5
  "Backup / recovery policy".

## 3. What is backed up where

**Postgres (Supabase, dev).** Supabase manages daily backups at the project
level (see §7 for PITR tier status). All user-facing data lives here:
`users`, `oauth_tokens`, `sessions`, `categories`, `sync_state`,
`sync_failures`, `sync_runs`, `llm_calls`, `llm_usage_daily`, `rollback_runs`.

**Worker secrets.** Source of truth is the team password vault. The
`.dev.vars` / `.prod.vars` files are developer-local reconciliation
surfaces, not backups. Wrangler itself is write-only — a deployed secret
cannot be read back, so losing the vault without a fresh capture means
regenerating and re-distributing (`SESSION_PEPPER` rotation logs everyone
out, per `src/CLAUDE.md` → `Secret rotation impact`).

**Hyperdrive origin configuration.** Stored in Cloudflare. The connection
string to Supabase is known only to Hyperdrive — the Worker never sees
origin DB credentials (`src/CLAUDE.md` → `DB connectivity`). Rebuilding
Hyperdrive needs the Supabase DB password from the team vault.

**GCP OAuth client.** Stored in Google Cloud Console. Client ID / secret
are mirrored in the team vault; the *authorization state* (consent-screen
approval, verified domains) is not restorable by the team — Google owns it.

## 4. DB recovery procedure

Walk top-down and stop at the first path that applies.

1. **PITR restore (preferred, tier-gated).** If Supabase PITR is active,
   restore the project to a timestamp just before the incident via the
   Supabase dashboard. Tier is currently **TBD** — see §7. If unavailable,
   skip to step 2.
2. **Daily-backup restore.** Restore the most recent Supabase daily backup
   via the dashboard. RPO is 24h by construction. The dev environment is
   pre-launch, so data loss up to 24h is tolerated.
3. **Manual `pg_dump` fallback.** If the managed backup is unusable,
   connect via `DIRECT_DATABASE_URL` (Session Pooler, port 5432, IPv4 —
   `src/CLAUDE.md` → `DB connectivity`) and run `pg_dump` / `pg_restore`
   against a freshly provisioned Supabase project. Do **not** use the
   Hyperdrive-bound connection string for admin tooling; it disallows
   server-prepared statements and is not intended for that path.
4. **Migration-baseline restore.** On a brand-new Postgres, replay
   `drizzle/0000..0012` with `pnpm db:migrate`. This produces an empty
   schema matching head; user data must then be loaded from the dump in
   step 3 (or, if no dump exists, is lost — this is the worst case).
5. **Rebind Worker.** After the origin is restored, update Hyperdrive per
   §5(ii). The Worker reconnects on the next request.

Never inject `DIRECT_DATABASE_URL` as a Worker secret (`src/CLAUDE.md` →
`DB connectivity`). Migrations always run from a developer's laptop, not
from the Worker.

## 5. Secret recovery procedure

Three independent sub-procedures. Run only the ones the incident requires.

### (i) Worker secrets (three keys + three OAuth/URL values)

1. Regenerate the three cryptographic keys with
   `pnpm tsx scripts/gen-secrets.ts`. Paste output into `.dev.vars` (or
   `.prod.vars` once prod exists).
2. Inject all six required secrets with
   `pnpm tsx scripts/sync-secrets.ts <dev|prod>`. The script refuses to
   proceed if any `REQUIRED_SECRETS` entry is missing.
3. **Read the blast-radius matrix before rotating any key** —
   `src/CLAUDE.md` → `Secret rotation impact` is the authoritative per-key
   impact statement. Notably, rotating `TOKEN_ENCRYPTION_KEY` without the
   re-encryption batch (`TODO.md:39`) will brick every OAuth refresh
   token; the batch job does not exist yet, so until it lands, treat
   this key as non-rotatable in recovery terms.

### (ii) Hyperdrive origin re-connection

1. Retrieve the Supabase DB password from the team vault.
2. Run `pnpm wrangler hyperdrive update <dev binding id from wrangler.toml:32>
   --connection-string=<session-pooler-url>`. (Dev binding only; prod has
   no Hyperdrive binding yet — `src/CLAUDE.md` → `Environments`.)
3. Verify with `GET /healthz` and `GET /me`. The Worker reconnects on the
   next request; no code redeploy is required.

### (iii) GCP OAuth client re-authorization

External — no repo operation exists. Re-register redirect URIs and, if
re-verification is triggered, re-submit the consent screen artifacts
tracked at `docs/marketplace-readiness.md` §2. This is a Marketplace /
consent-screen gate, not a backup operation.

## 6. Recovery drill

**Cadence.** Quarterly (every 3 months) once prod lands. Pre-launch, a dev
drill is optional — prod recovery cannot be rehearsed until `TODO.md:35`
closes (§7), and a "drill" restricted to dev exercises only part of the
end-to-end path. The quarterly rhythm is calibrated for moderate schema
velocity (13 migrations over the project lifetime): long enough to
accumulate new surface worth exercising, short enough that staff memory
of the procedure does not decay.

**What the drill exercises** (scratch env only; touching live data is a
production incident in disguise):
1. Provision a scratch Supabase project.
2. Replay `drizzle/0000..0012` via `pnpm db:migrate` against it —
   confirms migration replay still produces a valid head schema.
3. Regenerate and inject a full secret set into a scratch Wrangler env —
   confirms `gen-secrets.ts` + `sync-secrets.ts` work end-to-end without
   a developer remembering a manual step.
4. Exercise the Hyperdrive origin swap against the scratch project —
   confirms the `wrangler hyperdrive update` command still accepts the
   binding shape.

**Pass criteria.** `GET /healthz` and `GET /me` against the scratch Worker
return `200`.

## 7. Gaps

Unresolved items this runbook cannot yet close. Each has an owning pointer.

- **Supabase PITR tier confirmation.** Free-tier Supabase does not include
  PITR. The project's tier is not recorded in-repo. RPO tightening below
  24h is blocked on confirmation. Owning pointer: `TODO.md:35` (§3 후속 Prod
  환경 활성화) or a paid-tier upgrade decision.
- **Prod Supabase does not exist.** All prod RTO/RPO rows in §1 are TBD
  until `TODO.md:35` closes. A prod recovery drill today is not meaningful.
- **Account-deletion endpoint is absent.** Referenced at
  `docs/marketplace-readiness.md` §3 row "Deletion on account revoke" and
  §5 row "Account-deletion endpoint live". Feature deficit, not a recovery
  mechanism — listed here so on-call knows the gap when a user requests
  deletion during an incident.
- **`TOKEN_ENCRYPTION_KEY` re-encryption batch pending.** `TODO.md:39`.
  Until it lands, rotating this key is a one-way brick; recovery from its
  compromise would require every user to re-auth.

## How to use this document

- **Marketplace reviewer.** §1's Promise paragraph and the RTO/RPO table are
  the public posture. §2's canonical pointers are the proof. The
  Admin-facing "retention / deletion / recovery" row at
  `docs/marketplace-readiness.md` §3 sources its "recovery" answer from here.
- **Incident responder (Eng on-call).** Walk §4 top-down for DB incidents,
  §5 for secret incidents. Do not improvise recovery steps — if a step is
  missing, add it here first, then execute.
- **New contributor onboarding.** Read this file end-to-end, then read the
  canonical pointers in §2. Read `docs/security-principles.md` Principle 5
  as the paired invariant — that file promises rotation is audited, this
  file promises recovery is exercised.
- **Changing a rule.** Edit the canonical source first (almost always
  `src/CLAUDE.md`). Then, in the same PR, update the pointer and the
  promise / gap paragraph here if the change moved the semantics. If this
  document lags the canonical source, the on-call will follow a stale
  procedure during an incident.

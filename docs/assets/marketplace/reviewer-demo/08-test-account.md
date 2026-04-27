# Scenario 08 — Test account credentials (placeholder)

> Unlike sibling slices `01-install.md` through `07-account-deletion.md`,
> this file is **not** a scenario walkthrough. It is the placeholder
> doc for the *test account credentials* artifact that the reviewer
> needs in order to walk slices 01–07. It documents what the artifact
> is, why it is not committed to this repo, how it will be conveyed at
> submission time, and the cleanup posture between reviewer sessions.
> The README's "Required scenario sections" bullet list
> (`README.md:104-113`, "Every scenario file MUST include … Numbered
> steps … `### Failure modes` …") scopes the walkthrough files (01–07)
> only; this file carves itself out via the framing above. The
> credentials themselves are conveyed out-of-band — see the
> Delivery protocol section below.

- **Scopes exercised in this scenario:** None. This file is not a
  scenario walkthrough; it documents the credentials artifact only.
- **Pre-conditions:** None — the credentials documented here *are* the
  pre-condition for slice `01-install.md` (cited at
  `01-install.md:15`).

## Rationale — credentials live outside git

The test account credentials (Google account email + password, or
equivalent OAuth-friendly handoff) are deliberately **not** committed
to this repository. The reasoning chains to two existing project
invariants:

- **Secrets out of git.** `src/CLAUDE.md` "Secret rotation impact"
  and "Token rotation (§3 후속)" treat refresh tokens, encryption
  keys, and session peppers as out-of-tree material rotated through
  Wrangler secrets. A test account password is the same shape of
  secret — committing it would defeat the point of the encryption
  surface that protects production refresh tokens.
- **Log redaction contract.** `src/CLAUDE.md` "Log redaction contract"
  bans `password` (alongside `authorization` / `token` / `code` / …)
  from log output. The same field that the runtime redacts at log
  time MUST NOT be persisted in checked-in documentation. Slice 8 is
  the bundle's compliance surface for that ban.

Cross-cutting anchor: `docs/security-principles.md` Principle 5 (Secret
hygiene) — the conceptual anchor for both bullets above.

## Delivery protocol — how the test account is conveyed

The credentials are delivered alongside the Workspace Marketplace
verification submission packet, not in this repo:

- **Format.** Secure-note pointer (vendor-neutral; the OPS owner
  picks 1Password / shared password manager / equivalent at
  submission time). The note carries the test account's Google login
  identity (email + password OR a temporary app-password equivalent
  acceptable to Google's reviewer flow), plus any Workspace-domain
  context required for the install consent surface.
- **Channel.** Out-of-band relative to this repo and relative to the
  Marketplace listing form — the reviewer receives the secure-note
  link through the same submission-tracking surface they use to
  request scope clarifications, not through the Marketplace listing
  itself.
- **Account state at handover.** The test account is delivered in a
  state from which the reviewer can begin at slice `01-install.md`
  Step 1 without prior cleanup:
  - Workspace Marketplace state: AutoColor **uninstalled**. The
    install consent surface (`README.md:23-44` "Two consent
    surfaces") fires for the first time at slice `01-install.md`
    Step 1, not before.
  - Backend state: no `sessions` row, no `oauth_tokens` row for
    this user (matches `01-install.md:25-26` pre-conditions).
  - Calendar state: empty primary calendar, OR pre-populated with
    the synthetic fixtures listed at `README.md:59-67` ("Sample
    fixtures"). Real-account event payloads are forbidden per
    `README.md:69-73`.
- **Scope of the grant.** The test account holds standard Google
  Calendar permissions. No extra Workspace admin role is required —
  slices 01–07 exercise per-user scopes only, not domain-wide
  install scopes.

## Submission-time checklist — when the placeholder graduates

This file landing flips two mirror status rows but does NOT graduate
the underlying §5 launch gate:

- **Flips on slice 8 landing:**
  - `docs/marketplace-readiness.md` §4 row 8 (`Test account
    credentials`) — Status `미작성` → `초안`; Source of truth
    `TBD (shared secure note)` →
    `docs/assets/marketplace/reviewer-demo/08-test-account.md`.
  - `README.md:86` (Scenario matrix row 8) — Status `미작성` →
    `초안` (mirror).
- **Does NOT flip on slice 8 landing:**
  - `docs/marketplace-readiness.md` §5 row "Reviewer demo bundle"
    (Launch Gate row, currently `초안`). Slice 8 closes the bundle's
    file count to 8/8 but the underlying credentials secure-note
    is still TBD until the submission packet is filed. The Launch
    Gate row graduates only when the secure-note is authored AND
    bound to a concrete pointer (i.e., when this file's
    Delivery-protocol section can name a specific secure-note
    URL / vault entry instead of a vendor-neutral placeholder).
- **Owner.** `docs/marketplace-readiness.md` §1 row "Support email"
  / "Support / help URL" share the OPS owner that authors this
  secure-note at submission time. The §5 row "Reviewer demo bundle"
  is co-owned by Product + Eng, but the secure-note authorship is
  OPS-scoped.

## Cleanup posture — account state between reviewer sessions

The reviewer can self-terminate the account state without OPS
involvement; re-provisioning between submissions is OPS-scoped:

- **Reviewer self-cleanup.** Slice `07-account-deletion.md` walks the
  user-initiated `POST /api/account/delete` path — backend
  authoritative `DELETE FROM users` (`src/routes/account.ts:102`)
  fans out via FK cascade across 9 tables, plus best-effort Google
  refresh-token revoke and per-calendar `channels.stop`. After the
  reviewer walks slice 07, the backend holds no rows for the test
  account and Google holds no live AutoColor grant — the account is
  back to a pre-install state from the AutoColor side, but the
  Google account itself still exists.
- **OPS-side re-provisioning.** Between submission cycles, OPS
  rotates the test account's Google password (or replaces the
  account entirely) and updates the secure-note pointer. The
  rotation cadence is not pinned by this file — OPS picks per
  Marketplace-submission lifecycle. The account state at the start
  of the next reviewer session matches the "Account state at
  handover" bullet under "Delivery protocol" above.
- **Why slice 7 is not the canonical cleanup.** Slice 7 is the
  *user-visible deletion path* the reviewer is asked to verify. It
  is not a between-submission OPS hygiene step — it is the surface
  that proves the data-deletion contract for `docs/marketplace-readiness.md`
  §3 row 179. Treating it as routine cleanup would conflate the
  reviewer's "verify the deletion path" task with OPS's "prepare a
  fresh account for the next submission" task.

### Cross-references

- `docs/assets/marketplace/reviewer-demo/README.md` "Test account
  credentials" section — the short pointer that this file is the
  source of truth for. After slice 8 lands, the README section
  reduces to a 2–3-line pointer; the substantive content moved
  here.
- `docs/marketplace-readiness.md` §4 row 8 — the row this file is
  the `Source of truth` for. Status: `초안` (flipped from `미작성`
  on slice 8 merge).
- `docs/marketplace-readiness.md` §5 "Reviewer demo bundle" Launch
  Gate row — the gate this slice approaches but does not graduate.
  Stays at `초안` until the secure-note is authored at submission
  time per the Submission-time checklist section above.
- `docs/assets/marketplace/reviewer-demo/01-install.md:15` — the
  entry point that requires this account to be signed in. Slice 8
  landing makes that citation resolvable.
- `docs/assets/marketplace/reviewer-demo/07-account-deletion.md` —
  the user-visible deletion path. Reviewer self-cleanup terminator
  per the Cleanup-posture section above. Distinct from OPS-side
  re-provisioning.
- `src/CLAUDE.md` "Log redaction contract" — the runtime invariant
  that bans `password` from log output, mirrored here as the ban on
  committing the same field to docs.
- `docs/security-principles.md` Principle 5 — Secret hygiene. The
  conceptual anchor for both "Secrets out of git" and the log
  redaction ban above.

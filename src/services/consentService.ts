import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { EXAMPLE_CONSENT_POLICY_VERSION } from "../config/consent";
import { ruleSeeds, users } from "../db/schema";
import {
  consentReceiptFrom,
  type ConsentReceipt,
  type ExampleConsentRecord,
} from "./piiRedactor";

// ADR-0007 — example-storage consent state. Sole owner of the three
// `users.example_consent_*` columns; `src/routes/consent.ts` is the only
// caller that mutates. Every query is tenant-scoped explicitly — RLS is
// bypassed on the Worker path (src/CLAUDE.md "Tenant isolation").

export type ExampleConsentState = {
  granted: boolean;
  grantedAt: Date | null;
  revokedAt: Date | null;
  policyVersion: string | null;
  currentPolicyVersion: string;
};

export async function readExampleConsent(
  db: PostgresJsDatabase,
  userId: string,
): Promise<ExampleConsentRecord> {
  const rows = await db
    .select({
      consentedAt: users.exampleConsentAt,
      revokedAt: users.exampleConsentRevokedAt,
      policyVersion: users.exampleConsentPolicyVersion,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  // A missing user row cannot happen behind `authMiddleware`, but the
  // fail-closed shape is the correct answer if it ever does.
  if (!row) return { consentedAt: null, revokedAt: null, policyVersion: null };
  return row;
}

// The bridge from stored state to the §5.2 capability token. Returning
// `null` here is what makes `consentExample()` — and therefore
// `addExample` — unreachable for a user who has not consented.
export async function issueExampleConsentReceipt(
  db: PostgresJsDatabase,
  userId: string,
): Promise<ConsentReceipt | null> {
  const record = await readExampleConsent(db, userId);
  return consentReceiptFrom(record, EXAMPLE_CONSENT_POLICY_VERSION);
}

export function toConsentState(
  record: ExampleConsentRecord,
): ExampleConsentState {
  return {
    granted:
      consentReceiptFrom(record, EXAMPLE_CONSENT_POLICY_VERSION) !== null,
    grantedAt: record.consentedAt,
    revokedAt: record.revokedAt,
    policyVersion: record.policyVersion,
    currentPolicyVersion: EXAMPLE_CONSENT_POLICY_VERSION,
  };
}

// Idempotent grant. An already-live consent keeps its original timestamp —
// re-stamping would falsify the record of when the user actually agreed.
// A previously revoked (or stale-version) consent is re-established: clear
// `revokedAt`, stamp a fresh `consentedAt`, record the current version.
export async function grantExampleConsent(
  db: PostgresJsDatabase,
  userId: string,
  policyVersion: string,
): Promise<ExampleConsentState> {
  const existing = await readExampleConsent(db, userId);
  if (consentReceiptFrom(existing, policyVersion) !== null) {
    return toConsentState(existing);
  }

  const updated = await db
    .update(users)
    .set({
      exampleConsentAt: sql`now()`,
      exampleConsentRevokedAt: null,
      exampleConsentPolicyVersion: policyVersion,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId))
    .returning({
      consentedAt: users.exampleConsentAt,
      revokedAt: users.exampleConsentRevokedAt,
      policyVersion: users.exampleConsentPolicyVersion,
    });

  const row = updated[0];
  if (!row) throw new Error("consent grant updated no rows");
  return toConsentState(row);
}

// Revocation purges every stored example for the tenant.
//
// Why deletion and not "stop writing, keep rows": consent is the ONLY lawful
// basis for this storage — the classifier works without examples, so there is
// no contract-necessity fallback. Withdrawal removes the basis, and continued
// storage is itself processing (GDPR Art. 7(3) + Art. 17(1)(b), PIPA §37④ /
// §21). See ADR-0007 and privacy-policy §2.5.
//
// **Purge BEFORE stamping** — the deliberate inverse of `addExample`'s
// insert-before-delete (`ruleService.ts`), because the risk asymmetry
// inverts. There, a mid-failure must not lose the user's data. Here, a
// mid-failure must not leave data retained under a revoked consent: crashing
// between the two statements leaves "rows gone, consent still live", which is
// recoverable by retrying revoke, instead of "consent revoked, rows retained",
// which is a policy violation. Do not reorder these for consistency with
// `addExample`.
export async function revokeExampleConsent(
  db: PostgresJsDatabase,
  userId: string,
): Promise<{ purged: number }> {
  const purgedRows = await db
    .delete(ruleSeeds)
    .where(
      and(eq(ruleSeeds.userId, userId), eq(ruleSeeds.seedType, "example")),
    )
    .returning({ id: ruleSeeds.id });

  await db
    .update(users)
    .set({
      exampleConsentRevokedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId));

  return { purged: purgedRows.length };
}

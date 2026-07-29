import { Hono } from "hono";
import { z } from "zod";

import {
  EXAMPLE_CONSENT_POLICY_VERSION,
  EXAMPLE_STORAGE_OPENS_AT,
  exampleStorageIsOpen,
} from "../config/consent";
import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import {
  grantExampleConsent,
  readExampleConsent,
  revokeExampleConsent,
  toConsentState,
} from "../services/consentService";

// ADR-0007 — example-storage consent surface. Sole writer of the three
// `users.example_consent_*` columns.
//
// Grant is a separate endpoint from `POST /api/examples` on purpose. If the
// two were combined, the redacted title would travel in the very request that
// establishes consent — data crossing the boundary before a consent record
// exists (PIPA §22 동의 후 수집). Splitting them also gives an independently
// auditable consent event and lets the Add-on render the disclosure and
// collect an affirmative act before any title leaves the client.
export const consentRoutes = new Hono<HonoEnv>();

consentRoutes.use("*", authMiddleware);

const GrantBody = z.object({
  // The client echoes the version whose disclosure text it actually rendered.
  // A stale Add-on deployment consenting against superseded copy is a loud
  // 409, never a silent grant against text the user never saw.
  policyVersion: z.string().min(1).max(64),
});

// GET /api/consent/examples — current state, for the settings card.
//
// Deliberately NOT consumed by the event card: that surface learns consent
// state lazily from `POST /api/examples`'s 403, so the sidebar hot path keeps
// zero extra round-trips (card-latency discipline) and a revoke performed on
// another device is honored on the very next correction.
consentRoutes.get("/examples", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const record = await readExampleConsent(db, userId);
    return c.json(toConsentState(record));
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

// POST /api/consent/examples — grant. Idempotent.
consentRoutes.post("/examples", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = GrantBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }
  // privacy-policy §12 — the 30-day notice window. Refusing the grant is the
  // whole gate: with no live consent `consentReceiptFrom` mints nothing, so
  // `POST /api/examples` cannot store either. Checked before the version
  // comparison so an early call gets the accurate reason rather than a
  // misleading version mismatch.
  if (!exampleStorageIsOpen()) {
    return c.json(
      {
        error: "storage_not_open_yet",
        opensAt: new Date(EXAMPLE_STORAGE_OPENS_AT).toISOString(),
      },
      409,
    );
  }
  if (parsed.data.policyVersion !== EXAMPLE_CONSENT_POLICY_VERSION) {
    return c.json(
      {
        error: "policy_version_mismatch",
        expected: EXAMPLE_CONSENT_POLICY_VERSION,
      },
      409,
    );
  }

  const { db, close } = getDb(c.env);
  try {
    const state = await grantExampleConsent(
      db,
      userId,
      EXAMPLE_CONSENT_POLICY_VERSION,
    );
    return c.json(state);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

// DELETE /api/consent/examples — revoke + purge.
//
// Always 200, never 404: revoking a consent that was never granted is a no-op
// that still runs the purge (defensive — if a row somehow exists without a
// live consent, revoke is the surface that should remove it).
consentRoutes.delete("/examples", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const { purged } = await revokeExampleConsent(db, userId);
    const record = await readExampleConsent(db, userId);
    return c.json({
      revoked: true,
      revokedAt: record.revokedAt,
      purgedExamples: purged,
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

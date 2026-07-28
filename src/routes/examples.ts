import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { EXAMPLE_CONSENT_POLICY_VERSION } from "../config/consent";
import { getDb } from "../db";
import { users } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { issueExampleConsentReceipt } from "../services/consentService";
import { resolveEmbedder } from "../services/embeddings";
import { consentExample } from "../services/piiRedactor";
import { addExample, getRule } from "../services/ruleService";

// ADR-0007 / ADR-0004 #05 — Instant Feedback correction sink. The only
// production caller of `consentExample`, and therefore the only path by which
// a calendar title can become durable.
export const examplesRoutes = new Hono<HonoEnv>();

examplesRoutes.use("*", authMiddleware);

// Cost guardrail — every accepted call burns one Workers AI embed before it
// touches a row. The per-rule cap of 10 bounds stored ROWS, not CALLS, so an
// authenticated bot could drain neurons indefinitely without growing storage.
// Same 2-second atomic UPDATE-RETURNING shape as the preview throttle in
// `classify.ts`, on its own column because `users.last_preview_at`'s
// sole-writer contract forbids a second writer by name.
const EXAMPLE_MIN_INTERVAL_MS = 2_000;

const AddExampleBody = z.object({
  ruleId: z.string().uuid(),
  // The Add-on already holds the title from the open event, so there is no
  // Google round-trip here. Cap mirrors `PreviewBody.summary`.
  title: z.string().trim().min(1).max(1024),
});

// POST /api/examples
//
// Failure modes and why each maps where it does:
//   400 invalid_request  — malformed body
//   429 example_throttled — abuse absorption (above)
//   403 consent_required  — authenticated but no live receipt. Distinguished
//                           from Google-borne 403s by the `error` string,
//                           which is how the Add-on already discriminates.
//   404 not_found         — rule absent, not owned, or label-deleted
//   200 {stored:false, reason:"unfit"}        — designed non-event: the
//        redacted title carries too little signal (§5.2 `isUnfitExample`).
//        ADR-0004 #05 says drop it silently; a 4xx would make `gas/api.js`
//        throw CLIENT_ERROR and turn a by-design outcome into an error path.
//   200 {stored:false, reason:"embed_failed"} — soft failure the UI must
//        surface. A 5xx would trip `gas/api.js`'s 3× exponential-backoff
//        retry loop, stalling the sidebar and making a transient embed
//        failure indistinguishable from an outage.
examplesRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = AddExampleBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }
  const { ruleId, title } = parsed.data;

  const { db, close } = getDb(c.env);
  try {
    const intervalSec = Math.ceil(EXAMPLE_MIN_INTERVAL_MS / 1000);
    const stamped = await db
      .update(users)
      .set({ lastExampleAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(users.id, userId),
          or(
            isNull(users.lastExampleAt),
            sql`${users.lastExampleAt} < now() - (${intervalSec} || ' seconds')::interval`,
          ),
        ),
      )
      .returning({ id: users.id });
    if (stamped.length === 0) {
      return c.json(
        {
          error: "example_throttled" as const,
          retryAfterMs: EXAMPLE_MIN_INTERVAL_MS,
        },
        429,
        { "Retry-After": String(intervalSec) },
      );
    }

    // §5.2 type gate — no receipt, no `ConsentedExample`, no storage.
    const receipt = await issueExampleConsentReceipt(db, userId);
    if (receipt === null) {
      return c.json(
        {
          error: "consent_required",
          policyVersion: EXAMPLE_CONSENT_POLICY_VERSION,
        },
        403,
      );
    }

    // Ownership is proven here, tenant-scoped. The body's `ruleId` is never
    // trusted as an authorization claim.
    const rule = await getRule(db, userId, ruleId);
    if (!rule || rule.labelDeletedAt !== null) {
      return c.json({ error: "not_found" }, 404);
    }

    const example = consentExample(title, ruleId, userId, receipt);
    if (example === null) {
      return c.json({ stored: false, reason: "unfit" as const });
    }

    // Awaited, not fire-and-forget: `addExample` awaits an embedding network
    // call before its DB writes, so deferring it past `close()` would end the
    // pool mid-embed and silently drop the insert (same hazard documented in
    // `categories.ts`).
    const result = await addExample(db, resolveEmbedder(c.env), example);
    return c.json(result);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

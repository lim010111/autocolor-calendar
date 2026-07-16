import { and, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import { llmCalls } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";

// §6.3 후속 — self-query reader for the per-call LLM debugging surface.
//
// PURPOSE
// -------
// "분류가 잘 되는지" drill-down: when `/api/stats` shows an aggregate dip
// (miss rate up, hit latency p95 spike), this route returns the per-call
// rows so the user can inspect prompt / raw response / available
// categories on the specific events that failed. Replaces the deferred
// Langfuse integration's per-trace UI surface with a SQL/JSON pair that
// stays inside Workers + Hyperdrive.
//
// TENANT ISOLATION
// ----------------
// The Worker connects through Hyperdrive as the BYPASSRLS `postgres` role
// (see src/CLAUDE.md "Tenant isolation"), so the `where(eq(llmCalls.userId,
// ctx.userId))` predicate is the ONLY enforcement of per-tenant access.
// Removing it would expose every user's prompt history.
//
// PII / OBSERVABILITY DISCIPLINE
// ------------------------------
// Returned columns include `prompt_summary` and `raw_response` — both
// already passed `redactEventForLlm` (§5.3) before being stored, so this
// route inherits the redaction guarantee. The route writes nothing; it is
// a pure read surface and does not touch the §6 Wave A "fire-and-forget"
// writers.

export const llmCallsRoutes = new Hono<HonoEnv>();

llmCallsRoutes.use("*", authMiddleware);

// Window keys mirror `/api/stats` for cross-route consistency. `24h` is
// added here because per-event drill-down typically follows an alert and
// the operator wants the most recent 24 hours, not a week.
const WindowSchema = z.enum(["24h", "7d", "30d"]);
const WINDOW_HOURS: Record<z.infer<typeof WindowSchema>, number> = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
};

const OutcomeSchema = z.enum([
  "hit",
  "miss",
  "timeout",
  "quota_exceeded",
  "http_error",
  "bad_response",
  "fetch_failed",
  "disabled",
]);

const QuerySchema = z.object({
  window: WindowSchema.optional(),
  outcome: OutcomeSchema.optional(),
  eventId: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

llmCallsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const parsed = QuerySchema.safeParse({
    window: c.req.query("window"),
    outcome: c.req.query("outcome"),
    eventId: c.req.query("eventId"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }

  const windowKey = parsed.data.window ?? "24h";
  const limit = parsed.data.limit ?? 50;
  const windowStart = new Date(
    Date.now() - WINDOW_HOURS[windowKey] * 3600 * 1000,
  );

  const { db, close } = getDb(c.env);
  try {
    // Build the WHERE list explicitly — drizzle's `and()` handles
    // arbitrary truthy lists. Optional filters (outcome, eventId) only
    // append when present so they don't accidentally match NULL columns.
    const conditions = [
      eq(llmCalls.userId, userId),
      gte(llmCalls.occurredAt, windowStart),
    ];
    if (parsed.data.outcome) {
      conditions.push(eq(llmCalls.outcome, parsed.data.outcome));
    }
    if (parsed.data.eventId) {
      conditions.push(eq(llmCalls.eventId, parsed.data.eventId));
    }

    const rows = await db
      .select({
        id: llmCalls.id,
        occurredAt: llmCalls.occurredAt,
        outcome: llmCalls.outcome,
        httpStatus: llmCalls.httpStatus,
        latencyMs: llmCalls.latencyMs,
        categoryCount: llmCalls.categoryCount,
        attempts: llmCalls.attempts,
        categoryName: llmCalls.categoryName,
        eventId: llmCalls.eventId,
        promptSummary: llmCalls.promptSummary,
        rawResponse: llmCalls.rawResponse,
        availableCategories: llmCalls.availableCategories,
      })
      .from(llmCalls)
      .where(and(...conditions))
      .orderBy(desc(llmCalls.occurredAt))
      .limit(limit);

    return c.json({
      window: windowKey,
      windowStart: windowStart.toISOString(),
      limit,
      count: rows.length,
      rows: rows.map((r) => ({
        ...r,
        occurredAt: r.occurredAt.toISOString(),
      })),
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

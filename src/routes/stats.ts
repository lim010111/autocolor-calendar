import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import {
  llmCalls,
  llmUsageDaily,
  rollbackRuns,
  syncRuns,
} from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";

export const statsRoutes = new Hono<HonoEnv>();

statsRoutes.use("*", authMiddleware);

// §6 Wave B — §5.3 LLM quota cap. Must stay in sync with
// `LLM_DEFAULT_DAILY_LIMIT` in src/services/llmClassifier.ts. Duplicated here
// (not imported) to keep the llmClassifier module free of an upstream import
// cycle — its shape is a contract, not a coincidence.
const LLM_DEFAULT_DAILY_LIMIT = 200;

const WindowSchema = z.enum(["7d", "30d"]);

const WINDOW_DAYS: Record<z.infer<typeof WindowSchema>, number> = {
  "7d": 7,
  "30d": 30,
};

statsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const windowParam = c.req.query("window") ?? "7d";
  const parsed = WindowSchema.safeParse(windowParam);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_window", allowed: ["7d", "30d"] },
      400,
    );
  }
  const windowKey = parsed.data;
  const windowStart = new Date(
    Date.now() - WINDOW_DAYS[windowKey] * 24 * 3600 * 1000,
  );

  const { db, close } = getDb(c.env);
  try {
    // Four aggregations + one ORDER-BY-LIMIT-1 in parallel. Each SELECT is
    // one Worker subrequest through Hyperdrive; postgres.js `prepare: false`
    // (see src/CLAUDE.md "DB connectivity") — raw `sql` with inline params
    // is still safe because drizzle parameterizes interpolations.
    const [syncAggRows, llmAggRows, rollbackAggRows, usageRows, lastSyncRows] =
      await Promise.all([
        db
          .select({
            runs: sql<number>`count(*)::int`.as("runs"),
            okRuns: sql<number>`count(*) filter (where ${syncRuns.outcome} = 'ok')::int`.as(
              "ok_runs",
            ),
            evaluated: sql<number>`coalesce(sum(${syncRuns.evaluated}), 0)::int`.as(
              "evaluated",
            ),
            updated: sql<number>`coalesce(sum(${syncRuns.updated}), 0)::int`.as(
              "updated",
            ),
            skippedManual: sql<number>`coalesce(sum(${syncRuns.skippedManual}), 0)::int`.as(
              "skipped_manual",
            ),
            skippedEqual: sql<number>`coalesce(sum(${syncRuns.skippedEqual}), 0)::int`.as(
              "skipped_equal",
            ),
            noMatch: sql<number>`coalesce(sum(${syncRuns.noMatch}), 0)::int`.as(
              "no_match",
            ),
          })
          .from(syncRuns)
          .where(
            and(
              eq(syncRuns.userId, userId),
              gte(syncRuns.finishedAt, windowStart),
            ),
          ),
        db
          .select({
            calls: sql<number>`count(*)::int`.as("calls"),
            hits: sql<number>`count(*) filter (where ${llmCalls.outcome} = 'hit')::int`.as(
              "hits",
            ),
            miss: sql<number>`count(*) filter (where ${llmCalls.outcome} = 'miss')::int`.as(
              "miss",
            ),
            timeout: sql<number>`count(*) filter (where ${llmCalls.outcome} = 'timeout')::int`.as(
              "timeout",
            ),
            quotaExceeded: sql<number>`count(*) filter (where ${llmCalls.outcome} = 'quota_exceeded')::int`.as(
              "quota_exceeded",
            ),
            httpError: sql<number>`count(*) filter (where ${llmCalls.outcome} = 'http_error')::int`.as(
              "http_error",
            ),
            badResponse: sql<number>`count(*) filter (where ${llmCalls.outcome} = 'bad_response')::int`.as(
              "bad_response",
            ),
            disabled: sql<number>`count(*) filter (where ${llmCalls.outcome} = 'disabled')::int`.as(
              "disabled",
            ),
            // FILTER (WHERE outcome='hit') keeps quota_exceeded (latency=0)
            // and timeout (latency≈5000ms) from warping the distribution.
            // Returns null when the filter matches zero rows — GAS renders
            // "—" for null rather than 0ms.
            avgLatencyMs: sql<number | null>`avg(${llmCalls.latencyMs}) filter (where ${llmCalls.outcome} = 'hit')`.as(
              "avg_latency_ms",
            ),
            p95LatencyMs: sql<number | null>`percentile_cont(0.95) within group (order by ${llmCalls.latencyMs}) filter (where ${llmCalls.outcome} = 'hit')`.as(
              "p95_latency_ms",
            ),
          })
          .from(llmCalls)
          .where(
            and(
              eq(llmCalls.userId, userId),
              gte(llmCalls.occurredAt, windowStart),
            ),
          ),
        db
          .select({
            runs: sql<number>`count(*)::int`.as("runs"),
            cleared: sql<number>`coalesce(sum(${rollbackRuns.cleared}), 0)::int`.as(
              "cleared",
            ),
            ok: sql<number>`count(*) filter (where ${rollbackRuns.outcome} = 'ok')::int`.as(
              "ok",
            ),
            reauthRequired: sql<number>`count(*) filter (where ${rollbackRuns.outcome} = 'reauth_required')::int`.as(
              "reauth_required",
            ),
            forbidden: sql<number>`count(*) filter (where ${rollbackRuns.outcome} = 'forbidden')::int`.as(
              "forbidden",
            ),
            notFound: sql<number>`count(*) filter (where ${rollbackRuns.outcome} = 'not_found')::int`.as(
              "not_found",
            ),
            retryable: sql<number>`count(*) filter (where ${rollbackRuns.outcome} = 'retryable')::int`.as(
              "retryable",
            ),
          })
          .from(rollbackRuns)
          .where(
            and(
              eq(rollbackRuns.userId, userId),
              gte(rollbackRuns.finishedAt, windowStart),
            ),
          ),
        db
          .select({ callCount: llmUsageDaily.callCount })
          .from(llmUsageDaily)
          .where(
            and(
              eq(llmUsageDaily.userId, userId),
              // UTC day, consistent with reserveLlmCall UPSERT key (§5.3).
              // KST ~9h offset tradeoff is documented in drizzle/0008.
              eq(llmUsageDaily.day, sql`current_date`),
            ),
          )
          .limit(1),
        db
          .select({
            finishedAt: syncRuns.finishedAt,
            outcome: syncRuns.outcome,
          })
          .from(syncRuns)
          .where(eq(syncRuns.userId, userId))
          .orderBy(desc(syncRuns.finishedAt))
          .limit(1),
      ]);

    const sa = syncAggRows[0];
    const la = llmAggRows[0];
    const ra = rollbackAggRows[0];
    const usage = usageRows[0];
    const last = lastSyncRows[0];

    const limitOverride = c.env.LLM_DAILY_LIMIT
      ? Number.parseInt(c.env.LLM_DAILY_LIMIT, 10)
      : NaN;
    const limit =
      Number.isFinite(limitOverride) && limitOverride > 0
        ? limitOverride
        : LLM_DEFAULT_DAILY_LIMIT;
    const used = usage?.callCount ?? 0;
    // Null when the OpenAI integration isn't configured at all — UI hides
    // the "오늘 AI 분류 잔여" line in that case rather than showing a bogus
    // "200 남음".
    const dailyQuotaRemaining = c.env.OPENAI_API_KEY
      ? Math.max(0, limit - used)
      : null;

    return c.json({
      window: windowKey,
      windowStart: windowStart.toISOString(),
      classification: {
        runs: sa?.runs ?? 0,
        okRuns: sa?.okRuns ?? 0,
        evaluated: sa?.evaluated ?? 0,
        updated: sa?.updated ?? 0,
        skippedManual: sa?.skippedManual ?? 0,
        skippedEqual: sa?.skippedEqual ?? 0,
        noMatch: sa?.noMatch ?? 0,
      },
      llm: {
        calls: la?.calls ?? 0,
        hits: la?.hits ?? 0,
        byOutcome: {
          hit: la?.hits ?? 0,
          miss: la?.miss ?? 0,
          timeout: la?.timeout ?? 0,
          quota_exceeded: la?.quotaExceeded ?? 0,
          http_error: la?.httpError ?? 0,
          bad_response: la?.badResponse ?? 0,
          disabled: la?.disabled ?? 0,
        },
        avgLatencyMs: roundOrNull(la?.avgLatencyMs),
        p95LatencyMs: roundOrNull(la?.p95LatencyMs),
        dailyQuotaRemaining,
      },
      rollback: {
        runs: ra?.runs ?? 0,
        cleared: ra?.cleared ?? 0,
        byOutcome: {
          ok: ra?.ok ?? 0,
          reauth_required: ra?.reauthRequired ?? 0,
          forbidden: ra?.forbidden ?? 0,
          not_found: ra?.notFound ?? 0,
          retryable: ra?.retryable ?? 0,
        },
      },
      lastSync: last
        ? {
            finishedAt: new Date(last.finishedAt).toISOString(),
            outcome: last.outcome,
          }
        : null,
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

function roundOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

// Cost guardrail (§5/§6 후속) — daily LLM cost summary cron.
//
// Run from `scheduled()` in `src/index.ts` on the `5 0 * * *` cron (UTC
// 00:05). Summarises the previous UTC day's `llm_usage_global_daily` row
// against `LLM_GLOBAL_DAILY_LIMIT` and emits one structured log line so an
// operator tailing `wrangler tail` can spot saturation early. Threshold-
// crossed days emit `console.warn`; otherwise `console.log` at info level.
//
// FAILURE ISOLATION: any error inside this function is caught by the
// `scheduled()` `.catch(warn)` wrapper. Mirrors the §6 Wave A/B
// observability discipline — the cost report is observability, never a
// retry trigger. Empty rows (the day saw zero LLM activity) emit a normal
// info log with `count: 0` so the absence of activity is visible too.
//
// PII: aggregate counter only. No `userId`, no event content. Same posture
// as `tokenRotation.ts` and `llm_calls`.

import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { llmUsageGlobalDaily } from "../db/schema";
import type { Bindings } from "../env";
import { parseGlobalDailyLimit } from "./llmClassifier";

// 80% saturation triggers a warn-level alert. Below this threshold the
// report is informational only — operators don't need a page for "yesterday
// was a normal day."
export const WARN_THRESHOLD_PCT = 80;

export type CostReportSummary = {
  // ISO date (YYYY-MM-DD, UTC) the summary refers to. Always "yesterday"
  // relative to `now`.
  day: string;
  callCount: number;
  globalLimit: number;
  saturationPct: number;
  // True when callCount / globalLimit ≥ WARN_THRESHOLD_PCT/100. Drives
  // the warn-vs-info log level so dashboards can filter on it.
  warned: boolean;
};

function previousUtcDay(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  // YYYY-MM-DD slice — `toISOString` uses UTC by definition.
  return d.toISOString().slice(0, 10);
}

export async function runDailyCostReport(args: {
  db: PostgresJsDatabase;
  env: Bindings;
  now?: Date;
}): Promise<CostReportSummary> {
  const { db, env } = args;
  const now = args.now ?? new Date();
  const day = previousUtcDay(now);
  const globalLimit = parseGlobalDailyLimit(env.LLM_GLOBAL_DAILY_LIMIT);

  // SELECT a single row for `day`. If the day saw zero LLM calls, no row
  // exists (the UPSERT only fires on actual reservations) — fall back to 0.
  const rows = await db
    .select({ callCount: llmUsageGlobalDaily.callCount })
    .from(llmUsageGlobalDaily)
    .where(eq(llmUsageGlobalDaily.day, sql`${day}::date`))
    .limit(1);

  const callCount = rows[0]?.callCount ?? 0;
  // Compare raw counts rather than the rounded percentage so a saturation
  // value of 79.99% doesn't trip the warn at exactly the threshold —
  // `saturationPct` is for human-readable logging only, never a control
  // signal.
  const warnAt =
    globalLimit > 0 ? Math.floor((globalLimit * WARN_THRESHOLD_PCT) / 100) : 0;
  const saturationPct =
    globalLimit > 0 ? Math.round((callCount * 100) / globalLimit) : 0;
  const warned = globalLimit > 0 && callCount >= warnAt;

  const summary: CostReportSummary = {
    day,
    callCount,
    globalLimit,
    saturationPct,
    warned,
  };

  const logLine = JSON.stringify({
    level: warned ? "warn" : "info",
    msg: warned
      ? "daily LLM cost report — saturation threshold crossed"
      : "daily LLM cost report",
    ...summary,
  });
  if (warned) {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
  return summary;
}

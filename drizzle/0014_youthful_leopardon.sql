-- Cost guardrail (§5/§6 후속) — operator-side global daily LLM call counter
-- + per-user preview-LLM throttle column.
--
-- 1. `llm_usage_global_daily` is a single-row-per-day counter (PK = day) that
--    `reserveLlmCall` bumps BEFORE the per-user `llm_usage_daily` UPSERT.
--    A post-increment count exceeding `LLM_GLOBAL_DAILY_LIMIT` aborts the
--    call WITHOUT touching the per-user counter, so a single user does not
--    absorb blame for global exhaustion. `day` is UTC for parity with
--    `llm_usage_daily` — see 0008's KST-offset note for the same tradeoff.
--
--    No `user_id` column — this counter is operator-scoped, not user-scoped.
--    The cross-tenant nature is documented in `src/CLAUDE.md` "Cost guardrail
--    (§5/§6 후속)" as the second exception to the "Tenant isolation" rule
--    (the first being the §3-후속 token-rotation cron).
--
-- 2. `users.last_preview_at` is the sole-writer throttle window for the
--    `POST /api/classify/preview` endpoint when `llm: true`. Mirror of the
--    `sync_state.last_manual_trigger_at` (§6.4) and
--    `sync_state.watch_renewal_in_progress_at` (§6.4 / §4B M4) single-writer
--    pattern. NULL on pre-migration rows — the route treats NULL as "no
--    prior call observed" and skips the throttle until the first stamp.
--
-- RLS: `llm_usage_global_daily` enables RLS without any policies, so non-
-- BYPASSRLS roles (anon / service / future supabase-js clients) cannot read
-- or write it. The Worker connects via Hyperdrive as `postgres` (BYPASSRLS),
-- so the cron and `reserveLlmCall` are unaffected. This matches the
-- defense-in-depth posture of `0001_rls.sql` for operator-only tables.
--
-- NOTE: The hand-augmented `ENABLE ROW LEVEL SECURITY` line below is
-- intentionally NOT reflected in `meta/0014_snapshot.json` (drizzle-kit
-- doesn't track RLS state). This mirrors `0001_rls.sql` precedent and is
-- documented in `drizzle/CLAUDE.md` "Hand-written DDL" — the SQL file is
-- authoritative; the snapshot lags real RLS state by design.

CREATE TABLE "llm_usage_global_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_usage_global_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_preview_at" timestamp with time zone;

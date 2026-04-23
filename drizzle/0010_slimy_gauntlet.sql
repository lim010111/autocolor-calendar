-- §6 Wave B — sync_runs observability reader source.
--
-- Promotes `SyncSummary` into an append-only per-run log so windowed rollups
-- (weekly / 30-day) have a source. `sync_state.last_run_summary` still keeps
-- the most recent row inline for `/me` latency — intentional duplication
-- rather than a migration that would require a companion `/me` response shape
-- change on the GAS client.
--
-- Writer: `syncConsumer.handleOne` injects `recordSyncRun` into SyncContext;
-- `calendarSync.runPagedList`'s `finalize()` helper guarantees one row per
-- Worker invocation across all six outcomes. The consumer wraps the insert
-- in `execCtx.waitUntil(...).catch(warn)` — observability failure must never
-- trigger `msg.retry`, same discipline as `llm_calls` / `rollback_runs`.
--
-- PII: counters only. No Calendar event payload ever reaches this table —
-- respects the log-redaction contract in src/CLAUDE.md.
--
-- Retention: no TTL applied in Wave B. `sync_runs` grows monotonically; Wave
-- B-후속 will add a pg_cron purge bundled with the §3-후속 "세션 GC" wave.
-- The (user_id, finished_at) btree keeps recent-window reads fast regardless.
--
-- RLS: Worker connects through Hyperdrive as `postgres` (BYPASSRLS), so RLS
-- here is defense-in-depth for Studio / future supabase-js clients — same
-- pattern as drizzle/0001_rls.sql, 0008_llm_usage_daily.sql, and 0009.

CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"seen" integer DEFAULT 0 NOT NULL,
	"evaluated" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped_manual" integer DEFAULT 0 NOT NULL,
	"skipped_equal" integer DEFAULT 0 NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"no_match" integer DEFAULT 0 NOT NULL,
	"llm_attempted" integer DEFAULT 0 NOT NULL,
	"llm_succeeded" integer DEFAULT 0 NOT NULL,
	"llm_timeout" integer DEFAULT 0 NOT NULL,
	"llm_quota_exceeded" integer DEFAULT 0 NOT NULL,
	"stored_next_sync_token" boolean DEFAULT false NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "sync_runs_outcome_check" CHECK ("sync_runs"."outcome" IN ('ok','reauth_required','forbidden','not_found','full_sync_required','retryable'))
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_runs_user_finished_at_idx" ON "sync_runs" USING btree ("user_id","finished_at");--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sync_runs_owner_rw" ON "sync_runs"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

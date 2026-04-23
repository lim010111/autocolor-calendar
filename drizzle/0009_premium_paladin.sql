-- §6 Wave A — 관측성 스키마/라이터 기반.
--
-- Three logical changes bundled (drizzle-kit collapsed them into this file):
--   1. sync_failures.summary_snapshot  — SyncSummary snapshot at DLQ write.
--   2. sync_state.last_failure_summary — retryable-failure SyncSummary, read
--      by dlqConsumer when a job finally dies. Cleared on next success.
--   3. llm_calls                       — per-call LLM outcome/latency log.
--   4. rollback_runs                   — per-run color_rollback audit log.
--
-- RLS: Worker connects through Hyperdrive as `postgres` (BYPASSRLS), so RLS
-- here is defense-in-depth for Studio / future supabase-js clients — same
-- pattern as drizzle/0001_rls.sql and 0008_llm_usage_daily.sql. Application
-- code always scopes on user_id.
--
-- Retention: no TTL applied in Wave A. `llm_calls` in particular will grow
-- monotonically — Wave B (dashboards) owns retention policy via pg_cron or
-- partition-by-month. Index on (user_id, occurred_at) keeps recent-window
-- reads fast regardless.

CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer,
	"latency_ms" integer NOT NULL,
	"category_count" integer NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"category_name" text,
	CONSTRAINT "llm_calls_outcome_check" CHECK ("llm_calls"."outcome" IN ('hit','miss','timeout','quota_exceeded','http_error','bad_response','disabled'))
);
--> statement-breakpoint
CREATE TABLE "rollback_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"seen" integer DEFAULT 0 NOT NULL,
	"cleared" integer DEFAULT 0 NOT NULL,
	"skipped_stale_marker" integer DEFAULT 0 NOT NULL,
	"skipped_manual_override" integer DEFAULT 0 NOT NULL,
	"skipped_version_mismatch" integer DEFAULT 0 NOT NULL,
	"not_found" integer DEFAULT 0 NOT NULL,
	"forbidden_events" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"attempt" integer NOT NULL,
	"error_message" text,
	CONSTRAINT "rollback_runs_outcome_check" CHECK ("rollback_runs"."outcome" IN ('ok','reauth_required','forbidden','not_found','retryable'))
);
--> statement-breakpoint
ALTER TABLE "sync_failures" ADD COLUMN "summary_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "last_failure_summary" jsonb;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback_runs" ADD CONSTRAINT "rollback_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_calls_user_occurred_at_idx" ON "llm_calls" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "rollback_runs_user_finished_at_idx" ON "rollback_runs" USING btree ("user_id","finished_at");--> statement-breakpoint
ALTER TABLE "llm_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "llm_calls_owner_rw" ON "llm_calls"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);--> statement-breakpoint
ALTER TABLE "rollback_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "rollback_runs_owner_rw" ON "rollback_runs"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

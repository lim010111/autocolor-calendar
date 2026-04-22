-- §5.3 LLM fallback cost guard.
--
-- Per-user daily LLM call counter. PK (user_id, day) gives atomic
-- UPSERT+INCREMENT via `ON CONFLICT DO UPDATE ... RETURNING call_count`.
-- `reserveLlmCall` bumps the counter BEFORE the outbound OpenAI request so
-- a hung request cannot cause runaway cost; if the returned count exceeds
-- the configured limit the caller aborts without calling OpenAI.
--
-- `day` is stored UTC. For a KST user the day boundary crosses quota near
-- 09:00 KST, which is acceptable for a cost sanity guard (not a user-facing
-- fairness contract). A per-user-local-day scheme would need a per-row
-- timezone, which we don't collect.
--
-- Worker connects through Hyperdrive as `postgres` (BYPASSRLS), so RLS here
-- is defense-in-depth for Studio / future supabase-js clients — consistent
-- with drizzle/0001_rls.sql. Application code (`reserveLlmCall`) always
-- scopes on user_id via the PK.

CREATE TABLE "llm_usage_daily" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_daily_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "llm_usage_daily" ADD CONSTRAINT "llm_usage_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "llm_usage_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "llm_usage_daily_owner_rw" ON "llm_usage_daily"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

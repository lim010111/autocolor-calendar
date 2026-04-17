-- Row Level Security policies.
--
-- IMPORTANT: These policies only apply when connections use the Supabase
-- GoTrue-authenticated role (authenticated/anon via supabase-js). The Worker
-- connects via Supabase Pooler as the `postgres` role which has BYPASSRLS,
-- so these policies are DEFENSE-IN-DEPTH for Studio access / future Edge
-- Functions / direct `supabase-js` clients. Multi-tenant isolation in the
-- Worker path is enforced entirely by application code
-- (`where(eq(table.user_id, ctx.userId))`).

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_state" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY "users_self_rw" ON "users"
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

--> statement-breakpoint

CREATE POLICY "oauth_tokens_owner_rw" ON "oauth_tokens"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

--> statement-breakpoint

CREATE POLICY "sessions_owner_rw" ON "sessions"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

--> statement-breakpoint

CREATE POLICY "categories_owner_rw" ON "categories"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

--> statement-breakpoint

CREATE POLICY "sync_state_owner_rw" ON "sync_state"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

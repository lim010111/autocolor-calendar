-- Row Level Security policy for sync_failures (parity with 0001_rls.sql).
--
-- Same contract as other tables: this policy only applies for connections
-- that use a GoTrue-authenticated role. The Worker connects as `postgres`
-- (BYPASSRLS). Multi-tenant isolation in the Worker path is enforced by
-- application code (`where(eq(table.user_id, ctx.userId))`).

ALTER TABLE "sync_failures" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY "sync_failures_owner_rw" ON "sync_failures"
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

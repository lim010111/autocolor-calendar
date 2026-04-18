-- §4B Watch API: per-channel random token + uniqueness on (channel_id, resource_id).
--
-- Security rationale: instead of a single global GOOGLE_WEBHOOK_TOKEN secret
-- whose leak would compromise every user's webhook path, each Watch channel
-- registration generates a fresh random token. Webhook receipt verifies the
-- X-Goog-Channel-Token header against the row found by (channel_id,
-- resource_id) — a leak is scoped to one channel and rotates automatically
-- on renewal (§4C).
--
-- The partial UNIQUE index enforces that no two sync_state rows share the
-- same (channel_id, resource_id) pair, so webhook lookups are unambiguous.
-- Scoped WHERE clause keeps rows whose channel is not yet registered
-- (all-NULL pair) from colliding with each other.

ALTER TABLE "sync_state" ADD COLUMN "watch_channel_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_state_watch_channel_uq" ON "sync_state" USING btree ("watch_channel_id","watch_resource_id") WHERE "watch_channel_id" IS NOT NULL;

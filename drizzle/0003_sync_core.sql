CREATE TABLE "sync_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"job" jsonb NOT NULL,
	"error_code" text,
	"error_body" text,
	"attempt" integer NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "needs_reauth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "needs_reauth_reason" text;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "in_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "last_run_summary" jsonb;--> statement-breakpoint
ALTER TABLE "sync_failures" ADD CONSTRAINT "sync_failures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_failures_user_failed_at_idx" ON "sync_failures" USING btree ("user_id","failed_at");
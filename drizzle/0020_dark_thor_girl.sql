ALTER TABLE "users" ADD COLUMN "example_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "example_consent_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "example_consent_policy_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_example_at" timestamp with time zone;
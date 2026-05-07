ALTER TABLE "llm_calls" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "prompt_summary" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "raw_response" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "available_categories" text[];
ALTER TABLE "categories" ADD COLUMN "label_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "label_deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_label_unique" ON "categories" USING btree ("user_id","label_id") WHERE "categories"."label_id" IS NOT NULL;
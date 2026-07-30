ALTER TABLE "categories" DROP CONSTRAINT "categories_user_id_name_unique";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "rule_deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_id_name_unique" ON "categories" USING btree ("user_id","name") WHERE "categories"."rule_deleted_at" IS NULL;--> statement-breakpoint
-- One-shot data fix (not schema): drop the Stage-1 seed vectors of rules
-- whose backing Google label is already gone. `labelReconcile` stamps
-- `label_deleted_at` and `listRules` then hides the rule, but `knnByUser`
-- ranks `rule_seeds` with no join to `categories`, so those seeds kept
-- competing in the kNN pool forever — winning the top slot (the event then
-- degrades to the LLM leg because `lookupRuleRef` misses) or the second slot
-- (firing a spurious `ambiguous`). `label_deleted_at` is never auto-cleared
-- (부활 금지), so the seeds can never be needed again. Going forward the
-- purge happens at stamp time in `labelReconcile`.
DELETE FROM "rule_seeds" rs
  USING "categories" c
  WHERE rs."rule_id" = c."id" AND c."label_deleted_at" IS NOT NULL;

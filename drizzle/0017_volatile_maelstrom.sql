-- ADR-0004 #02 — rule_seeds (embedding kNN Stage-1 seed store).
--
-- VECTOR DIMENSION IS PROVISIONAL (ADR-0005, freeze deferred). vector(768)
-- tracks `EMBEDDING_DIM` in src/config/embedding.ts. The single-persona /
-- ko-only gold set lacks the power to freeze 768 vs 1024, so #02–#06 build on
-- gemma(768) but a multi-persona / multilingual gold set may flip it.
--
-- 768 → 1024 FLIP PROCEDURE (bounded, irreversible — all tenants, all langs):
--   1. Edit EMBEDDING_DIM (+ EMBEDDING_MODEL if the winner changes) in
--      src/config/embedding.ts.
--   2. New migration: `ALTER TABLE rule_seeds ALTER COLUMN embedding TYPE
--      vector(1024) USING NULL` is invalid (dim change is not a cast) — instead
--      `TRUNCATE rule_seeds` then `ALTER COLUMN embedding TYPE vector(1024)`.
--   3. Re-run the backfill job (scripts/backfill-seeds.ts) — idempotent, so the
--      truncate+backfill re-populates every name + keyword row under the new dim.
--   4. Rebuild the HNSW index (DROP + CREATE below) so it matches the new dim.
-- The prefix (src/config/embedding.ts EMBEDDING_PREFIX) is frozen and MUST
-- stay identical across backfill / create-update / sync title hot-path.

CREATE TABLE "rule_seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seed_type" text NOT NULL,
	"seed_text" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_seeds_seed_type_check" CHECK ("rule_seeds"."seed_type" IN ('name','keyword','example'))
);
--> statement-breakpoint
ALTER TABLE "rule_seeds" ADD CONSTRAINT "rule_seeds_rule_id_categories_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_seeds" ADD CONSTRAINT "rule_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_seeds_user_id_idx" ON "rule_seeds" USING btree ("user_id");--> statement-breakpoint
-- Hand-written (drizzle-kit cannot express these) — see drizzle/AGENTS.md
-- "Hand-written DDL" + src/db/schema.ts `ruleSeeds` note.
--
-- HNSW cosine index (ADR-0004 cosine contract). `vector_cosine_ops` matches
-- the `<=>` operator the Stage-1 kNN query uses. Rebuild on a dim flip.
CREATE INDEX "rule_seeds_embedding_hnsw_idx" ON "rule_seeds" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- Partial UNIQUE — at most one name seed per rule. Backs the name-seed
-- create-or-replace (`ON CONFLICT (rule_id) WHERE seed_type='name'`) so a
-- rule rename replaces (not duplicates) its name row. keyword/example rows
-- (#03/#05) are unconstrained (0..N per rule).
CREATE UNIQUE INDEX "rule_seeds_rule_id_name_uq" ON "rule_seeds" ("rule_id") WHERE "seed_type" = 'name';

#!/usr/bin/env tsx
/**
 * ADR-0004 #02 — one-shot name-seed backfill.
 *
 * Embeds every existing rule's `name` (all Declared) and upserts it into
 * `rule_seeds(seed_type='name')`, so the embedding-kNN Stage 1 has seeds for
 * rules created before this feature shipped.
 *
 * TRIGGER: operator runs it once from a workstation after deploying #02:
 *   pnpm tsx scripts/backfill-name-seeds.ts
 * It is ALSO the 768→1024 flip re-backfill step (see the header of
 * drizzle/0017_*.sql): after `TRUNCATE rule_seeds` + column ALTER, re-run this.
 *
 * IDEMPOTENT: upsert on the partial-unique `(rule_id) WHERE seed_type='name'`,
 * so re-running replaces each row's text + vector rather than duplicating.
 *
 * VERIFICATION: after the run, the count of `seed_type='name'` rows must equal
 * the rule (categories) count; the script asserts this and exits non-zero if not.
 *
 * PARITY: embeds via the Cloudflare Workers AI REST API using the SAME model +
 * frozen prefix as the Worker's `env.AI.run` path (src/config/embedding.ts).
 * Both hit the same Workers AI inference service; cosine (`<=>`) is
 * scale-invariant so vectors need no normalization to match the read path.
 * Rule names are user-authored, non-PII (OAuth-review-exempt, ADR-0004 #02).
 *
 * Reads DIRECT_DATABASE_URL + CF_ACCOUNT_ID + CF_API_TOKEN from .dev.vars —
 * same locality contract as the eval harness (never injected into the Worker).
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

import { EMBEDDING_MODEL, EMBEDDING_PREFIX } from "../src/config/embedding";

loadEnv({ path: ".dev.vars" });

const dbUrl = process.env["DIRECT_DATABASE_URL"];
const accountId = process.env["CF_ACCOUNT_ID"];
const apiToken = process.env["CF_API_TOKEN"];
if (!dbUrl) throw new Error("DIRECT_DATABASE_URL missing in .dev.vars");
if (!accountId || !apiToken) {
  throw new Error("CF_ACCOUNT_ID / CF_API_TOKEN missing in .dev.vars (Workers AI REST)");
}

const BATCH = 50;

async function embedNames(names: string[]): Promise<number[][]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: names.map((n) => EMBEDDING_PREFIX + n) }),
  });
  if (!res.ok) {
    throw new Error(`workers-ai REST ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { result?: { data?: number[][] } };
  const data = body.result?.data;
  if (!Array.isArray(data) || data.length !== names.length) {
    throw new Error(
      `workers-ai returned ${data?.length} vectors for ${names.length} names`,
    );
  }
  return data;
}

async function main(): Promise<void> {
  const sql = postgres(dbUrl as string, { prepare: false, idle_timeout: 5 });
  try {
    const rules = (await sql`
      SELECT id, user_id, name FROM categories ORDER BY created_at
    `) as unknown as Array<{ id: string; user_id: string; name: string }>;
    console.log(`categories to backfill: ${rules.length}`);

    let written = 0;
    for (let i = 0; i < rules.length; i += BATCH) {
      const chunk = rules.slice(i, i + BATCH);
      const vectors = await embedNames(chunk.map((r) => r.name));
      for (let j = 0; j < chunk.length; j += 1) {
        const r = chunk[j]!;
        const lit = `[${vectors[j]!.join(",")}]`;
        await sql`
          INSERT INTO rule_seeds (rule_id, user_id, seed_type, seed_text, embedding)
          VALUES (${r.id}, ${r.user_id}, 'name', ${r.name}, ${lit}::vector)
          ON CONFLICT (rule_id) WHERE seed_type = 'name'
          DO UPDATE SET seed_text = EXCLUDED.seed_text, embedding = EXCLUDED.embedding
        `;
        written += 1;
      }
      console.log(`embedded ${Math.min(i + BATCH, rules.length)}/${rules.length}`);
    }

    const seedRows = (await sql`
      SELECT count(*)::int AS count FROM rule_seeds WHERE seed_type = 'name'
    `) as unknown as Array<{ count: number }>;
    const ruleRows = (await sql`
      SELECT count(*)::int AS count FROM categories
    `) as unknown as Array<{ count: number }>;
    const seedCount = Number(seedRows[0]?.count ?? 0);
    const ruleCount = Number(ruleRows[0]?.count ?? 0);
    console.log(`written=${written} name_seeds=${seedCount} rules=${ruleCount}`);
    if (seedCount !== ruleCount) {
      throw new Error(
        `verification failed: ${seedCount} name seeds != ${ruleCount} rules`,
      );
    }
    console.log("✓ backfill verified");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

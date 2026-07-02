#!/usr/bin/env tsx
/**
 * ADR-0004 #02/#03 — one-shot seed backfill (name + keyword).
 *
 * Embeds every existing rule's `name` and its distinct `keywords` (all
 * Declared) and writes them into `rule_seeds`, so the embedding-kNN Stage 1
 * has seeds for rules created before this feature shipped.
 *
 * TRIGGER: operator runs it once from a workstation after deploying #02/#03:
 *   pnpm tsx scripts/backfill-seeds.ts
 * It is ALSO the 768→1024 flip re-backfill step (see the header of
 * drizzle/0017_*.sql): after `TRUNCATE rule_seeds` + column ALTER, re-run this.
 *
 * IDEMPOTENT:
 *   - name seeds upsert on the partial-unique `(rule_id) WHERE seed_type='name'`,
 *     so re-running replaces each row's text + vector rather than duplicating.
 *   - keyword seeds have no uniqueness (0..N per rule), so the job clears the
 *     keyword rows OF THE SNAPSHOT RULES, then re-inserts their current distinct
 *     set — a re-run converges to the same rows without duplicating.
 *
 * QUIESCE REQUIREMENT: this is a one-shot operator job that snapshots
 * `categories` at startup, embeds that snapshot (slow), then mutates seeds. It
 * assumes NO concurrent rule keyword writes during the run — run it at rollout
 * or inside the 768→1024 flip maintenance window (which TRUNCATEs first anyway),
 * not against a live write stream. The keyword clear is SCOPED to the snapshot's
 * `rule_id`s so a rule *created* mid-run keeps its runtime-written keyword seeds;
 * a concurrent *edit* to a snapshot rule can still be overwritten by the stale
 * snapshot value, and the count verification (against the stale snapshot) will
 * NOT detect it — hence the quiesce requirement rather than a runtime guard.
 *
 * EMBED-BEFORE-MUTATE (keyword phase): all keyword vectors are computed BEFORE
 * the clear + insert, so an embedding failure aborts the run with the existing
 * keyword seeds still in place.
 *
 * VERIFICATION: after the run,
 *   - `seed_type='name'` row count must equal the rule (categories) count, AND
 *   - `seed_type='keyword'` row count must equal Σ (distinct keyword count) over
 *     rules.
 * The script asserts both and exits non-zero on mismatch.
 *
 * PARITY: embeds via the Cloudflare Workers AI REST API using the SAME model +
 * frozen prefix as the Worker's `env.AI.run` path (src/config/embedding.ts).
 * Both hit the same Workers AI inference service; cosine (`<=>`) is
 * scale-invariant so vectors need no normalization to match the read path.
 * Rule names + keywords are user-authored, non-PII (OAuth-review-exempt,
 * ADR-0004 #02/#03).
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

// Normalizes a rule's raw keyword list to its durable seed set: trim, drop
// empties, dedupe. MUST match `dedupeNonEmpty` in src/services/ruleService.ts so
// the backfill and the runtime write path agree on the distinct keyword set
// (the verification below counts distinct keywords the same way).
function dedupeNonEmpty(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords ?? []) {
    const k = raw.trim();
    if (k.length === 0 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: texts.map((t) => EMBEDDING_PREFIX + t) }),
  });
  if (!res.ok) {
    throw new Error(`workers-ai REST ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { result?: { data?: number[][] } };
  const data = body.result?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error(
      `workers-ai returned ${data?.length} vectors for ${texts.length} texts`,
    );
  }
  return data;
}

// Embeds an arbitrary work list in fixed-size batches, preserving order.
async function embedAll(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    vectors.push(...(await embedTexts(chunk)));
    console.log(`embedded ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
  }
  return vectors;
}

type RuleRow = { id: string; user_id: string; name: string; keywords: string[] };

async function main(): Promise<void> {
  const sql = postgres(dbUrl as string, { prepare: false, idle_timeout: 5 });
  try {
    const rules = (await sql`
      SELECT id, user_id, name, keywords FROM categories ORDER BY created_at
    `) as unknown as RuleRow[];
    console.log(`categories to backfill: ${rules.length}`);

    // ── Name seeds (upsert on the partial-unique index) ──────────────────────
    console.log("— embedding names —");
    const nameVectors = await embedAll(rules.map((r) => r.name));
    for (let i = 0; i < rules.length; i += 1) {
      const r = rules[i]!;
      const lit = `[${nameVectors[i]!.join(",")}]`;
      await sql`
        INSERT INTO rule_seeds (rule_id, user_id, seed_type, seed_text, embedding)
        VALUES (${r.id}, ${r.user_id}, 'name', ${r.name}, ${lit}::vector)
        ON CONFLICT (rule_id) WHERE seed_type = 'name'
        DO UPDATE SET seed_text = EXCLUDED.seed_text, embedding = EXCLUDED.embedding
      `;
    }

    // ── Keyword seeds (embed-before-mutate: embed all, then clear + insert) ───
    console.log("— embedding keywords —");
    const kwItems: Array<{ ruleId: string; userId: string; text: string }> = [];
    for (const r of rules) {
      for (const kw of dedupeNonEmpty(r.keywords)) {
        kwItems.push({ ruleId: r.id, userId: r.user_id, text: kw });
      }
    }
    const kwVectors = await embedAll(kwItems.map((k) => k.text));
    // Idempotent replace, SCOPED to the snapshot's rules: every keyword seed row
    // is re-derived from the snapshot, so clearing then re-inserting converges
    // without duplicating. Scoping to `rule_id = ANY(snapshot)` avoids wiping the
    // keyword seeds of a rule created after the snapshot (see QUIESCE header).
    const snapshotRuleIds = rules.map((r) => r.id);
    await sql`
      DELETE FROM rule_seeds
      WHERE seed_type = 'keyword' AND rule_id = ANY(${snapshotRuleIds})
    `;
    for (let i = 0; i < kwItems.length; i += 1) {
      const it = kwItems[i]!;
      const lit = `[${kwVectors[i]!.join(",")}]`;
      await sql`
        INSERT INTO rule_seeds (rule_id, user_id, seed_type, seed_text, embedding)
        VALUES (${it.ruleId}, ${it.userId}, 'keyword', ${it.text}, ${lit}::vector)
      `;
    }

    // ── Verification ─────────────────────────────────────────────────────────
    const nameRows = (await sql`
      SELECT count(*)::int AS count FROM rule_seeds WHERE seed_type = 'name'
    `) as unknown as Array<{ count: number }>;
    const keywordRows = (await sql`
      SELECT count(*)::int AS count FROM rule_seeds WHERE seed_type = 'keyword'
    `) as unknown as Array<{ count: number }>;
    const ruleRows = (await sql`
      SELECT count(*)::int AS count FROM categories
    `) as unknown as Array<{ count: number }>;

    const nameCount = Number(nameRows[0]?.count ?? 0);
    const keywordCount = Number(keywordRows[0]?.count ?? 0);
    const ruleCount = Number(ruleRows[0]?.count ?? 0);
    const expectedKeywords = kwItems.length; // Σ distinct keywords per rule
    console.log(
      `names=${nameCount} rules=${ruleCount} keywords=${keywordCount} expected_keywords=${expectedKeywords}`,
    );
    if (nameCount !== ruleCount) {
      throw new Error(
        `verification failed: ${nameCount} name seeds != ${ruleCount} rules`,
      );
    }
    if (keywordCount !== expectedKeywords) {
      throw new Error(
        `verification failed: ${keywordCount} keyword seeds != ${expectedKeywords} distinct keywords`,
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

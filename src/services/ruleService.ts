import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { categories, ruleSeeds, syncState } from "../db/schema";
import type { Bindings } from "../env";
import { enqueueSync } from "../queues/syncProducer";
import { resolveEmbedder, type EmbedTexts } from "./embeddings";
import type { ConsentedExample } from "./piiRedactor";

// Rule aggregate module — single source of truth for the user-defined
// classification rule. The DB table is still named `categories` (and the
// public URL `/api/categories` likewise), but the domain language is `Rule`
// everywhere else (see `CONTEXT.md` "Flagged ambiguities").
//
// ADR-0004 (`docs/adr/0004-embedding-classifier.md`) replaces the Stage 1
// substring matcher with an embedding kNN classifier. This module is the
// prep seam: future work (rule_seeds table read, embedding job dispatch,
// trust grades, Instant Feedback) lands *inside* this module without
// touching its callers.

export type SeedType = "name" | "keyword" | "example";
export type SeedGrade = "verified" | "declared";

// One textual seed contributing to a Rule's meaning. ADR-0004 #02 promotes
// these to durable rows in `rule_seeds`; today they are synthesized at
// read time from the `categories.name` + `categories.keywords` columns.
export type Seed = {
  text: string;
  type: SeedType;
  grade: SeedGrade;
};

export type Rule = {
  id: string;
  userId: string;
  name: string;
  colorId: string;
  keywords: string[];
  priority: number;
  // ADR-0006 — Google event-label UUID this Rule writes (null = pre-cutover
  // rule, not yet attached to a label; sync skips applying it).
  labelId: string | null;
  // ADR-0006 — set when the backing Google label was deleted/unnamed. The
  // rule is excluded from classification (`listRules` default) but still
  // listed to the editor with a "라벨 삭제됨" badge. Never auto-cleared.
  labelDeletedAt: Date | null;
  seeds: Seed[];
  createdAt: Date;
  updatedAt: Date;
};

// Deprecated. Scheduled for removal once ADR-0004 #02 ships and the
// remaining external references to `Category` are dropped.
export type Category = Rule;

export type RuleCreateInput = {
  name: string;
  colorId: string;
  keywords: string[];
  priority?: number | undefined;
  // ADR-0006 (native-labels #03) — the Google event-label UUID the editor's
  // create flow minted via `appendEventLabel` before inserting the Rule.
  labelId?: string | undefined;
};

export type RuleUpdateInput = {
  name?: string | undefined;
  colorId?: string | undefined;
  keywords?: string[] | undefined;
  priority?: number | undefined;
};

export type RuleSideEffects = { sideEffects: Promise<void> };
export type RuleMutationResult = RuleSideEffects & { rule: Rule };

export class DuplicateRuleNameError extends Error {
  constructor() {
    super("duplicate rule name");
    this.name = "DuplicateRuleNameError";
  }
}

const UNIQUE_NAME_CONSTRAINT = "categories_user_id_name_unique";

function isDuplicateNameError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === UNIQUE_NAME_CONSTRAINT;
}

const SELECT_FIELDS = {
  id: categories.id,
  userId: categories.userId,
  name: categories.name,
  colorId: categories.colorId,
  keywords: categories.keywords,
  priority: categories.priority,
  labelId: categories.labelId,
  labelDeletedAt: categories.labelDeletedAt,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
} as const;

type CategoriesRow = {
  id: string;
  userId: string;
  name: string;
  colorId: string;
  keywords: string[];
  priority: number;
  labelId: string | null;
  labelDeletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// Convention: the rule's name yields one `name` seed; each keyword yields
// one `keyword` seed. Everything is `declared` because it originates from
// user typing — `verified` example seeds have no `categories` column and
// are merged from `rule_seeds` by `listRules` (ADR-0004 #05).
export function synthesizeSeeds(row: {
  name: string;
  keywords: string[];
}): Seed[] {
  const seeds: Seed[] = [
    { text: row.name, type: "name", grade: "declared" },
  ];
  for (const kw of row.keywords) {
    seeds.push({ text: kw, type: "keyword", grade: "declared" });
  }
  return seeds;
}

function toRule(row: CategoriesRow): Rule {
  return {
    ...row,
    seeds: synthesizeSeeds(row),
  };
}

// Default excludes label-deleted rules (ADR-0006) — the classifier paths
// (`calendarSync.loadCategories`, preview route) must never assign a rule
// whose backing Google label is gone. The editor list passes
// `includeLabelDeleted: true` to render them with a "라벨 삭제됨" badge.
export async function listRules(
  db: PostgresJsDatabase,
  userId: string,
  opts?: { includeLabelDeleted?: boolean },
): Promise<Rule[]> {
  const rows = await db
    .select(SELECT_FIELDS)
    .from(categories)
    .where(
      opts?.includeLabelDeleted
        ? eq(categories.userId, userId)
        : and(eq(categories.userId, userId), isNull(categories.labelDeletedAt)),
    )
    .orderBy(asc(categories.priority), asc(categories.createdAt));
  const rules = rows.map(toRule);

  // ADR-0004 #05 — example seeds are durable-only (`rule_seeds`, no
  // `categories` column), so merge them into `Rule.seeds` here. The one
  // consumer of example seeds on a `Rule` is the Stage-2 prompt builder's
  // `examples` field (`buildPrompt`); Stage-1 kNN reads `rule_seeds`
  // directly and never looks at `Rule.seeds`. Oldest-first (FIFO insert
  // order) so the prompt sees a stable ordering.
  const exampleRows = await db
    .select({
      ruleId: ruleSeeds.ruleId,
      seedText: ruleSeeds.seedText,
      createdAt: ruleSeeds.createdAt,
    })
    .from(ruleSeeds)
    .where(
      and(eq(ruleSeeds.userId, userId), eq(ruleSeeds.seedType, "example")),
    );
  if (exampleRows.length > 0) {
    exampleRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const byRule = new Map<string, Seed[]>();
    for (const r of exampleRows) {
      const list = byRule.get(r.ruleId) ?? [];
      list.push({ text: r.seedText, type: "example", grade: "verified" });
      byRule.set(r.ruleId, list);
    }
    for (const rule of rules) {
      const examples = byRule.get(rule.id);
      if (examples) rule.seeds.push(...examples);
    }
  }
  return rules;
}

export async function getRule(
  db: PostgresJsDatabase,
  userId: string,
  ruleId: string,
): Promise<Rule | null> {
  const rows = await db
    .select(SELECT_FIELDS)
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.id, ruleId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toRule(row);
}

async function listCalendarsForUser(
  db: PostgresJsDatabase,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ calendarId: syncState.calendarId })
    .from(syncState)
    .where(eq(syncState.userId, userId));
  return rows.map((r) => r.calendarId);
}

// Rule create / mutate fan-out. Webhook-driven incremental sync only sees
// events that were *just changed*, so a freshly-added rule never reaches
// the existing un-mutated events on a user's calendar. Full resync
// re-evaluates every event in the +365d/-30d window and lets `processEvent`
// apply the new rule (and re-color app-owned events when a rule's colorId
// changed). Same failure model as the §5 후속 B color_rollback fan-out:
// partial failures land in `console.error`, the user request still
// succeeds, recovery is a manual re-sync.
function fanOutFullResync(
  env: Bindings,
  userId: string,
  calendarIds: string[],
): Promise<void> {
  return Promise.allSettled(
    calendarIds.map((calendarId) =>
      enqueueSync(env, {
        type: "full_resync",
        userId,
        calendarId,
        reason: "manual",
        enqueuedAt: Date.now(),
      }),
    ),
  ).then((results) => {
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === "rejected") {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "full_resync enqueue failed (rule change)",
            userId,
            calendarId: calendarIds[i],
            error:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          }),
        );
      }
    }
  });
}

function fanOutColorRollback(
  env: Bindings,
  userId: string,
  ruleId: string,
  calendarIds: string[],
): Promise<void> {
  return Promise.allSettled(
    calendarIds.map((calendarId) =>
      enqueueSync(env, {
        type: "color_rollback",
        userId,
        calendarId,
        categoryId: ruleId,
        enqueuedAt: Date.now(),
      }),
    ),
  ).then((results) => {
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === "rejected") {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "color_rollback enqueue failed",
            userId,
            calendarId: calendarIds[i],
            categoryId: ruleId,
            error:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          }),
        );
      }
    }
  });
}

// ADR-0004 #02 — name-seed create-or-replace. Embeds the rule's name with
// the frozen prefix (enforced inside `embed`) and upserts the single
// `seed_type='name'` row (partial-unique `(rule_id) WHERE seed_type='name'`).
// Runs inside `RuleSideEffects.sideEffects` via `waitUntil`, so a failure
// follows the fan-out failure model: warn-only, the user request already
// succeeded, recovery is the next rule edit or the backfill job. A missing
// embedder (no `env.AI` binding — unit tests / misconfig) is a silent skip.
// Exported for `labelReconcile.ts` (ADR-0006): a Google-side label rename /
// named-label discovery re-seeds through this same single writer.
export async function writeNameSeed(
  db: PostgresJsDatabase,
  embed: EmbedTexts | undefined,
  args: { ruleId: string; userId: string; name: string },
): Promise<void> {
  if (!embed) return;
  try {
    const vectors = await embed([args.name]);
    const embedding = vectors[0];
    if (!embedding) throw new Error("empty embedding result");
    await db
      .insert(ruleSeeds)
      .values({
        ruleId: args.ruleId,
        userId: args.userId,
        seedType: "name",
        seedText: args.name,
        embedding,
      })
      .onConflictDoUpdate({
        target: ruleSeeds.ruleId,
        targetWhere: eq(ruleSeeds.seedType, "name"),
        set: { seedText: args.name, embedding },
      });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "name seed embedding failed",
        userId: args.userId,
        ruleId: args.ruleId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// Normalizes a raw keyword list to the durable seed set: trim, drop empties,
// dedupe (first occurrence wins). Mirrors the backfill's distinct-keyword
// verification (`keyword 행 수 == Σ rule 별 distinct keyword 수`), so the two
// write paths agree on what a rule's keyword seed set is.
function dedupeNonEmpty(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (k.length === 0 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// ADR-0004 #03 — pure keyword set diff. Unlike the single-row `name` seed
// (create-or-replace on the partial-unique index), a rule owns 0..N `keyword`
// seeds with no uniqueness, so a keyword edit is a set reconciliation, not a
// replace-all: only the delta is embedded/written. `unchanged` is returned for
// clarity but is deliberately never re-embedded or re-written (#02 "re-embed
// only when the text changes" discipline — the reason this is a diff).
export function computeKeywordDiff(
  existing: string[],
  incoming: string[],
): { toAdd: string[]; toRemove: string[]; unchanged: string[] } {
  const existingSet = new Set(existing);
  const next = dedupeNonEmpty(incoming);
  const nextSet = new Set(next);
  const toAdd = next.filter((k) => !existingSet.has(k));
  const toRemove = existing.filter((k) => !nextSet.has(k));
  const unchanged = next.filter((k) => existingSet.has(k));
  return { toAdd, toRemove, unchanged };
}

// ADR-0004 #03 — keyword-seed set reconciliation. Reconciles a rule's stored
// `seed_type='keyword'` rows against the incoming keyword list via an
// incremental diff (add / remove / unchanged), reusing the same `RuleSideEffects`
// seam + frozen-prefix `embedTexts` path as `writeNameSeed`.
//
// embed-before-mutate: the `toAdd` batch is embedded FIRST (one call, frozen
// prefix). Only after embedding succeeds are rows mutated — additions insert
// then removals delete (see the insert-before-delete rationale at the call
// site). An embedding failure is warn-only and leaves every existing keyword
// seed untouched (same fan-out failure model as `writeNameSeed`: the request
// already succeeded, recovery is the next edit or the backfill job). A missing
// embedder (no `env.AI` binding) is a silent skip.
//
// The delete is tenant-scoped (`user_id` predicate — RLS is bypassed on the
// Worker path, src/AGENTS.md "Tenant isolation") and restricted to this rule's
// keyword seeds and the exact `toRemove` texts. `keywords=[]` removes them all.
//
// Concurrency is eventually-consistent — the same posture as the #02 name-seed
// write: keyword rows have no uniqueness constraint, and two racing PATCHes'
// fire-and-forget reconciles can land out of order, so the seed set may
// transiently duplicate a keyword row or reflect an older edit than
// `categories.keywords` (recovery = next edit / backfill). Left unconstrained
// per ADR-0004 #03 AC #1 — no version-checking or locks.
async function reconcileKeywordSeeds(
  db: PostgresJsDatabase,
  embed: EmbedTexts | undefined,
  args: { ruleId: string; userId: string; keywords: string[] },
): Promise<void> {
  if (!embed) return;
  try {
    const existingRows = await db
      .select({ seedText: ruleSeeds.seedText })
      .from(ruleSeeds)
      .where(
        and(
          eq(ruleSeeds.ruleId, args.ruleId),
          eq(ruleSeeds.seedType, "keyword"),
        ),
      );
    const { toAdd, toRemove } = computeKeywordDiff(
      existingRows.map((r) => r.seedText),
      args.keywords,
    );
    if (toAdd.length === 0 && toRemove.length === 0) return;

    // embed-before-mutate — a failure here throws to the catch below with no
    // rows changed, preserving the existing keyword seeds.
    let vectors: number[][] = [];
    if (toAdd.length > 0) {
      vectors = await embed(toAdd);
      if (vectors.length !== toAdd.length) {
        throw new Error(
          `keyword embedding count mismatch: ${vectors.length} != ${toAdd.length}`,
        );
      }
    }

    // insert-before-delete: the insert and delete are separate, non-transactional
    // statements. Doing the additions FIRST means a mid-mutation DB failure (the
    // insert throws) degrades to a benign stale-EXTRA keyword — over-inclusive,
    // self-heals on the next edit/backfill — instead of losing the pre-existing
    // seed (under-inclusive data loss). `toAdd` and `toRemove` are disjoint
    // (toAdd = next − existing, toRemove = existing − next), so the order never
    // changes the success-case result.
    if (toAdd.length > 0) {
      await db.insert(ruleSeeds).values(
        toAdd.map((seedText, i) => ({
          ruleId: args.ruleId,
          userId: args.userId,
          seedType: "keyword",
          seedText,
          embedding: vectors[i]!,
        })),
      );
    }
    if (toRemove.length > 0) {
      await db
        .delete(ruleSeeds)
        .where(
          and(
            eq(ruleSeeds.ruleId, args.ruleId),
            eq(ruleSeeds.userId, args.userId),
            eq(ruleSeeds.seedType, "keyword"),
            inArray(ruleSeeds.seedText, toRemove),
          ),
        );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "keyword seed reconciliation failed",
        userId: args.userId,
        ruleId: args.ruleId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export async function createRule(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
  input: RuleCreateInput,
  embed?: EmbedTexts,
): Promise<RuleMutationResult> {
  let row: CategoriesRow;
  try {
    const inserted = await db
      .insert(categories)
      .values({
        userId,
        name: input.name,
        colorId: input.colorId,
        keywords: input.keywords,
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.labelId !== undefined ? { labelId: input.labelId } : {}),
      })
      .returning(SELECT_FIELDS);
    row = inserted[0]!;
  } catch (err) {
    if (isDuplicateNameError(err)) {
      throw new DuplicateRuleNameError();
    }
    throw err;
  }

  const embedder = embed ?? resolveEmbedder(env);
  const calendarIds = await listCalendarsForUser(db, userId);
  const fanOut =
    calendarIds.length > 0
      ? fanOutFullResync(env, userId, calendarIds)
      : Promise.resolve();
  const nameSeed = writeNameSeed(db, embedder, {
    ruleId: row.id,
    userId,
    name: row.name,
  });
  // ADR-0004 #03 — a fresh rule has no existing keyword seeds, so reconcile
  // treats every `input.keywords` entry as an add (one embed batch + insert).
  const keywordSeeds = reconcileKeywordSeeds(db, embedder, {
    ruleId: row.id,
    userId,
    keywords: input.keywords,
  });
  const sideEffects = Promise.all([fanOut, nameSeed, keywordSeeds]).then(
    () => undefined,
  );

  return { rule: toRule(row), sideEffects };
}

export async function updateRule(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
  ruleId: string,
  patch: RuleUpdateInput,
  embed?: EmbedTexts,
): Promise<RuleMutationResult | null> {
  const update: {
    name?: string;
    colorId?: string;
    keywords?: string[];
    priority?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.colorId !== undefined) update.colorId = patch.colorId;
  if (patch.keywords !== undefined) update.keywords = patch.keywords;
  if (patch.priority !== undefined) update.priority = patch.priority;

  let row: CategoriesRow | undefined;
  try {
    const updated = await db
      .update(categories)
      .set(update)
      .where(and(eq(categories.userId, userId), eq(categories.id, ruleId)))
      .returning(SELECT_FIELDS);
    row = updated[0];
  } catch (err) {
    if (isDuplicateNameError(err)) {
      throw new DuplicateRuleNameError();
    }
    throw err;
  }
  if (!row) return null;

  // Full-resync trigger — classification-affecting fields that need the
  // existing +365d/-30d window re-evaluated + Google API quota spent.
  // `priority` is the tiebreaker among matching rules. `name` is deliberately
  // NOT here: under ADR-0004 the name is now a Declared *seed*, so a rename
  // re-embeds that seed (below) but the reclassification of already-synced
  // events stays eventual (next incremental/triggered sync) — same posture as
  // before, and consistent with #02 AC "정합 with 기존 triggerSync". A rename
  // alone should not spend a full calendar re-evaluation.
  const triggerSync =
    patch.colorId !== undefined ||
    patch.keywords !== undefined ||
    patch.priority !== undefined;

  // ADR-0004 #02 — re-embed the name seed only when `name` is in the patch
  // (create-or-replace via `writeNameSeed`). colorId / priority-only changes
  // never touch the seed. Idempotent, so a no-op rename (same text) just
  // rewrites the same vector.
  const embedder = embed ?? resolveEmbedder(env);
  const tasks: Promise<void>[] = [];
  if (triggerSync) {
    const calendarIds = await listCalendarsForUser(db, userId);
    if (calendarIds.length > 0) {
      tasks.push(fanOutFullResync(env, userId, calendarIds));
    }
  }
  if (patch.name !== undefined) {
    tasks.push(
      writeNameSeed(db, embedder, { ruleId: row.id, userId, name: row.name }),
    );
  }
  // ADR-0004 #03 — reconcile keyword seeds only when the keywords are in the
  // patch (colorId/priority-only edits leave them untouched, mirroring the
  // name-seed re-embed discipline above). `row.keywords` is the updated set.
  if (patch.keywords !== undefined) {
    tasks.push(
      reconcileKeywordSeeds(db, embedder, {
        ruleId: row.id,
        userId,
        keywords: row.keywords,
      }),
    );
  }
  const sideEffects: Promise<void> =
    tasks.length > 0
      ? Promise.all(tasks).then(() => undefined)
      : Promise.resolve();

  return { rule: toRule(row), sideEffects };
}

export async function deleteRule(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
  ruleId: string,
): Promise<RuleSideEffects | null> {
  const deleted = await db
    .delete(categories)
    .where(and(eq(categories.userId, userId), eq(categories.id, ruleId)))
    .returning({ id: categories.id });
  if (deleted.length === 0) return null;

  // §5 후속 B — fan out per-calendar rollback jobs so events painted by
  // this rule revert to the calendar's default color. sync_state holds
  // every calendar we have ever synced for this user, including
  // deactivated rows — include them all because events painted before
  // deactivation still wear our marker.
  //
  // Failure model: enqueue writes the job into SYNC_QUEUE outside any
  // Postgres transaction, so a partial failure (e.g. queue binding
  // transient error on the 2nd of 3 calendars) leaves orphan markers.
  // We log explicitly so §6 observability can surface the rate, and the
  // route still returns 200 — re-deleting the same rule won't help (row
  // is gone), the recovery path is a future manual "resync cleanup" tool.
  const calendarIds = await listCalendarsForUser(db, userId);
  const sideEffects = fanOutColorRollback(env, userId, ruleId, calendarIds);

  return { sideEffects };
}

// ADR-0004 #05 — example lifecycle cap: at most 10 example seeds per rule;
// the 11th add evicts the oldest (FIFO on `created_at`). Exported for the
// lifecycle unit tests.
export const EXAMPLES_PER_RULE_CAP = 10;

// ADR-0004 #05 — Instant Feedback write outcome. Unlike the #02/#03 seed
// writes (fire-and-forget fan-out, warn-only), an example add is a direct
// user action: the Instant Feedback UI must be able to tell the user their
// correction did NOT stick, so an embedding failure surfaces as a soft
// failure instead of being swallowed.
export type AddExampleResult =
  | { stored: true }
  | { stored: false; reason: "embed_failed" };

// ADR-0004 #05 — Instant Feedback entry point (dark build: live write path,
// zero production callers until the OAuth-gated consent flow can mint a
// `ConsentReceipt`).
//
// §5.2 branded contract — accepts only `ConsentedExample`. The brand
// asserts the joint invariant "consented AND redacted", minted exclusively
// by `consentExample()` in `piiRedactor.ts`. A raw `(ruleId, title)` insert
// is unspellable at compile time. `example.ruleId` / `example.userId`
// already carry the target rule and tenant, so no separate args are needed.
//
// embed-before-mutate: the title is embedded via the frozen-prefix
// `embedTexts` FIRST; a failure (or a missing embedder — for a direct user
// action a silent skip would lie to the user) returns `embed_failed` with
// zero rows touched. Mutations then run in three steps:
//   1. last-write-wins move — delete this (redacted) title's example rows
//      anywhere in the tenant (`user_id` + `seed_type='example'` +
//      `seed_text` — RLS is bypassed on the Worker path, src/AGENTS.md
//      "Tenant isolation"), so a title is at most one rule's example
//      (CONTEXT.md). The deleted row is invalidated by the correction
//      itself, so delete-before-insert cannot lose data the user still
//      wants — a mid-mutation DB failure leaves the title example-less and
//      throws to the caller, which surfaces it.
//   2. insert the fresh `seed_type='example'` row (grade is derived at
//      read time — example ≡ verified, never stored).
//   3. FIFO cap — keep the newest `EXAMPLES_PER_RULE_CAP` example rows for
//      this rule; delete the oldest beyond the cap (seed row delete ≡ its
//      embedding dies with it).
export async function addExample(
  db: PostgresJsDatabase,
  embed: EmbedTexts | undefined,
  example: ConsentedExample,
): Promise<AddExampleResult> {
  let embedding: number[] | undefined;
  try {
    if (!embed) throw new Error("no embedder available");
    const vectors = await embed([example.text]);
    embedding = vectors[0];
    if (!embedding) throw new Error("empty embedding result");
  } catch (err) {
    // SECURITY: never log `example.text` (calendar content).
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "example embedding failed (correction not stored)",
        userId: example.userId,
        ruleId: example.ruleId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { stored: false, reason: "embed_failed" };
  }

  await db
    .delete(ruleSeeds)
    .where(
      and(
        eq(ruleSeeds.userId, example.userId),
        eq(ruleSeeds.seedType, "example"),
        eq(ruleSeeds.seedText, example.text),
      ),
    );

  await db.insert(ruleSeeds).values({
    ruleId: example.ruleId,
    userId: example.userId,
    seedType: "example",
    seedText: example.text,
    embedding,
  });

  const rows = await db
    .select({ id: ruleSeeds.id, createdAt: ruleSeeds.createdAt })
    .from(ruleSeeds)
    .where(
      and(
        eq(ruleSeeds.ruleId, example.ruleId),
        eq(ruleSeeds.userId, example.userId),
        eq(ruleSeeds.seedType, "example"),
      ),
    );
  if (rows.length > EXAMPLES_PER_RULE_CAP) {
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const excess = rows
      .slice(0, rows.length - EXAMPLES_PER_RULE_CAP)
      .map((r) => r.id);
    await db
      .delete(ruleSeeds)
      .where(
        and(eq(ruleSeeds.userId, example.userId), inArray(ruleSeeds.id, excess)),
      );
  }

  return { stored: true };
}

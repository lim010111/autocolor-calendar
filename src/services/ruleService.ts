import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { categories, syncState } from "../db/schema";
import type { Bindings } from "../env";
import { enqueueSync } from "../queues/syncProducer";
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
  createdAt: Date;
  updatedAt: Date;
};

// ADR-0004 #02 will replace this with a SELECT from `rule_seeds`. The
// shape and grade values are pinned now so the swap is local.
//
// Convention: the rule's name yields one `name` seed; each keyword yields
// one `keyword` seed. Everything is `declared` because it originates from
// user typing — `verified` seeds arrive only via Instant Feedback
// (ADR-0004 #05).
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

export async function listRules(
  db: PostgresJsDatabase,
  userId: string,
): Promise<Rule[]> {
  const rows = await db
    .select(SELECT_FIELDS)
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.priority), asc(categories.createdAt));
  return rows.map(toRule);
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

export async function createRule(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
  input: RuleCreateInput,
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
      })
      .returning(SELECT_FIELDS);
    row = inserted[0]!;
  } catch (err) {
    if (isDuplicateNameError(err)) {
      throw new DuplicateRuleNameError();
    }
    throw err;
  }

  const calendarIds = await listCalendarsForUser(db, userId);
  const sideEffects =
    calendarIds.length > 0
      ? fanOutFullResync(env, userId, calendarIds)
      : Promise.resolve();

  return { rule: toRule(row), sideEffects };
}

export async function updateRule(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
  ruleId: string,
  patch: RuleUpdateInput,
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

  // Classification-affecting fields only. `name` change is metadata and
  // does not alter the rule-keyword match or the per-event PATCH target,
  // so a typo-fix rename should not spend Google API quota on a full
  // calendar re-evaluation. `priority` is included because it is the
  // tiebreaker among multiple matching rules.
  const triggerSync =
    patch.colorId !== undefined ||
    patch.keywords !== undefined ||
    patch.priority !== undefined;

  let sideEffects: Promise<void> = Promise.resolve();
  if (triggerSync) {
    const calendarIds = await listCalendarsForUser(db, userId);
    if (calendarIds.length > 0) {
      sideEffects = fanOutFullResync(env, userId, calendarIds);
    }
  }

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
  // route still returns 204 — re-deleting the same rule won't help (row
  // is gone), the recovery path is a future manual "resync cleanup" tool.
  const calendarIds = await listCalendarsForUser(db, userId);
  const sideEffects = fanOutColorRollback(env, userId, ruleId, calendarIds);

  return { sideEffects };
}

// ADR-0004 #05 — Instant Feedback entry point. The signature is pinned
// now so the shape of `RuleService` stops drifting between this PR and
// the embedding-classifier wave; the body is a no-op resolve until the
// consent + rule_seeds insert + FIFO eviction logic lands.
//
// §5.2 branded contract — accepts only `ConsentedExample`. The brand
// asserts the joint invariant "consented AND redacted", minted exclusively
// by `consentExample()` in `piiRedactor.ts`. A raw `(ruleId, title)` insert
// is unspellable at compile time. The `_example.ruleId` already carries
// the target rule, so no separate `ruleId` arg is needed.
//
// Deliberately no-op rather than `throw`: a stray caller during the
// interim should fall through silently. Wiring this into a route is
// gated until #05.
export async function addExample(
  _db: PostgresJsDatabase,
  _example: ConsentedExample,
): Promise<void> {
  // intentionally no-op until ADR-0004 #05
}

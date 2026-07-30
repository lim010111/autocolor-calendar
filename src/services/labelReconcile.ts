import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { categories, ruleSeeds } from "../db/schema";
import type { EmbedTexts } from "./embeddings";
import { getCalendarLabelProperties } from "./googleCalendar";
import { writeNameSeed } from "./ruleService";

// ADR-0006 (native-labels #02) — labelProperties reconciliation. Google's
// `Calendars.labelProperties` is the CANONICAL store of label names/colors
// (Decision 2: A2); `categories` rows are classification settings attached
// to a label, with `name`/`colorId` as read-only caches. Once per sync run
// (the run's single extra fetch — subrequest budget note in src/AGENTS.md),
// this module folds Google-side edits back into our cache:
//
// - **rename**  → update the `categories.name` cache + re-embed the name
//   seed through `writeNameSeed` (the single canonical name-seed writer).
// - **recolor** → update the `categories.background_color` cache (+ the
//   legacy `colorId` nearest-match). Colors are canonical in Google exactly
//   like names, so a color edit there must reach the editor's swatch; this
//   is also the backfill path for rows written before the column existed.
// - **delete / un-name** → stamp `label_deleted_at`; the rule drops out of
//   classification (`listRules` default filter) and the editor shows a
//   "라벨 삭제됨" badge. **Never auto-cleared** — deleted rules do not
//   revive (Decision 4: 사용자 편집이 이긴다), so a stamped rule is skipped
//   even if its labelId reappears.
// - **new named label** → "출처 불문 동일 취급" (Decision 3): becomes a
//   Rule immediately. If a same-named rule exists with no labelId, LINK it
//   (the pairing the #04 cutover migration would make — prevents a
//   duplicate-name insert loop every run); otherwise INSERT a fresh rule
//   with keyword fallback `[name]` and a name seed. Unnamed labels (the 24
//   default palette slots) are never rules.
//
// **"New" is decided against tombstones, not against live rules.** A Rule
// deleted in the Add-on editor (`categories.rule_deleted_at`) keeps its row
// precisely so this module can tell "the user is done with this label" from
// "we have never seen this label". Reading only live rules made every
// editor deletion undo itself on the next sync run — the label survives the
// delete (label removal is Google's UI to own, Decision 3), so the create
// branch below saw a named label with no rule and re-created it seconds
// later, with `keywords` reset to `[name]`. Every branch here therefore
// checks `ruleDeletedAt` before it writes.
//
// Failure model: warn-only. A reconcile failure must never abort the sync
// run — classification proceeds on the cached rules (eventually consistent,
// same posture as the rule-mutation fan-out). Deliberately NO full_resync
// fan-out from in here: reconcile runs INSIDE a sync run and is ordered
// before `loadCategories`, so the current run already sees the changes;
// enqueueing more syncs from a sync would amplify.

// Classic 11 colorIds → the hex Calendar actually paints them today. These
// are the CURRENT UI values (each one is also a slot in the 24-color label
// palette — `gas/i18n.js` CLASSIC_COLOR_ID_HEX carries the same table), NOT
// the pastel values `colors.get` reports (`#a4bdfc`, `#e1e1e1`, …).
//
// Using the pastel values here was a real bug on two paths: the hex this
// table is compared against always arrives from the modern 24-color picker,
// so `nearestClassicColorId` was measuring distance across two different
// palettes (dark grey #616161 landed on basil green), and
// `scripts/cutover-labels-core.ts` writes a value FROM this table into a
// Google label's backgroundColor, which put pastel non-palette colors on
// cutover-created labels. Keep both sides in the modern palette.
//
// Used only to satisfy the legacy `colorId` CHECK ('1'..'11') — the value is
// a nearest-match cache, never a display source (that is `backgroundColor`).
// Removed with the #04 cutover.
export const CLASSIC_EVENT_COLOR_HEX: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Nearest classic colorId by RGB Euclidean distance. Unparseable/missing
// hex falls back to "8" (graphite) — a neutral cache value; the label's real
// color still renders from Google's side.
export function nearestClassicColorId(hex: string | undefined): string {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return "8";
  let bestId = "8";
  let bestDist = Infinity;
  for (const [id, classicHex] of Object.entries(CLASSIC_EVENT_COLOR_HEX)) {
    const c = hexToRgb(classicHex)!;
    const d =
      (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return bestId;
}

export type LabelReconcileSummary = {
  labels: number;
  renamed: number;
  recolored: number;
  deactivated: number;
  created: number;
  linked: number;
};

// Google's hex casing is not contractual; normalise so an equal color never
// looks like a drift (which would UPDATE on every single sync run).
function normalizeHex(hex: string | undefined | null): string | null {
  return hex ? hex.toLowerCase() : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

export async function reconcileLabels(args: {
  db: PostgresJsDatabase;
  userId: string;
  calendarId: string;
  accessToken: string;
  embed?: EmbedTexts | undefined;
}): Promise<void> {
  const { db, userId, calendarId, accessToken, embed } = args;
  const summary: LabelReconcileSummary = {
    labels: 0,
    renamed: 0,
    recolored: 0,
    deactivated: 0,
    created: 0,
    linked: 0,
  };
  try {
    // The sync run's single extra fetch (subrequest budget: +1 per run).
    const { eventLabels: labels } = await getCalendarLabelProperties(
      accessToken,
      calendarId,
    );
    summary.labels = labels.length;

    const rules = await db
      .select({
        id: categories.id,
        name: categories.name,
        backgroundColor: categories.backgroundColor,
        labelId: categories.labelId,
        labelDeletedAt: categories.labelDeletedAt,
        ruleDeletedAt: categories.ruleDeletedAt,
      })
      .from(categories)
      .where(eq(categories.userId, userId));

    // Tombstoned rows (user deleted the Rule in the editor) are read but
    // never acted on — see the `ruleDeletedAt` guards below. They are the
    // reason this SELECT has no `ruleDeletedAt IS NULL` filter: dropping
    // them here would make every branch treat the surviving Google label as
    // new and re-create the rule, which is the resurrection bug itself.
    const rulesByLabelId = new Map(
      rules.filter((r) => r.labelId !== null).map((r) => [r.labelId!, r]),
    );
    // Name lookups drive link/insert decisions, so they must see only LIVE
    // rules — a tombstone is not a link target. Its name is tracked
    // separately below.
    const rulesByName = new Map(
      rules.filter((r) => r.ruleDeletedAt === null).map((r) => [r.name, r]),
    );
    // Names of user-deleted rules, for the labelId-less case: a pre-cutover
    // tombstone has no labelId to match on, so without this a same-named
    // Google label would still resurrect it through the insert branch.
    const deletedRuleNames = new Set(
      rules.filter((r) => r.ruleDeletedAt !== null).map((r) => r.name),
    );
    const namedLabelIds = new Set<string>();

    for (const label of labels) {
      const name = label.name?.trim();
      if (!name) continue; // unnamed palette slot — never a rule
      namedLabelIds.add(label.id);

      const attached = rulesByLabelId.get(label.id);
      if (attached) {
        if (attached.labelDeletedAt !== null) continue; // 부활 금지
        // Same 부활 금지, other direction: the user deleted the Rule while
        // the label lives on. Skipping here is what makes editor deletion
        // stick — and it also stops the rename/recolor writes below from
        // silently maintaining a rule the user is done with.
        if (attached.ruleDeletedAt !== null) continue;

        // recolor: a separate UPDATE from the rename below on purpose — a
        // rename can hit the unique-name constraint, and a color edit must
        // not be lost to an unrelated name collision.
        const hex = normalizeHex(label.backgroundColor);
        if (hex !== null && hex !== normalizeHex(attached.backgroundColor)) {
          await db
            .update(categories)
            .set({
              backgroundColor: hex,
              // Keep the legacy nearest-classic cache consistent with the
              // color it approximates (removed with the #04 cutover).
              colorId: nearestClassicColorId(hex),
              updatedAt: sql`now()` as unknown as Date,
            })
            .where(
              and(eq(categories.userId, userId), eq(categories.id, attached.id)),
            );
          summary.recolored += 1;
        }

        if (attached.name === name) continue;
        // rename: cache + name-seed re-embed. A collision with another
        // rule's name (unique per user) is warn-skipped — the user resolves
        // it by renaming either side in Google.
        try {
          await db
            .update(categories)
            .set({ name, updatedAt: sql`now()` as unknown as Date })
            .where(
              and(eq(categories.userId, userId), eq(categories.id, attached.id)),
            );
          await writeNameSeed(db, embed, { ruleId: attached.id, userId, name });
          summary.renamed += 1;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          warnReconcile(userId, "rename collision — skipped", err);
        }
        continue;
      }

      // New named label with no attached rule.
      const sameName = rulesByName.get(name);
      if (sameName && sameName.labelId === null) {
        // Same-name pre-cutover rule → link (the #04 pairing, done early so
        // repeated runs don't warn-loop on a duplicate-name insert).
        // Adopt the label's color along with the linkage — from here on the
        // Google label is canonical for this rule (ADR-0006).
        const linkHex = normalizeHex(label.backgroundColor);
        await db
          .update(categories)
          .set({
            labelId: label.id,
            // ADR-0008 — written explicitly, never left to the column
            // default. This branch KNOWS the label was already in Google
            // when we found it, and that knowledge is exactly what the
            // deletion gate needs; the default is 'unknown' (= "we never
            // recorded it"), which would be a different, weaker claim.
            labelOrigin: "discovered",
            ...(linkHex !== null
              ? { backgroundColor: linkHex, colorId: nearestClassicColorId(linkHex) }
              : {}),
            updatedAt: sql`now()` as unknown as Date,
          })
          .where(
            and(eq(categories.userId, userId), eq(categories.id, sameName.id)),
          );
        summary.linked += 1;
        continue;
      }
      if (sameName) {
        // Same name already bound to a DIFFERENT label — ambiguous, leave
        // to the user (renaming either side resolves it).
        warnReconcile(userId, "duplicate name for new label — skipped");
        continue;
      }
      if (deletedRuleNames.has(name)) {
        // A user-deleted Rule carried this name and had no labelId to match
        // on (pre-cutover row). Inserting here would resurrect it under a
        // new uuid — the exact defect the tombstone exists to prevent.
        continue;
      }
      try {
        const inserted = await db
          .insert(categories)
          .values({
            userId,
            name,
            colorId: nearestClassicColorId(label.backgroundColor),
            backgroundColor: normalizeHex(label.backgroundColor),
            keywords: [name],
            labelId: label.id,
            // ADR-0008 — same as the link branch above: this label came
            // from Google, so the Add-on must never delete it.
            labelOrigin: "discovered",
          })
          .returning({ id: categories.id });
        const ruleId = inserted[0]?.id;
        if (ruleId) {
          await writeNameSeed(db, embed, { ruleId, userId, name });
          summary.created += 1;
        }
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Raced with a concurrent run (name or (user,label) unique) — the
        // winner already created it.
        warnReconcile(userId, "create raced — skipped", err);
      }
    }

    // Deactivate rules whose label vanished or lost its name.
    for (const rule of rules) {
      if (rule.labelId === null || rule.labelDeletedAt !== null) continue;
      // A user-deleted Rule is already out of classification; stamping it
      // again would only add a "라벨 삭제됨" reading to a row nobody renders.
      if (rule.ruleDeletedAt !== null) continue;
      if (namedLabelIds.has(rule.labelId)) continue;
      // Drop the seed vectors with the stamp. `knnByUser` ranks `rule_seeds`
      // with no join to `categories`, so a deactivated rule's seeds would
      // otherwise keep competing in the kNN pool forever — winning the top
      // slot (the event then degrades to the LLM leg, because
      // `lookupRuleRef` cannot find the rule in the filtered list) or the
      // second slot (firing a spurious `ambiguous`). `labelDeletedAt` is
      // never auto-cleared, so the seeds can never be needed again.
      //
      // **Purge BEFORE the stamp** — same discipline as the consent-revoke
      // purge (src/AGENTS.md "Example storage consent"), for the same
      // reason: there is no transaction here (reconcile is warn-only and
      // must never abort the sync run), so each statement autocommits. The
      // stamp is what makes the row skip this loop at the guard above, so
      // stamping first turns any purge failure into permanently orphaned
      // seeds — nothing revisits the row. In this order a failed purge
      // leaves the whole deactivation un-stamped and the next reconcile run
      // retries it; a failed stamp after a successful purge re-purges
      // (a no-op) and stamps. Both orders converge, only this one is
      // retryable.
      await db
        .delete(ruleSeeds)
        .where(
          and(eq(ruleSeeds.userId, userId), eq(ruleSeeds.ruleId, rule.id)),
        );
      await db
        .update(categories)
        .set({
          labelDeletedAt: sql`now()` as unknown as Date,
          updatedAt: sql`now()` as unknown as Date,
        })
        .where(and(eq(categories.userId, userId), eq(categories.id, rule.id)));
      summary.deactivated += 1;
    }

    if (
      summary.renamed +
        summary.recolored +
        summary.deactivated +
        summary.created +
        summary.linked >
      0
    ) {
      // Counters only — label/rule names are user content and stay out of
      // the log stream (same discipline as SyncSummary logging).
      console.log(
        JSON.stringify({ level: "info", msg: "label reconcile", ...summary }),
      );
    }
  } catch (err) {
    warnReconcile(userId, "label reconcile failed (sync proceeds on cache)", err);
  }
}

function warnReconcile(userId: string, msg: string, err?: unknown): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      msg: `[labelReconcile] ${msg}`,
      userId,
      ...(err !== undefined
        ? { error: err instanceof Error ? err.message : String(err) }
        : {}),
    }),
  );
}

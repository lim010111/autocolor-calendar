import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { categories } from "../db/schema";
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
      })
      .from(categories)
      .where(eq(categories.userId, userId));

    const rulesByLabelId = new Map(
      rules.filter((r) => r.labelId !== null).map((r) => [r.labelId!, r]),
    );
    const rulesByName = new Map(rules.map((r) => [r.name, r]));
    const namedLabelIds = new Set<string>();

    for (const label of labels) {
      const name = label.name?.trim();
      if (!name) continue; // unnamed palette slot — never a rule
      namedLabelIds.add(label.id);

      const attached = rulesByLabelId.get(label.id);
      if (attached) {
        if (attached.labelDeletedAt !== null) continue; // 부활 금지

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
      if (namedLabelIds.has(rule.labelId)) continue;
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

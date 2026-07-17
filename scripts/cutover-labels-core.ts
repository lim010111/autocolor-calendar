/**
 * native-labels #04 — cutover planning/apply core (pure, unit-tested).
 *
 * Separated from the CLI (`cutover-labels.ts`) so vitest can exercise the
 * link/append/skip decisions and the apply loop without a DB or Google API.
 * The CLI owns all I/O (env, postgres, token refresh, labelProperties reads)
 * and injects it here via `deps`.
 *
 * IDEMPOTENCY MODEL (re-run converges, never duplicates):
 *   1. Categories with `labelId` already set are excluded upstream (the CLI
 *      selects `label_id IS NULL` only), so a completed row is never redone.
 *   2. Before appending, a freshly-read `labelProperties` is matched by
 *      trimmed name — a half-finished prior run (label appended, DB link
 *      crashed) resolves to a LINK on re-run instead of a duplicate append.
 *      This is the same same-name pairing rule as `labelReconcile.ts`, so a
 *      concurrent sync's reconcile converges to the identical state.
 */
import { CALENDAR_EVENT_LABEL_CAP } from "../src/services/eventLabels";
import type { CalendarEventLabel } from "../src/services/googleCalendar";
import { CLASSIC_EVENT_COLOR_HEX } from "../src/services/labelReconcile";

// Google caps label names at 50 chars (API docs) while category names allow
// 100 (routes/categories.ts Zod) — over-long names are surfaced as skips for
// the operator to resolve (renames are Google-canonical, we never truncate).
export const LABEL_NAME_MAX = 50;

export type PendingCategory = { id: string; name: string; colorId: string };

export type CutoverSkipReason = "name_too_long" | "label_claimed";

export type CutoverPlan = {
  links: Array<{ categoryId: string; name: string; labelId: string }>;
  appends: Array<{ categoryId: string; name: string; backgroundColor: string }>;
  skips: Array<{ categoryId: string; name: string; reason: CutoverSkipReason }>;
  existingLabelCount: number;
  capExceeded: boolean;
};

export function planCutover(args: {
  labels: CalendarEventLabel[];
  pending: PendingCategory[];
  // labelIds already linked to ANY of the user's rules (including
  // label_deleted_at-stamped ones — the partial unique (user, labelId) index
  // covers them too, so linking a pending rule to such a label would 23505).
  claimedLabelIds: ReadonlySet<string>;
}): CutoverPlan {
  const { labels, pending, claimedLabelIds } = args;

  // First named label per trimmed name wins — deterministic on Google's
  // array order when the user has duplicate-named labels.
  const labelsByName = new Map<string, CalendarEventLabel>();
  for (const label of labels) {
    const name = label.name?.trim();
    if (!name || labelsByName.has(name)) continue;
    labelsByName.set(name, label);
  }

  const plan: CutoverPlan = {
    links: [],
    appends: [],
    skips: [],
    existingLabelCount: labels.length,
    capExceeded: false,
  };

  for (const cat of pending) {
    const name = cat.name.trim();
    const existing = labelsByName.get(name);
    if (existing) {
      if (claimedLabelIds.has(existing.id)) {
        // Same-name label already linked to a different rule — ambiguous
        // (e.g. a Google-side rename collision left a stale cache name).
        // Operator resolves; never auto-append a duplicate-named label.
        plan.skips.push({ categoryId: cat.id, name, reason: "label_claimed" });
      } else {
        plan.links.push({ categoryId: cat.id, name, labelId: existing.id });
      }
      continue;
    }
    if (name.length > LABEL_NAME_MAX) {
      plan.skips.push({ categoryId: cat.id, name, reason: "name_too_long" });
      continue;
    }
    // colorId is CHECK-constrained to '1'..'11'; the graphite fallback
    // mirrors `nearestClassicColorId`'s neutral default and only fires if
    // that invariant is somehow violated.
    const backgroundColor =
      CLASSIC_EVENT_COLOR_HEX[cat.colorId] ?? CLASSIC_EVENT_COLOR_HEX["8"] ?? "#e1e1e1";
    plan.appends.push({ categoryId: cat.id, name, backgroundColor });
  }

  plan.capExceeded =
    plan.existingLabelCount + plan.appends.length > CALENDAR_EVENT_LABEL_CAP;
  return plan;
}

export type ApplyResult = {
  linked: number;
  appended: number;
  // A pre-planned link UPDATE that hit 0 rows: the row was linked
  // concurrently (e.g. a sync run's reconcile paired it first). Converged —
  // warn-only. A post-append 0-row link is NOT counted here — it orphans the
  // just-minted Google label and lands in `failures` instead.
  linkMissed: number;
  appendsSkippedForCap: number;
  failures: Array<{ categoryId: string; name: string; error: string }>;
};

// Executes one user's plan. Links first (label-count-neutral, safe even when
// the cap is exceeded), then appends — each append immediately links the
// minted labelId so a crash window leaves at most one label recoverable by
// the re-run's same-name link. Item failures are isolated: one bad append
// never blocks the rest.
export async function applyUserPlan(
  plan: CutoverPlan,
  deps: {
    appendLabel: (input: {
      name: string;
      backgroundColor: string;
    }) => Promise<{ id: string }>;
    linkCategory: (categoryId: string, labelId: string) => Promise<boolean>;
  },
): Promise<ApplyResult> {
  const result: ApplyResult = {
    linked: 0,
    appended: 0,
    linkMissed: 0,
    appendsSkippedForCap: 0,
    failures: [],
  };

  for (const link of plan.links) {
    try {
      if (await deps.linkCategory(link.categoryId, link.labelId)) {
        result.linked += 1;
      } else {
        result.linkMissed += 1;
      }
    } catch (err) {
      result.failures.push({
        categoryId: link.categoryId,
        name: link.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (plan.capExceeded) {
    // Pre-checked cap: appending would push the calendar past 200 labels —
    // hold ALL appends for this user (no partial fill) and surface it.
    result.appendsSkippedForCap = plan.appends.length;
    return result;
  }

  for (const append of plan.appends) {
    try {
      const { id } = await deps.appendLabel({
        name: append.name,
        backgroundColor: append.backgroundColor,
      });
      result.appended += 1;
      if (await deps.linkCategory(append.categoryId, id)) {
        result.linked += 1;
      } else {
        // 0 rows AFTER a real append: a concurrent writer linked the row
        // between plan and apply, so the label minted above is now an orphan
        // on the user's calendar (duplicate name, consumes the 200-label
        // cap). Must surface as a failure — folding it into `linkMissed`
        // would let remaining-count verification read clean.
        result.failures.push({
          categoryId: append.categoryId,
          name: append.name,
          error: `post-append link hit 0 rows — minted label ${id} is orphaned (row linked concurrently); delete the duplicate label or relink manually`,
        });
      }
    } catch (err) {
      result.failures.push({
        categoryId: append.categoryId,
        name: append.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

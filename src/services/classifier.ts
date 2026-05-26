import type { RuleRef } from "./classifierOutcomes";
import type { CalendarEvent } from "./googleCalendar";
import type { Rule } from "./ruleService";

export type ClassifyContext = {
  userId: string;
  categories: Rule[];
};

// Stage 1 substring hit shape — just the rule + matched keyword. The chain
// wraps this into a `ClassificationOutcome.ruleHit`; leg identity is now
// the outcome's `kind`, not a `reason: "rule_match:..."` string.
export type RuleHit = { rule: RuleRef; matchedKeyword: string };

// §5.1 rule-based matching (Step 1).
//
// Contract:
// - `ctx.categories` is assumed pre-sorted by (priority ASC, created_at ASC)
//   at load time (`calendarSync.ts:loadCategories`). The classifier trusts
//   that ordering; callers must not shuffle the array after loading.
// - Case-insensitive substring match against summary + "\n" + (description ?? "").
//   Korean morphology makes word-boundary matching unreliable, so substring
//   is the deliberate default. `attendees` and `location` are excluded here —
//   PII redaction (§5.2 `piiRedactor.ts`) is only required on the LLM
//   fallback path (§5.3), not on this rule-based path which matches raw
//   user-authored keywords.
// - First keyword hit in the first matching category wins. Remaining
//   categories are not consulted.
// - Returns null on no match. Never throws.
export async function classifyEvent(
  event: CalendarEvent,
  ctx: ClassifyContext,
): Promise<RuleHit | null> {
  if (ctx.categories.length === 0) return null;

  const summary = event.summary ?? "";
  const description = event.description ?? "";
  if (summary.length === 0 && description.length === 0) return null;

  const haystack = `${summary}\n${description}`.toLowerCase();

  for (const cat of ctx.categories) {
    for (const kw of cat.keywords) {
      const needle = kw.toLowerCase();
      if (needle.length === 0) continue;
      if (haystack.includes(needle)) {
        return {
          rule: { id: cat.id, name: cat.name, colorId: cat.colorId },
          matchedKeyword: kw,
        };
      }
    }
  }
  return null;
}

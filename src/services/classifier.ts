import type { CalendarEvent } from "./googleCalendar";

export type Category = {
  id: string;
  name: string;
  colorId: string;
  keywords: string[];
  priority: number;
};

export type ClassifyContext = {
  userId: string;
  categories: Category[];
};

export type Classification = {
  colorId: string;
  categoryId: string;
  reason: string;
  // Populated only on rule-based hits. The specific user-authored keyword
  // whose substring matched — surfaced through the preview endpoint so the
  // sidebar can show "키워드: <kw>". LLM hits leave this undefined (the LLM
  // reasons about category, not per-keyword evidence).
  matchedKeyword?: string;
};

export type ClassifyEventFn = (
  event: CalendarEvent,
  ctx: ClassifyContext,
) => Promise<Classification | null>;

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
export const classifyEvent: ClassifyEventFn = async (event, ctx) => {
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
          colorId: cat.colorId,
          categoryId: cat.id,
          reason: `rule_match:${kw}`,
          matchedKeyword: kw,
        };
      }
    }
  }
  return null;
};

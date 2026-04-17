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
};

// §4A: stub. §5 replaces with rule → embedding → LLM classification chain.
export type ClassifyEventFn = (
  event: CalendarEvent,
  ctx: ClassifyContext,
) => Promise<Classification | null>;

export const classifyEvent: ClassifyEventFn = async () => null;

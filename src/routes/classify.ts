import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import { categories } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { classifyEvent } from "../services/classifier";

export const classifyRoutes = new Hono<HonoEnv>();

classifyRoutes.use("*", authMiddleware);

const PreviewBody = z.object({
  summary: z.string().trim().min(1).max(1024),
  description: z.string().max(8000).optional(),
  location: z.string().max(1024).optional(),
});

// §5 후속 A — sidebar classify preview.
//
// Rule-only on purpose. The LLM leg is intentionally NOT invoked from this
// endpoint: a sidebar open should return in <300ms, and the LLM path (5s
// timeout + per-user `LLM_DAILY_LIMIT`) would burn quota on every event the
// user merely looks at. When the rule misses, we surface `llmAvailable` so
// the caller can render "다음 동기화 시 AI 분류 시도" — the actual LLM
// classification happens later in the sync pipeline (`classifierChain.ts`),
// not here.
classifyRoutes.post("/preview", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = PreviewBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }

  const llmAvailable = !!c.env.OPENAI_API_KEY;
  const { db, close } = getDb(c.env);
  try {
    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        colorId: categories.colorId,
        keywords: categories.keywords,
        priority: categories.priority,
      })
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.priority), asc(categories.createdAt));

    // Zero-category short-circuit: skip classifyEvent's internal category
    // loop (guaranteed no-op) and return immediately so tests don't need to
    // mock the classifier.
    if (rows.length === 0) {
      return c.json({ source: "no_match" as const, llmAvailable });
    }

    const classification = await classifyEvent(
      {
        id: "preview",
        summary: parsed.data.summary,
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
        ...(parsed.data.location !== undefined
          ? { location: parsed.data.location }
          : {}),
      },
      { userId, categories: rows },
    );

    if (!classification) {
      return c.json({ source: "no_match" as const, llmAvailable });
    }

    const matched = rows.find((r) => r.id === classification.categoryId);
    return c.json({
      source: "rule" as const,
      category: matched
        ? { id: matched.id, name: matched.name, colorId: matched.colorId }
        : {
            id: classification.categoryId,
            name: "",
            colorId: classification.colorId,
          },
      ...(classification.matchedKeyword !== undefined
        ? { matchedKeyword: classification.matchedKeyword }
        : {}),
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

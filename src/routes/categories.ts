import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import { categories, syncState } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { enqueueSync } from "../queues/syncProducer";

export const categoriesRoutes = new Hono<HonoEnv>();

categoriesRoutes.use("*", authMiddleware);

const ColorIdSchema = z.enum([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
]);
const KeywordsSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(10);

const CreateBody = z.object({
  name: z.string().trim().min(1).max(100),
  colorId: ColorIdSchema,
  keywords: KeywordsSchema,
  priority: z.number().int().min(0).max(10000).optional(),
});

const PatchBody = CreateBody.partial();
const UuidParam = z.string().uuid();

const SELECT_FIELDS = {
  id: categories.id,
  name: categories.name,
  colorId: categories.colorId,
  keywords: categories.keywords,
  priority: categories.priority,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
} as const;

const UNIQUE_NAME_CONSTRAINT = "categories_user_id_name_unique";

function isDuplicateNameError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === UNIQUE_NAME_CONSTRAINT;
}

categoriesRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const rows = await db
      .select(SELECT_FIELDS)
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.priority), asc(categories.createdAt));
    return c.json({ categories: rows });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

categoriesRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }

  const { db, close } = getDb(c.env);
  try {
    const [row] = await db
      .insert(categories)
      .values({
        userId,
        name: parsed.data.name,
        colorId: parsed.data.colorId,
        keywords: parsed.data.keywords,
        ...(parsed.data.priority !== undefined
          ? { priority: parsed.data.priority }
          : {}),
      })
      .returning(SELECT_FIELDS);
    return c.json({ category: row }, 201);
  } catch (err) {
    if (isDuplicateNameError(err)) {
      return c.json({ error: "duplicate_name" }, 409);
    }
    throw err;
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

categoriesRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const idParse = UuidParam.safeParse(c.req.param("id"));
  if (!idParse.success) return c.json({ error: "invalid_id" }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: "empty_patch" }, 400);
  }

  const patch: {
    name?: string;
    colorId?: string;
    keywords?: string[];
    priority?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.colorId !== undefined) patch.colorId = parsed.data.colorId;
  if (parsed.data.keywords !== undefined) patch.keywords = parsed.data.keywords;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;

  const { db, close } = getDb(c.env);
  try {
    const updated = await db
      .update(categories)
      .set(patch)
      .where(and(eq(categories.userId, userId), eq(categories.id, idParse.data)))
      .returning(SELECT_FIELDS);
    if (updated.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ category: updated[0] });
  } catch (err) {
    if (isDuplicateNameError(err)) {
      return c.json({ error: "duplicate_name" }, 409);
    }
    throw err;
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

categoriesRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const idParse = UuidParam.safeParse(c.req.param("id"));
  if (!idParse.success) return c.json({ error: "invalid_id" }, 400);

  const { db, close } = getDb(c.env);
  try {
    const deleted = await db
      .delete(categories)
      .where(and(eq(categories.userId, userId), eq(categories.id, idParse.data)))
      .returning({ id: categories.id });
    if (deleted.length === 0) return c.json({ error: "not_found" }, 404);

    // §5 후속 B — fan out per-calendar rollback jobs so events painted by
    // this category revert to the calendar's default color. sync_state
    // holds every calendar we have ever synced for this user, including
    // deactivated rows — include them all because events painted before
    // deactivation still wear our marker.
    //
    // Failure model: enqueue writes the job into SYNC_QUEUE outside any
    // Postgres transaction, so a partial failure (e.g. queue binding
    // transient error on the 2nd of 3 calendars) leaves orphan markers.
    // We log explicitly so §6 observability can surface the rate, and
    // still return 204 — re-deleting the same category won't help (row is
    // gone), the recovery path is a future manual "resync cleanup" tool.
    const calendars = await db
      .select({ calendarId: syncState.calendarId })
      .from(syncState)
      .where(eq(syncState.userId, userId));

    const enqueuePromise = Promise.allSettled(
      calendars.map((row) =>
        enqueueSync(c.env, {
          type: "color_rollback",
          userId,
          calendarId: row.calendarId,
          categoryId: idParse.data,
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
              calendarId: calendars[i]!.calendarId,
              categoryId: idParse.data,
              error:
                r.reason instanceof Error ? r.reason.message : String(r.reason),
            }),
          );
        }
      }
    });
    c.executionCtx.waitUntil(enqueuePromise);

    return c.body(null, 204);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

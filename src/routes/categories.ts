import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import {
  createRule,
  deleteRule,
  DuplicateRuleNameError,
  listRules,
  updateRule,
  type Rule,
} from "../services/ruleService";

// Thin Hono adapter over `ruleService`. The URL path `/api/categories` and
// the wire JSON shape (`{ id, name, colorId, keywords, priority, createdAt,
// updatedAt }`) are preserved for GAS Add-on compatibility — see
// `CONTEXT.md` "Flagged ambiguities" for why the DB/wire stays
// `categories` while the domain language is `Rule`.

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

// Wire projection — drops `seeds` and `userId` from the aggregate so the
// public shape stays unchanged across this PR. ADR-0004 #02 will flip this
// to include seeds.
function toWire(rule: Rule) {
  return {
    id: rule.id,
    name: rule.name,
    colorId: rule.colorId,
    keywords: rule.keywords,
    priority: rule.priority,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

categoriesRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const rules = await listRules(db, userId);
    return c.json({ categories: rules.map(toWire) });
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
    const { rule, sideEffects } = await createRule(
      db,
      c.env,
      userId,
      parsed.data,
    );
    c.executionCtx.waitUntil(sideEffects);
    return c.json({ category: toWire(rule) }, 201);
  } catch (err) {
    if (err instanceof DuplicateRuleNameError) {
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

  const { db, close } = getDb(c.env);
  try {
    const result = await updateRule(
      db,
      c.env,
      userId,
      idParse.data,
      parsed.data,
    );
    if (!result) return c.json({ error: "not_found" }, 404);
    c.executionCtx.waitUntil(result.sideEffects);
    return c.json({ category: toWire(result.rule) });
  } catch (err) {
    if (err instanceof DuplicateRuleNameError) {
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
    const result = await deleteRule(db, c.env, userId, idParse.data);
    if (!result) return c.json({ error: "not_found" }, 404);
    c.executionCtx.waitUntil(result.sideEffects);
    return c.body(null, 204);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

import { createMiddleware } from "hono/factory";

import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { verifySession } from "../services/sessionService";

export const authMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = header.slice(7).trim();
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const { db, close } = getDb(c.env);
  try {
    const session = await verifySession(db, c.env.SESSION_PEPPER, token);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", session.userId);
    c.set("email", session.email);
    await next();
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

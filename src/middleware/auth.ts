import { createMiddleware } from "hono/factory";

import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { parseBearerToken } from "../lib/bearer";
import { verifySession } from "../services/sessionService";

export const authMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const token = parseBearerToken(c.req.header("authorization"));
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const { db, close } = getDb(c.env);
  try {
    const session = await verifySession(
      db,
      c.env.SESSION_PEPPER,
      token,
      c.executionCtx,
    );
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", session.userId);
    c.set("email", session.email);
    await next();
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

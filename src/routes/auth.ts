import { Hono } from "hono";

import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { revokeSession } from "../services/sessionService";

export const authRoutes = new Hono<HonoEnv>();

authRoutes.post("/logout", async (c) => {
  const header = c.req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = header.slice(7).trim();
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const { db, close } = getDb(c.env);
  try {
    await revokeSession(db, c.env.SESSION_PEPPER, token);
    return c.json({ ok: true });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

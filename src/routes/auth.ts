import { Hono } from "hono";

import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { parseBearerToken } from "../lib/bearer";
import { revokeSession } from "../services/sessionService";

export const authRoutes = new Hono<HonoEnv>();

authRoutes.post("/logout", async (c) => {
  const token = parseBearerToken(c.req.header("authorization"));
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const { db, close } = getDb(c.env);
  try {
    await revokeSession(db, c.env.SESSION_PEPPER, token);
    return c.json({ ok: true });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

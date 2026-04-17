import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db";
import type { Bindings } from "../env";

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

healthRoutes.get("/healthz", (c) => c.json({ ok: true, env: c.env.ENV }));

// Temporary smoke route. Local `wrangler dev` may fail with TLS cert-chain
// errors against Supabase (workerd ships a limited CA bundle); verify via
// deployed dev Worker instead. Removed after Step 4 migration verification.
healthRoutes.get("/db-ping", async (c) => {
  const { db, close } = getDb(c.env);
  try {
    const rows = await db.execute<{ ok: number }>(sql`select 1 as ok`);
    const first = Array.isArray(rows) ? rows[0] : undefined;
    return c.json({ ok: first?.ok === 1 });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

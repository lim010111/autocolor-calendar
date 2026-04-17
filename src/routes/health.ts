import { Hono } from "hono";

import type { Bindings } from "../env";

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

healthRoutes.get("/healthz", (c) => c.json({ ok: true, env: c.env.ENV }));

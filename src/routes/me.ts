import { Hono } from "hono";

import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";

export const meRoutes = new Hono<HonoEnv>();

meRoutes.use("*", authMiddleware);

meRoutes.get("/", (c) =>
  c.json({
    userId: c.get("userId"),
    email: c.get("email"),
    needs_reauth: false,
  }),
);

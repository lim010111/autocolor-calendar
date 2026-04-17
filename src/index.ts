import { Hono } from "hono";

import type { Bindings } from "./env";
import { healthRoutes } from "./routes/health";

const app = new Hono<{ Bindings: Bindings }>();

app.route("/", healthRoutes);

export default app;

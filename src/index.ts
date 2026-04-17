import { Hono } from "hono";

import type { HonoEnv } from "./env";
import { errorHandler } from "./middleware/errorHandler";
import { loggerMiddleware } from "./middleware/logger";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { oauthRoutes } from "./routes/oauth";

const app = new Hono<HonoEnv>();

app.use("*", loggerMiddleware);
app.onError(errorHandler);

app.route("/", healthRoutes);
app.route("/oauth", oauthRoutes);
app.route("/auth", authRoutes);
app.route("/me", meRoutes);

export default app;

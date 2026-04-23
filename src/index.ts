import { Hono } from "hono";

import { getDb } from "./db";
import type { Bindings, HonoEnv } from "./env";
import { errorHandler } from "./middleware/errorHandler";
import { loggerMiddleware } from "./middleware/logger";
import { handleDlqBatch } from "./queues/dlqConsumer";
import { handleSyncBatch } from "./queues/syncConsumer";
import type { SyncJob } from "./queues/types";
import { authRoutes } from "./routes/auth";
import { categoriesRoutes } from "./routes/categories";
import { classifyRoutes } from "./routes/classify";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { oauthRoutes } from "./routes/oauth";
import { statsRoutes } from "./routes/stats";
import { syncRoutes } from "./routes/sync";
import { webhookRoutes } from "./routes/webhooks";
import { renewExpiringWatches } from "./services/watchRenewal";

const app = new Hono<HonoEnv>();

app.use("*", loggerMiddleware);
app.onError(errorHandler);

app.route("/", healthRoutes);
app.route("/oauth", oauthRoutes);
app.route("/auth", authRoutes);
app.route("/me", meRoutes);
app.route("/sync", syncRoutes);
app.route("/webhooks", webhookRoutes);
app.route("/api/categories", categoriesRoutes);
app.route("/api/classify", classifyRoutes);
app.route("/api/stats", statsRoutes);

export default {
  fetch: app.fetch,
  async queue(
    batch: MessageBatch<SyncJob>,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Route by queue name — Workers dispatches the same `queue` handler for
    // every consumer binding defined in wrangler.toml.
    if (batch.queue.includes("dlq")) {
      await handleDlqBatch(batch, env, ctx);
    } else {
      await handleSyncBatch(batch, env, ctx);
    }
  },
  async scheduled(
    _event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Single cron trigger today (`watch-renewal` via [env.dev.triggers] in
    // wrangler.toml). If more crons are added, branch on _event.cron.
    //
    // Skip before getDb when WEBHOOK_BASE_URL is unset — dev shells without
    // a verified custom domain would otherwise pay a Hyperdrive handshake
    // every 6h for a guaranteed no-op. renewExpiringWatches keeps the same
    // check as defense-in-depth for direct callers (tests, future scripts).
    if (!env.WEBHOOK_BASE_URL) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "watch renewal skipped — WEBHOOK_BASE_URL not configured",
        }),
      );
      return;
    }
    const { db, close } = getDb(env);
    ctx.waitUntil(
      renewExpiringWatches(db, env).finally(() => close()),
    );
  },
};
export { app };

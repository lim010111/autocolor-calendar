import { Hono } from "hono";

import { getDb } from "./db";
import type { Bindings, HonoEnv } from "./env";
import { errorHandler } from "./middleware/errorHandler";
import { loggerMiddleware } from "./middleware/logger";
import { handleDlqBatch } from "./queues/dlqConsumer";
import { handleSyncBatch } from "./queues/syncConsumer";
import type { SyncJob } from "./queues/types";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth";
import { categoriesRoutes } from "./routes/categories";
import { classifyRoutes } from "./routes/classify";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { oauthRoutes } from "./routes/oauth";
import { statsRoutes } from "./routes/stats";
import { syncRoutes } from "./routes/sync";
import { webhookRoutes } from "./routes/webhooks";
import { rotateBatch } from "./services/tokenRotation";
import { renewExpiringWatches } from "./services/watchRenewal";

// §3 후속 — cron strings MUST stay in lockstep with `wrangler.toml`
// `[env.dev.triggers].crons`. The dispatcher in `scheduled()` routes by
// exact-string equality on `event.cron`; renaming or re-ordering these
// without touching `wrangler.toml` (or vice versa) lands us in the
// "unknown cron schedule" warn branch and the job silently no-ops.
const WATCH_RENEWAL_CRON = "0 */6 * * *";
const TOKEN_ROTATION_CRON = "0 3 * * *";

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
app.route("/api/account", accountRoutes);

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
    event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    // §3 후속 — cron dispatch by `event.cron`. Two schedules registered in
    // `wrangler.toml` `[env.dev.triggers].crons`:
    //   - WATCH_RENEWAL_CRON ("0 */6 * * *") → renewExpiringWatches
    //   - TOKEN_ROTATION_CRON ("0 3 * * *")   → rotateBatch (TOKEN_ENCRYPTION_KEY)
    // Cloudflare delivers each schedule as a separate `scheduled()`
    // invocation with a distinct `event.cron`, so we never need to handle
    // both within a single call. We defer `getDb` until AFTER the dispatch
    // decision so no-op branches (renewal-skip on dev shells without
    // WEBHOOK_BASE_URL, unknown-cron warn) don't pay a Hyperdrive
    // handshake. Each branch owns its own DB lifetime via
    // `.finally(() => close())`.
    if (event.cron === WATCH_RENEWAL_CRON) {
      if (!env.WEBHOOK_BASE_URL) {
        // Dev shell w/o verified custom domain — Watch API rejects
        // workers.dev origins, so skip before paying the handshake. The
        // service keeps the same check as defense-in-depth.
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
        renewExpiringWatches(db, env)
          .catch((err: unknown) => {
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "watch renewal failed at top level",
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          })
          .finally(() => close()),
      );
    } else if (event.cron === TOKEN_ROTATION_CRON) {
      // Rotation is independent of WEBHOOK_BASE_URL — runs in dev shells.
      const { db, close } = getDb(env);
      ctx.waitUntil(
        rotateBatch({ db, env })
          .catch((err: unknown) => {
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "token rotation failed at top level",
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          })
          .finally(() => close()),
      );
    } else {
      // A schedule landed that the dispatcher doesn't recognise — usually
      // means `wrangler.toml` and the cron-string constants above drifted
      // apart. Stay below the Hyperdrive handshake — no DB needed for a
      // warn line.
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "scheduled() received unknown cron — check wrangler.toml ↔ src/index.ts cron constants",
          cron: event.cron,
        }),
      );
    }
  },
};
export { app };

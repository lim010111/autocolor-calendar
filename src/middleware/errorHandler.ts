import type { Context } from "hono";

import { OAuthError } from "../config/constants";
import type { HonoEnv } from "../env";

export function errorHandler(err: Error, c: Context<HonoEnv>): Response {
  if (err instanceof OAuthError) {
    const target = new URL(c.env.GAS_REDIRECT_URL);
    target.searchParams.set("error", err.code);
    return c.redirect(target.toString(), 302);
  }

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      reqId: c.get("reqId"),
      path: new URL(c.req.url).pathname,
      msg: err.message,
      stack: err.stack,
    }),
  );
  return c.json({ error: "server_error" }, 500);
}

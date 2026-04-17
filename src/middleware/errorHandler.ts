import type { Context } from "hono";

import { OAuthError } from "../config/constants";
import type { HonoEnv } from "../env";

export function errorHandler(err: Error, c: Context<HonoEnv>): Response {
  const path = new URL(c.req.url).pathname;

  if (err instanceof OAuthError) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        reqId: c.get("reqId"),
        path,
        code: err.code,
        msg: err.message,
      }),
    );
    const target = new URL(c.env.GAS_REDIRECT_URL);
    target.searchParams.set("error", err.code);
    return c.redirect(target.toString(), 302);
  }

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      reqId: c.get("reqId"),
      path,
      msg: err.message,
      stack: err.stack,
    }),
  );
  return c.json({ error: "server_error" }, 500);
}

import { createMiddleware } from "hono/factory";

import type { HonoEnv } from "../env";

const REDACT_KEYS = new Set([
  "authorization",
  "token",
  "code",
  "state",
  "refresh_token",
  "access_token",
  "id_token",
  "email",
  "sub",
  "password",
]);

function redactQuery(search: string): string {
  if (!search) return "";
  const params = new URLSearchParams(search);
  for (const key of Array.from(params.keys())) {
    if (REDACT_KEYS.has(key.toLowerCase())) params.set(key, "[REDACTED]");
  }
  const out = params.toString();
  return out ? `?${out}` : "";
}

export const loggerMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
    const start = Date.now();
    const reqId = crypto.randomUUID();
    c.set("reqId", reqId);
    const url = new URL(c.req.url);
    const safePath = `${url.pathname}${redactQuery(url.search)}`;

    try {
      await next();
    } finally {
      const entry = {
        ts: new Date().toISOString(),
        level: "info",
        reqId,
        method: c.req.method,
        path: safePath,
        status: c.res.status,
        duration_ms: Date.now() - start,
      };
      console.log(JSON.stringify(entry));
    }
  });

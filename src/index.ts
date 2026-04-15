import { Hono } from "hono";
import type { Bindings } from "./env";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/healthz", (c) => c.json({ ok: true, env: c.env.ENV }));

export default app;

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { HonoEnv } from "../env";
import { homeRoutes } from "../routes/home";

describe("homeRoutes", () => {
  const app = new Hono<HonoEnv>();
  app.route("/", homeRoutes);

  it("GET / returns 200 + HTML landing page", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("AutoColor for Calendar");
    expect(body).toContain("legal.autocolorcal.app/privacy");
    expect(body).toContain("legal.autocolorcal.app/terms");
    expect(body).toContain("support@autocolorcal.app");
  });
});

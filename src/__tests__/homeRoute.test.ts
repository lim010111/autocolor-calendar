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
    // App name must match OAuth Consent Screen App name (Google review
    // 2026-05-09 거절 사유 #3 — Consent Screen "App name"과 홈페이지
    // 표기가 일치해야 함). H1으로 가장 prominent하게 노출.
    expect(body).toContain("<h1>AutoColor for Calendar</h1>");
    // English purpose statement reachable to non-Korean reviewers
    // (거절 사유 #2 — 홈페이지에 앱 목적 설명 부재). H1 직후 lead-en.
    expect(body).toContain(
      "Google Workspace Add-on that automatically applies colors",
    );
    // Privacy policy link must be visible in header navigation, not
    // only buried in footer (거절 사유 #1 — 검수자 visual scan 미통과).
    expect(body).toMatch(
      /<header[\s\S]*?legal\.autocolorcal\.app\/privacy[\s\S]*?<\/header>/,
    );
    expect(body).toContain("legal.autocolorcal.app/privacy");
    expect(body).toContain("legal.autocolorcal.app/terms");
    expect(body).toContain("support@autocolorcal.app");
  });
});

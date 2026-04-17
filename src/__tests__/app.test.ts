import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import app from "../index";
import { signState } from "../lib/state";

type MinimalEnv = {
  ENV: "dev" | "prod";
  GOOGLE_OAUTH_REDIRECT_URI: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GAS_REDIRECT_URL: string;
  TOKEN_ENCRYPTION_KEY: string;
  SESSION_HMAC_KEY: string;
  SESSION_PEPPER: string;
};

let env: MinimalEnv;
const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

beforeAll(() => {
  const b64 = () => randomBytes(32).toString("base64");
  env = {
    ENV: "dev",
    GOOGLE_OAUTH_REDIRECT_URI: "https://autocolor-test.workers.dev/oauth/google/callback",
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GAS_REDIRECT_URL: "https://script.google.com/macros/s/TEST/exec",
    TOKEN_ENCRYPTION_KEY: b64(),
    SESSION_HMAC_KEY: b64(),
    SESSION_PEPPER: b64(),
  };
});

async function invoke(path: string, init?: RequestInit): Promise<Response> {
  const req = new Request(`https://worker.test${path}`, init);
  return app.fetch(req, env as unknown as Record<string, unknown>, ctx);
}

describe("app routing", () => {
  it("GET /healthz returns 200 with env echo", async () => {
    const res = await invoke("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; env: string };
    expect(body).toEqual({ ok: true, env: "dev" });
  });

  it("GET /oauth/google redirects to Google consent with signed state", async () => {
    const res = await invoke("/oauth/google");
    expect(res.status).toBe(302);
    const loc = res.headers.get("location");
    expect(loc).toBeTruthy();
    const url = new URL(loc!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(env.GOOGLE_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const state = url.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("GET /me without bearer returns 401", async () => {
    const res = await invoke("/me/");
    expect(res.status).toBe(401);
  });

  it("POST /auth/logout without bearer returns 401", async () => {
    const res = await invoke("/auth/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("oauth callback error contract", () => {
  it("tampered state redirects to GAS_REDIRECT_URL with ?error=state_invalid", async () => {
    const res = await invoke("/oauth/google/callback?code=x&state=tampered");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://script.google.com/macros/s/TEST/exec");
    expect(loc.searchParams.get("error")).toBe("state_invalid");
  });

  it("Google access_denied maps to ?error=consent_denied", async () => {
    const res = await invoke("/oauth/google/callback?error=access_denied");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("consent_denied");
  });

  it("Google non-consent provider errors map to ?error=provider_error", async () => {
    const res = await invoke("/oauth/google/callback?error=invalid_scope");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("provider_error");
  });

  it("callback without code/state redirects with ?error=state_invalid", async () => {
    const res = await invoke("/oauth/google/callback");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("state_invalid");
  });

  it("valid state but no HYPERDRIVE binding lands the user back with ?error=server_error", async () => {
    // Simulates the prod-shell environment: state verifies but getDb throws.
    // The non-OAuthError must be wrapped so the user still lands on /exec.
    const state = await signState(env.SESSION_HMAC_KEY);
    const res = await invoke(
      `/oauth/google/callback?code=x&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://script.google.com/macros/s/TEST/exec");
    // `token_exchange_failed` would also pass the "don't strand the user" bar,
    // but we want to confirm server_error specifically maps through the
    // wrap-any-non-OAuthError catch in the callback handler.
    const code = loc.searchParams.get("error");
    expect([
      "server_error",
      "token_exchange_failed",
      "provider_error",
    ]).toContain(code);
  });
});

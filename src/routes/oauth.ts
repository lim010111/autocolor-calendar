import { Hono } from "hono";

import {
  GOOGLE_AUTH_URL,
  OAUTH_SCOPE_PARAM,
  OAuthError,
} from "../config/constants";
import { getDb } from "../db";
import type { HonoEnv } from "../env";
import { signState, verifyState } from "../lib/state";
import { exchangeCode, fetchUserInfo } from "../services/googleOAuth";
import { saveGoogleRefreshToken } from "../services/oauthTokenService";
import { issueSession } from "../services/sessionService";
import { upsertUserByGoogleSub } from "../services/userService";

export const oauthRoutes = new Hono<HonoEnv>();

oauthRoutes.get("/google", async (c) => {
  const state = await signState(c.env.SESSION_HMAC_KEY);
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", c.env.GOOGLE_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", OAUTH_SCOPE_PARAM);
  url.searchParams.set("state", state);
  return c.redirect(url.toString(), 302);
});

oauthRoutes.get("/google/callback", async (c) => {
  try {
    const query = c.req.query();

    if (query["error"]) {
      if (query["error"] === "access_denied") {
        throw new OAuthError("consent_denied", query["error"]);
      }
      // Google can return invalid_request, invalid_scope, unauthorized_client,
      // server_error, temporarily_unavailable, etc. Surface them distinctly
      // from a user-driven cancellation so GAS can render a different message.
      throw new OAuthError("provider_error", query["error"]);
    }

    const code = query["code"];
    const state = query["state"];
    if (!code || !state) {
      throw new OAuthError("state_invalid", "missing code or state");
    }

    const stateOk = await verifyState(c.env.SESSION_HMAC_KEY, state);
    if (!stateOk) throw new OAuthError("state_invalid");

    const tokens = await exchangeCode(
      code,
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      c.env.GOOGLE_OAUTH_REDIRECT_URI,
    );
    const userInfo = await fetchUserInfo(tokens.access_token);

    const { db, close } = getDb(c.env);
    let sessionToken: string;
    try {
      const user = await upsertUserByGoogleSub(db, {
        googleSub: userInfo.sub,
        email: userInfo.email,
      });
      await saveGoogleRefreshToken(db, c.env.TOKEN_ENCRYPTION_KEY, {
        userId: user.id,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
      });
      const userAgent = c.req.header("user-agent") ?? null;
      const session = await issueSession(db, c.env.SESSION_PEPPER, {
        userId: user.id,
        userAgent,
      });
      sessionToken = session.token;
    } finally {
      c.executionCtx.waitUntil(close());
    }

    const target = new URL(c.env.GAS_REDIRECT_URL);
    target.searchParams.set("token", sessionToken);
    return c.redirect(target.toString(), 302);
  } catch (err) {
    // The callback contract is: always land the user back on the GAS /exec
    // URL with an ?error=<code> so the Add-on can resume. Wrap any stray
    // non-OAuth error as server_error so errorHandler redirects instead of
    // stranding the user on a JSON 500 page.
    if (err instanceof OAuthError) throw err;
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        reqId: c.get("reqId"),
        path: "/oauth/google/callback",
        msg: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    throw new OAuthError(
      "server_error",
      err instanceof Error ? err.message : "unknown",
    );
  }
});

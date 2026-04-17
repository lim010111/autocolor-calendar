import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { GOOGLE_TOKEN_URL } from "../config/constants";
import type { Bindings } from "../env";
import { getGoogleRefreshToken, markReauthRequired } from "./oauthTokenService";

export class ReauthRequiredError extends Error {
  constructor(public readonly reason: string) {
    super(`reauth_required: ${reason}`);
    this.name = "ReauthRequiredError";
  }
}

export class TokenRefreshError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

type RefreshResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export type AccessTokenResult = { accessToken: string; expiresAt: number };

export async function getValidAccessToken(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
): Promise<AccessTokenResult> {
  const stored = await getGoogleRefreshToken(db, env.TOKEN_ENCRYPTION_KEY, userId);
  if (!stored) throw new ReauthRequiredError("no_refresh_token");
  if (stored.needsReauth) throw new ReauthRequiredError("flag_set");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // ignore
    }
    const errorCode =
      typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error?: unknown }).error
        : undefined;
    if (errorCode === "invalid_grant") {
      await markReauthRequired(db, userId, "invalid_grant");
      throw new ReauthRequiredError("invalid_grant");
    }
    throw new TokenRefreshError(
      res.status,
      `Google token endpoint returned ${res.status}`,
    );
  }

  const data = (await res.json()) as RefreshResponse;
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

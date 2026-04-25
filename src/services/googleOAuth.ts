import {
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  OAuthError,
} from "../config/constants";

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
};

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
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
      throw new OAuthError("invalid_grant");
    }
    throw new OAuthError(
      "token_exchange_failed",
      `Google token endpoint returned ${res.status}`,
    );
  }

  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.refresh_token) {
    throw new OAuthError(
      "token_exchange_failed",
      "Google did not return a refresh_token",
    );
  }
  return data;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new OAuthError(
      "token_exchange_failed",
      `userinfo endpoint returned ${res.status}`,
    );
  }
  const data = (await res.json()) as { sub?: string; email?: string };
  if (!data.sub || !data.email) {
    throw new OAuthError("token_exchange_failed", "userinfo missing sub/email");
  }
  return { sub: data.sub, email: data.email };
}

// Best-effort. Per RFC 7009 + Google docs, /revoke returns 200 on success and
// 400 {"error":"invalid_token"} when already revoked/expired. Both outcomes
// are acceptable for the account-delete flow — we just need to attempt
// revocation. Never throw: a Google API outage must not block the
// authoritative DELETE FROM users step.
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    const body = new URLSearchParams({ token: refreshToken });
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "google revoke non-2xx",
          status: res.status,
        }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "google revoke threw",
        err: String(err),
      }),
    );
  }
}

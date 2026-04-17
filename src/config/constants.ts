export const OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const OAUTH_SCOPE_PARAM = OAUTH_SCOPES.join(" ");

export const SESSION_ABSOLUTE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const SESSION_ROLLING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type OAuthErrorCode =
  | "state_invalid"
  | "consent_denied"
  | "token_exchange_failed"
  | "invalid_grant"
  | "server_error";

export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "OAuthError";
  }
}

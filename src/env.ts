export type Bindings = {
  ENV: "dev" | "prod";
  GOOGLE_OAUTH_REDIRECT_URI: string;

  DATABASE_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GAS_REDIRECT_URL: string;
  TOKEN_ENCRYPTION_KEY: string;
  SESSION_HMAC_KEY: string;
  SESSION_PEPPER: string;
};

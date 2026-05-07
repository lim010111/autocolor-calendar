import type { SyncJob } from "./queues/types";

export type Bindings = {
  ENV: "dev" | "prod";
  GOOGLE_OAUTH_REDIRECT_URI: string;

  // Optional because the prod worker is a URL-reserving shell that does not
  // yet have a Hyperdrive binding. `getDb` throws a clear error if a caller
  // tries to use the DB in an environment where it is not configured.
  HYPERDRIVE?: Hyperdrive;

  // Queue producer. Absent in the prod shell until Queue bindings are added;
  // producer code must check for presence.
  SYNC_QUEUE?: Queue<SyncJob>;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GAS_REDIRECT_URL: string;
  TOKEN_ENCRYPTION_KEY: string;
  // §3 후속 — present ONLY during an active rotation window. The rotation
  // cron (`src/services/tokenRotation.ts`) decrypts old-key rows with this
  // and re-encrypts under `TOKEN_ENCRYPTION_KEY`; `getGoogleRefreshToken`
  // also falls back to it when the primary key fails. Remove via
  // `wrangler secret delete TOKEN_ENCRYPTION_KEY_PREV --env <target>` once
  // `oauth_tokens` count of `token_version <> TARGET_TOKEN_VERSION` hits 0.
  TOKEN_ENCRYPTION_KEY_PREV?: string;
  SESSION_HMAC_KEY: string;
  SESSION_PEPPER: string;

  // Base URL used as the `address` when registering a Google Calendar Watch
  // channel. Optional because Google distrusts *.workers.dev and will reject
  // registration against the dev shell — dev environments leave it unset,
  // which makes `/sync/bootstrap` skip channel registration entirely. Prod
  // sets this to the verified custom domain (§1 prerequisite).
  WEBHOOK_BASE_URL?: string;

  // §5.3 LLM fallback. Optional so the prod URL-reserving shell (no secrets
  // yet) and dev environments without a key both keep working —
  // `classifyWithLlm` returns `{ kind: "disabled" }` when absent, which the
  // chain treats as a rule-miss and silently counts as `no_match`.
  OPENAI_API_KEY?: string;

  // Per-user daily LLM call ceiling. Parsed as a positive integer at runtime
  // in `classifyWithLlm`; NaN / ≤ 0 / unset all fall back to the default
  // (200). Exists so we can bump or lower the ceiling without a redeploy.
  LLM_DAILY_LIMIT?: string;

  // Cost guardrail (§5/§6 후속) — operator-side global daily LLM call
  // ceiling. Bumped via `llm_usage_global_daily` BEFORE the per-user
  // counter inside `reserveLlmCall`. Default = 10,000 calls/day
  // (≈ $21/month at current gpt-5.4-nano pricing assumptions). Same parse
  // rules as `LLM_DAILY_LIMIT` — NaN / ≤ 0 / unset all fall back to the
  // default. Defined as a `vars` value (not a secret) so operators can
  // adjust per environment without re-deploying.
  LLM_GLOBAL_DAILY_LIMIT?: string;
};

export type Variables = {
  reqId: string;
  userId: string;
  email: string;
};

export type HonoEnv = { Bindings: Bindings; Variables: Variables };

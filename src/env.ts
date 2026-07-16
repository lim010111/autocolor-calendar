import type { SyncJob } from "./queues/types";

export type Bindings = {
  ENV: "dev" | "prod";
  GOOGLE_OAUTH_REDIRECT_URI: string;

  // Optional so unit tests can build minimal `Bindings` without a Hyperdrive
  // shim. Both dev and prod bind it via `wrangler.toml`; `getDb` throws a
  // clear error if missing at runtime, which only happens under bad config.
  HYPERDRIVE?: Hyperdrive;

  // Queue producer. Optional so test harnesses can omit it; both dev and
  // prod bind it. Producer code still null-checks before enqueue.
  SYNC_QUEUE?: Queue<SyncJob>;

  // ADR-0004 #02 — Workers AI binding for embedding-kNN Stage 1. Optional so
  // unit tests (plain node, no `env.AI`) can build minimal `Bindings`; both
  // dev and prod bind it via `wrangler.toml`. The embedding helper
  // (`src/services/embeddings.ts`) is the single caller of `env.AI.run`, and
  // it forces the frozen prefix (`src/config/embedding.ts`). When absent,
  // Stage-1 embedding degrades to Stage-2 LLM fallback (read path) or a
  // warn-only skip (write path) — see ADR-0004 #02 AC #9.
  AI?: Ai;

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

  // §5.3 LLM fallback. Optional so environments without a key (tests / a
  // local sandbox) keep working — `classifyWithLlm` returns
  // `{ kind: "disabled" }` when absent, which the chain treats as a
  // rule-miss and silently counts as `no_match`.
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

  // sync-reliability #02 — per-invocation external-fetch budget for the sync
  // pipeline (`calendarSync.runPagedList`). Workers Free caps subrequests at
  // 50/invocation; the default (40) keeps a margin for the fetches the guard
  // does not count (token refresh / DB connection / queue send). Same parse
  // rules as `LLM_DAILY_LIMIT` — NaN / ≤ 0 / unset fall back to the default.
  // Bump toward ~900 if #01 moves the account to Workers Paid (1000-cap) —
  // the guard logic is plan-agnostic.
  SYNC_SUBREQUEST_BUDGET?: string;
};

export type Variables = {
  reqId: string;
  userId: string;
  email: string;
};

export type HonoEnv = { Bindings: Bindings; Variables: Variables };

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => new Uint8Array(value),
  toDriver: (value) => value,
});

export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google"),
    encryptedRefreshToken: bytea("encrypted_refresh_token").notNull(),
    iv: bytea("iv").notNull(),
    scope: text("scope").notNull(),
    tokenVersion: integer("token_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    needsReauth: boolean("needs_reauth").notNull().default(false),
    needsReauthReason: text("needs_reauth_reason"),
  },
  (t) => [
    unique("oauth_tokens_user_provider_uq").on(t.userId, t.provider),
    // §3 후속 — supports the rotation cron's `WHERE token_version != target`
    // SELECT in `src/services/tokenRotation.ts`. Unconditional btree (not
    // partial) so it stays useful across rotation cycles without requiring
    // a fresh migration each time `TARGET_TOKEN_VERSION` is bumped.
    index("oauth_tokens_token_version_idx").on(t.tokenVersion),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: bytea("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    colorId: text("color_id").notNull(),
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    priority: integer("priority").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("categories_user_priority_idx").on(t.userId, t.priority),
    unique("categories_user_id_name_unique").on(t.userId, t.name),
    // Google Calendar event color IDs are the string keys "1".."11" per
    // https://developers.google.com/calendar/api/v3/reference/colors.
    check(
      "categories_color_id_check",
      sql`${t.colorId} IN ('1','2','3','4','5','6','7','8','9','10','11')`,
    ),
  ],
);

export const syncState = pgTable(
  "sync_state",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    nextSyncToken: text("next_sync_token"),
    watchChannelId: text("watch_channel_id"),
    watchResourceId: text("watch_resource_id"),
    watchChannelToken: text("watch_channel_token"),
    watchExpiration: timestamp("watch_expiration", { withTimezone: true }),
    lastFullResyncAt: timestamp("last_full_resync_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    inProgressAt: timestamp("in_progress_at", { withTimezone: true }),
    // §6.4 / §4B M4 — watch renewal claim. Deliberately distinct from
    // `inProgressAt` (sync consumer claim): sync and renewal touch independent
    // Google API surfaces (events.list vs channels.watch), so conflating them
    // would block renewal while a sync is running. See `src/CLAUDE.md`
    // "Watch renewal concurrency (§6.4)" for the writer/reader contract.
    watchRenewalInProgressAt: timestamp("watch_renewal_in_progress_at", {
      withTimezone: true,
    }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastRunSummary: jsonb("last_run_summary"),
    // §6 Wave A — snapshot of the most recent FAILED SyncSummary on
    // retryable errors. Cleared to null on the next successful run. The DLQ
    // consumer reads this column when a message lands in `sync_failures` so
    // the dead-letter row captures the work-done-before-failure counters.
    // Separate from `last_run_summary` on purpose: reusing one column would
    // race between the consumer's failure write and a concurrent successful
    // run overwriting it.
    lastFailureSummary: jsonb("last_failure_summary"),
    // §6.4 manual-trigger rate limit. Stamped only by `POST /sync/run` on a
    // successful enqueue, so the consumer's own claim/release/summary writes
    // (which touch `updated_at`) can't starve a manual re-trigger inside the
    // 30s coalesce window. NULL on pre-migration rows — the route falls back
    // to `updated_at` for those, which preserves the old behavior until they
    // get their first manual trigger.
    lastManualTriggerAt: timestamp("last_manual_trigger_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("sync_state_user_calendar_uq").on(t.userId, t.calendarId),
    // Partial unique index on (watch_channel_id, watch_resource_id) — see
    // drizzle/0005_watch_channel_token.sql. Drizzle can't express partial
    // indexes declaratively, so this entry is informational only; the SQL
    // migration is authoritative. Left here so reviewers see the intent
    // alongside the column definition.
  ],
);

// §5.3 LLM fallback cost guard. Per-user daily call counter; `reserveLlmCall`
// bumps this via atomic UPSERT before the outbound OpenAI request so a hung
// call can't cause runaway cost. `day` is UTC — see 0008 migration note on
// the ~9h KST offset tradeoff.
export const llmUsageDaily = pgTable(
  "llm_usage_daily",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    callCount: integer("call_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const syncFailures = pgTable(
  "sync_failures",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    // `job` stores the SyncJob message that was dead-lettered. Never write
    // raw Calendar event payloads here (PII); store only the job envelope.
    job: jsonb("job").notNull(),
    errorCode: text("error_code"),
    // Google API error body only — never Calendar event payloads.
    errorBody: text("error_body"),
    attempt: integer("attempt").notNull(),
    // §6 Wave A — `SyncSummary` snapshot copied from
    // `sync_state.last_failure_summary` at DLQ-write time. Aggregate
    // counters only (no event payloads). Nullable — absent when the
    // consumer produced no summary (e.g. job envelope rejected before run).
    summarySnapshot: jsonb("summary_snapshot"),
    failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_failures_user_failed_at_idx").on(t.userId, t.failedAt)],
);

// §6 Wave A — per-call LLM log.
//
// Promotes the four aggregate `SyncSummary.llm_*` counters into per-call rows
// so operators can see latency distribution, outcome mix by http_status,
// and which categories the model actually picks. Written as a bulk INSERT
// at sync-run end via `SyncContext.recordLlmCalls` + `execCtx.waitUntil(...)`
// — one subrequest per sync run regardless of event count, so this doesn't
// burn the Worker's 50-subrequest budget.
//
// PII: `category_name` is the user's own category name (not PII). `outcome`,
// `http_status`, counts, and `latency_ms` are pure telemetry. No event
// content crosses this boundary — the calendar event payload never reaches
// this table, consistent with the log-redaction contract in src/CLAUDE.md.
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome").notNull(),
    // Only populated for outcome='http_error'. Nullable otherwise.
    httpStatus: integer("http_status"),
    latencyMs: integer("latency_ms").notNull(),
    // Post-slice candidate count (= min(LLM_MAX_CATEGORIES=50, categories.length))
    // so this reflects what the model actually saw, not what the user owns.
    categoryCount: integer("category_count").notNull(),
    // Total attempts including the final outcome (1 or 2 per MAX_ATTEMPTS=2).
    // 0 when the chain quota-latched mid-run and skipped the fetch entirely.
    attempts: integer("attempts").notNull().default(1),
    // Only populated for outcome='hit'. Nullable otherwise.
    categoryName: text("category_name"),
  },
  (t) => [
    index("llm_calls_user_occurred_at_idx").on(t.userId, t.occurredAt),
    check(
      "llm_calls_outcome_check",
      sql`${t.outcome} IN ('hit','miss','timeout','quota_exceeded','http_error','bad_response','disabled')`,
    ),
  ],
);

// §6 Wave A — per-run rollback log.
//
// Every `color_rollback` queue job result (ok / reauth_required / forbidden /
// not_found / retryable) inserts one row here before `msg.ack`/`msg.retry`.
// `attempt = msg.attempts` so a "retry then DLQ" pattern is visible as
// multiple rows with increasing attempt numbers.
//
// `category_id` has no FK: the trigger for a rollback is the category being
// deleted, so the FK target is already gone by the time the consumer writes.
// This matches the consumer's `ON DELETE CASCADE` intent for user removal
// without blocking the common happy path.
//
// Insert failures are caught and logged at warn — observability writes MUST
// NOT cause the rollback job itself to retry, since that would re-emit
// `clearEventColor` PATCHes on already-cleared events.
export const rollbackRuns = pgTable(
  "rollback_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    pages: integer("pages").notNull().default(0),
    seen: integer("seen").notNull().default(0),
    cleared: integer("cleared").notNull().default(0),
    skippedStaleMarker: integer("skipped_stale_marker").notNull().default(0),
    skippedManualOverride: integer("skipped_manual_override").notNull().default(0),
    skippedVersionMismatch: integer("skipped_version_mismatch").notNull().default(0),
    notFound: integer("not_found").notNull().default(0),
    forbiddenEvents: integer("forbidden_events").notNull().default(0),
    outcome: text("outcome").notNull(),
    attempt: integer("attempt").notNull(),
    // Google API error message shape only (status/reason/op name). Consistent
    // with sync_failures.error_body contract — never event payloads.
    errorMessage: text("error_message"),
  },
  (t) => [
    index("rollback_runs_user_finished_at_idx").on(t.userId, t.finishedAt),
    check(
      "rollback_runs_outcome_check",
      sql`${t.outcome} IN ('ok','reauth_required','forbidden','not_found','retryable')`,
    ),
  ],
);

// §6 Wave B — per-run sync log.
//
// Promotes `SyncSummary` into a historical append-only table so weekly rollups
// (`/api/stats`) can sum counters across runs. `sync_state.last_run_summary`
// keeps the most recent row inline for `/me` latency, but it only holds one
// row per (user, calendar) — insufficient for any windowed aggregate. Every
// `runPagedList` termination (ok / reauth_required / forbidden / not_found /
// full_sync_required / retryable) inserts exactly one row via `finalize()`,
// so a retry→DLQ sequence appears as N rows with increasing attempts and a
// chunked full resync appears as one row per Worker invocation.
//
// Written by `syncConsumer.handleOne` through
// `execCtx.waitUntil(db.insert(syncRuns).values(...).catch(warn))` —
// fire-and-forget so response latency is unaffected, and a DB write failure
// only downgrades to a warn log. Observability writes MUST NOT cause the
// sync itself to retry.
//
// PII: counters only. No Calendar event payload ever reaches this table —
// `SyncSummary` itself is aggregate-only by construction (see
// calendarSync.ts). Consistent with src/CLAUDE.md log-redaction contract.
//
// Retention: no TTL applied in Wave B. Index on (user_id, finished_at) keeps
// recent-window reads fast regardless. pg_cron-based purge lands with the
// §3-후속 "세션 GC" cleanup wave.
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    pages: integer("pages").notNull().default(0),
    seen: integer("seen").notNull().default(0),
    evaluated: integer("evaluated").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skippedManual: integer("skipped_manual").notNull().default(0),
    skippedEqual: integer("skipped_equal").notNull().default(0),
    cancelled: integer("cancelled").notNull().default(0),
    noMatch: integer("no_match").notNull().default(0),
    llmAttempted: integer("llm_attempted").notNull().default(0),
    llmSucceeded: integer("llm_succeeded").notNull().default(0),
    llmTimeout: integer("llm_timeout").notNull().default(0),
    llmQuotaExceeded: integer("llm_quota_exceeded").notNull().default(0),
    storedNextSyncToken: boolean("stored_next_sync_token").notNull().default(false),
    outcome: text("outcome").notNull(),
  },
  (t) => [
    index("sync_runs_user_finished_at_idx").on(t.userId, t.finishedAt),
    check(
      "sync_runs_outcome_check",
      sql`${t.outcome} IN ('ok','reauth_required','forbidden','not_found','full_sync_required','retryable')`,
    ),
  ],
);

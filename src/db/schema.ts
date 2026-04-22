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
  (t) => [unique("oauth_tokens_user_provider_uq").on(t.userId, t.provider)],
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
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastRunSummary: jsonb("last_run_summary"),
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
    failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_failures_user_failed_at_idx").on(t.userId, t.failedAt)],
);

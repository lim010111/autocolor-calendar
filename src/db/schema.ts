import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  pgTable,
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

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector(1536)",
  fromDriver: (value) => JSON.parse(value as string) as number[],
  toDriver: (value) => JSON.stringify(value),
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
    embedding: vector1536("embedding"),
    priority: integer("priority").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("categories_user_priority_idx").on(t.userId, t.priority),
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
    watchExpiration: timestamp("watch_expiration", { withTimezone: true }),
    lastFullResyncAt: timestamp("last_full_resync_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("sync_state_user_calendar_uq").on(t.userId, t.calendarId)],
);

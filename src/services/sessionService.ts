import { and, eq, gt, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_ROLLING_TTL_MS,
} from "../config/constants";
import { sessions, users } from "../db/schema";
import { hmacSha256, textEncoder } from "../lib/crypto";
import { randomToken32 } from "../lib/random";

async function hashToken(pepper: string, token: string): Promise<Uint8Array> {
  return hmacSha256(pepper, textEncoder.encode(token));
}

export async function issueSession(
  db: PostgresJsDatabase,
  pepper: string,
  params: { userId: string; userAgent: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken32();
  const tokenHash = await hashToken(pepper, token);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_ROLLING_TTL_MS);

  await db.insert(sessions).values({
    userId: params.userId,
    tokenHash,
    expiresAt,
    userAgent: params.userAgent,
  });

  return { token, expiresAt };
}

export type SessionContext = { userId: string; email: string };

export async function verifySession(
  db: PostgresJsDatabase,
  pepper: string,
  token: string,
): Promise<SessionContext | null> {
  const tokenHash = await hashToken(pepper, token);
  const now = new Date();

  const rows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const absoluteExpiry = row.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS;
  if (now.getTime() > absoluteExpiry) return null;

  const newRollingExpiry = new Date(
    Math.min(now.getTime() + SESSION_ROLLING_TTL_MS, absoluteExpiry),
  );
  await db
    .update(sessions)
    .set({ expiresAt: newRollingExpiry })
    .where(eq(sessions.id, row.id));

  return { userId: row.userId, email: row.email };
}

export async function revokeSession(
  db: PostgresJsDatabase,
  pepper: string,
  token: string,
): Promise<void> {
  const tokenHash = await hashToken(pepper, token);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

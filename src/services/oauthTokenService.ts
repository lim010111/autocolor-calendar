import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { oauthTokens } from "../db/schema";
import { aesGcmDecrypt, aesGcmEncrypt, textDecoder, textEncoder } from "../lib/crypto";

export async function saveGoogleRefreshToken(
  db: PostgresJsDatabase,
  encryptionKey: string,
  params: { userId: string; refreshToken: string; scope: string },
): Promise<void> {
  const aad = textEncoder.encode(`user:${params.userId}`);
  const plaintext = textEncoder.encode(params.refreshToken);
  const { iv, ciphertext } = await aesGcmEncrypt(encryptionKey, plaintext, aad);

  await db
    .insert(oauthTokens)
    .values({
      userId: params.userId,
      provider: "google",
      encryptedRefreshToken: ciphertext,
      iv,
      scope: params.scope,
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        encryptedRefreshToken: ciphertext,
        iv,
        scope: params.scope,
        rotatedAt: sql`now()`,
        updatedAt: sql`now()`,
        // A successful re-save clears any prior reauth flag.
        needsReauth: false,
        needsReauthReason: null,
      },
    });
}

export async function getGoogleRefreshToken(
  db: PostgresJsDatabase,
  encryptionKey: string,
  userId: string,
): Promise<{ refreshToken: string; scope: string; needsReauth: boolean } | null> {
  const rows = await db
    .select({
      iv: oauthTokens.iv,
      encryptedRefreshToken: oauthTokens.encryptedRefreshToken,
      scope: oauthTokens.scope,
      needsReauth: oauthTokens.needsReauth,
    })
    .from(oauthTokens)
    .where(
      and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const aad = textEncoder.encode(`user:${userId}`);
  const plaintext = await aesGcmDecrypt(
    encryptionKey,
    row.iv,
    row.encryptedRefreshToken,
    aad,
  );
  return {
    refreshToken: textDecoder.decode(plaintext),
    scope: row.scope,
    needsReauth: row.needsReauth,
  };
}

export async function markReauthRequired(
  db: PostgresJsDatabase,
  userId: string,
  reason: string,
): Promise<void> {
  await db
    .update(oauthTokens)
    .set({
      needsReauth: true,
      needsReauthReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google")),
    );
}

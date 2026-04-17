import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { oauthTokens } from "../db/schema";
import { aesGcmEncrypt, textEncoder } from "../lib/crypto";

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
      },
    });
}

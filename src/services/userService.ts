import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { users } from "../db/schema";

export async function upsertUserByGoogleSub(
  db: PostgresJsDatabase,
  params: { googleSub: string; email: string },
): Promise<{ id: string; email: string }> {
  const rows = await db
    .insert(users)
    .values({ googleSub: params.googleSub, email: params.email })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: { email: params.email, updatedAt: sql`now()` },
    })
    .returning({ id: users.id, email: users.email });
  const row = rows[0];
  if (!row) throw new Error("upsertUserByGoogleSub: no row returned");
  return row;
}

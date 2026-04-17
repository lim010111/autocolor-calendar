import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Bindings } from "../env";

export function getDb(env: Bindings) {
  const client = postgres(env.DATABASE_URL, {
    prepare: false,
    ssl: "require",
  });
  return { db: drizzle(client), close: () => client.end() };
}

export type DbHandle = ReturnType<typeof getDb>;

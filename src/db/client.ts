import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Bindings } from "../env";

export function getDb(env: Bindings) {
  // Route through Cloudflare Hyperdrive: it pools PostgreSQL connections at
  // the edge, so the Worker sees a single local socket (one subrequest) and
  // avoids postgres.js burning through the subrequest budget during the
  // Supabase pooler handshake.
  const client = postgres(env.HYPERDRIVE.connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 0,
    fetch_types: false,
  });
  return { db: drizzle(client), close: () => client.end() };
}

export type DbHandle = ReturnType<typeof getDb>;

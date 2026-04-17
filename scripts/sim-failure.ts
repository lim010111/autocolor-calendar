#!/usr/bin/env tsx
/**
 * §4A failure path simulator.
 *
 * Usage:
 *   pnpm tsx scripts/sim-failure.ts <case> <user_email>
 *
 * Cases:
 *   corrupt-token   — set sync_state.next_sync_token to a bogus value
 *                     (Google will return 410 fullSyncRequired on next run)
 *   set-reauth      — set oauth_tokens.needs_reauth = true
 *   clear-reauth    — unset oauth_tokens.needs_reauth
 *   deactivate      — set sync_state.active = false
 *   activate        — set sync_state.active = true
 *   inspect         — print current sync_state + oauth_tokens row for user
 *
 * DO NOT commit secrets; reads DIRECT_DATABASE_URL from .dev.vars.
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".dev.vars" });

const url = process.env["DIRECT_DATABASE_URL"];
if (!url) throw new Error("DIRECT_DATABASE_URL missing in .dev.vars");

const [, , caseName, email] = process.argv;
if (!caseName || !email) {
  console.error("usage: tsx scripts/sim-failure.ts <case> <email>");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, idle_timeout: 1 });

async function main(): Promise<void> {
  const emailStr = email as string;
  const users = (await sql<Array<{ id: string }>>`
    SELECT id FROM users WHERE email = ${emailStr} LIMIT 1
  `) as unknown as Array<{ id: string }>;
  const user = users[0];
  if (!user) throw new Error(`no user with email=${emailStr}`);
  const userId = user.id;

  switch (caseName) {
    case "corrupt-token":
      await sql`
        UPDATE sync_state
        SET next_sync_token = 'BOGUS_FORCE_410_RECOVERY'
        WHERE user_id = ${userId} AND calendar_id = 'primary'
      `;
      console.log("next_sync_token set to BOGUS_FORCE_410_RECOVERY");
      break;
    case "set-reauth":
      await sql`
        UPDATE oauth_tokens
        SET needs_reauth = true, needs_reauth_reason = 'simulated'
        WHERE user_id = ${userId} AND provider = 'google'
      `;
      console.log("needs_reauth = true");
      break;
    case "clear-reauth":
      await sql`
        UPDATE oauth_tokens
        SET needs_reauth = false, needs_reauth_reason = NULL
        WHERE user_id = ${userId} AND provider = 'google'
      `;
      console.log("needs_reauth cleared");
      break;
    case "deactivate":
      await sql`
        UPDATE sync_state
        SET active = false
        WHERE user_id = ${userId} AND calendar_id = 'primary'
      `;
      console.log("sync_state.active = false");
      break;
    case "activate":
      await sql`
        UPDATE sync_state
        SET active = true
        WHERE user_id = ${userId} AND calendar_id = 'primary'
      `;
      console.log("sync_state.active = true");
      break;
    case "inspect": {
      const ss = await sql`
        SELECT calendar_id, next_sync_token, active, in_progress_at,
               last_error, last_run_summary, updated_at
        FROM sync_state WHERE user_id = ${userId}
      `;
      const ot = await sql`
        SELECT provider, needs_reauth, needs_reauth_reason, updated_at
        FROM oauth_tokens WHERE user_id = ${userId}
      `;
      console.log("sync_state:", JSON.stringify(ss, null, 2));
      console.log("oauth_tokens:", JSON.stringify(ot, null, 2));
      break;
    }
    default:
      throw new Error(`unknown case: ${caseName}`);
  }
}

main()
  .then(() => sql.end())
  .catch((err) => {
    console.error(err);
    sql.end();
    process.exit(1);
  });

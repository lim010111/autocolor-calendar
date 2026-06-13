// Account-deletion watch teardown — best-effort channels.stop for every active
// watch row a user owns. Absorbed from `routes/account.ts` Step 2 so the bare
// `stopWatchChannel` primitive is no longer reached from outside the watch
// module. As a watch-module sibling, this is the one entry point that composes
// `stopWatchChannel` directly (the registration entry points compose
// `reRegisterWatch` instead).
//
// Contract (see src/CLAUDE.md "Account deletion (§3 row 179)"):
// - Best-effort: Google API outages MUST NOT block deletion. Every failure
//   path is warn-only and this function NEVER throws.
// - Warn lines log only op / calendarId / String(err) shape — never event
//   content, never decrypted token material.
// - Orphaned channels expire ≤ 7d; webhook deliveries against the deleted user
//   no-op via `lookupChannelOwner` returning null after the cascade.

import { and, eq, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { syncState } from "../../db/schema";
import type { Bindings } from "../../env";
import { getValidAccessToken } from "../tokenRefresh";
import { stopWatchChannel } from "./core";

export async function teardownWatchesForUser(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
): Promise<void> {
  // If getValidAccessToken throws (no_refresh_token / flag_set / invalid_grant
  // / TokenRefreshError), skip the loop. Orphan channels expire ≤ 7d and
  // webhook deliveries no-op via lookupChannelOwner returning null after
  // cascade.
  try {
    const { accessToken } = await getValidAccessToken(db, env, userId);
    const watchRows = await db
      .select({ calendarId: syncState.calendarId })
      .from(syncState)
      .where(
        and(eq(syncState.userId, userId), isNotNull(syncState.watchChannelId)),
      );
    for (const row of watchRows) {
      try {
        await stopWatchChannel(db, accessToken, userId, row.calendarId);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "account.delete channels.stop failed",
            calendarId: row.calendarId,
            err: String(err),
          }),
        );
      }
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "account.delete watch cleanup skipped",
        err: String(err),
      }),
    );
  }
}

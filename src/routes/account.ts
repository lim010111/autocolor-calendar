import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db";
import { users } from "../db/schema";
import type { HonoEnv } from "../env";
import { parseBearerToken } from "../lib/bearer";
import { authMiddleware } from "../middleware/auth";
import { revokeRefreshToken } from "../services/googleOAuth";
import { getGoogleRefreshToken } from "../services/oauthTokenService";
import { revokeSession } from "../services/sessionService";
import { teardownWatchesForUser } from "../services/watch";

export const accountRoutes = new Hono<HonoEnv>();

accountRoutes.use("*", authMiddleware);

// POST /api/account/delete
//
// Marketplace privacy gate (§3 row 179). Hard-deletes the user's row; FK
// cascade cleans 9 user-scoped tables. Best-effort Google API cleanup runs
// before the authoritative DELETE so cascade-dropped rows are still readable.
//
// Order is required (see src/CLAUDE.md "Account deletion (§3 row 179)"):
//   1. Refresh-token revoke   — reads oauth_tokens (cascade-dropped at 3)
//   2. channels.stop loop     — reads sync_state (cascade-dropped at 3)
//   3. DELETE FROM users      — sole authoritative writer
//   4. revokeSession           — defense-in-depth no-op (cascade already
//                                 removed the sessions row)
//
// Idempotency is provided by authMiddleware: a second call from the same
// client carries a bearer that no longer resolves a session → 401.
accountRoutes.post("/delete", async (c) => {
  const userId = c.get("userId");
  const bearer = parseBearerToken(c.req.header("authorization"));
  const { db, close } = getDb(c.env);
  try {
    // Step 1 — best-effort Google OAuth refresh-token revoke.
    try {
      const stored = await getGoogleRefreshToken(
        db,
        {
          current: c.env.TOKEN_ENCRYPTION_KEY,
          previous: c.env.TOKEN_ENCRYPTION_KEY_PREV,
        },
        userId,
      );
      if (stored) await revokeRefreshToken(stored.refreshToken);
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "account.delete revoke failed",
          err: String(err),
        }),
      );
    }

    // Step 2 — best-effort channels.stop for every active watch row, owned by
    // the watch module's teardown entry point. Self-contained best-effort (it
    // never throws), so a Google API outage cannot block deletion. Orphan
    // channels expire ≤ 7d and webhook deliveries no-op via lookupChannelOwner
    // returning null after cascade.
    await teardownWatchesForUser(db, c.env, userId);

    // Step 3 — authoritative delete. FK cascade fans out to 9 user-scoped
    // tables. This is the only path that propagates errors to the response.
    await db.delete(users).where(eq(users.id, userId));

    // Step 4 — explicit session revoke. Defense-in-depth: cascade already
    // dropped the sessions row, so this is a no-op against the authoritative
    // state. Wrapped in try/catch so a stray DB error after step 3 cannot
    // turn a successful deletion into a 5xx.
    if (bearer) {
      try {
        await revokeSession(db, c.env.SESSION_PEPPER, bearer);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "account.delete post-cascade session revoke",
            err: String(err),
          }),
        );
      }
    }

    return c.json({ ok: true });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

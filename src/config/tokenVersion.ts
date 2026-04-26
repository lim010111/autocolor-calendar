// §3 후속 — TOKEN_ENCRYPTION_KEY rotation target version.
//
// `saveGoogleRefreshToken` stamps every newly written `oauth_tokens` row with
// this value, and `rotateBatch` (`src/services/tokenRotation.ts`) drives stale
// rows toward it by re-encrypting under the current key.
//
// Bumping this constant is the trigger for a rotation cycle: deploy with a
// higher version + the new `TOKEN_ENCRYPTION_KEY` + the prior key as
// `TOKEN_ENCRYPTION_KEY_PREV`, then wait for the cron to drain the
// `token_version <> TARGET_TOKEN_VERSION` set to zero. See `src/CLAUDE.md`
// "Secret rotation impact" / "Token rotation (§3 후속)" for the operator
// runbook.
//
// Living in its own leaf module so that both `oauthTokenService.ts` (writer)
// and `tokenRotation.ts` (rotator) can import it without forming a service →
// service cycle.
export const TARGET_TOKEN_VERSION = 1 as const;

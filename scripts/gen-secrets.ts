import { randomBytes } from "node:crypto";

// Emits 32-byte base64 secrets on stdout as KEY=VALUE lines. Paste into
// `.dev.vars` for local `wrangler dev`, then inject into the Worker with
// `wrangler secret put <NAME> --env dev|prod`. Store in a team vault —
// losing these requires invalidating all sessions or re-encrypting all
// oauth_tokens rows.
const names = ["TOKEN_ENCRYPTION_KEY", "SESSION_HMAC_KEY", "SESSION_PEPPER"];

for (const name of names) {
  const value = randomBytes(32).toString("base64");
  process.stdout.write(`${name}=${value}\n`);
}

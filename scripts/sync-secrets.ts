import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Pipes the seven Worker-runtime secrets from `.dev.vars` into
// `wrangler secret put <NAME> --env <target>` via stdin so values never hit
// the shell history. Usage: pnpm tsx scripts/sync-secrets.ts dev
//
// Excluded intentionally:
//   - ENV, GOOGLE_OAUTH_REDIRECT_URI -> wrangler.toml [env.*.vars]
//   - DATABASE_URL, DIRECT_DATABASE_URL -> Hyperdrive binding (runtime) and
//     drizzle-kit migrations (local) respectively; never sent to the Worker.

const WORKER_SECRETS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GAS_REDIRECT_URL",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_HMAC_KEY",
  "SESSION_PEPPER",
] as const;

const target = process.argv[2];
if (target !== "dev" && target !== "prod") {
  process.stderr.write("usage: sync-secrets.ts <dev|prod>\n");
  process.exit(2);
}

const envFile = target === "dev" ? ".dev.vars" : ".prod.vars";
const raw = readFileSync(envFile, "utf8");
const values = new Map<string, string>();
for (const line of raw.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
}

for (const name of WORKER_SECRETS) {
  const value = values.get(name);
  if (!value) {
    process.stderr.write(`missing ${name} in ${envFile}\n`);
    process.exit(1);
  }
  process.stdout.write(`Injecting ${name}...\n`);
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "secret", "put", name, "--env", target],
    { input: value, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) {
    process.stderr.write(`wrangler secret put ${name} failed\n`);
    process.exit(result.status ?? 1);
  }
}

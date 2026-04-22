import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Pipes Worker-runtime secrets from `.dev.vars` / `.prod.vars` into
// `wrangler secret put <NAME> --env <target>` via stdin so values never hit
// the shell history. Usage: pnpm tsx scripts/sync-secrets.ts dev
//
// Parser contract: one KEY=VALUE per line, no shell quoting. Surrounding
// whitespace on the key and value is trimmed, but inner whitespace is kept
// verbatim. Wrapping the value in quotes (`FOO="bar"`) is NOT unwrapped —
// the quotes would be sent to Wrangler as part of the secret.
//
// Excluded intentionally:
//   - ENV, GOOGLE_OAUTH_REDIRECT_URI -> wrangler.toml [env.*.vars]
//   - DATABASE_URL, DIRECT_DATABASE_URL -> Hyperdrive binding (runtime) and
//     drizzle-kit migrations (local) respectively; never sent to the Worker.

const REQUIRED_SECRETS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GAS_REDIRECT_URL",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_HMAC_KEY",
  "SESSION_PEPPER",
] as const;

// Optional secrets are skipped with a notice when absent / empty. Used for
// features whose Worker-side code tolerates the binding being unset (e.g.
// §5.3 LLM fallback is inert without OPENAI_API_KEY).
const OPTIONAL_SECRETS = ["OPENAI_API_KEY"] as const;

const rawTarget = process.argv[2];
if (rawTarget !== "dev" && rawTarget !== "prod") {
  process.stderr.write("usage: sync-secrets.ts <dev|prod>\n");
  process.exit(2);
}
const target: "dev" | "prod" = rawTarget;

const envFile = target === "dev" ? ".dev.vars" : ".prod.vars";
const raw = readFileSync(envFile, "utf8");
const values = new Map<string, string>();
for (const line of raw.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  values.set(key, value);
}

function injectSecret(name: string, value: string): void {
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

for (const name of REQUIRED_SECRETS) {
  const value = values.get(name);
  if (!value) {
    process.stderr.write(`missing ${name} in ${envFile}\n`);
    process.exit(1);
  }
  injectSecret(name, value);
}

for (const name of OPTIONAL_SECRETS) {
  const value = values.get(name);
  if (!value) {
    process.stdout.write(`Skipping optional ${name} (not set in ${envFile})\n`);
    continue;
  }
  injectSecret(name, value);
}

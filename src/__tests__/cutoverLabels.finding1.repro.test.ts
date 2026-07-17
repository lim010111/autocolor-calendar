/**
 * Finding 1 repro — "--env can silently use stale shell secrets"
 * (merge-gate advisory on PR #156, scripts/cutover-labels.ts:64-75).
 *
 * DESIRED property encoded here: the file passed via `--env` is
 * AUTHORITATIVE — a DIRECT_DATABASE_URL already exported in the operator's
 * shell must NOT silently override the selected env file's value while the
 * banner claims that file. On HEAD, `loadEnv({ path: envFile })` (dotenv
 * without `override: true`) preserves pre-existing process.env keys, so the
 * stale shell value wins and the "shell export wins" test below FAILS.
 *
 * Oracle: the script is spawned as a subprocess in dry-run mode with
 * sentinel `.invalid` hostnames in both sources. `.invalid` is a reserved
 * TLD, so the first DB query fails fast and offline with
 * `getaddrinfo ENOTFOUND <host>` — the hostname in that error reveals
 * which DIRECT_DATABASE_URL the script actually used. No real secrets,
 * no network success path, no repo .dev.vars/.prod.vars involved.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const scriptPath = join(repoRoot, "scripts", "cutover-labels.ts");

const FILE_HOST = "from-file.invalid";
const SHELL_HOST = "from-shell.invalid";
const FILE_DB_URL = `postgres://cutover:pw@${FILE_HOST}:5432/db`;
const SHELL_DB_URL = `postgres://cutover:pw@${SHELL_HOST}:5432/db`;

let fixtureDir: string;
let fixtureEnvFile: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "cutover-finding1-"));
  fixtureEnvFile = join(fixtureDir, "fixture.vars");
  writeFileSync(
    fixtureEnvFile,
    [
      `DIRECT_DATABASE_URL=${FILE_DB_URL}`,
      "TOKEN_ENCRYPTION_KEY=dGVzdC1rZXktZnJvbS1maWxlLTAwMDAwMDAwMDAwMDA=",
      "GOOGLE_CLIENT_ID=file-client-id.apps.googleusercontent.com",
      "GOOGLE_CLIENT_SECRET=file-client-secret",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

/** Dry-run the script as a subprocess; returns combined stdout+stderr. */
function runCutoverDryRun(shellOverrides: Record<string, string>): string {
  const env: Record<string, string | undefined> = { ...process.env };
  // Start from a clean slate for the 4 required keys so the fixture file is
  // the only source unless a test deliberately exports a conflicting value.
  delete env["DIRECT_DATABASE_URL"];
  delete env["TOKEN_ENCRYPTION_KEY"];
  delete env["TOKEN_ENCRYPTION_KEY_PREV"];
  delete env["GOOGLE_CLIENT_ID"];
  delete env["GOOGLE_CLIENT_SECRET"];
  Object.assign(env, shellOverrides);

  const res = spawnSync(tsxBin, [scriptPath, "--env", fixtureEnvFile], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  // Exit code 1 is expected in both runs: the sentinel host is unresolvable,
  // so the first DB query fails. We only care WHICH host it failed against.
  return `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
}

describe("cutover-labels --env authority (finding 1 repro)", () => {
  it("control: with no conflicting shell export, the file's DB URL is used", () => {
    const out = runCutoverDryRun({});
    // Guard against unrelated crashes: the run must get past the env check
    // and die on the sentinel DB connection, proving the oracle works.
    expect(out).not.toContain("missing env");
    expect(out).toContain(FILE_HOST);
    expect(out).not.toContain(SHELL_HOST);
  }, 60_000);

  it("a pre-exported shell DIRECT_DATABASE_URL must NOT override the selected --env file", () => {
    const out = runCutoverDryRun({ DIRECT_DATABASE_URL: SHELL_DB_URL });
    // Same guard: not an env-check failure, the script reached the DB step.
    expect(out).not.toContain("missing env");
    // DESIRED: the --env file is authoritative — the connection attempt must
    // target the file's sentinel host, never the stale shell export's.
    // On HEAD this fails: dotenv without override:true keeps the shell value,
    // and the error reads `getaddrinfo ENOTFOUND from-shell.invalid`.
    expect(out).toContain(FILE_HOST);
    expect(out).not.toContain(SHELL_HOST);
  }, 60_000);
});

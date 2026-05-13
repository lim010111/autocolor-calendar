#!/usr/bin/env tsx
/**
 * upload-prompts-to-langfuse — operator script (eval-side only, per ADR-0003).
 *
 * Uploads / upserts classifier system prompts from `prompts/classifier/system.v*.md`
 * into Langfuse Prompt Management. The Langfuse copy is the eval-side replica
 * used by `run-classification-eval.ts --prompt-source langfuse`; production
 * keeps reading from `src/services/prompts/_generated.ts` (the file is the
 * authoritative source-of-truth, Langfuse is downstream).
 *
 * Usage:
 *   pnpm tsx scripts/upload-prompts-to-langfuse.ts <version|all> [--dry-run]
 *
 *   version  — exact key from `ClassifierPromptVersion` (e.g. `v2`, `v5-L1`).
 *   all      — every `system.v*.md` discovered under `prompts/classifier/`.
 *   --dry-run — log the diff verdict per version but do not call create().
 *
 * Idempotency: for each version the script computes sha256(body) and reads
 * the current Langfuse prompt body via `prompt.get(name, { fallback: "" })`.
 * If hashes match → no-op (skipped count). Otherwise it calls `prompt.create()`
 * which produces a new version under the same `name` (Langfuse auto-versions);
 * a `content_sha256:<hex>` tag and `commitMessage` are stamped for traceability.
 *
 * Naming: Langfuse `name` = `autocolor-classifier-<version>` so all variants
 * live under the same browse-prefix in the Prompt Management UI.
 *
 * Secrets: reads `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` /
 * `LANGFUSE_BASE_URL` from `.dev.vars`. Per ADR-0001/0003 these keys never
 * reach the Worker — `scripts/sync-secrets.ts` is deliberately unchanged.
 *
 * Exit codes:
 *   0  — every requested version is in sync (or was successfully uploaded).
 *   1  — one or more versions failed to upload, OR the local file references
 *        a version not present in `prompts/classifier/`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { LangfuseClient } from "@langfuse/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CLASSIFIER_DIR = path.join(ROOT, "prompts", "classifier");

loadEnv({ path: path.join(ROOT, ".dev.vars") });

const NAME_PREFIX = "autocolor-classifier";
// Same source-discovery regex as scripts/embed-prompts.ts — kept in lockstep
// so a version that ships through the Worker bundle is also reachable via
// Langfuse (and vice-versa). Re-check that regex when expanding the suffix
// grammar.
const FILE_PATTERN = /^system\.(v\d+(?:-[A-Za-z0-9-]+)*)\.md$/;

type CliArgs = {
  versions: string[];
  dryRun: boolean;
  all: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0) {
    throw new Error(
      "usage: upload-prompts-to-langfuse.ts <version|all> [--dry-run]",
    );
  }
  const out: CliArgs = { versions: [], dryRun: false, all: false };
  for (const a of argv) {
    if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "all") {
      out.all = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: upload-prompts-to-langfuse.ts <version|all> [--dry-run]\n",
      );
      process.exit(0);
    } else if (a.startsWith("--")) {
      throw new Error(`unknown argument: ${a}`);
    } else {
      out.versions.push(a);
    }
  }
  if (!out.all && out.versions.length === 0) {
    throw new Error("no version specified — pass a version key or `all`");
  }
  return out;
}

function stripFrontmatter(s: string): string {
  if (!s.startsWith("---\n")) return s;
  const end = s.indexOf("\n---\n", 4);
  return end === -1 ? s : s.slice(end + 5);
}

function stripQuotes(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.replace(/^"|"$/g, "");
}

function buildClient(): LangfuseClient {
  const publicKey = stripQuotes(process.env["LANGFUSE_PUBLIC_KEY"]);
  const secretKey = stripQuotes(process.env["LANGFUSE_SECRET_KEY"]);
  const baseUrl =
    stripQuotes(process.env["LANGFUSE_BASE_URL"]) ||
    "https://cloud.langfuse.com";
  if (!publicKey || !secretKey) {
    throw new Error(
      "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set in .dev.vars",
    );
  }
  return new LangfuseClient({ publicKey, secretKey, baseUrl });
}

function discoverLocalVersions(): Map<string, string> {
  // Mirror of embed-prompts.ts's loadClassifierBodies. Identical body
  // post-frontmatter-strip + trailing-whitespace-trim so the sha256
  // matches what's bundled into the Worker.
  const bodies = new Map<string, string>();
  for (const name of readdirSync(CLASSIFIER_DIR).sort()) {
    const m = name.match(FILE_PATTERN);
    if (!m) continue;
    const version = m[1]!;
    const raw = readFileSync(path.join(CLASSIFIER_DIR, name), "utf8");
    bodies.set(version, stripFrontmatter(raw).replace(/\s+$/, ""));
  }
  if (bodies.size === 0) {
    throw new Error(`no system.vN.md files found under ${CLASSIFIER_DIR}`);
  }
  return bodies;
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function leverIdFromVersion(version: string): string | null {
  // `v5-L1` → `L1`. Used as a `lever:L<n>` tag so the Langfuse UI can
  // group experimental variants in the Prompt Management browse view.
  const m = version.match(/-(L\d+)$/);
  return m ? m[1]! : null;
}

type UploadVerdict = "matched" | "uploaded" | "would-upload" | "error";

async function uploadOne(
  client: LangfuseClient,
  version: string,
  body: string,
  dryRun: boolean,
): Promise<{ verdict: UploadVerdict; message: string }> {
  const name = `${NAME_PREFIX}-${version}`;
  const localHash = sha256(body);
  let remoteBody: string | null = null;
  try {
    // Look up the `eval`-labeled version. The default label is "production"
    // — we never write that label here (these prompts are eval-only per
    // ADR-0003), so an unlabeled `prompt.get` always 404s. `fallback` only
    // suppresses network failures, not API 404s, so the catch below handles
    // the "first upload" case explicitly.
    const fetched = await client.prompt.get(name, {
      label: "eval",
      fallback: "",
      cacheTtlSeconds: 0,
    });
    remoteBody = fetched.isFallback ? null : fetched.prompt;
  } catch (err) {
    // Treat 404 ("prompt not found at this label") as "remote body is
    // absent" so first-upload runs proceed to create. Anything else (auth,
    // network, 5xx) propagates as an error verdict.
    const errName = err instanceof Error ? err.constructor.name : "";
    const errMsg = err instanceof Error ? err.message : String(err);
    const is404 =
      errName === "NotFoundError" ||
      /404|not found/i.test(errMsg);
    if (!is404) {
      return {
        verdict: "error",
        message: `${name}: fetch failed (${errMsg})`,
      };
    }
    // 404 → `remoteBody` stays null from its declaration above; fall through
    // to the create path.
  }

  if (remoteBody !== null && sha256(remoteBody) === localHash) {
    return { verdict: "matched", message: `${name}: in sync (sha256=${localHash.slice(0, 12)})` };
  }

  if (dryRun) {
    const reason = remoteBody === null ? "not present remotely" : "content differs";
    return {
      verdict: "would-upload",
      message: `${name}: would upload (${reason}, sha256=${localHash.slice(0, 12)})`,
    };
  }

  const tags = ["model:gpt-5.4-nano", `version:${version}`, `content_sha256:${localHash.slice(0, 12)}`];
  const lever = leverIdFromVersion(version);
  if (lever) tags.push(`lever:${lever}`);

  try {
    await client.prompt.create({
      name,
      type: "text",
      prompt: body,
      labels: ["eval"],
      tags,
      commitMessage: `embed-prompts sha256=${localHash.slice(0, 12)}`,
    });
    return {
      verdict: "uploaded",
      message: `${name}: uploaded (sha256=${localHash.slice(0, 12)})`,
    };
  } catch (err) {
    return {
      verdict: "error",
      message: `${name}: create failed (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const local = discoverLocalVersions();

  const requested = args.all ? [...local.keys()].sort() : args.versions;
  const missing = requested.filter((v) => !local.has(v));
  if (missing.length > 0) {
    throw new Error(
      `requested version(s) not found under prompts/classifier/: ${missing.join(", ")}`,
    );
  }

  const client = buildClient();
  process.stdout.write(
    `Uploading ${requested.length} prompt version(s) to Langfuse${args.dryRun ? " (dry-run)" : ""}…\n\n`,
  );

  const counts: Record<UploadVerdict, number> = {
    matched: 0,
    uploaded: 0,
    "would-upload": 0,
    error: 0,
  };

  for (const version of requested) {
    const body = local.get(version)!;
    const { verdict, message } = await uploadOne(client, version, body, args.dryRun);
    counts[verdict] += 1;
    const icon =
      verdict === "matched"
        ? "·"
        : verdict === "uploaded"
          ? "↑"
          : verdict === "would-upload"
            ? "?"
            : "✗";
    process.stdout.write(`  ${icon} ${message}\n`);
  }

  process.stdout.write(
    `\nSummary: matched=${counts.matched} uploaded=${counts.uploaded} ` +
      `would-upload=${counts["would-upload"]} errors=${counts.error}\n`,
  );

  if (counts.error > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`upload-prompts-to-langfuse: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

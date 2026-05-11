#!/usr/bin/env tsx
/**
 * sync-langfuse-dataset — operator script (eval-side only).
 *
 * Uploads / upserts the per-language classification dataset files into
 * Langfuse Cloud datasets named `autocolor-classification-<lang>`. Run
 * manually after every `dataset-builder` rebuild; per ADR-0001 the eval
 * runner reads from Langfuse and never writes dataset items.
 *
 * Usage:
 *   pnpm tsx evals/scripts/sync-langfuse-dataset.ts <lang|all> [--allow-id-drift]
 *
 *   lang ∈ {en, ko, zh-CN, zh-TW}; `all` iterates over the four. The
 *   `--allow-id-drift` flag is required to proceed when the local
 *   `case.id` set differs from what already exists in Langfuse (added /
 *   removed / changed). Without the flag the script prints the diff and
 *   exits 1, mirroring the ADR's "no silent mutation" constraint.
 *
 * Idempotency: dataset items are upserted by id, so re-running with an
 * unchanged source file is a no-op (zero Langfuse units written for
 * unchanged items beyond the id-list pagination read).
 *
 * Secrets: reads `LANGFUSE_*` from `.dev.vars`. Per ADR-0001 these keys
 * never reach the Worker — `scripts/sync-secrets.ts` is deliberately
 * unchanged.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { LangfuseClient } from "@langfuse/client";

import type { CalendarEvent } from "../../src/services/googleCalendar";
import { redactEventForLlm } from "../../src/services/piiRedactor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

loadEnv({ path: path.join(ROOT, ".dev.vars") });

const SUPPORTED_LANGS = ["en", "ko", "zh-CN", "zh-TW"] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

const DATASET_NAME_PREFIX = "autocolor-classification";
const PAGE_SIZE = 100;

type EvalCase = {
  id: string;
  tag: string;
  categories: Array<{ name: string; keywords: string[]; colorId: string }>;
  event: { summary?: string; description?: string; location?: string };
  expected: { category_name: string };
};

type EvalSuite = {
  schema_version: number;
  task: string;
  lang?: string;
  description?: string;
  cases: EvalCase[];
};

type CliArgs = {
  langs: Lang[];
  allowIdDrift: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0) {
    throw new Error(
      `usage: sync-langfuse-dataset.ts <lang|all> [--allow-id-drift]\n` +
        `  lang ∈ {${SUPPORTED_LANGS.join(", ")}}`,
    );
  }
  const out: CliArgs = { langs: [], allowIdDrift: false };
  for (const a of argv) {
    if (a === "--allow-id-drift") {
      out.allowIdDrift = true;
    } else if (a === "all") {
      out.langs = [...SUPPORTED_LANGS];
    } else if ((SUPPORTED_LANGS as readonly string[]).includes(a)) {
      out.langs.push(a as Lang);
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        `usage: sync-langfuse-dataset.ts <lang|all> [--allow-id-drift]\n` +
          `  lang ∈ {${SUPPORTED_LANGS.join(", ")}}\n`,
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (out.langs.length === 0) {
    throw new Error("no language specified — pass <lang|all>");
  }
  return out;
}

// .dev.vars values may be wrapped in double quotes (`KEY="value"`); the
// dotenv parser preserves the quotes verbatim, so strip them here so the
// HTTP layer receives the bare token.
function stripQuotes(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.replace(/^"|"$/g, "");
}

function buildClient(): LangfuseClient {
  const publicKey = stripQuotes(process.env["LANGFUSE_PUBLIC_KEY"]);
  const secretKey = stripQuotes(process.env["LANGFUSE_SECRET_KEY"]);
  const baseUrl =
    stripQuotes(process.env["LANGFUSE_BASE_URL"]) || "https://cloud.langfuse.com";
  if (!publicKey || !secretKey) {
    throw new Error(
      "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set in .dev.vars",
    );
  }
  return new LangfuseClient({ publicKey, secretKey, baseUrl });
}

function buildEvent(c: EvalCase): CalendarEvent {
  // Mirror `run-classification-eval.ts:buildEvent` so the dataset item
  // input is byte-identical to what the runner will send the model.
  const e: CalendarEvent = { id: c.id };
  if (c.event.summary !== undefined) e.summary = c.event.summary;
  if (c.event.description !== undefined) e.description = c.event.description;
  if (c.event.location !== undefined) e.location = c.event.location;
  return e;
}

function buildItemInput(c: EvalCase): unknown {
  const redacted = redactEventForLlm(buildEvent(c));
  return {
    categories: c.categories.map((cat) => ({ name: cat.name, keywords: cat.keywords })),
    event: {
      summary: redacted.summary ?? "",
      description: redacted.description ?? "",
      location: redacted.location ?? "",
    },
  };
}

function datasetItemId(lang: Lang, caseId: string): string {
  // Langfuse enforces project-wide uniqueness on dataset item ids
  // (see `CreateDatasetItemRequest.id` doc), but the local `case.id`
  // is intentionally identical across the 4 sibling language files for
  // cross-lingual comparison. Namespace by `<lang>-` to satisfy
  // Langfuse, and keep the raw `case.id` in metadata so cross-lingual
  // queries still work.
  return `${lang}-${caseId}`;
}

type RemoteItem = { id: string; metadata: unknown };

async function listAllItems(
  client: LangfuseClient,
  datasetName: string,
): Promise<RemoteItem[]> {
  const all: RemoteItem[] = [];
  for (let page = 1; ; page++) {
    const resp = await client.api.datasetItems.list({ datasetName, page, limit: PAGE_SIZE });
    const data = resp.data ?? [];
    for (const item of data) {
      all.push({ id: item.id, metadata: item.metadata });
    }
    const total = resp.meta?.totalItems ?? all.length;
    if (all.length >= total || data.length === 0) break;
  }
  return all;
}

async function ensureDataset(
  client: LangfuseClient,
  datasetName: string,
): Promise<{ created: boolean }> {
  try {
    await client.api.datasets.get(datasetName);
    return { created: false };
  } catch (err) {
    // LangfuseAPIError exposes statusCode; on 404 fall through to create.
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode !== 404) throw err;
  }
  await client.api.datasets.create({
    name: datasetName,
    description:
      `AutoColor classification eval — ${datasetName}. ` +
      `Synced from evals/datasets/<lang>/classification.json via ` +
      `evals/scripts/sync-langfuse-dataset.ts. See ADR-0001.`,
  });
  return { created: true };
}

async function syncOneLang(
  client: LangfuseClient,
  lang: Lang,
  allowIdDrift: boolean,
): Promise<{ added: number; updated: number; skipped: number }> {
  const taskFile = path.join(ROOT, "evals", "datasets", lang, "classification.json");
  const raw = await fs.readFile(taskFile, "utf8");
  const suite = JSON.parse(raw) as EvalSuite;
  if (suite.lang !== undefined && suite.lang !== lang) {
    throw new Error(
      `dataset file ${taskFile} declares lang=${suite.lang}, expected ${lang}`,
    );
  }

  const datasetName = `${DATASET_NAME_PREFIX}-${lang}`;
  const { created } = await ensureDataset(client, datasetName);
  if (created) console.log(`  created dataset ${datasetName}`);

  const remote = created ? [] : await listAllItems(client, datasetName);
  const remoteIds = new Set(remote.map((r) => r.id));
  const localIds = new Set(suite.cases.map((c) => datasetItemId(lang, c.id)));

  const added: string[] = [];
  const removed: string[] = [];
  for (const id of localIds) if (!remoteIds.has(id)) added.push(id);
  for (const id of remoteIds) if (!localIds.has(id)) removed.push(id);

  if (added.length + removed.length > 0 && !created) {
    console.log(
      `  drift: ${added.length} added, ${removed.length} removed in ${datasetName}`,
    );
    if (!allowIdDrift) {
      const head = (xs: string[]) => xs.slice(0, 10);
      console.error(`\n✗ case.id drift detected in ${datasetName}:`);
      if (added.length > 0) {
        console.error(`  added (${added.length}):`);
        for (const id of head(added)) console.error(`    + ${id}`);
        if (added.length > 10) console.error(`    … ${added.length - 10} more`);
      }
      if (removed.length > 0) {
        console.error(`  removed (${removed.length}):`);
        for (const id of head(removed)) console.error(`    - ${id}`);
        if (removed.length > 10) console.error(`    … ${removed.length - 10} more`);
      }
      console.error(
        `\nRe-run with --allow-id-drift to apply, or bump the dataset name.`,
      );
      process.exit(1);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;
  for (const c of suite.cases) {
    const id = datasetItemId(lang, c.id);
    const isNew = !remoteIds.has(id);
    await client.api.datasetItems.create({
      datasetName,
      id,
      input: buildItemInput(c),
      expectedOutput: { category_name: c.expected.category_name },
      metadata: { tag: c.tag, lang, case_id: c.id },
    });
    if (isNew) addedCount++;
    else updatedCount++;
  }

  return { added: addedCount, updated: updatedCount, skipped: 0 };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = buildClient();

  for (const lang of args.langs) {
    console.log(`\nsyncing ${lang}…`);
    const summary = await syncOneLang(client, lang, args.allowIdDrift);
    console.log(
      `  ${lang}: ${summary.added} added, ${summary.updated} updated, ${summary.skipped} skipped`,
    );
  }
  console.log("\nsync done.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

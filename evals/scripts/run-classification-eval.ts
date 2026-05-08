#!/usr/bin/env tsx
/**
 * Layer 3 — semantic classification eval (offline operator script).
 *
 * Runs each case in `evals/tasks/classification-semantic.json` against the
 * live OpenAI API using the production prompt builder + parser, then appends
 * one ledger row to `evals/agent-results.json`.
 *
 * Usage:
 *   pnpm tsx evals/scripts/run-classification-eval.ts
 *   # OPENAI_API_KEY can come from env or .dev.vars
 *
 * Cost: ~20 cases × (~3K input + ≤64 completion tokens) per run, well under
 * $0.02 against gpt-5.4-nano. Bypasses `reserveLlmCall` — this is operator
 * budget, separate from the per-user runtime cap.
 *
 * Exit code: 0 when all `user-report-*` cases pass AND overall pass-rate
 * ≥ 90%; otherwise 1 (suitable for "merge gate" use).
 */
import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import type { Category } from "../../src/services/classifier";
import type { CalendarEvent } from "../../src/services/googleCalendar";
import { buildPrompt, parseCategoryName } from "../../src/services/llmClassifier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const TASK_FILE = path.join(ROOT, "evals/tasks/classification-semantic.json");
const RESULTS_FILE = path.join(ROOT, "evals/agent-results.json");
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-5.4-nano";
const MAX_COMPLETION_TOKENS = 64;
const TIMEOUT_MS = 15_000;
const PASS_RATE_THRESHOLD = 0.9;

loadEnv({ path: path.join(ROOT, ".dev.vars") });

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
  description?: string;
  cases: EvalCase[];
};

type LedgerRow = {
  run_id: string;
  timestamp: string;
  git_sha: string;
  kind: string;
  tool: string;
  score: number;
  max: number;
  grade: string | null;
  categories: Record<string, string> | null;
  task_pass_rate: number | null;
  notes: string;
};

type Ledger = {
  schema_version: number;
  description: string;
  runs: LedgerRow[];
  next?: unknown;
};

type CaseResult = {
  id: string;
  tag: string;
  pass: boolean;
  expected: string;
  got: string;
};

function requireApiKey(): string {
  const k = process.env["OPENAI_API_KEY"];
  if (!k) {
    throw new Error(
      "OPENAI_API_KEY not set — provide via env or .dev.vars before running this eval.",
    );
  }
  return k;
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function buildCategory(
  c: EvalCase["categories"][number],
  i: number,
): Category {
  return {
    id: `c-${i}`,
    name: c.name,
    colorId: c.colorId,
    keywords: c.keywords,
    priority: 100 + i,
  };
}

function buildEvent(c: EvalCase): CalendarEvent {
  // exactOptionalPropertyTypes: assign optional fields only when present
  // so `undefined` is never explicitly written into the type.
  const e: CalendarEvent = { id: c.id };
  if (c.event.summary !== undefined) e.summary = c.event.summary;
  if (c.event.description !== undefined) e.description = c.event.description;
  if (c.event.location !== undefined) e.location = c.event.location;
  return e;
}

async function callOpenAi(
  apiKey: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "classification",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["category_name"],
              properties: { category_name: { type: "string" } },
            },
          },
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("missing content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function runCase(apiKey: string, c: EvalCase): Promise<CaseResult> {
  const cats = c.categories.map(buildCategory);
  const messages = buildPrompt(buildEvent(c), cats);
  let got: string;
  try {
    const raw = await callOpenAi(apiKey, messages);
    const parsed = parseCategoryName(raw);
    if (parsed === undefined) got = "<bad_response>";
    else if (parsed === null) got = "none";
    else got = parsed;
  } catch (err) {
    got = `<error:${err instanceof Error ? err.message : String(err)}>`;
  }
  return {
    id: c.id,
    tag: c.tag,
    expected: c.expected.category_name,
    got,
    pass: got === c.expected.category_name,
  };
}

async function appendLedgerRow(
  passCount: number,
  total: number,
  failedUserReports: number,
): Promise<void> {
  const ledger = JSON.parse(await fs.readFile(RESULTS_FILE, "utf8")) as Ledger;
  const passRate = total === 0 ? 0 : passCount / total;
  const today = new Date().toISOString().slice(0, 10);
  ledger.runs.push({
    run_id: `${today}-classification-semantic`,
    timestamp: new Date().toISOString(),
    git_sha: gitSha(),
    kind: "task_pass_rate",
    tool: "classification-semantic-eval",
    score: passCount,
    max: total,
    grade: null,
    categories: null,
    task_pass_rate: Number(passRate.toFixed(3)),
    notes:
      `model=${MODEL}; cases tagged user-report-2026-05-08 must all pass` +
      (failedUserReports > 0 ? ` (FAILED: ${failedUserReports})` : ""),
  });
  await fs.writeFile(RESULTS_FILE, JSON.stringify(ledger, null, 2) + "\n");
}

async function main(): Promise<void> {
  const apiKey = requireApiKey();
  const suite = JSON.parse(await fs.readFile(TASK_FILE, "utf8")) as EvalSuite;
  console.log(`Running ${suite.cases.length} cases against ${MODEL}…\n`);

  const results: CaseResult[] = [];
  for (const c of suite.cases) {
    const r = await runCase(apiKey, c);
    results.push(r);
    const mark = r.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}  [${r.tag}]  ${r.id}: expected=${r.expected} got=${r.got}`);
  }

  const passCount = results.filter((r) => r.pass).length;
  const total = results.length;
  const passRate = total === 0 ? 0 : passCount / total;
  console.log(`\nPass: ${passCount}/${total} (${(passRate * 100).toFixed(1)}%)`);

  const userReportFails = results.filter(
    (r) => !r.pass && r.tag.includes("user-report"),
  );
  if (userReportFails.length > 0) {
    console.error(
      `\n⚠ ${userReportFails.length} user-report case(s) failed — merge BLOCKED:`,
    );
    for (const f of userReportFails) {
      console.error(`   ${f.id}: expected=${f.expected} got=${f.got}`);
    }
  }

  await appendLedgerRow(passCount, total, userReportFails.length);
  console.log(`\nLedger row appended: ${RESULTS_FILE}`);

  if (userReportFails.length > 0 || passRate < PASS_RATE_THRESHOLD) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

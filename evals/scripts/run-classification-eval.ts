#!/usr/bin/env tsx
/**
 * Layer 3 — semantic classification eval (offline operator script).
 *
 * Runs each case in a dataset file against the live OpenAI API using the
 * production prompt builder + parser, then appends one ledger row to
 * `evals/agent-results.json`.
 *
 * Usage:
 *   pnpm tsx evals/scripts/run-classification-eval.ts
 *     # default — uses evals/tasks/classification-semantic.json (90% gate)
 *
 *   pnpm tsx evals/scripts/run-classification-eval.ts \
 *     --task-file evals/datasets/en/classification.json --include-rule-leg
 *     # multilingual dataset — threshold + blocking tags read from the
 *     # dataset's `evaluator` field; rule leg is also measured
 *
 * Cost: ~20 cases × (~3K input + ≤64 completion tokens) per run, well under
 * $0.02 against gpt-5.4-nano. Bypasses `reserveLlmCall` — this is operator
 * budget, separate from the per-user runtime cap.
 *
 * Exit code: 0 when all blocking-tag cases pass AND overall pass-rate
 * ≥ threshold; otherwise 1 (suitable for "merge gate" use).
 */
import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import { classifyEvent, type Category } from "../../src/services/classifier";
import type { CalendarEvent } from "../../src/services/googleCalendar";
import {
  buildPrompt,
  DEFAULT_CLASSIFIER_PROMPT_VERSION,
  LLM_MODEL as PRODUCTION_MODEL,
  parseCategoryName,
  type ClassifierPromptVersion,
} from "../../src/services/llmClassifier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_TASK_FILE = path.join(ROOT, "evals/tasks/classification-semantic.json");
const RESULTS_FILE = path.join(ROOT, "evals/agent-results.json");
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MAX_COMPLETION_TOKENS = 64;
const TIMEOUT_MS = 60_000;
const DEFAULT_PASS_RATE_THRESHOLD = 0.9;
const DEFAULT_BLOCKING_TAG_PREFIX = "user-report-";
const VALID_PROMPT_VERSIONS: readonly ClassifierPromptVersion[] = ["v2", "v3"];

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
  // Optional fields added by the multilingual dataset builder.
  lang?: string;
  evaluator?: { threshold?: number; blocking_tags?: string[] };
  cases: EvalCase[];
};

type CliArgs = {
  taskFile: string;
  includeRuleLeg: boolean;
  reasoningEffort: string | undefined;
  maxCompletionTokens: number;
  model: string;
  promptVersion: ClassifierPromptVersion;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    taskFile: DEFAULT_TASK_FILE,
    includeRuleLeg: false,
    reasoningEffort: undefined,
    maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS,
    model: PRODUCTION_MODEL,
    promptVersion: DEFAULT_CLASSIFIER_PROMPT_VERSION,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--task-file") {
      const next = argv[++i];
      if (!next) throw new Error("--task-file requires a path");
      out.taskFile = path.isAbsolute(next) ? next : path.resolve(process.cwd(), next);
    } else if (a === "--include-rule-leg") {
      out.includeRuleLeg = true;
    } else if (a === "--reasoning-effort") {
      const next = argv[++i];
      if (!next) throw new Error("--reasoning-effort requires a value");
      out.reasoningEffort = next;
    } else if (a === "--max-completion-tokens") {
      const next = argv[++i];
      if (!next) throw new Error("--max-completion-tokens requires a value");
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --max-completion-tokens: ${next}`);
      out.maxCompletionTokens = n;
    } else if (a === "--model") {
      const next = argv[++i];
      if (!next) throw new Error("--model requires a value");
      out.model = next;
    } else if (a === "--prompt-version") {
      const next = argv[++i];
      if (!next) throw new Error("--prompt-version requires a value");
      if (!(VALID_PROMPT_VERSIONS as readonly string[]).includes(next)) {
        throw new Error(
          `invalid --prompt-version: ${next} (expected one of ${VALID_PROMPT_VERSIONS.join(", ")})`,
        );
      }
      out.promptVersion = next as ClassifierPromptVersion;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: run-classification-eval.ts [--task-file <path>] [--include-rule-leg] " +
          "[--reasoning-effort <value>] [--max-completion-tokens <n>] " +
          "[--model <id>] [--prompt-version v2|v3]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

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
  // Populated only when --include-rule-leg is set.
  rule?: { hit: boolean; categoryName: string | null; pass: boolean };
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
  reasoningEffort: string | undefined,
  maxCompletionTokens: number,
  model: string,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_completion_tokens: maxCompletionTokens,
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
    };
    if (reasoningEffort !== undefined) body.reasoning_effort = reasoningEffort;
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
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

async function runCase(
  apiKey: string,
  c: EvalCase,
  opts: {
    includeRuleLeg: boolean;
    reasoningEffort: string | undefined;
    maxCompletionTokens: number;
    model: string;
    promptVersion: ClassifierPromptVersion;
  },
): Promise<CaseResult> {
  const cats = c.categories.map(buildCategory);
  const event = buildEvent(c);

  let rule: CaseResult["rule"];
  if (opts.includeRuleLeg) {
    const ruleResult = await classifyEvent(event, { userId: "eval", categories: cats });
    if (ruleResult === null) {
      rule = { hit: false, categoryName: null, pass: c.expected.category_name === "none" };
    } else {
      const matched = cats.find((cat) => cat.id === ruleResult.categoryId);
      const name = matched?.name ?? null;
      rule = { hit: true, categoryName: name, pass: name === c.expected.category_name };
    }
  }

  const messages = buildPrompt(event, cats, opts.promptVersion);
  let got: string;
  try {
    const raw = await callOpenAi(apiKey, messages, opts.reasoningEffort, opts.maxCompletionTokens, opts.model);
    const parsed = parseCategoryName(raw);
    if (parsed === undefined) got = "<bad_response>";
    else if (parsed === null) got = "none";
    else got = parsed;
  } catch (err) {
    got = `<error:${err instanceof Error ? err.message : String(err)}>`;
  }
  const result: CaseResult = {
    id: c.id,
    tag: c.tag,
    expected: c.expected.category_name,
    got,
    pass: got === c.expected.category_name,
  };
  if (rule) result.rule = rule;
  return result;
}

async function appendLedgerRow(
  suite: EvalSuite,
  taskFile: string,
  results: CaseResult[],
  blockingFailCount: number,
  ruleStats: { ruleHits: number; rulePassCount: number } | null,
  reasoningEffort: string | undefined,
  maxCompletionTokens: number,
  model: string,
  promptVersion: ClassifierPromptVersion,
): Promise<void> {
  const ledger = JSON.parse(await fs.readFile(RESULTS_FILE, "utf8")) as Ledger;
  const passCount = results.filter((r) => r.pass).length;
  const total = results.length;
  const passRate = total === 0 ? 0 : passCount / total;
  const today = new Date().toISOString().slice(0, 10);
  const langSuffix = suite.lang ? `-${suite.lang}` : "";
  const effortSuffix = reasoningEffort ? `-effort-${reasoningEffort}` : "";
  const capSuffix = maxCompletionTokens !== DEFAULT_MAX_COMPLETION_TOKENS ? `-cap${maxCompletionTokens}` : "";
  // Only stamp the model + prompt-version into the run_id when the runner
  // drifts off production defaults — otherwise the prior baseline ids keep
  // their original shape so dashboards / docs/ai-readiness-map.html joins
  // do not break.
  const modelSuffix = model === PRODUCTION_MODEL ? "" : `-${model}`;
  const promptSuffix =
    promptVersion === DEFAULT_CLASSIFIER_PROMPT_VERSION ? "" : `-prompt-${promptVersion}`;
  // Preserve the historical ledger tool string for the original hand-crafted
  // suite (no `lang` field) so trend reads in docs/ai-readiness-map.html
  // don't have to merge two ids.
  const tool = suite.lang ? `${suite.task}${langSuffix}-eval` : "classification-semantic-eval";
  const datasetBasename = path.relative(ROOT, taskFile);
  const noteParts = [
    `model=${model}`,
    `prompt_version=${promptVersion}`,
    `dataset=${datasetBasename}`,
  ];
  if (suite.lang) noteParts.push(`lang=${suite.lang}`);
  if (reasoningEffort) noteParts.push(`reasoning_effort=${reasoningEffort}`);
  if (maxCompletionTokens !== DEFAULT_MAX_COMPLETION_TOKENS) noteParts.push(`max_completion_tokens=${maxCompletionTokens}`);
  if (ruleStats) {
    noteParts.push(
      `rule_hit=${ruleStats.ruleHits}/${total}`,
      `rule_pass=${ruleStats.rulePassCount}/${total}`,
    );
  }
  if (blockingFailCount > 0) noteParts.push(`blocking_failed=${blockingFailCount}`);
  ledger.runs.push({
    run_id: `${today}-${suite.task}${langSuffix}${modelSuffix}${promptSuffix}${effortSuffix}${capSuffix}`,
    timestamp: new Date().toISOString(),
    git_sha: gitSha(),
    kind: "task_pass_rate",
    tool,
    score: passCount,
    max: total,
    grade: null,
    categories: null,
    task_pass_rate: Number(passRate.toFixed(3)),
    notes: noteParts.join("; "),
  });
  await fs.writeFile(RESULTS_FILE, JSON.stringify(ledger, null, 2) + "\n");
}

function isBlockingFail(tag: string, blockingTags: string[] | null): boolean {
  if (blockingTags) return blockingTags.some((t) => tag.includes(t));
  return tag.includes(DEFAULT_BLOCKING_TAG_PREFIX);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = requireApiKey();
  const suite = JSON.parse(await fs.readFile(args.taskFile, "utf8")) as EvalSuite;

  const threshold = suite.evaluator?.threshold ?? DEFAULT_PASS_RATE_THRESHOLD;
  const blockingTags = suite.evaluator?.blocking_tags ?? null; // null → default `user-report-` prefix
  const langLabel = suite.lang ? ` lang=${suite.lang}` : "";
  const effortLabel = args.reasoningEffort ? ` effort=${args.reasoningEffort}` : "";
  console.log(
    `Running ${suite.cases.length} cases against ${args.model} (prompt=${args.promptVersion})${langLabel}${effortLabel} ` +
      `(threshold=${threshold}, dataset=${path.relative(ROOT, args.taskFile)})…\n`,
  );

  const results: CaseResult[] = [];
  for (const c of suite.cases) {
    const r = await runCase(apiKey, c, {
      includeRuleLeg: args.includeRuleLeg,
      reasoningEffort: args.reasoningEffort,
      maxCompletionTokens: args.maxCompletionTokens,
      model: args.model,
      promptVersion: args.promptVersion,
    });
    results.push(r);
    const mark = r.pass ? "PASS" : "FAIL";
    const ruleSuffix = r.rule
      ? ` rule=${r.rule.hit ? r.rule.categoryName : "<miss>"}`
      : "";
    console.log(
      `  ${mark}  [${r.tag}]  ${r.id}: expected=${r.expected} got=${r.got}${ruleSuffix}`,
    );
  }

  const passCount = results.filter((r) => r.pass).length;
  const total = results.length;
  const passRate = total === 0 ? 0 : passCount / total;
  console.log(`\nPass: ${passCount}/${total} (${(passRate * 100).toFixed(1)}%)`);

  let ruleStats: { ruleHits: number; rulePassCount: number } | null = null;
  if (args.includeRuleLeg) {
    const ruleHits = results.filter((r) => r.rule?.hit).length;
    const rulePassCount = results.filter((r) => r.rule?.pass).length;
    ruleStats = { ruleHits, rulePassCount };
    console.log(
      `Rule leg: hit=${ruleHits}/${total} (${((ruleHits / total) * 100).toFixed(1)}%), ` +
        `pass=${rulePassCount}/${total} (${((rulePassCount / total) * 100).toFixed(1)}%)`,
    );
  }

  const blockingFails = results.filter((r) => !r.pass && isBlockingFail(r.tag, blockingTags));
  if (blockingFails.length > 0) {
    const tagDesc = blockingTags
      ? `tags ${JSON.stringify(blockingTags)}`
      : `cases tagged ${DEFAULT_BLOCKING_TAG_PREFIX}*`;
    console.error(
      `\n⚠ ${blockingFails.length} blocking case(s) failed (${tagDesc}) — merge BLOCKED:`,
    );
    for (const f of blockingFails) {
      console.error(`   ${f.id}: expected=${f.expected} got=${f.got}`);
    }
  }

  await appendLedgerRow(
    suite,
    args.taskFile,
    results,
    blockingFails.length,
    ruleStats,
    args.reasoningEffort,
    args.maxCompletionTokens,
    args.model,
    args.promptVersion,
  );
  console.log(`\nLedger row appended: ${RESULTS_FILE}`);

  if (blockingFails.length > 0 || passRate < threshold) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

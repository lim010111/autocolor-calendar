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
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { LangfuseClient } from "@langfuse/client";

import type { CalendarEvent } from "../../src/services/googleCalendar";
import {
  buildPrompt,
  DEFAULT_CLASSIFIER_PROMPT_VERSION,
  LLM_MODEL as PRODUCTION_MODEL,
  parseCategoryName,
  type ClassifierPromptVersion,
} from "../../src/services/llmClassifier";
import { redactEventForLlm } from "../../src/services/piiRedactor";
import { synthesizeSeeds, type Rule } from "../../src/services/ruleService";

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
const VALID_PROMPT_VERSIONS: readonly ClassifierPromptVersion[] = [
  "v2",
  "v3",
  "v4-light-A",
  "v4-light-B",
  "v4-light-C",
  "v4-ko",
  "v4-zh-CN",
  "v4-zh-TW",
  // v5 family — gpt-5.4-nano prompt-dimension experiment 2026-05-13. See
  // `.claude/handoffs/gpt-5.4-nano-prompt-tuning-2026-05-13.md`.
  "v5-L1",
  "v5-L2",
  "v5-L4",
  "v5-L5",
  // v6 — ADR-0004 #05 examples-field line (2026-07-17).
  "v6",
];
const LANGFUSE_PROMPT_NAME_PREFIX = "autocolor-classifier";
const LANGFUSE_PROMPT_LABEL = "eval";
type PromptSource = "file" | "langfuse";
const VALID_PROMPT_SOURCES: readonly PromptSource[] = ["file", "langfuse"];

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
  promptSource: PromptSource;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    taskFile: DEFAULT_TASK_FILE,
    includeRuleLeg: false,
    reasoningEffort: undefined,
    maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS,
    model: PRODUCTION_MODEL,
    promptVersion: DEFAULT_CLASSIFIER_PROMPT_VERSION,
    promptSource: "file",
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
    } else if (a === "--prompt-source") {
      const next = argv[++i];
      if (!next) throw new Error("--prompt-source requires a value");
      if (!(VALID_PROMPT_SOURCES as readonly string[]).includes(next)) {
        throw new Error(
          `invalid --prompt-source: ${next} (expected one of ${VALID_PROMPT_SOURCES.join(", ")})`,
        );
      }
      out.promptSource = next as PromptSource;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: run-classification-eval.ts [--task-file <path>] [--include-rule-leg] " +
          "[--reasoning-effort <value>] [--max-completion-tokens <n>] " +
          "[--model <id>] [--prompt-version v2|v3|v5-L1|…] " +
          "[--prompt-source file|langfuse]",
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
  // §4 trace-payload fields (per ADR-0001). Populated for every case so a
  // downstream sink (e.g. Langfuse) can read them without re-running the
  // model. `got` keeps the human-readable normalised form for stdout +
  // ledger; `parsed` keeps the parser's raw return so the trace can show
  // `null` (miss) vs `undefined` (bad_response) faithfully.
  parsed: string | null | undefined;
  rawResponse: string;
  httpStatus: number;
  latencyMs: number;
  attempts: number;
  promptSummary: string;
  // First 16 hex chars of sha256(systemPromptText). Same value for every
  // case in a run; carried here so a per-case trace stands alone.
  promptSha256Prefix: string;
  // Per-case usage telemetry — populated only on outcomes where the OpenAI
  // call returned a body (`hit` / `miss` / `bad_response` / `http_error`).
  // `null` for timeouts and the rare malformed-response case where parsing
  // `usage` itself fails. Used by §10 nano-prompt-experiment to attribute
  // cost (reasoning_tokens) to the same case whose accuracy we measure.
  reasoningTokens: number | null;
  completionTokens: number | null;
  // Populated only when --include-rule-leg is set.
  rule?: { hit: boolean; categoryName: string | null; pass: boolean };
};

type OpenAiCallTelemetry = {
  rawBody: string;
  httpStatus: number;
  latencyMs: number;
  // §10 nano-prompt-experiment: `completion_tokens_details.reasoning_tokens`
  // is the o-series / gpt-5-nano hidden reasoning-token count; pairs with
  // top-level `completion_tokens` to form the (cost, accuracy) frontier
  // captured in the ledger 4-tuple.
  reasoningTokens: number | null;
  completionTokens: number | null;
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

// ── Langfuse prompt-source helper (ADR-0003) ────────────────────────────
//
// When the runner is invoked with `--prompt-source langfuse`, the system
// prompt body is pulled from Langfuse Prompt Management instead of the
// embedded `_generated.ts` bundle. Production code (`buildPrompt` in
// `src/services/llmClassifier.ts`) keeps reading the file source — only
// the runner has this Langfuse path. Failure here is HARD: if the
// operator explicitly asked for the Langfuse copy and we can't get it,
// silently falling back to the file copy would defeat the measurement.
function leverIdFromVersion(version: ClassifierPromptVersion): string | null {
  // `v5-L1` → `L1`. Used as a per-trace `lever:L<n>` tag so the Langfuse
  // Run Comparison chart auto-segregates the v5 experiment cells.
  const m = version.match(/-(L\d+)$/);
  return m ? m[1]! : null;
}

async function fetchLangfusePromptBody(
  version: ClassifierPromptVersion,
): Promise<string> {
  const publicKey = stripQuotes(process.env["LANGFUSE_PUBLIC_KEY"]);
  const secretKey = stripQuotes(process.env["LANGFUSE_SECRET_KEY"]);
  const baseUrl =
    stripQuotes(process.env["LANGFUSE_BASE_URL"]) ||
    "https://cloud.langfuse.com";
  if (!publicKey || !secretKey) {
    throw new Error(
      "--prompt-source langfuse requires LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in .dev.vars",
    );
  }
  const client = new LangfuseClient({ publicKey, secretKey, baseUrl });
  const name = `${LANGFUSE_PROMPT_NAME_PREFIX}-${version}`;
  const fetched = await client.prompt.get(name, {
    label: LANGFUSE_PROMPT_LABEL,
    cacheTtlSeconds: 0,
  });
  if (typeof fetched.prompt !== "string") {
    throw new Error(
      `langfuse prompt ${name} returned non-text content (chat prompt?)`,
    );
  }
  return fetched.prompt;
}

// ── Langfuse sink (ADR-0001) ────────────────────────────────────────────
//
// Soft-dep observability for the eval runner. Failure to construct the
// client, send a trace, or flush at end-of-run MUST NOT change the merge-
// gate exit code, stdout PASS/FAIL block, or ledger row — those are
// determined exclusively from the in-memory `CaseResult[]`. The sink emits
// at most one warn line per failure category and latches off on init
// failure so a missing key does not flood stderr with N case errors.
//
// Mechanism: the legacy `client.api.ingestion.batch` endpoint accepts
// trace-create + span-create + score-create events in one call. The
// dataset-item linkage is a separate `datasetRunItems.create` call
// (only fired when the suite has a recognised `lang`). No OTel setup —
// `@langfuse/tracing` is not used here.
const SUPPORTED_LANGS_FOR_LANGFUSE = ["en", "ko", "zh-CN", "zh-TW"] as const;
const LANGFUSE_DATASET_PREFIX = "autocolor-classification";

function stripQuotes(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.replace(/^"|"$/g, "");
}

type LangfuseSinkConfig = {
  runName: string;
  runDescription: string;
  datasetName: string | null;
};

type LangfuseRecordPayload = {
  caseResult: CaseResult;
  runOpts: {
    model: string;
    promptVersion: ClassifierPromptVersion;
    promptSource: PromptSource;
    reasoningEffort: string | undefined;
    maxCompletionTokens: number;
    lang: string | null;
  };
};

class LangfuseSink {
  private client: LangfuseClient | null = null;
  private latchedOff = false;
  private cfg: LangfuseSinkConfig;
  private firstTraceId: string | null = null;
  private baseUrl: string | null = null;
  private successCount = 0;

  constructor(cfg: LangfuseSinkConfig) {
    this.cfg = cfg;
  }

  /**
   * Lazy-init: returns the client if keys are present and the constructor
   * succeeds; otherwise latches off (silently — keys absent is a valid
   * state per ADR-0001, not a failure). Init errors with keys *present*
   * emit one warn and latch.
   */
  private ensureClient(): LangfuseClient | null {
    if (this.client) return this.client;
    if (this.latchedOff) return null;
    const publicKey = stripQuotes(process.env["LANGFUSE_PUBLIC_KEY"]);
    const secretKey = stripQuotes(process.env["LANGFUSE_SECRET_KEY"]);
    const baseUrl =
      stripQuotes(process.env["LANGFUSE_BASE_URL"]) ||
      "https://cloud.langfuse.com";
    if (!publicKey || !secretKey) {
      this.latchedOff = true;
      return null;
    }
    try {
      this.client = new LangfuseClient({ publicKey, secretKey, baseUrl });
      this.baseUrl = baseUrl;
      return this.client;
    } catch (err) {
      console.warn(
        `langfuse: client init failed (${err instanceof Error ? err.message : String(err)}); telemetry disabled for this run`,
      );
      this.latchedOff = true;
      return null;
    }
  }

  async record(p: LangfuseRecordPayload): Promise<void> {
    const client = this.ensureClient();
    if (!client) return;
    const { caseResult: cr, runOpts } = p;
    const traceId = randomUUID();
    const spanId = randomUUID();
    const scoreId = randomUUID();
    if (!this.firstTraceId) this.firstTraceId = traceId;
    const traceName = `classify ${cr.id}`;
    const outcome =
      cr.got.startsWith("<error:") ? "error"
        : cr.got === "<bad_response>" ? "bad_response"
        : cr.got === "none" ? "miss"
        : "hit";
    const ts = new Date().toISOString();
    const startTime = new Date(Date.now() - cr.latencyMs).toISOString();
    const endTime = ts;

    // The post-redactEventForLlm user-message JSON is already serialised
    // in `promptSummary`. Re-parse it for the trace `input` so the UI
    // shows structured data rather than a string blob.
    let traceInput: unknown;
    try {
      traceInput = JSON.parse(cr.promptSummary);
    } catch {
      traceInput = cr.promptSummary;
    }
    const traceOutput = { parsed: cr.parsed ?? null, raw_response: cr.rawResponse };
    const leverId = leverIdFromVersion(runOpts.promptVersion);
    const metadata = {
      prompt_version: runOpts.promptVersion,
      prompt_sha256_prefix: cr.promptSha256Prefix,
      prompt_source: runOpts.promptSource,
      model: runOpts.model,
      reasoning_effort: runOpts.reasoningEffort ?? null,
      max_completion_tokens: runOpts.maxCompletionTokens,
      lang: runOpts.lang,
      case_id: cr.id,
      case_tag: cr.tag,
      lever_id: leverId,
      attempts: cr.attempts,
      latency_ms: cr.latencyMs,
      http_status: cr.httpStatus,
      outcome,
      reasoning_tokens: cr.reasoningTokens,
      completion_tokens: cr.completionTokens,
    };

    try {
      await client.api.ingestion.batch({
        batch: [
          {
            type: "trace-create",
            id: randomUUID(),
            timestamp: ts,
            body: {
              id: traceId,
              timestamp: ts,
              name: traceName,
              input: traceInput,
              output: traceOutput,
              metadata,
              tags: [
                `lang:${runOpts.lang ?? "n/a"}`,
                `prompt:${runOpts.promptVersion}`,
                `prompt_source:${runOpts.promptSource}`,
                `model:${runOpts.model}`,
                `outcome:${outcome}`,
                ...(leverId ? [`lever:${leverId}`] : []),
                ...(runOpts.reasoningEffort ? [`effort:${runOpts.reasoningEffort}`] : []),
              ],
            },
          },
          {
            type: "span-create",
            id: randomUUID(),
            timestamp: ts,
            body: {
              id: spanId,
              traceId,
              name: "openai.chat.completions",
              startTime,
              endTime,
              input: traceInput,
              output: traceOutput,
              metadata,
            },
          },
          {
            type: "score-create",
            id: randomUUID(),
            timestamp: ts,
            body: {
              id: scoreId,
              traceId,
              name: "pass",
              value: cr.pass ? 1 : 0,
              dataType: "NUMERIC",
              ...(cr.pass
                ? {}
                : { comment: `expected=${cr.expected} got=${cr.got}` }),
            },
          },
          // §10 nano-prompt-experiment custom scores. Per-trace numeric
          // scores let Langfuse's Run Comparison chart compute run-mean
          // (accuracy = mean of `pass`, bad_response_rate = mean of
          // `bad_response`, reasoning-token aggregates over the run).
          // `reasoning_tokens` is omitted when the call didn't return a
          // usage body (timeout / pre-flight error) so the run mean isn't
          // skewed by a zero.
          {
            type: "score-create",
            id: randomUUID(),
            timestamp: ts,
            body: {
              id: randomUUID(),
              traceId,
              name: "bad_response",
              value: cr.got === "<bad_response>" ? 1 : 0,
              dataType: "NUMERIC",
            },
          },
          ...(cr.reasoningTokens !== null
            ? [
                {
                  type: "score-create" as const,
                  id: randomUUID(),
                  timestamp: ts,
                  body: {
                    id: randomUUID(),
                    traceId,
                    name: "reasoning_tokens",
                    value: cr.reasoningTokens,
                    dataType: "NUMERIC" as const,
                  },
                },
              ]
            : []),
        ],
      });
      this.successCount++;
    } catch (err) {
      this.warnOnce(
        "trace_post",
        `langfuse: trace post failed (${err instanceof Error ? err.message : String(err)})`,
      );
      return; // skip dataset link if the trace itself failed
    }

    // Layer 4 only — Layer 3's hand-crafted suite has no Langfuse dataset.
    if (this.cfg.datasetName) {
      const datasetItemId = `${runOpts.lang}-${cr.id}`;
      try {
        await client.api.datasetRunItems.create({
          runName: this.cfg.runName,
          runDescription: this.cfg.runDescription,
          datasetItemId,
          traceId,
        });
      } catch (err) {
        this.warnOnce(
          "dataset_link",
          `langfuse: dataset run-item link failed (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
  }

  private warnedKinds = new Set<string>();
  private warnOnce(kind: string, msg: string): void {
    if (this.warnedKinds.has(kind)) return;
    this.warnedKinds.add(kind);
    console.warn(msg);
  }

  /**
   * End-of-run hook. Returns a UI URL when one can be derived, else null.
   * Failure to derive a URL is non-fatal — the eval always exits on its
   * in-memory results, never on Langfuse state. For Layer 4 we look up
   * the projectId once and build a dataset-run URL that groups all of
   * the run's traces; for Layer 3 (no dataset) we fall back to the first
   * trace URL.
   */
  async finalize(): Promise<string | null> {
    const client = this.client;
    if (!client) return null;
    if (this.successCount === 0) return null;
    if (this.cfg.datasetName && this.baseUrl) {
      try {
        const [run, projects] = await Promise.all([
          client.api.datasets.getRun(this.cfg.datasetName, this.cfg.runName),
          client.api.projects.get(),
        ]);
        const projectId = projects.data?.[0]?.id;
        if (projectId) {
          return `${this.baseUrl}/project/${projectId}/datasets/${run.datasetId}/runs/${run.id}`;
        }
      } catch (err) {
        this.warnOnce(
          "run_url",
          `langfuse: run URL fetch failed (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
    if (this.baseUrl && this.firstTraceId) {
      return `${this.baseUrl}/trace/${this.firstTraceId}`;
    }
    return null;
  }
}

function gitShortSha(): string {
  // Already exists for the ledger row; re-using the helper avoids re-shelling.
  return gitSha();
}

function buildLangfuseSinkConfig(
  suite: EvalSuite,
  args: CliArgs,
): LangfuseSinkConfig {
  const sha = gitShortSha();
  const langSuffix = suite.lang ? `-${suite.lang}` : "";
  const effortSuffix = args.reasoningEffort ? `-${args.reasoningEffort}` : "";
  const runName = `${sha}${langSuffix}-${args.promptVersion}${effortSuffix}`;
  const description =
    `Run ${runName} (model=${args.model}, prompt=${args.promptVersion}` +
    (args.reasoningEffort ? `, reasoning_effort=${args.reasoningEffort}` : "") +
    `, dataset=${path.relative(ROOT, args.taskFile)})`;
  const datasetName =
    suite.lang && (SUPPORTED_LANGS_FOR_LANGFUSE as readonly string[]).includes(suite.lang)
      ? `${LANGFUSE_DATASET_PREFIX}-${suite.lang}`
      : null;
  return { runName, runDescription: description, datasetName };
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
): Rule {
  const now = new Date(0);
  return {
    id: `c-${i}`,
    userId: "eval-runner",
    name: c.name,
    colorId: c.colorId,
    keywords: c.keywords,
    priority: 100 + i,
    labelId: null,
    labelDeletedAt: null,
    seeds: synthesizeSeeds({ name: c.name, keywords: c.keywords }),
    createdAt: now,
    updatedAt: now,
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
  telemetry: OpenAiCallTelemetry,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
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
    const rawBody = await res.text();
    telemetry.rawBody = rawBody;
    telemetry.httpStatus = res.status;
    telemetry.latencyMs = Date.now() - start;
    // §10 nano-prompt-experiment: parse usage for BOTH OK and 4xx/5xx
    // bodies — the error case never produces tokens, but the structure is
    // identical so the try/catch is cheap and uniform.
    let usageParsed: {
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    } | undefined;
    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${rawBody.slice(0, 200)}`);
    }
    let json: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: typeof usageParsed;
    };
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new Error("missing content");
    }
    usageParsed = json.usage;
    const reasoning = usageParsed?.completion_tokens_details?.reasoning_tokens;
    const completion = usageParsed?.completion_tokens;
    telemetry.reasoningTokens = typeof reasoning === "number" ? reasoning : null;
    telemetry.completionTokens = typeof completion === "number" ? completion : null;
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("missing content");
    return content;
  } finally {
    if (telemetry.latencyMs === 0) telemetry.latencyMs = Date.now() - start;
    clearTimeout(timer);
  }
}

// Legacy substring rule-leg baseline for `--include-rule-leg` (LLM eval only).
// Production Stage 1 became embedding kNN (ADR-0004 #02) and the production
// `classifier.ts` was deleted; this measurement baseline keeps a self-contained
// copy of the old case-insensitive substring matcher so the LLM eval's optional
// rule-leg comparison still runs. The embedding classifier is measured by the
// separate harness in `evals/embedding-eval/`.
function classifyEventSubstring(
  event: CalendarEvent,
  categories: Array<{ id: string; name: string; colorId: string; keywords: string[] }>,
): { id: string; name: string; colorId: string } | null {
  const summary = event.summary ?? "";
  const description = event.description ?? "";
  if (summary.length === 0 && description.length === 0) return null;
  const haystack = `${summary}\n${description}`.toLowerCase();
  for (const cat of categories) {
    for (const kw of cat.keywords) {
      const needle = kw.toLowerCase();
      if (needle.length === 0) continue;
      if (haystack.includes(needle)) {
        return { id: cat.id, name: cat.name, colorId: cat.colorId };
      }
    }
  }
  return null;
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
    // When provided, this body replaces the system message returned by
    // `buildPrompt`. Set by main() when `--prompt-source langfuse` is
    // active — the body has already been fetched from Langfuse Prompt
    // Management once and is passed through to every case. The user-
    // message JSON, category slicing, and PII redaction still come from
    // `buildPrompt`, so production behaviour is preserved up to the
    // system body swap.
    systemBodyOverride: string | null;
  },
): Promise<CaseResult> {
  const cats = c.categories.map(buildCategory);
  const event = buildEvent(c);

  let rule: CaseResult["rule"];
  if (opts.includeRuleLeg) {
    const ruleResult = classifyEventSubstring(event, cats);
    if (ruleResult === null) {
      rule = { hit: false, categoryName: null, pass: c.expected.category_name === "none" };
    } else {
      const matched = cats.find((cat) => cat.id === ruleResult.id);
      const name = matched?.name ?? null;
      rule = { hit: true, categoryName: name, pass: name === c.expected.category_name };
    }
  }

  // §5.2: buildPrompt requires `RedactedEvent`. Mirror the production LLM
  // leg by redacting first — the redactor is idempotent so prompt bytes
  // are identical to the pre-brand call shape.
  const messages = buildPrompt(redactEventForLlm(event), cats, opts.promptVersion);
  if (opts.systemBodyOverride !== null && messages[0]) {
    messages[0].content = opts.systemBodyOverride;
  }
  const promptSummary = messages[1]?.content ?? "";
  const promptSha256Prefix = createHash("sha256")
    .update(messages[0]?.content ?? "")
    .digest("hex")
    .slice(0, 16);
  const telemetry: OpenAiCallTelemetry = {
    rawBody: "",
    httpStatus: 0,
    latencyMs: 0,
    reasoningTokens: null,
    completionTokens: null,
  };
  let got: string;
  let parsed: string | null | undefined;
  try {
    const raw = await callOpenAi(
      apiKey,
      messages,
      opts.reasoningEffort,
      opts.maxCompletionTokens,
      opts.model,
      telemetry,
    );
    parsed = parseCategoryName(raw);
    if (parsed === undefined) got = "<bad_response>";
    else if (parsed === null) got = "none";
    else got = parsed;
  } catch (err) {
    got = `<error:${err instanceof Error ? err.message : String(err)}>`;
    parsed = undefined;
  }
  const result: CaseResult = {
    id: c.id,
    tag: c.tag,
    expected: c.expected.category_name,
    got,
    pass: got === c.expected.category_name,
    parsed,
    rawResponse: telemetry.rawBody,
    httpStatus: telemetry.httpStatus,
    latencyMs: telemetry.latencyMs,
    attempts: 1,
    promptSummary,
    promptSha256Prefix,
    reasoningTokens: telemetry.reasoningTokens,
    completionTokens: telemetry.completionTokens,
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
  promptSource: PromptSource,
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
    `prompt_source=${promptSource}`,
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
  // §10 nano-prompt-experiment 4-tuple. `accuracy` is redundant with
  // `task_pass_rate` but stated explicitly so the report's cost-narrative
  // table reads stand-alone. Means are computed only over cases that
  // actually produced a usage payload, so a run with zero successful API
  // calls reports `null` instead of NaN.
  const badResponseCount = results.filter((r) => r.got === "<bad_response>").length;
  const badResponseRate = total === 0 ? 0 : badResponseCount / total;
  const reasoningSamples = results
    .map((r) => r.reasoningTokens)
    .filter((v): v is number => typeof v === "number");
  const completionSamples = results
    .map((r) => r.completionTokens)
    .filter((v): v is number => typeof v === "number");
  const meanReasoning =
    reasoningSamples.length === 0
      ? null
      : reasoningSamples.reduce((a, b) => a + b, 0) / reasoningSamples.length;
  const meanCompletion =
    completionSamples.length === 0
      ? null
      : completionSamples.reduce((a, b) => a + b, 0) / completionSamples.length;
  // p95 — nearest-rank method on the sorted sample; cheaper than
  // interpolation and ample for the n=192 dataset. Used by the §4.6
  // winner-gate pre-check P2 (`p95 reasoning_tokens ≤ 60` ⇒ eligible
  // for production cap=64 deployment).
  const p95Reasoning =
    reasoningSamples.length === 0
      ? null
      : (() => {
          const sorted = [...reasoningSamples].sort((a, b) => a - b);
          const idx = Math.min(
            sorted.length - 1,
            Math.ceil(0.95 * sorted.length) - 1,
          );
          return sorted[idx]!;
        })();
  noteParts.push(
    `accuracy=${passRate.toFixed(3)}`,
    `bad_response_rate=${badResponseRate.toFixed(3)}`,
    `mean_reasoning_tokens=${meanReasoning === null ? "null" : meanReasoning.toFixed(1)}`,
    `p95_reasoning_tokens=${p95Reasoning === null ? "null" : p95Reasoning.toString()}`,
    `mean_completion_tokens=${meanCompletion === null ? "null" : meanCompletion.toFixed(1)}`,
  );
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

  // Fetch the Langfuse-stored prompt body once when the operator opts into
  // the Langfuse source. Production reads from `_generated.ts`; we never
  // touch this path unless the runner is explicitly invoked in that mode.
  let systemBodyOverride: string | null = null;
  if (args.promptSource === "langfuse") {
    systemBodyOverride = await fetchLangfusePromptBody(args.promptVersion);
    console.log(
      `Loaded system prompt from Langfuse (prompt=${args.promptVersion}, ` +
        `bytes=${systemBodyOverride.length})\n`,
    );
  }

  const langfuseSink = new LangfuseSink(buildLangfuseSinkConfig(suite, args));
  const runOpts = {
    model: args.model,
    promptVersion: args.promptVersion,
    promptSource: args.promptSource,
    reasoningEffort: args.reasoningEffort,
    maxCompletionTokens: args.maxCompletionTokens,
    lang: suite.lang ?? null,
  };

  const results: CaseResult[] = [];
  for (const c of suite.cases) {
    const r = await runCase(apiKey, c, {
      includeRuleLeg: args.includeRuleLeg,
      reasoningEffort: args.reasoningEffort,
      maxCompletionTokens: args.maxCompletionTokens,
      model: args.model,
      promptVersion: args.promptVersion,
      systemBodyOverride,
    });
    results.push(r);
    const mark = r.pass ? "PASS" : "FAIL";
    const ruleSuffix = r.rule
      ? ` rule=${r.rule.hit ? r.rule.categoryName : "<miss>"}`
      : "";
    console.log(
      `  ${mark}  [${r.tag}]  ${r.id}: expected=${r.expected} got=${r.got}${ruleSuffix}`,
    );
    await langfuseSink.record({ caseResult: r, runOpts });
  }

  const passCount = results.filter((r) => r.pass).length;
  const total = results.length;
  const passRate = total === 0 ? 0 : passCount / total;
  console.log(`\nPass: ${passCount}/${total} (${(passRate * 100).toFixed(1)}%)`);

  // §10 nano-prompt-experiment cost-narrative summary — mirrors the
  // 4-tuple stamped into the ledger note so the operator sees it without
  // re-opening agent-results.json.
  const badResponseCount = results.filter((r) => r.got === "<bad_response>").length;
  const badResponseRate = total === 0 ? 0 : badResponseCount / total;
  const reasoningSamples = results
    .map((r) => r.reasoningTokens)
    .filter((v): v is number => typeof v === "number");
  const completionSamples = results
    .map((r) => r.completionTokens)
    .filter((v): v is number => typeof v === "number");
  const fmtMean = (xs: number[]): string =>
    xs.length === 0 ? "n/a" : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
  const fmtMax = (xs: number[]): string =>
    xs.length === 0 ? "n/a" : Math.max(...xs).toString();
  const fmtP95 = (xs: number[]): string => {
    if (xs.length === 0) return "n/a";
    const sorted = [...xs].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    return sorted[idx]!.toString();
  };
  console.log(
    `bad_response_rate=${badResponseRate.toFixed(3)} (${badResponseCount}/${total})`,
  );
  console.log(
    `reasoning_tokens: mean=${fmtMean(reasoningSamples)} p95=${fmtP95(reasoningSamples)} max=${fmtMax(reasoningSamples)} (n=${reasoningSamples.length})`,
  );
  console.log(
    `completion_tokens: mean=${fmtMean(completionSamples)} max=${fmtMax(completionSamples)} (n=${completionSamples.length})`,
  );

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
    args.promptSource,
  );
  console.log(`\nLedger row appended: ${RESULTS_FILE}`);

  const langfuseUrl = await langfuseSink.finalize();
  if (langfuseUrl) console.log(`Langfuse run: ${langfuseUrl}`);

  if (blockingFails.length > 0 || passRate < threshold) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

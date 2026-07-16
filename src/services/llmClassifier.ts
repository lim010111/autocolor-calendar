import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { llmUsageDaily, llmUsageGlobalDaily } from "../db/schema";
import type { Bindings } from "../env";
import type { RuleRef } from "./classifierOutcomes";
import type { Rule } from "./ruleService";
import type { RedactedEvent } from "./piiRedactor";
import {
  DEFAULT_CLASSIFIER_PROMPT_VERSION,
  loadClassifierPrompt,
  type ClassifierPromptVersion,
} from "./prompts/classifierPrompts";

export {
  DEFAULT_CLASSIFIER_PROMPT_VERSION,
  loadClassifierPrompt,
  type ClassifierPromptVersion,
};

// §5.3 LLM fallback classifier.
//
// SECURITY CONTRACT
// -----------------
// - NEVER log prompt text, raw event, or LLM response body. `LlmOutcome`
//   intentionally exposes only a discriminated kind + http status (no body)
//   so the chain can bump counters without touching PII. Error messages
//   thrown anywhere in this module must not embed event content.
// - PII redaction (`redactEventForLlm`) is a precondition enforced via the
//   `RedactedEvent` branded type (§5.2). Callers (today: `classifierChain`'s
//   LLM leg) MUST mint a `RedactedEvent` via `redactEventForLlm` before
//   invoking this function — raw `CalendarEvent` is rejected at compile time.
// - Halt-on-failure: any non-"hit" outcome collapses to a silent `no_match`
//   at `calendarSync.processEvent`. There is no fall-through to rule-based
//   logic here (rule leg runs BEFORE this module in `classifierChain`).
//
// PROMPT-INJECTION DEFENSE
// ------------------------
// User-authored `summary` / `description` can carry "Ignore previous
// instructions..." payloads. Layered defense:
//   1. Closed enum server-side: LLM-returned `category_name` is matched
//      exactly against `categories[].name`. Unknown names → `bad_response`.
//   2. Structured outputs (`response_format.json_schema`, `strict: true`)
//      constrains the response shape.
//   3. `category_name` — not raw colorId — is what the LLM picks, so a
//      hijacked model cannot assign a specific color directly.
//
// COST GUARD
// ----------
// Two-tier daily counter via `reserveLlmCall`, bumped BEFORE the fetch:
//   1. Global counter (`llm_usage_global_daily`) — operator-side ceiling
//      that protects the OpenAI credit independently of how many users
//      have signed up. Checked first; if over, the per-user counter is
//      NOT touched so a single user doesn't absorb blame for global
//      exhaustion.
//   2. Per-user counter (`llm_usage_daily`) — the original §5.3 guard.
// Either tier overflowing aborts without calling OpenAI. A hung request
// therefore cannot cause runaway cost; the 1 wasted increment per
// over-quota event acts as self-rate-limiting.
//
// Prompt-side caps below also bound per-call input size, and
// `max_completion_tokens` bounds the response — combined, this turns
// "1 quota call" into a small, near-constant cost regardless of what
// the user pastes into a calendar event description.

const LLM_TIMEOUT_MS = 5_000;
// Production model ID. Exported so the eval runner can pin against the same
// value (default) instead of duplicating the literal — keeps eval and prod
// in lockstep, prevents drift.
export const LLM_MODEL = "gpt-5.4-nano";
const LLM_DEFAULT_DAILY_LIMIT = 200;
const LLM_DEFAULT_GLOBAL_DAILY_LIMIT = 10_000;
const LLM_MAX_CATEGORIES = 50;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_ATTEMPTS = 2; // 1 재시도 = 최대 2회

// Prompt-side input caps applied AFTER PII redaction inside `buildPrompt`.
// These are the second line of defense behind the route-level Zod caps
// (`description.max(8000)`, etc.); the sync path never reaches the route
// validator, so the prompt builder is the chokepoint that matters for
// arbitrary calendar payloads. UTF-16 length cap (`String.prototype.slice`)
// — bytewise length is not what we're rate-limiting; we're rate-limiting
// tokens, and slicing characters is the cheapest proxy for that.
const LLM_PROMPT_SUMMARY_MAX = 256;
const LLM_PROMPT_DESC_MAX = 1024;
const LLM_PROMPT_LOC_MAX = 256;

// Response-token ceiling. The structured-output schema only emits
// `{ "category_name": "<name>" }` — even a verbose name leaves us well
// under 64 tokens. If the model overruns (reasoning tokens, etc.) the
// response is truncated and `parseCategoryName` returns `bad_response`,
// which folds to a silent miss — same outcome as a missing key.
const LLM_MAX_COMPLETION_TOKENS = 64;

export type ChatMessage = { role: "system" | "user"; content: string };

export type LlmOutcome =
  | { kind: "hit"; rule: RuleRef; categoryName: string }
  | { kind: "miss" } // model returned "none"
  | { kind: "timeout" }
  | { kind: "quota_exceeded" }
  | { kind: "http_error"; status: number }
  | { kind: "bad_response" }
  | { kind: "disabled" };

// §6 Wave A — per-call log record emitted via `LlmClassifyDeps.onCall`.
// Persisted into the `llm_calls` table by `calendarSync.runPagedList` at
// sync-run end (bulk insert, fire-and-forget) and by the preview route
// (`POST /api/classify/preview`) as a single-row insert.
//
// PII contract: `promptSummary` carries the user-message JSON that already
// passed `redactEventForLlm` (§5.3) — the same payload that was sent to
// OpenAI. `rawResponse` is OpenAI's reply, which by structured-outputs
// constraint is a `{category_name: string}` echo of the closed enum
// (`bad_response` is the one path where the model can return arbitrary
// text, but the prompt provides redacted input only). Both columns inherit
// the §5.3 redaction guarantee — no new PII surface.
export type LlmCallRecord = {
  outcome: LlmOutcome["kind"];
  // Only set for outcome='http_error'. undefined otherwise.
  httpStatus?: number;
  latencyMs: number;
  // Post-slice count sent to the model: min(LLM_MAX_CATEGORIES, categories.length).
  categoryCount: number;
  // Total attempts including the final outcome. 0 when the caller short-
  // circuits before any fetch (e.g. quota-latched in classifierChain).
  attempts: number;
  // Only set for outcome='hit'. undefined otherwise.
  categoryName?: string;
  // §6.3 후속 debugging surface. NULL on preview path (preview synthesises
  // event id "preview"; sync uses Google's event id).
  eventId?: string;
  // Redacted user-message JSON (system message omitted — deterministic and
  // stored in source). undefined when no fetch occurred (`disabled` /
  // `quota_exceeded`).
  promptSummary?: string;
  // Raw OpenAI chat/completions response body (text, pre-parse). Set on any
  // outcome where an HTTP body was actually received: `hit`, `miss`,
  // `bad_response`, and `http_error` (4xx/5xx body). undefined when no body
  // exists: `timeout`, `quota_exceeded`, `disabled`.
  rawResponse?: string;
  // Category names sent to the model (post-slice — what the model actually
  // saw). undefined only for `disabled` outcomes.
  availableCategories?: string[];
};

// Exported for `classifierChain.ts` quota-latched skip path so the skipped
// record reports the same post-slice count the prompt builder would have
// used. Shared constant so both modules stay in lockstep.
export const LLM_PROMPT_MAX_CATEGORIES = 50;

export type ReserveLlmCallFn = (
  db: PostgresJsDatabase,
  userId: string,
  perUserLimit: number,
  globalLimit: number,
) => Promise<{ ok: boolean; count: number; reason?: "per_user" | "global" }>;

export type LlmClassifyDeps = {
  db: PostgresJsDatabase;
  env: Bindings;
  userId: string;
  // Test-injection seam, mirroring SyncContext.classifyEvent?. Production
  // callers omit this and get the real `reserveLlmCall`; tests inject a stub
  // to bypass the drizzle builder chain without touching the DB.
  reserve?: ReserveLlmCallFn;
};

// Pure, exported for testing. Whitelist-based: only `summary`, `description`,
// `location` reach the prompt. `attendees / creator / organizer` are NOT
// included even after redaction — `displayName` would still leak PII and
// adds little classification signal. `start/end` omitted (time-of-day
// classification is §5 후속).
export function buildPrompt(
  redactedEvent: RedactedEvent,
  categories: Rule[],
  version: ClassifierPromptVersion = DEFAULT_CLASSIFIER_PROMPT_VERSION,
): ChatMessage[] {
  const categoryList = categories.slice(0, LLM_MAX_CATEGORIES).map((c) => ({
    name: c.name,
    keywords: c.keywords,
  }));

  // System prompt body lives under `prompts/classifier/system.<version>.md`
  // and is bundled into the Worker via `scripts/embed-prompts.ts`. The eval
  // runner can pin against a non-default version via `--prompt-version` to
  // reproduce prior baselines without a git checkout.
  const system = loadClassifierPrompt(version);

  // Cost guardrail (§5/§6 후속) — slice each user-authored field so a
  // pathological 32KB description (Google's per-event ceiling) cannot push
  // input tokens into the hundreds of thousands. Slice happens AFTER
  // redaction so PII placeholders like `[email]` are preserved when they
  // fall inside the cap. Truncation is silent — classification quality
  // tradeoff is acceptable because the leading characters of a calendar
  // field carry the highest classification signal (`buildPrompt` whitelist
  // rationale, §5.3). UTF-16 `slice` may split a surrogate pair when the
  // truncation boundary lands mid-emoji; the model treats the resulting
  // lone surrogate as opaque text and JSON.stringify emits `\uXXXX`
  // unchanged, so this is benign by construction.
  const userPayload = {
    categories: categoryList,
    event: {
      summary: (redactedEvent.summary ?? "").slice(0, LLM_PROMPT_SUMMARY_MAX),
      description: (redactedEvent.description ?? "").slice(0, LLM_PROMPT_DESC_MAX),
      location: (redactedEvent.location ?? "").slice(0, LLM_PROMPT_LOC_MAX),
    },
  };

  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(userPayload) },
  ];
}

// Pure, exported for testing. `"none"` → null (miss). Unknown name → null.
// Strict equality — no trimming, no case-folding — because categories are
// user-authored and the LLM is constrained by structured outputs to echo
// one of the provided names verbatim. Leg identity (rule / llm / embedding)
// is now carried by `ClassificationOutcome.kind`, so this helper returns the
// matched rule reference only — no `reason: "llm_match:..."` string.
export function mapCategoryNameToRuleRef(
  name: string | null,
  categories: Rule[],
): RuleRef | null {
  if (name === null || name === "none") return null;
  const match = categories.find((c) => c.name === name);
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    colorId: match.colorId,
    labelId: match.labelId,
  };
}

// Atomic UPSERT + increment, two-tier (global → per-user).
//
// Order is global-first by design: if the global counter is already
// exhausted, we abort WITHOUT bumping the per-user counter, so an
// unrelated user doesn't burn one of their 200 daily calls because
// some other user filled the global bucket. The mirror trade-off is
// that the global counter can over-count by one when per-user fails
// AFTER global succeeded — that is the safe direction (next call sees
// the inflated count and aborts earlier).
//
// `count` and `reason` reflect WHICH tier denied the call: callers
// (telemetry, dashboards) get to distinguish "this user is over their
// own ceiling" from "OpenAI credit is at risk system-wide today".
export async function reserveLlmCall(
  db: PostgresJsDatabase,
  userId: string,
  perUserLimit: number,
  globalLimit: number,
): Promise<{ ok: boolean; count: number; reason?: "per_user" | "global" }> {
  // Tier 1: global counter.
  const globalRows = await db
    .insert(llmUsageGlobalDaily)
    .values({
      day: sql`CURRENT_DATE` as unknown as string,
      callCount: 1,
    })
    .onConflictDoUpdate({
      target: llmUsageGlobalDaily.day,
      set: {
        callCount: sql`${llmUsageGlobalDaily.callCount} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ callCount: llmUsageGlobalDaily.callCount });

  const globalRow = globalRows[0];
  if (!globalRow) {
    // Defensive: RETURNING must produce one row. Treat as over-quota.
    return { ok: false, count: 0, reason: "global" };
  }
  if (globalRow.callCount > globalLimit) {
    return { ok: false, count: globalRow.callCount, reason: "global" };
  }

  // Tier 2: per-user counter.
  const userRows = await db
    .insert(llmUsageDaily)
    .values({
      userId,
      day: sql`CURRENT_DATE` as unknown as string,
      callCount: 1,
    })
    .onConflictDoUpdate({
      target: [llmUsageDaily.userId, llmUsageDaily.day],
      set: {
        callCount: sql`${llmUsageDaily.callCount} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ callCount: llmUsageDaily.callCount });

  const userRow = userRows[0];
  if (!userRow) {
    return { ok: false, count: 0, reason: "per_user" };
  }
  if (userRow.callCount > perUserLimit) {
    return { ok: false, count: userRow.callCount, reason: "per_user" };
  }
  return { ok: true, count: userRow.callCount };
}

function parseDailyLimit(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : LLM_DEFAULT_DAILY_LIMIT;
}

// Exported for `dailyCostReport.ts` so the cron uses the same parse rules
// and default as `classifyWithLlm` — operator-side cap drift between the
// classifier and the report would mean the alert fires at a different
// threshold than the actual ceiling.
export function parseGlobalDailyLimit(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : LLM_DEFAULT_GLOBAL_DAILY_LIMIT;
}

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

async function callOpenAi(
  apiKey: string,
  messages: ChatMessage[],
): Promise<Response> {
  return fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      // Cost guardrail (§5/§6 후속) — response-token ceiling. Capped low
      // because the structured-output schema constrains the response to
      // a tiny JSON object; if the model exceeds the cap the response
      // truncates and the caller falls through to `bad_response` → silent
      // miss. See `LLM_MAX_COMPLETION_TOKENS` declaration for rationale.
      max_completion_tokens: LLM_MAX_COMPLETION_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["category_name"],
            properties: {
              category_name: { type: "string" },
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
}

// Pull the user-message content out of the prompt array. Used to populate
// `LlmCallRecord.promptSummary` — system message is deterministic and lives
// in source, so we only persist the variable user-message.
function extractUserMessage(messages: ChatMessage[]): string | undefined {
  return messages.find((m) => m.role === "user")?.content;
}

// Pure, exported for testing and for the offline eval script
// (`evals/scripts/run-classification-eval.ts`) which reuses the production
// parser to keep parsing parity with the runtime path.
export function parseCategoryName(content: string): string | null | undefined {
  // Returns:
  //   string   — category name candidate (caller validates via map)
  //   null     — explicit "none" miss
  //   undefined — parse failure / shape mismatch (caller → bad_response)
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const v = (parsed as { category_name?: unknown }).category_name;
  if (typeof v !== "string") return undefined;
  if (v === "none") return null;
  return v;
}

export async function classifyWithLlm(
  // §5.2 branded contract — caller MUST redact via `redactEventForLlm`
  // first. Raw `CalendarEvent` is rejected at compile time. The redaction
  // step thus moves to `classifierChain`'s LLM leg; this function trusts
  // its input is already redacted.
  event: RedactedEvent,
  categories: Rule[],
  deps: LlmClassifyDeps,
): Promise<{ outcome: LlmOutcome; record: LlmCallRecord }> {
  // §6 Wave A — single emission point. Every return in this function routes
  // through `finish()` so the per-call record (latency, attempts, outcome,
  // §6.3 후속 debugging columns) is always emitted exactly once. Skipping
  // `finish()` would silently drop a row from the observability log. The
  // record now travels back to the caller alongside the outcome (chain
  // wraps it into the matching `ClassificationOutcome.llmRecord` field).
  const t0 = Date.now();
  const categoryCount = Math.min(LLM_MAX_CATEGORIES, categories.length);
  let attempts = 0;
  // Captured progressively as the function walks past each guard:
  // - eventId is known immediately
  // - availableCategories is known once we'd build a prompt
  // - promptSummary is known after `buildPrompt`
  // - rawResponse is known after we read the OpenAI body (or NULL for
  //   timeout/network/quota/disabled paths where no body exists)
  const eventId = event.id;
  let availableCategories: string[] | undefined;
  let promptSummary: string | undefined;
  let rawResponse: string | undefined;

  function finish(outcome: LlmOutcome): { outcome: LlmOutcome; record: LlmCallRecord } {
    const rec: LlmCallRecord = {
      outcome: outcome.kind,
      latencyMs: Date.now() - t0,
      categoryCount,
      attempts,
    };
    if (outcome.kind === "http_error") rec.httpStatus = outcome.status;
    if (outcome.kind === "hit") rec.categoryName = outcome.categoryName;
    rec.eventId = eventId;
    if (availableCategories !== undefined) rec.availableCategories = availableCategories;
    if (promptSummary !== undefined) rec.promptSummary = promptSummary;
    if (rawResponse !== undefined) rec.rawResponse = rawResponse;
    return { outcome, record: rec };
  }

  const apiKey = deps.env.OPENAI_API_KEY;
  // `disabled` exits leave availableCategories / promptSummary / rawResponse
  // all undefined — no slicing or prompt build occurred, so the columns
  // would be misleading if populated.
  if (!apiKey) return finish({ kind: "disabled" });
  if (categories.length === 0) return finish({ kind: "disabled" });

  // From this point onward, we know what slice the prompt builder would use.
  // Capture even before quota check so a `quota_exceeded` row still tells us
  // which categories the user owned at the moment we wanted to fire.
  availableCategories = categories
    .slice(0, LLM_MAX_CATEGORIES)
    .map((c) => c.name);

  const perUserLimit = parseDailyLimit(deps.env.LLM_DAILY_LIMIT);
  const globalLimit = parseGlobalDailyLimit(deps.env.LLM_GLOBAL_DAILY_LIMIT);
  const reserve = deps.reserve ?? reserveLlmCall;
  const reservation = await reserve(deps.db, deps.userId, perUserLimit, globalLimit);
  if (!reservation.ok) return finish({ kind: "quota_exceeded" });

  const messages = buildPrompt(event, categories);
  promptSummary = extractUserMessage(messages);

  let lastOutcome: LlmOutcome = { kind: "bad_response" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const res = await callOpenAi(apiKey, messages);
      // Read body as text first so we can persist the raw response across all
      // HTTP-received outcomes (hit/miss/bad_response/http_error 4xx/5xx).
      // Each retry overwrites — only the final attempt's body is recorded
      // (matches `lastOutcome` semantics so debugging matches the row's
      // reported outcome).
      let bodyText: string;
      try {
        bodyText = await res.text();
      } catch {
        // Reading the body failed mid-stream — no body available to record.
        // Treat as bad_response since neither the success nor the http_error
        // path can proceed without it.
        return finish({ kind: "bad_response" });
      }
      rawResponse = bodyText;

      if (!res.ok) {
        lastOutcome = { kind: "http_error", status: res.status };
        if (attempt < MAX_ATTEMPTS && isTransient(res.status)) continue;
        return finish(lastOutcome);
      }
      let body: OpenAiChatResponse;
      try {
        body = JSON.parse(bodyText) as OpenAiChatResponse;
      } catch {
        return finish({ kind: "bad_response" });
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") return finish({ kind: "bad_response" });

      const name = parseCategoryName(content);
      if (name === undefined) return finish({ kind: "bad_response" });

      const rule = mapCategoryNameToRuleRef(name, categories);
      if (rule === null) {
        // Either explicit "none" or unknown name — both fold to silent miss.
        return finish(name === null ? { kind: "miss" } : { kind: "bad_response" });
      }
      // `rule !== null` implies `name !== null` (mapCategoryNameToRuleRef
      // returns null for null input). TS can't narrow that across the helper
      // boundary — the assertion is safe by construction.
      return finish({ kind: "hit", rule, categoryName: name as string });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        lastOutcome = { kind: "timeout" };
        if (attempt < MAX_ATTEMPTS) continue;
        return finish(lastOutcome);
      }
      if (err instanceof TypeError) {
        // Workers runtime wraps network failures as TypeError.
        lastOutcome = { kind: "http_error", status: 0 };
        if (attempt < MAX_ATTEMPTS) continue;
        return finish(lastOutcome);
      }
      // Unknown error: do not retry, do not log content. Emit the error
      // name only (never `.message` — some runtimes embed request bodies or
      // PII in the message) so operators have a signal when this path trips.
      const errName = err instanceof Error ? err.name : typeof err;
      console.warn(`[llmClassifier] unknown error: ${errName}`);
      return finish({ kind: "bad_response" });
    }
  }

  return finish(lastOutcome);
}

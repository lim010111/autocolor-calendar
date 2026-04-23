import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { llmUsageDaily } from "../db/schema";
import type { Bindings } from "../env";
import type { Category, Classification } from "./classifier";
import { redactEventForLlm } from "./piiRedactor";
import type { CalendarEvent } from "./googleCalendar";

// §5.3 LLM fallback classifier.
//
// SECURITY CONTRACT
// -----------------
// - NEVER log prompt text, raw event, or LLM response body. `LlmOutcome`
//   intentionally exposes only a discriminated kind + http status (no body)
//   so the chain can bump counters without touching PII. Error messages
//   thrown anywhere in this module must not embed event content.
// - PII redaction (`redactEventForLlm`) happens inside `classifyWithLlm`
//   before prompt build. Callers pass the raw event.
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
// `reserveLlmCall` bumps a per-user daily counter BEFORE the fetch. If the
// post-increment count exceeds the limit, we abort without calling OpenAI.
// A hung request therefore cannot cause runaway cost; the 1 wasted
// increment per over-quota event acts as self-rate-limiting.

const LLM_TIMEOUT_MS = 5_000;
const LLM_MODEL = "gpt-5.4-nano";
const LLM_DEFAULT_DAILY_LIMIT = 200;
const LLM_MAX_CATEGORIES = 50;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_ATTEMPTS = 2; // 1 재시도 = 최대 2회

export type ChatMessage = { role: "system" | "user"; content: string };

export type LlmOutcome =
  | { kind: "hit"; classification: Classification }
  | { kind: "miss" } // model returned "none"
  | { kind: "timeout" }
  | { kind: "quota_exceeded" }
  | { kind: "http_error"; status: number }
  | { kind: "bad_response" }
  | { kind: "disabled" };

// §6 Wave A — per-call log record emitted via `LlmClassifyDeps.onCall`.
// Persisted into the `llm_calls` table by `calendarSync.runPagedList` at
// sync-run end (bulk insert, fire-and-forget). Contains only telemetry and
// the user's own category name — never event content.
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
};

// Exported for `classifierChain.ts` quota-latched skip path so the skipped
// record reports the same post-slice count the prompt builder would have
// used. Shared constant so both modules stay in lockstep.
export const LLM_PROMPT_MAX_CATEGORIES = 50;

export type ReserveLlmCallFn = (
  db: PostgresJsDatabase,
  userId: string,
  limit: number,
) => Promise<{ ok: boolean; count: number }>;

export type LlmClassifyDeps = {
  db: PostgresJsDatabase;
  env: Bindings;
  userId: string;
  // Test-injection seam, mirroring SyncContext.classifyEvent?. Production
  // callers omit this and get the real `reserveLlmCall`; tests inject a stub
  // to bypass the drizzle builder chain without touching the DB.
  reserve?: ReserveLlmCallFn;
  // §6 Wave A telemetry hook — called exactly once before every return with
  // the per-call record. Kept as a callback (not a return-type extension) so
  // the existing `LlmOutcome` shape stays stable across 13+ test assertions.
  onCall?: (record: LlmCallRecord) => void;
};

// Pure, exported for testing. Whitelist-based: only `summary`, `description`,
// `location` reach the prompt. `attendees / creator / organizer` are NOT
// included even after redaction — `displayName` would still leak PII and
// adds little classification signal. `start/end` omitted (time-of-day
// classification is §5 후속).
export function buildPrompt(
  redactedEvent: CalendarEvent,
  categories: Category[],
): ChatMessage[] {
  const categoryList = categories.slice(0, LLM_MAX_CATEGORIES).map((c) => ({
    name: c.name,
    keywords: c.keywords,
  }));

  const system = `You classify a calendar event into one of the user's categories, or return "none".

Rules:
1. Read the event fields: summary, description, location.
2. Compare against each category's name and keywords.
3. If exactly one category clearly fits, output its exact "name" from the provided list.
4. If NO category clearly fits, output "none".
5. [email], [url], [phone] are opaque placeholders — do not guess their contents.
6. Do not invent category names. Choose only from the provided list or "none".
7. Output must be JSON of the form {"category_name": string}.

Example:
Categories: [{"name":"Meeting","keywords":["meeting","sync"]}]
Event: {"summary":"team sync 10am"}
Output: {"category_name":"Meeting"}`;

  const userPayload = {
    categories: categoryList,
    event: {
      summary: redactedEvent.summary ?? "",
      description: redactedEvent.description ?? "",
      location: redactedEvent.location ?? "",
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
// one of the provided names verbatim.
export function mapCategoryNameToClassification(
  name: string | null,
  categories: Category[],
): Classification | null {
  if (name === null || name === "none") return null;
  const match = categories.find((c) => c.name === name);
  if (!match) return null;
  return {
    colorId: match.colorId,
    categoryId: match.id,
    reason: `llm_match:${name}`,
  };
}

// Atomic UPSERT + increment. Returns post-increment count and whether the
// caller should proceed (count <= limit).
export async function reserveLlmCall(
  db: PostgresJsDatabase,
  userId: string,
  limit: number,
): Promise<{ ok: boolean; count: number }> {
  const rows = await db
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

  const row = rows[0];
  if (!row) {
    // Defensive: RETURNING must produce exactly one row for this UPSERT.
    // Treat as over-quota so the caller aborts rather than proceeding
    // without an accounted reservation.
    return { ok: false, count: 0 };
  }
  return { ok: row.callCount <= limit, count: row.callCount };
}

function parseDailyLimit(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : LLM_DEFAULT_DAILY_LIMIT;
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

function parseCategoryName(content: string): string | null | undefined {
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
  event: CalendarEvent,
  categories: Category[],
  deps: LlmClassifyDeps,
): Promise<LlmOutcome> {
  // §6 Wave A — single emission point. Every return in this function routes
  // through `finish()` so the per-call record (latency, attempts, outcome)
  // is always emitted exactly once. Skipping `finish()` would silently drop
  // a row from the observability log.
  const t0 = Date.now();
  const categoryCount = Math.min(LLM_MAX_CATEGORIES, categories.length);
  let attempts = 0;

  function finish(outcome: LlmOutcome): LlmOutcome {
    const rec: LlmCallRecord = {
      outcome: outcome.kind,
      latencyMs: Date.now() - t0,
      categoryCount,
      attempts,
    };
    if (outcome.kind === "http_error") rec.httpStatus = outcome.status;
    if (outcome.kind === "hit") rec.categoryName = outcome.classification.reason.replace(/^llm_match:/, "");
    deps.onCall?.(rec);
    return outcome;
  }

  const apiKey = deps.env.OPENAI_API_KEY;
  if (!apiKey) return finish({ kind: "disabled" });
  if (categories.length === 0) return finish({ kind: "disabled" });

  const limit = parseDailyLimit(deps.env.LLM_DAILY_LIMIT);
  const reserve = deps.reserve ?? reserveLlmCall;
  const reservation = await reserve(deps.db, deps.userId, limit);
  if (!reservation.ok) return finish({ kind: "quota_exceeded" });

  const redacted = redactEventForLlm(event);
  const messages = buildPrompt(redacted, categories);

  let lastOutcome: LlmOutcome = { kind: "bad_response" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const res = await callOpenAi(apiKey, messages);
      if (!res.ok) {
        lastOutcome = { kind: "http_error", status: res.status };
        if (attempt < MAX_ATTEMPTS && isTransient(res.status)) continue;
        return finish(lastOutcome);
      }
      let body: OpenAiChatResponse;
      try {
        body = (await res.json()) as OpenAiChatResponse;
      } catch {
        return finish({ kind: "bad_response" });
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") return finish({ kind: "bad_response" });

      const name = parseCategoryName(content);
      if (name === undefined) return finish({ kind: "bad_response" });

      const classification = mapCategoryNameToClassification(name, categories);
      if (classification === null) {
        // Either explicit "none" or unknown name — both fold to silent miss.
        return finish(name === null ? { kind: "miss" } : { kind: "bad_response" });
      }
      return finish({ kind: "hit", classification });
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

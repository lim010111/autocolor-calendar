import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import { categories, llmCalls, users } from "../db/schema";
import type { HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { classifyEvent } from "../services/classifier";
import { buildDefaultClassifier } from "../services/classifierChain";
import type { LlmCallRecord } from "../services/llmClassifier";

// Cost guardrail (§5/§6 후속) — preview-LLM throttle window.
//
// Single-writer column: `users.last_preview_at` is stamped only by this
// route, only on the `llm: true` branch, only after we decide to run the
// classifier. Same single-writer discipline as
// `sync_state.last_manual_trigger_at` (§6.4) — adding a second writer
// would re-open the abuse window.
//
// 2-second minimum interval is a deliberately coarse defense: human users
// click the "🤖 AI 분류 확인" button at most a few times per minute, but a
// macro/bot driving HTTP directly can otherwise burn the per-user 200/day
// quota in seconds. This throttle stops the burst at ~30 reqs/min, which
// then collides with the per-user daily quota AND the operator-side global
// daily cap. Sliding-window minute/hour rate limits are deferred to
// `TODO.md` §6.4 후속 (general rate limit work).
//
// `llm: false` / omitted → throttle skipped (rule-only path costs nothing).
const PREVIEW_LLM_MIN_INTERVAL_MS = 2_000;

export const classifyRoutes = new Hono<HonoEnv>();

classifyRoutes.use("*", authMiddleware);

const PreviewBody = z.object({
  summary: z.string().trim().min(1).max(1024),
  description: z.string().max(8000).optional(),
  location: z.string().max(1024).optional(),
  // §5 후속 — opt-in on-demand LLM preview. When true AND the rule leg misses
  // AND `OPENAI_API_KEY` is set AND categories ≥ 1, the LLM leg runs once.
  // Shares `reserveLlmCall`'s per-user daily quota with the sync pipeline —
  // no separate preview cap. GAS sidebar triggers this via an explicit "🤖 AI
  // 분류 확인" button so we do not burn quota on every event the user opens.
  llm: z.boolean().optional(),
});

// §5 후속 A — sidebar classify preview.
//
// Default: rule-only for <300ms sidebar latency. When the caller sets
// `llm: true` in the body, we delegate rule-miss events to `classifierChain`'s
// LLM leg (same factory the sync pipeline uses). Rule hits still short-circuit
// inside the chain — `llm: true` is opt-in for the LLM leg, not a rule bypass.
// On LLM failure (timeout / http_error / quota_exceeded / bad_response / disabled)
// we return the same `no_match` shape as rule-only (plus `llmTried: true`) —
// there is no fallback to rule-based results per Halt-on-Failure.
classifyRoutes.post("/preview", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = PreviewBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }

  const llmAvailable = !!c.env.OPENAI_API_KEY;
  const useLlm = parsed.data.llm === true;
  const { db, close } = getDb(c.env);
  try {
    // Cost guardrail (§5/§6 후속) — preview-LLM throttle. Atomic
    // UPDATE-RETURNING: stamp `users.last_preview_at` only when the prior
    // value is NULL or older than the minimum interval. Zero rows returned
    // = some other in-flight request just claimed the window. The
    // SELECT-then-UPDATE alternative (used by `sync_state.last_manual_trigger_at`)
    // tolerates concurrent passes; here we want stricter abuse absorption
    // because preview's threat model is automated bots, not button spam.
    if (useLlm) {
      const intervalSec = Math.ceil(PREVIEW_LLM_MIN_INTERVAL_MS / 1000);
      const stamped = await db
        .update(users)
        .set({ lastPreviewAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(users.id, userId),
            or(
              isNull(users.lastPreviewAt),
              sql`${users.lastPreviewAt} < now() - (${intervalSec} || ' seconds')::interval`,
            ),
          ),
        )
        .returning({ id: users.id });
      if (stamped.length === 0) {
        return c.json(
          {
            error: "preview_throttled" as const,
            retryAfterMs: PREVIEW_LLM_MIN_INTERVAL_MS,
          },
          429,
          { "Retry-After": String(intervalSec) },
        );
      }
    }

    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        colorId: categories.colorId,
        keywords: categories.keywords,
        priority: categories.priority,
      })
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.priority), asc(categories.createdAt));

    // Zero-category short-circuit: skip classifyEvent's internal category
    // loop (guaranteed no-op) and return immediately so tests don't need to
    // mock the classifier. Same branch for both `useLlm=true` and false —
    // the chain would bail at `ctx.categories.length === 0` anyway.
    if (rows.length === 0) {
      return c.json({ source: "no_match" as const, llmAvailable });
    }

    // llmTried flips to true exactly when the chain engaged the LLM leg
    // (post key/cats guard). Preview builds a fresh `buildDefaultClassifier`
    // closure per request, so the quota-latch path inside the chain is
    // unreachable here — a latched skip needs ≥2 rule-miss events sharing a
    // closure, which this endpoint never produces.
    let llmTried = false;
    let llmCallRecord: LlmCallRecord | null = null;
    const classifyFn = useLlm
      ? buildDefaultClassifier({
          db,
          env: c.env,
          userId,
          onLlmAttempted: () => {
            llmTried = true;
          },
          onLlmCall: (rec) => {
            llmCallRecord = rec;
          },
        })
      : classifyEvent;

    const classification = await classifyFn(
      {
        id: "preview",
        summary: parsed.data.summary,
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
        ...(parsed.data.location !== undefined
          ? { location: parsed.data.location }
          : {}),
      },
      { userId, categories: rows },
    );

    // §6 Wave A — preview's single-call LlmCallRecord gets its own
    // one-row insert (sync's bulk insert lives in `runPagedList`). Same
    // fire-and-forget / error-isolation discipline: warn on DB failure,
    // never fail the response.
    if (llmCallRecord !== null) {
      const rec: LlmCallRecord = llmCallRecord;
      c.executionCtx.waitUntil(
        db
          .insert(llmCalls)
          .values({
            userId,
            outcome: rec.outcome,
            latencyMs: rec.latencyMs,
            categoryCount: rec.categoryCount,
            attempts: rec.attempts,
            ...(rec.httpStatus !== undefined ? { httpStatus: rec.httpStatus } : {}),
            ...(rec.categoryName !== undefined
              ? { categoryName: rec.categoryName }
              : {}),
            ...(rec.eventId !== undefined ? { eventId: rec.eventId } : {}),
            ...(rec.promptSummary !== undefined
              ? { promptSummary: rec.promptSummary }
              : {}),
            ...(rec.rawResponse !== undefined
              ? { rawResponse: rec.rawResponse }
              : {}),
            ...(rec.availableCategories !== undefined
              ? { availableCategories: rec.availableCategories }
              : {}),
          })
          .catch((e: unknown) => {
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "llm_calls insert failed (preview)",
                error: e instanceof Error ? e.message : String(e),
                userId,
              }),
            );
          }),
      );
    }

    if (!classification) {
      return c.json({
        source: "no_match" as const,
        llmAvailable,
        ...(llmTried ? { llmTried: true as const } : {}),
      });
    }

    const matched = rows.find((r) => r.id === classification.categoryId);
    const isLlmHit = classification.reason.startsWith("llm_match:");
    return c.json({
      source: isLlmHit ? ("llm" as const) : ("rule" as const),
      category: matched
        ? { id: matched.id, name: matched.name, colorId: matched.colorId }
        : {
            id: classification.categoryId,
            name: "",
            colorId: classification.colorId,
          },
      ...(classification.matchedKeyword !== undefined
        ? { matchedKeyword: classification.matchedKeyword }
        : {}),
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

// merge-gate codex:finding-1 repro — "Manual events are still embedded before
// the new manual gate" (E1, branch fix/e1-manual-skip-before-classify).
//
// Production path: `runPagedList` embeds the WHOLE page's titles via
// `embedPageTitles(embedTitles, res.items ?? [])` BEFORE the per-event loop
// runs `processEvent`, whose E1 manual gate is what skips manual/user-corrected
// events. `embedPageTitles` filters only cancelled/empty-title events, so a
// manual event's raw title is still shipped to Workers AI (env.AI.run) and
// burns an embedding subrequest even though the event can never be painted.
//
// Existing calendarSync tests inject `ctx.classifyEvent`, which flips
// `usingDefaultClassifier` to false and disables the per-page embedding branch
// entirely — so they cannot observe this. This suite instead runs the DEFAULT
// classifier with a fake `env.AI` binding that records every text batch sent
// to the embedder.
//
// Expected (desired) behavior: the manual event's title never reaches the
// embedder; the virgin event's title does (contrast assertion, so the oracle
// is not vacuously satisfiable by disabling embedding altogether).
import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { SyncContext } from "../services/calendarSync";
import { runIncrementalSync } from "../services/calendarSync";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const CAL = "primary";
const MANUAL_TITLE = "Dentist appointment user picked a label for";
const VIRGIN_TITLE = "Team weekly standup";

// Fake Workers AI binding — records every batch of texts sent to `ai.run`.
// `resolveEmbedder(env)` wraps this in `makeWorkersAiEmbedder`, which is the
// single `env.AI.run` caller for embeddings, so `captured` sees exactly what
// the production embedding path would ship to Workers AI (prefix included).
function fakeAi(captured: string[][]): Ai {
  const run = vi.fn(async (_model: string, inputs: { text: string[] }) => {
    captured.push([...inputs.text]);
    return {
      shape: [inputs.text.length, 3],
      data: inputs.text.map(() => [0.1, 0.2, 0.3]),
    };
  });
  return { run } as unknown as Ai;
}

function makeEnv(ai: Ai): Bindings {
  const b64 = () => randomBytes(32).toString("base64");
  return {
    ENV: "dev",
    GOOGLE_OAUTH_REDIRECT_URI: "https://worker.test/oauth/google/callback",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "cs",
    GAS_REDIRECT_URL: "https://example/exec",
    TOKEN_ENCRYPTION_KEY: b64(),
    SESSION_HMAC_KEY: b64(),
    SESSION_PEPPER: b64(),
    AI: ai,
  };
}

// Minimal db double (pattern lifted from calendarSync.test.ts). Categories
// resolve empty so Stage 1 short-circuits to `embeddingMiss` before its kNN
// query — no `db.execute` needed — and the LLM leg is disabled (no
// OPENAI_API_KEY), so classification folds to no_match without further I/O.
function makeDb(opts: {
  nextSyncToken?: string | null;
  tokenRow?: {
    iv: Uint8Array;
    encryptedRefreshToken: Uint8Array;
    scope: string;
    needsReauth: boolean;
  } | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: (cols?: Record<string, unknown>) => ({
      from: (_table: unknown) => ({
        where: (_w: unknown) => ({
          // Awaited directly (no .limit/.orderBy) by labelReconcile's rules
          // select and listRules' example-seeds select — empty set.
          then: (resolve: (v: never[]) => unknown) => resolve([]),
          limit: async () => {
            if (cols && "nextSyncToken" in cols) {
              return [{ nextSyncToken: opts.nextSyncToken ?? null }];
            }
            // oauth_tokens select for getGoogleRefreshToken
            return opts.tokenRow ? [opts.tokenRow] : [];
          },
          orderBy: async () => [],
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return {
          where: () =>
            Object.assign(Promise.resolve(undefined), {
              returning: async () => [{ id: "sync-state-row" }],
            }),
        };
      },
    }),
    insert: (_table: unknown) => ({
      values: (_v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => undefined,
        onConflictDoUpdate: (_args: unknown) => ({
          returning: async () => [],
        }),
      }),
    }),
  };
  return { db: db as never, updates };
}

async function seedTokenRow(env: Bindings) {
  const { aesGcmEncrypt, textEncoder } = await import("../lib/crypto");
  const aad = textEncoder.encode(`user:${USER_ID}`);
  const { iv, ciphertext } = await aesGcmEncrypt(
    env.TOKEN_ENCRYPTION_KEY,
    textEncoder.encode("stored-refresh"),
    aad,
  );
  return {
    iv,
    encryptedRefreshToken: ciphertext,
    scope: "openid",
    needsReauth: false,
  };
}

function mockFetchQueue(responses: Response[]) {
  const queue = [...responses];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    // ADR-0006 label reconcile probe — empty label set, served out-of-band.
    if (url.includes("labelProperties")) {
      return new Response("{}", { status: 200 });
    }
    const r = queue.shift();
    if (!r) throw new Error("unexpected fetch");
    return r;
  }) as typeof fetch;
}

describe("E1 manual gate vs per-page title embedding (merge-gate finding-1)", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("does not ship a manual event's title to the embedder (virgin title still embedded)", async () => {
    const captured: string[][] = [];
    const env = makeEnv(fakeAi(captured));
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old-tok", tokenRow });

    mockFetchQueue([
      // 1st fetch = token refresh
      new Response(
        JSON.stringify({
          access_token: "at",
          expires_in: 3600,
          scope: "openid",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
      // 2nd fetch = events.list — one manual event (user label, no autocolor
      // marker → fails the §5.4 ownership probe → E1 manual skip) and one
      // virgin event (no label, no colorId → passes the gate).
      new Response(
        JSON.stringify({
          items: [
            {
              id: "manual-1",
              status: "confirmed",
              summary: MANUAL_TITLE,
              eventLabelId: "99999999-9999-9999-9999-999999999999",
            },
            {
              id: "virgin-1",
              status: "confirmed",
              summary: VIRGIN_TITLE,
              colorId: "",
            },
          ],
          nextSyncToken: "fresh-tok",
        }),
        { status: 200 },
      ),
    ]);

    // NO ctx.classifyEvent injection — the default (embedding) classifier
    // must be in play, otherwise the production per-page embed branch is
    // disabled and the test proves nothing.
    const ctx: SyncContext = { db, env, userId: USER_ID, calendarId: CAL };
    const result = await runIncrementalSync(ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sanity: the E1 manual gate did fire for the manual event.
    expect(result.summary.skipped_manual).toBe(1);

    const embeddedTexts = captured.flat();
    // Contrast oracle: the production embedding path is live and the virgin
    // (paintable) event's title WAS embedded — the fix must not silence the
    // embedder wholesale.
    expect(
      embeddedTexts.some((t) => t.includes(VIRGIN_TITLE)),
      `virgin title should be embedded; embedder saw: ${JSON.stringify(embeddedTexts)}`,
    ).toBe(true);
    // The finding: the manual event fails the E1 gate and can never be
    // painted, so its raw title must NOT be shipped to Workers AI. FAILS at
    // HEAD — embedPageTitles embeds the whole page before processEvent runs
    // the gate.
    expect(
      embeddedTexts.some((t) => t.includes(MANUAL_TITLE)),
      `manual title must not reach the embedder; embedder saw: ${JSON.stringify(embeddedTexts)}`,
    ).toBe(false);
  });
});

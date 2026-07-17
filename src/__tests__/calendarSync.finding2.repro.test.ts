// Merge-gate finding repro — "Stale continuations are only detected on the
// final page".
//
// sync-reliability #04: the CAS guard lives only inside runPagedList's
// `!continuation && finalSyncToken` final-write branch. A resumed incremental
// hop whose sync_state.nextSyncToken already changed (a newer run completed
// while the hop sat in the queue) therefore never notices it is stale unless
// it happens to reach Google's final page: if the #02 budget guard trips
// first, the hop does real Google work (events.list + events.patch), returns
// ANOTHER continuation carrying the stale arc token, and the stale arc
// re-enqueues itself — quota burn with zero staleness observability.
//
// This test FAILS on current HEAD. It passes once a resumed hop pre-checks
// sync_state.nextSyncToken against its carried arc token at entry and, on
// mismatch, terminates before ANY external fetch: no token refresh, no
// events.list, no events.patch, no continuation — just the stale-skip
// summary contract (`sync_token_write_skipped === true`,
// `stored_next_sync_token === false`).
//
// Self-contained: the `makeDb` harness in calendarSync.test.ts is not
// exported, so the doubles below are copied (trimmed) from it.

import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import { runIncrementalSync } from "../services/calendarSync";
import type { ClassifyEventFn } from "../services/classifierOutcomes";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const CAL = "primary";
const TARGET_LABEL = "33333333-3333-3333-3333-333333333333";

function makeEnv(): Bindings {
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
  };
}

// Minimal db double (copied from calendarSync.test.ts makeDb, trimmed).
// `nextSyncToken` is what a `select({nextSyncToken})...limit()` resolves —
// the store the remedy's entry pre-check must consult.
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
          then: (resolve: (v: never[]) => unknown) => resolve([]),
          limit: async () => {
            if (cols && "nextSyncToken" in cols) {
              return [{ nextSyncToken: opts.nextSyncToken ?? null }];
            }
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

// Injected classifier mimicking the LLM leg's fetch cost (2 counted OpenAI
// attempts per event) so the #02 budget guard trips mid-page — same shape as
// the #02 suite's `llmHitClassify`.
const llmHitClassify: ClassifyEventFn = async (event) => ({
  kind: "llmHit",
  rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: TARGET_LABEL },
  llmRecord: {
    outcome: "hit",
    latencyMs: 1,
    categoryCount: 1,
    attempts: 2,
    eventId: event.id,
  },
});

describe("finding repro — #04 stale continuation is only detected on the final page", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("resumed hop against a changed store token aborts before any external fetch (no stale work, no re-enqueue)", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    // The store moved on while this hop sat in the queue: it now holds
    // "newer-tok", not the carried arc token.
    const { db } = makeDb({ nextSyncToken: "newer-tok", tokenRow });

    // Serve everything HEAD would ask for — token refresh, a 20-event page
    // (with nextPageToken so no final nextSyncToken is reached), PATCHes —
    // so on HEAD the run completes a budget-stopped hop instead of erroring.
    // The remedy consumes NONE of this.
    let fetchCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      if (init?.method === "PATCH") return new Response("{}", { status: 200 });
      return new Response(
        JSON.stringify({
          items: Array.from({ length: 20 }, (_, i) => ({
            id: `e${i}`,
            status: "confirmed",
            summary: "x",
            colorId: "",
          })),
          nextPageToken: "pt-next",
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await runIncrementalSync(
      { db, env, userId: USER_ID, calendarId: CAL, classifyEvent: llmHitClassify },
      { syncToken: "arc-start-tok", pageToken: "pt-resume" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // THE FINDING: on HEAD the stale hop issues real external fetches
    // (token refresh + events.list + PATCHes), budget-stops, and re-enqueues
    // the stale arc. The remedy aborts at entry: zero fetches, no
    // continuation, and the stale-skip summary contract.
    expect(
      fetchCalls,
      "stale resumed hop must not issue ANY external fetch — it did real " +
        "Google work on a stale arc instead of aborting at the entry pre-check",
    ).toBe(0);
    expect(result.continuation).toBeUndefined();
    expect(result.summary.sync_token_write_skipped).toBe(true);
    expect(result.summary.stored_next_sync_token).toBe(false);
    warnSpy.mockRestore();
  });
});

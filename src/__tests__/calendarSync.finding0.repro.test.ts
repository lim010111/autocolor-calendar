import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { SyncContext } from "../services/calendarSync";
import { runIncrementalSync } from "../services/calendarSync";

// Adversarial repro for merge-gate finding: "CAS scope assumes the claim is
// a hard mutex" (sync-reliability #04 follow-up).
//
// The #04 fix gates the CAS-conditional final token write on
// `resumedIncremental = start.syncToken !== undefined && start.pageToken !==
// undefined` — i.e. continuation-resume hops ONLY. A FRESH incremental run
// (`runIncrementalSync(ctx)` with a stored nextSyncToken and no opts) enters
// `runPagedList` with `start.pageToken === undefined`, so it takes the
// unconditional `else` branch and persists its final token with a plain
// (userId, calendarId) UPDATE — no store-change detection at all.
//
// The gate's justifying comment ("Every run reads+writes the token under the
// sync claim, so fresh runs are already atomic") assumes the claim is a hard
// mutex. It is not: src/lib/syncClaim.ts allows a second run to take over
// after the 5-minute STALE_WINDOW_MS while the first run is still executing
// (the file's own header comment acknowledges the overlap). In that window a
// later run can complete and store a NEWER token; the original overrunning
// fresh run then writes its OLDER arc token unconditionally — a second
// token-rollback path identical in kind to the one #04 fixed for resume hops.
//
// Expected (finding-fixed) behavior asserted here — mirroring the protective
// contract the #04 CAS already gives resume hops, with the store change
// simulated via the empty-RETURNING channel (`casRows: []`):
//   1. the fresh run's final token write consults the store (the update
//      chain's `.returning()` path is exercised at least once),
//   2. on a store mismatch the write is skipped:
//      summary.sync_token_write_skipped === true,
//   3. summary.stored_next_sync_token === false (nothing was persisted).
//
// At HEAD this test FAILS on assertion (2)/(3)/(1): the fresh path awaits the
// unconditional `.where()` thenable, never calls `.returning()`, and reports
// stored_next_sync_token=true — proving the unconditional rollback path.

const USER_ID = "11111111-1111-1111-1111-111111111111";
const CAL = "primary";

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

// Minimal db double (copied from calendarSync.test.ts's makeDb — not exported
// there). `casRows` drives the CAS UPDATE … RETURNING result: `[]` simulates
// an interleaved run having changed sync_state.nextSyncToken since this run
// read its start token. Unconditional updates await `.where()` directly and
// never touch `casState.returningCalls`.
function makeDb(opts: {
  nextSyncToken?: string | null;
  tokenRow?: {
    iv: Uint8Array;
    encryptedRefreshToken: Uint8Array;
    scope: string;
    needsReauth: boolean;
  } | null;
  casRows?: Array<{ id: string }>;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const casState = { returningCalls: 0 };
  const db = {
    select: (cols?: Record<string, unknown>) => ({
      from: (_table: unknown) => ({
        where: (_w: unknown) => ({
          // Awaited directly (no .limit/.orderBy) by labelReconcile's rules
          // select — resolve to an empty rule set so reconcile no-ops.
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
              returning: async () => {
                casState.returningCalls += 1;
                return opts.casRows ?? [{ id: "sync-state-row" }];
              },
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
  return { db: db as never, updates, casState };
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
    // ADR-0006 label reconcile probe — served out-of-band (empty label set).
    if (url.includes("fields=labelProperties")) {
      return new Response("{}", { status: 200 });
    }
    const r = queue.shift();
    if (!r) throw new Error("unexpected fetch");
    return r;
  }) as typeof fetch;
}

describe("finding repro — fresh incremental final token write ignores store changes", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    // The protective path warns on a skipped write; keep test output clean.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("store changed mid-run (empty RETURNING) → fresh run must skip its token write, not persist unconditionally", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    // casRows: [] — an overlapping run (post-5-min stale-window takeover,
    // syncClaim.ts) already stored a newer token; any store-conditional
    // write by THIS run must resolve to zero rows.
    const { db, casState } = makeDb({
      nextSyncToken: "old-tok",
      tokenRow,
      casRows: [],
    });

    mockFetchQueue([
      // 1st fetch = token refresh
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      // 2nd fetch = events.list (single page, no items — token arc only)
      new Response(
        JSON.stringify({ items: [], nextSyncToken: "overrun-arc-tok" }),
        { status: 200 },
      ),
    ]);

    // FRESH incremental: no opts → start.pageToken === undefined.
    const ctx: SyncContext = { db, env, userId: USER_ID, calendarId: CAL };
    const result = await runIncrementalSync(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // (2) The store changed under us — the run must report the skip, not
    // pretend it stored its (older) arc token. HEAD: undefined → FAIL.
    expect(result.summary.sync_token_write_skipped).toBe(true);
    // (3) Nothing was persisted. HEAD: true → FAIL.
    expect(result.summary.stored_next_sync_token).toBe(false);
    // (1) The final write consulted the store (conditional RETURNING channel)
    // instead of firing an unconditional (userId, calendarId) UPDATE.
    // HEAD: 0 → FAIL.
    expect(casState.returningCalls).toBeGreaterThan(0);
  });
});

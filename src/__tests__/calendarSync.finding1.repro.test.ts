// Merge-gate finding repro — "The planned skip flag has no persistent surface".
//
// sync-reliability #04: when a continuation-resume hop's CAS write misses
// (sync_state.nextSyncToken changed since the arc started), runPagedList
// skips the WHOLE final UPDATE and only sets the in-memory
// `summary.sync_token_write_skipped` plus a console.warn. `sync_runs`
// persists scalar columns only (no summary jsonb — see src/db/schema.ts
// syncRuns and src/queues/syncConsumer.ts recordSyncRun), so nothing
// durable distinguishes a stale-skip from a #02 budget stop
// (both: outcome='ok' AND stored_next_sync_token=false).
//
// This test FAILS on current HEAD. It passes once the CAS-miss path
// persists the flagged summary through a NARROW follow-up UPDATE to
// sync_state — one whose patch:
//   - carries `lastRunSummary` with `sync_token_write_skipped === true`,
//   - does NOT carry `nextSyncToken` (must not touch the newer token), and
//   - does NOT carry `lastFailureSummary` (a stale-skip is not "progress"
//     that may clear another run's staged failure snapshot).
//
// NOTE on aliasing: the staged CAS patch holds a REFERENCE to the mutable
// `summary` object, and the flag is set after staging — so inspecting the
// recorded CAS patch post-hoc shows the flag "present" even though that
// UPDATE never executed (CAS RETURNING → zero rows). The narrow-patch
// requirement (no nextSyncToken / no lastFailureSummary keys) is what
// excludes that false surface.
//
// Self-contained: the `makeDb` harness in calendarSync.test.ts is not
// exported, so the doubles below are copied (trimmed) from it.

import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import { runIncrementalSync } from "../services/calendarSync";

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

// Minimal db double (copied from calendarSync.test.ts makeDb, trimmed).
// Records every update().set(patch) into `updates`; `casRows: []` makes the
// #04 CAS UPDATE … RETURNING resolve to zero rows (CAS miss).
function makeDb(opts: {
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
          then: (resolve: (v: never[]) => unknown) => resolve([]),
          limit: async () => {
            if (cols && "nextSyncToken" in cols) {
              return [{ nextSyncToken: null }];
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
    if (url.includes("fields=labelProperties")) {
      return new Response("{}", { status: 200 });
    }
    const r = queue.shift();
    if (!r) throw new Error("unexpected fetch");
    return r;
  }) as typeof fetch;
}

describe("finding repro — #04 CAS-miss skip flag needs a persistent surface", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("CAS miss on a continuation resume persists a flagged lastRunSummary via a narrow UPDATE", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    // casRows: [] — sync_state.nextSyncToken changed since the arc started;
    // the conditional final UPDATE resolves to zero rows.
    const { db, updates, casState } = makeDb({ tokenRow, casRows: [] });
    mockFetchQueue([
      new Response(
        JSON.stringify({
          access_token: "at",
          expires_in: 3600,
          scope: "openid",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          items: [{ id: "e1", status: "confirmed", summary: "Lunch", colorId: "" }],
          nextSyncToken: "arc-final-tok",
        }),
        { status: 200 },
      ),
    ]);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const result = await runIncrementalSync(
      { db, env, userId: USER_ID, calendarId: CAL },
      { syncToken: "arc-start-tok", pageToken: "pt-resume" },
    );

    // Sanity: this run took the CAS path and missed — the in-memory flag is
    // set, exactly as the #04 change intends.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(casState.returningCalls).toBe(1);
    expect(result.summary.sync_token_write_skipped).toBe(true);

    // THE FINDING: some persisted patch must carry the flagged summary on a
    // narrow write — lastRunSummary with the flag, and neither a
    // nextSyncToken write nor a lastFailureSummary clear. The staged (and
    // skipped) CAS patch does not qualify: it carries both excluded keys.
    const narrowFlaggedPatches = updates.filter((patch) => {
      if ("nextSyncToken" in patch) return false;
      if ("lastFailureSummary" in patch) return false;
      const lrs = patch.lastRunSummary;
      if (typeof lrs !== "object" || lrs === null) return false;
      return (
        (lrs as Record<string, unknown>).sync_token_write_skipped === true
      );
    });
    expect(
      narrowFlaggedPatches.length,
      "CAS-miss run persisted no narrow UPDATE carrying " +
        "lastRunSummary.sync_token_write_skipped — the flag exists only " +
        "in memory and the warn log (sync_runs has no jsonb summary), so " +
        "a stale-skip is indistinguishable in the DB from a #02 budget stop",
    ).toBeGreaterThan(0);

    warnSpy.mockRestore();
  });
});

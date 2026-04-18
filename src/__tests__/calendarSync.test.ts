import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { SyncContext } from "../services/calendarSync";
import { runFullResync, runIncrementalSync } from "../services/calendarSync";
import type { ClassifyEventFn } from "../services/classifier";

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

// Minimal db double that records update/select calls and returns canned rows.
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
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    select: (cols?: Record<string, unknown>) => ({
      from: (_table: unknown) => ({
        where: (_w: unknown) => ({
          limit: async () => {
            if (cols && "nextSyncToken" in cols) {
              return [{ nextSyncToken: opts.nextSyncToken ?? null }];
            }
            // oauth_tokens select for getGoogleRefreshToken
            return opts.tokenRow ? [opts.tokenRow] : [];
          },
          orderBy: async () => [], // for categories: no rules configured
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { where: async () => undefined };
      },
    }),
    insert: (_table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  };
  return { db: db as never, updates, inserts };
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
  globalThis.fetch = vi.fn(async () => {
    const r = queue.shift();
    if (!r) throw new Error("unexpected fetch");
    return r;
  }) as typeof fetch;
}

describe("calendarSync.runIncrementalSync", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("with stored syncToken → single page → saves new nextSyncToken", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "old-tok", tokenRow });

    mockFetchQueue([
      // 1st fetch = token refresh
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      // 2nd fetch = events.list (single page)
      new Response(
        JSON.stringify({
          items: [
            { id: "e1", status: "confirmed", summary: "Lunch", colorId: "" },
            { id: "e2", status: "cancelled" },
          ],
          nextSyncToken: "fresh-tok",
        }),
        { status: 200 },
      ),
    ]);

    const ctx: SyncContext = { db, env, userId: USER_ID, calendarId: CAL };
    const result = await runIncrementalSync(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.pages).toBe(1);
    expect(result.summary.cancelled).toBe(1);
    expect(result.summary.no_match).toBe(1); // stub classifier returns null
    expect(result.summary.stored_next_sync_token).toBe(true);
    const finalUpdate = updates[updates.length - 1]!;
    expect(finalUpdate.nextSyncToken).toBe("fresh-tok");
  });

  it("410 fullSyncRequired → clears token and returns full_sync_required", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "stale", tokenRow });

    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          error: { code: 410, errors: [{ reason: "fullSyncRequired" }] },
        }),
        { status: 410 },
      ),
    ]);

    const result = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("full_sync_required");
    // The cleanup update clears nextSyncToken.
    const cleared = updates.find((u) => u.nextSyncToken === null);
    expect(cleared).toBeTruthy();
    // lastFullResyncAt must NOT be stamped here — the field records the last
    // *completed* full resync, not the moment a 410 was detected.
    expect(cleared && "lastFullResyncAt" in cleared).toBe(false);
  });

  it("PATCH returning 410 is absorbed as no_match (does not wipe nextSyncToken)", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "old", tokenRow });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      if (init?.method === "PATCH") {
        // Individual event is gone → Google returns 410.
        return new Response(
          JSON.stringify({ error: { code: 410, message: "Resource has been deleted" } }),
          { status: 410 },
        );
      }
      // events.list
      return new Response(
        JSON.stringify({
          items: [{ id: "gone", status: "confirmed", summary: "standup", colorId: "" }],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const classify: ClassifyEventFn = async () => ({
      colorId: "3",
      categoryId: "cat-1",
      reason: "rule",
    });
    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classify,
    });

    // The sync must complete successfully; the 410 on PATCH is a per-event
    // issue, not a token-stale signal. Escalating it would needlessly clear
    // nextSyncToken and trigger a full resync.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.updated).toBe(0);
    expect(result.summary.no_match).toBe(1);
    // nextSyncToken rolls forward to `fresh` — not cleared.
    const finalUpdate = updates[updates.length - 1]!;
    expect(finalUpdate.nextSyncToken).toBe("fresh");
    expect(updates.some((u) => u.nextSyncToken === null)).toBe(false);
  });

  it("PATCH returning 429 propagates as retryable (not silently absorbed)", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "old", tokenRow });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      if (init?.method === "PATCH") {
        // Transient rate limit — Queue must retry the whole sync, not ack-ok.
        return new Response(JSON.stringify({ error: { code: 429 } }), {
          status: 429,
          headers: { "retry-after": "17" },
        });
      }
      return new Response(
        JSON.stringify({
          items: [{ id: "evt", status: "confirmed", summary: "standup", colorId: "" }],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const classify: ClassifyEventFn = async () => ({
      colorId: "3",
      categoryId: "cat-1",
      reason: "rule",
    });
    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classify,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("retryable");
    expect(result.retryAfterSec).toBe(17);
    // Critically, nextSyncToken must NOT advance — otherwise the mis-colored
    // event never comes back on subsequent incremental syncs.
    expect(updates.some((u) => u.nextSyncToken === "fresh")).toBe(false);
  });

  it("PATCH returning 500 propagates as retryable (not silently absorbed)", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "old", tokenRow });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      if (init?.method === "PATCH") {
        return new Response("oops", { status: 502 });
      }
      return new Response(
        JSON.stringify({
          items: [{ id: "evt", status: "confirmed", summary: "standup", colorId: "" }],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const classify: ClassifyEventFn = async () => ({
      colorId: "3",
      categoryId: "cat-1",
      reason: "rule",
    });
    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classify,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("retryable");
    expect(updates.some((u) => u.nextSyncToken === "fresh")).toBe(false);
  });

  it("classifier match + colorId empty → patches event and counts updated", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "old", tokenRow });

    const patchResponses: Response[] = [];
    const patchUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      if (init?.method === "PATCH") {
        patchUrls.push(url);
        patchResponses.push(new Response("{}", { status: 200 }));
        return patchResponses[patchResponses.length - 1]!;
      }
      // events.list
      return new Response(
        JSON.stringify({
          items: [
            { id: "match", status: "confirmed", summary: "standup", colorId: "" },
            { id: "manual", status: "confirmed", summary: "standup", colorId: "7" },
            { id: "already", status: "confirmed", summary: "standup", colorId: "3" },
          ],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const classify: ClassifyEventFn = async () => ({
      colorId: "3",
      categoryId: "cat-1",
      reason: "rule",
    });
    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classify,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.updated).toBe(1);      // "match" patched
    expect(result.summary.skipped_manual).toBe(1); // "manual" (user set 7)
    expect(result.summary.skipped_equal).toBe(1);  // "already" has colorId 3
    expect(patchUrls).toHaveLength(1);
    expect(patchUrls[0]).toContain("/events/match");
    const finalUpdate = updates[updates.length - 1]!;
    expect(finalUpdate.nextSyncToken).toBe("fresh");
  });

  it("ReauthRequiredError → ok=false reason=reauth_required, no token update", async () => {
    const env = makeEnv();
    // Row missing → getGoogleRefreshToken returns null → ReauthRequiredError.
    const { db, updates } = makeDb({ nextSyncToken: "old", tokenRow: null });
    mockFetchQueue([]); // no fetch expected (fails before token refresh? actually yes fails at db)
    const result = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("reauth_required");
    // No nextSyncToken write should have happened.
    expect(updates.some((u) => "nextSyncToken" in u)).toBe(false);
  });
});

describe("calendarSync.runFullResync chunking", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("continuation carries timeMin/timeMax forward unchanged", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: null, tokenRow });

    const listUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      listUrls.push(url);
      // Every page hands back a pageToken so we exceed the 5-page chunk cap.
      const page = listUrls.length;
      return new Response(
        JSON.stringify({
          items: [{ id: `e-${page}`, status: "confirmed", colorId: "" }],
          nextPageToken: `pt-${page + 1}`,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const FIXED_MIN = "2024-01-01T00:00:00.000Z";
    const FIXED_MAX = "2030-01-01T00:00:00.000Z";
    const first = await runFullResync(
      { db, env, userId: USER_ID, calendarId: CAL },
      { timeMin: FIXED_MIN, timeMax: FIXED_MAX },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.continuation).toBeTruthy();
    expect(first.continuation!.timeMin).toBe(FIXED_MIN);
    expect(first.continuation!.timeMax).toBe(FIXED_MAX);
    // Every list call within the first chunk must have used the passed window.
    for (const u of listUrls) {
      expect(u).toContain(`timeMin=${encodeURIComponent(FIXED_MIN)}`);
      expect(u).toContain(`timeMax=${encodeURIComponent(FIXED_MAX)}`);
    }

    // Simulate the consumer re-enqueuing the continuation: timeMin/timeMax
    // from the previous run must be threaded back in, not recomputed.
    listUrls.length = 0;
    const second = await runFullResync(
      { db, env, userId: USER_ID, calendarId: CAL },
      {
        pageToken: first.continuation!.pageToken,
        timeMin: first.continuation!.timeMin,
        timeMax: first.continuation!.timeMax,
      },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    for (const u of listUrls) {
      expect(u).toContain(`timeMin=${encodeURIComponent(FIXED_MIN)}`);
      expect(u).toContain(`timeMax=${encodeURIComponent(FIXED_MAX)}`);
    }
    // pageToken on the very first request of this run should be the one we
    // passed in (continuation resume), not a fresh start.
    expect(listUrls[0]).toContain(
      `pageToken=${encodeURIComponent(first.continuation!.pageToken)}`,
    );
  });

  it("computes a fresh window when no timeMin/timeMax is provided", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: null, tokenRow });

    const listUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      listUrls.push(url);
      return new Response(
        JSON.stringify({ items: [], nextSyncToken: "done" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await runFullResync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(result.ok).toBe(true);
    // A timeMin and timeMax were attached, even though the caller didn't pass any.
    expect(listUrls[0]).toMatch(/timeMin=[^&]+/);
    expect(listUrls[0]).toMatch(/timeMax=[^&]+/);
  });
});

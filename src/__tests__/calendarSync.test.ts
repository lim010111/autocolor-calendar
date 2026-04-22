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
  // §5.3: rows returned by loadCategories (orderBy tail of categories select).
  categories?: Array<{
    id: string;
    name: string;
    colorId: string;
    keywords: string[];
    priority: number;
  }>;
  // §5.3: row returned by reserveLlmCall's UPSERT … RETURNING. Present =
  // quota available, omit = over-quota (empty RETURNING → ok: false).
  reserveRow?: { callCount: number };
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
          orderBy: async () => opts.categories ?? [],
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
        return {
          onConflictDoNothing: async () => undefined,
          onConflictDoUpdate: (_args: unknown) => ({
            returning: async () => (opts.reserveRow ? [opts.reserveRow] : []),
          }),
        };
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

describe("calendarSync — §5.4 ownership-aware color application", () => {
  // INTENT: this block asserts marker payloads using LITERAL strings
  // ("autocolor_v", "autocolor_color", "autocolor_category", "1") rather
  // than `AUTOCOLOR_KEYS` constants. That is deliberate — these keys are
  // the on-the-wire format Google stores against the event, and any rename
  // would silently invalidate every existing event's marker. Do NOT DRY
  // these into the constants; the literals are a wire-format regression
  // guard. The googleCalendar.test.ts patchEventColor cases use the
  // constants because those test the in-process function contract, not the
  // wire format.
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  type PatchCall = { url: string; body: unknown };

  function stubSyncWith(events: Array<Record<string, unknown>>): {
    patches: PatchCall[];
  } {
    const patches: PatchCall[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "at",
            expires_in: 3600,
            scope: "openid",
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }
      if (init?.method === "PATCH") {
        patches.push({
          url,
          body: init.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response("{}", { status: 200 });
      }
      // events.list
      return new Response(
        JSON.stringify({ items: events, nextSyncToken: "fresh" }),
        { status: 200 },
      );
    }) as typeof fetch;
    return { patches };
  }

  const classifyToBlue: ClassifyEventFn = async () => ({
    colorId: "3",
    categoryId: "cat-1",
    reason: "rule",
  });

  it("PATCHes empty-color event with marker payload", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      { id: "fresh", status: "confirmed", summary: "x", colorId: "" },
    ]);

    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classifyToBlue,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.updated).toBe(1);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({
      colorId: "3",
      extendedProperties: {
        private: {
          autocolor_v: "1",
          autocolor_color: "3",
          autocolor_category: "cat-1",
        },
      },
    });
  });

  it("re-applies when app-owned color differs from new target", async () => {
    // Marker says we last wrote "5" and the event still wears "5" → app-owned.
    // Rule has since changed to "3" → we may overwrite, stamping a fresh marker.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "owned",
        status: "confirmed",
        summary: "x",
        colorId: "5",
        extendedProperties: {
          private: {
            autocolor_v: "1",
            autocolor_color: "5",
            autocolor_category: "cat-old",
          },
        },
      },
    ]);

    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classifyToBlue,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.updated).toBe(1);
    expect(result.summary.skipped_manual).toBe(0);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({
      colorId: "3",
      extendedProperties: {
        private: {
          autocolor_v: "1",
          autocolor_color: "3",
          autocolor_category: "cat-1",
        },
      },
    });
  });

  it("skips when user changed color after we owned it (stale marker)", async () => {
    // Marker color "7" but event currently shows "5" → user changed it after
    // our last PATCH. We must not overwrite even though the marker is present.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "user-changed",
        status: "confirmed",
        summary: "x",
        colorId: "5",
        extendedProperties: {
          private: {
            autocolor_v: "1",
            autocolor_color: "7",
            autocolor_category: "cat-old",
          },
        },
      },
    ]);

    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classifyToBlue,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.skipped_manual).toBe(1);
    expect(result.summary.updated).toBe(0);
    expect(patches).toHaveLength(0);
  });

  it("skipped_equal short-circuits even when valid marker matches current", async () => {
    // current === target AND a valid app-owned marker is present. The
    // `current === target` short-circuit must fire FIRST and bump
    // `skipped_equal` — never PATCH (idempotent no-op). Regression guard
    // against a future check-order rearrangement that could re-PATCH the
    // same color and burn the API quota.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "stable",
        status: "confirmed",
        summary: "x",
        colorId: "3",
        extendedProperties: {
          private: {
            autocolor_v: "1",
            autocolor_color: "3",
            autocolor_category: "cat-1",
          },
        },
      },
    ]);

    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classifyToBlue,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.skipped_equal).toBe(1);
    expect(result.summary.updated).toBe(0);
    expect(result.summary.skipped_manual).toBe(0);
    expect(patches).toHaveLength(0);
  });

  it("treats unknown autocolor_v as opaque (skips even on color match)", async () => {
    // Forward-compat / rollback safety: a v1-aware deploy seeing a v2
    // marker must NOT trust the v2 schema. The marker is opaque, so the
    // event is treated as user-manual (no app-owned re-apply).
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "v2-marker",
        status: "confirmed",
        summary: "x",
        colorId: "5",
        extendedProperties: {
          private: {
            autocolor_v: "2",
            autocolor_color: "5",
            autocolor_category: "cat-future",
          },
        },
      },
    ]);

    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classifyToBlue,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.skipped_manual).toBe(1);
    expect(result.summary.updated).toBe(0);
    expect(patches).toHaveLength(0);
  });

  it("does not retro-claim user-set color matching target (no marker)", async () => {
    // current === target but no marker → skipped_equal (not updated). Critical
    // invariant: we never PATCH, so we never stamp a marker on a color we
    // didn't write. Otherwise we'd silently transfer ownership and the next
    // rule change would re-color what is, semantically, a user-set event.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      { id: "coincidence", status: "confirmed", summary: "x", colorId: "3" },
    ]);

    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: classifyToBlue,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.skipped_equal).toBe(1);
    expect(result.summary.updated).toBe(0);
    expect(patches).toHaveLength(0);
  });
});

describe("calendarSync — §5.3 LLM fallback counter wiring", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("injected classifyEvent returning null → no_match bumps, LLM counters stay 0", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "t", tokenRow });

    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          items: [{ id: "e", status: "confirmed", summary: "x", colorId: "" }],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      ),
    ]);

    const nullClassify: ClassifyEventFn = async () => null;
    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: nullClassify,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.no_match).toBe(1);
    // Injection seam bypasses the chain entirely → LLM counters stay at 0.
    expect(result.summary.llm_attempted).toBe(0);
    expect(result.summary.llm_succeeded).toBe(0);
    expect(result.summary.llm_timeout).toBe(0);
    expect(result.summary.llm_quota_exceeded).toBe(0);
  });

  it("default chain + OPENAI_API_KEY + stubbed OpenAI hit → llm_attempted=1, llm_succeeded=1, updated=1", async () => {
    // §5.3 positive wiring test (review I1). Goes through the real
    // buildDefaultClassifier + classifyWithLlm + reserveLlmCall path with
    // fetch stubbed so no network is touched.
    const env: Bindings = { ...makeEnv(), OPENAI_API_KEY: "sk-test" };
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({
      nextSyncToken: "t",
      tokenRow,
      categories: [
        { id: "c-1", name: "회의", colorId: "9", keywords: ["회의"], priority: 100 },
      ],
      reserveRow: { callCount: 1 },
    });

    // Rule leg misses (summary "totally unrelated" has no keyword match),
    // so the chain delegates to LLM, which returns "회의" → colorId "9".
    mockFetchQueue([
      // 1. token refresh
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      // 2. events.list
      new Response(
        JSON.stringify({
          items: [
            { id: "e1", status: "confirmed", summary: "totally unrelated", colorId: "" },
          ],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      ),
      // 3. OpenAI chat completions
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ category_name: "회의" }) } }],
        }),
        { status: 200 },
      ),
      // 4. events.patch
      new Response("", { status: 200 }),
    ]);

    const result = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.llm_attempted).toBe(1);
    expect(result.summary.llm_succeeded).toBe(1);
    expect(result.summary.llm_timeout).toBe(0);
    expect(result.summary.llm_quota_exceeded).toBe(0);
    expect(result.summary.updated).toBe(1);
    expect(result.summary.no_match).toBe(0);
  });

  it("default chain + no OPENAI_API_KEY → rule-miss collapses to no_match, LLM counters stay 0", async () => {
    // env without OPENAI_API_KEY: chain's LLM leg short-circuits to null
    // without bumping any LLM counter, processEvent rolls up to no_match.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "t", tokenRow });

    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          items: [{ id: "e", status: "confirmed", summary: "no match", colorId: "" }],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      ),
    ]);

    const result = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.no_match).toBe(1);
    expect(result.summary.llm_attempted).toBe(0);
    expect(result.summary.llm_succeeded).toBe(0);
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

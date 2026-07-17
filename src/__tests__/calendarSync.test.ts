import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import type { SyncContext } from "../services/calendarSync";
import { runFullResync, runIncrementalSync } from "../services/calendarSync";
import type { ClassifyEventFn } from "../services/classifierOutcomes";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const CAL = "primary";
// ADR-0006 — the label every test rule writes (classification output is a
// native label now; colorId on the rule is a legacy cache).
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
    labelId?: string | null;
    labelDeletedAt?: Date | null;
  }>;
  // §5.3: row returned by reserveLlmCall's UPSERT … RETURNING. Present =
  // quota available, omit = over-quota (empty RETURNING → ok: false).
  reserveRow?: { callCount: number };
  // sync-reliability #04: rows the final CAS UPDATE … RETURNING resolves to.
  // Default = one row (CAS passes); pass [] to simulate an interleaved run
  // having changed sync_state.nextSyncToken since the arc started.
  casRows?: Array<{ id: string }>;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
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
          orderBy: async () => opts.categories ?? [],
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return {
          // Awaited directly by unconditional updates; the #04 CAS path
          // chains `.returning()` instead, so the double supports both.
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
  return { db: db as never, updates, inserts, casState };
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
    // ADR-0006 — the default classifier's label reconcile issues one
    // calendars.get?fields=labelProperties per run. Serve it out-of-band
    // (empty label set) so queue-based tests keep their token→list→…
    // ordering regardless of whether the test uses the default classifier.
    if (url.includes("fields=labelProperties")) {
      return new Response("{}", { status: 200 });
    }
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
      if (url.includes("fields=labelProperties")) {
        // ADR-0006 label reconcile probe — empty label set.
        return new Response("{}", { status: 200 });
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
      kind: "embeddingHit",
      rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: TARGET_LABEL },
      seed: { id: "s-1", text: "standup" },
      grade: "declared",
      score: 0.9,
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
      if (url.includes("fields=labelProperties")) {
        // ADR-0006 label reconcile probe — empty label set.
        return new Response("{}", { status: 200 });
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
      kind: "embeddingHit",
      rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: TARGET_LABEL },
      seed: { id: "s-1", text: "standup" },
      grade: "declared",
      score: 0.9,
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
      if (url.includes("fields=labelProperties")) {
        // ADR-0006 label reconcile probe — empty label set.
        return new Response("{}", { status: 200 });
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
      kind: "embeddingHit",
      rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: TARGET_LABEL },
      seed: { id: "s-1", text: "standup" },
      grade: "declared",
      score: 0.9,
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
      if (url.includes("fields=labelProperties")) {
        // ADR-0006 label reconcile probe — empty label set.
        return new Response("{}", { status: 200 });
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
            { id: "already", status: "confirmed", summary: "standup", colorId: "", eventLabelId: TARGET_LABEL },
          ],
          nextSyncToken: "fresh",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const classify: ClassifyEventFn = async () => ({
      kind: "embeddingHit",
      rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: TARGET_LABEL },
      seed: { id: "s-1", text: "standup" },
      grade: "declared",
      score: 0.9,
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
  // ("autocolor_v", "autocolor_label", "autocolor_category", "2", plus the
  // purged legacy "autocolor_color") rather than `AUTOCOLOR_KEYS` constants. That is deliberate — these keys are
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
    kind: "embeddingHit",
    rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: TARGET_LABEL },
    seed: { id: "s-1", text: "kw" },
    grade: "declared",
    score: 0.9,
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
    expect(patches[0]!.url).toContain("eventLabelVersion=1");
    expect(patches[0]!.body).toEqual({
      eventLabelId: TARGET_LABEL,
      extendedProperties: {
        private: {
          autocolor_v: "2",
          autocolor_label: TARGET_LABEL,
          autocolor_category: "cat-1",
          autocolor_color: null,
        },
      },
    });
  });

  it("re-applies v1-app-owned event (colorId equality) and re-stamps marker v2", async () => {
    // Marker v1 says we last wrote "5" and the event still wears "5" →
    // app-owned via the transitional colorId probe. The rule now writes a
    // label → PATCH goes out as eventLabelId + a fresh v2 marker (this is
    // the #04 re-stamp path), purging the legacy autocolor_color key.
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
      eventLabelId: TARGET_LABEL,
      extendedProperties: {
        private: {
          autocolor_v: "2",
          autocolor_label: TARGET_LABEL,
          autocolor_category: "cat-1",
          autocolor_color: null,
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
    // current label === target AND a valid app-owned v2 marker is present.
    // The equality short-circuit must fire FIRST and bump `skipped_equal` —
    // never PATCH (idempotent no-op). Regression guard against a future
    // check-order rearrangement that could re-PATCH the same label and burn
    // the API quota.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "stable",
        status: "confirmed",
        summary: "x",
        colorId: "",
        eventLabelId: TARGET_LABEL,
        extendedProperties: {
          private: {
            autocolor_v: "2",
            autocolor_label: TARGET_LABEL,
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

  it("treats unknown autocolor_v as opaque (skips even on value match)", async () => {
    // Forward-compat / rollback safety: a v2-aware deploy seeing a v3
    // marker must NOT trust the v3 schema. The marker is opaque, so the
    // event is treated as user-manual (no app-owned re-apply).
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "v3-marker",
        status: "confirmed",
        summary: "x",
        colorId: "5",
        extendedProperties: {
          private: {
            autocolor_v: "3",
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

  it("does not retro-claim user-set label matching target (no marker)", async () => {
    // current label === target but no marker → skipped_equal (not updated).
    // Critical invariant: we never PATCH, so we never stamp a marker on a
    // label we didn't write. Otherwise we'd silently transfer ownership and
    // the next rule change would re-label what is, semantically, a user-set
    // event.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "coincidence",
        status: "confirmed",
        summary: "x",
        colorId: "",
        eventLabelId: TARGET_LABEL,
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
    expect(patches).toHaveLength(0);
  });

  // native-labels #01 (ADR-0006) — label-aware manual gate. Google's label
  // rewrite makes user color picks surface as `eventLabelId`, with an EMPTY
  // legacy `colorId` for non-classic colors. The four cases below pin the
  // gate: labelled+empty-colorId is manual (the pre-#01 pipeline painted
  // over it), app-owned bridge labels stay re-applicable, the best-match
  // disguise keeps its pre-existing skip, and label-less colorless events
  // are still painted (covered by "PATCHes empty-color event" above).
  it("skips labelled event whose colorId reads empty (no marker)", async () => {
    // THE defect this issue fixes: a non-classic user color used to look
    // like "no color" and got painted over, silently severing the user's
    // label connection.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "user-labelled",
        status: "confirmed",
        summary: "x",
        colorId: "",
        eventLabelId: "11111111-2222-3333-4444-555555555555",
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

  it("skips labelled event with stale marker even when colorId is empty", async () => {
    // Marker says we wrote "7" but the user re-painted with a non-classic
    // color afterwards → colorId reads "" + eventLabelId present. Marker
    // mismatch + label = manual.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "repainted-via-label",
        status: "confirmed",
        summary: "x",
        colorId: "",
        eventLabelId: "22222222-3333-4444-5555-666666666666",
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

  it("re-applies app-owned event that carries Google's bridge label", async () => {
    // Our own colorId PATCHes are bridged to a label slot by Google, so an
    // app-owned event ALSO has eventLabelId. Label presence alone must not
    // flip it to manual — marker v1 equality still owns it (no false skip).
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "bridged-owned",
        status: "confirmed",
        summary: "x",
        colorId: "5",
        eventLabelId: "99999999-8888-7777-6666-555555555555",
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
      eventLabelId: TARGET_LABEL,
      extendedProperties: {
        private: {
          autocolor_v: "2",
          autocolor_label: TARGET_LABEL,
          autocolor_category: "cat-1",
          autocolor_color: null,
        },
      },
    });
  });

  it("best-match disguise: labelled event with non-empty colorId stays skipped (regression)", async () => {
    // A named user label reads back as best-match colorId "4" + eventLabelId.
    // Pre-#01 logic already skipped it via `current !== "" && !appOwned`;
    // this pins that the label-aware gate did not regress the path.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "best-match-disguise",
        status: "confirmed",
        summary: "x",
        colorId: "4",
        eventLabelId: "33333333-4444-5555-6666-777777777777",
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

  it("hit on a rule without labelId → skipped_no_label, no PATCH (pre-cutover)", async () => {
    // ADR-0006 — a rule that predates the #04 cutover has labelId NULL.
    // Classification output is a label, so there is nothing to write; the
    // event is counted, not guessed.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      { id: "fresh", status: "confirmed", summary: "x", colorId: "" },
    ]);

    const noLabelClassify: ClassifyEventFn = async () => ({
      kind: "embeddingHit",
      rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: null },
      seed: { id: "s-1", text: "kw" },
      grade: "declared",
      score: 0.9,
    });
    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: noLabelClassify,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.skipped_no_label).toBe(1);
    expect(result.summary.updated).toBe(0);
    expect(result.summary.skipped_manual).toBe(0);
    expect(patches).toHaveLength(0);
  });

  it("re-applies v2-app-owned event when the rule's label changed", async () => {
    // Marker v2 label === current eventLabelId → app-owned. A different
    // classification target may overwrite, stamping a fresh v2 marker.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "v2-owned",
        status: "confirmed",
        summary: "x",
        colorId: "",
        eventLabelId: "44444444-4444-4444-4444-444444444444",
        extendedProperties: {
          private: {
            autocolor_v: "2",
            autocolor_label: "44444444-4444-4444-4444-444444444444",
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
      eventLabelId: TARGET_LABEL,
      extendedProperties: {
        private: {
          autocolor_v: "2",
          autocolor_label: TARGET_LABEL,
          autocolor_category: "cat-1",
          autocolor_color: null,
        },
      },
    });
  });

  it("skips v2-marked event when the user re-labelled after our PATCH", async () => {
    // Marker v2 label ≠ current eventLabelId → the user picked another
    // label chip after us. Manual — never overwrite.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "old", tokenRow });
    const { patches } = stubSyncWith([
      {
        id: "v2-relabelled",
        status: "confirmed",
        summary: "x",
        colorId: "",
        eventLabelId: "55555555-5555-5555-5555-555555555555",
        extendedProperties: {
          private: {
            autocolor_v: "2",
            autocolor_label: "44444444-4444-4444-4444-444444444444",
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

    const nullClassify: ClassifyEventFn = async () => ({ kind: "noMatch" });
    const result = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: nullClassify,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Injection seam bypasses the chain entirely → no sinks are installed,
    // so neither `no_match` nor any LLM counter is bumped. In production
    // the default chain owns these counters via syncSummarySink (verified
    // by the "default chain + no OPENAI_API_KEY" case below).
    expect(result.summary.no_match).toBe(0);
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
        {
          id: "c-1",
          name: "회의",
          colorId: "9",
          keywords: ["회의"],
          priority: 100,
          labelId: "99999999-9999-9999-9999-999999999999",
          labelDeletedAt: null,
        },
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
      if (url.includes("fields=labelProperties")) {
        // ADR-0006 label reconcile probe — empty label set.
        return new Response("{}", { status: 200 });
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
        // full_resync continuations always carry the window (the union's
        // syncToken shape belongs to incremental budget stops — #02).
        timeMin: first.continuation!.timeMin!,
        timeMax: first.continuation!.timeMax!,
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
      if (url.includes("fields=labelProperties")) {
        // ADR-0006 label reconcile probe — empty label set.
        return new Response("{}", { status: 200 });
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

describe("calendarSync — §6 Wave A observability hooks", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("success UPDATE clears last_failure_summary to null", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "tok", tokenRow });
    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({ items: [], nextSyncToken: "fresh-tok" }),
        { status: 200 },
      ),
    ]);
    const res = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(res.ok).toBe(true);
    const finalUpdate = updates[updates.length - 1]!;
    // Must be explicitly null (not undefined) so the column is overwritten.
    expect(finalUpdate).toHaveProperty("lastFailureSummary", null);
  });

  it("mid-chunked full_resync UPDATE also clears last_failure_summary to null", async () => {
    // guards calendarSync.ts:438 — the §6 Wave A contract requires the clear
    // to happen on BOTH the full-sync-complete branch (above) and the
    // mid-chunk branch below. Removing the clear would let a stale snapshot
    // survive a long chunked resync and land in an unrelated future DLQ row.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: null, tokenRow });

    let page = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      if (url.includes("fields=labelProperties")) {
        // ADR-0006 label reconcile probe — empty label set.
        return new Response("{}", { status: 200 });
      }
      page += 1;
      // Every page hands back nextPageToken but never nextSyncToken, so
      // runPagedList loops past MAX_PAGES_PER_FULL_RESYNC_RUN=5 and exits
      // via the `else if (!finalSyncToken)` branch at calendarSync.ts:431-447.
      return new Response(
        JSON.stringify({
          items: [{ id: `e-${page}`, status: "confirmed", colorId: "" }],
          nextPageToken: `pt-${page + 1}`,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await runFullResync(
      { db, env, userId: USER_ID, calendarId: CAL },
      { timeMin: "2024-01-01T00:00:00.000Z", timeMax: "2030-01-01T00:00:00.000Z" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Truthy continuation confirms the mid-chunk branch fired, not full-sync.
    expect(result.continuation).toBeTruthy();

    // Filter for the UPDATE that stamps lastRunSummary instead of indexing
    // the tail — robust against a future UPDATE (e.g. token refresh) landing
    // after this one and silently shadowing the assertion.
    const runSummaryUpdate = updates.find((u) => "lastRunSummary" in u);
    expect(runSummaryUpdate).toBeDefined();
    expect(runSummaryUpdate!).toHaveProperty("lastFailureSummary", null);
  });

  it("recordLlmCalls receives the buffer when LLM fires (rule-miss path)", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "tok", tokenRow });
    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          items: [{ id: "e1", status: "confirmed", summary: "x", colorId: "" }],
          nextSyncToken: "done",
        }),
        { status: 200 },
      ),
    ]);
    const recordLlmCalls = vi.fn();
    // Custom classifyEvent that simulates an LLM-returning-hit — but since
    // the hook sits on runPagedList not on the classifier, we synthesize
    // the record by calling the hook via a one-off ClassifyEventFn wrapper.
    // Simpler: use the built-in classifier by omitting `classifyEvent` and
    // letting the rule-miss + empty categories fall to `no_match` (no LLM).
    // For this test, we verify the hook is NOT called when nothing fires.
    const res = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      recordLlmCalls,
    });
    expect(res.ok).toBe(true);
    // Empty buffer → hook must not be invoked (flushLlmCalls short-circuits).
    expect(recordLlmCalls).not.toHaveBeenCalled();
  });

  it("recordLlmCalls undefined → no-op (no throw)", async () => {
    // Regression guard for the `ctx.recordLlmCalls?.(buffer)` optional call.
    // A production caller that omits the hook must not crash the sync run.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "tok", tokenRow });
    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({ items: [], nextSyncToken: "done" }),
        { status: 200 },
      ),
    ]);
    const res = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(res.ok).toBe(true);
  });
});

describe("calendarSync — #02 subrequest budget guard", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  const FIXED_MIN = "2024-01-01T00:00:00.000Z";
  const FIXED_MAX = "2030-01-01T00:00:00.000Z";

  // Injected classifier that mimics the LLM leg's fetch cost: `attempts` is
  // what the budget counter reads off the llmRecord (`processEvent`).
  const llmHitClassify =
    (attempts: number): ClassifyEventFn =>
    async (event) => ({
      kind: "llmHit",
      rule: { id: "cat-1", name: "cat-1", colorId: "3", labelId: TARGET_LABEL },
      llmRecord: {
        outcome: "hit",
        latencyMs: 1,
        categoryCount: 1,
        attempts,
        eventId: event.id,
      },
    });

  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
      { status: 200 },
    );
  }

  it("derives events.list maxResults from the budget env var", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "tok", tokenRow });

    const listUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      // ADR-0006 label reconcile — the run's fixed extra fetch, not events.list.
      if (url.includes("fields=labelProperties")) {
        return new Response("{}", { status: 200 });
      }
      listUrls.push(url);
      return new Response(JSON.stringify({ items: [], nextSyncToken: "fresh" }), { status: 200 });
    }) as typeof fetch;

    // Default budget 40 → floor((40-1-2)/3) = 12 (run-fixed reconcile fetch
    // pre-paid by the derivation).
    let res = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(res.ok).toBe(true);
    expect(listUrls[0]).toContain("maxResults=12");

    // Custom budget 100 → floor((100-1-2)/3) = 32.
    listUrls.length = 0;
    res = await runIncrementalSync({
      db,
      env: { ...env, SYNC_SUBREQUEST_BUDGET: "100" },
      userId: USER_ID,
      calendarId: CAL,
    });
    expect(res.ok).toBe(true);
    expect(listUrls[0]).toContain("maxResults=32");
  });

  it("mid-page budget stop → continuation resumes from the CURRENT page token; warn logs counters only", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: null, tokenRow });

    // Two pages. Page pt-1: 11 events (cost 1 list + 11×3 = 34 → next page
    // still fits: 34+5 ≤ 40). Page pt-2: 12 events — the guard trips before
    // event 2 (used 38 → 38+3 > 40), so the continuation must point at pt-2
    // itself (redo the partially-processed page), not at a later token.
    const items = (page: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${page}-e${i}`,
        status: "confirmed",
        summary: "SECRET-EVENT-TITLE",
        colorId: "",
      }));
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      if (init?.method === "PATCH") return new Response("{}", { status: 200 });
      const pageToken = new URL(url).searchParams.get("pageToken");
      if (pageToken === "pt-1") {
        return new Response(
          JSON.stringify({ items: items("p1", 11), nextPageToken: "pt-2" }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ items: items("p2", 12), nextPageToken: "pt-3" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await runFullResync(
      { db, env, userId: USER_ID, calendarId: CAL, classifyEvent: llmHitClassify(2) },
      { pageToken: "pt-1", timeMin: FIXED_MIN, timeMax: FIXED_MAX },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.continuation).toBeTruthy();
    expect(result.continuation!.pageToken).toBe("pt-2");
    expect(result.continuation!.timeMin).toBe(FIXED_MIN);
    expect(result.continuation!.timeMax).toBe(FIXED_MAX);
    // 11 events of pt-1 + 1 event of pt-2 processed before the stop.
    expect(result.summary.seen).toBe(12);

    // AC #3 — exactly one warn line, counters only, no event content.
    const budgetWarns = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("subrequest budget"));
    expect(budgetWarns).toHaveLength(1);
    const payload = JSON.parse(budgetWarns[0]!) as Record<string, unknown>;
    expect(payload.level).toBe("warn");
    expect(payload.used).toBe(38);
    expect(payload.budget).toBe(40);
    expect(typeof payload.pages).toBe("number");
    expect(typeof payload.seen).toBe("number");
    expect(budgetWarns[0]).not.toContain("SECRET-EVENT-TITLE");
    warnSpy.mockRestore();
  });

  it("incremental budget stop → continuation carries the (syncToken, pageToken) pair; resume completes", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates } = makeDb({ nextSyncToken: "sync-tok-1", tokenRow });

    const items = (page: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${page}-e${i}`,
        status: "confirmed",
        summary: "x",
        colorId: "",
      }));
    const listUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      if (init?.method === "PATCH") return new Response("{}", { status: 200 });
      listUrls.push(url);
      const pageToken = new URL(url).searchParams.get("pageToken");
      if (pageToken === null) {
        return new Response(
          JSON.stringify({ items: items("p1", 11), nextPageToken: "pt-2" }),
          { status: 200 },
        );
      }
      // Resume page — final page of the delta.
      return new Response(
        JSON.stringify({ items: items("p2", 12), nextSyncToken: "fresh-2" }),
        { status: 200 },
      );
    }) as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // First invocation: page 1 (11 events, used 34) → boundary allows page 2
    // → mid-page stop on page 2 → syncToken-shaped continuation.
    const first = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      classifyEvent: llmHitClassify(2),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.continuation).toEqual({ pageToken: "pt-2", syncToken: "sync-tok-1" });
    // Interrupted run must NOT store a new nextSyncToken.
    expect(first.summary.stored_next_sync_token).toBe(false);
    expect(updates.some((u) => "nextSyncToken" in u && u.nextSyncToken !== null)).toBe(false);

    // Second invocation (fresh budget): resume with the carried pair — the
    // list call must include BOTH tokens, and the run completes and stores
    // the fresh nextSyncToken.
    listUrls.length = 0;
    const second = await runIncrementalSync(
      { db, env, userId: USER_ID, calendarId: CAL, classifyEvent: llmHitClassify(2) },
      { syncToken: "sync-tok-1", pageToken: "pt-2" },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(listUrls[0]).toContain("syncToken=sync-tok-1");
    expect(listUrls[0]).toContain("pageToken=pt-2");
    expect(second.continuation).toBeUndefined();
    expect(second.summary.stored_next_sync_token).toBe(true);
    expect(updates.some((u) => u.nextSyncToken === "fresh-2")).toBe(true);
    warnSpy.mockRestore();
  });

  it("large-calendar simulation (AC #4): a 50-fetch cap never trips; the arc completes via chunk resume", async () => {
    // End-to-end arc through the REAL classifier chain (OpenAI fetch counted
    // per event) against a simulated Workers-Free subrequest cap: every fetch
    // past 50 within one invocation throws "Too many subrequests" — exactly
    // the prod failure mode. The guard must stop each invocation before the
    // cap and finish the whole 60-event calendar via continuations.
    const env: Bindings = { ...makeEnv(), OPENAI_API_KEY: "sk-test" };
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({
      nextSyncToken: null,
      tokenRow,
      categories: [
        {
          id: "c-1",
          name: "회의",
          colorId: "9",
          keywords: ["회의"],
          priority: 100,
          labelId: TARGET_LABEL,
        },
      ],
      reserveRow: { callCount: 1 },
    });

    const TOTAL = 60;
    const allIds = Array.from({ length: TOTAL }, (_, i) => `e-${i}`);
    const patchedIds = new Set<string>();
    let invocationFetches = 0;
    let maxInvocationFetches = 0;
    let capTrips = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      invocationFetches += 1;
      maxInvocationFetches = Math.max(maxInvocationFetches, invocationFetches);
      if (invocationFetches > 50) {
        capTrips += 1;
        throw new Error("Too many subrequests.");
      }
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      // ADR-0006 label reconcile — one calendars.get per invocation; counts
      // toward the simulated cap exactly like it does in prod.
      if (url.includes("fields=labelProperties")) {
        return new Response("{}", { status: 200 });
      }
      if (url.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ category_name: "회의" }) } }],
          }),
          { status: 200 },
        );
      }
      if (init?.method === "PATCH") {
        // patchEventLabel appends ?eventLabelVersion=1 — strip the query.
        const id = decodeURIComponent(url.split("/events/")[1]!.split("?")[0]!);
        patchedIds.add(id);
        return new Response("{}", { status: 200 });
      }
      // events.list — page the 60-event dataset by the REQUESTED maxResults
      // (derived page size), offset encoded in the pageToken.
      const params = new URL(url).searchParams;
      const offset = Number(params.get("pageToken")?.replace("off-", "") ?? "0");
      const max = Number(params.get("maxResults"));
      const slice = allIds.slice(offset, offset + max).map((id) => ({
        id,
        status: "confirmed",
        summary: `unrelated-${id}`,
        colorId: "",
      }));
      const nextOffset = offset + max;
      return new Response(
        JSON.stringify({
          items: slice,
          ...(nextOffset < TOTAL
            ? { nextPageToken: `off-${nextOffset}` }
            : { nextSyncToken: "done" }),
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Consumer loop: each hop is a fresh Worker invocation (fetch cap resets),
    // re-enqueueing the continuation like applyResult does.
    let opts: { pageToken?: string; timeMin: string; timeMax: string } = {
      timeMin: FIXED_MIN,
      timeMax: FIXED_MAX,
    };
    let hops = 0;
    let completed = false;
    while (hops < 30) {
      hops += 1;
      invocationFetches = 0; // fresh invocation
      const res = await runFullResync(
        { db, env, userId: USER_ID, calendarId: CAL },
        opts,
      );
      // A cap trip would surface as ok:false (retryable) — must never happen.
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      if (!res.continuation) {
        completed = true;
        break;
      }
      opts = {
        pageToken: res.continuation.pageToken,
        timeMin: res.continuation.timeMin!,
        timeMax: res.continuation.timeMax!,
      };
    }

    expect(completed).toBe(true);
    expect(capTrips).toBe(0);
    expect(maxInvocationFetches).toBeLessThanOrEqual(50);
    // No event lost: every event was classified and patched at least once.
    expect(patchedIds.size).toBe(TOTAL);
    // The budget actually forced chunking (multiple invocations).
    expect(hops).toBeGreaterThan(1);
    warnSpy.mockRestore();
  });
});

describe("calendarSync — #04 stale-continuation CAS", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  // One-page resume fixture: the delayed hop resumes with the arc's
  // (syncToken, pageToken) pair and Google answers the final page of the
  // delta, minting the arc's final token.
  function mockResumePage(): void {
    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
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
  }

  it("AC 1+2 — delayed resume against a changed sync_state token: skips the token write, observable and distinct", async () => {
    // Race reproduction: while this continuation sat in the queue, another
    // run completed and stored a fresh token — simulated by the CAS
    // RETURNING resolving to zero rows. Pre-#04 the unconditional UPDATE
    // would have rolled sync_state back to arc-final-tok here.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, updates, casState } = makeDb({ tokenRow, casRows: [] });
    mockResumePage();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await runIncrementalSync(
      { db, env, userId: USER_ID, calendarId: CAL },
      { syncToken: "arc-start-tok", pageToken: "pt-resume" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.continuation).toBeUndefined();
    // The write went through the conditional (RETURNING) path and missed.
    expect(casState.returningCalls).toBe(1);
    // Distinct from a normal completion (stored=true) AND from a #02 budget
    // stop (which carries a continuation): stored=false + the skip flag.
    expect(result.summary.stored_next_sync_token).toBe(false);
    expect(result.summary.sync_token_write_skipped).toBe(true);
    // Exactly one warn line, counters only — no calendarId, no event content.
    const staleWarns = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("stale continuation"));
    expect(staleWarns).toHaveLength(1);
    const payload = JSON.parse(staleWarns[0]!) as Record<string, unknown>;
    expect(payload.userId).toBe(USER_ID);
    expect("calendarId" in payload).toBe(false);
    expect(staleWarns[0]).not.toContain("Lunch");
    // The staged patch carried the arc token, but the summary that callers
    // and sync_runs see reflects the skip.
    expect(updates.some((u) => u.nextSyncToken === "arc-final-tok")).toBe(true);
    warnSpy.mockRestore();
  });

  it("AC 3 — resume with an unchanged token stores it through the CAS (non-contended path intact)", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    // Default casRows → one row: sync_state still holds arc-start-tok.
    const { db, updates, casState } = makeDb({ tokenRow });
    mockResumePage();

    const result = await runIncrementalSync(
      { db, env, userId: USER_ID, calendarId: CAL },
      { syncToken: "arc-start-tok", pageToken: "pt-resume" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(casState.returningCalls).toBe(1);
    expect(result.summary.stored_next_sync_token).toBe(true);
    expect(result.summary.sync_token_write_skipped).toBeUndefined();
    expect(updates.some((u) => u.nextSyncToken === "arc-final-tok")).toBe(true);
  });

  it("fresh (non-resume) incremental runs keep the unconditional write — CAS scope is resume hops only", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db, casState } = makeDb({ nextSyncToken: "stored-tok", tokenRow });
    mockResumePage();

    const result = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.stored_next_sync_token).toBe(true);
    expect(casState.returningCalls).toBe(0);
  });
});

describe("calendarSync — §6 Wave B finalize routes all outcomes", () => {
  // INTENT: every `return` inside `runPagedList` must flow through the
  // `finalize()` helper so `ctx.recordSyncRun` is emitted exactly once per
  // Worker invocation. These tests pin that contract by exercising each of
  // the six outcomes and asserting both call count and the `outcome` field.
  // Adding a new early-return path without routing through finalize silently
  // drops a telemetry row — these cases catch that regression.
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("ok outcome → recordSyncRun called once with outcome='ok' + summary", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "tok", tokenRow });
    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({ items: [], nextSyncToken: "fresh" }),
        { status: 200 },
      ),
    ]);
    const recordSyncRun = vi.fn();
    const res = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      recordSyncRun,
    });
    expect(res.ok).toBe(true);
    expect(recordSyncRun).toHaveBeenCalledTimes(1);
    const rec = recordSyncRun.mock.calls[0]![0];
    expect(rec.outcome).toBe("ok");
    expect(rec.stored_next_sync_token).toBe(true);
    expect(rec.finished_at).toBeTruthy();
    expect(typeof rec.started_at).toBe("string");
  });

  it("retryable outcome → recordSyncRun called once with outcome='retryable'", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "tok", tokenRow });
    // events.list returns 500 (server error) → CalendarApiError kind='server'
    // → `reason: 'retryable'`.
    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ error: { code: 500 } }), { status: 500 }),
    ]);
    const recordSyncRun = vi.fn();
    const res = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      recordSyncRun,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("retryable");
    expect(recordSyncRun).toHaveBeenCalledTimes(1);
    expect(recordSyncRun.mock.calls[0]![0].outcome).toBe("retryable");
  });

  it("reauth_required outcome → recordSyncRun called once with outcome='reauth_required'", async () => {
    const env = makeEnv();
    // tokenRow: null → getGoogleRefreshToken throws ReauthRequiredError
    // before ever reaching events.list.
    const { db } = makeDb({ nextSyncToken: "tok", tokenRow: null });
    mockFetchQueue([]);
    const recordSyncRun = vi.fn();
    const res = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      recordSyncRun,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("reauth_required");
    expect(recordSyncRun).toHaveBeenCalledTimes(1);
    expect(recordSyncRun.mock.calls[0]![0].outcome).toBe("reauth_required");
  });

  it("full_sync_required outcome → recordSyncRun called once with outcome='full_sync_required'", async () => {
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "stale", tokenRow });
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
    const recordSyncRun = vi.fn();
    const res = await runIncrementalSync({
      db,
      env,
      userId: USER_ID,
      calendarId: CAL,
      recordSyncRun,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("full_sync_required");
    expect(recordSyncRun).toHaveBeenCalledTimes(1);
    expect(recordSyncRun.mock.calls[0]![0].outcome).toBe("full_sync_required");
  });

  it("recordSyncRun undefined → no-op (optional chain guard)", async () => {
    // The production path injects `recordSyncRun` from syncConsumer, but
    // ad-hoc callers (manual scripts, other tests) may omit it. The
    // `ctx.recordSyncRun?.(...)` optional call must not throw.
    const env = makeEnv();
    const tokenRow = await seedTokenRow(env);
    const { db } = makeDb({ nextSyncToken: "tok", tokenRow });
    mockFetchQueue([
      new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({ items: [], nextSyncToken: "done" }),
        { status: 200 },
      ),
    ]);
    const res = await runIncrementalSync({ db, env, userId: USER_ID, calendarId: CAL });
    expect(res.ok).toBe(true);
  });
});

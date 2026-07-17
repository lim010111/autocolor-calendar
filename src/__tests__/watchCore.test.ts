import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as TokenRefreshModule from "../services/tokenRefresh";

// reRegisterWatch owns the shared (re)registration core: WEBHOOK_BASE_URL
// guard → getValidAccessToken (+ ReauthRequiredError mapping) → stop → register
// → classify. registerWatchChannel / stopWatchChannel are module-private to
// watch/core.ts; this suite exercises them only through reRegisterWatch's
// public result union, plus globalThis.fetch (the Google API seam).

const getTokenMock = vi.fn();
vi.mock("../services/tokenRefresh", async () => {
  const actual =
    await vi.importActual<typeof TokenRefreshModule>("../services/tokenRefresh");
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getTokenMock(...args),
  };
});

import { ReauthRequiredError } from "../services/tokenRefresh";
import { reRegisterWatch } from "../services/watch/core";

const UID = "11111111-1111-1111-1111-111111111111";
const CAL = "primary";

type DbShape = {
  calls: Array<{ op: string; args: unknown }>;
  row: {
    userId: string;
    calendarId: string;
    channelId: string | null;
    resourceId: string | null;
    storedToken: string | null;
    active: boolean;
  } | null;
};

// Same minimal chainable stub the watchChannel suite used — records writes and
// injects fake SELECT results for the stop-channel lookup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDb(state: DbShape): any {
  return {
    update() {
      return {
        set(args: unknown) {
          return {
            where() {
              state.calls.push({ op: "update", args });
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  state.calls.push({ op: "select", args: null });
                  return Promise.resolve(state.row ? [state.row] : []);
                },
              };
            },
          };
        },
      };
    },
  };
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(typeof input === "string" ? input : input.toString(), init),
  ) as typeof fetch;
}

const BASE_ENV = {
  ENV: "dev",
  GOOGLE_OAUTH_REDIRECT_URI: "x",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
  GAS_REDIRECT_URL: "x",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
} as const;

const ENV_WITH_WEBHOOK = {
  ...BASE_ENV,
  WEBHOOK_BASE_URL: "https://example.test",
} as const;

// A sync_state row that already holds a live channel, so the stop leg actually
// fires a channels.stop fetch (lets us assert stop→register ordering).
function rowWithChannel(): DbShape["row"] {
  return {
    userId: UID,
    calendarId: CAL,
    channelId: "c-old",
    resourceId: "r-old",
    storedToken: "tok-old",
    active: true,
  };
}

describe("reRegisterWatch", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    getTokenMock.mockReset();
    getTokenMock.mockResolvedValue({ accessToken: "at-x", expiresAt: 0 });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("stops the old channel then registers a fresh one, returning ok + expiration", async () => {
    const expirationMs = Date.now() + 7 * 86400 * 1000;
    const fetched: Array<{ url: string; body: string }> = [];
    mockFetch(async (url, init) => {
      fetched.push({ url, body: String(init?.body ?? "{}") });
      if (url.includes("/channels/stop")) {
        return new Response("{}", { status: 200 });
      }
      // /events/watch
      return new Response(
        JSON.stringify({
          id: JSON.parse(String(init?.body ?? "{}")).id,
          resourceId: "res-new",
          expiration: String(expirationMs),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL);

    expect(result).toEqual({ ok: true, expiration: new Date(expirationMs) });
    // Ordering: channels.stop fires before events/watch.
    expect(fetched[0]!.url).toContain("/channels/stop");
    expect(fetched[1]!.url).toContain("/calendars/primary/events/watch");
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    // The watch.create POST body shape — web_hook type, HTTPS address on the
    // configured base, and freshly minted UUID id + token.
    const body = JSON.parse(fetched[1]!.body) as Record<string, unknown>;
    expect(body.type).toBe("web_hook");
    expect(body.address).toBe("https://example.test/webhooks/calendar");
    expect(String(body.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(body.token)).toMatch(/^[0-9a-f-]{36}$/);
    // DB write persists the channel metadata.
    expect(state.calls.some((c) => c.op === "update")).toBe(true);
  });

  it("trims a trailing slash from the webhook base URL", async () => {
    let watchBody = "{}";
    mockFetch(async (url, init) => {
      if (url.includes("/events/watch")) watchBody = String(init?.body ?? "{}");
      return new Response(JSON.stringify({ id: "c1", resourceId: "r1" }), {
        status: 200,
      });
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    await reRegisterWatch(
      fakeDb(state),
      { ...BASE_ENV, WEBHOOK_BASE_URL: "https://example.test/" },
      UID,
      CAL,
    );

    const body = JSON.parse(watchBody) as { address: string };
    expect(body.address).toBe("https://example.test/webhooks/calendar");
  });

  it("returns skipped without touching the token or Google when WEBHOOK_BASE_URL is unset", async () => {
    let fetchCalls = 0;
    mockFetch(async () => {
      fetchCalls++;
      return new Response("{}", { status: 200 });
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), BASE_ENV, UID, CAL);

    expect(result).toEqual({ skipped: "webhook_unconfigured" });
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(fetchCalls).toBe(0);
  });

  it("maps a ReauthRequiredError from the token fetch to failed: reauth_required", async () => {
    let fetchCalls = 0;
    mockFetch(async () => {
      fetchCalls++;
      return new Response("{}", { status: 200 });
    });
    getTokenMock.mockRejectedValue(new ReauthRequiredError("invalid_grant"));

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL);

    expect(result).toEqual({ failed: "reauth_required" });
    // Token was known-bad — never reached Google.
    expect(fetchCalls).toBe(0);
  });

  it("classifies a CalendarApiError from the register leg into failed: api_error + kind", async () => {
    mockFetch(async (url) => {
      if (url.includes("/channels/stop")) return new Response("{}", { status: 200 });
      // /events/watch — Google backend error.
      return new Response(
        JSON.stringify({ error: { code: 500, errors: [{ reason: "backendError" }] } }),
        { status: 500 },
      );
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL);

    expect(result).toEqual({ failed: "api_error", kind: "server" });
  });

  it("classifies a 401 from the register leg as api_error + kind: auth", async () => {
    mockFetch(async (url) => {
      if (url.includes("/channels/stop")) return new Response("{}", { status: 200 });
      return new Response(
        JSON.stringify({ error: { code: 401, message: "unauthenticated" } }),
        { status: 401 },
      );
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL);

    expect(result).toEqual({ failed: "api_error", kind: "auth" });
  });

  it("classifies a 410 from the register leg as full_sync_required (#07 shared factory)", async () => {
    // Deliberate delta pinned by architecture-deepening #07: before the
    // shared throwCalendarApiError factory, watch's local classify lacked
    // the 410 branch and mapped this to `unknown`. Both kinds land on the
    // same 502 arm in routes/sync.ts, and renewal/selfHeal/bootstrap use
    // the kind as a warn-log code only — so unification is log-string-only
    // on a branch Google effectively never takes for channel ops.
    mockFetch(async (url) => {
      if (url.includes("/channels/stop")) return new Response("{}", { status: 200 });
      return new Response(
        JSON.stringify({ error: { code: 410, errors: [{ reason: "fullSyncRequired" }] } }),
        { status: 410 },
      );
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL);

    expect(result).toEqual({ failed: "api_error", kind: "full_sync_required" });
  });

  it("never surfaces Google error body text through the result (no PII/token leak)", async () => {
    mockFetch(async (url) => {
      if (url.includes("/channels/stop")) return new Response("{}", { status: 200 });
      return new Response(
        JSON.stringify({
          error: {
            code: 500,
            message: "Secret leaked field: sensitive-token-abc",
            errors: [{ reason: "backendError" }],
          },
        }),
        { status: 500 },
      );
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL);

    expect(result).toEqual({ failed: "api_error", kind: "server" });
    // The Google error body must not propagate anywhere in the result.
    expect(JSON.stringify(result)).not.toContain("Secret leaked");
    expect(JSON.stringify(result)).not.toContain("sensitive-token");
  });

  it("classifies a CalendarApiError from the stop leg, never reaching register", async () => {
    const fetched: string[] = [];
    mockFetch(async (url) => {
      fetched.push(url);
      if (url.includes("/channels/stop")) {
        return new Response(
          JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } }),
          { status: 403 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const state: DbShape = { calls: [], row: rowWithChannel() };
    const result = await reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL);

    expect(result).toEqual({ failed: "api_error", kind: "rate_limited" });
    expect(fetched.some((u) => u.includes("/events/watch"))).toBe(false);
  });

  it("rethrows an unexpected (non-reauth, non-CalendarApiError) failure", async () => {
    getTokenMock.mockRejectedValue(new Error("hyperdrive socket reset"));
    const state: DbShape = { calls: [], row: rowWithChannel() };

    await expect(
      reRegisterWatch(fakeDb(state), ENV_WITH_WEBHOOK, UID, CAL),
    ).rejects.toThrow("hyperdrive socket reset");
  });
});

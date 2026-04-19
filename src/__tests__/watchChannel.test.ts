import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CalendarApiError,
  registerWatchChannel,
  stopWatchChannel,
  verifyChannelToken,
  lookupChannelOwner,
} from "../services/watchChannel";

const UID = "11111111-1111-1111-1111-111111111111";
const CAL = "primary";
const AT = "at-xyz";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(typeof input === "string" ? input : input.toString(), init),
  ) as typeof fetch;
}

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

// Minimal stub that records calls and lets tests inject fake SELECT results.
// Signature loose on purpose — we only need the chainable shape tests use.
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

describe("watchChannel.verifyChannelToken", () => {
  it("returns true on equal tokens", () => {
    expect(verifyChannelToken("abc-123", "abc-123")).toBe(true);
  });
  it("returns false when lengths differ", () => {
    expect(verifyChannelToken("abc", "abcd")).toBe(false);
  });
  it("returns false when bytes differ at any position", () => {
    expect(verifyChannelToken("abc-123", "abc-124")).toBe(false);
  });
  it("returns false when either side is null/empty", () => {
    expect(verifyChannelToken(null, "abc")).toBe(false);
    expect(verifyChannelToken("abc", null)).toBe(false);
    expect(verifyChannelToken("", "")).toBe(false);
  });
});

describe("watchChannel.registerWatchChannel", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("POSTs to /events/watch with generated id + token + HTTPS address", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    mockFetch(async (url, init) => {
      seen.push({ url, body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          id: JSON.parse(String(init?.body ?? "{}")).id,
          resourceId: "res-abc",
          expiration: String(Date.now() + 7 * 86400 * 1000),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const state: DbShape = { calls: [], row: null };
    const out = await registerWatchChannel(
      fakeDb(state),
      AT,
      UID,
      CAL,
      "https://example.test",
    );
    expect(seen[0]!.url).toContain("/calendars/primary/events/watch");
    const body = JSON.parse(seen[0]!.body) as Record<string, unknown>;
    expect(body.type).toBe("web_hook");
    expect(body.address).toBe("https://example.test/webhooks/calendar");
    expect(typeof body.id).toBe("string");
    expect(typeof body.token).toBe("string");
    // UUID v4 shape sanity — mostly guards against accidental static values.
    expect(String(body.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(body.token)).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.channelId).toBe(body.id);
    expect(out.resourceId).toBe("res-abc");
    expect(out.token).toBe(body.token);
    // DB write persists the channel metadata.
    expect(state.calls.some((c) => c.op === "update")).toBe(true);
  });

  it("trims trailing slash from webhook base URL", async () => {
    const seen: string[] = [];
    mockFetch(async (_url, init) => {
      seen.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ id: "c1", resourceId: "r1" }),
        { status: 200 },
      );
    });
    await registerWatchChannel(
      fakeDb({ calls: [], row: null }),
      AT,
      UID,
      CAL,
      "https://example.test/",
    );
    const body = JSON.parse(seen[0]!) as { address: string };
    expect(body.address).toBe("https://example.test/webhooks/calendar");
  });

  it("classifies 401 as CalendarApiError(auth)", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ error: { code: 401, message: "unauthenticated" } }),
        { status: 401 },
      ),
    );
    await expect(
      registerWatchChannel(
        fakeDb({ calls: [], row: null }),
        AT,
        UID,
        CAL,
        "https://example.test",
      ),
    ).rejects.toMatchObject({
      name: "CalendarApiError",
      kind: "auth",
      status: 401,
    });
  });

  it("classifies 429 as rate_limited", async () => {
    mockFetch(async () => new Response("{}", { status: 429 }));
    await expect(
      registerWatchChannel(
        fakeDb({ calls: [], row: null }),
        AT,
        UID,
        CAL,
        "https://example.test",
      ),
    ).rejects.toSatisfy((err) => err instanceof CalendarApiError && err.kind === "rate_limited");
  });

  it("never includes Google error body text in the thrown message", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 500,
            message: "Secret leaked field: sensitive-token-abc",
            errors: [{ reason: "backendError" }],
          },
        }),
        { status: 500 },
      ),
    );
    try {
      await registerWatchChannel(
        fakeDb({ calls: [], row: null }),
        AT,
        UID,
        CAL,
        "https://example.test",
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CalendarApiError);
      expect(String((err as Error).message)).not.toContain("Secret leaked");
      expect(String((err as Error).message)).not.toContain("sensitive-token");
    }
  });
});

describe("watchChannel.stopWatchChannel", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("no-ops when no channel is registered", async () => {
    const state: DbShape = { calls: [], row: null };
    let fetchCalls = 0;
    mockFetch(async () => {
      fetchCalls++;
      return new Response("{}", { status: 200 });
    });
    await stopWatchChannel(fakeDb(state), AT, UID, CAL);
    expect(fetchCalls).toBe(0);
  });

  it("treats 404 from Google as success and clears the columns", async () => {
    const state: DbShape = {
      calls: [],
      row: {
        userId: UID,
        calendarId: CAL,
        channelId: "c-1",
        resourceId: "r-1",
        storedToken: "tok",
        active: true,
      },
    };
    mockFetch(async () => new Response("{}", { status: 404 }));
    await stopWatchChannel(fakeDb(state), AT, UID, CAL);
    // The update after the 404 clears the local columns.
    expect(state.calls.some((c) => c.op === "update")).toBe(true);
  });

  it("propagates non-404 errors as CalendarApiError", async () => {
    const state: DbShape = {
      calls: [],
      row: {
        userId: UID,
        calendarId: CAL,
        channelId: "c-1",
        resourceId: "r-1",
        storedToken: "tok",
        active: true,
      },
    };
    mockFetch(async () => new Response("{}", { status: 500 }));
    await expect(stopWatchChannel(fakeDb(state), AT, UID, CAL)).rejects.toBeInstanceOf(
      CalendarApiError,
    );
  });
});

describe("watchChannel.lookupChannelOwner", () => {
  it("returns null when no row matches", async () => {
    const state: DbShape = { calls: [], row: null };
    const out = await lookupChannelOwner(fakeDb(state), "c-missing", "r-missing");
    expect(out).toBeNull();
  });

  it("returns null when row has no stored token (channel stopped mid-flight)", async () => {
    const state: DbShape = {
      calls: [],
      row: {
        userId: UID,
        calendarId: CAL,
        channelId: "c-1",
        resourceId: "r-1",
        storedToken: null,
        active: true,
      },
    };
    const out = await lookupChannelOwner(fakeDb(state), "c-1", "r-1");
    expect(out).toBeNull();
  });

  it("returns owner on match", async () => {
    const state: DbShape = {
      calls: [],
      row: {
        userId: UID,
        calendarId: CAL,
        channelId: "c-1",
        resourceId: "r-1",
        storedToken: "tok-abc",
        active: true,
      },
    };
    const out = await lookupChannelOwner(fakeDb(state), "c-1", "r-1");
    expect(out).toEqual({
      userId: UID,
      calendarId: CAL,
      storedToken: "tok-abc",
      active: true,
    });
  });
});

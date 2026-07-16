import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HonoEnv } from "../env";
import type * as TokenRefreshModule from "../services/tokenRefresh";

// Pattern mirrors syncRoute.test.ts: mock auth + getDb + global fetch so the
// route exercises in isolation without Postgres / Google Calendar I/O.

vi.mock("../middleware/auth", () => ({
  authMiddleware: async (
    c: {
      req: { header: (k: string) => string | undefined };
      set: (key: string, value: unknown) => void;
      json: (body: unknown, status: number) => unknown;
    },
    next: () => Promise<void>,
  ) => {
    if (!c.req.header("authorization")) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("userId", "u-test");
    c.set("email", "test@example.com");
    await next();
  },
}));

const selectBatches: unknown[][] = [];

function resetDbMocks(): void {
  selectBatches.length = 0;
}

vi.mock("../db", () => ({
  getDb: () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectBatches.shift() ?? []),
          }),
        }),
      }),
    },
    close: async () => undefined,
  }),
}));

const getValidAccessTokenMock = vi.fn();
vi.mock("../services/tokenRefresh", async () => {
  const actual = await vi.importActual<typeof TokenRefreshModule>(
    "../services/tokenRefresh",
  );
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getValidAccessTokenMock(...args),
  };
});

import { eventsRoutes } from "../routes/events";
import { CalendarApiError } from "../services/googleCalendar";
import { ReauthRequiredError } from "../services/tokenRefresh";

const app = new Hono<HonoEnv>();
app.route("/api/events", eventsRoutes);

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

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

const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(typeof input === "string" ? input : input.toString(), init),
  ) as typeof fetch;
}

async function postColor(
  body: unknown,
  options: {
    headers?: Record<string, string>;
    cid?: string;
    eid?: string;
    env?: Record<string, unknown>;
  } = {},
): Promise<Response> {
  const headers = options.headers ?? { authorization: "Bearer x" };
  const cid = options.cid ?? "primary";
  const eid = options.eid ?? "evt-1";
  const path = `/api/events/${encodeURIComponent(cid)}/${encodeURIComponent(eid)}/color`;
  return app.fetch(
    new Request(`https://worker.test${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    (options.env ?? BASE_ENV) as never,
    ctx,
  );
}

describe("POST /api/events/:cid/:eid/color — auth gate", () => {
  beforeEach(() => {
    resetDbMocks();
    getValidAccessTokenMock.mockReset();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 401 when bearer is missing", async () => {
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" }, { headers: {} });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/events/:cid/:eid/color — input validation", () => {
  beforeEach(() => {
    resetDbMocks();
    getValidAccessTokenMock.mockReset();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(["5", "not-a-uuid", "", "11111111-2222-3333-4444"])(
    "rejects invalid labelId %p with 400",
    async (labelId) => {
      const res = await postColor({ labelId });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("invalid_request");
    },
  );

  it("rejects missing labelId with 400", async () => {
    const res = await postColor({});
    expect(res.status).toBe(400);
  });

  it("rejects legacy colorId payloads with 400 (label world — ADR-0006)", async () => {
    const res = await postColor({ colorId: "5" });
    expect(res.status).toBe(400);
  });

  it("accepts a uuid labelId", async () => {
    selectBatches.push([{ needsReauth: false }]);
    getValidAccessTokenMock.mockResolvedValueOnce({
      accessToken: "at-x",
      expiresAt: Date.now() + 60_000,
    });
    mockFetch(async () => new Response("{}", { status: 200 }));
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/:cid/:eid/color — reauth gate", () => {
  beforeEach(() => {
    resetDbMocks();
    getValidAccessTokenMock.mockReset();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 503 reauth_required when oauth_tokens row missing", async () => {
    selectBatches.push([]); // no row
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("reauth_required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 reauth_required when needsReauth=true", async () => {
    selectBatches.push([{ needsReauth: true }]);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("reauth_required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 reauth_required when getValidAccessToken throws ReauthRequiredError", async () => {
    selectBatches.push([{ needsReauth: false }]);
    getValidAccessTokenMock.mockRejectedValueOnce(
      new ReauthRequiredError("invalid_grant"),
    );
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("reauth_required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/:cid/:eid/color — Calendar API", () => {
  beforeEach(() => {
    resetDbMocks();
    getValidAccessTokenMock.mockReset();
    getValidAccessTokenMock.mockResolvedValue({
      accessToken: "at-x",
      expiresAt: Date.now() + 60_000,
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("PATCH body clears all four §5.4 marker keys (manual override invariant)", async () => {
    selectBatches.push([{ needsReauth: false }]);
    const seen: { url: string; method: string | undefined; body: string }[] = [];
    mockFetch(async (url, init) => {
      seen.push({
        url,
        method: init?.method,
        body: init?.body ? String(init.body) : "",
      });
      return new Response("{}", { status: 200 });
    });
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("PATCH");
    expect(seen[0]!.url).toContain("/calendars/primary/events/evt-1");
    expect(seen[0]!.url).toContain("eventLabelVersion=1");
    const parsed = JSON.parse(seen[0]!.body);
    expect(parsed).toEqual({
      eventLabelId: "11111111-2222-3333-4444-555555555555",
      extendedProperties: {
        private: {
          autocolor_v: null,
          autocolor_color: null,
          autocolor_label: null,
          autocolor_category: null,
        },
      },
    });
  });

  it("returns 200 {ok:true, labelId} on success", async () => {
    selectBatches.push([{ needsReauth: false }]);
    mockFetch(async () => new Response("{}", { status: 200 }));
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, labelId: "11111111-2222-3333-4444-555555555555" });
  });

  it("encodes calendarId / eventId path params (special chars)", async () => {
    selectBatches.push([{ needsReauth: false }]);
    let seenUrl = "";
    mockFetch(async (url) => {
      seenUrl = url;
      return new Response("{}", { status: 200 });
    });
    const res = await postColor(
      { labelId: "11111111-2222-3333-4444-555555555555" },
      { cid: "alice@example.com", eid: "abc_def123" },
    );
    expect(res.status).toBe(200);
    expect(seenUrl).toContain("/calendars/alice%40example.com/events/abc_def123");
  });

  it("idempotent — two consecutive successes both 200, both clear markers", async () => {
    selectBatches.push([{ needsReauth: false }]);
    selectBatches.push([{ needsReauth: false }]);
    const seen: string[] = [];
    mockFetch(async (_url, init) => {
      seen.push(init?.body ? String(init.body) : "");
      return new Response("{}", { status: 200 });
    });
    const r1 = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    const r2 = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(seen).toHaveLength(2);
    for (const body of seen) {
      const parsed = JSON.parse(body);
      expect(parsed.extendedProperties.private).toEqual({
        autocolor_v: null,
        autocolor_color: null,
        autocolor_label: null,
        autocolor_category: null,
      });
    }
  });

  it("maps Calendar 401 (auth) to 503 reauth_required", async () => {
    selectBatches.push([{ needsReauth: false }]);
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 }),
    );
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("reauth_required");
  });

  it("maps Calendar 404 (not_found) to 404 event_not_found", async () => {
    selectBatches.push([{ needsReauth: false }]);
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 }),
    );
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("event_not_found");
  });

  it("maps Calendar 410 (full_sync_required) to 404 event_not_found", async () => {
    selectBatches.push([{ needsReauth: false }]);
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: { code: 410, errors: [{ reason: "fullSyncRequired" }] },
        }),
        { status: 410 },
      ),
    );
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("event_not_found");
  });

  it("maps Calendar 403 insufficientPermissions to 403 forbidden", async () => {
    selectBatches.push([{ needsReauth: false }]);
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: { code: 403, errors: [{ reason: "insufficientPermissions" }] },
        }),
        { status: 403 },
      ),
    );
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("forbidden");
  });

  it("maps Calendar 429 to 429 rate_limited + Retry-After header", async () => {
    selectBatches.push([{ needsReauth: false }]);
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 429 } }), {
        status: 429,
        headers: { "retry-after": "12" },
      }),
    );
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    const body = (await res.json()) as { error?: string; retry_after_sec?: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retry_after_sec).toBe(12);
  });

  it("maps Calendar 5xx (server) to 502 upstream_unavailable", async () => {
    selectBatches.push([{ needsReauth: false }]);
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }),
    );
    const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("upstream_unavailable");
  });

  it("CalendarApiError class is the expected one (sanity)", () => {
    expect(CalendarApiError).toBeTruthy();
  });

  it("does not log Calendar event payloads (log redaction contract)", async () => {
    // The route is body-blind by construction (it never reads the event
    // body — only writes eventLabelId + null markers). Pin the contract by
    // spying on console.* and asserting nothing event-shaped lands there
    // even when the upstream returns a payload-rich error body.
    selectBatches.push([{ needsReauth: false }]);
    const calendarErrorBody = {
      error: {
        code: 500,
        message: "Internal",
        errors: [{ reason: "backendError" }],
      },
      // Even if Google included event-shaped fields here, the route never
      // logs them — but include them anyway as a worst-case probe.
      summary: "회사 비밀 회의",
      description: "topsecret@example.com",
      attendees: [{ email: "user@example.com" }],
    };
    mockFetch(async () =>
      new Response(JSON.stringify(calendarErrorBody), { status: 500 }),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await postColor({ labelId: "11111111-2222-3333-4444-555555555555" });
      expect(res.status).toBe(502);
      for (const spy of [logSpy, warnSpy, errorSpy]) {
        for (const call of spy.mock.calls) {
          const joined = call.map((v) => String(v)).join(" ");
          expect(joined).not.toContain("회사 비밀 회의");
          expect(joined).not.toContain("topsecret@example.com");
          expect(joined).not.toContain("user@example.com");
        }
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

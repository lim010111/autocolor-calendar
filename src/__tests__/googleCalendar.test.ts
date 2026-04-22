import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTOCOLOR_KEYS,
  AUTOCOLOR_MARKER_VERSION,
  CalendarApiError,
  clearEventColor,
  listEvents,
  patchEventColor,
} from "../services/googleCalendar";

const AT = "access-token-abc";
const CAL = "primary";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(typeof input === "string" ? input : input.toString(), init),
  ) as typeof fetch;
}

describe("googleCalendar.listEvents", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("returns parsed EventsListResponse on 200", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          items: [{ id: "e1", status: "confirmed" }],
          nextSyncToken: "tok-next",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const out = await listEvents(AT, CAL, { syncToken: "tok" });
    expect(out.items).toHaveLength(1);
    expect(out.nextSyncToken).toBe("tok-next");
  });

  it("builds querystring with singleEvents/showDeleted and optional syncToken", async () => {
    const seen: string[] = [];
    mockFetch(async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    await listEvents(AT, CAL, { syncToken: "tok-x" });
    expect(seen[0]).toContain("singleEvents=true");
    expect(seen[0]).toContain("showDeleted=true");
    expect(seen[0]).toContain("syncToken=tok-x");
    expect(seen[0]).toContain("maxResults=2500");
  });

  it("maps 401 to kind=auth", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 }),
    );
    await expect(listEvents(AT, CAL, {})).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(CalendarApiError);
      expect((err as CalendarApiError).kind).toBe("auth");
      return true;
    });
  });

  it("maps 410 to kind=full_sync_required", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: { code: 410, errors: [{ reason: "fullSyncRequired" }] },
        }),
        { status: 410 },
      ),
    );
    await expect(listEvents(AT, CAL, { syncToken: "stale" })).rejects.toSatisfy(
      (err) => {
        expect((err as CalendarApiError).kind).toBe("full_sync_required");
        return true;
      },
    );
  });

  it("maps 429 to kind=rate_limited and propagates Retry-After", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 429 } }), {
        status: 429,
        headers: { "retry-after": "42" },
      }),
    );
    try {
      await listEvents(AT, CAL, {});
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CalendarApiError);
      expect((err as CalendarApiError).kind).toBe("rate_limited");
      expect((err as CalendarApiError).retryAfterSec).toBe(42);
    }
  });

  it("maps 403 rateLimitExceeded to kind=rate_limited (not forbidden)", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] },
        }),
        { status: 403 },
      ),
    );
    await expect(listEvents(AT, CAL, {})).rejects.toSatisfy((err) => {
      expect((err as CalendarApiError).kind).toBe("rate_limited");
      return true;
    });
  });

  it("maps 403 insufficientPermissions to kind=forbidden", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: { code: 403, errors: [{ reason: "insufficientPermissions" }] },
        }),
        { status: 403 },
      ),
    );
    await expect(listEvents(AT, CAL, {})).rejects.toSatisfy((err) => {
      expect((err as CalendarApiError).kind).toBe("forbidden");
      return true;
    });
  });

  it("maps 5xx to kind=server", async () => {
    mockFetch(async () => new Response("oops", { status: 502 }));
    await expect(listEvents(AT, CAL, {})).rejects.toSatisfy((err) => {
      expect((err as CalendarApiError).kind).toBe("server");
      return true;
    });
  });

  it("error message does not include response body", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 500, message: "secret PII here" } }), {
        status: 500,
      }),
    );
    try {
      await listEvents(AT, CAL, {});
    } catch (err) {
      expect((err as Error).message).not.toContain("secret PII here");
    }
  });
});

describe("googleCalendar.patchEventColor", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("PATCHes with colorId body and returns void on 200", async () => {
    const seen: { url: string; body: string | null; method: string | undefined }[] = [];
    mockFetch(async (url, init) => {
      seen.push({
        url,
        method: init?.method,
        body: init?.body ? String(init.body) : null,
      });
      return new Response("{}", { status: 200 });
    });
    await patchEventColor(AT, CAL, "evt-1", "5");
    expect(seen[0]!.method).toBe("PATCH");
    expect(seen[0]!.body).toBe(JSON.stringify({ colorId: "5" }));
    expect(seen[0]!.url).toContain("/events/evt-1");
  });

  it("omits extendedProperties when 5th arg not passed", async () => {
    const seen: string[] = [];
    mockFetch(async (_url, init) => {
      seen.push(String(init?.body));
      return new Response("{}", { status: 200 });
    });
    await patchEventColor(AT, CAL, "evt-1", "5");
    const parsed = JSON.parse(seen[0]!);
    expect(parsed).toEqual({ colorId: "5" });
    expect("extendedProperties" in parsed).toBe(false);
  });

  it("includes extendedProperties.private when marker passed", async () => {
    const seen: string[] = [];
    mockFetch(async (_url, init) => {
      seen.push(String(init?.body));
      return new Response("{}", { status: 200 });
    });
    await patchEventColor(AT, CAL, "evt-1", "5", {
      [AUTOCOLOR_KEYS.version]: AUTOCOLOR_MARKER_VERSION,
      [AUTOCOLOR_KEYS.color]: "5",
      [AUTOCOLOR_KEYS.category]: "cat-abc",
    });
    expect(JSON.parse(seen[0]!)).toEqual({
      colorId: "5",
      extendedProperties: {
        private: {
          [AUTOCOLOR_KEYS.version]: "1",
          [AUTOCOLOR_KEYS.color]: "5",
          [AUTOCOLOR_KEYS.category]: "cat-abc",
        },
      },
    });
  });

  it("maps 404 to kind=not_found", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 }),
    );
    await expect(patchEventColor(AT, CAL, "missing", "1")).rejects.toSatisfy(
      (err) => {
        expect((err as CalendarApiError).kind).toBe("not_found");
        return true;
      },
    );
  });
});

describe("googleCalendar — listEvents privateExtendedProperty", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("appends a single privateExtendedProperty filter verbatim", async () => {
    const seen: string[] = [];
    mockFetch(async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    await listEvents(AT, CAL, {
      timeMin: "2026-01-01T00:00:00Z",
      privateExtendedProperty: "autocolor_category=cat-abc",
    });
    expect(seen[0]).toContain(
      "privateExtendedProperty=autocolor_category%3Dcat-abc",
    );
  });

  it("appends multiple privateExtendedProperty filters when given an array", async () => {
    const seen: string[] = [];
    mockFetch(async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    await listEvents(AT, CAL, {
      timeMin: "2026-01-01T00:00:00Z",
      privateExtendedProperty: ["autocolor_v=1", "autocolor_category=cat-abc"],
    });
    // URLSearchParams.append with repeated keys produces two parameter
    // occurrences, which is the spec Google requires for AND semantics.
    const url = seen[0]!;
    const matches = url.match(/privateExtendedProperty=/g) ?? [];
    expect(matches.length).toBe(2);
    expect(url).toContain("privateExtendedProperty=autocolor_v%3D1");
    expect(url).toContain(
      "privateExtendedProperty=autocolor_category%3Dcat-abc",
    );
  });
});

describe("googleCalendar.clearEventColor", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("PATCHes colorId:null + three null markers under extendedProperties.private", async () => {
    const seen: { method: string | undefined; body: string | null; url: string }[] = [];
    mockFetch(async (url, init) => {
      seen.push({
        url,
        method: init?.method,
        body: init?.body ? String(init.body) : null,
      });
      return new Response("{}", { status: 200 });
    });
    await clearEventColor(AT, CAL, "evt-99");
    expect(seen[0]!.method).toBe("PATCH");
    expect(seen[0]!.url).toContain("/events/evt-99");
    expect(JSON.parse(seen[0]!.body!)).toEqual({
      colorId: null,
      extendedProperties: {
        private: {
          [AUTOCOLOR_KEYS.version]: null,
          [AUTOCOLOR_KEYS.color]: null,
          [AUTOCOLOR_KEYS.category]: null,
        },
      },
    });
    // Sanity — marker version constant still exports as "1" (guards against
    // accidental schema-version bumps that would desync with the reader).
    expect(AUTOCOLOR_MARKER_VERSION).toBe("1");
  });

  it("maps 410 to kind=full_sync_required", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: { code: 410, errors: [{ reason: "fullSyncRequired" }] },
        }),
        { status: 410 },
      ),
    );
    await expect(clearEventColor(AT, CAL, "stale-evt")).rejects.toSatisfy(
      (err) => {
        expect((err as CalendarApiError).kind).toBe("full_sync_required");
        return true;
      },
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks must be declared before the tested module is imported.
// - `getDb` is replaced so the route + authMiddleware never hit real Postgres.
// - `verifySession` returns a canned session keyed by bearer token so tests
//   can simulate "user A" vs "user B" without exercising the real HMAC path.
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../services/sessionService", () => ({
  verifySession: vi.fn(),
}));
vi.mock("../queues/syncProducer", () => ({
  enqueueSync: vi.fn(async () => undefined),
  SyncQueueUnavailableError: class extends Error {},
}));

import { app } from "../index";
import { getDb } from "../db";
import { enqueueSync } from "../queues/syncProducer";
import { verifySession } from "../services/sessionService";

import {
  type FakeDbHandle,
  type Row,
  makeFakeDb,
} from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const CAT_A_ID = "11111111-1111-1111-1111-11111111111a";
const CAT_B_ID = "22222222-2222-2222-2222-22222222222b";

function row(overrides: Partial<Row>): Row {
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000001",
    userId: overrides.userId ?? USER_A,
    name: overrides.name ?? "주간회의",
    colorId: overrides.colorId ?? "9",
    keywords: overrides.keywords ?? ["주간회의"],
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? new Date("2026-04-19T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-04-19T00:00:00Z"),
  };
}

const baseEnv = {
  ENV: "dev" as const,
  HYPERDRIVE: { connectionString: "postgres://fake" } as unknown as Hyperdrive,
  GOOGLE_OAUTH_REDIRECT_URI: "https://worker.test/oauth/google/callback",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "cs",
  GAS_REDIRECT_URL: "https://script.google.com/test/exec",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
};

const ctx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function invoke(
  path: string,
  init?: RequestInit & { userToken?: string },
): Promise<Response> {
  const headers: Record<string, string> = {};
  const incoming = init?.headers as Record<string, string> | undefined;
  if (incoming) Object.assign(headers, incoming);
  if (init?.userToken) headers["authorization"] = `Bearer ${init.userToken}`;
  return app.fetch(
    new Request(`https://worker.test${path}`, { ...init, headers }),
    baseEnv as unknown as Record<string, unknown>,
    ctx,
  );
}

let currentDb: FakeDbHandle;

beforeEach(() => {
  currentDb = makeFakeDb();
  vi.mocked(getDb).mockImplementation(
    () => currentDb as unknown as ReturnType<typeof getDb>,
  );
  vi.mocked(verifySession).mockImplementation(async (_db, _pep, token) => {
    if (token === "token-a") return { userId: USER_A, email: "a@test" };
    if (token === "token-b") return { userId: USER_B, email: "b@test" };
    return null;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/api/categories — auth gate", () => {
  it("GET without bearer returns 401", async () => {
    const res = await invoke("/api/categories");
    expect(res.status).toBe(401);
  });

  it("POST without bearer returns 401", async () => {
    const res = await invoke("/api/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("PATCH without bearer returns 401", async () => {
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("DELETE without bearer returns 401", async () => {
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("invalid bearer returns 401", async () => {
    const res = await invoke("/api/categories", { userToken: "token-bad" });
    expect(res.status).toBe(401);
  });
});

describe("/api/categories — list (GET)", () => {
  it("returns only rows owned by the requesting user, ordered by priority then createdAt", async () => {
    currentDb.state.categories.push(
      row({
        id: CAT_A_ID,
        userId: USER_A,
        name: "회의",
        priority: 50,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      }),
      row({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02",
        userId: USER_A,
        name: "점심",
        priority: 50,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      row({ id: CAT_B_ID, userId: USER_B, name: "B's rule" }),
    );

    const res = await invoke("/api/categories", { userToken: "token-a" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { categories: Array<{ id: string; name: string }> };
    expect(body.categories.map((c) => c.id)).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02", // earlier createdAt wins tie
      CAT_A_ID,
    ]);
    expect(body.categories.some((c) => c.id === CAT_B_ID)).toBe(false);
  });
});

describe("/api/categories — create (POST)", () => {
  function post(body: unknown, token = "token-a") {
    return invoke("/api/categories", {
      method: "POST",
      userToken: token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("201 on valid body", async () => {
    const res = await post({
      name: "주간회의",
      colorId: "9",
      keywords: ["주간회의"],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { category: { name: string; userId?: string } };
    expect(body.category.name).toBe("주간회의");
    // stored row is scoped to user A
    expect(currentDb.state.categories).toHaveLength(1);
    expect(currentDb.state.categories[0]?.userId).toBe(USER_A);
  });

  it("400 when colorId is outside 1..11", async () => {
    const res = await post({ name: "x", colorId: "12", keywords: ["x"] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("400 when keywords is empty", async () => {
    const res = await post({ name: "x", colorId: "1", keywords: [] });
    expect(res.status).toBe(400);
  });

  it("400 when name is missing", async () => {
    const res = await post({ colorId: "1", keywords: ["x"] });
    expect(res.status).toBe(400);
  });

  it("400 when body is not JSON", async () => {
    const res = await invoke("/api/categories", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("409 duplicate_name when same-user row with the same name exists", async () => {
    currentDb.state.categories.push(
      row({ id: CAT_A_ID, userId: USER_A, name: "주간회의" }),
    );
    const res = await post({
      name: "주간회의",
      colorId: "3",
      keywords: ["새 키워드"],
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("duplicate_name");
  });

  it("allows a different user to reuse the same name (unique is per-user)", async () => {
    currentDb.state.categories.push(
      row({ id: CAT_B_ID, userId: USER_B, name: "주간회의" }),
    );
    const res = await post({
      name: "주간회의",
      colorId: "9",
      keywords: ["주간회의"],
    });
    expect(res.status).toBe(201);
  });

  it("enqueues one full_resync job per calendar in sync_state", async () => {
    // Webhook-driven incremental sync only sees changed events. Without this
    // fan-out, a freshly added rule never reaches existing un-mutated events
    // until something else perturbs them.
    currentDb.state.syncStates.push(
      { userId: USER_A, calendarId: "primary" },
      { userId: USER_A, calendarId: "secondary@group.calendar.google.com" },
      { userId: USER_B, calendarId: "other-user-cal" },
    );
    const res = await post({
      name: "주간회의",
      colorId: "9",
      keywords: ["주간회의"],
    });
    expect(res.status).toBe(201);
    const calls = vi.mocked(enqueueSync).mock.calls;
    // Exactly two — user A's two calendars only. User B's row must not leak.
    expect(calls).toHaveLength(2);
    const jobs = calls.map((c) => c[1]);
    expect(jobs.every((j) => j.type === "full_resync")).toBe(true);
    expect(
      jobs
        .map((j) => (j as { calendarId: string }).calendarId)
        .sort(),
    ).toEqual(["primary", "secondary@group.calendar.google.com"]);
    expect(
      jobs.every(
        (j) => (j as { reason: string }).reason === "manual",
      ),
    ).toBe(true);
  });

  it("enqueues nothing when user has no sync_state rows", async () => {
    const res = await post({
      name: "주간회의",
      colorId: "9",
      keywords: ["주간회의"],
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when create fails (409 duplicate_name)", async () => {
    currentDb.state.categories.push(
      row({ id: CAT_A_ID, userId: USER_A, name: "주간회의" }),
    );
    currentDb.state.syncStates.push({
      userId: USER_A,
      calendarId: "primary",
    });
    const res = await post({
      name: "주간회의",
      colorId: "3",
      keywords: ["x"],
    });
    expect(res.status).toBe(409);
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });
});

describe("/api/categories — patch (PATCH)", () => {
  it("200 when row is owned by the requesting user", async () => {
    currentDb.state.categories.push(
      row({ id: CAT_A_ID, userId: USER_A, name: "주간회의", colorId: "9" }),
    );
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colorId: "3" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { category: { colorId: string } };
    expect(body.category.colorId).toBe("3");
    expect(currentDb.state.categories[0]?.colorId).toBe("3");
  });

  it("404 when the id belongs to another user (tenant isolation)", async () => {
    currentDb.state.categories.push(
      row({ id: CAT_B_ID, userId: USER_B, name: "B's rule" }),
    );
    const res = await invoke(`/api/categories/${CAT_B_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colorId: "3" }),
    });
    expect(res.status).toBe(404);
    // user B's row must be untouched
    expect(currentDb.state.categories[0]?.colorId).toBe("9");
  });

  it("400 on an invalid uuid path parameter", async () => {
    const res = await invoke(`/api/categories/not-a-uuid`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colorId: "3" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 on an empty patch", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("409 when the new name collides with another row owned by the same user", async () => {
    currentDb.state.categories.push(
      row({ id: CAT_A_ID, userId: USER_A, name: "주간회의" }),
      row({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02",
        userId: USER_A,
        name: "점심 약속",
      }),
    );
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "점심 약속" }),
    });
    expect(res.status).toBe(409);
  });

  it("enqueues full_resync per calendar when colorId changes", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    currentDb.state.syncStates.push(
      { userId: USER_A, calendarId: "primary" },
      { userId: USER_A, calendarId: "work@group.calendar.google.com" },
    );
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colorId: "3" }),
    });
    expect(res.status).toBe(200);
    const jobs = vi.mocked(enqueueSync).mock.calls.map((c) => c[1]);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.type === "full_resync")).toBe(true);
  });

  it("enqueues full_resync when keywords change", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    currentDb.state.syncStates.push({
      userId: USER_A,
      calendarId: "primary",
    });
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["새키워드"] }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(enqueueSync)).toHaveBeenCalledTimes(1);
  });

  it("enqueues full_resync when priority changes (tiebreaker reordering)", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    currentDb.state.syncStates.push({
      userId: USER_A,
      calendarId: "primary",
    });
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: 50 }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(enqueueSync)).toHaveBeenCalledTimes(1);
  });

  it("does NOT enqueue when only name changes (metadata, no classification impact)", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    currentDb.state.syncStates.push({
      userId: USER_A,
      calendarId: "primary",
    });
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "rename only" }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when PATCH fails (404 not found)", async () => {
    currentDb.state.syncStates.push({
      userId: USER_A,
      calendarId: "primary",
    });
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colorId: "3" }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });
});

describe("/api/categories — delete (DELETE)", () => {
  it("204 on success and removes the row", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(204);
    expect(currentDb.state.categories).toHaveLength(0);
  });

  it("enqueues one color_rollback job per calendar in sync_state", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    currentDb.state.syncStates.push(
      { userId: USER_A, calendarId: "primary" },
      { userId: USER_A, calendarId: "secondary@group.calendar.google.com" },
      { userId: USER_B, calendarId: "other-user-cal" },
    );
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(204);
    const calls = vi.mocked(enqueueSync).mock.calls;
    // Exactly two jobs — user A's two calendars. User B's row must not leak.
    expect(calls).toHaveLength(2);
    const jobs = calls.map((c) => c[1]);
    expect(jobs.every((j) => j.type === "color_rollback")).toBe(true);
    expect(jobs.map((j) => (j as { calendarId: string }).calendarId).sort()).toEqual([
      "primary",
      "secondary@group.calendar.google.com",
    ]);
    expect(
      jobs.every((j) => (j as { categoryId: string }).categoryId === CAT_A_ID),
    ).toBe(true);
  });

  it("enqueues nothing when user has no sync_state rows", async () => {
    currentDb.state.categories.push(row({ id: CAT_A_ID, userId: USER_A }));
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(204);
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when DELETE target row is missing (404 short-circuit)", async () => {
    // No row exists for this id + user — the DELETE returns 404 and the
    // enqueue fan-out must not run (otherwise we'd spam rollback jobs for
    // categories that were already cleaned up).
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(enqueueSync)).not.toHaveBeenCalled();
  });

  it("404 when id belongs to another user (tenant isolation)", async () => {
    currentDb.state.categories.push(row({ id: CAT_B_ID, userId: USER_B }));
    const res = await invoke(`/api/categories/${CAT_B_ID}`, {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(404);
    expect(currentDb.state.categories).toHaveLength(1);
  });

  it("400 on invalid uuid", async () => {
    const res = await invoke(`/api/categories/not-a-uuid`, {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(400);
  });
});

describe("/api/categories — round-trip", () => {
  it("create → list → patch → list → delete → list", async () => {
    // create
    const created = await invoke("/api/categories", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "주간회의", colorId: "9", keywords: ["주간회의"] }),
    });
    expect(created.status).toBe(201);
    const { category } = (await created.json()) as {
      category: { id: string; colorId: string };
    };
    const id = category.id;

    // list
    const list1 = await invoke("/api/categories", { userToken: "token-a" });
    const body1 = (await list1.json()) as {
      categories: Array<{ id: string; colorId: string }>;
    };
    expect(body1.categories).toHaveLength(1);
    expect(body1.categories[0]?.id).toBe(id);

    // patch colorId
    const patched = await invoke(`/api/categories/${id}`, {
      method: "PATCH",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colorId: "1" }),
    });
    expect(patched.status).toBe(200);

    // list again
    const list2 = await invoke("/api/categories", { userToken: "token-a" });
    const body2 = (await list2.json()) as {
      categories: Array<{ id: string; colorId: string }>;
    };
    expect(body2.categories[0]?.colorId).toBe("1");

    // delete
    const deleted = await invoke(`/api/categories/${id}`, {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(deleted.status).toBe(204);

    // list empty
    const list3 = await invoke("/api/categories", { userToken: "token-a" });
    const body3 = (await list3.json()) as { categories: unknown[] };
    expect(body3.categories).toHaveLength(0);
  });
});

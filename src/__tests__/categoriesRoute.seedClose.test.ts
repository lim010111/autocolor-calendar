import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Oracle for the merge-gate finding (ADR-0027 handle-merge-findings, PR #124):
// categories.ts fired `waitUntil(sideEffects)` and `waitUntil(close())` as two
// SEPARATE, unchained tasks. `close()` = postgres-js `client.end()`, and the
// name-seed write inside `sideEffects` (`writeNameSeed`) `await`s an embedding
// network call BEFORE its `db.insert(rule_seeds)`. So `close()` — invoked
// synchronously in the route's `finally` — ends the pool while the embed is
// still in flight; when the embed resolves the seed insert hits a closed pool,
// throws, and `writeNameSeed`'s warn-only catch swallows it → the Stage-1 seed
// is silently never written. Pre-#02 this was safe because the only sideEffect
// (`fanOutFullResync`) touches the Queue, not the db.
//
// This test models that faithfully: each getDb() call is its OWN connection
// (like the real handle — the auth middleware acquires + closes a SEPARATE one),
// `close()` marks that pool ended, and a `rule_seeds` upsert issued after its
// own pool closed throws (mirroring CONNECTION_ENDED). It asserts the seed IS
// persisted. RED on the unchained HEAD; GREEN once `close()` is chained after
// `sideEffects` (`sideEffects.finally(() => close())`, the index.ts pattern).
//
// DO NOT weaken this oracle to make it pass — the fix belongs in the source.

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../services/sessionService", () => ({ verifySession: vi.fn() }));
vi.mock("../queues/syncProducer", () => ({
  enqueueSync: vi.fn(async () => undefined),
  SyncQueueUnavailableError: class extends Error {},
}));

import { app } from "../index";
import { getDb } from "../db";
import { ruleSeeds } from "../db/schema";
import { verifySession } from "../services/sessionService";

import { type Row, makeFakeDb } from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const CAT_A_ID = "11111111-1111-1111-1111-11111111111a";

function row(overrides: Partial<Row>): Row {
  return {
    id: overrides.id ?? CAT_A_ID,
    userId: overrides.userId ?? USER_A,
    name: overrides.name ?? "주간회의",
    colorId: overrides.colorId ?? "9",
    keywords: overrides.keywords ?? ["주간회의"],
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? new Date("2026-04-19T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-04-19T00:00:00Z"),
  };
}

type RaceHandle = {
  db: unknown;
  close: () => Promise<void>;
  state: { ruleSeeds: Record<string, unknown>[] };
};

// A fake db whose pool teardown is observable and LOCAL to this handle: its
// own `close()` flips its own `closed`, and a `rule_seeds` upsert issued after
// THIS handle closed throws — exactly what postgres-js does when a query races
// this client's own already-resolved `client.end()`. Because each getDb() is a
// fresh handle, the auth middleware closing its separate connection cannot
// poison the route's connection (matches production).
function makeRaceDb(seed?: Partial<Row>): RaceHandle {
  const base = makeFakeDb(seed ? { categories: [row(seed)] } : {});
  let closed = false;
  const realInsert = (base.db as { insert: (t: unknown) => unknown }).insert;
  const db = {
    ...(base.db as object),
    insert(table: unknown) {
      if (table === ruleSeeds) {
        return {
          values(v: Record<string, unknown> | Record<string, unknown>[]) {
            // #03 keyword adds arrive as `.values(array)` awaited directly;
            // race-aware like the name upsert so a keyword seed written after
            // this handle's close() throws just as the name seed would.
            if (Array.isArray(v)) {
              return Promise.resolve().then(() => {
                if (closed) {
                  throw new Error("write CONNECTION_ENDED (pool closed)");
                }
                for (const rowv of v) base.state.ruleSeeds.push(rowv);
              });
            }
            return {
              onConflictDoUpdate: async (_cfg?: unknown) => {
                if (closed) {
                  throw new Error("write CONNECTION_ENDED (pool closed)");
                }
                base.state.ruleSeeds.push(v);
                return undefined;
              },
            };
          },
        };
      }
      return realInsert(table);
    },
  };
  return {
    db,
    close: async () => {
      closed = true;
    },
    state: base.state,
  };
}

// Embedder deferred to a macrotask so the synchronous route path — including
// the `finally` that fires `close()` on HEAD — is guaranteed to run before the
// seed insert. Makes the race deterministic instead of timing-dependent.
const deferredAi = {
  run: (_model: string, { text }: { text: string[] }) =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ data: text.map(() => [0.11, 0.22, 0.33]) }), 0),
    ),
};

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
  AI: deferredAi as unknown as Ai,
};

// Every getDb() call gets its own handle; only the route inserts rule_seeds, so
// the aggregate across handles is exactly the route's seed writes.
let handles: RaceHandle[];
let seedForHandles: Partial<Row> | undefined;
let tasks: Promise<unknown>[];

function allSeeds(): Record<string, unknown>[] {
  return handles.flatMap((h) => h.state.ruleSeeds);
}

const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    tasks.push(Promise.resolve(p));
  },
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function invoke(
  path: string,
  init: RequestInit & { userToken?: string },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.userToken) headers["authorization"] = `Bearer ${init.userToken}`;
  const res = await app.fetch(
    new Request(`https://worker.test${path}`, { ...init, headers }),
    baseEnv as unknown as Record<string, unknown>,
    ctx,
  );
  // Drain every waitUntil task — the runtime keeps the isolate alive for these,
  // so the seed write (and close) must be settled before we assert.
  await Promise.allSettled(tasks);
  return res;
}

beforeEach(() => {
  handles = [];
  tasks = [];
  seedForHandles = undefined;
  vi.mocked(getDb).mockImplementation(() => {
    const h = makeRaceDb(seedForHandles);
    handles.push(h);
    return h as unknown as ReturnType<typeof getDb>;
  });
  vi.mocked(verifySession).mockImplementation(async (_db, _pep, token) =>
    token === "token-a" ? { userId: USER_A, email: "a@test" } : null,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("categories mutation — name seed survives pool teardown", () => {
  it("POST create persists the name seed even though close() is scheduled", async () => {
    const res = await invoke("/api/categories", {
      method: "POST",
      userToken: "token-a",
      body: JSON.stringify({ name: "주간회의", colorId: "9", keywords: ["주간회의"] }),
    });
    expect(res.status).toBe(201);
    // The whole point of #02/#03: the Stage-1 seeds must be written. If close()
    // races the embed, the insert throws into the write path's warn-only catch
    // and these stay empty. Create writes a name seed (#02) AND a keyword seed
    // (#03, keywords: ["주간회의"]) — both must survive the pool teardown.
    const seeds = allSeeds();
    expect(seeds).toHaveLength(2);
    expect(seeds).toContainEqual(
      expect.objectContaining({
        userId: USER_A,
        seedType: "name",
        seedText: "주간회의",
      }),
    );
    expect(seeds).toContainEqual(
      expect.objectContaining({
        userId: USER_A,
        seedType: "keyword",
        seedText: "주간회의",
      }),
    );
  });

  it("PATCH rename re-embeds and persists the name seed despite close()", async () => {
    seedForHandles = { id: CAT_A_ID, userId: USER_A, name: "old name" };
    const res = await invoke(`/api/categories/${CAT_A_ID}`, {
      method: "PATCH",
      userToken: "token-a",
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(200);
    expect(allSeeds()).toHaveLength(1);
    expect(allSeeds()[0]).toMatchObject({
      seedType: "name",
      seedText: "renamed",
    });
  });
});

// §3 후속 — `scheduled()` cron dispatch tests. The handler now branches on
// `event.cron` (renewal vs rotation), so 6 cases pin the routing.
//
// Mocks: `getDb` returns a fake handle so we don't hit Hyperdrive;
// `renewExpiringWatches` and `rotateBatch` are vi.fn so we can assert the
// dispatcher routes each schedule to the right service. `ctx.waitUntil`
// captures the promise the dispatcher hands off so the test can await it
// and pin that `close()` runs after every branch settles.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";

const closeSpy = vi.fn(async () => undefined);
const renewMock = vi.fn(async (..._args: unknown[]) => undefined);
const rotateMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("../db", () => ({
  getDb: () => ({
    db: {} as never,
    close: closeSpy,
  }),
}));

vi.mock("../services/watchRenewal", () => ({
  renewExpiringWatches: (...args: unknown[]) => renewMock(...args),
}));

vi.mock("../services/tokenRotation", () => ({
  rotateBatch: (...args: unknown[]) => rotateMock(...args),
}));

import worker from "../index";

const BASE_ENV: Bindings = {
  ENV: "dev",
  GOOGLE_OAUTH_REDIRECT_URI: "x",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
  GAS_REDIRECT_URL: "x",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
};

function makeCtx(): {
  ctx: ExecutionContext;
  awaitAll: () => Promise<void>;
} {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      promises.push(p);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return {
    ctx,
    awaitAll: async () => {
      await Promise.all(promises);
    },
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  closeSpy.mockClear();
  renewMock.mockClear();
  rotateMock.mockClear();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("scheduled() — cron dispatch (§3 후속)", () => {
  it("renewal cron + WEBHOOK_BASE_URL set → renewal called once, rotation not called", async () => {
    const env = { ...BASE_ENV, WEBHOOK_BASE_URL: "https://webhook.test" };
    const { ctx, awaitAll } = makeCtx();

    await worker.scheduled?.(
      { cron: "0 */6 * * *", scheduledTime: Date.now(), type: "scheduled" } as ScheduledEvent,
      env,
      ctx,
    );
    await awaitAll();

    expect(renewMock).toHaveBeenCalledTimes(1);
    expect(rotateMock).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("rotation cron → rotation called once, renewal not called", async () => {
    const env = { ...BASE_ENV, WEBHOOK_BASE_URL: "https://webhook.test" };
    const { ctx, awaitAll } = makeCtx();

    await worker.scheduled?.(
      { cron: "0 3 * * *", scheduledTime: Date.now(), type: "scheduled" } as ScheduledEvent,
      env,
      ctx,
    );
    await awaitAll();

    expect(rotateMock).toHaveBeenCalledTimes(1);
    expect(renewMock).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("renewal cron + WEBHOOK_BASE_URL unset → skip-info logged, getDb NOT opened (no Hyperdrive handshake)", async () => {
    const env = { ...BASE_ENV };
    const { ctx, awaitAll } = makeCtx();

    await worker.scheduled?.(
      { cron: "0 */6 * * *", scheduledTime: Date.now(), type: "scheduled" } as ScheduledEvent,
      env,
      ctx,
    );
    await awaitAll();

    expect(renewMock).not.toHaveBeenCalled();
    expect(rotateMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("watch renewal skipped — WEBHOOK_BASE_URL not configured");
    // Skip path returns BEFORE getDb — no socket cost on dev shells. This
    // pins the §3 후속 dispatch refactor: pre-refactor `getDb` always
    // opened, paying a Hyperdrive handshake every 6h on workers.dev.
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("rotation cron + WEBHOOK_BASE_URL unset → rotation STILL runs (independent of webhook config)", async () => {
    const env = { ...BASE_ENV };
    const { ctx, awaitAll } = makeCtx();

    await worker.scheduled?.(
      { cron: "0 3 * * *", scheduledTime: Date.now(), type: "scheduled" } as ScheduledEvent,
      env,
      ctx,
    );
    await awaitAll();

    expect(rotateMock).toHaveBeenCalledTimes(1);
    expect(renewMock).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("unknown cron → warn line, neither service called, getDb NOT opened (no throw)", async () => {
    const env = { ...BASE_ENV, WEBHOOK_BASE_URL: "https://webhook.test" };
    const { ctx, awaitAll } = makeCtx();

    await worker.scheduled?.(
      { cron: "1 2 3 4 5", scheduledTime: Date.now(), type: "scheduled" } as ScheduledEvent,
      env,
      ctx,
    );
    await awaitAll();

    expect(renewMock).not.toHaveBeenCalled();
    expect(rotateMock).not.toHaveBeenCalled();
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("scheduled() received unknown cron");
    expect(warned).toContain("1 2 3 4 5");
    // Unknown-cron warn doesn't need a DB; skipping getDb keeps drift
    // logs cheap.
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("rotation cron + rotateBatch throws → top-level warn, close() still runs (no unhandled rejection)", async () => {
    const env = { ...BASE_ENV };
    rotateMock.mockRejectedValueOnce(new Error("simulated rotation failure"));
    const { ctx, awaitAll } = makeCtx();

    await worker.scheduled?.(
      { cron: "0 3 * * *", scheduledTime: Date.now(), type: "scheduled" } as ScheduledEvent,
      env,
      ctx,
    );
    await awaitAll();

    expect(rotateMock).toHaveBeenCalledTimes(1);
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("token rotation failed at top level");
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

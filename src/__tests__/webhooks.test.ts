import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We stub ../services/watchChannel and ../queues/syncProducer so the route
// logic can be exercised without a DB or Queue binding. The route imports
// these modules eagerly, so the mocks must be registered before the import
// tree of ../routes/webhooks resolves.

const lookupMock = vi.fn();
const verifyMock = vi.fn();
const enqueueMock = vi.fn();

vi.mock("../db", () => ({
  getDb: () => ({
    db: {} as unknown,
    close: async () => undefined,
  }),
}));

vi.mock("../services/watchChannel", () => ({
  lookupChannelOwner: (...args: unknown[]) => lookupMock(...args),
  verifyChannelToken: (...args: unknown[]) => verifyMock(...args),
}));

vi.mock("../queues/syncProducer", () => ({
  enqueueSync: (...args: unknown[]) => enqueueMock(...args),
  SyncQueueUnavailableError: class SyncQueueUnavailableError extends Error {},
}));

import { webhookRoutes } from "../routes/webhooks";

const app = new Hono();
app.route("/webhooks", webhookRoutes);

const ENV = {
  ENV: "dev",
  GOOGLE_OAUTH_REDIRECT_URI: "x",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
  GAS_REDIRECT_URL: "x",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
} as unknown as Record<string, unknown>;

// Hono's routes call `c.executionCtx.waitUntil(close())`, which requires an
// executionCtx to be threaded through `app.fetch` rather than `app.request`.
const waitUntilSpy = vi.fn();
const ctx = {
  waitUntil: waitUntilSpy,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function call(headers: Record<string, string>): Promise<Response> {
  return app.fetch(
    new Request("https://worker.test/webhooks/calendar", {
      method: "POST",
      headers,
    }),
    ENV as never,
    ctx,
  );
}

describe("POST /webhooks/calendar", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    verifyMock.mockReset();
    enqueueMock.mockReset();
    waitUntilSpy.mockReset();
    enqueueMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when required headers are missing", async () => {
    const res = await call({});
    expect(res.status).toBe(401);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("returns 401 when channel is unknown (no matching row)", async () => {
    lookupMock.mockResolvedValue(null);
    const res = await call({
      "x-goog-channel-id": "c-1",
      "x-goog-resource-id": "r-1",
      "x-goog-resource-state": "exists",
      "x-goog-channel-token": "tok-received",
    });
    expect(res.status).toBe(401);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("returns 401 on token mismatch (no enumeration oracle)", async () => {
    lookupMock.mockResolvedValue({
      userId: "u1",
      calendarId: "primary",
      storedToken: "expected-token",
      active: true,
    });
    verifyMock.mockReturnValue(false);
    const res = await call({
      "x-goog-channel-id": "c-1",
      "x-goog-resource-id": "r-1",
      "x-goog-resource-state": "exists",
      "x-goog-channel-token": "wrong-token",
    });
    expect(res.status).toBe(401);
    expect(verifyMock).toHaveBeenCalledWith("expected-token", "wrong-token");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("acks the sync handshake without enqueueing", async () => {
    lookupMock.mockResolvedValue({
      userId: "u1",
      calendarId: "primary",
      storedToken: "tok",
      active: true,
    });
    verifyMock.mockReturnValue(true);
    const res = await call({
      "x-goog-channel-id": "c-1",
      "x-goog-resource-id": "r-1",
      "x-goog-resource-state": "sync",
      "x-goog-channel-token": "tok",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handshake?: boolean };
    expect(body.handshake).toBe(true);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("enqueues incremental sync for exists state", async () => {
    lookupMock.mockResolvedValue({
      userId: "u1",
      calendarId: "primary",
      storedToken: "tok",
      active: true,
    });
    verifyMock.mockReturnValue(true);
    const res = await call({
      "x-goog-channel-id": "c-1",
      "x-goog-resource-id": "r-1",
      "x-goog-resource-state": "exists",
      "x-goog-channel-token": "tok",
    });
    expect(res.status).toBe(202);
    // waitUntil-wrapped promise should have fired by the time we await the
    // response (Hono resolves waitUntil synchronously in tests).
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [, job] = enqueueMock.mock.calls[0]!;
    expect(job).toMatchObject({
      type: "incremental",
      userId: "u1",
      calendarId: "primary",
      reason: "webhook",
    });
  });

  it("skips enqueue for inactive calendar but still 2xx", async () => {
    lookupMock.mockResolvedValue({
      userId: "u1",
      calendarId: "primary",
      storedToken: "tok",
      active: false,
    });
    verifyMock.mockReturnValue(true);
    const res = await call({
      "x-goog-channel-id": "c-1",
      "x-goog-resource-id": "r-1",
      "x-goog-resource-state": "exists",
      "x-goog-channel-token": "tok",
    });
    expect(res.status).toBe(200);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

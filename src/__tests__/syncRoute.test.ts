import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../index";

// These tests only verify the route layer surface (auth gate, coalesce, queue
// availability). Full consumer behavior is covered in calendarSync.test.ts.

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function invoke(
  path: string,
  init?: RequestInit,
  env?: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(
    new Request(`https://worker.test${path}`, init),
    (env ?? {}) as never,
    ctx,
  );
}

describe("sync routes — auth gate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POST /sync/run without bearer returns 401", async () => {
    const res = await invoke("/sync/run", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /sync/bootstrap without bearer returns 401", async () => {
    const res = await invoke("/sync/bootstrap", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

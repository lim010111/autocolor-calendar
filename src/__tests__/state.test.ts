import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OAUTH_STATE_TTL_MS } from "../config/constants";
import { signState, verifyState } from "../lib/state";

function b64key(): string {
  return randomBytes(32).toString("base64");
}

describe("OAuth state HMAC", () => {
  it("verifies a freshly signed state", async () => {
    const key = b64key();
    const state = await signState(key);
    expect(await verifyState(key, state)).toBe(true);
  });

  it("fails when signature is tampered", async () => {
    const key = b64key();
    const state = await signState(key);
    const [body, sig] = state.split(".") as [string, string];
    const tampered = `${body}.${sig.slice(0, -2)}AA`;
    expect(await verifyState(key, tampered)).toBe(false);
  });

  it("fails when signed with a different key", async () => {
    const state = await signState(b64key());
    expect(await verifyState(b64key(), state)).toBe(false);
  });

  it("fails when state is malformed", async () => {
    const key = b64key();
    expect(await verifyState(key, "not-a-state")).toBe(false);
  });

  it("fails once TTL has expired", async () => {
    const key = b64key();
    const state = await signState(key);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + OAUTH_STATE_TTL_MS + 1000);
      expect(await verifyState(key, state)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

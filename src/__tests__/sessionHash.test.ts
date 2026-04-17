import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hmacSha256, textEncoder } from "../lib/crypto";

function b64key(): string {
  return randomBytes(32).toString("base64");
}

describe("session hash HMAC-SHA256", () => {
  it("produces the same digest for the same pepper + token", async () => {
    const pepper = b64key();
    const token = "opaque-session-token-xyz";
    const a = await hmacSha256(pepper, textEncoder.encode(token));
    const b = await hmacSha256(pepper, textEncoder.encode(token));
    expect(a).toEqual(b);
  });

  it("produces different digests when pepper rotates", async () => {
    const token = "opaque-session-token-xyz";
    const a = await hmacSha256(b64key(), textEncoder.encode(token));
    const b = await hmacSha256(b64key(), textEncoder.encode(token));
    expect(a).not.toEqual(b);
  });

  it("produces different digests for different tokens under same pepper", async () => {
    const pepper = b64key();
    const a = await hmacSha256(pepper, textEncoder.encode("token-a"));
    const b = await hmacSha256(pepper, textEncoder.encode("token-b"));
    expect(a).not.toEqual(b);
  });
});

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  hmacSha256,
  textEncoder,
  timingSafeEqual,
} from "../lib/crypto";

function b64key(): string {
  return randomBytes(32).toString("base64");
}

describe("aesGcm roundtrip", () => {
  it("decrypts ciphertext with matching key + AAD", async () => {
    const key = b64key();
    const aad = textEncoder.encode("user:abc");
    const plaintext = textEncoder.encode("hunter2:refresh-token");

    const { iv, ciphertext } = await aesGcmEncrypt(key, plaintext, aad);
    const decrypted = await aesGcmDecrypt(key, iv, ciphertext, aad);

    expect(new TextDecoder().decode(decrypted)).toBe("hunter2:refresh-token");
  });

  it("fails decryption when AAD differs (row-swap defense)", async () => {
    const key = b64key();
    const { iv, ciphertext } = await aesGcmEncrypt(
      key,
      textEncoder.encode("secret"),
      textEncoder.encode("user:alice"),
    );

    await expect(
      aesGcmDecrypt(key, iv, ciphertext, textEncoder.encode("user:mallory")),
    ).rejects.toThrow();
  });

  it("fails decryption when key differs", async () => {
    const aad = textEncoder.encode("user:abc");
    const { iv, ciphertext } = await aesGcmEncrypt(
      b64key(),
      textEncoder.encode("secret"),
      aad,
    );
    await expect(aesGcmDecrypt(b64key(), iv, ciphertext, aad)).rejects.toThrow();
  });
});

describe("hmacSha256", () => {
  it("is deterministic for same key and input", async () => {
    const key = b64key();
    const data = textEncoder.encode("payload");
    const a = await hmacSha256(key, data);
    const b = await hmacSha256(key, data);
    expect(a).toEqual(b);
  });

  it("differs when key differs", async () => {
    const data = textEncoder.encode("payload");
    const a = await hmacSha256(b64key(), data);
    const b = await hmacSha256(b64key(), data);
    expect(a).not.toEqual(b);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal buffers", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("returns false for length mismatch", () => {
    expect(
      timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
  });

  it("returns false for equal-length differing buffers", () => {
    expect(
      timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
    ).toBe(false);
  });
});

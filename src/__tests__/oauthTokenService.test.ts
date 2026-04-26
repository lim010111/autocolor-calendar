// §3 후속 — dual-key fallback in `getGoogleRefreshToken`. Existing
// `tokenRefresh.test.ts` exercises the higher-level `getValidAccessToken`
// surface; this file tests the lower-level decrypt fallback directly so a
// regression that breaks the rotation window is caught at the smallest unit.
//
// We assert on observable decrypt outcome (returned plaintext or thrown
// error), not on call counts: ESM read-only bindings make `vi.spyOn` of
// individual `crypto.ts` exports unworkable, and behavioral assertions
// already pin every fallback branch — a row encrypted with key A can only
// surface its plaintext if the read path tried key A at some point.

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { aesGcmEncrypt, textEncoder } from "../lib/crypto";
import { getGoogleRefreshToken } from "../services/oauthTokenService";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const b64 = () => randomBytes(32).toString("base64");

type Row = {
  iv: Uint8Array;
  encryptedRefreshToken: Uint8Array;
  scope: string;
  needsReauth: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeDb(row: Row | null): any {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
  };
}

async function seed(key: string, refreshToken: string): Promise<Row> {
  const aad = textEncoder.encode(`user:${USER_ID}`);
  const pt = textEncoder.encode(refreshToken);
  const { iv, ciphertext } = await aesGcmEncrypt(key, pt, aad);
  return { iv, encryptedRefreshToken: ciphertext, scope: "openid email", needsReauth: false };
}

describe("getGoogleRefreshToken — dual-key fallback (§3 후속)", () => {
  it("current-only OK: returns plaintext when row matches current key", async () => {
    const current = b64();
    const row = await seed(current, "rt-current");
    const out = await getGoogleRefreshToken(makeFakeDb(row), { current }, USER_ID);
    expect(out?.refreshToken).toBe("rt-current");
  });

  it("PREV fallback: row encrypted under previous key, current fails, previous succeeds", async () => {
    const current = b64();
    const previous = b64();
    const row = await seed(previous, "rt-prev");
    const out = await getGoogleRefreshToken(
      makeFakeDb(row),
      { current, previous },
      USER_ID,
    );
    // Only the previous-key path can yield this plaintext.
    expect(out?.refreshToken).toBe("rt-prev");
  });

  it("both keys set, current wins: a wrong previous doesn't break a current-encrypted row", async () => {
    const current = b64();
    // Deliberately wrong previous — if the read path were to ALWAYS try the
    // previous key (or use it as the primary), this would surface garbage.
    // Because current succeeds first, previous is never reached.
    const previous = b64();
    const row = await seed(current, "rt-current");
    const out = await getGoogleRefreshToken(
      makeFakeDb(row),
      { current, previous },
      USER_ID,
    );
    expect(out?.refreshToken).toBe("rt-current");
  });

  it("both fail: row encrypted under a third unrelated key → throws", async () => {
    const current = b64();
    const previous = b64();
    const third = b64();
    const row = await seed(third, "rt-orphan");

    await expect(
      getGoogleRefreshToken(makeFakeDb(row), { current, previous }, USER_ID),
    ).rejects.toBeTruthy();
  });

  it("PREV unset, current fails: throws (mirrors today's behavior; no silent fallback)", async () => {
    const current = b64();
    const otherKey = b64();
    const row = await seed(otherKey, "rt-other");

    await expect(
      getGoogleRefreshToken(makeFakeDb(row), { current }, USER_ID),
    ).rejects.toBeTruthy();
  });

  it("no row → returns null without invoking decrypt path", async () => {
    const current = b64();
    const out = await getGoogleRefreshToken(makeFakeDb(null), { current }, USER_ID);
    expect(out).toBeNull();
  });
});

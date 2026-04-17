import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import { aesGcmEncrypt, textEncoder } from "../lib/crypto";
import {
  ReauthRequiredError,
  TokenRefreshError,
  getValidAccessToken,
} from "../services/tokenRefresh";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function makeEnv(): Bindings {
  const b64 = () => randomBytes(32).toString("base64");
  return {
    ENV: "dev",
    GOOGLE_OAUTH_REDIRECT_URI: "https://worker.test/oauth/google/callback",
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GAS_REDIRECT_URL: "https://script.google.com/macros/s/TEST/exec",
    TOKEN_ENCRYPTION_KEY: b64(),
    SESSION_HMAC_KEY: b64(),
    SESSION_PEPPER: b64(),
  };
}

type FakeRow = {
  iv: Uint8Array;
  encryptedRefreshToken: Uint8Array;
  scope: string;
  needsReauth: boolean;
};

function makeFakeDb(row: FakeRow | null) {
  const markReauth = vi.fn();
  // The minimal drizzle-builder surface getGoogleRefreshToken/markReauthRequired use.
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: markReauth }),
    }),
  };
  return { db: db as never, markReauth };
}

async function seedEncrypted(env: Bindings, refreshToken: string): Promise<FakeRow> {
  const aad = textEncoder.encode(`user:${USER_ID}`);
  const pt = textEncoder.encode(refreshToken);
  const { iv, ciphertext } = await aesGcmEncrypt(env.TOKEN_ENCRYPTION_KEY, pt, aad);
  return { iv, encryptedRefreshToken: ciphertext, scope: "openid email", needsReauth: false };
}

describe("getValidAccessToken", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fresh access_token on 200", async () => {
    const env = makeEnv();
    const row = await seedEncrypted(env, "stored-refresh");
    const { db } = makeFakeDb(row);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "at-123",
          expires_in: 3600,
          scope: "openid email",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const before = Date.now();
    const out = await getValidAccessToken(db, env, USER_ID);
    expect(out.accessToken).toBe("at-123");
    expect(out.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("maps invalid_grant to ReauthRequiredError and flags the row", async () => {
    const env = makeEnv();
    const row = await seedEncrypted(env, "stored-refresh");
    const { db, markReauth } = makeFakeDb(row);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    await expect(getValidAccessToken(db, env, USER_ID)).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
    expect(markReauth).toHaveBeenCalledTimes(1);
  });

  it("throws ReauthRequiredError when no token row exists", async () => {
    const env = makeEnv();
    const { db } = makeFakeDb(null);
    await expect(getValidAccessToken(db, env, USER_ID)).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
  });

  it("throws ReauthRequiredError when needs_reauth is already set", async () => {
    const env = makeEnv();
    const row = await seedEncrypted(env, "stored-refresh");
    row.needsReauth = true;
    const { db } = makeFakeDb(row);
    await expect(getValidAccessToken(db, env, USER_ID)).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
  });

  it("non-invalid_grant 5xx maps to retryable TokenRefreshError", async () => {
    const env = makeEnv();
    const row = await seedEncrypted(env, "stored-refresh");
    const { db, markReauth } = makeFakeDb(row);

    globalThis.fetch = vi.fn(async () =>
      new Response("oops", { status: 503 }),
    ) as typeof fetch;

    await expect(getValidAccessToken(db, env, USER_ID)).rejects.toBeInstanceOf(
      TokenRefreshError,
    );
    expect(markReauth).not.toHaveBeenCalled();
  });
});

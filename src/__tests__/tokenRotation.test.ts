// §3 후속 — `rotateBatch` cron job tests. 8 cases pin the operator-visible
// counters AND the warn-line shapes (a botched rotation should be loud, not
// silent). Real AES round-trips drive the success/decrypt-fallback paths;
// mocked DB drives the SELECT/UPDATE outcomes.

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TARGET_TOKEN_VERSION } from "../config/tokenVersion";
import type { Bindings } from "../env";
import { aesGcmEncrypt, textEncoder } from "../lib/crypto";
import { rotateBatch, type RotationSummary } from "../services/tokenRotation";

const b64 = () => randomBytes(32).toString("base64");

type SelectedRow = {
  id: string;
  userId: string;
  iv: Uint8Array;
  encryptedRefreshToken: Uint8Array;
};

async function seed(
  key: string,
  userId: string,
  refreshToken: string,
): Promise<SelectedRow> {
  const aad = textEncoder.encode(`user:${userId}`);
  const pt = textEncoder.encode(refreshToken);
  const { iv, ciphertext } = await aesGcmEncrypt(key, pt, aad);
  return {
    id: `row-${userId}`,
    userId,
    iv,
    encryptedRefreshToken: ciphertext,
  };
}

type UpdateBehavior = "ok" | "throw";

interface FakeDb {
  selectRows: SelectedRow[];
  updateBehavior: UpdateBehavior;
  updatedRows: Array<{ rowId: string; setFields: Record<string, unknown> }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDb(state: FakeDb): any {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.selectRows,
        }),
      }),
    }),
    update: () => ({
      set: (fields: Record<string, unknown>) => ({
        where: async () => {
          // Capture the row id from the second call's WHERE — but for our
          // purposes the rowId in the test corresponds to the call sequence.
          state.updatedRows.push({
            rowId: state.selectRows[state.updatedRows.length]?.id ?? "?",
            setFields: fields,
          });
          if (state.updateBehavior === "throw") {
            throw new Error("simulated update failure");
          }
          return undefined;
        },
      }),
    }),
  };
}

function baseEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ENV: "dev",
    GOOGLE_OAUTH_REDIRECT_URI: "x",
    GOOGLE_CLIENT_ID: "x",
    GOOGLE_CLIENT_SECRET: "x",
    GAS_REDIRECT_URL: "x",
    TOKEN_ENCRYPTION_KEY: b64(),
    SESSION_HMAC_KEY: "x",
    SESSION_PEPPER: "x",
    ...overrides,
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function warnPayload(): string {
  return warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
}
function logPayload(): string {
  return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
}

describe("rotateBatch (§3 후속)", () => {
  it("0 rows: empty SELECT → ok summary, no warn lines, info tick-complete log", async () => {
    const env = baseEnv({ TOKEN_ENCRYPTION_KEY_PREV: b64() });
    const state: FakeDb = { selectRows: [], updateBehavior: "ok", updatedRows: [] };

    const summary = await rotateBatch({ db: fakeDb(state), env });

    expect(summary).toEqual<RotationSummary>({
      scanned: 0,
      ok: 0,
      decrypt_fail_prev: 0,
      encrypt_fail: 0,
      update_fail: 0,
      skipped_no_prev: 0,
    });
    expect(warnPayload()).toBe("");
    expect(logPayload()).toContain("token rotation tick complete");
  });

  it("N rows all OK: every row decrypts under PREV, re-encrypts under CURRENT, version bumps", async () => {
    const previous = b64();
    const env = baseEnv({ TOKEN_ENCRYPTION_KEY_PREV: previous });
    const rows = await Promise.all([
      seed(previous, "u1", "rt-1"),
      seed(previous, "u2", "rt-2"),
      seed(previous, "u3", "rt-3"),
    ]);
    const state: FakeDb = { selectRows: rows, updateBehavior: "ok", updatedRows: [] };

    const summary = await rotateBatch({ db: fakeDb(state), env });

    expect(summary.scanned).toBe(3);
    expect(summary.ok).toBe(3);
    expect(summary.decrypt_fail_prev).toBe(0);
    expect(state.updatedRows.length).toBe(3);
    // Pin: every UPDATE writes the target version + new ciphertext + iv,
    // and does NOT touch needsReauth (D2 — no sentinel column policy).
    for (const upd of state.updatedRows) {
      expect(upd.setFields["tokenVersion"]).toBe(TARGET_TOKEN_VERSION);
      expect(upd.setFields["encryptedRefreshToken"]).toBeInstanceOf(Uint8Array);
      expect(upd.setFields["iv"]).toBeInstanceOf(Uint8Array);
      expect(upd.setFields).not.toHaveProperty("needsReauth");
      expect(upd.setFields).not.toHaveProperty("needsReauthReason");
    }
  });

  it("partial decrypt_fail_prev: rows seeded under unrelated keys are skipped, others rotate", async () => {
    const previous = b64();
    const orphanKey = b64();
    const env = baseEnv({ TOKEN_ENCRYPTION_KEY_PREV: previous });
    const rows = await Promise.all([
      seed(previous, "u1", "rt-1"),
      seed(orphanKey, "u2-bad", "rt-orphan"),
      seed(previous, "u3", "rt-3"),
    ]);
    const state: FakeDb = { selectRows: rows, updateBehavior: "ok", updatedRows: [] };

    const summary = await rotateBatch({ db: fakeDb(state), env });

    expect(summary.scanned).toBe(3);
    expect(summary.ok).toBe(2);
    expect(summary.decrypt_fail_prev).toBe(1);
    expect(state.updatedRows.length).toBe(2); // Failed row never reaches UPDATE.
    expect(warnPayload()).toContain("token rotation row decrypt failed");
    expect(warnPayload()).toContain("u2-bad");
    // D2: failed row must NOT carry needsReauth in any UPDATE payload.
    for (const upd of state.updatedRows) {
      expect(upd.setFields).not.toHaveProperty("needsReauth");
    }
  });

  it("update_fail: UPDATE throws → counter increments, loop continues, no rethrow", async () => {
    const previous = b64();
    const env = baseEnv({ TOKEN_ENCRYPTION_KEY_PREV: previous });
    const rows = await Promise.all([
      seed(previous, "u1", "rt-1"),
      seed(previous, "u2", "rt-2"),
    ]);
    const state: FakeDb = { selectRows: rows, updateBehavior: "throw", updatedRows: [] };

    const summary = await rotateBatch({ db: fakeDb(state), env });

    expect(summary.scanned).toBe(2);
    expect(summary.ok).toBe(0);
    expect(summary.update_fail).toBe(2);
    expect(warnPayload()).toContain("token rotation row update failed");
  });

  it("encrypt_fail: invalid CURRENT key → all rows fail at the encrypt step, no UPDATE attempts", async () => {
    const previous = b64();
    // Invalid base64 key → aesGcmEncrypt's importAesKey throws.
    const env = baseEnv({
      TOKEN_ENCRYPTION_KEY: "not-a-valid-base64-key!@#",
      TOKEN_ENCRYPTION_KEY_PREV: previous,
    });
    const rows = await Promise.all([seed(previous, "u1", "rt-1")]);
    const state: FakeDb = { selectRows: rows, updateBehavior: "ok", updatedRows: [] };

    const summary = await rotateBatch({ db: fakeDb(state), env });

    expect(summary.scanned).toBe(1);
    expect(summary.ok).toBe(0);
    expect(summary.encrypt_fail).toBe(1);
    expect(state.updatedRows.length).toBe(0);
    expect(warnPayload()).toContain("token rotation row encrypt failed");
  });

  it("PREV missing + stale rows (D1): no decrypt attempted, skipped_no_prev = scanned, one warn line", async () => {
    const orphanKey = b64();
    // Deliberately omit TOKEN_ENCRYPTION_KEY_PREV.
    const env = baseEnv();
    const rows = await Promise.all([
      seed(orphanKey, "u1", "rt-1"),
      seed(orphanKey, "u2", "rt-2"),
    ]);
    const state: FakeDb = { selectRows: rows, updateBehavior: "ok", updatedRows: [] };

    const summary = await rotateBatch({ db: fakeDb(state), env });

    expect(summary.scanned).toBe(2);
    expect(summary.skipped_no_prev).toBe(2);
    expect(summary.ok).toBe(0);
    expect(state.updatedRows.length).toBe(0);
    // One distinct warn — operator misconfig signal.
    const warns = warnPayload();
    expect(warns).toContain("token rotation skipped — TOKEN_ENCRYPTION_KEY_PREV not configured");
    // No per-row decrypt warns (we never tried).
    expect(warns).not.toContain("token rotation row decrypt failed");
  });

  it("idempotency: WHERE clause filters by token_version != target so already-rotated rows aren't selected", async () => {
    // The fake db only honors what `selectRows` returns, but we simulate the
    // post-rotation state by passing an empty array (the real query's
    // `ne(token_version, target)` predicate would filter all rotated rows).
    // Pin: rotateBatch tolerates a "nothing to do" state cleanly without
    // surprising side effects.
    const env = baseEnv({ TOKEN_ENCRYPTION_KEY_PREV: b64() });
    const state: FakeDb = { selectRows: [], updateBehavior: "ok", updatedRows: [] };

    const summary = await rotateBatch({ db: fakeDb(state), env });

    expect(summary.scanned).toBe(0);
    expect(state.updatedRows.length).toBe(0);
  });

  it("targetVersion override flows through to the UPDATE payload and the tick-complete log", async () => {
    const previous = b64();
    const env = baseEnv({ TOKEN_ENCRYPTION_KEY_PREV: previous });
    const rows = await Promise.all([seed(previous, "u1", "rt-1")]);
    const state: FakeDb = { selectRows: rows, updateBehavior: "ok", updatedRows: [] };

    const summary = await rotateBatch({
      db: fakeDb(state),
      env,
      targetVersion: 7,
    });

    expect(summary.ok).toBe(1);
    expect(state.updatedRows[0]?.setFields["tokenVersion"]).toBe(7);
    expect(logPayload()).toContain('"targetVersion":7');
  });
});

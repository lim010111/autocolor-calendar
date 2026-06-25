import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `maybeSelfHealWatch` composes the shared watch core. This adapter test mocks
// the single `reRegisterWatch` seam (guard / reauth / stop→register / classify
// are owned once by `watchCore.test.ts`) and focuses on the self-heal policy:
// the needs_reauth gate, active/expiring decision, 10-min cooldown, and the
// stamp-before-register ordering of `last_self_heal_at`.

const reRegisterMock = vi.fn();
vi.mock("../services/watch/core", () => ({
  reRegisterWatch: (...args: unknown[]) => reRegisterMock(...args),
}));

import { maybeSelfHealWatch } from "../services/watch";

type SsRow = {
  calendarId: string;
  active: boolean;
  watchChannelId: string | null;
  watchExpiration: Date | null;
  lastSelfHealAt: Date | null;
};

type TokRow = { needsReauth: boolean };

// Tracks every db.update() write so tests can assert that lastSelfHealAt was
// stamped (or NOT stamped) per case.
type UpdateCall = { tableName: string; setColumns: string[] };

function fakeDb(opts: {
  tok?: TokRow;
  syncRows?: SsRow[];
  updateCalls?: UpdateCall[];
}) {
  const updateCalls = opts.updateCalls ?? [];
  return {
    select(cols: Record<string, unknown>) {
      // distinguish oauth_tokens select (cols has needsReauth) from sync_state
      const isTokenSelect = "needsReauth" in cols && Object.keys(cols).length === 1;
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  if (isTokenSelect) {
                    return Promise.resolve(opts.tok ? [opts.tok] : []);
                  }
                  return Promise.resolve(opts.syncRows ?? []);
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          updateCalls.push({
            tableName: "sync_state",
            setColumns: Object.keys(values),
          });
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const BASE_ENV = {
  ENV: "dev",
  GOOGLE_OAUTH_REDIRECT_URI: "x",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
  GAS_REDIRECT_URL: "x",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
} as const;

const ENV_WITH_WEBHOOK = {
  ...BASE_ENV,
  WEBHOOK_BASE_URL: "https://example.test",
} as const;

const USER_ID = "user-1";

function expiringSoonRow(): SsRow {
  return {
    calendarId: "primary",
    active: true,
    // null channel — heal-needed path, the simplest "needs heal" case
    watchChannelId: null,
    watchExpiration: null,
    lastSelfHealAt: null,
  };
}

describe("maybeSelfHealWatch", () => {
  beforeEach(() => {
    reRegisterMock.mockReset();
    reRegisterMock.mockResolvedValue({
      ok: true,
      expiration: new Date(Date.now() + 7 * 86400 * 1000),
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("WEBHOOK_BASE_URL unset → no DB read, no register", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [expiringSoonRow()],
      updateCalls,
    });
    await maybeSelfHealWatch(db, BASE_ENV, USER_ID);
    expect(reRegisterMock).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("oauth_tokens.needs_reauth=true → skip register and skip stamp", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: true },
      syncRows: [expiringSoonRow()],
      updateCalls,
    });
    await maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID);
    expect(reRegisterMock).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("sync_state.active=false → skip", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [{ ...expiringSoonRow(), active: false }],
      updateCalls,
    });
    await maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID);
    expect(reRegisterMock).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("watchChannelId is null → registers via core and stamps lastSelfHealAt", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [expiringSoonRow()],
      updateCalls,
    });
    await maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID);
    expect(reRegisterMock).toHaveBeenCalledTimes(1);
    // Adapter delegates (db, env, userId, calendarId) to the core.
    expect(reRegisterMock.mock.calls[0]?.[2]).toBe(USER_ID);
    expect(reRegisterMock.mock.calls[0]?.[3]).toBe("primary");
    // Exactly one stamp UPDATE for `last_self_heal_at`.
    expect(updateCalls).toEqual([
      { tableName: "sync_state", setColumns: ["lastSelfHealAt"] },
    ]);
  });

  it("watchExpiration > now + 24h → no register, no stamp", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [
        {
          calendarId: "primary",
          active: true,
          watchChannelId: "c-existing",
          // 48h ahead — well outside 24h heal threshold
          watchExpiration: new Date(Date.now() + 48 * 60 * 60 * 1000),
          lastSelfHealAt: null,
        },
      ],
      updateCalls,
    });
    await maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID);
    expect(reRegisterMock).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("cooldown active (lastSelfHealAt 5min ago) → skip register", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [
        {
          ...expiringSoonRow(),
          lastSelfHealAt: new Date(Date.now() - 5 * 60 * 1000),
        },
      ],
      updateCalls,
    });
    await maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID);
    expect(reRegisterMock).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("core returns failed:api_error → lastSelfHealAt stamped first; no rethrow", async () => {
    // Pins the failure-burst protection: even when the core reports a transient
    // API failure, we still stamp the cooldown column so a follow-up /me call
    // within 10min skips instead of re-trying. The helper must NOT throw.
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [expiringSoonRow()],
      updateCalls,
    });
    reRegisterMock.mockResolvedValue({ failed: "api_error", kind: "server" });

    await expect(
      maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID),
    ).resolves.toBeUndefined();

    expect(reRegisterMock).toHaveBeenCalledTimes(1);
    // Stamp happens BEFORE register — even on failure it's recorded.
    expect(updateCalls).toEqual([
      { tableName: "sync_state", setColumns: ["lastSelfHealAt"] },
    ]);
  });

  it("core throws an unexpected error → no rethrow, stamp recorded", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [expiringSoonRow()],
      updateCalls,
    });
    reRegisterMock.mockRejectedValue(new Error("hyperdrive socket reset"));

    await expect(
      maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID),
    ).resolves.toBeUndefined();

    expect(reRegisterMock).toHaveBeenCalledTimes(1);
    expect(updateCalls).toEqual([
      { tableName: "sync_state", setColumns: ["lastSelfHealAt"] },
    ]);
  });

  it("core returns failed:reauth_required → no rethrow, stamp recorded", async () => {
    const updateCalls: UpdateCall[] = [];
    const db = fakeDb({
      tok: { needsReauth: false },
      syncRows: [expiringSoonRow()],
      updateCalls,
    });
    reRegisterMock.mockResolvedValue({ failed: "reauth_required" });

    await expect(
      maybeSelfHealWatch(db, ENV_WITH_WEBHOOK, USER_ID),
    ).resolves.toBeUndefined();

    // Stamp still recorded (cooldown protects against rapid re-attempt of
    // the same dead token).
    expect(updateCalls).toEqual([
      { tableName: "sync_state", setColumns: ["lastSelfHealAt"] },
    ]);
  });
});

// Merge-gate finding oracle — "Rule delete can tombstone before cleanup and
// rollback are recoverable" (`deleteRule`, src/services/ruleService.ts).
//
// `deleteRule` commits the guarded tombstone UPDATE first, then runs the
// `rule_seeds` purge and the `color_rollback` fan-out as separate,
// non-transactional statements (`getDb` hands out a bare drizzle handle — no
// route, middleware, or service wraps these in a transaction). If the seed
// purge fails after the UPDATE has already committed, the rule is hidden from
// every read path while its seeds are still in the kNN pool — `knnByUser`
// (src/services/stage1.ts) ranks `rule_seeds` with NO join to `categories`.
//
// Nothing re-drives the cleanup: the tombstone guard `isNull(rule_deleted_at)`
// makes the retry match zero rows (→ `null` → HTTP 404 from the DELETE route),
// and `labelReconcile`'s deactivate branch explicitly `continue`s on
// `ruleDeletedAt !== null` before reaching its own seed purge. There is no
// cron, consumer, or migration that purges seeds of a tombstoned rule.
//
// Both cases below assert the RECOVERABILITY invariant, not the current
// ordering — a fix is free to reorder, retry, or re-drive, as long as a
// transient seed-purge failure cannot strand orphan seeds behind an
// already-hidden rule.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../queues/syncProducer", () => ({
  enqueueSync: vi.fn(async () => undefined),
  SyncQueueUnavailableError: class extends Error {},
}));

import type { Bindings } from "../env";
import { enqueueSync } from "../queues/syncProducer";
import { deleteRule, listRules } from "../services/ruleService";
import { type FakeDbInitial, type Row, makeFakeDb } from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const RULE_A = "11111111-1111-1111-1111-11111111111a";

const env = { ENV: "dev" } as unknown as Bindings;

function row(): Row {
  return {
    id: RULE_A,
    userId: USER_A,
    name: "주간회의",
    colorId: "9",
    keywords: ["주간회의"],
    priority: 100,
    createdAt: new Date("2026-04-19T00:00:00Z"),
    updatedAt: new Date("2026-04-19T00:00:00Z"),
  };
}

// A transient DB-side failure of the seed purge — a dropped Hyperdrive socket,
// a statement timeout, or the Workers Free subrequest cap firing mid-request.
class SeedPurgeFailure extends Error {
  constructor() {
    super("connection terminated unexpectedly");
  }
}

function makeInitial(): FakeDbInitial {
  return {
    categories: [row()],
    syncStates: [
      { userId: USER_A, calendarId: "primary" },
      { userId: USER_A, calendarId: "work@group" },
    ],
    ruleSeeds: [
      { ruleId: RULE_A, userId: USER_A, seedType: "name", seedText: "주간회의" },
      { ruleId: RULE_A, userId: USER_A, seedType: "keyword", seedText: "미팅" },
    ],
  };
}

beforeEach(() => {
  vi.mocked(enqueueSync).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(enqueueSync).mockImplementation(async () => undefined);
});

describe("deleteRule — seed purge failure must stay recoverable", () => {
  it("a retry after a transient seed-purge failure completes the cleanup", async () => {
    // `initial` is read lazily by the fake, so clearing the hook after the
    // first attempt models a transient error that is gone by the retry.
    const initial = makeInitial();
    initial.failSeedDeleteWith = new SeedPurgeFailure();
    const { db, state } = makeFakeDb(initial);

    await expect(
      deleteRule(db as never, env, USER_A, RULE_A),
    ).rejects.toBeInstanceOf(SeedPurgeFailure);

    // The transient failure clears; the client (gas/api.js retries 5xx) or the
    // user re-issues the delete.
    delete initial.failSeedDeleteWith;
    const retry = await deleteRule(db as never, env, USER_A, RULE_A);
    if (retry) await retry.sideEffects;

    // Consequence 1 — orphan seeds must not survive the completed delete.
    expect(
      state.ruleSeeds.filter((s) => s["ruleId"] === RULE_A),
    ).toHaveLength(0);

    // Consequence 2 — the events this rule painted must still get their
    // per-calendar `color_rollback` jobs.
    const rollbacks = vi
      .mocked(enqueueSync)
      .mock.calls.map((c) => c[1])
      .filter((m) => m.type === "color_rollback");
    expect(rollbacks).toHaveLength(2);
  });

  it("never hides the rule while its seeds are still scoring in the kNN pool", async () => {
    const initial = makeInitial();
    initial.failSeedDeleteWith = new SeedPurgeFailure();
    const { db, state } = makeFakeDb(initial);

    await expect(
      deleteRule(db as never, env, USER_A, RULE_A),
    ).rejects.toBeInstanceOf(SeedPurgeFailure);

    // The editor list is the user's view of "is this rule gone".
    const visible = await listRules(db as never, USER_A, {
      includeLabelDeleted: true,
    });
    const hiddenFromUser = visible.length === 0;
    const orphanSeeds = state.ruleSeeds.filter(
      (s) => s["ruleId"] === RULE_A,
    ).length;

    // "Deleted to the user, alive to the classifier" is the state that must be
    // unreachable — either the rule is still visible (the delete did not take
    // effect and can be retried), or its seeds are gone.
    expect({ hiddenFromUser, orphanSeeds }).not.toEqual({
      hiddenFromUser: true,
      orphanSeeds: 2,
    });
  });
});

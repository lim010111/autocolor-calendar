import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as GoogleCalendar from "../services/googleCalendar";
import type * as RuleService from "../services/ruleService";

vi.mock("../services/googleCalendar", async () => {
  const actual = await vi.importActual<typeof GoogleCalendar>(
    "../services/googleCalendar",
  );
  return {
    ...actual,
    getCalendarLabelProperties: vi.fn(),
  };
});

vi.mock("../services/ruleService", async () => {
  const actual = await vi.importActual<typeof RuleService>(
    "../services/ruleService",
  );
  return {
    ...actual,
    writeNameSeed: vi.fn(async () => undefined),
  };
});

import { getCalendarLabelProperties } from "../services/googleCalendar";
import { reconcileLabels } from "../services/labelReconcile";

const USER = "00000000-0000-0000-0000-00000000aaaa";
const CAL = "primary";
const AT = "acc-token";
const mockedLabels = vi.mocked(getCalendarLabelProperties);

const labelsRead = (
  eventLabels: Awaited<
    ReturnType<typeof getCalendarLabelProperties>
  >["eventLabels"],
) => ({ calendarId: "owner@example.com", eventLabels });

type RuleRow = {
  id: string;
  name: string;
  backgroundColor?: string | null;
  labelId: string | null;
  labelDeletedAt: Date | null;
  ruleDeletedAt?: Date | null;
};

// Same shape as the double in `labelReconcile.test.ts`, with two additions
// that make the partial-failure story observable across TWO reconcile runs:
//
//  1. `update().set().where()` APPLIES the `labelDeletedAt` stamp to the
//     backing rows. `reconcileLabels` is not wrapped in a transaction
//     (`getDb` hands out a plain postgres.js/drizzle handle and the caller in
//     `calendarSync.runPagedList` just awaits it), so each statement
//     autocommits — a stamp that lands is durable even if the very next
//     statement blows up.
//  2. `delete().where()` can be armed to throw once, standing in for any
//     failure of the seed purge (connection reset mid-run, statement
//     timeout, the Workers Free subrequest cap firing between the two
//     statements, a Worker CPU kill).
function makeDb(rules: RuleRow[], opts: { failSeedDeleteOnce?: boolean } = {}) {
  const rows = rules.map((r) => ({ ruleDeletedAt: null, ...r }));
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let seedPurges = 0;
  let armed = opts.failSeedDeleteOnce === true;

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          then: (resolve: (v: RuleRow[]) => unknown) =>
            resolve(rows.map((r) => ({ ...r }))),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return {
          where: async () => {
            if ("labelDeletedAt" in patch) {
              // Committed on its own — this is the state the next run reads.
              for (const r of rows) r.labelDeletedAt = new Date();
            }
            return undefined;
          },
        };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { returning: async () => [{ id: "new-rule-id" }] };
      },
    }),
    delete: () => ({
      where: async () => {
        if (armed) {
          armed = false;
          throw new Error("seed purge failed: connection terminated");
        }
        seedPurges += 1;
        return undefined;
      },
    }),
  };

  return {
    db: db as never,
    updates,
    inserts,
    rows,
    seedPurgeCount: () => seedPurges,
  };
}

beforeEach(() => {
  mockedLabels.mockReset();
});

describe("labelReconcile — deactivation seed purge is not retryable (merge-gate finding 1)", () => {
  it("a failed seed purge is never retried: the stamp lands, later runs skip at the labelDeletedAt guard", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const store = makeDb(
      [{ id: "r1", name: "회의", labelId: "L1", labelDeletedAt: null }],
      { failSeedDeleteOnce: true },
    );

    // Run 1 — the Google label is gone, so the rule is deactivated. The stamp
    // commits; the seed purge that is supposed to ride along with it throws.
    mockedLabels.mockResolvedValueOnce(labelsRead([]));
    await expect(
      reconcileLabels({
        db: store.db,
        userId: USER,
        calendarId: CAL,
        accessToken: AT,
      }),
    ).resolves.toBeUndefined();

    // Preconditions that hold whatever the eventual fix looks like: the
    // failure is swallowed warn-only (the sync run must not abort), and the
    // seeds did not go.
    expect(warnSpy).toHaveBeenCalled();
    expect(store.seedPurgeCount()).toBe(0);

    // Run 2 — same tenant, same vanished label, DB healthy again. This is the
    // repair opportunity: if the purge were retryable, the orphaned seeds
    // would go now. On HEAD the `labelDeletedAt !== null` guard (line 314)
    // skips the row before it can ever reach the purge (line 333), so the
    // stale kNN seed pool — which `knnByUser` ranks with no join to
    // `categories` — survives forever.
    mockedLabels.mockResolvedValueOnce(labelsRead([]));
    await reconcileLabels({
      db: store.db,
      userId: USER,
      calendarId: CAL,
      accessToken: AT,
    });

    warnSpy.mockRestore();

    // The invariant: a row carrying `label_deleted_at` must not still own
    // seeds. Either the purge eventually happens, or the stamp must not have
    // landed without it (leaving the whole deactivation retryable). Both
    // shapes of fix — purge-before-stamp, or letting a stamped row fall
    // through to the purge — satisfy this; HEAD satisfies neither.
    expect({
      stampedAsLabelDeleted: store.rows[0]!.labelDeletedAt !== null,
      seedsPurged: store.seedPurgeCount() >= 1,
    }).not.toEqual({ stampedAsLabelDeleted: true, seedsPurged: false });
  });

  // Control: the same double, same assertion, with no injected failure —
  // passes on HEAD. Proves the harness is not rigged to fail and that the
  // invariant above is satisfiable through the real purge path.
  it("control — with a healthy DB the stamp and the purge land together", async () => {
    const store = makeDb([
      { id: "r1", name: "회의", labelId: "L1", labelDeletedAt: null },
    ]);

    mockedLabels.mockResolvedValueOnce(labelsRead([]));
    await reconcileLabels({
      db: store.db,
      userId: USER,
      calendarId: CAL,
      accessToken: AT,
    });

    expect(store.seedPurgeCount()).toBe(1);
    expect({
      stampedAsLabelDeleted: store.rows[0]!.labelDeletedAt !== null,
      seedsPurged: store.seedPurgeCount() >= 1,
    }).not.toEqual({ stampedAsLabelDeleted: true, seedsPurged: false });
  });
});

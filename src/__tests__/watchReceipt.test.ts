import { describe, expect, it } from "vitest";

import {
  lookupChannelOwner,
  verifyChannelToken,
} from "../services/watch/receipt";

const UID = "11111111-1111-1111-1111-111111111111";
const CAL = "primary";

type Row = {
  userId: string;
  calendarId: string;
  storedToken: string | null;
  active: boolean;
} | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDb(row: Row): any {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(row ? [row] : []);
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("watch/receipt.verifyChannelToken", () => {
  it("returns true on equal tokens", () => {
    expect(verifyChannelToken("abc-123", "abc-123")).toBe(true);
  });
  it("returns false when lengths differ", () => {
    expect(verifyChannelToken("abc", "abcd")).toBe(false);
  });
  it("returns false when bytes differ at any position", () => {
    expect(verifyChannelToken("abc-123", "abc-124")).toBe(false);
  });
  it("returns false when either side is null/empty", () => {
    expect(verifyChannelToken(null, "abc")).toBe(false);
    expect(verifyChannelToken("abc", null)).toBe(false);
    expect(verifyChannelToken("", "")).toBe(false);
  });
});

describe("watch/receipt.lookupChannelOwner", () => {
  it("returns null when no row matches", async () => {
    const out = await lookupChannelOwner(fakeDb(null), "c-missing", "r-missing");
    expect(out).toBeNull();
  });

  it("returns null when row has no stored token (channel stopped mid-flight)", async () => {
    const out = await lookupChannelOwner(
      fakeDb({ userId: UID, calendarId: CAL, storedToken: null, active: true }),
      "c-1",
      "r-1",
    );
    expect(out).toBeNull();
  });

  it("returns owner on match", async () => {
    const out = await lookupChannelOwner(
      fakeDb({
        userId: UID,
        calendarId: CAL,
        storedToken: "tok-abc",
        active: true,
      }),
      "c-1",
      "r-1",
    );
    expect(out).toEqual({
      userId: UID,
      calendarId: CAL,
      storedToken: "tok-abc",
      active: true,
    });
  });
});

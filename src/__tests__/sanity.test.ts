import { describe, expect, it } from "vitest";

describe("harness sanity", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});

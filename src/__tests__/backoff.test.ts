import { describe, expect, it } from "vitest";

import { computeBackoffSeconds } from "../lib/backoff";

describe("computeBackoffSeconds", () => {
  it("attempt 0 → around 15s base", () => {
    const s = computeBackoffSeconds(0, () => 0);
    expect(s).toBe(15);
  });

  it("doubles with attempts", () => {
    expect(computeBackoffSeconds(1, () => 0)).toBe(30);
    expect(computeBackoffSeconds(2, () => 0)).toBe(60);
    expect(computeBackoffSeconds(3, () => 0)).toBe(120);
  });

  it("caps at 3600 seconds", () => {
    expect(computeBackoffSeconds(20, () => 0)).toBe(3600);
  });

  it("adds jitter up to 10 seconds", () => {
    const s = computeBackoffSeconds(0, () => 0.99);
    expect(s).toBeGreaterThanOrEqual(15);
    expect(s).toBeLessThanOrEqual(15 + 10);
  });
});

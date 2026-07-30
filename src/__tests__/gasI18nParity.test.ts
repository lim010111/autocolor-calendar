import { describe, expect, it } from "vitest";

import { loadGasMessages } from "./_helpers/gasSwatches";

// `gas/AGENTS.md` requires every user-facing string to exist in ALL FOUR
// bundles, and nothing enforced it. The failure is quiet by design: `t()`
// falls back en → the raw key, so a missing Korean string ships as
// `rules.delete.warning` printed on the card. Non-en users see it; the
// operator, testing in en, does not.
describe("gas/i18n.js — locale bundle parity", () => {
  const MESSAGES = loadGasMessages();
  const locales = Object.keys(MESSAGES);
  const reference = "en";

  it("declares exactly the four supported locales", () => {
    expect(locales.sort()).toEqual(["en", "ko", "zh-CN", "zh-TW"]);
  });

  for (const locale of ["ko", "zh-CN", "zh-TW"]) {
    it(`${locale} has the same key set as ${reference}`, () => {
      const expected = Object.keys(MESSAGES[reference]!).sort();
      const actual = Object.keys(MESSAGES[locale]!).sort();
      const missing = expected.filter((k) => !actual.includes(k));
      const extra = actual.filter((k) => !expected.includes(k));
      expect(
        { missing, extra },
        `gas/i18n.js: ${locale} is out of sync with ${reference}. ` +
          `Add every new key to all four bundles (gas/AGENTS.md).`,
      ).toEqual({ missing: [], extra: [] });
    });
  }

  it("has no empty strings in any bundle", () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(MESSAGES[locale]!)) {
        expect(value, `${locale}.${key} is empty`).not.toBe("");
      }
    }
  });
});

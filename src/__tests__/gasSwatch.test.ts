import { describe, expect, it } from "vitest";

import { loadGasSwatchApi } from "./_helpers/gasSwatches";
import { CLASSIC_EVENT_COLOR_HEX } from "../services/labelReconcile";

// The Add-on's "My rules" list and the event-sidebar label chips both draw
// their swatch from `getSwatchForRule`. This file pins the property that was
// broken in production: what the user picks is what the editor draws.
//
// The bug it guards: the rule row used to render from `categories.colorId`,
// a nearest-classic cache that collapses the 24 label colors onto 11 ids —
// AND the nearest-match ran against a different palette than the picker.
// 19 of 24 colors came back wrong (cocoa → basil green, wisteria → blue).
const gas = loadGasSwatchApi();

describe("gas/i18n.js swatch resolution", () => {
  it("every pickable color renders as itself", () => {
    // Exactly the round-trip the user performs: pick a hex in the grid →
    // POST it → read it back on the rule → draw a swatch.
    const wrong = gas.LABEL_SWATCH_PALETTE.filter((swatch) => {
      const drawn = gas.getSwatchForRule({
        backgroundColor: swatch.hex,
        colorId: "8",
      });
      return drawn.hex !== swatch.hex;
    }).map((s) => s.hex);

    expect(wrong).toEqual([]);
    expect(gas.LABEL_SWATCH_PALETTE).toHaveLength(24);
  });

  it("hex casing from Google does not change the swatch", () => {
    const cocoa = "#795548";
    expect(
      gas.getSwatchForRule({ backgroundColor: cocoa.toUpperCase() }).hex,
    ).toBe(cocoa);
  });

  it("an off-palette custom color falls back to the nearest slot, not grey", () => {
    // Google's UI allows custom RGB label colors. A near-cocoa custom color
    // must land on cocoa, not on the graphite default.
    expect(gas.getSwatchForRule({ backgroundColor: "#7a5649" }).hex).toBe(
      "#795548",
    );
    expect(gas.getNearestSwatchForHex("not-a-hex")).toBeNull();
  });

  it("falls back to the legacy colorId only when no hex is known", () => {
    // Rows written before `background_color` existed (reconcile backfills
    // them on the next sync) and pre-cutover rules with no label at all.
    expect(gas.getSwatchForRule({ backgroundColor: null, colorId: "2" }).hex).toBe(
      gas.CLASSIC_COLOR_ID_HEX["2"],
    );
    expect(gas.getSwatchForRule({ colorId: "999" }).hex).toBe("#616161");
  });

  it("the classic colorId table agrees with the backend's", () => {
    // Two copies of the same 11 values (GAS cannot import from src/). They
    // drifted into different palettes once already — that divergence is
    // precisely what mis-rendered the swatches.
    expect(gas.CLASSIC_COLOR_ID_HEX).toEqual(CLASSIC_EVENT_COLOR_HEX);
  });

  it("every classic color is also a label-palette slot", () => {
    for (const hex of Object.values(gas.CLASSIC_COLOR_ID_HEX)) {
      expect(gas.getSwatchForHex(hex)).not.toBeNull();
    }
  });
});

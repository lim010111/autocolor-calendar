import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The Add-on's swatch logic lives in `gas/i18n.js` as Apps Script globals —
// no module system, no bundler, and no test runner of its own. Rather than
// duplicate the 24-color palette on this side (the duplication that produced
// the wrong-swatch bug in the first place), evaluate the real file and hand
// its globals back. Only declarations are touched at load time; every GAS
// API reference in that file sits inside a function body.

export type Swatch = { hex: string; url: string; selectedUrl: string };

export type GasSwatchApi = {
  LABEL_SWATCH_PALETTE: Swatch[];
  CLASSIC_COLOR_ID_HEX: Record<string, string>;
  getLabelSwatches: () => Swatch[];
  getSwatchForHex: (hex: string | null | undefined) => Swatch | null;
  getNearestSwatchForHex: (hex: string | null | undefined) => Swatch | null;
  getSwatchForClassicColorId: (colorId: string) => Swatch;
  getSwatchForRule: (rule: {
    backgroundColor?: string | null;
    colorId?: string | null;
  }) => Swatch;
};

const I18N_PATH = fileURLToPath(
  new URL("../../../gas/i18n.js", import.meta.url),
);

export function loadGasSwatchApi(): GasSwatchApi {
  const source = readFileSync(I18N_PATH, "utf8");
  const factory = new Function(
    `${source}\nreturn {
      LABEL_SWATCH_PALETTE: LABEL_SWATCH_PALETTE,
      CLASSIC_COLOR_ID_HEX: CLASSIC_COLOR_ID_HEX,
      getLabelSwatches: getLabelSwatches,
      getSwatchForHex: getSwatchForHex,
      getNearestSwatchForHex: getNearestSwatchForHex,
      getSwatchForClassicColorId: getSwatchForClassicColorId,
      getSwatchForRule: getSwatchForRule,
    };`,
  ) as () => GasSwatchApi;
  return factory();
}

/** The 24 default label-slot hexes, in grid order. */
export const LABEL_PALETTE_HEXES: string[] =
  loadGasSwatchApi().LABEL_SWATCH_PALETTE.map((s) => s.hex);

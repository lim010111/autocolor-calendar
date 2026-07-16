#!/usr/bin/env python3
"""Regenerate the inline swatch PNGs embedded in gas/i18n.js LABEL_SWATCH_PALETTE.

card-latency #03 contract, carried into native-labels #03: the swatch grid
renders from base64 data URIs inlined in the card JSON instead of external
PNGs, so neither the initial paint nor the url <-> selectedUrl selection
swap makes an external image fetch.

native-labels #03 (ADR-0006): the palette is the 24 default label-slot hex
colors Google pre-seeds per calendar (PRD "기본 24색 = unnamed 라벨 슬롯").
Labels have no color names, so entries carry only the hex.

Hex provenance (operator prod-account labelProperties probe, 2026-07-15,
`.scratch/native-labels/spike/label-probe.ts` run — 21 unnamed slots read
verbatim; plus per-entry notes below):
- 21 entries: measured directly as unnamed slots.
- #e67c73: the classic flamingo hex from this file's previous 11-color
  palette (absent from the probe account's remaining slots).
- #ad1457: measured as the probe account's named test label ("내가 만든
  라벨" — the PRD row-3 label), matching the public Radicchio value.
- #d81b60: TODO(native-labels): NOT probe-measured — public Google palette
  value (Cherry Blossom). Verify against a fresh account's labelProperties
  before treating as canonical.

Visuals mirror the old placehold.co affordance:
- unselected: 48x48 solid color square (CardService circle-crops it)
- selected:   same color with a check mark (white; #333333 on light colors)

Usage (operator workstation, requires Pillow):
    python3 scripts/gen-swatch-assets.py
Then paste the printed entries over the LABEL_SWATCH_PALETTE array body in
gas/i18n.js. Ordering follows the Google Calendar color-grid layout and
MUST stay unchanged.
"""
import base64
import io

from PIL import Image, ImageDraw

# (hex, checkHex) — 24 default label-slot colors, grid order.
PALETTE = [
    ("d50000", "FFFFFF"),  # tomato
    ("e67c73", "FFFFFF"),  # flamingo (classic-palette hex; not in probe slots)
    ("f4511e", "FFFFFF"),  # tangerine
    ("ef6c00", "FFFFFF"),  # pumpkin
    ("f09300", "FFFFFF"),  # mango
    ("f6bf26", "333333"),  # banana
    ("e4c441", "333333"),  # citron
    ("c0ca33", "333333"),  # avocado
    ("7cb342", "FFFFFF"),  # pistachio
    ("33b679", "FFFFFF"),  # sage
    ("0b8043", "FFFFFF"),  # basil
    ("009688", "FFFFFF"),  # eucalyptus
    ("039be5", "FFFFFF"),  # peacock
    ("4285f4", "FFFFFF"),  # cobalt
    ("3f51b5", "FFFFFF"),  # blueberry
    ("7986cb", "FFFFFF"),  # lavender
    ("b39ddb", "FFFFFF"),  # wisteria
    ("9e69af", "FFFFFF"),  # amethyst
    ("8e24aa", "FFFFFF"),  # grape
    ("ad1457", "FFFFFF"),  # radicchio (probe: named test label bg)
    ("d81b60", "FFFFFF"),  # cherry blossom — TODO(native-labels): verify (see header)
    ("795548", "FFFFFF"),  # cocoa
    ("616161", "FFFFFF"),  # graphite
    ("a79b8e", "FFFFFF"),  # birch
]

SIZE = 48
SS = 4  # supersample factor for anti-aliased check mark


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def encode(img):
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def solid_png(color_hex):
    img = Image.new("P", (SIZE, SIZE))
    img.putpalette(list(hex_rgb(color_hex)))  # 1-entry palette keeps PLTE tiny
    return encode(img)


def check_png(color_hex, check_hex):
    big = SIZE * SS
    img = Image.new("RGB", (big, big), hex_rgb(color_hex))
    d = ImageDraw.Draw(img)
    w = 4 * SS
    pts = [(14 * SS, 25 * SS), (21 * SS, 32 * SS), (34 * SS, 16 * SS)]
    d.line(pts, fill=hex_rgb(check_hex), width=w, joint="curve")
    r = w // 2
    for (x, y) in (pts[0], pts[2]):  # round the stroke end caps
        d.ellipse([x - r, y - r, x + r, y + r], fill=hex_rgb(check_hex))
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img = img.convert("P", palette=Image.ADAPTIVE, colors=32)
    return encode(img)


def main():
    total = 0
    lines = []
    for color, check in PALETTE:
        u = solid_png(color)
        s = check_png(color, check)
        total += len(u) + len(s)
        lines.append('  { hex: "#%s", url: "%s",' % (color, u))
        lines.append('    selectedUrl: "%s" },' % s)
    lines[-1] = lines[-1].rstrip(",")  # last array entry: no trailing comma
    print("\n".join(lines))
    print("// total data-URI chars: %d" % total)


if __name__ == "__main__":
    main()

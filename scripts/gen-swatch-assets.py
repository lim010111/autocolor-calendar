#!/usr/bin/env python3
"""Regenerate the inline swatch PNGs embedded in gas/i18n.js COLOR_PALETTE.

card-latency #03: the 11-color swatch grid renders from base64 data URIs
inlined in the card JSON instead of external placehold.co PNGs, so neither
the initial paint nor the url <-> selectedUrl selection swap makes an
external image fetch.

Visuals mirror the old placehold.co affordance:
- unselected: 48x48 solid color square (CardService circle-crops it)
- selected:   same color with a check mark (white; #333333 on banana)

Usage (operator workstation, requires Pillow):
    python3 scripts/gen-swatch-assets.py
Then paste the printed entries over the COLOR_PALETTE array body in
gas/i18n.js. Ordering/id/key are the Google Calendar colorId mapping and
MUST stay unchanged.
"""
import base64
import io

from PIL import Image, ImageDraw

# (colorId, hex, checkHex, key) — order and values are the frozen palette
PALETTE = [
    ("11", "D50000", "FFFFFF", "tomato"),
    ("4",  "E67C73", "FFFFFF", "flamingo"),
    ("6",  "F4511E", "FFFFFF", "tangerine"),
    ("5",  "F6BF26", "333333", "banana"),
    ("2",  "33B679", "FFFFFF", "sage"),
    ("10", "0B8043", "FFFFFF", "basil"),
    ("7",  "039BE5", "FFFFFF", "peacock"),
    ("9",  "3F51B5", "FFFFFF", "blueberry"),
    ("1",  "7986CB", "FFFFFF", "lavender"),
    ("3",  "8E24AA", "FFFFFF", "grape"),
    ("8",  "616161", "FFFFFF", "graphite"),
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
    for cid, color, check, key in PALETTE:
        u = solid_png(color)
        s = check_png(color, check)
        total += len(u) + len(s)
        pad = " " if len(cid) == 2 else "  "
        lines.append('  { id: "%s",%surl: "%s",' % (cid, pad, u))
        lines.append('    selectedUrl: "%s", key: "%s" },' % (s, key))
    lines[-1] = lines[-1].rstrip(",")  # last array entry: no trailing comma
    print("\n".join(lines))
    print("// total data-URI chars: %d" % total)


if __name__ == "__main__":
    main()

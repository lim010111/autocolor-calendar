#!/usr/bin/env python3
"""Regenerate marketplace icon derivatives from the 1024px master."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets" / "marketplace" / "icons"
MASTER = OUT / "icon-1024.png"
SOURCE_SVG = OUT / "icon-source.svg"


SOURCE_SVG_TEXT = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">AutoColor for Calendar app icon</title>
  <desc id="desc">A rounded calendar with colored event squares and a magic wand sparkle.</desc>
  <defs>
    <linearGradient id="headerGradient" x1="210" y1="210" x2="780" y2="350" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6c82ff"/>
      <stop offset="1" stop-color="#7895ff"/>
    </linearGradient>
    <linearGradient id="pageGradient" x1="235" y1="360" x2="770" y2="760" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f7f9ff"/>
      <stop offset="1" stop-color="#eef3f9"/>
    </linearGradient>
    <linearGradient id="wandGradient" x1="540" y1="835" x2="760" y2="600" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4b5366"/>
      <stop offset="1" stop-color="#262b38"/>
    </linearGradient>
    <filter id="blueGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="36" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.36 0 0 0 0 0.46 0 0 0 0 1 0 0 0 .62 0"/>
      <feBlend in="SourceGraphic" mode="screen"/>
    </filter>
    <filter id="colorGlow" x="-75%" y="-75%" width="250%" height="250%">
      <feGaussianBlur stdDeviation="28" result="blur"/>
      <feBlend in="blur" in2="SourceGraphic" mode="screen"/>
    </filter>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="12" stdDeviation="20" flood-color="#151820" flood-opacity=".28"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" fill="none"/>

  <g filter="url(#blueGlow)">
    <path d="M200 356V270c0-38 31-69 69-69h486c38 0 69 31 69 69v86H200z" fill="url(#headerGradient)"/>
  </g>
  <path d="M200 356h624v355c0 46-37 83-83 83H283c-46 0-83-37-83-83V356z" fill="url(#pageGradient)" opacity=".9" filter="url(#shadow)"/>
  <path d="M200 356h624v355c0 46-37 83-83 83H283c-46 0-83-37-83-83V356z" fill="none" stroke="#ffffff" stroke-width="4" opacity=".65"/>

  <g opacity=".88">
    <circle cx="349" cy="263" r="43" fill="#6f7db7" opacity=".32"/>
    <circle cx="636" cy="263" r="43" fill="#6f7db7" opacity=".32"/>
    <rect x="326" y="150" width="46" height="135" rx="23" fill="#303642" stroke="#10131c" stroke-width="2"/>
    <rect x="613" y="150" width="46" height="135" rx="23" fill="#303642" stroke="#10131c" stroke-width="2"/>
  </g>

  <g>
    <rect x="254" y="409" width="89" height="90" rx="12" fill="#ffffff" stroke="#e6e9ee"/>
    <rect x="381" y="409" width="89" height="90" rx="12" fill="#ffffff" stroke="#e6e9ee"/>
    <rect x="508" y="409" width="89" height="90" rx="12" fill="#ffffff" stroke="#e6e9ee"/>
    <rect x="635" y="409" width="92" height="90" rx="12" fill="#ff5579" stroke="#ff2e63" filter="url(#colorGlow)"/>

    <rect x="254" y="529" width="89" height="86" rx="12" fill="#ffffff" stroke="#e6e9ee"/>
    <rect x="381" y="529" width="89" height="86" rx="12" fill="#ffc42f" stroke="#ffa800" filter="url(#colorGlow)"/>
    <rect x="508" y="529" width="89" height="86" rx="12" fill="#55cd89" stroke="#21ad65" filter="url(#colorGlow)"/>
    <rect x="635" y="529" width="92" height="86" rx="12" fill="#ffffff" stroke="#e6e9ee"/>

    <rect x="254" y="644" width="89" height="89" rx="12" fill="#55a0ff" stroke="#2576f2" filter="url(#colorGlow)"/>
    <rect x="381" y="644" width="89" height="89" rx="12" fill="#ffffff" stroke="#e6e9ee"/>
    <rect x="508" y="644" width="89" height="89" rx="12" fill="#9b6bea" stroke="#7b43d8" filter="url(#colorGlow)"/>
  </g>

  <g>
    <path d="M708 647l51-51 19 51 51 51-51 19-51 51-19-51-51-51z" fill="#ffca30" stroke="#ffb300" stroke-width="2" filter="url(#colorGlow)"/>
    <path d="M827 556l24 30 30 24-30 24-24 30-24-30-30-24 30-24z" fill="#5bd28e" stroke="#22b86d" stroke-width="2" opacity=".9"/>
    <path d="M829 663l23 27 27 23-27 23-23 27-23-27-27-23 27-23z" fill="#9a69ed" stroke="#7e48db" stroke-width="2" opacity=".9"/>
    <path d="M744 724l24 26 26 24-26 24-24 26-24-26-26-24 26-24z" fill="#7590ff" stroke="#5975ef" stroke-width="2" opacity=".9"/>
  </g>

  <g transform="rotate(-45 640 745)">
    <rect x="536" y="707" width="205" height="55" rx="27.5" fill="url(#wandGradient)" stroke="#111723" stroke-width="2"/>
    <line x1="735" y1="735" x2="802" y2="735" stroke="#202839" stroke-width="8" stroke-linecap="round"/>
    <line x1="797" y1="735" x2="831" y2="735" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".65"/>
  </g>
</svg>
"""


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def star_points(
    cx: float,
    cy: float,
    outer: float,
    inner: float | None = None,
    points: int = 4,
) -> list[tuple[float, float]]:
    if inner is None:
        inner = outer * 0.42

    coords = []
    for i in range(points * 2):
        radius = outer if i % 2 == 0 else inner
        angle = -math.pi / 2 + i * math.pi / points
        coords.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return coords


def draw_round_line(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int, int, int],
    fill: tuple[int, int, int, int],
    width: int,
) -> None:
    x1, y1, x2, y2 = xy
    draw.line(xy, fill=fill, width=width)
    radius = width / 2
    draw.ellipse((x1 - radius, y1 - radius, x1 + radius, y1 + radius), fill=fill)
    draw.ellipse((x2 - radius, y2 - radius, x2 + radius, y2 + radius), fill=fill)


def render_small_icon(size: int) -> Image.Image:
    mul = 12 if size <= 16 else 10
    canvas = size * mul
    base = 32
    scale = canvas / base

    def sc(value: float) -> int:
        return round(value * scale)

    def box(values: tuple[float, ...]) -> tuple[int, ...]:
        return tuple(sc(value) for value in values)

    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))

    glow = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle(box((18.2, 13.3, 23.3, 18.4)), radius=sc(1.5), fill=rgba("#ff5579", 160))
    gd.rounded_rectangle(box((11.6, 17.7, 16.8, 22.8)), radius=sc(1.5), fill=rgba("#ffc42f", 155))
    gd.rounded_rectangle(box((17.5, 17.7, 22.7, 22.8)), radius=sc(1.5), fill=rgba("#55cd89", 155))
    gd.rounded_rectangle(box((6.7, 22.1, 11.9, 27.3)), radius=sc(1.5), fill=rgba("#55a0ff", 150))
    gd.polygon([(sc(x), sc(y)) for x, y in star_points(25.4, 19.2, 4.4, 1.7, 4)], fill=rgba("#ffca30", 150))
    glow = glow.filter(ImageFilter.GaussianBlur(sc(1.25 if size >= 32 else 0.75)))
    img.alpha_composite(glow)

    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(box((4.0, 6.5, 25.6, 27.0)), radius=sc(3.8), fill=rgba("#f7f9ff", 248), outline=rgba("#cfd6e6"), width=max(1, sc(0.45)))
    draw.rounded_rectangle(box((4.0, 6.0, 25.6, 14.0)), radius=sc(3.8), fill=rgba("#6f84ff"))
    draw.rectangle(box((4.0, 10.5, 25.6, 14.0)), fill=rgba("#6f84ff"))

    draw.rounded_rectangle(box((8.5, 3.2, 11.2, 10.0)), radius=sc(1.4), fill=rgba("#333a48"), outline=rgba("#151923"), width=max(1, sc(0.3)))
    draw.rounded_rectangle(box((18.3, 3.2, 21.0, 10.0)), radius=sc(1.4), fill=rgba("#333a48"), outline=rgba("#151923"), width=max(1, sc(0.3)))

    cell_width = max(1, sc(0.35))
    cells = [
        ((7.0, 14.7, 11.7, 19.4), "#ffffff", "#e3e7ef"),
        ((13.0, 14.7, 17.7, 19.4), "#ffffff", "#e3e7ef"),
        ((19.0, 14.7, 23.7, 19.4), "#ff5579", "#ff2e63"),
        ((7.0, 20.7, 11.7, 25.4), "#55a0ff", "#2576f2"),
        ((13.0, 20.7, 17.7, 25.4), "#ffc42f", "#ffa800"),
        ((19.0, 20.7, 23.7, 25.4), "#55cd89", "#21ad65"),
    ]
    for coords, fill, outline in cells:
        draw.rounded_rectangle(box(coords), radius=sc(1.0), fill=rgba(fill), outline=rgba(outline), width=cell_width)

    draw_round_line(draw, (*box((19.4, 27.5)), *box((26.6, 20.3))), rgba("#283040"), max(1, sc(2.5)))
    draw_round_line(draw, (*box((25.8, 20.9)), *box((28.6, 18.1))), rgba("#f7f9ff", 210), max(1, sc(0.7)))
    draw.polygon([(sc(x), sc(y)) for x, y in star_points(25.6, 19.2, 4.7, 1.75, 4)], fill=rgba("#ffca30"), outline=rgba("#ffb300"))
    draw.polygon([(sc(x), sc(y)) for x, y in star_points(24.7, 25.1, 1.8, 0.75, 4)], fill=rgba("#7590ff", 240))

    return img.resize((size, size), Image.Resampling.LANCZOS)


def render_16_icon() -> Image.Image:
    mul = 16
    canvas = 16 * mul

    def sc(value: float) -> int:
        return round(value * mul)

    def box(values: tuple[float, ...]) -> tuple[int, ...]:
        return tuple(sc(value) for value in values)

    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(box((2.0, 3.2, 13.3, 14.2)), radius=sc(2.0), fill=rgba("#f7f9ff", 248), outline=rgba("#cfd6e6"), width=max(1, sc(0.35)))
    draw.rounded_rectangle(box((2.0, 3.0, 13.3, 7.0)), radius=sc(2.0), fill=rgba("#6f84ff"))
    draw.rectangle(box((2.0, 5.6, 13.3, 7.0)), fill=rgba("#6f84ff"))
    draw.rounded_rectangle(box((4.4, 1.7, 5.8, 5.4)), radius=sc(0.7), fill=rgba("#333a48"))
    draw.rounded_rectangle(box((9.5, 1.7, 10.9, 5.4)), radius=sc(0.7), fill=rgba("#333a48"))
    for coords, fill, outline in [
        ((3.7, 8.1, 6.2, 10.6), "#55a0ff", "#2576f2"),
        ((6.8, 8.1, 9.3, 10.6), "#ffc42f", "#ffa800"),
        ((9.9, 8.1, 12.4, 10.6), "#55cd89", "#21ad65"),
        ((6.8, 11.2, 9.3, 13.7), "#9b6bea", "#7b43d8"),
    ]:
        draw.rounded_rectangle(box(coords), radius=sc(0.5), fill=rgba(fill), outline=rgba(outline), width=max(1, sc(0.2)))
    draw_round_line(draw, (*box((10.3, 14.2)), *box((14.0, 10.5))), rgba("#283040"), max(1, sc(1.2)))
    draw.polygon([(sc(x), sc(y)) for x, y in star_points(13.0, 10.2, 2.4, 0.9, 4)], fill=rgba("#ffca30"), outline=rgba("#ffb300"))
    return img.resize((16, 16), Image.Resampling.LANCZOS)


def render_mono(color_hex: str) -> Image.Image:
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    main = rgba(color_hex)
    mid = rgba(color_hex, 170)
    soft = rgba(color_hex, 78)
    faint = rgba(color_hex, 38)

    draw.rounded_rectangle((198, 205, 792, 800), radius=78, fill=soft, outline=mid, width=18)
    draw.rounded_rectangle((198, 205, 792, 360), radius=78, fill=main)
    draw.rectangle((198, 282, 792, 360), fill=main)
    draw.line((198, 360, 792, 360), fill=main, width=10)

    draw.ellipse((300, 220, 400, 320), fill=faint, outline=mid, width=8)
    draw.ellipse((590, 220, 690, 320), fill=faint, outline=mid, width=8)
    draw.rounded_rectangle((326, 145, 374, 286), radius=24, fill=main)
    draw.rounded_rectangle((616, 145, 664, 286), radius=24, fill=main)

    for rect, alpha in [
        ((254, 414, 344, 504), 110),
        ((382, 414, 472, 504), 110),
        ((510, 414, 600, 504), 110),
        ((638, 414, 728, 504), 230),
        ((254, 532, 344, 622), 110),
        ((382, 532, 472, 622), 230),
        ((510, 532, 600, 622), 230),
        ((638, 532, 728, 622), 110),
        ((254, 650, 344, 740), 230),
        ((382, 650, 472, 740), 110),
        ((510, 650, 600, 740), 230),
    ]:
        draw.rounded_rectangle(rect, radius=16, fill=rgba(color_hex, alpha))

    draw_round_line(draw, (552, 846, 742, 656), main, 54)
    draw_round_line(draw, (724, 674, 786, 612), main, 18)
    draw.polygon(star_points(762, 626, 86, 32, 4), fill=main)
    draw.polygon(star_points(850, 590, 34, 13, 4), fill=mid)
    draw.polygon(star_points(852, 700, 30, 12, 4), fill=mid)
    draw.polygon(star_points(768, 754, 32, 12, 4), fill=mid)
    return img


def save_png(image: Image.Image, path: Path) -> None:
    image.save(path, optimize=True)


def main() -> None:
    if not MASTER.exists():
        raise SystemExit(f"Missing master icon: {MASTER}")

    OUT.mkdir(parents=True, exist_ok=True)
    SOURCE_SVG.write_text(SOURCE_SVG_TEXT, encoding="utf-8")

    master = Image.open(MASTER).convert("RGBA")
    for size in (480, 128):
        save_png(master.resize((size, size), Image.Resampling.LANCZOS), OUT / f"icon-{size}.png")

    save_png(render_small_icon(32), OUT / "icon-32.png")
    save_png(render_16_icon(), OUT / "icon-16.png")
    save_png(render_mono("#ffffff"), OUT / "icon-mono-dark.png")
    save_png(render_mono("#3c4043"), OUT / "icon-mono-light.png")

    for path in [
        MASTER,
        OUT / "icon-480.png",
        OUT / "icon-128.png",
        OUT / "icon-32.png",
        OUT / "icon-16.png",
        OUT / "icon-mono-dark.png",
        OUT / "icon-mono-light.png",
        SOURCE_SVG,
    ]:
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate the apple-touch-icon PNGs in frontend/public/icons/.

Pure-stdlib renderer (no Pillow): draws the site's Enderman mascot head —
dark gradient block with glowing magenta eyes on the page background colour —
with a classic football in front of it, and writes one PNG per requested
size. Run from the repo root:

    python3 scripts/generate_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

SIZES = [180, 152, 120]
OUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "icons"

BG = (0x07, 0x09, 0x1A)          # --bg (dark)
HEAD_LIGHT = (0x1E, 0x1E, 0x1E)  # .ender-head gradient start
HEAD_DARK = (0x0C, 0x0C, 0x0C)   # .ender-head gradient end
EYE = (0xCC, 0x00, 0xEE)         # .ender-eye

# Geometry in unit space, derived from the 11px CSS head:
# head block 0.18..0.82, eyes 2/11 wide, 4/11 tall, inset 1/11, top 3/11.
HEAD_X0, HEAD_X1 = 0.18, 0.82
HEAD_Y0, HEAD_Y1 = 0.18, 0.82
HEAD_W = HEAD_X1 - HEAD_X0
HEAD_RADIUS = 2 / 11 * HEAD_W * 0.6
EYE_W = 2 / 11 * HEAD_W
EYE_H = 4 / 11 * HEAD_W
EYE_INSET = 1 / 11 * HEAD_W
EYE_Y0 = HEAD_Y0 + 3 / 11 * HEAD_W
EYES = [
    (HEAD_X0 + EYE_INSET, EYE_Y0, HEAD_X0 + EYE_INSET + EYE_W, EYE_Y0 + EYE_H),
    (HEAD_X1 - EYE_INSET - EYE_W, EYE_Y0, HEAD_X1 - EYE_INSET, EYE_Y0 + EYE_H),
]

# Pixel-art football overlapping the lower right of the head: an 11x11
# sprite of hard square cells (Minecraft-style — blocky, flat colours, no
# round silhouette). W = white, S = shaded white, B = black patch.
BALL_CX, BALL_CY, BALL_R = 0.62, 0.76, 0.19
BALL_SPRITE = [
    "...WWWWW...",
    "..WWBBBWW..",
    ".WWWBBBWWW.",
    "WWWWWWWWWWW",
    "WWWWBBBWWWW",
    "WWWBBBBBWWW",
    "WBBWBBBWBBW",
    "WBBWWWWWBBW",
    ".WBWSSSWBW.",
    "..WSSSSSW..",
    "...WSSSW...",
]
BALL_COLORS = {
    "W": (0xF2, 0xF4, 0xF6),
    "S": (0xC6, 0xCE, 0xDA),
    "B": (0x10, 0x12, 0x18),
}


def in_rounded_rect(u, v, x0, y0, x1, y1, r):
    if not (x0 <= u <= x1 and y0 <= v <= y1):
        return False
    dx = max(x0 + r - u, u - (x1 - r), 0.0)
    dy = max(y0 + r - v, v - (y1 - r), 0.0)
    return dx * dx + dy * dy <= r * r


def dist_to_rect(u, v, x0, y0, x1, y1):
    dx = max(x0 - u, u - x1, 0.0)
    dy = max(y0 - v, v - y1, 0.0)
    return math.hypot(dx, dy)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def ball_sample(u, v):
    n = len(BALL_SPRITE)
    cell = 2 * BALL_R / n
    col = math.floor((u - (BALL_CX - BALL_R)) / cell)
    row = math.floor((v - (BALL_CY - BALL_R)) / cell)
    if 0 <= row < n and 0 <= col < n:
        return BALL_COLORS.get(BALL_SPRITE[row][col])
    return None


def sample(u, v):
    if in_rounded_rect(u, v, HEAD_X0, HEAD_Y0, HEAD_X1, HEAD_Y1, HEAD_RADIUS):
        t = ((u - HEAD_X0) + (v - HEAD_Y0)) / (2 * HEAD_W)
        col = lerp(HEAD_LIGHT, HEAD_DARK, t)
    else:
        col = BG

    ball = ball_sample(u, v)
    if ball is not None:
        return ball

    d = min(dist_to_rect(u, v, *eye) for eye in EYES)
    if d == 0.0:
        return EYE
    glow = 0.55 * math.exp(-((d / 0.045) ** 2)) + 0.20 * math.exp(-((d / 0.13) ** 2))
    return lerp(col, EYE, glow)


def render(size, supersample=4):
    rows = []
    step = 1.0 / (size * supersample)
    for py in range(size):
        row = bytearray(b"\x00")  # PNG filter byte: None
        for px in range(size):
            r = g = b = 0.0
            for sy in range(supersample):
                v = (py * supersample + sy + 0.5) * step
                for sx in range(supersample):
                    u = (px * supersample + sx + 0.5) * step
                    c = sample(u, v)
                    r += c[0]
                    g += c[1]
                    b += c[2]
            n = supersample * supersample
            row += bytes((round(r / n), round(g / n), round(b / n)))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        out = OUT_DIR / f"apple-touch-icon-{size}x{size}.png"
        write_png(out, size, render(size))
        print(f"wrote {out} ({out.stat().st_size} bytes)")

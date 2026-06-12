#!/usr/bin/env python3
"""Generate the apple-touch-icon PNGs in frontend/public/icons/.

Pure-stdlib renderer (no Pillow): draws a flat, modern WM-2026 icon —
a white football with pentagon panels on a pitch-green gradient, with a
"2026" wordmark below — and writes one PNG per requested size. Run from
the repo root:

    python3 scripts/generate_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

SIZES = [180, 152, 120]
OUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "icons"

BG_TOP = (0x22, 0xD3, 0xEE)      # cyan, light (top left)
BG_BOTTOM = (0x06, 0x7A, 0x8C)   # deep cyan/teal (bottom right)
SHADOW = (0x03, 0x36, 0x3E)
BALL_TOP = (0xEA, 0xFB, 0xFE)
BALL_BOTTOM = (0xC7, 0xEC, 0xF2)
PANEL = (0x0E, 0x4E, 0x59)       # panels in deep cyan (monochrome look)
TEXT = (0xFF, 0xFF, 0xFF)

# Ball: central pentagon (one vertex up) + five rim panels beyond its edges.
BALL_CX, BALL_CY, BALL_R = 0.5, 0.40, 0.255
PENT_SECTOR = 2 * math.pi / 5
PENTAGONS = [(BALL_CX, BALL_CY, 0.40 * BALL_R, -math.pi / 2)] + [
    (
        BALL_CX + 0.98 * BALL_R * math.cos(a),
        BALL_CY + 0.98 * BALL_R * math.sin(a),
        0.34 * BALL_R,
        a + math.pi,
    )
    for a in (-math.pi / 2 + PENT_SECTOR / 2 + k * PENT_SECTOR for k in range(5))
]


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def in_pentagon(u, v, cx, cy, radius, rot):
    dx, dy = u - cx, v - cy
    d = math.hypot(dx, dy)
    if d > radius:
        return False
    apothem = radius * math.cos(math.pi / 5)
    theta = (math.atan2(dy, dx) - rot) % PENT_SECTOR
    return d <= apothem / math.cos(theta - PENT_SECTOR / 2)


# ── "2026" wordmark ──────────────────────────────────────────────────
# Digits are stroked polylines in a local 1x1 box (y down), rendered with
# round caps/joins via distance-to-segment.

def _arc(cx, cy, r, a0, a1, n=28):
    return [
        (cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n))
        for i in range(n + 1)
    ]


def _bezier(p0, p1, p2, n=20):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        pts.append(
            (
                mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
                mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
            )
        )
    return pts


def _ellipse(cx, cy, rx, ry, n=40):
    return [
        (cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n))
        for i in range(n + 1)
    ]


DIGITS = {
    "2": [
        _arc(0.5, 0.34, 0.34, math.pi, 2 * math.pi + math.radians(30))
        + [(0.14, 0.98), (0.86, 0.98)]
    ],
    "0": [_ellipse(0.5, 0.5, 0.34, 0.47)],
    "6": [
        _ellipse(0.5, 0.66, 0.30, 0.30),
        _bezier((0.71, 0.03), (0.32, 0.18), (0.215, 0.58)),
    ],
}

TEXT_STR = "2026"
GLYPH_SCALE = 0.125     # glyph box height in icon units
TEXT_ADVANCE = 0.120
TEXT_Y = 0.745
STROKE = 0.0165         # stroke radius

TEXT_X0 = (1 - (TEXT_ADVANCE * (len(TEXT_STR) - 1) + 0.72 * GLYPH_SCALE + 2 * STROKE)) / 2


def _build_strokes():
    strokes = []
    for i, ch in enumerate(TEXT_STR):
        ox = TEXT_X0 + i * TEXT_ADVANCE
        for poly in DIGITS[ch]:
            pts = [(ox + x * GLYPH_SCALE, TEXT_Y + y * GLYPH_SCALE) for x, y in poly]
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            bbox = (min(xs) - STROKE, min(ys) - STROKE, max(xs) + STROKE, max(ys) + STROKE)
            strokes.append((pts, bbox))
    return strokes


STROKES = _build_strokes()


def _seg_d2(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    ex, ey = ax + t * dx - px, ay + t * dy - py
    return ex * ex + ey * ey


def text_hit(u, v):
    r2 = STROKE * STROKE
    for pts, (x0, y0, x1, y1) in STROKES:
        if not (x0 <= u <= x1 and y0 <= v <= y1):
            continue
        for i in range(len(pts) - 1):
            if _seg_d2(u, v, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= r2:
                return True
    return False


# ── Scene ────────────────────────────────────────────────────────────

def sample(u, v):
    col = lerp(BG_TOP, BG_BOTTOM, (u + v) / 2)

    # soft contact shadow under the ball
    d = math.hypot((u - BALL_CX) / 0.21, (v - 0.668) / 0.055)
    if d < 3.0:
        col = lerp(col, SHADOW, 0.40 * math.exp(-d * d))

    if math.hypot(u - BALL_CX, v - BALL_CY) <= BALL_R:
        ty = (v - (BALL_CY - BALL_R)) / (2 * BALL_R)
        col = lerp(BALL_TOP, BALL_BOTTOM, ty)
        if any(in_pentagon(u, v, *p) for p in PENTAGONS):
            col = PANEL
        return col

    if text_hit(u, v):
        return TEXT
    return col


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

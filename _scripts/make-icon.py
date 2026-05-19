"""Generate FAMILY MAP app icon.

A warm cream background with two overlapping teardrop pins in the app's
accent + sage colors, suggesting a couple/family on a map. Saved as
icon.png (apple-touch-icon, manifest) at multiple sizes.
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import math

BG          = (244, 241, 235, 255)  # cream
TERRACOTTA  = (182, 118, 89, 255)
SAGE        = (122, 145, 102, 255)
WHITE       = (255, 255, 255, 255)


def draw_pin(canvas, cx, cy, body_r, color):
    """Draw a teardrop pin with white outline and small white center dot.

    The pin is composed of a circle (body) plus an isoceles triangle (tail)
    that points downward. The tip is at (cx, cy + body_r * 2.4).
    """
    d = ImageDraw.Draw(canvas)

    border = max(8, body_r // 9)
    tip_y  = cy + int(body_r * 2.4)

    # White stroke (drawn slightly bigger; then color fill on top)
    d.ellipse((cx - body_r - border, cy - body_r - border,
               cx + body_r + border, cy + body_r + border), fill=WHITE)
    # Stroke triangle (slightly wider/lower)
    half = body_r // 2
    d.polygon([
        (cx - half - border, cy + half),
        (cx + half + border, cy + half),
        (cx,                 tip_y + border),
    ], fill=WHITE)

    # Colored fills
    d.ellipse((cx - body_r, cy - body_r, cx + body_r, cy + body_r), fill=color)
    d.polygon([
        (cx - half, cy + half),
        (cx + half, cy + half),
        (cx,        tip_y),
    ], fill=color)

    # Inner small white dot
    inner_r = max(10, body_r // 4)
    d.ellipse((cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r), fill=WHITE)


def make_icon(size=1024):
    img = Image.new('RGBA', (size, size), BG)

    # Soft shadow underneath both pins
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    cx = size // 2
    sd.ellipse((cx - int(size * 0.35),
                int(size * 0.82),
                cx + int(size * 0.35),
                int(size * 0.92)), fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(size * 0.04)))
    img = Image.alpha_composite(img, shadow)

    # Two overlapping pins — sage behind, terracotta in front (slightly larger)
    pins = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    back_cx, back_cy = int(size * 0.62), int(size * 0.42)
    back_r  = int(size * 0.16)
    draw_pin(pins, back_cx, back_cy, back_r, SAGE)

    front_cx, front_cy = int(size * 0.42), int(size * 0.39)
    front_r = int(size * 0.18)
    draw_pin(pins, front_cx, front_cy, front_r, TERRACOTTA)

    img = Image.alpha_composite(img, pins)
    return img


def main():
    repo = Path(__file__).resolve().parents[1]
    base = make_icon(1024)
    # Apple touch icon and root reference
    base.resize((180, 180), Image.LANCZOS).save(repo / 'icon.png', 'PNG')
    # Larger source kept for manifest sizes
    base.resize((192, 192), Image.LANCZOS).save(repo / 'icon-192.png', 'PNG')
    base.resize((512, 512), Image.LANCZOS).save(repo / 'icon-512.png', 'PNG')
    base.save(repo / 'icon-source.png', 'PNG')
    print('icons written:', sorted(p.name for p in repo.glob('icon*.png')))


if __name__ == '__main__':
    main()

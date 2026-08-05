"""Generate FAMILY MAP app icon.

A warm cream background with two overlapping teardrop pins, suggesting a
couple/family on a map. Saved as icon.png (apple-touch-icon, manifest) at
multiple sizes.

2026-08-05: the icon was re-saturated and flattened. The original muted
Nordic pair (terracotta #b67659 S39 + sage #7a9166 S17) read as washed out
next to apps like TimeTree on the home screen, and the pins sat on a soft
cast shadow. Now:
  - front pin  #b67659 S39 -> #d56a39 S65 (same hue, just no longer dusty)
  - back pin   #7a9166      -> #28a269, the emerald the app itself now uses
                              for 訪問済み, so icon and app agree
  - the cast shadow is gone entirely
The cream background is deliberately kept — it is the app's identity and the
white pin outlines need a non-white ground to read against.
"""
from PIL import Image, ImageDraw
from pathlib import Path

BG          = (244, 241, 235, 255)  # cream
TERRACOTTA  = (213, 106, 57, 255)   # #d56a39 — saturated accent
EMERALD     = (40, 162, 105, 255)   # #28a269 — matches --visited in index.html
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

    # 2026-08-05: the blurred ellipse that used to sit under both pins is
    # gone by request — flat icon, no cast shadow.

    # Two overlapping pins — emerald behind, terracotta in front (larger)
    pins = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    back_cx, back_cy = int(size * 0.62), int(size * 0.42)
    back_r  = int(size * 0.16)
    draw_pin(pins, back_cx, back_cy, back_r, EMERALD)

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

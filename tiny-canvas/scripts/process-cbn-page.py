#!/usr/bin/env python3
"""
process-cbn-page.py — build a color-by-number metadata JSON from a
line-art PNG (alpha ink, same shape as an assets/coloring-pages/*.png)
and a fully-colored REFERENCE PNG at matching dimensions.

Detects every fillable region in the line-art (connected components
of non-boundary pixels, same rule as game.js's fill mask), samples
the reference at each region's centroid, snaps the sampled color to
the nearest entry in a target palette, and prints a JSON blob you
can drop into templates.js as the page's `cbn` field.

USAGE
  python3 scripts/process-cbn-page.py \
      <line_art.png> <reference.png> \
      [--palette "#hex,#hex,..."] \
      [--min-area 400] [--out cbn-sun.json]

If --palette is omitted the script picks a compact default from the
Tiny Canvas COLOR_GROUPS.rainbow set (6 colors).

The emitted JSON has the shape:

  {
    "palette": ["#hex", "#hex", ...],   # 1-indexed at runtime
    "regions": [{"cx": 0.32, "cy": 0.61, "ci": 2}, ...]
  }

To wire it up in templates.js:

  {
    id: "cbn-<something>",
    name: "SUNNY DAY 1-2-3",
    image: "assets/coloring-pages/free/sun.png",
    cbn: {
      palette: [...],
      regions: [...]      // paste from the JSON
    }
  }

Note the runtime supports EITHER an `assign` function (zone-based
rules) OR an explicit `regions` array. This script emits the latter
so the coloring is a faithful sampling of the reference; the
function form is easier to hand-author for very simple pages (see
the CBN DEMO in templates.js).

Requires Pillow + numpy — same deps as process-coloring-pages.py.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError as e:  # pragma: no cover
    sys.exit(
        "Missing dependency: " + str(e) + "\n"
        "Install with: pip install pillow numpy"
    )


# Same alpha threshold the runtime fill mask uses (FILL_BOUNDARY_ALPHA
# = 96 in game.js). Anything at/above this reads as "ink" and blocks
# the flood.
INK_ALPHA = 96

# Minimum region area in device pixels — matches CBN_MIN_REGION_PX
# on the runtime side. Regions smaller than this are ignored (they're
# specks between antialiased strokes, not colourable shapes).
DEFAULT_MIN_AREA = 400

# Default 6-color CBN palette. Picked to cover the common
# scene-coloring vocabulary without overwhelming a small kid.
DEFAULT_PALETTE = [
    "#7ecfff",   # 1 sky blue
    "#ff8b3d",   # 2 warm orange
    "#f7d94c",   # 3 sun yellow
    "#8ac36b",   # 4 grass green
    "#ff8fb0",   # 5 rose
    "#a67849",   # 6 warm brown
]


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def build_mask(line_art_path: Path) -> np.ndarray:
    """Return a HxW uint8 array: 1 = ink/boundary, 0 = fillable."""
    im = Image.open(line_art_path).convert("RGBA")
    a = np.array(im.split()[-1])  # alpha channel
    return (a >= INK_ALPHA).astype(np.uint8)


def label_regions(mask: np.ndarray, min_area: int) -> list[dict]:
    """
    Iterative scanline flood fill enumerating every connected component
    of non-boundary pixels. Returns [{cx, cy, area}] in image pixel
    coords, largest-first. Reimplemented instead of scipy.label so this
    script has no extra dependency beyond the ones already used.
    """
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=np.uint8)
    regions: list[dict] = []
    for y in range(h):
        row_seen = seen[y]
        row_mask = mask[y]
        for x in range(w):
            if row_seen[x] or row_mask[x]:
                continue
            # BFS on this component.
            stack = [(x, y)]
            area = 0
            sx = 0
            sy = 0
            while stack:
                px, py = stack.pop()
                if seen[py, px] or mask[py, px]:
                    continue
                # Scan left.
                lx = px
                while lx > 0 and not seen[py, lx - 1] and not mask[py, lx - 1]:
                    lx -= 1
                span_up = False
                span_dn = False
                cx = lx
                while cx < w and not seen[py, cx] and not mask[py, cx]:
                    seen[py, cx] = 1
                    area += 1
                    sx += cx
                    sy += py
                    if py > 0:
                        up = (not seen[py - 1, cx]) and (not mask[py - 1, cx])
                        if up and not span_up:
                            stack.append((cx, py - 1))
                            span_up = True
                        elif not up:
                            span_up = False
                    if py < h - 1:
                        dn = (not seen[py + 1, cx]) and (not mask[py + 1, cx])
                        if dn and not span_dn:
                            stack.append((cx, py + 1))
                            span_dn = True
                        elif not dn:
                            span_dn = False
                    cx += 1
            if area < min_area:
                continue
            regions.append({
                "cx": sx / area,
                "cy": sy / area,
                "area": area,
            })
    regions.sort(key=lambda r: -r["area"])
    return regions


def sample_reference(ref: np.ndarray, cx: float, cy: float,
                     radius: int = 4) -> tuple[int, int, int]:
    """
    Median color in a small disk around (cx, cy). The median (not
    mean) protects against a centroid that falls on a stray dark
    stroke or an antialiased edge.
    """
    h, w, _ = ref.shape
    x0 = max(0, int(cx) - radius)
    x1 = min(w, int(cx) + radius + 1)
    y0 = max(0, int(cy) - radius)
    y1 = min(h, int(cy) + radius + 1)
    patch = ref[y0:y1, x0:x1, :3].reshape(-1, 3)
    med = np.median(patch, axis=0).astype(int)
    return (int(med[0]), int(med[1]), int(med[2]))


def snap_to_palette(rgb: tuple[int, int, int],
                    palette: list[tuple[int, int, int]]) -> int:
    """Nearest palette index by squared Euclidean distance. 1-based."""
    r, g, b = rgb
    best = 0
    best_d = float("inf")
    for i, (pr, pg, pb) in enumerate(palette):
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d < best_d:
            best_d = d
            best = i
    return best + 1


def parse_palette(spec: str | None) -> list[str]:
    if not spec:
        return DEFAULT_PALETTE[:]
    return [c.strip() for c in spec.split(",") if c.strip()]


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Emit a color-by-number metadata JSON from a "
                    "line-art PNG + a colored reference PNG."
    )
    ap.add_argument("line_art", type=Path,
                    help="Line-art PNG (alpha ink, same format as "
                         "assets/coloring-pages/*.png).")
    ap.add_argument("reference", type=Path,
                    help="Fully-colored reference PNG at matching "
                         "dimensions.")
    ap.add_argument("--palette",
                    help="Comma-separated hex list. Defaults to a "
                         "6-color CBN palette.")
    ap.add_argument("--min-area", type=int, default=DEFAULT_MIN_AREA,
                    help="Ignore regions smaller than N device pixels "
                         "(default %(default)s).")
    ap.add_argument("--out", type=Path,
                    help="Write JSON to this path (default: stdout).")
    args = ap.parse_args()

    line_art_path = args.line_art
    ref_path = args.reference
    if not line_art_path.is_file():
        sys.exit("line-art not found: " + str(line_art_path))
    if not ref_path.is_file():
        sys.exit("reference not found: " + str(ref_path))

    mask = build_mask(line_art_path)
    ref_img = Image.open(ref_path).convert("RGB")
    if ref_img.size != (mask.shape[1], mask.shape[0]):
        # Nearest-neighbor rescale so the sampled centroid still lands
        # on the intended color. Bicubic would smear across boundaries.
        ref_img = ref_img.resize(
            (mask.shape[1], mask.shape[0]), Image.NEAREST
        )
    ref = np.array(ref_img)

    palette_hex = parse_palette(args.palette)
    palette_rgb = [hex_to_rgb(h) for h in palette_hex]

    regions_raw = label_regions(mask, args.min_area)
    if not regions_raw:
        sys.exit("no regions detected — check the line-art alpha, or "
                 "lower --min-area (current: {}).".format(args.min_area))

    h, w = mask.shape
    regions_out = []
    for r in regions_raw:
        sampled = sample_reference(ref, r["cx"], r["cy"])
        ci = snap_to_palette(sampled, palette_rgb)
        regions_out.append({
            "cx": round(r["cx"] / w, 4),
            "cy": round(r["cy"] / h, 4),
            "ci": ci,
        })

    payload = {"palette": palette_hex, "regions": regions_out}

    text = json.dumps(payload, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
        sys.stderr.write("wrote {} regions to {}\n".format(
            len(regions_out), args.out))
    else:
        print(text)
        sys.stderr.write("({} regions)\n".format(len(regions_out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

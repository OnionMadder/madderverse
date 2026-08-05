"""Tiny Canvas coloring pages: art-src originals -> shipped transparent-ink PNGs.

Run from tiny-canvas/:  python scripts/process-coloring-pages.py

Input : art-src/coloring-pages/*.png  (line art on white paper, ~2816x1536;
        untracked working art — the AI-generated/scanned originals)
Output: assets/coloring-pages/*.png   (1800px wide, RGBA, lines baked as
        alpha, ink #1c2226 = --line-ink; these are what ships)

Pipeline per page:
  1. grayscale, LANCZOS downscale to TARGET_W wide
  2. luminance -> alpha LUT: lum >= HI -> 0 (paper + paper-grain texture),
     lum <= LO -> 255 (line core), linear ramp between (antialiased edges)
  3. despeckle: drop ink blobs (alpha >= 96 connected components) smaller
     than MIN_INK_AREA px — kills grain flecks that would render as gray
     dots on the transparent overlay
  4. save as a PALETTE PNG: the ink RGB is constant and only alpha
     varies, so the image is really an 8-bit alpha map. A P-mode PNG
     with a 256-entry palette (every entry the ink color) + a tRNS
     alpha ramp encodes 1 byte/px instead of 4 — ~45% smaller than the
     RGBA encode and decodes bit-for-bit identical (verified against
     the RGBA original when this was adopted 2026-08-05). Lossless
     WebP was measured too (~5% smaller again) and rejected: it does
     not round-trip RGB under fully-transparent pixels and changes the
     file extension for a marginal win.

Then an audit pass per page (the same thing game.js's fill tool sees):
threshold alpha >= 96 (FILL_BOUNDARY_ALPHA), treat the image perimeter as
boundary (buildFillMask marks it), count connected fillable regions. Run
at native width and at 900px to catch gaps that only open when the art is
drawn small. A page with suspiciously FEW regions, or whose largest region
spans an implausible share of the open area, has an ink gap somewhere —
find it in the source art before shipping.

Requires Pillow + numpy. No scipy (hand-rolled BFS labeling).
"""
import os
from collections import deque
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, "art-src", "coloring-pages")
OUT  = os.path.join(ROOT, "assets", "coloring-pages")

TARGET_W     = 1800
LO, HI       = 100, 225
INK          = (0x1c, 0x22, 0x26)   # --line-ink
MIN_INK_AREA = 30       # px at TARGET_W scale
MASK_THRESH  = 96       # game.js FILL_BOUNDARY_ALPHA
MIN_REGION   = 64       # ignore sub-64px cells in the audit count

LUT = np.zeros(256, dtype=np.uint8)
for lum in range(256):
    if lum >= HI:   a = 0
    elif lum <= LO: a = 255
    else:           a = round(255 * (HI - lum) / (HI - LO))
    LUT[lum] = a


def label_components(binary):
    """4-connected component labeling via BFS. Returns (labels, sizes)."""
    h, w = binary.shape
    labels = np.zeros((h, w), dtype=np.int32)
    sizes = []
    nxt = 0
    flat = binary.ravel()
    lab = labels.ravel()
    for start in np.flatnonzero(flat):
        if lab[start]:
            continue
        nxt += 1
        q = deque([start])
        lab[start] = nxt
        n = 0
        while q:
            i = q.popleft()
            n += 1
            y, x = divmod(i, w)
            if x > 0 and flat[i-1] and not lab[i-1]:   lab[i-1] = nxt; q.append(i-1)
            if x < w-1 and flat[i+1] and not lab[i+1]: lab[i+1] = nxt; q.append(i+1)
            if y > 0 and flat[i-w] and not lab[i-w]:   lab[i-w] = nxt; q.append(i-w)
            if y < h-1 and flat[i+w] and not lab[i+w]: lab[i+w] = nxt; q.append(i+w)
        sizes.append(n)
    return labels, sizes


def audit(alpha, tag):
    mask = alpha >= MASK_THRESH
    mask[0, :] = True; mask[-1, :] = True; mask[:, 0] = True; mask[:, -1] = True
    open_px = ~mask
    _, sizes = label_components(open_px)
    sizes = np.array(sizes)
    big = sizes[sizes >= MIN_REGION]
    total = open_px.sum()
    return "%s: %d regions (>=%dpx), largest %.1f%% of open area" % (
        tag, len(big), MIN_REGION, (100.0 * big.max() / total) if len(big) else 0)


def process(name):
    src = Image.open(os.path.join(SRC, name)).convert("L")
    w, h = src.size
    th = round(h * TARGET_W / w)
    small = src.resize((TARGET_W, th), Image.LANCZOS)
    alpha = LUT[np.asarray(small)]

    ink = alpha >= MASK_THRESH
    labels, sizes = label_components(ink)
    killed = 0
    if sizes:
        sizes_arr = np.array([0] + sizes)
        tiny = (sizes_arr[labels] > 0) & (sizes_arr[labels] < MIN_INK_AREA)
        killed = int(tiny.sum())
        alpha[tiny] = 0
        # faint isolated fuzz below the mask threshold cleans up too
        faint = (alpha > 0) & (alpha < 40) & ~ink
        alpha[faint] = np.where(alpha[faint] < 24, 0, alpha[faint])

    # palette PNG: pixel value = alpha, palette = 256 x ink RGB,
    # tRNS = identity alpha ramp (see the header note)
    pal_img = Image.fromarray(alpha, "P")
    pal_img.putpalette(list(INK) * 256)
    out_path = os.path.join(OUT, name)
    pal_img.save(out_path, "PNG", optimize=True,
                 transparency=bytes(range(256)))
    kb = os.path.getsize(out_path) / 1024

    a1 = audit(alpha, "@%d" % TARGET_W)
    w9 = 900
    h9 = round(th * w9 / TARGET_W)
    small9 = Image.fromarray(alpha, "L").resize((w9, h9), Image.LANCZOS)
    a2 = audit(np.asarray(small9), "@900")

    print("%-14s %4dx%-4d %7.0fKB  speckles:%-5d %s | %s" %
          (name, TARGET_W, th, kb, killed, a1, a2))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    names = sorted(f for f in os.listdir(SRC) if f.endswith(".png"))
    for n in names:
        process(n)
    print("done:", len(names), "pages")

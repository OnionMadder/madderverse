"""Generate tiny-canvas/cover.jpg (1280x720 hub card art) from a shipped page.

Run from tiny-canvas/:  python scripts/make-cover.py

The cover is not hand-painted: it renders one of the app's real coloring
pages (assets/coloring-pages/PAGE) half-colored, using the same region
model the FILL tool uses — threshold the line art's alpha at 96
(game.js FILL_BOUNDARY_ALPHA), treat the page edge as boundary, flood
connected regions — with colors from the app's RAINBOW palette. So the
cover literally shows what the product does and stays regenerable: if
the pages or the fill mechanics change, re-run this.

Regions whose centroid sits left of the SPLIT line get colored (only
those big enough that a kid would plausibly fill them); the right side
stays fresh line art. Deterministic (seeded) so re-runs are stable.
"""
import os, random
from collections import deque
from PIL import Image
import numpy as np

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE  = "cat.png"
OUT   = os.path.join(ROOT, "cover.jpg")
PAPER = (0xfb, 0xfa, 0xf6)          # --paper
SPLIT = 0.52                        # colored fraction, left side
MIN_FILL_AREA = 300                 # px — tiny slivers stay uncolored
MASK_THRESH   = 96                  # game.js FILL_BOUNDARY_ALPHA
SEED  = 7

# app RAINBOW palette (game.js COLOR_GROUPS) minus the ink-black entry
PALETTE = ["#ff2e88", "#ff4d4d", "#ff7a1f", "#ff9d42", "#ffd23f",
           "#9be15d", "#1ac88a", "#00ffcc", "#4fc3f7", "#5b6cff",
           "#a86bff"]
PALETTE = [tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) for h in PALETTE]

art = Image.open(os.path.join(ROOT, "assets", "coloring-pages", PAGE)).convert("RGBA")
a = np.asarray(art)
H, W = a.shape[:2]
alpha = a[..., 3]

mask = alpha >= MASK_THRESH
mask[0, :] = True; mask[-1, :] = True; mask[:, 0] = True; mask[:, -1] = True

# label fillable regions (4-connected BFS, same as the audit)
labels = np.zeros((H, W), dtype=np.int32)
flat, lab = (~mask).ravel(), labels.ravel()
regions = []
nxt = 0
for start in np.flatnonzero(flat):
    if lab[start]:
        continue
    nxt += 1
    q = deque([start]); lab[start] = nxt
    px_idx = []
    while q:
        i = q.popleft(); px_idx.append(i)
        y, x = divmod(i, W)
        if x > 0 and flat[i-1] and not lab[i-1]:   lab[i-1] = nxt; q.append(i-1)
        if x < W-1 and flat[i+1] and not lab[i+1]: lab[i+1] = nxt; q.append(i+1)
        if y > 0 and flat[i-W] and not lab[i-W]:   lab[i-W] = nxt; q.append(i-W)
        if y < H-1 and flat[i+W] and not lab[i+W]: lab[i+W] = nxt; q.append(i+W)
    regions.append(np.array(px_idx))

rng = random.Random(SEED)
canvas = np.empty((H, W, 3), dtype=np.uint8)
canvas[:] = PAPER
colored = 0
for px_idx in regions:
    if len(px_idx) < MIN_FILL_AREA:
        continue
    cx = (px_idx % W).mean()
    if cx > SPLIT * W:
        continue
    canvas.reshape(-1, 3)[px_idx] = rng.choice(PALETTE)
    colored += 1

# composite the ink on top (source-over of the alpha'd line art)
af = (alpha / 255.0)[..., None]
canvas = (a[..., :3] * af + canvas * (1 - af)).astype(np.uint8)

# fill the 1280x720 frame: scale by height, center-crop the width
img = Image.fromarray(canvas, "RGB")
scale = 720 / H
img = img.resize((round(W * scale), 720), Image.LANCZOS)
left = (img.width - 1280) // 2
img = img.crop((left, 0, left + 1280, 720))
img.save(OUT, quality=88, progressive=True)
print("cover.jpg: %dx%d from %s, %d regions colored, %.0fKB" %
      (img.width, img.height, PAGE, colored, os.path.getsize(OUT) / 1024))

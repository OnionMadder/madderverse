"""Cut Onion's body-part drawings into transparent ink PNGs for the paper doll.

    python groodle/tools/cut_art.py

Reads the same three line-art PNGs as trace_rig.py (groodle/art-src/body/) and
writes groodle/assets/doll/{torso,arm,leg}.png -- RGBA, where alpha is the
DARKNESS of her line and everything else is transparent.

Why images instead of traced vectors:

The rig used to re-draw her outline as ~130-point Bezier rings and then
reconstruct an inner outline with an SVG feMorphology erode. Three separate
problems came from that and all of them disappear here:

  * The Bezier approximation was not her line. Her drawing has weight and
    wobble; the trace flattened it.
  * Assembling five overlapping parts into ONE silhouette meant the union had
    seams, which needed a hand-placed hip gusset to patch.
  * The erode filter produced resolution-dependent gray squares at the hip
    (clean at 400px wide, visible at 620px, worse at 869px) because
    near-coincident part edges leave thin sub-1-alpha bands that the erode
    turns into visible ink.

Overlapping paper has none of those: each part carries its own drawn outline,
parts simply stack, and where they overlap the lines cross the way real cut
paper does.

Alpha is taken from the ink darkness, masked to the part's own solid region
(interior + stroke, via the border flood fill). That mask is what drops the
background grid and the generator watermark, so the source art does NOT need
cleaning up first -- same property trace_rig.py relies on. The face circles
and smile float free inside the head, so they survive because they are in the
flood-filled INTERIOR even though they are separate components.
"""
import json, math, os, sys
import numpy as np, cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(GAME, 'art-src', 'body')
DEST = os.path.join(GAME, 'assets', 'doll')
FILES = {'torso': 'torso.png', 'arm': 'arm.png', 'leg': 'leg.png'}

INK_THRESHOLD = 120
INK_RGB = (26, 15, 51)        # #1a0f33, the game's ink color
PAD = 3                       # px of transparent margin around the crop

# Must match tools/trace_rig.py -- the pin and scale define where the art sits.
HEAD_D, ARM_LEN, LEG_LEN = 116.0, 239.8, 276.9


def solid_of(gray):
    ink = (gray < INK_THRESHOLD).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
    main = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    ff = main.copy()
    cv2.floodFill(ff, np.zeros((main.shape[0] + 2, main.shape[1] + 2), np.uint8), (0, 0), 1)
    s = ((ff == 0) | (main == 1)).astype(np.uint8)
    return cv2.morphologyEx(s, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))


def cut(name):
    g = np.array(Image.open(os.path.join(SRC, FILES[name])).convert('L'))
    solid = solid_of(g)
    ys, xs = np.nonzero(solid)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()

    if name == 'torso':
        widest = max((np.nonzero(solid[y])[0].max() - np.nonzero(solid[y])[0].min())
                     for y in range(solid.shape[0] // 3) if solid[y].any())
        s = HEAD_D / widest
        py = float(y0)
    else:
        s = (ARM_LEN if name == 'arm' else LEG_LEN) / (y1 - y0)
        py = y0 + (y1 - y0) * 0.055
    row = np.nonzero(solid[int(round(py))])[0]
    px = (row.min() + row.max()) / 2.0 if len(row) else (x0 + x1) / 2.0

    # alpha = how dark her line is, but only inside this part. Dilating the
    # solid mask by one pixel keeps the stroke's own outer antialiasing, which
    # is what stops the cut edge from stair-stepping.
    keep = cv2.dilate(solid, np.ones((3, 3), np.uint8))
    alpha = np.where(keep > 0, 255 - g, 0).astype(np.uint8)

    rgba = np.zeros((g.shape[0], g.shape[1], 4), np.uint8)
    rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2] = INK_RGB
    rgba[:, :, 3] = alpha
    img = Image.fromarray(rgba, 'RGBA')

    cx0, cy0 = max(0, x0 - PAD), max(0, y0 - PAD)
    cx1, cy1 = min(g.shape[1], x1 + 1 + PAD), min(g.shape[0], y1 + 1 + PAD)
    img = img.crop((cx0, cy0, cx1, cy1))

    # Placement, in PART-LOCAL units with the pin at (0,0) -- the same frame
    # trace_rig.py emits its rings in, so game.js can position both alike.
    return img, {
        'x': round((cx0 - px) * s, 2), 'y': round((cy0 - py) * s, 2),
        'w': round(img.width * s, 2), 'h': round(img.height * s, 2),
    }


def main():
    os.makedirs(DEST, exist_ok=True)
    art = {}
    for name in FILES:
        img, box = cut(name)
        out = os.path.join(DEST, name + '.png')
        img.save(out, optimize=True)
        art[name] = box
        sys.stderr.write('%-6s %4dx%-4d  %6.1f KB  box=%s\n' % (
            name, img.width, img.height, os.path.getsize(out) / 1024.0, box))
    sys.stdout.write('    const DOLL_ART = ' +
                     json.dumps(art, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    main()

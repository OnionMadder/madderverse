"""Trace Groodle's hand-drawn body parts into the paper-doll rig in game.js.

    python groodle/tools/trace_rig.py [folder of part PNGs] > rig_block.js

Defaults to groodle/art-src/body/ (torso.png, arm.png, leg.png), tracked so
the rig stays regenerable from a fresh clone.

Input is three line-art PNGs on a light background -- torso+head, one arm,
one leg -- drawn at any size, on any grid/watermark background. Output is the
`const RIG = {...};` block that game.js reads.

Why it works without you cleaning the images up first:

  * The figure's strokes are ~10x thicker than a background grid line, and
    the figure is a single connected component while grid lines and a
    generator watermark are separate small ones. Taking the largest
    component drops the background for free -- do NOT pre-erase it.
  * The face circles and the smile float free inside the head, so they are
    their OWN components. Interior linework is therefore extracted from the
    full ink mask (masked to the part's interior), not from the largest
    component, or the face silently disappears.

Only the arm and leg are traced once each; the opposite side is a mirror at
render time, so draw one of each.

THE FRAME CONSTRAINT -- read before changing any pose angle. His arms are
217 units long, against 150 of clearance to the frame edge and 186 of
headroom above the shoulder. A flat T-pose spans 534 units in a 400-wide
frame, so it only fits if the whole doll shrinks -- and the colourable area
shrinks with the square of that scale. Measured:

    pose set                     scale   head r   colourable area
    with a horizontal T-pose     0.757     43.9      57%
    steep arms-up instead        0.872     50.6      76%

We ship the second. `POSES` below is the source of truth for the angles; the
script re-solves the scale from whatever pose set it is given, so adding a
wider pose silently shrinks the doll. Check the printed scale after editing.
"""
import json, math, os, sys
import numpy as np, cv2
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'art-src', 'body')
FILES = {'torso': 'torso.png', 'arm': 'arm.png', 'leg': 'leg.png'}

INK_THRESHOLD = 120          # figure strokes are near 0; grid lines 150-230
HEAD_D, ARM_LEN, LEG_LEN = 116.0, 217.0, 210.0   # pre-fit units

# Joint angles per pose. Mirrored parts flip their own sign, so a pose says
# "raise the arm N degrees" once and each side resolves it.
POSES = {
    'standing': {},
    'cheer':    {'armL': 163, 'armR': 163},
    'star':     {'armL': 36,  'armR': 36, 'legL': 13, 'legR': 13},
    'groovy':   {'armL': 30,  'armR': -14, 'legL': -6, 'legR': 8},
    'tpose':    {'armL': 40,  'armR': 40},
    'wave':     {'armR': 166, 'armL': 8},
}

# Torso-local geometry. The torso's own origin is the top-centre of the head.
BC = -6.75                    # body centre sits left of the head-top centre
TX, TY = 200 - BC, 34.0
ANCHOR = {'armL': (BC - 50, 152), 'armR': (BC + 50, 152),
          'legL': (BC - 23, 284), 'legR': (BC + 23, 284)}
SRC_OF = {'armL': 'arm', 'armR': 'arm', 'legL': 'leg', 'legR': 'leg'}
MIRROR = {'armR', 'legR'}
SIGN   = {'armL': 1, 'armR': -1, 'legL': 1, 'legR': -1}
REST   = {'armL': 2, 'armR': -2, 'legL': 1, 'legR': -1}


def trace(name):
    """One part image -> {'solid': [ring...], 'ink': [ring...]}, pinned at (0,0)."""
    a = np.array(Image.open(os.path.join(SRC, FILES[name])).convert('L'))
    ink = (a < INK_THRESHOLD).astype(np.uint8)

    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    main = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)

    # Flood from the border: what the outside reaches is background, so what
    # it cannot reach is the part's interior.
    ff = main.copy()
    cv2.floodFill(ff, np.zeros((main.shape[0] + 2, main.shape[1] + 2), np.uint8), (0, 0), 1)
    solid = ((ff == 0) | (main == 1)).astype(np.uint8)
    solid = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    # Interior linework: all ink inside the part, minus a band along the outer
    # contour (an erosion alone cannot clear an 11px stroke without also
    # eating the toe and knuckle lines that sit near the edge).
    cs, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    band = np.zeros_like(solid)
    cv2.drawContours(band, cs, -1, 1, thickness=26)
    detail = (ink & cv2.erode(solid, np.ones((3, 3), np.uint8)) & (1 - band)).astype(np.uint8)

    ys, xs = np.nonzero(solid)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    if name == 'torso':
        widest = max((np.nonzero(solid[y])[0].max() - np.nonzero(solid[y])[0].min())
                     for y in range(solid.shape[0] // 3) if solid[y].any())
        s = HEAD_D / widest          # scale on the head: HATS anchors to it
    else:
        s = (ARM_LEN if name == 'arm' else LEG_LEN) / (y1 - y0)

    # Pin: centre of the part a little below its top edge -- where a brass
    # fastener sits on the rounded shoulder / hip end.
    py = y0 + (y1 - y0) * (0.0 if name == 'torso' else 0.055)
    row = np.nonzero(solid[int(round(py))])[0]
    px = (row.min() + row.max()) / 2 if len(row) else (x0 + x1) / 2

    def rings(mask, eps, min_area, external):
        mode = cv2.RETR_EXTERNAL if external else cv2.RETR_LIST
        cc, _ = cv2.findContours(mask, mode, cv2.CHAIN_APPROX_NONE)
        out = []
        for c in cc:
            if cv2.contourArea(c) < min_area:
                continue
            p = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
            if len(p) >= 3:
                out.append([((x - px) * s, (y - py) * s) for x, y in p])
        return out

    return {'solid': rings(solid, 1.6, 60, True),
            'ink':   rings(detail, 3.4, 150, False)}


def placed(parts, pose):
    """Every ring of one pose, in pre-fit assembled space."""
    out = []
    for k in ('legL', 'legR', 'armL', 'armR'):
        deg = REST[k] + SIGN[k] * pose.get(k, 0)
        # ANCHOR is torso-LOCAL, so the torso's own placement has to be added
        # before the limb is positioned -- forgetting it shifts every limb by
        # (TX, TY), which silently widens the bbox and shrinks the solved scale.
        ax, ay = ANCHOR[k]
        ax, ay = TX + ax, TY + ay
        t = math.radians(deg); c, s = math.cos(t), math.sin(t)
        for ring in parts[SRC_OF[k]]['solid']:
            out.append([(ax + (-x if k in MIRROR else x) * c - y * s,
                         ay + (-x if k in MIRROR else x) * s + y * c) for x, y in ring])
    for ring in parts['torso']['solid']:
        out.append([(TX + x, TY + y) for x, y in ring])
    return out


def main():
    parts = {n: trace(n) for n in FILES}

    # Solve one scale + offset for ALL poses, so he never changes size between
    # them, the widest pose still fits, and the lowest foot lands on the floor.
    pts = [p for name in POSES for ring in placed(parts, POSES[name]) for p in ring]
    x0, x1 = min(x for x, _ in pts), max(x for x, _ in pts)
    y0, y1 = min(y for _, y in pts), max(y for _, y in pts)
    K = min((400 - 16) / (x1 - x0), (570 - 14) / (y1 - y0), 1.0)
    OX, OY = 200 - K * (x0 + x1) / 2, 570 - K * y1

    def flat(rings):
        return [[round(v * K, 1) for xy in r for v in xy] for r in rings]

    rig = {
        'parts':   {n: {'solid': flat(parts[n]['solid']), 'ink': flat(parts[n]['ink'])}
                    for n in parts},
        'anchor':  {k: [round(OX + K * (TX + x), 1), round(OY + K * (TY + y), 1)]
                    for k, (x, y) in ANCHOR.items()},
        'torsoAt': [round(OX + K * TX, 1), round(OY + K * TY, 1)],
        'rest': REST, 'sign': SIGN, 'mirror': sorted(MIRROR), 'srcOf': SRC_OF,
        'poses': POSES,
    }
    sys.stdout.write('    const RIG = ' + json.dumps(rig, separators=(',', ':')) + ';\n')
    sys.stderr.write(
        "scale={:.4f}  head r={:.1f}  head top y={:.1f}  colourable area={:.0f}% of full\n"
        .format(K, 58 * K, OY + K * TY, K * K * 100))
    sys.stderr.write("If head r moved, retune BODY + HEAD_CROWN_Y + every HATS "
                     "anchor.y/scale in game.js -- they are tuned to it.\n")


if __name__ == '__main__':
    main()

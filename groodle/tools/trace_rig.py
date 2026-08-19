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
frame, so it only fits if the whole doll shrinks -- and the colorable area
shrinks with the square of that scale. Measured:

    pose set                     scale   head r   colorable area
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

# Fraction of each part's height whose interior ink is kept. The excluded
# slivers are CUT edges -- where the part was severed from the whole figure --
# not drawn lines. See the note in trace() for why only the hip needs this.
INK_TRIM = {'leg': (0.10, 1.0), 'torso': (0.0, 0.93)}

# Width of the band along a part's own outer contour whose ink is discarded.
# That contour is already drawn by the assembled silhouette's outline filter,
# so keeping it means two near-parallel lines a unit apart -- a smudged seam.
# Per part because the three drawings do not share a stroke weight. At the
# shared 26 both the leg's and the arm's own inner edges survived and doubled
# the outline; the arm's showed only on the RIGHT, because the torso is drawn
# ~7 units right of the body axis and so covers the left arm but not the right.
# The torso stays at 26: its collarbone and chest lines are genuine interior
# detail sitting close to its edge, and a wider band eats them.
CONTOUR_BAND = {'torso': 26, 'arm': 40, 'leg': 44}

# Ink shapes whose center falls below this fraction of a part's height are
# dropped outright. See the note in trace().
INK_DROP_BELOW = {'torso': 0.65}
# Limb lengths and joint anchors are FITTED, not guessed: tools/fit_standing.py
# rasterises the assembled standing doll against the original full-figure
# drawing and maximises IoU. Hand-guessed values scored 0.563; these score
# 0.977. The first guess had the legs 32% too short and their pins less than
# half far enough apart, which is exactly what read as "the legs look wrong".
HEAD_D, ARM_LEN, LEG_LEN = 116.0, 239.8, 276.9

# Joint angles per pose. Mirrored parts flip their own sign, so a pose says
# "raise the arm N degrees" once and each side resolves it.
POSES = {
    # Standing IS the original drawing -- fit_standing.py matches it at
    # IoU 0.977, so do not nudge these away from {} .
    'standing': {},
    # The rest stay inside the FREE budget: up to ~18 deg costs nothing,
    # because the frame already has room for it. Past that the whole doll
    # shrinks and takes the colorable area with it (see README).
    'star':     {'armL': 18, 'armR': 18, 'legL': 9, 'legR': 9},
    'cheer':    {'armL': 18, 'armR': 18, 'legL': 4, 'legR': 4},
    'groovy':   {'armL': 16, 'armR': -11, 'legL': -5, 'legR': 8},
    'tpose':    {'armL': 18, 'armR': 18},
    'wave':     {'armR': 18, 'armL': -6},
}

# How far the DANCE may swing a limb. This is folded into the scale solve
# below, so the doll is sized to hold its own dance without clipping.
DANCE_SWING = 18

# Torso-local geometry. The torso's own origin is the top-center of the head.
BC = -6.75                    # body center sits left of the head-top center
TX, TY = 200 - BC, 34.0
ANCHOR = {'armL': (BC - 63.9, 143.0), 'armR': (BC + 63.9, 143.0),
          'legL': (BC - 47.9, 270.9), 'legR': (BC + 47.9, 270.9)}
SRC_OF = {'armL': 'arm', 'armR': 'arm', 'legL': 'leg', 'legR': 'leg'}
MIRROR = {'armR', 'legR'}
SIGN   = {'armL': 1, 'armR': -1, 'legL': 1, 'legR': -1}
REST   = {'armL': 0.8, 'armR': -0.8, 'legL': 0.2, 'legR': -0.2}


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
    cv2.drawContours(band, cs, -1, 1, thickness=CONTOUR_BAND.get(name, 26))
    detail = (ink & cv2.erode(solid, np.ones((3, 3), np.uint8)) & (1 - band)).astype(np.uint8)

    ys, xs = np.nonzero(solid)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    if name == 'torso':
        widest = max((np.nonzero(solid[y])[0].max() - np.nonzero(solid[y])[0].min())
                     for y in range(solid.shape[0] // 3) if solid[y].any())
        s = HEAD_D / widest          # scale on the head: HATS anchors to it
    else:
        s = (ARM_LEN if name == 'arm' else LEG_LEN) / (y1 - y0)

    # Pin: center of the part a little below its top edge -- where a brass
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

    # Trim ink at the CUT edge, on the BITMAP before contouring -- a part's
    # interior ink is often one continuous ring spanning its whole length, so
    # dropping whole rings is a no-op.
    #
    # Where a part was severed from the figure the drawing carries an edge that
    # is not a line Onion drew, and after assembly it lands right on top of the
    # union outline: two near-parallel lines a unit apart, which reads as a
    # smudged seam. The shoulder never shows it because the arm's top is buried
    # ~175 units under the torso; the hip has only ~47 units of cover before the
    # torso tapers away, so both cut edges are exposed.
    lo, hi = INK_TRIM.get(name, (0.0, 1.0))
    if (lo, hi) != (0.0, 1.0):
        span = y1 - y0
        detail[:int(round(y0 + lo * span)), :] = 0
        detail[int(round(y0 + hi * span)):, :] = 0
    ink_rings = rings(detail, 3.4, 150, False)

    # Drop whole ink shapes that sit below a part's cutoff. The torso's pelvic
    # crease lines live here: they are real lines Onion drew, but in the
    # assembly the legs cover most of that area, so each survives only as an
    # isolated stub -- and her drawing is not quite symmetric, so one stub
    # showed and the other did not, which reads as a stray mark rather than
    # anatomy. Ring-level, because unlike the leg's single full-length contour
    # the torso's ink really is many separate shapes.
    cut = INK_DROP_BELOW.get(name)
    if cut is not None:
        span = y1 - y0
        keep = []
        for r in ink_rings:
            mid = sum(y for _, y in r) / len(r)          # part-local units
            if (mid / s + py - y0) / span <= cut:
                keep.append(r)
        ink_rings = keep
    return {'solid': rings(solid, 1.6, 60, True), 'ink': ink_rings}


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


def hip_gusset(rx=13.0, ry=21.0, steps=28):
    """A small disc bridging the torso-to-leg gap, in TORSO-local coords,
    merged into the torso's solid rings.

    The torso and legs were drawn separately and, at the right hip, do not
    quite touch: the torso is drawn ~7 units right of the body axis, so a
    symmetric leg pin leaves a few units of daylight around y=325. That is a
    real hole in the union and the outline filter faithfully traced it as a
    stray dark slash -- what made the hip read as broken while the shoulder
    read as clean.

    Fitting cannot fix it: a gap that small barely moves IoU, so the solver is
    indifferent (given the freedom it widened the gap slightly). This is the
    paper-doll answer instead: the tab that makes a joint overlap.

    Kept SMALL, placed in the gap itself rather than at the pin, and shaped as
    a TALL NARROW ellipse: the daylight runs vertically down the joint, so the
    patch needs height, and every unit of width risks the two things that broke
    earlier attempts. Three tries failed and are worth not repeating:
      * a big disc at the pin reached the armpit and closed the arm/torso gap,
        which is the gap that makes an arm read as its own limb (contract
        rule 2 -- the exact regression this whole rebuild was fixing);
      * dropping that disc lower to clear the armpit made it protrude past the
        hip as a visible bulge;
      * a small circle covered the lower half of the gap but not the top.
    Check BOTH after changing it: enclosed holes in the hip band, and that the
    outline did not move. Point probes alone pass while the outline bulges.
    Wind it the SAME way OpenCV returns contours -- under nonzero fill an
    opposite winding subtracts where it overlaps, punching new holes.
    """
    out = []
    for sx in (-1, 1):
        cx, cy = BC + sx * 32.0, 285.0
        out.append([(cx + rx * math.cos(-2 * math.pi * i / steps),
                     cy + ry * math.sin(-2 * math.pi * i / steps))
                    for i in range(steps)])
    return out


def main():
    parts = {n: trace(n) for n in FILES}
    parts['torso']['solid'] = parts['torso']['solid'] + hip_gusset()

    # Solve one scale + offset for ALL poses, so he never changes size between
    # them, the widest pose still fits, and the lowest foot lands on the floor.
    envelope = dict(POSES)
    sw = DANCE_SWING
    envelope['_danceA'] = {'armL': sw, 'armR': sw, 'legL': sw * 0.5, 'legR': sw * 0.5}
    envelope['_danceB'] = {'armL': -sw, 'armR': -sw}
    envelope['_danceC'] = {'armL': sw, 'armR': -sw}
    pts = [p for name in envelope for ring in placed(parts, envelope[name]) for p in ring]
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
        "scale={:.4f}  head r={:.1f}  head top y={:.1f}  colorable area={:.0f}% of full\n"
        .format(K, 58 * K, OY + K * TY, K * K * 100))
    sys.stderr.write("If head r moved, retune BODY + HEAD_CROWN_Y + every HATS "
                     "anchor.y/scale in game.js -- they are tuned to it.\n")


if __name__ == '__main__':
    main()

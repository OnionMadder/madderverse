"""Solve the rig's joint anchors so the STANDING doll matches the original
full-figure drawing as closely as possible.

The parts were drawn separately, so their pin positions were my guess. The
original drawing is ground truth for what he looks like standing, so fit to
it: rasterise both, maximise IoU over the anchor offsets and rest angles.
Left/right stay mirrored so he cannot come out lopsided.
"""
import math, json, os, sys
import numpy as np, cv2
from PIL import Image

REPO = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(REPO, 'groodle', 'art-src', 'body')
ORIGINAL = os.path.join(ART, 'original-full-figure.png')
W, H = 400, 600


def solid_of(path):
    a = np.array(Image.open(path).convert('L'))
    ink = (a < 120).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
    main = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    ff = main.copy()
    cv2.floodFill(ff, np.zeros((main.shape[0] + 2, main.shape[1] + 2), np.uint8), (0, 0), 1)
    s = ((ff == 0) | (main == 1)).astype(np.uint8)
    return cv2.morphologyEx(s, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))


def rings_of(mask, eps=1.6, min_area=60):
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < min_area:
            continue
        p = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(p) >= 3:
            out.append(p.astype(np.float64))
    return out


def head_width(mask):
    return max((np.nonzero(mask[y])[0].max() - np.nonzero(mask[y])[0].min())
               for y in range(mask.shape[0] // 3) if mask[y].any())


# ---- the three parts, pinned at their own origins (same as trace_rig.py) ----
HEAD_D, ARM_LEN, LEG_LEN = 116.0, 217.0, 210.0
PARTS = {}
for name, f, in (('torso', 'torso.png'), ('arm', 'arm.png'), ('leg', 'leg.png')):
    m = solid_of(os.path.join(ART, f))
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    s = HEAD_D / head_width(m) if name == 'torso' else \
        (ARM_LEN if name == 'arm' else LEG_LEN) / (y1 - y0)
    py = y0 + (y1 - y0) * (0.0 if name == 'torso' else 0.055)
    row = np.nonzero(m[int(round(py))])[0]
    px = (row.min() + row.max()) / 2
    PARTS[name] = [(r - [px, py]) * s for r in rings_of(m)]

# ---- reference: the original drawing, scaled to the same head size ----
ref = solid_of(ORIGINAL)
rs = HEAD_D / head_width(ref)
rys, rxs = np.nonzero(ref)
# align on the head: top of head, and the head's own horizontal centre
rtop = rys.min()
hrow = np.nonzero(ref[rtop + int(round(HEAD_D / rs / 2))])[0]
rcx = (hrow.min() + hrow.max()) / 2
REF_RINGS = [(r - [rcx, rtop]) * rs for r in rings_of(ref)]

BC = -6.75
TX, TY = 200 - BC, 34.0
SRC_OF = {'armL': 'arm', 'armR': 'arm', 'legL': 'leg', 'legR': 'leg'}
MIRROR = {'armR', 'legR'}
SIGN = {'armL': 1, 'armR': -1, 'legL': 1, 'legR': -1}


def raster(rings, K, OX, OY):
    img = np.zeros((H, W), np.uint8)
    polys = [np.round(np.stack([OX + K * r[:, 0], OY + K * r[:, 1]], 1)).astype(np.int32)
             for r in rings]
    cv2.fillPoly(img, polys, 1)
    return img


def assemble(p):
    """(armDXL, armDXR, armDY, legDXL, legDXR, legDY, armRest, legRest,
    armScale, legScale). Left and right are solved SEPARATELY: the torso is
    drawn ~7 units off the body axis, so symmetric pins leave the right leg
    short of it -- a real gap in the union, which the outline then traces as
    a stray dark slash at the right hip."""
    aDXL, aDXR, aDY, lDXL, lDXR, lDY, aR, lR, aS, lS = p
    SC = {'arm': aS, 'leg': lS}
    anchor = {'armL': (BC - aDXL, aDY), 'armR': (BC + aDXR, aDY),
              'legL': (BC - lDXL, lDY), 'legR': (BC + lDXR, lDY)}
    rest = {'armL': aR, 'armR': -aR, 'legL': lR, 'legR': -lR}
    out = []
    for k in ('legL', 'legR', 'armL', 'armR'):
        ax, ay = anchor[k]; ax, ay = TX + ax, TY + ay
        t = math.radians(rest[k]); c, s = math.cos(t), math.sin(t)
        sc = SC[SRC_OF[k]]
        for r in PARTS[SRC_OF[k]]:
            x = (-r[:, 0] if k in MIRROR else r[:, 0]) * sc
            y = r[:, 1] * sc
            out.append(np.stack([ax + x * c - y * s, ay + x * s + y * c], 1))
    for r in PARTS['torso']:
        out.append(np.stack([TX + r[:, 0], TY + r[:, 1]], 1))
    return out, anchor, rest


def score(p):
    rings, _, _ = assemble(p)
    # place both in the frame using the SAME head-anchored transform, so the
    # comparison is about limb placement and not about overall fit
    K = 0.8717
    OX, OY = 200 - K * TX, 147.7 - K * TY
    a = raster(rings, K, OX, OY)
    b = raster(REF_RINGS, K, 200 - K * 0, 147.7 - K * 0)
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return inter / union if union else 0.0


start = np.array([63.9, 63.9, 143.0, 47.9, 47.9, 270.9, 0.8, 0.2, 1.105, 1.319])
print("start IoU: %.4f  %s" % (score(start), start))

# coordinate descent -- small parameter space, no optimiser dependency
best, bs = start.copy(), score(start)
steps = np.array([4.0, 4.0, 5.0, 4.0, 4.0, 6.0, 2.0, 2.0, 0.04, 0.04])
for it in range(60):
    improved = False
    for i in range(len(best)):
        for d in (+steps[i], -steps[i]):
            cand = best.copy(); cand[i] += d
            s = score(cand)
            if s > bs + 1e-6:
                best, bs, improved = cand, s, True
    if not improved:
        steps *= 0.5
        if steps.max() < 0.25:
            break
print("fitted IoU: %.4f" % bs)
print("armDXL=%.1f armDXR=%.1f armDY=%.1f legDXL=%.1f legDXR=%.1f legDY=%.1f "
      "armRest=%.1f legRest=%.1f armScale=%.3f legScale=%.3f" % tuple(best))
json.dump(dict(zip(['armDXL','armDXR','armDY','legDXL','legDXR','legDY',
                    'armRest','legRest','armScale','legScale'], best.tolist()), iou=bs),
          open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fit.json'), 'w'))

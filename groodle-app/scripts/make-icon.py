"""Generate the Groodle launcher icon from the game's own art.

    python groodle-app/scripts/make-icon.py

Writes groodle-app/assets/icon.png (1024x1024) and icon-foreground.png, then
run `npx @capacitor/assets generate --android --assetPath assets` to fan them
out across the mipmap densities.

The icon is Groodle's head -- cropped straight out of the tracked source
drawing, not redrawn -- on the app's own background colour. Cropping rather
than illustrating means the icon cannot drift from the character: redraw the
torso, re-run this, and the icon follows.

Android adaptive icons mask the outer ~1/3 of the canvas away (the safe zone
is the centre 66%), so the head is scaled to sit inside that and the
foreground layer is generated with the padding it expects.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
REPO = os.path.dirname(APP)
TORSO = os.path.join(REPO, 'groodle', 'art-src', 'body', 'torso.png')
OUT = os.path.join(APP, 'assets')

BG = (26, 15, 51)          # #1a0f33 -- the manifest's background_color
WASH = (232, 232, 244)     # the pale interior the kid colours on
INK = (26, 15, 51)

# Torso-local landmarks, in the same units trace_rig.py uses (head top = 0).
NECK_Y, TORSO_H = 114.0, 318.0
SIZE = 1024
SAFE = 0.62                # fraction of the canvas the head may occupy


def head_rgba():
    """The head, cropped from the torso drawing, as ink-on-transparent.

    Same flood-from-the-border trick trace_rig.py uses: whatever the outside
    can reach is background, so what it cannot reach is the head's interior.
    Done with cv2 rather than PIL -- PIL's floodfill leaked straight through
    the open neck and filled the whole crop box.
    """
    import cv2
    g = np.array(Image.open(TORSO).convert('L'))
    ink = (g < 120).astype(np.uint8)
    ys, _ = np.nonzero(ink)
    top, bot = ys.min(), ys.max()
    # the drawing spans the whole torso, so the neck sits a known fraction down
    cut = int(round(top + (bot - top) * (NECK_Y / TORSO_H)))

    # Fill on the FULL image (the head is closed there); crop afterwards. The
    # neck is open once you slice at `cut`, and an open outline cannot be
    # flood-filled -- that is what broke the first attempt.
    ff = ink.copy()
    cv2.floodFill(ff, np.zeros((ink.shape[0] + 2, ink.shape[1] + 2), np.uint8), (0, 0), 1)
    solid = ((ff == 0) | (ink == 1)).astype(np.uint8)

    band_solid = solid[:cut]
    band_ink = ink[:cut]
    # keep only the head component, so neck/shoulder stubs do not ride along
    n, lab, stats, _ = cv2.connectedComponentsWithStats(band_solid, 8)
    head = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)

    # Trim the neck. NECK_Y is a safe over-cut, so the crop still catches the
    # top of the neck as a stub under the chin; drop rows past the point where
    # the silhouette has narrowed well below the skull's widest span.
    widths = [(np.count_nonzero(head[y]), y) for y in range(head.shape[0])
              if head[y].any()]
    # The neck is a LOCAL MINIMUM, not a threshold: the chin narrows gradually,
    # so any fixed fraction of the skull's width lands mid-chin and lops it off
    # flat. Walk down from the widest row until the silhouette stops narrowing
    # and starts widening again -- that turn is the neck.
    wmax = max(w for w, _ in widths)
    ywide = next(y for w, y in widths if w == wmax)
    below = [(w, y) for w, y in widths if y > ywide]
    neck = below[-1][1] if below else head.shape[0]
    for i in range(1, len(below) - 3):
        w, y = below[i]
        if w < wmax * 0.75 and all(below[i + k][0] >= w for k in range(1, 4)):
            neck = y
            break
    # Cut a little ABOVE the pinch: right at it, the neck's outer edge is still
    # attached to the skull and survives as a thin tail.
    neck = max(0, neck - int(round(head.shape[0] * 0.045)))
    head[neck:] = 0
    # Slicing at the neck leaves a thin tail of its outer edge still attached
    # to the skull, so component filtering will not drop it. A morphological
    # open does: the tail is narrow, the skull is not.
    k = max(9, int(round(head.shape[1] * 0.06)) | 1)
    head = cv2.morphologyEx(head, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(head, 8)
    if n2 > 1:
        head = (lab2 == 1 + int(np.argmax(st2[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)

    ys2, xs2 = np.nonzero(head)
    x0, x1, y0, y1 = xs2.min(), xs2.max(), ys2.min(), ys2.max()
    hm = head[y0:y1 + 1, x0:x1 + 1].astype(bool)
    im = (band_ink[y0:y1 + 1, x0:x1 + 1].astype(bool)) & hm

    h, w = hm.shape
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[hm] = (*WASH, 255)
    rgba[im] = (*INK, 255)
    return Image.fromarray(rgba, 'RGBA')


def compose(head, pad_fraction):
    """Head centred on the canvas, occupying `pad_fraction` of it."""
    canvas = Image.new('RGBA', (SIZE, SIZE), (*BG, 255))
    target = SIZE * pad_fraction
    s = min(target / head.width, target / head.height)
    hw, hh = int(head.width * s), int(head.height * s)
    resized = head.resize((hw, hh), Image.LANCZOS)
    canvas.alpha_composite(resized, ((SIZE - hw) // 2, (SIZE - hh) // 2))
    return canvas


def main():
    os.makedirs(OUT, exist_ok=True)
    head = head_rgba()
    print('head crop: %dx%d' % (head.width, head.height))
    # square icon: head fills more of the frame
    compose(head, 0.74).convert('RGB').save(os.path.join(OUT, 'icon.png'))
    # adaptive foreground: smaller, so the launcher's mask cannot clip it
    fg = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    inner = compose(head, SAFE)
    inner_head = inner.crop((0, 0, SIZE, SIZE))
    fg.alpha_composite(inner_head)
    # drop the background from the foreground layer -- Android supplies it
    arr = np.array(fg)
    bgmask = (arr[:, :, 0] == BG[0]) & (arr[:, :, 1] == BG[1]) & (arr[:, :, 2] == BG[2])
    arr[bgmask] = (0, 0, 0, 0)
    Image.fromarray(arr, 'RGBA').save(os.path.join(OUT, 'icon-foreground.png'))
    Image.new('RGB', (SIZE, SIZE), BG).save(os.path.join(OUT, 'icon-background.png'))
    print('wrote icon.png, icon-foreground.png, icon-background.png ->', OUT)


if __name__ == '__main__':
    main()

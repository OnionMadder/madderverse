"""Generate the Groodle app icon from the game's own art.

    python groodle-app/scripts/make-icon.py

Writes into groodle-app/assets/:
    icon.png             1024x1024, the launcher icon source
    icon-foreground.png  adaptive-icon foreground (transparent)
    icon-background.png  adaptive-icon background (flat)
    icon-512.png         the Play Console storefront icon

Then run `npx @capacitor/assets generate --android --assetPath assets` to fan
icon.png out across the mipmap densities.

icon-512.png is generated from the SAME composition as the launcher icon, on
purpose: the icon on the store page and the icon under the app on the phone
must be the same picture. Slip Studio's drifted apart -- its storefront art
was refreshed while the launcher kept deriving from an older source -- and
nobody noticed for a month.

Nothing here is illustrated. The head is cropped out of the tracked source
drawing and the hat is the game's own sprite, placed with the same geometry
game.js uses (HEAD_CROWN + the hat's anchor and scale). So the icon cannot
drift from the character: redraw the torso or retune the hat, re-run, the
icon follows.

Android adaptive icons mask the outer ~1/3 of the canvas away (the safe zone
is roughly the center 66%), so the foreground layer is fitted inside that --
which matters more with a hat, since the group is much taller than the head.
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
WASH = (232, 232, 244)     # the pale interior the kid colors on
INK = (26, 15, 51)

# Torso-local landmarks, in the same units trace_rig.py uses (head top = 0).
NECK_Y, TORSO_H = 114.0, 318.0

# Which hat he wears. Any id from HATS in game.js; the sprite and its
# placement are read from there, not duplicated here.
HAT_ID = 'the-worminal'

# Game-space constants the hat placement needs, matching game.js.
HEAD_D = 116.0                   # head width in Groodle units
CROWN_X, CROWN_Y = 207.0, 43.0   # HEAD_CROWN_X / HEAD_CROWN_Y
HEAD_TOP = 35.0                  # BODY.headTop

SIZE = 1024
HEAD_FRAC = 0.58   # head width as a fraction of the icon -- keep the face big
FIT = 0.88         # ceiling: the whole group must fit the square icon
SAFE = 0.66        # tighter ceiling for the adaptive foreground's safe zone


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


def hatted(head):
    """Head wearing HAT_ID, placed with the game's own geometry.

    game.js draws a hat at HEAD_CROWN + the hat's anchor, sized frame*scale
    and bottom-aligned. Reading HAT_FRAMES and HATS straight out of game.js
    means a retuned hat moves here too, instead of this script carrying a
    second copy of the numbers that silently goes stale.
    """
    import json, re
    g = open(os.path.join(REPO, 'groodle', 'game.js'), encoding='utf-8').read()

    i = g.index('const HAT_FRAMES = {')
    frames = json.loads(re.sub(r'(\w+):', r'"\1":',
                               g[i + len('const HAT_FRAMES = '):g.index('};', i) + 1]
                               ).replace("'", '"'))
    i = g.index('const HATS = [')
    m = re.search(r"\{ id: '" + HAT_ID + r"'.*?anchor: \{ x: (-?\d+), y:\s*(\d+) \}, scale: ([\d.]+) \}",
                  g[i:g.index('\n    ];', i)])
    if not m:
        raise SystemExit('hat %r not found in HATS' % HAT_ID)
    ax, ay, sc = int(m.group(1)), int(m.group(2)), float(m.group(3))
    sprite = re.search(r"\{ id: '" + HAT_ID + r"'.*?sprite: '([\w-]+)'", g[i:]).group(1)
    f = frames[sprite]

    upp = head.width / HEAD_D                    # px per Groodle unit
    hw, hh = f['w'] * sc, f['h'] * sc            # hat size, Groodle units
    hx, hy = CROWN_X + ax - hw / 2.0, CROWN_Y + ay - hh
    head_left = CROWN_X - (head.width / upp) / 2.0

    sheet = Image.open(os.path.join(REPO, 'groodle', 'assets', 'sprites', 'hats.png')).convert('RGBA')
    hat = sheet.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'])).resize(
        (max(1, int(hw * upp)), max(1, int(hh * upp))), Image.LANCZOS)

    pad = int(max(0, (HEAD_TOP - hy)) * upp) + 10
    c = Image.new('RGBA', (head.width + 80, head.height + pad + 10), (0, 0, 0, 0))
    c.alpha_composite(head, (40, pad))
    c.alpha_composite(hat, (int(40 + (hx - head_left) * upp), int(pad + (hy - HEAD_TOP) * upp)))
    return c.crop(c.getbbox())


def compose(group, head_width, fit, opaque=True):
    """Group centered on the canvas.

    Sized so the HEAD is a consistent fraction of the icon rather than the
    whole group -- otherwise a tall hat shrinks the face until it is
    unreadable at launcher size -- but never so large that the group clips.
    """
    canvas = Image.new('RGBA', (SIZE, SIZE), (*BG, 255) if opaque else (0, 0, 0, 0))
    s = min((SIZE * HEAD_FRAC) / head_width,
            (SIZE * fit) / group.width, (SIZE * fit) / group.height)
    gw, gh = int(group.width * s), int(group.height * s)
    canvas.alpha_composite(group.resize((gw, gh), Image.LANCZOS),
                           ((SIZE - gw) // 2, (SIZE - gh) // 2))
    return canvas


def main():
    os.makedirs(OUT, exist_ok=True)
    head = head_rgba()
    group = hatted(head)
    print('head crop: %dx%d   with %s: %dx%d'
          % (head.width, head.height, HAT_ID, group.width, group.height))

    icon = compose(group, head.width, FIT).convert('RGB')
    icon.save(os.path.join(OUT, 'icon.png'))
    # Play's storefront icon: same picture, just the size Play wants, so the
    # store and the home screen can never show two different Groodles.
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-512.png'))

    # Adaptive foreground: fitted well inside the safe zone, because the
    # launcher's mask crops the outer third and the worm rides high.
    fg = compose(group, head.width, SAFE, opaque=False)
    Image.fromarray(np.array(fg), 'RGBA').save(os.path.join(OUT, 'icon-foreground.png'))
    Image.new('RGB', (SIZE, SIZE), BG).save(os.path.join(OUT, 'icon-background.png'))
    print('wrote icon.png, icon-512.png, icon-foreground.png, icon-background.png ->', OUT)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Florigami sprite-sheet compositor.

Reads a petal-formation JSON (from tools/petal-editor.html) + the paper shapes
(shapes/) + a rawpixel pattern (patterns/), and stamps a full flower sprite
sheet following the grid convention in ASSETS.md:
  columns = growth stages [seed, sprout, bud, bloom]
  rows    = the species' colours (dex + rares), in order
  seed + sprout are colour-agnostic → rendered on row 0 only.

Recipe (locked with Onion): patterned petals toned toward the flower colour,
watercolour pigment-pool shading (edge emerges from the shading, no drawn line),
plain watercolour centre.

Usage:
  python compositor.py <shapes_dir> <patterns_dir> <formation.json> <pattern_index> <out.png>
"""
import sys, os, glob, json
from PIL import Image, ImageChops, ImageFilter

SH, PT, FORM, PATIDX, OUT = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
PATS = sorted(glob.glob(os.path.join(PT, '*.png')))
form = json.load(open(FORM))
PATTERN = PATS[PATIDX]

# cosmos colour rows: dex (6) + rares (white, black) = 8. Hexes = game --f-* palette.
COLORS = [
    ("red", "#C94E4E"), ("orange", "#E9925A"), ("yellow", "#F1D65C"),
    ("green", "#9FB86A"), ("blue", "#7C96CF"), ("purple", "#9B7BC0"),
    ("white", "#F3EEE0"), ("black", "#46424C"),
]
STAGES = ["seed", "sprout", "bud", "bloom"]
F = 256                       # cell size (px)
CENTER = "#E7A24C"            # plain gold centre
GREEN = "#7A9557"             # stems + leaves
BROWN = "#6B4A2E"            # planted seed

def load(n): return Image.open(os.path.join(SH, n + '.png')).convert('RGBA')
def hx(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def lt(hexc, w): r, g, b = hx(hexc); return (int(r+(255-r)*w), int(g+(255-g)*w), int(b+(255-b)*w))

def coverpat(pf, size, scale=1.9):
    p = Image.open(pf).convert('RGBA'); bg = Image.new('RGBA', p.size, (255, 255, 255, 255)); bg.alpha_composite(p); p = bg.convert('RGB')
    p = p.resize((int(p.width*scale), int(p.height*scale)), Image.LANCZOS)
    tw, th = size; s = max(tw/p.width, th/p.height)
    r = p.resize((int(p.width*s)+1, int(p.height*s)+1), Image.LANCZOS)
    return r.crop(((r.width-tw)//2, (r.height-th)//2, (r.width-tw)//2+tw, (r.height-th)//2+th))

def wshade(a, floor=0.46, band=0.15, form_=52):
    w, h = a.size; R = int(min(w, h)*band); depth = a.filter(ImageFilter.GaussianBlur(R))
    edge = depth.point(lambda v: int(255*(floor+(1-floor)*(v/255)**0.85)))
    near = a.filter(ImageFilter.GaussianBlur(max(3, R//5))).point(lambda v: int(255*(0.8+0.2*v/255)))
    edge = ImageChops.multiply(edge, near)
    g = Image.linear_gradient('L').resize((w, h)).point(lambda v: 255-int(v/255*form_))
    return ImageChops.multiply(edge, g).convert('RGB')

def petal_tex(shape, pf, tone, tw=0.44):
    # pf=None -> PLAIN watercolour petal (base colours). pf set -> PATTERNED
    # petal (rares only). Same tone + pigment-pool shading either way.
    shp = load(shape); a = shp.split()[3]
    it = shp.convert('RGB')
    if pf is not None:
        it = ImageChops.multiply(it, coverpat(pf, shp.size))
    plainTw = tw if pf is not None else 0.22   # plain petals hold more of the pure hue
    it = ImageChops.multiply(it, Image.new('RGB', shp.size, lt(tone, plainTw)))
    it = ImageChops.multiply(it, wshade(a)); r = it.convert('RGBA'); r.putalpha(a); return r

def solid_tex(shape, hexc, tw=0.10):
    shp = load(shape); a = shp.split()[3]
    it = ImageChops.multiply(shp.convert('RGB'), Image.new('RGB', shp.size, lt(hexc, tw)))
    it = ImageChops.multiply(it, wshade(a, 0.5, 0.18)); r = it.convert('RGBA'); r.putalpha(a); return r

def scaled(img, w): return img.resize((max(2, w), max(2, int(w*img.height/img.width))), Image.LANCZOS)

def shadow(layer, off, blur, op):
    s = Image.new('RGBA', layer.size, (56, 40, 26, 0)); s.putalpha(layer.split()[3].point(lambda v: min(v, op)))
    return s.filter(ImageFilter.GaussianBlur(blur)), off

def stamp(cv, tex, cx, cy, w, rot=0, shadow_op=90, sb=None):
    im = scaled(tex, w)
    if rot: im = im.rotate(-rot, expand=True, resample=Image.BICUBIC)
    x, y = int(cx-im.width/2), int(cy-im.height/2)
    if shadow_op:
        sh, off = shadow(im, (0, max(1, int(w*0.05))), sb or max(2, int(w*0.09)), shadow_op)
        cv.alpha_composite(sh, (x+off[0], y+off[1]))
    cv.alpha_composite(im, (x, y))

def bloom_cell(colorHex, isRare):
    cv = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    petTex = petal_tex('circle', PATTERN if isRare else None, colorHex)
    for p in form['petals']:
        w = max(2, int(p['scale']*F)); h = max(2, int(w*petTex.height/petTex.width))
        im = petTex.resize((w, h), Image.LANCZOS)
        im = im.rotate(-(p['rot']+(180 if p.get('flip') else 0)), expand=True, resample=Image.BICUBIC)
        x, y = int(p['cx']*F-im.width/2), int(p['cy']*F-im.height/2)
        sh, off = shadow(im, (0, int(F*0.012)), int(F*0.02), 90)
        cv.alpha_composite(sh, (x+off[0], y+off[1])); cv.alpha_composite(im, (x, y))
    c = form.get('center')
    if c:
        stamp(cv, solid_tex('circle', CENTER, 0.16), F/2, F/2, int(c['scale']*F), shadow_op=55)
    return cv

def bud_cell(colorHex, isRare):
    cv = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    stamp(cv, solid_tex('stem', GREEN), F*0.5, F*0.72, int(F*0.10), shadow_op=50)      # stem
    stamp(cv, solid_tex('leaf', GREEN), F*0.40, F*0.60, int(F*0.26), rot=40, shadow_op=45)  # sepal leaf
    stamp(cv, petal_tex('seed', PATTERN if isRare else None, colorHex), F*0.5, F*0.40, int(F*0.34), shadow_op=70)  # closed bud
    return cv

def sprout_cell():
    cv = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    stamp(cv, solid_tex('stem', GREEN), F*0.5, F*0.62, int(F*0.09), shadow_op=45)
    stamp(cv, solid_tex('leaf', GREEN), F*0.36, F*0.5, int(F*0.30), rot=55, shadow_op=40)
    stamp(cv, solid_tex('leaf', GREEN), F*0.64, F*0.52, int(F*0.28), rot=-58, shadow_op=40)
    return cv

def seed_cell():
    cv = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    stamp(cv, solid_tex('seed', BROWN, 0.0), F*0.5, F*0.6, int(F*0.24), shadow_op=60)
    return cv

RARE = {"white", "black"}   # the only PATTERNED colours; all others plain
sheet = Image.new('RGBA', (len(STAGES)*F, len(COLORS)*F), (0, 0, 0, 0))
for row, (name, hexc) in enumerate(COLORS):
    isRare = name in RARE
    for col, stage in enumerate(STAGES):
        if stage == "seed":
            cell = seed_cell() if row == 0 else None
        elif stage == "sprout":
            cell = sprout_cell() if row == 0 else None
        elif stage == "bud":
            cell = bud_cell(hexc, isRare)
        else:
            cell = bloom_cell(hexc, isRare)
        if cell is not None:
            sheet.alpha_composite(cell, (col*F, row*F))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT)
print(f"baked {OUT}  {sheet.size}  ({len(COLORS)} colours x {len(STAGES)} stages)")

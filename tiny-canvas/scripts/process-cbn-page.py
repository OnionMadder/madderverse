#!/usr/bin/env python3
"""
process-cbn-page.py — audit a coloring page for color-by-number, and
optionally emit the `cbn:` metadata block for templates.js.

This is the offline twin of cbn-core.js. It reimplements that module's
rules EXACTLY — same ink threshold, same fixed working width, same
area floor, same pole-of-inaccessibility anchors — so what it reports
is what the game will do. If you change a rule in one, change it in
the other; the constants are named identically on both sides.

  cbn-core.js            here
  ------------------     ----------------
  INK_ALPHA      96      INK_ALPHA
  WORK_W       1024      WORK_W
  MIN_AREA_FRAC 4.3e-4   MIN_AREA_FRAC
  MAX_REGIONS   120      MAX_REGIONS

USAGE

  # audit a page — does it work as CBN at all?
  python3 scripts/process-cbn-page.py assets/coloring-pages/cbn/cat.png

  # audit every CBN page
  python3 scripts/process-cbn-page.py assets/coloring-pages/cbn/*.png

  # write a region map you can look at (ids drawn at each anchor)
  python3 scripts/process-cbn-page.py <page.png> --map /tmp/cat-map.png

  # emit the cbn: block by sampling a fully-coloured reference
  python3 scripts/process-cbn-page.py <page.png> --reference <ref.png> \
      --palette "#hex,#hex,..." --out cat.json

THE USUAL WAY TO AUTHOR A PAGE IS NOW tools/cbn-editor.html — open
the page, click each region, copy the block. The --reference path
here is the bulk/scripted alternative and is kept for that; it is no
longer the primary route, because hand-colouring a whole reference
PNG per page is what stalled seven of the eight CBN pages.

WHAT THE AUDIT IS TELLING YOU

A number has to physically fit inside its region to be readable, so a
region's usable size is the radius of the largest circle that fits in
it. "numbered at 1x" counts regions big enough to show a digit on a
phone with no zoom; "UNREACHABLE" counts regions still too small at
the app's 8x zoom ceiling — those can never be numbered, and that is
an art problem (thicken or simplify that part), not something the
runtime can fix.

Requires Pillow + numpy — same deps as process-coloring-pages.py.
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError as e:  # pragma: no cover
    sys.exit(
        "Missing dependency: " + str(e) + "\n"
        "Install with: pip install pillow numpy"
    )


# ---- these four MUST match cbn-core.js ----
INK_ALPHA = 96
WORK_W = 1024
MIN_AREA_FRAC = 4.3e-4
MAX_REGIONS = 120
BORDER_INK = 2

# Legibility model — must match labelFit() in cbn-core.js.
#
# A number is judged against the region's RUN through its anchor, not
# against an inscribed circle: a digit is tall and narrow, so a
# ribbon-shaped region can hold one long before a circle of that
# diameter fits. Two styles, because the pill's capsule needs much
# more room than the digit inside it:
#   pill — paper capsule + outline, ~1.7em square
#   slim — bare glyph with a halo, barely wider than the digit
# PHONE_ART_W is the displayed art width on a ~390px phone, the tight
# case: a page that works there works everywhere.
FONT_MIN = 9.0
PILL_W = (1.7, 2.1)     # (1 digit, 2 digits)
PILL_H = 1.7
SLIM_W = (0.75, 1.35)
SLIM_H = 1.15
PHONE_ART_W = 366.0
ZOOM_MAX_CBN = 8.0


def label_fit(reg, art_width, digits=1):
    """(mode, font_px) — mirror of labelFit() in cbn-core.js."""
    d = 1 if digits >= 2 else 0
    avail_w = reg["hw"] * art_width
    avail_h = reg["vh"] * art_width      # vh is width-normalized too
    pill = min(avail_w / PILL_W[d], avail_h / PILL_H)
    if pill >= FONT_MIN:
        return "pill", pill
    slim = min(avail_w / SLIM_W[d], avail_h / SLIM_H)
    if slim >= FONT_MIN:
        return "slim", slim
    return "none", 0.0


def zoom_to_show(reg, art_width, digits=1, max_zoom=ZOOM_MAX_CBN):
    if label_fit(reg, art_width, digits)[0] != "none":
        return 1.0
    d = 1 if digits >= 2 else 0
    slim = min((reg["hw"] * art_width) / SLIM_W[d],
               (reg["vh"] * art_width) / SLIM_H)
    if slim <= 0:
        return float("inf")
    z = FONT_MIN / slim
    return float("inf") if z > max_zoom else max(1.0, z)

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


def load_ink(path: Path, work_w: int = WORK_W) -> tuple[np.ndarray, Image.Image]:
    """Return (ink mask HxW uint8, the RGBA image resized to work width)."""
    im = Image.open(path).convert("RGBA")
    w = min(work_w, im.width)
    h = max(1, round(im.height * (w / im.width)))
    im = im.resize((w, h), Image.LANCZOS)
    a = np.array(im.split()[-1])
    ink = (a >= INK_ALPHA).astype(np.uint8)
    # The page edge is a boundary — same as sealBorder() in cbn-core.js
    # and markPageBorder() in game.js's fill mask.
    ink[:BORDER_INK, :] = 1
    ink[-BORDER_INK:, :] = 1
    ink[:, :BORDER_INK] = 1
    ink[:, -BORDER_INK:] = 1
    return ink, im


def label_regions(ink: np.ndarray, min_area: int):
    """
    Scanline flood fill enumerating connected components of non-ink
    pixels. Returns (label_map int32 HxW with -1 for ink/specks,
    [{'id','area','ax','ay'} ...]) with ids in raster-discovery order,
    matching labelRegions() in cbn-core.js.
    """
    h, w = ink.shape
    lab = np.full((h, w), -1, np.int32)
    seen = np.zeros((h, w), np.uint8)
    regions = []
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0, x0] or ink[y0, x0]:
                continue
            rid = len(regions)
            px = []
            stack = [(x0, y0)]
            while stack:
                px_, py = stack.pop()
                x = px_
                while x > 0 and not seen[py, x - 1] and not ink[py, x - 1]:
                    x -= 1
                up = dn = False
                while x < w and not seen[py, x] and not ink[py, x]:
                    seen[py, x] = 1
                    px.append((py, x))
                    if py > 0:
                        open_u = (not seen[py - 1, x]) and (not ink[py - 1, x])
                        if open_u and not up:
                            stack.append((x, py - 1)); up = True
                        elif not open_u:
                            up = False
                    if py < h - 1:
                        open_d = (not seen[py + 1, x]) and (not ink[py + 1, x])
                        if open_d and not dn:
                            stack.append((x, py + 1)); dn = True
                        elif not open_d:
                            dn = False
                    x += 1
            if len(px) < min_area:
                continue          # speck: stays -1, gets no number
            ys = np.fromiter((p[0] for p in px), np.int32, len(px))
            xs = np.fromiter((p[1] for p in px), np.int32, len(px))
            lab[ys, xs] = rid
            regions.append({"id": rid, "area": len(px)})
            if len(regions) > MAX_REGIONS:
                return None, []
    return lab, regions


def chamfer_edt(ink: np.ndarray) -> np.ndarray:
    """
    Chamfer 3-4 distance transform of the non-ink pixels, in pixels.

    The horizontal propagation (d[x] = min(d[x], d[x-1]+3)) is a
    running minimum, so it vectorizes: subtract 3x, accumulate the
    minimum, add 3x back. That keeps the whole transform in numpy
    instead of a per-pixel Python loop.
    """
    h, w = ink.shape
    INF = 1 << 24
    d = np.where(ink > 0, 0, INF).astype(np.int64)
    cols3 = 3 * np.arange(w, dtype=np.int64)

    def sweep_h(row):
        np.minimum(row, np.minimum.accumulate(row - cols3) + cols3, out=row)
        rev = row[::-1]
        np.minimum(rev, np.minimum.accumulate(rev - cols3) + cols3, out=rev)

    for y in range(h):                       # forward: N, NW, NE, then W/E
        if y > 0:
            up = d[y - 1]
            np.minimum(d[y], up + 3, out=d[y])
            np.minimum(d[y][1:], up[:-1] + 4, out=d[y][1:])
            np.minimum(d[y][:-1], up[1:] + 4, out=d[y][:-1])
        sweep_h(d[y])
    for y in range(h - 2, -1, -1):           # backward: S, SW, SE
        dn = d[y + 1]
        np.minimum(d[y], dn + 3, out=d[y])
        np.minimum(d[y][1:], dn[:-1] + 4, out=d[y][1:])
        np.minimum(d[y][:-1], dn[1:] + 4, out=d[y][:-1])
        sweep_h(d[y])
    return d / 3.0


def build_model(path: Path, work_w: int = WORK_W):
    ink, im = load_ink(path, work_w)
    h, w = ink.shape
    min_area = max(1, round(MIN_AREA_FRAC * w * h))
    lab, regions = label_regions(ink, min_area)
    if lab is None:
        return None
    if not regions:
        return None
    dist = chamfer_edt(ink)
    # Pole of inaccessibility per region: the pixel furthest from ink.
    for reg in regions:
        sel = lab == reg["id"]
        dd = np.where(sel, dist, -1.0)
        idx = int(np.argmax(dd))
        py, px = divmod(idx, w)
        reg["ax"] = (px + 0.5) / w
        reg["ay"] = (py + 0.5) / h
        reg["r"] = float(dd.flat[idx]) / w        # normalized to WIDTH
        # Runs through the anchor, within this region. Both normalized
        # to WIDTH so one scale factor converts either to pixels.
        row = lab[py]
        x0 = x1 = px
        while x0 > 0 and row[x0 - 1] == reg["id"]:
            x0 -= 1
        while x1 < w - 1 and row[x1 + 1] == reg["id"]:
            x1 += 1
        col = lab[:, px]
        y0 = y1 = py
        while y0 > 0 and col[y0 - 1] == reg["id"]:
            y0 -= 1
        while y1 < h - 1 and col[y1 + 1] == reg["id"]:
            y1 += 1
        reg["hw"] = (x1 - x0 + 1) / w
        reg["vh"] = (y1 - y0 + 1) / w
    return {"w": w, "h": h, "labels": lab, "regions": regions,
            "image": im, "min_area": min_area}


def fitness(model, art_width=PHONE_ART_W, max_zoom=ZOOM_MAX_CBN):
    rows = []
    fit1 = fitmax = 0
    worst = 1.0
    for reg in model["regions"]:
        mode, _ = label_fit(reg, art_width)
        z = zoom_to_show(reg, art_width, 1, max_zoom)
        if mode != "none":
            fit1 += 1
        if z != float("inf"):
            fitmax += 1
            worst = max(worst, z)
        rows.append({"id": reg["id"], "zoom": z, "mode": mode})
    return {"total": len(model["regions"]), "fit1x": fit1, "fitmax": fitmax,
            "unreachable": len(model["regions"]) - fitmax, "worst": worst,
            "rows": rows}


# Distinct-ish tints for the region map. Not the app palette — these
# exist only to make neighbouring regions tell apart on the audit
# image, so hue spacing matters more than prettiness.
MAP_TINTS = [
    (255, 179, 186), (255, 223, 186), (255, 255, 186), (186, 255, 201),
    (186, 225, 255), (218, 198, 255), (255, 198, 236), (198, 255, 246),
    (230, 230, 200), (200, 220, 240), (245, 210, 175), (205, 240, 205),
]


def write_map(model, out_path: Path):
    """
    Region map: every region flat-tinted, its id drawn at the anchor,
    line art on top. This is the picture to look at when deciding what
    colour each region should be — and it is drawn from the label map,
    so a region that looks merged here IS merged in the game.
    """
    w, h = model["w"], model["h"]
    lab = model["labels"]
    rgb = np.full((h, w, 3), 255, np.uint8)
    for reg in model["regions"]:
        rgb[lab == reg["id"]] = MAP_TINTS[reg["id"] % len(MAP_TINTS)]
    base = Image.fromarray(rgb, "RGB").convert("RGBA")
    base.alpha_composite(model["image"])        # ink over the tints

    d = ImageDraw.Draw(base)
    for reg in model["regions"]:
        x, y = reg["ax"] * w, reg["ay"] * h
        txt = str(reg["id"])
        tw = 6 * len(txt)
        d.rectangle([x - tw - 3, y - 9, x + tw + 3, y + 9],
                    fill=(255, 255, 255, 235), outline=(0, 0, 0, 255))
        d.text((x - tw + 1, y - 6), txt, fill=(0, 0, 0, 255))
    base.convert("RGB").save(out_path)


SOFT_ALPHA = 88          # visible, but under INK_ALPHA


def open_mask(ink: np.ndarray, radius: float) -> np.ndarray:
    """Morphological opening of a binary mask: erode by radius, dilate
    back. Whatever fails to survive was a stroke thinner than 2*radius.
    Implemented with two chamfer transforms so there is no scipy dep."""
    eroded = chamfer_edt(~ink) > radius        # ink pixels far from paper
    if not eroded.any():
        return np.zeros_like(ink)
    return chamfer_edt(eroded) <= radius


def soften_decorative_lines(src: Path, dst: Path, radius: float = 3.0,
                            art_width: float = PHONE_ART_W) -> dict:
    """
    Demote thin INTERIOR strokes from boundaries to decoration.

    The problem this solves: a cactus is drawn with thin rib lines
    inside a much thicker outline. Those ribs are decoration -- they
    say "saguaro" -- but the fill mask cannot tell decoration from
    structure, so the trunk shatters into ribbons 4 px wide on a
    phone, and no digit fits in 4 px.

    Dropping a stroke's alpha just BELOW INK_ALPHA keeps it visible
    (it is drawn over the kid's colour, so it still reads as a rib)
    while fill and color-by-number see straight through it. That is
    exactly how the pumpkin's interior rib curves already behave.

    Thickness alone is NOT a safe test for which strokes to demote --
    on the cactus the pot's soil ellipse is the same 4-7 px as the
    ribs, and softening it would merge the soil into the pot rim,
    losing a region that was perfectly numberable. So the test is what
    softening ACHIEVES: a stroke is demoted only if it separates two
    regions AND at least one of them is too small to carry a number.
    Decorative-looking strokes that do real work are left alone.

    ...with one more condition, learned the hard way. That rule alone
    also demotes the OUTLINE between a too-thin rib and the sky, which
    merges the whole cactus into the background and destroys the
    picture. So a stroke touching a region that reaches the page edge
    is never demoted: you may dissolve a shape's internal divisions,
    never its silhouette. The caller-visible symptom when this went
    wrong was the region count collapsing from 17 to 4, which is what
    the post-check at the end now catches on its own.
    """
    im = Image.open(src).convert("RGBA")
    r, g, b, a = im.split()
    alpha = np.array(a)
    ink = alpha >= INK_ALPHA
    h, w = ink.shape

    model = build_model(src, work_w=w)
    if model is None:
        raise SystemExit("no model for " + str(src))
    lab = model["labels"]
    # Which regions cannot show a number at 1x on a phone?
    too_small = {reg["id"] for reg in model["regions"]
                 if label_fit(reg, art_width)[0] == "none"}

    # Regions reaching the page edge are the background (and anything
    # bleeding off-page). Their boundary is the drawing's silhouette
    # and must never be dissolved.
    ring = BORDER_INK + 3
    edge = set(np.unique(np.concatenate([
        lab[ring, :], lab[-ring - 1, :], lab[:, ring], lab[:, -ring - 1]
    ]))) - {-1}

    thin = ink & ~open_mask(ink, radius)
    # Label the thin strokes so each line is judged on its own.
    strokes, n_strokes = label_binary(thin)

    # For each stroke, collect the regions it sits between. Probing at
    # +/-(radius*2+2) px steps past the stroke lands in open space on
    # either side without reaching across a neighbouring stroke.
    reach = int(radius * 2 + 2)
    touching = [set() for _ in range(n_strokes + 1)]
    ys, xs = np.nonzero(thin)
    sid = strokes[ys, xs]
    for dy, dx in ((0, -reach), (0, reach), (-reach, 0), (reach, 0)):
        py = np.clip(ys + dy, 0, h - 1)
        px = np.clip(xs + dx, 0, w - 1)
        near = lab[py, px]
        for s, v in zip(sid, near):
            if v >= 0:
                touching[s].add(int(v))

    keep_ids, soften_ids = [], []
    for s in range(1, n_strokes + 1):
        regs = touching[s]
        if len(regs) >= 2 and (regs & too_small) and not (regs & edge):
            soften_ids.append(s)
        else:
            keep_ids.append(s)

    demote = np.isin(strokes, soften_ids) & thin
    out = alpha.copy()
    out[demote] = np.minimum(out[demote], SOFT_ALPHA)
    Image.merge("RGBA", (r, g, b, Image.fromarray(out))).save(dst)

    # Post-check. A softening that leaks is not subtle -- shapes fall
    # into the background and the region count collapses -- but it is
    # also not obvious from the output image, because the demoted
    # strokes still RENDER. So verify against the model rather than
    # trusting the rule, and say so loudly.
    after = build_model(dst, work_w=w)
    n_before, n_after = len(model["regions"]), (
        len(after["regions"]) if after else 0)
    bg_before = max((model["regions"][i]["area"] for i in edge), default=0)
    bg_after = 0
    if after:
        alab = after["labels"]
        aedge = set(np.unique(np.concatenate([
            alab[ring, :], alab[-ring - 1, :], alab[:, ring],
            alab[:, -ring - 1]]))) - {-1}
        bg_after = max((after["regions"][i]["area"] for i in aedge),
                       default=0)
    leaked = bg_before and bg_after > bg_before * 1.05

    return {"strokes": n_strokes, "softened": len(soften_ids),
            "kept": len(keep_ids), "px": int(demote.sum()),
            "ink_px": int(ink.sum()), "too_small": len(too_small),
            "regions_before": n_before, "regions_after": n_after,
            "bg_growth": (bg_after / bg_before) if bg_before else 1.0,
            "leaked": bool(leaked)}


def label_binary(mask: np.ndarray):
    """Connected components of a binary mask (8-connected), returned as
    an int32 label image (0 = background) plus the component count."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    for y0 in range(h):
        row = mask[y0]
        for x0 in range(w):
            if not row[x0] or lab[y0, x0]:
                continue
            n += 1
            stack = [(x0, y0)]
            lab[y0, x0] = n
            while stack:
                x, y = stack.pop()
                for dy in (-1, 0, 1):
                    yy = y + dy
                    if yy < 0 or yy >= h:
                        continue
                    for dx in (-1, 0, 1):
                        xx = x + dx
                        if xx < 0 or xx >= w:
                            continue
                        if mask[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = n
                            stack.append((xx, yy))
    return lab, n


def sample_reference(model, ref_path: Path, palette_hex):
    """Emit seeds by sampling a colored reference at each ANCHOR.

    Anchors, not centroids — a centroid frequently falls outside its
    own region (measured: 39 of 135 across the shipped pages), which
    means the old version of this script sampled a neighbouring shape's
    colour and confidently wrote it down.
    """
    w, h = model["w"], model["h"]
    ref = Image.open(ref_path).convert("RGB")
    if ref.size != (w, h):
        ref = ref.resize((w, h), Image.NEAREST)
    arr = np.array(ref)
    pal = [hex_to_rgb(c) for c in palette_hex]
    seeds = []
    for reg in model["regions"]:
        cx, cy = int(reg["ax"] * w), int(reg["ay"] * h)
        x0, x1 = max(0, cx - 4), min(w, cx + 5)
        y0, y1 = max(0, cy - 4), min(h, cy + 5)
        patch = arr[y0:y1, x0:x1].reshape(-1, 3)
        med = np.median(patch, axis=0)
        best, bd = 1, float("inf")
        for i, p in enumerate(pal):
            dsq = float(((med - np.array(p)) ** 2).sum())
            if dsq < bd:
                bd, best = dsq, i + 1
        seeds.append({"x": round(reg["ax"], 4), "y": round(reg["ay"], 4),
                      "ci": best})
    return seeds


def report(path: Path, args) -> int:
    if args.soften:
        out = Path(args.soften)
        if len(args.line_art) > 1:
            out = out.parent / (path.stem + "-soft.png")
        st = soften_decorative_lines(path, out, args.soften_radius)
        print("%-14s softened %d of %d thin strokes (%.1f%% of ink); "
              "regions %d -> %d -> %s"
              % (path.name, st["softened"], st["strokes"],
                 100.0 * st["px"] / st["ink_px"],
                 st["regions_before"], st["regions_after"], out))
        if st["leaked"]:
            print("  !! LEAK: the background region grew %.1fx. A "
                  "silhouette stroke was dissolved and shapes have "
                  "fallen into the background. Do NOT ship this file."
                  % st["bg_growth"])
            return 1
        path = out

    model = build_model(path)
    if model is None:
        print("%-14s NO MODEL — over %d regions, or no region above the "
              "size floor. Ink is probably too thin to seal."
              % (path.name, MAX_REGIONS))
        return 1
    f = fitness(model)
    flag = "  <-- UNREACHABLE REGIONS" if f["unreachable"] else ""
    print("%-14s %4dx%-4d regions=%-4d  numbered: 1x=%-3d 8x=%-3d  "
          "worst-zoom=%4.1fx%s"
          % (path.name, model["w"], model["h"], f["total"],
             f["fit1x"], f["fitmax"], f["worst"], flag))
    if f["unreachable"]:
        bad = [r["id"] for r in f["rows"] if r["zoom"] > ZOOM_MAX_CBN]
        print("               region ids that can never hold a number: %s"
              % bad)

    if args.map:
        out = Path(args.map)
        if len(args.line_art) > 1:          # batch: one map per page
            out = out.parent / (path.stem + "-map.png")
        write_map(model, out)
        print("               region map -> %s" % out)

    if args.reference:
        pal = ([c.strip() for c in args.palette.split(",") if c.strip()]
               if args.palette else DEFAULT_PALETTE[:])
        seeds = sample_reference(model, Path(args.reference), pal)
        payload = {"palette": pal, "regions": seeds}
        text = json.dumps(payload, indent=2)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
            print("               %d seeds -> %s" % (len(seeds), args.out))
        else:
            print(text)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Audit a coloring page for color-by-number, and "
                    "optionally emit its cbn: metadata.")
    ap.add_argument("line_art", nargs="+",
                    help="Line-art PNG(s) (alpha ink), e.g. "
                         "assets/coloring-pages/cbn/*.png")
    ap.add_argument("--reference",
                    help="Fully-coloured reference PNG to sample colours "
                         "from. Optional — tools/cbn-editor.html is the "
                         "easier route.")
    ap.add_argument("--palette",
                    help="Comma-separated hex list used with --reference.")
    ap.add_argument("--map",
                    help="Write a region map PNG (ids drawn at anchors). "
                         "With several inputs, writes <stem>-map.png next "
                         "to the path given.")
    ap.add_argument("--out", help="Write the emitted JSON here.")
    ap.add_argument("--soften", metavar="OUT.png",
                    help="Demote thin interior strokes that split an "
                         "un-numberable region from boundaries to "
                         "decoration (alpha drops below the ink "
                         "threshold, so they still render but fill "
                         "passes through), and write the result here. "
                         "Use when a page is drawn with fine interior "
                         "detail -- cactus ribs, hatching -- that "
                         "shatters it into ribbons too narrow to hold "
                         "a number.")
    ap.add_argument("--soften-radius", type=float, default=3.0,
                    help="A stroke thinner than 2x this is a candidate "
                         "(default %(default)s, i.e. under ~6px at the "
                         "1800px shipping width).")
    args = ap.parse_args()

    paths = []
    for pat in args.line_art:
        hits = sorted(glob.glob(pat))
        paths.extend(Path(p) for p in (hits if hits else [pat]))

    rc = 0
    for p in paths:
        if not p.is_file():
            print("not found: %s" % p)
            rc = 1
            continue
        rc |= report(p, args)
    return rc


if __name__ == "__main__":
    sys.exit(main())

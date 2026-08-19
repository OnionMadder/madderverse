/* ============================================================
   cbn-core.js — Tiny Canvas color-by-number region model.

   ONE definition of "what is a region", shared by the game
   (game.js §4d) and the authoring tool (tools/cbn-editor.html).
   They used to be two separate implementations that drifted;
   if you change a rule here, both move together.

   Plain script, one global, no bundler — same shape as
   templates.js. Loaded BEFORE game.js.

   ── Why this exists in image space ──────────────────────────

   The first CBN engine derived regions from the game's FILL
   MASK. That mask is rasterized at canvas-backing-store
   resolution with the artwork drawn at its current on-screen
   rect, which means:

     • a phone and a desktop detect different region sets on
       the same page (the old area floor was a fixed 400 device
       px against a viewport-sized mask), and
     • zooming changes the art's rect, so at 4x the mask is a
       CROP of the zoomed art — region identity itself moves
       when you zoom.

   So CBN cannot be built on it. This module rasterizes the
   source PNG once at a FIXED working width, independent of
   viewport, zoom and device. Region ids are then stable enough
   to persist in a save file, and the editor sees exactly the
   region set the game will.

   ── What a region carries ───────────────────────────────────

   Anchors are the POLE OF INACCESSIBILITY — the centre of the
   largest circle that fits inside the shape — not the centroid.
   A centroid is the centre of MASS, and a background that wraps
   around a subject has its centre of mass sitting on top of the
   subject. Measured across the 8 shipped CBN pages, centroids
   put 39 of 135 numbers outside their own shape; poles put 0.

   The inscribed radius that falls out of the same computation
   is what lets the runtime size a number to its region and hide
   it when the region is too small to hold one legibly.
   ============================================================ */

window.TinyCanvasCBN = (function () {
    "use strict";

    /* Ink threshold. Must match FILL_BOUNDARY_ALPHA in game.js
       and INK_ALPHA in scripts/process-cbn-page.py — the fill
       tool and the region model have to agree on where a line
       is, or a number ends up in a region the kid cannot fill. */
    const INK_ALPHA = 96;

    /* Fixed working width for the model. The shipped pages are
       1800px wide; 1024 keeps the label map near 1.2MB while
       staying well above the point where thin ink starts
       breaking (the audit in scripts/process-coloring-pages.py
       tests down to 900). Both the game and the editor must use
       this same number or their region ids diverge. */
    const WORK_W = 1024;

    /* Minimum region area as a FRACTION of page area, not a pixel
       count — a pixel count is resolution-dependent, which is the
       bug this replaces. Tuned to reproduce the region counts the
       old fixed 400px floor produced at its 1280x720 reference. */
    const MIN_AREA_FRAC = 4.3e-4;

    /* Sanity ceiling. Not a design limit — a page that detects
       more regions than this has ink so fine it has shattered
       into speckle, and should be fixed in the art, not shipped.
       (The old engine silently truncated to 40, which quietly
       dropped real regions off the end of a page.) */
    const MAX_REGIONS = 120;

    /* The page edge is a boundary: the scenes are full-bleed, so
       sky/floor regions run to the image border and would
       otherwise merge with whatever is outside. Same rule as
       markPageBorder() in game.js's buildFillMask. */
    const BORDER_INK = 2;

    /* ---------- model construction ---------- */

    /* src: HTMLImageElement (loaded) or HTMLCanvasElement.
       opts.workW: override the working width (the audit script
       uses this to compare against native resolution).

       Returns { w, h, labels, regions, minArea } where
         labels  Int16Array w*h, -1 = ink or sub-threshold speck,
                 else a region id (an index into regions)
         regions [{ id, area, ax, ay, r, x0, y0, x1, y1 }]
                 ax/ay  anchor, normalized 0..1
                 r      inscribed radius, normalized to WIDTH
                        (so screenRadius = r * artWidthOnScreen)
                 x0..y1 bbox, normalized

       Returns null if the source has no intrinsic size yet. */
    function buildModel(src, opts) {
        opts = opts || {};
        const nw = src.naturalWidth || src.width;
        const nh = src.naturalHeight || src.height;
        if (!nw || !nh) return null;

        const workW = opts.workW || WORK_W;
        const w = Math.max(1, Math.min(workW, nw));
        const h = Math.max(1, Math.round(nh * (w / nw)));

        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const o = off.getContext("2d", { willReadFrequently: true });
        o.clearRect(0, 0, w, h);
        o.drawImage(src, 0, 0, w, h);

        let data;
        try {
            data = o.getImageData(0, 0, w, h).data;
        } catch (_) {
            /* Tainted canvas — only possible if the art is served
               cross-origin, which it never is. Fail soft: no model
               means the page just behaves as a freehand page. */
            return null;
        }

        const ink = new Uint8Array(w * h);
        for (let i = 0, a = 3; i < ink.length; i++, a += 4) {
            if (data[a] >= INK_ALPHA) ink[i] = 1;
        }
        sealBorder(ink, w, h);

        const minArea = Math.max(1, Math.round(MIN_AREA_FRAC * w * h));
        const labels = labelRegions(ink, w, h, minArea);
        if (!labels) return null;

        const regions = labels.regions;
        if (!regions.length) return null;

        anchorRegions(ink, labels.map, regions, w, h);

        return {
            w: w,
            h: h,
            labels: labels.map,
            regions: regions,
            minArea: minArea
        };
    }

    /* Treat the outermost BORDER_INK rows/columns as ink. */
    function sealBorder(ink, w, h) {
        for (let t = 0; t < BORDER_INK; t++) {
            if (t >= h || t >= w) break;
            const yTop = t * w, yBot = (h - 1 - t) * w;
            for (let x = 0; x < w; x++) {
                ink[yTop + x] = 1;
                ink[yBot + x] = 1;
            }
            for (let y = 0; y < h; y++) {
                ink[y * w + t] = 1;
                ink[y * w + (w - 1 - t)] = 1;
            }
        }
    }

    /* Scanline connected-component labeling, 4-connected, over
       non-ink pixels. Ported from the old cbnDetectRegions but
       KEEPING the per-pixel label map — throwing it away is what
       forced the old engine into a nearest-centroid guess for
       "which region did this tap land in".

       Components below minArea are labeled -1: they are specks
       between antialiased strokes, or genuine hairline detail.
       Either way they get no number and no completion
       requirement — the kid colours them however they like. */
    function labelRegions(ink, w, h, minArea) {
        const map = new Int16Array(w * h).fill(-1);
        const seen = new Uint8Array(w * h);
        const regions = [];
        const stack = [];

        for (let y0 = 0; y0 < h; y0++) {
            for (let x0 = 0; x0 < w; x0++) {
                const start = y0 * w + x0;
                if (seen[start] || ink[start]) continue;

                /* Provisional id; committed only if big enough. */
                const id = regions.length;
                const px = [];
                let area = 0;
                let minX = x0, minY = y0, maxX = x0, maxY = y0;

                stack.length = 0;
                stack.push(start);
                while (stack.length) {
                    const seed = stack.pop();
                    const py = (seed / w) | 0;
                    let x = seed - py * w;
                    while (x > 0 && !seen[py * w + x - 1] &&
                           !ink[py * w + x - 1]) x--;
                    let up = false, dn = false;
                    while (x < w) {
                        const j = py * w + x;
                        if (seen[j] || ink[j]) break;
                        seen[j] = 1;
                        px.push(j);
                        area++;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (py < minY) minY = py;
                        if (py > maxY) maxY = py;
                        if (py > 0) {
                            const u = j - w;
                            const openU = !seen[u] && !ink[u];
                            if (openU && !up) { stack.push(u); up = true; }
                            else if (!openU) { up = false; }
                        }
                        if (py < h - 1) {
                            const d = j + w;
                            const openD = !seen[d] && !ink[d];
                            if (openD && !dn) { stack.push(d); dn = true; }
                            else if (!openD) { dn = false; }
                        }
                        x++;
                    }
                }

                if (area < minArea) continue;   /* stays -1 */

                for (let k = 0; k < px.length; k++) map[px[k]] = id;
                regions.push({
                    id: id,
                    area: area,
                    ax: 0, ay: 0, r: 0,
                    x0: minX / w, y0: minY / h,
                    x1: (maxX + 1) / w, y1: (maxY + 1) / h
                });

                if (regions.length > MAX_REGIONS) return null;
            }
        }
        return { map: map, regions: regions };
    }

    /* Chamfer 3-4 distance transform, then per region take the
       pixel furthest from any ink — the pole of inaccessibility.
       Two sequential sweeps, so this is O(w*h) with no queue.

       Distances are held in thirds (the 3-4 kernel) and divided
       out at the end; a chamfer approximation is within a few
       percent of true Euclidean, far tighter than we need to
       decide whether a number fits.

       Each region also records the horizontal and vertical RUN
       through its anchor. The inscribed circle alone is far too
       pessimistic for a ribbon: a digit is tall and narrow, so a
       tall narrow region can hold one long before a circle of that
       diameter fits. Measured on the sunny-day page, judging by the
       circle showed 4 numbers at phone size; judging by the runs
       shows 22. Both are normalized to WIDTH so one scale factor
       (the art's on-screen width) converts either to pixels. */
    function anchorRegions(ink, map, regions, w, h) {
        const INF = 0x3fffffff;
        const dist = new Int32Array(w * h);
        for (let i = 0; i < dist.length; i++) {
            dist[i] = ink[i] ? 0 : INF;
        }

        /* Forward: W, NW, N, NE */
        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                const i = row + x;
                if (!dist[i]) continue;
                let d = dist[i];
                if (x > 0)              d = Math.min(d, dist[i - 1] + 3);
                if (y > 0) {
                    if (x > 0)          d = Math.min(d, dist[i - w - 1] + 4);
                                        d = Math.min(d, dist[i - w] + 3);
                    if (x < w - 1)      d = Math.min(d, dist[i - w + 1] + 4);
                }
                dist[i] = d;
            }
        }
        /* Backward: E, SE, S, SW */
        for (let y = h - 1; y >= 0; y--) {
            const row = y * w;
            for (let x = w - 1; x >= 0; x--) {
                const i = row + x;
                if (!dist[i]) continue;
                let d = dist[i];
                if (x < w - 1)          d = Math.min(d, dist[i + 1] + 3);
                if (y < h - 1) {
                    if (x < w - 1)      d = Math.min(d, dist[i + w + 1] + 4);
                                        d = Math.min(d, dist[i + w] + 3);
                    if (x > 0)          d = Math.min(d, dist[i + w - 1] + 4);
                }
                dist[i] = d;
            }
        }

        const best = new Int32Array(regions.length);   /* best distance */
        const at = new Int32Array(regions.length).fill(-1);
        for (let i = 0; i < map.length; i++) {
            const id = map[i];
            if (id < 0) continue;
            const d = dist[i];
            if (d > best[id]) { best[id] = d; at[id] = i; }
        }

        for (let k = 0; k < regions.length; k++) {
            const i = at[k];
            const reg = regions[k];
            if (i < 0) {
                /* Cannot happen for a region with area >= 1, but a
                   region with no anchor would place a number at
                   (0,0) — degrade to the bbox centre instead. */
                reg.ax = (reg.x0 + reg.x1) / 2;
                reg.ay = (reg.y0 + reg.y1) / 2;
                reg.r = 0;
                reg.hw = 0;
                reg.vh = 0;
                continue;
            }
            const y = (i / w) | 0;
            const x = i - y * w;
            reg.ax = (x + 0.5) / w;
            reg.ay = (y + 0.5) / h;
            reg.r = (best[k] / 3) / w;   /* normalized to WIDTH */

            /* Run lengths through the anchor, in this region only. */
            let x0 = x, x1 = x;
            while (x0 > 0     && map[y * w + x0 - 1] === reg.id) x0--;
            while (x1 < w - 1 && map[y * w + x1 + 1] === reg.id) x1++;
            let y0 = y, y1 = y;
            while (y0 > 0     && map[(y0 - 1) * w + x] === reg.id) y0--;
            while (y1 < h - 1 && map[(y1 + 1) * w + x] === reg.id) y1++;
            reg.hw = (x1 - x0 + 1) / w;   /* both normalized to WIDTH */
            reg.vh = (y1 - y0 + 1) / w;
        }
    }

    /* ---------- lookup ---------- */

    /* Normalized page coords -> region id, or -1 for ink, a
       speck, or off-page. O(1): this is the whole point of
       keeping the label map. */
    function regionAt(model, nx, ny) {
        if (!model) return -1;
        if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) return -1;
        const x = Math.min(model.w - 1, Math.max(0, (nx * model.w) | 0));
        const y = Math.min(model.h - 1, Math.max(0, (ny * model.h) | 0));
        return model.labels[y * model.w + x];
    }

    /* ---------- authored colour assignment ---------- */

    /* seeds: [{ x, y, ci }] in normalized page coords, as emitted
       by the editor. Each seed is a region ANCHOR, so it is
       guaranteed to sit inside its region — that is what makes
       this mapping reliable where sampling a centroid was not.

       Returns an Int16Array indexed by region id holding the
       1-based palette index, 0 = unassigned. Also returns the
       count of seeds that failed to land, so the editor and the
       audit can shout about a stale export. */
    function assignFromSeeds(model, seeds) {
        const byRegion = new Int16Array(model.regions.length);
        let missed = 0;
        for (let i = 0; i < seeds.length; i++) {
            const s = seeds[i];
            const id = regionAt(model, s.x, s.y);
            if (id < 0) { missed++; continue; }
            byRegion[id] = s.ci | 0;
        }
        return { byRegion: byRegion, missed: missed };
    }

    /* Assignment from a function of the region's anchor. Kept so
       hand-authored `assign(cx, cy)` rules still work; the editor
       emits seeds instead. */
    function assignFromFn(model, fn, paletteN) {
        const byRegion = new Int16Array(model.regions.length);
        for (let i = 0; i < model.regions.length; i++) {
            const reg = model.regions[i];
            let ci = fn(reg.ax, reg.ay, model.w, model.h);
            if (typeof ci !== "number" || ci < 1 || ci > paletteN) ci = 1;
            byRegion[reg.id] = ci;
        }
        return { byRegion: byRegion, missed: 0 };
    }

    /* ---------- label fit ---------- */

    /* How big a number can this region hold, and in which style?

       Two styles, because the pill is what makes a number readable
       over any colour but its rounded background needs far more room
       than the digit does:

         "pill" — the normal badge: paper-coloured capsule, dark
                  outline. Needs ~1.7em square.
         "slim" — glyph only, with a halo instead of a capsule. Needs
                  little more than the digit itself. This is what
                  lets a narrow ribbon (a cactus rib, a rainbow band)
                  carry a number at all.

       Sizes are in em of the font, measured against the region's
       run through its anchor. Judging by the inscribed circle
       instead — which is what the first version of this engine did —
       is far too strict for anything ribbon-shaped, because a digit
       is tall and narrow and so is a ribbon.

       Returns { mode: "pill"|"slim"|"none", font } with font in
       on-screen px. */
    const FONT_MIN = 9;
    const FONT_MAX = 26;
    /* em multiples of the font size that each style needs. */
    const PILL_W = [1.7, 2.1];   /* [1 digit, 2 digits] */
    const PILL_H = 1.7;
    const SLIM_W = [0.75, 1.35];
    const SLIM_H = 1.15;

    function labelFit(reg, artWidth, digits, opts) {
        opts = opts || {};
        const fmin = opts.fontMin || FONT_MIN;
        const fmax = opts.fontMax || FONT_MAX;
        const d = (digits >= 2) ? 1 : 0;
        const availW = reg.hw * artWidth;
        const availH = reg.vh * artWidth;   /* vh is width-normalized too */

        const pill = Math.min(availW / PILL_W[d], availH / PILL_H);
        if (pill >= fmin) {
            return { mode: "pill", font: Math.min(pill, fmax) };
        }
        const slim = Math.min(availW / SLIM_W[d], availH / SLIM_H);
        if (slim >= fmin) {
            return { mode: "slim", font: Math.min(slim, fmax) };
        }
        return { mode: "none", font: 0 };
    }

    /* The zoom at which this region can first show a number. */
    function zoomToShow(reg, artWidth, digits, maxZoom) {
        if (labelFit(reg, artWidth, digits).mode !== "none") return 1;
        /* fit scales linearly with artWidth, so binary-search-free:
           find the factor that lifts the larger of the two styles to
           the floor. */
        const d = (digits >= 2) ? 1 : 0;
        const slim = Math.min((reg.hw * artWidth) / SLIM_W[d],
                              (reg.vh * artWidth) / SLIM_H);
        if (slim <= 0) return Infinity;
        const z = FONT_MIN / slim;
        return z > maxZoom ? Infinity : Math.max(1, z);
    }

    /* ---------- fitness ---------- */

    /* Can this page actually be played as color-by-number?

       A number needs room. `minR` is the on-screen inscribed
       radius (px) below which a digit is not legible; a region's
       on-screen radius is r * artWidth, and zooming multiplies
       it. So the zoom a region needs is minR / (r * artWidth).

       opts.artWidth  displayed art width in CSS px (default 366,
                      a phone) — the tight case, since a page that
                      works on a phone works everywhere.
       opts.minR      legibility floor (default 7).
       opts.maxZoom   the app's ceiling (default 8).

       Returns { total, fitAt1x, fitAtMax, unreachable, worstZoom,
                 rows:[{ id, r, screenR, zoomNeeded, ok }] }. */
    function fitnessReport(model, opts) {
        opts = opts || {};
        const artWidth = opts.artWidth || 366;
        const maxZoom = opts.maxZoom || 8;
        /* Digit count per region, when known — a two-digit number
           needs a wider region than a one-digit one. Callers that
           have assigned colours should pass byRegion. */
        const byRegion = opts.byRegion || null;

        const rows = [];
        let fitAt1x = 0, fitAtMax = 0, worstZoom = 1;
        for (let i = 0; i < model.regions.length; i++) {
            const reg = model.regions[i];
            const ci = byRegion ? byRegion[reg.id] : 1;
            const digits = (ci >= 10) ? 2 : 1;
            const fit = labelFit(reg, artWidth, digits);
            const zoomNeeded = zoomToShow(reg, artWidth, digits, maxZoom);
            if (fit.mode !== "none") fitAt1x++;
            if (zoomNeeded !== Infinity) fitAtMax++;
            if (zoomNeeded !== Infinity && zoomNeeded > worstZoom) {
                worstZoom = zoomNeeded;
            }
            rows.push({
                id: reg.id,
                r: reg.r,
                mode: fit.mode,
                font: fit.font,
                zoomNeeded: zoomNeeded,
                ok: zoomNeeded !== Infinity
            });
        }
        return {
            total: model.regions.length,
            fitAt1x: fitAt1x,
            fitAtMax: fitAtMax,
            unreachable: model.regions.length - fitAtMax,
            worstZoom: worstZoom,
            rows: rows
        };
    }

    return {
        INK_ALPHA: INK_ALPHA,
        WORK_W: WORK_W,
        MIN_AREA_FRAC: MIN_AREA_FRAC,
        MAX_REGIONS: MAX_REGIONS,
        FONT_MIN: FONT_MIN,
        FONT_MAX: FONT_MAX,
        buildModel: buildModel,
        regionAt: regionAt,
        assignFromSeeds: assignFromSeeds,
        assignFromFn: assignFromFn,
        labelFit: labelFit,
        zoomToShow: zoomToShow,
        fitnessReport: fitnessReport
    };
})();

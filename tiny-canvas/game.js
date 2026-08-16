/* ============================================================
   Tiny Canvas — drawing engine, audio, gallery, screen switcher
   ============================================================
   Pattern follows pootery/game.js:
     - Single IIFE, no globals beyond window.TINY_CANVAS_TEMPLATES.
     - DPR-aware canvas sized to a logical 800×800 box.
     - Web Audio synthesized SFX, lazy-init on first user gesture.
     - Screens swap via the [hidden] attribute on <main class="screen">.
     - Gallery persisted to localStorage as JSON of {id, name, date,
       template, png(dataURL)} records.
   ============================================================ */

(function () {
    "use strict";

    /* ---------- 0. CONFIG ---------- */

    /* Canvas now fills the viewport — STAGE_W / STAGE_H are recomputed
       at setupCanvas() from window.innerWidth / window.innerHeight.
       These exports stay so the rest of the codebase can reference
       "the canvas's logical size in CSS pixels" but they're no longer
       constants. */
    let STAGE_W = 800;
    let STAGE_H = 800;

    /* Long-side of the rasterized PNG produced by composePng().
       Independent of viewport — keeps saved + autosaved files at a
       bounded size regardless of device aspect or pixel density. */
    const SAVE_LONG_SIDE = 1024;

    /* Color palette — grouped so kids find a color by category instead
       of scrolling one long row. The pink/teal canon anchors RAINBOW.

       `free: true` groups are the base set every kid gets (43 colors +
       the custom picker), so NO color is ever locked away — the custom
       swatch alone covers the whole spectrum. The themed groups without
       the flag are Pro: curated palettes that pair with the Pro page
       categories (an OCEAN palette for the ocean scenes, GALAXY for
       space, and so on). Availability is filtered by availableColorGroups().

       ⚠ Fill tells colors apart at euclidean distance 6 (TOL2 = 36 in
       floodFillAt). Every color here — across ALL groups, since a kid
       mixes groups in one drawing — sits >13 from every other. If you
       add colors, re-run the pairwise check (min distance must stay
       well above 6) before shipping. */
    const COLOR_GROUPS = {
        /* Renamed from "rainbow" to "brights" (2026-08-14) after Bala,
           testing on the paid Android app, tapped the RAINBOW palette
           tab expecting rainbow strokes and got a colour-selector swap.
           Two things labelled RAINBOW in the same tray — one draws
           rainbow (the brush), one just swaps swatches (this tab) —
           was a real UX trap for early readers. The word RAINBOW is
           now reserved for the brush; this palette gets BRIGHTS, which
           is honest about what's in it (saturated primaries) and reads
           at kid grade level. The RAINBOW brush moved from Pro to free
           in the same change so tapping RAINBOW does the same thing
           for every kid regardless of purchase. `activeColorGroup()`
           auto-migrates existing users with `colorGroup: "rainbow"`
           to the first available group (which is this one), so no
           schema bump or storage migration was needed. */
        brights: {
            label: "BRIGHTS", free: true,
            colors: [
                "#ff2e88", "#ff4d4d", "#ff7a1f", "#ff9d42",
                "#ffd23f", "#9be15d", "#1ac88a", "#00ffcc",
                "#4fc3f7", "#5b6cff", "#a86bff", "#1c2226"
            ]
        },
        pastels: {
            label: "PASTELS", free: true,
            colors: [
                "#ffcbe0", "#ffd6c2", "#ffe9a8", "#f0f4a8",
                "#c8f0c8", "#b6efe6", "#bfe2ff", "#cfd2ff",
                "#e6cfff", "#ffd9ec"
            ]
        },
        neons: {
            label: "NEONS", free: true,
            colors: [
                "#ff0080", "#ff5500", "#ffea00", "#00ff5e",
                "#00b0ff", "#7a00ff", "#ff00d4"
            ]
        },
        earth: {
            label: "EARTH", free: true,
            colors: [
                "#4a2510", "#6b3a1a", "#a05a2c", "#c98a52",
                "#e2b888", "#6b7a4a", "#8a9a5b", "#3a5a4a"
            ]
        },
        metallic: {
            label: "METALLIC", free: true,
            colors: [
                "#d4af37",   /* gold */
                "#c0c0c0",   /* silver */
                "#b87333",   /* copper */
                "#8c7853",   /* bronze */
                "#e5e4e2",   /* platinum */
                "#fff"       /* white */
            ]
        },

        /* ---- Pro: themed palettes that pair with the categories ---- */
        ocean: {
            label: "OCEAN",   /* ocean scenes: deep sea -> shallows -> shore */
            colors: [
                "#012a4a", "#01579b", "#0288d1", "#26c6da",
                "#4dd6b8", "#80deea", "#ff8a65", "#ffe0b2"
            ]
        },
        galaxy: {
            label: "GALAXY",  /* space scenes: nebula, cosmos, starlight */
            colors: [
                "#1a0b3d", "#4a148c", "#8e24aa", "#c2185b",
                "#3949ab", "#ff4081", "#ffd54f", "#b0bec5"
            ]
        },
        garden: {
            label: "GARDEN",  /* bugs, animals, backyard: leaves + blooms */
            colors: [
                "#2e7d32", "#66bb6a", "#9ccc65", "#d32f2f",
                "#f06292", "#64b5f6", "#8d6e63", "#f9a825"
            ]
        },
        frost: {
            label: "FROST",   /* snowflakes + winter: ice and slate */
            colors: [
                "#e1f5fe", "#a6daf0", "#81d4fa", "#5eb3e4",
                "#9fa8da", "#cfd8dc", "#607d8b", "#2e4a5a"
            ]
        },
        jungle: {
            label: "JUNGLE",  /* dinosaurs: prehistoric moss, bark, amber */
            colors: [
                "#33691e", "#558b2f", "#7cb342", "#00695c",
                "#5d4037", "#a1887f", "#c9b8a8", "#ffb300"
            ]
        },
        sunset: {
            label: "SUNSET",  /* tropical places + warmth: dusk over the shore */
            colors: [
                "#bf360c", "#e64a19", "#ff7043", "#ff9800",
                "#ffb74d", "#ec407a", "#ffca28", "#880e4f"
            ]
        }
    };

    /* Brush sizes: 5 for the painting tools, 3 for eraser. Per-tool
       state so each remembers its own size between switches. */
    const BRUSH_SIZES  = [4, 10, 18, 28, 42];
    const ERASER_SIZES = [14, 28, 50];

    const STORAGE_KEY        = "tinyCanvas.gallery.v1";
    const SETTINGS_KEY       = "tinyCanvas.settings.v1";
    const IN_PROGRESS_KEY    = "tinyCanvas.inProgress.v1";
    const FIRST_SAVE_KEY     = "tinyCanvas.firstSaveCelebrated.v1";
    const ERASE_TIP_KEY      = "tinyCanvas.eraseTipShown.v1";
    const GATE_UNLOCKED_KEY  = "tinyCanvas.parentGate.unlockedUntil.v1";
    /* Pro unlock flag — "1" once the one-off purchase is made. Only
       consulted on NATIVE: the web build always has everything (it is
       the showcase/trial, same call Slip Studio made). Billing will
       set this via RevenueCat later; until then native stays free-tier.
       See isPro(). */
    const PRO_KEY            = "tinyCanvas.pro.v1";
    /* History entries are dirty-rect ImageData patches, not full-canvas
       snapshots — see the HISTORY section for why. Cheap enough to
       afford real depth; the byte budget is the backstop for the rare
       full-canvas entry (a CLEAR). */
    const MAX_HISTORY          = 30;
    const HISTORY_BYTE_BUDGET  = 24 * 1024 * 1024;
    /* Logical-px slack added around every stroke's dirty rect. Covers
       brushes that paint wider than their nominal nib: glitter throws
       sparkles to size/2 + ~2.4, paint stacks passes wider than the
       line. Cheap insurance — an under-sized rect leaves stray marks
       behind after an undo. */
    const STROKE_BOUNDS_SLACK  = 12;
    const SAVE_MAX           = 60;     /* gallery item cap */
    const AUTOSAVE_INTERVAL_MS = 60_000;

    /* Time-lapse replay caps. Serialized alongside each gallery record
       so a kid can play back their drawing forming. Sized to keep an
       average drawing under ~15KB serialized while still capturing a
       reasonable session. See §4c. */
    const REPLAY_MAX_EVENTS       = 300;
    const REPLAY_STROKE_SAMPLE_MS = 25;    /* min gap between stored samples */
    const REPLAY_MAX_STROKE_PTS   = 400;   /* per stroke cap */
    const GATE_UNLOCK_MS     = 24 * 60 * 60 * 1000;  /* 24h persistent unlock */

    /* ---------- 0a. BRUSH DEFINITIONS ----------
       Each brush implements:
         beginStroke(ctx, p, size, color) — fires on pointerdown.
           Sets composite mode + lays the initial dot.
         drawSegment(ctx, p0, p1, size, color) — fires on pointermove.
           Draws one segment of the stroke from p0 to p1.
       The pointer handler is brush-agnostic — it just routes events
       to whichever brush is active. Adding a new brush = adding an
       entry here + a tool button in the DOM. */

    /* Helper: distance between two points. */
    function dist(p0, p1) {
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /* Helper: linearly interpolated points along a segment.
       Returns count steps from p0 toward p1 (exclusive of p0,
       inclusive of p1). Used by textured brushes that stamp
       dabs along the path instead of drawing a vector line.   */
    function interp(p0, p1, count) {
        const out = [];
        for (let i = 1; i <= count; i++) {
            const t = i / count;
            out.push({ x: p0.x + (p1.x - p0.x) * t,
                       y: p0.y + (p1.y - p0.y) * t });
        }
        return out;
    }

    const BRUSHES = {
        /* PEN, MARKER, PENCIL and PAINT were retired 2026-08-09 —
           they read as redundant variants of a solid-colour stroke.
           CRAYON kept as the textured default; GLITTER for the
           sparkle novelty; RAINBOW is a free brush too (moved from Pro
           2026-08-14 — see COLOR_GROUPS note). The three Pro brushes
           (SPRAY / GLOW / SMUDGE) do the rest. */
        crayon: {
            /* Stippled-grain texture. Dabs along the path with small
               random offsets at moderate alpha — multiple dabs per
               segment build up the waxy/grainy look. */
            label:       "CRAYON",
            alpha:       0.45,
            defaultSize: 18,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 1;
                ctx.fillStyle   = color;
                this._stampDot(ctx, p.x, p.y, size);
            },
            drawSegment: function (ctx, p0, p1, size) {
                const d = dist(p0, p1);
                const steps = Math.max(1, Math.ceil(d / (size * 0.18)));
                const pts = interp(p0, p1, steps);
                for (let i = 0; i < pts.length; i++) {
                    this._stampDot(ctx, pts[i].x, pts[i].y, size);
                }
            },
            _stampDot: function (ctx, x, y, size) {
                /* Three offset dabs per stamp produce the wax-edge look. */
                const r = size / 2;
                const jitter = r * 0.45;
                for (let k = 0; k < 3; k++) {
                    const ox = (Math.random() - 0.5) * jitter;
                    const oy = (Math.random() - 0.5) * jitter;
                    const rr = r * (0.62 + Math.random() * 0.38);
                    ctx.beginPath();
                    ctx.arc(x + ox, y + oy, rr, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        glitter: {
            /* Translucent color base + bright white sparkle dabs at
               random positions along the path. Reads as "shimmery"
               without needing actual animation. */
            label:       "GLITTER",
            alpha:       0.55,
            defaultSize: 18,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                /* Tinted soft base */
                ctx.globalAlpha = 1;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
                ctx.fill();
                this._sparkles(ctx, p.x, p.y, size);
            },
            drawSegment: function (ctx, p0, p1, size, color) {
                /* Soft tinted base stroke */
                ctx.globalAlpha = 1;
                ctx.strokeStyle = color;
                ctx.lineWidth   = size;
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
                /* Sparkles scattered along the segment */
                const d = dist(p0, p1);
                const sparkleCount = Math.max(1, Math.floor(d / (size * 0.4)));
                const pts = interp(p0, p1, sparkleCount);
                for (let i = 0; i < pts.length; i++) {
                    this._sparkles(ctx, pts[i].x, pts[i].y, size);
                }
            },
            _sparkles: function (ctx, x, y, size) {
                const r = size / 2;
                const n = 2 + Math.floor(Math.random() * 3);
                for (let k = 0; k < n; k++) {
                    const ang = Math.random() * Math.PI * 2;
                    const dst = Math.random() * r;
                    const sx = x + Math.cos(ang) * dst;
                    const sy = y + Math.sin(ang) * dst;
                    const sr = 0.8 + Math.random() * 1.6;
                    ctx.globalAlpha = 0.55 + Math.random() * 0.35;
                    ctx.fillStyle   = "#ffffff";
                    ctx.beginPath();
                    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        /* ---- Pro brushes (see isPro() — always on for web) ---- */

        spray: {
            /* Spray-paint mist: fine dots scattered in a disc along the
               path. Dots land opaque on the wet layer, so overlaps
               within one stroke don't darken; the composite alpha
               gives the whole mist a soft look. */
            label:       "SPRAY",
            alpha:       0.85,
            defaultSize: 28,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 1;
                ctx.fillStyle = color;
                this._mist(ctx, p.x, p.y, size);
            },
            drawSegment: function (ctx, p0, p1, size) {
                const d = dist(p0, p1);
                const steps = Math.max(1, Math.ceil(d / (size * 0.3)));
                const pts = interp(p0, p1, steps);
                for (let i = 0; i < pts.length; i++) {
                    this._mist(ctx, pts[i].x, pts[i].y, size);
                }
            },
            _mist: function (ctx, x, y, size) {
                const r = size * 0.7;
                const n = 6 + Math.floor(size * 0.5);
                for (let k = 0; k < n; k++) {
                    /* sqrt puts more dots near the center, like a real
                       spray cone */
                    const ang = Math.random() * Math.PI * 2;
                    const dst = Math.sqrt(Math.random()) * r;
                    const dr  = 0.7 + Math.random() * 1.3;
                    ctx.beginPath();
                    ctx.arc(x + Math.cos(ang) * dst,
                            y + Math.sin(ang) * dst, dr, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        rainbow: {
            /* Hue cycles with distance travelled, so a long swoop lays
               down a whole rainbow. Ignores the armed color entirely —
               that IS the toy. Hue cursor lives on state (reset each
               stroke, random start so two strokes differ). */
            label:       "RAINBOW",
            alpha:       1,
            defaultSize: 18,
            beginStroke: function (ctx, p, size) {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 1;
                ctx.lineCap  = "round";
                ctx.lineJoin = "round";
                ctx.lineWidth = size;
                state.rainbowHue = Math.floor(Math.random() * 360);
                ctx.fillStyle = "hsl(" + state.rainbowHue + ",95%,60%)";
                ctx.beginPath();
                ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
                ctx.fill();
            },
            drawSegment: function (ctx, p0, p1, size) {
                /* Subdivide so the hue advances in ~5px slices — a fast
                   swipe delivers long segments, and one hue per segment
                   reads as banded color blocks instead of a gradient. */
                const d = dist(p0, p1);
                const slices = Math.max(1, Math.ceil(d / 5));
                const rate = 360 / (size * 18);   /* one cycle per ~18 widths */
                ctx.lineWidth = size;
                let from = p0;
                for (let i = 1; i <= slices; i++) {
                    const t = i / slices;
                    const to = { x: p0.x + (p1.x - p0.x) * t,
                                 y: p0.y + (p1.y - p0.y) * t };
                    state.rainbowHue =
                        (state.rainbowHue + dist(from, to) * rate) % 360;
                    ctx.strokeStyle =
                        "hsl(" + Math.round(state.rainbowHue) + ",95%,60%)";
                    ctx.beginPath();
                    ctx.moveTo(from.x, from.y);
                    ctx.lineTo(to.x, to.y);
                    ctx.stroke();
                    from = to;
                }
            }
        },

        glow: {
            /* Neon: a wide soft halo in the armed color under a bright
               near-white core, baked into the bitmap so save/export
               keep it (no CSS filters).

               Unlike PAINT this can't stroke per segment: translucent
               passes double-darken where round caps overlap the
               previous segment, and the halo turns into a chain of
               beads. So GLOW keeps the whole stroke's point list and
               redraws the FULL path each move — clearing the wet
               layer first makes that free of accumulation, and one
               stroke() per pass has no interior joints to darken. */
            label:       "GLOW",
            alpha:       1,   /* passes carry their own alphas */
            defaultSize: 18,
            beginStroke: function (ctx, p, size, color) {
                this._pts = [{ x: p.x, y: p.y }];
                this._redraw(ctx, size, color);
            },
            drawSegment: function (ctx, p0, p1, size, color) {
                this._pts.push({ x: p1.x, y: p1.y });
                this._redraw(ctx, size, color);
            },
            _redraw: function (ctx, size, color) {
                clearStrokeLayer();
                ctx.globalCompositeOperation = "source-over";
                ctx.lineCap  = "round";
                ctx.lineJoin = "round";
                const passes = [
                    { w: size * 2.4,  a: 0.14 },
                    { w: size * 1.35, a: 0.32 },
                    { w: size * 0.72, a: 0.95 },
                    { w: size * 0.30, a: 0.65, white: true }
                ];
                const pts = this._pts;
                for (let i = 0; i < passes.length; i++) {
                    ctx.globalAlpha  = passes[i].a;
                    ctx.strokeStyle  = passes[i].white ? "#ffffff" : color;
                    ctx.fillStyle    = ctx.strokeStyle;
                    ctx.lineWidth    = passes[i].w;
                    if (pts.length === 1) {
                        ctx.beginPath();
                        ctx.arc(pts[0].x, pts[0].y, passes[i].w / 2,
                                0, Math.PI * 2);
                        ctx.fill();
                        continue;
                    }
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let k = 1; k < pts.length; k++) {
                        ctx.lineTo(pts[k].x, pts[k].y);
                    }
                    ctx.stroke();
                }
            }
        },

        smudge: {
            /* Finger-smear: samples a patch of the ACTUAL canvas and
               drags it along the stroke at partial alpha. Has to read
               what is already painted, so it draws direct on the main
               context — `direct` keeps it off the wet layer (which
               only holds the in-flight stroke). */
            label:       "SMUDGE",
            alpha:       1,
            direct:      true,
            defaultSize: 28,
            beginStroke: function (ctx, p, size) {
                /* nothing to lay down — the smear starts on move */
            },
            drawSegment: function (ctx, p0, p1, size) {
                const d = dist(p0, p1);
                const steps = Math.min(6, Math.max(1, Math.ceil(d / (size * 0.25))));
                const pts = interp(p0, p1, steps);
                let from = p0;
                for (let i = 0; i < pts.length; i++) {
                    this._smear(ctx, from, pts[i], size);
                    from = pts[i];
                }
            },
            _smear: function (ctx, from, to, size) {
                const dpr = state.dpr || 1;
                const rDev = Math.round(size * dpr / 2);
                const side = rDev * 2;
                if (!this._patch || this._patch.width < side) {
                    this._patch = document.createElement("canvas");
                    this._patch.width = this._patch.height = side;
                    this._pctx = this._patch.getContext("2d");
                } else if (this._patch.width !== side) {
                    /* keep the buffer at the largest size seen; draw
                       into the top-left side x side corner below */
                }
                const pc = this._pctx;
                pc.clearRect(0, 0, side, side);
                pc.drawImage(canvas,
                    Math.round(from.x * dpr) - rDev,
                    Math.round(from.y * dpr) - rDev,
                    side, side, 0, 0, side, side);
                ctx.save();
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 0.45;
                ctx.beginPath();
                ctx.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(this._patch, 0, 0, side, side,
                    to.x - size / 2, to.y - size / 2, size, size);
                ctx.restore();
            }
        },

        /* FILL is not a stroke tool — it has no beginStroke/drawSegment
           and never reaches the pointer-move path. onPointerDown
           intercepts it and calls floodFillAt() instead. It lives in
           this table anyway so the tool button, the active-state
           refresh and the tool-switch handler all keep working off one
           list. `sizeless` tells rebuildSizeButtons to hide the SIZE
           row — a bucket has no nib. */
        fill: {
            label:       "FILL",
            sizeless:    true,
            defaultSize: 0
        },

        /* STAMP is a one-shot tap like FILL — onPointerDown intercepts
           it and calls placeStampAt(). The SIZE row applies (it scales
           the stamp); the stamp-row chips pick the shape. Pro. */
        stamp: {
            label:       "STAMP",
            stamp:       true,
            defaultSize: 28
        },

        eraser: {
            /* Peels the top layer instead of wiping to bare paper.
               beginStroke/drawSegment defer to eraserPaintReveal
               (defined next to the reveal snapshot helpers), which
               samples pixels from revealCanvas — the canvas as it
               was BEFORE the most recent non-erase op. `direct:
               true` keeps this off the wet-stroke layer; the
               reveal composite has to hit the real canvas. */
            label:       "ERASER",
            alpha:       1,
            direct:      true,
            defaultSize: 28,
            beginStroke: function (ctx, p, size) {
                const r = size / 2;
                eraserPaintReveal(ctx,
                    function (m) {
                        m.beginPath();
                        m.arc(p.x, p.y, r, 0, Math.PI * 2);
                        m.fill();
                    },
                    p.x - r, p.y - r, p.x + r, p.y + r);
            },
            drawSegment: function (ctx, p0, p1, size) {
                const r = size / 2;
                eraserPaintReveal(ctx,
                    function (m) {
                        m.lineWidth = size;
                        m.lineCap   = "round";
                        m.lineJoin  = "round";
                        m.beginPath();
                        m.moveTo(p0.x, p0.y);
                        m.lineTo(p1.x, p1.y);
                        m.stroke();
                    },
                    Math.min(p0.x, p1.x) - r,
                    Math.min(p0.y, p1.y) - r,
                    Math.max(p0.x, p1.x) + r,
                    Math.max(p0.y, p1.y) + r);
            }
        }
    };

    /* Brushes that draw color (everything except eraser). Used for
       deciding which size set + palette state apply. SPRAY / GLOW /
       SMUDGE are Pro (their buttons carry data-pro and stay hidden on
       a locked native build — see revealProUI). RAINBOW WAS Pro through
       vc4 but moved to free 2026-08-14 (Bala's feedback — see the
       BRIGHTS/RAINBOW rename note on COLOR_GROUPS above); its button
       in index.html no longer carries data-pro. CRAYON, GLITTER and
       RAINBOW are the free brush set. */
    const BRUSH_IDS  = ["crayon", "glitter", "rainbow",
                        "spray", "glow", "smudge"];
    const TOOL_IDS   = BRUSH_IDS.concat("eraser");

    /* ---------- 1. STATE ---------- */

    const state = {
        screen:        "title",                 /* title | picker | draw | gallery | settings */
        templateId:    null,                    /* current template */
        templateName:  "BLANK",
        currentColor:  COLOR_GROUPS.brights.colors[0],
        currentTool:   "crayon",
        lastNonEraseTool: "crayon", /* remembers the last brush/fill/stamp
                                       the kid used, so ERASE mode matches:
                                       last was FILL → fill-erase (tap a
                                       region back to what was under it);
                                       any brush/stamp → brush-erase (drag
                                       reveals the previous layer). */
        fillPattern:   "solid",   /* id from FILL_PATTERNS */                   /* any key in BRUSHES */
        stampId:       "heart",   /* id from STAMPS (STAMP tool) */
        stampPack:     "classics", /* active STAMP_PACKS tab */
        rainbowHue:    0,         /* per-stroke hue cursor (RAINBOW brush) */
        proUnlocked:   false,     /* native purchase flag — see isPro() */
        colorGroup:    "brights",               /* active palette group */
        brushSize:     BRUSHES.crayon.defaultSize, /* size for whichever brush is active */
        eraserSize:    BRUSHES.eraser.defaultSize,
        isDrawing:     false,
        lastX:         0,                       /* raw pointer */
        lastY:         0,
        smoothX:       0,                       /* midpoint-smoothed pen tip */
        smoothY:       0,
        history:       [],                      /* ImageData snapshots */
        redoStack:     [],                      /* undone ops, ready to reapply */
        /* Time-lapse replay recording. Each committed op appends a
           compact event to this list; on save it serializes into the
           gallery record and the detail panel gets a PLAY button.
           Reset on template load and CLEAR. Erase strokes are
           deliberately NOT recorded (their effect depends on the
           reveal buffer, which isn't reproducible from serialized
           events alone). See §4c REPLAY RECORDER. */
        replayEvents:  [],
        replayStrokePts: null,                  /* current stroke buffer */
        /* Color-by-number mode. Non-null when the current template
           opts in via `cbn: {...}`. Structure:
             { palette:   [hex, hex, ...]      // numbered colors, 1-indexed
               regions:   [{cx, cy, ci}]       // detected on page load
               activeIdx: 1                    // which number the kid armed
               completed: Set<regionKey>       // regions filled correctly }
           Regions are auto-detected from the fill mask; ci
           (color-index into palette) is assigned by a template's
           optional `assign` rules or by a deterministic hash of the
           centroid for the auto-fallback. See §4d CBN ENGINE. */
        cbn:           null,
        dirty:         false,
        savedId:       null,                    /* gallery record id if this drawing was saved */
        dpr:           1,
        /* Parent gate is unlocked once per session per Apple's
           documented Kids-category pattern. */
        parentGateUnlocked: false,
        /* Pending callback for parentGate(cb). Stored so the modal
           knows which action to run on correct answer. */
        parentGatePending: null,
        /* Settings — initialized from localStorage in loadSettings(). */
        settings: {
            smoothing: true,    /* brush smoothing on by default — better for kids */
            sfx:       true,    /* SFX on by default */
            music:     false,   /* music not implemented v1; toggle disabled */
            locale:    "en",
            paper:     "classic" /* id from PAPERS — Pro paper texture */
        }
    };

    /* ---------- 1b. PRO TIER ----------
       Pro is the 99c one-off unlock (native stores only). The rules,
       per the plan in CLAUDE.md:
       - Purely ADDITIVE. Free keeps everything it has; Pro content
         simply does not APPEAR when locked — no padlocks, no greyed
         rows, no pressure in the kid's flow.
       - The WEB build always has everything: it is the showcase/trial
         (decided 2026-08-05, same call as Slip Studio's web build).
       - Billing (RevenueCat) is NOT built yet. On native the flag
         defaults false, so the unreleased native build shows the free
         tier until billing lands and sets PRO_KEY.
       Gated content: SPRAY / GLOW / SMUDGE brushes, the STAMP tool,
       PAPER textures, export FRAMES. Pattern fills are deliberately
       FREE — they shipped ungated and stay that way. RAINBOW was in
       this list through vc4 but moved to free 2026-08-14 (Bala's
       feedback — see COLOR_GROUPS). */

    /* Dev/preview override: ?free=1 shows the FREE tier on web —
       there is no other way to see it there (web is always Pro), and
       it's what the free-tier store screenshots get shot against. */
    const FORCE_FREE = (function () {
        try {
            return new URLSearchParams(window.location.search).has("free");
        } catch (_) { return false; }
    })();

    function isPro() {
        if (FORCE_FREE) return false;
        return !isNative() || state.proUnlocked;
    }

    /* Tier filters. Pro content is ABSENT for free, never padlocked or
       greyed — the free app has to read as complete, not as a demo with
       the good parts crossed out. Each of these returns the full table
       for Pro and the `free: true` subset otherwise. */
    function availableStampPacks() {
        return isPro() ? STAMP_PACKS
                       : STAMP_PACKS.filter(function (p) { return p.free; });
    }

    function availablePapers() {
        return isPro() ? PAPERS
                       : PAPERS.filter(function (p) { return p.free; });
    }

    function availableFrames() {
        return isPro() ? FRAMES
                       : FRAMES.filter(function (f) { return f.free; });
    }

    /* Color GROUP keys the current tier may use. Pro sees all; free sees
       the base groups only. The custom picker stays available to both,
       so free is never blocked from any single color — just from the
       curated themed packs. */
    function availableColorGroups() {
        return Object.keys(COLOR_GROUPS).filter(function (k) {
            return isPro() || COLOR_GROUPS[k].free;
        });
    }

    /* The color group actually selectable now. A stored group the tier
       can't use (bought Pro on web, opened free native) falls back to
       the first available rather than showing an empty/absent tab. */
    function activeColorGroup() {
        const groups = availableColorGroups();
        return groups.indexOf(state.colorGroup) >= 0
             ? state.colorGroup : groups[0];
    }

    function isAvailable(list, id) {
        return list.some(function (x) { return x.id === id; });
    }

    /* The paper actually in force. A stored id the current tier can't
       use (bought Pro on the web, then opened the free native build)
       falls back to CLASSIC rather than rendering a paper the kid isn't
       entitled to. */
    function activePaperId() {
        const id = state.settings.paper;
        return isAvailable(availablePapers(), id) ? id : "classic";
    }

    function loadProFlag() {
        try { state.proUnlocked = localStorage.getItem(PRO_KEY) === "1"; }
        catch (_) { state.proUnlocked = false; }
    }

    /* Everything Pro-gated in the DOM carries data-pro; reveal in one
       pass at init. Hidden means display:none — the free UI has no
       trace of it, per the no-locks rule. */
    function revealProUI() {
        if (!isPro()) return;
        $$("[data-pro]").forEach(function (el) {
            el.removeAttribute("hidden");
        });
    }

    /* ---------- 1c. PRO BILLING (RevenueCat) ----------

       ONE product, ONE entitlement — the whole reason Pro is a single
       unlock (see CLAUDE.md). Modeled on Pootery's billing module,
       minus four fifths of it: no pack mapping, no Supabase user ids
       (Tiny Canvas has no accounts — RC's anonymous app-user id plus
       Restore Purchases covers device moves, and Apple Kids forbids
       accounts anyway).

       Activation checklist (all user-side, mirrors Pootery's):
         1. RC dashboard: new project -> Android app with package id
            org.madderverse.tinycanvas -> copy the PUBLIC SDK key
            (goog_...) into RC_PUBLIC_API_KEY below. (iOS later: add
            an iOS app, appl_... key, branch on platform.)
         2. Play Console -> Monetize -> In-app products -> create
            product id `tiny_canvas_pro`, $0.99, Active.
         3. RC dashboard: add product `tiny_canvas_pro`, create
            entitlement `pro`, attach the product to it, and put the
            product in a "current" Offering.
         4. `npx cap sync` (registers the native module — without it
            window.Capacitor.Plugins.Purchases never exists and
            billing silently no-ops).
         5. Test via Play Console License Testing before production.

       While the key below is the REPLACE_ placeholder, _rcReady stays
       false and the Settings Pro card never shows — so an unconfigured
       build carries no dead purchase UI (Apple rejects those). Web
       never shows it either: isPro() is already true there. */

    const RC_PUBLIC_API_KEY  = "goog_ShjKvnDrLrnFmeaPhCCrNXrJXyf";
    const RC_PRO_ENTITLEMENT = "pro";
    const RC_PRO_PRODUCT_ID  = "tiny_canvas_pro";

    function rcPlugin() {
        return window.Capacitor &&
               window.Capacitor.Plugins &&
               window.Capacitor.Plugins.Purchases;
    }

    function rcConfigured() {
        return RC_PUBLIC_API_KEY &&
               RC_PUBLIC_API_KEY.indexOf("REPLACE_") < 0;
    }

    let _rcReady       = false;
    let _rcPriceString = "";    /* store-localized, e.g. "$0.99" */

    /* Find the Pro package in an offerings result. getOfferings()
       resolves to PurchasesOfferings DIRECTLY ({ current, all }) —
       there is NO `.offerings` wrapper; reading one was the Pootery
       bug that made every pack report "not available." Prefer the
       current offering, fall back to scanning all of them so a
       missing "current" pointer can't block the product. */
    function findProPackage(offResult) {
        const matches = function (p) {
            return p && p.product &&
                   p.product.identifier === RC_PRO_PRODUCT_ID;
        };
        let pkgs = (offResult && offResult.current &&
                    offResult.current.availablePackages) || [];
        if (!pkgs.some(matches) && offResult && offResult.all) {
            Object.keys(offResult.all).forEach(function (k) {
                const o = offResult.all[k];
                if (o && o.availablePackages) {
                    pkgs = pkgs.concat(o.availablePackages);
                }
            });
        }
        return pkgs.find(matches) || null;
    }

    async function initBilling() {
        const P = rcPlugin();
        if (!P) return;                /* web build / no native bridge */
        if (!rcConfigured()) {
            console.warn("[TinyCanvas] RC_PUBLIC_API_KEY not set — billing inert");
            return;
        }
        try {
            /* No appUserID — RC generates an anonymous one and keeps
               it stable per install; Restore covers reinstalls. */
            await P.configure({ apiKey: RC_PUBLIC_API_KEY });
            _rcReady = true;
            await syncEntitlements();
            /* Prefetch the price so the card can show the store's own
               localized string rather than a hardcoded "$0.99". */
            try {
                const off = await P.getOfferings();
                const pkg = findProPackage(off);
                if (pkg && pkg.product && pkg.product.priceString) {
                    _rcPriceString = pkg.product.priceString;
                }
            } catch (_) { /* price is cosmetic — card falls back */ }
        } catch (e) {
            console.warn("[TinyCanvas] RC init failed", e);
        }
        syncProCard();
    }

    /* Pull entitlements from RC; an active `pro` unlocks. Never
       auto-relocks — same call Pootery made: a lapsed entitlement
       (refund) leaving a stale local unlock is rare and harmless
       next to yanking content out of a kid's hands mid-drawing. */
    async function syncEntitlements() {
        const P = rcPlugin();
        if (!P || !_rcReady) return;
        try {
            const result = await P.getCustomerInfo();
            const info   = result && result.customerInfo;
            const active = (info && info.entitlements &&
                            info.entitlements.active) || {};
            if (active[RC_PRO_ENTITLEMENT]) unlockPro();
        } catch (e) {
            console.warn("[TinyCanvas] entitlement sync failed", e);
        }
    }

    /* The single switch billing flips. Idempotent. */
    function unlockPro() {
        if (state.proUnlocked) { syncProCard(); return; }
        state.proUnlocked = true;
        setStorage(PRO_KEY, "1");
        revealProUI();
        applyPaper();
        syncProCard();
    }

    async function purchasePro() {
        const P = rcPlugin();
        if (!P || !_rcReady) {
            /* The card only shows when _rcReady, so reaching here
               means the store stopped answering mid-session. */
            alert("Couldn't reach the store just now. Check your " +
                  "connection and try again.");
            return;
        }
        try {
            const off = await P.getOfferings();
            const pkg = findProPackage(off);
            if (!pkg) {
                console.warn("[TinyCanvas] no RC package for " +
                             RC_PRO_PRODUCT_ID);
                alert("The upgrade isn't available right now. " +
                      "Try again later.");
                return;
            }
            const purchase = await P.purchasePackage({ aPackage: pkg });
            const info   = purchase && purchase.customerInfo;
            const active = (info && info.entitlements &&
                            info.entitlements.active) || {};
            if (active[RC_PRO_ENTITLEMENT]) {
                unlockPro();
                alert("Tiny Canvas Pro unlocked! New brushes, stamps, " +
                      "papers and frames are ready in the drawing tools.");
            }
        } catch (e) {
            if (e && e.userCancelled) return;
            console.warn("[TinyCanvas] purchase failed", e);
            alert("The purchase didn't go through. Nothing was " +
                  "charged — try again, or use Restore Purchases if " +
                  "you've bought Pro before.");
        }
    }

    /* Both stores expect a Restore button next to any purchase. */
    async function restoreProPurchases() {
        const P = rcPlugin();
        if (!P || !_rcReady) {
            alert("Restore is only available in the installed app.");
            return;
        }
        try {
            await P.restorePurchases();
            await syncEntitlements();
            alert(state.proUnlocked
                ? "Purchases restored — Pro is unlocked."
                : "No previous purchase was found for this Google " +
                  "account.");
        } catch (e) {
            console.warn("[TinyCanvas] restore failed", e);
            alert("Restore failed. Make sure you're signed in to the " +
                  "same store account that bought Pro.");
        }
    }

    /* The parent-facing card in Settings. Shows ONLY on a native
       build that is locked AND has a live store connection — web
       never sees it (already Pro), an unconfigured build never sees
       it (no dead buttons), and a purchased build hides it again. */
    function syncProCard() {
        const card = $("#proCard");
        if (!card) return;
        card.hidden = !(isNative() && !isPro() && _rcReady);
        const price = $("#proPrice");
        if (price && _rcPriceString) price.textContent = _rcPriceString;
    }

    /* True if the current tool lays down a stroke in color — i.e.
       everything except the eraser and the two one-shot tap tools
       (fill, stamp). Stamp still counts for SIZE purposes though —
       see sizesForCurrentTool. */
    function isBrushTool() {
        return state.currentTool !== "eraser" && !isFillTool() && !isStampTool();
    }
    function isFillTool()  { return state.currentTool === "fill"; }
    function isStampTool() { return state.currentTool === "stamp"; }

    /* Size set + active size for whichever tool is current. Fill has
       no sizes at all, so it returns an empty set and the SIZE row
       hides itself. */
    function sizesForCurrentTool() {
        if (isFillTool()) return [];
        /* Stamp scales off the brush sizes (a stamp is ~3x its nib). */
        return (isBrushTool() || isStampTool()) ? BRUSH_SIZES : ERASER_SIZES;
    }
    function activeSize() {
        return (isBrushTool() || isStampTool()) ? state.brushSize
                                                : state.eraserSize;
    }
    /* Drawing size in LOGICAL canvas px, compensated for zoom: divide
       by the view scale so the nib keeps a constant ON-SCREEN size.
       Zooming in is therefore how you do fine detail — the same
       finger-sized dot paints a quarter the canvas area at 2x. Safe
       to read per-stroke: a zoom change mid-stroke is impossible (the
       second finger cancels the stroke before the pinch starts).
       UI code (size buttons) keeps comparing activeSize() — the
       nominal size is what the kid picked. */
    function effectiveSize() {
        return activeSize() / (view.s || 1);
    }
    function setActiveSize(n) {
        if (isBrushTool() || isStampTool()) state.brushSize = n;
        else                                state.eraserSize = n;
    }

    function currentBrush() {
        return BRUSHES[state.currentTool] || BRUSHES.crayon;
    }

    /* ---------- 1a. CAPACITOR NATIVE BRIDGE ----------
       Tiny Canvas runs as both a static web page (served from
       madderverse.org/tiny-canvas/) AND a Capacitor-wrapped native
       app on iOS + Android. The native runtime injects window.Capacitor
       at app start; this section feature-detects it and adapts the
       export, persistence, status bar, and splash-screen flows.

       Plugins are registered in package.json and auto-linked by
       `npx cap sync`. Each call site is guarded so the web build runs
       the same code untouched. */

    function getCapacitor() {
        return (typeof window !== "undefined" && window.Capacitor) || null;
    }

    function isNative() {
        const cap = getCapacitor();
        return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    }

    function nativePlugin(name) {
        const cap = getCapacitor();
        return cap && cap.Plugins && cap.Plugins[name] || null;
    }

    /* True when the page is running as a wrapped app (Capacitor) OR
       as an installed PWA in standalone mode (iOS Add to Home Screen,
       Android PWA install). The parent gate only enforces in this
       context — the regular web at madderverse.org/tiny-canvas/ has
       a browser address bar, the back button, and is just a website
       you visit. Gating navigation there is friction without
       compliance value. */
    function isStandaloneOrNative() {
        if (isNative()) return true;
        try {
            if (window.matchMedia &&
                window.matchMedia("(display-mode: standalone)").matches) {
                return true;
            }
            if (typeof navigator !== "undefined" &&
                navigator.standalone === true) {
                return true;
            }
        } catch (_) {}
        return false;
    }

    /* Storage keys mirrored to native Preferences. localStorage stays
       the source of truth at runtime (synchronous reads) but writes
       are mirrored to Preferences so the data survives app uninstall
       on Android and webview clears on iOS. Rehydration on app start
       reads Preferences back into localStorage. */
    const STORAGE_KEYS_TO_MIRROR = [
        STORAGE_KEY, SETTINGS_KEY, IN_PROGRESS_KEY, FIRST_SAVE_KEY, PRO_KEY
    ];

    async function rehydrateFromNativePrefs() {
        const prefs = nativePlugin("Preferences");
        if (!prefs) return;
        for (const key of STORAGE_KEYS_TO_MIRROR) {
            try {
                const r = await prefs.get({ key });
                if (r && r.value !== null && r.value !== undefined) {
                    /* Only overwrite localStorage if the native value
                       differs (avoids needlessly thrashing the cache). */
                    if (localStorage.getItem(key) !== r.value) {
                        localStorage.setItem(key, r.value);
                    }
                }
            } catch (_) { /* missing key, etc — skip silently */ }
        }
    }

    function mirrorToNativePrefs(key, value) {
        const prefs = nativePlugin("Preferences");
        if (!prefs) return;
        try {
            if (value === null || value === undefined) {
                prefs.remove({ key });
            } else {
                prefs.set({ key, value: String(value) });
            }
        } catch (_) { /* fail silently — native is a mirror, not auth */ }
    }

    /* setStorage / removeStorage replace direct localStorage calls for
       data we want mirrored. Sync to localStorage immediately, fire
       Preferences write async in the background. */
    function setStorage(key, value) {
        try { localStorage.setItem(key, value); } catch (_) {}
        mirrorToNativePrefs(key, value);
    }
    function removeStorage(key) {
        try { localStorage.removeItem(key); } catch (_) {}
        mirrorToNativePrefs(key, null);
    }

    async function setupStatusBar() {
        const sb = nativePlugin("StatusBar");
        if (!sb) return;
        try {
            await sb.setStyle({ style: "DARK" });
            await sb.setBackgroundColor({ color: "#06141a" });
            /* overlaysWebView: false in capacitor.config.json means the
               status bar sits ABOVE the webview, not over it. We've
               configured for that mode — don't toggle here. */
        } catch (_) { /* StatusBar can fail on some Android builds */ }
    }

    async function hideSplashScreen() {
        const ss = nativePlugin("SplashScreen");
        if (!ss) return;
        try { await ss.hide(); } catch (_) {}
    }

    /* Native export: write the PNG to the Cache directory, then open
       the Share sheet so the user picks "Save to Photos" or "Save to
       Files" (iOS) / "Save image" or share target (Android). This is
       the standard iOS app pattern for "save my drawing somewhere"
       since Capacitor core doesn't include a direct photo-library
       writer plugin.

       Returns true on success so the web fallback doesn't double-fire. */
    async function nativeExport(rec) {
        const fs    = nativePlugin("Filesystem");
        const share = nativePlugin("Share");
        if (!fs) return false;

        const base64 = (rec.png || "").replace(/^data:image\/png;base64,/, "");
        if (!base64) return false;

        const safeName = (rec.name || "tiny-canvas")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        const fileName = safeName + "-" + formatDate(rec.date) + ".png";

        try {
            const written = await fs.writeFile({
                path: fileName,
                data: base64,
                directory: "CACHE",
                recursive: false
            });
            if (share) {
                await share.share({
                    title: "Tiny Canvas — " + (rec.name || "Drawing"),
                    url: written.uri,
                    dialogTitle: "Save or share your drawing"
                });
            }
            return true;
        } catch (e) {
            /* User canceled the share sheet, or write failed.
               Either way: return true so we don't double-fire the
               web download. The kid sees no error; they just don't
               get a file out — the drawing is still in the gallery. */
            return true;
        }
    }

    /* ---------- 2. DOM HOOKS ---------- */

    const $  = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    /* Screen elements */
    const screens = {
        title:    $("#screen-title"),
        picker:   $("#screen-picker"),
        draw:     $("#screen-draw"),
        gallery:  $("#screen-gallery"),
        settings: $("#screen-settings")
    };

    /* ---------- 3. AUDIO BOOTSTRAP ----------
       Single shared AudioContext, lazy-created on first user gesture.
       All SFX synthesized — no audio files. See DESIGN.md §11.       */

    let audioCtx = null;

    function ensureAudio() {
        if (audioCtx) {
            if (audioCtx.state === "suspended") {
                try { audioCtx.resume(); } catch (_) {}
            }
            return audioCtx;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            audioCtx = new AC();
            if (audioCtx.state === "suspended") {
                try { audioCtx.resume(); } catch (_) {}
            }
        } catch (_) {
            audioCtx = null;
        }
        return audioCtx;
    }

    function unlockAudioOnce() {
        ensureAudio();
        document.removeEventListener("pointerdown", unlockAudioOnce, true);
        document.removeEventListener("keydown",     unlockAudioOnce, true);
    }
    document.addEventListener("pointerdown", unlockAudioOnce, true);
    document.addEventListener("keydown",     unlockAudioOnce, true);

    /* Settings-gated audio: every SFX exits silently if the user has
       turned sound off. Keeps the call sites unchanged. */
    function audioEnabled() {
        return state.settings.sfx;
    }

    /* Soft tap — short low blip when the brush hits the page. */
    function sfxTap() {
        if (!audioEnabled()) return;
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.10);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.07, now + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.20);
    }

    /* Two-note perfect-fifth bell — confirmation chime (save). */
    function sfxSave() {
        if (!audioEnabled()) return;
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        [880, 1320].forEach(function (freq, i) {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq;
            const g = ctx.createGain();
            const start = now + i * 0.06;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.14, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, start + 1.1);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 1.2);
        });
    }

    /* Soft swoosh — page change / screen transition. */
    function sfxSwoosh() {
        if (!audioEnabled()) return;
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.18);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 1.6);
            data[i] = (Math.random() * 2 - 1) * env * 0.4;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1400;
        bp.Q.value = 1.5;
        const g = ctx.createGain();
        g.gain.value = 0.4;
        src.connect(bp); bp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    /* Eraser "scratch" — quick noise burst with a high-pass. */
    function sfxErase() {
        if (!audioEnabled()) return;
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.12);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 2);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1800;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        src.connect(hp); hp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    /* ---------- 3b. MUSIC (synthesised, no audio files) ----------

       The Settings screen shipped a permanently disabled "Music —
       coming in a future update" toggle. Rather than delete the row,
       this makes it real.

       The bed is generated, never sampled: four detuned voices on a
       pentatonic chord, each breathing on its own slow LFO, through a
       lowpass. No scheduler (so nothing drifts out of sync over a long
       session) and no audio files at all — which also keeps it clear
       of the licensing trap that bit Slip Studio, where a stock-music
       subscription turned out not to cover an app with a music toggle.

       Default OFF. Deliberately quiet — this is a kids' colouring app,
       not a jukebox. */

    const MUSIC_VOICES = [
        { hz: 174.61, lfo: 0.031 },   /* F3  */
        { hz: 261.63, lfo: 0.043 },   /* C4  */
        { hz: 349.23, lfo: 0.037 },   /* F4  */
        { hz: 392.00, lfo: 0.026 }    /* G4  */
    ];
    const MUSIC_GAIN = 0.035;
    let musicRig = null;

    function startMusic() {
        if (musicRig) return;
        const ctx = ensureAudio();
        if (!ctx) return;

        const master = ctx.createGain();
        master.gain.value = 0;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 820;
        lp.Q.value = 0.4;
        lp.connect(master);
        master.connect(ctx.destination);

        const parts = [];
        MUSIC_VOICES.forEach(function (v, i) {
            const osc = ctx.createOscillator();
            osc.type = i % 2 ? "sine" : "triangle";
            osc.frequency.value = v.hz;
            osc.detune.value = (i - 1.5) * 4;      /* gentle chorus */

            const vg = ctx.createGain();
            /* Base equals the LFO depth, so the swing lands in
               [0, 2*amp] and never inverts phase. */
            const amp = 1 / MUSIC_VOICES.length;
            vg.gain.value = amp;

            const lfo = ctx.createOscillator();
            lfo.frequency.value = v.lfo;
            const lfoAmt = ctx.createGain();
            lfoAmt.gain.value = amp;
            lfo.connect(lfoAmt);
            lfoAmt.connect(vg.gain);

            osc.connect(vg);
            vg.connect(lp);
            osc.start();
            lfo.start();
            parts.push({ osc: osc, lfo: lfo });
        });

        /* Long fade-in so it never announces itself. */
        master.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + 4);
        musicRig = { ctx: ctx, master: master, parts: parts };
    }

    function stopMusic() {
        if (!musicRig) return;
        const rig = musicRig;
        musicRig = null;
        const now = rig.ctx.currentTime;
        try {
            rig.master.gain.cancelScheduledValues(now);
            rig.master.gain.setValueAtTime(rig.master.gain.value, now);
            rig.master.gain.linearRampToValueAtTime(0, now + 1.2);
        } catch (_) {}
        setTimeout(function () {
            rig.parts.forEach(function (p) {
                try { p.osc.stop(); } catch (_) {}
                try { p.lfo.stop(); } catch (_) {}
            });
        }, 1500);
    }

    function syncMusic() {
        if (state.settings.music) startMusic();
        else                      stopMusic();
    }

    /* ---------- 4. CANVAS SETUP ---------- */

    const canvas = $("#drawCanvas");
    const ctx2d  = canvas.getContext("2d");

    function setupCanvas() {
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        state.dpr = dpr;
        /* Logical canvas size = viewport size (CSS pixels). Capped at
           2x DPR to keep backing store bounded on large laptop screens. */
        /* Size from the canvas's OWN laid-out box, not window.innerWidth.
           They are not the same number — a classic desktop scrollbar makes
           innerWidth ~22px wider than the element, and Android WebView
           insets can do the same vertically. Sizing the backing store from
           innerWidth while the element lays out narrower means
           canvas.width / rect.width != dpr, and every consumer that
           assumes it IS dpr silently lands in the wrong place: the fill
           mask is positioned by the true ratio while the fill seed was
           computed with dpr, so taps seeded in the wrong region and the
           coloring page appeared to leak. Fall back to innerWidth only
           when the canvas has no box yet (screen still hidden at init). */
        /* ⚠ Reset the zoom BEFORE measuring — the canvas's box
           reflects the #zoomLayer transform, and sizing the backing
           store from a zoomed box would multiply it by the zoom
           factor. A resize/rotate resetting the view is also the
           sane UX. */
        resetView();
        const box = canvas.getBoundingClientRect();
        STAGE_W = Math.max(320, Math.round(box.width)  || window.innerWidth  || 800);
        STAGE_H = Math.max(320, Math.round(box.height) || window.innerHeight || 800);
        canvas.width  = STAGE_W * dpr;
        canvas.height = STAGE_H * dpr;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.lineCap  = "round";
        ctx2d.lineJoin = "round";
        /* The mask is sized to the backing store and positioned from
           the live SVG rect, so a resize or rotate invalidates both. */
        invalidateFillMask();
        clearCanvas();
    }

    /* keepHistory: the CLEAR button passes true so the wipe itself is
       undoable. Everything else (new page, resize) passes nothing and
       resets the stack, because history from a previous drawing can't
       be replayed onto a different one. */
    function clearCanvas(keepHistory) {
        ctx2d.save();
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        ctx2d.restore();
        /* Reset the erase-reveal buffer too — after CLEAR, "last
           layer" IS bare paper. Without this an eraser stroke would
           bring back pixels from before the clear. */
        clearRevealCanvas();
        if (!keepHistory) state.history.length = 0;
        /* Full reset (new page, resize) also drops redo — those
           patches point at coords that don't apply to a fresh page.
           CLEAR (keepHistory=true) pushes its own history entry via
           commitHistory, which invalidates redoStack for us. */
        if (!keepHistory) state.redoStack.length = 0;
        /* Reset the replay recorder on template swap/resize; CLEAR
           records a 'C' event so playback can wipe partway through. */
        if (!keepHistory) replayReset();
        else replayRecordClear();
        state.dirty = false;
        updateUndoButton();
        updateRedoButton();
        updateStatus();
    }

    /* Convert a pointer event into logical canvas coords. Since the
       canvas is fixed inset 0 and fills the viewport, clientX/Y maps
       directly to canvas CSS coordinates. */
    function getPos(e) {
        /* Map the pointer into LOGICAL canvas coords via the canvas's own
           box. This used to return clientX/clientY raw, on the assumption
           that the canvas is fixed inset:0 so the two are identical. They
           are identical only while the backing store was sized from the
           same number the element actually laid out at — and it wasn't
           (setupCanvas used window.innerWidth, which a scrollbar or a
           WebView inset makes wider than the element). The mismatch
           compressed every stroke toward the top-left: at the far edge of
           a 375px-wide box sized from a 397px innerWidth, the line landed
           about 10px from the finger. */
        const cr = canvas.getBoundingClientRect();
        if (!cr.width || !cr.height) return { x: e.clientX, y: e.clientY };
        return { x: (e.clientX - cr.left) * (STAGE_W / cr.width),
                 y: (e.clientY - cr.top)  * (STAGE_H / cr.height) };
    }

    /* ---------- 4b. ZOOM + PAN VIEW ----------

       The raster coloring pages are dense full scenes — small regions
       need a closer look. The view is ONE CSS transform on #zoomLayer
       (paper + canvas + line art move as a unit). No drawing code
       changes: getPos, the fill mask and composePng all measure live
       client rects, which reflect the transform, so the scale factors
       cancel everywhere. fillGeomKey even self-invalidates on zoom
       because the measured rects change.

       ⚠ The one consumer that must NOT see the transform is
       setupCanvas — it sizes the backing store from the canvas's box,
       and a zoomed box would double the store. It calls resetView()
       before measuring.

       Gestures: two fingers pinch-zoom + pan (one finger always
       draws — drawing is the point); +/- buttons for the
       discoverable/desktop path; ctrl+wheel zooms, plain wheel pans
       when zoomed. A second finger landing mid-stroke cancels the
       partial stroke (restored from the history snapshot); landing
       right after a fill/stamp tap undoes it — both are the kid
       reaching to pinch, not two intentional marks. */

    const ZOOM_MIN = 1, ZOOM_MAX = 4, ZOOM_STEP = 1.5;
    const view = { s: 1, tx: 0, ty: 0 };
    let pinch = null;               /* active two-finger gesture */
    const activePointers = new Map();
    let lastOneShotCommit = 0;      /* fill/stamp commit time, for the
                                       pinch-undo grace window */

    function applyView() {
        view.s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.s));
        /* Clamp pan so the content always covers the viewport — no
           bare void beyond the paper's edge. */
        const minTx = STAGE_W * (1 - view.s);
        const minTy = STAGE_H * (1 - view.s);
        view.tx = Math.min(0, Math.max(minTx, view.tx));
        view.ty = Math.min(0, Math.max(minTy, view.ty));
        const layer = $("#zoomLayer");
        if (layer) {
            layer.style.transform = "translate(" + view.tx + "px, " +
                view.ty + "px) scale(" + view.s + ")";
        }
        syncZoomButtons();
    }

    /* Zoom by `factor` keeping the content under client point (cx,cy)
       stationary. */
    function zoomAt(factor, cx, cy) {
        const s0 = view.s;
        const s1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s0 * factor));
        if (s1 === s0) { syncZoomButtons(); return; }
        const px = (cx - view.tx) / s0;
        const py = (cy - view.ty) / s0;
        view.s  = s1;
        view.tx = cx - px * s1;
        view.ty = cy - py * s1;
        applyView();
    }

    function resetView() {
        view.s = 1; view.tx = 0; view.ty = 0;
        applyView();
    }

    function syncZoomButtons() {
        const zin  = $("#zoomInBtn");
        const zout = $("#zoomOutBtn");
        if (zin)  zin.disabled  = view.s >= ZOOM_MAX - 0.001;
        if (zout) zout.disabled = view.s <= ZOOM_MIN + 0.001;
    }

    /* A second finger arrived while a stroke was in flight: put the
       canvas back to the pre-stroke snapshot (beginHistoryCapture
       already blitted it into histCanvas) and drop the stroke. Works
       for wet-layer AND direct brushes — the snapshot restore covers
       both. */
    function cancelStrokeForPinch() {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        if (histCanvas) {
            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);
            ctx2d.drawImage(histCanvas, 0, 0);
            ctx2d.restore();
        }
        clearStrokeLayer();
        /* Drop the in-flight replay stroke — no commit means nothing
           to bank; leaving it hanging would attach its points to the
           NEXT stroke's begin. */
        replayCancelStroke();
    }

    function beginPinch() {
        cancelStrokeForPinch();
        /* A fill/stamp that just committed was the leading edge of
           this pinch — take it back. Guarded by the commit timestamp
           so a no-op tap (landed on a line) can't undo older work. */
        if (Date.now() - lastOneShotCommit < 500) {
            lastOneShotCommit = 0;
            undo();
        }
        const pts = Array.from(activePointers.values());
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        pinch = {
            d0:   Math.max(1, Math.sqrt(dx * dx + dy * dy)),
            s0:   view.s,
            tx0:  view.tx,
            ty0:  view.ty,
            mid0: { x: (pts[0].x + pts[1].x) / 2,
                    y: (pts[0].y + pts[1].y) / 2 }
        };
    }

    function updatePinch() {
        if (!pinch || activePointers.size < 2) return;
        const pts = Array.from(activePointers.values());
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const d   = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const mid = { x: (pts[0].x + pts[1].x) / 2,
                      y: (pts[0].y + pts[1].y) / 2 };
        const s1 = Math.min(ZOOM_MAX,
                   Math.max(ZOOM_MIN, pinch.s0 * (d / pinch.d0)));
        /* Content point that was under the original midpoint follows
           the live midpoint — zoom + pan in one gesture. */
        const px = (pinch.mid0.x - pinch.tx0) / pinch.s0;
        const py = (pinch.mid0.y - pinch.ty0) / pinch.s0;
        view.s  = s1;
        view.tx = mid.x - px * s1;
        view.ty = mid.y - py * s1;
        applyView();
    }

    /* ---------- 4a. FILL MASK + FLOOD FILL ----------

       The coloring page is an SVG in #lineArt sitting ABOVE the canvas
       at pointer-events:none — the kid colors underneath it. That means
       the canvas bitmap holds no line information at all, so a naive
       flood fill would bleed straight across the whole page.

       So we rasterize the same overlay SVG into an offscreen canvas,
       positioned with the identical svgRect/canvasRect math composePng()
       uses for export, and keep a 1-byte-per-pixel boundary mask.

       That mask is only HALF the boundary though. A fill also has to
       stop at the kid's own strokes, the way MS Paint does — draw a
       closed shape freehand and tapping inside it should fill just that
       shape. Walking the mask alone ignored the bitmap entirely, so on
       a blank page there was nothing to stop the flood and one tap
       filled the whole screen. See floodFillAt for the colour-matching
       half.

       Threshold is deliberately high (not 1): the SVG strokes are
       antialiased, so a low threshold would stop the fill at the faint
       outer skirt of the line and leave a pale halo ringing every
       region. At 96 the fill runs under the skirt and stops at the
       stroke core — and since the line art draws on TOP of the canvas,
       that underlap is invisible. */

    const FILL_BOUNDARY_ALPHA = 96;
    let fillMask        = null;   /* Uint8Array, 1 = line, 0 = fillable */
    let fillMaskW       = 0;
    let fillMaskH       = 0;
    let fillMaskPending = null;   /* in-flight build, so two fast taps
                                     share one rasterization */
    let fillMaskGeom    = "";     /* geometry fingerprint the cached
                                     mask was built against */

    /* Called whenever the page or the backing store changes shape. */
    function invalidateFillMask() {
        fillMask        = null;
        fillMaskPending = null;
        fillMaskGeom    = "";
    }

    /* Fingerprint of every input the mask's geometry depends on.
       Explicit invalidation alone is not enough: the mask is positioned
       from the LIVE svg rect measured against the LIVE canvas backing
       store, so anything that moves or resizes either one — a resize
       whose handler hasn't run yet, an orientation change, a layout
       shift from the tool drawer — leaves a mask that still looks valid
       but is drawn in the wrong place. A misaligned mask doesn't fail
       loudly; it just fills the wrong region, which reads as "the
       coloring page leaks". Cheaper to re-measure on every fill than to
       chase that. */
    /* The overlay's art element. Templates come in two formats — the
       original inline SVG and the raster coloring pages (an <img> whose
       lines are baked as alpha) — and every geometry consumer treats
       them the same: measure the element's box, draw it into that box.
       The <img> is sized with max-width/max-height + auto, so its
       layout box IS its displayed content (no object-fit letterbox
       inside the element to account for). */
    function overlayArtEl() {
        const host = $("#lineArt");
        return host ? host.querySelector("svg, img") : null;
    }

    function fillGeomKey() {
        const art = overlayArtEl();
        const c   = canvas.getBoundingClientRect();
        if (!art) return canvas.width + "x" + canvas.height + ":none";
        const r = art.getBoundingClientRect();
        return [canvas.width, canvas.height,
                Math.round(r.left - c.left), Math.round(r.top - c.top),
                Math.round(r.width), Math.round(r.height),
                state.templateId || ""].join(",");
    }

    function buildFillMask() {
        const key = fillGeomKey();
        if (fillMask && fillMaskGeom === key) return Promise.resolve(fillMask);
        if (fillMask) invalidateFillMask();   /* geometry moved under us */
        if (fillMaskPending) return fillMaskPending;
        fillMaskGeom = key;

        const W = canvas.width, H = canvas.height;
        fillMaskPending = new Promise(function (resolve) {
            const mask = new Uint8Array(W * H);
            fillMaskW = W;
            fillMaskH = H;

            function done() {
                fillMask        = mask;
                fillMaskPending = null;
                resolve(mask);
            }

            const art = overlayArtEl();
            /* BLANK page — no line art, so nothing bounds the fill and
               a tap floods the whole canvas. That's the correct
               behaviour: on a blank page, fill IS "paint the paper". */
            if (!art) { done(); return; }

            const off = document.createElement("canvas");
            off.width  = W;
            off.height = H;
            const o = off.getContext("2d", { willReadFrequently: true });

            /* Measure at DRAW time, not at call time — a raster page
               may still be loading, and before load its <img> has no
               intrinsic size so its box is empty. */
            function artBox() {
                const aR = art.getBoundingClientRect();
                const cR = canvas.getBoundingClientRect();
                if (!aR.width || !cR.width || !cR.height) return null;
                /* CSS px -> device px, PER AXIS — the same ratios
                   getPos and the flood-fill seed use. A single shared
                   ratio assumes the backing store is a uniform scale
                   of the CSS box, and the STAGE_W/H floor of 320
                   breaks that on viewports under 320px: x and y
                   ratios diverge and the mask lands offset from the
                   art, which reads as "the page leaks". */
                const sx = W / cR.width;
                const sy = H / cR.height;
                return { x: (aR.left - cR.left) * sx,
                         y: (aR.top  - cR.top)  * sy,
                         w: aR.width  * sx,
                         h: aR.height * sy };
            }

            function threshold() {
                let d;
                try {
                    d = o.getImageData(0, 0, W, H).data;
                } catch (_) { return false; }
                for (let i = 0, a = 3; i < mask.length; i++, a += 4) {
                    if (d[a] >= FILL_BOUNDARY_ALPHA) mask[i] = 1;
                }
                return true;
            }

            /* On a raster page the page EDGE is a boundary too: the
               scenes are full-bleed, so their sky / wall / floor
               regions run right to the image border. Without this a
               tap on the sky escapes the page and floods the paper
               margins all the way around the screen. A 2-device-px
               frame confines fills to the page — the way a paper
               coloring book behaves. SVG pages keep their old
               open-margin behavior. */
            function markPageBorder(b) {
                const x0 = Math.max(0, Math.round(b.x));
                const y0 = Math.max(0, Math.round(b.y));
                const x1 = Math.min(W - 1, Math.round(b.x + b.w) - 1);
                const y1 = Math.min(H - 1, Math.round(b.y + b.h) - 1);
                if (x1 <= x0 || y1 <= y0) return;
                for (let t = 0; t < 2; t++) {
                    const ya = Math.min(y0 + t, H - 1);
                    const yb = Math.max(y1 - t, 0);
                    for (let x = x0; x <= x1; x++) {
                        mask[ya * W + x] = 1;
                        mask[yb * W + x] = 1;
                    }
                    const xa = Math.min(x0 + t, W - 1);
                    const xb = Math.max(x1 - t, 0);
                    for (let y = y0; y <= y1; y++) {
                        mask[y * W + xa] = 1;
                        mask[y * W + xb] = 1;
                    }
                }
            }

            /* Raster page: the <img> is already a drawable — no
               serialize/blob roundtrip. Its alpha channel IS the line
               art (ink baked as alpha), so the same threshold works. */
            if (art.tagName === "IMG") {
                const drawRaster = function () {
                    const b = artBox();
                    if (!b) { done(); return; }
                    o.drawImage(art, b.x, b.y, b.w, b.h);
                    if (threshold()) markPageBorder(b);
                    done();
                };
                if (art.complete && art.naturalWidth) drawRaster();
                else {
                    art.addEventListener("load",  drawRaster, { once: true });
                    art.addEventListener("error", done,       { once: true });
                }
                return;
            }

            /* SVG page: rasterize via Blob URL -> Image, as before. */
            const b0 = artBox();
            if (!b0) { done(); return; }
            const blob = new Blob([art.outerHTML],
                                  { type: "image/svg+xml" });
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            img.onload = function () {
                o.drawImage(img, b0.x, b0.y, b0.w, b0.h);
                URL.revokeObjectURL(url);
                threshold();
                done();
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                done();
            };
            img.src = url;
        });
        return fillMaskPending;
    }

    /* ---------- 4c. FILL PATTERNS ----------

       Tap-to-fill can lay down a repeating pattern instead of a flat
       colour. The pattern is a MASK, painted in whichever colour is
       armed — so one tile works with all 42 colours rather than being
       one fixed look. That is the same call Slip Studio made with
       tint-able motif silhouettes, and it is why a handful of tiles
       reads as a lot of content.

       Every tile is drawn in code. No image assets: they cost nothing
       to ship, stay crisp at any DPR, and keep the app's "bundles
       everything, requests nothing" posture intact.

       Gaps in the pattern are left ALONE rather than painted, so the
       paper (or whatever the region already held) shows through and the
       result reads as stamped rather than as a flat two-tone block. */

    const PATTERN_TILE = 30;        /* logical px, before DPR scaling */

    const FILL_PATTERNS = [
        { id: "solid", label: "SOLID", draw: null },

        { id: "dots", label: "DOTS", draw: function (c, s) {
            for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) {
                c.beginPath();
                c.arc(x * s, y * s, s * 0.15, 0, Math.PI * 2);
                c.fill();
            }
        } },

        { id: "stripes", label: "STRIPES", draw: function (c, s) {
            c.lineWidth = s * 0.22;
            c.beginPath();
            for (let i = -1; i <= 2; i++) {
                c.moveTo(i * s - s * 0.2, -s * 0.2);
                c.lineTo(i * s + s * 1.2, s * 1.2);
            }
            c.stroke();
        } },

        { id: "check", label: "CHECKS", draw: function (c, s) {
            c.fillRect(0, 0, s / 2, s / 2);
            c.fillRect(s / 2, s / 2, s / 2, s / 2);
        } },

        { id: "stars", label: "STARS", draw: function (c, s) {
            const star = function (cx, cy, r) {
                c.beginPath();
                for (let i = 0; i < 10; i++) {
                    const a = (Math.PI / 5) * i - Math.PI / 2;
                    const rr = i % 2 ? r * 0.45 : r;
                    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
                    if (i) c.lineTo(x, y); else c.moveTo(x, y);
                }
                c.closePath();
                c.fill();
            };
            star(s * 0.3, s * 0.3, s * 0.2);
            star(s * 0.78, s * 0.74, s * 0.15);
        } },

        { id: "hearts", label: "HEARTS", draw: function (c, s) {
            const heart = function (cx, cy, r) {
                c.beginPath();
                c.moveTo(cx, cy + r * 0.75);
                c.bezierCurveTo(cx - r * 1.5, cy - r * 0.4,
                                cx - r * 0.5, cy - r * 1.2, cx, cy - r * 0.35);
                c.bezierCurveTo(cx + r * 0.5, cy - r * 1.2,
                                cx + r * 1.5, cy - r * 0.4, cx, cy + r * 0.75);
                c.fill();
            };
            heart(s * 0.3, s * 0.32, s * 0.2);
            heart(s * 0.78, s * 0.76, s * 0.16);
        } },

        { id: "scales", label: "SCALES", draw: function (c, s) {
            c.lineWidth = s * 0.1;
            for (let row = -1; row <= 2; row++) {
                for (let i = -1; i <= 2; i++) {
                    c.beginPath();
                    c.arc(i * s * 0.5 + ((row & 1) ? s * 0.25 : 0),
                          row * s * 0.5, s * 0.28, 0, Math.PI);
                    c.stroke();
                }
            }
        } },

        { id: "zigzag", label: "ZIGZAG", draw: function (c, s) {
            c.lineWidth = s * 0.13;
            c.lineJoin = "round";
            for (let row = -1; row <= 1; row++) {
                c.beginPath();
                for (let i = -1; i <= 3; i++) {
                    const x = i * s * 0.5;
                    const y = row * s + ((i & 1) ? s * 0.16 : s * 0.44);
                    if (i === -1) c.moveTo(x, y); else c.lineTo(x, y);
                }
                c.stroke();
            }
        } },

        { id: "grid", label: "GRID", draw: function (c, s) {
            c.lineWidth = s * 0.08;
            c.beginPath();
            c.moveTo(0, s / 2); c.lineTo(s, s / 2);
            c.moveTo(s / 2, 0); c.lineTo(s / 2, s);
            c.stroke();
        } }
    ];

    /* id@dpr -> { w, h, a: Uint8Array } of coverage, built once. */
    const _patternCache = {};

    function patternTile(id) {
        let def = null;
        for (let i = 0; i < FILL_PATTERNS.length; i++) {
            if (FILL_PATTERNS[i].id === id) { def = FILL_PATTERNS[i]; break; }
        }
        if (!def || !def.draw) return null;
        const dpr = Math.max(1, Math.round(state.dpr || 1));
        const key = id + "@" + dpr;
        if (_patternCache[key]) return _patternCache[key];
        const s = PATTERN_TILE * dpr;
        const cv = document.createElement("canvas");
        cv.width = s; cv.height = s;
        const c = cv.getContext("2d", { willReadFrequently: true });
        c.fillStyle = "#000";
        c.strokeStyle = "#000";
        c.lineCap = "round";
        def.draw(c, s);
        let src;
        try { src = c.getImageData(0, 0, s, s).data; }
        catch (_) { return null; }
        const a = new Uint8Array(s * s);
        for (let i = 0, q = 3; i < a.length; i++, q += 4) a[i] = src[q];
        _patternCache[key] = { w: s, h: s, a: a };
        return _patternCache[key];
    }

    /* "#rrggbb" -> [r,g,b]. Every colour in COLOR_GROUPS is 6-digit
       hex, so this stays deliberately narrow. */
    function hexToRgb(hex) {
        const h = String(hex).replace("#", "");
        return [parseInt(h.slice(0, 2), 16) || 0,
                parseInt(h.slice(2, 4), 16) || 0,
                parseInt(h.slice(4, 6), 16) || 0];
    }

    /* Scanline flood fill in device pixels, bounded by the mask.
       Packed indices (y*W+x) on a plain stack — the stack holds span
       seeds, not pixels, so it stays small even on a full-page fill. */
    function floodFillAt(p) {
        buildFillMask().then(function (mask) {
            const W = fillMaskW, H = fillMaskH;
            if (!W || !H) return;
            /* p is already in logical canvas coords (getPos maps it there
               off the canvas's own box), so logical -> device is just the
               backing-store ratio. This composes to exactly the same
               client -> device transform buildFillMask uses to position
               the art, which is what keeps seed and mask in one space. */
            if (!STAGE_W || !STAGE_H) return;
            const sx = Math.round(p.x * (W / STAGE_W));
            const sy = Math.round(p.y * (H / STAGE_H));
            if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
            /* Tapped directly on a line — nothing to fill. */
            if (mask[sy * W + sx]) return;

            const rgb = hexToRgb(state.currentColor);
            const r = rgb[0], g = rgb[1], b = rgb[2];

            let image;
            try {
                image = ctx2d.getImageData(0, 0, W, H);
            } catch (_) { return; }
            const data = image.data;

            /* MS Paint semantics: spread across pixels that match the
               colour under the finger, and stop at anything different —
               the kid's own strokes included. The printed line art is
               still an absolute boundary via the mask, so this composes
               with a coloring page instead of replacing it.
               Matching on all four channels means transparent paper
               (0,0,0,0) is its own "colour" and reads as a region. */
            const si = (sy * W + sx) * 4;
            const seedR = data[si], seedG = data[si + 1],
                  seedB = data[si + 2], seedA = data[si + 3];

            /* Already this colour — nothing would change. */
            if (seedA === 255 && seedR === r && seedG === g && seedB === b) {
                return;
            }

            /* Tolerance, squared. Some slack is needed because brush
               strokes and SVG edges are antialiased, so an exact match
               stops a pixel early and rings the fill with a pale halo.

               ⚠ But it MUST stay below the closest pair of colours in
               COLOR_GROUPS, or the flood cannot tell them apart. The
               palette's tightest pair is #00ffcc / #00ffd5, a distance
               of just 9. At the old tolerance of 48 they were the same
               colour as far as fill was concerned: draw an outline in
               one, fill the interior with the other, then tap the
               outline to recolour it and the flood ran straight through
               into the interior and swallowed it whole. 31 of the
               palette's pairs were colliding that way.

               6 is comfortably under 9 and still absorbs antialiasing.
               If new colours are ever added, re-check the minimum
               pairwise distance against this number. */
            const TOL2 = 6 * 6;
            function matches(i) {
                if (mask[i]) return false;
                const q = i * 4;
                const dr = data[q]     - seedR;
                const dg = data[q + 1] - seedG;
                const db = data[q + 2] - seedB;
                const da = data[q + 3] - seedA;
                return dr * dr + dg * dg + db * db + da * da <= TOL2;
            }

            /* Snapshot BEFORE painting — the eraser peels back to this. */
            captureRevealSnapshot();
            /* Record for time-lapse replay. Fill is one event; the
               replayer runs floodFillAt against a scratch canvas at
               playback time. */
            replayRecordFill(p);
            beginHistoryCapture();

            const seen = new Uint8Array(W * H);
            const stack = [sy * W + sx];

            while (stack.length) {
                const seed = stack.pop();
                const y = (seed / W) | 0;
                let   x = seed - y * W;

                /* The walk MARKS the region and paints nothing. Painting
                   as we went made pattern fills impossible: a pattern
                   leaves gaps, and those gaps have to show whatever was
                   underneath — which is already overwritten by the time
                   you know where the gaps fall. Marking first also means
                   `data` still holds the original pixels throughout, so
                   matches() stays honest without depending on `seen`
                   being tested first. */
                while (x > 0 && !seen[y * W + x - 1] &&
                       matches(y * W + x - 1)) x--;

                let spanUp = false, spanDown = false;
                while (x < W) {
                    const i = y * W + x;
                    if (seen[i] || !matches(i)) break;
                    seen[i] = 1;
                    growBoundsDevice(x, y);

                    if (y > 0) {
                        const up = i - W;
                        const openUp = !seen[up] && matches(up);
                        if (openUp && !spanUp) { stack.push(up); spanUp = true; }
                        else if (!openUp)      { spanUp = false; }
                    }
                    if (y < H - 1) {
                        const dn = i + W;
                        const openDn = !seen[dn] && matches(dn);
                        if (openDn && !spanDown) { stack.push(dn); spanDown = true; }
                        else if (!openDn)        { spanDown = false; }
                    }
                    x++;
                }
            }

            /* ---- paint pass ----
               Solid writes the colour everywhere in the region. A
               pattern writes it only where the tile has coverage, and
               blends the tile's antialiased edge so the marks are not
               jagged; untouched gaps keep whatever the region held. */
            const tile = patternTile(state.fillPattern);
            if (!tile) {
                for (let i = 0; i < seen.length; i++) {
                    if (!seen[i]) continue;
                    const q = i * 4;
                    data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = 255;
                }
            } else {
                const tw = tile.w, th = tile.h, ta = tile.a;
                for (let i = 0; i < seen.length; i++) {
                    if (!seen[i]) continue;
                    const y = (i / W) | 0, x = i - y * W;
                    const cov = ta[(y % th) * tw + (x % tw)];
                    if (!cov) continue;
                    const q = i * 4;
                    if (cov === 255) {
                        data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = 255;
                    } else {
                        /* source-over of the tint at `cov` alpha */
                        const af = cov / 255;
                        const da = data[q + 3] / 255;
                        const oa = af + da * (1 - af);
                        data[q]     = Math.round((r * af + data[q]     * da * (1 - af)) / oa);
                        data[q + 1] = Math.round((g * af + data[q + 1] * da * (1 - af)) / oa);
                        data[q + 2] = Math.round((b * af + data[q + 2] * da * (1 - af)) / oa);
                        data[q + 3] = Math.round(oa * 255);
                    }
                }
            }

            /* putImageData ignores the DPR transform, so drop to
               identity for the write and restore it after. */
            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            ctx2d.putImageData(image, 0, 0);
            ctx2d.restore();

            /* +1 because growBoundsDevice records pixel indices, and
               the rect is exclusive at the far edge. */
            sMaxX += 1; sMaxY += 1;
            commitHistory();
            lastOneShotCommit = Date.now();

            state.dirty = true;
            updateStatus();
            markInProgressDirty();
            hideIdleScribble();
            /* CBN mode: check whether the fill landed on the "right"
               region for the armed number. Match = big Onion smile +
               track completion; mismatch = the fill still lands (no
               punishment) but Onion stays neutral. */
            if (state.cbn) {
                const outcome = cbnResolveTap(sx, sy);
                if (outcome === "match") {
                    cbnMarkRegionComplete(sx, sy);
                    triggerOnionReaction("eureka");
                } else {
                    triggerOnionReaction("drawing", 500);
                }
            } else {
                triggerOnionReaction("drawing", 500);
            }
            sfxTap();
        });
    }

    /* Fill-erase — the counterpart to floodFillAt when the ERASE
       tool is armed and the kid's last brush was FILL. Same flood
       walk, same mask, same tolerance — but instead of painting
       the armed color, each seen pixel gets its value from
       revealCanvas (the state before the most recent non-erase
       op). Effect: tapping a filled region reverts JUST that region
       to whatever was underneath.

       Does NOT call captureRevealSnapshot — this consumes the
       reveal, it doesn't advance it. */
    function floodFillEraseAt(p) {
        buildFillMask().then(function (mask) {
            const W = fillMaskW, H = fillMaskH;
            if (!W || !H) return;
            if (!STAGE_W || !STAGE_H) return;
            const sx = Math.round(p.x * (W / STAGE_W));
            const sy = Math.round(p.y * (H / STAGE_H));
            if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
            if (mask[sy * W + sx]) {
                /* Tapped a printed line — nothing to unfill, but this
                   is the classic "nothing happened" moment for the
                   tutorial. */
                maybeShowEraseTip();
                return;
            }

            let image, revealImage;
            try {
                image = ctx2d.getImageData(0, 0, W, H);
                ensureRevealCanvas();
                revealImage = revealCtx.getImageData(0, 0, W, H);
            } catch (_) { return; }
            const data       = image.data;
            const revealData = revealImage.data;

            const si = (sy * W + sx) * 4;
            const seedR = data[si], seedG = data[si + 1],
                  seedB = data[si + 2], seedA = data[si + 3];

            const TOL2 = 6 * 6;
            function matches(i) {
                if (mask[i]) return false;
                const q = i * 4;
                const dr = data[q]     - seedR;
                const dg = data[q + 1] - seedG;
                const db = data[q + 2] - seedB;
                const da = data[q + 3] - seedA;
                return dr * dr + dg * dg + db * db + da * da <= TOL2;
            }

            beginHistoryCapture();

            const seen  = new Uint8Array(W * H);
            const stack = [sy * W + sx];
            while (stack.length) {
                const seed = stack.pop();
                const y = (seed / W) | 0;
                let   x = seed - y * W;
                while (x > 0 && !seen[y * W + x - 1] &&
                       matches(y * W + x - 1)) x--;
                let spanUp = false, spanDown = false;
                while (x < W) {
                    const i = y * W + x;
                    if (seen[i] || !matches(i)) break;
                    seen[i] = 1;
                    growBoundsDevice(x, y);
                    if (y > 0) {
                        const up = i - W;
                        const openUp = !seen[up] && matches(up);
                        if (openUp && !spanUp) { stack.push(up); spanUp = true; }
                        else if (!openUp)      { spanUp = false; }
                    }
                    if (y < H - 1) {
                        const dn = i + W;
                        const openDn = !seen[dn] && matches(dn);
                        if (openDn && !spanDown) { stack.push(dn); spanDown = true; }
                        else if (!openDn)        { spanDown = false; }
                    }
                    x++;
                }
            }

            /* Paint pass: each seen pixel becomes its reveal counterpart.
               Track pixel-level changes so a tap on an already-matching
               region (nothing to peel) fires the tutorial. */
            let changed = 0;
            for (let i = 0; i < seen.length; i++) {
                if (!seen[i]) continue;
                const q = i * 4;
                const rr = revealData[q],     rg = revealData[q + 1],
                      rb = revealData[q + 2], ra = revealData[q + 3];
                if (data[q]     !== rr || data[q + 1] !== rg ||
                    data[q + 2] !== rb || data[q + 3] !== ra) changed++;
                data[q]     = rr;
                data[q + 1] = rg;
                data[q + 2] = rb;
                data[q + 3] = ra;
            }

            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            ctx2d.putImageData(image, 0, 0);
            ctx2d.restore();

            sMaxX += 1; sMaxY += 1;
            if (changed > 0) {
                commitHistory();
                lastOneShotCommit = Date.now();
                state.dirty = true;
                markInProgressDirty();
                sfxErase();
            } else {
                /* No pixels actually changed — the region was already
                   what's underneath. Skip the empty history patch and
                   nudge the kid. */
                maybeShowEraseTip();
            }
            updateStatus();
        });
    }

    /* ---------- 4d. STAMPS (Pro tool) ----------

       One-shot tap shapes, tinted by the armed color — the same
       "mask, not fixed art" call as pattern fills, so 60 shapes x 42
       colors reads as a lot of content. Each draw() renders into a
       100x100 unit box centered on the origin (-50..50); placeStampAt
       translates/scales, so stamps stay crisp at any size and DPR.
       All drawn in code — no image assets, per the app's "bundles
       everything, requests nothing" posture.

       Filled stamps are solid silhouettes; stroked ones (smiley,
       snowflake, rainbow...) read as doodles with the paper showing
       through. lineWidth 7 is in unit space and scales with the
       stamp. */

    function _starPath(c, points, rOuter, rInner) {
        c.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const a = (Math.PI / points) * i - Math.PI / 2;
            const r = (i % 2) ? rInner : rOuter;
            const x = Math.cos(a) * r, y = Math.sin(a) * r;
            if (i) c.lineTo(x, y); else c.moveTo(x, y);
        }
        c.closePath();
    }

    const STAMPS = [
        { id: "heart", label: "HEART", draw: function (c) {
            c.beginPath();
            c.moveTo(0, 38);
            c.bezierCurveTo(-62, -8, -34, -52, 0, -18);
            c.bezierCurveTo(34, -52, 62, -8, 0, 38);
            c.fill();
        } },
        { id: "star", label: "STAR", draw: function (c) {
            _starPath(c, 5, 46, 20);
            c.fill();
        } },
        { id: "sparkle", label: "SPARKLE", draw: function (c) {
            _starPath(c, 4, 46, 11);
            c.fill();
        } },
        { id: "flower", label: "FLOWER", draw: function (c) {
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i;
                c.beginPath();
                c.ellipse(Math.cos(a) * 26, Math.sin(a) * 26,
                          17, 12, a, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.arc(0, 0, 12, 0, Math.PI * 2);
            c.fill();
        } },
        { id: "butterfly", label: "BUTTERFLY", draw: function (c) {
            for (const s of [-1, 1]) {
                c.beginPath();
                c.ellipse(s * 22, -14, 20, 15, s * 0.5, 0, Math.PI * 2);
                c.fill();
                c.beginPath();
                c.ellipse(s * 17, 16, 14, 11, s * -0.4, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.ellipse(0, 0, 5, 26, 0, 0, Math.PI * 2);
            c.fill();
        } },
        { id: "sun", label: "SUN", draw: function (c) {
            c.beginPath();
            c.arc(0, 0, 24, 0, Math.PI * 2);
            c.fill();
            for (let i = 0; i < 8; i++) {
                const a = (Math.PI / 4) * i;
                c.save();
                c.rotate(a);
                c.beginPath();
                c.moveTo(-6, -30); c.lineTo(6, -30); c.lineTo(0, -47);
                c.closePath();
                c.fill();
                c.restore();
            }
        } },
        { id: "moon", label: "MOON", draw: function (c) {
            c.beginPath();
            c.arc(0, 0, 40, Math.PI * 0.32, Math.PI * 1.68);
            c.arc(-18, 0, 32, Math.PI * 1.62, Math.PI * 0.38, true);
            c.closePath();
            c.fill();
        } },
        { id: "cloud", label: "CLOUD", draw: function (c) {
            c.beginPath();
            c.arc(-22, 8, 16, 0, Math.PI * 2);
            c.arc(0, -6, 22, 0, Math.PI * 2);
            c.arc(24, 8, 15, 0, Math.PI * 2);
            c.rect(-24, 6, 48, 18);
            c.fill();
        } },
        { id: "drop", label: "RAINDROP", draw: function (c) {
            c.beginPath();
            c.moveTo(0, -44);
            c.bezierCurveTo(24, -8, 30, 10, 0, 40);
            c.bezierCurveTo(-30, 10, -24, -8, 0, -44);
            c.fill();
        } },
        { id: "rainbow", label: "RAINBOW", draw: function (c) {
            for (const r of [40, 27, 14]) {
                c.beginPath();
                c.arc(0, 22, r, Math.PI, 0);
                c.stroke();
            }
        } },
        { id: "snowflake", label: "SNOWFLAKE", draw: function (c) {
            for (let i = 0; i < 6; i++) {
                c.save();
                c.rotate((Math.PI / 3) * i);
                c.beginPath();
                c.moveTo(0, 0); c.lineTo(0, -42);
                c.moveTo(-9, -28); c.lineTo(0, -20); c.lineTo(9, -28);
                c.stroke();
                c.restore();
            }
        } },
        { id: "bolt", label: "BOLT", draw: function (c) {
            c.beginPath();
            c.moveTo(10, -46); c.lineTo(-22, 6); c.lineTo(-2, 6);
            c.lineTo(-10, 46); c.lineTo(22, -8); c.lineTo(2, -8);
            c.closePath();
            c.fill();
        } },
        { id: "balloon", label: "BALLOON", draw: function (c) {
            c.beginPath();
            c.ellipse(0, -14, 22, 27, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(-5, 12); c.lineTo(5, 12); c.lineTo(0, 19);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(0, 19);
            c.quadraticCurveTo(10, 32, 0, 46);
            c.stroke();
        } },
        { id: "crown", label: "CROWN", draw: function (c) {
            c.beginPath();
            c.moveTo(-38, 26); c.lineTo(-42, -18); c.lineTo(-20, 0);
            c.lineTo(0, -30); c.lineTo(20, 0); c.lineTo(42, -18);
            c.lineTo(38, 26);
            c.closePath();
            c.fill();
        } },
        { id: "gem", label: "GEM", draw: function (c) {
            c.beginPath();
            c.moveTo(-30, -18); c.lineTo(30, -18); c.lineTo(44, 2);
            c.lineTo(0, 42); c.lineTo(-44, 2);
            c.closePath();
            c.fill();
        } },
        { id: "note", label: "MUSIC", draw: function (c) {
            c.beginPath();
            c.ellipse(-14, 28, 13, 9, -0.3, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(-3, 26); c.lineTo(-3, -34);
            c.stroke();
            c.beginPath();
            c.moveTo(-3, -34);
            c.quadraticCurveTo(26, -26, 22, -2);
            c.quadraticCurveTo(16, -18, -3, -18);
            c.closePath();
            c.fill();
        } },
        { id: "paw", label: "PAW", draw: function (c) {
            c.beginPath();
            c.ellipse(0, 16, 22, 18, 0, 0, Math.PI * 2);
            c.fill();
            const toes = [[-28, -8, 9], [-10, -22, 10], [10, -22, 10], [28, -8, 9]];
            for (const t of toes) {
                c.beginPath();
                c.arc(t[0], t[1], t[2], 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "fish", label: "FISH", draw: function (c) {
            c.beginPath();
            c.ellipse(-6, 0, 28, 18, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(18, 0); c.lineTo(44, -18); c.lineTo(44, 18);
            c.closePath();
            c.fill();
        } },
        { id: "ladybug", label: "LADYBUG", draw: function (c) {
            c.beginPath();
            c.arc(0, 2, 30, 0, Math.PI * 2);
            c.stroke();
            c.beginPath();
            c.moveTo(0, -28); c.lineTo(0, 32);
            c.stroke();
            c.beginPath();
            c.arc(0, -34, 11, 0, Math.PI * 2);
            c.fill();
            for (const s of [[-14, -8], [14, -8], [-12, 16], [12, 16]]) {
                c.beginPath();
                c.arc(s[0], s[1], 5.5, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "apple", label: "APPLE", draw: function (c) {
            c.beginPath();
            c.arc(-11, 8, 21, 0, Math.PI * 2);
            c.arc(11, 8, 21, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(0, -10); c.quadraticCurveTo(-2, -28, 6, -38);
            c.stroke();
            c.beginPath();
            c.ellipse(18, -30, 12, 7, -0.6, 0, Math.PI * 2);
            c.fill();
        } },
        { id: "icecream", label: "ICE CREAM", draw: function (c) {
            c.beginPath();
            c.moveTo(-20, -2); c.lineTo(20, -2); c.lineTo(0, 46);
            c.closePath();
            c.fill();
            c.beginPath();
            c.arc(-11, -14, 14, 0, Math.PI * 2);
            c.arc(11, -14, 14, 0, Math.PI * 2);
            c.arc(0, -28, 14, 0, Math.PI * 2);
            c.fill();
        } },
        { id: "cupcake", label: "CUPCAKE", draw: function (c) {
            c.beginPath();
            c.moveTo(-26, 4); c.lineTo(-18, 42); c.lineTo(18, 42);
            c.lineTo(26, 4);
            c.closePath();
            c.fill();
            c.beginPath();
            c.arc(-14, -4, 12, 0, Math.PI * 2);
            c.arc(0, -14, 14, 0, Math.PI * 2);
            c.arc(14, -4, 12, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(0, -34, 6, 0, Math.PI * 2);
            c.fill();
        } },
        { id: "rocket", label: "ROCKET", draw: function (c) {
            c.beginPath();
            c.moveTo(0, -46);
            c.quadraticCurveTo(18, -20, 14, 18);
            c.lineTo(-14, 18);
            c.quadraticCurveTo(-18, -20, 0, -46);
            c.fill();
            c.beginPath();
            c.moveTo(-14, 4); c.lineTo(-30, 30); c.lineTo(-12, 22);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(14, 4); c.lineTo(30, 30); c.lineTo(12, 22);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(-7, 24); c.lineTo(7, 24); c.lineTo(0, 44);
            c.closePath();
            c.fill();
        } },
        { id: "smiley", label: "SMILEY", draw: function (c) {
            c.beginPath();
            c.arc(0, 0, 40, 0, Math.PI * 2);
            c.stroke();
            for (const s of [-1, 1]) {
                c.beginPath();
                c.arc(s * 15, -10, 5.5, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.arc(0, 4, 24, Math.PI * 0.15, Math.PI * 0.85);
            c.stroke();
        } },

        /* --- Unlocked wave 2 (2026-08-05): 36 more, same contract.
           Two styles, deliberately mixed: filled silhouettes (bold,
           icon-like) and stroked doodles with filled accents (faces,
           food) — a stroke in the armed color on a filled area of the
           same color is invisible, so anything with interior detail
           must be stroked-outline with the paper showing through. */

        /* NATURE */
        { id: "tree", label: "TREE", draw: function (c) {
            c.fillRect(-6, 12, 12, 32);
            c.beginPath();
            c.arc(-16, 2, 17, 0, Math.PI * 2);
            c.arc(16, 2, 17, 0, Math.PI * 2);
            c.arc(0, -18, 20, 0, Math.PI * 2);
            c.fill();
        } },
        { id: "leaf", label: "LEAF", draw: function (c) {
            c.beginPath();
            c.moveTo(0, -42);
            c.quadraticCurveTo(34, -14, 4, 28);
            c.quadraticCurveTo(0, 32, -4, 28);
            c.quadraticCurveTo(-34, -14, 0, -42);
            c.fill();
            c.beginPath();
            c.moveTo(0, 30); c.lineTo(0, 46);
            c.stroke();
        } },
        { id: "mushroom", label: "MUSHROOM", draw: function (c) {
            c.beginPath();
            c.arc(0, 2, 38, Math.PI, 0);
            c.quadraticCurveTo(38, 12, 28, 12);
            c.lineTo(-28, 12);
            c.quadraticCurveTo(-38, 12, -38, 2);
            c.fill();
            c.beginPath();
            c.moveTo(-11, 12); c.lineTo(-13, 40);
            c.quadraticCurveTo(0, 48, 13, 40);
            c.lineTo(11, 12);
            c.closePath();
            c.fill();
        } },
        { id: "tulip", label: "TULIP", draw: function (c) {
            c.beginPath();
            c.moveTo(-24, -40);
            c.quadraticCurveTo(-30, -6, 0, -2);
            c.quadraticCurveTo(30, -6, 24, -40);
            c.quadraticCurveTo(12, -26, 0, -40);
            c.quadraticCurveTo(-12, -26, -24, -40);
            c.fill();
            c.beginPath();
            c.moveTo(0, -2); c.lineTo(0, 44);
            c.stroke();
            c.beginPath();
            c.moveTo(0, 28);
            c.quadraticCurveTo(-24, 24, -28, 8);
            c.quadraticCurveTo(-8, 14, 0, 28);
            c.fill();
        } },

        /* ANIMALS */
        { id: "cat", label: "CAT", draw: function (c) {
            c.beginPath();
            c.moveTo(-30, -20); c.lineTo(-34, -44); c.lineTo(-13, -31);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(30, -20); c.lineTo(34, -44); c.lineTo(13, -31);
            c.closePath(); c.fill();
            c.beginPath();
            c.arc(0, 0, 33, 0, Math.PI * 2);
            c.stroke();
            for (const s of [-1, 1]) {
                c.beginPath();
                c.arc(s * 13, -6, 4.5, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.moveTo(-5, 8); c.lineTo(5, 8); c.lineTo(0, 14);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(-16, 12); c.lineTo(-42, 8);
            c.moveTo(-16, 18); c.lineTo(-42, 20);
            c.moveTo(16, 12); c.lineTo(42, 8);
            c.moveTo(16, 18); c.lineTo(42, 20);
            c.stroke();
        } },
        { id: "dog", label: "DOG", draw: function (c) {
            for (const s of [-1, 1]) {
                c.beginPath();
                c.ellipse(s * 30, -4, 10, 22, s * 0.35, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.arc(0, 0, 31, 0, Math.PI * 2);
            c.stroke();
            for (const s of [-1, 1]) {
                c.beginPath();
                c.arc(s * 12, -8, 4.5, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.ellipse(0, 8, 7, 5.5, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(0, 14); c.quadraticCurveTo(0, 23, 10, 23);
            c.stroke();
        } },
        { id: "bunny", label: "BUNNY", draw: function (c) {
            for (const s of [-1, 1]) {
                c.beginPath();
                c.ellipse(s * 13, -28, 9, 21, s * 0.12, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.arc(0, 14, 29, 0, Math.PI * 2);
            c.stroke();
            for (const s of [-1, 1]) {
                c.beginPath();
                c.arc(s * 11, 8, 4.5, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.moveTo(-4, 20); c.lineTo(4, 20); c.lineTo(0, 26);
            c.closePath(); c.fill();
        } },
        { id: "bird", label: "BIRD", draw: function (c) {
            c.beginPath();
            c.ellipse(4, 8, 26, 19, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(-20, -16, 14, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(-32, -20); c.lineTo(-48, -14); c.lineTo(-32, -9);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(26, 2); c.lineTo(47, -10); c.lineTo(42, 10);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(-4, 27); c.lineTo(-4, 38);
            c.moveTo(10, 27); c.lineTo(10, 38);
            c.stroke();
        } },
        { id: "bee", label: "BEE", draw: function (c) {
            for (const s of [-1, 1]) {
                c.beginPath();
                c.ellipse(s * 12, -26, 15, 9, s * 0.5, 0, Math.PI * 2);
                c.stroke();
            }
            c.beginPath();
            c.ellipse(0, 8, 26, 19, 0, 0, Math.PI * 2);
            c.stroke();
            c.beginPath();
            c.moveTo(-9, -9); c.lineTo(-9, 25);
            c.moveTo(0, -11); c.lineTo(0, 27);
            c.moveTo(9, -9); c.lineTo(9, 25);
            c.stroke();
            c.beginPath();
            c.moveTo(26, 8); c.lineTo(40, 8);
            c.stroke();
        } },
        { id: "snail", label: "SNAIL", draw: function (c) {
            c.beginPath();
            c.arc(8, 4, 25, 0, Math.PI * 2); c.stroke();
            c.beginPath();
            c.arc(11, 7, 13, 0, Math.PI * 1.6); c.stroke();
            c.beginPath();
            c.moveTo(-34, 32);
            c.quadraticCurveTo(-48, 32, -44, 14);
            c.quadraticCurveTo(-42, 2, -35, 0);
            c.quadraticCurveTo(-28, 26, 30, 27);
            c.quadraticCurveTo(42, 28, 40, 32);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(-40, 2); c.lineTo(-46, -13);
            c.moveTo(-33, 0); c.lineTo(-29, -15);
            c.stroke();
            c.beginPath(); c.arc(-47, -15, 3, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(-28, -17, 3, 0, Math.PI * 2); c.fill();
        } },
        { id: "frog", label: "FROG", draw: function (c) {
            for (const s of [-1, 1]) {
                c.beginPath();
                c.arc(s * 18, -22, 12, 0, Math.PI * 2);
                c.stroke();
                c.beginPath();
                c.arc(s * 18, -22, 4.5, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.ellipse(0, 10, 34, 23, 0, 0, Math.PI * 2);
            c.stroke();
            c.beginPath();
            c.arc(0, 8, 18, Math.PI * 0.15, Math.PI * 0.85);
            c.stroke();
        } },
        { id: "turtle", label: "TURTLE", draw: function (c) {
            c.beginPath();
            c.arc(0, 8, 30, Math.PI, 0);
            c.closePath();
            c.fill();
            c.beginPath();
            c.arc(36, 2, 9, 0, Math.PI * 2);
            c.fill();
            c.fillRect(-24, 8, 10, 12);
            c.fillRect(14, 8, 10, 12);
            c.beginPath();
            c.moveTo(-29, 10); c.lineTo(-42, 16); c.lineTo(-29, 18);
            c.closePath(); c.fill();
        } },
        { id: "duck", label: "DUCK", draw: function (c) {
            c.beginPath();
            c.ellipse(6, 14, 30, 20, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(-18, -16, 15, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(-31, -18); c.lineTo(-49, -12); c.lineTo(-31, -6);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(26, 4); c.lineTo(46, -8); c.lineTo(38, 12);
            c.closePath(); c.fill();
        } },
        { id: "dino", label: "DINO", draw: function (c) {
            c.beginPath();
            c.ellipse(8, 14, 30, 18, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(-14, 8);
            c.quadraticCurveTo(-34, -4, -34, -30);
            c.quadraticCurveTo(-34, -42, -25, -42);
            c.quadraticCurveTo(-15, -42, -18, -30);
            c.quadraticCurveTo(-20, -8, -4, 4);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(32, 10);
            c.quadraticCurveTo(52, 16, 47, 30);
            c.quadraticCurveTo(36, 24, 26, 26);
            c.closePath();
            c.fill();
            c.fillRect(-10, 28, 10, 14);
            c.fillRect(12, 28, 10, 14);
        } },

        /* FOOD */
        { id: "donut", label: "DONUT", draw: function (c) {
            c.save();
            c.lineWidth = 24;
            c.beginPath();
            c.arc(0, 0, 28, 0, Math.PI * 2);
            c.stroke();
            c.restore();
        } },
        { id: "pizza", label: "PIZZA", draw: function (c) {
            c.beginPath();
            c.moveTo(0, 46);
            c.lineTo(-28, -22);
            c.quadraticCurveTo(0, -38, 28, -22);
            c.closePath();
            c.stroke();
            c.beginPath();
            c.moveTo(-23, -10);
            c.quadraticCurveTo(0, -24, 23, -10);
            c.stroke();
            for (const p of [[-8, -2], [9, 2], [0, 18]]) {
                c.beginPath();
                c.arc(p[0], p[1], 6, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "candy", label: "CANDY", draw: function (c) {
            c.beginPath();
            c.arc(0, 0, 18, 0, Math.PI * 2);
            c.fill();
            for (const s of [-1, 1]) {
                c.beginPath();
                c.moveTo(s * 16, -6);
                c.lineTo(s * 38, -16);
                c.lineTo(s * 33, 0);
                c.lineTo(s * 38, 16);
                c.lineTo(s * 16, 6);
                c.closePath();
                c.fill();
            }
        } },
        { id: "cherry", label: "CHERRY", draw: function (c) {
            c.beginPath(); c.arc(-14, 20, 15, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(17, 24, 14, 0, Math.PI * 2); c.fill();
            c.beginPath();
            c.moveTo(-12, 8); c.quadraticCurveTo(-4, -24, 8, -38);
            c.moveTo(18, 12); c.quadraticCurveTo(15, -14, 8, -38);
            c.stroke();
            c.beginPath();
            c.ellipse(17, -38, 12, 6, -0.5, 0, Math.PI * 2);
            c.fill();
        } },
        { id: "cookie", label: "COOKIE", draw: function (c) {
            c.beginPath();
            c.arc(0, 0, 36, 0, Math.PI * 2);
            c.stroke();
            for (const p of [[-14, -10], [10, -16], [16, 10], [-8, 14], [1, -1]]) {
                c.beginPath();
                c.arc(p[0], p[1], 5.5, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "strawberry", label: "BERRY", draw: function (c) {
            c.beginPath();
            c.moveTo(0, 42);
            c.bezierCurveTo(-38, 18, -30, -20, 0, -14);
            c.bezierCurveTo(30, -20, 38, 18, 0, 42);
            c.stroke();
            for (const p of [[-12, 4], [12, 4], [0, 18], [-6, -4], [6, -4]]) {
                c.beginPath();
                c.arc(p[0], p[1], 3, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.moveTo(-18, -13);
            c.lineTo(-8, -30); c.lineTo(-4, -16);
            c.lineTo(0, -34); c.lineTo(4, -16);
            c.lineTo(8, -30); c.lineTo(18, -13);
            c.closePath();
            c.fill();
        } },
        { id: "melon", label: "MELON", draw: function (c) {
            c.beginPath();
            c.arc(0, -8, 38, 0, Math.PI);
            c.closePath();
            c.stroke();
            c.beginPath();
            c.arc(0, -8, 28, 0, Math.PI);
            c.stroke();
            for (const p of [[-13, 6], [0, 12], [13, 6]]) {
                c.beginPath();
                c.ellipse(p[0], p[1], 3, 5, 0, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "carrot", label: "CARROT", draw: function (c) {
            c.beginPath();
            c.moveTo(-12, -18); c.lineTo(12, -18); c.lineTo(2, 42);
            c.quadraticCurveTo(0, 46, -2, 42);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(0, -20); c.lineTo(-14, -44);
            c.moveTo(0, -20); c.lineTo(0, -46);
            c.moveTo(0, -20); c.lineTo(14, -44);
            c.stroke();
        } },

        /* SPACE */
        { id: "planet", label: "PLANET", draw: function (c) {
            c.beginPath();
            c.arc(0, 0, 25, 0, Math.PI * 2);
            c.fill();
            c.save();
            c.rotate(-0.35);
            c.beginPath();
            c.ellipse(0, 0, 45, 12, 0, 0, Math.PI * 2);
            c.stroke();
            c.restore();
        } },
        { id: "alien", label: "ALIEN", draw: function (c) {
            c.beginPath();
            c.ellipse(0, 4, 25, 30, 0, 0, Math.PI * 2);
            c.stroke();
            for (const s of [-1, 1]) {
                c.beginPath();
                c.ellipse(s * 11, 0, 7, 12, s * 0.5, 0, Math.PI * 2);
                c.fill();
                c.beginPath();
                c.moveTo(s * 11, -25); c.lineTo(s * 21, -42);
                c.stroke();
                c.beginPath();
                c.arc(s * 22, -44, 3.5, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.arc(0, 20, 8, Math.PI * 0.2, Math.PI * 0.8);
            c.stroke();
        } },
        { id: "comet", label: "COMET", draw: function (c) {
            c.beginPath();
            c.arc(-20, 20, 15, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(-10, 8); c.lineTo(42, -30);
            c.moveTo(-6, 18); c.lineTo(46, -8);
            c.moveTo(-10, 30); c.lineTo(36, 12);
            c.stroke();
        } },
        { id: "ufo", label: "UFO", draw: function (c) {
            c.beginPath();
            c.arc(0, -10, 18, Math.PI, 0);
            c.stroke();
            c.beginPath();
            c.ellipse(0, -2, 42, 13, 0, 0, Math.PI * 2);
            c.fill();
            for (const x of [-22, 0, 22]) {
                c.beginPath();
                c.moveTo(x, 12); c.lineTo(x * 1.3, 32);
                c.stroke();
            }
        } },
        { id: "shoot", label: "SHOOTING", draw: function (c) {
            c.save();
            c.translate(-14, -12);
            _starPath(c, 5, 22, 10);
            c.fill();
            c.restore();
            c.beginPath();
            c.moveTo(4, -2); c.lineTo(44, 18);
            c.moveTo(-4, 10); c.lineTo(36, 32);
            c.stroke();
        } },
        { id: "starduo", label: "STARS", draw: function (c) {
            c.save(); c.translate(-16, -8);
            _starPath(c, 5, 24, 10.5); c.fill();
            c.restore();
            c.save(); c.translate(22, 16);
            _starPath(c, 5, 16, 7); c.fill();
            c.restore();
            c.save(); c.translate(12, -30);
            _starPath(c, 4, 10, 3.5); c.fill();
            c.restore();
        } },

        /* VEHICLES */
        { id: "car", label: "CAR", draw: function (c) {
            c.beginPath();
            c.moveTo(-44, 16);
            c.lineTo(-40, 0); c.lineTo(-22, -2);
            c.lineTo(-12, -18); c.lineTo(16, -18);
            c.lineTo(26, -2); c.lineTo(42, 2); c.lineTo(44, 16);
            c.closePath();
            c.fill();
            for (const x of [-24, 24]) {
                c.beginPath();
                c.arc(x, 20, 10, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "truck", label: "TRUCK", draw: function (c) {
            c.fillRect(-46, -14, 52, 28);
            c.beginPath();
            c.moveTo(6, -6); c.lineTo(28, -6); c.lineTo(40, 6);
            c.lineTo(40, 14); c.lineTo(6, 14);
            c.closePath();
            c.fill();
            for (const x of [-30, -8, 26]) {
                c.beginPath();
                c.arc(x, 20, 9, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "boat", label: "BOAT", draw: function (c) {
            c.beginPath();
            c.moveTo(-42, 14); c.lineTo(42, 14); c.lineTo(26, 32);
            c.lineTo(-26, 32);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(0, 8); c.lineTo(0, -44);
            c.stroke();
            c.beginPath();
            c.moveTo(5, -40); c.lineTo(34, 4); c.lineTo(5, 4);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(-5, -32); c.lineTo(-28, 4); c.lineTo(-5, 4);
            c.closePath(); c.fill();
        } },
        { id: "plane", label: "PLANE", draw: function (c) {
            c.beginPath();
            c.ellipse(0, 6, 40, 11, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(-8, 2); c.lineTo(-30, -32); c.lineTo(-12, -32);
            c.lineTo(10, 0);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(28, 0); c.lineTo(42, -22); c.lineTo(46, -2);
            c.closePath(); c.fill();
        } },
        { id: "train", label: "TRAIN", draw: function (c) {
            c.fillRect(-46, -24, 30, 44);
            c.fillRect(-18, -4, 60, 24);
            c.fillRect(26, -20, 12, 16);
            for (const x of [-34, -10, 12, 32]) {
                c.beginPath();
                c.arc(x, 24, 8, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "heli", label: "COPTER", draw: function (c) {
            c.beginPath();
            c.ellipse(-6, 8, 26, 17, 0, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.moveTo(16, 4); c.lineTo(44, 0); c.lineTo(44, 10); c.lineTo(18, 14);
            c.closePath(); c.fill();
            c.beginPath();
            c.moveTo(-6, -8); c.lineTo(-6, -20);
            c.moveTo(-44, -22); c.lineTo(32, -22);
            c.moveTo(44, -8); c.lineTo(44, 16);
            c.stroke();
            c.beginPath();
            c.moveTo(-26, 32); c.lineTo(14, 32);
            c.moveTo(-18, 26); c.lineTo(-18, 32);
            c.moveTo(6, 26); c.lineTo(6, 32);
            c.stroke();
        } },
        { id: "bike", label: "BIKE", draw: function (c) {
            for (const s of [-1, 1]) {
                c.beginPath();
                c.arc(s * 26, 16, 17, 0, Math.PI * 2);
                c.stroke();
            }
            c.beginPath();
            c.moveTo(-26, 16); c.lineTo(-8, -12); c.lineTo(14, -12);
            c.lineTo(26, 16); c.lineTo(-2, 16); c.lineTo(-8, -12);
            c.stroke();
            c.beginPath();
            c.moveTo(14, -12); c.lineTo(18, -24);
            c.moveTo(12, -26); c.lineTo(26, -24);
            c.moveTo(-8, -12); c.lineTo(-12, -20);
            c.moveTo(-18, -21); c.lineTo(-6, -21);
            c.stroke();
        } },
        { id: "bus", label: "BUS", draw: function (c) {
            c.beginPath();
            c.moveTo(-44, -20);
            c.lineTo(40, -20);
            c.quadraticCurveTo(46, -20, 46, -12);
            c.lineTo(46, 16); c.lineTo(-44, 16);
            c.lineTo(-46, -4);
            c.closePath();
            c.stroke();
            c.beginPath();
            c.moveTo(-44, -2); c.lineTo(46, -2);
            c.stroke();
            for (const x of [-26, 26]) {
                c.beginPath();
                c.arc(x, 20, 9, 0, Math.PI * 2);
                c.fill();
            }
        } }
    ];

    /* Stamp PACKS — the chip row shows one pack at a time, tabs
       above it (same pattern as the palette groups). Grouping is by
       id so the 24 original draw functions stay where they are.
       A pack id listed here but missing from STAMPS is skipped, so a
       typo degrades to a shorter pack, not a crash. */
    /* `free: true` marks the pack the free tier gets. Stamps are the
       most replayable thing in the app — tap, instant result, no skill
       floor — and shipping zero of them to free made the free game
       coloring-only. CLASSICS goes free; the other five (50 stamps) are
       the Pro pitch. Same reasoning as pattern fills staying free. */
    const STAMP_PACKS = [
        { id: "classics", label: "CLASSICS", free: true,
          ids: ["heart", "star", "sparkle", "rainbow", "smiley", "crown",
                "gem", "balloon", "note", "bolt"] },
        { id: "animals", label: "ANIMALS",
          ids: ["cat", "dog", "bunny", "bird", "paw", "fish", "ladybug",
                "butterfly", "bee", "snail", "frog", "turtle", "duck",
                "dino"] },
        { id: "nature", label: "NATURE",
          ids: ["flower", "tulip", "tree", "leaf", "mushroom", "sun",
                "moon", "cloud", "drop", "snowflake"] },
        { id: "food", label: "FOOD",
          ids: ["apple", "icecream", "cupcake", "donut", "pizza", "candy",
                "cherry", "cookie", "strawberry", "melon", "carrot"] },
        { id: "space", label: "SPACE",
          ids: ["rocket", "planet", "alien", "ufo", "comet", "shoot",
                "starduo"] },
        { id: "vehicles", label: "VEHICLES",
          ids: ["car", "truck", "bus", "train", "boat", "plane", "heli",
                "bike"] }
    ].map(function (pk) {
        return {
            id: pk.id, label: pk.label, free: !!pk.free,
            stamps: pk.ids.map(function (id) {
                return STAMPS.find(function (s) { return s.id === id; });
            }).filter(Boolean)
        };
    });

    function placeStampAt(p) {
        let def = null;
        for (let i = 0; i < STAMPS.length; i++) {
            if (STAMPS[i].id === state.stampId) { def = STAMPS[i]; break; }
        }
        if (!def) def = STAMPS[0];
        /* A stamp is ~3x its nominal nib — sizes 4..42 give 13..134px
           shapes, which spans "little sticker" to "half the screen".
           effectiveSize keeps that ON-SCREEN size constant under zoom,
           so zooming in places smaller, finer stamps. */
        const size = effectiveSize() * 3.2;
        /* Snapshot BEFORE painting — the eraser peels back to this. */
        captureRevealSnapshot();
        /* Record for time-lapse replay — the stamp definition is
           addressed by its id at playback time. */
        replayRecordStamp(p, size);
        beginHistoryCapture();
        ctx2d.save();
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.globalAlpha = 1;
        ctx2d.translate(p.x, p.y);
        ctx2d.scale(size / 100, size / 100);
        ctx2d.fillStyle   = state.currentColor;
        ctx2d.strokeStyle = state.currentColor;
        ctx2d.lineCap  = "round";
        ctx2d.lineJoin = "round";
        ctx2d.lineWidth = 7;
        def.draw(ctx2d);
        ctx2d.restore();
        growBounds(p.x, p.y, size / 2 + STROKE_BOUNDS_SLACK);
        commitHistory();
        lastOneShotCommit = Date.now();
        state.dirty = true;
        updateStatus();
        markInProgressDirty();
        hideIdleScribble();
        triggerOnionReaction("drawing", 500);
        sfxTap();
    }

    /* ---------- 4e. PAPER TEXTURES (Pro) ----------

       A purely VISUAL layer behind the transparent canvas — the fill
       tool matches canvas pixels, so paper never affects fills, and
       the eraser (destination-out) reveals it naturally. Tiles are
       drawn in code at runtime (no assets) and applied as a repeating
       background on #paperLayer; composePng paints the same tile into
       exports so a saved drawing looks like the screen did.

       Light tints + faint marks only: the printed line art is
       near-black and the deco colors assume light paper. */

    const PAPER_TILE_PX = 120;

    const PAPERS = [
        { id: "classic", label: "CLASSIC", base: "#fbfaf6", free: true },
        { id: "dotty",   label: "DOTTY",   base: "#fbfaf6", free: true, draw: function (c, s) {
            c.fillStyle = "rgba(28,34,38,0.08)";
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    c.beginPath();
                    c.arc(x * s / 4 + s / 8, y * s / 4 + s / 8, 1.6, 0, Math.PI * 2);
                    c.fill();
                }
            }
        } },
        { id: "grid",    label: "GRID",    base: "#fbfaf6", draw: function (c, s) {
            c.strokeStyle = "rgba(79,195,247,0.16)";
            c.lineWidth = 1;
            c.beginPath();
            for (let i = 0; i <= 4; i++) {
                c.moveTo(i * s / 4 + 0.5, 0); c.lineTo(i * s / 4 + 0.5, s);
                c.moveTo(0, i * s / 4 + 0.5); c.lineTo(s, i * s / 4 + 0.5);
            }
            c.stroke();
        } },
        { id: "lines",   label: "LINES",   base: "#fdfcf7", draw: function (c, s) {
            c.strokeStyle = "rgba(91,108,255,0.14)";
            c.lineWidth = 1;
            c.beginPath();
            for (let i = 0; i < 3; i++) {
                c.moveTo(0, i * s / 3 + s / 6 + 0.5);
                c.lineTo(s, i * s / 3 + s / 6 + 0.5);
            }
            c.stroke();
        } },
        { id: "kraft",   label: "KRAFT",   base: "#f2e7d4", draw: function (c, s) {
            /* seeded speckle so the tile is deterministic */
            let seed = 42;
            const rnd = function () {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return seed / 0x7fffffff;
            };
            c.fillStyle = "rgba(120,94,60,0.10)";
            for (let i = 0; i < 60; i++) {
                c.beginPath();
                c.arc(rnd() * s, rnd() * s, 0.6 + rnd() * 1.0, 0, Math.PI * 2);
                c.fill();
            }
        } },
        { id: "mint",    label: "MINT",    base: "#edf7ee" },
        { id: "sky",     label: "SKY",     base: "#edf4fb" },
        { id: "blush",   label: "BLUSH",   base: "#fdf0f4" }
    ];

    function paperDefFor(id) {
        for (let i = 0; i < PAPERS.length; i++) {
            if (PAPERS[i].id === id) return PAPERS[i];
        }
        return PAPERS[0];
    }

    const _paperTileCache = {};

    /* Tile canvas (base + marks) — used for the on-screen layer AND
       composePng's export background, so the two can't disagree. */
    function paperTileCanvas(def) {
        if (_paperTileCache[def.id]) return _paperTileCache[def.id];
        const cv = document.createElement("canvas");
        cv.width = cv.height = PAPER_TILE_PX;
        const c = cv.getContext("2d");
        c.fillStyle = def.base;
        c.fillRect(0, 0, PAPER_TILE_PX, PAPER_TILE_PX);
        if (def.draw) def.draw(c, PAPER_TILE_PX);
        _paperTileCache[def.id] = cv;
        return cv;
    }

    function applyPaper() {
        const layer = $("#paperLayer");
        if (!layer) return;
        const def = paperDefFor(activePaperId());
        layer.style.backgroundColor = def.base;
        if (def.draw) {
            layer.style.backgroundImage =
                "url(" + paperTileCanvas(def).toDataURL() + ")";
            layer.style.backgroundSize = PAPER_TILE_PX + "px " +
                                         PAPER_TILE_PX + "px";
        } else {
            layer.style.backgroundImage = "none";
        }
    }

    /* ---------- HISTORY (dirty-rect patches) ----------

       History used to be a full-canvas PNG dataURL per stroke. That
       cost a toDataURL() encode of the whole viewport-sized backing
       store on EVERY pointerdown — tens of milliseconds of jank right
       at the moment the kid starts drawing — and each entry weighed a
       hundred-odd KB, which is why the depth was capped at 12.

       Now: snapshot the canvas into an offscreen buffer with
       drawImage (a cheap blit, no encode), track the bounding box the
       stroke actually touches, and on commit keep ONLY that rectangle
       as raw ImageData. A typical stroke covers a tiny fraction of the
       screen, so entries are small, undo is instant, and the depth
       affords 30 instead of 12.

       It also makes undo SYNCHRONOUS — the old version had to decode
       an Image before it could paint, so an undo could still be
       pending a frame or two after the click. */

    let histCanvas = null;
    let histCtx    = null;
    let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;

    function ensureHistCanvas() {
        if (!histCanvas) {
            histCanvas = document.createElement("canvas");
            histCtx = histCanvas.getContext("2d", { willReadFrequently: true });
        }
        if (histCanvas.width  !== canvas.width ||
            histCanvas.height !== canvas.height) {
            histCanvas.width  = canvas.width;
            histCanvas.height = canvas.height;
        }
    }

    /* Snapshot the pre-change canvas and reset the dirty box. */
    function beginHistoryCapture() {
        ensureHistCanvas();
        histCtx.setTransform(1, 0, 0, 1, 0, 0);
        histCtx.clearRect(0, 0, histCanvas.width, histCanvas.height);
        histCtx.drawImage(canvas, 0, 0);
        sMinX = Infinity; sMinY = Infinity;
        sMaxX = -Infinity; sMaxY = -Infinity;
    }

    /* Grow the dirty box around a point given in LOGICAL px.
       `pad` is a logical-px radius — pass the brush size plus slack,
       because several brushes scatter past their nominal width
       (glitter throws sparkles out to size/2 + ~2.4, paint stacks
       passes wider than the nib). Under-padding here is the one way
       this design can go visibly wrong: anything drawn outside the
       recorded rect survives an undo as a stray mark. */
    function growBounds(x, y, pad) {
        const d = state.dpr || 1;
        const r = (pad || 0) * d;
        const dx = x * d, dy = y * d;
        if (dx - r < sMinX) sMinX = dx - r;
        if (dy - r < sMinY) sMinY = dy - r;
        if (dx + r > sMaxX) sMaxX = dx + r;
        if (dy + r > sMaxY) sMaxY = dy + r;
    }

    /* Device-px variant, used by the fill tool which already works
       in device space. */
    function growBoundsDevice(x, y) {
        if (x < sMinX) sMinX = x;
        if (y < sMinY) sMinY = y;
        if (x > sMaxX) sMaxX = x;
        if (y > sMaxY) sMaxY = y;
    }

    function markWholeCanvasDirty() {
        sMinX = 0; sMinY = 0;
        sMaxX = canvas.width; sMaxY = canvas.height;
    }

    function historyBytes() {
        let n = 0;
        for (let i = 0; i < state.history.length; i++) {
            n += state.history[i].patch.data.length;
        }
        return n;
    }

    function trimHistory() {
        while (state.history.length > MAX_HISTORY) state.history.shift();
        /* A full-canvas patch (a CLEAR) is ~4.8MB on a phone, so cap
           by bytes too. Always keep at least one entry. */
        while (state.history.length > 1 &&
               historyBytes() > HISTORY_BYTE_BUDGET) {
            state.history.shift();
        }
    }

    function commitHistory() {
        if (!histCanvas) return;
        if (!isFinite(sMinX) || sMaxX < sMinX) return;   /* nothing drawn */
        const W = canvas.width, H = canvas.height;
        const x = Math.max(0, Math.floor(sMinX));
        const y = Math.max(0, Math.floor(sMinY));
        const w = Math.min(W, Math.ceil(sMaxX)) - x;
        const h = Math.min(H, Math.ceil(sMaxY)) - y;
        if (w <= 0 || h <= 0) return;
        let patch;
        try {
            patch = histCtx.getImageData(x, y, w, h);
        } catch (_) { return; }
        state.history.push({ x: x, y: y, patch: patch });
        /* Any new op invalidates the redo stack — the timeline just
           forked. Without this, an undo → new stroke → redo would
           put back the old stroke on top of the new one. */
        if (state.redoStack && state.redoStack.length) {
            state.redoStack.length = 0;
        }
        trimHistory();
        updateUndoButton();
        updateRedoButton();
    }

    /* Snapshot the CURRENT pixels of a rect (the post-op state), so
       an undo can push them onto the redo stack for later redo. */
    function snapshotRect(x, y, w, h) {
        try {
            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            const data = ctx2d.getImageData(x, y, w, h);
            ctx2d.restore();
            return data;
        } catch (_) { return null; }
    }

    function undo() {
        const entry = state.history.pop();
        if (!entry) return;
        /* Capture the current-rect BEFORE we overwrite it, so redo
           can put it back. Cap the redo stack the same way history is
           capped — no runaway memory on a long fiddle session. */
        const forward = snapshotRect(entry.x, entry.y,
                                     entry.patch.width, entry.patch.height);
        if (forward) {
            state.redoStack.push({ x: entry.x, y: entry.y, patch: forward });
            while (state.redoStack.length > MAX_HISTORY) state.redoStack.shift();
        }
        ctx2d.save();
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.putImageData(entry.patch, entry.x, entry.y);
        ctx2d.restore();
        updateUndoButton();
        updateRedoButton();
        if (state.history.length === 0) state.dirty = false;
        markInProgressDirty();
        triggerOnionReaction("undo");
        updateStatus();
        maybeShowIdleScribble();
    }

    /* Redo mirrors undo — pops the redo stack, snapshots the current
       pixels (which the redo is about to overwrite) back onto the
       undo history so a subsequent undo undoes the redo, then paints
       the redo patch. */
    function redo() {
        if (!state.redoStack || !state.redoStack.length) return;
        const entry = state.redoStack.pop();
        if (!entry) return;
        const backward = snapshotRect(entry.x, entry.y,
                                      entry.patch.width, entry.patch.height);
        if (backward) {
            state.history.push({ x: entry.x, y: entry.y, patch: backward });
            trimHistory();
        }
        ctx2d.save();
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.putImageData(entry.patch, entry.x, entry.y);
        ctx2d.restore();
        updateUndoButton();
        updateRedoButton();
        state.dirty = true;
        markInProgressDirty();
        triggerOnionReaction("redo");
        updateStatus();
        maybeShowIdleScribble();
    }

    /* UNDO + REDO buttons live in the action-row alongside ERASE +
       CLEAR. Disabled state mirrors the two stacks. */
    function updateUndoButton() {
        const btn = $("#drawUndo");
        if (!btn) return;
        if (state.history.length === 0) btn.setAttribute("disabled", "");
        else                            btn.removeAttribute("disabled");
    }
    function updateRedoButton() {
        const btn = $("#drawRedo");
        if (!btn) return;
        if (!state.redoStack || state.redoStack.length === 0) {
            btn.setAttribute("disabled", "");
        } else {
            btn.removeAttribute("disabled");
        }
    }

    /* ---------- 3b. ERASE-REVEAL SNAPSHOT ----------

       Erase peels back to the LAST layer, not to bare paper. The
       reveal snapshot is the canvas as it was JUST BEFORE the most
       recent non-erase operation (stroke, fill, or stamp) — so
       painting a cloud over a red sky, then erasing the cloud,
       gives the red sky back.

       Two buffers:
       - revealCanvas: the persistent snapshot the eraser samples
         from. Captured before every non-erase op via
         captureRevealSnapshot().
       - revealScratch: a per-stroke workspace used to mask the
         reveal blit down to just the eraser's footprint. Bounded
         by the segment's dirty rect so it stays cheap on phones.

       When there is no prior layer to reveal (fresh page, first
       stroke), revealCanvas is empty and the eraser cleanly erases
       to bare paper — the pre-2026-08-09 behaviour. */

    let revealCanvas = null, revealCtx = null;
    let revealScratch = null, revealScratchCtx = null;

    function ensureRevealCanvas() {
        if (!revealCanvas) {
            revealCanvas = document.createElement("canvas");
            revealCtx = revealCanvas.getContext("2d", { willReadFrequently: true });
        }
        if (revealCanvas.width  !== canvas.width ||
            revealCanvas.height !== canvas.height) {
            revealCanvas.width  = canvas.width;
            revealCanvas.height = canvas.height;
        }
        if (!revealScratch) {
            revealScratch = document.createElement("canvas");
            revealScratchCtx = revealScratch.getContext("2d");
        }
        if (revealScratch.width  !== canvas.width ||
            revealScratch.height !== canvas.height) {
            revealScratch.width  = canvas.width;
            revealScratch.height = canvas.height;
        }
    }

    /* Blit the current canvas into revealCanvas. Call this BEFORE
       any non-erase modification (stroke start, fill, stamp) — the
       eraser then reads from this to peel back to the pre-op state. */
    function captureRevealSnapshot() {
        ensureRevealCanvas();
        revealCtx.save();
        revealCtx.setTransform(1, 0, 0, 1, 0, 0);
        revealCtx.clearRect(0, 0, revealCanvas.width, revealCanvas.height);
        revealCtx.drawImage(canvas, 0, 0);
        revealCtx.restore();
    }

    /* Reset the reveal buffer — call on CLEAR and template swap so
       the eraser after a clear reveals bare paper, not the ghost of
       the previous page. */
    function clearRevealCanvas() {
        if (!revealCanvas) return;
        revealCtx.save();
        revealCtx.setTransform(1, 0, 0, 1, 0, 0);
        revealCtx.clearRect(0, 0, revealCanvas.width, revealCanvas.height);
        revealCtx.restore();
    }

    /* Paint pixels from revealCanvas onto the main canvas, clipped
       to a brush footprint. Two-pass:
         1) destination-out with the mask shape → clears the footprint
            on the main canvas
         2) source-in the reveal pixels into a scratch mask, then
            source-over that patch back onto the main canvas
       Both passes are bounded by the segment's dirty rect (dx..dw,
       dy..dh in device px) so cost scales with the segment size,
       not the whole canvas. */
    function eraserPaintReveal(mainCtx, drawShapeIntoMask,
                               minLx, minLy, maxLx, maxLy) {
        ensureRevealCanvas();
        const dpr = state.dpr || 1;
        const dx = Math.max(0, Math.floor(minLx * dpr));
        const dy = Math.max(0, Math.floor(minLy * dpr));
        const dw = Math.min(canvas.width,  Math.ceil(maxLx * dpr)) - dx;
        const dh = Math.min(canvas.height, Math.ceil(maxLy * dpr)) - dy;
        if (dw <= 0 || dh <= 0) return;

        /* Build a dpr-scaled mask of the brush footprint into the
           scratch's dirty rect, then use source-in to keep only the
           reveal pixels covered by that mask. */
        revealScratchCtx.save();
        revealScratchCtx.setTransform(1, 0, 0, 1, 0, 0);
        revealScratchCtx.globalCompositeOperation = "source-over";
        revealScratchCtx.globalAlpha = 1;
        revealScratchCtx.clearRect(dx, dy, dw, dh);
        revealScratchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        revealScratchCtx.fillStyle   = "#000";
        revealScratchCtx.strokeStyle = "#000";
        drawShapeIntoMask(revealScratchCtx);
        revealScratchCtx.setTransform(1, 0, 0, 1, 0, 0);
        revealScratchCtx.globalCompositeOperation = "source-in";
        revealScratchCtx.drawImage(revealCanvas, dx, dy, dw, dh,
                                                  dx, dy, dw, dh);
        revealScratchCtx.restore();

        /* Main canvas: clear the footprint, then lay in the masked
           reveal patch. mainCtx enters at the dpr transform (setupCanvas
           invariant); ctx.save/restore preserves that around the
           identity-transform blit of the reveal patch. */
        mainCtx.save();
        mainCtx.globalCompositeOperation = "destination-out";
        mainCtx.globalAlpha = 1;
        mainCtx.fillStyle   = "#000";
        mainCtx.strokeStyle = "#000";
        drawShapeIntoMask(mainCtx);
        mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        mainCtx.globalCompositeOperation = "source-over";
        mainCtx.drawImage(revealScratch, dx, dy, dw, dh,
                                          dx, dy, dw, dh);
        mainCtx.restore();
    }

    /* ---------- 4. IDLE SCRIBBLE ----------
       Kinetic centerpiece visible on a fresh blank canvas — Tiny
       Canvas's answer to Pootery's spinning clay. Fades out the
       moment the kid makes a stroke; comes back after CLEAR.
       Only renders on the BLANK template (other templates have
       their own line-art as the centerpiece). */

    function maybeShowIdleScribble() {
        const el = $("#idleScribble");
        if (!el) return;
        const shouldShow = state.templateId === "blank" && !state.dirty;
        el.classList.toggle("is-hidden", !shouldShow);
    }

    function hideIdleScribble() {
        const el = $("#idleScribble");
        if (el) el.classList.add("is-hidden");
    }

    /* ---------- 4a. ONION MASCOT ----------
       Small SVG character anchored to the bottom-left of the viewport
       that reacts to drawing events. Eyes track the brush; mouth
       changes per state; whole onion jumps on save, shudders on clear.

       The onion has pointer-events: none so it never blocks drawing.
       All animations honor prefers-reduced-motion in CSS. */

    /* All reaction classes the Onion can wear. setOnionState clears
       the whole set and (optionally) adds one — keep this list in
       sync with the .onion.is-* selectors in style.css or the
       previous reaction won't come off. */
    const ONION_STATES = [
        "is-drawing", "is-saved", "is-cleared", "is-undo",
        "is-redo", "is-first-stroke", "is-eureka",
        "is-tool-swap", "is-sleepy"
    ];

    function setOnionState(name) {
        const onion = $("#onion");
        if (!onion) return;
        for (let i = 0; i < ONION_STATES.length; i++) {
            onion.classList.remove(ONION_STATES[i]);
        }
        if (name) onion.classList.add("is-" + name);
    }

    let _onionRevertT = 0;
    function triggerOnionReaction(name, ms) {
        setOnionState(name);
        ms = ms || (name === "saved"         ? 900 :
                    name === "cleared"       ? 1000 :
                    name === "undo"          ? 400 :
                    name === "redo"          ? 550 :
                    name === "first-stroke"  ? 700 :
                    name === "eureka"        ? 500 :
                    name === "tool-swap"     ? 350 :
                    600);
        clearTimeout(_onionRevertT);
        _onionRevertT = setTimeout(function () { setOnionState(null); }, ms);
    }

    /* Sleepy: after ~30s with no gesture on the draw screen, the
       Onion nods off. Any real activity wakes her. Kept subtle so
       parents don't read it as a bug. */
    const SLEEPY_MS = 30 * 1000;
    let _sleepyTimer = 0;
    function nudgeOnionAwake() {
        clearTimeout(_sleepyTimer);
        const onion = $("#onion");
        if (onion && onion.classList.contains("is-sleepy")) {
            setOnionState(null);
        }
        if (state.screen === "draw") {
            _sleepyTimer = setTimeout(function () {
                /* Only sleep if we're STILL on draw and the kid
                   isn't mid-stroke — waking her from a stroke would
                   read as a glitch. */
                if (state.screen === "draw" && !state.isDrawing) {
                    setOnionState("sleepy");
                }
            }, SLEEPY_MS);
        }
    }

    /* Eye tracking: as the pointer moves anywhere on the viewport,
       shift the pupils + highlights toward it. Subtle — max ~3px.
       Uses SVG transform on the eye groups so it composes with the
       CSS blink animation (which targets pupils + highlights). */
    function onionTrackGaze(e) {
        const onion = $("#onion");
        if (!onion) return;
        const rect = onion.getBoundingClientRect();
        if (rect.width === 0) return;
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const maxOff   = 3;
        const distRamp = Math.min(1, dist / 220);
        const ox = (dx / dist) * maxOff * distRamp;
        const oy = (dy / dist) * maxOff * distRamp;
        const t = "translate(" + ox.toFixed(2) + " " + oy.toFixed(2) + ")";
        const eL = onion.querySelector(".onion-eye-l");
        const eR = onion.querySelector(".onion-eye-r");
        if (eL) eL.setAttribute("transform", t);
        if (eR) eR.setAttribute("transform", t);
    }

    /* ---------- 4c. TIME-LAPSE REPLAY RECORDER ----------

       Every non-erase op appends a compact event to state.replayEvents.
       On save the list is serialized alongside the PNG, and the
       gallery detail panel gets a PLAY button that renders the
       drawing forming.

       Event shapes (short keys because localStorage is bytes):
         { t:'S', tool, sz, col, pts: [[x,y],...] }   stroke
         { t:'F', col, pat, sx, sy }                  fill
         { t:'M', id, col, x, y, sz }                 stamp
         { t:'C' }                                     clear

       Erase strokes are deliberately NOT recorded — their effect
       depends on the reveal buffer, which isn't reproducible from a
       serialized event alone. In replay, an eraser stroke just
       leaves the pixels from the moment before it was cast.

       Rounds coordinates to 1 decimal — cuts JSON size roughly in
       half with no visible difference at the sub-pixel scale. */

    function replayReset() {
        state.replayEvents = [];
        state.replayStrokePts = null;
    }

    function replayIsFull() {
        return (state.replayEvents.length >= REPLAY_MAX_EVENTS);
    }

    /* Round for storage: 1 decimal keeps ~0.05 logical-px precision,
       which is well below one on-screen device pixel at any dpr. */
    function r1(n) { return Math.round(n * 10) / 10; }

    function replayBeginStroke(p) {
        if (state.currentTool === "eraser") return;
        if (replayIsFull()) return;
        state.replayStrokePts = [[r1(p.x), r1(p.y)]];
        state._replayLastSampleTs = 0;
    }

    function replayAddStrokePoint(p, ts) {
        if (!state.replayStrokePts) return;
        if (state.replayStrokePts.length >= REPLAY_MAX_STROKE_PTS) return;
        /* Throttle by time — the digitiser fires far more samples than
           a replay needs. Always accept the first point. */
        if (state._replayLastSampleTs &&
            (ts - state._replayLastSampleTs) < REPLAY_STROKE_SAMPLE_MS) return;
        state._replayLastSampleTs = ts;
        state.replayStrokePts.push([r1(p.x), r1(p.y)]);
    }

    function replayEndStroke() {
        if (!state.replayStrokePts) return;
        if (state.replayStrokePts.length < 1) {
            state.replayStrokePts = null;
            return;
        }
        state.replayEvents.push({
            t:    "S",
            tool: state.currentTool,
            sz:   effectiveSize(),
            col:  state.currentColor,
            pts:  state.replayStrokePts
        });
        state.replayStrokePts = null;
    }

    /* Drop the in-flight stroke without banking it — pinch cancel,
       WebGL context loss, etc. */
    function replayCancelStroke() {
        state.replayStrokePts = null;
    }

    function replayRecordFill(p) {
        if (replayIsFull()) return;
        state.replayEvents.push({
            t:   "F",
            col: state.currentColor,
            pat: state.fillPattern,
            sx:  r1(p.x),
            sy:  r1(p.y)
        });
    }

    function replayRecordStamp(p, size) {
        if (replayIsFull()) return;
        state.replayEvents.push({
            t:   "M",
            id:  state.stampId,
            col: state.currentColor,
            x:   r1(p.x),
            y:   r1(p.y),
            sz:  size
        });
    }

    function replayRecordClear() {
        if (replayIsFull()) return;
        state.replayEvents.push({ t: "C" });
    }

    /* ---------- 4d. COLOR-BY-NUMBER ENGINE ----------

       A template opts in with a `cbn` field:

         cbn: {
           palette: ["#hex", "#hex", ...],   // 1-indexed numbered
           assign?: function(cx, cy, W, H)   // optional: colour idx per region
         }

       If `assign` is present, runtime calls it per detected region
       (cx/cy = 0..1 normalized) and uses whatever palette index it
       returns. If absent, regions get a deterministic centroid-hash
       assignment — good enough to demo the mechanic, not
       artistically curated. Onion authors the assign rules per page
       (or the future Python pipeline emits an inline `regions`
       array from a reference PNG; see scripts/process-cbn-page.py).

       Region detection walks the fill mask (same Uint8Array the
       fill tool uses) for connected components of non-boundary
       pixels. Regions smaller than CBN_MIN_REGION_PX are skipped —
       stray specks between antialiased lines shouldn't get their
       own number.

       Fill routing is patched in floodFillAt: when CBN is active, a
       tap in a region checks the armed palette index against the
       region's assigned index. Match = happy Onion + track
       completion. Mismatch = fill anyway (no punishment — Onion's
       kids-first rule), Onion stays neutral. */

    const CBN_MIN_REGION_PX = 400;   /* device-px area threshold */
    const CBN_MAX_REGIONS   = 40;    /* skip pages with runaway region counts */

    function cbnReset() {
        const wasActive = !!state.cbn;
        state.cbn = null;
        cbnClearLabelOverlay();
        /* If we were in CBN mode, rebuild the normal palette + chrome
           so the page after doesn't inherit numbered swatches. */
        if (wasActive) {
            buildPalette();
        }
    }

    /* Build the CBN state for a template on load. Two modes:
         1. Explicit `regions` array (emitted by
            scripts/process-cbn-page.py) — normalized {cx,cy,ci} in
            [0,1]. Trusted verbatim; scaled to mask coords for
            cbnResolveTap. Preferred for real Onion-authored pages.
         2. Runtime auto-detect — scan the fill mask, apply an
            `assign` function (or the centroid hash fallback). Used
            for demo pages and quick iteration.
       Async because the fill mask is async; the label overlay
       renders once the mask is ready. */
    async function cbnMaybeActivate(tpl) {
        cbnReset();
        if (!tpl || !tpl.cbn || !tpl.cbn.palette) return;

        const mask = await buildFillMask();
        if (!mask) return;
        /* Guard against a template swap that happened mid-await —
           don't stamp CBN state onto whatever page loaded second. */
        if (state.templateId !== tpl.id) return;

        const W = fillMaskW, H = fillMaskH;
        const palette = tpl.cbn.palette.slice();
        let regions;

        if (Array.isArray(tpl.cbn.regions) && tpl.cbn.regions.length) {
            /* Pre-authored regions — normalized coords. */
            regions = tpl.cbn.regions.map(function (r) {
                const ci = (typeof r.ci === "number" &&
                            r.ci >= 1 && r.ci <= palette.length) ? r.ci : 1;
                return {
                    cx:   r.cx * W,
                    cy:   r.cy * H,
                    area: (typeof r.area === "number")
                          ? r.area
                          : Math.round((W * H) / tpl.cbn.regions.length),
                    ci:   ci
                };
            });
        } else {
            /* Runtime auto-detect + assign. */
            regions = cbnDetectRegions(mask, W, H);
            if (!regions.length) return;
            const assign = (typeof tpl.cbn.assign === "function")
                           ? tpl.cbn.assign
                           : cbnDefaultAssign(palette.length);
            for (let i = 0; i < regions.length; i++) {
                const r = regions[i];
                let ci = assign(r.cx / W, r.cy / H, W, H);
                if (typeof ci !== "number" || ci < 1 ||
                    ci > palette.length) ci = 1;
                r.ci = ci;
            }
        }

        state.cbn = {
            palette:   palette,
            regions:   regions,
            activeIdx: 1,
            completed: new Set()
        };

        cbnRenderLabelOverlay();
        buildPalette();   /* re-render palette with numbered swatches */
    }

    /* Auto-assignment fallback: cycles palette indices in reading order,
       so adjacent regions rarely share a number. Deterministic per
       (cx,cy,paletteN) so a re-load of the same page shows the same
       numbers. */
    function cbnDefaultAssign(paletteN) {
        return function (cx, cy) {
            /* Small hash on the normalized centroid — Cantor-style
               pairing then mod paletteN. Stable across sessions. */
            const a = Math.floor(cx * 100), b = Math.floor(cy * 100);
            const h = ((a * 73856093) ^ (b * 19349663)) >>> 0;
            return (h % paletteN) + 1;
        };
    }

    /* Scanline flood-fill on the mask to enumerate connected
       non-boundary regions. Skips small components (specks between
       antialiased strokes) and any region touching the border past
       CBN_MAX_REGIONS (which is a runaway signal — usually a page
       whose ink is too thin to seal). Returns [{cx,cy,area}]
       sorted largest-first. */
    function cbnDetectRegions(mask, W, H) {
        const seen  = new Uint8Array(W * H);
        const found = [];
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                if (seen[i] || mask[i]) continue;
                /* BFS on this component. */
                const stack = [i];
                let area = 0, sx = 0, sy = 0;
                while (stack.length) {
                    const seed = stack.pop();
                    const py = (seed / W) | 0;
                    let px = seed - py * W;
                    while (px > 0 && !seen[py * W + px - 1] &&
                           !mask[py * W + px - 1]) px--;
                    let up = false, dn = false;
                    while (px < W) {
                        const j = py * W + px;
                        if (seen[j] || mask[j]) break;
                        seen[j] = 1;
                        area++; sx += px; sy += py;
                        if (py > 0) {
                            const u = j - W;
                            const openU = !seen[u] && !mask[u];
                            if (openU && !up) { stack.push(u); up = true; }
                            else if (!openU)  up = false;
                        }
                        if (py < H - 1) {
                            const d = j + W;
                            const openD = !seen[d] && !mask[d];
                            if (openD && !dn) { stack.push(d); dn = true; }
                            else if (!openD)  dn = false;
                        }
                        px++;
                    }
                }
                if (area < CBN_MIN_REGION_PX) continue;
                found.push({ cx: sx / area, cy: sy / area, area: area });
                if (found.length > CBN_MAX_REGIONS * 2) {
                    /* Bail if the count is exploding — the page isn't
                       CBN-suitable. Caller will see zero and skip. */
                    return [];
                }
            }
        }
        found.sort(function (a, b) { return b.area - a.area; });
        return found.slice(0, CBN_MAX_REGIONS);
    }

    /* Number label overlay — one absolutely-positioned <span> per
       region, layered above the line-art but under the tool rail. */
    function cbnClearLabelOverlay() {
        const host = $("#cbnLabels");
        if (host) host.innerHTML = "";
    }

    function cbnRenderLabelOverlay() {
        const host = $("#cbnLabels");
        if (!host || !state.cbn) return;
        host.innerHTML = "";
        const art = overlayArtEl();
        if (!art) return;
        const W = fillMaskW, H = fillMaskH;
        const regs = state.cbn.regions;
        for (let i = 0; i < regs.length; i++) {
            const r = regs[i];
            const label = document.createElement("span");
            label.className = "cbn-label";
            label.textContent = String(r.ci);
            /* Position in the OVERLAY's coordinate space (percent).
               The overlay tracks the art element's box via CSS
               (see #cbnLabels rule), so pixel-fraction of the mask
               = pixel-fraction of the art. */
            label.style.left = (100 * r.cx / W).toFixed(2) + "%";
            label.style.top  = (100 * r.cy / H).toFixed(2) + "%";
            host.appendChild(label);
        }
    }

    /* Called by floodFillAt when a fill lands. Returns:
         "match"     — the armed color matched the region's target
         "mismatch"  — a valid region, wrong color (fill anyway)
         "no-region" — tap wasn't inside any detected region
       Only meaningful when state.cbn is set. */
    function cbnResolveTap(sx, sy) {
        if (!state.cbn) return "no-region";
        /* Find the region whose centroid is closest to the tap AND
           whose area, projected as a circle from the centroid, would
           plausibly contain the tap. Cheap heuristic — the fill
           routes to the region the tap actually belongs to by mask
           topology, so we only need a coarse lookup for reactions. */
        let best = null, bestD2 = Infinity;
        for (let i = 0; i < state.cbn.regions.length; i++) {
            const r = state.cbn.regions[i];
            const dx = sx - r.cx, dy = sy - r.cy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = r; }
        }
        if (!best) return "no-region";
        /* Reject if the tap is far outside the region's plausible
           radius (2× the equivalent-circle radius). */
        const rMax = 2 * Math.sqrt(best.area / Math.PI);
        if (Math.sqrt(bestD2) > rMax) return "no-region";
        return (best.ci === state.cbn.activeIdx) ? "match" : "mismatch";
    }

    function cbnMarkRegionComplete(sx, sy) {
        if (!state.cbn) return;
        let best = null, bestD2 = Infinity;
        for (let i = 0; i < state.cbn.regions.length; i++) {
            const r = state.cbn.regions[i];
            const dx = sx - r.cx, dy = sy - r.cy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = r; }
        }
        if (best) state.cbn.completed.add(best);
    }

    /* ---------- 4b. WET STROKE LAYER ----------

       Why this exists: most brushes paint translucent (crayon .45,
       glitter .55, spray .85, ...), and each drawSegment used to
       stroke a SEPARATE path straight onto the canvas with round
       caps. Consecutive segments overlap at their shared endpoint,
       so translucent ink landed on translucent ink and compounded —
       leaving a visibly darker dot at every single pointer sample.
       On crayon and glitter it read as a string of beads rather than
       a line.

       Real paint programs solve this by keeping the in-progress stroke
       on its own layer at FULL opacity — overlapping opaque ink of one
       colour is idempotent, so no beads form — and blending that layer
       down once, at the brush's alpha, when compositing. We already
       snapshot the pre-stroke canvas into histCanvas for undo, so the
       live redraw is just: restore base, then lay the wet layer over it
       at the brush's alpha.

       Cost is two full-canvas drawImage calls per pointermove, both GPU
       blits. The eraser stays OFF this path — it works in
       destination-out on the real canvas and has nothing to blend. */

    let strokeLayer = null;
    let strokeCtx   = null;

    function ensureStrokeLayer() {
        if (!strokeLayer) {
            strokeLayer = document.createElement("canvas");
            strokeCtx = strokeLayer.getContext("2d");
        }
        if (strokeLayer.width  !== canvas.width ||
            strokeLayer.height !== canvas.height) {
            strokeLayer.width  = canvas.width;
            strokeLayer.height = canvas.height;
        }
        const dpr = state.dpr || 1;
        strokeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        strokeCtx.lineCap  = "round";
        strokeCtx.lineJoin = "round";
    }

    function clearStrokeLayer() {
        ensureStrokeLayer();
        strokeCtx.save();
        strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
        strokeCtx.clearRect(0, 0, strokeLayer.width, strokeLayer.height);
        strokeCtx.restore();
    }

    /* Rebuild the visible canvas = pre-stroke snapshot + wet layer at
       the brush's alpha. */
    function compositeStroke() {
        if (!strokeLayer || !histCanvas) return;
        const a = currentBrush().alpha;
        ctx2d.save();
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.globalAlpha = 1;
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        ctx2d.drawImage(histCanvas, 0, 0);
        ctx2d.globalAlpha = (typeof a === "number") ? a : 1;
        ctx2d.drawImage(strokeLayer, 0, 0);
        ctx2d.restore();
    }

    /* True while a wet stroke is being composited. Brushes flagged
       `direct` (eraser's destination-out, smudge's read-the-canvas
       smear) must hit the real canvas instead. */
    function usesStrokeLayer() {
        return !currentBrush().direct;
    }

    /* ---------- 5. DRAWING ---------- */

    function attachDrawing() {
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup",   onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("pointerleave",  onPointerUp);
        /* Desktop zoom: ctrl/cmd+wheel zooms at the cursor, plain
           wheel pans while zoomed in. */
        canvas.addEventListener("wheel", function (e) {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
            } else if (view.s > 1) {
                view.tx -= e.deltaX;
                view.ty -= e.deltaY;
                applyView();
            }
        }, { passive: false });
        const zin  = $("#zoomInBtn");
        const zout = $("#zoomOutBtn");
        if (zin) zin.addEventListener("click", function () {
            zoomAt(ZOOM_STEP, window.innerWidth / 2, window.innerHeight / 2);
            sfxTap();
        });
        if (zout) zout.addEventListener("click", function () {
            zoomAt(1 / ZOOM_STEP, window.innerWidth / 2, window.innerHeight / 2);
            sfxTap();
        });
        /* Eye tracking lives at document level so the onion looks at
           the cursor even when it's over the tool rail or titlebar. */
        document.addEventListener("pointermove", onionTrackGaze, { passive: true });
    }

    function onPointerDown(e) {
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        /* Two fingers = pinch zoom/pan, never two marks. The second
           finger cancels any in-flight stroke (see beginPinch). */
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 2) { beginPinch(); return; }
        if (activePointers.size > 2 || pinch) return;
        /* The first real gesture retires the coach — a kid who has
           already started drawing does not need to be told how. */
        dismissCoach();
        /* Reaching the canvas at all means the kid is done with the
           sheet — slide it back down so it stops covering the art. */
        if (isDrawerOpen()) setDrawerOpen(false);
        const p = getPos(e);
        /* Fill is a one-shot tap, not a stroke: it never sets
           isDrawing, so pointermove stays inert and no stroke is
           finished on pointerup. It pushes its own history entry once
           it knows it will actually paint something — pushing here
           would burn an undo step on a tap that landed on a line. */
        if (isFillTool()) { floodFillAt(p); return; }
        /* Stamp is a one-shot tap too — places the armed shape and
           handles its own history entry. */
        if (isStampTool()) { placeStampAt(p); return; }
        /* Fill-erase: last brush was FILL, so ERASE acts as a
           tap-to-unfill — one-shot too, sharing the fill's flood
           machinery but painting from revealCanvas. */
        if (state.currentTool === "eraser" &&
            state.lastNonEraseTool === "fill") {
            floodFillEraseAt(p);
            return;
        }
        /* Non-erase stroke → snapshot the canvas BEFORE the stroke
           begins, so a later ERASE peels back to this state. Erase
           strokes do NOT re-snapshot (they consume the reveal, they
           don't advance it). */
        if (state.currentTool !== "eraser") {
            captureRevealSnapshot();
            replayBeginStroke(p);
        }
        beginHistoryCapture();
        state.isDrawing = true;
        state.lastX  = p.x;
        state.lastY  = p.y;
        state.smoothX = p.x;
        state.smoothY = p.y;
        const brush = currentBrush();
        const size  = effectiveSize();
        const color = state.currentColor;
        if (usesStrokeLayer()) {
            clearStrokeLayer();
            brush.beginStroke(strokeCtx, p, size, color);
            compositeStroke();
        } else {
            brush.beginStroke(ctx2d, p, size, color);
        }
        growBounds(p.x, p.y, size + STROKE_BOUNDS_SLACK);
        /* First stroke on a freshly-loaded page gets the big pleased
           hop reaction — a moment of "you started!" without any words.
           Detected as "wasn't dirty before this stroke started". */
        const isFirstStrokeOnPage = !state.dirty;
        state.dirty = true;
        updateStatus();
        markInProgressDirty();
        hideIdleScribble();
        if (isFirstStrokeOnPage && state.currentTool !== "eraser") {
            /* Fire once, but let the drawing state take over
               immediately after — the hop is a flourish, not a
               replacement for the "actively drawing" mouth. */
            triggerOnionReaction("first-stroke", 500);
            setTimeout(function () {
                if (state.isDrawing) setOnionState("drawing");
            }, 500);
        } else {
            setOnionState("drawing");
        }
        nudgeOnionAwake();
        if (state.currentTool === "eraser") sfxErase();
        else                                sfxTap();
    }

    function onPointerMove(e) {
        if (activePointers.has(e.pointerId)) {
            activePointers.set(e.pointerId,
                               { x: e.clientX, y: e.clientY });
        }
        if (pinch) { updatePinch(); return; }
        if (!state.isDrawing) return;
        const brush = currentBrush();
        const size  = effectiveSize();
        const color = state.currentColor;
        const target = usesStrokeLayer() ? strokeCtx : ctx2d;

        /* Pointermove is throttled to the display refresh, so a fast
           swipe arrives as a few widely-spaced points and the line
           renders as visible straight facets. getCoalescedEvents hands
           back every sample the digitiser actually captured between
           frames, which is what makes a quick stroke read as a curve
           rather than a polygon. Falls back to the single event where
           unsupported. */
        let points;
        if (typeof e.getCoalescedEvents === "function") {
            const raw = e.getCoalescedEvents();
            points = (raw && raw.length ? raw : [e]).map(getPos);
        } else {
            points = [getPos(e)];
        }

        for (let n = 0; n < points.length; n++) {
            drawOneMove(points[n], brush, size, color, target);
        }

        if (usesStrokeLayer()) compositeStroke();
    }

    function drawOneMove(p, brush, size, color, ctx) {
        if (state.settings.smoothing) {
            /* Midpoint-quadratic smoothing: draw from the current
               smoothed point to the midpoint of (lastRaw, currentRaw).
               This filters out pointer jitter and produces a softer
               line that follows the kid's intent rather than every
               event tremor. */
            const midX = (state.lastX + p.x) / 2;
            const midY = (state.lastY + p.y) / 2;
            brush.drawSegment(ctx,
                { x: state.smoothX, y: state.smoothY },
                { x: midX,          y: midY },
                size, color);
            state.smoothX = midX;
            state.smoothY = midY;
        } else {
            brush.drawSegment(ctx,
                { x: state.lastX, y: state.lastY },
                p, size, color);
            state.smoothX = p.x;
            state.smoothY = p.y;
        }

        growBounds(p.x, p.y, size + STROKE_BOUNDS_SLACK);

        /* Sample the raw point into the replay recorder (throttled
           there — see replayAddStrokePoint). Skipped for the eraser
           tool since erase strokes aren't recorded at all. */
        if (state.currentTool !== "eraser") {
            replayAddStrokePoint(p, performance.now());
        }

        state.lastX = p.x;
        state.lastY = p.y;
    }

    function onPointerUp(e) {
        if (e && e.pointerId !== undefined) {
            activePointers.delete(e.pointerId);
        }
        if (pinch) {
            if (activePointers.size < 2) pinch = null;
            return;
        }
        const wasDrawing = state.isDrawing;
        if (state.isDrawing && state.settings.smoothing) {
            /* Finish the smoothed stroke by drawing one final segment
               from the last smoothed point to the actual raw point.
               Without this the smoothed line stops short of the kid's
               finger. */
            const brush = currentBrush();
            brush.drawSegment(usesStrokeLayer() ? strokeCtx : ctx2d,
                { x: state.smoothX, y: state.smoothY },
                { x: state.lastX,   y: state.lastY },
                effectiveSize(), state.currentColor);
            growBounds(state.lastX, state.lastY,
                       effectiveSize() + STROKE_BOUNDS_SLACK);
        }
        /* Flatten the wet layer down one last time so the canvas holds
           the finished stroke before history reads it. */
        if (wasDrawing && usesStrokeLayer()) {
            compositeStroke();
            clearStrokeLayer();
        }
        /* Bank the stroke as one undo step, keeping only the rectangle
           it actually touched. Skip the commit — and fire the soft
           tutorial — when an erase stroke changed nothing (dragged over
           printed lines or over already-blank paper). Banking an empty
           patch would waste an undo slot on a no-op the kid never asked
           for. */
        if (wasDrawing) {
            if (state.currentTool === "eraser" && eraseWasNoop()) {
                maybeShowEraseTip();
            } else {
                commitHistory();
                /* Bank the completed stroke into the replay recorder.
                   No-op for erase strokes (replayBeginStroke skipped
                   them, so state.replayStrokePts is null). */
                replayEndStroke();
                /* Onion's "aha!" reaction when a brush-erase actually
                   surfaced a color from underneath — reveal worked,
                   not just wiped to paper. Skip on fill-erase (which
                   takes a different pointer path) and on non-erase
                   strokes (which fire "drawing" already). */
                if (state.currentTool === "eraser" && eraseRevealedColor()) {
                    triggerOnionReaction("eureka");
                }
            }
        }
        nudgeOnionAwake();
        state.isDrawing = false;
        /* Reset shared canvas state so the next stroke begins clean. */
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.globalAlpha = 1;
        /* Onion goes back to idle after the stroke ends. */
        setOnionState(null);
    }

    /* ---------- 6. TEMPLATE LOADING ---------- */

    async function loadTemplate(tpl) {
        /* Save the kid's current work to its template's in-progress
           slot BEFORE clearing the canvas — so going BLANK → UNICORN
           → BLANK restores the BLANK strokes. Without this the
           previous drawing would be lost the moment you tap a
           different page. No-op on first entry. */
        if (state.templateId && state.dirty) {
            markInProgressDirty();
            await persistInProgress();
        }
        state.templateId   = tpl.id;
        state.templateName = tpl.name;
        resetView();
        const overlay = $("#lineArt");
        if (tpl.image) {
            /* Raster coloring page. Built as an element (not innerHTML)
               so the src assignment and load events are on a node we
               control; buildFillMask waits on this img's load if a
               fill lands before the file arrives. */
            const img = document.createElement("img");
            img.className = "art-loading";
            img.src = tpl.image;
            img.alt = "";
            img.draggable = false;
            const reveal = function () {
                img.classList.remove("art-loading");
            };
            if (img.complete && img.naturalWidth) reveal();
            else img.addEventListener("load", reveal, { once: true });
            overlay.innerHTML = "";
            overlay.appendChild(img);
        } else {
            overlay.innerHTML = tpl.svg || "";
        }
        /* New page, new boundaries. */
        invalidateFillMask();
        $("#drawTitle").innerHTML = "&lt;&nbsp;" + tpl.name + "&nbsp;&gt;";
        clearCanvas();
        state.savedId = null;
        updateStatus();
        /* If the kid was mid-drawing this template before (e.g. they
           closed the app and came back), restore those strokes silently.
           No confirm dialog — Bala's gallery is sacred + no nag. */
        tryRestoreInProgress(tpl.id);
        /* Reveal the idle scribble if we landed on a fresh BLANK
           with no strokes; hide it otherwise (template is loaded
           or restore brought back existing strokes). */
        maybeShowIdleScribble();
        /* Enter CBN mode if the template opts in. Async — waits on
           the fill mask + then renders the number-label overlay and
           swaps the palette. Templates without `cbn` deactivate any
           lingering CBN state from the previous page. */
        cbnMaybeActivate(tpl);
    }

    /* ---------- 7. UI BUILDERS ---------- */

    /* Unlocked: one headed section per pack, all pages. Locked
       native: ONE flat headerless grid — the EXTRAS pages plus each
       category's `free: true` representative. Pro content is absent,
       never padlocked or greyed, so the free app reads as complete.
       Empty packs render nothing at either tier. */
    /* Built on first entry to the picker, NOT at init. The cards live on
       a hidden screen, and a hidden <img> can never intersect the
       viewport — so `loading="lazy"` does not defer it and building this
       early made the browser fetch every page up front (measured: 6.2MB,
       and 92 megapixels decoded). Deferring means the fetch happens when
       the grid is actually on screen, where lazy loading works. */
    let pickerBuilt = false;

    function buildPicker() {
        const grid = $("#pickerGrid");
        if (pickerBuilt && grid.childElementCount) return;
        pickerBuilt = true;
        grid.innerHTML = "";
        const packs = (window.TINY_CANVAS_PAGE_PACKS || []).filter(
            function (pk) { return pk.pages.length; });
        if (isPro()) {
            const showHeaders = packs.length > 1;
            packs.forEach(function (pk) {
                if (showHeaders) {
                    const h = document.createElement("h3");
                    h.className = "picker-section";
                    h.textContent = pk.label;
                    grid.appendChild(h);
                }
                pk.pages.forEach(function (tpl) {
                    grid.appendChild(buildPickCard(tpl));
                });
            });
            return;
        }
        packs.forEach(function (pk) {
            pk.pages.forEach(function (tpl) {
                if (!pk.pro || tpl.free) {
                    grid.appendChild(buildPickCard(tpl));
                }
            });
        });
    }

    const PAGES_DIR = "assets/coloring-pages/";

    function thumbSrc(image) {
        return image.indexOf(PAGES_DIR) === 0
            ? PAGES_DIR + "thumbs/" + image.slice(PAGES_DIR.length)
            : image;
    }

    function buildPickCard(tpl) {
            const card = document.createElement("button");
            card.className = "pick-card";
            card.type = "button";
            card.setAttribute("data-id", tpl.id);

            const thumb = document.createElement("div");
            thumb.className = "pick-thumb";
            if (tpl.image) {
                const im = document.createElement("img");
                /* 360px thumb, not the 1800px page — by convention at
                   assets/coloring-pages/thumbs/<same relative path>
                   (written by scripts/process-coloring-pages.py from the
                   page's own alpha, so it cannot drift). Falls back to
                   the full page if a thumb is ever missing. */
                im.src = thumbSrc(tpl.image);
                im.onerror = function () {
                    im.onerror = null;
                    im.src = tpl.image;
                };
                im.alt = "";
                im.loading = "lazy";
                im.decoding = "async";
                im.draggable = false;
                thumb.appendChild(im);
            } else {
                thumb.innerHTML = tpl.svg ||
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">' +
                    '<rect x="100" y="100" width="600" height="600" fill="none" ' +
                    'stroke="currentColor" stroke-width="6" stroke-dasharray="20 16"/>' +
                    '</svg>';
            }
            card.appendChild(thumb);

            const name = document.createElement("span");
            name.className = "pick-name";
            name.textContent = tpl.name;
            card.appendChild(name);

            card.addEventListener("click", async function () {
                await loadTemplate(tpl);
                showScreen("draw");
            });
            return card;
    }

    /* Palette-group tabs build once at init; the active tab swaps
       the swatches rendered inside #colorPalette. */
    function buildPaletteTabs() {
        const tabsHost = $("#paletteTabs");
        if (!tabsHost) return;
        tabsHost.innerHTML = "";
        /* Keep the active group valid for the tier before rendering, so
           the highlighted tab always exists in the row. */
        state.colorGroup = activeColorGroup();
        availableColorGroups().forEach(function (key) {
            const grp = COLOR_GROUPS[key];
            const tab = document.createElement("button");
            tab.className = "palette-tab";
            tab.type = "button";
            tab.setAttribute("data-group", key);
            tab.textContent = grp.label;
            tab.addEventListener("click", function () {
                state.colorGroup = key;
                buildPalette();
                refreshPaletteTabs();
            });
            tabsHost.appendChild(tab);
        });
        refreshPaletteTabs();
    }

    function refreshPaletteTabs() {
        $$("#paletteTabs .palette-tab").forEach(function (t) {
            t.classList.toggle("active",
                t.getAttribute("data-group") === state.colorGroup);
        });
    }

    /* Held across rebuilds. The custom swatch lives in the markup as a
       sibling of #colorPalette (buildPalette rewrites that container's
       innerHTML, which would destroy it), but visually it belongs as
       the LAST swatch in the wrapping flow — as a sibling it stacked to
       the right of the whole block and floated off on its own line.
       innerHTML="" only detaches it; holding the node keeps its
       listeners, so re-appending each rebuild is safe. */
    let customSwatchEl = null;

    function buildPalette() {
        const palette = $("#colorPalette");
        if (!customSwatchEl) customSwatchEl = $("#customSwatch");
        palette.innerHTML = "";
        /* CBN mode: swap in numbered swatches from the template's own
           palette. The palette tabs / custom swatch are hidden by
           refreshPaletteChrome so nothing off-palette is a tap away —
           the whole point of color-by-number is that these N colours
           are the alphabet. */
        if (state.cbn) {
            state.cbn.palette.forEach(function (hex, i) {
                const idx = i + 1;
                const sw = document.createElement("button");
                sw.className = "swatch swatch-cbn";
                sw.type = "button";
                sw.style.background = hex;
                sw.setAttribute("role", "option");
                sw.setAttribute("aria-label", "Color " + idx);
                sw.setAttribute("data-color", hex);
                sw.setAttribute("data-cbn-idx", String(idx));
                const num = document.createElement("span");
                num.className = "swatch-num";
                num.textContent = String(idx);
                sw.appendChild(num);
                if (idx === state.cbn.activeIdx) sw.classList.add("active");
                sw.addEventListener("click", function () {
                    state.cbn.activeIdx = idx;
                    state.currentColor  = hex;
                    /* Arm FILL so a tap on a region actually paints —
                       CBN's play pattern is tap-to-fill, not scribble. */
                    if (state.currentTool !== "fill") {
                        state.currentTool = "fill";
                        state.lastNonEraseTool = "fill";
                        refreshToolButtons();
                        rebuildSizeButtons();
                    }
                    refreshPaletteActive();
                    nudgeOnionAwake();
                });
                palette.appendChild(sw);
            });
            refreshPaletteChrome();
            return;
        }
        const colors = COLOR_GROUPS[activeColorGroup()].colors;
        colors.forEach(function (hex) {
            const sw = document.createElement("button");
            sw.className = "swatch";
            sw.type = "button";
            sw.style.background = hex;
            sw.setAttribute("role", "option");
            sw.setAttribute("aria-label", hex);
            sw.setAttribute("data-color", hex);
            if (hex === state.currentColor) sw.classList.add("active");
            sw.addEventListener("click", function () {
                state.currentColor = hex;
                /* Picking a color switches to a brush if we were on
                   the eraser — kids expect the color to "do something". */
                if (state.currentTool === "eraser") {
                    state.currentTool = state.lastNonEraseTool || "crayon";
                    refreshToolButtons();
                    rebuildSizeButtons();
                }
                refreshPaletteActive();
                nudgeOnionAwake();
            });
            palette.appendChild(sw);
        });
        /* Custom swatch goes last, inside the same wrapping flow. */
        if (customSwatchEl) palette.appendChild(customSwatchEl);
        refreshPaletteChrome();
    }

    /* CBN mode hides the palette-group tabs and the custom-color
       swatch — those would let a kid step outside the numbered
       palette, which defeats the point. Normal mode restores them.
       Called from buildPalette AND from cbnReset so leaving a CBN
       page brings the chrome back even if the palette doesn't
       rebuild for other reasons. */
    function refreshPaletteChrome() {
        const tabs = $(".palette-tabs-row");
        const custom = $("#customSwatch");
        if (tabs) {
            if (state.cbn) tabs.setAttribute("hidden", "");
            else           tabs.removeAttribute("hidden");
        }
        if (custom) {
            /* Custom lives inside #colorPalette in normal mode but
               floats semantically — hide via style so the palette's
               grid stays clean in CBN. */
            custom.style.display = state.cbn ? "none" : "";
        }
    }

    function refreshPaletteActive() {
        let matchedPreset = false;
        $$("#colorPalette .swatch").forEach(function (sw) {
            const on = sw.getAttribute("data-color") === state.currentColor;
            if (on) matchedPreset = true;
            sw.classList.toggle("active", on);
        });
        syncCustomColorInput(matchedPreset);
    }

    /* Point the native colour input at whatever colour is actually
       armed. Its value was set once in the HTML and never touched
       again, so the picker always opened on that hardcoded pink no
       matter what the kid was drawing with — you'd tap it to nudge
       your green and land back at magenta.
       The swatch itself KEEPS its rainbow gradient rather than being
       repainted with the chosen colour: the rainbow is what says "pick
       any colour", and overwriting it would spend that affordance on
       the first use. Which colour is armed is shown by the active ring
       instead, same as every preset. */
    function syncCustomColorInput(matchedPreset) {
        const custom = $("#customColor");
        const wrap   = $("#customSwatch");
        if (custom && /^#[0-9a-f]{6}$/i.test(state.currentColor)) {
            custom.value = state.currentColor;
        }
        if (wrap) wrap.classList.toggle("active", !matchedPreset);
    }

    function refreshToolButtons() {
        $$(".tool-btn").forEach(function (b) {
            b.classList.toggle("active",
                b.getAttribute("data-tool") === state.currentTool);
        });
    }

    /* Size set is per-tool (brush has 5, eraser has 3, fill has none)
       — rebuild the buttons each time the tool changes so the visible
       dots match what's actually selectable. An empty set hides the
       whole row, label included, rather than leaving a stranded SIZE
       caption over nothing. */
    function rebuildSizeButtons() {
        const host = $("#sizeRow");
        if (!host) return;
        const sizes = sizesForCurrentTool();
        const row = host.closest(".size-row");
        if (row) row.hidden = sizes.length === 0;
        /* FILL swaps the SIZE row for the pattern row. */
        const prow = document.querySelector(".pattern-row");
        if (prow) {
            prow.hidden = !isFillTool();
            if (isFillTool()) buildPatternButtons();
        }
        /* STAMP shows its shape row alongside SIZE. */
        const srow = document.querySelector(".stamp-row");
        if (srow) {
            srow.hidden = !isStampTool();
            if (isStampTool()) { buildStampTabs(); buildStampButtons(); }
        }
        host.innerHTML = "";
        sizes.forEach(function (n) {
            const btn = document.createElement("button");
            btn.className = "size-btn";
            btn.type = "button";
            btn.setAttribute("data-size", String(n));
            btn.setAttribute("aria-label", "Size " + n);
            const dot = document.createElement("span");
            dot.className = "size-dot";
            /* Visually scale dot to size, capped so the biggest
               doesn't overflow the 40px button. */
            const dotPx = Math.min(28, Math.max(4, Math.round(n * 0.65)));
            dot.style.width  = dotPx + "px";
            dot.style.height = dotPx + "px";
            btn.appendChild(dot);
            btn.addEventListener("click", function () {
                setActiveSize(n);
                refreshSizeButtons();
            });
            host.appendChild(btn);
        });
        refreshSizeButtons();
    }

    /* Pattern chips. Each renders its own tile so the choice is shown
       rather than named — a five-year-old is not reading "ZIGZAG". */
    function buildPatternButtons() {
        const host = $("#patternRow");
        if (!host || host.childElementCount) return;
        FILL_PATTERNS.forEach(function (p) {
            const b = document.createElement("button");
            b.className = "pattern-btn";
            b.type = "button";
            b.setAttribute("data-pattern", p.id);
            b.setAttribute("aria-label", p.label);
            b.title = p.label;
            const cv = document.createElement("canvas");
            cv.width = 34; cv.height = 34;
            const c = cv.getContext("2d");
            c.fillStyle = "#eafffb";
            if (!p.draw) {
                c.fillRect(0, 0, 34, 34);
            } else {
                c.strokeStyle = "#eafffb";
                c.lineCap = "round";
                /* tile is PATTERN_TILE across; draw it at chip scale so
                   the swatch shows the same density the fill will. */
                const k = 34 / PATTERN_TILE;
                c.save(); c.scale(k, k);
                p.draw(c, PATTERN_TILE);
                c.restore();
            }
            b.appendChild(cv);
            b.addEventListener("click", function () {
                state.fillPattern = p.id;
                refreshPatternButtons();
            });
            host.appendChild(b);
        });
        refreshPatternButtons();
    }

    function refreshPatternButtons() {
        $$("#patternRow .pattern-btn").forEach(function (b) {
            b.classList.toggle("active",
                b.getAttribute("data-pattern") === state.fillPattern);
        });
    }

    /* Stamp pack tabs — built once on first STAMP arm; clicking swaps
       which pack's chips render below. Same visual as palette tabs. */
    function buildStampTabs() {
        const host = $("#stampPackTabs");
        if (!host || host.childElementCount) return;
        const packs = availableStampPacks();
        /* One pack (the free tier) needs no tab row — a single tab is
           chrome that explains nothing and hints at what's missing. */
        host.hidden = packs.length < 2;
        packs.forEach(function (pk) {
            const tab = document.createElement("button");
            tab.className = "palette-tab";
            tab.type = "button";
            tab.setAttribute("data-stamp-pack", pk.id);
            tab.textContent = pk.label;
            tab.addEventListener("click", function () {
                state.stampPack = pk.id;
                buildStampButtons(true);
                refreshStampTabs();
                sfxTap();
            });
            host.appendChild(tab);
        });
        refreshStampTabs();
    }

    function refreshStampTabs() {
        $$("#stampPackTabs .palette-tab").forEach(function (t) {
            t.classList.toggle("active",
                t.getAttribute("data-stamp-pack") === state.stampPack);
        });
    }

    /* Stamp chips — same shown-not-named treatment as pattern chips:
       each renders its own shape. Built lazily on first STAMP arm;
       rebuilt (force) on pack switch. Switching packs does NOT
       re-arm a stamp — the armed one keeps working from any tab. */
    function buildStampButtons(force) {
        const host = $("#stampRow");
        if (!host || (host.childElementCount && !force)) return;
        host.innerHTML = "";
        const packs = availableStampPacks();
        /* Fall back to the first AVAILABLE pack, not STAMP_PACKS[0] —
           on the free tier the stored pack may be one this tier can't
           see, which would render an empty chip row. */
        const pack = packs.find(function (pk) {
            return pk.id === state.stampPack;
        }) || packs[0];
        if (!pack) return;
        state.stampPack = pack.id;
        pack.stamps.forEach(function (s) {
            const b = document.createElement("button");
            b.className = "pattern-btn";
            b.type = "button";
            b.setAttribute("data-stamp", s.id);
            b.setAttribute("aria-label", s.label);
            b.title = s.label;
            const cv = document.createElement("canvas");
            cv.width = 34; cv.height = 34;
            const c = cv.getContext("2d");
            c.translate(17, 17);
            c.scale(0.30, 0.30);
            c.fillStyle = "#eafffb";
            c.strokeStyle = "#eafffb";
            c.lineCap = "round";
            c.lineJoin = "round";
            c.lineWidth = 8;
            s.draw(c);
            b.appendChild(cv);
            b.addEventListener("click", function () {
                state.stampId = s.id;
                refreshStampButtons();
            });
            host.appendChild(b);
        });
        refreshStampButtons();
    }

    function refreshStampButtons() {
        $$("#stampRow .pattern-btn").forEach(function (b) {
            b.classList.toggle("active",
                b.getAttribute("data-stamp") === state.stampId);
        });
    }

    /* Paper chips — each shows its actual tile. Free gets CLASSIC +
       DOTTY; a single chip would be a control with nothing to choose,
       so the row only earns its place at two or more. */
    function buildPaperButtons() {
        const host = $("#paperRow");
        if (!host || host.childElementCount) return;
        const papers = availablePapers();
        host.hidden = papers.length < 2;
        papers.forEach(function (pd) {
            const b = document.createElement("button");
            b.className = "pattern-btn paper-btn";
            b.type = "button";
            b.setAttribute("data-paper", pd.id);
            b.setAttribute("aria-label", pd.label + " paper");
            b.title = pd.label;
            const cv = document.createElement("canvas");
            cv.width = 34; cv.height = 34;
            const c = cv.getContext("2d");
            c.drawImage(paperTileCanvas(pd), 0, 0, PAPER_TILE_PX, PAPER_TILE_PX,
                        0, 0, 34, 34);
            b.appendChild(cv);
            b.addEventListener("click", function () {
                state.settings.paper = pd.id;
                persistSettings();
                applyPaper();
                refreshPaperButtons();
                sfxTap();
            });
            host.appendChild(b);
        });
        refreshPaperButtons();
    }

    function refreshPaperButtons() {
        $$("#paperRow .paper-btn").forEach(function (b) {
            b.classList.toggle("active",
                b.getAttribute("data-paper") === state.settings.paper);
        });
    }

    function refreshSizeButtons() {
        $$("#sizeRow .size-btn").forEach(function (b) {
            b.classList.toggle("active",
                Number(b.getAttribute("data-size")) === activeSize());
        });
    }

    /* ---------- TOOL DRAWER (phone bottom sheet) ----------

       Below 768px the rail is a bottom sheet that sits collapsed to
       its 54px handle and slides up when .is-open is set. The CSS for
       that class shipped, but nothing ever set it — there was no
       drawer reference in the JS at all, no :focus-within fallback and
       no swipe handler. On a phone that left the kid with the default
       pen in the default colour and no way to reach brushes, sizes,
       colours, the eraser or fill.

       Above 768px .drawer-handle is display:none and the rail is
       always visible, so the class is inert there. */

    function isDrawerOpen() {
        const rail = $(".draw-side-rail");
        return !!rail && rail.classList.contains("is-open");
    }

    function setDrawerOpen(open) {
        const rail   = $(".draw-side-rail");
        const handle = $(".drawer-handle");
        if (!rail || !handle) return;
        rail.classList.toggle("is-open", !!open);
        handle.setAttribute("aria-expanded", open ? "true" : "false");
        handle.setAttribute("aria-label", open ? "Hide tools" : "Show tools");
    }

    function attachDrawerHandler() {
        const handle = $(".drawer-handle");
        if (!handle) return;
        handle.addEventListener("click", function () {
            retireCoachButtons();
            setDrawerOpen(!isDrawerOpen());
        });
    }

    function attachToolHandlers() {
        $$(".tool-btn").forEach(function (b) {
            b.addEventListener("click", function () {
                const newTool = b.getAttribute("data-tool");
                if (!BRUSHES[newTool]) return;
                state.currentTool = newTool;
                /* Remember the last non-erase tool so ERASE mode can
                   mimic it (fill-erase vs brush-erase). See onPointerDown
                   for the routing. */
                if (newTool !== "eraser") {
                    state.lastNonEraseTool = newTool;
                }
                /* Each brush has its own ergonomic default — adopt it
                   if the kid hasn't already set a size for this tool.
                   We just always reset to the default on tool switch;
                   it's predictable and avoids "why did my line get
                   tiny" confusion. */
                if (isFillTool()) {
                    /* no size to adopt — the bucket has no nib */
                } else if (isBrushTool() || isStampTool()) {
                    state.brushSize = BRUSHES[newTool].defaultSize;
                } else {
                    state.eraserSize = BRUSHES.eraser.defaultSize;
                }
                refreshToolButtons();
                rebuildSizeButtons();
                /* Cheeky wink at the kid — acknowledges the tap without
                   getting in the way of what they were about to do. */
                triggerOnionReaction("tool-swap");
                nudgeOnionAwake();
            });
        });
    }

    /* ---------- 7c. COACH (first-run onboarding) ----------

       Three things are invisible on arrival: that you can draw
       anywhere, that PAGES holds 21 coloring pages, and that TOOLS
       holds the brushes, colours and the fill bucket. The coach
       teaches the first with a moving touch dot; the other two get a
       short breathe on the buttons themselves, because a caption
       alone doesn't move a thumb toward a control nobody has noticed.

       Shown once, then never again unless replayed from Settings.
       Dismissed by the first real gesture — the kid who already
       started drawing doesn't need to be told how. */

    const COACH_KEY   = "tinyCanvas.coach.draw.v1";
    const OFFERED_KEY = "tinyCanvas.coach.offered.v1";
    const COACH_TIMEOUT_MS = 9000;

    let coachTimer = 0;

    function prefersReducedMotion() {
        try {
            return window.matchMedia &&
                   window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (_) { return false; }
    }

    function coachSeen() {
        try { return localStorage.getItem(COACH_KEY) === "1"; }
        catch (_) { return true; }   /* no storage — don't nag every launch */
    }

    function markCoachSeen() {
        try { setStorage(COACH_KEY, "1"); } catch (_) {}
    }

    function showCoach() {
        const el = $("#coach");
        if (!el) return;
        /* SMIL ignores prefers-reduced-motion, so the travelling dot
           has to be removed rather than styled away. The squiggle and
           caption stay — they still teach the gesture. */
        if (prefersReducedMotion()) {
            const motion = $("#coachMotion");
            if (motion && motion.parentNode) {
                motion.parentNode.removeChild(motion);
            }
        }
        el.classList.remove("is-leaving");
        el.removeAttribute("hidden");
        clearTimeout(coachTimer);
        coachTimer = setTimeout(dismissCoach, COACH_TIMEOUT_MS);
    }

    function dismissCoach() {
        const el = $("#coach");
        clearTimeout(coachTimer);
        if (!el || el.hasAttribute("hidden")) return;
        markCoachSeen();
        if (prefersReducedMotion()) {
            el.setAttribute("hidden", "");
            return;
        }
        el.classList.add("is-leaving");
        setTimeout(function () {
            el.setAttribute("hidden", "");
            el.classList.remove("is-leaving");
        }, 300);
    }

    /* Breathe PAGES + TOOLS so they get noticed at all. Retired the
       moment either is tapped — an affordance the kid has already
       found never needs advertising again. */
    function offerCoachButtons() {
        try { if (localStorage.getItem(OFFERED_KEY) === "1") return; }
        catch (_) { return; }
        const pages  = $(".pages-btn");
        const handle = $(".drawer-handle");
        if (pages)  pages.classList.add("is-new");
        if (handle) handle.classList.add("is-new");
    }

    function retireCoachButtons() {
        try { setStorage(OFFERED_KEY, "1"); } catch (_) {}
        const pages  = $(".pages-btn");
        const handle = $(".drawer-handle");
        if (pages)  pages.classList.remove("is-new");
        if (handle) handle.classList.remove("is-new");
    }

    /* Settings → HOW TO PLAY. Clears both flags and replays. */
    function replayCoaching() {
        try {
            setStorage(COACH_KEY, "0");
            setStorage(OFFERED_KEY, "0");
        } catch (_) {}
        showScreen("draw");
        offerCoachButtons();
        showCoach();
    }

    /* ---------- 8. SCREEN SWITCHER ---------- */

    function showScreen(name) {
        Object.keys(screens).forEach(function (k) {
            if (k === name) {
                screens[k].removeAttribute("hidden");
            } else {
                screens[k].setAttribute("hidden", "");
            }
        });
        state.screen = name;
        document.body.className = "screen-" + name;
        sfxSwoosh();
        if (name === "picker")   buildPicker();
        if (name === "gallery")  renderGallery();
        if (name === "settings") syncSettingsUI();
        if (name === "draw") {
            if (!coachSeen()) {
                offerCoachButtons();
                showCoach();
            }
            /* After layout settles — the page <img> has to have a box
               before the fraction it covers means anything. */
            setTimeout(maybeShowRotateHint, 400);
            /* Reset the sleepy timer whenever the kid returns to
               drawing so the Onion starts fresh. */
            nudgeOnionAwake();
        } else {
            dismissCoach();
            hideRotateHint();
            /* Off the draw screen, cancel the sleepy timer and clear
               any lingering sleepy state so re-entry looks alert. */
            clearTimeout(_sleepyTimer);
            setOnionState(null);
        }
    }

    /* ---------- 8a. SETTINGS PERSISTENCE ---------- */

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (obj && typeof obj === "object") {
                Object.assign(state.settings, obj);
            }
        } catch (_) { /* fall through to defaults */ }
    }

    function persistSettings() {
        try {
            setStorage(SETTINGS_KEY, JSON.stringify(state.settings));
        } catch (_) { /* quota; non-fatal */ }
    }

    function syncSettingsUI() {
        const smoothing = $("#setSmoothing");
        const sfx       = $("#setSfx");
        const music     = $("#setMusic");
        const locale    = $("#setLocale");
        if (smoothing) smoothing.checked = !!state.settings.smoothing;
        if (sfx)       sfx.checked       = !!state.settings.sfx;
        if (music)     music.checked     = !!state.settings.music;
        if (locale)    locale.value      = state.settings.locale || "en";
        syncProCard();
    }

    function attachSettingsHandlers() {
        const smoothing = $("#setSmoothing");
        const sfx       = $("#setSfx");
        const locale    = $("#setLocale");
        if (smoothing) {
            smoothing.addEventListener("change", function () {
                state.settings.smoothing = smoothing.checked;
                persistSettings();
            });
        }
        if (sfx) {
            sfx.addEventListener("change", function () {
                state.settings.sfx = sfx.checked;
                persistSettings();
            });
        }
        const music = $("#setMusic");
        if (music) {
            music.addEventListener("change", function () {
                state.settings.music = music.checked;
                persistSettings();
                /* The toggle itself is the user gesture that lets the
                   AudioContext start, so act on it immediately. */
                syncMusic();
            });
        }
        /* Don't keep humming in the pocket. */
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) stopMusic();
            else if (state.settings.music) startMusic();
        });

        /* Custom colour — the 36 swatches cover the common ground, this
           covers "but I want THAT green". Native input so it uses the
           platform picker kids' parents already know. */
        const custom = $("#customColor");
        const customWrap = $("#customSwatch");
        if (custom) {
            const applyCustom = function () {
                state.currentColor = custom.value;
                /* Same courtesy the preset swatches do: picking a
                   colour while the eraser is armed means the kid wants
                   to draw, not rub out. */
                if (state.currentTool === "eraser") {
                    state.currentTool = state.lastNonEraseTool || "crayon";
                    refreshToolButtons();
                    rebuildSizeButtons();
                }
                refreshPaletteActive();
            };
            custom.addEventListener("input",  applyCustom);
            custom.addEventListener("change", applyCustom);
        }
        if (locale) {
            locale.addEventListener("change", function () {
                state.settings.locale = locale.value;
                persistSettings();
            });
        }
    }

    /* ---------- 8b. PARENT GATE ----------
       Apple Kids category and Google's Designed for Families both
       require external links, destructive actions, and share/export
       to sit behind an adult-only gate in the installed app context.
       Implementation choices, all on purpose:

       1. Plain web (not installed as PWA, not Capacitor) short-circuits
          past the gate entirely. madderverse.org/tiny-canvas/ in a
          browser tab has a back button and address bar — it's a
          website you visit, not an installed kids app. Gating
          navigation there is friction without a compliance reason.

       2. Single-digit addition (4..18 sum) with 3 options. Above an
          early-reader's grade level, low enough that adults don't
          curse at their own app. Distractors are within ±3 of the
          correct answer so it's still real math, not a pattern match.

       3. Unlock persists 24h via localStorage. Within Apple's
          "designated area" pattern but doesn't re-pester the parent
          every reload. */

    function isGateUnlocked() {
        if (state.parentGateUnlocked) return true;
        try {
            const until = parseInt(
                localStorage.getItem(GATE_UNLOCKED_KEY) || "0", 10);
            if (until > Date.now()) {
                state.parentGateUnlocked = true;
                return true;
            }
        } catch (_) {}
        return false;
    }

    function setGateUnlocked() {
        state.parentGateUnlocked = true;
        try {
            setStorage(GATE_UNLOCKED_KEY,
                       String(Date.now() + GATE_UNLOCK_MS));
        } catch (_) {}
    }

    function parentGate(label, onPass) {
        /* No-op on plain web — the address bar IS the safety net. */
        if (!isStandaloneOrNative()) { onPass(); return; }
        if (isGateUnlocked())        { onPass(); return; }
        state.parentGatePending = onPass;
        renderParentGate(label);
        const modal = $("#parentGate");
        modal.removeAttribute("hidden");
    }

    function renderParentGate(label) {
        /* Single-digit addition; sums in [4, 18]. Beyond an early
           reader without being a brain-teaser. */
        const a = 2 + Math.floor(Math.random() * 7);   /* 2..8 */
        const b = 2 + Math.floor(Math.random() * 7);   /* 2..8 */
        const correct = a + b;
        $("#parentGateProblem").textContent = "What is " + a + " + " + b + "?";
        const foot = $("#parentGateFoot");
        foot.textContent = "";
        foot.classList.remove("is-error");

        /* Two plausible wrong answers within ±3 — real math, not a
           pattern match, but adults solve it instantly. */
        const wrongs = new Set();
        while (wrongs.size < 2) {
            const delta = (Math.random() < 0.5 ? -1 : 1) *
                          (1 + Math.floor(Math.random() * 3));
            const candidate = correct + delta;
            if (candidate !== correct && candidate > 0) wrongs.add(candidate);
        }
        const options = [correct].concat(Array.from(wrongs));
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }

        const host = $("#parentGateOptions");
        host.innerHTML = "";
        options.forEach(function (n) {
            const btn = document.createElement("button");
            btn.className = "parent-gate-option";
            btn.type = "button";
            btn.textContent = String(n);
            btn.addEventListener("click", function () {
                if (n === correct) {
                    setGateUnlocked();
                    closeParentGate();
                    const cb = state.parentGatePending;
                    state.parentGatePending = null;
                    if (cb) cb();
                } else {
                    btn.classList.add("is-wrong");
                    setTimeout(function () {
                        btn.classList.remove("is-wrong");
                    }, 600);
                    foot.textContent = "That's not it — try again.";
                    foot.classList.add("is-error");
                }
            });
            host.appendChild(btn);
        });
    }

    function closeParentGate() {
        $("#parentGate").setAttribute("hidden", "");
    }

    function cancelParentGate() {
        state.parentGatePending = null;
        closeParentGate();
    }

    /* ---------- 8c. AUTO-SAVE ----------
       Independent of the gallery: keeps the current canvas + template
       in localStorage so a crash or backgrounded tab doesn't lose the
       kid's work. Auto-fires every 60s while there's something dirty
       to save, and on visibilitychange when the kid switches apps. */

    let autosaveTimer = 0;
    let inProgressDirty = false;

    function markInProgressDirty() {
        inProgressDirty = true;
    }

    /* Bounded snapshot of ONLY the kid's strokes — transparency
       preserved, no paper, no line art. This used to be composePng(),
       which bakes the paper color AND the line art into an opaque
       image; restoring that back onto the transparent canvas dragged
       yesterday's paper texture around as canvas pixels (switch to
       SKY paper and the old KRAFT tile is still baked into the
       drawing) and double-painted the line art at whatever geometry
       the old viewport had. Restore needs the same thing the canvas
       held: strokes on transparency. */
    function canvasSnapshotPng() {
        const cw = canvas.width, ch = canvas.height;
        if (!cw || !ch) return null;
        const aspect = cw / ch;
        let outW, outH;
        if (aspect >= 1) {
            outW = SAVE_LONG_SIDE;
            outH = Math.round(SAVE_LONG_SIDE / aspect);
        } else {
            outH = SAVE_LONG_SIDE;
            outW = Math.round(SAVE_LONG_SIDE * aspect);
        }
        const off = document.createElement("canvas");
        off.width = outW; off.height = outH;
        off.getContext("2d").drawImage(canvas, 0, 0, outW, outH);
        return off.toDataURL("image/png");
    }

    async function persistInProgress() {
        if (!inProgressDirty) return;
        if (!state.templateId) return;
        try {
            const png = canvasSnapshotPng();
            if (!png) return;
            const rec = {
                templateId:   state.templateId,
                templateName: state.templateName,
                png:          png,
                savedAt:      new Date().toISOString()
            };
            setStorage(IN_PROGRESS_KEY, JSON.stringify(rec));
            inProgressDirty = false;
        } catch (_) {
            /* quota or taint — fail silently */
        }
    }

    function clearInProgress() {
        removeStorage(IN_PROGRESS_KEY);
        inProgressDirty = false;
    }

    function loadInProgressFor(templateId) {
        try {
            const raw = localStorage.getItem(IN_PROGRESS_KEY);
            if (!raw) return null;
            const rec = JSON.parse(raw);
            if (rec && rec.templateId === templateId && rec.png) return rec;
        } catch (_) {}
        return null;
    }

    function tryRestoreInProgress(templateId) {
        const rec = loadInProgressFor(templateId);
        if (!rec) return;
        /* Paint the saved PNG onto the canvas, scaled to fill it.
           The saved PNG is at SAVE_LONG_SIDE / scaled-aspect; the
           live canvas is at viewport size — drawImage handles the
           stretch. Strokes will keep their relative position to the
           line-art (which scales similarly). */
        const img = new Image();
        img.onload = function () {
            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);
            ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx2d.restore();
            state.dirty = true;
            updateStatus();
        };
        img.onerror = function () { /* corrupt rec — ignore */ };
        img.src = rec.png;
    }

    function startAutosave() {
        if (autosaveTimer) clearInterval(autosaveTimer);
        autosaveTimer = setInterval(persistInProgress, AUTOSAVE_INTERVAL_MS);
        /* Save when the tab loses visibility (kid backgrounds the app
           or locks the device). visibilitychange fires before the
           browser kills the page on iOS Safari. */
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden") persistInProgress();
        });
        /* Last-chance save on close. */
        window.addEventListener("beforeunload", persistInProgress);
        window.addEventListener("pagehide",     persistInProgress);
    }

    /* ---------- 8d. TOASTS ---------- */

    function showSavedToast() {
        const t = $("#savedToast");
        if (!t) return;
        t.removeAttribute("hidden");
        /* Force reflow so the .is-show transition fires from hidden state */
        // eslint-disable-next-line no-unused-expressions
        t.offsetHeight;
        t.classList.add("is-show");
        clearTimeout(showSavedToast._timer);
        showSavedToast._timer = setTimeout(function () {
            t.classList.remove("is-show");
            setTimeout(function () { t.setAttribute("hidden", ""); }, 250);
        }, 1400);
    }

    /* ---------- ROTATE HINT ----------

       The pages are 1.833 landscape. Held portrait on a phone that
       renders the page at ~22% of the screen (353x192 inside 375x812);
       turning the phone roughly doubles it. So: suggest it once, gently,
       and never get in the way.

       Gated on the MEASURED page fraction rather than a device guess —
       that is the actual condition that makes rotating worth it, so it
       can't misfire on a tablet, in landscape, on a squarer future page,
       or on BLANK (which has no art element and fills the canvas
       already). Once per session, not once ever: a nag that repeats
       every launch would be worse than the problem. */
    /* Measured page/canvas area ratios: phone portrait 375x812 = 22.3%
       (the case this exists for), tablet portrait 768x1024 = 36.2%
       (fine as-is), phone landscape = 51.5%. 0.30 sits between the two
       portrait cases with room either side — 0.35 cleared the tablet by
       only 1.2 points, close enough that a slightly different tablet
       would have been nagged. */
    const ROTATE_HINT_MAX_FRAC = 0.30;   /* page/canvas area ratio */
    const ROTATE_HINT_MS       = 4500;
    let rotateHintShown = false;

    function rotateHintWorthIt() {
        const art = overlayArtEl();
        if (!art) return false;                       /* BLANK */
        if (innerWidth > innerHeight) return false;   /* already landscape */
        if (view.s !== 1) return false;               /* zoomed in on purpose */
        const ar = art.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        if (!ar.width || !cr.width) return false;
        return (ar.width * ar.height) / (cr.width * cr.height)
               < ROTATE_HINT_MAX_FRAC;
    }

    function hideRotateHint() {
        const t = $("#rotateHint");
        if (!t || t.hidden) return;
        clearTimeout(hideRotateHint._timer);
        t.classList.remove("is-show");
        setTimeout(function () { t.setAttribute("hidden", ""); }, 250);
    }

    function maybeShowRotateHint() {
        if (rotateHintShown) return;
        if (state.screen !== "draw") return;
        if (!rotateHintWorthIt()) return;
        const t = $("#rotateHint");
        if (!t) return;
        rotateHintShown = true;
        t.removeAttribute("hidden");
        // eslint-disable-next-line no-unused-expressions
        t.offsetHeight;
        t.classList.add("is-show");
        hideRotateHint._timer = setTimeout(hideRotateHint, ROTATE_HINT_MS);
    }

    function showFirstSaveToast() {
        const t = $("#firstSaveToast");
        if (!t) return;
        t.removeAttribute("hidden");
        t.offsetHeight;
        t.classList.add("is-show");
        setTimeout(function () {
            t.classList.remove("is-show");
            setTimeout(function () { t.setAttribute("hidden", ""); }, 250);
        }, 2400);
    }

    function isFirstSaveCelebrated() {
        try { return localStorage.getItem(FIRST_SAVE_KEY) === "1"; }
        catch (_) { return false; }
    }
    function markFirstSaveCelebrated() {
        try { setStorage(FIRST_SAVE_KEY, "1"); }
        catch (_) {}
    }

    /* Soft tutorial fired the first time an erase gesture changes
       nothing — the kid dragged the eraser over the printed lines,
       or fill-erased an already-empty region. Once-ever, so it
       teaches without nagging. */
    function isEraseTipShown() {
        try { return localStorage.getItem(ERASE_TIP_KEY) === "1"; }
        catch (_) { return true; }
    }
    function markEraseTipShown() {
        try { setStorage(ERASE_TIP_KEY, "1"); }
        catch (_) {}
    }
    function maybeShowEraseTip() {
        if (isEraseTipShown()) return;
        const t = $("#eraseTipToast");
        if (!t) return;
        markEraseTipShown();
        t.removeAttribute("hidden");
        // eslint-disable-next-line no-unused-expressions
        t.offsetHeight;
        t.classList.add("is-show");
        clearTimeout(maybeShowEraseTip._timer);
        maybeShowEraseTip._timer = setTimeout(function () {
            t.classList.remove("is-show");
            setTimeout(function () { t.setAttribute("hidden", ""); }, 250);
        }, 3200);
    }

    /* After a brush-erase stroke that DID change pixels, decide
       whether the reveal surfaced actual color (i.e. the reveal
       buffer had content underneath) or just wiped to bare paper.
       Any post-stroke pixel with alpha > 0 in the dirty rect means
       "the erase brought back a color layer" — the eureka moment.
       Samples strided pixels for speed; called at most once per
       erase stroke on pointer-up. */
    function eraseRevealedColor() {
        if (!isFinite(sMinX) || sMaxX < sMinX) return false;
        const W = canvas.width, H = canvas.height;
        const x = Math.max(0, Math.floor(sMinX));
        const y = Math.max(0, Math.floor(sMinY));
        const w = Math.min(W, Math.ceil(sMaxX)) - x;
        const h = Math.min(H, Math.ceil(sMaxY)) - y;
        if (w <= 0 || h <= 0) return false;
        let data;
        try {
            data = ctx2d.getImageData(x, y, w, h).data;
        } catch (_) { return false; }
        /* Stride 8 pixels — cheap enough on a phone, dense enough to
           catch even a tiny slice of revealed color under a stroke. */
        for (let i = 3; i < data.length; i += 32) {
            if (data[i] > 0) return true;
        }
        return false;
    }

    /* Compare the current dirty rect on the canvas against the
       pre-stroke snapshot (histCanvas, blitted in beginHistoryCapture).
       Returns true when zero pixels changed — the erase gesture did
       nothing visible, so it's either over lines or over paper. */
    function eraseWasNoop() {
        if (!histCanvas || !histCtx) return false;
        if (!isFinite(sMinX) || sMaxX < sMinX) return true;
        const W = canvas.width, H = canvas.height;
        const x = Math.max(0, Math.floor(sMinX));
        const y = Math.max(0, Math.floor(sMinY));
        const w = Math.min(W, Math.ceil(sMaxX)) - x;
        const h = Math.min(H, Math.ceil(sMaxY)) - y;
        if (w <= 0 || h <= 0) return true;
        let pre, post;
        try {
            pre  = histCtx.getImageData(x, y, w, h).data;
            post = ctx2d.getImageData(x, y, w, h).data;
        } catch (_) { return false; }
        if (pre.length !== post.length) return false;
        for (let i = 0; i < pre.length; i++) {
            if (pre[i] !== post[i]) return false;
        }
        return true;
    }

    /* ---------- 9. STATUS LINE ---------- */

    function updateStatus() {
        const el = $("#drawStatus");
        if (!el) return;
        if (state.savedId) {
            el.textContent = "SAVED";
        } else if (state.dirty) {
            el.textContent = "DRAWING";
        } else {
            el.textContent = "READY";
        }
    }

    /* ---------- 10. GALLERY (localStorage) ---------- */

    function loadGallery() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function persistGallery(items) {
        try {
            setStorage(STORAGE_KEY, JSON.stringify(items));
        } catch (_) {
            /* Quota etc — fail silently, the kid just won't get a
               persisted record. The on-screen drawing is unaffected. */
        }
    }

    /* ---------- CONTENT CROP ----------

       The export is cropped to what is actually ON the page. Pages are
       all 1.833:1, but the art inside them is not: the full scenes ink
       100% of the page width while the single-object EXTRAS use as
       little as 31% (leaf) or 35% (beans), so framing to the page edge
       left those exports mostly empty paper.

       The crop is the union of TWO things, and it needs both: the
       page's own ink, and wherever the kid actually painted. Cropping
       to the page ink alone would clip a kid who coloured out past the
       lines onto the paper — which the canvas allows and which fill
       only stops for fills, not brush strokes. */

    const INK_ALPHA_MIN    = 16;    /* line-art ink counts from here */
    const STROKE_ALPHA_MIN = 3;     /* kid's colour counts from here */
    const CROP_MARGIN_FRAC = 0.03;  /* breathing room, frac of long side */
    const CROP_MIN_FRAC    = 0.25;  /* never crop tighter than this */
    const BBOX_SCAN_W      = 256;   /* scan downscaled — a few px of
                                       slop is invisible under the margin */
    const inkBoxCache = Object.create(null);

    /* Bounding box of pixels with alpha >= minA, returned as 0..1
       fractions of the source's own box. null when nothing qualifies
       (an untouched canvas, or a page whose art failed to load). */
    function alphaBBox(src, sw, sh, minA) {
        if (!src || !sw || !sh) return null;
        const w = Math.max(1, Math.min(BBOX_SCAN_W, Math.round(sw)));
        const h = Math.max(1, Math.round(w * (sh / sw)));
        const off = document.createElement("canvas");
        off.width = w; off.height = h;
        const c = off.getContext("2d", { willReadFrequently: true });
        let d;
        try {
            c.drawImage(src, 0, 0, w, h);
            d = c.getImageData(0, 0, w, h).data;
        } catch (_) {
            return null;              /* taint / decode failure */
        }
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (d[(y * w + x) * 4 + 3] >= minA) {
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                }
            }
        }
        if (x1 < 0) return null;
        return { x: x0 / w, y: y0 / h,
                 w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
    }

    /* Hand a drawable line-art image to `done`, or null when there is
       none (BLANK). Raster pages are drawable as-is; SVG pages take the
       Blob URL -> Image roundtrip, which is why composePng is async. */
    function withArtImage(art, done) {
        if (!art) { done(null); return; }
        if (art.tagName === "IMG") {
            done(art.complete && art.naturalWidth ? art : null);
            return;
        }
        const blob = new Blob([art.outerHTML], { type: "image/svg+xml" });
        const url  = URL.createObjectURL(blob);
        const img  = new Image();
        img.onload  = function () { URL.revokeObjectURL(url); done(img); };
        img.onerror = function () { URL.revokeObjectURL(url); done(null); };
        img.src = url;
    }

    /* Composite the live canvas + line-art into a bounded PNG dataURL
       (long side = SAVE_LONG_SIDE, so localStorage stays sane).

       ⚠ The export is framed to the CONTENT, never to the viewport.
       The drawing canvas fills the whole screen, so sizing the output
       from it stamped the device's window aspect onto every save — a
       wide desktop viewport exported a 2.1:1 image with the 1.83:1 page
       letterboxed inside a band of bare paper. The page is the artwork;
       the paper around it is just backdrop. Output now takes the aspect
       of the cropped content box (see CONTENT CROP above), so a tall
       subject on a wide page exports tall.

       Zoom is neutralized first: every rect here is a LIVE client rect,
       so saving while pinched in would otherwise export the zoomed crop.
       Measure with the view reset, restore it in the same synchronous
       block (layout is forced, but nothing repaints between), then do
       the async drawing off the captured numbers. */
    function composePng() {
        return new Promise(function (resolve) {
            const art       = overlayArtEl();
            const zoomed    = view.s !== 1 || view.tx !== 0 || view.ty !== 0;
            const savedView = { s: view.s, tx: view.tx, ty: view.ty };
            if (zoomed) resetView();

            const canvasRect = canvas.getBoundingClientRect();
            const artRect    = art ? art.getBoundingClientRect() : null;
            const framed     = !!artRect && artRect.width > 0 &&
                               artRect.height > 0;

            /* The page's box, in CSS px relative to the canvas box.
               Falls back to the whole canvas for BLANK. */
            const box = framed
                ? { x: artRect.left - canvasRect.left,
                    y: artRect.top  - canvasRect.top,
                    w: artRect.width, h: artRect.height }
                : { x: 0, y: 0, w: canvasRect.width, h: canvasRect.height };

            if (zoomed) {
                view.s  = savedView.s;
                view.tx = savedView.tx;
                view.ty = savedView.ty;
                applyView();
            }

            if (canvasRect.width <= 0 || canvasRect.height <= 0) {
                resolve(canvas.toDataURL("image/png"));
                return;
            }

            withArtImage(art, function (artImg) {
                resolve(renderExport(artImg, box, canvasRect));
            });
        });
    }

    /* Everything below is synchronous — the only async part of an
       export is getting the line art drawable. */
    function renderExport(artImg, box, canvasRect) {
        /* ---- crop: union of the page's ink and the kid's strokes ---- */
        let crop = { x: box.x, y: box.y, w: box.w, h: box.h };
        const parts = [];

        if (artImg) {
            /* Static per template — scan once, then reuse. */
            const key = state.templateId || "?";
            let ib = inkBoxCache[key];
            if (ib === undefined) {
                ib = alphaBBox(artImg,
                               artImg.naturalWidth  || artImg.width,
                               artImg.naturalHeight || artImg.height,
                               INK_ALPHA_MIN);
                inkBoxCache[key] = ib;
            }
            if (ib) {
                parts.push({ x: box.x + ib.x * box.w,
                             y: box.y + ib.y * box.h,
                             w: ib.w * box.w, h: ib.h * box.h });
            }
        }

        const sb = alphaBBox(canvas, canvas.width, canvas.height,
                             STROKE_ALPHA_MIN);
        if (sb) {
            parts.push({ x: sb.x * canvasRect.width,
                         y: sb.y * canvasRect.height,
                         w: sb.w * canvasRect.width,
                         h: sb.h * canvasRect.height });
        }

        if (parts.length) {
            let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
            parts.forEach(function (p) {
                l = Math.min(l, p.x);         t = Math.min(t, p.y);
                r = Math.max(r, p.x + p.w);   b = Math.max(b, p.y + p.h);
            });
            const m = Math.max(r - l, b - t) * CROP_MARGIN_FRAC;
            l -= m; t -= m; r += m; b += m;

            /* A single dot shouldn't export as a postage stamp. */
            const minW = box.w * CROP_MIN_FRAC;
            const minH = box.h * CROP_MIN_FRAC;
            if (r - l < minW) { const c = (l + r) / 2; l = c - minW / 2; r = c + minW / 2; }
            if (b - t < minH) { const c = (t + b) / 2; t = c - minH / 2; b = c + minH / 2; }

            /* Don't let the margin wander off the page. The bound is
               the page box widened by wherever the kid painted — so a
               full-bleed scene exports as exactly the page (its ink
               already fills it) instead of gaining a paper mat, while a
               kid who coloured out past the lines still gets all of it.
               Clamped to the canvas too: there is nothing to sample
               past the paper. */
            let bl = box.x, bt = box.y;
            let br = box.x + box.w, bb = box.y + box.h;
            if (sb) {
                bl = Math.min(bl, sb.x * canvasRect.width);
                bt = Math.min(bt, sb.y * canvasRect.height);
                br = Math.max(br, (sb.x + sb.w) * canvasRect.width);
                bb = Math.max(bb, (sb.y + sb.h) * canvasRect.height);
            }
            l = Math.max(Math.max(0, bl), l);
            t = Math.max(Math.max(0, bt), t);
            r = Math.min(Math.min(canvasRect.width,  br), r);
            b = Math.min(Math.min(canvasRect.height, bb), b);
            if (r - l > 4 && b - t > 4) crop = { x: l, y: t, w: r - l, h: b - t };
        }

        const aspect = crop.w / crop.h;
        let outW, outH;
        if (aspect >= 1) {
            outW = SAVE_LONG_SIDE;
            outH = Math.round(SAVE_LONG_SIDE / aspect);
        } else {
            outH = SAVE_LONG_SIDE;
            outW = Math.round(SAVE_LONG_SIDE * aspect);
        }

        const off = document.createElement("canvas");
        off.width = outW;
        off.height = outH;
        const o = off.getContext("2d");

        /* CSS px -> export px. Per-axis, never one shared ratio: the
           STAGE floor can make x and y diverge (see artBox()). */
        const kx = outW / crop.w;
        const ky = outH / crop.h;

        /* Paper background — the same tile the on-screen #paperLayer
           shows, at the same scale AND phase, so the saved file looks
           like the screen did. Falls back to the classic plain paper. */
        const pd = paperDefFor(activePaperId());
        o.fillStyle = pd.base;
        o.fillRect(0, 0, outW, outH);
        if (pd.draw) {
            const pat = o.createPattern(paperTileCanvas(pd), "repeat");
            if (pat) {
                o.save();
                o.scale(kx, ky);
                o.translate(-crop.x, -crop.y);
                o.fillStyle = pat;
                o.fillRect(crop.x, crop.y, crop.w, crop.h);
                o.restore();
            }
        }

        /* Kid's strokes — the crop region of the canvas, blitted to
           fill the output. */
        const devX = canvas.width  / canvasRect.width;
        const devY = canvas.height / canvasRect.height;
        const sx = Math.max(0, crop.x * devX);
        const sy = Math.max(0, crop.y * devY);
        const sw = Math.min(canvas.width  - sx, crop.w * devX);
        const sh = Math.min(canvas.height - sy, crop.h * devY);
        if (sw > 0 && sh > 0) {
            o.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH);
        }

        /* Line art — positioned relative to the crop, so the printed
           lines land on the kid's colour exactly as they did on screen. */
        if (artImg) {
            o.drawImage(artImg,
                        (box.x - crop.x) * kx, (box.y - crop.y) * ky,
                        box.w * kx, box.h * ky);
        }

        return off.toDataURL("image/png");
    }

    async function saveDrawing() {
        const wasEmpty = loadGallery().length === 0;
        const png = await composePng();
        const items = loadGallery();
        const record = {
            id:        "tc_" + Date.now() + "_" +
                       Math.random().toString(36).slice(2, 7),
            name:      state.templateName,
            template:  state.templateId,
            date:      new Date().toISOString(),
            png:       png,
            /* Time-lapse replay track. Copy the events list AND the
               logical stage dims the drawing was recorded against —
               replay renders at those coords, then the display canvas
               scales to whatever the detail panel gives it. Omitted
               (falsy) if the drawing has no recordable events, so old
               records without replay behave normally in the gallery. */
            replay:    state.replayEvents.length
                       ? { w: STAGE_W, h: STAGE_H, ev: state.replayEvents.slice() }
                       : null
        };
        items.unshift(record);
        /* Drop the oldest entries past the cap. */
        while (items.length > SAVE_MAX) items.pop();
        persistGallery(items);
        state.savedId = record.id;
        /* Once a piece is saved to gallery, the in-progress slot is
           no longer needed — kid moved on to "finished" territory. */
        clearInProgress();
        sfxSave();
        flashButton("#drawSave");
        showSavedToast();
        triggerOnionReaction("saved");
        /* One-shot first-save celebration. Construction Paper Principle:
           a single gentle pat on the back, no streaks, never repeats. */
        if (wasEmpty && !isFirstSaveCelebrated()) {
            markFirstSaveCelebrated();
            setTimeout(showFirstSaveToast, 500);
        }
        updateStatus();
    }

    function flashButton(sel) {
        const el = $(sel);
        if (!el) return;
        el.classList.add("is-flash");
        setTimeout(function () { el.classList.remove("is-flash"); }, 280);
    }

    function renderGallery() {
        const items = loadGallery();
        const grid  = $("#galleryGrid");
        const empty = $("#galleryEmpty");
        const count = $("#galleryCount");
        count.textContent = items.length + (items.length === 1 ? " PIC" : " PICS");
        grid.innerHTML = "";
        if (items.length === 0) {
            empty.removeAttribute("hidden");
            return;
        }
        empty.setAttribute("hidden", "");
        items.forEach(function (rec) {
            const card = document.createElement("button");
            card.className = "pic-card";
            card.type = "button";
            const thumb = document.createElement("div");
            thumb.className = "pic-thumb";
            const img = document.createElement("img");
            img.src = rec.png;
            img.alt = rec.name;
            thumb.appendChild(img);
            card.appendChild(thumb);
            const name = document.createElement("span");
            name.className = "pic-name";
            name.textContent = rec.name;
            card.appendChild(name);
            const date = document.createElement("span");
            date.className = "pic-date";
            date.textContent = formatDate(rec.date);
            card.appendChild(date);
            card.addEventListener("click", function () { openDetail(rec); });
            grid.appendChild(card);
        });
    }

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return d.getFullYear() + "-" + mm + "-" + dd;
        } catch (_) {
            return "";
        }
    }

    /* ---------- 10b. EXPORT FRAMES (Pro) ----------

       Decorative borders applied at EXPORT time, never baked into the
       stored gallery record — picking a different frame later always
       works from the clean drawing. Each frame draws its band onto an
       existing canvas; the band is min(W,H)*8%, and motifs are clipped
       to the band so they can't spill onto the artwork (scallop's
       bumps are the deliberate exception). All code, no assets. */

    function _framePerim(W, H, bw, step) {
        /* Points spaced along the band's centerline. */
        const pts = [];
        const m = bw / 2;
        for (let x = m; x <= W - m; x += step) {
            pts.push([x, m], [x, H - m]);
        }
        for (let y = m + step; y <= H - m - step; y += step) {
            pts.push([m, y], [W - m, y]);
        }
        return pts;
    }

    function _bandClip(c, W, H, bw) {
        c.beginPath();
        c.rect(0, 0, W, H);
        c.rect(bw, bw, W - bw * 2, H - bw * 2);
        c.clip("evenodd");
    }

    function _fillBand(c, W, H, bw, style) {
        c.save();
        _bandClip(c, W, H, bw);
        c.fillStyle = style;
        c.fillRect(0, 0, W, H);
        c.restore();
    }

    function _miniHeart(c, x, y, r) {
        c.beginPath();
        c.moveTo(x, y + r * 0.75);
        c.bezierCurveTo(x - r * 1.5, y - r * 0.4,
                        x - r * 0.5, y - r * 1.2, x, y - r * 0.35);
        c.bezierCurveTo(x + r * 0.5, y - r * 1.2,
                        x + r * 1.5, y - r * 0.4, x, y + r * 0.75);
        c.fill();
    }

    /* `free: true` picks the two the free tier gets — one plain, one
       playful — so a free kid can still finish a picture and hand it
       over framed. The other ten are Pro. */
    const FRAMES = [
        { id: "none",     label: "NONE",     free: true, draw: null },

        { id: "solid",    label: "PINK",     free: true, draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#ff2e88");
            c.strokeStyle = "#ffffff";
            c.lineWidth = Math.max(2, bw * 0.08);
            c.strokeRect(bw, bw, W - bw * 2, H - bw * 2);
        } },

        { id: "rainbow",  label: "RAINBOW",  draw: function (c, W, H, bw) {
            const g = c.createLinearGradient(0, 0, W, H);
            ["#ff4d4d", "#ff9d42", "#ffd23f", "#9be15d",
             "#4fc3f7", "#a86bff", "#ff4d4d"].forEach(function (hex, i, arr) {
                g.addColorStop(i / (arr.length - 1), hex);
            });
            _fillBand(c, W, H, bw, g);
        } },

        { id: "candy",    label: "CANDY",    draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#ffffff");
            c.save();
            _bandClip(c, W, H, bw);
            c.strokeStyle = "#ff4d6d";
            c.lineWidth = bw * 0.45;
            const step = bw * 1.4;
            c.beginPath();
            for (let x = -H; x < W + H; x += step) {
                c.moveTo(x, -4);
                c.lineTo(x + H, H + 4);
            }
            c.stroke();
            c.restore();
        } },

        { id: "polka",    label: "POLKA",    draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#1ac88a");
            c.save();
            _bandClip(c, W, H, bw);
            c.fillStyle = "#ffffff";
            _framePerim(W, H, bw, bw * 1.1).forEach(function (p) {
                c.beginPath();
                c.arc(p[0], p[1], bw * 0.18, 0, Math.PI * 2);
                c.fill();
            });
            c.restore();
        } },

        { id: "stars",    label: "STARS",    draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#2b3a8f");
            c.save();
            _bandClip(c, W, H, bw);
            c.fillStyle = "#ffd23f";
            _framePerim(W, H, bw, bw * 1.5).forEach(function (p) {
                c.save();
                c.translate(p[0], p[1]);
                _starPath(c, 5, bw * 0.32, bw * 0.14);
                c.fill();
                c.restore();
            });
            c.restore();
        } },

        { id: "hearts",   label: "HEARTS",   free: true, draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#fdd7e4");
            c.save();
            _bandClip(c, W, H, bw);
            c.fillStyle = "#ff2e88";
            _framePerim(W, H, bw, bw * 1.4).forEach(function (p) {
                _miniHeart(c, p[0], p[1], bw * 0.3);
            });
            c.restore();
        } },

        { id: "scallop",  label: "SCALLOP",  draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#ff7a1f");
            /* bumps ride the inner edge, deliberately over the art */
            c.fillStyle = "#ff7a1f";
            const r = bw * 0.45, step = r * 2;
            for (let x = bw + r; x < W - bw; x += step) {
                c.beginPath(); c.arc(x, bw, r, 0, Math.PI); c.fill();
                c.beginPath(); c.arc(x, H - bw, r, Math.PI, 0); c.fill();
            }
            for (let y = bw + r; y < H - bw; y += step) {
                c.beginPath(); c.arc(bw, y, r, -Math.PI / 2, Math.PI / 2); c.fill();
                c.beginPath(); c.arc(W - bw, y, r, Math.PI / 2, -Math.PI / 2); c.fill();
            }
        } },

        { id: "zigzag",   label: "ZIGZAG",   draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#ffd23f");
            c.save();
            _bandClip(c, W, H, bw);
            c.strokeStyle = "#ff7a1f";
            c.lineWidth = bw * 0.18;
            c.lineJoin = "round";
            const step = bw * 0.9, m = bw / 2;
            c.beginPath();
            for (let x = 0; x < W + step; x += step) {
                c.lineTo(x, ((x / step) & 1) ? m * 0.5 : m * 1.5);
            }
            for (let x = 0; x < W + step; x += step) {
                c.moveTo(x, H - (((x / step) & 1) ? m * 0.5 : m * 1.5));
                if (x > 0) {
                    c.lineTo(x - step, H - (((x / step - 1) & 1) ? m * 0.5 : m * 1.5));
                }
            }
            c.stroke();
            c.restore();
        } },

        { id: "confetti", label: "CONFETTI", draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#ffffff");
            c.save();
            _bandClip(c, W, H, bw);
            let seed = 7;
            const rnd = function () {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return seed / 0x7fffffff;
            };
            const cols = ["#ff2e88", "#ff9d42", "#ffd23f",
                          "#1ac88a", "#4fc3f7", "#a86bff"];
            const n = Math.round((W + H) / bw * 6);
            for (let i = 0; i < n; i++) {
                /* random point somewhere in the band ring */
                const edge = rnd();
                let x, y;
                if (edge < 0.25)      { x = rnd() * W; y = rnd() * bw; }
                else if (edge < 0.5)  { x = rnd() * W; y = H - rnd() * bw; }
                else if (edge < 0.75) { x = rnd() * bw; y = rnd() * H; }
                else                  { x = W - rnd() * bw; y = rnd() * H; }
                c.save();
                c.translate(x, y);
                c.rotate(rnd() * Math.PI);
                c.fillStyle = cols[(rnd() * cols.length) | 0];
                c.fillRect(-bw * 0.09, -bw * 0.045, bw * 0.18, bw * 0.09);
                c.restore();
            }
            c.restore();
        } },

        { id: "stitched", label: "STITCHED", draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#f2e7d4");
            c.strokeStyle = "#a8845c";
            c.lineWidth = Math.max(2, bw * 0.07);
            c.setLineDash([bw * 0.35, bw * 0.25]);
            c.strokeRect(bw * 0.5, bw * 0.5, W - bw, H - bw);
            c.setLineDash([]);
        } },

        { id: "clouds",   label: "CLOUDS",   draw: function (c, W, H, bw) {
            _fillBand(c, W, H, bw, "#9ed1f7");
            c.save();
            _bandClip(c, W, H, bw);
            c.fillStyle = "#ffffff";
            _framePerim(W, H, bw, bw * 1.6).forEach(function (p, i) {
                const r = bw * (0.22 + ((i % 3) * 0.05));
                c.beginPath();
                c.arc(p[0] - r, p[1] + r * 0.3, r * 0.8, 0, Math.PI * 2);
                c.arc(p[0], p[1] - r * 0.3, r, 0, Math.PI * 2);
                c.arc(p[0] + r, p[1] + r * 0.3, r * 0.8, 0, Math.PI * 2);
                c.fill();
            });
            c.restore();
        } },

        { id: "gold",     label: "GOLD",     draw: function (c, W, H, bw) {
            const g = c.createLinearGradient(0, 0, W, H);
            g.addColorStop(0,    "#d4af37");
            g.addColorStop(0.35, "#f7e08c");
            g.addColorStop(0.65, "#c79a2a");
            g.addColorStop(1,    "#f2d878");
            _fillBand(c, W, H, bw, g);
            c.strokeStyle = "#8a6d1d";
            c.lineWidth = Math.max(2, bw * 0.06);
            c.strokeRect(bw, bw, W - bw * 2, H - bw * 2);
        } }
    ];

    function frameDefFor(id) {
        for (let i = 0; i < FRAMES.length; i++) {
            if (FRAMES[i].id === id) return FRAMES[i];
        }
        return FRAMES[0];
    }

    /* Render a gallery record with a frame → PNG dataURL. */
    function frameRecPng(rec, frameId) {
        return new Promise(function (resolve) {
            const def = frameDefFor(frameId);
            if (!def.draw) { resolve(rec.png); return; }
            const img = new Image();
            img.onload = function () {
                const cv = document.createElement("canvas");
                cv.width = img.width;
                cv.height = img.height;
                const c = cv.getContext("2d");
                c.drawImage(img, 0, 0);
                const bw = Math.round(Math.min(img.width, img.height) * 0.08);
                def.draw(c, img.width, img.height, bw);
                resolve(cv.toDataURL("image/png"));
            };
            img.onerror = function () { resolve(rec.png); };
            img.src = rec.png;
        });
    }

    /* Frame currently previewed in the detail panel. Transient —
       resets to NONE every time the panel opens. */
    let detailFrameId = "none";

    function buildFrameButtons() {
        const host = $("#frameRow");
        if (!host || host.childElementCount) return;
        availableFrames().forEach(function (f) {
            const b = document.createElement("button");
            b.className = "pattern-btn frame-btn";
            b.type = "button";
            b.setAttribute("data-frame", f.id);
            b.setAttribute("aria-label", f.label + " frame");
            b.title = f.label;
            const cv = document.createElement("canvas");
            cv.width = 34; cv.height = 34;
            const c = cv.getContext("2d");
            c.fillStyle = "#fbfaf6";
            c.fillRect(0, 0, 34, 34);
            if (f.draw) f.draw(c, 34, 34, 7);
            b.appendChild(cv);
            b.addEventListener("click", function () {
                detailFrameId = f.id;
                refreshFrameButtons();
                const id = $("#picDetail").dataset.id;
                const rec = loadGallery().find(function (r) { return r.id === id; });
                if (!rec) return;
                if (f.id === "none") { $("#detailImg").src = rec.png; return; }
                frameRecPng(rec, f.id).then(function (png) {
                    /* Kid may have tapped another chip while this one
                       rendered — only apply if still the armed frame. */
                    if (detailFrameId === f.id) $("#detailImg").src = png;
                });
            });
            host.appendChild(b);
        });
        refreshFrameButtons();
    }

    function refreshFrameButtons() {
        $$("#frameRow .frame-btn").forEach(function (b) {
            b.classList.toggle("active",
                b.getAttribute("data-frame") === detailFrameId);
        });
    }

    function openDetail(rec) {
        $("#detailTemplate").textContent = rec.name;
        $("#detailDate").textContent     = formatDate(rec.date);
        $("#detailImg").src              = rec.png;
        detailFrameId = "none";
        buildFrameButtons();
        refreshFrameButtons();
        /* PLAY button appears only if this record has a replay track.
           Records saved before 2026-08-09 have no `replay` field and
           behave as before — the button stays hidden. */
        const replayBtn = $("#detailReplay");
        if (replayBtn) {
            if (rec.replay && rec.replay.ev && rec.replay.ev.length) {
                replayBtn.removeAttribute("hidden");
            } else {
                replayBtn.setAttribute("hidden", "");
            }
        }
        const panel = $("#picDetail");
        panel.removeAttribute("hidden");
        panel.dataset.id = rec.id;
    }

    function closeDetail() {
        /* Kill any playing replay first, so its rAF loop doesn't keep
           painting into a hidden canvas. */
        stopReplay();
        $("#picDetail").setAttribute("hidden", "");
    }

    /* ---------- 10b. TIME-LAPSE REPLAY PLAYBACK ----------

       Renders a recorded event list back into the detail canvas.
       Uses a scratch canvas at the drawing's original logical size
       so brush geometry (line widths, arc radii, stamp translations)
       matches what the kid actually drew, then blits into the visible
       display canvas each rAF frame.

       Strokes replay their points in wall-clock time at REPLAY_SPEED×
       real speed (2 = twice as fast). Fills/stamps/clears are
       instant "beat" events with a small pause after so the kid can
       see them land.

       Uses the SAME brush table as live drawing, so the replay is a
       faithful reconstruction — not a separate renderer that has to
       be kept in sync. */

    const REPLAY_SPEED         = 2.4;   /* strokes go this many × real time */
    const REPLAY_POINT_MS      = 35;    /* wall time per point at 1× */
    const REPLAY_BEAT_MS       = 240;   /* pause after a fill/stamp/clear */
    const REPLAY_TAIL_MS       = 900;   /* pause after final event before stopping */

    let replayState = null;

    function stopReplay() {
        if (!replayState) return;
        if (replayState.raf)   cancelAnimationFrame(replayState.raf);
        if (replayState.timer) clearTimeout(replayState.timer);
        replayState = null;
        const cvs = $("#detailReplayCanvas");
        const stop = $("#detailReplayStop");
        const img  = $("#detailImg");
        if (cvs)  cvs.setAttribute("hidden", "");
        if (stop) stop.setAttribute("hidden", "");
        if (img)  img.removeAttribute("hidden");
    }

    function playCurrentReplay() {
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        const rec = loadGallery().find(function (r) { return r.id === id; });
        if (!rec || !rec.replay || !rec.replay.ev || !rec.replay.ev.length) return;

        stopReplay();

        const displayCanvas = $("#detailReplayCanvas");
        const stopBtn       = $("#detailReplayStop");
        const detailImg     = $("#detailImg");
        if (!displayCanvas) return;

        /* Scratch canvas at the original stage size. All the brush
           coords are in this logical space. */
        const W = rec.replay.w || STAGE_W;
        const H = rec.replay.h || STAGE_H;
        const scratch = document.createElement("canvas");
        scratch.width  = W;
        scratch.height = H;
        const sctx = scratch.getContext("2d");

        /* Size the visible canvas to match the display aspect. It's
           sized square-ish by the #detailImg rule; give it explicit
           backing store to match the scratch's aspect. */
        const rect = displayCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const dispScale = Math.min(rect.width || 400, rect.height || 400) /
                          Math.max(W, H);
        displayCanvas.width  = Math.max(1, Math.round(W * dispScale * dpr));
        displayCanvas.height = Math.max(1, Math.round(H * dispScale * dpr));
        const dctx = displayCanvas.getContext("2d");

        /* Swap in the replay canvas + stop chip; hide the still image. */
        if (detailImg) detailImg.setAttribute("hidden", "");
        displayCanvas.removeAttribute("hidden");
        if (stopBtn) stopBtn.removeAttribute("hidden");

        replayState = {
            events:      rec.replay.ev,
            i:           0,
            strokePi:    0,
            scratch:     scratch,
            sctx:        sctx,
            displayCvs:  displayCanvas,
            dctx:        dctx,
            raf:         0,
            timer:       0,
            nextAtMs:    0
        };

        blitReplayFrame();
        stepReplay();
    }

    /* Copy the current scratch state into the visible display canvas.
       Cheap — one drawImage per rAF frame. */
    function blitReplayFrame() {
        if (!replayState) return;
        const dctx = replayState.dctx;
        const dcvs = replayState.displayCvs;
        dctx.save();
        dctx.setTransform(1, 0, 0, 1, 0, 0);
        /* Paper background so bare-canvas pixels don't show through
           as transparent. */
        dctx.fillStyle = getComputedStyle(document.body)
                            .getPropertyValue("--paper").trim() || "#fff5dc";
        dctx.fillRect(0, 0, dcvs.width, dcvs.height);
        dctx.drawImage(replayState.scratch, 0, 0, dcvs.width, dcvs.height);
        dctx.restore();
    }

    /* Advance the replay by one atomic step, then schedule the next
       via rAF (fast) or setTimeout (paced beats). */
    function stepReplay() {
        if (!replayState) return;
        const rs = replayState;
        if (rs.i >= rs.events.length) {
            /* All done — hold the final frame briefly, then close. */
            rs.timer = setTimeout(stopReplay, REPLAY_TAIL_MS);
            return;
        }
        const ev = rs.events[rs.i];

        if (ev.t === "S") {
            /* Stroke: apply one point per rAF tick, honoring
               REPLAY_POINT_MS as the target cadence. */
            const brush = BRUSHES[ev.tool] || BRUSHES.crayon;
            const size  = ev.sz;
            const color = ev.col;
            const pts   = ev.pts;
            if (rs.strokePi === 0) {
                /* First point: lay the initial dot. */
                brush.beginStroke(rs.sctx,
                                  { x: pts[0][0], y: pts[0][1] },
                                  size, color);
                blitReplayFrame();
                rs.strokePi = 1;
                rs.nextAtMs = performance.now() +
                              (REPLAY_POINT_MS / REPLAY_SPEED);
                rs.raf = requestAnimationFrame(function tick() {
                    if (!replayState) return;
                    const now = performance.now();
                    if (now < rs.nextAtMs) {
                        rs.raf = requestAnimationFrame(tick);
                        return;
                    }
                    /* Emit as many points as the elapsed budget covers,
                       so a browser that skipped frames still catches up
                       instead of playing back in slow-motion. */
                    while (rs.strokePi < pts.length && now >= rs.nextAtMs) {
                        const p0 = { x: pts[rs.strokePi - 1][0],
                                     y: pts[rs.strokePi - 1][1] };
                        const p1 = { x: pts[rs.strokePi][0],
                                     y: pts[rs.strokePi][1] };
                        brush.drawSegment(rs.sctx, p0, p1, size, color);
                        rs.strokePi++;
                        rs.nextAtMs += (REPLAY_POINT_MS / REPLAY_SPEED);
                    }
                    blitReplayFrame();
                    if (rs.strokePi < pts.length) {
                        rs.raf = requestAnimationFrame(tick);
                    } else {
                        /* Stroke done — move on to the next event. */
                        rs.i++;
                        rs.strokePi = 0;
                        rs.raf = requestAnimationFrame(stepReplay);
                    }
                });
                return;
            }
            /* Shouldn't reach here — strokePi resets to 0 between
               events — but guard anyway. */
            rs.strokePi = 0;
            rs.i++;
            rs.raf = requestAnimationFrame(stepReplay);
            return;
        }

        if (ev.t === "F") {
            replayApplyFill(rs, ev);
            blitReplayFrame();
            rs.i++;
            rs.timer = setTimeout(stepReplay, REPLAY_BEAT_MS);
            return;
        }
        if (ev.t === "M") {
            replayApplyStamp(rs, ev);
            blitReplayFrame();
            rs.i++;
            rs.timer = setTimeout(stepReplay, REPLAY_BEAT_MS);
            return;
        }
        if (ev.t === "C") {
            rs.sctx.save();
            rs.sctx.setTransform(1, 0, 0, 1, 0, 0);
            rs.sctx.clearRect(0, 0, rs.scratch.width, rs.scratch.height);
            rs.sctx.restore();
            blitReplayFrame();
            rs.i++;
            rs.timer = setTimeout(stepReplay, REPLAY_BEAT_MS);
            return;
        }

        /* Unknown event type — skip it. */
        rs.i++;
        rs.raf = requestAnimationFrame(stepReplay);
    }

    /* Replay fill: walk the target canvas at logical coords and
       flood the region under (sx, sy) with the recorded color. Uses
       a simple in-place walk on the scratch canvas — no line-art
       boundary (the replay canvas has no template overlay), so the
       walk stops at anything different from the seed pixel, exactly
       like the live fill's MS-Paint semantics on BLANK. */
    function replayApplyFill(rs, ev) {
        const sctx = rs.sctx;
        const W = rs.scratch.width, H = rs.scratch.height;
        const sx = Math.round(ev.sx), sy = Math.round(ev.sy);
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
        let image;
        try { image = sctx.getImageData(0, 0, W, H); }
        catch (_) { return; }
        const data = image.data;
        const rgb = hexToRgb(ev.col);
        const r = rgb[0], g = rgb[1], b = rgb[2];
        const si = (sy * W + sx) * 4;
        const seedR = data[si], seedG = data[si + 1],
              seedB = data[si + 2], seedA = data[si + 3];
        if (seedA === 255 && seedR === r && seedG === g && seedB === b) return;
        const TOL2 = 6 * 6;
        function matches(i) {
            const q = i * 4;
            const dr = data[q]     - seedR;
            const dg = data[q + 1] - seedG;
            const db = data[q + 2] - seedB;
            const da = data[q + 3] - seedA;
            return dr * dr + dg * dg + db * db + da * da <= TOL2;
        }
        const seen = new Uint8Array(W * H);
        const stack = [sy * W + sx];
        while (stack.length) {
            const seed = stack.pop();
            const y = (seed / W) | 0;
            let x = seed - y * W;
            while (x > 0 && !seen[y * W + x - 1] && matches(y * W + x - 1)) x--;
            let up = false, dn = false;
            while (x < W) {
                const i = y * W + x;
                if (seen[i] || !matches(i)) break;
                seen[i] = 1;
                if (y > 0) {
                    const u = i - W;
                    const openU = !seen[u] && matches(u);
                    if (openU && !up) { stack.push(u); up = true; }
                    else if (!openU)  up = false;
                }
                if (y < H - 1) {
                    const d = i + W;
                    const openD = !seen[d] && matches(d);
                    if (openD && !dn) { stack.push(d); dn = true; }
                    else if (!openD)  dn = false;
                }
                x++;
            }
        }
        /* Solid paint pass — replay always uses solid fill (patterns
           aren't recorded per-event yet; this is a v1 tradeoff). */
        for (let i = 0; i < seen.length; i++) {
            if (!seen[i]) continue;
            const q = i * 4;
            data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = 255;
        }
        sctx.putImageData(image, 0, 0);
    }

    function replayApplyStamp(rs, ev) {
        const sctx = rs.sctx;
        const stamps = (typeof STAMPS !== "undefined") ? STAMPS : [];
        let def = null;
        for (let i = 0; i < stamps.length; i++) {
            if (stamps[i].id === ev.id) { def = stamps[i]; break; }
        }
        if (!def) return;
        sctx.save();
        sctx.globalCompositeOperation = "source-over";
        sctx.globalAlpha = 1;
        sctx.translate(ev.x, ev.y);
        sctx.scale(ev.sz / 100, ev.sz / 100);
        sctx.fillStyle   = ev.col;
        sctx.strokeStyle = ev.col;
        sctx.lineCap  = "round";
        sctx.lineJoin = "round";
        sctx.lineWidth = 7;
        def.draw(sctx);
        sctx.restore();
    }

    function deleteCurrent() {
        /* Destructive — parent-gated. */
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        parentGate("delete", function () {
            const items = loadGallery().filter(function (r) { return r.id !== id; });
            persistGallery(items);
            closeDetail();
            renderGallery();
        });
    }

    /* Print the picture. Parent-gated (same as export). We stamp a
       single <img> into a hidden #printWrap, wait for it to decode,
       then call window.print(). @media print CSS hides the rest of
       the app and reveals the wrap. Works cleanly on web and on
       iOS/WKWebView; Android WebView's print support is weaker and
       may need Capacitor's Print plugin later, but the same call
       gracefully no-ops there rather than crashing. */
    async function printPngRecord(rec) {
        return new Promise(function (resolve) {
            const wrap = document.createElement("div");
            wrap.id = "printWrap";
            const img = document.createElement("img");
            img.alt = rec.name || "Tiny Canvas";
            img.src = rec.png;
            wrap.appendChild(img);
            document.body.appendChild(wrap);
            const finish = function () {
                document.body.classList.add("printing");
                try {
                    window.print();
                } catch (_) {}
                /* window.print() is synchronous on web (blocks until the
                   dialog resolves) but on iOS returns immediately while
                   the sheet is showing. Clean up on the next tick either
                   way; the OS holds the image internally by then. */
                setTimeout(function () {
                    document.body.classList.remove("printing");
                    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                    resolve();
                }, 300);
            };
            if (img.complete && img.naturalWidth) {
                finish();
            } else {
                img.onload = img.onerror = finish;
            }
        });
    }

    function printCurrent() {
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        parentGate("print", async function () {
            let rec = loadGallery().find(function (r) { return r.id === id; });
            if (!rec) return;
            /* Print the framed version if the kid picked one, same rule
               as export. */
            if (detailFrameId !== "none") {
                const framed = await frameRecPng(rec, detailFrameId);
                rec = Object.assign({}, rec, { png: framed });
            }
            await printPngRecord(rec);
        });
    }

    function exportCurrent() {
        /* Export saves a PNG to the device — gated as a "leaves the app"
           action per Apple Kids policy.

           Native: writes to Filesystem.Cache + opens the Share sheet
           so the user picks "Save to Photos" / "Save to Files".
           Web: anchor-download fallback. */
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        parentGate("export", async function () {
            let rec = loadGallery().find(function (r) { return r.id === id; });
            if (!rec) return;

            /* Frame chosen in the detail panel is applied to the
               exported copy only — the stored record stays clean. */
            if (detailFrameId !== "none") {
                const framed = await frameRecPng(rec, detailFrameId);
                rec = Object.assign({}, rec, { png: framed });
            }

            if (isNative()) {
                const ok = await nativeExport(rec);
                if (ok) return;
                /* Native plugin failed entirely (e.g. Filesystem missing).
                   Fall through to the web anchor download as a last resort
                   — it'll still produce a file via the Capacitor webview's
                   download intent. */
            }

            const a = document.createElement("a");
            a.href = rec.png;
            a.download = (rec.name || "tiny-canvas") + "-" + formatDate(rec.date) + ".png";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }

    /* ---------- 11. PWA INSTALL PROMPT ---------- */

    let deferredInstall = null;
    const installBtn = $("#btnInstall");

    window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        /* Never offer "install this app" from inside the installed app.
           Chrome's Android WebView does fire beforeinstallprompt, so
           without this gate the native build shows an INSTALL APP button
           on its own title screen — which does nothing useful and reads
           as a bug to anyone holding the phone. */
        if (isNative()) return;
        deferredInstall = e;
        if (installBtn) installBtn.hidden = false;
    });

    if (installBtn) {
        installBtn.addEventListener("click", async function () {
            if (!deferredInstall) return;
            deferredInstall.prompt();
            try { await deferredInstall.userChoice; } catch (_) {}
            deferredInstall = null;
            installBtn.hidden = true;
        });
    }

    /* ---------- 12. KEYBOARD ---------- */

    document.addEventListener("keydown", function (e) {
        if (state.screen !== "draw") return;
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
            e.preventDefault();
            undo();
        } else if ((k === "z" && e.shiftKey) || k === "y") {
            /* Ctrl/Cmd+Shift+Z = redo (Mac + modern Windows); Ctrl+Y
               is the classic Windows shortcut kids' parents might
               reach for. Both go through the same path. */
            e.preventDefault();
            redo();
        }
    });

    /* ---------- 13. WIRING ---------- */

    async function init() {
        /* Native rehydration must run BEFORE loadSettings/loadGallery
           so the first localStorage reads see the canonical native
           values, not stale web-cache values. No-op on web. */
        await rehydrateFromNativePrefs();
        loadProFlag();
        loadSettings();
        setupCanvas();
        /* buildPicker() is deliberately NOT called here — showScreen
           builds it on first entry. See the note on buildPicker. */
        buildPaletteTabs();
        buildPalette();
        attachToolHandlers();
        attachDrawerHandler();
        attachDrawing();
        attachSettingsHandlers();
        rebuildSizeButtons();
        refreshToolButtons();
        /* Pro content: reveal the gated UI (always on web — see
           isPro), then build + apply the paper layer. Order matters:
           reveal first so the paper row exists un-hidden when its
           chips build. */
        revealProUI();
        buildPaperButtons();
        applyPaper();
        /* Billing: deliberately NOT awaited — boot must not block on
           the store network. The cached PRO_KEY already applied above;
           RC confirms/unlocks in the background. No-op on web and on
           builds without a real RC key. */
        initBilling();
        const buyPro = $("#btnBuyPro");
        if (buyPro) buyPro.addEventListener("click", function () {
            parentGate("purchase", purchasePro);
        });
        const restorePro = $("#btnRestorePro");
        if (restorePro) restorePro.addEventListener("click", function () {
            parentGate("restore", restoreProPurchases);
        });

        $("#btnStart").addEventListener("click", async function () {
            /* START COLORING goes straight to a blank canvas instead of
               dumping the kid into a 20-template grid. Most kids just
               want to scribble; templates are an optional side-trip via
               the floating PAGES button on the draw screen. */
            const blank = (window.TINY_CANVAS_TEMPLATES || [])
                .find(function (t) { return t.id === "blank"; });
            if (blank) await loadTemplate(blank);
            showScreen("draw");
        });
        $("#btnGallery").addEventListener("click", function () {
            showScreen("gallery");
        });
        $("#pickerBack").addEventListener("click", function () {
            /* Picker is now reached ONLY from the draw screen via the
               floating PAGES button. Back-from-picker returns to
               drawing rather than punting to the title. */
            showScreen("draw");
        });
        $("#drawBack").addEventListener("click", function () {
            /* Save the in-progress before leaving so the kid's
               current strokes survive going back to title and
               coming back to draw later. */
            persistInProgress();
            showScreen("title");
        });
        /* Floating PAGES button on the draw screen — opens the
           template picker as an optional browse view. */
        const howTo = $("#btnHowToPlay");
        if (howTo) howTo.addEventListener("click", replayCoaching);

        const pagesBtn = $("#pagesBtn");
        if (pagesBtn) {
            pagesBtn.addEventListener("click", function () {
                retireCoachButtons();
                showScreen("picker");
            });
        }
        $("#galleryBack").addEventListener("click", function () {
            showScreen("title");
        });
        $("#drawClear").addEventListener("click", function () {
            /* CLEAR is undoable. It used to call pushHistory() and
               then clearCanvas(), which wiped the very entry it had
               just pushed — so an accidental CLEAR destroyed the
               drawing with no way back, on a kids' app. */
            beginHistoryCapture();
            markWholeCanvasDirty();
            commitHistory();
            clearCanvas(true);
            clearInProgress();
            triggerOnionReaction("cleared");
            /* Bring the idle scribble back if we're on BLANK — the
               kid just got back to a fresh page. */
            maybeShowIdleScribble();
        });
        $("#drawSave").addEventListener("click", function () {
            saveDrawing();
        });
        const trayUndo = $("#drawUndo");
        if (trayUndo) trayUndo.addEventListener("click", undo);
        const trayRedo = $("#drawRedo");
        if (trayRedo) trayRedo.addEventListener("click", redo);
        $("#detailClose").addEventListener("click", closeDetail);
        $("#detailDelete").addEventListener("click", deleteCurrent);
        $("#detailExport").addEventListener("click", exportCurrent);
        const detailPrint = $("#detailPrint");
        if (detailPrint) detailPrint.addEventListener("click", printCurrent);
        const detailReplayBtn  = $("#detailReplay");
        const detailReplayStop = $("#detailReplayStop");
        if (detailReplayBtn)  detailReplayBtn.addEventListener("click", playCurrentReplay);
        if (detailReplayStop) detailReplayStop.addEventListener("click", stopReplay);
        const galleryStart = $("#galleryStartBtn");
        if (galleryStart) {
            galleryStart.addEventListener("click", async function () {
                const blank = (window.TINY_CANVAS_TEMPLATES || [])
                    .find(function (t) { return t.id === "blank"; });
                if (blank) await loadTemplate(blank);
                showScreen("draw");
            });
        }

        /* Settings screen */
        const settingsHook = $("#settingsHook");
        if (settingsHook) {
            settingsHook.addEventListener("click", function () {
                showScreen("settings");
            });
        }
        const settingsBack = $("#settingsBack");
        if (settingsBack) {
            settingsBack.addEventListener("click", function () {
                showScreen("title");
            });
        }

        /* Parent gate close button */
        const gateClose = $("#parentGateClose");
        if (gateClose) gateClose.addEventListener("click", cancelParentGate);

        /* External links — apply parent gate. The .madder-home button
           leaves the app for the Madderverse hub; the footer Madderverse
           / About / Mad Sundar links all do too. Each gets an
           interception click handler. parentGate() itself short-circuits
           on plain web (just navigates) and uses the 24h-persisted unlock
           on native/PWA-standalone. */
        document.querySelectorAll('.madder-home, .site-footer-slim a')
            .forEach(function (link) {
                link.addEventListener("click", function (e) {
                    const href = link.getAttribute("href");
                    const target = link.getAttribute("target");
                    /* If gate would be a no-op (web context or already
                       unlocked), let the browser handle the click
                       natively — preserves middle-click open-in-tab,
                       cmd-click, etc. */
                    if (!isStandaloneOrNative() || isGateUnlocked()) return;
                    e.preventDefault();
                    parentGate("external-link", function () {
                        if (target) window.open(href, target);
                        else        window.location.href = href;
                    });
                });
            });

        /* Default tool selection. State is pre-initialized at the top
           of the IIFE; this just syncs the DOM after the builders ran. */
        refreshToolButtons();
        rebuildSizeButtons();
        refreshPaletteActive();
        syncSettingsUI();

        /* Kick off auto-save once everything is wired. */
        startAutosave();

        /* Native shell setup — no-op on web. Splash hide is slightly
           delayed so the first webview frame paints before the splash
           fades. Capacitor's capacitor.config.json launchShowDuration:
           1200 covers the case where init takes longer than expected. */
        setupStatusBar();
        setTimeout(hideSplashScreen, 400);

        /* Resize-aware backing store: rebuild on orientation change
           so DPR-scaled strokes don't blur when the screen rotates. */
        let resizeRaf = 0;
        window.addEventListener("resize", function () {
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(function () {
                /* Carry the drawing across the rotation, SCALED AND
                   CENTRED. This used to snapshot with getImageData and
                   paste it back with putImageData(snap, 0, 0) — which
                   neither scales nor centres, so rotating to landscape
                   dumped the portrait-shaped drawing against the
                   top-left corner.

                   The scale factor is deliberately min(W,H)-based
                   rather than a straight width or height ratio: the
                   line-art SVG letterboxes its 800x800 viewBox into the
                   viewport with preserveAspectRatio, i.e. it lives in
                   the largest centred SQUARE. Matching that keeps the
                   kid's strokes registered with the printed lines
                   through a rotation instead of sliding off them.

                   drawImage rather than putImageData because
                   putImageData cannot scale and ignores transforms. */
                const oldW = canvas.width, oldH = canvas.height;
                let carry = null;
                if (oldW && oldH) {
                    carry = document.createElement("canvas");
                    carry.width  = oldW;
                    carry.height = oldH;
                    try { carry.getContext("2d").drawImage(canvas, 0, 0); }
                    catch (_) { carry = null; }
                }

                /* setupCanvas resizes the backing store, clears it and
                   resets history — correct, because history patches are
                   recorded in the OLD pixel geometry and replaying one
                   after a rotation would paint it in the wrong place. */
                setupCanvas();

                if (carry) {
                    const newW = canvas.width, newH = canvas.height;
                    const k  = Math.min(newW, newH) / Math.min(oldW, oldH);
                    const dw = oldW * k, dh = oldH * k;
                    ctx2d.save();
                    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
                    ctx2d.globalCompositeOperation = "source-over";
                    ctx2d.globalAlpha = 1;
                    try {
                        ctx2d.drawImage(carry,
                            (newW - dw) / 2, (newH - dh) / 2, dw, dh);
                    } catch (_) {}
                    ctx2d.restore();
                    state.dirty = true;
                    updateStatus();
                }

                /* Turning the phone is the thing the hint asked for —
                   take it down immediately rather than leaving it
                   floating over the landscape layout. Also covers the
                   case where the kid arrived in landscape and then
                   rotated TO portrait, which is when the hint becomes
                   worth showing. */
                if (innerWidth > innerHeight) hideRotateHint();
                else maybeShowRotateHint();
            });
        });

        updateStatus();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

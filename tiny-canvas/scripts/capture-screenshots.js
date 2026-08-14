#!/usr/bin/env node
/* ============================================================
   tiny-canvas — store screenshot capture script
   ============================================================
   Drives a headless Chromium via Playwright to walk through the
   seven core screens (title, picker, mid-drawing, fill+pattern,
   stamps, gallery, settings) at every device size the App Store
   + Google Play require. Outputs PNGs into
   tiny-canvas/screenshots/<size>/.

   USAGE (from inside tiny-canvas/):
     # one-time setup
     npm i -D playwright
     npx playwright install chromium

     # serve the web build separately in one terminal:
     python3 -m http.server 8000

     # capture in another terminal:
     node scripts/capture-screenshots.js

   Device emulation only — no real iPhone / iPad needed. The
   CLAUDE.md prefers on-device phone shots (below 1030px CSS
   width the layout is a different arrangement), but Apple + Play
   accept correctly-dimensioned headless captures. If review
   ever flags one, re-shoot the failing profile on real hardware.

   Each profile produces 7 numbered PNGs in the order that reads
   as a marketing walkthrough — the tool tray is featured before
   the reward moment (gallery):
     01-title.png      02-picker.png       03-drawing.png
     04-fill.png       05-stamps.png       06-gallery.png
     07-settings.png

   The size labels match the App Store Connect / Play Console
   upload slots so you just drag-drop the right folder in.
   ============================================================ */

const { chromium } = require("playwright");
const fs   = require("fs");
const path = require("path");

const HOST = process.env.HOST || "http://localhost:8000";
const APP  = HOST + "/tiny-canvas/";

/* Device profiles — CSS pixels + devicePixelRatio. */
const PROFILES = [
    /* App Store — required */
    { label: "ios-6.9-iphone-pro-max", w: 430, h: 932,  dpr: 3, ios: true },

    /* App Store — recommended */
    { label: "ios-6.1-iphone",         w: 390, h: 844,  dpr: 3, ios: true },

    /* App Store — iPad (required when iPad support is shipped) */
    { label: "ios-13-ipad-pro",        w: 1032, h: 1376, dpr: 2, ios: true },

    /* Google Play — phone */
    { label: "android-phone",          w: 412, h: 915,  dpr: 2.5 },

    /* Google Play — 7-inch tablet */
    { label: "android-7in-tablet",     w: 600, h: 960,  dpr: 2 },

    /* Google Play — 10-inch tablet */
    { label: "android-10in-tablet",    w: 800, h: 1280, dpr: 2 }
];

const OUT_ROOT = path.join(__dirname, "..", "screenshots");

/* Template ids picked for their screenshot value — all live in the
   2026-08-07 catalog in templates.js. Change here and here alone. */
const DRAWING_PAGE = "unicorn";   /* freehand strokes read well over it */
const FILL_PAGE    = "cat";       /* clean animal outline, big regions */
const STAMPS_PAGE  = "blank";     /* stamps sell themselves on empty paper */

/* Gallery seed — ids must be real templates so buildGalleryThumb
   below can render each one. */
const GALLERY_SEED = [
    { id: "tc_s1", template: "unicorn",  name: "UNICORN",  date: "2026-08-06T12:00:00.000Z" },
    { id: "tc_s2", template: "cat",      name: "CAT",      date: "2026-08-07T09:00:00.000Z" },
    { id: "tc_s3", template: "rocket",   name: "ROCKET",   date: "2026-08-08T18:00:00.000Z" },
    { id: "tc_s4", template: "donut",    name: "DONUT",    date: "2026-08-09T15:00:00.000Z" }
];

async function ensureDir(p) {
    await fs.promises.mkdir(p, { recursive: true });
}

/* ============================================================
   Per-profile capture flow.
   ============================================================ */
async function captureProfile(browser, profile) {
    const outDir = path.join(OUT_ROOT, profile.label);
    await ensureDir(outDir);

    const ctx = await browser.newContext({
        viewport:           { width: profile.w, height: profile.h },
        deviceScaleFactor:  profile.dpr,
        isMobile:           !profile.label.includes("tablet"),
        hasTouch:           true,
        userAgent:          profile.ios
            ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
            : "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120"
    });

    const page = await ctx.newPage();

    /* Seed localStorage BEFORE first navigation so the captured
       state has:
         - a populated gallery (with real ids to match current templates)
         - all one-shot coach marks / toasts pre-dismissed
         - no rotate-hint interference
       Every key mirrors what the app writes at runtime; see game.js.

       ⚠ addInitScript re-fires on EVERY navigation, including the
       reload that comes after we paint gallery-thumb data URLs into
       localStorage. Naive re-seeding overwrites the painted pngs
       and the reloaded gallery renders as broken-image icons. Every
       write here is guarded by an "already present?" check so the
       reload is a no-op for anything the paint step wrote. */
    await page.addInitScript((seed) => {
        try {
            if (!localStorage.getItem("tinyCanvas.gallery.v1")) {
                localStorage.setItem(
                    "tinyCanvas.gallery.v1",
                    JSON.stringify(seed.map(function (r) {
                        return {
                            id: r.id, name: r.name, template: r.template,
                            date: r.date, png: ""
                        };
                    }))
                );
            }
            /* Suppress every "first time you see this" flash. Missing
               key or "0" both count as unseen, so guard on presence
               of the "1" value specifically. */
            var flags = [
                "tinyCanvas.firstSaveCelebrated.v1",
                "tinyCanvas.eraseTipShown.v1",
                "tinyCanvas.coach.draw.v1",
                "tinyCanvas.coach.offered.v1"
            ];
            flags.forEach(function (k) {
                if (localStorage.getItem(k) !== "1") {
                    localStorage.setItem(k, "1");
                }
            });
        } catch (_) {}
    }, GALLERY_SEED);

    await page.goto(APP, { waitUntil: "networkidle" });

    /* Hard-stop animations for a stable capture, and hide the
       rotate-hint / erase-tip toasts even if they slip past their
       flags (rotateHintShown is in-memory, not persisted). */
    async function freezeChrome() {
        await page.addStyleTag({ content: `
            *, *::before, *::after {
                animation-play-state: paused !important;
                transition: none !important;
            }
            #rotateHint, #eraseTipToast, #savedToast, #firstSaveToast,
            #coach { display: none !important; }
        ` });
    }
    await freezeChrome();

    /* Build gallery thumbnails from the CURRENT catalog. Raster
       templates (image) are drawn via <img>, SVG templates via a
       Blob URL as before. Older code assumed svg-only and left
       every card as bare paper; that made the gallery shot look
       like a bug. */
    await page.evaluate(async () => {
        const items = JSON.parse(localStorage.getItem("tinyCanvas.gallery.v1") || "[]");
        const tpls  = window.TINY_CANVAS_TEMPLATES || [];

        function paintScribble(ctx, tplId) {
            /* Per-template hand-tuned strokes — four soft washes each,
               chosen to sit over the subject's main shapes rather than
               scatter across the whole page. Random beziers on top of
               the art read as "toddler scribble" and made the gallery
               look like every drawing was a mess; this reads as
               "a kid started colouring in the shape."

               Coords are in the 800x800 offscreen canvas; the art is
               drawn into (32, 132, 736, 536) below, so strokes with
               y in ~150..660 land ON the art. */
            const PLANS = {
                unicorn: [
                    /* horn (yellow), mane (pink), body wash (teal),
                       tail (lavender) */
                    { color: "#ffd23f", w: 22, a: 0.85,
                      pts: [[435, 300], [430, 260], [430, 200]] },
                    { color: "#ff5cab", w: 30, a: 0.55,
                      pts: [[365, 340], [345, 420], [355, 490]] },
                    { color: "#7dd3c0", w: 42, a: 0.5,
                      pts: [[400, 470], [460, 490], [520, 480]] },
                    { color: "#c39bff", w: 26, a: 0.55,
                      pts: [[540, 470], [575, 500], [590, 540]] }
                ],
                cat: [
                    { color: "#ffb26b", w: 46, a: 0.55,
                      pts: [[360, 340], [400, 420], [400, 500]] },
                    { color: "#ff5cab", w: 22, a: 0.7,
                      pts: [[350, 300], [380, 300], [415, 300]] },
                    { color: "#9be15d", w: 40, a: 0.45,
                      pts: [[120, 260], [180, 240], [240, 260]] },
                    { color: "#7cc7ff", w: 34, a: 0.4,
                      pts: [[560, 320], [620, 300], [680, 320]] }
                ],
                rocket: [
                    { color: "#ff2e88", w: 30, a: 0.65,
                      pts: [[380, 250], [400, 340], [400, 420]] },
                    { color: "#ffd23f", w: 26, a: 0.85,
                      pts: [[400, 500], [400, 560], [400, 610]] },
                    { color: "#7cc7ff", w: 40, a: 0.4,
                      pts: [[140, 200], [240, 220], [340, 200]] },
                    { color: "#c39bff", w: 36, a: 0.4,
                      pts: [[500, 220], [600, 200], [680, 220]] }
                ],
                donut: [
                    { color: "#ff9ac9", w: 60, a: 0.5,
                      pts: [[280, 300], [400, 260], [520, 300]] },
                    { color: "#ff9ac9", w: 60, a: 0.5,
                      pts: [[280, 500], [400, 540], [520, 500]] },
                    { color: "#c39bff", w: 60, a: 0.5,
                      pts: [[220, 400], [220, 400]] },
                    { color: "#7dd3c0", w: 60, a: 0.5,
                      pts: [[580, 400], [580, 400]] }
                ]
            };
            const plan = PLANS[tplId];
            if (!plan) return; /* silently no-op for unlisted templates */
            ctx.lineCap = "round"; ctx.lineJoin = "round";
            for (const s of plan) {
                ctx.strokeStyle = s.color;
                ctx.lineWidth   = s.w;
                ctx.globalAlpha = s.a;
                ctx.beginPath();
                ctx.moveTo(s.pts[0][0], s.pts[0][1]);
                if (s.pts.length === 2) {
                    /* single-point becomes a dot via a tiny lineTo */
                    ctx.lineTo(s.pts[1][0] + 0.5, s.pts[1][1]);
                } else {
                    for (let i = 1; i < s.pts.length; i++) {
                        ctx.lineTo(s.pts[i][0], s.pts[i][1]);
                    }
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        async function drawImage(ctx, src, x, y, w, h) {
            await new Promise(function (res) {
                const img = new Image();
                img.onload  = function () { ctx.drawImage(img, x, y, w, h); res(); };
                img.onerror = res;
                img.src = src;
            });
        }

        async function drawSvg(ctx, svgText, x, y, w, h) {
            const blob = new Blob([svgText], { type: "image/svg+xml" });
            const url  = URL.createObjectURL(blob);
            try { await drawImage(ctx, url, x, y, w, h); }
            finally { URL.revokeObjectURL(url); }
        }

        for (const it of items) {
            const tpl = tpls.find(function (t) { return t.id === it.template; });
            const c = document.createElement("canvas");
            c.width = 800; c.height = 800;
            const cx = c.getContext("2d");
            cx.fillStyle = "#fbfaf6";
            cx.fillRect(0, 0, 800, 800);
            /* Paint the strokes FIRST, then the art on top —
               matches the app's layer stack, where line art (z=10)
               sits above the kid's canvas (z=5). composePng in
               game.js does the same order for saved gallery thumbs;
               reversing it would hide the printed lines behind the
               kid's colour and read as "toddler with a fat marker
               obliterated the page." */
            paintScribble(cx, it.template);
            if (tpl) {
                if (tpl.image)    await drawImage(cx, tpl.image, 32, 132, 736, 536);
                else if (tpl.svg) await drawSvg(cx, tpl.svg,     32,  32, 736, 736);
            }
            it.png = c.toDataURL("image/png");
        }
        localStorage.setItem("tinyCanvas.gallery.v1", JSON.stringify(items));
    });

    /* Reload so the gallery picks up the filled thumbnails. */
    await page.reload({ waitUntil: "networkidle" });
    await freezeChrome();

    /* ============================================================
       Small navigation + interaction helpers, scoped to `page`.
       ============================================================ */

    /* Every synthesized click routes through in-page JS rather than
       Playwright's ElementHandle.click, which enforces an "element
       is inside the viewport" check. On phone profiles the tool tray
       is a scrolling bottom-sheet and its palette/pattern/stamp rows
       can sit below the sheet's own fold — a scrollIntoView isn't
       always enough (the OUTER viewport is what Playwright measures,
       not the drawer's scroll box), and the click times out. A
       synthetic .click() on the resolved element fires the app's
       real listener without that check. */
    async function clickIf(selector) {
        return page.evaluate(function (sel) {
            var el = document.querySelector(sel);
            if (!el) return false;
            el.scrollIntoView({ block: "center" });
            el.click();
            return true;
        }, selector);
    }
    async function clickNth(selector, nth) {
        return page.evaluate(function (a) {
            var els = document.querySelectorAll(a.sel);
            var el  = els[a.i];
            if (!el) return false;
            el.scrollIntoView({ block: "center" });
            el.click();
            return true;
        }, { sel: selector, i: nth });
    }

    /* Load a specific template via the picker (nav flow the real
       app uses: draw → PAGES → picker → card).

       Card click goes through in-page JS rather than Playwright's
       ElementHandle.click, which enforces "element is inside the
       viewport" — a picker card several rows down the scroll list
       fails that check even after scrollIntoView, throwing on
       phone-sized profiles where the grid is longer than the
       viewport. A synthetic .click() on the element bypasses the
       viewport check but still fires the app's real handler. */
    async function goToTemplate(id) {
        await clickIf("#pagesBtn");
        await page.waitForSelector(".pick-card", { timeout: 4000 });
        await page.waitForTimeout(120);
        const found = await page.evaluate(function (tplId) {
            var card = document.querySelector(
                '.pick-card[data-id="' + tplId + '"]');
            if (!card) return false;
            card.scrollIntoView({ block: "center" });
            card.click();
            return true;
        }, id);
        if (!found) throw new Error("no pick-card for template id: " + id);
        await page.waitForSelector("#drawCanvas");
        await page.waitForTimeout(220);
    }

    /* Dispatch a synthetic tap on the drawing canvas at art-
       relative normalized coords (0..1 across the visible line-art
       element, not the whole canvas). Routes through the app's
       real pointer handlers so fill / stamp semantics fire
       exactly like a kid tapping. */
    async function tapArt(nx, ny) {
        await page.evaluate(function (p) {
            var c = document.getElementById("drawCanvas");
            var art = document.querySelector("#lineArt img")
                   || document.querySelector("#lineArt svg")
                   || c;
            var r = art.getBoundingClientRect();
            var x = r.left + r.width  * p.nx;
            var y = r.top  + r.height * p.ny;
            function make(type, buttons) {
                return new PointerEvent(type, {
                    pointerId: 1, pointerType: "touch", isPrimary: true,
                    clientX: x, clientY: y,
                    button: 0, buttons: buttons, bubbles: true
                });
            }
            c.dispatchEvent(make("pointerdown", 1));
            c.dispatchEvent(make("pointerup",   0));
        }, { nx: nx, ny: ny });
        await page.waitForTimeout(90);
    }

    async function armTool(tool) {
        await clickIf('[data-tool="' + tool + '"]');
        await page.waitForTimeout(80);
    }

    async function pickPattern(nth) {
        /* 1-based nth-child, so subtract 1 for querySelectorAll index. */
        await clickNth('#patternRow .pattern-btn', nth - 1);
        await page.waitForTimeout(60);
    }

    async function pickStamp(nth) {
        const ok = await clickNth('#stampRow .pattern-btn', nth - 1);
        if (!ok) await clickNth('#stampRow .stamp-btn', nth - 1);
        await page.waitForTimeout(60);
    }

    /* Colour by group index + swatch index inside the group. */
    async function pickColor(groupIdx, swatchIdx) {
        await clickNth('#paletteTabs .palette-tab', groupIdx);
        await page.waitForTimeout(60);
        await clickNth('#colorPalette .swatch', swatchIdx);
        await page.waitForTimeout(40);
    }

    /* ============================================================
       01 — Title
       ============================================================ */
    await page.waitForSelector("#btnStart");
    await page.screenshot({ path: path.join(outDir, "01-title.png") });

    /* ============================================================
       02 — Picker
       ============================================================ */
    await page.click("#btnStart");                 /* title → draw(blank) */
    await page.waitForSelector("#drawCanvas");
    await page.waitForTimeout(150);
    await page.click("#pagesBtn");                 /* draw → picker */
    await page.waitForSelector(".pick-card");
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(outDir, "02-picker.png") });

    /* ============================================================
       03 — Mid-drawing on UNICORN
       ============================================================ */
    /* Same in-page click as goToTemplate — see the note there. */
    const found03 = await page.evaluate(function (id) {
        var card = document.querySelector('.pick-card[data-id="' + id + '"]');
        if (!card) return false;
        card.scrollIntoView({ block: "center" });
        card.click();
        return true;
    }, DRAWING_PAGE);
    if (!found03) throw new Error("no pick-card for template id: " + DRAWING_PAGE);
    await page.waitForSelector("#drawCanvas");
    await page.waitForTimeout(220);
    /* Drawer stays collapsed — its natural state on phones, and
       canvas taps auto-close it anyway (game.js: pointerdown on
       #drawCanvas calls setDrawerOpen(false) so the kid's art is
       never hidden behind the tray). Arming tools via in-page
       .click() doesn't need the drawer visible; the buttons are
       still in the DOM at their natural size regardless of the
       transform. See armTool / pickPattern / pickStamp / pickColor. */

    /* Paint strokes directly on the canvas context so the shot is
       reproducible. Bypasses history — fine for screenshots.

       ⚠ We paint via a REAL pointer-event dispatched at the canvas
       rather than writing pixels straight into the 2d context. The
       app's pointer-down handler auto-closes the drawer (game.js
       line ~4179), which we actually want here — art must be
       visible under the collapsed drawer for the shot to read.
       Writing to the context bypassed the pointer path, so any
       prior paint was silently reset by init/rehydrate paths that
       run after loadTemplate finishes. Going through the real
       stroke path also picks up brush smoothing + history for
       free, so the drawing looks like actual kid-strokes. */
    await page.waitForFunction(function () {
        var art = document.querySelector("#lineArt img");
        return art && art.complete && art.naturalWidth > 0;
    }, { timeout: 5000 });
    await page.evaluate(async function () {
        var c = document.getElementById("drawCanvas");
        var art = document.querySelector("#lineArt img")
               || document.querySelector("#lineArt svg")
               || c;
        var ar = art.getBoundingClientRect();

        /* Build a set of little bezier flourishes inside the art box.
           Each flourish becomes one stroke: pointerdown + a few
           pointermove segments + pointerup, dispatched on the canvas
           at real client coords so game.js's getPos() maps them
           correctly. */
        function P(nx, ny) {
            return {
                x: ar.left + ar.width  * nx,
                y: ar.top  + ar.height * ny
            };
        }
        var strokes = [
            /* Pink mane wash — sweep down from the horn to the neck */
            [P(0.30, 0.30), P(0.34, 0.42), P(0.32, 0.55), P(0.38, 0.66)],
            /* Yellow horn — quick vertical dab */
            [P(0.52, 0.32), P(0.52, 0.20), P(0.52, 0.12)],
            /* Green body wash — diagonal on the flank */
            [P(0.48, 0.66), P(0.60, 0.74), P(0.66, 0.72)],
            /* Cyan tail flick */
            [P(0.24, 0.60), P(0.18, 0.68), P(0.14, 0.78)]
        ];

        /* Colours a kid might reach for — each stroke uses one.
           We arm the tool via the app's UI (color swatches) so the
           real brush pipeline runs; a bare context.strokeStyle would
           be overwritten by beginStroke on the first pointerdown. */
        var colorGroups = document.querySelectorAll('#paletteTabs .palette-tab');
        var strokeColors = [
            { group: 0, swatch: 0 },  /* RAINBOW / bright pink */
            { group: 0, swatch: 4 },  /* RAINBOW / yellow-ish  */
            { group: 3, swatch: 2 },  /* EARTH / green         */
            { group: 2, swatch: 6 }   /* NEONS / cyan          */
        ];

        function tap(el, type, x, y, buttons) {
            el.dispatchEvent(new PointerEvent(type, {
                pointerId: 1, pointerType: "touch", isPrimary: true,
                clientX: x, clientY: y,
                button: 0, buttons: buttons, bubbles: true
            }));
        }

        for (var i = 0; i < strokes.length; i++) {
            var col = strokeColors[i];
            if (colorGroups[col.group]) colorGroups[col.group].click();
            await new Promise(function (r) { setTimeout(r, 30); });
            var sw = document.querySelectorAll('#colorPalette .swatch')[col.swatch];
            if (sw) sw.click();
            await new Promise(function (r) { setTimeout(r, 30); });

            var pts = strokes[i];
            tap(c, "pointerdown", pts[0].x, pts[0].y, 1);
            for (var j = 1; j < pts.length; j++) {
                tap(c, "pointermove", pts[j].x, pts[j].y, 1);
            }
            tap(c, "pointerup", pts[pts.length - 1].x, pts[pts.length - 1].y, 0);
            await new Promise(function (r) { setTimeout(r, 60); });
        }

    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(outDir, "03-drawing.png") });

    /* ============================================================
       04 — Fill + pattern showcase on CAT
       ============================================================ */
    await goToTemplate(FILL_PAGE);
    /* Drawer stays collapsed — its natural state on phones, and
       canvas taps auto-close it anyway (game.js: pointerdown on
       #drawCanvas calls setDrawerOpen(false) so the kid's art is
       never hidden behind the tray). Arming tools via in-page
       .click() doesn't need the drawer visible; the buttons are
       still in the DOM at their natural size regardless of the
       transform. See armTool / pickPattern / pickStamp / pickColor. */
    await armTool("fill");
    /* Warm colour — neons carry the app's flavour. Group 2 = NEONS
       in the current catalog; pick a bright pink. */
    await pickColor(2, 1);
    /* Choose a pattern that reads at thumbnail size (dots / hearts /
       checks are easy to see; 2nd chip is generally dots). */
    await pickPattern(2);
    /* Tap two big fill regions in the top-visible band. Cat's body
       + face fills big; exact coords are conservative. */
    await tapArt(0.50, 0.55);
    await pickPattern(4);
    await pickColor(2, 3);
    await tapArt(0.20, 0.30);
    await pickPattern(6);
    await pickColor(0, 2);
    await tapArt(0.78, 0.35);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, "04-fill.png") });

    /* ============================================================
       05 — Stamps on BLANK
       ============================================================ */
    await goToTemplate(STAMPS_PAGE);
    /* Drawer stays collapsed — its natural state on phones, and
       canvas taps auto-close it anyway (game.js: pointerdown on
       #drawCanvas calls setDrawerOpen(false) so the kid's art is
       never hidden behind the tray). Arming tools via in-page
       .click() doesn't need the drawer visible; the buttons are
       still in the DOM at their natural size regardless of the
       transform. See armTool / pickPattern / pickStamp / pickColor. */
    await armTool("stamp");
    /* Default pack shows first; the stamp row auto-populates. */
    await page.waitForSelector("#stampRow", { timeout: 3000 }).catch(function () {});
    await page.waitForTimeout(120);

    /* Warm pinks + yellows + teals — read as celebratory. Place a
       spray of stamps across the visible band. */
    await pickColor(0, 3);
    await pickStamp(1);  await tapArt(0.20, 0.28);
    await pickStamp(3);  await tapArt(0.50, 0.20);
    await pickColor(2, 0);
    await pickStamp(5);  await tapArt(0.72, 0.30);
    await pickColor(0, 6);
    await pickStamp(2);  await tapArt(0.35, 0.55);
    await pickStamp(6);  await tapArt(0.62, 0.62);
    await pickColor(1, 4);
    await pickStamp(4);  await tapArt(0.15, 0.72);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, "05-stamps.png") });

    /* ============================================================
       06 — Gallery
       ============================================================ */
    await page.click("#drawBack");                 /* draw → title */
    await page.waitForSelector("#btnGallery");
    await page.click("#btnGallery");
    await page.waitForSelector(".pic-card");
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, "06-gallery.png") });

    /* ============================================================
       07 — Settings
       ============================================================ */
    await page.click("#galleryBack");
    await page.waitForSelector("#settingsHook");
    await page.click("#settingsHook");
    await page.waitForSelector("#setSmoothing");
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(outDir, "07-settings.png") });

    await ctx.close();
}

(async () => {
    await ensureDir(OUT_ROOT);
    const browser = await chromium.launch();
    for (const profile of PROFILES) {
        process.stdout.write("[capture] " + profile.label +
            " " + profile.w + "x" + profile.h +
            " @" + profile.dpr + "x ... ");
        const t0 = Date.now();
        try {
            await captureProfile(browser, profile);
            console.log("ok (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
        } catch (e) {
            console.log("FAILED");
            console.error("  ! " + e.message);
        }
    }
    await browser.close();
    console.log("\nAll captures saved to: " + OUT_ROOT);
    console.log("Slot map: see tiny-canvas/STORE_LISTING.md §15.");
})();

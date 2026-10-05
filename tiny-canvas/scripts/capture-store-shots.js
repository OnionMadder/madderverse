#!/usr/bin/env node
/* ============================================================
   tiny-canvas — Google Play store screenshots (landscape)
   ============================================================
   Produces 1920x1080 marketing shots of the NATIVE payload
   (www/, so no web-only chrome) by driving the real app: every
   colour on screen was put there by the app's own fill / brush /
   stamp / colour-by-number code, and the gallery holds pictures
   the app itself saved. Landscape because the coloring pages are
   ~1.83:1 scenes — in portrait they shrink to a strip.

   USAGE (from tiny-canvas/):
     node scripts/build-www.mjs
     # serve the REPO ROOT (e.g. the "madderverse" launch config, 8771)
     HOST=http://localhost:8771 node scripts/capture-store-shots.js

   Output: store/screenshots-v2/NN-name.png

   Supersedes capture-screenshots.js for Play. That script is
   portrait, shoots the web build, and seeds the pre-profile
   gallery key, so its gallery renders broken images.
   ============================================================ */

const { chromium } = require("playwright");
const fs   = require("fs");
const path = require("path");

const HOST = process.env.HOST || "http://localhost:8771";
const APP  = HOST + "/tiny-canvas/www/";
const OUT  = path.join(__dirname, "..", "store", "screenshots-v2");
const VIEW = { width: 853, height: 480 };   /* x2.25 = 1919x1080, real phone-landscape proportions */

/* Seeded RNG so a re-run produces the same pictures. */
function rng(seed) {
    return function () {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
        viewport: VIEW, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120"
    });
    const page = await ctx.newPage();

    /* Pre-dismiss every one-shot coach mark / toast, in both the
       legacy and the per-profile key namespace. */
    await page.addInitScript(() => {
        ["firstSaveCelebrated.v1", "eraseTipShown.v1", "coach.draw.v1",
         "coach.offered.v1"].forEach(function (k) {
            localStorage.setItem("tinyCanvas." + k, "1");
            localStorage.setItem("tinyCanvas.profile.p1." + k, "1");
        });
    });
    await page.goto(APP, { waitUntil: "networkidle" });

    const shot = async (name) => {
        await page.addStyleTag({ content:
            "#rotateHint,#eraseTipToast,#savedToast,#firstSaveToast," +
            "#cbnDoneToast,#coach{display:none!important}" });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, name + ".png") });
        console.log("  " + name);
    };

    /* ---------- helpers (all run the app's real handlers) ---------- */

    const load = async (id) => {
        await page.evaluate(function (id) {
            const t = window.TINY_CANVAS_TEMPLATES.find(function (t) { return t.id === id; });
            return window.__tinycanvas.loadTemplate(t);
        }, id);
        await page.waitForFunction(function () {
            const a = document.querySelector("#lineArt img");
            return !a || (a.complete && a.naturalWidth > 0);
        });
        await page.waitForTimeout(700);
    };
    const click = (sel, i) => page.evaluate(function (a) {
        const el = document.querySelectorAll(a.sel)[a.i || 0];
        if (el) el.click();
        return !!el;
    }, { sel: sel, i: i });
    const tool = async (t) => { await click('[data-tool="' + t + '"]'); await page.waitForTimeout(60); };
    const drawer = (open) => page.evaluate(function (open) {
        const isOpen = document.body.classList.contains("drawer-open") ||
            !!document.querySelector(".draw-side-rail.is-open,.drawer-open");
        if (isOpen !== open) { const h = document.querySelector("#drawerHandle,#toolsToggle,.drawer-handle"); if (h) h.click(); }
    }, open);

    /* Select a colour by hex, flipping palette tabs until found. */
    const color = (hex) => page.evaluate(function (hex) {
        const tabs = document.querySelectorAll("#paletteTabs .palette-tab");
        for (let t = -1; t < tabs.length; t++) {
            if (t >= 0) tabs[t].click();
            const sw = document.querySelector('#colorPalette .swatch[data-color="' + hex + '"]');
            if (sw) { sw.click(); return true; }
        }
        return false;
    }, hex);
    const swatchColors = (tab) => page.evaluate(function (tab) {
        const tabs = document.querySelectorAll("#paletteTabs .palette-tab");
        if (tabs[tab]) tabs[tab].click();
        return Array.from(document.querySelectorAll("#colorPalette .swatch[data-color]"))
            .map(function (s) { return s.getAttribute("data-color"); });
    }, tab);

    /* Pointer gesture on the canvas at art-relative coords (0..1). */
    const gesture = (pts) => page.evaluate(async function (pts) {
        const c = document.getElementById("drawCanvas");
        const art = document.querySelector("#lineArt img") || c;
        const r = art.getBoundingClientRect();
        const ev = function (type, p, b) {
            c.dispatchEvent(new PointerEvent(type, {
                pointerId: 1, pointerType: "touch", isPrimary: true,
                clientX: r.left + r.width * p[0], clientY: r.top + r.height * p[1],
                button: 0, buttons: b, bubbles: true }));
        };
        ev("pointerdown", pts[0], 1);
        for (let i = 1; i < pts.length; i++) {
            ev("pointermove", pts[i], 1);
            await new Promise(function (res) { setTimeout(res, 4); });
        }
        ev("pointerup", pts[pts.length - 1], 0);
    }, pts);
    const tap = (x, y) => gesture([[x, y]]);

    /* Is the kid-canvas still blank under (x,y), and not on a line? */
    const blankAt = (x, y) => page.evaluate(function (p) {
        const c = document.getElementById("drawCanvas");
        const art = document.querySelector("#lineArt img");
        const r = (art || c).getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const px = (r.left + r.width * p[0] - cr.left) * c.width / cr.width;
        const py = (r.top + r.height * p[1] - cr.top) * c.height / cr.height;
        const d = c.getContext("2d").getImageData(px | 0, py | 0, 1, 1).data;
        const painted = d[3] > 0 && !(d[0] > 240 && d[1] > 240 && d[2] > 235);
        if (painted) return false;
        if (art) {
            if (!window.__artProbe || window.__artProbe.src !== art.src) {
                const o = document.createElement("canvas");
                o.width = art.naturalWidth; o.height = art.naturalHeight;
                o.getContext("2d").drawImage(art, 0, 0);
                window.__artProbe = { src: art.src, ctx: o.getContext("2d"), w: o.width, h: o.height };
            }
            const a = window.__artProbe;
            const ad = a.ctx.getImageData((p[0] * a.w) | 0, (p[1] * a.h) | 0, 1, 1).data;
            if (ad[3] > 96) return false;
        }
        return true;
    }, [x, y]);

    /* Fill every still-blank region hit by a grid inside a box. */
    const fillBox = async (box, colors, rand, step, opts) => {
        opts = opts || {};
        for (let y = box[1]; y <= box[3]; y += step) {
            for (let x = box[0]; x <= box[2]; x += step) {
                if (!(await blankAt(x, y))) continue;
                await color(colors[(rand() * colors.length) | 0]);
                if (opts.patterns && rand() < opts.patterns) {
                    await click("#patternRow .pattern-btn", 1 + ((rand() * 7) | 0));
                } else {
                    await click("#patternRow .pattern-btn", 0);   /* solid */
                }
                await tap(x, y);
            }
        }
        await click("#patternRow .pattern-btn", 0);
    };
    const biggest = () => page.evaluate(function () {
        const b = document.querySelectorAll(".size-btn");
        if (b.length) b[b.length - 1].click();
    });
    /* A fill tap that repaints a region in its own colour changes
       nothing but deselects the wet sticker (game.js: fill tap
       always calls deselectSticker). */
    const deselect = async (x, y) => {
        await tool("fill");
        const hex = await page.evaluate(function (p) {
            const c = document.getElementById("drawCanvas");
            const r = (document.querySelector("#lineArt img") || c).getBoundingClientRect();
            const cr = c.getBoundingClientRect();
            const d = c.getContext("2d").getImageData(
                ((r.left + r.width * p[0] - cr.left) * c.width / cr.width) | 0,
                ((r.top + r.height * p[1] - cr.top) * c.height / cr.height) | 0, 1, 1).data;
            return "#" + [d[0], d[1], d[2]].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
        }, [x, y]);
        await color(hex);
        await tap(x, y);
    };
    const save = async () => { await click("#drawSave"); await page.waitForTimeout(1500); };

    await page.click("#btnStart");
    await page.waitForSelector("#drawCanvas");
    await page.waitForTimeout(400);
    const brights = await swatchColors(0);

    /* 01 — hero: a scene part-way coloured, tray closed */
    await load("cat");
    await tool("fill");
    await fillBox([0.02, 0.03, 0.70, 0.97], brights, rng(7), 0.035, { patterns: 0.04 });
    await drawer(false);
    await save();
    await shot("01-color-a-scene");

    /* 02 — colour by number, half done, number palette showing */
    await load("cbn-snowman");
    await tool("fill");
    await page.evaluate(async function () {
        const labels = Array.from(document.querySelectorAll("#cbnLabels .cbn-label"));
        const c = document.getElementById("drawCanvas");
        for (let i = 0; i < labels.length; i++) {
            if (i % 2) continue;                 /* leave half for the kid */
            const l = labels[i];
            const n = l.textContent.trim();
            const sw = document.querySelector('#colorPalette .swatch[data-cbn-idx="' + n + '"]');
            if (!sw) continue;
            sw.click();
            const r = l.getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            ["pointerdown", "pointerup"].forEach(function (t, k) {
                c.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: "touch",
                    isPrimary: true, clientX: x, clientY: y, button: 0, buttons: k ? 0 : 1, bubbles: true }));
            });
            await new Promise(function (res) { setTimeout(res, 80); });
        }
    });
    await drawer(true);
    await save();
    await shot("02-color-by-number");

    /* 05 — glitter + rainbow brushes over a part-coloured page */
    await load("butterfly");
    await tool("fill");
    await fillBox([0.20, 0.05, 0.80, 0.95], await swatchColors(1), rng(5), 0.04);
    await tool("rainbow");
    await biggest();
    await gesture([[0.05, 0.85], [0.12, 0.70], [0.20, 0.62], [0.30, 0.60], [0.40, 0.66]]);
    await tool("glitter");
    await biggest();
    await color("#ff2e88");
    await gesture([[0.10, 0.10], [0.18, 0.06], [0.26, 0.12], [0.34, 0.08], [0.42, 0.14]]);
    await drawer(true);
    await save();
    await shot("05-glitter-rainbow");

    /* 04 — stickers dropped onto a coloured ocean scene */
    await load("fish");
    await tool("fill");
    await fillBox([0.02, 0.03, 0.98, 0.97], await swatchColors(5), rng(11), 0.05);
    await tool("stamp");
    await page.waitForTimeout(150);
    const stickerSpots = [[0.15, 0.2], [0.82, 0.22], [0.12, 0.78], [0.86, 0.75], [0.5, 0.12]];
    for (let i = 0; i < stickerSpots.length; i++) {
        await color(brights[(i * 4 + 1) % brights.length]);
        await biggest();
        await click("#stampRow .stamp-btn,#stampRow .pattern-btn", i * 2);
        await tap(stickerSpots[i][0], stickerSpots[i][1]);
    }
    await deselect(0.5, 0.95);
    await drawer(false);
    await save();
    await shot("03-stickers");

    /* 05 — mirror mode, four ways, on blank paper */
    await load("blank");
    for (let i = 0; i < 3; i++) await click("#symmetryBtn");   /* off→v→h→4 */
    await tool("rainbow");
    const r5 = rng(3);
    for (let k = 0; k < 7; k++) {
        const pts = [];
        const a0 = r5() * Math.PI / 2, rad0 = 0.05 + r5() * 0.35;
        for (let t = 0; t <= 24; t++) {
            const a = a0 + t * 0.09, rad = rad0 + t * 0.006;
            pts.push([0.5 + Math.cos(a) * rad * 0.56, 0.5 + Math.sin(a) * rad]);
        }
        await gesture(pts);
    }
    await tool("glitter");
    await color("#ffd23f");
    await gesture([[0.42, 0.42], [0.46, 0.38], [0.48, 0.30]]);
    await drawer(false);
    await save();
    await shot("04-mirror");
    for (let i = 0; i < 1; i++) await click("#symmetryBtn");   /* back to off */

    /* 06 — the page picker */
    await click("#pagesBtn");
    await page.waitForSelector(".pick-card");
    /* Open on the detailed scenes rather than the plain FREE basics. */
    await page.evaluate(function () {
        const h = Array.from(document.querySelectorAll(".screen:not([hidden]) *"))
            .find(function (e) { return e.children.length === 0 && e.textContent.trim() === "ANIMALS"; });
        if (h) h.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(600);
    await shot("07-pages");

    /* 07 — the gallery, holding everything saved above */
    await page.evaluate(function () {
        const b = document.querySelector("#pickerBack,#pickBack,.screen:not([hidden]) .back-btn");
        if (b) b.click();
    });
    await page.waitForTimeout(300);
    await page.evaluate(function () {     /* undo the picker scroll */
        window.scrollTo(0, 0);
        document.querySelectorAll("*").forEach(function (e) { if (e.scrollTop) e.scrollTop = 0; });
    });
    await click("#drawBack");
    await page.waitForSelector("#btnGallery");
    await page.click("#btnGallery");
    await page.waitForSelector(".pic-card");
    await page.waitForTimeout(800);
    await page.evaluate(function () {
        window.scrollTo(0, 0);
        document.querySelectorAll("*").forEach(function (e) { if (e.scrollTop) e.scrollTop = 0; });
    });
    await shot("06-gallery");

    /* 08 — title */
    await click("#galleryBack");
    await page.waitForSelector("#btnStart");
    await shot("08-title");

    await browser.close();
    console.log("saved to " + OUT);
})().catch(function (e) { console.error(e); process.exit(1); });

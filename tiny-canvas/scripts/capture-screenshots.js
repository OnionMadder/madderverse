#!/usr/bin/env node
/* ============================================================
   tiny-canvas — store screenshot capture script
   ============================================================
   Drives a headless Chromium via Playwright to walk through the
   five core screens (title, picker, mid-drawing, gallery,
   settings) at every device size the App Store + Google Play
   require. Outputs PNGs into tiny-canvas/screenshots/<size>/.

   USAGE (from inside tiny-canvas/):
     # one-time setup
     npm i -D playwright
     npx playwright install chromium

     # serve the web build separately in one terminal:
     python3 -m http.server 8000

     # capture in another terminal:
     node scripts/capture-screenshots.js

   The script is intentionally device-emulation only — it does NOT
   require a real iPhone or iPad. Apple accepts pixel-perfect
   browser-rendered screenshots as long as they're the right
   dimensions. Same with Google Play. If review later flags a
   screenshot as "doesn't look like a real device," capture from
   the simulator + Android emulator instead (see the manual path
   in CLAUDE.md).

   Each profile produces 5 numbered PNGs in the order Apple expects:
     01-title.png   02-picker.png   03-drawing.png
     04-gallery.png 05-settings.png

   The size labels match the App Store Connect / Play Console
   upload slots so you just drag-drop the right folder in.
   ============================================================ */

const { chromium } = require("playwright");
const fs   = require("fs");
const path = require("path");

const HOST = process.env.HOST || "http://localhost:8000";
const APP  = HOST + "/tiny-canvas/";

/* Device profiles. The "label" maps to the App Store / Play
   Console upload slot. width/height are CSS pixels. devicePixelRatio
   makes the actual capture sharper (recommended 2-3). */
const PROFILES = [
    /* App Store — required */
    { label: "ios-6.9-iphone-pro-max", w: 430, h: 932, dpr: 3, ios: true },

    /* App Store — recommended */
    { label: "ios-6.1-iphone",         w: 390, h: 844, dpr: 3, ios: true },

    /* App Store — iPad (required when iPad support is shipped) */
    { label: "ios-13-ipad-pro",        w: 1032, h: 1376, dpr: 2, ios: true },

    /* Google Play — phone */
    { label: "android-phone",          w: 412, h: 915, dpr: 2.5 },

    /* Google Play — 7-inch tablet */
    { label: "android-7in-tablet",     w: 600, h: 960, dpr: 2 },

    /* Google Play — 10-inch tablet */
    { label: "android-10in-tablet",    w: 800, h: 1280, dpr: 2 }
];

const OUT_ROOT = path.join(__dirname, "..", "screenshots");

async function fileExists(p) {
    try { await fs.promises.stat(p); return true; }
    catch (_) { return false; }
}

async function ensureDir(p) {
    await fs.promises.mkdir(p, { recursive: true });
}

/* Capture the five screens for one profile. */
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

    /* Seed localStorage BEFORE loading the app so the gallery
       screenshot has actual content. We do this via
       addInitScript so it fires on first navigation. */
    await page.addInitScript(() => {
        const fakeGallery = [
            { id: "tc_s1", name: "SMILEY SUN",      template: "smile-sun",
              date: "2026-05-12T12:00:00.000Z", png: "" /* filled by script */ },
            { id: "tc_s2", name: "FRIENDLY DRAGON", template: "dragon",
              date: "2026-05-13T12:00:00.000Z", png: "" },
            { id: "tc_s3", name: "UNICORN",         template: "unicorn",
              date: "2026-05-13T18:00:00.000Z", png: "" },
            { id: "tc_s4", name: "ROCKET",          template: "rocket",
              date: "2026-05-14T09:00:00.000Z", png: "" }
        ];
        try { localStorage.setItem(
            "tinyCanvas.gallery.v1", JSON.stringify(fakeGallery)); } catch (_) {}
        try { localStorage.setItem(
            "tinyCanvas.firstSaveCelebrated.v1", "1"); } catch (_) {}
    });

    await page.goto(APP, { waitUntil: "networkidle" });
    /* Pause animations so the screenshot is stable. */
    await page.addStyleTag({
        content: "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }"
    });

    /* Fill in gallery thumbnails (synthesized from each template). */
    await page.evaluate(async () => {
        const items = JSON.parse(localStorage.getItem("tinyCanvas.gallery.v1") || "[]");
        for (const it of items) {
            const tpl = (window.TINY_CANVAS_TEMPLATES || []).find(t => t.id === it.template);
            const c = document.createElement("canvas");
            c.width = 800; c.height = 800;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#fbfaf6";
            ctx.fillRect(0, 0, 800, 800);
            /* Paint a few translucent strokes for "this is a finished
               drawing" vibe. */
            ctx.lineWidth = 22; ctx.lineCap = "round";
            ctx.strokeStyle = "#ff2e88";
            ctx.beginPath();
            ctx.moveTo(120, 220); ctx.lineTo(680, 220); ctx.stroke();
            ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 30;
            ctx.beginPath();
            ctx.moveTo(160, 520); ctx.lineTo(620, 520); ctx.stroke();
            ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 16;
            ctx.beginPath();
            ctx.moveTo(200, 380); ctx.lineTo(580, 380); ctx.stroke();
            if (tpl && tpl.svg) {
                const blob = new Blob([tpl.svg], { type: "image/svg+xml" });
                const url = URL.createObjectURL(blob);
                await new Promise(res => {
                    const img = new Image();
                    img.onload = () => { ctx.drawImage(img, 32, 32, 736, 736); URL.revokeObjectURL(url); res(); };
                    img.onerror = res;
                    img.src = url;
                });
            }
            it.png = c.toDataURL("image/png");
        }
        localStorage.setItem("tinyCanvas.gallery.v1", JSON.stringify(items));
    });

    /* Now reload so the gallery picks up the filled-in PNGs. */
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({
        content: "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }"
    });

    /* ---- 01: Title screen ---- */
    await page.waitForSelector("#btnStart");
    await page.screenshot({ path: path.join(outDir, "01-title.png"), fullPage: false });

    /* ---- 02: Picker ---- */
    await page.click("#btnStart");
    await page.waitForSelector(".pick-card");
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, "02-picker.png"), fullPage: false });

    /* ---- 03: Drawing in progress (UNICORN, mid-stroke) ---- */
    const unicornCard = page.locator(".pick-card", {
        has: page.locator(".pick-name", { hasText: "UNICORN" })
    });
    await unicornCard.click();
    await page.waitForSelector("#drawCanvas");
    await page.waitForTimeout(200);
    /* Programmatically paint a few colorful strokes so the screenshot
       shows the kid in the middle of doing something, not a blank
       canvas. */
    await page.evaluate(() => {
        const c = document.getElementById("drawCanvas");
        const ctx = c.getContext("2d");
        const dpr = c.width / 800;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        /* Pink mane wash */
        ctx.strokeStyle = "#ff2e88"; ctx.lineWidth = 28; ctx.globalAlpha = 0.65;
        ctx.beginPath(); ctx.moveTo(290, 320); ctx.bezierCurveTo(260, 360, 240, 420, 270, 470);
        ctx.stroke();
        /* Yellow horn */
        ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 18; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(470, 200); ctx.lineTo(460, 100);
        ctx.stroke();
        /* Teal body fill (a few strokes) */
        ctx.strokeStyle = "#9be15d"; ctx.lineWidth = 30; ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.moveTo(400, 420); ctx.lineTo(460, 510); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(430, 450); ctx.lineTo(500, 530); ctx.stroke();
        ctx.restore();
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, "03-drawing.png"), fullPage: false });

    /* ---- 04: Gallery ---- */
    await page.click("#drawBack");
    await page.click("#pickerBack");
    await page.click("#btnGallery");
    await page.waitForSelector(".pic-card");
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, "04-gallery.png"), fullPage: false });

    /* ---- 05: Settings ---- */
    await page.click("#galleryBack");
    await page.click("#settingsHook");
    await page.waitForSelector("#setSmoothing");
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, "05-settings.png"), fullPage: false });

    await ctx.close();
}

(async () => {
    await ensureDir(OUT_ROOT);
    const browser = await chromium.launch();
    for (const profile of PROFILES) {
        console.log("[capture]", profile.label,
                    profile.w + "x" + profile.h, "@" + profile.dpr + "x");
        try {
            await captureProfile(browser, profile);
        } catch (e) {
            console.error("  ! failed:", e.message);
        }
    }
    await browser.close();
    console.log("\nAll captures saved to:", OUT_ROOT);
    console.log("\nNext: review the PNGs, then drag-drop into the");
    console.log("matching App Store Connect / Play Console upload slot.");
    console.log("Slot map: see tiny-canvas/STORE_LISTING.md §15.");
})();

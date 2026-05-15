#!/usr/bin/env node
/* ============================================================
   all-munkis-app — Play Store screenshot capture
   ============================================================
   Drives headless Chromium via Playwright through the four
   showcase states and dumps PNGs into
   store-assets/screenshots/<profile>/.

   States captured:
     01-title       fresh load — empty rainbow stage + full bank
     02-rainbow     all six rainbow Munkis placed on the stage
     03-drag        a Munki mid-drag toward a slot (ghost visible)
     04-achievements the achievements panel open with a few unlocked

   USAGE (from inside all-munkis-app/):
     npm install
     npx playwright install chromium
     npm run serve            # terminal 1  (python http.server 8000)
     npm run screenshots      # terminal 2  (this script)

   Device-emulation only — no real phone needed. Google Play
   accepts pixel-perfect browser-rendered screenshots at the
   right dimensions. If Play review ever flags one as "not a real
   device," recapture from the Android emulator instead.

   Profiles → Play Console upload slots: see ../STORE_LISTING.md §
   "Screenshot slot map".
   ============================================================ */

const { chromium } = require("playwright");
const fs   = require("fs");
const path = require("path");

const HOST = process.env.HOST || "http://localhost:8000";
/* The web build lives at the server root of all-munkis-app/www/.
   `npm run serve` serves the app folder; www/ is the doc subdir. */
const APP  = HOST + "/www/";

const PROFILES = [
    /* Google Play — phone (REQUIRED: min 2, up to 8) */
    { label: "android-phone",        w: 412,  h: 915,  dpr: 2.5 },
    /* Google Play — 7-inch tablet (Designed for Families) */
    { label: "android-7in-tablet",   w: 600,  h: 960,  dpr: 2   },
    /* Google Play — 10-inch tablet (Designed for Families) */
    { label: "android-10in-tablet",  w: 800,  h: 1280, dpr: 2   }
];

const OUT_ROOT = path.join(__dirname, "..", "store-assets", "screenshots");

async function ensureDir(p) { await fs.promises.mkdir(p, { recursive: true }); }

/* Synthetic pointer drag via dispatched PointerEvents — the game
   uses pointer events for everything so this exercises the real
   code path (placement, achievements, etc.). */
const DRAG_HELPERS = () => {
    window.__fire = (el, type, x, y, pid) => {
        el.dispatchEvent(new PointerEvent(type, {
            pointerId: pid, pointerType: "touch", clientX: x, clientY: y,
            bubbles: true, cancelable: true, button: 0, isPrimary: true
        }));
    };
    window.__place = (charId, slotIdx, pid) => {
        const chip = document.querySelector(`#tray .tray-chip[data-char="${charId}"]`);
        const slot = document.querySelector(`.stage-slot[data-index="${slotIdx}"]`);
        if (!chip || !slot) return false;
        const c = chip.getBoundingClientRect(), s = slot.getBoundingClientRect();
        window.__fire(chip, "pointerdown", c.left + c.width / 2, c.top + c.height / 2, pid);
        window.__fire(chip, "pointermove", c.left + 20, c.top + 30, pid);
        window.__fire(chip, "pointermove", s.left + s.width / 2, s.top + s.height / 2, pid);
        window.__fire(chip, "pointerup",   s.left + s.width / 2, s.top + s.height / 2, pid);
        return true;
    };
};

async function captureProfile(browser, profile) {
    const outDir = path.join(OUT_ROOT, profile.label);
    await ensureDir(outDir);

    const ctx = await browser.newContext({
        viewport:          { width: profile.w, height: profile.h },
        deviceScaleFactor: profile.dpr,
        isMobile:          !profile.label.includes("tablet"),
        hasTouch:          true,
        userAgent:         "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120"
    });
    const page = await ctx.newPage();
    await page.addInitScript(DRAG_HELPERS);
    await page.goto(APP, { waitUntil: "networkidle" });
    /* Freeze animations so captures are stable. */
    await page.addStyleTag({ content:
        "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;}" });
    await page.waitForSelector("#tray .tray-chip");
    await page.waitForTimeout(250);

    /* ---- 01: title / fresh stage ---- */
    await page.screenshot({ path: path.join(outDir, "01-title.png") });

    /* ---- 02: full rainbow on stage ---- */
    await page.evaluate(() => {
        ["red", "orange", "yellow", "green", "blue", "purple"]
            .forEach((c, i) => window.__place(c, i, 900 + i));
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, "02-rainbow.png") });

    /* ---- 03: a Munki mid-drag (ghost + drop-target glow) ---- */
    await page.evaluate(() => {
        const slot0 = document.querySelector('.stage-slot[data-index="0"]');
        const s = slot0.getBoundingClientRect();
        window.__fire(slot0, "pointerdown", s.left + s.width / 2, s.top + s.height / 2, 700);
        window.__fire(slot0, "pointermove", s.left + s.width / 2, s.top - 60, 700);
        window.__fire(slot0, "pointermove", s.left + s.width / 2, s.top - 90, 700);
        /* leave the pointer "down" so the drag ghost is on-screen */
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, "03-drag.png") });
    /* release so state is clean for the next shot */
    await page.evaluate(() => {
        const slot0 = document.querySelector('.stage-slot[data-index="0"]');
        const s = slot0.getBoundingClientRect();
        window.__fire(slot0, "pointerup", s.left + s.width / 2, s.top - 90, 700);
    });

    /* ---- 04: achievements panel open ---- */
    await page.evaluate(() => {
        /* Seed a few unlocked achievements + reveal the counter so the
           panel has content. Mirrors the real storage schema. */
        const rec = {
            horrorTriggers: 1, madballzUnlocked: false,
            achievements: {
                solidSquad:   { unlocked_at: "2026-05-14T12:00:00.000Z", points_awarded: 1 },
                patternMaker: { unlocked_at: "2026-05-14T12:01:00.000Z", points_awarded: 2 },
                band3:        { unlocked_at: "2026-05-14T12:02:00.000Z", points_awarded: 1 },
                coldSnap:     { unlocked_at: "2026-05-14T12:03:00.000Z", points_awarded: 1 }
            },
            moonUnlocked: false, bandCount: 4, seventhWheel: "ice",
            activeBankIndex: 0, unlockedBanks: [true]
        };
        try { localStorage.setItem("all-munkis-progress-v1", JSON.stringify(rec)); } catch (_) {}
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content:
        "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;}" });
    await page.waitForSelector("#eggCounter");
    await page.waitForTimeout(200);
    await page.evaluate(() => {
        const c = document.getElementById("eggCounter");
        c.hidden = false; c.classList.add("shown"); c.click();
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, "04-achievements.png") });

    await ctx.close();
}

(async () => {
    await ensureDir(OUT_ROOT);
    const browser = await chromium.launch();
    for (const p of PROFILES) {
        console.log("[capture]", p.label, p.w + "x" + p.h, "@" + p.dpr + "x");
        try { await captureProfile(browser, p); }
        catch (e) { console.error("  ! failed:", e.message); }
    }
    await browser.close();
    console.log("\nSaved to:", OUT_ROOT);
    console.log("Drag-drop each profile folder into the matching Play");
    console.log("Console slot — map in ../STORE_LISTING.md.");
})();

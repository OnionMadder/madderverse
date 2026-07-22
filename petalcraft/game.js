/* ══════════════════════════════════════════════════════════════════
   Petalcraft — cozy flower-breeding game
   Mendelian genetics per species. Genotype hidden ("accidental
   discovery"); the player sees colors only.
   No timers, no fail states, no ads, no accounts.

   Phenotype tables + seed genotypes are the community-canonical AC:NH
   data, taken verbatim from Joey Parrish's ACNH Flower Guide source
   (scripts/phenotypes.py, GPLv3), which is itself derived from
   Aiterusawato/Aeter's data-mined tables. See DESIGN.md §10.
   Cosmos, tulip AND pansy tables below were cross-verified against that
   source on 2026-07-22 — the DESIGN.md tulip 210/212 TODO is resolved
   (both rows confirmed correct).
   ══════════════════════════════════════════════════════════════════ */

"use strict";

// ─── 1. CONSTANTS ────────────────────────────────────────────────

const SAVE_KEY = "petalcraft-save";
const SAVE_VERSION = 2;

const GRID_W = 6;
const GRID_H = 4;

// Breeding: base per-pair chance per day, with a pity ramp so no pair gets
// stuck forever. See DESIGN.md §2.4.
const BASE_BREED_CHANCE = 0.15;
const PITY_STEP = 0.05;
const PITY_CEILING = 0.90;

// Rain: fraction of days that are rainy. Rain pre-waters the whole garden
// (a gift, never a punishment). See DESIGN.md §2.3.
const RAIN_CHANCE = 0.15;

// Real-time clock. Time flows on its own; the garden grows and breeds while
// you watch OR while the tab is closed (offline catch-up on load).
// Speed = how many REAL minutes map to one in-game day. Player-tunable.
const SPEED_PRESETS = {
    cozy:    { label: "Cozy",    realMinPerDay: 15 },   // a day every 15 min
    relaxed: { label: "Relaxed", realMinPerDay: 5 },    // default
    lively:  { label: "Lively",  realMinPerDay: 1.5 },  // a day every 90s
};
const DEFAULT_SPEED = "relaxed";
// Safety bound on offline catch-up so a long absence can't spin a huge loop
// or overgrow the whole garden into an unreadable jungle.
const MAX_CATCHUP_DAYS = 40;
const MINUTES_PER_DAY = 24 * 60;

// Species definitions.
// table maps a 3-char genotype ("012" = R:0 Y:1 W:2) → color.
const SPECIES = {
    cosmos: {
        name: "Cosmos",
        genes: 3,
        seeds: { red: "200", yellow: "021", white: "001" },
        table: {
            "000": "white",  "001": "white",  "002": "white",
            "010": "yellow", "011": "yellow", "012": "white",
            "020": "yellow", "021": "yellow", "022": "yellow",
            "100": "pink",   "101": "pink",   "102": "pink",
            "110": "orange", "111": "orange", "112": "pink",
            "120": "orange", "121": "orange", "122": "orange",
            "200": "red",    "201": "red",    "202": "red",
            "210": "orange", "211": "orange", "212": "red",
            "220": "black",  "221": "black",  "222": "red",
        },
        dex: ["white", "yellow", "red", "pink", "orange", "black"],
    },
    tulips: {
        name: "Tulips",
        genes: 3,
        seeds: { red: "201", yellow: "020", white: "001" },
        table: {
            "000": "white",  "001": "white",  "002": "white",
            "010": "yellow", "011": "yellow", "012": "white",
            "020": "yellow", "021": "yellow", "022": "yellow",
            "100": "pink",   "101": "pink",   "102": "white",
            "110": "orange", "111": "yellow", "112": "yellow",
            "120": "orange", "121": "yellow", "122": "yellow",
            "200": "black",  "201": "red",    "202": "red",
            "210": "black",  "211": "red",    "212": "red",
            "220": "purple", "221": "purple", "222": "purple",
        },
        dex: ["white", "yellow", "red", "pink", "orange", "purple", "black"],
    },
    pansies: {
        name: "Pansies",
        genes: 3,
        seeds: { red: "200", yellow: "020", white: "001" },
        table: {
            "000": "white",  "001": "white",  "002": "blue",
            "010": "yellow", "011": "yellow", "012": "blue",
            "020": "yellow", "021": "yellow", "022": "yellow",
            "100": "red",    "101": "red",    "102": "blue",
            "110": "orange", "111": "orange", "112": "orange",
            "120": "yellow", "121": "yellow", "122": "yellow",
            "200": "red",    "201": "red",    "202": "purple",
            "210": "red",    "211": "red",    "212": "purple",
            "220": "orange", "221": "orange", "222": "purple",
        },
        dex: ["white", "yellow", "red", "orange", "blue", "purple"],
    },
};

// The three base colors every species is seeded with.
const SEED_COLORS = ["red", "yellow", "white"];

// Unlock schedule (DESIGN.md §4.2). cosmos is free from day 1; the others
// unlock from garden progress so the first ~15 min is one self-contained puzzle.
const UNLOCK_ORDER = ["cosmos", "tulips", "pansies"];

// Flavor text for the Bloombook. Placeholder lines — Onion to rewrite.
const FLAVOR = {
    cosmos: {
        white:  "Common as garden clouds. A sensible place to start.",
        yellow: "Sunny and slightly smug about it.",
        red:    "Loud. Fun. Not subtle.",
        pink:   "Kind of an accident, and lovelier for it.",
        orange: "The kind of orange that thinks it's a red or a yellow depending on mood.",
        black:  "Cross the right pair. Wait. Suddenly: this. Nobody quite believes it.",
    },
    tulips: {
        white:  "Sturdy. Photographs well.",
        yellow: "The one your grandma has by the mailbox.",
        red:    "Storybook red. Extremely satisfying to breed on purpose.",
        pink:   "A rarity, and it acts like it knows.",
        orange: "Bred more or less on accident. Kept on purpose.",
        purple: "Two dominants and a lot of luck.",
        black:  "Blackness in flowers is really deep-plum. This one is showing off.",
    },
    pansies: {
        white:  "Plain in the best way. A steady base to work away from.",
        yellow: "Cheerful without trying too hard.",
        red:    "Velvety, and a little dramatic about it.",
        orange: "Somewhere between a sunrise and a snack.",
        blue:   "Not really blue — but close enough to make people lean in. Comes from white, of all things.",
        purple: "Deep, regal, faintly smug. Worth the crossing.",
    },
};

const GROWTH_STAGES = ["seed", "sprout", "bud", "bloom"];

// Time-of-day segments (fraction of the in-game day).
const CLOCK_SEGMENTS = [
    { name: "night", start: 0.00, end: 0.25 },
    { name: "morning", start: 0.25, end: 0.50 },
    { name: "afternoon", start: 0.50, end: 0.75 },
    { name: "evening", start: 0.75, end: 0.85 },
    { name: "night", start: 0.85, end: 1.00 },
];

// Rotating, never-required micro-goals (DESIGN.md §4.4). Hints, not tasks.
const MICRO_GOALS = [
    "Try crossing two colors you haven't paired yet.",
    "Plant a few of the same flower side by side.",
    "Cross a red and a yellow — see what turns up.",
    "Water everything, then let a day pass.",
    "Fill one more slot in the Bloombook.",
    "Some flowers carry secrets. Breed the same color twice.",
];

// ─── 2. GENETIC ENGINE ───────────────────────────────────────────

function genotypeToAlleles(gt) {
    const out = [];
    for (const ch of gt) {
        const n = Number(ch);
        if (n === 0) out.push({ a: 0, b: 0 });
        else if (n === 2) out.push({ a: 1, b: 1 });
        else out.push({ a: 0, b: 1 });
    }
    return out;
}

function pickAllele(pair) {
    return Math.random() < 0.5 ? pair.a : pair.b;
}

/** Cross two genotype strings → a new genotype string. */
function breed(gtA, gtB) {
    const allelesA = genotypeToAlleles(gtA);
    const allelesB = genotypeToAlleles(gtB);
    const child = [];
    for (let i = 0; i < allelesA.length; i++) {
        child.push(String(pickAllele(allelesA[i]) + pickAllele(allelesB[i])));
    }
    return child.join("");
}

/** Look up the phenotype (color) for a species + genotype. */
function phenotype(species, genotype) {
    const s = SPECIES[species];
    if (!s || !s.table[genotype]) {
        console.warn("[petalcraft] no phenotype for", species, genotype);
        return "white";
    }
    return s.table[genotype];
}

/** Is `color` a hybrid (not one of the three seed colors) for this species? */
function isHybridColor(color) {
    return !SEED_COLORS.includes(color);
}

// ─── 3. STATE ────────────────────────────────────────────────────

const state = {
    version: SAVE_VERSION,
    clock: {
        // absolute in-game minutes since day 1, 00:00
        totalMinutes: 1 * MINUTES_PER_DAY + 8 * 60,   // start Day 1, 08:00
        day: 1,
        raining: false,
        lastRealMs: 0,   // wall-clock ms at last tick (drives real-time + catch-up)
    },
    grid: {
        w: GRID_W,
        h: GRID_H,
        // tiles[y*w+x] = null | { species, genotype, stage, watered, failedBreeds }
        tiles: Array(GRID_W * GRID_H).fill(null),
    },
    seedInventory: {
        cosmos:  { red: Infinity, yellow: Infinity, white: Infinity },
        tulips:  { red: Infinity, yellow: Infinity, white: Infinity },
        pansies: { red: Infinity, yellow: Infinity, white: Infinity },
    },
    unlockedSpecies: ["cosmos"],   // tulips + pansies unlock via progress
    flowerdex: { cosmos: {}, tulips: {}, pansies: {} },
    settings: {
        sound: true,
        speed: DEFAULT_SPEED,
        reducedMotion: false,
    },
    seenOnboarding: false,
    goalIndex: 0,
    ui: {
        armedSeed: null,
        bloombookOpen: false,
        bloombookTab: "cosmos",
    },
    lastSaveAt: 0,
};

// Derived helpers ------------------------------------------------------------

function dayIndexFromMinutes(m) { return Math.floor(m / MINUTES_PER_DAY); }

function inGameMinutesPerRealMs() {
    const preset = SPEED_PRESETS[state.settings.speed] || SPEED_PRESETS[DEFAULT_SPEED];
    return MINUTES_PER_DAY / (preset.realMinPerDay * 60000);
}

function dexCount(species) {
    return Object.keys(state.flowerdex[species] || {}).length;
}

function systemReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function motionOff() {
    return state.settings.reducedMotion || systemReducedMotion();
}
function applyMotionPref() {
    document.body.classList.toggle("reduce-motion", motionOff());
}

// ─── 4. GRID OPS ─────────────────────────────────────────────────

function tileAt(x, y) {
    if (x < 0 || y < 0 || x >= state.grid.w || y >= state.grid.h) return null;
    return state.grid.tiles[y * state.grid.w + x];
}
function setTile(x, y, v) {
    if (x < 0 || y < 0 || x >= state.grid.w || y >= state.grid.h) return;
    state.grid.tiles[y * state.grid.w + x] = v;
}

function neighborCoords(x, y) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= state.grid.w || ny >= state.grid.h) continue;
            out.push([nx, ny]);
        }
    }
    return out;
}

function plant(x, y, species, color) {
    const inv = state.seedInventory[species];
    if (!inv || inv[color] <= 0) return false;
    if (tileAt(x, y) !== null) return false;

    setTile(x, y, {
        species,
        genotype: SPECIES[species].seeds[color],
        stage: 0,
        watered: false,
        failedBreeds: 0,
    });
    if (inv[color] !== Infinity) inv[color] -= 1;
    return true;
}

function waterTile(x, y) {
    const t = tileAt(x, y);
    if (!t || t.watered) return false;
    t.watered = true;
    return true;
}

function waterAll() {
    let n = 0;
    for (const t of state.grid.tiles) {
        if (t && !t.watered) { t.watered = true; n++; }
    }
    return n;
}

// ─── 5. DAY ROLLOVER + BREEDING ──────────────────────────────────

/**
 * Run one in-game day's consequences: growth, breeding, dry-out, and rolling
 * the next day's weather. Does NOT touch the clock — the clock drives how many
 * of these fire (see advanceTimeTo). Returns { babies, discoveries }.
 */
function rollDay() {
    // 1. Growth: every flower not at bloom advances one stage.
    for (const t of state.grid.tiles) {
        if (t && t.stage < 3) t.stage += 1;
    }

    // 2. Breeding: unique unordered same-species neighbor pairs, one roll each.
    const newBabies = [];
    const rolledPairs = new Set();
    const order = shuffledIndices(state.grid.tiles.length);

    for (const idx of order) {
        const t = state.grid.tiles[idx];
        if (!t || t.stage < 2) continue;   // only bud + bloom can breed
        if (!t.watered) continue;
        const x = idx % state.grid.w;
        const y = Math.floor(idx / state.grid.w);

        for (const [nx, ny] of neighborCoords(x, y)) {
            const n = tileAt(nx, ny);
            if (!n || n.species !== t.species) continue;
            if (n.stage < 2) continue;
            if (!t.watered && !n.watered) continue;   // at least one watered

            const key = pairKey(idx, ny * state.grid.w + nx);
            if (rolledPairs.has(key)) continue;
            rolledPairs.add(key);

            const maxFailed = Math.max(t.failedBreeds || 0, n.failedBreeds || 0);
            const pity = Math.min(PITY_STEP * Math.max(0, maxFailed - 3), PITY_CEILING - BASE_BREED_CHANCE);
            const chance = Math.min(BASE_BREED_CHANCE + pity, PITY_CEILING);

            if (Math.random() < chance) {
                const spot = randomEmptyNeighborAround([[x, y], [nx, ny]]);
                if (spot) {
                    newBabies.push({
                        x: spot[0], y: spot[1],
                        tile: { species: t.species, genotype: breed(t.genotype, n.genotype), stage: 0, watered: false, failedBreeds: 0 },
                    });
                }
                t.failedBreeds = 0;
                n.failedBreeds = 0;
            } else {
                t.failedBreeds = (t.failedBreeds || 0) + 1;
                n.failedBreeds = (n.failedBreeds || 0) + 1;
            }
        }
    }

    // 3. Place babies (deferred so they don't participate in this day's roll).
    const discoveries = [];
    for (const { x, y, tile } of newBabies) {
        if (tileAt(x, y) !== null) continue;
        setTile(x, y, tile);
        const color = phenotype(tile.species, tile.genotype);
        if (!state.flowerdex[tile.species][color]) {
            state.flowerdex[tile.species][color] = { firstSeen: isoDate(), genotype: tile.genotype };
            discoveries.push({ species: tile.species, color, x, y });
        }
    }

    // 4. Dry-out for the new day, then roll weather (rain re-waters everything).
    for (const t of state.grid.tiles) { if (t) t.watered = false; }
    state.clock.raining = Math.random() < RAIN_CHANCE;
    if (state.clock.raining) {
        for (const t of state.grid.tiles) { if (t) t.watered = true; }
    }

    return { babies: newBabies.length, discoveries };
}

/**
 * Move the clock to `targetMinutes`, running rollDay() once per in-game
 * midnight crossed (bounded by MAX_CATCHUP_DAYS). Returns an aggregate
 * { babies, discoveries, days } across every rollover processed.
 */
function advanceTimeTo(targetMinutes) {
    const prevDayIdx = dayIndexFromMinutes(state.clock.totalMinutes);
    const newDayIdx = dayIndexFromMinutes(targetMinutes);
    state.clock.totalMinutes = targetMinutes;
    state.clock.day = newDayIdx;

    let rollovers = Math.max(0, newDayIdx - prevDayIdx);
    const capped = Math.min(rollovers, MAX_CATCHUP_DAYS);

    const agg = { babies: 0, discoveries: [], days: rollovers };
    for (let i = 0; i < capped; i++) {
        const r = rollDay();
        agg.babies += r.babies;
        agg.discoveries.push(...r.discoveries);
    }
    if (agg.discoveries.length) checkUnlocks();
    return agg;
}

function pairKey(a, b) { return a < b ? a + "-" + b : b + "-" + a; }

function shuffledIndices(n) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function randomEmptyNeighborAround(parentCoords) {
    const set = new Map();
    for (const [px, py] of parentCoords) {
        for (const [nx, ny] of neighborCoords(px, py)) {
            if (tileAt(nx, ny) === null) set.set(nx + "," + ny, [nx, ny]);
        }
    }
    const list = Array.from(set.values());
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

function isoDate() { return new Date().toISOString().slice(0, 10); }

// ─── 6. UNLOCKS ──────────────────────────────────────────────────

/** Mark a species' three seed colors as "known" (no discovery fanfare). */
function ensureSeedColorsKnown(species) {
    for (const color of SEED_COLORS) {
        if (!state.flowerdex[species][color]) {
            state.flowerdex[species][color] = { firstSeen: isoDate(), genotype: SPECIES[species].seeds[color] };
        }
    }
}

function isUnlocked(species) { return state.unlockedSpecies.includes(species); }

function unlockSpecies(species) {
    if (isUnlocked(species)) return false;
    state.unlockedSpecies.push(species);
    ensureSeedColorsKnown(species);
    return true;
}

/**
 * Re-evaluate progression gates (DESIGN.md §4.2):
 *  - tulips  unlock at the first cosmos HYBRID (any non-seed color).
 *  - pansies unlock once 5 cosmos slots are filled.
 * Returns an array of newly-unlocked species names (for UI fanfare).
 */
function checkUnlocks() {
    const newly = [];
    const cosmosColors = Object.keys(state.flowerdex.cosmos || {});
    const cosmosHybrids = cosmosColors.filter(isHybridColor).length;

    if (!isUnlocked("tulips") && cosmosHybrids >= 1 && unlockSpecies("tulips")) newly.push("tulips");
    if (!isUnlocked("pansies") && cosmosColors.length >= 5 && unlockSpecies("pansies")) newly.push("pansies");
    return newly;
}

// ─── 7. PERSISTENCE ──────────────────────────────────────────────

function serialize() {
    return {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        clock: { totalMinutes: state.clock.totalMinutes, day: state.clock.day, raining: state.clock.raining, lastRealMs: Date.now() },
        grid: {
            w: state.grid.w,
            h: state.grid.h,
            tiles: state.grid.tiles.map(t => t === null ? null : {
                s: t.species, g: t.genotype, st: t.stage, wet: t.watered ? 1 : 0, fb: t.failedBreeds || 0,
            }),
        },
        unlocked: state.unlockedSpecies.slice(),
        dex: state.flowerdex,
        settings: { ...state.settings },
        seenOnboarding: state.seenOnboarding,
        goalIndex: state.goalIndex,
    };
}

function deserialize(data) {
    if (!data || typeof data !== "object") return false;

    if (data.clock) {
        state.clock.totalMinutes = data.clock.totalMinutes ?? state.clock.totalMinutes;
        state.clock.day = data.clock.day ?? dayIndexFromMinutes(state.clock.totalMinutes);
        state.clock.raining = !!data.clock.raining;
        state.clock.lastRealMs = data.clock.lastRealMs || 0;
    }
    if (data.grid && Array.isArray(data.grid.tiles)) {
        state.grid.w = data.grid.w || GRID_W;
        state.grid.h = data.grid.h || GRID_H;
        state.grid.tiles = data.grid.tiles.map(t => t === null ? null : {
            species: t.s, genotype: t.g, stage: t.st ?? 0, watered: !!t.wet, failedBreeds: t.fb || 0,
        });
    }
    if (Array.isArray(data.unlocked)) state.unlockedSpecies = data.unlocked;
    if (data.dex && typeof data.dex === "object") {
        // Ensure all three species buckets exist (v1 saves predate pansies).
        state.flowerdex = { cosmos: {}, tulips: {}, pansies: {}, ...data.dex };
        for (const sp of UNLOCK_ORDER) if (!state.flowerdex[sp]) state.flowerdex[sp] = {};
    }
    if (data.settings && typeof data.settings === "object") {
        state.settings.sound = data.settings.sound !== false;
        state.settings.speed = SPEED_PRESETS[data.settings.speed] ? data.settings.speed : DEFAULT_SPEED;
        state.settings.reducedMotion = !!data.settings.reducedMotion;
    }
    state.seenOnboarding = !!data.seenOnboarding;
    state.goalIndex = data.goalIndex || 0;

    // Migration: v1 saves had no clock.lastRealMs and both species pre-unlocked.
    // Nothing destructive needed; missing seed-color dex entries are backfilled below.
    return true;
}

let saveTimer = 0;
function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
            state.lastSaveAt = Date.now();
        } catch (e) {
            console.warn("[petalcraft] save failed:", e);
        }
    }, 500);
}

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        return deserialize(JSON.parse(raw));
    } catch (e) {
        console.warn("[petalcraft] load failed:", e);
        return false;
    }
}

// ─── 8. AUDIO (synthesized — no asset files, works offline) ───────

let audioCtx = null;
function ensureAudio() {
    if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return null; }
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
}

function blip(ctx, freq, t0, dur, type, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
    return o;
}

function sfx(name) {
    if (!state.settings.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
        case "plip": {                       // watering — a soft droplet
            const o = blip(ctx, 880, t, 0.14, "sine", 0.12);
            o.frequency.exponentialRampToValueAtTime(420, t + 0.13);
            break;
        }
        case "plant":                        // seed in soil — muffled thock
            blip(ctx, 200, t, 0.16, "triangle", 0.16);
            break;
        case "tap":                          // UI — soft click
            blip(ctx, 520, t, 0.07, "sine", 0.07);
            break;
        case "discovery": {                  // the payoff — warm rising arpeggio
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(ctx, f, t + i * 0.10, 0.42, "sine", 0.13));
            break;
        }
        case "unlock":                       // new seeds — two-note chime
            blip(ctx, 659.25, t, 0.5, "sine", 0.12);
            blip(ctx, 987.77, t + 0.12, 0.6, "sine", 0.1);
            break;
    }
}

// ─── 9. RENDERING ────────────────────────────────────────────────

const gardenEl = document.getElementById("garden");
const gardenWrapEl = gardenEl.parentElement;
const clockDayEl = document.getElementById("clock-day");
const clockTimeEl = document.getElementById("clock-time");
const seedTrayEl = document.getElementById("seed-tray");
const trayHintEl = document.getElementById("tray-hint");
const goalEl = document.getElementById("tray-goal");
const rainEl = document.getElementById("rain");
const toastEl = document.getElementById("toast");
const bloombookEl = document.getElementById("bloombook");
const bloombookTabsEl = document.getElementById("bloombook-tabs");
const bloombookBodyEl = document.getElementById("bloombook-body");

gardenEl.style.setProperty("--gw", state.grid.w);
gardenEl.style.setProperty("--gh", state.grid.h);

function buildGrid() {
    gardenEl.innerHTML = "";
    for (let y = 0; y < state.grid.h; y++) {
        for (let x = 0; x < state.grid.w; x++) {
            const el = document.createElement("div");
            el.className = "tile";
            el.dataset.x = x;
            el.dataset.y = y;
            el.setAttribute("role", "gridcell");
            el.addEventListener("click", () => onTileClick(x, y));
            gardenEl.appendChild(el);
        }
    }
}

function renderGrid(highlights) {
    const tiles = gardenEl.children;
    for (let i = 0; i < tiles.length; i++) {
        const el = tiles[i];
        const t = state.grid.tiles[i];
        const x = i % state.grid.w;
        const y = Math.floor(i / state.grid.w);

        el.classList.toggle("watered", !!(t && t.watered));
        el.classList.toggle("plant-target", !!state.ui.armedSeed && t === null);

        const sig = t === null ? "empty"
            : t.species + ":" + t.stage + ":" + phenotype(t.species, t.genotype);
        if (el.dataset.sig !== sig) {
            el.dataset.sig = sig;
            el.innerHTML = "";
            if (t !== null) el.appendChild(makeFlowerEl(t));
        }

        if (highlights && highlights.has(x + "," + y)) {
            el.classList.remove("new-hybrid");
            void el.offsetWidth;
            el.classList.add("new-hybrid");
        }
    }
}

function makeFlowerEl(tile) {
    const wrap = document.createElement("div");
    wrap.className = "flower";
    wrap.dataset.stage = String(tile.stage);
    wrap.dataset.species = tile.species;
    const color = phenotype(tile.species, tile.genotype);
    wrap.style.setProperty("--fc", `var(--f-${color})`);

    const body = document.createElement("div");
    body.className = "fl-body";
    wrap.appendChild(body);

    // Cosmos + pansies bloom as a petalled face; tulips use a CSS cup.
    if (tile.stage === 3 && tile.species !== "tulips") {
        for (let i = 0; i < 5; i++) {
            const petal = document.createElement("div");
            petal.className = "petal";
            body.appendChild(petal);
        }
        const c = document.createElement("div");
        c.className = "center";
        body.appendChild(c);
    }

    const stageName = GROWTH_STAGES[tile.stage];
    wrap.setAttribute("aria-label", `${color} ${SPECIES[tile.species].name.toLowerCase()}, ${stageName}`);
    return wrap;
}

function renderClock() {
    clockDayEl.textContent = `Day ${state.clock.day}`;
    const seg = currentSegment();
    clockTimeEl.textContent = state.clock.raining ? "rain" : seg;

    const c = gardenWrapEl.classList;
    c.toggle("night", seg === "night");
    c.toggle("dusk", seg === "evening");
    c.toggle("rainy", state.clock.raining);

    // Rain particle layer follows weather + motion pref.
    if (rainEl) rainEl.hidden = !(state.clock.raining && !motionOff());
}

function currentSegment() {
    const frac = (state.clock.totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_DAY;
    for (const seg of CLOCK_SEGMENTS) {
        if (frac >= seg.start && frac < seg.end) return seg.name;
    }
    return "morning";
}

function renderSeedTray() {
    seedTrayEl.innerHTML = "";
    for (const species of state.unlockedSpecies) {
        for (const color of SEED_COLORS) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "seed-chip";
            const armed = state.ui.armedSeed
                && state.ui.armedSeed.species === species
                && state.ui.armedSeed.color === color;
            if (armed) chip.classList.add("armed");

            const swatch = document.createElement("span");
            swatch.className = "swatch";
            swatch.style.setProperty("--sw", `var(--f-${color})`);
            chip.appendChild(swatch);

            const label = document.createElement("span");
            label.textContent = `${color} ${speciesShort(species)}`;
            chip.appendChild(label);

            chip.addEventListener("click", () => { sfx("tap"); armSeed(species, color); });
            seedTrayEl.appendChild(chip);
        }
    }
}

function speciesShort(species) {
    if (species === "tulips") return "tulip";
    if (species === "pansies") return "pansy";
    return "cosmos";
}

function armSeed(species, color) {
    const cur = state.ui.armedSeed;
    if (cur && cur.species === species && cur.color === color) {
        state.ui.armedSeed = null;
        trayHintEl.textContent = "Tap a seed, then tap an empty tile to plant.";
    } else {
        state.ui.armedSeed = { species, color };
        trayHintEl.textContent = `${color} ${speciesShort(species)} seed armed — tap a soil tile.`;
    }
    renderSeedTray();
    renderGrid();
    dismissCoach();
}

function renderGoal() {
    if (!goalEl) return;
    goalEl.textContent = MICRO_GOALS[state.goalIndex % MICRO_GOALS.length];
}

// ─── 10. BLOOMBOOK ───────────────────────────────────────────────

function renderBloombook() {
    bloombookTabsEl.innerHTML = "";
    for (const species of state.unlockedSpecies) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "bloombook-tab";
        if (species === state.ui.bloombookTab) tab.classList.add("active");
        tab.textContent = SPECIES[species].name;
        tab.addEventListener("click", () => { sfx("tap"); state.ui.bloombookTab = species; renderBloombook(); });
        bloombookTabsEl.appendChild(tab);
    }

    // Guard: the active tab must be an unlocked species.
    if (!isUnlocked(state.ui.bloombookTab)) state.ui.bloombookTab = state.unlockedSpecies[0];

    const species = state.ui.bloombookTab;
    const spec = SPECIES[species];
    const found = state.flowerdex[species] || {};

    bloombookBodyEl.innerHTML = "";

    const note = document.createElement("p");
    note.className = "dex-note";
    const seen = spec.dex.filter(c => found[c]).length;
    note.textContent = `${seen} / ${spec.dex.length} discovered.`;
    bloombookBodyEl.appendChild(note);

    const grid = document.createElement("div");
    grid.className = "dex-grid";
    for (const color of spec.dex) {
        const filled = !!found[color];
        const slot = document.createElement("div");
        slot.className = "dex-slot " + (filled ? "filled" : "unfilled");
        slot.style.setProperty("--sw", `var(--f-${color})`);

        const sw = document.createElement("div");
        sw.className = "dex-swatch";
        slot.appendChild(sw);

        const label = document.createElement("div");
        label.className = "dex-label";
        label.textContent = filled ? color : "?";
        slot.appendChild(label);

        if (filled) {
            slot.title = `${color} ${speciesShort(species)}\n${FLAVOR[species][color] || ""}\nFirst seen: ${found[color].firstSeen}`;
            slot.addEventListener("click", () => showDexDetail(species, color));
        }
        grid.appendChild(slot);
    }
    bloombookBodyEl.appendChild(grid);

    // A place for the tapped-slot flavor line to live (kept below the grid).
    const detail = document.createElement("p");
    detail.className = "dex-detail";
    detail.id = "dex-detail";
    detail.textContent = seen === 0
        ? "Nothing here yet. Cross a few flowers and check back."
        : "Tap a discovered flower to read about it.";
    bloombookBodyEl.appendChild(detail);
}

function showDexDetail(species, color) {
    const el = document.getElementById("dex-detail");
    if (!el) return;
    const entry = state.flowerdex[species][color];
    el.innerHTML = `<strong>${color} ${speciesShort(species)}</strong> — ${FLAVOR[species][color] || ""} <span class="dex-date">First seen ${entry.firstSeen}.</span>`;
    sfx("tap");
}

function openBloombook() {
    state.ui.bloombookOpen = true;
    bloombookEl.hidden = false;
    bloombookEl.setAttribute("aria-hidden", "false");
    renderBloombook();
}
function closeBloombook() {
    state.ui.bloombookOpen = false;
    bloombookEl.hidden = true;
    bloombookEl.setAttribute("aria-hidden", "true");
}

// ─── 11. SETTINGS ────────────────────────────────────────────────

const settingsEl = document.getElementById("settings");
const settingsBodyEl = document.getElementById("settings-body");

function renderSettings() {
    settingsBodyEl.innerHTML = "";

    // Sound toggle
    settingsBodyEl.appendChild(toggleRow("Sound", state.settings.sound, (v) => {
        state.settings.sound = v; if (v) sfx("tap"); saveSoon();
    }));

    // Clock speed — segmented
    const speedRow = document.createElement("div");
    speedRow.className = "set-row";
    const speedLabel = document.createElement("div");
    speedLabel.className = "set-label";
    speedLabel.innerHTML = "Garden pace<span class=\"set-sub\">how fast days pass</span>";
    speedRow.appendChild(speedLabel);
    const seg = document.createElement("div");
    seg.className = "set-seg";
    for (const key of ["cozy", "relaxed", "lively"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "set-seg-btn" + (state.settings.speed === key ? " active" : "");
        b.textContent = SPEED_PRESETS[key].label;
        b.addEventListener("click", () => { state.settings.speed = key; sfx("tap"); saveSoon(); renderSettings(); });
        seg.appendChild(b);
    }
    speedRow.appendChild(seg);
    settingsBodyEl.appendChild(speedRow);

    // Reduced motion toggle
    settingsBodyEl.appendChild(toggleRow("Reduce motion", state.settings.reducedMotion, (v) => {
        state.settings.reducedMotion = v; applyMotionPref(); saveSoon(); renderClock();
    }));

    // Replay how-to
    const howRow = document.createElement("div");
    howRow.className = "set-row";
    const howBtn = document.createElement("button");
    howBtn.type = "button";
    howBtn.className = "set-text-btn";
    howBtn.textContent = "How to play";
    howBtn.addEventListener("click", () => { closeSettings(); startCoaching(true); });
    howRow.appendChild(howBtn);
    settingsBodyEl.appendChild(howRow);
}

function toggleRow(label, value, onChange) {
    const row = document.createElement("div");
    row.className = "set-row";
    const l = document.createElement("div");
    l.className = "set-label";
    l.textContent = label;
    row.appendChild(l);
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "set-toggle" + (value ? " on" : "");
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(value));
    sw.innerHTML = "<span class=\"knob\"></span>";
    sw.addEventListener("click", () => {
        const nv = !sw.classList.contains("on");
        sw.classList.toggle("on", nv);
        sw.setAttribute("aria-checked", String(nv));
        onChange(nv);
    });
    row.appendChild(sw);
    return row;
}

function openSettings() {
    settingsEl.hidden = false;
    settingsEl.setAttribute("aria-hidden", "false");
    renderSettings();
}
function closeSettings() {
    settingsEl.hidden = true;
    settingsEl.setAttribute("aria-hidden", "true");
}

// ─── 12. ONBOARDING COACH ────────────────────────────────────────

const coachEl = document.getElementById("coach");
const coachTextEl = document.getElementById("coach-text");
const coachNextEl = document.getElementById("coach-next");

const COACH_STEPS = [
    "Welcome. This is your garden — a grid of soil.",
    "Pick a seed from the tray at the bottom, then tap a soil tile to plant it.",
    "Tap a flower to water it (or use “Water all”). Watered flowers that bloom next to each other can cross.",
    "Days pass on their own — flowers grow and cross while you watch, or while you're away. New colors go in the Bloombook 📖.",
];
let coachStep = 0;

function startCoaching(force) {
    if (!coachEl) return;
    if (state.seenOnboarding && !force) return;
    coachStep = 0;
    coachEl.hidden = false;
    showCoachStep();
}
function showCoachStep() {
    coachTextEl.textContent = COACH_STEPS[coachStep];
    coachNextEl.textContent = coachStep >= COACH_STEPS.length - 1 ? "Start planting" : "Next";
}
function advanceCoach() {
    sfx("tap");
    coachStep += 1;
    if (coachStep >= COACH_STEPS.length) { dismissCoach(); return; }
    showCoachStep();
}
function dismissCoach() {
    if (!coachEl || coachEl.hidden) return;
    coachEl.hidden = true;
    if (!state.seenOnboarding) { state.seenOnboarding = true; saveSoon(); }
}

// ─── 13. INTERACTIONS ────────────────────────────────────────────

function onTileClick(x, y) {
    const t = tileAt(x, y);

    if (state.ui.armedSeed && t === null) {
        const { species, color } = state.ui.armedSeed;
        if (plant(x, y, species, color)) {
            state.ui.armedSeed = null;
            trayHintEl.textContent = "Nice. Water it, then give it a few days.";
            sfx("plant");
            renderSeedTray();
            renderGrid();
            saveSoon();
            dismissCoach();
        }
        return;
    }

    if (t !== null) {
        if (waterTile(x, y)) {
            spawnDroplet(gardenEl.children[y * state.grid.w + x]);
            sfx("plip");
            renderGrid();
            saveSoon();
            dismissCoach();
        }
        return;
    }

    if (!state.ui.armedSeed) {
        trayHintEl.textContent = "First pick a seed, then tap here to plant.";
    }
}

function spawnDroplet(tileEl) {
    if (!tileEl || motionOff()) return;
    const d = document.createElement("div");
    d.className = "droplet";
    tileEl.appendChild(d);
    setTimeout(() => d.remove(), 650);
}

function onWaterAll() {
    const n = waterAll();
    if (n > 0) {
        sfx("plip");
        renderGrid();
        toast(`${n} flower${n === 1 ? "" : "s"} watered.`);
        saveSoon();
    } else {
        toast("Everything is already watered.");
    }
}

// Manual "next day" — an optional fast-forward to the next morning. Time only
// ever moves forward; this is a convenience, not a skip of consequences.
function onAdvanceDay() {
    const nextMorning = (dayIndexFromMinutes(state.clock.totalMinutes) + 1) * MINUTES_PER_DAY + 8 * 60;
    const agg = advanceTimeTo(nextMorning);
    applyRolloverResult(agg, /*live*/ true);
}

/** Shared handling for rollovers (real-time, manual, and offline catch-up). */
function applyRolloverResult(agg, live) {
    const highlights = new Set(agg.discoveries.map(d => `${d.x},${d.y}`));
    rotateGoal();
    renderClock();
    renderGrid(highlights);
    renderSeedTray();
    if (state.ui.bloombookOpen) renderBloombook();

    const newlyUnlocked = agg.newlyUnlocked || [];
    if (newlyUnlocked.length) {
        const sp = SPECIES[newlyUnlocked[0]].name.toLowerCase();
        toast(`New seeds unlocked: ${sp}!`);
        sfx("unlock");
    } else if (agg.discoveries.length > 0) {
        const first = agg.discoveries[0];
        const extra = agg.discoveries.length > 1 ? ` (+${agg.discoveries.length - 1} more)` : "";
        toast(`New in the Bloombook: ${first.color} ${speciesShort(first.species)}.${extra}`);
        if (live) sfx("discovery");
    } else if (agg.babies > 0 && live) {
        toast(`${agg.babies} new sprout${agg.babies === 1 ? "" : "s"}.`);
    }
    saveSoon();
}

function rotateGoal() {
    state.goalIndex = (state.goalIndex + 1) % MICRO_GOALS.length;
    renderGoal();
}

// ─── 14. TOAST ───────────────────────────────────────────────────

let toastTimer = 0;
function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// ─── 15. REAL-TIME CLOCK LOOP ────────────────────────────────────

let lastFrameMs = 0;

function tick() {
    const now = Date.now();
    if (!lastFrameMs) lastFrameMs = now;
    const dtMs = now - lastFrameMs;
    lastFrameMs = now;

    if (dtMs > 0) {
        const beforeSeg = currentSegment();
        const beforeRain = state.clock.raining;
        const target = state.clock.totalMinutes + dtMs * inGameMinutesPerRealMs();
        const prevDayIdx = dayIndexFromMinutes(state.clock.totalMinutes);
        const newDayIdx = dayIndexFromMinutes(target);

        if (newDayIdx > prevDayIdx) {
            // One or more day rollovers happened this frame.
            const beforeUnlocks = state.unlockedSpecies.slice();
            const agg = advanceTimeTo(target);
            agg.newlyUnlocked = state.unlockedSpecies.filter(s => !beforeUnlocks.includes(s));
            applyRolloverResult(agg, /*live*/ true);
        } else {
            state.clock.totalMinutes = target;
            state.clock.day = newDayIdx;
            // Cheap: only touch the DOM when the visible segment/weather flips.
            if (currentSegment() !== beforeSeg || state.clock.raining !== beforeRain) renderClock();
        }
    }
    requestAnimationFrame(tick);
}

// ─── 16. INIT ────────────────────────────────────────────────────

function init() {
    const loaded = loadFromStorage();

    // Backfill known seed colors for whatever's already unlocked (covers new
    // games AND v1 saves that predate the pre-seeded Bloombook).
    for (const sp of state.unlockedSpecies) ensureSeedColorsKnown(sp);

    // Offline catch-up: advance the clock by however much real time elapsed
    // since the last save, running any day rollovers that occurred.
    let catchUp = null;
    if (loaded && state.clock.lastRealMs) {
        const elapsedMs = Math.max(0, Date.now() - state.clock.lastRealMs);
        if (elapsedMs > 1000) {
            const target = state.clock.totalMinutes + elapsedMs * inGameMinutesPerRealMs();
            const beforeUnlocks = state.unlockedSpecies.slice();
            catchUp = advanceTimeTo(target);
            catchUp.newlyUnlocked = state.unlockedSpecies.filter(s => !beforeUnlocks.includes(s));
        }
    }

    applyMotionPref();
    buildGrid();
    renderClock();
    renderGrid();
    renderSeedTray();
    renderGoal();

    document.getElementById("btn-water-all").addEventListener("click", onWaterAll);
    const advBtn = document.getElementById("btn-advance-day");
    if (advBtn) advBtn.addEventListener("click", onAdvanceDay);
    document.getElementById("btn-bloombook").addEventListener("click", () => { sfx("tap"); openBloombook(); });
    document.getElementById("btn-close-bloombook").addEventListener("click", () => { sfx("tap"); closeBloombook(); });
    bloombookEl.addEventListener("click", (e) => { if (e.target === bloombookEl) closeBloombook(); });

    const settingsBtn = document.getElementById("btn-settings");
    if (settingsBtn) settingsBtn.addEventListener("click", () => { sfx("tap"); openSettings(); });
    const settingsClose = document.getElementById("btn-close-settings");
    if (settingsClose) settingsClose.addEventListener("click", () => { sfx("tap"); closeSettings(); });
    if (settingsEl) settingsEl.addEventListener("click", (e) => { if (e.target === settingsEl) closeSettings(); });

    if (coachNextEl) coachNextEl.addEventListener("click", advanceCoach);
    const coachSkip = document.getElementById("coach-skip");
    if (coachSkip) coachSkip.addEventListener("click", () => { sfx("tap"); dismissCoach(); });

    // First real gesture wakes the audio context (autoplay policy).
    window.addEventListener("pointerdown", () => ensureAudio(), { once: true });

    // Show what happened while away, else greet / onboard.
    if (catchUp && (catchUp.discoveries.length || catchUp.babies || (catchUp.newlyUnlocked && catchUp.newlyUnlocked.length))) {
        applyRolloverResult(catchUp, /*live*/ false);
        const bits = [];
        if (catchUp.babies) bits.push(`${catchUp.babies} new sprout${catchUp.babies === 1 ? "" : "s"}`);
        if (catchUp.discoveries.length) bits.push(`${catchUp.discoveries.length} new in the Bloombook`);
        if (bits.length) setTimeout(() => toast(`While you were away: ${bits.join(", ")}.`), 400);
    } else if (!loaded) {
        toast("Welcome to Petalcraft.");
    }

    if (!state.seenOnboarding) startCoaching(false);

    // Start the living clock.
    lastFrameMs = 0;
    requestAnimationFrame(tick);
}

// Dev console handle — genotypes hidden from the UI, not from the developer.
window.__petalcraft = {
    state, breed, phenotype, SPECIES, SPEED_PRESETS,
    advanceDay: onAdvanceDay,
    setSpeed: (k) => { if (SPEED_PRESETS[k]) { state.settings.speed = k; saveSoon(); } },
    unlockAll: () => { ["tulips", "pansies"].forEach(unlockSpecies); renderSeedTray(); },
    reset: () => { localStorage.removeItem(SAVE_KEY); location.reload(); },
};

init();

/* ══════════════════════════════════════════════════════════════════
   Florigami — cozy flower-breeding game (renamed from "Petalcraft" 2026-07-25)
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

// The game's display name lives here (JS side) so a future rename is a
// single-line edit for everything JS-driven: the topbar header, the browser
// tab title, and any toast that names the game. The <title> tag and SEO meta
// in index.html are separate (crawlers read the static HTML) and must be
// updated there too on a rename — see the report for the exact spots.
const GAME_NAME = "Florigami";

// Storage key stays "petalcraft-*" (the pre-rename name) as invisible plumbing —
// renaming it would wipe every existing player's saved garden. Same approach as
// Pootery keeping its "crayte-*" keys after that rename.
const SAVE_KEY = "petalcraft-save";
const SAVE_VERSION = 5;

// Species renamed 2026-07-25 (roster rework). Old saves are carried forward by
// remapping these ids on load so unlocked progress + dex + crosses survive.
const RENAMED_SPECIES = { tulips: "daisies", hyacinths: "sunflowers" };

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

// ─── Unified colour-mixing genetics (finalized 2026-07-25) ───────────────
// EVERY species breeds the same way (the model prototyped on cosmos). The 3
// genes are pigment presence: R (red), Y (yellow), B (blue); a pigment shows at
// strength >= 1. Colour = which pigments are present:
//   R=red . Y=yellow . B=blue . R+Y=orange . Y+B=green . R+B=purple
//   none = white (rare) . all three = black (rare)
// Seeds are the 3 PRIMARIES; crossing two primaries deterministically yields
// their mix (red x yellow -> orange ...). White + black are the two UNIVERSAL
// rares (deep-recessive / all-pigment crosses) and the only PATTERNED tier:
// every base colour is plain watercolour, each species' rares wear that
// species' signature pattern. Species differ by silhouette + rare pattern only.
const MIX_SEEDS = { red: "200", yellow: "020", blue: "002" };
const MIX_TABLE = {
    "000": "white",  "001": "blue",   "002": "blue",
    "010": "yellow", "011": "green",  "012": "green",
    "020": "yellow", "021": "green",  "022": "green",
    "100": "red",    "101": "purple", "102": "purple",
    "110": "orange", "111": "black",  "112": "black",
    "120": "orange", "121": "black",  "122": "black",
    "200": "red",    "201": "purple", "202": "purple",
    "210": "orange", "211": "black",  "212": "black",
    "220": "orange", "221": "black",  "222": "black",
};
const MIX_DEX = ["red", "orange", "yellow", "green", "blue", "purple"];
const MIX_RARE = ["white", "black"];

function mixSpecies(name, extra) {
    return Object.assign({ name, genes: 3, seeds: MIX_SEEDS, table: MIX_TABLE, dex: MIX_DEX, rare: MIX_RARE }, extra || {});
}

// All 8 AC-named species share the genetics above; they differ only by
// silhouette (art) and their signature rare pattern (baked into the sheets).
const SPECIES = {
    cosmos:      mixSpecies("Cosmos", { sprites: { src: "assets/img/flowers/cosmos.png?a=2", frame: 256, stages: ["seed", "sprout", "bud", "bloom"] } }),
    daisies:      mixSpecies("Daisies", { sprites: { src: "assets/img/flowers/daisy.png?a=1", frame: 256, stages: ["seed", "sprout", "bud", "bloom"] } }),
    pansies:     mixSpecies("Pansies", { sprites: { src: "assets/img/flowers/pansy.png?a=1", frame: 256, stages: ["seed", "sprout", "bud", "bloom"] } }),
    sunflowers:   mixSpecies("Sunflowers"),
    lilies:      mixSpecies("Lilies"),
    mums:        mixSpecies("Mums"),
    windflowers: mixSpecies("Windflowers"),
    roses:       mixSpecies("Roses"),
};

// The three primary seed colours every species now ships (unified model).
// Prefer seedColorsFor(species) at call sites; this stays as the shared default.
const SEED_COLORS = ["red", "yellow", "blue"];

/** The seed colors a given species actually ships (keys of its seeds table). */
function seedColorsFor(species) {
    return Object.keys(SPECIES[species].seeds);
}

// Unlock schedule (DESIGN.md §4.2). cosmos is free from day 1; the others
// unlock from garden progress so the first ~15 min is one self-contained puzzle.
// Order matters: it's how locked species queue up as "coming" tabs/hints.
const UNLOCK_ORDER = ["cosmos", "daisies", "pansies", "sunflowers", "lilies", "mums", "windflowers", "roses"];

// A short, non-spoiling hint shown on each locked species' Floridex tab. Says
// the species exists and roughly why it's coming, never the exact trigger —
// discovery stays a surprise (Madderverse Promise: you just haven't found it yet).
const LOCKED_HINT = {
    daisies:      "Grow your first cosmos hybrid and these arrive.",
    pansies:     "A few more cosmos in the Floridex and these open up.",
    sunflowers:   "Keep filling the Floridex — these bloom into reach with time.",
    lilies:      "Your garden's growing. These are a little further down the path.",
    mums:        "More discoveries, and these will find their way to you.",
    windflowers: "Something breezier waits a few flowers on from here.",
    roses:       "The last and finest. Fill enough of the Floridex and they arrive.",
};

// Progression gates keyed off total discoveries across all species — a natural,
// self-paced "you've been at this a while" curve (Madderverse Promise: nothing is
// ever blocked, you just haven't found it yet). daisies + pansies keep their own
// cosmos-specific gates below; the rest ladder up on total Floridex breadth.
const TOTAL_GATES = { sunflowers: 10, lilies: 14, mums: 18, windflowers: 23, roses: 28 };

// Flavor text for the Floridex — written in Onion's voice.
// Shared, colour-mixing-themed flavour for the unified palette. Every species
// breeds identically, so the base colours share flavour; per-species overrides
// (e.g. for the signature rares) can be added to FLAVOR later. Read via flavorFor().
const SHARED_FLAVOR = {
    red:    "One of the three primaries you start with. Bold, warm, no apologies.",
    yellow: "A starting primary — cheerful and easy, and a little glad you showed up.",
    blue:   "The third primary. Cool and calm, and steadier than it lets on.",
    orange: "Red and yellow, meeting halfway — proof that mixing what you have makes something new.",
    green:  "Yellow and blue, quietly agreeing. The colour the leaves lent to the bloom.",
    purple: "Red and blue met in the middle, and got a little regal about it.",
    white:  "No pigment at all — surprisingly hard to arrive at. The blank the whole rainbow forgets it came from.",
    black:  "Every colour at once, folded down into the dark. The deepest cross there is.",
};
const FLAVOR = {};   // per-species overrides (none yet — all species use SHARED_FLAVOR)
function flavorFor(species, color) {
    return (FLAVOR[species] && FLAVOR[species][color]) || SHARED_FLAVOR[color] || "";
}

// ─── Garden ornaments ─────────────────────────────────────────────
// Cozy, gameplay-neutral keepsakes that appear in the garden scene as you
// fill the Floridex. Pure decoration — no stats, no timers, nothing to lose.
// Each unlocks from progress the player makes anyway (DESIGN.md §4.7 reward loop),
// so nobody has to grind FOR an ornament — they just turn up. `at` returns true
// once earned; `svg` is drawn inline (zero art assets). `pos` places it on the
// ground band behind the plot.
const ORNAMENTS = [
    {
        id: "mushrooms", name: "a little ring of mushrooms",
        at: (s) => totalDex() >= 4,
        pos: { left: 8, bottom: 4 }, w: 34,
        svg: `<svg viewBox="0 0 40 30"><g>
            <ellipse cx="20" cy="27" rx="16" ry="3" fill="rgba(74,63,46,0.12)"/>
            <path d="M6 18a6 5 0 0112 0z" fill="#C9695A"/><rect x="10" y="17" width="4" height="8" rx="2" fill="#F1E7CF"/>
            <circle cx="8.5" cy="15.5" r="1" fill="#F7EFDD"/><circle cx="11" cy="16.6" r="0.8" fill="#F7EFDD"/>
            <path d="M20 14a7 6 0 0114 0z" fill="#D8756A"/><rect x="25" y="13" width="4.5" height="11" rx="2.2" fill="#F1E7CF"/>
            <circle cx="23" cy="11.5" r="1.1" fill="#F7EFDD"/><circle cx="26" cy="12.8" r="0.9" fill="#F7EFDD"/>
        </g></svg>`,
    },
    {
        id: "birdbath", name: "a stone birdbath",
        at: (s) => rareCount() >= 1,
        pos: { left: 78, bottom: 3 }, w: 40,
        svg: `<svg viewBox="0 0 40 44"><g>
            <ellipse cx="20" cy="41" rx="13" ry="3" fill="rgba(74,63,46,0.12)"/>
            <rect x="17" y="20" width="6" height="20" rx="2" fill="#B8AE97"/>
            <path d="M6 18h28a14 6 0 01-28 0z" fill="#CFC6AE"/>
            <ellipse cx="20" cy="18" rx="14" ry="5" fill="#DDD5BF"/>
            <ellipse cx="20" cy="18" rx="10" ry="3.2" fill="#8FC0CE"/>
            <circle cx="30" cy="12" r="2.4" fill="#8A6FB0"/><path d="M30 12l3-1-3 2z" fill="#6E5691"/>
        </g></svg>`,
    },
    {
        id: "bench", name: "a garden bench",
        at: (s) => speciesCompleteCount() >= 1,
        pos: { left: 26, bottom: 3 }, w: 46,
        svg: `<svg viewBox="0 0 52 34"><g>
            <ellipse cx="26" cy="31" rx="20" ry="3" fill="rgba(74,63,46,0.12)"/>
            <rect x="7" y="17" width="38" height="5" rx="2" fill="#B98C64"/>
            <rect x="7" y="9" width="38" height="4" rx="2" fill="#C99A70"/>
            <rect x="9" y="22" width="4" height="9" rx="1.5" fill="#8A6947"/>
            <rect x="39" y="22" width="4" height="9" rx="1.5" fill="#8A6947"/>
            <rect x="9" y="9" width="4" height="13" rx="1.5" fill="#A57B54"/>
            <rect x="39" y="9" width="4" height="13" rx="1.5" fill="#A57B54"/>
        </g></svg>`,
    },
    {
        id: "sundial", name: "a sundial",
        at: (s) => speciesCompleteCount() >= 2,
        pos: { left: 60, bottom: 4 }, w: 34,
        svg: `<svg viewBox="0 0 36 40"><g>
            <ellipse cx="18" cy="37" rx="12" ry="3" fill="rgba(74,63,46,0.12)"/>
            <rect x="15" y="18" width="6" height="19" rx="2" fill="#B8AE97"/>
            <ellipse cx="18" cy="18" rx="12" ry="4" fill="#DDD5BF"/>
            <ellipse cx="18" cy="17" rx="9" ry="3" fill="#CFC6AE"/>
            <path d="M18 16l6-8-3 8z" fill="#8A6947"/>
        </g></svg>`,
    },
    {
        id: "lantern", name: "a paper lantern",
        at: (s) => speciesCompleteCount() >= 3,
        pos: { left: 44, bottom: 5 }, w: 26,
        svg: `<svg viewBox="0 0 24 44"><g>
            <ellipse cx="12" cy="41" rx="7" ry="2.4" fill="rgba(74,63,46,0.12)"/>
            <rect x="11" y="2" width="2" height="8" fill="#8A6947"/>
            <path d="M12 10c8 0 8 20 0 20s-8-20 0-20z" fill="#F0C070" opacity="0.92"/>
            <ellipse cx="12" cy="20" rx="7.5" ry="9" fill="none" stroke="#D89A4A" stroke-width="0.8" opacity="0.5"/>
            <rect x="8" y="30" width="8" height="10" rx="1.5" fill="#9C7A54"/>
        </g></svg>`,
    },
    {
        id: "topiary", name: "a flowering topiary",
        at: (s) => speciesCompleteCount() >= 4,
        pos: { left: 90, bottom: 3 }, w: 30,
        svg: `<svg viewBox="0 0 32 46"><g>
            <ellipse cx="16" cy="43" rx="10" ry="3" fill="rgba(74,63,46,0.12)"/>
            <rect x="14" y="24" width="4" height="17" fill="#8A6947"/>
            <circle cx="16" cy="16" r="12" fill="#7A9557"/>
            <circle cx="16" cy="13" r="9" fill="#89A566" opacity="0.6"/>
            <circle cx="11" cy="12" r="2" fill="#E89AB2"/><circle cx="20" cy="10" r="2" fill="#F1D65C"/>
            <circle cx="22" cy="18" r="2" fill="#9B7BC0"/><circle cx="10" cy="20" r="2" fill="#E9925A"/>
            <circle cx="16" cy="22" r="2" fill="#F3EEE0"/>
        </g></svg>`,
    },
];

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
    "Fill one more slot in the Floridex.",
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

/** Is `color` a hybrid (not one of a species' own seed colors)? */
function isHybridColor(species, color) {
    return !seedColorsFor(species).includes(color);
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
    // Seeds are unlimited; every species now ships the same 3 primaries
    // (red/yellow/blue) — the unified colour-mixing model.
    seedInventory: {
        cosmos:      { red: Infinity, yellow: Infinity, blue: Infinity },
        daisies:      { red: Infinity, yellow: Infinity, blue: Infinity },
        pansies:     { red: Infinity, yellow: Infinity, blue: Infinity },
        sunflowers:   { red: Infinity, yellow: Infinity, blue: Infinity },
        lilies:      { red: Infinity, yellow: Infinity, blue: Infinity },
        mums:        { red: Infinity, yellow: Infinity, blue: Infinity },
        windflowers: { red: Infinity, yellow: Infinity, blue: Infinity },
        roses:       { red: Infinity, yellow: Infinity, blue: Infinity },
    },
    unlockedSpecies: ["cosmos"],   // every other species unlocks via progress
    floridex: { cosmos: {}, daisies: {}, pansies: {}, sunflowers: {}, lilies: {}, mums: {}, windflowers: {}, roses: {} },
    seenOrnaments: [],             // ornament ids already announced (persisted)
    crosses: [],                   // capped log of observed colour crosses (persisted)
    settings: {
        sound: true,
        ambient: true,      // quiet garden ambience (wind, birds, crickets)
        speed: DEFAULT_SPEED,
        reducedMotion: false,
        scene: "auto",      // "auto" (season) | "living-sky" | a BACKDROPS id
    },
    seenOnboarding: false,
    goalIndex: 0,
    ui: {
        armedSeed: null,
        floridexOpen: false,
        floridexTab: "cosmos",     // a species id, or "__rares" for the trophy shelf
        floridexFilter: "all",     // "all" | "found" | "rare"
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
    return Object.keys(state.floridex[species] || {}).length;
}

/** Is `color` a signature "rare" flower for this species? */
function isRare(species, color) {
    const r = SPECIES[species] && SPECIES[species].rare;
    return !!(r && r.includes(color));
}

/** Total DISTINCT colors discovered across every species (dex entries). */
function totalDex() {
    let n = 0;
    for (const sp of UNLOCK_ORDER) {
        const found = state.floridex[sp] || {};
        n += SPECIES[sp].dex.filter(c => found[c]).length;
    }
    return n;
}

/** How many rare flowers the player has found (across all species). */
function rareCount() {
    let n = 0;
    for (const sp of UNLOCK_ORDER) {
        const found = state.floridex[sp] || {};
        for (const c of (SPECIES[sp].rare || [])) if (found[c]) n++;
    }
    return n;
}

/** Is every color in this species' dex discovered? */
function isSpeciesComplete(species) {
    const found = state.floridex[species] || {};
    return SPECIES[species].dex.every(c => found[c]);
}

/** Count of species whose dex is fully filled. */
function speciesCompleteCount() {
    return UNLOCK_ORDER.filter(isSpeciesComplete).length;
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

/**
 * The genotype planted for a (species, color): a seed's homozygous genotype, or
 * for a DISCOVERED colour the exact genotype first found (stored in the dex).
 * Lets players replant anything they've bred — the intentional-breeding puzzle.
 */
function plantGenotype(species, color) {
    const seeds = SPECIES[species].seeds;
    if (seeds[color]) return seeds[color];
    const entry = (state.floridex[species] || {})[color];
    return entry && entry.genotype;
}

function plant(x, y, species, color) {
    if (tileAt(x, y) !== null) return false;
    const g = plantGenotype(species, color);
    if (!g) return false;
    setTile(x, y, {
        species,
        genotype: g,
        stage: 0,
        watered: false,
        wetLevel: 0,        // transient (not saved): drives the drying droplet
        failedBreeds: 0,
    });
    return true;   // seeds + bred colours are unlimited — cozy, no scarcity
}

/** Every colour a species can currently plant = every colour discovered so far
 *  (seed colours are pre-known), in canonical dex-then-rare order. */
function plantableColorsFor(species) {
    const found = state.floridex[species] || {};
    return spriteColorsFor(species).filter(c => found[c]);
}

function waterTile(x, y) {
    const t = tileAt(x, y);
    if (!t || t.watered) return false;
    t.watered = true;
    t.wetLevel = 1;
    return true;
}

/** Move a grown flower from one tile to an empty one (free rearranging, no cost). */
function movePlant(fx, fy, tx, ty) {
    const t = tileAt(fx, fy);
    if (!t || tileAt(tx, ty) !== null) return false;
    if (fx === tx && fy === ty) return false;
    setTile(fx, fy, null);
    setTile(tx, ty, t);
    return true;
}

/** Pick (remove) a flower, freeing its tile. Cozy — no penalty, seeds are infinite. */
function removePlant(x, y) {
    if (tileAt(x, y) === null) return false;
    setTile(x, y, null);
    return true;
}

function waterAll() {
    let n = 0;
    for (const t of state.grid.tiles) {
        if (t && !t.watered) { t.watered = true; t.wetLevel = 1; n++; }
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
                        tile: { species: t.species, genotype: breed(t.genotype, n.genotype), stage: 0, watered: false, wetLevel: 0, failedBreeds: 0 },
                        // parent COLOURS (not genotypes) — for the legible cross readout
                        // + field-notes. Genotype stays hidden (accidental discovery).
                        parents: [phenotype(t.species, t.genotype), phenotype(n.species, n.genotype)],
                        parentCoords: [[x, y], [nx, ny]],
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
    const babyCoords = [];
    const crosses = [];
    for (const { x, y, tile, parents, parentCoords } of newBabies) {
        if (tileAt(x, y) !== null) continue;
        setTile(x, y, tile);
        babyCoords.push({ x, y });
        const color = phenotype(tile.species, tile.genotype);
        const isNew = !state.floridex[tile.species][color];
        if (isNew) {
            state.floridex[tile.species][color] = { firstSeen: isoDate(), genotype: tile.genotype };
            discoveries.push({ species: tile.species, color, x, y, rare: isRare(tile.species, color) });
        }
        const cross = { species: tile.species, a: parents[0], b: parents[1], child: color, x, y, parentCoords, isNew, day: state.clock.day };
        crosses.push(cross);
        recordCross(cross);
    }

    // 4. Dry-out for the new day, then roll weather (rain re-waters everything).
    for (const t of state.grid.tiles) { if (t) { t.watered = false; t.wetLevel = 0; } }
    state.clock.raining = Math.random() < RAIN_CHANCE;
    if (state.clock.raining) {
        for (const t of state.grid.tiles) { if (t) { t.watered = true; t.wetLevel = 1; } }
    }

    return { babies: newBabies.length, discoveries, babyCoords, crosses };
}

// ─── Crosses history — the field notes that make breeding legible ─────
// A capped log of "colour A × colour B → child" the player has actually
// observed. Powers the rollover readout + the "you've seen X from this pairing"
// hint. It records OUTCOMES, never genotypes — the accidental-discovery mystery
// (two same-colour flowers can carry different genes) is preserved.
const CROSS_LOG_CAP = 80;
function recordCross(c) {
    if (!Array.isArray(state.crosses)) state.crosses = [];
    state.crosses.push({ species: c.species, a: c.a, b: c.b, child: c.child, day: c.day });
    if (state.crosses.length > CROSS_LOG_CAP) state.crosses.shift();
}

/** Distinct child colours the player has observed from crossing colours a×b
 *  (order-independent) of a species. */
function crossOutcomesFor(species, a, b) {
    const seen = new Set();
    for (const c of (state.crosses || [])) {
        if (c.species !== species) continue;
        if ((c.a === a && c.b === b) || (c.a === b && c.b === a)) seen.add(c.child);
    }
    return [...seen];
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

    const agg = { babies: 0, discoveries: [], babyCoords: [], crosses: [], days: rollovers };
    for (let i = 0; i < capped; i++) {
        const r = rollDay();
        agg.babies += r.babies;
        agg.discoveries.push(...r.discoveries);
        agg.crosses.push(...r.crosses);
        // Only the LAST rollover's sprouts still exist as sprouts (earlier ones
        // grew), so keep just the final day's coords for the sparkle.
        agg.babyCoords = r.babyCoords;
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

/** Mark a species' own seed colors as "known" (no discovery fanfare). */
function ensureSeedColorsKnown(species) {
    for (const color of seedColorsFor(species)) {
        if (!state.floridex[species][color]) {
            state.floridex[species][color] = { firstSeen: isoDate(), genotype: SPECIES[species].seeds[color] };
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
 *  - daisies  unlock at the first cosmos HYBRID (any non-seed color).
 *  - pansies unlock once 5 cosmos slots are filled.
 * Returns an array of newly-unlocked species names (for UI fanfare).
 */
function checkUnlocks() {
    const newly = [];
    const cosmosColors = Object.keys(state.floridex.cosmos || {});
    const cosmosHybrids = cosmosColors.filter(c => isHybridColor("cosmos", c)).length;

    if (!isUnlocked("daisies") && cosmosHybrids >= 1 && unlockSpecies("daisies")) newly.push("daisies");
    if (!isUnlocked("pansies") && cosmosColors.length >= 5 && unlockSpecies("pansies")) newly.push("pansies");
    // The rest ladder up on total Floridex breadth — sunflowers → lilies → mums
    // → windflowers → roses — so the garden keeps opening at the player's pace.
    const total = totalDex();
    for (const sp of ["sunflowers", "lilies", "mums", "windflowers", "roses"]) {
        if (!isUnlocked(sp) && total >= TOTAL_GATES[sp] && unlockSpecies(sp)) newly.push(sp);
    }
    return newly;
}

// ─── 6b. GARDEN EXPANSION ─────────────────────────────────────────
// The plot grows as the Floridex fills (DESIGN.md §4.5) — more room to lay out
// deliberate crosses. Tiers key off totalDex(); existing flowers keep their
// (x,y) as the plot extends RIGHT (horizontal growth only — height stays 4 so
// the plot reads as a wide band that fits the landscape garden scene). Never shrinks.
const EXPANSION_TIERS = [
    { at: 0,  w: 6,  h: 4 },    // start — 24 tiles
    { at: 12, w: 8,  h: 4 },    // 32 tiles
    { at: 26, w: 9,  h: 4 },    // 36 tiles
    { at: 42, w: 10, h: 4 },    // 40 tiles — the widest (post-game sandbox)
];

function targetGridSize() {
    const n = totalDex();
    let best = EXPANSION_TIERS[0];
    for (const t of EXPANSION_TIERS) if (n >= t.at) best = t;
    return best;
}

/** Grow the grid to (nw, nh), preserving every flower's (x, y). No DOM rebuild
 *  here — callers do buildGrid() + renderGrid() after. */
function resizeGrid(nw, nh) {
    const ow = state.grid.w, oh = state.grid.h, old = state.grid.tiles;
    const tiles = new Array(nw * nh).fill(null);
    for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) tiles[y * nw + x] = old[y * ow + x];
    }
    state.grid.w = nw; state.grid.h = nh; state.grid.tiles = tiles;
    gardenEl.style.setProperty("--gw", nw);
    gardenEl.style.setProperty("--gh", nh);
}

/** Expand the plot if the player has earned a bigger tier. Returns the new
 *  {w,h} when it grew, else null. */
function checkExpansion() {
    const t = targetGridSize();
    if (t.w > state.grid.w || t.h > state.grid.h) { resizeGrid(t.w, t.h); return t; }
    return null;
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
        dex: state.floridex,
        settings: { ...state.settings },
        seenOnboarding: state.seenOnboarding,
        goalIndex: state.goalIndex,
        seenOrnaments: state.seenOrnaments.slice(),
        crosses: (state.crosses || []).slice(),
    };
}

/**
 * Bring an older save's shape up to the current schema. A no-op for v2 today,
 * but every future breaking change adds a step here — a v1 save falls through
 * every branch and lands whole. Called before deserialize().
 */
function migrateSave(data) {
    if (!data || typeof data !== "object") return data;
    let v = data.version || 1;
    // v1 → v2: pansies bucket + clock.lastRealMs were added; deserialize already
    // backfills both defensively, so nothing destructive is needed here.
    if (v < 2) { v = 2; }
    // v2 → v3: sunflowers species + seenOrnaments were added. Both are backfilled
    // defensively in deserialize (dex/inventory buckets, seenOrnaments default []),
    // so a v2 save falls through whole — no data touched.
    if (v < 3) { v = 3; }
    // v3 → v4: cosmos colour-mixing genetics + `crosses` log. deserialize defaults
    // crosses to []; old cosmos floridex colours (pink etc.) are harmless extra
    // keys, and the tray/dex read the new SPECIES tables — nothing to migrate.
    if (v < 4) { v = 4; }
    // v4 → v5: species roster rework (tulips→daisies, hyacinths→sunflowers).
    // deserialize remaps those ids in unlocked/dex/crosses, so nothing to do here.
    if (v < 5) { v = 5; }
    data.version = SAVE_VERSION;
    return data;
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
            species: t.s, genotype: t.g, stage: t.st ?? 0, watered: !!t.wet,
            wetLevel: t.wet ? 0.6 : 0,   // transient; approximate on load
            failedBreeds: t.fb || 0,
        });
    }
    // Carry renamed species forward (tulips→daisies, hyacinths→sunflowers) BEFORE
    // the known-species filter, so a player's unlocked/dex/crosses survive the rename.
    if (Array.isArray(data.unlocked)) data.unlocked = data.unlocked.map(s => RENAMED_SPECIES[s] || s);
    if (data.dex && typeof data.dex === "object") {
        for (const [o, n] of Object.entries(RENAMED_SPECIES)) {
            if (data.dex[o]) { data.dex[n] = Object.assign({}, data.dex[n], data.dex[o]); delete data.dex[o]; }
        }
    }
    if (Array.isArray(data.crosses)) data.crosses.forEach(c => { if (c && RENAMED_SPECIES[c.species]) c.species = RENAMED_SPECIES[c.species]; });

    if (Array.isArray(data.unlocked)) {
        // Keep only species we still ship (guards against a renamed/removed id).
        state.unlockedSpecies = data.unlocked.filter(s => SPECIES[s]);
        if (!state.unlockedSpecies.length) state.unlockedSpecies = ["cosmos"];
    }
    if (data.dex && typeof data.dex === "object") {
        // Ensure every species bucket exists (older saves predate pansies/sunflowers).
        state.floridex = { cosmos: {}, daisies: {}, pansies: {}, sunflowers: {}, ...data.dex };
        for (const sp of UNLOCK_ORDER) if (!state.floridex[sp]) state.floridex[sp] = {};
    }
    if (Array.isArray(data.seenOrnaments)) state.seenOrnaments = data.seenOrnaments.slice();
    state.crosses = Array.isArray(data.crosses) ? data.crosses.slice() : [];
    if (data.settings && typeof data.settings === "object") {
        state.settings.sound = data.settings.sound !== false;
        state.settings.ambient = data.settings.ambient !== false;
        state.settings.speed = SPEED_PRESETS[data.settings.speed] ? data.settings.speed : DEFAULT_SPEED;
        state.settings.reducedMotion = !!data.settings.reducedMotion;
        if (typeof data.settings.scene === "string") state.settings.scene = data.settings.scene;
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

// Set true by loadFromStorage when a save existed but couldn't be read, so
// init() can greet the player gently instead of silently wiping their garden.
let loadWasCorrupt = false;

function loadFromStorage() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.warn("[petalcraft] save is unreadable; backing it up and starting fresh:", e);
        stashCorruptSave(raw);
        loadWasCorrupt = true;
        return false;
    }
    try {
        const ok = deserialize(migrateSave(parsed));
        if (!ok) throw new Error("deserialize rejected the save shape");
        return true;
    } catch (e) {
        console.warn("[petalcraft] save couldn't be applied; backing it up and starting fresh:", e);
        stashCorruptSave(raw);
        loadWasCorrupt = true;
        return false;
    }
}

/** Keep the last broken save around (once) so nothing is silently destroyed. */
function stashCorruptSave(raw) {
    try { localStorage.setItem(SAVE_KEY + "-corrupt", raw); } catch (e) { /* quota — nothing to do */ }
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

/** Export the current save as a JSON string (for the Settings backup button). */
function exportSaveString() {
    return JSON.stringify(serialize());
}

/** Apply an imported save string. Returns true on success. */
function importSaveString(str) {
    let parsed;
    try { parsed = JSON.parse(str); } catch (e) { return false; }
    try {
        const ok = deserialize(migrateSave(parsed));
        if (!ok) return false;
        localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
        return true;
    } catch (e) {
        console.warn("[petalcraft] import failed:", e);
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
        case "rare": {                       // a rare find — grander, a bell-ring finish
            // A fuller major arpeggio, a beat slower, then a shimmering octave chord.
            [392.0, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(ctx, f, t + i * 0.11, 0.5, "sine", 0.12));
            [1046.5, 1318.5, 1568.0].forEach((f) => blip(ctx, f, t + 0.66, 1.4, "sine", 0.07));
            break;
        }
        case "unlock":                       // new seeds — two-note chime
            blip(ctx, 659.25, t, 0.5, "sine", 0.12);
            blip(ctx, 987.77, t + 0.12, 0.6, "sine", 0.1);
            break;
    }
}

// ─── 8b. AMBIENCE (synthesized, very quiet, toggleable) ──────────
// A soft wind bed (filtered noise with slow gusts) plus the odd bird by day
// and crickets by night. All generated — no audio files, works offline.

let ambient = { on: false, wind: null, chirpTimer: 0 };

function makeNoiseBuffer(ctx) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;   // brown-ish: smoother, softer than white
        d[i] = last * 3.2;
    }
    return buf;
}

function startAmbient() {
    if (!state.settings.ambient) return;
    const ctx = ensureAudio();
    if (!ctx || ambient.wind) return;

    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;

    const gain = ctx.createGain();
    gain.gain.value = 0.0;

    // Slow gusts: an LFO gently swelling the wind volume.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 0.010;
    lfo.connect(lfoGain).connect(gain.gain);

    src.connect(filter).connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.014, ctx.currentTime + 3);   // fade in
    src.start();
    lfo.start();

    ambient.wind = { src, filter, gain, lfo, lfoGain };
    ambient.on = true;
    scheduleChirp();
}

function stopAmbient() {
    ambient.on = false;
    clearTimeout(ambient.chirpTimer);
    const w = ambient.wind;
    if (!w) return;
    ambient.wind = null;
    try {
        const ctx = audioCtx;
        w.gain.gain.cancelScheduledValues(ctx.currentTime);
        w.gain.gain.setValueAtTime(w.gain.gain.value, ctx.currentTime);
        w.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
        w.src.stop(ctx.currentTime + 1.3);
        w.lfo.stop(ctx.currentTime + 1.3);
    } catch (e) { /* already stopped */ }
}

function syncAmbient() {
    if (state.settings.ambient && state.settings.sound !== false) startAmbient();
    else stopAmbient();
}

function birdChirp(ctx) {
    // Two or three quick rising notes — a small "tweet".
    const t = ctx.currentTime;
    const base = 1400 + Math.random() * 900;
    const notes = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < notes; i++) {
        const o = blip(ctx, base + i * 220, t + i * 0.09, 0.10, "sine", 0.028);
        o.frequency.exponentialRampToValueAtTime(base + i * 220 + 300, t + i * 0.09 + 0.09);
    }
}

function cricket(ctx) {
    // A soft high tremolo pulse.
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) blip(ctx, 2600, t + i * 0.07, 0.05, "triangle", 0.014);
}

function scheduleChirp() {
    clearTimeout(ambient.chirpTimer);
    if (!ambient.on) return;
    const seg = currentSegment();
    const dayish = seg === "morning" || seg === "afternoon";
    // Birds by day are sparse; crickets by night steadier but quiet.
    const delay = dayish ? 6000 + Math.random() * 12000 : 4000 + Math.random() * 6000;
    ambient.chirpTimer = setTimeout(() => {
        const ctx = audioCtx;
        if (ambient.on && ctx && state.settings.sound !== false && !motionOff()) {
            if (dayish) { if (Math.random() < 0.8) birdChirp(ctx); }
            else if (seg === "night") { if (Math.random() < 0.7) cricket(ctx); }
        }
        scheduleChirp();
    }, delay);
}

// ─── 9. RENDERING ────────────────────────────────────────────────

const gardenEl = document.getElementById("garden");
const gardenWrapEl = gardenEl.parentElement;
const clockDayEl = document.getElementById("clock-day");
const clockTimeEl = document.getElementById("clock-time");
const seedTrayEl = document.getElementById("seed-tray");
const trayHintEl = document.getElementById("tray-hint");
const goalEl = document.getElementById("tray-goal");
const breedStatusEl = document.getElementById("breed-status");
const rainEl = document.getElementById("rain");
const toastEl = document.getElementById("toast");
const floridexEl = document.getElementById("floridex");
const floridexTabsEl = document.getElementById("floridex-tabs");
const floridexBodyEl = document.getElementById("floridex-body");
const skyEl = document.getElementById("sky");
const sunEl = document.getElementById("sun");
const moonEl = document.getElementById("moon");
const starsEl = document.getElementById("stars");
const cloudsEl = document.getElementById("clouds");
const sceneVeilEl = document.getElementById("scene-veil");
const ambientFxEl = document.getElementById("ambient-fx");
const connectorsEl = document.getElementById("connectors");
const scenePhotoEl = document.getElementById("scene-photo");
const sceneDayEl = document.getElementById("scene-day");
const sceneNightEl = document.getElementById("scene-night");

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
            // Tap + drag are handled by pointer events on the garden (see
            // initGardenPointer) so a tap waters, a drag moves/picks the flower.
            gardenEl.appendChild(el);
        }
    }
}

function renderGrid(highlights, sprouts, rareHighlights) {
    const tiles = gardenEl.children;
    for (let i = 0; i < tiles.length; i++) {
        const el = tiles[i];
        const t = state.grid.tiles[i];
        const x = i % state.grid.w;
        const y = Math.floor(i / state.grid.w);

        el.classList.toggle("watered", !!(t && t.watered));
        el.classList.toggle("plant-target", !!state.ui.armedSeed && t === null);
        if (!t || !t.watered) { el.style.removeProperty("--wet"); delete el.dataset.wet; }

        const oldSig = el.dataset.sig;
        const sig = t === null ? "empty"
            : t.species + ":" + t.stage + ":" + phenotype(t.species, t.genotype);
        if (oldSig !== sig) {
            el.dataset.sig = sig;
            el.innerHTML = "";
            if (t !== null) {
                const fl = makeFlowerEl(t);
                // Ease into the change: pop a brand-new sprout, grow an existing
                // flower up into its next stage.
                if (!motionOff()) {
                    if (oldSig === "empty" || oldSig === undefined) fl.classList.add("sprout-in");
                    else fl.classList.add("grow-in");
                }
                el.appendChild(fl);
            }
        }

        if (rareHighlights && rareHighlights.has(x + "," + y)) {
            el.classList.remove("new-rare");
            void el.offsetWidth;
            el.classList.add("new-rare");
        } else if (highlights && highlights.has(x + "," + y)) {
            el.classList.remove("new-hybrid");
            void el.offsetWidth;
            el.classList.add("new-hybrid");
        } else if (sprouts && sprouts.has(x + "," + y)) {
            el.classList.remove("new-sprout");
            void el.offsetWidth;
            el.classList.add("new-sprout");
        }
    }
    updateWetVisuals();
    layoutConnectors();
    renderBreedStatus();
}

// ─── 9f2. FLOWER SPRITE SHEETS (progressive enhancement) ─────────
// Flowers render as the CSS shapes below by DEFAULT. When a species gets a
// real sprite sheet, add `sprites: { src, frame }` to its SPECIES entry and
// drop the PNG in — makeFlowerEl then draws from the sheet instead, per-frame,
// with the CSS shapes as an automatic fallback if the image is missing or slow.
//
// Sheet convention (see ASSETS.md): ONE sheet per species, a fixed grid —
//   • columns = growth stages, in this order: seed, sprout, bud, bloom, night
//   • rows    = the species' dex colors, in dex order (row 0 = first dex color)
//   • seed + sprout are colour-agnostic and are read from ROW 0 only, so the
//     artist draws them once (leave those cells blank in the other rows).
// A `night` column is optional (closed/dimmed bloom shown after dark).
const SPRITE_COLS = ["seed", "sprout", "bud", "bloom", "night"];
const spriteReady = {};   // species id -> true once its sheet <img> has loaded

// Sheet rows = dex colours first, then any rare colours not already in the dex
// (so rares like white/black cosmos get their own painted row, below the dex).
// The compositor bakes rows in this exact order.
function spriteColorsFor(species) {
    const s = SPECIES[species];
    return s.dex.concat((s.rare || []).filter(c => !s.dex.includes(c)));
}

/** Kick off loading for every species that has a sprite sheet configured. */
function initSpriteSheets() {
    for (const sp of Object.keys(SPECIES)) {
        const cfg = SPECIES[sp].sprites;
        if (!cfg || !cfg.src || spriteReady[sp]) continue;
        const img = new Image();
        img.onload = () => { spriteReady[sp] = true; rerenderGarden(); };
        img.onerror = () => console.warn("[petalcraft] flower sheet failed to load (using CSS shapes):", cfg.src);
        img.src = cfg.src;
    }
}

/** The sheet frame for a (species, color, stage), or null → use CSS shapes. */
function spriteFrameFor(species, color, stage, isNight) {
    const cfg = SPECIES[species].sprites;
    if (!cfg || !spriteReady[species]) return null;
    const cols = cfg.stages || SPRITE_COLS;
    let key = SPRITE_COLS[stage] || "bloom";              // 0..3 → seed/sprout/bud/bloom
    if (stage === 3 && isNight && cols.includes("night")) key = "night";
    const col = cols.indexOf(key);
    if (col < 0) return null;
    const shared = (key === "seed" || key === "sprout");  // seed/sprout live on row 0
    const colors = spriteColorsFor(species);
    const row = shared ? 0 : colors.indexOf(color);
    if (row < 0) return null;
    return { src: cfg.src, col, row, cols: cols.length, rows: colors.length };
}

/** Paint a sheet frame onto a responsive box using percentage background math. */
function applySprite(el, f) {
    el.style.backgroundImage = `url("${f.src}")`;
    el.style.backgroundSize = `${f.cols * 100}% ${f.rows * 100}%`;
    const px = f.cols > 1 ? (f.col / (f.cols - 1)) * 100 : 0;
    const py = f.rows > 1 ? (f.row / (f.rows - 1)) * 100 : 0;
    el.style.backgroundPosition = `${px}% ${py}%`;
}

/** Force a full grid repaint (used when a sheet finishes loading mid-game). */
function rerenderGarden() {
    for (const el of gardenEl.children) delete el.dataset.sig;
    renderGrid();
}

// ─── 9f3. PHOTO BACKDROPS + SEASONS (progressive enhancement) ─────
// The living CSS sky is the DEFAULT and the fallback. When real scene art
// exists, register it in BACKDROPS and (optionally) map seasons to it. A photo
// backdrop crossfades day→night by the clock; season is auto-picked from the
// player's real-world date, overridable in Settings. See ASSETS.md for specs.
//
//   BACKDROPS[id] = { name, day: "assets/img/backdrops/x-day.jpg",
//                     night: "…-night.jpg", celestial?: true }
//   SEASON_SCENES  = { spring: id|null, summer, autumn, winter }
const BACKDROPS = {
    garden: {
        name: "Paper garden",
        day: "assets/img/backdrops/garden-day.jpg?a=1",
        night: "assets/img/backdrops/garden-night.jpg?a=1",
        celestial: false,   // the scene is its own world — hide the CSS sun/moon/stars
    },
};
// One scene for now, shown year-round; swap in seasonal variants later.
const SEASON_SCENES = { spring: "garden", summer: "garden", autumn: "garden", winter: "garden" };

/** Real-world season (northern hemisphere) — drives the "auto" scene. */
function currentSeason() {
    const m = new Date().getMonth();     // 0=Jan … 11=Dec
    if (m === 11 || m <= 1) return "winter";
    if (m <= 4) return "spring";
    if (m <= 7) return "summer";
    return "autumn";
}

/** Which backdrop id is active right now, or null for the living CSS sky. */
function activeBackdropId() {
    const pref = state.settings.scene || "auto";
    if (pref === "living-sky") return null;
    if (pref !== "auto" && BACKDROPS[pref]) return pref;   // explicit override
    const id = SEASON_SCENES[currentSeason()];             // auto → by season
    return (id && BACKDROPS[id]) ? id : null;
}

/** Apply the active backdrop (preloads, then reveals; falls back on error). */
function applyBackdrop() {
    if (!scenePhotoEl || !gardenWrapEl) return;
    gardenWrapEl.setAttribute("data-season", currentSeason());
    const id = activeBackdropId();
    if (!id) {                                             // living sky
        gardenWrapEl.classList.remove("has-photo");
        scenePhotoEl.hidden = true;
        return;
    }
    const bd = BACKDROPS[id];
    const img = new Image();
    img.onload = () => {
        sceneDayEl.style.backgroundImage = `url("${bd.day}")`;
        sceneNightEl.style.backgroundImage = `url("${bd.night || bd.day}")`;
        scenePhotoEl.hidden = false;
        gardenWrapEl.classList.add("has-photo");
        gardenWrapEl.classList.toggle("photo-keeps-sky", bd.celestial !== false);
        updateBackdropTime();
    };
    img.onerror = () => {                                  // missing art → living sky
        gardenWrapEl.classList.remove("has-photo");
        scenePhotoEl.hidden = true;
    };
    img.src = bd.day;
}

/** Crossfade the day/night backdrop layers by time of day (0 day … 1 night). */
function updateBackdropTime() {
    if (!sceneNightEl || !scenePhotoEl || scenePhotoEl.hidden) return;
    sceneNightEl.style.opacity = skyAt(dayFraction()).star.toFixed(2);
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

    // If a real sprite sheet is loaded for this species, draw the frame and skip
    // the CSS shape entirely. Otherwise fall through to the CSS-drawn flower.
    const frame = spriteFrameFor(tile.species, color, tile.stage, currentSegment() === "night");
    if (frame) {
        wrap.classList.add("sprited");
        applySprite(body, frame);
        const sn = GROWTH_STAGES[tile.stage];
        wrap.setAttribute("aria-label", `${color} ${SPECIES[tile.species].name.toLowerCase()}, ${sn}`);
        return wrap;
    }

    // CSS fallback (used until a species has a baked sprite sheet): a generic
    // 5-petal paper face for every species. Real silhouette comes from the sheet.
    if (tile.stage === 3) {
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
    c.toggle("morning", seg === "morning");
    c.toggle("rainy", state.clock.raining);

    updateSky(true);
    updateFireflies();

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

function dayFraction() {
    return (state.clock.totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_DAY;
}

// ─── 9b. LIVING SKY ──────────────────────────────────────────────
// A continuous day→dusk→night→dawn gradient interpolated from these stops,
// plus a sun/moon that arc across and stars that fade in after dark.

const SKY_STOPS = [
    { f: 0.00, top: "#2b3055", bot: "#4a4a6b", star: 1.00 },
    { f: 0.22, top: "#4a4368", bot: "#8a6b7a", star: 0.80 },
    { f: 0.28, top: "#f0b48a", bot: "#f6d6a8", star: 0.00 },
    { f: 0.38, top: "#bfe0e6", bot: "#eaf3e0", star: 0.00 },
    { f: 0.50, top: "#b9e2ee", bot: "#e9f4df", star: 0.00 },
    { f: 0.72, top: "#cfe6e2", bot: "#f2ead2", star: 0.00 },
    { f: 0.80, top: "#f4c98a", bot: "#f7d9a0", star: 0.00 },
    { f: 0.86, top: "#d99a86", bot: "#e9b892", star: 0.18 },
    { f: 0.92, top: "#6b5a86", bot: "#a97e8e", star: 0.55 },
    { f: 1.00, top: "#2b3055", bot: "#4a4a6b", star: 1.00 },
];

function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    return `rgb(${Math.round(lerp(ca[0], cb[0], t))},${Math.round(lerp(ca[1], cb[1], t))},${Math.round(lerp(ca[2], cb[2], t))})`;
}

function skyAt(f) {
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
        const a = SKY_STOPS[i], b = SKY_STOPS[i + 1];
        if (f >= a.f && f <= b.f) {
            const t = (f - a.f) / (b.f - a.f || 1);
            return { top: lerpColor(a.top, b.top, t), bot: lerpColor(a.bot, b.bot, t), star: lerp(a.star, b.star, t) };
        }
    }
    return { top: SKY_STOPS[0].top, bot: SKY_STOPS[0].bot, star: SKY_STOPS[0].star };
}

let lastSkyF = -1;
function updateSky(force) {
    if (!skyEl) return;
    const f = dayFraction();
    if (!force && Math.abs(f - lastSkyF) < 0.002) return;   // throttle DOM writes
    lastSkyF = f;

    const sky = skyAt(f);
    skyEl.style.setProperty("--sky-top", sky.top);
    skyEl.style.setProperty("--sky-bot", sky.bot);
    if (starsEl) starsEl.style.opacity = sky.star.toFixed(2);
    if (sceneVeilEl) sceneVeilEl.style.opacity = (sky.star * 0.6).toFixed(2);

    // Sun arc: rises ~0.25, sets ~0.80. Moon takes the opposite span.
    positionCelestial(sunEl, f, 0.25, 0.80);
    positionCelestial(moonEl, f, 0.80, 1.25);   // wraps past midnight

    // A photo backdrop (if active) crossfades day→night on the same clock.
    updateBackdropTime();
}

function positionCelestial(el, f, rise, set) {
    if (!el) return;
    // Normalise f into the [rise, set] window (moon's set may exceed 1.0).
    let ff = f;
    if (set > 1 && f < rise) ff = f + 1;   // moon after midnight
    const span = set - rise;
    const p = (ff - rise) / span;          // 0 at rise, 1 at set
    if (p < 0 || p > 1) { el.style.setProperty("--vis", "0"); return; }
    const x = 0.08 + p * 0.84;             // left→right across the sky
    const y = 0.62 - Math.sin(Math.PI * p) * 0.5;   // arc up then down
    el.style.setProperty("--cx", x.toFixed(3));
    el.style.setProperty("--cy", y.toFixed(3));
    // Fade in near the horizon at both ends.
    const vis = Math.min(1, Math.sin(Math.PI * p) * 2.2);
    el.style.setProperty("--vis", Math.max(0, vis).toFixed(2));
}

// Drifting clouds — a few, seeded once. Motion-gated by CSS.
function initClouds() {
    if (!cloudsEl) return;
    cloudsEl.innerHTML = "";
    const specs = [
        { w: 96, y: 12, dur: 74, delay: -8 },
        { w: 64, y: 26, dur: 96, delay: -40 },
        { w: 120, y: 6, dur: 120, delay: -70 },
    ];
    for (const s of specs) {
        const c = document.createElement("div");
        c.className = "cloud";
        c.style.setProperty("--cw", s.w + "px");
        c.style.setProperty("--cy", s.y + "%");
        c.style.setProperty("--cdur", s.dur + "s");
        c.style.setProperty("--cdelay", s.delay + "s");
        cloudsEl.appendChild(c);
    }
}

// ─── 9c. WATER EVAPORATION VISUALS ───────────────────────────────
// wetLevel decays over the in-game day (breeding still keys off the boolean
// `watered`, so this is purely the drying-droplet look — never a punishment).
const WET_FLOOR = 0.22;
const WET_DECAY_PER_MIN = 0.75 / 720;   // ~1.0 → floor over half an in-game day

function decayWetness(inGameMinutes) {
    if (inGameMinutes <= 0) return;
    for (const t of state.grid.tiles) {
        if (t && t.watered && t.wetLevel > WET_FLOOR) {
            t.wetLevel = Math.max(WET_FLOOR, t.wetLevel - WET_DECAY_PER_MIN * inGameMinutes);
        }
    }
}

function updateWetVisuals() {
    const tiles = gardenEl.children;
    for (let i = 0; i < tiles.length; i++) {
        const t = state.grid.tiles[i];
        if (!t || !t.watered) continue;
        const v = (t.wetLevel != null ? t.wetLevel : 1).toFixed(2);
        if (tiles[i].dataset.wet !== v) {
            tiles[i].dataset.wet = v;
            tiles[i].style.setProperty("--wet", v);
        }
    }
}

// ─── 9d. "WILL BREED TONIGHT" CONNECTORS ─────────────────────────
// A soft dashed link between each adjacent same-species pair that's eligible
// to cross at the next rollover. A cozy hint about *where*, never the outcome.

const SVGNS = "http://www.w3.org/2000/svg";

function layoutConnectors() {
    if (!connectorsEl) return;
    // Match the SVG box to the garden's box within garden-wrap.
    connectorsEl.style.left = gardenEl.offsetLeft + "px";
    connectorsEl.style.top = gardenEl.offsetTop + "px";
    connectorsEl.style.width = gardenEl.clientWidth + "px";
    connectorsEl.style.height = gardenEl.clientHeight + "px";
    connectorsEl.setAttribute("viewBox", `0 0 ${gardenEl.clientWidth} ${gardenEl.clientHeight}`);
    renderConnectors();
}

function tileCenter(i) {
    const el = gardenEl.children[i];
    if (!el) return null;
    return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
}

/** A pair is eligible when both are the same species, both bud+ , at least one watered. */
function breedEligiblePairs() {
    const pairs = [];
    const seen = new Set();
    const W = state.grid.w;
    for (let i = 0; i < state.grid.tiles.length; i++) {
        const t = state.grid.tiles[i];
        if (!t || t.stage < 2) continue;
        const x = i % W, y = Math.floor(i / W);
        for (const [nx, ny] of neighborCoords(x, y)) {
            const j = ny * W + nx;
            const n = state.grid.tiles[j];
            if (!n || n.species !== t.species || n.stage < 2) continue;
            if (!t.watered && !n.watered) continue;
            const key = pairKey(i, j);
            if (seen.has(key)) continue;
            seen.add(key);
            pairs.push([i, j]);
        }
    }
    return pairs;
}

function renderConnectors() {
    if (!connectorsEl) return;
    connectorsEl.innerHTML = "";
    for (const [i, j] of breedEligiblePairs()) {
        const a = tileCenter(i), b = tileCenter(j);
        if (!a || !b) continue;
        const line = document.createElementNS(SVGNS, "line");
        line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
        line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
        line.setAttribute("class", "link");
        connectorsEl.appendChild(line);
        const heart = document.createElementNS(SVGNS, "circle");
        heart.setAttribute("cx", (a.x + b.x) / 2);
        heart.setAttribute("cy", (a.y + b.y) / 2);
        heart.setAttribute("r", 3.2);
        heart.setAttribute("class", "link-heart");
        connectorsEl.appendChild(heart);
    }
}

// ─── 9e. AMBIENT LIFE (fireflies at dusk, the odd flyer) ─────────
function updateFireflies() {
    if (!ambientFxEl) return;
    const seg = currentSegment();
    const want = (seg === "evening") && !motionOff();
    const have = ambientFxEl.querySelectorAll(".firefly").length > 0;
    if (want && !have) {
        for (let i = 0; i < 6; i++) {
            const f = document.createElement("div");
            f.className = "firefly";
            f.style.left = (10 + Math.random() * 80) + "%";
            f.style.top = (35 + Math.random() * 55) + "%";
            f.style.setProperty("--fdur", (5 + Math.random() * 5).toFixed(1) + "s");
            f.style.setProperty("--fdelay", (-Math.random() * 5).toFixed(1) + "s");
            f.style.setProperty("--fdx", (Math.random() * 30 - 15).toFixed(0) + "px");
            f.style.setProperty("--fdy", (-8 - Math.random() * 18).toFixed(0) + "px");
            ambientFxEl.appendChild(f);
        }
    } else if (!want && have) {
        ambientFxEl.querySelectorAll(".firefly").forEach(el => el.remove());
    }
}

let flyerTimer = 0;
function scheduleFlyer() {
    clearTimeout(flyerTimer);
    flyerTimer = setTimeout(() => {
        const seg = currentSegment();
        const dayish = seg === "morning" || seg === "afternoon";
        if (dayish && ambientFxEl && !motionOff() && !document.hidden) {
            const f = document.createElement("div");
            f.className = "flyer";
            f.textContent = Math.random() < 0.6 ? "🦋" : "🐦";
            f.style.top = (12 + Math.random() * 40) + "%";
            const dur = (8 + Math.random() * 6).toFixed(1);
            f.style.setProperty("--flydur", dur + "s");
            ambientFxEl.appendChild(f);
            setTimeout(() => f.remove(), parseFloat(dur) * 1000 + 200);
        }
        scheduleFlyer();
    }, 30000 + Math.random() * 45000);
}

// ─── 9f. GARDEN ORNAMENTS (progression keepsakes) ────────────────
// Ornaments live on the ground band behind the plot. Pure decoration; earned
// from progress you'd make anyway. refreshOrnaments() reconciles what's shown
// with what's earned, and (when announce=true) toasts anything newly earned.

const ornamentsEl = document.getElementById("ornaments");

function earnedOrnaments() {
    return ORNAMENTS.filter(o => { try { return o.at(state); } catch (e) { return false; } });
}

function renderOrnaments() {
    if (!ornamentsEl) return;
    ornamentsEl.innerHTML = "";
    for (const o of earnedOrnaments()) {
        const el = document.createElement("div");
        el.className = "ornament";
        el.style.left = o.pos.left + "%";
        el.style.bottom = o.pos.bottom + "%";
        el.style.setProperty("--ow", o.w + "px");
        el.innerHTML = o.svg;
        el.title = o.name;
        ornamentsEl.appendChild(el);
    }
}

/** Announce newly-earned ornaments, remember them, and (re)draw the scene. */
function refreshOrnaments(announce) {
    const earned = earnedOrnaments();
    const fresh = earned.filter(o => !state.seenOrnaments.includes(o.id));
    if (fresh.length) {
        for (const o of fresh) state.seenOrnaments.push(o.id);
        if (announce) {
            // Stagger so several completing at once don't stomp each other.
            fresh.forEach((o, i) => setTimeout(() => toast(`Your garden gained ${o.name}.`), 900 + i * 2600));
        }
        saveSoon();
    }
    renderOrnaments();
    return fresh;
}

// ─── 9g. RARE-FIND CELEBRATION ───────────────────────────────────
// A gentle full-card moment for a signature flower. Fired only for LIVE
// discoveries (a rollover you were present for) — never on offline catch-up,
// where a jarring modal on launch would be unwelcome.

const celebrateEl = document.getElementById("rare-celebrate");
let celebrateQueue = [];

function queueCelebration(disc) {
    celebrateQueue.push(disc);
    if (celebrateEl && celebrateEl.hidden) showNextCelebration();
}

function showNextCelebration() {
    if (!celebrateEl) return;
    const disc = celebrateQueue.shift();
    if (!disc) { celebrateEl.hidden = true; celebrateEl.setAttribute("aria-hidden", "true"); return; }

    const entry = (state.floridex[disc.species] || {})[disc.color] || { genotype: disc.genotype, firstSeen: isoDate() };
    const thumb = celebrateEl.querySelector(".celebrate-thumb");
    const name = celebrateEl.querySelector(".celebrate-name");
    const flavor = celebrateEl.querySelector(".celebrate-flavor");
    const sub = celebrateEl.querySelector(".celebrate-sub");
    thumb.innerHTML = "";
    if (entry.genotype) thumb.appendChild(makeFlowerEl({ species: disc.species, genotype: entry.genotype, stage: 3 }));
    name.textContent = `${disc.color} ${speciesShort(disc.species)}`;
    flavor.textContent = flavorFor(disc.species, disc.color);
    sub.textContent = celebrateQueue.length > 0
        ? `A rare find — and there's another waiting.`
        : `A rare find. One of the hardest crosses in the garden.`;

    celebrateEl.hidden = false;
    celebrateEl.setAttribute("aria-hidden", "false");
    if (!motionOff()) {
        celebrateEl.classList.remove("burst");
        void celebrateEl.offsetWidth;
        celebrateEl.classList.add("burst");
    }
}

function renderSeedTray() {
    seedTrayEl.innerHTML = "";
    for (const species of state.unlockedSpecies) {
        const seedCols = seedColorsFor(species);
        for (const color of plantableColorsFor(species)) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "seed-chip";
            // Colours you've BRED (not starting seeds) get a subtle marker so it
            // reads as "you made this, and can replant it."
            if (!seedCols.includes(color)) chip.classList.add("bred");
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

            chip.title = seedCols.includes(color)
                ? `Plant a ${color} ${speciesShort(species)}`
                : `Replant a ${color} ${speciesShort(species)} you've bred`;
            chip.addEventListener("click", () => { sfx("tap"); armSeed(species, color); });
            seedTrayEl.appendChild(chip);
        }
    }
}

// Singular label for a species id (chips, dex names, toasts). Falls back to
// trimming a trailing "s" so a newly-added species never silently reads as
// "cosmos" (the old default hid the sunflowers mislabel).
const SPECIES_SHORT = {
    cosmos: "cosmos", daisies: "daisy", pansies: "pansy", sunflowers: "sunflower",
    lilies: "lily", mums: "mum", windflowers: "windflower", roses: "rose",
};
function speciesShort(species) {
    if (SPECIES_SHORT[species]) return SPECIES_SHORT[species];
    return species && species.endsWith("s") ? species.slice(0, -1) : (species || "flower");
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

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function humanList(arr) {
    if (arr.length <= 1) return arr[0] || "";
    if (arr.length === 2) return `${arr[0]} & ${arr[1]}`;
    return `${arr.slice(0, -1).join(", ")} & ${arr[arr.length - 1]}`;
}

// Breeding clarity: how many adjacent watered pairs will attempt to cross at the
// next rollover, plus a field-note of what a colour-pairing has produced for the
// player before (observed outcomes only — genotype stays hidden).
function renderBreedStatus() {
    if (!breedStatusEl) return;
    const pairs = breedEligiblePairs();
    if (!pairs.length) { breedStatusEl.hidden = true; breedStatusEl.textContent = ""; return; }
    const infos = pairs.map(([i, j]) => {
        const a = state.grid.tiles[i], b = state.grid.tiles[j];
        return { species: a.species, ca: phenotype(a.species, a.genotype), cb: phenotype(b.species, b.genotype) };
    });
    const n = infos.length;
    let msg = `🌙 ${n} pair${n > 1 ? "s" : ""} ready to cross tonight.`;
    const hinted = infos.find(p => crossOutcomesFor(p.species, p.ca, p.cb).length);
    if (hinted) {
        const outs = crossOutcomesFor(hinted.species, hinted.ca, hinted.cb);
        msg += `  ${cap(hinted.ca)} × ${hinted.cb} has made ${humanList(outs)} before.`;
    }
    breedStatusEl.hidden = false;
    breedStatusEl.textContent = msg;
}

// ─── 10. FLORIDEX ────────────────────────────────────────────────

const RARES_TAB = "__rares";

function renderFloridex() {
    floridexTabsEl.innerHTML = "";

    // Trophy shelf tab first — the place your signature finds live.
    floridexTabsEl.appendChild(makeTab(RARES_TAB, "★ Rares",
        state.ui.floridexTab === RARES_TAB, false));

    // Unlocked species, in discovery order.
    for (const species of UNLOCK_ORDER) {
        if (!isUnlocked(species)) continue;
        floridexTabsEl.appendChild(makeTab(species, SPECIES[species].name,
            species === state.ui.floridexTab, false));
    }
    // Locked species show a muted "coming" tab — they reveal that MORE exists,
    // with a soft hint, but never how to unlock it (no spoiler).
    for (const species of UNLOCK_ORDER) {
        if (isUnlocked(species)) continue;
        floridexTabsEl.appendChild(makeTab(species, "🔒 ？", false, true));
    }

    // Guard: the active tab must be the rares shelf or an unlocked species.
    if (state.ui.floridexTab !== RARES_TAB && !isUnlocked(state.ui.floridexTab)) {
        state.ui.floridexTab = state.unlockedSpecies[0];
    }

    floridexBodyEl.innerHTML = "";
    if (state.ui.floridexTab === RARES_TAB) renderRaresShelf();
    else renderSpeciesPage(state.ui.floridexTab);
}

function makeTab(id, label, active, locked) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "floridex-tab" + (active ? " active" : "") + (locked ? " locked" : "");
    tab.textContent = label;
    if (locked) {
        tab.setAttribute("aria-label", "Locked species");
        tab.addEventListener("click", () => {
            sfx("tap");
            toast(LOCKED_HINT[id] || "Keep going — more will bloom into reach.");
        });
    } else {
        tab.addEventListener("click", () => { sfx("tap"); state.ui.floridexTab = id; renderFloridex(); });
    }
    return tab;
}

// ── Species page: filter bar + a scrollable list of flavor cards ──
function renderSpeciesPage(species) {
    const spec = SPECIES[species];
    const found = state.floridex[species] || {};
    const seen = spec.dex.filter(c => found[c]).length;

    // Progress note.
    const note = document.createElement("p");
    note.className = "dex-note";
    const complete = seen === spec.dex.length;
    note.textContent = complete
        ? `All ${spec.dex.length} discovered — this page is complete. ✿`
        : `${seen} / ${spec.dex.length} discovered.`;
    floridexBodyEl.appendChild(note);

    // Filter chips.
    const filters = document.createElement("div");
    filters.className = "dex-filters";
    for (const [key, lbl] of [["all", "All"], ["found", "Found"], ["rare", "★ Rare"]]) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "dex-filter" + (state.ui.floridexFilter === key ? " active" : "");
        chip.textContent = lbl;
        chip.addEventListener("click", () => { sfx("tap"); state.ui.floridexFilter = key; renderFloridex(); });
        filters.appendChild(chip);
    }
    floridexBodyEl.appendChild(filters);

    // Card list.
    const list = document.createElement("div");
    list.className = "dex-list";
    const filter = state.ui.floridexFilter;
    let shown = 0;
    for (const color of spec.dex) {
        const filled = !!found[color];
        const rare = isRare(species, color);
        if (filter === "found" && !filled) continue;
        if (filter === "rare" && !rare) continue;
        list.appendChild(makeDexCard(species, color, filled, rare, found[color]));
        shown++;
    }
    if (shown === 0) {
        const empty = document.createElement("p");
        empty.className = "dex-empty";
        empty.textContent = filter === "rare"
            ? "No rare finds here yet. They're the hardest crosses — keep at it."
            : "Nothing discovered on this page yet. Cross a few and check back.";
        list.appendChild(empty);
    }
    floridexBodyEl.appendChild(list);
}

function makeDexCard(species, color, filled, rare, entry) {
    const card = document.createElement("div");
    card.className = "dex-card " + (filled ? "filled" : "unfilled") + (rare ? " rare" : "");

    const thumb = document.createElement("div");
    thumb.className = "dex-thumb";
    if (filled && entry && entry.genotype) {
        thumb.appendChild(makeFlowerEl({ species, genotype: entry.genotype, stage: 3 }));
    } else {
        const q = document.createElement("div");
        q.className = "dex-thumb-q";
        q.textContent = "?";
        thumb.appendChild(q);
    }
    card.appendChild(thumb);

    const text = document.createElement("div");
    text.className = "dex-card-text";
    if (filled) {
        const h = document.createElement("div");
        h.className = "dex-card-name";
        h.innerHTML = `${color} ${speciesShort(species)}`;
        if (rare) {
            const rb = document.createElement("span");
            rb.className = "dex-ribbon";
            rb.textContent = "★ rare";
            h.appendChild(rb);
        }
        text.appendChild(h);

        const flavor = document.createElement("p");
        flavor.className = "dex-card-flavor";
        flavor.textContent = flavorFor(species, color);
        text.appendChild(flavor);

        const date = document.createElement("div");
        date.className = "dex-card-date";
        date.textContent = `First seen ${entry.firstSeen}`;
        text.appendChild(date);
    } else {
        const h = document.createElement("div");
        h.className = "dex-card-name muted";
        h.textContent = rare ? "Undiscovered — a rare one" : "Undiscovered";
        text.appendChild(h);
        const flavor = document.createElement("p");
        flavor.className = "dex-card-flavor muted";
        flavor.textContent = "Something goes here. You'll know it when it turns up.";
        text.appendChild(flavor);
    }
    card.appendChild(text);
    return card;
}

// ── Rares trophy shelf — signature finds across every unlocked species ──
function renderRaresShelf() {
    const rares = [];
    for (const species of UNLOCK_ORDER) {
        if (!isUnlocked(species)) continue;
        for (const color of (SPECIES[species].rare || [])) {
            rares.push({ species, color, entry: (state.floridex[species] || {})[color] });
        }
    }
    const foundN = rares.filter(r => r.entry).length;

    const note = document.createElement("p");
    note.className = "dex-note";
    note.textContent = rares.length === 0
        ? "The rarest flowers will be displayed here once you've unlocked more of the garden."
        : `You've found ${foundN} of ${rares.length} signature flowers.`;
    floridexBodyEl.appendChild(note);

    const intro = document.createElement("p");
    intro.className = "dex-shelf-intro";
    intro.textContent = "The hardest crosses in the garden. Each one earns a spot on the shelf.";
    floridexBodyEl.appendChild(intro);

    const shelf = document.createElement("div");
    shelf.className = "dex-shelf";
    for (const r of rares) {
        const found = !!r.entry;
        const item = document.createElement("div");
        item.className = "trophy " + (found ? "won" : "empty");

        const plinth = document.createElement("div");
        plinth.className = "trophy-plinth";
        if (found && r.entry.genotype) {
            plinth.appendChild(makeFlowerEl({ species: r.species, genotype: r.entry.genotype, stage: 3 }));
        } else {
            const q = document.createElement("div");
            q.className = "dex-thumb-q";
            q.textContent = "?";
            plinth.appendChild(q);
        }
        item.appendChild(plinth);

        const cap = document.createElement("div");
        cap.className = "trophy-cap";
        cap.textContent = found ? `${r.color} ${speciesShort(r.species)}` : "not yet";
        item.appendChild(cap);
        shelf.appendChild(item);
    }
    floridexBodyEl.appendChild(shelf);
}

function openFloridex() {
    state.ui.floridexOpen = true;
    floridexEl.hidden = false;
    floridexEl.setAttribute("aria-hidden", "false");
    renderFloridex();
}
function closeFloridex() {
    state.ui.floridexOpen = false;
    floridexEl.hidden = true;
    floridexEl.setAttribute("aria-hidden", "true");
}

// ─── 11. SETTINGS ────────────────────────────────────────────────

const settingsEl = document.getElementById("settings");
const settingsBodyEl = document.getElementById("settings-body");

function renderSettings() {
    settingsBodyEl.innerHTML = "";

    // Sound toggle (SFX — plips, chimes, discovery jingle)
    settingsBodyEl.appendChild(toggleRow("Sound effects", state.settings.sound, (v) => {
        state.settings.sound = v; if (v) sfx("tap"); syncAmbient(); saveSoon();
    }));

    // Ambient toggle (the quiet garden bed — wind, birds, crickets)
    settingsBodyEl.appendChild(toggleRow("Garden ambience", state.settings.ambient, (v) => {
        state.settings.ambient = v; syncAmbient(); if (v) sfx("tap"); saveSoon();
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

    // Scene picker — only shown once real backdrop art has been registered.
    // Options: Auto (follows the real-world season), Living sky (the CSS default),
    // and one entry per registered backdrop.
    if (Object.keys(BACKDROPS).length) {
        const row = document.createElement("div");
        row.className = "set-row";
        const lab = document.createElement("div");
        lab.className = "set-label";
        lab.innerHTML = "Scene<span class=\"set-sub\">garden backdrop</span>";
        row.appendChild(lab);
        const sel = document.createElement("select");
        sel.className = "set-select";
        const opts = [["auto", "Auto (season)"], ["living-sky", "Living sky"]]
            .concat(Object.keys(BACKDROPS).map(id => [id, BACKDROPS[id].name || id]));
        for (const [val, label] of opts) {
            const o = document.createElement("option");
            o.value = val; o.textContent = label;
            if (state.settings.scene === val) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener("change", () => {
            state.settings.scene = sel.value; sfx("tap"); applyBackdrop(); saveSoon();
        });
        row.appendChild(sel);
        settingsBodyEl.appendChild(row);
    }

    // Back up / restore the garden (a plain JSON file — nothing leaves the device)
    const dataRow = document.createElement("div");
    dataRow.className = "set-row";
    const dataWrap = document.createElement("div");
    dataWrap.style.width = "100%";
    const dataBtns = document.createElement("div");
    dataBtns.className = "set-data-row";

    const backupBtn = document.createElement("button");
    backupBtn.type = "button";
    backupBtn.className = "set-text-btn";
    backupBtn.textContent = "Back up garden";
    backupBtn.addEventListener("click", () => { sfx("tap"); downloadSave(); });
    dataBtns.appendChild(backupBtn);

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "set-text-btn";
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", () => { sfx("tap"); saveImportInput.click(); });
    dataBtns.appendChild(restoreBtn);

    dataWrap.appendChild(dataBtns);
    const note = document.createElement("p");
    note.className = "set-note";
    note.textContent = "Saves a file to your device. Nothing is uploaded.";
    dataWrap.appendChild(note);
    dataRow.appendChild(dataWrap);
    settingsBodyEl.appendChild(dataRow);

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

// Save file download + restore (a hidden <input type=file> lives in JS so no
// HTML change is needed). Purely local: the file is generated on-device.
const saveImportInput = document.createElement("input");
saveImportInput.type = "file";
saveImportInput.accept = "application/json,.json";
saveImportInput.style.display = "none";
document.body.appendChild(saveImportInput);
saveImportInput.addEventListener("change", () => {
    const file = saveImportInput.files && saveImportInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        if (importSaveString(String(reader.result))) {
            toast("Garden restored.");
            location.reload();
        } else {
            toast("That file didn't look like a Florigami save.");
        }
    };
    reader.readAsText(file);
    saveImportInput.value = "";
});

function downloadSave() {
    try {
        const blob = new Blob([exportSaveString()], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `florigami-garden-${isoDate()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("Garden backed up.");
    } catch (e) {
        toast("Couldn't back up the garden here.");
    }
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
    "Days pass on their own — flowers grow and cross while you watch, or while you're away. New colors go in the Floridex 📖.",
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

// One-time nudge so players discover they can rearrange/pick flowers.
function maybeMoveHint() {
    try {
        if (localStorage.getItem("florigami-move-hint")) return;
        localStorage.setItem("florigami-move-hint", "1");
    } catch (_) { /* private mode — just show it */ }
    setTimeout(() => toast("Tip: once it grows, drag a flower to move it — or drop it on the compost to pick it.", 4800), 1600);
}

function onTileTap(x, y) {
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
            maybeMoveHint();
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

// ─── DRAG: move a flower to empty soil, or to the compost to pick it ─────
// A press that doesn't move is a TAP (waters, or plants an armed seed). A press
// that moves picks the flower up: drop it on empty soil to MOVE it, or on the
// compost pile to PICK (remove) it and free the tile. All free — cozy.
const DRAG_THRESHOLD = 8;
let gdrag = null, compostEl = null, dragGhostEl = null;

function tileFromPoint(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    const tile = el && el.closest ? el.closest(".tile") : null;
    if (!tile || !gardenEl.contains(tile)) return null;
    return { x: +tile.dataset.x, y: +tile.dataset.y, el: tile };
}

function initGardenPointer() {
    compostEl = document.getElementById("compost");
    gardenEl.addEventListener("pointerdown", onGardenDown);
    gardenEl.addEventListener("pointermove", onGardenMove);
    gardenEl.addEventListener("pointerup", onGardenUp);
    gardenEl.addEventListener("pointercancel", () => { if (gdrag && gdrag.moved) endDrag(); gdrag = null; });
}

function onGardenDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const hit = tileFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    gdrag = { fromX: hit.x, fromY: hit.y, tile: tileAt(hit.x, hit.y), sx: e.clientX, sy: e.clientY, moved: false };
    try { gardenEl.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
}

function onGardenMove(e) {
    if (!gdrag) return;
    if (!gdrag.moved) {
        if (Math.hypot(e.clientX - gdrag.sx, e.clientY - gdrag.sy) < DRAG_THRESHOLD) return;
        if (!gdrag.tile) { gdrag = null; return; }   // dragging from empty soil → nothing
        beginDrag(gdrag);
    }
    e.preventDefault();
    if (dragGhostEl) { dragGhostEl.style.left = e.clientX + "px"; dragGhostEl.style.top = e.clientY + "px"; }
    const t = tileFromPoint(e.clientX, e.clientY);
    for (const el of gardenEl.children) el.classList.remove("drop-hover");
    if (t && tileAt(t.x, t.y) === null) t.el.classList.add("drop-hover");
    if (compostEl) compostEl.classList.toggle("hot", overCompost(e.clientX, e.clientY));
}

function onGardenUp(e) {
    if (!gdrag) return;
    const d = gdrag; gdrag = null;
    if (!d.moved) { onTileTap(d.fromX, d.fromY); return; }
    const onCompost = overCompost(e.clientX, e.clientY);
    const target = tileFromPoint(e.clientX, e.clientY);
    endDrag();
    if (onCompost && removePlant(d.fromX, d.fromY)) {
        sfx("plant"); toast("Picked — that tile's free again."); renderGrid(); saveSoon();
    } else if (target && movePlant(d.fromX, d.fromY, target.x, target.y)) {
        sfx("plant"); renderGrid(); saveSoon();
    } else {
        renderGrid();   // snap back
    }
}

function overCompost(cx, cy) {
    if (!compostEl || !compostEl.classList.contains("show")) return false;
    const r = compostEl.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
}

function beginDrag(d) {
    d.moved = true;
    document.body.classList.add("dragging-flower");
    const originEl = gardenEl.children[d.fromY * state.grid.w + d.fromX];
    if (originEl) originEl.classList.add("lifted");
    dragGhostEl = document.createElement("div");
    dragGhostEl.className = "drag-ghost";
    dragGhostEl.appendChild(makeFlowerEl(d.tile));
    document.body.appendChild(dragGhostEl);
    for (let i = 0; i < gardenEl.children.length; i++) {
        if (state.grid.tiles[i] === null) gardenEl.children[i].classList.add("droppable");
    }
    if (compostEl) compostEl.classList.add("show");
    dismissCoach();
}

function endDrag() {
    document.body.classList.remove("dragging-flower");
    if (dragGhostEl) { dragGhostEl.remove(); dragGhostEl = null; }
    if (compostEl) compostEl.classList.remove("show", "hot");
    for (const el of gardenEl.children) el.classList.remove("lifted", "droppable", "drop-hover");
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
    const rares = agg.discoveries.filter(d => d.rare);
    const rareHi = new Set(rares.map(d => `${d.x},${d.y}`));
    const hybridHi = new Set(agg.discoveries.filter(d => !d.rare).map(d => `${d.x},${d.y}`));
    const sprouts = new Set((agg.babyCoords || [])
        .map(b => `${b.x},${b.y}`)
        .filter(k => !hybridHi.has(k) && !rareHi.has(k)));
    // Expand the plot first (if earned) so this frame paints the bigger grid;
    // coords in the highlight sets stay valid (same x,y in a larger grid).
    const expanded = checkExpansion();
    if (expanded) buildGrid();
    rotateGoal();
    renderClock();
    renderGrid(hybridHi, sprouts, rareHi);
    renderSeedTray();
    refreshOrnaments(live);
    if (state.ui.floridexOpen) renderFloridex();

    const newlyUnlocked = agg.newlyUnlocked || [];
    const crosses = (agg.crosses || []).filter(c => !isRare(c.species, c.child)); // rares get their own moment
    if (newlyUnlocked.length) {
        const sp = SPECIES[newlyUnlocked[0]].name.toLowerCase();
        toast(`New seeds unlocked: ${sp}!`);
        sfx("unlock");
    } else if (crosses.length) {
        // Legible causality — name what crossed into what. Lead with a NEW
        // discovery if there was one this rollover, else the first cross.
        const c = crosses.find(x => x.isNew) || crosses[0];
        const extra = crosses.length > 1 ? ` (+${crosses.length - 1} more)` : "";
        const tag = c.isNew ? " — new in the Floridex!" : "";
        toast(`${cap(c.a)} × ${c.b} ${speciesShort(c.species)} → ${c.child}${tag}${extra}`, 4300);
        if (live) sfx(c.isNew ? "discovery" : "plant");
    } else if (agg.discoveries.length > 0 && !rares.length) {
        const first = agg.discoveries[0];
        const extra = agg.discoveries.length > 1 ? ` (+${agg.discoveries.length - 1} more)` : "";
        toast(`New in the Floridex: ${first.color} ${speciesShort(first.species)}.${extra}`);
        if (live) sfx("discovery");
    }

    // Garden growth celebration (after the discovery/unlock toasts above).
    if (expanded && live) {
        setTimeout(() => {
            sfx("unlock");
            toast(`Your garden grew — ${expanded.w}×${expanded.h} tiles now. More room to plant.`, 4200);
            if (!motionOff()) { gardenEl.classList.remove("just-grew"); void gardenEl.offsetWidth; gardenEl.classList.add("just-grew"); }
        }, newlyUnlocked.length || agg.discoveries.length ? 1300 : 200);
    }

    // Rare finds get their own moment — a grander jingle + a keepsake card —
    // independent of any unlock/discovery toast above. Live sessions only; the
    // offline case is summarized by init's "while you were away" line instead.
    if (rares.length && live) {
        sfx("rare");
        const first = rares[0];
        const more = rares.length > 1 ? ` (+${rares.length - 1} more rare!)` : "";
        toast(`A rare bloom: ${first.color} ${speciesShort(first.species)}!${more}`, 5000);
        rares.forEach(queueCelebration);
    }
    saveSoon();
}

function rotateGoal() {
    state.goalIndex = (state.goalIndex + 1) % MICRO_GOALS.length;
    renderGoal();
}

// ─── 14. TOAST ───────────────────────────────────────────────────

let toastTimer = 0, toastHideTimer = 0;
function toast(msg, ms = 3400) {
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    toastEl.textContent = msg;
    toastEl.classList.remove("leaving");
    toastEl.hidden = false;
    toastTimer = setTimeout(() => {
        toastEl.classList.add("leaving");          // fade out
        toastHideTimer = setTimeout(() => { toastEl.hidden = true; toastEl.classList.remove("leaving"); }, 340);
    }, ms);
}

// ─── 15. REAL-TIME CLOCK LOOP ────────────────────────────────────

let lastFrameMs = 0;
let wetVisualAccum = 0;

function tick() {
    const now = Date.now();
    if (!lastFrameMs) lastFrameMs = now;
    const dtMs = now - lastFrameMs;
    lastFrameMs = now;

    if (dtMs > 0) {
        const beforeSeg = currentSegment();
        const beforeRain = state.clock.raining;
        const dtInGameMin = dtMs * inGameMinutesPerRealMs();
        const target = state.clock.totalMinutes + dtInGameMin;
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
            // Continuous sky is self-throttled (only writes on a visible change).
            updateSky(false);
            // Water dries out gradually through the day.
            decayWetness(dtInGameMin);
            wetVisualAccum += dtMs;
            if (wetVisualAccum > 400) { wetVisualAccum = 0; updateWetVisuals(); }
            // Segment / weather flips still get the full clock re-render.
            if (currentSegment() !== beforeSeg || state.clock.raining !== beforeRain) renderClock();
        }
    }
    requestAnimationFrame(tick);
}

// ─── 16. INIT ────────────────────────────────────────────────────

function init() {
    const loaded = loadFromStorage();

    // Backfill known seed colors for whatever's already unlocked (covers new
    // games AND v1 saves that predate the pre-seeded Floridex).
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

    // Single source of truth for the display name (JS side) — see GAME_NAME.
    document.title = GAME_NAME;
    const titleEl = document.querySelector(".topbar-title");
    if (titleEl) titleEl.textContent = GAME_NAME;

    applyMotionPref();
    checkExpansion();     // a loaded save that already earned a bigger plot starts at it (silent)
    buildGrid();
    initGardenPointer();  // tap = water/plant · drag = move/pick a flower
    initClouds();
    initSpriteSheets();   // no-op until a species has a sprite sheet configured
    applyBackdrop();      // living CSS sky until a photo backdrop is registered
    renderClock();
    renderGrid();
    renderSeedTray();
    renderGoal();
    // Seed + draw ornaments already earned (silent — no toast flood on first
    // load or on upgrade for a player who'd already completed a species).
    refreshOrnaments(false);

    // Tile offsets aren't reliable until first layout — re-place the connector
    // overlay once the grid has actually painted, and whenever the box resizes.
    requestAnimationFrame(() => layoutConnectors());
    window.addEventListener("resize", () => layoutConnectors());
    scheduleFlyer();

    document.getElementById("btn-water-all").addEventListener("click", onWaterAll);
    const advBtn = document.getElementById("btn-advance-day");
    if (advBtn) advBtn.addEventListener("click", onAdvanceDay);
    document.getElementById("btn-floridex").addEventListener("click", () => { sfx("tap"); openFloridex(); });
    document.getElementById("btn-close-floridex").addEventListener("click", () => { sfx("tap"); closeFloridex(); });
    floridexEl.addEventListener("click", (e) => { if (e.target === floridexEl) closeFloridex(); });

    const settingsBtn = document.getElementById("btn-settings");
    if (settingsBtn) settingsBtn.addEventListener("click", () => { sfx("tap"); openSettings(); });
    const settingsClose = document.getElementById("btn-close-settings");
    if (settingsClose) settingsClose.addEventListener("click", () => { sfx("tap"); closeSettings(); });
    if (settingsEl) settingsEl.addEventListener("click", (e) => { if (e.target === settingsEl) closeSettings(); });

    if (coachNextEl) coachNextEl.addEventListener("click", advanceCoach);
    const coachSkip = document.getElementById("coach-skip");
    if (coachSkip) coachSkip.addEventListener("click", () => { sfx("tap"); dismissCoach(); });

    // Rare-find celebration card: the button (and a backdrop tap) advances to
    // the next queued rare, or closes when the queue is empty.
    const celebrateBtn = document.getElementById("celebrate-close");
    if (celebrateBtn) celebrateBtn.addEventListener("click", () => { sfx("tap"); showNextCelebration(); });
    if (celebrateEl) celebrateEl.addEventListener("click", (e) => { if (e.target === celebrateEl) showNextCelebration(); });

    // First real gesture wakes the audio context (autoplay policy) and, if the
    // player wants it, starts the quiet garden ambience.
    window.addEventListener("pointerdown", () => { ensureAudio(); syncAmbient(); }, { once: true });

    // A save existed but couldn't be read — say so kindly rather than silently wiping.
    if (loadWasCorrupt) {
        setTimeout(() => toast("Your garden had a hiccup, so we started a fresh one. (The old save was kept, just in case.)", 5200), 300);
    }

    // Show what happened while away, else greet / onboard.
    if (catchUp && (catchUp.discoveries.length || catchUp.babies || (catchUp.newlyUnlocked && catchUp.newlyUnlocked.length))) {
        applyRolloverResult(catchUp, /*live*/ false);
        const bits = [];
        if (catchUp.babies) bits.push(`${catchUp.babies} new sprout${catchUp.babies === 1 ? "" : "s"}`);
        if (catchUp.discoveries.length) bits.push(`${catchUp.discoveries.length} new in the Floridex`);
        const awayRares = catchUp.discoveries.filter(d => d.rare).length;
        if (awayRares) bits.push(`${awayRares} rare${awayRares === 1 ? "" : "s"} ✨`);
        if (bits.length) setTimeout(() => toast(`While you were away: ${bits.join(", ")}.`, awayRares ? 5200 : 3400), 400);
    } else if (!loaded) {
        toast(`Welcome to ${GAME_NAME}.`);
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
    unlockAll: () => { UNLOCK_ORDER.forEach(unlockSpecies); renderSeedTray(); renderOrnaments(); },
    isRare, totalDex, rareCount, speciesCompleteCount, refreshOrnaments,
    reset: () => { localStorage.removeItem(SAVE_KEY); location.reload(); },

    // ── Asset-pipeline test rigs (dev only) — prove the sprite + backdrop
    //    plumbing works before real art exists, using generated placeholders. ──

    /** Generate a placeholder sheet for one species (or all) + wire it in. */
    mockSprites: (species) => {
        const list = species ? [species] : Object.keys(SPECIES);
        for (const sp of list) {
            const dex = SPECIES[sp].dex, F = 128;
            const cv = document.createElement("canvas");
            cv.width = SPRITE_COLS.length * F; cv.height = dex.length * F;
            const g = cv.getContext("2d");
            for (let r = 0; r < dex.length; r++) {
                for (let c = 0; c < SPRITE_COLS.length; c++) {
                    const cs = getComputedStyle(document.documentElement).getPropertyValue(`--f-${dex[r]}`).trim() || "#ccc";
                    const cx = c * F + F / 2, cy = r * F + F / 2;
                    const rad = [10, 22, 34, 52, 46][c];        // seed→night grows
                    g.fillStyle = cs; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill();
                    g.fillStyle = "rgba(0,0,0,.25)"; g.font = "18px sans-serif"; g.textAlign = "center";
                    g.fillText(SPRITE_COLS[c][0].toUpperCase(), cx, r * F + 20);
                }
            }
            SPECIES[sp].sprites = { src: cv.toDataURL(), frame: F };
            spriteReady[sp] = true;
        }
        rerenderGarden();
        return `mock sprites on: ${list.join(", ")}`;
    },
    /** Register a generated gradient backdrop + a season map, to test the layer. */
    mockBackdrop: () => {
        const grad = (a, b) => {
            const cv = document.createElement("canvas"); cv.width = 8; cv.height = 256;
            const g = cv.getContext("2d"); const lg = g.createLinearGradient(0, 0, 0, 256);
            lg.addColorStop(0, a); lg.addColorStop(1, b); g.fillStyle = lg; g.fillRect(0, 0, 8, 256);
            return cv.toDataURL();
        };
        BACKDROPS.testmeadow = { name: "Test meadow", day: grad("#bfe3ef", "#dfeecb"), night: grad("#20223e", "#3a3a5a") };
        SEASON_SCENES.spring = SEASON_SCENES.summer = SEASON_SCENES.autumn = SEASON_SCENES.winter = "testmeadow";
        state.settings.scene = "auto"; applyBackdrop();
        return "mock backdrop registered (scene=auto)";
    },
    applyBackdrop, currentSeason,
};

init();

/* ══════════════════════════════════════════════════════════════════
   Petalcraft — Phase 1 MVP
   A cozy flower-breeding game. Mendelian genetics per species.
   Genotype hidden ("accidental discovery"); the player sees colors only.
   No timers, no fail states, no ads, no accounts.
   ══════════════════════════════════════════════════════════════════ */

"use strict";

// ─── 1. CONSTANTS ────────────────────────────────────────────────

const SAVE_KEY = "petalcraft-save";
const SAVE_VERSION = 1;

const GRID_W = 6;
const GRID_H = 4;

// Breeding: base per-pair chance per day, with a pity ramp so no pair gets
// stuck forever. See DESIGN.md §2.4.
const BASE_BREED_CHANCE = 0.15;
const PITY_STEP = 0.05;
const PITY_CEILING = 0.90;

// Real-time clock: 1 real-life hour = 1 in-game day by default.
// Player-tunable in a later phase; hard-coded for MVP.
const REAL_MINUTES_PER_INGAME_DAY = 60;

// Species definitions.
// PHENOTYPE_TABLE maps 3-char genotype string ("012" = R:0 Y:1 W:2) → color.
// Sourced from the community-canonical AC:NH tables (Joey Parrish, ACNH Wiki,
// Aiterusawato). See DESIGN.md §10 for attribution. TODO: cross-verify
// tulip 212/210 rows against Aiterusawato once the simulator page is reachable.
const SPECIES = {
    cosmos: {
        name: "Cosmos",
        genes: 3,
        seeds: {
            red:    "200",
            yellow: "021",   // seed-bag yellow is heterozygous W — hidden gene surprise
            white:  "001",   // seed-bag white also carries hidden W
        },
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
        // Slots shown in the Bloombook, in display order.
        dex: ["white", "yellow", "red", "pink", "orange", "black"],
    },
    tulips: {
        name: "Tulips",
        genes: 3,
        seeds: {
            red:    "201",   // seed-bag red is heterozygous W — that's why red×red throws black
            yellow: "020",
            white:  "001",
        },
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
};

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
};

const GROWTH_STAGES = ["seed", "sprout", "bud", "bloom"];
// Days to advance from stage N → N+1. Total 4 days seed→bloom (matches AC).
const STAGE_DAYS = [1, 1, 1, /* bloom stays */ 0];

// Time-of-day segments (fraction of the in-game day).
const CLOCK_SEGMENTS = [
    { name: "morning", start: 0.25, end: 0.50 },
    { name: "afternoon", start: 0.50, end: 0.75 },
    { name: "evening", start: 0.75, end: 0.85 },
    { name: "night", start: 0.85, end: 1.00 },
    { name: "night", start: 0.00, end: 0.25 },
];

// ─── 2. GENETIC ENGINE ───────────────────────────────────────────

/**
 * Given a 3-char genotype string, return its "allele pairs" as an array
 * of {a, b} where a/b ∈ {0, 1}. Strength 0 = 00, 1 = 01, 2 = 11.
 */
function genotypeToAlleles(gt) {
    const out = [];
    for (const ch of gt) {
        const n = Number(ch);
        // Convention: 0 → [0,0], 1 → [0,1] (only one carrier variant), 2 → [1,1].
        if (n === 0) out.push({ a: 0, b: 0 });
        else if (n === 2) out.push({ a: 1, b: 1 });
        else out.push({ a: 0, b: 1 });
    }
    return out;
}

/**
 * Given one gene as an allele pair, return one random allele.
 */
function pickAllele(pair) {
    return Math.random() < 0.5 ? pair.a : pair.b;
}

/**
 * Cross two genotype strings. Returns a new genotype string.
 * Each gene: one allele from parent A, one from parent B, uniform random.
 */
function breed(gtA, gtB) {
    const allelesA = genotypeToAlleles(gtA);
    const allelesB = genotypeToAlleles(gtB);
    const child = [];
    for (let i = 0; i < allelesA.length; i++) {
        const fromA = pickAllele(allelesA[i]);
        const fromB = pickAllele(allelesB[i]);
        // Aggregate to strength 0/1/2.
        child.push(String(fromA + fromB));
    }
    return child.join("");
}

/**
 * Look up the phenotype (color) for a species + genotype.
 */
function phenotype(species, genotype) {
    const s = SPECIES[species];
    if (!s || !s.table[genotype]) {
        console.warn("[petalcraft] no phenotype for", species, genotype);
        return "white";
    }
    return s.table[genotype];
}

// ─── 3. STATE ────────────────────────────────────────────────────

const state = {
    version: SAVE_VERSION,
    clock: {
        // in-game minutes since day 1, 00:00
        totalMinutes: 6 * 60,   // start at 06:00 morning
        day: 1,
    },
    grid: {
        w: GRID_W,
        h: GRID_H,
        // tiles[y * w + x] = null | { species, genotype, stage, watered, failedBreeds }
        tiles: Array(GRID_W * GRID_H).fill(null),
    },
    seedInventory: {
        cosmos: { red: Infinity, yellow: Infinity, white: Infinity },
        tulips: { red: Infinity, yellow: Infinity, white: Infinity },
    },
    unlockedSpecies: ["cosmos", "tulips"],   // MVP: both unlocked from day 1
    flowerdex: {
        cosmos: {},
        tulips: {},
    },
    ui: {
        armedSeed: null,   // { species, color } or null
        bloombookOpen: false,
        bloombookTab: "cosmos",
    },
    lastSaveAt: 0,
};

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
    // Seeds are infinite in MVP but decrement anyway for future clamping.
    if (inv[color] !== Infinity) inv[color] -= 1;
    return true;
}

function waterTile(x, y) {
    const t = tileAt(x, y);
    if (!t) return false;
    if (t.watered) return false;
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

function advanceDay() {
    state.clock.day += 1;
    // Snap real clock to next morning
    state.clock.totalMinutes = (state.clock.day - 1) * 24 * 60 + 6 * 60;

    // 1. Growth: every flower not at bloom advances one stage.
    for (const t of state.grid.tiles) {
        if (t && t.stage < 3) t.stage += 1;
    }

    // 2. Breeding: for each watered flower at bud+ stage, look for a
    //    same-species watered neighbor, roll, and produce a child.
    //    We iterate over unique unordered pairs so each pair only rolls once
    //    per day. Order the tiles randomly so no positional bias.
    const newBabies = [];    // { x, y, tile, parents: [[x,y],[x,y]] }
    const rolledPairs = new Set();

    const order = shuffledIndices(state.grid.tiles.length);
    for (const idx of order) {
        const t = state.grid.tiles[idx];
        if (!t || t.stage < 2) continue;    // only bud + bloom can breed
        if (!t.watered) continue;
        const x = idx % state.grid.w;
        const y = Math.floor(idx / state.grid.w);

        for (const [nx, ny] of neighborCoords(x, y)) {
            const n = tileAt(nx, ny);
            if (!n || n.species !== t.species) continue;
            if (n.stage < 2) continue;
            // At least one parent must be watered (soft rule; see DESIGN §2.2).
            if (!t.watered && !n.watered) continue;

            const key = pairKey(idx, ny * state.grid.w + nx);
            if (rolledPairs.has(key)) continue;
            rolledPairs.add(key);

            // Both parents share the failedBreeds counter for pity purposes.
            const maxFailed = Math.max(t.failedBreeds || 0, n.failedBreeds || 0);
            const pity = Math.min(PITY_STEP * Math.max(0, maxFailed - 3), PITY_CEILING - BASE_BREED_CHANCE);
            const chance = Math.min(BASE_BREED_CHANCE + pity, PITY_CEILING);

            if (Math.random() < chance) {
                const emptySpot = randomEmptyNeighborAround([[x, y], [nx, ny]]);
                if (emptySpot) {
                    const childGenotype = breed(t.genotype, n.genotype);
                    const child = {
                        species: t.species,
                        genotype: childGenotype,
                        stage: 0,
                        watered: false,
                        failedBreeds: 0,
                    };
                    newBabies.push({ x: emptySpot[0], y: emptySpot[1], tile: child });
                    t.failedBreeds = 0;
                    n.failedBreeds = 0;
                } else {
                    // No room — pair "succeeded" but had nowhere to go. Reset counter to avoid over-pity.
                    t.failedBreeds = 0;
                    n.failedBreeds = 0;
                }
            } else {
                t.failedBreeds = (t.failedBreeds || 0) + 1;
                n.failedBreeds = (n.failedBreeds || 0) + 1;
            }
        }
    }

    // 3. Place babies (deferred so they don't participate in this day's roll).
    const discoveries = [];
    for (const { x, y, tile } of newBabies) {
        if (tileAt(x, y) !== null) continue;   // baby's spot got taken by another baby
        setTile(x, y, tile);
        // Check for new dex entry — record the phenotype the baby WILL show once bloomed.
        const color = phenotype(tile.species, tile.genotype);
        if (!state.flowerdex[tile.species][color]) {
            state.flowerdex[tile.species][color] = {
                firstSeen: isoDate(),
                genotype: tile.genotype,   // remembered but hidden from UI
            };
            discoveries.push({ species: tile.species, color, x, y });
        }
    }

    // 4. Dry-out: reset all water flags for the new day.
    for (const t of state.grid.tiles) {
        if (t) t.watered = false;
    }

    return { babies: newBabies.length, discoveries };
}

function pairKey(a, b) {
    return a < b ? a + "-" + b : b + "-" + a;
}

function shuffledIndices(n) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Given a list of parent coords, return one uniformly-random empty tile
 * that is 8-adjacent to at least one parent. Returns null if none exists.
 */
function randomEmptyNeighborAround(parentCoords) {
    const candidateSet = new Map();   // key "x,y" → [x, y]
    for (const [px, py] of parentCoords) {
        for (const [nx, ny] of neighborCoords(px, py)) {
            if (tileAt(nx, ny) === null) {
                candidateSet.set(nx + "," + ny, [nx, ny]);
            }
        }
    }
    const list = Array.from(candidateSet.values());
    if (list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
}

function isoDate() {
    return new Date().toISOString().slice(0, 10);
}

// ─── 6. PERSISTENCE ──────────────────────────────────────────────

function serialize() {
    return {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        clock: { ...state.clock },
        grid: {
            w: state.grid.w,
            h: state.grid.h,
            tiles: state.grid.tiles.map(t => t === null ? null : {
                s: t.species,
                g: t.genotype,
                st: t.stage,
                wet: t.watered ? 1 : 0,
                fb: t.failedBreeds || 0,
            }),
        },
        unlocked: state.unlockedSpecies.slice(),
        dex: state.flowerdex,
    };
}

function deserialize(data) {
    if (!data || typeof data !== "object") return false;
    // Migration hook — no-op for v1 but reserved.
    if (data.version !== SAVE_VERSION) {
        console.warn("[petalcraft] save version mismatch:", data.version, "→", SAVE_VERSION);
    }
    if (data.clock) {
        state.clock.totalMinutes = data.clock.totalMinutes ?? state.clock.totalMinutes;
        state.clock.day = data.clock.day ?? state.clock.day;
    }
    if (data.grid && Array.isArray(data.grid.tiles)) {
        state.grid.w = data.grid.w || GRID_W;
        state.grid.h = data.grid.h || GRID_H;
        state.grid.tiles = data.grid.tiles.map(t => t === null ? null : {
            species: t.s,
            genotype: t.g,
            stage: t.st ?? 0,
            watered: !!t.wet,
            failedBreeds: t.fb || 0,
        });
    }
    if (Array.isArray(data.unlocked)) state.unlockedSpecies = data.unlocked;
    if (data.dex && typeof data.dex === "object") state.flowerdex = data.dex;
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

// ─── 7. RENDERING ────────────────────────────────────────────────

const gardenEl = document.getElementById("garden");
const gardenWrapEl = gardenEl.parentElement;
const clockDayEl = document.getElementById("clock-day");
const clockTimeEl = document.getElementById("clock-time");
const seedTrayEl = document.getElementById("seed-tray");
const trayHintEl = document.getElementById("tray-hint");
const toastEl = document.getElementById("toast");
const bloombookEl = document.getElementById("bloombook");
const bloombookTabsEl = document.getElementById("bloombook-tabs");
const bloombookBodyEl = document.getElementById("bloombook-body");

// Set the CSS variables so the grid CSS knows the dimensions.
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
    // Full re-render but efficient enough for a 24-tile MVP.
    const tiles = gardenEl.children;
    for (let i = 0; i < tiles.length; i++) {
        const el = tiles[i];
        const t = state.grid.tiles[i];
        const x = i % state.grid.w;
        const y = Math.floor(i / state.grid.w);

        el.classList.toggle("watered", !!(t && t.watered));
        el.classList.toggle("plant-target", !!state.ui.armedSeed && t === null);

        // Only update flower DOM if state changed (cheap heuristic: compare a signature).
        const sig = t === null
            ? "empty"
            : t.species + ":" + t.stage + ":" + phenotype(t.species, t.genotype);
        if (el.dataset.sig !== sig) {
            el.dataset.sig = sig;
            el.innerHTML = "";
            if (t !== null) {
                el.appendChild(makeFlowerEl(t));
            }
        }

        // Sparkle highlight for a freshly-discovered hybrid
        if (highlights && highlights.has(x + "," + y)) {
            el.classList.remove("new-hybrid");   // restart animation
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

    if (tile.stage === 3 && tile.species !== "tulips") {
        // 5 petals + center for cosmos-style discs
        for (let i = 0; i < 5; i++) {
            const petal = document.createElement("div");
            petal.className = "petal";
            body.appendChild(petal);
        }
        const c = document.createElement("div");
        c.className = "center";
        body.appendChild(c);
    }

    // A11y label
    const stageName = GROWTH_STAGES[tile.stage];
    wrap.setAttribute("aria-label", `${color} ${SPECIES[tile.species].name.toLowerCase()}, ${stageName}`);
    return wrap;
}

function renderClock() {
    clockDayEl.textContent = `Day ${state.clock.day}`;
    clockTimeEl.textContent = currentSegment();

    const wrapClass = gardenWrapEl.classList;
    const seg = currentSegment();
    wrapClass.toggle("night", seg === "night");
    wrapClass.toggle("dusk", seg === "evening");
}

function currentSegment() {
    const frac = (state.clock.totalMinutes % (24 * 60)) / (24 * 60);
    for (const seg of CLOCK_SEGMENTS) {
        if (frac >= seg.start && frac < seg.end) return seg.name;
    }
    return "morning";
}

function renderSeedTray() {
    seedTrayEl.innerHTML = "";
    for (const species of state.unlockedSpecies) {
        // Show only seed colors the player "owns" (all 3 base colors from day 1 in MVP)
        for (const color of ["red", "yellow", "white"]) {
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
            const speciesShort = species === "cosmos" ? "cosmos" : "tulip";
            label.textContent = `${color} ${speciesShort}`;
            chip.appendChild(label);

            chip.addEventListener("click", () => armSeed(species, color));
            seedTrayEl.appendChild(chip);
        }
    }
}

function armSeed(species, color) {
    if (state.ui.armedSeed
        && state.ui.armedSeed.species === species
        && state.ui.armedSeed.color === color) {
        state.ui.armedSeed = null;
        trayHintEl.textContent = "Tap a seed, then tap an empty tile to plant.";
    } else {
        state.ui.armedSeed = { species, color };
        trayHintEl.textContent = `${color} ${species === "tulips" ? "tulip" : "cosmos"} seed armed — tap a soil tile.`;
    }
    renderSeedTray();
    renderGrid();
}

// ─── 8. BLOOMBOOK ────────────────────────────────────────────────

function renderBloombook() {
    // Tabs
    bloombookTabsEl.innerHTML = "";
    for (const species of state.unlockedSpecies) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "bloombook-tab";
        if (species === state.ui.bloombookTab) tab.classList.add("active");
        tab.textContent = SPECIES[species].name;
        tab.addEventListener("click", () => {
            state.ui.bloombookTab = species;
            renderBloombook();
        });
        bloombookTabsEl.appendChild(tab);
    }

    // Body: colors for current species
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
            slot.title = `${color} ${species}\n${FLAVOR[species][color] || ""}\nFirst seen: ${found[color].firstSeen}`;
        }
        grid.appendChild(slot);
    }
    bloombookBodyEl.appendChild(grid);
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

// ─── 9. INTERACTIONS ─────────────────────────────────────────────

function onTileClick(x, y) {
    const t = tileAt(x, y);

    if (state.ui.armedSeed && t === null) {
        const { species, color } = state.ui.armedSeed;
        if (plant(x, y, species, color)) {
            state.ui.armedSeed = null;
            trayHintEl.textContent = "Nice. Water it, then wait a few days.";
            renderSeedTray();
            renderGrid();
            saveSoon();
        }
        return;
    }

    if (t !== null) {
        if (waterTile(x, y)) {
            renderGrid();
            saveSoon();
        }
        // Tapping a watered flower is a no-op (see DESIGN §2.2)
        return;
    }

    // Empty tile, no seed armed — remind them what to do
    if (!state.ui.armedSeed) {
        trayHintEl.textContent = "First pick a seed, then tap here to plant.";
    }
}

function onWaterAll() {
    const n = waterAll();
    if (n > 0) {
        renderGrid();
        toast(`${n} flower${n === 1 ? "" : "s"} watered.`);
        saveSoon();
    } else {
        toast("Everything is already watered.");
    }
}

function onAdvanceDay() {
    const result = advanceDay();
    // Prepare discovery highlights
    const highlights = new Set(result.discoveries.map(d => `${d.x},${d.y}`));
    renderClock();
    renderGrid(highlights);
    renderSeedTray();

    if (result.discoveries.length > 0) {
        const first = result.discoveries[0];
        const label = `New in the Bloombook: ${first.color} ${first.species === "tulips" ? "tulip" : "cosmos"}.`;
        toast(label);
    } else if (result.babies > 0) {
        toast(`${result.babies} new sprout${result.babies === 1 ? "" : "s"}.`);
    } else {
        // Quiet on empty days — cozy design principle: no nagging
    }
    saveSoon();
}

// ─── 10. TOAST ───────────────────────────────────────────────────

let toastTimer = 0;
function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// ─── 11. INIT ────────────────────────────────────────────────────

function init() {
    const loaded = loadFromStorage();
    buildGrid();
    renderClock();
    renderGrid();
    renderSeedTray();

    document.getElementById("btn-water-all").addEventListener("click", onWaterAll);
    document.getElementById("btn-advance-day").addEventListener("click", onAdvanceDay);
    document.getElementById("btn-bloombook").addEventListener("click", openBloombook);
    document.getElementById("btn-close-bloombook").addEventListener("click", closeBloombook);
    bloombookEl.addEventListener("click", (e) => {
        if (e.target === bloombookEl) closeBloombook();
    });

    if (!loaded) {
        toast("Welcome to Petalcraft.");
    }
}

// Expose a bit of state for the dev console — genotypes hidden from UI, not from the developer.
window.__petalcraft = {
    state,
    breed,
    phenotype,
    SPECIES,
    advanceDay: onAdvanceDay,
    reset: () => {
        localStorage.removeItem(SAVE_KEY);
        location.reload();
    },
};

init();

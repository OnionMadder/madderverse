// ════════════════════════════════════════════════════════════════════
//  environment.js — Giggle Gears | Environment System
//    1. SKY LAYER    — image-based objects drifting across top 1/3
//                      self-animating via CSS, zero per-frame JS cost
//    2. SCENE LAYER  — image-based cameos anchored to BG-relative spots
//                      fade-in / hold / fade-out, no movement
//    3. SPECIAL LAYER — rare cross-sky events (birds, shooting stars)
//                       injected into sky layer with their own motion class
// ════════════════════════════════════════════════════════════════════

import { BASE_URL, gameState, raceVars, skySpriteName, TRACK_DURATION_MS } from './state.js';
import { spriteHTML } from './sprites.js';

const SKY_BASE   = BASE_URL + 'bg-sky/';   // legacy PNG path (specials only)
const SCENE_BASE = BASE_URL + 'bg-scene/';

// ─── Time-of-day mapping ──────────────────────────────────────────────
const TRACK_TIMEOFDAY = {
    city:       'night',
    desert:     'day',
    space:      'night',
    icy:        'day',
    rainforest: 'day',
    tamil:      'night',
    block:      'day',
    candy:      'day',
};

// ─── Sky object pools ─────────────────────────────────────────────────
// Entries with `sprite: true` come from the bg-sky sprite sheet. Specials
// (birds, shooting-star) are not on the sheet and stay as plain PNGs.
const SKY_POOLS = {
    day: [
        { file: 'sun.png',         motionClass: 'sky-drift-slow', topMin: 4,  topMax: 14, weight: 1, unique: true,  sprite: true },
        { file: 'cloud-one.png',   motionClass: 'sky-drift-mid',  topMin: 6,  topMax: 28, weight: 4, unique: false, sprite: true },
        { file: 'cloud-two.png',   motionClass: 'sky-drift-mid',  topMin: 8,  topMax: 30, weight: 4, unique: false, sprite: true },
        { file: 'cloud-three.png', motionClass: 'sky-drift-fast', topMin: 10, topMax: 32, weight: 3, unique: false, sprite: true },
    ],
    night: [
        // moon → planet-one, comet-one → comet-two (the bg-sky sheet doesn't
        // include moon or comet-one, so we use the closest available frames).
        { file: 'planet-one.png', motionClass: 'sky-drift-slow', topMin: 4,  topMax: 14, weight: 1, unique: true,  sprite: true },
        { file: 'star-one.png',   motionClass: 'sky-drift-slow', topMin: 4,  topMax: 30, weight: 5, unique: false, sprite: true },
        { file: 'star-two.png',   motionClass: 'sky-drift-slow', topMin: 6,  topMax: 28, weight: 5, unique: false, sprite: true },
        { file: 'comet-two.png',  motionClass: 'sky-shoot',      topMin: 4,  topMax: 20, weight: 2, unique: false, sprite: true },
    ],
};

// Special pool — rare, any track regardless of time-of-day. Not on the sheet.
const SKY_SPECIAL = [
    { file: 'bird-one.png',      motionClass: 'sky-drift-fast', topMin: 10, topMax: 30, weight: 1, sprite: false },
    { file: 'bird-two.png',      motionClass: 'sky-drift-mid',  topMin: 12, topMax: 30, weight: 1, sprite: false },
    { file: 'shooting-star.png', motionClass: 'sky-shoot-fast', topMin: 4,  topMax: 18, weight: 1, sprite: false },
];

// ─── Scene (midground cameo) config ──────────────────────────────────
const SCENE_CONFIG = {
    city: {
        spawnInterval: 380,
        anchors: [
            { left: 15, bottom: 22, files: ['city-scene-one.png', 'city-scene-two.png'],           holdMs: 2800 },
            { left: 50, bottom: 30, files: ['city-scene-three.png'],                               holdMs: 2200 },
            { left: 80, bottom: 18, files: ['city-scene-three.png', 'city-scene-ghost.png'],       holdMs: 3000 },
        ],
    },
    desert: {
        spawnInterval: 500,
        anchors: [
            { left: 20, bottom: 25, files: ['desert-scene-one.png'],                              holdMs: 2400 },
            { left: 55, bottom: 35, files: ['desert-scene-two.png'],                              holdMs: 2000 },
            { left: 78, bottom: 22, files: ['desert-scene-three.png', 'desert-scene-four.png'],   holdMs: 2600 },
        ],
    },
    space: {
        spawnInterval: 440,
        anchors: [
            { left: 12, bottom: 30, files: ['space-scene-one.png'],   holdMs: 3200 },
            { left: 45, bottom: 28, files: ['space-scene-two.png'],   holdMs: 2000 },
            { left: 75, bottom: 34, files: ['space-scene-three.png'], holdMs: 2800 },
        ],
    },
    icy: {
        spawnInterval: 420,
        anchors: [
            { left: 18, bottom: 28, files: ['icy-scene-one.png'],                               holdMs: 2600 },
            { left: 50, bottom: 32, files: ['icy-scene-two.png', 'icy-scene-three.png'],        holdMs: 2200 },
            { left: 82, bottom: 24, files: ['icy-scene-four.png'],                              holdMs: 3000 },
        ],
    },
    rainforest: {
        spawnInterval: 340,
        anchors: [
            { left: 10, bottom: 30, files: ['rf-scene-one.png', 'rf-scene-two.png'], holdMs: 2400 },
            { left: 48, bottom: 35, files: ['rf-scene-three.png'],                   holdMs: 2000 },
            { left: 82, bottom: 26, files: ['rf-scene-four.png'],                    holdMs: 2800 },
        ],
    },
    tamil: {
        spawnInterval: 400,
        anchors: [
            { left: 16, bottom: 28, files: ['tamil-scene-one.png'],                            holdMs: 3000 },
            { left: 50, bottom: 32, files: ['tamil-scene-two.png', 'tamil-scene-three.png'],   holdMs: 2400 },
            { left: 80, bottom: 24, files: ['tamil-scene-four.png'],                           holdMs: 2800 },
        ],
    },
    block: {
        spawnInterval: 400,
        anchors: [
            { left: 16, bottom: 28, files: ['block-scene-one.png'],                           holdMs: 3000 },
            { left: 50, bottom: 32, files: ['block-scene-two.png', 'block-scene-three.png'],  holdMs: 2400 },
            { left: 80, bottom: 24, files: ['block-scene-four.png'],                          holdMs: 2800 },
        ],
    },
    candy: {
        spawnInterval: 400,
        anchors: [
            { left: 16, bottom: 28, files: ['candy-scene-one.png'],                           holdMs: 3000 },
            { left: 50, bottom: 32, files: ['candy-scene-two.png', 'candy-scene-three.png'],  holdMs: 2400 },
            { left: 80, bottom: 24, files: ['candy-scene-four.png'],                          holdMs: 2800 },
        ],
    },
};

// ─── Angry-sky configuration ──────────────────────────────────────────
// "Angry" items chase the player Super-Mario-Bros-3-style. Hitting one ends
// the level (or breaks the deflect shield first if active).
const ANGRY_CELESTIAL  = new Set(['sun.png', 'planet-one.png']);
const ANGRY_PROJECTILE = new Set(['comet-two.png', 'shooting-star.png']);
const ANGRY_SPAWN_DELAY_MS = 30000;  // earliest moment in a race an angry item can appear

function _angryTypeFor(file) {
    if (ANGRY_CELESTIAL.has(file))  return 'celestial';
    if (ANGRY_PROJECTILE.has(file)) return 'projectile';
    return null;
}

// ─── Runtime state ────────────────────────────────────────────────────
let skyTimer                = 0;
let skyActiveUniques        = new Set();
let sceneTimer              = 0;
let sceneAnchorCooldowns    = [];
let specialTimer            = 0;
let _angrySpawnedCelestial  = false;
let _angrySpawnedProjectile = false;

// ═══════════════════════════════════════════════════════════════════════
//  SKY LAYER
// ═══════════════════════════════════════════════════════════════════════

export function spawnSkyObject() {
    skyTimer++;
    if (skyTimer < 110) return;
    skyTimer = 0;

    const tod  = TRACK_TIMEOFDAY[gameState.track];
    if (!tod) return;
    const fullPool = SKY_POOLS[tod];
    if (!fullPool?.length) return;

    // Angry items: once per level AND only after the spawn delay has elapsed.
    const elapsedMs    = performance.now() - raceVars.raceStartedAt;
    const angryAllowed = elapsedMs >= ANGRY_SPAWN_DELAY_MS;
    const pool = fullPool.filter(d => {
        if (ANGRY_CELESTIAL.has(d.file)  && (_angrySpawnedCelestial  || !angryAllowed)) return false;
        if (ANGRY_PROJECTILE.has(d.file) && (_angrySpawnedProjectile || !angryAllowed)) return false;
        return true;
    });
    if (!pool.length) return;

    const def = _weightedPick(pool);
    if (!def) return;
    if (def.unique && skyActiveUniques.has(def.file)) return;
    _emitSkyItem(def, false);
}

export function maybeSpawnSpecial() {
    specialTimer++;
    if (specialTimer < 600) return;
    if (Math.random() > 0.008) return;
    specialTimer = 0;
    const elapsedMs    = performance.now() - raceVars.raceStartedAt;
    const angryAllowed = elapsedMs >= ANGRY_SPAWN_DELAY_MS;
    const pool = SKY_SPECIAL.filter(d => {
        if (ANGRY_PROJECTILE.has(d.file) && (_angrySpawnedProjectile || !angryAllowed)) return false;
        return true;
    });
    if (!pool.length) return;
    const def = _weightedPick(pool);
    if (def) _emitSkyItem(def, true);
}

function _emitSkyItem(def, isSpecial) {
    const layer = document.getElementById('skybox-layer');
    if (!layer) return;

    const topPct = def.topMin + Math.random() * (def.topMax - def.topMin);
    const motionCls = def.motionClass + (isSpecial ? ' sky-special' : '');

    let el;
    if (def.sprite) {
        // Sheet-backed: a sprite wrapper IS the sky-item.
        const tmp = document.createElement('div');
        tmp.innerHTML = spriteHTML(skySpriteName(def.file), { extraClass: 'sky-item ' + motionCls });
        el = tmp.firstElementChild;
    } else {
        // Standalone PNG (specials).
        el = document.createElement('img');
        el.src = SKY_BASE + def.file;
        el.className = 'sky-item ' + motionCls;
        el.alt = '';
        el.draggable = false;
    }
    el.style.top = topPct + '%';
    el.dataset.skyFile = def.file;

    const angryType = _angryTypeFor(def.file);
    if (angryType) {
        el.classList.add('sky-angry');
        el.dataset.angryType = angryType;
        // Take the element off the drift animation — race.js will steer it.
        el.style.animation = 'none';
        el.style.transform = 'none';
        el.style.opacity   = '1';
        const startX = window.innerWidth * (0.35 + Math.random() * 0.4);
        const startY = window.innerHeight * (0.04 + Math.random() * 0.06);
        el.style.left = startX + 'px';
        el.style.top  = startY + 'px';
        el._angryX       = startX;
        el._angryY       = startY;
        el._angryVX      = 0;
        el._angryVY      = 0;
        el._angryAge     = 0;
        el._angrySpawnAt = performance.now();
        el._angryMode    = 'wander';
        if (angryType === 'celestial')  _angrySpawnedCelestial  = true;
        if (angryType === 'projectile') _angrySpawnedProjectile = true;
    }

    el.addEventListener('animationend', () => {
        if (def.unique) skyActiveUniques.delete(def.file);
        el.remove();
    }, { once: true });

    if (def.unique) skyActiveUniques.add(def.file);
    layer.appendChild(el);
}

function _weightedPick(pool) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const item of pool) {
        r -= item.weight;
        if (r <= 0) return item;
    }
    return pool[pool.length - 1];
}

// ═══════════════════════════════════════════════════════════════════════
//  SCENE LAYER — anchored cameos
// ═══════════════════════════════════════════════════════════════════════

export function buildSceneAnchors() {
    const layer = document.getElementById('scenery-layer');
    if (!layer) return;
    layer.innerHTML = '';

    const cfg = SCENE_CONFIG[gameState.track];
    if (!cfg) { sceneAnchorCooldowns = []; return; }

    sceneAnchorCooldowns = cfg.anchors.map(() => 0);
    cfg.anchors.forEach((anchor, i) => {
        const img          = document.createElement('img');
        img.className      = 'scene-item';
        img.style.left     = anchor.left   + '%';
        img.style.bottom   = anchor.bottom + '%';
        img.alt            = '';
        img.draggable      = false;
        img.dataset.anchor = i;
        layer.appendChild(img);
    });
}

export function tickSceneAnchors() {
    for (let i = 0; i < sceneAnchorCooldowns.length; i++) {
        if (sceneAnchorCooldowns[i] > 0) sceneAnchorCooldowns[i]--;
    }

    sceneTimer++;
    const cfg = SCENE_CONFIG[gameState.track];
    if (!cfg || sceneTimer < cfg.spawnInterval) return;
    sceneTimer = 0;

    const layer = document.getElementById('scenery-layer');
    if (!layer) return;

    const eligible = cfg.anchors
        .map((anchor, i) => ({ anchor, i }))
        .filter(({ i }) => {
            if (sceneAnchorCooldowns[i] > 0) return false;
            const el = layer.querySelector(`.scene-item[data-anchor="${i}"]`);
            return el && !el.classList.contains('scene-active');
        });

    if (!eligible.length) return;

    const { anchor, i } = eligible[Math.floor(Math.random() * eligible.length)];
    const el = layer.querySelector(`.scene-item[data-anchor="${i}"]`);
    if (!el) return;

    el.src = SCENE_BASE + anchor.files[Math.floor(Math.random() * anchor.files.length)];
    el.classList.add('scene-active');

    const t = setTimeout(() => {
        el.classList.add('scene-fadeout');
        el.addEventListener('transitionend', () => {
            el.classList.remove('scene-active', 'scene-fadeout');
            el.src = '';
        }, { once: true });
    }, anchor.holdMs);

    el._sceneTimer = t;
    sceneAnchorCooldowns[i] = Math.ceil((anchor.holdMs + 3000) / 16.67);
}

// ═══════════════════════════════════════════════════════════════════════
//  SKYBOX PHASE UPDATE — called each frame by the race loop
// ═══════════════════════════════════════════════════════════════════════

export function updateSkyboxPhases() {
    const layer = document.getElementById('skybox-layer');
    if (!layer) return;
    layer.style.filter = raceVars.boostActive
        ? 'brightness(1.12) saturate(1.15)'
        : '';
}

// ═══════════════════════════════════════════════════════════════════════
//  LIFECYCLE — called by startRace() and endRace()
// ═══════════════════════════════════════════════════════════════════════

export function buildSkybox() {
    const layer = document.getElementById('skybox-layer');
    if (layer) layer.innerHTML = '';
    skyActiveUniques.clear();
    skyTimer                = 0;
    specialTimer            = 0;
    _angrySpawnedCelestial  = false;
    _angrySpawnedProjectile = false;
}

export function clearEnvironment() {
    const sl = document.getElementById('scenery-layer');
    if (sl) {
        sl.querySelectorAll('.scene-item').forEach(el => {
            if (el._sceneTimer) { clearTimeout(el._sceneTimer); el._sceneTimer = null; }
        });
        sl.innerHTML = '';
    }
    const skyL = document.getElementById('skybox-layer');
    if (skyL) skyL.innerHTML = '';

    skyActiveUniques.clear();
    skyTimer                = 0;
    specialTimer            = 0;
    sceneTimer              = 0;
    sceneAnchorCooldowns    = [];
    _angrySpawnedCelestial  = false;
    _angrySpawnedProjectile = false;
}
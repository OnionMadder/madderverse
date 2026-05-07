// ════════════════════════════════════════════════════════════════════
//  race.js — Giggle Gears | Race Engine, NPCs & Physics
// ════════════════════════════════════════════════════════════════════

import {
    gameState, raceVars, savePoints,
    SPEED_BASE, SPEED_BOOST, SPEED_STEP,
    BOOST_RAMP_RATE, BOOST_MAX_SPEED,
    JUMP_VELOCITY, GRAVITY, GRAVITY_BOOST,
    GROUND_Y_VH, JUMP_COOLDOWN_BASE,
    LEVEL_LENGTH, TRACK_DURATION_MS,
    NPC_CARS, NPC_TIERS, NPC_TIER_KEYS,
    carSpriteName, driverSpriteName, npcSpriteName, vhToPx,
} from './state.js';
import { spriteHTML } from './sprites.js';
import {
    clearEnvironment, buildSkybox, buildSceneAnchors,
    spawnSkyObject, maybeSpawnSpecial, tickSceneAnchors, updateSkyboxPhases,
} from './environment.js';
import {
    updateHUD, updateTimerHUD, setSpeedIndicator, showTrick,
    addKeyListeners, removeKeyListeners, setKeyHandlers,
} from './screens.js';
import { awardPoints, fireTrick, tickStreak, POINT_EVENTS, endRace } from './tricks.js';
import { sfx, playTrackMusic, unlockAudio }                           from './audio.js';

// ─── Re-export endRace so screens.js dynamic import works ─────────────
export { endRace };

// ═══════════════════════════════════════════════════════════════════════
//  RACE INIT
// ═══════════════════════════════════════════════════════════════════════

export function startRace() {
    cancelAnimationFrame(raceVars.raceAnimation);

    // Reset race vars
    raceVars.levelDistance = 0;
    raceVars.sessionPoints = 0;
    raceVars.npcs          = [];
    raceVars.currentSpeed  = SPEED_BASE;
    raceVars.boostActive   = false;
    raceVars.roadOffset    = 0;
    raceVars.trickCooldown = 0;
    raceVars.npcSpawnTimer = 0;
    raceVars.isJumping     = false;
    raceVars.jumpOffsetPx  = 0;
    raceVars.jumpVelocity  = 0;
    raceVars.jumpCooldown  = 0;
    raceVars.shieldActive  = !!gameState.upgrades.deflectShield;
    raceVars.deathCause    = null;
    raceVars.raceEnded     = false;

    // Register handlers now — all modules are fully initialised by this point
    setKeyHandlers(_keyDown, _keyUp);
    addKeyListeners();

    const track = document.getElementById('race-track');
    if (!track) return;
    track.className = `track-${gameState.track}`;

    document.querySelectorAll('.road-tile').forEach(t => {
        t.className = `road-tile road-${gameState.track}`;
    });

    buildRacingCar();
    clearEnvironment();
    buildSkybox();
    buildSceneAnchors();

    const npcLayer = document.getElementById('npc-layer');
    if (npcLayer) npcLayer.innerHTML = '';
    raceVars.npcs = [];

    const w = document.getElementById('racing-car-wrapper');
    if (w) w.style.bottom = vhToPx(GROUND_Y_VH) + 'px';

    updateHUD();
    updateTimerHUD(TRACK_DURATION_MS);
    playTrackMusic(gameState.track);

    // Pre-spawn a couple NPC drivers so they're visible from frame one
    for (let i = 0; i < 2; i++) {
        raceVars.npcSpawnTimer = 9999;
        _spawnNPCs();
        const npc = raceVars.npcs[raceVars.npcs.length - 1];
        if (npc) {
            npc.x = window.innerWidth - 80 - i * 320;
            npc.el.style.left = npc.x + 'px';
        }
    }
    raceVars.npcSpawnTimer = 0;

    raceVars.raceStartedAt = performance.now();
    _loop();
}

// ═══════════════════════════════════════════════════════════════════════
//  BUILD RACING CAR
// ═══════════════════════════════════════════════════════════════════════

function buildRacingCar() {
    const wrapper = document.getElementById('racing-car-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const inner  = document.createElement('div');
    inner.className = 'racing-car-inner';

    const spoiler = document.createElement('div');
    spoiler.className   = 'anchor slot-roof-rear';
    spoiler.textContent = gameState.accessorySpoiler || '';

    const dome = document.createElement('div');
    dome.className   = 'anchor slot-roof-front';
    dome.textContent = gameState.accessoryDome || '';

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'race-body-wrapper';
    bodyWrap.classList.toggle('fx-hover',        gameState.upgrades.hoverride);
    bodyWrap.classList.toggle('fx-boostflame',   gameState.upgrades.boostFlame);
    bodyWrap.classList.toggle('fx-fancy-lights', gameState.upgrades.fancyLights);
    bodyWrap.classList.toggle('fx-shield',       raceVars.shieldActive);
    bodyWrap.classList.toggle('lights-on',       gameState.lightsOn);

    // race-car-img IS a sprite wrapper (the .sprite class is added via spriteHTML markup).
    const carWrap = document.createElement('div');
    carWrap.innerHTML = spriteHTML(carSpriteName(gameState.carId), { extraClass: 'race-car-img', attrs: 'role="img" aria-label="Car"' });
    const carImg = carWrap.firstElementChild;

    const driverSlot = document.createElement('div');
    driverSlot.className = 'race-driver-slot';
    driverSlot.innerHTML = spriteHTML(driverSpriteName(gameState.driver), { attrs: 'role="img" aria-label="Driver"' });

    const hlSlot = document.createElement('div');
    hlSlot.className = 'anchor slot-front';
    const beam = document.createElement('div');
    beam.className = 'headlight-beam';
    hlSlot.appendChild(beam);

    bodyWrap.appendChild(carImg);
    bodyWrap.appendChild(driverSlot);
    bodyWrap.appendChild(hlSlot);

    inner.appendChild(spoiler);
    inner.appendChild(dome);
    inner.appendChild(bodyWrap);
    wrapper.appendChild(inner);
}

// ═══════════════════════════════════════════════════════════════════════
//  HEADLIGHT — natural conical beam with speed-responsive bloom
// ═══════════════════════════════════════════════════════════════════════

function _updateHeadlightBeam() {
    if (!gameState.lightsOn && !gameState.upgrades.fancyLights) return;
    const beam = document.querySelector('#racing-car-wrapper .headlight-beam');
    if (!beam) return;

    const t          = performance.now();
    const speedRatio = Math.min((raceVars.currentSpeed - SPEED_BASE) / (SPEED_BOOST - SPEED_BASE), 1);

    // Beam geometry — wider & longer at speed
    const beamW    = Math.round(70  + speedRatio * 90);
    const beamH    = Math.round(28  + speedRatio * 20);
    const spread   = Math.round(32  + speedRatio * 20); // cone half-angle in deg
    const midPct   = Math.round(40  + speedRatio * 12); // warm core falloff point

    // Flicker — subtle ~12Hz oscillation, stronger at boost
    const flicker  = 1 + (raceVars.boostActive ? 0.06 : 0.02) * Math.sin(t / 42);
    const coreA    = Math.min(1, (0.78 + speedRatio * 0.22) * flicker);
    const midA     = coreA * 0.58;
    const rimA     = coreA * 0.22;

    // Colour shifts warmer at speed (tungsten → LED-white)
    const r = Math.round(255);
    const g = Math.round(248 + speedRatio * 7);
    const b = Math.round(180 + speedRatio * 75);

    beam.style.width  = beamW + 'px';
    beam.style.height = beamH + 'px';

    // Three-stop conic: tight bright core → warm mid → transparent rim
    beam.style.background = `conic-gradient(
        from -${spread}deg at 0% 50%,
        rgba(${r},${g},${b},${coreA})        0deg,
        rgba(${r},${g},${b},${midA})         ${midPct}deg,
        rgba(${r},${Math.round(g*0.8)},${Math.round(b*0.5)},${rimA}) ${spread * 1.2}deg,
        transparent                          ${spread * 1.6}deg
    )`;

    // Outer atmospheric glow ring — separate box-shadow on the slot div
    const glow = beam.parentElement;
    if (glow) {
        const glowR  = Math.round(16  + speedRatio * 26);
        const glowA  = (0.18 + speedRatio * 0.14).toFixed(2);
        glow.style.filter = `drop-shadow(${glowR}px 0 ${glowR * 2}px rgba(${r},${g},${b},${glowA}))`;
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  UNDERGLOW — futuristic neon with complementary offset glow layers
// ═══════════════════════════════════════════════════════════════════════

// Complementary colour pairs for multi-layer neon effect.
// [ primaryHex, complementHex, triHex ]
const UNDERGLOW_COMPLEMENTS = {
    '#00ffee': ['#00ffee', '#ff00aa', '#7700ff'],
    '#ff2d9e': ['#ff2d9e', '#00ffd5', '#ffcc00'],
    '#aaff00': ['#aaff00', '#aa00ff', '#ff6600'],
    '#cc00ff': ['#cc00ff', '#00ff88', '#ffcc00'],
    '#ff7700': ['#ff7700', '#0088ff', '#ff00cc'],
    '#aaddff': ['#aaddff', '#ffaa33', '#aa77ff'],
    '#ffcc00': ['#ffcc00', '#0044ff', '#ff00aa'],
    '#ff2222': ['#ff2222', '#00ffcc', '#ffff00'],
    '#33ff55': ['#33ff55', '#ff3366', '#3366ff'],
    '#ffffff': ['#ffffff', '#aaddff', '#ffccee'],
};

function _updateUnderglow() {
    const bodyWrap = document.querySelector('#racing-car-wrapper .race-body-wrapper');
    if (!bodyWrap) return;
    if (!gameState.underglowColor) { bodyWrap.style.filter = ''; bodyWrap.style.setProperty('--glow-extra', ''); return; }

    const t       = performance.now();
    const boost   = raceVars.boostActive;
    // Pulse frequency: faster at boost
    const freq    = boost ? 1800 : 3200;
    const pulse   = 0.5 + 0.5 * Math.sin((t / freq) * Math.PI * 2);
    // Secondary pulse slightly out of phase
    const pulse2  = 0.5 + 0.5 * Math.sin((t / freq) * Math.PI * 2 + 1.2);

    const palette = UNDERGLOW_COMPLEMENTS[gameState.underglowColor] ||
                    [gameState.underglowColor, '#ffffff', '#aaddff'];
    const [c1, c2, c3] = palette;

    // Primary glow size
    const sz1 = boost ? Math.round(22 + pulse  * 12) : Math.round(14 + pulse  * 6);
    // Complementary offset layer — slightly smaller, different phase
    const sz2 = boost ? Math.round(16 + pulse2 *  8) : Math.round( 9 + pulse2 * 4);
    // Tri-colour accent — tiny bright spark
    const sz3 = boost ? Math.round( 8 + pulse  *  5) : Math.round( 4 + pulse  * 3);

    // Neon road shadow — cast downward
    const roadSz = boost ? Math.round(30 + pulse * 10) : Math.round(18 + pulse * 6);

    bodyWrap.style.filter = [
        `drop-shadow(0 ${sz1 + 2}px ${sz1 + 6}px ${c1})`,
        `drop-shadow(0 ${sz2 + 4}px ${sz2 + 10}px ${c2})`,
        `drop-shadow(0 ${sz3 + 1}px ${sz3 + 3}px ${c3})`,
        `drop-shadow(0 ${roadSz}px ${roadSz + 8}px ${c1})`,  // road spill
    ].join(' ');
}

// ═══════════════════════════════════════════════════════════════════════
//  BOOST
// ═══════════════════════════════════════════════════════════════════════

export function boostStart() {
    if (raceVars.boostActive) return;
    raceVars.boostActive = true;
    setSpeedIndicator(true);
    sfx.boost();
    const w = document.getElementById('racing-car-wrapper');
    if (w) {
        w.classList.add('car-boosting');
        if (gameState.upgrades.boostFlame) w.classList.add('fx-boostflame');
    }
}

export function boostEnd() {
    if (!raceVars.boostActive) return;
    raceVars.boostActive = false;
    setSpeedIndicator(false);
    const w = document.getElementById('racing-car-wrapper');
    if (w) {
        w.classList.remove('car-boosting');
        if (!gameState.upgrades.boostFlame) w.classList.remove('fx-boostflame');
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  JUMP — floaty kid-friendly arc
// ═══════════════════════════════════════════════════════════════════════

export function doJump() {
    // Mid-air re-jump — each press of UP adds upward velocity ("increase the jump")
    if (raceVars.isJumping && raceVars.jumpOffsetPx > 20) {
        raceVars.jumpVelocity = JUMP_VELOCITY * 0.6;
        sfx.jump();
        return;
    }
    if (raceVars.isJumping || raceVars.jumpCooldown > 0) return;
    raceVars.isJumping    = true;
    raceVars.jumpVelocity = JUMP_VELOCITY;
    sfx.jump();
    document.getElementById('racing-car-wrapper')?.classList.add('car-jumping');
}

function _updateJump() {
    const w = document.getElementById('racing-car-wrapper');
    if (!w) return;

    if (raceVars.isJumping) {
        // Gravity always applies — release UP and the driver starts falling immediately.
        raceVars.jumpVelocity += GRAVITY;
        raceVars.jumpOffsetPx -= raceVars.jumpVelocity;

        // Cap altitude so the driver never leaves the screen.
        const maxOffset = Math.max(120, window.innerHeight - 220);
        if (raceVars.jumpOffsetPx > maxOffset) {
            raceVars.jumpOffsetPx = maxOffset;
            if (raceVars.jumpVelocity < 0) raceVars.jumpVelocity = 0;
        }

        // Award big-air bonus once per jump when reaching peak height
        if (!raceVars._bigAirAwarded && raceVars.jumpOffsetPx > 90) {
            raceVars._bigAirAwarded = true;
            awardPoints(POINT_EVENTS.bigJump.pts, POINT_EVENTS.bigJump.label);
        }

        if (raceVars.jumpOffsetPx <= 0) {
            raceVars.jumpOffsetPx      = 0;
            raceVars.isJumping         = false;
            raceVars.jumpVelocity      = 0;
            raceVars._bigAirAwarded    = false;
            raceVars.jumpCooldown      = raceVars.boostActive
                ? Math.floor(JUMP_COOLDOWN_BASE * 0.55)
                : JUMP_COOLDOWN_BASE;
            w.classList.remove('car-jumping');
            sfx.land();
        }
    } else {
        if (raceVars.jumpCooldown > 0) raceVars.jumpCooldown--;
    }

    w.style.bottom = (vhToPx(GROUND_Y_VH) + raceVars.jumpOffsetPx) + 'px';

    // Shadow shrinks as car rises
    const shadowEl = w.querySelector('.car-shadow') || w;
    const scaleS   = Math.max(0.3, 1 - raceVars.jumpOffsetPx / 280);
    w.style.setProperty('--shadow-scale', scaleS);
}

// ─── Keyboard ─────────────────────────────────────────────────────────
function _keyDown(e) {
    if (e.code === 'Space')   { e.preventDefault(); unlockAudio(); boostStart(); }
    if (e.code === 'ArrowUp') { e.preventDefault(); unlockAudio(); doJump(); }
    if (e.code === 'KeyT')    { fireTrick(); }
}
function _keyUp(e) {
    if (e.code === 'Space') { e.preventDefault(); boostEnd(); }
}

// T key trick is handled inside _keyDown above (no extra listener needed)

// ═══════════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════

function _loop() {
    const gs = document.getElementById('screen-game');
    if (!gs?.classList.contains('active')) return;

    if (raceVars.boostActive) {
        // Two-phase climb: snap up to base boost cap, then keep accelerating
        // the longer boost is held — encourages tap-and-release over mashing.
        const accel = raceVars.currentSpeed < SPEED_BOOST ? SPEED_STEP : BOOST_RAMP_RATE;
        raceVars.currentSpeed = Math.min(raceVars.currentSpeed + accel, BOOST_MAX_SPEED);
    } else {
        raceVars.currentSpeed = Math.max(raceVars.currentSpeed - SPEED_STEP * 0.5, SPEED_BASE);
    }

    raceVars.roadOffset    += raceVars.currentSpeed;
    raceVars.levelDistance += raceVars.currentSpeed;
    if (raceVars.roadOffset >= window.innerWidth) raceVars.roadOffset -= window.innerWidth;

    const rs = document.getElementById('road-strip');
    if (rs) rs.style.transform = `translateX(-${raceVars.roadOffset}px)`;

    _updateJump();
    _updateHeadlightBeam();
    _updateUnderglow();
    _spawnNPCs();
    _moveNPCs();
    updateSkyboxPhases();
    spawnSkyObject();
    maybeSpawnSpecial();
    tickSceneAnchors();
    _tickAngrySky();
    checkCollisions();
    tickStreak();

    if (raceVars.trickCooldown > 0) raceVars.trickCooldown--;

    const remainingMs = Math.max(0, TRACK_DURATION_MS - (performance.now() - raceVars.raceStartedAt));
    updateTimerHUD(remainingMs);
    if (remainingMs <= 0) { endRace(false); return; }

    raceVars.raceAnimation = requestAnimationFrame(_loop);
}

// ═══════════════════════════════════════════════════════════════════════
//  NPCs
// ═══════════════════════════════════════════════════════════════════════

function _spawnNPCs() {
    raceVars.npcSpawnTimer++;

    const elapsedMs     = performance.now() - raceVars.raceStartedAt;
    const endProximity  = Math.min(elapsedMs / TRACK_DURATION_MS, 1);
    const difficultyMod = 1 - endProximity * 0.5;
    const interval      = Math.floor((160 - raceVars.currentSpeed * 5) * difficultyMod);

    // While an angry sky item is on screen, dial NPC spawns way back so the
    // player can focus on dodging.
    const angryActive = _isAngryOnScreen();
    const minInterval = angryActive ? 220 : 35;
    const maxNpcs     = angryActive ? 1   : 3;

    if (raceVars.npcSpawnTimer < Math.max(interval, minInterval)) return;
    raceVars.npcSpawnTimer = 0;
    if (raceVars.npcs.length >= maxNpcs) return;

    const npcLayer = document.getElementById('npc-layer');
    if (!npcLayer) return;

    // Each NPC sprite can only appear once on screen at a time
    const onScreenFiles = new Set(raceVars.npcs.map(n => n.carFile));
    const available     = NPC_CARS.filter(f => !onScreenFiles.has(f));
    if (!available.length) return;

    const carFile = available[Math.floor(Math.random() * available.length)];
    const laneY   = [78, 83][Math.floor(Math.random() * 2)];
    const tierKey = NPC_TIER_KEYS[Math.floor(Math.random() * NPC_TIER_KEYS.length)];
    const tier    = NPC_TIERS[tierKey];

    const npcEl = document.createElement('div');
    npcEl.className   = 'npc-car';
    npcEl.style.top   = laneY + 'vh';
    npcEl.style.left  = (window.innerWidth + 50) + 'px';
    npcEl.innerHTML   = spriteHTML(npcSpriteName(carFile), { extraClass: 'npc-car-img', attrs: 'role="img" aria-label="NPC"' });
    npcLayer.appendChild(npcEl);

    raceVars.npcs.push({
        el:           npcEl,
        carFile,
        x:            window.innerWidth + 50,
        tierSpeed:    tier.maxSpeed * (0.7 + Math.random() * 0.6),
        curSpeed:     tier.maxSpeed * 0.4,
        accel:        tier.acceleration * (0.8 + Math.random() * 0.4),
        lane:         laneY,
        passed:       false,
        nearMissed:   false,
        hit:          false,
        jumped:       false,
        careening:    false,
        careenVX:     0,
        careenVY:     0,
    });
}

function _moveNPCs() {
    const toRemove = [];

    raceVars.npcs.forEach((npc, i) => {
        if (npc.careening) {
            npc.x          += npc.careenVX;
            npc.careenVY   += 0.18;                   // gravity pulls them down after the launch
            const topVh    = parseFloat(npc.el.style.top) || 78;
            const newTopVh = topVh + npc.careenVY;
            npc.el.style.top       = newTopVh + 'vh';
            npc.el.style.left      = npc.x + 'px';
            const wobble = Math.sin(npc.careenAge * 0.45) * 0.18;
            const scale  = Math.max(0.05, 1 - npc.careenAge * 0.012) * (1 + wobble);
            npc.el.style.transform = `rotate(${npc.careenAngle || 0}deg) scale(${scale})`;
            npc.careenAngle = ((npc.careenAngle || 0) + (npc.careenSpin || 22)) % 360;
            npc.careenAge   = (npc.careenAge   || 0) + 1;
            if (npc.x < -500 || npc.x > window.innerWidth + 500 || newTopVh < -25 || newTopVh > 130 || npc.careenAge > 130) toRemove.push(i);
            return;
        }

        const leadNPC = raceVars.npcs.find((other, j) => {
            if (j === i) return false;
            if (other.lane !== npc.lane) return false;
            const gap = other.x - npc.x;
            return gap > 0 && gap < 150;
        });

        if (leadNPC) {
            npc.curSpeed += (leadNPC.curSpeed - npc.curSpeed) * 0.08;
        } else {
            npc.curSpeed += (npc.tierSpeed - npc.curSpeed) * npc.accel;
        }

        const scrollContrib = raceVars.currentSpeed * 0.6;
        npc.x -= scrollContrib + npc.curSpeed;
        npc.el.style.left = npc.x + 'px';

        if (!npc.passed && npc.x < 80) {
            npc.passed = true;
            awardPoints(POINT_EVENTS.dodge.pts, POINT_EVENTS.dodge.label);
            sfx.dodge();
        }
        if (npc.x < -300) toRemove.push(i);
    });

    toRemove.reverse().forEach(i => { raceVars.npcs[i].el.remove(); raceVars.npcs.splice(i, 1); });
}

// ═══════════════════════════════════════════════════════════════════════
//  COLLISIONS
// ═══════════════════════════════════════════════════════════════════════

export function checkCollisions() {
    const wrapper = document.getElementById('racing-car-wrapper');
    if (!wrapper) return;
    const pr  = wrapper.getBoundingClientRect();
    const px1 = pr.left   + pr.width  * 0.25;
    const px2 = pr.right  - pr.width  * 0.25;
    const py1 = pr.top    + pr.height * 0.25;
    const py2 = pr.bottom - pr.height * 0.25;

    raceVars.npcs.forEach(npc => {
        if (npc.careening) return;
        const nr  = npc.el.getBoundingClientRect();
        const nx1 = nr.left  + nr.width  * 0.15;
        const nx2 = nr.right - nr.width  * 0.15;
        const ny1 = nr.top;
        const ny2 = nr.bottom;

        // Jump-over detection — car above NPC in x-corridor
        if (raceVars.isJumping && raceVars.jumpOffsetPx > 30 && !npc.jumped) {
            if (px1 < nx2 && px2 > nx1) {
                npc.jumped = true;
                awardPoints(POINT_EVENTS.jumpOver.pts, POINT_EVENTS.jumpOver.label);
                sfx.trick();
                return;
            }
        }

        // Near-miss — passed very close but not overlapping (horizontal x-proximity)
        if (!npc.nearMissed && !npc.hit && raceVars.jumpOffsetPx <= 30) {
            const closeEnough = Math.abs(px1 - nx2) < 28 || Math.abs(nx1 - px2) < 28;
            if (closeEnough && !(px1 < nx2 && px2 > nx1)) {
                npc.nearMissed = true;
                awardPoints(POINT_EVENTS.nearMiss.pts, POINT_EVENTS.nearMiss.label);
            }
        }

        if (raceVars.jumpOffsetPx > 40) return;

        const overlap = px1 < nx2 && px2 > nx1 && py1 < ny2 && py2 > ny1;
        if (overlap && !npc.hit) {
            npc.hit = true;
            if (raceVars.shieldActive) {
                launchCareen(npc);
                awardPoints(POINT_EVENTS.deflect.pts, POINT_EVENTS.deflect.label);
                sfx.deflect();
            } else {
                flashCrash();
            }
        }
    });

    _checkSkyTouches(pr);
}

// ─── Sky-object touch (jump up to pop them) ─────────────────────────
function _checkSkyTouches(playerRect) {
    if (!raceVars.isJumping) return;
    const layer = document.getElementById('skybox-layer');
    if (!layer) return;

    // Angry chasers can't be popped — they have to be dodged.
    const items = layer.querySelectorAll('.sky-item:not([data-popped]):not(.sky-angry)');
    if (!items.length) return;

    items.forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const overlap = r.right > playerRect.left && r.left < playerRect.right
                     && r.bottom > playerRect.top  && r.top  < playerRect.bottom;
        if (overlap) _popSkyItem(el);
    });
}

// ─── Angry-sky chase (SMB3-style) ────────────────────────────────────
const ANGRY_LIFETIME_MS = 15000;  // never on screen longer than this
const ANGRY_WANDER_MS   = 3000;   // initial passive drift before going aggro
const ANGRY_CYCLE_MS    = 4500;   // aim → dive → retreat cycle length

function _tickAngrySky() {
    const layer = document.getElementById('skybox-layer');
    if (!layer) return;
    const items = layer.querySelectorAll('.sky-item.sky-angry:not([data-hit-processed])');
    if (!items.length) return;

    const wrapper = document.getElementById('racing-car-wrapper');
    if (!wrapper) return;
    const pr = wrapper.getBoundingClientRect();
    const playerCx = pr.left + pr.width  / 2;

    // Hard floor — angry items can't reach the road, so the ground is safe.
    const safeFloor = window.innerHeight * 0.55;

    const now = performance.now();

    items.forEach(el => {
        const age          = now - (el._angrySpawnAt || now);
        const isProjectile = el.dataset.angryType === 'projectile';

        // Lifetime cap: bail upward and remove once off-screen.
        if (age > ANGRY_LIFETIME_MS) el._angryMode = 'exit';

        let targetX, targetY, lerp;

        if (el._angryMode === 'exit') {
            targetX = el._angryX;
            targetY = -120;
            lerp    = 0.004;
        } else if (age < ANGRY_WANDER_MS) {
            // Passive wander — drifts to random points near the top, ignoring the player.
            el._wanderTimer = (el._wanderTimer || 0) - 1;
            if (el._wanderTimer <= 0 || el._wanderX == null) {
                el._wanderX = window.innerWidth  * (0.20 + Math.random() * 0.6);
                el._wanderY = window.innerHeight * (0.05 + Math.random() * 0.12);
                el._wanderTimer = 60 + Math.floor(Math.random() * 60);
            }
            targetX = el._wanderX;
            targetY = el._wanderY;
            lerp    = isProjectile ? 0.0010 : 0.0008;
            el._angryMode = 'wander';
        } else {
            // Aggro phase — repeating aim / dive / retreat above the player.
            const cyclePos = (age - ANGRY_WANDER_MS) % ANGRY_CYCLE_MS;
            if (cyclePos < 1500) {
                el._angryMode = 'aim';
                targetX = playerCx;
                targetY = window.innerHeight * 0.10;
                lerp    = isProjectile ? 0.0014 : 0.0009;
            } else if (cyclePos < 3000) {
                el._angryMode = 'dive';
                targetX = playerCx;
                targetY = safeFloor;             // dive reaches no further than safeFloor
                lerp    = isProjectile ? 0.0030 : 0.0020;
            } else {
                el._angryMode = 'retreat';
                targetX = el._angryX;
                targetY = window.innerHeight * 0.07;
                lerp    = isProjectile ? 0.0022 : 0.0015;
            }
        }

        const damp     = isProjectile ? 0.93 : 0.95;
        const maxSpeed = isProjectile ? 8    : 6;

        const er  = el.getBoundingClientRect();
        const ecx = er.left + er.width  / 2;
        const ecy = er.top  + er.height / 2;

        el._angryVX = (el._angryVX || 0) + (targetX - ecx) * lerp;
        el._angryVY = (el._angryVY || 0) + (targetY - ecy) * lerp;
        el._angryVX *= damp;
        el._angryVY *= damp;

        const sp = Math.hypot(el._angryVX, el._angryVY);
        if (sp > maxSpeed) {
            el._angryVX = (el._angryVX / sp) * maxSpeed;
            el._angryVY = (el._angryVY / sp) * maxSpeed;
        }

        el._angryX = (el._angryX || ecx) + el._angryVX;
        el._angryY = (el._angryY || ecy) + el._angryVY;

        // Enforce the safe-floor cap so it can't reach the road.
        if (el._angryY > safeFloor) {
            el._angryY = safeFloor;
            if (el._angryVY > 0) el._angryVY = 0;
        }

        el.style.left = el._angryX + 'px';
        el.style.top  = el._angryY + 'px';

        // Remove once the exit has carried it above the viewport.
        if (el._angryMode === 'exit' && el._angryY < -60) {
            el.remove();
            return;
        }

        // Collision check — only matters during the aggro phase since the
        // wander phase keeps it well above the player.
        if (el._angryMode === 'wander' || el._angryMode === 'exit') return;
        const nowR    = el.getBoundingClientRect();
        const overlap = nowR.right > pr.left && nowR.left < pr.right
                     && nowR.bottom > pr.top && nowR.top  < pr.bottom;
        if (overlap) _onAngryHit(el);
    });
}

function _isAngryOnScreen() {
    const layer = document.getElementById('skybox-layer');
    return !!layer?.querySelector('.sky-item.sky-angry:not([data-hit-processed])');
}

function _onAngryHit(el) {
    if (el.dataset.hitProcessed) return;
    el.dataset.hitProcessed = '1';

    // Pop the angry item with the existing pop animation
    el.classList.remove('sky-angry');
    el.classList.add('sky-popping');
    el.addEventListener('animationend', () => el.remove(), { once: true });

    const track = document.getElementById('race-track');
    if (track) {
        track.classList.add('crash-flash');
        setTimeout(() => track.classList.remove('crash-flash'), 400);
    }

    if (raceVars.shieldActive) {
        // Shield absorbs the hit and shatters
        raceVars.shieldActive = false;
        const wrap = document.querySelector('#racing-car-wrapper .race-body-wrapper');
        if (wrap) wrap.classList.remove('fx-shield');
        sfx.deflect();
        showTrick('🛡️ Shield Down!', false);
    } else {
        // Game over — angry hit ends the level
        sfx.crash();
        raceVars.deathCause = 'angry';
        _showAngryKO();
        setTimeout(() => endRace(true), 1300);
    }
}

function _showAngryKO() {
    const screen = document.getElementById('screen-game');
    if (!screen) return;
    let overlay = document.getElementById('angry-ko-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'angry-ko-overlay';
        overlay.innerHTML = `
            <div class="ko-icon">💥</div>
            <div class="ko-title">WIPED OUT!</div>
            <div class="ko-subtitle">An angry sky item caught you!</div>
        `;
        screen.appendChild(overlay);
    }
    // Force restart of the entry animation if the overlay was reused
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
}

function _popSkyItem(el) {
    if (el.dataset.popped) return;
    el.dataset.popped = '1';

    // Pin the element at its current screen position so swapping the
    // animation doesn't snap it back to the start of the drift.
    const layer  = document.getElementById('skybox-layer');
    const er     = el.getBoundingClientRect();
    const lr     = layer.getBoundingClientRect();
    el.style.left = (er.left - lr.left) + 'px';
    el.style.top  = (er.top  - lr.top)  + 'px';
    void el.offsetWidth;     // force reflow
    el.classList.add('sky-popping');

    const evt = _skyHitEvent(el.dataset.skyFile || '');
    awardPoints(evt.pts, evt.label);
    if (evt.pts >= 0) sfx.trick();
    else              sfx.crash();
}

function _skyHitEvent(file) {
    // Birds (alive) — penalty
    if (/^bird-/.test(file))                    return POINT_EVENTS.birdHit;
    // Big celestial bodies — penalty
    if (/^sun|^planet-/.test(file))             return POINT_EVENTS.sunHit;
    // Comets / shooting stars — penalty
    if (/^comet-|^shooting-/.test(file))        return POINT_EVENTS.cometHit;
    // Stars — small reward
    if (/^star-/.test(file))                    return POINT_EVENTS.starPop;
    // Clouds — small reward
    if (/^cloud-/.test(file))                   return POINT_EVENTS.cloudPop;
    return POINT_EVENTS.skyPop;
}

export function launchCareen(npc) {
    npc.careening   = true;
    // Boing! Random sideways direction so it's never the same twice
    const dir       = Math.random() < 0.5 ? -1 : 1;
    npc.careenVX    = dir * (14 + Math.random() * 10);
    npc.careenVY    = -(3.2 + Math.random() * 2.2);    // strong upward launch
    npc.careenSpin  = (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 22);
    npc.careenAngle = 0;
    npc.careenAge   = 0;
    npc.el.style.zIndex = '25';
    npc.el.style.filter = 'brightness(3) saturate(0)';
    setTimeout(() => { if (npc.el) npc.el.style.filter = ''; }, 120);
}

export function flashCrash() {
    const track = document.getElementById('race-track');
    if (track) {
        track.classList.add('crash-flash');
        setTimeout(() => track.classList.remove('crash-flash'), 400);
    }
    sfx.crash();
    showTrick('💥 Crash! -25', false);
    awardPoints(-25, null);
}
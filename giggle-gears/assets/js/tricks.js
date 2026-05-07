// ════════════════════════════════════════════════════════════════════
//  tricks.js — Giggle Gears | Tricks, Points & End Race
// ════════════════════════════════════════════════════════════════════

import { gameState, raceVars, savePoints, JUMP_AWARD_PTS } from './state.js';
import { updateHUD, showTrick, removeKeyListeners }         from './screens.js';
import { showScreen }                                        from './screens.js';
import { clearEnvironment }                                  from './environment.js';
import { sfx, playOverworld, stopMusic }                     from './audio.js';

// ═══════════════════════════════════════════════════════════════════════
//  TRICK DEFINITIONS
//  Each trick has: label, pts, condition(raceVars, gameState) → bool
//  Tricks fire in priority order — first matching wins (+ a random
//  pick among tied-condition tricks keeps it fresh).
// ═══════════════════════════════════════════════════════════════════════

const TRICK_DEFS = [
    // ── Upgrade combos (highest value) ──────────────────────────────
    {
        label: '⚡ Hyper Combo! +250',
        pts: 250,
        condition: (rv, gs) =>
            rv.boostActive &&
            rv.isJumping &&
            gs.upgrades.boostFlame &&
            gs.upgrades.hoverride,
    },
    {
        label: '🛡️ Shield Slam! +200',
        pts: 200,
        condition: (rv, gs) =>
            rv.boostActive && rv.shieldActive,
    },
    {
        label: '🌀 Hover Blitz! +175',
        pts: 175,
        condition: (rv, gs) =>
            rv.boostActive && gs.upgrades.hoverride && rv.isJumping,
    },

    // ── Speed-based tricks ────────────────────────────────────────
    {
        label: '🔥 Burnout! +130',
        pts: 130,
        condition: (rv, gs) =>
            rv.boostActive && gs.upgrades.boostFlame,
    },
    {
        label: '💨 Speed Ghost! +110',
        pts: 110,
        condition: (rv, gs) =>
            rv.boostActive && gs.underglowColor && rv.currentSpeed > 7,
    },
    {
        label: '🌈 Neon Drift! +90',
        pts: 90,
        condition: (rv, gs) =>
            rv.boostActive && gs.underglowColor,
    },

    // ── Jump-based tricks ─────────────────────────────────────────
    {
        label: '✈️ Air Time! +120',
        pts: 120,
        condition: (rv, gs) =>
            rv.isJumping && gs.upgrades.hoverride,
    },
    {
        label: '🚀 Sky Punch! +80',
        pts: 80,
        condition: (rv, gs) =>
            rv.isJumping && rv.jumpOffsetPx > 60,
    },

    // ── Style / cosmetic tricks ───────────────────────────────────
    {
        label: '💎 Fancy Flash! +70',
        pts: 70,
        condition: (rv, gs) =>
            rv.boostActive && gs.upgrades.fancyLights,
    },
    {
        label: '😎 Glow Drift! +60',
        pts: 60,
        condition: (rv, gs) =>
            gs.underglowColor !== null,
    },
    {
        label: '🏁 Race Line! +50',
        pts: 50,
        condition: (rv, gs) => true, // fallback, always available
    },
];

// ─── Bonus point events (called directly, not via fireTrick) ─────────
export const POINT_EVENTS = {
    dodge:       { pts: 50,  label: '🚗 Dodged! +50'       },
    jumpOver:    { pts: 75,  label: '⬆️ Jump Over! +75'     },
    bigJump:     { pts: 100, label: '🌤️ Big Air! +100'      },
    skyPop:      { pts: 60,  label: '✨ Pop! +60'           },
    starPop:     { pts: 60,  label: '⭐ Star Pop! +60'      },
    cloudPop:    { pts: 40,  label: '☁️ Cloud Pop! +40'      },
    birdHit:     { pts: -50, label: '🐦 Birds! -50'         },
    sunHit:      { pts: -75, label: '☀️ Too Hot! -75'       },
    cometHit:    { pts: -60, label: '☄️ Yowch! -60'         },
    deflect:     { pts: 120, label: '🛡️ Deflected! +120'    },
    nearMiss:    { pts: 35,  label: '😅 Near Miss! +35'     },
    finishBonus: { pts: 200, label: '🏆 Finish! +200'       },
    speedBonus:  { pts: 80,  label: '💨 Speed Bonus! +80'   },
    comboStreak: { pts: 150, label: '🔥 Combo x3! +150'     },
};

// ─── Combo streak tracker ─────────────────────────────────────────────
let _streakCount = 0;
let _streakTimer = 0;
const STREAK_WINDOW = 300; // frames (~5 seconds at 60fps)

export function tickStreak() {
    if (_streakTimer > 0) {
        _streakTimer--;
    } else {
        _streakCount = 0;
    }
}

function _bumpStreak() {
    _streakCount++;
    _streakTimer = STREAK_WINDOW;
    if (_streakCount >= 3 && _streakCount % 3 === 0) {
        awardPoints(POINT_EVENTS.comboStreak.pts, POINT_EVENTS.comboStreak.label);
        sfx.trick();
        _streakTimer = STREAK_WINDOW; // reset window
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  FIRE TRICK — called on T key or trick button
// ═══════════════════════════════════════════════════════════════════════

export function fireTrick() {
    if (raceVars.trickCooldown > 0) return;

    // Gather all currently valid tricks
    const valid = TRICK_DEFS.filter(t => t.condition(raceVars, gameState));
    if (!valid.length) return;

    // Pick highest-value eligible trick; break ties randomly
    const topPts = valid[0].pts;
    const top    = valid.filter(t => t.pts === topPts);
    const trick  = top[Math.floor(Math.random() * top.length)];

    awardPoints(trick.pts, trick.label);
    sfx.trick();
    _bumpStreak();

    raceVars.trickCooldown = 100;

    const w = document.getElementById('racing-car-wrapper');
    if (w) {
        w.classList.add('trick-animation');
        setTimeout(() => w.classList.remove('trick-animation'), 800);
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  POINTS
// ═══════════════════════════════════════════════════════════════════════

export function awardPoints(amount, message) {
    gameState.points       = Math.max(0, gameState.points + amount);
    raceVars.sessionPoints += Math.max(0, amount);
    savePoints();
    updateHUD();
    if (message) showTrick(message, amount > 0);
}

// ═══════════════════════════════════════════════════════════════════════
//  END RACE
// ═══════════════════════════════════════════════════════════════════════

export function endRace(playerQuit) {
    if (raceVars.raceEnded) return;
    raceVars.raceEnded = true;

    cancelAnimationFrame(raceVars.raceAnimation);
    raceVars.raceAnimation = null;
    removeKeyListeners();
    clearEnvironment();

    // Clean up the angry-KO overlay if it was up
    document.getElementById('angry-ko-overlay')?.remove();

    if (!playerQuit) {
        awardPoints(POINT_EVENTS.finishBonus.pts, POINT_EVENTS.finishBonus.label);
        sfx.finish();
        // Speed bonus for finishing while boosting
        if (raceVars.boostActive) {
            awardPoints(POINT_EVENTS.speedBonus.pts, POINT_EVENTS.speedBonus.label);
        }
    }

    // Transition back to overworld music
    stopMusic(800);
    setTimeout(() => playOverworld(), 900);

    const title   = document.getElementById('end-title');
    const summary = document.getElementById('end-summary');

    let titles;
    let summaryText;
    if (raceVars.deathCause === 'angry') {
        titles = ['💥 WIPED OUT!', '☄️ Cosmic K.O.!', '🌋 Caught You!'];
        summaryText = `An angry sky item ended your run! You still earned ${raceVars.sessionPoints} ⭐. Total: ${gameState.points} ⭐`;
    } else if (playerQuit) {
        titles = ['Better luck next time!', 'See ya!', 'Pit Stop!'];
        summaryText = `You earned ${raceVars.sessionPoints} ⭐ this run! Total: ${gameState.points} ⭐`;
    } else {
        titles = ['SICK DRIVING!', 'You crushed it!', 'Wahoo!', 'Legendary!'];
        summaryText = `You earned ${raceVars.sessionPoints} ⭐ this run! Total: ${gameState.points} ⭐`;
    }
    if (title)   title.textContent   = titles[Math.floor(Math.random() * titles.length)];
    if (summary) summary.textContent = summaryText;

    showScreen('screen-end');
}
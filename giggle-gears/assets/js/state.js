// ════════════════════════════════════════════════════════════════════
//  state.js — Giggle Gears | Base State, Constants & Persistence
// ════════════════════════════════════════════════════════════════════

// Document-relative; resolved against index.html when used as <img src=>.
export const BASE_URL = 'https://fymz.lol/giggle-gears/assets/img/';

// ─── Catalog data ────────────────────────────────────────────────────
export const CAR_BODIES = [
    { id: 'car-one',      label: 'Tiki Torcher',    cost: 0     },
    { id: 'car-two',      label: 'Dino Deep',        cost: 0     },
    { id: 'car-three',    label: 'Jungle Pod',       cost: 0     },
    { id: 'car-four',     label: 'Bone Daddy',       cost: 5000  },
    { id: 'car-five',     label: 'Tamil Drifter',    cost: 10000 },
    { id: 'car-six',      label: 'Spike Hombre',     cost: 15000 },
    { id: 'car-seven',    label: 'Neonrider',        cost: 20000 },
    { id: 'car-eight',    label: 'Gravitron',        cost: 25000 },
    { id: 'car-nine',     label: 'Cratekart',        cost: 30000 },
    { id: 'car-ten',      label: 'Desertmobile',     cost: 35000 },
    { id: 'car-eleven',   label: 'Puddle Jumper',    cost: 40000 },
    { id: 'car-twelve',   label: 'Cyber Cart',       cost: 45000 },
    { id: 'car-thirteen', label: 'Bobbys Car',       cost: 50000 },
    { id: 'car-fourteen', label: 'Clown Shoes',      cost: 55000 },
    { id: 'car-fifteen',  label: 'Crabby Crabskins', cost: 60000 },
];

export const DRIVERS = [
    { file: 'driver-one.png',   label: 'Tub Butter'   },
    { file: 'driver-two.png',   label: 'Fairy Smidge'  },
    { file: 'driver-three.png', label: 'Sponk Thing'   },
    { file: 'driver-four.png',  label: 'Serendipity'  },
    { file: 'driver-five.png',  label: 'Bazibble'      },
    { file: 'driver-six.png',   label: 'Sand Lad'     },
    { file: 'driver-seven.png', label: 'Guy Fiery'     },
    { file: 'driver-eight.png', label: 'Lumpino'       },
    { file: 'driver-nine.png',  label: 'Rock Biter'   },
    { file: 'driver-ten.png',   label: 'Mermessa'     },
];

export const NPC_CARS = [
    'npc-one.png', 'npc-two.png',   'npc-three.png', 'npc-four.png',
    'npc-five.png','npc-six.png',   'npc-seven.png', 'npc-eight.png',
    'npc-nine.png','npc-ten.png',
];

export const NPC_TIERS = {
    crawler: { maxSpeed: 0.5, acceleration: 0.03 },
    sluggish: { maxSpeed: 1.5, acceleration: 0.05 },
    average:  { maxSpeed: 2.8, acceleration: 0.08 },
    zippy:    { maxSpeed: 4.2, acceleration: 0.13 },
    rocket:   { maxSpeed: 5.5, acceleration: 0.18 },
};
export const NPC_TIER_KEYS = Object.keys(NPC_TIERS);

export const UNDERGLOWS = [
    { label: 'Cyan',   color: '#00ffee', cost: 1000  },
    { label: 'Pink',   color: '#ff2d9e', cost: 2000  },
    { label: 'Lime',   color: '#aaff00', cost: 3000  },
    { label: 'Purple', color: '#cc00ff', cost: 4000  },
    { label: 'Orange', color: '#ff7700', cost: 5000  },
    { label: 'Ice',    color: '#aaddff', cost: 6000  },
    { label: 'Gold',   color: '#ffcc00', cost: 7000  },
    { label: 'Red',    color: '#ff2222', cost: 8000  },
    { label: 'Venom',  color: '#33ff55', cost: 9000  },
    { label: 'Ghost',  color: '#ffffff', cost: 10000 },
];

export const EXTRAS = [
    { label: 'Spoiler',        type: 'spoiler',       displayIcon: '📐', cost: 5000  },
    { label: 'Dome',           type: 'dome',          displayIcon: '🛸', cost: 5000  },
    { label: 'Antenna',        type: 'dome',          displayIcon: '📡', cost: 7500  },
    { label: 'Race Wing',      type: 'spoiler',       displayIcon: '🏁', cost: 7500  },
    { label: 'Hover',          type: 'hoverride',     displayIcon: '🌀', cost: 10000 },
    { label: 'Boost Flame',    type: 'boostFlame',    displayIcon: '🔥', cost: 10000 },
    { label: 'Fancy Lights',   type: 'fancyLights',   displayIcon: '💎', cost: 15000 },
    { label: 'Deflect Shield', type: 'deflectShield', displayIcon: '🛡️', cost: 20000 },
];

// ─── Physics / speed constants ────────────────────────────────────────
export const SPEED_BASE       = 2.7;
export const SPEED_BOOST      = 9;
export const SPEED_STEP       = 0.4;
// While boost is held past the base cap, speed keeps creeping up — the
// longer it's on, the harder it gets to control.
export const BOOST_RAMP_RATE  = 0.085;  // accel per frame once past SPEED_BOOST
export const BOOST_MAX_SPEED  = 22;     // hard ceiling — way past comfortable control

// ─── Jump physics — floaty, kid-friendly arc ──────────────────────────
// Lower velocity + much lower gravity = slower, bigger, bouncier arc.
// GRAVITY_BOOST is used during BalaBoost for a floatier "hang" in the air.
export const JUMP_VELOCITY      = -17;   // pops up high enough to reach sky items
export const GRAVITY            = 0.16;  // long floaty hang to clear NPCs
export const GRAVITY_BOOST      = 0.085; // extra hang on boost
export const GROUND_Y_VH        = 6;
export const JUMP_AWARD_PTS     = 50;
export const JUMP_COOLDOWN_BASE = 24;    // slightly longer to feel weighty
export const LEVEL_LENGTH       = 40000;
export const TRACK_DURATION_MS  = 90000;  // 1:30 per track — fixed, only damage ends sooner

// ─── Persistent unlock ledger ─────────────────────────────────────────
let _unlockedItems = JSON.parse(localStorage.getItem('gg_unlocked') || '[]');

export function isUnlocked(key)  { return _unlockedItems.includes(key); }
export function unlockItem(key)  {
    if (!isUnlocked(key)) {
        _unlockedItems.push(key);
        localStorage.setItem('gg_unlocked', JSON.stringify(_unlockedItems));
    }
}

// ─── Game state ───────────────────────────────────────────────────────
const _savedPoints = parseInt(localStorage.getItem('gg_points')) || 0;

export const gameState = {
    driver:           'driver-one.png',
    carId:            'car-one',
    underglowColor:   null,
    track:            'city',
    points:           _savedPoints,
    accessorySpoiler: null,
    accessoryDome:    null,
    lightsOn:         false,
    upgrades: {
        hoverride:     false,
        boostFlame:    false,
        fancyLights:   false,
        deflectShield: false,
    },
};

export function savePoints() {
    localStorage.setItem('gg_points', gameState.points);
}

// ─── Race-time mutable vars ───────────────────────────────────────────
// Exported as a single object so modules can mutate them by reference.
export const raceVars = {
    raceAnimation: null,
    boostActive:   false,
    currentSpeed:  SPEED_BASE,
    roadOffset:    0,
    levelDistance: 0,
    npcs:          [],
    sessionPoints: 0,
    trickCooldown: 0,
    npcSpawnTimer: 0,
    isJumping:     false,
    jumpVelocity:  0,
    jumpOffsetPx:  0,
    jumpCooldown:  0,
    raceStartedAt: 0,
    shieldActive:  false,
    deathCause:    null,   // 'angry' when an angry sky item ended the run
    raceEnded:     false,  // guard so endRace can't fire twice
};

// ─── Shared helpers ───────────────────────────────────────────────────
// Sprite-name helpers — sheet frames are named after the original file stem.
export const carSpriteName    = (id)   => id;
export const driverSpriteName = (file) => file.replace(/\.png$/, '');
export const npcSpriteName    = (file) => file.replace(/\.png$/, '');
export const skySpriteName    = (file) => file.replace(/\.png$/, '');
export const vhToPx           = (vh)   => window.innerHeight * vh / 100;
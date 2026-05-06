// bagawk.js — George's Jump
'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scoreEl       = $('score');
  const fullnessEl    = $('fullness');
  const eatenBadge    = $('eatenBadge');
  const comboEl       = $('combo');
  const comboBadge    = $('comboBadge');
  const timerEl       = $('timer');
  const timerBadge    = timerEl ? timerEl.closest('.badge') : null;
  const bestEl        = $('best');
  const levelEl       = $('level');
  const difficultyEl  = $('difficulty');
  const taskDescEl    = $('taskDesc');
  const restartBtn    = $('restart');
  const muteBtn       = $('mute');
  const skinBtn       = $('skinBtn');
  const scoresBtn     = $('scoresBtn');
  const mascotBtn     = $('mascotBtn');
  const mascotModal   = $('mascotModal');
  const mascotGrid    = $('mascotGrid');
  const mascotCoinsEl = $('mascotCoins');
  const mascotBadge   = $('mascotBadge');
  const mascotHudCanvas = $('mascotHudCanvas');
  const coinBadge     = $('coinBadge');
  const coinsEl       = $('coins');
  const skinModal     = $('skinModal');
  const skinGrid      = $('skinGrid');
  const scoresModal   = $('scoresModal');
  const scoresOverall = $('scoresOverall');
  const scoresList    = $('scoresList');
  const endScreen     = $('endScreen');
  const endTitle      = $('endTitle');
  const endMsg        = $('endMsg');
  const endScore      = $('endScore');
  const endEaten      = $('endEaten');
  const endCombo      = $('endCombo');
  const endNew        = $('endNew');
  const endUnlock     = $('endUnlock');
  const playAgainBtn  = $('playAgain');
  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = H - 10;

  const LEVEL_DURATION_MS = 120000; // 2 min per level
  const SPEEDUP_AT_S = [45, 60];    // seconds elapsed for tier 1 / tier 2
  const FAT_THRESHOLD = 18;         // fullness for fat cutscene

  // Floaty / bouncy flap physics
  //   Press ↑ = wing-flap impulse: vy is clamped DOWN to FLAP_IMPULSE_*
  //     (a fast climb is never slowed by a flap; a fall is cleanly cancelled).
  //     Ground press is springier than mid-air press for that "boing" launch.
  //   Hold ↑ = continuous wing-flutter lift that overpowers gravity slightly,
  //     so kids who keep the key held drift up gently.
  //   Apex float: gravity is halved when |vy| is small, giving extra hang time
  //     at the top of an arc — the classic floaty platformer feel.
  const GRAVITY               = 0.14;
  const APEX_FLOAT_FACTOR     = 0.5;   // gravity multiplier when near the peak
  const APEX_FLOAT_THRESHOLD  = 0.7;   // |vy| below this counts as "at apex"
  const DIVE_GRAVITY_BONUS    = 0.42;  // extra gravity while ↓ held
  const FLAP_IMPULSE_GROUND   = -4.1;  // springy launch from the ground
  const FLAP_IMPULSE_AIR      = -3.2;  // softer mid-air wingbeat
  const HOLD_LIFT             = -0.26; // per-frame upward accel while ↑ held
  const VY_CEILING            = -5.4;  // max upward speed cap
  const VY_TERMINAL           =  4.6;  // max downward speed cap (dive included)

  // Drift zones (lift columns)
  const DRIFT_LIFT             = 0.30;
  const DRIFT_SPAWN_INTERVAL   = 360; // every ~6 seconds at 60fps
  const STATE = { LOADING: -1, READY: 0, PLAY: 1, CUTSCENE: 2 };
  let state = STATE.LOADING;
  let paused = false;

  let score = 0, fullness = 0, capCount = 0, frame = 0;
  let foods = [], particles = [], drifts = [];
  let levelStartTime = 0, timeLeftMs = LEVEL_DURATION_MS, timerTier = 0;
  let cutsceneStart = 0, outcome = null, levelWon = false;
  let lastJumpFrame = -100, lastLandFrame = -100;
  let jumpHeld = false, diveHeld = false;
  let bestComboThisLevel = 0;

  // Per-tier combo counters. Catching tier X bumps combos[X];
  // missing a food of tier X resets combos[X] only.
  let combos = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  function maxComboTier() {
    let tier = 0, count = 0;
    for (const t of [1,2,3,4,5]) {
      if (combos[t] > count) { count = combos[t]; tier = t; }
    }
    return { tier, count };
  }
  function anyComboActive() {
    return combos[1] >= 2 || combos[2] >= 2 || combos[3] >= 2 ||
           combos[4] >= 2 || combos[5] >= 2;
  }

  let best = parseInt(localStorage.getItem('bagawk_best') || '0', 10);
  if (bestEl) bestEl.textContent = best;

  let currentLevel = parseInt(localStorage.getItem('bagawk_level') || '0', 10);
  if (!Number.isFinite(currentLevel) || currentLevel < 0) currentLevel = 0;

  const defaultStats = {
    levelsCleared: 0, maxCombo: 0, totalEaten: 0,
    totalFruits: 0, totalBreakfasts: 0, totalCombos: 0, runs: 0
  };
  let stats;
  try { stats = Object.assign({}, defaultStats, JSON.parse(localStorage.getItem('bagawk_stats') || '{}')); }
  catch { stats = { ...defaultStats }; }
  function saveStats() { localStorage.setItem('bagawk_stats', JSON.stringify(stats)); }

  let levelScores;
  try { levelScores = JSON.parse(localStorage.getItem('bagawk_level_scores') || '{}'); }
  catch { levelScores = {}; }
  function saveLevelScores() { localStorage.setItem('bagawk_level_scores', JSON.stringify(levelScores)); }

  const LEVELS_PER_BATCH = 9;
  const DIFFICULTY = {
    easy:   { spawnInterval: 90,  scrollSpeed: 1.6, label: 'EASY',   className: 'diff-easy' },
    medium: { spawnInterval: 110, scrollSpeed: 2.2, label: 'MEDIUM', className: 'diff-medium' },
    hard:   { spawnInterval: 135, scrollSpeed: 2.9, label: 'HARD',   className: 'diff-hard' }
  };

  const FRUITS = new Set(['grapes', 'apple', 'banana', 'fruit-bowl', 'orange-juice']);
  const isFullBreakfast = (n) =>
    n === 'full-breakfast-one' || n === 'full-breakfast-two' || n === 'full-breakfast-three';

  const TASKS = {
    'free-eat': {
      describe(level, st) { return `Eat as much as you can! (${st.fullness} eaten)`; },
      onCatch() {},
      isWon(level, st)    { return st.fullness >= (level.threshold || 12); },
      canEarlyEnd: false
    },
    'fruits': {
      describe(level, st) { return `Eat ${level.target} fruits  (${st.fruits}/${level.target})`; },
      onCatch(food, st)   { if (FRUITS.has(food.def.name)) st.fruits++; },
      isWon(level, st)    { return st.fruits >= level.target; },
      canEarlyEnd: true
    },
    'breakfasts': {
      describe(level, st) { return `Catch ${level.target} full breakfasts  (${st.breakfasts}/${level.target})`; },
      onCatch(food, st)   { if (isFullBreakfast(food.def.name)) st.breakfasts++; },
      isWon(level, st)    { return st.breakfasts >= level.target; },
      canEarlyEnd: true
    }
  };

  // Each level has a `cap`. Non-combo'd catches past cap give 0 points.
  // Combo'd catches always score AND bypass the cap entirely.
  const LEVEL_BATCHES = [
    [
      { d: 'easy',   task: 'free-eat',   threshold: 8,  cap: 14 },
      { d: 'easy',   task: 'free-eat',   threshold: 12, cap: 18 },
      { d: 'easy',   task: 'fruits',     target: 4,     cap: 8 },
      { d: 'medium', task: 'free-eat',   threshold: 16, cap: 22 },
      { d: 'easy',   task: 'breakfasts', target: 2,     cap: 14 },
      { d: 'easy',   task: 'free-eat',   threshold: 14, cap: 20 },
      { d: 'medium', task: 'fruits',     target: 5,     cap: 10 },
      { d: 'medium', task: 'breakfasts', target: 3,     cap: 18 },
      { d: 'hard',   task: 'free-eat',   threshold: 24, cap: 30 }
    ]
    // Future batches: push another array of 9 here.
  ];
  function getLevel(globalIndex) {
    const batchIdx = Math.floor(globalIndex / LEVELS_PER_BATCH) % LEVEL_BATCHES.length;
    const inBatch  = globalIndex % LEVELS_PER_BATCH;
    return LEVEL_BATCHES[batchIdx][inBatch];
  }

  let levelData = getLevel(currentLevel);
  let taskState = { fullness: 0, fruits: 0, breakfasts: 0 };

  // ============================================================
  // Chicken hitbox (sprite renders relative to this)
  // ============================================================
  const chicken = { x: 40, y: GROUND_Y - 28, vy: 0, w: 24, h: 28 };

  // ============================================================
  // Food point values & on-screen sizes
  // ============================================================
  const FOOD_POINTS = {
    // Light
    'grapes': 1, 'apple': 1, 'banana': 1, 'butter': 1, 'syrup': 1,
    'coffee': 1, 'milk': 1, 'orange-juice': 1,
    // Medium
    'oatmeal': 2, 'cereal': 2, 'granola': 2, 'fruit-bowl': 2,
    'breakfast-bowl': 2, 'bacon': 2, 'sausae-patty': 2,
    // Heavy
    'eggs-toast': 3, 'french-toast': 3, 'waffles': 3, 'pancakces': 3, 'sausages': 3,
    // Combos
    'bacon-eggs': 4,
    // Full breakfasts
    'full-breakfast-one': 5, 'full-breakfast-two': 5, 'full-breakfast-three': 5
  };
  const SIZE_BY_PTS = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 16 };

  // ============================================================
  // Skins registry
  //
  // To add a new skin: drop a sprite sheet that uses the same frame
  // names as george-moves.json (walk-one/two/three, run-one/two/three,
  // jump-one/two/three, land-one/two/three) and add an entry below
  // with an `unlock(stats)` predicate.
  // ============================================================
  const SKINS = {
    default: {
      id: 'default',
      name: 'George',
      desc: 'The original chicken.',
      src:  'assets/sprites/george-moves.png',
      json: 'assets/sprites/george-moves.json',
      unlock: () => true,
      requirement: 'Available'
    }
    // Examples for future skins:
    // chefHat: {
    //   id: 'chefHat', name: 'Chef George', desc: 'Knows his way around the kitchen.',
    //   src: 'assets/sprites/george-chef.png', json: 'assets/sprites/george-chef.json',
    //   unlock: s => (s.totalEaten || 0) >= 100,
    //   requirement: 'Eat 100 foods total'
    // },
    // berryKing: {
    //   id: 'berryKing', name: 'Fruit King', desc: 'Crowned by the orchard.',
    //   src: 'assets/sprites/george-fruit.png', json: 'assets/sprites/george-fruit.json',
    //   unlock: s => (s.totalFruits || 0) >= 50,
    //   requirement: 'Eat 50 fruits total'
    // },
  };

  let currentSkinId = localStorage.getItem('bagawk_skin') || 'default';
  if (!SKINS[currentSkinId] || !SKINS[currentSkinId].unlock(stats)) currentSkinId = 'default';

  // ============================================================
  // Mascot costumes — buy with coins, equipped one shows on the HUD.
  // Frame names match costumes.json. Cost = how many coins to unlock.
  // ============================================================
  const MASCOTS = [
    { id: 'roast',   name: 'Roast George',  frame: 'costume (3)',  cost: 100  },
    { id: 'pumpkin', name: 'Pumpkin George',frame: 'costume (9)',  cost: 200  },
    { id: 'cowboy',  name: 'Cowboy George', frame: 'costume (11)', cost: 300  },
    { id: 'pirate',  name: 'Pirate George', frame: 'costume (4)',  cost: 500  },
    { id: 'santa',   name: 'Santa George',  frame: 'costume (8)',  cost: 750  },
    { id: 'ninja',   name: 'Ninja George',  frame: 'costume (2)',  cost: 1000 },
    { id: 'disco',   name: 'Disco George',  frame: 'costume (5)',  cost: 1500 },
    { id: 'knight',  name: 'Knight George', frame: 'costume (12)', cost: 2000 },
    { id: 'count',   name: 'Count George',  frame: 'costume (1)',  cost: 2500 },
    { id: 'mecha',   name: 'Mecha George',  frame: 'costume (6)',  cost: 3500 },
    { id: 'cyber',   name: 'Cyber George',  frame: 'costume (10)', cost: 5000 },
    { id: 'astro',   name: 'Astro George',  frame: 'costume (7)',  cost: 7500 }
  ];
  const MASCOT_BY_ID = Object.fromEntries(MASCOTS.map(m => [m.id, m]));

  let coins = parseInt(localStorage.getItem('bagawk_coins') || '0', 10);
  if (!Number.isFinite(coins) || coins < 0) coins = 0;

  let ownedMascots = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem('bagawk_mascots_owned') || '[]');
    if (Array.isArray(raw)) ownedMascots = new Set(raw.filter(id => MASCOT_BY_ID[id]));
  } catch { ownedMascots = new Set(); }
  function saveOwnedMascots() {
    localStorage.setItem('bagawk_mascots_owned', JSON.stringify([...ownedMascots]));
  }
  function saveCoins() { localStorage.setItem('bagawk_coins', String(coins)); }

  let equippedMascot = localStorage.getItem('bagawk_mascot_equipped') || '';
  if (equippedMascot && (!MASCOT_BY_ID[equippedMascot] || !ownedMascots.has(equippedMascot))) {
    equippedMascot = '';
  }
  function saveEquippedMascot() {
    localStorage.setItem('bagawk_mascot_equipped', equippedMascot || '');
  }

  // Mascot sprite sheet — drawn separately because the costumes share one big PNG
  const mascotSheet = { img: new Image(), ready: false, frames: null };
  function loadMascotSheet() {
    return Promise.all([
      new Promise(resolve => {
        mascotSheet.img.addEventListener('load', () => { mascotSheet.ready = true; resolve(); }, { once: true });
        mascotSheet.img.addEventListener('error', () => resolve(), { once: true });
        mascotSheet.img.src = 'assets/sprites/costumes.png';
      }),
      fetch('assets/sprites/costumes.json')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) mascotSheet.frames = d.frames; })
        .catch(() => {})
    ]);
  }
  loadMascotSheet().then(renderHudMascot);

  // ============================================================
  // Sprite sheets: food-one, food-two, and the active george skin
  // ============================================================
  const sheets = {
    one:    { img: new Image(), ready: false, src: 'assets/sprites/food-one.png',  json: 'assets/sprites/food-one.json',  frames: null },
    two:    { img: new Image(), ready: false, src: 'assets/sprites/food-two.png',  json: 'assets/sprites/food-two.json',  frames: null },
    george: { img: new Image(), ready: false, src: SKINS[currentSkinId].src,        json: SKINS[currentSkinId].json,        frames: null }
  };
  let foodCatalog = [];

  function loadSheet(key) {
    const s = sheets[key];
    s.ready = false;
    s.frames = null;
    const imgP = new Promise((resolve) => {
      const onLoad = () => { s.ready = true; cleanup(); resolve(); };
      const onErr  = () => { cleanup(); resolve(); };
      const cleanup = () => {
        s.img.removeEventListener('load', onLoad);
        s.img.removeEventListener('error', onErr);
      };
      s.img.addEventListener('load', onLoad);
      s.img.addEventListener('error', onErr);
      // Cache-bust on re-load (skin swap) so the browser actually fetches.
      const sameSrc = s.img.src && s.img.src.endsWith(s.src);
      s.img.src = sameSrc ? `${s.src}?t=${Date.now()}` : s.src;
    });
    const jsonP = fetch(s.json)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) s.frames = data.frames; })
      .catch(() => {});
    return Promise.all([imgP, jsonP]);
  }

  function loadGeorgeSheet() {
    sheets.george.src  = SKINS[currentSkinId].src;
    sheets.george.json = SKINS[currentSkinId].json;
    return loadSheet('george');
  }

  Promise.all([loadSheet('one'), loadSheet('two'), loadSheet('george')]).then(() => {
    foodCatalog = buildCatalog();
    state = STATE.READY;
    applyLevelToHUD();
  });

  function buildCatalog() {
    const out = [];
    for (const key of ['one', 'two']) {
      const s = sheets[key];
      if (!s.ready || !s.frames) continue;
      for (const [name, def] of Object.entries(s.frames)) {
        const pts = FOOD_POINTS[name];
        if (!pts) continue;
        out.push({
          name, sheet: key,
          sx: def.frame.x, sy: def.frame.y, sw: def.frame.w, sh: def.frame.h,
          pts
        });
      }
    }
    return out;
  }

  // ============================================================
  // Audio
  // ============================================================
  let muted = localStorage.getItem('bagawk_muted') === '1';

  const SFX = {
    bagawk: ['assets/audio/bagawk-one.mp3', 'assets/audio/bagawk-two.mp3'],
    cluck:  ['assets/audio/cluck-one.mp3', 'assets/audio/cluck-two.mp3', 'assets/audio/cluck-three.mp3', 'assets/audio/cluck-four.mp3']
  };
  const sfxPool = {};
  for (const [k, paths] of Object.entries(SFX)) {
    sfxPool[k] = paths.map(p => {
      const a = new Audio(p); a.preload = 'auto'; a.volume = 0.55; return a;
    });
  }
  function playRandom(name, vol = 0.55) {
    if (muted) return;
    const pool = sfxPool[name];
    if (!pool || !pool.length) return;
    const a = pool[Math.floor(Math.random() * pool.length)];
    try { a.currentTime = 0; a.volume = vol; a.play().catch(() => {}); } catch (_) {}
  }

  const music = new Audio('assets/audio/overworld-music.mp3');
  music.loop = true; music.volume = 0.35;
  let musicAvailable = true;
  music.addEventListener('error', () => { musicAvailable = false; }, { once: true });
  function startMusic() {
    if (muted || !musicAvailable) return;
    try { music.currentTime = 0; music.play().catch(() => {}); } catch (_) {}
  }
  function pauseMusic()  { try { music.pause(); } catch (_) {} }
  function resumeMusic() {
    if (muted || !musicAvailable) return;
    try { music.play().catch(() => {}); } catch (_) {}
  }
  function stopMusic()   { try { music.pause(); music.currentTime = 0; } catch (_) {} }

  function applyMuteUI() {
    if (!muteBtn) return;
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn.title = muted ? 'Unmute (M)' : 'Mute (M)';
    muteBtn.innerHTML = muted ? '&#9834;&#x0338;' : '&#9834;';
  }
  function toggleMute() {
    muted = !muted;
    localStorage.setItem('bagawk_muted', muted ? '1' : '0');
    if (muted) pauseMusic();
    else if (state === STATE.PLAY && !paused) resumeMusic();
    applyMuteUI();
  }
  applyMuteUI();

  // ============================================================
  // Spawning
  // ============================================================
  function spawnFood() {
    if (!foodCatalog.length) return;
    const f = foodCatalog[Math.floor(Math.random() * foodCatalog.length)];
    const w = SIZE_BY_PTS[f.pts] || 18;
    const h = w * (f.sh / f.sw);

    // Spawn in three vertical bands so flying actually matters: ~35% high
    // (need to climb), ~35% low (snatch on the run), ~30% middle.
    const minY = 4;
    const maxY = GROUND_Y - h - 4;
    const span = Math.max(0, maxY - minY);
    const r = Math.random();
    let y;
    if (r < 0.35) {
      // High band — top quarter of the play area
      y = minY + Math.random() * (span * 0.25);
    } else if (r < 0.70) {
      // Low band — bottom quarter, just above the floor
      y = minY + span * 0.75 + Math.random() * (span * 0.25);
    } else {
      // Middle band — anywhere in between
      y = minY + span * 0.30 + Math.random() * (span * 0.40);
    }

    foods.push({
      def: f, x: W + 10, y,
      w, h, pts: f.pts, passed: false
    });
  }

  function spawnDrift() {
    const w = 18 + Math.random() * 12;
    const h = GROUND_Y - 16;
    drifts.push({
      x: W + 10, y: 8, w, h,
      feathers: Array.from({ length: 8 }, () => ({
        ox: Math.random() * w,
        oy: Math.random() * h,
        size: 2 + Math.random() * 2,
        rate: 0.5 + Math.random() * 0.7
      })),
      t0: frame
    });
  }

  // ============================================================
  // George frame state machine — uses the 3-frame walk/run/jump/land
  // sets from george-moves.json and ties them to physics + game state.
  // ============================================================
  function getGeorgeFrame() {
    const sheet = sheets.george;
    if (!sheet.ready || !sheet.frames) return null;
    const has = (n) => !!sheet.frames[n];
    const firstFrame = () => Object.keys(sheet.frames)[0];

    if (state === STATE.LOADING || state === STATE.READY) {
      return has('walk-one') ? 'walk-one' : firstFrame();
    }

    if (state === STATE.CUTSCENE) {
      const t = Date.now() - cutsceneStart;
      if (outcome === 'fat') {
        if (t < 600  && has('land-one'))   return 'land-one';
        if (t < 1200 && has('land-two'))   return 'land-two';
        if (has('land-three')) return 'land-three';
      }
      return has('walk-one') ? 'walk-one' : firstFrame();
    }

    // PLAY
    const onGround = chicken.y >= GROUND_Y - chicken.h - 0.5;
    if (!onGround) {
      // Air pose driven by vertical velocity:
      //   vy << 0  → ascent     (jump-one)
      //   vy ≈ 0   → peak/drift (jump-two)
      //   vy >> 0  → descent    (jump-three)
      if (chicken.vy < -1.5 && has('jump-one'))   return 'jump-one';
      if (chicken.vy >  1.5 && has('jump-three')) return 'jump-three';
      return has('jump-two') ? 'jump-two'
           : has('jump-one') ? 'jump-one'
           : firstFrame();
    }

    // Just-landed cycle (3 frames over ~18 game frames)
    const sinceLand = frame - lastLandFrame;
    if (sinceLand < 6  && has('land-one'))   return 'land-one';
    if (sinceLand < 12 && has('land-two'))   return 'land-two';
    if (sinceLand < 18 && has('land-three')) return 'land-three';

    // Default ground motion. Switch to RUN when the timer enters a
    // speedup tier OR any combo is active — links new animation to
    // existing tempo / combo systems.
    const fast = timerTier > 0 || anyComboActive();
    if (fast && has('run-one') && has('run-two') && has('run-three')) {
      const cycle = ['run-one', 'run-two', 'run-three', 'run-two'];
      return cycle[Math.floor(frame / 6) % cycle.length];
    }
    const cycle = ['walk-one', 'walk-two', 'walk-three', 'walk-two'];
    if (!cycle.every(has)) return has('walk-one') ? 'walk-one' : firstFrame();
    return cycle[Math.floor(frame / 10) % cycle.length];
  }

  function renderGeorge() {
    const sheet = sheets.george;
    if (!sheet.ready || !sheet.frames) return;
    const name = getGeorgeFrame();
    if (!name) return;
    const def = sheet.frames[name];
    if (!def) return;

    // Landing frames are squat-ish — give them slightly more vertical room.
    const isSeated = name.startsWith('land-');
    const targetH = isSeated ? Math.round(chicken.h * 1.15) : chicken.h;
    const ar = def.frame.w / def.frame.h;
    const drawH = targetH;
    const drawW = Math.round(drawH * ar);
    const drawX = Math.round(chicken.x + chicken.w / 2 - drawW / 2);
    const drawY = Math.round((chicken.y + chicken.h) - drawH);

    ctx.drawImage(sheet.img,
      def.frame.x, def.frame.y, def.frame.w, def.frame.h,
      drawX, drawY, drawW, drawH
    );
  }

  // ============================================================
  // Particles (score popups)
  // ============================================================
  function spawnPopup(x, y, text, color) {
    particles.push({ x, y, vy: -0.6, life: 60, text, color });
  }
  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.y += p.vy; p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ============================================================
  // HUD updates
  // ============================================================
  const TIER_COLOR = { 1: '#cfcfcf', 2: '#7cf99c', 3: '#00ffcc', 4: '#ffd166', 5: '#ff5cf0' };

  function updateComboHUD(poppedTier) {
    if (!comboBadge) return;
    const { tier, count } = maxComboTier();
    comboBadge.classList.remove('combo-tier-1', 'combo-tier-2', 'combo-tier-3', 'combo-tier-4', 'combo-tier-5');
    if (count < 2) {
      comboBadge.hidden = true;
      return;
    }
    comboBadge.hidden = false;
    comboBadge.classList.add(`combo-tier-${tier}`);
    if (comboEl) comboEl.textContent = `x${count} (${tier}pt)`;
    if (poppedTier === tier) {
      comboBadge.classList.remove('combo-pop');
      void comboBadge.offsetWidth;
      comboBadge.classList.add('combo-pop');
    }
  }

  function updateEatenHUD() {
    if (!fullnessEl) return;
    const cap = (levelData && levelData.cap) ? levelData.cap : 0;
    fullnessEl.textContent = cap > 0 ? `${capCount}/${cap}` : `${fullness}`;
    if (eatenBadge) {
      eatenBadge.classList.remove('cap-near', 'cap-over');
      if (cap > 0) {
        if (capCount > cap) eatenBadge.classList.add('cap-over');
        else if (capCount >= Math.floor(cap * 0.75)) eatenBadge.classList.add('cap-near');
      }
    }
  }

  function updateCoinsHUD(popped) {
    if (coinsEl) coinsEl.textContent = coins;
    if (mascotCoinsEl) mascotCoinsEl.textContent = coins;
    if (popped && coinBadge) {
      coinBadge.classList.remove('coin-pop');
      void coinBadge.offsetWidth;
      coinBadge.classList.add('coin-pop');
    }
  }

  function renderHudMascot() {
    if (!mascotBadge || !mascotHudCanvas) return;
    if (!equippedMascot) { mascotBadge.hidden = true; return; }
    const m = MASCOT_BY_ID[equippedMascot];
    if (!m || !mascotSheet.ready || !mascotSheet.frames) {
      mascotBadge.hidden = true;
      return;
    }
    const def = mascotSheet.frames[m.frame];
    if (!def) { mascotBadge.hidden = true; return; }
    const c = mascotHudCanvas.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.clearRect(0, 0, mascotHudCanvas.width, mascotHudCanvas.height);
    c.drawImage(mascotSheet.img,
      def.frame.x, def.frame.y, def.frame.w, def.frame.h,
      0, 0, mascotHudCanvas.width, mascotHudCanvas.height
    );
    mascotBadge.hidden = false;
    mascotBadge.title = `Mascot: ${m.name}`;
  }

  function updateTimerTier(secLeft) {
    const elapsed = (LEVEL_DURATION_MS / 1000) - secLeft;
    let tier = 0;
    if (elapsed >= SPEEDUP_AT_S[1]) tier = 2;
    else if (elapsed >= SPEEDUP_AT_S[0]) tier = 1;
    if (tier === timerTier) return;
    timerTier = tier;
    if (!timerBadge) return;
    timerBadge.classList.remove('timer-warn1', 'timer-warn2', 'timer-warn3');
    if (tier > 0) timerBadge.classList.add('timer-warn' + tier);
  }

  function updateTaskUI() {
    if (!taskDescEl || !levelData) return;
    taskDescEl.textContent = TASKS[levelData.task].describe(levelData, taskState);
  }

  function applyLevelToHUD() {
    if (levelEl) levelEl.textContent = String(currentLevel + 1);
    if (difficultyEl) {
      const d = DIFFICULTY[levelData.d];
      difficultyEl.textContent = d.label;
      difficultyEl.className = 'diff ' + d.className;
    }
    updateTaskUI();
    updateEatenHUD();
    updateComboHUD();
    if (timerEl) timerEl.textContent = Math.ceil(LEVEL_DURATION_MS / 1000);
    if (timerBadge) timerBadge.classList.remove('timer-warn1', 'timer-warn2', 'timer-warn3');
    timerTier = 0;
  }

  // ============================================================
  // Game loop — physics, collisions, spawning
  // ============================================================
  function update() {
    if (state !== STATE.PLAY || paused) return;
    frame++;

    // --- Flap-based physics: gravity always, continuous lift while ↑ held ---
    // Apex float: scale gravity down when George is near the top of his arc,
    // so jumps hang in the air for an extra heartbeat.
    let g = GRAVITY;
    if (Math.abs(chicken.vy) < APEX_FLOAT_THRESHOLD) g *= APEX_FLOAT_FACTOR;
    chicken.vy += g;
    if (jumpHeld) chicken.vy += HOLD_LIFT;
    if (diveHeld) chicken.vy += DIVE_GRAVITY_BONUS;

    // Velocity caps so flap stacking can't yeet George into orbit
    if (chicken.vy < VY_CEILING)  chicken.vy = VY_CEILING;
    if (chicken.vy > VY_TERMINAL) chicken.vy = VY_TERMINAL;

    // --- Drift zones: scroll & apply lift if chicken inside ---
    const diff = DIFFICULTY[levelData.d];
    for (let i = drifts.length - 1; i >= 0; i--) {
      const d = drifts[i];
      d.x -= diff.scrollSpeed;
      if (chicken.x < d.x + d.w &&
          chicken.x + chicken.w > d.x &&
          chicken.y < d.y + d.h &&
          chicken.y + chicken.h > d.y) {
        chicken.vy -= DRIFT_LIFT;
        if (chicken.vy < VY_CEILING) chicken.vy = VY_CEILING;
      }
      if (d.x + d.w < 0) drifts.splice(i, 1);
    }

    // --- Position update + ground / ceiling clamp ---
    chicken.y += chicken.vy;
    if (chicken.y < 0) { chicken.y = 0; if (chicken.vy < 0) chicken.vy = 0; }
    let justLanded = false;
    if (chicken.y > GROUND_Y - chicken.h) {
      if (chicken.vy > 0.5) justLanded = true;
      chicken.y = GROUND_Y - chicken.h;
      chicken.vy = 0;
    }
    if (justLanded) lastLandFrame = frame;

    // --- Timer ---
    timeLeftMs = Math.max(0, LEVEL_DURATION_MS - (Date.now() - levelStartTime));
    const secLeft = Math.ceil(timeLeftMs / 1000);
    if (timerEl) timerEl.textContent = secLeft;
    updateTimerTier(secLeft);
    if (timeLeftMs <= 0) { endLevel(false); return; }

    // --- Spawning ---
    if (frame % diff.spawnInterval === 0) spawnFood();
    if (frame % DRIFT_SPAWN_INTERVAL === 0) spawnDrift();

    const task = TASKS[levelData.task];

    // --- Food: collisions and miss detection ---
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      f.x -= diff.scrollSpeed;

      const collided = chicken.x < f.x + f.w &&
                       chicken.x + chicken.w > f.x &&
                       chicken.y < f.y + f.h &&
                       chicken.y + chicken.h > f.y;

      if (collided) {
        // Per-tier combo: increment THIS tier; cap at 10x
        combos[f.pts] = Math.min((combos[f.pts] || 0) + 1, 10);
        const streak = combos[f.pts];
        const isCombo = streak >= 2;

        // Score + cap rules:
        //  - Combo'd catch: full pts × streak multiplier, bypasses cap
        //  - Non-combo catch: contributes to capCount; past cap → 0 pts
        const cap = levelData.cap || 0;
        let pointsEarned = isCombo ? f.pts * streak : f.pts;

        if (!isCombo && cap > 0) {
          const before = capCount;
          capCount += f.pts;
          if (before >= cap) {
            pointsEarned = 0;
          } else if (capCount > cap) {
            const overflow = capCount - cap;
            pointsEarned = Math.max(0, f.pts - overflow);
          }
        }

        score += pointsEarned;
        if (pointsEarned > 0) {
          coins += pointsEarned;
          saveCoins();
          updateCoinsHUD(true);
        }
        fullness += f.pts;
        taskState.fullness = fullness;
        task.onCatch(f, taskState);

        // Stats
        stats.totalEaten = (stats.totalEaten || 0) + 1;
        if (FRUITS.has(f.def.name)) stats.totalFruits = (stats.totalFruits || 0) + 1;
        if (isFullBreakfast(f.def.name)) stats.totalBreakfasts = (stats.totalBreakfasts || 0) + 1;
        if (streak === 3) stats.totalCombos = (stats.totalCombos || 0) + 1;
        if (streak > (stats.maxCombo || 0)) stats.maxCombo = streak;
        if (streak > bestComboThisLevel) bestComboThisLevel = streak;

        // Popup & sfx
        const popText = pointsEarned > 0
          ? (isCombo ? `+${pointsEarned} x${streak}` : `+${pointsEarned}`)
          : '...';
        const popColor = isCombo
          ? TIER_COLOR[f.pts]
          : (f.pts >= 4 ? '#ffd166' : (f.pts >= 3 ? '#00ffcc' : '#ffffff'));
        spawnPopup(f.x + f.w / 2, f.y, popText, popColor);
        if (f.pts >= 5) playRandom('bagawk', 0.6);
        else playRandom('cluck', 0.5);

        foods.splice(i, 1);
        if (scoreEl) scoreEl.textContent = score;
        updateEatenHUD();
        updateComboHUD(f.pts);
        updateTaskUI();

        if (task.canEarlyEnd && task.isWon(levelData, taskState)) {
          endLevel(true);
          return;
        }
        continue;
      }

      // Miss: food fully passed George without being caught → reset that tier's combo
      if (!f.passed && f.x + f.w < chicken.x) {
        f.passed = true;
        if ((combos[f.pts] || 0) > 0) {
          combos[f.pts] = 0;
          updateComboHUD();
        }
      }

      if (f.x + f.w < 0) foods.splice(i, 1);
    }

    updateParticles();
  }

  // ============================================================
  // Render
  // ============================================================
  function render() {
    ctx.clearRect(0, 0, W, H);

    // Drift zones (behind food) — translucent cyan column with rising feathers + glowing edges
    for (const d of drifts) {
      // Soft column body
      ctx.fillStyle = 'rgba(0, 255, 204, 0.10)';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      // Brighter glowing edges (top + bottom + sides)
      ctx.fillStyle = 'rgba(0, 255, 204, 0.45)';
      ctx.fillRect(d.x, d.y, 1, d.h);
      ctx.fillRect(d.x + d.w - 1, d.y, 1, d.h);
      // Rising feathers
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      for (const fe of d.feathers) {
        const t = (frame - d.t0) * fe.rate;
        const yOff = ((fe.oy - t) % d.h + d.h) % d.h;
        ctx.beginPath();
        ctx.ellipse(d.x + fe.ox, d.y + yOff, fe.size, fe.size * 0.55, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Up-arrow chevron at the top to make it read as "lift"
      ctx.strokeStyle = 'rgba(0, 255, 204, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(d.x + 2,         d.y + 6);
      ctx.lineTo(d.x + d.w / 2,   d.y + 1);
      ctx.lineTo(d.x + d.w - 2,   d.y + 6);
      ctx.stroke();
    }

    // Foods
    for (const f of foods) {
      const s = sheets[f.def.sheet];
      if (s && s.ready) {
        ctx.drawImage(s.img, f.def.sx, f.def.sy, f.def.sw, f.def.sh, f.x, f.y, f.w, f.h);
      } else {
        ctx.fillStyle = '#ff00aa';
        ctx.fillRect(f.x, f.y, f.w, f.h);
      }
    }

    renderGeorge();

    // Score popups
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / 60);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    if (state === STATE.LOADING) {
      ctx.fillStyle = '#00ffcc';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LOADING…', W / 2, H / 2);
    } else if (state === STATE.READY) {
      ctx.fillStyle = '#00ffcc';
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('TAP  ↑  TO FLAP', W / 2, H / 2 - 14);
      ctx.font = '10px monospace';
      ctx.fillText('Tap fast to FLY higher  ·  ↓  to DIVE', W / 2, H / 2 + 2);
      ctx.fillStyle = 'rgba(0, 255, 204, 0.7)';
      ctx.fillText('or tap the screen', W / 2, H / 2 + 16);
    } else if (state === STATE.PLAY) {
      drawCountdownOverlay();
    }
  }

  function drawCountdownOverlay() {
    const secLeft = Math.ceil(timeLeftMs / 1000);
    if (secLeft > 5 || secLeft <= 0) return;
    const subSec = (timeLeftMs % 1000) / 1000;
    const grow   = 1 + (1 - subSec) * 0.6;
    const alpha  = Math.max(0.2, subSec * 0.95 + 0.05);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2 + 6);
    ctx.scale(grow, grow);
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(String(secLeft), 2, 2);
    ctx.fillStyle = '#ff3344';
    ctx.fillText(String(secLeft), 0, 0);
    ctx.restore();
  }

  // ============================================================
  // Controls — flap impulse + dive
  // ============================================================
  function applyFlap() {
    // Clamp vy DOWN to the impulse floor — never slows an already-faster climb,
    // and cleanly cancels a fall. Ground launches use a springier impulse than
    // mid-air wingbeats so jumping off the floor has a satisfying "boing".
    const onGround = chicken.y >= GROUND_Y - chicken.h - 0.5;
    const impulse = onGround ? FLAP_IMPULSE_GROUND : FLAP_IMPULSE_AIR;
    if (chicken.vy > impulse) chicken.vy = impulse;
    lastJumpFrame = frame;
  }

  function jumpStart() {
    if (state === STATE.LOADING) return;
    if (paused) return;
    if (state === STATE.READY) {
      state = STATE.PLAY;
      levelStartTime = Date.now();
      timeLeftMs = LEVEL_DURATION_MS;
      startMusic();
    }
    if (state === STATE.PLAY) {
      applyFlap();
    }
    jumpHeld = true;
  }
  function jumpRelease() { jumpHeld = false; }
  function diveStart()   { if (state === STATE.PLAY && !paused) diveHeld = true; }
  function diveEnd()     { diveHeld = false; }

  // ============================================================
  // End-of-level
  // ============================================================
  let pendingNewBest = false;
  let pendingUnlocks = [];

  function endLevel(taskComplete) {
    state = STATE.CUTSCENE;
    cutsceneStart = Date.now();
    stopMusic();

    const task = TASKS[levelData.task];
    const won = taskComplete || task.isWon(levelData, taskState);
    levelWon = won;
    const gotFatter = fullness >= FAT_THRESHOLD;
    outcome = gotFatter ? 'fat' : 'slim';

    // Overall best
    if (score > best) {
      best = score;
      localStorage.setItem('bagawk_best', String(best));
      if (bestEl) bestEl.textContent = best;
    }

    // Per-level best
    const prevLevelBest = levelScores[currentLevel] || 0;
    pendingNewBest = score > prevLevelBest && score > 0;
    if (pendingNewBest) {
      levelScores[currentLevel] = score;
      saveLevelScores();
    }

    // Stats + unlocks
    if (won) stats.levelsCleared = Math.max(stats.levelsCleared || 0, currentLevel + 1);
    stats.runs = (stats.runs || 0) + 1;
    pendingUnlocks = checkNewUnlocks();
    saveStats();

    if (won) {
      currentLevel++;
      localStorage.setItem('bagawk_level', String(currentLevel));
    }

    if (endTitle) endTitle.textContent = won ? `LEVEL ${currentLevel} CLEAR!` : `LEVEL ${currentLevel + 1} FAILED`;
    if (endMsg) {
      if (won) {
        endMsg.textContent = gotFatter
          ? 'Task complete — and stuffed to bursting.'
          : 'Task complete — George stayed light on his feet.';
      } else {
        endMsg.textContent = `Task incomplete: ${task.describe(levelData, taskState)}`;
      }
    }
    if (endScore) endScore.textContent = score;
    if (endEaten) endEaten.textContent = fullness;
    if (endCombo) endCombo.textContent = `x${bestComboThisLevel || 1}`;
    if (endNew) endNew.hidden = !pendingNewBest;
    if (endUnlock) {
      if (pendingUnlocks.length) {
        endUnlock.hidden = false;
        endUnlock.textContent = `New skin unlocked: ${pendingUnlocks.map(u => u.name).join(', ')}`;
      } else {
        endUnlock.hidden = true;
      }
    }
    if (playAgainBtn) playAgainBtn.textContent = won ? 'Next Level' : 'Try Again';

    setTimeout(() => {
      if (endScreen) endScreen.hidden = false;
    }, gotFatter ? 1300 : 700);
  }

  function getUnlockedSet() {
    const set = new Set();
    for (const [id, sk] of Object.entries(SKINS)) {
      if (sk.unlock(stats)) set.add(id);
    }
    return set;
  }
  let knownUnlocked = getUnlockedSet();
  function checkNewUnlocks() {
    const now = getUnlockedSet();
    const newlyUnlocked = [];
    for (const id of now) {
      if (!knownUnlocked.has(id)) newlyUnlocked.push(SKINS[id]);
    }
    knownUnlocked = now;
    return newlyUnlocked;
  }

  // ============================================================
  // Reset (Next level / Try again / R key)
  // ============================================================
  function reset() {
    levelData = getLevel(currentLevel);
    taskState = { fullness: 0, fruits: 0, breakfasts: 0 };
    score = 0;
    fullness = 0;
    capCount = 0;
    chicken.y = GROUND_Y - chicken.h;
    chicken.vy = 0;
    foods = [];
    particles = [];
    drifts = [];
    timeLeftMs = LEVEL_DURATION_MS;
    lastJumpFrame = -100;
    lastLandFrame = -100;
    jumpHeld = false;
    diveHeld = false;
    cutsceneStart = 0;
    outcome = null;
    levelWon = false;
    bestComboThisLevel = 0;
    combos = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (state !== STATE.LOADING) state = STATE.READY;
    if (endScreen) endScreen.hidden = true;
    if (scoreEl) scoreEl.textContent = '0';
    applyLevelToHUD();
  }

  // ============================================================
  // Skin select modal
  // ============================================================
  function openSkinModal() {
    if (!skinModal) return;
    paused = true;
    pauseMusic();
    renderSkinGrid();
    skinModal.hidden = false;
  }
  function closeSkinModal() {
    if (!skinModal) return;
    skinModal.hidden = true;
    paused = false;
    if (state === STATE.PLAY) resumeMusic();
  }
  function renderSkinGrid() {
    if (!skinGrid) return;
    skinGrid.innerHTML = '';
    for (const sk of Object.values(SKINS)) {
      const unlocked = sk.unlock(stats);
      const equipped = sk.id === currentSkinId;
      const card = document.createElement('div');
      card.className = 'skin-card' + (equipped ? ' equipped' : '') + (unlocked ? '' : ' locked');
      const thumbStyle = unlocked ? ` style="background-image:url('${sk.src}')"` : '';
      card.innerHTML = `
        <div class="skin-name">${sk.name}</div>
        <div class="skin-thumb"${thumbStyle}></div>
        <div class="skin-desc">${unlocked ? sk.desc : sk.requirement}</div>
        <div class="skin-status">${equipped ? 'EQUIPPED' : (unlocked ? 'TAP TO EQUIP' : 'LOCKED')}</div>
      `;
      if (unlocked && !equipped) card.addEventListener('click', () => equipSkin(sk.id));
      skinGrid.appendChild(card);
    }
  }
  function equipSkin(id) {
    if (!SKINS[id] || !SKINS[id].unlock(stats)) return;
    currentSkinId = id;
    localStorage.setItem('bagawk_skin', id);
    loadGeorgeSheet().then(() => {
      renderSkinGrid();
    });
  }

  // ============================================================
  // Mascot shop modal
  // ============================================================
  function openMascotModal() {
    if (!mascotModal) return;
    paused = true;
    pauseMusic();
    renderMascotGrid();
    updateCoinsHUD();
    mascotModal.hidden = false;
  }
  function closeMascotModal() {
    if (!mascotModal) return;
    mascotModal.hidden = true;
    paused = false;
    if (state === STATE.PLAY) resumeMusic();
  }
  function drawMascotThumb(canvasEl, frameName) {
    const def = mascotSheet.frames && mascotSheet.frames[frameName];
    if (!def || !mascotSheet.ready) return;
    const c = canvasEl.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.clearRect(0, 0, canvasEl.width, canvasEl.height);
    c.drawImage(mascotSheet.img,
      def.frame.x, def.frame.y, def.frame.w, def.frame.h,
      0, 0, canvasEl.width, canvasEl.height
    );
  }
  function renderMascotGrid() {
    if (!mascotGrid) return;
    mascotGrid.innerHTML = '';

    // Optional "no mascot" tile so the player can clear their pick
    const noneCard = document.createElement('div');
    const noneEquipped = !equippedMascot;
    noneCard.className = 'mascot-card owned' + (noneEquipped ? ' equipped' : '');
    noneCard.innerHTML = `
      <div class="mascot-thumb" style="display:flex;align-items:center;justify-content:center;color:#888;font-size:0.7rem;">NONE</div>
      <div class="mascot-name">No Mascot</div>
      <div class="mascot-status">${noneEquipped ? 'EQUIPPED' : 'TAP TO REMOVE'}</div>
    `;
    if (!noneEquipped) {
      noneCard.addEventListener('click', () => {
        equippedMascot = '';
        saveEquippedMascot();
        renderHudMascot();
        renderMascotGrid();
      });
    }
    mascotGrid.appendChild(noneCard);

    for (const m of MASCOTS) {
      const owned = ownedMascots.has(m.id);
      const equipped = equippedMascot === m.id;
      const affordable = coins >= m.cost;
      const card = document.createElement('div');
      let cls = 'mascot-card';
      if (equipped) cls += ' equipped';
      else if (owned) cls += ' owned';
      else cls += ' locked ' + (affordable ? 'affordable' : 'unaffordable');
      card.className = cls;

      const thumb = document.createElement('canvas');
      thumb.className = 'mascot-thumb';
      thumb.width = 80;
      thumb.height = 80;
      card.appendChild(thumb);

      const name = document.createElement('div');
      name.className = 'mascot-name';
      name.textContent = m.name;
      card.appendChild(name);

      const status = document.createElement('div');
      status.className = 'mascot-status';
      if (equipped)      status.textContent = 'EQUIPPED';
      else if (owned)    status.textContent = 'TAP TO EQUIP';
      else               status.textContent = `BUY · ${m.cost}🏆`;
      card.appendChild(status);

      mascotGrid.appendChild(card);

      // Draw thumb after appending so the canvas exists in the DOM
      drawMascotThumb(thumb, m.frame);

      if (equipped) continue;
      if (owned) {
        card.addEventListener('click', () => {
          equippedMascot = m.id;
          saveEquippedMascot();
          renderHudMascot();
          renderMascotGrid();
        });
      } else if (affordable) {
        card.addEventListener('click', () => {
          if (coins < m.cost) return;
          coins -= m.cost;
          saveCoins();
          ownedMascots.add(m.id);
          saveOwnedMascots();
          equippedMascot = m.id;
          saveEquippedMascot();
          updateCoinsHUD(true);
          renderHudMascot();
          renderMascotGrid();
        });
      }
    }
  }

  // ============================================================
  // High scores modal
  // ============================================================
  function openScoresModal() {
    if (!scoresModal) return;
    paused = true;
    pauseMusic();
    renderScores();
    scoresModal.hidden = false;
  }
  function closeScoresModal() {
    if (!scoresModal) return;
    scoresModal.hidden = true;
    paused = false;
    if (state === STATE.PLAY) resumeMusic();
  }
  function renderScores() {
    if (!scoresList || !scoresOverall) return;
    let bestLevel = -1, bestVal = 0;
    for (const [k, v] of Object.entries(levelScores)) {
      if (v > bestVal) { bestVal = v; bestLevel = parseInt(k, 10); }
    }
    scoresOverall.innerHTML = bestVal > 0
      ? `Best Overall: <strong>${bestVal}</strong> (Level ${bestLevel + 1})`
      : 'No scores yet — go eat!';

    const unlockedLevels = Object.keys(levelScores).map(k => parseInt(k, 10) + 1);
    const reachable = Math.max(currentLevel + 1, ...unlockedLevels, 1);
    scoresList.innerHTML = '';
    for (let i = 0; i < reachable; i++) {
      const row = document.createElement('div');
      row.className = 'scores-row';
      const v = levelScores[i] || 0;
      const isBest = i === bestLevel && bestVal > 0;
      row.innerHTML = `<span>Level ${i + 1}</span><span>${v > 0 ? v : '—'}${isBest ? ' ★' : ''}</span>`;
      scoresList.appendChild(row);
    }
  }

  // ============================================================
  // Input
  // ============================================================
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      jumpStart();
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      diveStart();
    } else if (e.key === 'r' || e.key === 'R') {
      reset();
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMute();
    } else if (e.key === 'c' || e.key === 'C') {
      if (mascotModal && mascotModal.hidden) openMascotModal();
      else closeMascotModal();
    } else if (e.key === 'Escape') {
      if (skinModal && !skinModal.hidden) closeSkinModal();
      if (scoresModal && !scoresModal.hidden) closeScoresModal();
      if (mascotModal && !mascotModal.hidden) closeMascotModal();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') jumpRelease();
    else if (e.code === 'ArrowDown') diveEnd();
  });

  // Pointer (mobile + mouse): hold to fly higher, release to drop
  canvas.addEventListener('pointerdown',   (e) => { e.preventDefault(); jumpStart(); });
  canvas.addEventListener('pointerup',     (e) => { e.preventDefault(); jumpRelease(); });
  canvas.addEventListener('pointercancel', () => jumpRelease());
  canvas.addEventListener('pointerleave',  () => jumpRelease());

  if (restartBtn)   restartBtn.addEventListener('click', () => reset());
  if (muteBtn)      muteBtn.addEventListener('click', toggleMute);
  if (skinBtn)      skinBtn.addEventListener('click', openSkinModal);
  if (scoresBtn)    scoresBtn.addEventListener('click', openScoresModal);
  if (mascotBtn)    mascotBtn.addEventListener('click', openMascotModal);
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => reset());

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      if (id === 'skinModal')   closeSkinModal();
      if (id === 'scoresModal') closeScoresModal();
      if (id === 'mascotModal') closeMascotModal();
    });
  });

  updateCoinsHUD();

  // ============================================================
  // Loop
  // ============================================================
  function tick() {
    update();
    render();
    requestAnimationFrame(tick);
  }
  tick();
});

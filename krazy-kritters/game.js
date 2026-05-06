'use strict';

function _buildFrames(frameSize, gap) {
  const out = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push({
        x: 2 + c * (frameSize + gap),
        y: 2 + r * (frameSize + gap),
        w: frameSize,
        h: frameSize
      });
    }
  }
  return out;
}
const _ALIEN_FRAMES = _buildFrames(333, 2); // alien.png 1007x1007
const _BIO_FRAMES   = _buildFrames(402, 2); // bio.png   1214x1214
const _MECH_FRAMES  = _buildFrames(500, 2); // mech.png  1508x1508
const CATEGORIES = {
  alien: {
    name: 'ALIEN', sheetID: 'sprite-alien',
    firstID: 1, count: 9, slideMs: 450,
    requireLine: false, frames: _ALIEN_FRAMES,
    color: '#39ff14', dark: '#0a3d10',
    entryStyle: 'spin',
    needs: [5, 5, 5, 5, 5, 5, 5, 5, 5]
  },
  bio: {
    name: 'BIO', sheetID: 'sprite-bio',
    firstID: 10, count: 9, slideMs: 660,
    requireLine: false, frames: _BIO_FRAMES,
    color: '#ff44aa', dark: '#5a0a30',
    entryStyle: 'glide',
    needs: [3, 3, 3, 3, 3, 3, 3, 3, 3]
  },
  mech: {
    name: 'MECH', sheetID: 'sprite-mech',
    firstID: 19, count: 9, slideMs: 390,
    requireLine: false, frames: _MECH_FRAMES,
    color: '#ffb000', dark: '#5a3a00',
    entryStyle: 'fog',
    needs: [4, 4, 4, 4, 4, 4, 4, 4, 4]
  }
};
const CATEGORY_KEYS = ['alien', 'bio', 'mech'];
const TOTAL_TYPES = 27;

/* Per-type lookup tables (1-indexed; index 0 is empty/unused). */
const TYPE_CAT     = new Array(TOTAL_TYPES + 1).fill(null);
const TYPE_FRAMES  = new Array(TOTAL_TYPES + 1).fill(null);
const TYPE_SHEET   = new Array(TOTAL_TYPES + 1).fill(null);
const TYPE_NEEDS   = new Array(TOTAL_TYPES + 1).fill(0);
const TYPE_SLIDE   = new Array(TOTAL_TYPES + 1).fill(65);
const TYPE_LINE    = new Array(TOTAL_TYPES + 1).fill(false);
const TYPE_COLORS  = new Array(TOTAL_TYPES + 1).fill('#fff');
const TYPE_DARKS   = new Array(TOTAL_TYPES + 1).fill('#222');
const TYPE_GLYPHS  = new Array(TOTAL_TYPES + 1).fill('');
const TYPE_NAMES   = new Array(TOTAL_TYPES + 1).fill('');
for (const key of CATEGORY_KEYS) {
  const cat = CATEGORIES[key];
  for (let i = 0; i < cat.count; i++) {
    const id = cat.firstID + i;
    TYPE_CAT[id]    = key;
    TYPE_FRAMES[id] = cat.frames[i];
    TYPE_SHEET[id]  = cat.sheetID;
    TYPE_NEEDS[id]  = cat.needs[i];
    TYPE_SLIDE[id]  = cat.slideMs;
    TYPE_LINE[id]   = cat.requireLine;
    TYPE_COLORS[id] = cat.color;
    TYPE_DARKS[id]  = cat.dark;
    TYPE_GLYPHS[id] = cat.name[0] + (i + 1);   
    TYPE_NAMES[id]  = `${cat.name}-${i + 1}`;
  }
}

const Config = Object.freeze({
  SLIDE_MS_BASE: 65,           // baseline; per-mover slideMs overrides
  DOUBLE_TAP_MS: 280,

  /* Level timing */
  LEVEL_DURATION_MS: 90000,    // 90 s per level cycle (1m 30s)
  PANIC_AT_MS: 75000,          // panic kicks in after 75 s
  PANIC_DURATION_MS: 15000,    // (LEVEL_DURATION - PANIC_AT)
  PANIC_SPEED_MULT: 0.5,       // entry speed doubles in panic (slideMs halved)
  PANIC_SPAWN_MULT: 0.55,      // spawn interval shrinks even more
  FOG_FADE_MS: 1800,           // mech fog-in fade duration (placed, then fades into view)
  PANIC_MAX_MOVERS: 3,         // panic raises the in-flight cap (normal cap is per-difficulty)
  MAX_BOARD_CELLS_TRAVELED: 5, // free-flight kritters expire after this many on-board cells without landing
  MAX_FLIGHT_MS: 8000,         // hard timeout — covers off-board drift
  HINT_IDLE_MS: 5000,          // after this much player idle time, near-matches start flashing as a hint

  TYPE_CAT, TYPE_FRAMES, TYPE_SHEET, TYPE_NEEDS, TYPE_SLIDE, TYPE_LINE,
  TYPE_COLORS, TYPE_DARKS, TYPE_GLYPHS, TYPE_NAMES,
  CATEGORIES, CATEGORY_KEYS, TOTAL_TYPES
});

const DIFFICULTY = Object.freeze({
  easy:   { spawnMs: 0, typeCount: 3, speedGoal: 8,  scoreSec: 90, deadLimit: 30, maxMovers: 1 },
  normal: { spawnMs: 0, typeCount: 4, speedGoal: 10, scoreSec: 90, deadLimit: 20, maxMovers: 1 },
  hard:   { spawnMs: 0, typeCount: 5, speedGoal: 12, scoreSec: 90, deadLimit: 12, maxMovers: 1 }
});

/* =====================================================================
   LEVEL MAPS
   ===================================================================== */
const LEVEL_MAPS = {
  classic: [
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1]
  ],
  plus: [
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,0,1,1,1,1,0,0,0],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,0,1,1,1,1,0,0,0]
  ],
  diamond: [
    [0,0,0,0,1,1,0,0,0,0],
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,1,1,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,0,0,1,1,0,0,0,0]
  ],
  pinwheel: [
    [1,1,1,0,0,0,0,1,1,1],
    [1,1,1,1,0,0,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [0,0,1,1,1,1,1,1,0,0],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,0,0,1,1,1,1],
    [1,1,1,0,0,0,0,1,1,1]
  ],
  H: [
    [1,1,1,0,0,0,0,1,1,1],
    [1,1,1,0,0,0,0,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,0,0,0,0,1,1,1],
    [1,1,1,0,0,0,0,1,1,1]
  ]
};


const LEVEL_BACKGROUNDS = {
  classic:  'assets/backgrounds/classic.svg',
  plus:     'assets/backgrounds/plus.svg',
  diamond:  'assets/backgrounds/diamond.svg',
  pinwheel: 'assets/backgrounds/pinwheel.svg',
  H:        'assets/backgrounds/H.svg'
};

const BgImages = {
  cache: {},
  pending: {},
  preload(key) {
    if (this.cache[key]) return Promise.resolve(this.cache[key]);
    if (this.pending[key]) return this.pending[key];
    const url = LEVEL_BACKGROUNDS[key];
    if (!url) return Promise.resolve(null);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => { this.cache[key] = img; resolve(img); };
      img.onerror = () => { resolve(null); };
      img.src = url;
    });
    this.pending[key] = p;
    p.then(() => { delete this.pending[key]; });
    return p;
  },
  preloadAll() {
    return Promise.all(Object.keys(LEVEL_BACKGROUNDS).map(k => this.preload(k)));
  },
  get(key) { return this.cache[key] || null; }
};

const State = {
  canvas: null, ctx: null,
  sprites: { alien: null, bio: null, mech: null },

  /* Board */
  rows: 0, cols: 0,
  mask: null,
  grid: null,

  /* Dynamic layout (recomputed on resize) */
  cell: 40,
  offsetX: 0, offsetY: 0,

  /* Player */
  cursor: { r: 0, c: 0 },
  buffer: 0,
  lastActionTime: -Infinity,
  idleMs: 0,                    

  /* World */
  movers: [],
  flashCells: [],

  scene: 'splash',               // 'splash' | 'intro' | 'loading' | 'playing' | 'gameover'
  selectedMode: 'speed',         // 'speed' | 'score'
  selectedDifficulty: 'normal',  // 'easy' | 'normal' | 'hard'
  selectedLevel: 'classic',
  spawnInterval: 0,
  speedGoal: 10,
  deadLimit: 20,
  maxMovers: 1,
  allowedTypes: [],              // subset of typeIDs in play this run (size = difficulty.typeCount)
  scoreLimitMs: 60000,
  remainingMs: 0,
  spawnTimer: 0,

  /* Run stats */
  elapsed: 0,
  score: 0,
  cleared: 0,
  bestCombo: 0,
  deadEntries: 0,

  /* Level / panic */
  panicMode: false,
  panicTickAccum: 0,             // audio tick accumulator (ms)

  theme: 'neon',
  lastResult: null               // populated on endRun() for gameover screen
};

/* =====================================================================
   AUDIO 
   ===================================================================== */
const Audio = {
  ctx: null,
  ensure() {
    if (this.ctx) return this.ctx;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C) this.ctx = new C();
    } catch { /* unsupported */ }
    return this.ctx;
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  beep(freq = 880, durMs = 50, gain = 0.08) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.linearRampToValueAtTime(0, t0 + durMs / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  },
  panicTick(progress) {
    /* progress 0..1 across the 15-second panic window. Pitch climbs. */
    const freq = 660 + progress * 540;
    this.beep(freq, 40, 0.05);
  },
  clear(progress) {
    /* Two-note success blip. */
    this.beep(880, 60, 0.06);
    setTimeout(() => this.beep(1320, 80, 0.05), 60);
  }
};

/* =====================================================================
   RESIZE — fits the canvas to the stage and recomputes cell + offsets.
   ===================================================================== */
const Resize = {
  bind() {
    window.addEventListener('resize', () => this.fit());
    document.addEventListener('fullscreenchange', () => this.fit());
  },
  fit() {
    if (!State.canvas) return;
    const stage = document.getElementById('stage');
    const w = Math.max(320, stage.clientWidth);
    const h = Math.max(240, stage.clientHeight);
    if (State.canvas.width !== w)  State.canvas.width  = w;
    if (State.canvas.height !== h) State.canvas.height = h;
    this.fitCell();
  },
  fitCell() {
    if (!State.rows) return;
    const padding = 32;
    const availW = State.canvas.width  - padding * 2;
    const availH = State.canvas.height - padding * 2;
    const cell = Math.max(20, Math.floor(Math.min(availW / State.cols, availH / State.rows)));
    State.cell = cell;
    State.offsetX = Math.floor((State.canvas.width  - State.cols * cell) / 2);
    State.offsetY = Math.floor((State.canvas.height - State.rows * cell) / 2);
  }
};

/* =====================================================================
   GRID
   ===================================================================== */
const Grid = {
  load(key) {
    const map = LEVEL_MAPS[key];
    State.selectedLevel = key;
    State.rows = map.length;
    State.cols = map[0].length;
    State.mask = map.map(row => row.slice());
    State.grid = Array.from({ length: State.rows }, () =>
      Array.from({ length: State.cols }, () => ({ type: 0 }))
    );
    State.movers.length = 0;
    State.flashCells.length = 0;
    State.cursor = this.firstPlayable();
    State.buffer = 0;
    State.score = 0;
    State.cleared = 0;
    State.bestCombo = 0;
    State.deadEntries = 0;
    State.spawnTimer = 600;
    State.elapsed = 0;
    State.panicMode = false;
    State.panicTickAccum = 0;
    State.idleMs = 0;
    Resize.fitCell();
  },

  firstPlayable() {
    for (let r = 0; r < State.rows; r++)
      for (let c = 0; c < State.cols; c++)
        if (State.mask[r][c]) return { r, c };
    return { r: 0, c: 0 };
  },

  inBounds(r, c)   { return r >= 0 && r < State.rows && c >= 0 && c < State.cols; },
  isPlayable(r, c) { return this.inBounds(r, c) && State.mask[r][c] === 1; },
  isEmpty(r, c)    { return this.isPlayable(r, c) && State.grid[r][c].type === 0; },
  isFilled(r, c)   { return this.isPlayable(r, c) && State.grid[r][c].type !== 0; },
  canEnter(r, c)   { return this.isEmpty(r, c); },

  isFading(r, c) {
    for (const m of State.movers) {
      if (m.placed && m.r === r && m.c === c) return true;
    }
    return false;
  }
};

const Physics = {
  step(dt) {
    const speedMult = State.panicMode ? (1 / Config.PANIC_SPEED_MULT) : 1;
    const fadeMult  = State.panicMode ? 2 : 1;
    const cell = State.cell;
    const cols = State.cols;
    for (let i = State.movers.length - 1; i >= 0; i--) {
      const m = State.movers[i];

      if (m.placed) {
        /* Mech fog-in: kritter is already on the gameboard; advance the
         * fade-in alpha and remove the mover when fully visible. */
        m.fogFade += (dt / m.fogFadeMs) * fadeMult;
        if (m.fogFade >= 1) State.movers.splice(i, 1);
        continue;
      }


      m.px += m.vx * dt * speedMult;
      m.py += m.vy * dt * speedMult;
      m.lifeMs += dt;
      const r = Math.floor((m.py - State.offsetY) / cell);
      const c = Math.floor((m.px - State.offsetX) / cell);
      if (Grid.isPlayable(r, c)) {
        const key = r * cols + c;
        if (key !== m.lastCellKey) {
          m.lastCellKey = key;
          m.cellsOnBoard++;
        }
        if (Grid.isEmpty(r, c)) {
          State.grid[r][c].type = m.typeID;
          State.movers.splice(i, 1);
          continue;
        }
        if (m.cellsOnBoard > Config.MAX_BOARD_CELLS_TRAVELED) {
          State.deadEntries++;
          State.movers.splice(i, 1);
          continue;
        }
      }
      if (m.lifeMs > Config.MAX_FLIGHT_MS) {
        State.deadEntries++;
        State.movers.splice(i, 1);
      }
    }
  }
};

const Spawner = {
  countTypesOnBoard() {
    const counts = new Array(Config.TOTAL_TYPES + 1).fill(0);
    for (let r = 0; r < State.rows; r++) {
      for (let c = 0; c < State.cols; c++) {
        const t = State.grid[r][c].type;
        if (t) counts[t]++;
      }
    }
    return counts;
  },

  buildAllowedTypes(count) {
    const out = new Set();
    for (const key of Config.CATEGORY_KEYS) {
      if (out.size >= count) break;
      const cat = Config.CATEGORIES[key];
      out.add(cat.firstID + ((Math.random() * cat.count) | 0));
    }
    while (out.size < count) {
      out.add(1 + ((Math.random() * Config.TOTAL_TYPES) | 0));
    }
    return Array.from(out);
  },
  pickType() {
    const allowed = State.allowedTypes;
    if (!allowed || !allowed.length) {
      return 1 + ((Math.random() * Config.TOTAL_TYPES) | 0);
    }
    /* 65% of the time, prefer a type that's already on the board so
     * matches actually become possible from the limited pool. */
    const counts = this.countTypesOnBoard();
    if (Math.random() < 0.65) {
      let total = 0;
      for (const t of allowed) total += counts[t];
      if (total > 0) {
        let pick = Math.random() * total;
        for (const t of allowed) {
          pick -= counts[t];
          if (pick < 0) return t;
        }
      }
    }
    /* Fall through: uniform pick from the allowed set. */
    return allowed[(Math.random() * allowed.length) | 0];
  },
  emptyCells() {
    const out = [];
    for (let r = 0; r < State.rows; r++) {
      for (let c = 0; c < State.cols; c++) {
        if (Grid.isEmpty(r, c)) out.push({ r, c });
      }
    }
    return out;
  },
  spawn() {
    const typeID = this.pickType();
    const cat = Config.TYPE_CAT[typeID];

    if (cat === 'mech') {
      const empties = this.emptyCells();
      if (!empties.length) return;
      const target = empties[(Math.random() * empties.length) | 0];
      State.grid[target.r][target.c].type = typeID;
      State.movers.push({
        typeID,
        r: target.r, c: target.c,
        placed: true,
        fogFade: 0,
        fogFadeMs: Config.FOG_FADE_MS
      });
      return;
    }


    const cell = State.cell;
    const boardW = State.cols * cell;
    const boardH = State.rows * cell;
    const cx = State.offsetX + boardW / 2;
    const cy = State.offsetY + boardH / 2;
    const R = 0.5 * Math.sqrt(boardW * boardW + boardH * boardH) + cell;
    const spawnAngle = Math.random() * Math.PI * 2;
    const sx = cx + Math.cos(spawnAngle) * R;
    const sy = cy + Math.sin(spawnAngle) * R;
    const tx = State.offsetX + Math.random() * boardW;
    const ty = State.offsetY + Math.random() * boardH;
    const dx = tx - sx, dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const slideMs = Config.TYPE_SLIDE[typeID];
    const speed = cell / slideMs;       // px/ms — preserves per-category speed
    State.movers.push({
      typeID,
      px: sx, py: sy,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      cellsOnBoard: 0,
      lastCellKey: -1,
      lifeMs: 0,
      free: true
    });
  }
};

const Match = {

  allGroups() {
    const { grid, mask, rows, cols } = State;
    const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const groups = [];
    const NB = [
      [-1,-1], [-1, 0], [-1, 1],
      [ 0,-1],          [ 0, 1],
      [ 1,-1], [ 1, 0], [ 1, 1]
    ];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (seen[r][c] || !mask[r][c]) continue;
        if (Grid.isFading(r, c)) { seen[r][c] = true; continue; }
        const t = grid[r][c].type;
        if (!t) { seen[r][c] = true; continue; }

        const cells = [];
        const q = [[r, c]];
        seen[r][c] = true;
        while (q.length) {
          const [cr, cc] = q.pop();
          cells.push([cr, cc]);
          for (let k = 0; k < 8; k++) {
            const nr = cr + NB[k][0], nc = cc + NB[k][1];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (seen[nr][nc] || !mask[nr][nc]) continue;
            if (grid[nr][nc].type !== t) continue;
            if (Grid.isFading(nr, nc)) continue;
            seen[nr][nc] = true;
            q.push([nr, nc]);
          }
        }
        groups.push({ type: t, cells });
      }
    }
    return groups;
  },

  scan() {
    const out = [];
    for (const g of this.allGroups()) {
      if (g.cells.length < Config.TYPE_NEEDS[g.type]) continue;
      if (Config.TYPE_LINE[g.type]) {
        /* Mech (when requireLine is on): cells must share a row, column,
         * or 45° diagonal axis. 8-way contiguity is already guaranteed. */
        const r0 = g.cells[0][0], c0 = g.cells[0][1];
        const sameRow   = g.cells.every(([cr])     => cr === r0);
        const sameCol   = g.cells.every(([, cc])   => cc === c0);
        const sameDiag1 = g.cells.every(([cr, cc]) => cr - cc === r0 - c0);
        const sameDiag2 = g.cells.every(([cr, cc]) => cr + cc === r0 + c0);
        if (!sameRow && !sameCol && !sameDiag1 && !sameDiag2) continue;
      }
      out.push(g);
    }
    return out;
  },

  /* "One short of clearing" — used as a hint when the player has been
   * idle. The hint just flashes; the player still has to finalize the
   * combo for it to count. */
  findNearMatches() {
    const out = [];
    for (const g of this.allGroups()) {
      if (g.cells.length === Config.TYPE_NEEDS[g.type] - 1) out.push(g);
    }
    return out;
  },
  scanAndClear(bonus = 1) {
    const groups = this.scan();
    for (const g of groups) this.clearGroup(g, bonus);
    if (groups.length) Audio.clear();
    return groups.length;
  },
  clearGroup(group, bonus = 1) {
    const need = Config.TYPE_NEEDS[group.type];
    const n = group.cells.length;
    const overflow = Math.max(0, n - need);
    const life = 320 + overflow * 60;
    for (const [r, c] of group.cells) {
      State.flashCells.push({ r, c, type: group.type, t: 0, life });
      State.grid[r][c].type = 0;
    }
    State.score   += n * (overflow + 1) * 10 * bonus;
    State.cleared += 1;
    if (n > State.bestCombo) State.bestCombo = n;
    if (overflow > 0) Render.flash();
  },
  groupAt(r, c) {
    return this.scan().find(g =>
      g.cells.some(([gr, gc]) => gr === r && gc === c)
    ) || null;
  }
};


const Transporter = {
  pickOrDrop(r, c) {
    if (!Grid.isPlayable(r, c)) return;
    /* Cell is locked while a mech kritter is fog-fading in. */
    if (Grid.isFading(r, c)) return;
    const cell = State.grid[r][c];
    if (cell.type && State.buffer === 0) {
      /* Pure pick — no placement, no match check. */
      State.buffer = cell.type;
      cell.type = 0;
    } else if (!cell.type && State.buffer !== 0) {
      cell.type = State.buffer;
      State.buffer = 0;
      this.tryMatchAt(r, c);
    } else if (cell.type && State.buffer !== 0) {
      const tmp = cell.type;
      cell.type = State.buffer;
      State.buffer = tmp;
      this.tryMatchAt(r, c);
    }
  },
  tryMatchAt(r, c) {
    const g = Match.groupAt(r, c);
    if (g) {
      Match.clearGroup(g, 1);
      Audio.clear();
    }
  },
  doubleTapClear(r, c) {
    /* Manual emergency clear — only the group at the cursor (if any)
     * is cleared. No board-wide sweep, so spawner-formed groups
     * elsewhere still survive. */
    const g = Match.groupAt(r, c);
    if (g) {
      Match.clearGroup(g, 3);
      Audio.clear();
      return true;
    }
    return false;
  }
};

const HighScores = {
  KEY: 'kk_highscores_v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch { return {}; }
  },
  save(data) {
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); }
    catch { /* private mode etc — silently no-op */ }
  },
  get(mode, diff) {
    const v = this.load()[`${mode}_${diff}`];
    return v == null ? null : v;
  },
  set(mode, diff, value) {
    const data = this.load();
    const key = `${mode}_${diff}`;
    const prev = data[key];
    const isSpeed = mode === 'speed';
    const isBest = prev == null || (isSpeed ? value < prev : value > prev);
    if (isBest) { data[key] = value; this.save(data); }
    return isBest;
  },
  clear() { try { localStorage.removeItem(this.KEY); } catch {} },
  format(mode, value) {
    if (value == null) return '--';
    if (mode === 'speed') {
      const totalSec = value / 1000;
      const m = Math.floor(totalSec / 60);
      const s = (totalSec - m * 60).toFixed(1);
      return `${m}:${s.padStart(4, '0')}`;
    }
    return value.toLocaleString();
  }
};

/* =====================================================================
   MENU — handles the intro overlay (mode, difficulty, level, scores).
   ===================================================================== */
const Menu = {
  bind() {
    document.querySelectorAll('#mode-row [data-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.selectMode(btn.dataset.mode));
    });
    document.querySelectorAll('#difficulty-row [data-difficulty]').forEach(btn => {
      btn.addEventListener('click', () => this.selectDifficulty(btn.dataset.difficulty));
    });
    document.querySelectorAll('#level-row [data-level]').forEach(btn => {
      btn.addEventListener('click', () => this.selectLevel(btn.dataset.level));
    });
    document.querySelectorAll('.theme-row-intro [data-theme]').forEach(btn => {
      btn.addEventListener('click', () => Game.setTheme(btn.dataset.theme));
    });

    document.getElementById('start-btn').addEventListener('click', () => Game.startRun());
    document.getElementById('reset-hs-btn').addEventListener('click', () => {
      if (confirm('Erase all high scores?')) {
        HighScores.clear();
        this.refreshHighScores();
      }
    });

    /* Splash → intro: dismiss the title card and reveal the menu. */
    const splashBtn = document.getElementById('splash-start-btn');
    if (splashBtn) splashBtn.addEventListener('click', () => Game.dismissSplash());

    /* Game-over buttons */
    document.getElementById('play-again-btn').addEventListener('click', () => Game.startRun());
    document.getElementById('back-intro-btn').addEventListener('click', () => Game.toIntro());
  },

  selectMode(m) {
    State.selectedMode = m;
    document.querySelectorAll('#mode-row [data-mode]').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === m));
  },
  selectDifficulty(d) {
    State.selectedDifficulty = d;
    document.querySelectorAll('#difficulty-row [data-difficulty]').forEach(b =>
      b.classList.toggle('active', b.dataset.difficulty === d));
  },
  selectLevel(l) {
    State.selectedLevel = l;
    document.querySelectorAll('#level-row [data-level]').forEach(b =>
      b.classList.toggle('active', b.dataset.level === l));
  },

  refreshHighScores() {
    const data = HighScores.load();
    for (const mode of ['speed', 'score']) {
      for (const diff of ['easy', 'normal', 'hard']) {
        const cell = document.querySelector(`[data-hs="${mode}-${diff}"]`);
        if (!cell) continue;
        const v = data[`${mode}_${diff}`];
        if (v == null) {
          cell.textContent = '--';
          cell.classList.add('empty');
        } else {
          cell.textContent = HighScores.format(mode, v);
          cell.classList.remove('empty');
        }
      }
    }
  },

  showIntro() {
    document.getElementById('intro-screen').classList.remove('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    this.refreshHighScores();
  },
  hideIntro() {
    document.getElementById('intro-screen').classList.add('hidden');
  },
  showGameOver(result) {
    document.getElementById('intro-screen').classList.add('hidden');
    const go = document.getElementById('gameover-screen');
    go.classList.remove('hidden');

    document.getElementById('result-mode').textContent =
      `${result.mode.toUpperCase()} · ${result.difficulty.toUpperCase()} · ${result.level.toUpperCase()}`;
    document.getElementById('result-label').textContent =
      result.mode === 'speed' ? (result.completed ? 'TIME' : 'GROUPS CLEARED') : 'SCORE';
    document.getElementById('result-value').textContent = result.display;
    document.getElementById('result-score').textContent   = result.score.toLocaleString();
    document.getElementById('result-cleared').textContent = result.cleared;
    document.getElementById('result-biggest').textContent = result.bestCombo;

    document.getElementById('result-best').classList.toggle('hidden', !result.isBest);
    document.getElementById('result-dnf').classList.toggle('hidden', result.completed);
  }
};

/* =====================================================================
   INPUT
   ===================================================================== */
const Input = {
  bind() {
    window.addEventListener('keydown', this.onKey.bind(this));
  },
  onKey(e) {
    const k = e.key.toLowerCase();

    /* Esc = clean quit to intro from anywhere except intro */
    if (k === 'escape') {
      if (State.scene !== 'intro') Game.toIntro();
      e.preventDefault();
      return;
    }

    /* Theme + fullscreen are universal */
    if (k === '1') { Game.setTheme('neon');   e.preventDefault(); return; }
    if (k === '2') { Game.setTheme('dark');   e.preventDefault(); return; }
    if (k === '3') { Game.setTheme('glitch'); e.preventDefault(); return; }
    if (k === 'f') { Game.toggleFullscreen(); e.preventDefault(); return; }

    /* Enter dismisses splash, starts/restarts a run from intro/gameover */
    if (k === 'enter') {
      if      (State.scene === 'splash')   Game.dismissSplash();
      else if (State.scene === 'intro')    Game.startRun();
      else if (State.scene === 'gameover') Game.startRun();
      e.preventDefault();
      return;
    }

    if (State.scene !== 'playing') return;

    let handled = true;
    switch (k) {
      case 'arrowup':    case 'w': this.moveCursor(-1,  0); break;
      case 'arrowdown':  case 's': this.moveCursor( 1,  0); break;
      case 'arrowleft':  case 'a': this.moveCursor( 0, -1); break;
      case 'arrowright': case 'd': this.moveCursor( 0,  1); break;
      case ' ':                    this.action();           break;
      case 'l':                    Game.cycleLevel();       break;
      case 'r':                    Grid.load(State.selectedLevel); break;
      default:                     handled = false;
    }
    if (handled) {
      State.idleMs = 0;          // any gameplay input dismisses the hint flash
      e.preventDefault();
    }
  },

  moveCursor(dr, dc) {
    let { r, c } = State.cursor;
    let nr = r + dr, nc = c + dc;
    while (Grid.inBounds(nr, nc) && !Grid.isPlayable(nr, nc)) {
      nr += dr; nc += dc;
    }
    if (Grid.isPlayable(nr, nc)) State.cursor = { r: nr, c: nc };
  },

  action() {
    const now = performance.now();
    const isDouble = (now - State.lastActionTime) < Config.DOUBLE_TAP_MS;
    State.lastActionTime = now;
    const { r, c } = State.cursor;
    if (isDouble) {
      const fired = Transporter.doubleTapClear(r, c);
      if (fired) { Render.flash(); return; }
    }
    Transporter.pickOrDrop(r, c);
  }
};

/* =====================================================================
   RENDER — only canvas-touching module.
   ===================================================================== */
const Render = {
  draw(dt) {
    const ctx = State.ctx;
    const cell = State.cell;
    const { offsetX: OX, offsetY: OY } = State;
    const W = State.canvas.width, H = State.canvas.height;

    /* Level-specific background image (cover-fit), darkened slightly
     * for contrast. Falls back to the deep-purple solid if the image
     * isn't loaded yet. */
    const bgImg = BgImages.get(State.selectedLevel);
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = (W - dw) / 2, dy = (H - dh) / 2;
      ctx.drawImage(bgImg, dx, dy, dw, dh);
      ctx.fillStyle = 'rgba(4, 0, 13, 0.45)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#04000d';
      ctx.fillRect(0, 0, W, H);
    }

    /* Panic-mode tinted backdrop on the playable area */
    if (State.panicMode) {
      const pulse = 0.18 + 0.12 * Math.sin(performance.now() * 0.012);
      ctx.fillStyle = `rgba(255, 0, 60, ${pulse.toFixed(3)})`;
      ctx.fillRect(OX - 8, OY - 8,
                   State.cols * cell + 16, State.rows * cell + 16);
    }

    /* playable cells */
    for (let r = 0; r < State.rows; r++) {
      for (let c = 0; c < State.cols; c++) {
        if (!State.mask[r][c]) continue;
        const x = OX + c * cell, y = OY + r * cell;
        ctx.fillStyle = '#160033';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.strokeStyle = State.panicMode
          ? 'rgba(255, 64, 96, 0.55)'
          : 'rgba(192,0,255,0.35)';
        ctx.strokeRect(x + 0.5, y + 0.5, cell, cell);
      }
    }

    /* landed entities — but skip cells where a mech is currently
     * fog-fading; the mover loop draws those at the right opacity. */
    const fadingSet = new Set();
    for (const m of State.movers) {
      if (m.placed) fadingSet.add(m.r * State.cols + m.c);
    }
    for (let r = 0; r < State.rows; r++) {
      for (let c = 0; c < State.cols; c++) {
        const t = State.grid[r][c].type;
        if (!t) continue;
        if (fadingSet.has(r * State.cols + c)) continue;
        this.sprite(t, OX + c * cell, OY + r * cell);
      }
    }

    /* In-flight movers — each category has its own entry visual:
     *   bio   = free-flight straight-line glide from any direction
     *   mech  = placed on the gameboard, then fades into view (fog-in)
     *   alien = free-flight straight-line, sprite spins while traveling */
    for (const m of State.movers) {
      if (m.placed) {
        const px = OX + m.c * cell;
        const py = OY + m.r * cell;
        this.spriteFogIn(m.typeID, px, py, m.fogFade);
        continue;
      }
      /* Free-flight: m.px/m.py is the kritter's center in canvas pixels. */
      const px = m.px - cell / 2;
      const py = m.py - cell / 2;
      const cat = Config.TYPE_CAT[m.typeID];
      if (cat === 'alien') this.spriteSpinning(m.typeID, px, py);
      else                 this.sprite(m.typeID, px, py);
    }

    /* completed-group blink */
    const groups = Match.scan();
    if (groups.length && Math.sin(performance.now() * 0.018) > 0) {
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.strokeStyle = '#fff200';
      for (const g of groups) {
        for (const [r, c] of g.cells) {
          const x = OX + c * cell, y = OY + r * cell;
          ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
        }
      }
      ctx.lineWidth = 1;
    }

    /* Idle hint — once the player has been still for HINT_IDLE_MS, surface
     * any "one short of clearing" groups with a slower cyan pulse. The
     * hint never auto-clears: the player still has to finalize the combo
     * (place an Nth same-type adjacent) for it to count. */
    if (State.scene === 'playing' && State.idleMs >= Config.HINT_IDLE_MS) {
      const near = Match.findNearMatches();
      if (near.length && Math.sin(performance.now() * 0.010) > 0) {
        ctx.lineWidth = Math.max(2, cell * 0.05);
        ctx.strokeStyle = 'rgba(0, 255, 230, 0.85)';
        for (const g of near) {
          for (const [r, c] of g.cells) {
            const x = OX + c * cell, y = OY + r * cell;
            ctx.strokeRect(x + 4, y + 4, cell - 8, cell - 8);
          }
        }
        ctx.lineWidth = 1;
      }
    }

    /* flash trails */
    for (let i = State.flashCells.length - 1; i >= 0; i--) {
      const f = State.flashCells[i];
      f.t += dt;
      if (f.t >= f.life) { State.flashCells.splice(i, 1); continue; }
      const a = 1 - f.t / f.life;
      const x = OX + f.c * cell, y = OY + f.r * cell;
      ctx.globalAlpha = a;
      ctx.fillStyle = Config.TYPE_COLORS[f.type] || '#fff';
      const grow = (1 - a) * (cell * 0.4);
      ctx.fillRect(x - grow, y - grow, cell + grow * 2, cell + grow * 2);
      ctx.globalAlpha = 1;
    }

    /* cursor (only during play) */
    if (State.scene === 'playing') {
      const cx = OX + State.cursor.c * cell;
      const cy = OY + State.cursor.r * cell;
      ctx.lineWidth = Math.max(3, cell * 0.08);
      ctx.strokeStyle = '#ff00d4';
      ctx.strokeRect(cx - 2, cy - 2, cell + 4, cell + 4);
      ctx.lineWidth = 1;

      if (State.buffer) {
        ctx.globalAlpha = 0.85;
        this.sprite(State.buffer, cx, cy - cell - 6, 0.7);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(cx + cell / 2, cy - 6);
        ctx.lineTo(cx + cell / 2, cy);
        ctx.stroke();
      }
    }
  },

  sprite(typeID, x, y, scale = 1) {
    const ctx = State.ctx;
    const cell = State.cell;
    const size = cell * scale;
    const pad = (cell - size) / 2;
    const cat = Config.TYPE_CAT[typeID];
    const sheet = State.sprites[cat];
    const frame = Config.TYPE_FRAMES[typeID];

    if (sheet && sheet.complete && sheet.naturalWidth >= 100 && frame) {
      const wasSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h,
                    x + pad, y + pad, size, size);
      ctx.imageSmoothingEnabled = wasSmoothing;
      return;
    }

    /* Procedural fallback */
    const px = x + pad + 3, py = y + pad + 3, ps = size - 6;
    ctx.fillStyle = Config.TYPE_DARKS[typeID];
    ctx.fillRect(px, py, ps, ps);
    ctx.fillStyle = Config.TYPE_COLORS[typeID];
    ctx.fillRect(px + 2, py + 2, ps - 4, ps - 4);
    ctx.fillStyle = '#04000d';
    ctx.font = `bold ${Math.floor(size * 0.36)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Config.TYPE_GLYPHS[typeID], x + cell / 2, y + cell / 2 + 1);
  },

  /* Alien in-flight: spin sprite around its center. Continuous rotation
   * driven by clock so all aliens spin in sync. */
  spriteSpinning(typeID, x, y) {
    const ctx = State.ctx;
    const cell = State.cell;
    const angle = performance.now() * 0.008;   // ~1.3 revolutions / sec
    ctx.save();
    ctx.translate(x + cell / 2, y + cell / 2);
    ctx.rotate(angle);
    this.sprite(typeID, -cell / 2, -cell / 2);
    ctx.restore();
  },

  /* Mech fog-in: the kritter is already placed on the gameboard and
   * fades into player view. Halo + orbiting fog dots dissipate as the
   * sprite's alpha ramps from 0 → 1 across the fade window. */
  spriteFogIn(typeID, x, y, fadeProgress) {
    const ctx = State.ctx;
    const cell = State.cell;
    const cx = x + cell / 2, cy = y + cell / 2;
    const t = performance.now() * 0.003;
    const fog = 1 - Math.min(1, Math.max(0, fadeProgress));
    ctx.save();

    /* Soft halo — fades out as the sprite materializes */
    const haloA = (0.30 + 0.12 * Math.sin(t)) * fog;
    const haloR = cell * (0.55 + 0.05 * Math.sin(t * 1.7));
    ctx.fillStyle = `rgba(190, 210, 230, ${haloA.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
    ctx.fill();

    /* Orbiting fog dots — fade out alongside the halo */
    ctx.fillStyle = `rgba(220, 240, 255, ${(haloA * 0.7).toFixed(3)})`;
    for (let i = 0; i < 4; i++) {
      const a = t * 0.6 + i * (Math.PI / 2);
      const dist = cell * 0.40;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist,
              cell * 0.10, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Sprite — alpha ramps in across the fade window */
    ctx.globalAlpha = Math.min(1, Math.max(0, fadeProgress));
    this.sprite(typeID, x, y);
    ctx.restore();
  },

  flash() {
    State.canvas.classList.remove('flash');
    void State.canvas.offsetWidth;
    State.canvas.classList.add('flash');
  }
};

/* =====================================================================
   HUD — top bar updates.
   ===================================================================== */
const HUD = {
  el: {},
  cache() {
    this.el = {
      mode:     document.getElementById('mode-display'),
      progress: document.getElementById('progress-display'),
      time:     document.getElementById('time-display'),
      score:    document.getElementById('score-display'),
      best:     document.getElementById('best-display'),
      buffer:   document.getElementById('buffer-slot'),
      level:    document.getElementById('level-display'),
      clock:    document.getElementById('clock-display'),
      panic:    document.getElementById('panic-flag')
    };
  },
  update() {
    const e = this.el;
    e.mode.textContent  = `${State.selectedMode.toUpperCase()} · ${State.selectedDifficulty.charAt(0).toUpperCase()}`;
    e.level.textContent = State.selectedLevel.toUpperCase();
    e.score.textContent = State.score.toLocaleString();
    e.best.textContent  = State.bestCombo;

    if (State.selectedMode === 'speed') {
      e.progress.textContent = `${State.cleared}/${State.speedGoal}`;
      e.time.textContent = HighScores.format('speed', State.elapsed);
    } else {
      e.progress.textContent = `${State.cleared}`;
      const left = Math.max(0, State.remainingMs);
      e.time.textContent = HighScores.format('speed', left);
    }

    /* Level countdown clock (60s → 0s) */
    if (e.clock) {
      const remain = Math.max(0, Config.LEVEL_DURATION_MS - State.elapsed);
      const sec = Math.ceil(remain / 1000);
      e.clock.textContent = String(sec).padStart(2, '0');
      e.clock.classList.toggle('panic', State.panicMode);
    }
    if (e.panic) e.panic.classList.toggle('on', State.panicMode);

    if (State.buffer) {
      e.buffer.textContent = Config.TYPE_GLYPHS[State.buffer];
      e.buffer.style.background = Config.TYPE_COLORS[State.buffer];
      e.buffer.style.color      = '#04000d';
      e.buffer.style.borderColor = '#fff';
      e.buffer.classList.remove('empty');
      e.buffer.classList.add('full');
    } else {
      e.buffer.textContent = '--';
      e.buffer.style.background = '';
      e.buffer.style.color = '';
      e.buffer.style.borderColor = '';
      e.buffer.classList.remove('full');
      e.buffer.classList.add('empty');
    }
  }
};

/* =====================================================================
   GAME — orchestration.
   ===================================================================== */
const Game = {
  init() {
    State.canvas  = document.getElementById('canvas');
    State.ctx     = State.canvas.getContext('2d');
    State.sprites.alien = document.getElementById('sprite-alien');
    State.sprites.bio   = document.getElementById('sprite-bio');
    State.sprites.mech  = document.getElementById('sprite-mech');
    HUD.cache();
    Resize.bind();
    Resize.fit();
    Grid.load(State.selectedLevel);
    Input.bind();
    Menu.bind();
    this.setTheme('neon');
    this.toSplash();

    /* Warm the bg-image cache in the background so the loading screen
     * is brief once the player actually starts a run. */
    BgImages.preloadAll();
  },

  toSplash() {
    State.scene = 'splash';
    State.panicMode = false;
    document.body.classList.remove('scene-intro', 'scene-loading', 'scene-playing', 'scene-gameover', 'panic');
    document.body.classList.add('scene-splash');
    const splash = document.getElementById('splash-screen');
    if (splash) splash.classList.remove('hidden');
    document.getElementById('intro-screen').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    const ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');
  },

  dismissSplash() {
    const splash = document.getElementById('splash-screen');
    if (splash) splash.classList.add('hidden');
    this.toIntro();
  },

  start() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(50, now - last);
      last = now;

      if (State.scene === 'playing') {
        State.elapsed += dt;
        State.idleMs += dt;

        /* Panic-mode toggle + audio tick */
        const wasPanic = State.panicMode;
        State.panicMode = State.elapsed >= Config.PANIC_AT_MS
                       && State.elapsed <  Config.LEVEL_DURATION_MS;
        if (State.panicMode && !wasPanic) {
          document.body.classList.add('panic');
          Audio.beep(260, 220, 0.1);     // panic warning low blast
        } else if (!State.panicMode && wasPanic) {
          document.body.classList.remove('panic');
        }

        if (State.panicMode) {
          /* Tick rate climbs: 2 Hz → 6 Hz across the 15s window */
          const progress = (State.elapsed - Config.PANIC_AT_MS) / Config.PANIC_DURATION_MS;
          const tickHz   = 2 + progress * 4;
          const tickPer  = 1000 / tickHz;
          State.panicTickAccum += dt;
          while (State.panicTickAccum >= tickPer) {
            Audio.panicTick(progress);
            State.panicTickAccum -= tickPer;
          }
        } else {
          State.panicTickAccum = 0;
        }

        Physics.step(dt);

        const spawnMult = State.panicMode ? Config.PANIC_SPAWN_MULT : 1;
        /* Only one kritter enters the board at a time; panic raises the
         * cap to 3. A new spawn is gated on landings, not a timer. */
        const moverCap = State.panicMode ? Config.PANIC_MAX_MOVERS : State.maxMovers;
        State.spawnTimer -= dt;
        if (State.spawnTimer <= 0 && State.movers.length < moverCap) {
          Spawner.spawn();
          State.spawnTimer = State.spawnInterval * spawnMult;
        }

        /* End conditions */
        if (State.elapsed >= Config.LEVEL_DURATION_MS) {
          /* Level timer expired — round over either way. */
          this.endRun(State.selectedMode === 'score'
                      || State.cleared >= State.speedGoal);
        } else if (State.selectedMode === 'speed') {
          if (State.cleared >= State.speedGoal) this.endRun(true);
        } else {
          State.remainingMs = State.scoreLimitMs - State.elapsed;
          if (State.remainingMs <= 0) this.endRun(true);
        }
        if (State.deadEntries >= State.deadLimit) this.endRun(false);
      }

      Render.draw(dt);
      HUD.update();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  startRun() {
    Audio.ensure();
    Audio.resume();
    /* Auto-fullscreen on START — must call inside the user-gesture
     * handler; some browsers refuse it after an awaited Promise. */
    this.requestFullscreen();

    const d = DIFFICULTY[State.selectedDifficulty];
    State.spawnInterval = d.spawnMs;
    State.speedGoal     = d.speedGoal;
    State.deadLimit     = d.deadLimit;
    State.maxMovers     = d.maxMovers;
    State.scoreLimitMs  = d.scoreSec * 1000;
    State.remainingMs   = State.scoreLimitMs;
    /* Pick the run's kritter pool (3/4/5 types depending on difficulty). */
    State.allowedTypes  = Spawner.buildAllowedTypes(d.typeCount);

    Grid.load(State.selectedLevel);

    /* Show the loading screen, preload the level backdrop, then enter
     * play. A short minimum hold keeps the screen from flashing. */
    this.toLoading();
    const t0 = performance.now();
    const minHoldMs = 600;
    BgImages.preload(State.selectedLevel).then(() => {
      const wait = Math.max(0, minHoldMs - (performance.now() - t0));
      setTimeout(() => this.enterPlaying(), wait);
    });
  },

  toLoading() {
    State.scene = 'loading';
    State.panicMode = false;
    document.body.classList.remove('scene-splash', 'scene-intro', 'scene-playing', 'scene-gameover', 'panic');
    document.body.classList.add('scene-loading');
    document.getElementById('intro-screen').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    const splash = document.getElementById('splash-screen');
    if (splash) splash.classList.add('hidden');
    const ls = document.getElementById('loading-screen');
    if (ls) {
      ls.classList.remove('hidden');
      const lvlEl = document.getElementById('loading-level');
      if (lvlEl) lvlEl.textContent = State.selectedLevel.toUpperCase();
    }
  },

  enterPlaying() {
    State.scene = 'playing';
    document.body.classList.remove('scene-splash', 'scene-intro', 'scene-loading', 'scene-gameover', 'panic');
    document.body.classList.add('scene-playing');
    const ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');
  },

  endRun(naturallyCompleted) {
    if (State.scene !== 'playing') return;
    const ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');

    const mode = State.selectedMode;
    const diff = State.selectedDifficulty;
    const lvl  = State.selectedLevel;

    let value, isBest = false, completed = false, display;
    if (mode === 'speed') {
      completed = naturallyCompleted && State.cleared >= State.speedGoal;
      value     = State.elapsed;
      display   = completed
        ? HighScores.format('speed', value)
        : `${State.cleared}/${State.speedGoal}`;
      if (completed) isBest = HighScores.set(mode, diff, value);
    } else {
      completed = naturallyCompleted;
      value     = State.score;
      display   = value.toLocaleString();
      isBest    = HighScores.set(mode, diff, value);
    }

    State.lastResult = {
      mode, difficulty: diff, level: lvl,
      completed, value, display, isBest,
      score: State.score, cleared: State.cleared, bestCombo: State.bestCombo
    };
    State.scene = 'gameover';
    State.panicMode = false;
    document.body.classList.remove('scene-splash', 'scene-intro', 'scene-loading', 'scene-playing', 'panic');
    document.body.classList.add('scene-gameover');
    Menu.showGameOver(State.lastResult);
  },

  toIntro() {
    State.scene = 'intro';
    State.panicMode = false;
    document.body.classList.remove('scene-splash', 'scene-playing', 'scene-loading', 'scene-gameover', 'panic');
    document.body.classList.add('scene-intro');
    const splash = document.getElementById('splash-screen');
    if (splash) splash.classList.add('hidden');
    const ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');
    Menu.showIntro();
  },

  cycleLevel() {
    const keys = Object.keys(LEVEL_MAPS);
    const idx  = (keys.indexOf(State.selectedLevel) + 1) % keys.length;
    State.selectedLevel = keys[idx];
    /* Mid-game level swap: brief loading screen while the new backdrop
     * resolves (cached after first visit, so usually just the min hold). */
    this.toLoading();
    const t0 = performance.now();
    const minHoldMs = 350;
    BgImages.preload(State.selectedLevel).then(() => {
      const wait = Math.max(0, minHoldMs - (performance.now() - t0));
      setTimeout(() => {
        Grid.load(State.selectedLevel);
        this.enterPlaying();
      }, wait);
    });
  },

  setTheme(t) {
    State.theme = t;
    document.body.classList.remove('theme-neon', 'theme-dark', 'theme-glitch');
    document.body.classList.add('theme-' + t);
    document.querySelectorAll('.theme-row-intro [data-theme]').forEach(b =>
      b.classList.toggle('active', b.dataset.theme === t));
  },

  requestFullscreen() {
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); }
    catch { /* user gesture required, browser will refuse silently */ }
  },

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.requestFullscreen();
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    }
  }
};

/* =====================================================================
   BOOT
   ===================================================================== */
window.addEventListener('DOMContentLoaded', () => {
  Game.init();
  Game.start();
});

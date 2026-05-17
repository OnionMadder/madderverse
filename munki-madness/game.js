/* Munki Madness — Chunk 1
   Isometric marble maze. The marble is a "Munkable" — a curled-up Munki
   (cross-pollinates with All Munkis). Physics is a custom deterministic
   swept circle-vs-tile-grid stepper (no engine) — exact collision on the
   grid, so the Munkable can't tunnel walls or leave the board. The iso
   projection is a render-only affine transform. Audio is 100% Web Audio
   synthesis and is
   written against the master-gain -> compressor -> destination pattern so
   the Bala's Song engine can later slot in as the ambient bed without a
   rewrite (see assets/sprites/SPRITES_README.md for the asset hand-off).

   Sprite hand-off: drop frames at munki-madness/assets/sprites/ and flip
   the one line marked SPRITE-SWAP below (set USE_SPRITES = true). Until
   then the marble renders as a placeholder shaded circle and the level
   intro plays the placeholder "curl pop". */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Tunables  (all in WORLD units: 1 = one tile, time in seconds)
  // ---------------------------------------------------------------------
  // Custom deterministic physics — no engine. The world is an axis-aligned
  // tile grid, so a swept circle-vs-grid stepper is exact: the Munkable
  // collides against the grid and literally cannot pass it or leave the
  // board. Feel is fully under our control via the knobs below.
  var CANVAS = 640;          // internal canvas resolution (square)
  var MARGIN = 56;           // px breathing room around the board
  var WALL_H = 0.55;         // wall block height in world (tile) units
  var MARBLE_R = 0.30;       // Munkable radius (tiles)

  // ---- Physics knobs — see PHYSICS_SPEC.md (LOCKED v1.0) ----
  var ACCEL = 14;            // input push — responsive but still heavy
  var MAX_SPEED = 6;         // top speed (tiles/s)
  var WALL_BOUNCE = 0.4;     // wall restitution — pinball bonk
  var FRICTION_FLOOR = 0.92; // default per-frame@60 velocity multiplier
  var BUMPER_FORCE = 4;      // instantaneous velocity-add from a bumper
  var GRAVITY = 0;           // no gravity in v1 (reserved for Endeavor)
  var WALL_BONK_MIN = 1.6;   // min normal speed (tiles/s) to squeak

  // Per-surface { drag: per-frame@60 velocity multiplier, grip: accel x }.
  // Higher drag retains more speed (ice glides, gravel bites).
  var SURFACE = {
    floor:  { drag: FRICTION_FLOOR, grip: 1.0 },
    gravel: { drag: 0.78,           grip: 1.0 },
    ice:    { drag: 0.99,           grip: 0.3 }
  };

  var FIXED_DT = 1 / 120;    // physics substep (s)
  var MAX_SUBSTEPS = 8;      // cap substeps per frame (no spiral of death)
  // ---- Tilt control (see report) — calibrated, retuned for heavy ball ----
  var TILT_FULL = 15;             // deg of tilt PAST the recentred zero = full
  var TILT_FORCE_MULTIPLIER = 1.2;// extra tilt gain — feel knob
  var TILT_DEADZONE = 2.5;        // deg of slack around zero (anti-jitter)
  var TILT_FLIP_X = 1;            // set -1 if left/right feels inverted
  var TILT_FLIP_Y = 1;            // set -1 if forward/back feels inverted
  var DRAG_FULL = 90;        // px of drag that = full force

  // SPRITE-SWAP: flip to true once the curl frames + ball PNG are dropped
  // in assets/sprites/ (filenames per SPRITES_README.md). Nothing else
  // needs to change for the placeholder -> real-sprite handoff.
  var USE_SPRITES = false;

  // ---------------------------------------------------------------------
  // Levels. The catalog lives in levels/*.json (the level editor — chunk
  // 3 — writes there; see editor.js). game.js fetches levels/index.json
  // then each listed file. FALLBACK_LEVELS keeps the game playable if the
  // fetch fails (rare: file://, or pre-Capacitor-copy offline).
  // Tile alphabet:  #  wall   .  floor   S  slow/sticky   I  ice
  //                 O  hole   @  spawn   G  goal
  // Level schema (JSON):  { "name", "time", "rows": [ "..." ] }
  // ---------------------------------------------------------------------
  var LEVELS_MANIFEST = "levels/index.json";
  // FALLBACK keeps the game playable if the fetch fails (file:// etc).
  // Same v1.0 schema as the bundled levels/*.json.
  var FALLBACK_LEVELS = [
    { name: "First Roll", grid: { w: 8, h: 7 }, target_time_ms: 18000,
      tiles: [ { x:1,y:1,type:"spawn" }, { x:6,y:5,type:"goal" },
               { x:3,y:3,type:"hole" }, { x:5,y:2,type:"bumper",direction:"S" },
               { x:2,y:4,type:"spinner",rotation:"CW90" } ] }
  ];
  var LEVELS = [];               // filled by loadCatalog()
  var catalogReady = false;

  function dirVec(d) {
    return d === "N" ? { x:0,y:-1 } : d === "S" ? { x:0,y:1 } :
           d === "W" ? { x:-1,y:0 } : { x:1,y:0 };           // E default
  }

  // Parse the v1.0 object-tile schema into the internal model:
  //   { name, target_ms, w, h, cells[r][c]={type,dir,rot}, spawn, goal }
  // Cells not listed default to floor (see PHYSICS_SPEC.md).
  function normalizeLevel(o) {
    var w = (o.grid && o.grid.w) || 8, h = (o.grid && o.grid.h) || 8;
    var cells = [];
    for (var r = 0; r < h; r++) {
      var row = [];
      for (var c = 0; c < w; c++) row.push({ type: "floor" });
      cells.push(row);
    }
    var spawn = { x: 1, y: 1 }, goal = { x: w - 2, y: h - 2 };
    var list = o.tiles || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.x < 0 || t.y < 0 || t.x >= w || t.y >= h) continue;
      if (t.type === "spawn") { spawn = { x: t.x, y: t.y }; cells[t.y][t.x] = { type: "floor" }; continue; }
      var cell = { type: t.type };
      if (t.type === "bumper")  cell.dir = dirVec(t.direction || "E"), cell.dirName = t.direction || "E";
      if (t.type === "spinner") cell.rot = (t.rotation === "CCW90") ? -1 : 1, cell.rotName = t.rotation || "CW90";
      if (t.type === "goal") goal = { x: t.x, y: t.y };
      cells[t.y][t.x] = cell;
    }
    return {
      name: o.title || o.name || "Untitled",
      target_ms: o.target_time_ms || 30000,
      w: w, h: h, cells: cells, spawn: spawn, goal: goal
    };
  }

  function loadCatalog() {
    if (catalogReady) return Promise.resolve(LEVELS);
    return fetch(LEVELS_MANIFEST, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (idx) {
        var files = (idx && idx.levels) || [];
        return Promise.all(files.map(function (f) {
          return fetch("levels/" + f, { cache: "no-store" })
            .then(function (r) { if (!r.ok) throw 0; return r.json(); });
        }));
      })
      .then(function (list) {
        if (!list.length) throw 0;
        LEVELS = list.map(normalizeLevel);
        catalogReady = true;
        return LEVELS;
      })
      .catch(function () {
        LEVELS = FALLBACK_LEVELS.map(normalizeLevel);
        catalogReady = true;
        return LEVELS;
      });
  }

  // ---------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var elLevel = document.getElementById("level");
  var elTimer = document.getElementById("timer");
  var elAttempts = document.getElementById("attempts");
  var elBest = document.getElementById("best");
  var startScreen = document.getElementById("startScreen");
  var endScreen = document.getElementById("endScreen");
  var startBtn = document.getElementById("startBtn");
  var nextBtn = document.getElementById("nextBtn");
  var replayBtn = document.getElementById("replayBtn");
  var restartBtn = document.getElementById("restart");
  var muteBtn = document.getElementById("mute");
  var ctrlBtn = document.getElementById("ctrlBtn");
  var ctrlLabel = document.getElementById("ctrlLabel");
  var howText = document.getElementById("howText");
  var endTitle = document.getElementById("endTitle");
  var endTime = document.getElementById("endTime");
  var endTries = document.getElementById("endTries");
  var endBest = document.getElementById("endBest");
  var endStars = document.getElementById("endStars");
  var recenterBtn = document.getElementById("recenterBtn");
  var dbgBtn = document.getElementById("dbgBtn");
  var fallFlash = document.getElementById("fallFlash");

  // ---------------------------------------------------------------------
  // Control mode
  // ---------------------------------------------------------------------
  var isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  // Toggle cycles Tilt-only / Drag-only / Both. Keyboard+gamepad are an
  // always-on desktop convenience regardless of mode (see PHYSICS_SPEC).
  var CONTROL_MODES = ["tilt", "drag", "both"];
  var controlMode = isTouchDevice ? "tilt" : "drag";

  function refreshCtrlLabel() {
    var label = controlMode.charAt(0).toUpperCase() + controlMode.slice(1);
    if (ctrlLabel) ctrlLabel.textContent = label;
    if (howText) {
      howText.textContent =
        controlMode === "tilt" ? "Tilt your device to roll — (arrows/WASD/pad also work)." :
        controlMode === "drag" ? "Drag anywhere to roll — (arrows/WASD/pad also work)." :
        "Tilt or drag to roll — (arrows/WASD/pad also work).";
    }
  }
  refreshCtrlLabel();

  ctrlBtn.addEventListener("click", function () {
    var i = CONTROL_MODES.indexOf(controlMode);
    controlMode = CONTROL_MODES[(i + 1) % CONTROL_MODES.length];
    if (controlMode === "tilt" || controlMode === "both") requestTilt();
    refreshCtrlLabel();
  });

  // ---------------------------------------------------------------------
  // Audio — Web Audio synthesis only. master gain -> compressor -> dest.
  // ---------------------------------------------------------------------
  var Sound = (function () {
    var actx = null, master = null, comp = null;
    var rollSrc = null, rollGain = null, rollLP = null;
    var muted = false, ready = false;

    function brownNoiseBuffer(c) {
      var n = c.sampleRate * 2;
      var buf = c.createBuffer(1, n, c.sampleRate);
      var d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < n; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      return buf;
    }

    function init() {
      if (ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.9;
      comp = actx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(actx.destination);

      // persistent rolling bed: brown noise -> lowpass -> gain -> master
      rollSrc = actx.createBufferSource();
      rollSrc.buffer = brownNoiseBuffer(actx);
      rollSrc.loop = true;
      rollLP = actx.createBiquadFilter();
      rollLP.type = "lowpass";
      rollLP.frequency.value = 350;
      rollGain = actx.createGain();
      rollGain.gain.value = 0;
      rollSrc.connect(rollLP);
      rollLP.connect(rollGain);
      rollGain.connect(master);
      rollSrc.start();
      ready = true;
    }

    function resume() {
      init();
      if (actx && actx.state === "suspended") actx.resume();
    }

    // Rolling bed driven by marble speed each frame.
    function roll(speed) {
      if (!ready || muted) { if (rollGain) rollGain.gain.value = 0; return; }
      var s = Math.min(speed / 7, 1);
      rollGain.gain.value = 0.0001 + s * 0.16;
      rollLP.frequency.value = 280 + s * 1700;
    }

    // Squeak: sine with a fast upward pitch flick then quick decay.
    function squeak(speed) {
      if (!ready || muted) return;
      var t = actx.currentTime;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine";
      var base = 520 + Math.min(speed, 12) * 70;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 2.1, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.16);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.2);
    }

    // Scream: saw, pitch ~600 -> 80 over 800ms with a wobble LFO.
    function scream() {
      if (!ready || muted) return;
      var t = actx.currentTime, dur = 0.8;
      var o = actx.createOscillator(), g = actx.createGain();
      var lfo = actx.createOscillator(), lfoG = actx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(600, t);
      o.frequency.exponentialRampToValueAtTime(80, t + dur);
      lfo.type = "sine"; lfo.frequency.value = 11;
      lfoG.gain.value = 26;
      lfo.connect(lfoG); lfoG.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.04);
      g.gain.setValueAtTime(0.28, t + dur - 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); lfo.start(t);
      o.stop(t + dur); lfo.stop(t + dur);
    }

    // Goal chime: C-E-G major arpeggio, sine, ~200ms total.
    function chime() {
      if (!ready || muted) return;
      var t = actx.currentTime, notes = [523.25, 659.25, 783.99];
      for (var i = 0; i < notes.length; i++) {
        var o = actx.createOscillator(), g = actx.createGain();
        var st = t + i * 0.06;
        o.type = "sine";
        o.frequency.value = notes[i];
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.25, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
        o.connect(g); g.connect(master);
        o.start(st); o.stop(st + 0.24);
      }
    }

    // Bumper thunk: short low percussive pop (triangle + fast decay).
    function thunk() {
      if (!ready || muted) return;
      var t = actx.currentTime;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.10);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.34, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.18);
    }

    // Spinner whoosh: rising swirl — bandpassed noise sweeping up.
    function whoosh() {
      if (!ready || muted) return;
      var t = actx.currentTime, dur = 0.32;
      var src = actx.createBufferSource();
      src.buffer = brownNoiseBuffer(actx);
      var bp = actx.createBiquadFilter();
      bp.type = "bandpass"; bp.Q.value = 6;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.30, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    function setMuted(m) { muted = m; if (m && rollGain) rollGain.gain.value = 0; }
    function isMuted() { return muted; }

    return { resume: resume, roll: roll, squeak: squeak,
             scream: scream, chime: chime, thunk: thunk, whoosh: whoosh,
             setMuted: setMuted, isMuted: isMuted };
  })();

  muteBtn.addEventListener("click", function () {
    var m = !Sound.isMuted();
    Sound.setMuted(m);
    muteBtn.setAttribute("aria-pressed", String(m));
    muteBtn.innerHTML = m ? "&#128263;" : "&#9834;";
  });

  // ---------------------------------------------------------------------
  // Sprite loader (placeholder until real frames arrive)
  // ---------------------------------------------------------------------
  var Sprites = {
    ready: false,
    curl: [],   // 5 frames: standing(0) .. fully rolled(4)
    ball: null
  };

  function loadSprites() {
    if (!USE_SPRITES) return;
    var base = "assets/sprites/";
    var pending = 6, ok = 0;
    function done() { if (--pending === 0) Sprites.ready = (ok === 6); }
    for (var i = 1; i <= 5; i++) {
      (function (idx) {
        var im = new Image();
        im.onload = function () { ok++; done(); };
        im.onerror = done;
        im.src = base + "munkable-curl-" + idx + ".png";
        Sprites.curl[idx - 1] = im;
      })(i);
    }
    var b = new Image();
    b.onload = function () { ok++; done(); };
    b.onerror = done;
    b.src = base + "munkable-ball.png";
    Sprites.ball = b;
  }
  loadSprites();

  // ---------------------------------------------------------------------
  // Munkable — the player marble (a curled-up Munki). Animation state
  // machine: STANDING -> CURLING -> ROLLED -> UNCURLING.
  // Curl/uncurl play frames 1..5 over ~400ms at level start/end. While
  // ROLLED the sprite spins to match the physics velocity vector.
  // ---------------------------------------------------------------------
  function Munkable() {
    this.state = "STANDING";
    this.animT = 0;            // 0..1 progress through curl/uncurl
    this.spin = 0;             // accumulated roll angle (rad)
    this.popT = 0;             // placeholder curl-pop timer (s)
  }
  Munkable.ANIM_DUR = 0.4;     // seconds for a full curl / uncurl
  Munkable.prototype.beginCurl = function () {
    this.state = "CURLING"; this.animT = 0; this.popT = 0;
  };
  Munkable.prototype.beginUncurl = function () {
    this.state = "UNCURLING"; this.animT = 0;
  };
  Munkable.prototype.update = function (dt, speed) {
    if (this.state === "CURLING") {
      this.animT += dt / Munkable.ANIM_DUR;
      this.popT += dt;
      if (this.animT >= 1) { this.animT = 1; this.state = "ROLLED"; }
    } else if (this.state === "UNCURLING") {
      this.animT += dt / Munkable.ANIM_DUR;
      if (this.animT >= 1) { this.animT = 1; this.state = "STANDING"; }
    } else if (this.state === "ROLLED") {
      this.spin += speed * dt * 2.4;
    }
  };
  Munkable.prototype.frameIndex = function () {
    if (this.state === "CURLING")  return Math.min(4, Math.floor(this.animT * 5));
    if (this.state === "UNCURLING") return Math.min(4, Math.floor((1 - this.animT) * 5));
    if (this.state === "ROLLED")   return 4;
    return 0;
  };

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  var levelIndex = 0;
  var cells = [], cols = 0, rows = 0;     // cells[r][c] = {type,dir,rot,...}
  var targetMs = 30000;                   // 3-star time target for level
  var lastCellKey = "";                   // for fire-once bumper/spinner
  var bumperFlash = {};                   // "c,r" -> flash timer (s)
  // Munkable state — plain object, world units. vx/vy in tiles/s.
  var marble = { x: 1.5, y: 1.5, vx: 0, vy: 0, speed: 0 };
  var startTile = { x: 1.5, y: 1.5 }, goalTile = { x: 0, y: 0 };
  var tileW = 64, tileH = 32, OX = 0, OY = 0;

  var phase = "menu";   // menu | intro | play | falling | won
  var customLevel = null;   // non-null while play-testing an editor level
  var mmExit = null;        // editor "exit test-play" callback, if any
  var munkable = new Munkable();
  var attempts = 0;
  var levelTime = 0;    // seconds this attempt
  var timerRunning = false;
  var fallZ = 0, fallVZ = 0, fallScale = 1, fallT = 0;
  var dragVec = { x: 0, y: 0 }, dragging = false;
  // raw = latest sensor reading; base = calibrated "held" zero-point;
  // on = at least one event received; perm = iOS permission state.
  var tilt = { raw: { gamma: 0, beta: 0 }, base: null, on: false, perm: "n/a" };
  var debugOn = false;
  try { debugOn = /[?&]debug=1(?:&|$)/.test(location.search); } catch (e) {}
  var dbg = { sx: 0, sy: 0, dg: 0, db: 0 };
  var lastTS = 0;

  // ---------------------------------------------------------------------
  // localStorage best-time per level (lightweight; chunk 4 expands this)
  // ---------------------------------------------------------------------
  function bestKey(i) { return "mm.best." + i; }
  function getBest(i) {
    try { var v = localStorage.getItem(bestKey(i)); return v ? parseFloat(v) : null; }
    catch (e) { return null; }
  }
  function setBest(i, t) {
    try { localStorage.setItem(bestKey(i), String(t)); } catch (e) {}
  }
  function showBest() {
    if (customLevel) { elBest.textContent = "--"; return; }
    var b = getBest(levelIndex);
    elBest.textContent = b == null ? "--" : b.toFixed(1) + "s";
  }

  // ---------------------------------------------------------------------
  // Iso projection (render only). Inverse used to map screen-space
  // control vectors back into world-space forces (so a drag/tilt moves
  // the marble the direction the player pushes — kid-intuitive).
  // ---------------------------------------------------------------------
  function projRaw(wx, wy, wz) {
    return {
      x: (wx - wy) * (tileW / 2),
      y: (wx + wy) * (tileH / 2) - (wz || 0) * tileH
    };
  }
  function project(wx, wy, wz) {
    var p = projRaw(wx, wy, wz);
    return { x: p.x + OX, y: p.y + OY };
  }
  function screenVecToWorld(sx, sy) {
    var a = sx / (tileW / 2), b = sy / (tileH / 2);
    return { x: 0.5 * (a + b), y: 0.5 * (b - a) };
  }

  function fitProjection() {
    // base tile size, then auto-scale the board to fit the canvas
    tileW = 64; tileH = 32;
    var corners = [[0,0],[cols,0],[0,rows],[cols,rows]];
    var minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
    for (var i=0;i<corners.length;i++){
      var p = projRaw(corners[i][0], corners[i][1], 0);
      minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
      minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
    }
    minY -= WALL_H * tileH;            // walls extend upward
    var bw = maxX - minX, bh = maxY - minY;
    var s = Math.min((CANVAS - 2*MARGIN) / bw, (CANVAS - 2*MARGIN) / bh);
    tileW *= s; tileH *= s;
    // recompute bbox at scaled size, then center it
    minX=1e9;maxX=-1e9;minY=1e9;maxY=-1e9;
    for (i=0;i<corners.length;i++){
      var q = projRaw(corners[i][0], corners[i][1], 0);
      minX=Math.min(minX,q.x); maxX=Math.max(maxX,q.x);
      minY=Math.min(minY,q.y); maxY=Math.max(maxY,q.y);
    }
    minY -= WALL_H * tileH;
    OX = CANVAS/2 - (minX + maxX)/2;
    OY = CANVAS/2 - (minY + maxY)/2;
  }

  // ---------------------------------------------------------------------
  // Level loading
  // ---------------------------------------------------------------------
  var WALL_CELL = { type: "wall" };
  function cellAt(c, r) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return WALL_CELL;  // edge = hard wall
    return cells[r][c];
  }
  function isWall(c, r) { return cellAt(c, r).type === "wall"; }
  function isHole(c, r) { return cellAt(c, r).type === "hole"; }
  function surfaceOf(c, r) {
    var t = cellAt(c, r).type;
    if (t === "gravel") return "gravel";
    if (t === "ice") return "ice";
    return "floor";   // floor/goal/bumper/spinner all roll like floor
  }

  // spec: a catalog index (number) OR a level object (editor test-play)
  function loadLevel(spec) {
    var lv;
    if (spec && typeof spec === "object" && (spec.tiles || spec.grid)) {
      customLevel = normalizeLevel(spec);
      lv = customLevel;
    } else {
      customLevel = null;
      levelIndex = ((spec % LEVELS.length) + LEVELS.length) % LEVELS.length;
      lv = LEVELS[levelIndex];
    }
    cols = lv.w; rows = lv.h; cells = lv.cells;
    targetMs = lv.target_ms;
    startTile = { x: lv.spawn.x + 0.5, y: lv.spawn.y + 0.5 };
    goalTile = { x: lv.goal.x, y: lv.goal.y };
    lastCellKey = ""; bumperFlash = {};

    fitProjection();
    attempts = 0;
    elLevel.textContent = customLevel ? "TEST" : String(levelIndex + 1);
    elAttempts.textContent = "0";
    showBest();
    resetAttempt(true);
  }

  function resetAttempt(initial) {
    marble.x = startTile.x; marble.y = startTile.y;
    marble.vx = 0; marble.vy = 0; marble.speed = 0;
    fallZ = 0; fallVZ = 0; fallScale = 1; fallT = 0;
    lastCellKey = "";
    levelTime = 0;
    timerRunning = false;
    elTimer.textContent = "0.0";
    munkable = new Munkable();
    munkable.beginCurl();              // curl-up intro every spawn
    phase = "intro";
    if (!initial) {
      attempts++;
      elAttempts.textContent = String(attempts);
    }
  }

  // ---------------------------------------------------------------------
  // Input — tilt
  // ---------------------------------------------------------------------
  function onOrient(e) {
    if (e.gamma == null && e.beta == null) return;
    tilt.raw.gamma = e.gamma || 0;
    tilt.raw.beta = e.beta || 0;
    if (!tilt.base) {                       // auto-zero on the first reading
      tilt.base = { gamma: tilt.raw.gamma, beta: tilt.raw.beta };
    }
    tilt.on = true;
  }
  // Snapshot "however the phone is being held right now" as neutral.
  function recenter() {
    tilt.base = { gamma: tilt.raw.gamma, beta: tilt.raw.beta };
  }
  function applyDeadzone(v, dz) {           // soft knee: small tilts -> 0
    if (v > dz) return v - dz;
    if (v < -dz) return v + dz;
    return 0;
  }

  var tiltListening = false;
  function requestTilt() {
    if (typeof DeviceOrientationEvent === "undefined") { tilt.perm = "unsupported"; return; }
    function listen() {
      if (tiltListening) return;
      tiltListening = true;
      window.addEventListener("deviceorientation", onOrient);
    }
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      tilt.perm = "asking";
      DeviceOrientationEvent.requestPermission().then(function (st) {
        tilt.perm = st;
        if (st === "granted") listen();
        try { localStorage.setItem("mm.motionAsked", "1"); } catch (e) {}
      }).catch(function (err) { tilt.perm = "error"; });
    } else {
      tilt.perm = "granted";              // Android / desktop: no prompt
      listen();
    }
  }

  // ---------------------------------------------------------------------
  // Input — drag (touch + mouse), vector from press origin
  // ---------------------------------------------------------------------
  var dragStart = null;
  function pointFromEvt(ev) {
    var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    return { x: t.clientX, y: t.clientY };
  }
  function dragDown(ev) {
    if (controlMode === "tilt") return;
    dragging = true;
    dragStart = pointFromEvt(ev);
    dragVec.x = 0; dragVec.y = 0;
  }
  function dragMove(ev) {
    if (!dragging || !dragStart) return;
    var p = pointFromEvt(ev);
    dragVec.x = p.x - dragStart.x;
    dragVec.y = p.y - dragStart.y;
    if (ev.cancelable) ev.preventDefault();
  }
  function dragUp() {
    dragging = false; dragStart = null;
    dragVec.x = 0; dragVec.y = 0;
  }
  canvas.addEventListener("touchstart", dragDown, { passive: true });
  canvas.addEventListener("touchmove", dragMove, { passive: false });
  canvas.addEventListener("touchend", dragUp);
  canvas.addEventListener("touchcancel", dragUp);
  canvas.addEventListener("mousedown", dragDown);
  window.addEventListener("mousemove", dragMove);
  window.addEventListener("mouseup", dragUp);

  document.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (customLevel && (k === "escape" || k === "e")) { exitTest(); return; }
    if (k === "r") restartLevel();
    if (k === "m") muteBtn.click();
  });

  // Keyboard steering (arrows + WASD). e.code = layout-independent.
  var keys = Object.create(null);
  var MOVE_CODES = {
    ArrowUp:1, ArrowDown:1, ArrowLeft:1, ArrowRight:1,
    KeyW:1, KeyA:1, KeyS:1, KeyD:1
  };
  function setKey(e, down) {
    if (!MOVE_CODES[e.code]) return;
    keys[e.code] = down;
    if (e.cancelable) e.preventDefault();   // stop arrow-key page scroll
  }
  window.addEventListener("keydown", function (e) { setKey(e, true); });
  window.addEventListener("keyup", function (e) { setKey(e, false); });

  // ---------------------------------------------------------------------
  // Control intent -> world acceleration (screen-space push through the
  // inverse iso transform). Returns {x,y} accel in tiles/s^2 (0,0 = idle).
  // ---------------------------------------------------------------------
  var ZERO_ACCEL = { x: 0, y: 0 };
  function controlAccel() {
    if (phase !== "play") return ZERO_ACCEL;
    var sx = 0, sy = 0;
    var useKeys = true;   // keyboard/gamepad always-on convenience
    var useTilt = (controlMode === "tilt" || controlMode === "both") && tilt.on;
    var useDrag = (controlMode === "drag" || controlMode === "both") && dragging;

    if (useKeys) {
      if (keys.ArrowUp    || keys.KeyW) sy -= 1;   // screen-up
      if (keys.ArrowDown  || keys.KeyS) sy += 1;
      if (keys.ArrowLeft  || keys.KeyA) sx -= 1;
      if (keys.ArrowRight || keys.KeyD) sx += 1;
      var pads = navigator.getGamepads ? navigator.getGamepads() : null;
      var gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
      if (gp) {
        var ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        if (Math.abs(ax) > 0.18) sx += ax;          // left stick
        if (Math.abs(ay) > 0.18) sy += ay;
        var b = gp.buttons;
        if (b[12] && b[12].pressed) sy -= 1;         // d-pad
        if (b[13] && b[13].pressed) sy += 1;
        if (b[14] && b[14].pressed) sx -= 1;
        if (b[15] && b[15].pressed) sx += 1;
      }
    }
    if (useTilt) {
      var bg = tilt.base ? tilt.base.gamma : 0;
      var bb = tilt.base ? tilt.base.beta : 0;
      var dg = applyDeadzone(tilt.raw.gamma - bg, TILT_DEADZONE);
      var db = applyDeadzone(tilt.raw.beta  - bb, TILT_DEADZONE);
      dbg.dg = dg; dbg.db = db;
      sx += clamp(dg / TILT_FULL * TILT_FORCE_MULTIPLIER, -1, 1) * TILT_FLIP_X;
      sy += clamp(db / TILT_FULL * TILT_FORCE_MULTIPLIER, -1, 1) * TILT_FLIP_Y;
    }
    if (useDrag) {
      var dx = clamp(dragVec.x / DRAG_FULL, -1, 1);
      var dy = clamp(dragVec.y / DRAG_FULL, -1, 1);
      sx += dx; sy += dy;
    }
    sx = clamp(sx, -1, 1); sy = clamp(sy, -1, 1);
    dbg.sx = sx; dbg.sy = sy;
    if (sx === 0 && sy === 0) return ZERO_ACCEL;

    var w = screenVecToWorld(sx, sy);
    var len = Math.hypot(w.x, w.y) || 1;
    var mag = Math.min(1, Math.hypot(sx, sy));   // input strength 0..1
    return { x: (w.x / len) * ACCEL * mag, y: (w.y / len) * ACCEL * mag };
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------------------------------------------------------------------
  // Custom grid physics
  // ---------------------------------------------------------------------
  // A cell is solid if it's a wall OR off the board. Holes are NOT solid
  // (the Munkable rolls into them — that's the fall). Floor/ice/gravel/
  // goal/spawn are passable.
  function solidAt(c, r) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return true;  // off-board
    return cells[r][c].type === "wall";
  }

  // Resolve circle-vs-solid-tile overlaps by minimum translation, and
  // cancel the inward velocity (slide along walls, small bounce). Called
  // after every micro-step so a fast Munkable can never pass a wall.
  function resolveCollisions() {
    var R = MARBLE_R;
    for (var it = 0; it < 4; it++) {
      var any = false;
      var c0 = Math.floor(marble.x - R) - 1, c1 = Math.floor(marble.x + R) + 1;
      var r0 = Math.floor(marble.y - R) - 1, r1 = Math.floor(marble.y + R) + 1;
      for (var rr = r0; rr <= r1; rr++) {
        for (var cc = c0; cc <= c1; cc++) {
          if (!solidAt(cc, rr)) continue;
          var qx = clamp(marble.x, cc, cc + 1);   // closest pt on tile AABB
          var qy = clamp(marble.y, rr, rr + 1);
          var dx = marble.x - qx, dy = marble.y - qy;
          var d2 = dx * dx + dy * dy;
          if (d2 >= R * R) continue;
          var nx, ny, pen;
          if (d2 > 1e-9) {
            var d = Math.sqrt(d2);
            nx = dx / d; ny = dy / d; pen = R - d;
          } else {
            // center inside the tile — eject along the shallowest face
            var lP = marble.x - cc, rP = (cc + 1) - marble.x;
            var tP = marble.y - rr, bP = (rr + 1) - marble.y;
            var mX = Math.min(lP, rP), mY = Math.min(tP, bP);
            if (mX < mY) { nx = (lP < rP) ? -1 : 1; ny = 0; pen = R + mX; }
            else         { nx = 0; ny = (tP < bP) ? -1 : 1; pen = R + mY; }
          }
          marble.x += nx * pen;
          marble.y += ny * pen;
          var vn = marble.vx * nx + marble.vy * ny;   // velocity into wall
          if (vn < 0) {
            if (-vn > WALL_BONK_MIN && phase === "play") Sound.squeak(-vn);
            marble.vx -= (1 + WALL_BOUNCE) * vn * nx;
            marble.vy -= (1 + WALL_BOUNCE) * vn * ny;
          }
          any = true;
        }
      }
      if (!any) break;
    }
  }

  // One fixed physics substep: integrate control + per-surface drag, cap
  // speed, then swept-move in micro-steps (each shorter than the radius
  // so a wall can't be skipped) resolving grid collisions as we go.
  function physicsTick() {
    var s = SURFACE[surfaceOf(Math.floor(marble.x), Math.floor(marble.y))];
    var a = controlAccel();
    marble.vx += a.x * s.grip * FIXED_DT;
    marble.vy += a.y * s.grip * FIXED_DT;
    // s.drag is a per-frame@60 multiplier — convert to this substep.
    var keep = Math.pow(s.drag, FIXED_DT * 60);
    marble.vx *= keep; marble.vy *= keep;

    var sp = Math.hypot(marble.vx, marble.vy);
    if (sp > MAX_SPEED) { var k = MAX_SPEED / sp; marble.vx *= k; marble.vy *= k; sp = MAX_SPEED; }
    marble.speed = sp;

    var dx = marble.vx * FIXED_DT, dy = marble.vy * FIXED_DT;
    var dist = Math.hypot(dx, dy);
    var n = Math.max(1, Math.ceil(dist / (MARBLE_R * 0.5)));
    for (var i = 0; i < n; i++) {
      marble.x += dx / n;
      marble.y += dy / n;
      resolveCollisions();
    }
    marble.speed = Math.hypot(marble.vx, marble.vy);
  }

  function worldStep(dt) {
    if (phase === "play") {
      var cc = Math.floor(marble.x);
      var rr = Math.floor(marble.y);
      var cell = cellAt(cc, rr);

      if (!timerRunning && marble.speed > 0.05) timerRunning = true;
      if (timerRunning) {
        levelTime += dt;
        elTimer.textContent = levelTime.toFixed(1);
      }
      // decay bumper flashes
      for (var key in bumperFlash) {
        bumperFlash[key] -= dt;
        if (bumperFlash[key] <= 0) delete bumperFlash[key];
      }

      // fire bumper / spinner once per tile entry
      var ck = cc + "," + rr;
      if (ck !== lastCellKey) {
        lastCellKey = ck;
        if (cell.type === "bumper" && cell.dir) {
          marble.vx += cell.dir.x * BUMPER_FORCE;
          marble.vy += cell.dir.y * BUMPER_FORCE;
          bumperFlash[ck] = 0.18;
          Sound.thunk();
        } else if (cell.type === "spinner") {
          var rot = cell.rot || 1;             // 1 = CW90, -1 = CCW90
          var nvx = (rot === 1) ? -marble.vy : marble.vy;
          var nvy = (rot === 1) ?  marble.vx : -marble.vx;
          marble.vx = nvx; marble.vy = nvy;
          Sound.whoosh();
        }
      }

      if (cell.type === "hole") {
        beginFall();
      } else if (cc === goalTile.x && rr === goalTile.y) {
        winLevel();
      }
    } else if (phase === "falling") {
      // 350ms shrink+sink+fade, then a 600ms beat, then respawn.
      fallT += dt;
      if (fallT <= 0.35) {
        var p = fallT / 0.35;
        fallScale = 1 - p;
        fallZ = -0.9 * p;
      } else {
        fallScale = 0;
      }
      if (fallT >= 0.95) {
        flashFall(false);
        resetAttempt(false);
      }
    }
  }

  function beginFall() {
    phase = "falling";
    timerRunning = false;
    fallT = 0; fallZ = 0; fallScale = 1;
    marble.vx = 0; marble.vy = 0; marble.speed = 0;
    Sound.scream();
    flashFall(true);
  }
  function flashFall(on) {
    if (!fallFlash) return;
    if (on) { fallFlash.classList.add("show"); }
    else { fallFlash.classList.remove("show"); }
  }

  function winLevel() {
    phase = "won";
    timerRunning = false;
    munkable.beginUncurl();
    Sound.chime();
    // Stars: 1 = cleared, 2 = zero falls, 3 = zero falls AND under target.
    var falls = attempts;                       // respawns this level
    var stars = 1;
    if (falls === 0) stars = 2;
    if (falls === 0 && levelTime * 1000 < targetMs) stars = 3;

    var isBest = false;
    if (!customLevel) {
      var b = getBest(levelIndex);
      isBest = (b == null || levelTime < b);
      if (isBest) { setBest(levelIndex, +levelTime.toFixed(2)); }
      showBest();
    }
    var lvName = customLevel ? customLevel.name : LEVELS[levelIndex].name;
    endTitle.textContent = lvName + (customLevel ? " — Test Clear!" : " — Clear!");
    if (endStars) {
      endStars.textContent = "★★★".slice(0, stars) +
                             "☆☆☆".slice(0, 3 - stars);
      endStars.setAttribute("data-stars", String(stars));
    }
    if (nextBtn) nextBtn.textContent = customLevel ? "Back to Editor" : "Next Level";
    endTime.textContent = levelTime.toFixed(1);
    endTries.textContent = String(attempts);
    endBest.hidden = !isBest;
    setTimeout(function () { endScreen.hidden = false; }, 700);
  }

  function restartLevel() {
    if (phase === "menu") return;
    endScreen.hidden = true;
    flashFall(false);
    resetAttempt(false);
    attempts = Math.max(0, attempts);
  }

  // Editor test-play -> back to editor (win "Back to Editor", or Esc/E).
  function exitTest() {
    if (!customLevel) return;
    var f = mmExit;
    mmExit = null; customLevel = null;
    phase = "menu";
    endScreen.hidden = true;
    flashFall(false);
    if (nextBtn) nextBtn.textContent = "Next Level";
    if (typeof f === "function") f();
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function diamond(cx, cy, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  function tileColor(type) {
    switch (type) {
      case "gravel":  return "#7a5733";  // brown
      case "ice":     return "#7fd9ff";  // pale blue
      case "goal":    return "#ffd76b";  // gold
      case "bumper":  return "#c8623c";  // orange
      case "spinner": return "#3f8f86";  // teal
      default:        return "#3d2a63";  // floor
    }
  }

  // Arrow pointing along a world direction, drawn in screen space.
  function drawArrow(cx, cy, cen, dirName) {
    var v = dirVec(dirName);
    var t = project(cx + 0.5 + v.x * 0.4, cy + 0.5 + v.y * 0.4, 0);
    var ang = Math.atan2(t.y - cen.y, t.x - cen.x);
    var L = tileW * 0.22;
    ctx.save();
    ctx.translate(cen.x, cen.y);
    ctx.rotate(ang);
    ctx.fillStyle = "#fff1dd";
    ctx.beginPath();
    ctx.moveTo(L, 0); ctx.lineTo(-L * 0.5, L * 0.45);
    ctx.lineTo(-L * 0.2, 0); ctx.lineTo(-L * 0.5, -L * 0.45);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawSwirl(cen, rotDir) {
    var ph = (performance.now() / 500) * rotDir;
    ctx.save();
    ctx.translate(cen.x, cen.y);
    ctx.strokeStyle = "#cdf3ee";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, tileW * 0.20, ph, ph + Math.PI * 1.4);
    ctx.stroke();
    var ex = Math.cos(ph + Math.PI * 1.4) * tileW * 0.20;
    var ey = Math.sin(ph + Math.PI * 1.4) * tileW * 0.20;
    ctx.fillStyle = "#cdf3ee";
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBoard() {
    var hw = tileW / 2, hh = tileH / 2, now = performance.now();
    for (var sum = 0; sum <= cols + rows; sum++) {
      for (var r = 0; r < rows; r++) {
        var c = sum - r;
        if (c < 0 || c >= cols) continue;
        var cell = cells[r][c], type = cell.type;
        var cen = project(c + 0.5, r + 0.5, 0);

        if (type === "wall") {
          var top = project(c + 0.5, r + 0.5, WALL_H);
          ctx.fillStyle = "#1f1338";
          ctx.beginPath();
          ctx.moveTo(cen.x - hw, cen.y); ctx.lineTo(cen.x, cen.y + hh);
          ctx.lineTo(top.x, top.y + hh); ctx.lineTo(top.x - hw, top.y);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#2c1c4d";
          ctx.beginPath();
          ctx.moveTo(cen.x + hw, cen.y); ctx.lineTo(cen.x, cen.y + hh);
          ctx.lineTo(top.x, top.y + hh); ctx.lineTo(top.x + hw, top.y);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#4a3270";
          diamond(top.x, top.y, hw, hh); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.stroke();
          continue;
        }

        if (type === "hole") {
          diamond(cen.x, cen.y, hw, hh);
          ctx.fillStyle = "#150b25"; ctx.fill();
          ctx.save();
          diamond(cen.x, cen.y + hh * 0.16, hw * 0.66, hh * 0.66);
          ctx.fillStyle = "#05030a"; ctx.fill();
          ctx.restore();
          diamond(cen.x, cen.y, hw, hh);
          ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.lineWidth = 2; ctx.stroke();
          continue;
        }

        diamond(cen.x, cen.y, hw, hh);
        ctx.fillStyle = tileColor(type); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 1; ctx.stroke();

        if (type === "gravel") {
          ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.28)";
          for (var k = 0; k < 7; k++) {
            var a = ((c * 13 + r * 29 + k * 47) % 100) / 100;
            var b = ((c * 7 + r * 17 + k * 31) % 100) / 100;
            ctx.beginPath();
            ctx.arc(cen.x + (a - 0.5) * hw, cen.y + (b - 0.5) * hh, 1.4, 0, 6.28);
            ctx.fill();
          }
          ctx.restore();
        } else if (type === "ice") {
          ctx.save();
          ctx.globalAlpha = 0.20 + 0.18 * (0.5 + 0.5 * Math.sin(now / 320 + (c + r)));
          diamond(cen.x, cen.y, hw * 0.6, hh * 0.6);
          ctx.fillStyle = "#e7faff"; ctx.fill();
          ctx.restore();
        } else if (type === "goal") {
          ctx.save();
          ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now / 240);
          diamond(cen.x, cen.y, hw * 0.62, hh * 0.62);
          ctx.fillStyle = "#fff2c0"; ctx.fill();
          ctx.restore();
        } else if (type === "bumper") {
          var fk = c + "," + r, fl = bumperFlash[fk];
          if (fl) {
            ctx.save();
            ctx.globalAlpha = Math.min(0.6, fl / 0.18 * 0.6);
            diamond(cen.x, cen.y, hw, hh);
            ctx.fillStyle = "#ffe0bf"; ctx.fill();
            ctx.restore();
          }
          drawArrow(c, r, cen, cell.dirName || "E");
        } else if (type === "spinner") {
          drawSwirl(cen, cell.rot || 1);
        }
      }
    }
  }

  function drawMarble() {
    if (!marble) return;
    var z = (phase === "falling") ? fallZ : 0;
    var p = project(marble.x, marble.y, z);

    // shadow on the floor (skip while falling)
    if (phase !== "falling") {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = "#000";
      var fp = project(marble.x, marble.y, 0);
      ctx.beginPath();
      ctx.ellipse(fp.x, fp.y + tileH * 0.10, tileW * MARBLE_R * 0.95,
                  tileH * MARBLE_R * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // placeholder "curl pop" during the intro: scale 1.0 -> 0.6 w/ bounce
    var rpx = tileW * MARBLE_R;
    var scale = 1;
    if (munkable.state === "CURLING") {
      var k = munkable.animT;
      scale = 1 - 0.4 * k + 0.08 * Math.sin(k * Math.PI * 3) * (1 - k);
    } else if (munkable.state === "UNCURLING") {
      scale = 0.6 + 0.4 * munkable.animT;
    }
    if (phase === "falling") scale *= fallScale;
    var R = rpx * scale;
    var fade = (phase === "falling") ? Math.max(0, fallScale) : 1;

    if (USE_SPRITES && Sprites.ready) {
      var img = (munkable.state === "ROLLED") ? Sprites.ball
                                           : Sprites.curl[munkable.frameIndex()];
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      if (munkable.state === "ROLLED") ctx.rotate(munkable.spin * 0.5);
      ctx.drawImage(img, -R, -R, R * 2, R * 2);
      ctx.restore();
      return;
    }

    // placeholder marble: shaded sphere with a roll seam to read spin
    ctx.save();
    ctx.globalAlpha = fade;
    var g = ctx.createRadialGradient(
      p.x - R * 0.35, p.y - R * 0.4, R * 0.1,
      p.x, p.y, R);
    g.addColorStop(0, "#ffe39a");
    g.addColorStop(0.55, "#e7913f");
    g.addColorStop(1, "#9a5114");
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.5; ctx.stroke();
    // seam line rotates with accumulated spin
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(munkable.spin * 0.5);
    ctx.strokeStyle = "rgba(60,25,0,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.62, R * 0.92, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function drawDebug() {
    var L = [
      "TILT DEBUG  (?debug=1)",
      "mode=" + controlMode + "  perm=" + tilt.perm + "  on=" + tilt.on,
      "raw  g=" + tilt.raw.gamma.toFixed(1) + "  b=" + tilt.raw.beta.toFixed(1),
      "base " + (tilt.base ? ("g=" + tilt.base.gamma.toFixed(1) + " b=" + tilt.base.beta.toFixed(1)) : "(not set)"),
      "delta dg=" + dbg.dg.toFixed(1) + "  db=" + dbg.db.toFixed(1),
      "input sx=" + dbg.sx.toFixed(2) + "  sy=" + dbg.sy.toFixed(2),
      "marble v=(" + marble.vx.toFixed(2) + "," + marble.vy.toFixed(2) + ")  spd=" + marble.speed.toFixed(2),
      "TILT_FULL=" + TILT_FULL + "  MULT=" + TILT_FORCE_MULTIPLIER + "  DZ=" + TILT_DEADZONE + "  ACCEL=" + ACCEL
    ];
    ctx.save();
    ctx.font = "13px monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(8, 8, 320, L.length * 18 + 12);
    ctx.fillStyle = "#7df0c8";
    for (var i = 0; i < L.length; i++) ctx.fillText(L[i], 16, 16 + i * 18);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    if (cols === 0) return;
    drawBoard();
    drawMarble();
    if (debugOn) drawDebug();
  }

  // ---------------------------------------------------------------------
  // Main loop — fixed-step custom physics substeps, then render
  // ---------------------------------------------------------------------
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTS) lastTS = ts;
    var dt = Math.min((ts - lastTS) / 1000, 0.05);
    lastTS = ts;

    if (phase === "intro") {
      munkable.update(dt, 0);
      if (munkable.state === "ROLLED") phase = "play";
    } else if (phase === "play") {
      var steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.round(dt / FIXED_DT)));
      for (var s = 0; s < steps && phase === "play"; s++) physicsTick();
      munkable.update(dt, marble.speed);
      Sound.roll(marble.speed);
    } else if (phase === "falling") {
      Sound.roll(0);
      munkable.update(dt, 0);
    } else if (phase === "won") {
      Sound.roll(0);
      munkable.update(dt, 0);
    } else {
      Sound.roll(0);
    }

    if (phase === "play" || phase === "falling") worldStep(dt);
    render();
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------
  startBtn.addEventListener("click", function () {
    Sound.resume();
    // Always request from this user gesture (iOS needs it; harmless
    // elsewhere) so tilt works immediately and after toggling modes.
    requestTilt();
    tilt.base = null;                 // re-zero to however it's held now
    startBtn.disabled = true;
    loadCatalog().then(function () {
      startBtn.disabled = false;
      startScreen.hidden = true;
      loadLevel(0);
    });
  });
  nextBtn.addEventListener("click", function () {
    endScreen.hidden = true;
    if (customLevel) { exitTest(); return; }
    loadLevel(levelIndex + 1);
  });
  replayBtn.addEventListener("click", function () {
    endScreen.hidden = true;
    resetAttempt(true);
    attempts = 0; elAttempts.textContent = "0";
  });
  restartBtn.addEventListener("click", restartLevel);

  if (recenterBtn) recenterBtn.addEventListener("click", function () {
    requestTilt();                       // ensure iOS permission (gesture)
    recenter();
    recenterBtn.textContent = "✓";
    setTimeout(function () { recenterBtn.innerHTML = "&#127919;"; }, 800);
  });
  if (dbgBtn) dbgBtn.addEventListener("click", function () {
    debugOn = !debugOn;
    dbgBtn.setAttribute("aria-pressed", String(debugOn));
  });

  // ---------------------------------------------------------------------
  // Editor bridge (chunk 3). editor.js is only loaded behind the dev gate
  // (?editor=1 / Konami) — see the bootstrap in index.html. The editor
  // owns its own DOM/canvas; it just borrows these entry points.
  // ---------------------------------------------------------------------
  window.MM = {
    loadCatalog: loadCatalog,
    manifestPath: LEVELS_MANIFEST,
    // editor-facing copy of the bundled catalog as { name, time, rows }
    getBundledLevels: function () {
      return LEVELS.map(function (l) {
        return { name: l.name, time: l.time, rows: l.grid.slice() };
      });
    },
    // drop straight into a playable test of an arbitrary level object;
    // opts.onExit() fires when the player finishes or hits Esc/"Back".
    playLevel: function (obj, opts) {
      opts = opts || {};
      mmExit = opts.onExit || null;
      Sound.resume();
      startScreen.hidden = true;
      endScreen.hidden = true;
      loadCatalog().then(function () { loadLevel(obj); });
    }
  };

  // ---------------------------------------------------------------------
  // Live-tune panel (dev) — ?tune=1. Drag sliders mid-play to dial feel;
  // values apply instantly (the engine reads these vars every tick).
  // "Copy values" copies a paste-ready block to hand back for committing.
  // ---------------------------------------------------------------------
  (function buildTunePanel() {
    var on = false;
    try { on = /[?&]tune=1(?:&|$)/.test(location.search); } catch (e) {}
    if (!on) return;

    var SPECS = [
      { k: "ACCEL",        min: 4,    max: 24,    step: 0.5,
        get: function () { return ACCEL; },        set: function (v) { ACCEL = v; } },
      { k: "MAX_SPEED",    min: 2,    max: 12,    step: 0.5,
        get: function () { return MAX_SPEED; },    set: function (v) { MAX_SPEED = v; } },
      { k: "WALL_BOUNCE",  min: 0,    max: 0.9,   step: 0.05,
        get: function () { return WALL_BOUNCE; },  set: function (v) { WALL_BOUNCE = v; } },
      { k: "TILT_FORCE_MULTIPLIER", min: 0.4, max: 3, step: 0.1,
        get: function () { return TILT_FORCE_MULTIPLIER; }, set: function (v) { TILT_FORCE_MULTIPLIER = v; } },
      { k: "floor.drag",   min: 0.80, max: 0.99,  step: 0.005,
        get: function () { return SURFACE.floor.drag; },  set: function (v) { SURFACE.floor.drag = v; } },
      { k: "gravel.drag",  min: 0.60, max: 0.95,  step: 0.005,
        get: function () { return SURFACE.gravel.drag; }, set: function (v) { SURFACE.gravel.drag = v; } },
      { k: "ice.drag",     min: 0.93, max: 0.999, step: 0.002,
        get: function () { return SURFACE.ice.drag; },    set: function (v) { SURFACE.ice.drag = v; } },
      { k: "ice.grip",     min: 0.05, max: 1,     step: 0.05,
        get: function () { return SURFACE.ice.grip; },    set: function (v) { SURFACE.ice.grip = v; } }
    ];

    var box = document.createElement("div");
    box.setAttribute("style",
      "position:fixed;left:8px;bottom:8px;z-index:9998;width:248px;" +
      "background:rgba(14,7,32,0.92);border:1px solid #3a2a5c;border-radius:10px;" +
      "padding:10px 12px;color:#f3ecff;font:12px monospace;");
    var title = document.createElement("div");
    title.textContent = "LIVE TUNE  (?tune=1)";
    title.setAttribute("style", "color:#ffd76b;font-weight:700;margin-bottom:6px;");
    box.appendChild(title);

    SPECS.forEach(function (s) {
      var row = document.createElement("div");
      row.setAttribute("style", "margin:5px 0;");
      var lab = document.createElement("div");
      var val = document.createElement("span");
      val.setAttribute("style", "color:#7df0c8;");
      function setLabel() { val.textContent = (+s.get()).toFixed(3).replace(/\.?0+$/, ""); }
      lab.textContent = s.k + " = "; lab.appendChild(val);
      var rng = document.createElement("input");
      rng.type = "range"; rng.min = s.min; rng.max = s.max; rng.step = s.step;
      rng.value = s.get();
      rng.setAttribute("style", "width:100%;");
      rng.addEventListener("input", function () { s.set(parseFloat(rng.value)); setLabel(); });
      setLabel();
      row.appendChild(lab); row.appendChild(rng);
      box.appendChild(row);
    });

    var copy = document.createElement("button");
    copy.textContent = "Copy values";
    copy.setAttribute("style",
      "margin-top:8px;width:100%;background:#3c2464;color:#f3ecff;" +
      "border:1px solid #5a3286;border-radius:6px;padding:7px;font:inherit;cursor:pointer;");
    copy.addEventListener("click", function () {
      var txt = "ACCEL=" + ACCEL + "  MAX_SPEED=" + MAX_SPEED +
                "  WALL_BOUNCE=" + WALL_BOUNCE +
                "  TILT_FORCE_MULTIPLIER=" + TILT_FORCE_MULTIPLIER +
                "  SURFACE.floor.drag=" + SURFACE.floor.drag +
                "  SURFACE.gravel.drag=" + SURFACE.gravel.drag +
                "  SURFACE.ice.drag=" + SURFACE.ice.drag +
                "  SURFACE.ice.grip=" + SURFACE.ice.grip;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          function () { copy.textContent = "Copied ✓"; setTimeout(function () { copy.textContent = "Copy values"; }, 1200); },
          function () { window.prompt("Tell Claude these values:", txt); });
      } else { window.prompt("Tell Claude these values:", txt); }
    });
    box.appendChild(copy);

    if (document.body) document.body.appendChild(box);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(box); });
  })();

  // first paint of the menu (board hidden behind overlay)
  requestAnimationFrame(frame);
})();

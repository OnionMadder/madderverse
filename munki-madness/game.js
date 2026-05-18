/* Munki Madness — Chunk 1
   Isometric marble maze. The marble is a "Marble" — a curled-up Munki
   (cross-pollinates with All Munkis). Physics is a custom deterministic
   swept circle-vs-tile-grid stepper (no engine) — exact collision on the
   grid, so the Marble can't tunnel walls or leave the board. The iso
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
  // tile grid, so a swept circle-vs-grid stepper is exact: the Marble
  // collides against the grid and literally cannot pass it or leave the
  // board. Feel is fully under our control via the knobs below.
  var CANVAS = 640;          // internal canvas resolution (square)
  var MARGIN = 56;           // px breathing room around the board
  var WALL_H = 0.55;         // wall block height in world (tile) units
  var HEIGHT_UNIT = 0.5;     // world-z rise per elevation level
  var SPRING_ARC = 0.45;     // spring launch visual-arc duration (s)
  var MARBLE_R = 0.30;       // Marble radius (tiles)

  // ---- Physics knobs — see PHYSICS_SPEC.md (LOCKED v1.0) ----
  var ACCEL = 24;            // input push — player-dialed 2026-05-18 (?tune=1)
  var MAX_SPEED = 12;        // top speed (tiles/s) — player-dialed
  var WALL_BOUNCE = 0.4;     // wall restitution — pinball bonk
  var FRICTION_FLOOR = 0.965;// per-frame@60 vel multiplier — player-dialed
  var BUMPER_FORCE = 4;      // instantaneous velocity-add from a bumper
  var GRAVITY = 0;           // no gravity in v1 (reserved for Endeavor)
  var WALL_BONK_MIN = 1.6;   // min normal speed (tiles/s) to squeak

  // Per-surface { drag: per-frame@60 velocity multiplier, grip: accel x }.
  // Higher drag retains more speed (ice glides, gravel bites).
  var SURFACE = {
    floor:  { drag: FRICTION_FLOOR, grip: 1.0 },
    gravel: { drag: 0.78,           grip: 1.0 },
    ice:    { drag: 0.998,          grip: 0.3 }
  };

  var FIXED_DT = 1 / 120;    // physics substep (s)
  var MAX_SUBSTEPS = 8;      // cap substeps per frame (no spiral of death)
  // ---- Tilt control (see report) — calibrated, retuned for heavy ball ----
  var TILT_FULL = 15;             // deg of tilt PAST the recentred zero = full
  var TILT_FORCE_MULTIPLIER = 1.4;// extra tilt gain — player-dialed 2026-05-18
  var TILT_DEADZONE = 2.5;        // deg of slack around zero (anti-jitter)
  var TILT_FLIP_X = 1;            // set -1 if left/right feels inverted
  var TILT_FLIP_Y = 1;            // set -1 if forward/back feels inverted
  var DRAG_FULL = 90;        // px of drag that = full force

  // ---- Per-level physics overlay (opt-in) ----
  // The constants above are the GLOBAL BASE. A level JSON may carry a
  // sparse "physics" block listing ONLY the knobs it changes; loadLevel
  // overlays it on BASE_PHYS, so any level without a physics block is
  // byte-identical to the global feel. Keys mirror the ?tune=1 panel 1:1
  // so its "Copy values" output pastes straight into a level.
  var BASE_PHYS = {
    "ACCEL": ACCEL, "MAX_SPEED": MAX_SPEED, "WALL_BOUNCE": WALL_BOUNCE,
    "TILT_FORCE_MULTIPLIER": TILT_FORCE_MULTIPLIER,
    "floor.drag": SURFACE.floor.drag, "gravel.drag": SURFACE.gravel.drag,
    "ice.drag": SURFACE.ice.drag, "ice.grip": SURFACE.ice.grip
  };
  var curLevelLabel = "";   // shown in the tune panel's Copy header
  var tuneLvlEl = null;     // tune-panel subtitle (current level)
  var tuneRefreshers = [];  // snap panel sliders to live values on level load
  function clampPhys(k, v) {
    v = +v;
    if (!isFinite(v)) return BASE_PHYS[k];
    if (k === "WALL_BOUNCE") return Math.max(0, Math.min(0.98, v));
    if (k === "floor.drag" || k === "gravel.drag" || k === "ice.drag")
      return Math.max(0.3, Math.min(0.9999, v));   // <1 or velocity runs away
    return Math.max(0, v);
  }
  function applyPhysics(p) {
    ACCEL = p["ACCEL"]; MAX_SPEED = p["MAX_SPEED"];
    WALL_BOUNCE = p["WALL_BOUNCE"];
    TILT_FORCE_MULTIPLIER = p["TILT_FORCE_MULTIPLIER"];
    SURFACE.floor.drag  = p["floor.drag"];
    SURFACE.gravel.drag = p["gravel.drag"];
    SURFACE.ice.drag    = p["ice.drag"];
    SURFACE.ice.grip    = p["ice.grip"];
  }
  // effective = BASE overlaid with a level's sparse override (clamped).
  function effectivePhysics(override) {
    var e = {}, k;
    for (k in BASE_PHYS) e[k] = BASE_PHYS[k];
    if (override) for (k in override)
      if (BASE_PHYS.hasOwnProperty(k) && override[k] != null)
        e[k] = clampPhys(k, override[k]);
    return e;
  }

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
    { name: "First Roll", grid: { w: 8, h: 7 }, fill: "floor", target_time_ms: 18000,
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

  // Parse the v1.0 object-tile schema into the internal model. The map is
  // SPARSE: tmap["x,y"] -> tile, or undefined = a gap (impassable, like a
  // wall). Optional "fill" pre-paints the whole w*h with one type (a
  // convenience for rectangular levels); omit it for irregular shapes.
  // Tile fields: { x,y,type,height, dir,dirName, rot,rotName, hd }.
  //   ramp:   direction + height_delta (hd)   spring: height_delta (hd)
  // See munki-madness/PHYSICS_SPEC.md.
  function mkCell(t) {
    var cell = { type: t.type, height: t.height || 0 };
    if (t.type === "bumper") { cell.dir = dirVec(t.direction || "E"); cell.dirName = t.direction || "E"; }
    if (t.type === "spinner") { cell.rot = (t.rotation === "CCW90") ? -1 : 1; cell.rotName = t.rotation || "CW90"; }
    if (t.type === "ramp") {
      cell.dir = dirVec(t.direction || "E"); cell.dirName = t.direction || "E";
      cell.hd = (t.height_delta == null) ? 1 : t.height_delta;
    }
    if (t.type === "spring") cell.hd = (t.height_delta == null) ? 2 : t.height_delta;
    return cell;
  }
  function normalizeLevel(o) {
    var w = (o.grid && o.grid.w) || 24, h = (o.grid && o.grid.h) || 24;
    var tmap = {}, list = o.tiles || [];
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, maxH = 0;
    function put(x, y, cell) {
      tmap[x + "," + y] = cell;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if ((cell.height || 0) > maxH) maxH = cell.height || 0;
    }
    if (o.fill) {
      for (var yy = 0; yy < h; yy++)
        for (var xx = 0; xx < w; xx++) put(xx, yy, { type: o.fill, height: 0 });
    }
    var spawn = { x: 1, y: 1 }, goal = { x: w - 2, y: h - 2 };
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.x == null || t.y == null) continue;
      if (t.type === "spawn") {
        spawn = { x: t.x, y: t.y };
        put(t.x, t.y, { type: "floor", height: t.height || 0 });
        continue;
      }
      if (t.type === "goal") goal = { x: t.x, y: t.y };
      put(t.x, t.y, mkCell(t));
    }
    if (minX > maxX) { minX = 0; maxX = w - 1; minY = 0; maxY = h - 1; }
    return {
      name: o.title || o.name || "Untitled",
      target_ms: o.target_time_ms || 30000,
      w: w, h: h, tmap: tmap, spawn: spawn, goal: goal,
      bx: minX, by: minY, ex: maxX, ey: maxY, maxH: maxH,
      physics: (o.physics && typeof o.physics === "object") ? o.physics : null
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

    // Spring boing: quick upward pitch sproing (triangle) with a tail.
    function boing() {
      if (!ready || muted) return;
      var t = actx.currentTime;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(680, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.30);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.36);
    }

    function setMuted(m) { muted = m; if (m && rollGain) rollGain.gain.value = 0; }
    function isMuted() { return muted; }

    return { resume: resume, roll: roll, squeak: squeak,
             scream: scream, chime: chime, thunk: thunk, whoosh: whoosh,
             boing: boing, setMuted: setMuted, isMuted: isMuted };
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
        im.src = base + "marble-curl-" + idx + ".png";
        Sprites.curl[idx - 1] = im;
      })(i);
    }
    var b = new Image();
    b.onload = function () { ok++; done(); };
    b.onerror = done;
    b.src = base + "marble-ball.png";
    Sprites.ball = b;
  }
  loadSprites();

  // ---------------------------------------------------------------------
  // Marble — the player marble (a curled-up Munki). Animation state
  // machine: STANDING -> CURLING -> ROLLED -> UNCURLING.
  // Curl/uncurl play frames 1..5 over ~400ms at level start/end. While
  // ROLLED the sprite spins to match the physics velocity vector.
  // ---------------------------------------------------------------------
  function Marble() {
    this.state = "STANDING";
    this.animT = 0;            // 0..1 progress through curl/uncurl
    this.spin = 0;             // accumulated roll angle (rad)
    this.popT = 0;             // placeholder curl-pop timer (s)
  }
  Marble.ANIM_DUR = 0.4;     // seconds for a full curl / uncurl
  Marble.prototype.beginCurl = function () {
    this.state = "CURLING"; this.animT = 0; this.popT = 0;
  };
  Marble.prototype.beginUncurl = function () {
    this.state = "UNCURLING"; this.animT = 0;
  };
  Marble.prototype.update = function (dt, speed) {
    if (this.state === "CURLING") {
      this.animT += dt / Marble.ANIM_DUR;
      this.popT += dt;
      if (this.animT >= 1) { this.animT = 1; this.state = "ROLLED"; }
    } else if (this.state === "UNCURLING") {
      this.animT += dt / Marble.ANIM_DUR;
      if (this.animT >= 1) { this.animT = 1; this.state = "STANDING"; }
    } else if (this.state === "ROLLED") {
      this.spin += speed * dt * 2.4;
    }
  };
  Marble.prototype.frameIndex = function () {
    if (this.state === "CURLING")  return Math.min(4, Math.floor(this.animT * 5));
    if (this.state === "UNCURLING") return Math.min(4, Math.floor((1 - this.animT) * 5));
    if (this.state === "ROLLED")   return 4;
    return 0;
  };

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  var levelIndex = 0;
  var tmap = {}, cols = 0, rows = 0;      // sparse: tmap["x,y"]={type,...}
  var lvBounds = { bx: 0, by: 0, ex: 0, ey: 0, maxH: 0 };
  var targetMs = 30000;                   // 3-star time target for level
  var lastCellKey = "";                   // for fire-once bumper/spinner/spring
  var bumperFlash = {};                   // "c,r" -> flash timer (s)
  // Marble state — plain object, world units. vx/vy in tiles/s.
  // mh = current plane (integer height); zv = visual world-z; zArc =
  // transient spring-launch hop added on top of zv.
  var marble = { x: 1.5, y: 1.5, vx: 0, vy: 0, speed: 0, mh: 0, zv: 0, zArc: 0, arcT: 0 };
  var startTile = { x: 1.5, y: 1.5 }, goalTile = { x: 0, y: 0 };
  var tileW = 64, tileH = 32, OX = 0, OY = 0;

  var phase = "menu";   // menu | intro | play | falling | won
  var customLevel = null;   // non-null while play-testing an editor level
  var mmExit = null;        // editor "exit test-play" callback, if any
  var marbleAnim = new Marble();
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
    // Fit to the level's actual tile bounds (sparse / irregular shapes),
    // leaving headroom for the tallest tile + its skirt.
    var b = lvBounds;
    var x0 = b.bx, y0 = b.by, x1 = b.ex + 1, y1 = b.ey + 1;
    var topZ = (b.maxH + 1) * HEIGHT_UNIT;     // tallest extent upward
    function bbox() {
      var corners = [[x0,y0],[x1,y0],[x0,y1],[x1,y1]];
      var mnX=1e9,mxX=-1e9,mnY=1e9,mxY=-1e9;
      for (var i=0;i<4;i++){
        var p = projRaw(corners[i][0], corners[i][1], 0);
        mnX=Math.min(mnX,p.x); mxX=Math.max(mxX,p.x);
        mnY=Math.min(mnY,p.y); mxY=Math.max(mxY,p.y);
      }
      mnY -= topZ * tileH;                     // raised tiles go up
      return { mnX:mnX, mxX:mxX, mnY:mnY, mxY:mxY };
    }
    tileW = 64; tileH = 32;
    var a = bbox();
    var s = Math.min((CANVAS - 2*MARGIN) / (a.mxX - a.mnX),
                     (CANVAS - 2*MARGIN) / (a.mxY - a.mnY));
    tileW *= s; tileH *= s;
    var z = bbox();
    OX = CANVAS/2 - (z.mnX + z.mxX)/2;
    OY = CANVAS/2 - (z.mnY + z.mxY)/2;
  }

  // ---------------------------------------------------------------------
  // Level loading
  // ---------------------------------------------------------------------
  function cellAt(c, r) { return tmap[c + "," + r] || null; }   // null = gap
  function isHole(c, r) { var t = cellAt(c, r); return !!t && t.type === "hole"; }
  function surfaceOf(c, r) {
    var t = cellAt(c, r);
    if (!t) return "floor";
    if (t.type === "gravel") return "gravel";
    if (t.type === "ice") return "ice";
    return "floor";   // floor/goal/bumper/spinner/ramp/spring roll like floor
  }
  // Solid (invisible wall) for the marble at its current plane mh:
  // gaps & walls always solid; other tiles solid if on a different
  // height plane — UNLESS it's a ramp/spring bridging to that plane.
  function blocked(c, r) {
    var t = cellAt(c, r);
    if (!t) return true;                       // gap / off-map
    if (t.type === "wall") return true;
    if (t.type === "ramp")
      return !(marble.mh === t.height || marble.mh === t.height + t.hd);
    if (t.type === "spring")
      return !(marble.mh === t.height || marble.mh === t.height + t.hd);
    return t.height !== marble.mh;             // plain plane mismatch = wall
  }
  // Ramp progress 0..1 along its uphill direction within the tile.
  function rampProgress(cell, c, r) {
    var fx = marble.x - c, fy = marble.y - r;  // 0..1 within the tile
    var d = cell.dir;
    var p = (d.x !== 0) ? (d.x > 0 ? fx : 1 - fx)
                        : (d.y > 0 ? fy : 1 - fy);
    return clamp(p, 0, 1);
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
    cols = lv.w; rows = lv.h; tmap = lv.tmap;
    lvBounds = { bx: lv.bx, by: lv.by, ex: lv.ex, ey: lv.ey, maxH: lv.maxH };
    targetMs = lv.target_ms;
    // Opt-in per-level physics: BASE overlaid with this level's sparse
    // override (or just BASE if it has none — identical to global feel).
    applyPhysics(effectivePhysics(lv.physics));
    curLevelLabel = (customLevel ? "TEST" : "L" + (levelIndex + 1)) +
                    " · " + (lv.name || "Untitled");
    if (tuneLvlEl) tuneLvlEl.textContent = curLevelLabel +
      (lv.physics ? "  [has override]" : "  [global]");
    for (var ti = 0; ti < tuneRefreshers.length; ti++) tuneRefreshers[ti]();
    startTile = { x: lv.spawn.x + 0.5, y: lv.spawn.y + 0.5 };
    var sct = tmap[lv.spawn.x + "," + lv.spawn.y];
    startTile.h = sct ? (sct.height || 0) : 0;
    var gct = tmap[lv.goal.x + "," + lv.goal.y];
    goalTile = { x: lv.goal.x, y: lv.goal.y, h: gct ? (gct.height || 0) : 0 };
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
    marble.mh = startTile.h || 0;
    marble.zv = marble.mh * HEIGHT_UNIT;
    marble.zArc = 0; marble.arcT = 0;
    fallZ = 0; fallVZ = 0; fallScale = 1; fallT = 0;
    lastCellKey = "";
    levelTime = 0;
    timerRunning = false;
    elTimer.textContent = "0.0";
    marbleAnim = new Marble();
    marbleAnim.beginCurl();              // curl-up intro every spawn
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
  // (the Marble rolls into them — that's the fall). Floor/ice/gravel/
  // goal/spawn are passable.
  // Resolve circle-vs-solid-tile overlaps by minimum translation, and
  // cancel the inward velocity (slide along walls, small bounce). Called
  // after every micro-step so a fast Marble can never pass a wall.
  function resolveCollisions() {
    var R = MARBLE_R;
    for (var it = 0; it < 4; it++) {
      var any = false;
      var c0 = Math.floor(marble.x - R) - 1, c1 = Math.floor(marble.x + R) + 1;
      var r0 = Math.floor(marble.y - R) - 1, r1 = Math.floor(marble.y + R) + 1;
      for (var rr = r0; rr <= r1; rr++) {
        for (var cc = c0; cc <= c1; cc++) {
          if (!blocked(cc, rr)) continue;
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
      for (var key in bumperFlash) {
        bumperFlash[key] -= dt;
        if (bumperFlash[key] <= 0) delete bumperFlash[key];
      }

      // ---- elevation: where is the Marble's plane + visual z? ----
      var planeZ = marble.mh * HEIGHT_UNIT;
      if (cell && cell.type === "ramp") {
        var p = rampProgress(cell, cc, rr);
        // bridge low (cell.height) <-> high (cell.height + hd)
        marble.mh = (p >= 0.5) ? (cell.height + cell.hd) : cell.height;
        planeZ = (cell.height + cell.hd * p) * HEIGHT_UNIT;
      } else if (cell && cell.type === "spring") {
        // plane is governed by the launch — do NOT reset it to the
        // spring's base height or the Marble can never leave upward.
        planeZ = marble.mh * HEIGHT_UNIT;
      } else if (cell) {
        marble.mh = cell.height;
        planeZ = cell.height * HEIGHT_UNIT;
      }
      // spring-launch hop decays out
      if (marble.arcT > 0) {
        marble.arcT -= dt;
        var ap = clamp(marble.arcT / SPRING_ARC, 0, 1);
        marble.zArc = Math.sin(ap * Math.PI) * 0.9;     // up then down
        if (marble.arcT <= 0) marble.zArc = 0;
      }
      marble.zv = planeZ + marble.zArc;

      // fire bumper / spinner / spring once per tile entry
      var ck = cc + "," + rr;
      if (cell && ck !== lastCellKey) {
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
        } else if (cell.type === "spring") {
          marble.mh = cell.height + cell.hd;   // launched to the new plane
          marble.arcT = SPRING_ARC;
          Sound.boing();
        }
      }

      if (cell && cell.type === "hole") {
        beginFall();
      } else if (cc === goalTile.x && rr === goalTile.y &&
                 marble.mh === goalTile.h) {       // must be on the goal's plane
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
    marbleAnim.beginUncurl();
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
  function drawArrow(cx, cy, cen, dirName, z) {
    var v = dirVec(dirName);
    var t = project(cx + 0.5 + v.x * 0.4, cy + 0.5 + v.y * 0.4, z || 0);
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

  // vertical skirt (two visible iso faces) from world-z zb up to zt
  function drawSkirt(c, r, zb, zt) {
    var hw = tileW / 2, hh = tileH / 2;
    var b = project(c + 0.5, r + 0.5, zb);
    var t = project(c + 0.5, r + 0.5, zt);
    ctx.fillStyle = "#1f1338";
    ctx.beginPath();
    ctx.moveTo(b.x - hw, b.y); ctx.lineTo(b.x, b.y + hh);
    ctx.lineTo(t.x, t.y + hh); ctx.lineTo(t.x - hw, t.y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#2c1c4d";
    ctx.beginPath();
    ctx.moveTo(b.x + hw, b.y); ctx.lineTo(b.x, b.y + hh);
    ctx.lineTo(t.x, t.y + hh); ctx.lineTo(t.x + hw, t.y);
    ctx.closePath(); ctx.fill();
  }

  function drawBoard() {
    var hw = tileW / 2, hh = tileH / 2, now = performance.now();
    // sparse painter's order: far (small x+y) first, lower height first
    var keys = Object.keys(tmap);
    keys.sort(function (A, B) {
      var a = A.split(","), bb = B.split(",");
      var ka = (+a[0] + +a[1]) * 100 + (tmap[A].height || 0);
      var kb = (+bb[0] + +bb[1]) * 100 + (tmap[B].height || 0);
      return ka - kb;
    });

    for (var ki = 0; ki < keys.length; ki++) {
      var kk = keys[ki].split(",");
      var c = +kk[0], r = +kk[1];
      var cell = tmap[keys[ki]], type = cell.type;
      var hgt = cell.height || 0;
      var topZ = hgt * HEIGHT_UNIT;
      var cen = project(c + 0.5, r + 0.5, topZ);

      // skirt for any raised tile (and wall block sides)
      var skirtTop = (type === "wall") ? topZ + WALL_H : topZ;
      if (hgt > 0 || type === "wall") drawSkirt(c, r, 0, skirtTop);

      if (type === "wall") {
        var wtop = project(c + 0.5, r + 0.5, topZ + WALL_H);
        ctx.fillStyle = "#4a3270";
        diamond(wtop.x, wtop.y, hw, hh); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.stroke();
        continue;
      }

      if (type === "ramp") {
        // sloped quad: low edge at hgt, high edge at hgt+hd along dir
        var d = cell.dir, loZ = topZ, hiZ = (hgt + cell.hd) * HEIGHT_UNIT;
        function cz(cx, cy) {            // corner z by position along dir
          var u = (d.x !== 0) ? (d.x > 0 ? cx - c : 1 - (cx - c))
                              : (d.y > 0 ? cy - r : 1 - (cy - r));
          return loZ + (hiZ - loZ) * u;
        }
        var P = [
          project(c,   r,   cz(c, r)),
          project(c+1, r,   cz(c+1, r)),
          project(c+1, r+1, cz(c+1, r+1)),
          project(c,   r+1, cz(c, r+1))
        ];
        ctx.beginPath();
        ctx.moveTo(P[0].x, P[0].y);
        for (var pi = 1; pi < 4; pi++) ctx.lineTo(P[pi].x, P[pi].y);
        ctx.closePath();
        ctx.fillStyle = "#5a4488"; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1; ctx.stroke();
        var hc = project(c + 0.5, r + 0.5, (loZ + hiZ) / 2);
        drawArrow(c, r, hc, cell.dirName || "E", (cell.height + cell.hd / 2));
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
          var aa = ((c * 13 + r * 29 + k * 47) % 100) / 100;
          var bb2 = ((c * 7 + r * 17 + k * 31) % 100) / 100;
          ctx.beginPath();
          ctx.arc(cen.x + (aa - 0.5) * hw, cen.y + (bb2 - 0.5) * hh, 1.4, 0, 6.28);
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
        var fl = bumperFlash[keys[ki]];
        if (fl) {
          ctx.save();
          ctx.globalAlpha = Math.min(0.6, fl / 0.18 * 0.6);
          diamond(cen.x, cen.y, hw, hh);
          ctx.fillStyle = "#ffe0bf"; ctx.fill();
          ctx.restore();
        }
        drawArrow(c, r, cen, cell.dirName || "E", hgt * HEIGHT_UNIT);
      } else if (type === "spinner") {
        drawSwirl(cen, cell.rot || 1);
      } else if (type === "spring") {
        ctx.save();
        ctx.strokeStyle = "#9ff0d6"; ctx.lineWidth = 2.5;
        for (var sgi = 0; sgi < 3; sgi++) {
          var off = (sgi - 1) * hh * 0.26;
          ctx.beginPath();
          ctx.moveTo(cen.x - hw * 0.28, cen.y + off + hh * 0.12);
          ctx.lineTo(cen.x, cen.y + off - hh * 0.12);
          ctx.lineTo(cen.x + hw * 0.28, cen.y + off + hh * 0.12);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  function drawMarble() {
    if (!marble) return;
    var z = marble.zv + ((phase === "falling") ? fallZ : 0);
    var p = project(marble.x, marble.y, z);

    // shadow sits on the Marble's current plane (skip while falling)
    if (phase !== "falling") {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = "#000";
      var fp = project(marble.x, marble.y, marble.mh * HEIGHT_UNIT);
      ctx.beginPath();
      ctx.ellipse(fp.x, fp.y + tileH * 0.10, tileW * MARBLE_R * 0.95,
                  tileH * MARBLE_R * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // placeholder "curl pop" during the intro: scale 1.0 -> 0.6 w/ bounce
    var rpx = tileW * MARBLE_R;
    var scale = 1;
    if (marbleAnim.state === "CURLING") {
      var k = marbleAnim.animT;
      scale = 1 - 0.4 * k + 0.08 * Math.sin(k * Math.PI * 3) * (1 - k);
    } else if (marbleAnim.state === "UNCURLING") {
      scale = 0.6 + 0.4 * marbleAnim.animT;
    }
    if (phase === "falling") scale *= fallScale;
    var R = rpx * scale;
    var fade = (phase === "falling") ? Math.max(0, fallScale) : 1;

    if (USE_SPRITES && Sprites.ready) {
      var img = (marbleAnim.state === "ROLLED") ? Sprites.ball
                                           : Sprites.curl[marbleAnim.frameIndex()];
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      if (marbleAnim.state === "ROLLED") ctx.rotate(marbleAnim.spin * 0.5);
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
    ctx.rotate(marbleAnim.spin * 0.5);
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
    TiltUI.update();
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
      marbleAnim.update(dt, 0);
      if (marbleAnim.state === "ROLLED") phase = "play";
    } else if (phase === "play") {
      var steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.round(dt / FIXED_DT)));
      for (var s = 0; s < steps && phase === "play"; s++) physicsTick();
      marbleAnim.update(dt, marble.speed);
      Sound.roll(marble.speed);
    } else if (phase === "falling") {
      Sound.roll(0);
      marbleAnim.update(dt, 0);
    } else if (phase === "won") {
      Sound.roll(0);
      marbleAnim.update(dt, 0);
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
  // Tilt indicator (always on). Numbers (gamma/beta, 0.1° precision) +
  // a dial dot showing direction/magnitude vs the calibrated zero. Tap
  // to cycle BOTH -> NUMBERS_ONLY -> VISUAL_ONLY; persisted.
  // ---------------------------------------------------------------------
  var TiltUI = (function () {
    var modes = ["BOTH", "NUMBERS_ONLY", "VISUAL_ONLY"], mode = "BOTH";
    try { var m = localStorage.getItem("mm.tiltUI"); if (m && modes.indexOf(m) >= 0) mode = m; } catch (e) {}
    var box, numEl, cvs, cx2, built = false;
    function apply() {
      if (!built) return;
      cvs.style.display = (mode === "NUMBERS_ONLY") ? "none" : "block";
      numEl.style.display = (mode === "VISUAL_ONLY") ? "none" : "block";
    }
    function cycle() {
      mode = modes[(modes.indexOf(mode) + 1) % modes.length];
      try { localStorage.setItem("mm.tiltUI", mode); } catch (e) {}
      apply();
    }
    function build() {
      if (built || !document.body) return;
      built = true;
      box = document.createElement("div");
      box.setAttribute("style",
        "position:fixed;right:10px;bottom:10px;z-index:60;display:flex;" +
        "align-items:center;gap:8px;background:rgba(20,11,38,0.78);" +
        "border:1px solid #3a2a5c;border-radius:10px;padding:7px 9px;" +
        "color:#f3ecff;font:12px monospace;cursor:pointer;user-select:none;");
      box.title = "Tap to cycle tilt display";
      cvs = document.createElement("canvas");
      cvs.width = 52; cvs.height = 52;
      cvs.setAttribute("style", "width:52px;height:52px;");
      cx2 = cvs.getContext("2d");
      numEl = document.createElement("div");
      numEl.setAttribute("style", "line-height:1.35;min-width:74px;");
      box.appendChild(cvs); box.appendChild(numEl);
      box.addEventListener("click", cycle);
      document.body.appendChild(box);
      apply();
    }
    function update() {
      if (!built) { build(); return; }
      var g = tilt.raw.gamma, b = tilt.raw.beta;
      if (mode !== "VISUAL_ONLY") {
        numEl.innerHTML =
          '<span style="color:#ffd76b">&gamma;</span> ' + (g >= 0 ? "+" : "") + g.toFixed(1) + "&deg;<br>" +
          '<span style="color:#7df0c8">&beta;</span> ' + (b >= 0 ? "+" : "") + b.toFixed(1) + "&deg;";
      }
      if (mode !== "NUMBERS_ONLY") {
        var bg = tilt.base ? tilt.base.gamma : 0, bb = tilt.base ? tilt.base.beta : 0;
        var R = 23, X = 26, Y = 26;
        cx2.clearRect(0, 0, 52, 52);
        cx2.strokeStyle = "rgba(255,255,255,0.22)";
        cx2.beginPath(); cx2.arc(X, Y, R, 0, 6.283); cx2.stroke();
        cx2.strokeStyle = "rgba(255,255,255,0.13)";
        cx2.beginPath();
        cx2.moveTo(X - R, Y); cx2.lineTo(X + R, Y);
        cx2.moveTo(X, Y - R); cx2.lineTo(X, Y + R); cx2.stroke();
        var nx = clamp((g - bg) / 30, -1, 1), ny = clamp((b - bb) / 30, -1, 1);
        cx2.fillStyle = "#ffd76b";
        cx2.beginPath(); cx2.arc(X + nx * R, Y + ny * R, 5, 0, 6.283); cx2.fill();
      }
    }
    return { update: update };
  })();

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
      // Ranges widened 2026-05-18 (player maxed ACCEL/MAX_SPEED). NOTE:
      // *.drag are per-frame velocity multipliers and WALL_BOUNCE is a
      // restitution — they MUST stay < 1 or velocity runs away; maxes are
      // capped just below 1 deliberately. Don't raise them to/over 1.
      { k: "ACCEL",        min: 2,    max: 60,    step: 1,
        get: function () { return ACCEL; },        set: function (v) { ACCEL = v; } },
      { k: "MAX_SPEED",    min: 2,    max: 30,    step: 1,
        get: function () { return MAX_SPEED; },    set: function (v) { MAX_SPEED = v; } },
      { k: "WALL_BOUNCE",  min: 0,    max: 0.95,  step: 0.05,
        get: function () { return WALL_BOUNCE; },  set: function (v) { WALL_BOUNCE = v; } },
      { k: "TILT_FORCE_MULTIPLIER", min: 0.2, max: 6, step: 0.1,
        get: function () { return TILT_FORCE_MULTIPLIER; }, set: function (v) { TILT_FORCE_MULTIPLIER = v; } },
      { k: "floor.drag",   min: 0.60, max: 0.999, step: 0.002,
        get: function () { return SURFACE.floor.drag; },  set: function (v) { SURFACE.floor.drag = v; } },
      { k: "gravel.drag",  min: 0.40, max: 0.999, step: 0.002,
        get: function () { return SURFACE.gravel.drag; }, set: function (v) { SURFACE.gravel.drag = v; } },
      { k: "ice.drag",     min: 0.90, max: 0.9995, step: 0.001,
        get: function () { return SURFACE.ice.drag; },    set: function (v) { SURFACE.ice.drag = v; } },
      { k: "ice.grip",     min: 0,    max: 2,     step: 0.05,
        get: function () { return SURFACE.ice.grip; },    set: function (v) { SURFACE.ice.grip = v; } }
    ];

    var box = document.createElement("div");
    box.setAttribute("style",
      "position:fixed;left:8px;bottom:8px;z-index:9998;width:248px;" +
      "background:rgba(14,7,32,0.92);border:1px solid #3a2a5c;border-radius:10px;" +
      "padding:10px 12px;color:#f3ecff;font:12px monospace;");
    // Collapsible header — tap to fold the panel down to just this bar
    // (small screens default collapsed so it doesn't cover the maze).
    var title = document.createElement("div");
    title.setAttribute("style",
      "color:#ffd76b;font-weight:700;cursor:pointer;user-select:none;" +
      "-webkit-user-select:none;display:flex;align-items:center;gap:6px;");
    var caret = document.createElement("span");
    var tlabel = document.createElement("span");
    tlabel.textContent = "LIVE TUNE (?tune=1)";
    title.appendChild(caret); title.appendChild(tlabel);
    box.appendChild(title);

    var bodyEl = document.createElement("div");
    bodyEl.setAttribute("style", "margin-top:6px;");
    box.appendChild(bodyEl);

    var collapsed;
    try {
      var sv = localStorage.getItem("mm.tune.collapsed");
      collapsed = (sv === null) ? (window.innerWidth < 720) : (sv === "1");
    } catch (e) { collapsed = (window.innerWidth < 720); }
    function applyCollapsed() {
      bodyEl.style.display = collapsed ? "none" : "block";
      caret.textContent = collapsed ? "▸" : "▾";
      box.style.width = collapsed ? "auto" : "248px";
    }
    title.addEventListener("click", function () {
      collapsed = !collapsed;
      try { localStorage.setItem("mm.tune.collapsed", collapsed ? "1" : "0"); } catch (e) {}
      applyCollapsed();
    });

    tuneLvlEl = document.createElement("div");
    tuneLvlEl.setAttribute("style", "color:#7df0c8;font-size:11px;margin-bottom:6px;");
    tuneLvlEl.textContent = curLevelLabel || "(no level yet)";
    bodyEl.appendChild(tuneLvlEl);

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
      bodyEl.appendChild(row);
      // so a level switch (which applies that level's physics) snaps the
      // sliders + labels to the new effective values.
      tuneRefreshers.push(function () { rng.value = s.get(); setLabel(); });
    });

    var copy = document.createElement("button");
    copy.textContent = "Copy physics block";
    copy.setAttribute("style",
      "margin-top:8px;width:100%;background:#3c2464;color:#f3ecff;" +
      "border:1px solid #5a3286;border-radius:6px;padding:7px;font:inherit;cursor:pointer;");
    copy.addEventListener("click", function () {
      // Emit a paste-ready, SPARSE "physics" block — only the knobs that
      // differ from the global BASE — to drop into THIS level's JSON.
      var live = {
        "ACCEL": ACCEL, "MAX_SPEED": MAX_SPEED, "WALL_BOUNCE": WALL_BOUNCE,
        "TILT_FORCE_MULTIPLIER": TILT_FORCE_MULTIPLIER,
        "floor.drag": SURFACE.floor.drag, "gravel.drag": SURFACE.gravel.drag,
        "ice.drag": SURFACE.ice.drag, "ice.grip": SURFACE.ice.grip
      };
      var diff = [];
      for (var k in BASE_PHYS) {
        if (+live[k] !== +BASE_PHYS[k]) {
          diff.push('    ' + JSON.stringify(k) + ': ' + (+live[k]));
        }
      }
      var txt;
      if (!diff.length) {
        txt = "// " + curLevelLabel + " matches the global defaults — " +
              "no per-level \"physics\" override needed.";
      } else {
        txt = "// " + curLevelLabel + " — paste this into that level's " +
              "JSON (top level):\n" +
              '  "physics": {\n' + diff.join(",\n") + "\n  }";
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          function () { copy.textContent = "Copied ✓"; setTimeout(function () { copy.textContent = "Copy physics block"; }, 1400); },
          function () { window.prompt("Copy this physics block:", txt); });
      } else { window.prompt("Copy this physics block:", txt); }
    });
    bodyEl.appendChild(copy);

    applyCollapsed();   // honor saved/default fold state
    if (document.body) document.body.appendChild(box);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(box); });
  })();

  // first paint of the menu (board hidden behind overlay)
  requestAnimationFrame(frame);
})();

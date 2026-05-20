/* Munki Madness v2.0 — heightmap engine.
 *
 * A continuous topographic surface, not an isometric tile grid. The world
 * is a grid of CORNER HEIGHTS; the marble's elevation at any point is
 * bilinearly interpolated, and gravity is the gradient of that surface.
 * The goal is a WELL — a deep depression the marble falls into and can't
 * roll back out of. Rendered as a glowing wireframe mesh.
 *
 * v1.0 (Matter.js iso tile maze) lives in git history; this file replaces
 * it wholesale. See PHYSICS_SPEC.md for the locked model.
 *
 * Phase 1 scope: heightmap physics + wireframe render + well-as-goal +
 * tilt/drag/keys input + ?tune=1. Obstacles (Phase 2), editor (Phase 3),
 * audio (Phase 4) and the level catalog (Phase 5) layer on top of this.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Physics knobs — see PHYSICS_SPEC.md. Live-tunable via ?tune=1.
  // ---------------------------------------------------------------------
  var ACCEL = 20;            // player-input push (cells/s^2)
  var MAX_SPEED = 7;         // top speed (cells/s)
  var WALL_BOUNCE = 0.4;     // edge restitution (pinball bonk)
  var FRICTION_FLOOR = 0.955;// per-frame@60 velocity multiplier (drag)
                              // — higher = heavier (momentum lingers).
  // How hard the surface slope pulls the marble. The gravity accel is
  // -GRAVITY_K * gradient(height); a well's cone wall becomes a real pull.
  var GRAVITY_K = 40;
  var MARBLE_R = 0.42;       // marble radius (cells) — keeps it off the rim

  // Well capture: the marble is "in the goal" when it's inside the well's
  // bowl AND too slow to climb back out (trapped at the bottom). With the
  // heavier feel the ball carries more momentum into the bowl, so the
  // threshold is forgiving — the capture-dwell timer still rejects fly-throughs.
  var ESCAPE_SPEED = 2.2;

  var FIXED_DT = 1 / 120;    // physics substep (s)
  var MAX_SUBSTEPS = 8;      // anti spiral-of-death

  // ---- Tilt control (ported from v1.0; recalibrated feel) ----
  var TILT_FULL = 10;             // deg past the recentred zero = full input
                                  // (smaller = more responsive to subtle tilts)
  var TILT_FORCE_MULTIPLIER = 2.0;
  var TILT_DEADZONE = 2.5;        // deg of slack around zero (anti-jitter)
  var TILT_FLIP_X = 1, TILT_FLIP_Y = 1;
  var DRAG_FULL = 90;             // px of drag that = full input

  // The global BASE — a level JSON MAY carry a sparse "physics" override
  // (Phase 5 catalog uses this; the seam exists now). Keys mirror ?tune=1.
  var BASE_PHYS = {
    "ACCEL": ACCEL, "MAX_SPEED": MAX_SPEED, "WALL_BOUNCE": WALL_BOUNCE,
    "FRICTION_FLOOR": FRICTION_FLOOR, "GRAVITY_K": GRAVITY_K,
    "TILT_FORCE_MULTIPLIER": TILT_FORCE_MULTIPLIER
  };
  var curLevelLabel = "";
  var tuneLvlEl = null;
  var tuneRefreshers = [];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------------
  // Heightmap — a (gw+1) x (gh+1) lattice of CORNER heights. A cell (cx,cy)
  // is bounded by corners (cx,cy) (cx+1,cy) (cx,cy+1) (cx+1,cy+1). Negative
  // = depression (well), positive = hill, 0 = flat plane.
  // ---------------------------------------------------------------------
  function HeightMap(gw, gh) {
    this.gw = gw; this.gh = gh;
    this.cw = gw + 1; this.ch = gh + 1;
    this.H = new Float64Array(this.cw * this.ch); // all-zero = flat
  }
  HeightMap.prototype.idx = function (i, j) { return i + j * this.cw; };
  HeightMap.prototype.get = function (i, j) {
    i = clamp(i, 0, this.gw); j = clamp(j, 0, this.gh);
    return this.H[i + j * this.cw];
  };
  HeightMap.prototype.set = function (i, j, v) {
    if (i < 0 || j < 0 || i > this.gw || j > this.gh) return;
    this.H[i + j * this.cw] = v;
  };
  HeightMap.prototype.add = function (i, j, v) {
    if (i < 0 || j < 0 || i > this.gw || j > this.gh) return;
    this.H[i + j * this.cw] += v;
  };
  // Gaussian deformation: dig a well (depth<0) or raise a hill (depth>0)
  // centred at corner-space (cx,cy) with falloff sigma (in cells).
  HeightMap.prototype.dome = function (cx, cy, depth, sigma) {
    var s2 = 2 * sigma * sigma;
    for (var j = 0; j <= this.gh; j++) {
      for (var i = 0; i <= this.gw; i++) {
        var dx = i - cx, dy = j - cy;
        this.H[i + j * this.cw] += depth * Math.exp(-(dx * dx + dy * dy) / s2);
      }
    }
  };
  // Bilinear sample + gradient at world (wx,wy) in cell units. Returns
  // { h, gx, gy } where (gx,gy) is dHeight/d(cell) — the slope vector.
  HeightMap.prototype.sample = function (wx, wy) {
    wx = clamp(wx, 0, this.gw); wy = clamp(wy, 0, this.gh);
    var i0 = Math.floor(wx); if (i0 >= this.gw) i0 = this.gw - 1;
    var j0 = Math.floor(wy); if (j0 >= this.gh) j0 = this.gh - 1;
    var fx = wx - i0, fy = wy - j0;
    var cw = this.cw, H = this.H;
    var h00 = H[i0 + j0 * cw],     h10 = H[(i0 + 1) + j0 * cw];
    var h01 = H[i0 + (j0 + 1) * cw], h11 = H[(i0 + 1) + (j0 + 1) * cw];
    var top = h00 + (h10 - h00) * fx;
    var bot = h01 + (h11 - h01) * fx;
    var h = top + (bot - top) * fy;
    // Partial derivatives of the bilinear patch:
    var gx = (h10 - h00) + ((h11 - h01) - (h10 - h00)) * fy;
    var gy = (h01 - h00) + ((h11 - h10) - (h01 - h00)) * fx;
    return { h: h, gx: gx, gy: gy };
  };

  // ---------------------------------------------------------------------
  // Obstacle types — Phase 2. Each obstacle is a sparse object on top of
  // the heightmap. Effects are accumulated per physics substep into a
  // small state struct that the integrator reads.
  //
  //   { type:"bumper",   x, y, r }                     // solid disc; reflects + kicks
  //   { type:"reverse",  x, y, r }                     // slope gravity flips while inside
  //   { type:"ice",      x, y, r }                     // less drag + less input grip
  //   { type:"mud",      x, y, r }                     // more drag, slight grip loss
  //   { type:"conveyor", x, y, r, dx, dy, strength }   // constant directional push in radius
  //   { type:"wind",     x, y, r, dx, dy, strength }   // softer directional, falloff to edge
  //   { type:"tractor",  x, y, r, strength }           // pulls toward (x,y); never captures
  //
  // r is the *effect radius* (cell units). dx/dy for directional types are
  // unit-ish; strength is cells/s^2 contribution at full intensity.
  // ---------------------------------------------------------------------
  var BUMPER_KICK = 2.6;   // extra outward speed kick per bumper hit (cells/s)

  // ---------------------------------------------------------------------
  // Level catalog — Phase 2 ships the Tutorial Well plus three obstacle
  // demos. Phase 5 swaps these for a JSON catalog loaded from levels/*.
  // ---------------------------------------------------------------------
  function buildTutorialLevel() {
    var gw = 18, gh = 18;
    var hm = new HeightMap(gw, gh);
    var well = { x: gw / 2, y: gh / 2, captureR: 1.7 };
    // A smooth bowl in the middle of an otherwise flat plane.
    hm.dome(well.x, well.y, -7.5, 3.4);
    return {
      title: "Tutorial Well",
      hm: hm,
      spawn: { x: 2.0, y: 2.0 },
      well: well,
      obstacles: [],
      time: 45,
      physics: null
    };
  }

  function buildBumperRingLevel() {
    var gw = 18, gh = 18;
    var hm = new HeightMap(gw, gh);
    var well = { x: gw / 2, y: gh / 2, captureR: 1.6 };
    hm.dome(well.x, well.y, -7.5, 3.0);
    // Ring of bumpers around the well with a single gap facing the spawn
    // (upper-left). Player must thread that gap or bounce off and retry.
    var obs = [];
    var gapAngle = -Math.PI * 0.75;             // toward upper-left
    var gapHalfWidth = Math.PI * 0.20;          // half-angle of the open slot
    for (var k = 0; k < 9; k++) {
      var ang = -Math.PI + (k / 9) * Math.PI * 2;
      var dA = Math.abs(((ang - gapAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (dA < gapHalfWidth) continue;
      obs.push({
        type: "bumper",
        x: well.x + Math.cos(ang) * 3.2,
        y: well.y + Math.sin(ang) * 3.2,
        r: 0.45
      });
    }
    return {
      title: "Bumper Ring",
      hm: hm,
      spawn: { x: 2.2, y: 2.2 },
      well: well,
      obstacles: obs,
      time: 60,
      physics: null
    };
  }

  function buildReverseCrossingLevel() {
    var gw = 18, gh = 18;
    var hm = new HeightMap(gw, gh);
    // Gentle slope downhill from spawn (upper-left, high) to well (lower-
    // right, low). Without the reverse zone the marble would roll straight
    // in; the zone in the middle flips slope gravity so you have to FIGHT
    // your way across with tilt + momentum.
    for (var j = 0; j <= gh; j++) {
      for (var i = 0; i <= gw; i++) {
        hm.set(i, j, (gw - i) * 0.18 + (gh - j) * 0.10);
      }
    }
    var well = { x: 14.5, y: 14.5, captureR: 1.6 };
    hm.dome(well.x, well.y, -6.5, 2.8);
    var obs = [
      { type: "reverse", x: 8.5, y: 8.5, r: 3.4 }
    ];
    return {
      title: "Reverse Crossing",
      hm: hm,
      spawn: { x: 2.5, y: 2.5 },
      well: well,
      obstacles: obs,
      time: 60,
      physics: null
    };
  }

  function buildIceApproachLevel() {
    var gw = 18, gh = 18;
    var hm = new HeightMap(gw, gh);
    var well = { x: 14.0, y: 13.0, captureR: 1.7 };
    // Slightly deeper bowl so the marble can settle even with momentum.
    hm.dome(well.x, well.y, -8.0, 3.2);
    // Large ice patch covering the approach. The marble can't shed speed
    // crossing it — overcommit and you whip past the well's pull.
    var obs = [
      { type: "ice", x: 8.5, y: 8.0, r: 3.6 }
    ];
    return {
      title: "Ice Approach",
      hm: hm,
      spawn: { x: 3.0, y: 3.0 },
      well: well,
      obstacles: obs,
      time: 60,
      physics: null
    };
  }

  // Order = play order; "Next Level" wraps at the end.
  var LEVELS = [
    buildTutorialLevel,
    buildBumperRingLevel,
    buildReverseCrossingLevel,
    buildIceApproachLevel
  ];

  // ---------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
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
  var levelEl = document.getElementById("level");
  var timerEl = document.getElementById("timer");
  var attemptsEl = document.getElementById("attempts");
  var bestEl = document.getElementById("best");
  var endTitle = document.getElementById("endTitle");
  var endTime = document.getElementById("endTime");
  var endTries = document.getElementById("endTries");
  var endBest = document.getElementById("endBest");
  var endStars = document.getElementById("endStars");
  var recenterBtn = document.getElementById("recenterBtn");
  var dbgBtn = document.getElementById("dbgBtn");
  var fallFlash = document.getElementById("fallFlash");

  var DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  function fitCanvas() {
    var r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * DPR);
    canvas.height = Math.round(r.height * DPR);
  }
  window.addEventListener("resize", fitCanvas);

  // ---------------------------------------------------------------------
  // Control mode (ported from v1.0)
  // ---------------------------------------------------------------------
  var isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  var CONTROL_MODES = ["tilt", "drag", "both"];
  var controlMode = isTouchDevice ? "tilt" : "drag";

  function refreshCtrlLabel() {
    var label = controlMode.charAt(0).toUpperCase() + controlMode.slice(1);
    if (ctrlLabel) ctrlLabel.textContent = label;
    if (howText) {
      howText.textContent =
        controlMode === "tilt" ? "Tilt your device to roll into the well — (arrows/WASD also work)." :
        controlMode === "drag" ? "Drag anywhere to roll into the well — (arrows/WASD also work)." :
        "Tilt or drag to roll into the well — (arrows/WASD also work).";
    }
  }
  refreshCtrlLabel();
  if (ctrlBtn) ctrlBtn.addEventListener("click", function () {
    var i = CONTROL_MODES.indexOf(controlMode);
    controlMode = CONTROL_MODES[(i + 1) % CONTROL_MODES.length];
    if (controlMode === "tilt" || controlMode === "both") requestTilt();
    refreshCtrlLabel();
  });

  // ---------------------------------------------------------------------
  // Audio — Phase 2 wires Bala's Theme as the looping BG (user recorded
  // his own arrangement; see project_balas_theme_per_game_arrangement
  // in /memory). Browsers block autoplay until a user gesture, so the
  // loop arms here and actually starts in startGame() after the click.
  // Rolling SFX, whoosh, captured, etc. layer on top in Phase 4.
  // ---------------------------------------------------------------------
  var soundMuted = false;
  try { soundMuted = localStorage.getItem("mm2.muted") === "1"; } catch (e) {}
  var BG_VOL = 0.55;
  var bgAudio = new Audio("assets/audio/balas-theme.mp3?v=20260519c");
  bgAudio.loop = true;
  bgAudio.preload = "auto";
  bgAudio.volume = soundMuted ? 0 : BG_VOL;
  var Sound = {
    resume: function () {
      // Must be called from inside a user-gesture handler the first time.
      if (soundMuted) return;
      var p = bgAudio.play();
      if (p && p.catch) p.catch(function () {}); // ignore "blocked until gesture"
    },
    roll: function () {},  // Phase 4
    win: function () {},   // Phase 4
    whoosh: function () {} // Phase 4
  };
  function applyMute() {
    bgAudio.volume = soundMuted ? 0 : BG_VOL;
    if (muteBtn) {
      muteBtn.setAttribute("aria-pressed", soundMuted ? "true" : "false");
      muteBtn.style.opacity = soundMuted ? "0.5" : "1";
    }
  }
  applyMute();
  if (muteBtn) muteBtn.addEventListener("click", function () {
    soundMuted = !soundMuted;
    try { localStorage.setItem("mm2.muted", soundMuted ? "1" : "0"); } catch (e) {}
    applyMute();
    if (!soundMuted) Sound.resume();   // counts as a gesture if we hadn't started yet
  });

  // ---------------------------------------------------------------------
  // Tilt input (ported from v1.0)
  // ---------------------------------------------------------------------
  var tilt = { raw: { gamma: 0, beta: 0 }, base: null, on: false, perm: "idle" };
  var dbg = { dg: 0, db: 0, show: false };
  function onOrient(e) {
    tilt.raw.gamma = e.gamma || 0;
    tilt.raw.beta = e.beta || 0;
    if (!tilt.base) tilt.base = { gamma: tilt.raw.gamma, beta: tilt.raw.beta };
    tilt.on = true;
  }
  function recenter() { tilt.base = { gamma: tilt.raw.gamma, beta: tilt.raw.beta }; }
  function applyDeadzone(v, dz) {
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
      }).catch(function () { tilt.perm = "error"; });
    } else {
      tilt.perm = "granted";
      listen();
    }
  }
  if (recenterBtn) recenterBtn.addEventListener("click", function () {
    recenter();
    recenterBtn.textContent = "✓";
    setTimeout(function () { recenterBtn.innerHTML = "&#127919;"; }, 800);
  });
  if (dbgBtn) dbgBtn.addEventListener("click", function () { dbg.show = !dbg.show; });

  // ---------------------------------------------------------------------
  // Drag + keyboard input (ported from v1.0)
  // ---------------------------------------------------------------------
  var dragging = false, dragStart = null, dragVec = { x: 0, y: 0 };
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

  var keys = Object.create(null);
  var MOVE_CODES = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1
  };
  function setKey(e, down) {
    if (!MOVE_CODES[e.code]) return;
    keys[e.code] = down;
    if (e.cancelable) e.preventDefault();
  }
  window.addEventListener("keydown", function (e) { setKey(e, true); });
  window.addEventListener("keyup", function (e) { setKey(e, false); });
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    if (k === "r") restartLevel();
    if (k === "m" && muteBtn) muteBtn.click();
  });

  // Player input intent -> unit-ish accel vector in WORLD (cell) space.
  // Screen-up maps to -worldY (north on the mesh reads as "away/up").
  var ZERO = { x: 0, y: 0 };
  function controlVec() {
    if (phase !== "play") return ZERO;
    var sx = 0, sy = 0;
    if (keys.ArrowUp || keys.KeyW) sy -= 1;
    if (keys.ArrowDown || keys.KeyS) sy += 1;
    if (keys.ArrowLeft || keys.KeyA) sx -= 1;
    if (keys.ArrowRight || keys.KeyD) sx += 1;
    if ((controlMode === "tilt" || controlMode === "both") && tilt.on) {
      var bg = tilt.base ? tilt.base.gamma : 0;
      var bb = tilt.base ? tilt.base.beta : 0;
      var dg = applyDeadzone(tilt.raw.gamma - bg, TILT_DEADZONE);
      var db = applyDeadzone(tilt.raw.beta - bb, TILT_DEADZONE);
      dbg.dg = dg; dbg.db = db;
      sx += clamp(dg / TILT_FULL * TILT_FORCE_MULTIPLIER, -1, 1) * TILT_FLIP_X;
      sy += clamp(db / TILT_FULL * TILT_FORCE_MULTIPLIER, -1, 1) * TILT_FLIP_Y;
    }
    if ((controlMode === "drag" || controlMode === "both") && dragging) {
      sx += clamp(dragVec.x / DRAG_FULL, -1, 1);
      sy += clamp(dragVec.y / DRAG_FULL, -1, 1);
    }
    if (sx === 0 && sy === 0) return ZERO;
    var m = Math.sqrt(sx * sx + sy * sy);
    if (m > 1) { sx /= m; sy /= m; }
    return { x: sx, y: sy };
  }

  // ---------------------------------------------------------------------
  // Per-level physics overlay (sparse override on the global BASE)
  // ---------------------------------------------------------------------
  function clampPhys(k, v) {
    v = +v;
    if (!isFinite(v)) return BASE_PHYS[k];
    if (k === "WALL_BOUNCE") return clamp(v, 0, 0.98);
    if (k === "FRICTION_FLOOR") return clamp(v, 0.3, 0.9999);
    return Math.max(0, v);
  }
  function applyPhysics(p) {
    ACCEL = p.ACCEL; MAX_SPEED = p.MAX_SPEED; WALL_BOUNCE = p.WALL_BOUNCE;
    FRICTION_FLOOR = p.FRICTION_FLOOR; GRAVITY_K = p.GRAVITY_K;
    TILT_FORCE_MULTIPLIER = p.TILT_FORCE_MULTIPLIER;
  }
  function effectivePhysics(override) {
    var e = {}, k;
    for (k in BASE_PHYS) e[k] = BASE_PHYS[k];
    if (override) for (k in override)
      if (BASE_PHYS.hasOwnProperty(k) && override[k] != null)
        e[k] = clampPhys(k, override[k]);
    return e;
  }

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  var level = null;
  var marble = { x: 0, y: 0, vx: 0, vy: 0, h: 0, sink: 0 };
  var phase = "menu";          // menu | play | win
  var levelNum = 1;
  var attempts = 0;
  var elapsed = 0;             // s since level (re)start
  var captureTimer = 0;        // s the marble has dwelt in the bowl

  function bestKey() { return "mm2.best." + levelNum; }
  function getBest() {
    try { var v = localStorage.getItem(bestKey()); return v == null ? null : +v; }
    catch (e) { return null; }
  }
  function setBest(t) { try { localStorage.setItem(bestKey(), String(t)); } catch (e) {} }
  function fmtBest(t) { return t == null ? "--" : t.toFixed(1) + "s"; }

  function loadLevel(num) {
    if (num < 1) num = 1;
    if (num > LEVELS.length) num = ((num - 1) % LEVELS.length) + 1;
    levelNum = num;
    level = LEVELS[num - 1]();
    curLevelLabel = "L" + num + " " + level.title;
    applyPhysics(effectivePhysics(level.physics));
    for (var i = 0; i < tuneRefreshers.length; i++) tuneRefreshers[i]();
    if (tuneLvlEl) tuneLvlEl.textContent = curLevelLabel;
    resetMarble();
    elapsed = 0; captureTimer = 0;
    if (levelEl) levelEl.textContent = String(num);
    if (bestEl) bestEl.textContent = fmtBest(getBest());
    if (attemptsEl) attemptsEl.textContent = String(attempts);
  }
  function resetMarble() {
    marble.x = level.spawn.x;
    marble.y = level.spawn.y;
    marble.vx = 0; marble.vy = 0;
    marble.sink = 0;
    marble.h = level.hm.sample(marble.x, marble.y).h;
  }
  function restartLevel() {
    if (phase === "menu") return;
    attempts++;
    if (attemptsEl) attemptsEl.textContent = String(attempts);
    resetMarble();
    elapsed = 0; captureTimer = 0;
    phase = "play";
    if (endScreen) endScreen.hidden = true;
  }
  if (restartBtn) restartBtn.addEventListener("click", restartLevel);

  function startGame() {
    Sound.resume();
    if (controlMode === "tilt" || controlMode === "both") requestTilt();
    attempts = 1;
    loadLevel(1);
    phase = "play";
    if (startScreen) startScreen.hidden = true;
    if (endScreen) endScreen.hidden = true;
  }
  if (startBtn) startBtn.addEventListener("click", startGame);
  if (replayBtn) replayBtn.addEventListener("click", restartLevel);
  if (nextBtn) nextBtn.addEventListener("click", function () {
    attempts = 1;
    var n = levelNum + 1;
    if (n > LEVELS.length) n = 1;     // wrap at end of catalog
    loadLevel(n);
    phase = "play";
    if (endScreen) endScreen.hidden = true;
  });

  function win() {
    phase = "win";
    var t = elapsed;
    var prev = getBest();
    var isBest = (prev == null || t < prev);
    if (isBest) setBest(t);
    Sound.win();
    if (endTitle) endTitle.textContent = "In the Well!";
    if (endTime) endTime.textContent = t.toFixed(1);
    if (endTries) endTries.textContent = String(attempts);
    if (endBest) endBest.hidden = !isBest;
    if (endStars) {
      var budget = level.time || 45;
      var stars = t <= budget * 0.5 ? 3 : t <= budget * 0.8 ? 2 : 1;
      endStars.setAttribute("data-stars", String(stars));
      endStars.textContent = (stars >= 1 ? "★" : "☆") +
        (stars >= 2 ? "★" : "☆") + (stars >= 3 ? "★" : "☆");
    }
    if (bestEl) bestEl.textContent = fmtBest(getBest());
    if (endScreen) endScreen.hidden = false;
  }

  function flashFall() {
    if (!fallFlash) return;
    fallFlash.classList.add("show");
    setTimeout(function () { fallFlash.classList.remove("show"); }, 110);
  }

  // ---------------------------------------------------------------------
  // Obstacle effects — accumulate per-substep modifiers from each
  // in-range obstacle. Bumpers resolve immediately (collision response);
  // surface/field zones contribute to a small state struct the integrator
  // reads. Zones use a soft cosine falloff so edges don't snap on/off.
  // ---------------------------------------------------------------------
  function applyObstacleEffects(state) {
    var obs = level.obstacles;
    if (!obs || !obs.length) return;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      var dx = marble.x - o.x;
      var dy = marble.y - o.y;
      var dist2 = dx * dx + dy * dy;

      if (o.type === "bumper") {
        var cr = (o.r || 0.5) + MARBLE_R;
        if (dist2 < cr * cr) {
          var dist0 = Math.sqrt(dist2) || 0.0001;
          var nx = dx / dist0, ny = dy / dist0;
          marble.x = o.x + nx * cr;       // pop the marble out of the disc
          marble.y = o.y + ny * cr;
          var vn = marble.vx * nx + marble.vy * ny;
          if (vn < 0) {
            marble.vx -= (1 + WALL_BOUNCE) * vn * nx;
            marble.vy -= (1 + WALL_BOUNCE) * vn * ny;
            marble.vx += nx * BUMPER_KICK; // pinball-y outward kick
            marble.vy += ny * BUMPER_KICK;
            state.bonk = true;
          }
        }
        continue;
      }

      var r = o.r || 1;
      if (dist2 > r * r) continue;
      var dist = Math.sqrt(dist2);
      // Cosine falloff: 1.0 at center, 0.0 at the edge. Smoother edge
      // transitions than linear (avoids a discontinuous gradient).
      var falloff = 0.5 + 0.5 * Math.cos(Math.PI * (dist / r));

      switch (o.type) {
        case "reverse":
          state.gravFlip = -1;
          break;
        case "ice":
          // pull drag toward 0.995 (slippery) and grip toward 0.35.
          state.drag = state.drag + (0.995 - state.drag) * falloff;
          state.gripMul = Math.min(state.gripMul, 1 - 0.65 * falloff);
          break;
        case "mud":
          // pull drag toward 0.70 (sticky) and grip down ~15%.
          state.drag = state.drag + (0.70 - state.drag) * falloff;
          state.gripMul = Math.min(state.gripMul, 1 - 0.15 * falloff);
          break;
        case "conveyor":
          var cs = (o.strength || 14);
          state.extraAx += (o.dx || 0) * cs;
          state.extraAy += (o.dy || 0) * cs;
          break;
        case "wind":
          var ws = (o.strength || 8) * falloff;
          state.extraAx += (o.dx || 0) * ws;
          state.extraAy += (o.dy || 0) * ws;
          break;
        case "tractor":
          var ts = (o.strength || 12) * falloff;
          if (dist > 0.05) {
            state.extraAx += (-dx / dist) * ts;
            state.extraAy += (-dy / dist) * ts;
          }
          break;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Physics step
  // ---------------------------------------------------------------------
  function physStep(dt) {
    var hm = level.hm;
    var s = hm.sample(marble.x, marble.y);
    marble.h = s.h;

    // Per-substep effect accumulator. Defaults = no-obstacle behaviour
    // (matches Phase 1 byte-for-byte when level.obstacles is empty).
    var st = {
      drag: FRICTION_FLOOR, gripMul: 1, gravFlip: 1,
      extraAx: 0, extraAy: 0, bonk: false
    };
    applyObstacleEffects(st);

    // Slope gravity: accelerate downhill (opposite the height gradient).
    // gravFlip is -1 inside reverse-gravity zones.
    var ax = st.gravFlip * -GRAVITY_K * s.gx;
    var ay = st.gravFlip * -GRAVITY_K * s.gy;

    // Player input adds on top of gravity, scaled by surface grip
    // (ice reduces authority; mud nibbles slightly).
    var c = controlVec();
    ax += c.x * ACCEL * st.gripMul;
    ay += c.y * ACCEL * st.gripMul;

    // Field obstacles (conveyor / wind / tractor) layer on the same axis.
    ax += st.extraAx;
    ay += st.extraAy;

    marble.vx += ax * dt;
    marble.vy += ay * dt;

    // Per-frame@60 drag, applied frame-rate-independently. drag is the
    // effective per-frame multiplier after ice/mud zones.
    var d = Math.pow(st.drag, dt * 60);
    marble.vx *= d;
    marble.vy *= d;

    // Speed clamp.
    var sp = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy);
    if (sp > MAX_SPEED) {
      var k = MAX_SPEED / sp;
      marble.vx *= k; marble.vy *= k;
    }

    marble.x += marble.vx * dt;
    marble.y += marble.vy * dt;

    // Bounce off the mesh boundary (pinball wall).
    var lo = MARBLE_R, hiX = hm.gw - MARBLE_R, hiY = hm.gh - MARBLE_R;
    var bonk = false;
    if (marble.x < lo) { marble.x = lo; marble.vx = -marble.vx * WALL_BOUNCE; bonk = true; }
    else if (marble.x > hiX) { marble.x = hiX; marble.vx = -marble.vx * WALL_BOUNCE; bonk = true; }
    if (marble.y < lo) { marble.y = lo; marble.vy = -marble.vy * WALL_BOUNCE; bonk = true; }
    else if (marble.y > hiY) { marble.y = hiY; marble.vy = -marble.vy * WALL_BOUNCE; bonk = true; }
    if (bonk) flashFall();

    // Well capture: inside the bowl AND too slow to climb back out.
    var w = level.well;
    var dwx = marble.x - w.x, dwy = marble.y - w.y;
    var dwell = Math.sqrt(dwx * dwx + dwy * dwy);
    var inBowl = dwell < w.captureR;
    var slow = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy) < ESCAPE_SPEED;
    if (inBowl && slow) {
      captureTimer += dt;
      // Visually sink the marble into the hole as it settles.
      marble.sink = Math.min(1, marble.sink + dt * 3);
      if (captureTimer > 0.28) win();
    } else {
      captureTimer = Math.max(0, captureTimer - dt * 2);
      marble.sink = Math.max(0, marble.sink - dt * 4);
    }
  }

  // ---------------------------------------------------------------------
  // Camera / projection — fixed ~30deg-from-vertical angled view. World
  // axes: X right, Y is depth (into the scene), Z = height up. The mesh
  // bends visibly into cones where wells sit.
  // ---------------------------------------------------------------------
  var CAM = {
    pitchCos: Math.cos(0.62),  // ~35.5deg tilt of the ground plane
    pitchSin: Math.sin(0.62),
    heightK: 0.85,             // screen px lift per height-unit (xcell)
    persp: 0.34                // perspective strength (0 = orthographic)
  };
  function project(gx, gy, h) {
    var W = canvas.width, Hh = canvas.height;
    var hm = level.hm;
    var cell = Math.min(W, Hh) / (Math.max(hm.gw, hm.gh) * 1.18);
    var a = (gx - hm.gw / 2);
    var b = (gy - hm.gh / 2);
    // Depth from camera grows toward the far (small-b) edge; near the
    // viewer (large b) the surface is biggest.
    var depthN = (b * CAM.pitchSin) / (hm.gh) + 0.5; // ~0 far .. ~1 near
    var pscale = 1 / (1 + CAM.persp * (1 - depthN));
    var screenX = W / 2 + a * cell * pscale;
    var ground = b * CAM.pitchCos;
    var screenY = Hh * 0.40 + (ground * cell - h * CAM.heightK * cell * 0.5) * pscale;
    return { sx: screenX, sy: screenY, sc: pscale };
  }

  // ---------------------------------------------------------------------
  // Obstacle rendering — each type has a distinct wireframe-aesthetic
  // signature so the player can read it at a glance. Perimeters are
  // sampled through the heightmap so they hug the curved surface.
  // ---------------------------------------------------------------------
  function obstacleStyle(type) {
    // [stroke, fill, glyphColor]. Translucent fills so the mesh shows through.
    switch (type) {
      case "bumper":   return ["rgba(120,240,255,0.95)", "rgba(70,180,235,0.45)", "rgba(255,255,255,0.9)"];
      case "reverse":  return ["rgba(255,120,200,0.95)", "rgba(180,60,160,0.20)", "rgba(255,170,220,0.9)"];
      case "ice":      return ["rgba(180,230,255,0.85)", "rgba(120,200,255,0.18)", "rgba(220,240,255,0.85)"];
      case "mud":      return ["rgba(190,140,90,0.85)",  "rgba(120,80,40,0.32)",  "rgba(220,170,110,0.85)"];
      case "conveyor": return ["rgba(110,255,170,0.95)", "rgba(40,180,120,0.18)", "rgba(160,255,200,0.9)"];
      case "wind":     return ["rgba(180,255,210,0.7)",  "rgba(120,220,180,0.10)","rgba(200,255,220,0.85)"];
      case "tractor":  return ["rgba(255,180,90,0.95)",  "rgba(220,130,40,0.18)", "rgba(255,210,140,0.9)"];
    }
    return ["#fff", "rgba(255,255,255,0.1)", "#fff"];
  }
  function ringPath(cx, cy, r, segs) {
    ctx.beginPath();
    for (var s = 0; s <= segs; s++) {
      var a = s / segs * Math.PI * 2;
      var wx = cx + Math.cos(a) * r;
      var wy = cy + Math.sin(a) * r;
      var hh = level.hm.sample(wx, wy).h;
      var pp = project(wx, wy, hh);
      if (s === 0) ctx.moveTo(pp.sx, pp.sy); else ctx.lineTo(pp.sx, pp.sy);
    }
  }
  function renderObstacles() {
    var obs = level.obstacles;
    if (!obs || !obs.length) return;
    ctx.lineWidth = Math.max(1, DPR * 1.2);
    ctx.shadowBlur = 10 * DPR;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      var st = obstacleStyle(o.type);
      var cx = o.x, cy = o.y;
      var rad = o.r != null ? o.r : 0.5;
      var hC = level.hm.sample(cx, cy).h;
      var pc = project(cx, cy, hC);
      ctx.shadowColor = st[0];

      if (o.type === "bumper") {
        // Solid cyan disc — small, central glow.
        ringPath(cx, cy, rad, 22);
        ctx.fillStyle = st[1];
        ctx.fill();
        ctx.strokeStyle = st[0];
        ctx.stroke();
        // bright dot at the centre
        ctx.beginPath();
        ctx.arc(pc.sx, pc.sy, Math.max(2, 3 * DPR * pc.sc), 0, Math.PI * 2);
        ctx.fillStyle = st[2];
        ctx.fill();
        continue;
      }

      // Zone obstacles — outer ring + a faint translucent fill.
      ringPath(cx, cy, rad, 36);
      ctx.fillStyle = st[1];
      ctx.fill();
      ctx.strokeStyle = st[0];
      ctx.stroke();

      // Type-specific glyph inside the ring.
      ctx.strokeStyle = st[2];
      switch (o.type) {
        case "reverse": {
          // Spiral arms to read as "wrong-way / inverted".
          var arms = 3;
          for (var a = 0; a < arms; a++) {
            ctx.beginPath();
            for (var t = 0; t <= 24; t++) {
              var u = t / 24;
              var ang = (a / arms) * Math.PI * 2 + u * Math.PI * 1.4;
              var rr = u * rad * 0.85;
              var wx2 = cx + Math.cos(ang) * rr;
              var wy2 = cy + Math.sin(ang) * rr;
              var hh2 = level.hm.sample(wx2, wy2).h;
              var pp2 = project(wx2, wy2, hh2);
              if (t === 0) ctx.moveTo(pp2.sx, pp2.sy); else ctx.lineTo(pp2.sx, pp2.sy);
            }
            ctx.stroke();
          }
          break;
        }
        case "ice": {
          // Six radial shimmer spokes — snowflake-ish.
          for (var k = 0; k < 6; k++) {
            var ang2 = k / 6 * Math.PI * 2;
            var wxa = cx + Math.cos(ang2) * rad * 0.15;
            var wya = cy + Math.sin(ang2) * rad * 0.15;
            var wxb = cx + Math.cos(ang2) * rad * 0.85;
            var wyb = cy + Math.sin(ang2) * rad * 0.85;
            var ha = level.hm.sample(wxa, wya).h;
            var hb = level.hm.sample(wxb, wyb).h;
            var pa = project(wxa, wya, ha);
            var pb = project(wxb, wyb, hb);
            ctx.beginPath();
            ctx.moveTo(pa.sx, pa.sy);
            ctx.lineTo(pb.sx, pb.sy);
            ctx.stroke();
          }
          break;
        }
        case "mud": {
          // Scattered dots inside the zone.
          var dots = 11;
          for (var di = 0; di < dots; di++) {
            // pseudo-random but stable per-level position (cheap hash on di+seed)
            var seed = (i * 7 + di * 13) % 97;
            var fang = (seed * 2.39996) % (Math.PI * 2);
            var fr = (((seed * 17) % 100) / 100) * rad * 0.7;
            var dx2 = cx + Math.cos(fang) * fr;
            var dy2 = cy + Math.sin(fang) * fr;
            var hd = level.hm.sample(dx2, dy2).h;
            var pd = project(dx2, dy2, hd);
            ctx.beginPath();
            ctx.arc(pd.sx, pd.sy, Math.max(1, 1.6 * DPR * pd.sc), 0, Math.PI * 2);
            ctx.fillStyle = st[2];
            ctx.fill();
          }
          break;
        }
        case "conveyor":
        case "wind": {
          // Three chevrons pointing along (dx,dy).
          var ux = o.dx || 0, uy = o.dy || 0;
          var um = Math.sqrt(ux * ux + uy * uy) || 1;
          ux /= um; uy /= um;
          var px = -uy, py = ux; // perpendicular
          for (var c = -1; c <= 1; c++) {
            // Three chevrons spaced along the direction axis, each
            // pointing in (ux,uy) like a flowing conveyor strip.
            var off = c * rad * 0.45;
            var tipx = cx + ux * off;
            var tipy = cy + uy * off;
            var armL = rad * 0.35;
            var aL_x = tipx - ux * armL - px * armL * 0.6;
            var aL_y = tipy - uy * armL - py * armL * 0.6;
            var aR_x = tipx - ux * armL + px * armL * 0.6;
            var aR_y = tipy - uy * armL + py * armL * 0.6;
            var hT = level.hm.sample(tipx, tipy).h;
            var hL = level.hm.sample(aL_x, aL_y).h;
            var hR = level.hm.sample(aR_x, aR_y).h;
            var pT = project(tipx, tipy, hT);
            var pL = project(aL_x, aL_y, hL);
            var pR = project(aR_x, aR_y, hR);
            ctx.beginPath();
            ctx.moveTo(pL.sx, pL.sy);
            ctx.lineTo(pT.sx, pT.sy);
            ctx.lineTo(pR.sx, pR.sy);
            ctx.stroke();
          }
          break;
        }
        case "tractor": {
          // Concentric tightening rings — "pull inward" cue.
          for (var ti = 0; ti < 3; ti++) {
            var trad = rad * (0.25 + ti * 0.25);
            ringPath(cx, cy, trad, 28);
            ctx.strokeStyle = "rgba(255,180,90," + (0.85 - ti * 0.2) + ")";
            ctx.stroke();
          }
          break;
        }
      }
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  // ---------------------------------------------------------------------
  // Render — glowing wireframe triangular mesh on a dark field.
  // ---------------------------------------------------------------------
  function render() {
    var W = canvas.width, Hh = canvas.height;
    ctx.clearRect(0, 0, W, Hh);
    if (!level) return;
    var hm = level.hm, H = hm.H, cw = hm.cw;

    // Project every corner once.
    var P = new Array(hm.ch);
    var minH = Infinity, maxH = -Infinity;
    for (var j = 0; j <= hm.gh; j++) {
      P[j] = new Array(hm.cw);
      for (var i = 0; i <= hm.gw; i++) {
        var hv = H[i + j * cw];
        if (hv < minH) minH = hv;
        if (hv > maxH) maxH = hv;
        P[j][i] = project(i, j, hv);
      }
    }
    var span = Math.max(0.001, maxH - minH);

    // Depth/height tint: deep mesh glows hotter (cyan->blue->violet).
    function lineStyle(h) {
      var t = (h - minH) / span;            // 0 deep .. 1 high
      // deep wells -> bright cyan; flat -> mid blue; hills -> pale.
      var r = Math.round(lerp(40, 150, t));
      var g = Math.round(lerp(225, 180, t));
      var bl = Math.round(lerp(255, 255, t));
      var a = lerp(0.92, 0.5, t);
      return "rgba(" + r + "," + g + "," + bl + "," + a + ")";
    }

    ctx.lineWidth = Math.max(1, DPR * 0.9);
    ctx.shadowColor = "rgba(90,220,255,0.9)";
    ctx.shadowBlur = 8 * DPR;
    ctx.lineCap = "round";

    // Horizontal grid lines (one polyline per row), tinted by avg row h.
    for (var j2 = 0; j2 <= hm.gh; j2++) {
      ctx.beginPath();
      var rowH = 0;
      for (var i2 = 0; i2 <= hm.gw; i2++) {
        var p = P[j2][i2];
        rowH += H[i2 + j2 * cw];
        if (i2 === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
      }
      ctx.strokeStyle = lineStyle(rowH / hm.cw);
      ctx.stroke();
    }
    // Vertical grid lines.
    for (var i3 = 0; i3 <= hm.gw; i3++) {
      ctx.beginPath();
      var colH = 0;
      for (var j3 = 0; j3 <= hm.gh; j3++) {
        var p2 = P[j3][i3];
        colH += H[i3 + j3 * cw];
        if (j3 === 0) ctx.moveTo(p2.sx, p2.sy); else ctx.lineTo(p2.sx, p2.sy);
      }
      ctx.strokeStyle = lineStyle(colH / hm.ch);
      ctx.stroke();
    }
    // Diagonals (the triangle split) — dimmer, batched in one path.
    ctx.shadowBlur = 4 * DPR;
    ctx.strokeStyle = "rgba(70,170,230,0.32)";
    ctx.beginPath();
    for (var jd = 0; jd < hm.gh; jd++) {
      for (var id = 0; id < hm.gw; id++) {
        var a0 = P[jd][id], a1 = P[jd + 1][id + 1];
        ctx.moveTo(a0.sx, a0.sy);
        ctx.lineTo(a1.sx, a1.sy);
      }
    }
    ctx.stroke();

    // Well target rings at the bowl bottom.
    var w = level.well;
    var wb = level.hm.sample(w.x, w.y).h;
    ctx.shadowBlur = 14 * DPR;
    for (var ri = 0; ri < 3; ri++) {
      var rr = w.captureR * (0.4 + ri * 0.3);
      ctx.beginPath();
      for (var seg = 0; seg <= 36; seg++) {
        var ang = seg / 36 * Math.PI * 2;
        var hxy = level.hm.sample(w.x + Math.cos(ang) * rr, w.y + Math.sin(ang) * rr);
        var pp = project(w.x + Math.cos(ang) * rr, w.y + Math.sin(ang) * rr, hxy.h);
        if (seg === 0) ctx.moveTo(pp.sx, pp.sy); else ctx.lineTo(pp.sx, pp.sy);
      }
      ctx.strokeStyle = "rgba(120,255,235," + (0.7 - ri * 0.18) + ")";
      ctx.lineWidth = Math.max(1, DPR * 1.4);
      ctx.stroke();
    }

    renderObstacles();

    // Marble — glowing sphere sitting on the surface.
    var mp = project(marble.x, marble.y, marble.h - marble.sink * 1.6);
    var cellPx = Math.min(W, Hh) / (Math.max(hm.gw, hm.gh) * 1.18);
    var rad = cellPx * MARBLE_R * 2.0 * mp.sc * (1 - marble.sink * 0.45);
    ctx.shadowBlur = 18 * DPR;
    ctx.shadowColor = "rgba(255,150,90,0.95)";
    var grd = ctx.createRadialGradient(
      mp.sx - rad * 0.3, mp.sy - rad * 0.4, rad * 0.1,
      mp.sx, mp.sy, rad);
    grd.addColorStop(0, "#fff4e6");
    grd.addColorStop(0.4, "#ffb066");
    grd.addColorStop(1, "#c2541f");
    ctx.beginPath();
    ctx.arc(mp.sx, mp.sy, Math.max(2, rad), 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    if (dbg.show) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(8 * DPR, 8 * DPR, 240 * DPR, 78 * DPR);
      ctx.fillStyle = "#7df0c8";
      ctx.font = (12 * DPR) + "px monospace";
      var sp = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy);
      ctx.fillText("mode=" + controlMode + " perm=" + tilt.perm, 16 * DPR, 26 * DPR);
      ctx.fillText("pos=" + marble.x.toFixed(2) + "," + marble.y.toFixed(2), 16 * DPR, 44 * DPR);
      ctx.fillText("h=" + marble.h.toFixed(2) + " spd=" + sp.toFixed(2), 16 * DPR, 62 * DPR);
      ctx.fillText("dg=" + dbg.dg.toFixed(1) + " db=" + dbg.db.toFixed(1), 16 * DPR, 80 * DPR);
    }
  }

  // ---------------------------------------------------------------------
  // Main loop — fixed-step physics, render each frame.
  // ---------------------------------------------------------------------
  var lastT = 0, acc = 0;
  function frame(now) {
    if (!lastT) lastT = now;
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.25) dt = 0.25;

    if (phase === "play") {
      elapsed += dt;
      if (timerEl) timerEl.textContent = elapsed.toFixed(1);
      acc += dt;
      var steps = 0;
      while (acc >= FIXED_DT && steps < MAX_SUBSTEPS) {
        physStep(FIXED_DT);
        acc -= FIXED_DT;
        steps++;
        if (phase !== "play") break;
      }
      if (acc > FIXED_DT * MAX_SUBSTEPS) acc = 0;
      var spd = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy);
      if (!soundMuted) Sound.roll(spd);
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Editor bridge (Phase 3 fills this in; declared now for stability).
  // ---------------------------------------------------------------------
  window.MM = {
    getBundledLevels: function () { return [buildTutorialLevel()]; },
    playLevel: function (lv) { level = lv; phase = "play"; resetMarble(); }
  };

  // ---------------------------------------------------------------------
  // Live-tune panel — ?tune=1 (ported pattern from v1.0)
  // ---------------------------------------------------------------------
  (function buildTunePanel() {
    var on = false;
    try { on = /[?&]tune=1(?:&|$)/.test(location.search); } catch (e) {}
    if (!on) return;

    var SPECS = [
      { k: "ACCEL", min: 4, max: 48, step: 1,
        get: function () { return ACCEL; }, set: function (v) { ACCEL = v; } },
      { k: "MAX_SPEED", min: 2, max: 18, step: 0.5,
        get: function () { return MAX_SPEED; }, set: function (v) { MAX_SPEED = v; } },
      { k: "GRAVITY_K", min: 4, max: 90, step: 1,
        get: function () { return GRAVITY_K; }, set: function (v) { GRAVITY_K = v; } },
      { k: "WALL_BOUNCE", min: 0, max: 0.95, step: 0.05,
        get: function () { return WALL_BOUNCE; }, set: function (v) { WALL_BOUNCE = v; } },
      { k: "FRICTION_FLOOR", min: 0.70, max: 0.999, step: 0.002,
        get: function () { return FRICTION_FLOOR; }, set: function (v) { FRICTION_FLOOR = v; } },
      { k: "TILT_FORCE_MULTIPLIER", min: 0.2, max: 6, step: 0.1,
        get: function () { return TILT_FORCE_MULTIPLIER; }, set: function (v) { TILT_FORCE_MULTIPLIER = v; } }
    ];

    var box = document.createElement("div");
    box.setAttribute("style",
      "position:fixed;left:8px;bottom:8px;z-index:9998;width:248px;" +
      "background:rgba(8,14,28,0.92);border:1px solid #1f4a66;border-radius:10px;" +
      "padding:10px 12px;color:#dff6ff;font:12px monospace;");
    var title = document.createElement("div");
    title.setAttribute("style",
      "color:#7df0c8;font-weight:700;cursor:pointer;user-select:none;" +
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
      var sv = localStorage.getItem("mm2.tune.collapsed");
      collapsed = (sv === null) ? (window.innerWidth < 720) : (sv === "1");
    } catch (e) { collapsed = (window.innerWidth < 720); }
    function applyCollapsed() {
      bodyEl.style.display = collapsed ? "none" : "block";
      caret.textContent = collapsed ? "▸" : "▾";
      box.style.width = collapsed ? "auto" : "248px";
    }
    title.addEventListener("click", function () {
      collapsed = !collapsed;
      try { localStorage.setItem("mm2.tune.collapsed", collapsed ? "1" : "0"); } catch (e) {}
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
      tuneRefreshers.push(function () { rng.value = s.get(); setLabel(); });
    });

    var copy = document.createElement("button");
    copy.textContent = "Copy physics block";
    copy.setAttribute("style",
      "margin-top:8px;width:100%;background:#173a52;color:#dff6ff;" +
      "border:1px solid #2a6a8c;border-radius:6px;padding:7px;font:inherit;cursor:pointer;");
    copy.addEventListener("click", function () {
      var live = {
        "ACCEL": ACCEL, "MAX_SPEED": MAX_SPEED, "WALL_BOUNCE": WALL_BOUNCE,
        "FRICTION_FLOOR": FRICTION_FLOOR, "GRAVITY_K": GRAVITY_K,
        "TILT_FORCE_MULTIPLIER": TILT_FORCE_MULTIPLIER
      };
      var diff = [];
      for (var k in BASE_PHYS) {
        if (+live[k] !== +BASE_PHYS[k]) diff.push('    ' + JSON.stringify(k) + ': ' + (+live[k]));
      }
      var txt = diff.length
        ? "// " + curLevelLabel + " — paste into that level's JSON:\n" +
          '  "physics": {\n' + diff.join(",\n") + "\n  }"
        : "// " + curLevelLabel + " matches the global defaults — no override needed.";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          function () { copy.textContent = "Copied ✓"; setTimeout(function () { copy.textContent = "Copy physics block"; }, 1400); },
          function () { window.prompt("Copy this physics block:", txt); });
      } else { window.prompt("Copy this physics block:", txt); }
    });
    bodyEl.appendChild(copy);

    applyCollapsed();
    if (document.body) document.body.appendChild(box);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(box); });
  })();

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  fitCanvas();
  level = buildTutorialLevel();   // so the menu renders a live mesh behind it
  resetMarble();
  requestAnimationFrame(frame);
})();

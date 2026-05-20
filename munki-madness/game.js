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
  // Player-dialed via ?tune=1 (locked 2026-05-19; previous values
  // archived in the commit immediately before this one).
  var ACCEL = 30;            // player-input push (cells/s^2)
  var MAX_SPEED = 7;         // top speed (cells/s)
  var WALL_BOUNCE = 0.4;     // edge restitution (pinball bonk)
  var FRICTION_FLOOR = 0.96; // per-frame@60 velocity multiplier (drag)
  // GRAVITY_K is the *base* slope-to-accel constant — internal, not on
  // the tune panel. The exposed knob is GRAVITY_MULT (player-tunable);
  // effective slope gravity is -GRAVITY_K * GRAVITY_MULT * gradient.
  // MULT=0 → flat (no slope pull); MULT=1 → full base; MULT=2 → wild.
  var GRAVITY_K = 40;
  var GRAVITY_MULT = 0.15;
  var MARBLE_R = 0.42;       // marble radius (cells) — keeps it off the rim

  // Well capture: the marble is "in the goal" when it's inside the well's
  // bowl AND its speed is below ESCAPE_THRESHOLD (cells/s) — trapped at
  // the bottom. The 0.28s dwell timer still rejects fly-throughs.
  var ESCAPE_THRESHOLD = 1.1;

  // ---- Per-well attraction force (additive to the gradient gravity) ----
  // The heightmap gradient gives the *terrain* its feel — gentle when
  // GRAVITY_MULT is low. Wells get their own localised pull so capture
  // is reliable even when the surrounding mesh is almost flat. Force
  // magnitude at distance d:
  //
  //   mag = STRENGTH * (RADIUS / max(d, MIN_DIST)) ^ FALLOFF_EXP
  //   mag = min(mag, WELL_PULL_MAX_FORCE)                  // critical cap
  //
  // Applied in the direction of the well centre. At d == RADIUS the
  // magnitude equals STRENGTH; closer than RADIUS it would ramp fast,
  // but WELL_PULL_MAX_FORCE caps it so the marble doesn't get yanked
  // past the bowl. Once *inside* the drain zone (WELL_DRAIN_RADIUS)
  // an extra per-frame friction (WELL_DRAIN_FRICTION) bleeds momentum
  // so the marble settles to capture.
  var WELL_PULL_STRENGTH    = 5.2;
  var WELL_PULL_RADIUS      = 3.0;
  var WELL_PULL_MIN_DIST    = 0.5;
  var WELL_PULL_FALLOFF_EXP = 2.0;
  var WELL_PULL_MAX_FORCE   = 12;   // tunable; old internal hidden cap was 500
  var WELL_DRAIN_RADIUS     = 1.5;  // tunable; inner damping zone
  var WELL_DRAIN_FRICTION   = 0.85; // tunable; per-frame@60 v-multiplier while inside

  var FIXED_DT = 1 / 120;    // physics substep (s)
  var MAX_SUBSTEPS = 8;      // anti spiral-of-death

  // ---- Tilt control (ported from v1.0; recalibrated feel) ----
  var TILT_FULL = 10;             // deg past the recentred zero = full input
                                  // (smaller = more responsive to subtle tilts)
  var TILT_FORCE_MULTIPLIER = 2.8;
  var TILT_DEADZONE = 2.5;        // deg of slack around zero (anti-jitter)
  var TILT_FLIP_X = 1, TILT_FLIP_Y = 1;
  var DRAG_FULL = 90;             // px of drag that = full input

  // The global BASE — a level JSON MAY carry a sparse "physics" override
  // (Phase 5 catalog uses this; the seam exists now). Keys mirror ?tune=1.
  var BASE_PHYS = {
    "ACCEL": ACCEL, "MAX_SPEED": MAX_SPEED, "WALL_BOUNCE": WALL_BOUNCE,
    "FRICTION_FLOOR": FRICTION_FLOOR, "GRAVITY_MULT": GRAVITY_MULT,
    "TILT_FORCE_MULTIPLIER": TILT_FORCE_MULTIPLIER,
    "ESCAPE_THRESHOLD": ESCAPE_THRESHOLD,
    "WELL_PULL_STRENGTH": WELL_PULL_STRENGTH,
    "WELL_PULL_RADIUS": WELL_PULL_RADIUS,
    "WELL_PULL_MIN_DIST": WELL_PULL_MIN_DIST,
    "WELL_PULL_FALLOFF_EXP": WELL_PULL_FALLOFF_EXP,
    "WELL_PULL_MAX_FORCE": WELL_PULL_MAX_FORCE,
    "WELL_DRAIN_RADIUS": WELL_DRAIN_RADIUS,
    "WELL_DRAIN_FRICTION": WELL_DRAIN_FRICTION,
    "BUMPER_KICK": BUMPER_KICK,
    "CONVEYOR_STR": CONVEYOR_STR,
    "WIND_STR": WIND_STR,
    "TRACTOR_STR": TRACTOR_STR,
    "ICE_DRAG_TARGET": ICE_DRAG_TARGET,
    "ICE_GRIP_REDUCE": ICE_GRIP_REDUCE,
    "MUD_DRAG_TARGET": MUD_DRAG_TARGET,
    "MUD_GRIP_REDUCE": MUD_GRIP_REDUCE
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
  // Per-obstacle default strengths (tune panel exposes all of these).
  // Each obstacle MAY override its own strength inline (`o.strength`); the
  // constants are the LEVEL DEFAULT a builder/editor gets when it doesn't.
  var BUMPER_KICK       = 2.6;    // outward speed kick per bumper hit (cells/s)
  var BUMPER_POST_H     = 0.85;   // visual post height above the mesh (cells)
  var CONVEYOR_STR      = 14;     // conveyor constant force (cells/s^2)
  var WIND_STR          = 8;      // wind force at zone centre (cells/s^2)
  var TRACTOR_STR       = 12;     // tractor pull at zone centre (cells/s^2)
  var ICE_DRAG_TARGET   = 0.995;  // per-frame@60 drag the ice zone pulls toward
  var ICE_GRIP_REDUCE   = 0.65;   // fraction of input authority an ice zone removes
  var MUD_DRAG_TARGET   = 0.70;   // per-frame@60 drag the mud zone pulls toward
  var MUD_GRIP_REDUCE   = 0.15;   // fraction of input authority a mud zone removes

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

  function buildConveyorBeltLevel() {
    var gw = 18, gh = 18;
    var hm = new HeightMap(gw, gh);
    var well = { x: 14.5, y: 9.0, captureR: 1.6 };
    hm.dome(well.x, well.y, -7.0, 3.0);
    // A north-pushing conveyor straddles the path from spawn (lower-left)
    // to well (mid-right). Player rolls east and the belt knocks them
    // north — over-tilt south to compensate, or thread around the edge.
    var obs = [
      { type: "conveyor", x: 9.0, y: 8.0, r: 2.8, dx: 0, dy: -1 }
    ];
    return {
      title: "Conveyor Belt",
      hm: hm,
      spawn: { x: 2.5, y: 14.0 },
      well: well,
      obstacles: obs,
      time: 60,
      physics: null
    };
  }

  function buildWindLaneLevel() {
    var gw = 18, gh = 18;
    var hm = new HeightMap(gw, gh);
    var well = { x: 15.0, y: 3.5, captureR: 1.7 };
    hm.dome(well.x, well.y, -7.5, 3.2);
    // Wide wind zone in mid-field pushes SOUTH while the well sits up at
    // the top-right. The marble has to plow through the gust to reach it.
    // Wind is gentler than conveyor and has cosine falloff to the edge.
    var obs = [
      { type: "wind", x: 9.0, y: 9.0, r: 5.0, dx: 0, dy: 1 }
    ];
    return {
      title: "Wind Lane",
      hm: hm,
      spawn: { x: 2.5, y: 14.0 },
      well: well,
      obstacles: obs,
      time: 60,
      physics: null
    };
  }

  function buildTractorSlingshotLevel() {
    var gw = 18, gh = 18;
    var hm = new HeightMap(gw, gh);
    var well = { x: 15.0, y: 15.0, captureR: 1.7 };
    hm.dome(well.x, well.y, -7.5, 3.0);
    // A tractor sits off the direct spawn→well line and pulls the marble
    // off-course. Aim ABOVE the well to compensate, or ride the curve.
    // (Tractor doesn't capture — it's a deflector, not a goal.)
    var obs = [
      { type: "tractor", x: 8.5, y: 12.5, r: 4.0 }
    ];
    return {
      title: "Tractor Slingshot",
      hm: hm,
      spawn: { x: 2.5, y: 2.5 },
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
    buildIceApproachLevel,
    buildConveyorBeltLevel,
    buildWindLaneLevel,
    buildTractorSlingshotLevel
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
    if (k === "WALL_BOUNCE") return clamp(v, 0, 0.99);
    if (k === "FRICTION_FLOOR") return clamp(v, 0.3, 0.999);
    if (k === "GRAVITY_MULT") return clamp(v, 0, 2);
    if (k === "ESCAPE_THRESHOLD") return clamp(v, 0, 5);
    if (k === "WELL_PULL_STRENGTH") return clamp(v, 0, 10);
    if (k === "WELL_PULL_RADIUS") return clamp(v, 0.5, 8);
    if (k === "WELL_PULL_MIN_DIST") return clamp(v, 0.1, 1);
    if (k === "WELL_PULL_FALLOFF_EXP") return clamp(v, 0.5, 4);
    if (k === "WELL_PULL_MAX_FORCE") return clamp(v, 1, 30);
    if (k === "WELL_DRAIN_RADIUS") return clamp(v, 0.5, 5);
    if (k === "WELL_DRAIN_FRICTION") return clamp(v, 0.5, 0.99);
    if (k === "BUMPER_KICK") return clamp(v, 0, 10);
    if (k === "CONVEYOR_STR") return clamp(v, 0, 40);
    if (k === "WIND_STR") return clamp(v, 0, 30);
    if (k === "TRACTOR_STR") return clamp(v, 0, 30);
    if (k === "ICE_DRAG_TARGET") return clamp(v, 0.90, 0.999);
    if (k === "ICE_GRIP_REDUCE") return clamp(v, 0, 1);
    if (k === "MUD_DRAG_TARGET") return clamp(v, 0.30, 0.99);
    if (k === "MUD_GRIP_REDUCE") return clamp(v, 0, 1);
    return Math.max(0, v);
  }
  function applyPhysics(p) {
    ACCEL = p.ACCEL; MAX_SPEED = p.MAX_SPEED; WALL_BOUNCE = p.WALL_BOUNCE;
    FRICTION_FLOOR = p.FRICTION_FLOOR; GRAVITY_MULT = p.GRAVITY_MULT;
    TILT_FORCE_MULTIPLIER = p.TILT_FORCE_MULTIPLIER;
    ESCAPE_THRESHOLD = p.ESCAPE_THRESHOLD;
    WELL_PULL_STRENGTH = p.WELL_PULL_STRENGTH;
    WELL_PULL_RADIUS = p.WELL_PULL_RADIUS;
    WELL_PULL_MIN_DIST = p.WELL_PULL_MIN_DIST;
    WELL_PULL_FALLOFF_EXP = p.WELL_PULL_FALLOFF_EXP;
    WELL_PULL_MAX_FORCE = p.WELL_PULL_MAX_FORCE;
    WELL_DRAIN_RADIUS = p.WELL_DRAIN_RADIUS;
    WELL_DRAIN_FRICTION = p.WELL_DRAIN_FRICTION;
    BUMPER_KICK = p.BUMPER_KICK;
    CONVEYOR_STR = p.CONVEYOR_STR;
    WIND_STR = p.WIND_STR;
    TRACTOR_STR = p.TRACTOR_STR;
    ICE_DRAG_TARGET = p.ICE_DRAG_TARGET;
    ICE_GRIP_REDUCE = p.ICE_GRIP_REDUCE;
    MUD_DRAG_TARGET = p.MUD_DRAG_TARGET;
    MUD_GRIP_REDUCE = p.MUD_GRIP_REDUCE;
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
  var captureTimer = 0;        // s the marble has dwelt in the bowl (slow + inBowl)
  var drainDwell = 0;          // s the marble has dwelt INSIDE the drain zone
                               // (bypass capture: trapped long enough = done)
  // Live diagnostic state — read by the ?tune=1 overlay each frame.
  var mmDbg = {
    pos:   { x: 0, y: 0 },
    vel:   { x: 0, y: 0, m: 0 },
    pull:  { x: 0, y: 0, m: 0 },
    wd:    0,        // distance to well centre
    inBowl: false,
    inDrain: false
  };

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
    elapsed = 0; captureTimer = 0; drainDwell = 0;
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
    elapsed = 0; captureTimer = 0; drainDwell = 0;
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
          // Pull drag toward ICE_DRAG_TARGET (slippery) and grip down.
          state.drag = state.drag + (ICE_DRAG_TARGET - state.drag) * falloff;
          state.gripMul = Math.min(state.gripMul, 1 - ICE_GRIP_REDUCE * falloff);
          break;
        case "mud":
          // Pull drag toward MUD_DRAG_TARGET (sticky) and grip down.
          state.drag = state.drag + (MUD_DRAG_TARGET - state.drag) * falloff;
          state.gripMul = Math.min(state.gripMul, 1 - MUD_GRIP_REDUCE * falloff);
          break;
        case "conveyor":
          var cs = (o.strength != null ? o.strength : CONVEYOR_STR);
          state.extraAx += (o.dx || 0) * cs;
          state.extraAy += (o.dy || 0) * cs;
          break;
        case "wind":
          var ws = (o.strength != null ? o.strength : WIND_STR) * falloff;
          state.extraAx += (o.dx || 0) * ws;
          state.extraAy += (o.dy || 0) * ws;
          break;
        case "tractor":
          var ts = (o.strength != null ? o.strength : TRACTOR_STR) * falloff;
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
    // Effective strength = GRAVITY_K * GRAVITY_MULT (MULT is the panel knob).
    var gK = GRAVITY_K * GRAVITY_MULT;
    var ax = st.gravFlip * -gK * s.gx;
    var ay = st.gravFlip * -gK * s.gy;

    // Per-well attraction — additive to the gradient gravity. Designed
    // so the marble can roll freely over gentle slopes (small GRAVITY_MULT)
    // but still falls reliably into the well as it approaches the rim.
    //   mag = STRENGTH * (RADIUS / max(d, MIN_DIST)) ^ FALLOFF_EXP
    // Subject to the same gravFlip so reverse-gravity zones repel from
    // wells consistently with the rest of the landscape physics.
    var w = level.well;
    var wpx = w.x - marble.x;
    var wpy = w.y - marble.y;
    var wd  = Math.sqrt(wpx * wpx + wpy * wpy);
    var wpfx = 0, wpfy = 0, wmag = 0;   // captured for the diagnostic overlay
    if (wd > 0.0001 && WELL_PULL_STRENGTH > 0) {
      var dc = Math.max(wd, WELL_PULL_MIN_DIST);
      wmag = WELL_PULL_STRENGTH *
             Math.pow(WELL_PULL_RADIUS / dc, WELL_PULL_FALLOFF_EXP);
      // Critical cap: without this, STRENGTH=5.2 at MIN_DIST=0.5 yields
      // 187 cells/s^2 and shoots the marble straight through the well.
      if (wmag > WELL_PULL_MAX_FORCE) wmag = WELL_PULL_MAX_FORCE;
      var wnx = wpx / wd, wny = wpy / wd;
      wpfx = st.gravFlip * wmag * wnx;
      wpfy = st.gravFlip * wmag * wny;
      ax += wpfx;
      ay += wpfy;
    }

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

    // Drain zone — extra per-frame@60 damping while inside WELL_DRAIN_RADIUS
    // of the well centre. Bleeds momentum hard so the marble settles to
    // the capture threshold even with WELL_PULL pulling it in.
    var inDrain = (wd < WELL_DRAIN_RADIUS);
    if (inDrain) {
      var dd = Math.pow(WELL_DRAIN_FRICTION, dt * 60);
      marble.vx *= dd;
      marble.vy *= dd;
    }

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

    // Well capture: two paths, whichever fires first. Post-capture
    // timing halved 2026-05-19 — "you did it!" moment was too long.
    //   (a) Inside captureR bowl AND speed < ESCAPE_THRESHOLD continuously
    //       for 0.14s — the classic capture path.
    //   (b) Inside the drain zone for 0.15s continuously — bypass capture
    //       for when the marble is moving fast but trapped by drain damping.
    var dwx = marble.x - w.x, dwy = marble.y - w.y;
    var dwell = Math.sqrt(dwx * dwx + dwy * dwy);
    var sp2 = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy);
    var inBowl = dwell < w.captureR;
    var slow = sp2 < ESCAPE_THRESHOLD;
    if (inBowl && slow) {
      captureTimer += dt;
      // sink animation ramp doubled (dt*3 → dt*6) so the marble settles
      // into the hole in ~0.17s instead of ~0.33s
      marble.sink = Math.min(1, marble.sink + dt * 6);
      if (captureTimer > 0.14) { win(); }
    } else {
      captureTimer = Math.max(0, captureTimer - dt * 2);
      marble.sink = Math.max(0, marble.sink - dt * 4);
    }
    if (inDrain) {
      drainDwell += dt;
      if (drainDwell > 0.15) { win(); }
    } else {
      drainDwell = 0;
    }

    // Update the diagnostic snapshot for the ?tune=1 overlay.
    mmDbg.pos.x = marble.x;  mmDbg.pos.y = marble.y;
    mmDbg.vel.x = marble.vx; mmDbg.vel.y = marble.vy; mmDbg.vel.m = sp2;
    mmDbg.pull.x = wpfx;     mmDbg.pull.y = wpfy;     mmDbg.pull.m = wmag;
    mmDbg.wd = wd;
    mmDbg.inBowl = inBowl;
    mmDbg.inDrain = inDrain;
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
        // 3D post: bottom ring on the mesh + top ring lifted by
        // BUMPER_POST_H + vertical struts between. Reads as a short
        // cylindrical post on the wireframe surface.
        var segs = 22;
        var struts = 8;
        // Project the perimeter twice — once at ground, once at the top.
        var bot = [];
        var top = [];
        for (var sb = 0; sb <= segs; sb++) {
          var a2 = sb / segs * Math.PI * 2;
          var wx = cx + Math.cos(a2) * rad;
          var wy = cy + Math.sin(a2) * rad;
          var hh = level.hm.sample(wx, wy).h;
          bot.push(project(wx, wy, hh));
          top.push(project(wx, wy, hh + BUMPER_POST_H));
        }
        // Translucent cylindrical wall (subtle fill between the rings).
        ctx.beginPath();
        ctx.moveTo(bot[0].sx, bot[0].sy);
        for (var ss = 1; ss <= segs; ss++) ctx.lineTo(bot[ss].sx, bot[ss].sy);
        for (var st2 = segs; st2 >= 0; st2--) ctx.lineTo(top[st2].sx, top[st2].sy);
        ctx.closePath();
        ctx.fillStyle = st[1];
        ctx.fill();
        // Bottom ring (dimmer — it sits on the mesh).
        ctx.beginPath();
        for (var sd = 0; sd <= segs; sd++) {
          if (sd === 0) ctx.moveTo(bot[sd].sx, bot[sd].sy);
          else ctx.lineTo(bot[sd].sx, bot[sd].sy);
        }
        ctx.strokeStyle = "rgba(80,180,235,0.55)";
        ctx.stroke();
        // Top ring (brighter — the cap).
        ctx.beginPath();
        for (var su = 0; su <= segs; su++) {
          if (su === 0) ctx.moveTo(top[su].sx, top[su].sy);
          else ctx.lineTo(top[su].sx, top[su].sy);
        }
        ctx.strokeStyle = st[0];
        ctx.stroke();
        // Vertical struts.
        ctx.beginPath();
        for (var sv = 0; sv < struts; sv++) {
          var idx = Math.round(sv / struts * segs);
          ctx.moveTo(bot[idx].sx, bot[idx].sy);
          ctx.lineTo(top[idx].sx, top[idx].sy);
        }
        ctx.strokeStyle = "rgba(120,220,255,0.75)";
        ctx.stroke();
        // Bright dot at the centre of the top cap.
        var hCt = level.hm.sample(cx, cy).h + BUMPER_POST_H;
        var pct = project(cx, cy, hCt);
        ctx.beginPath();
        ctx.arc(pct.sx, pct.sy, Math.max(2, 3 * DPR * pct.sc), 0, Math.PI * 2);
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

    // ---- MARBLE — must draw LAST. Load-bearing for z-order: anything
    // drawn after this can occlude the ball. The marble's *physics*
    // position is on the surface (centre at marble.h), but rendering at
    // that Z visually buries the ball one radius into the mesh — and
    // any obstacle with a translucent fill (ice, mud, etc.) sits at
    // that same Z and covered the lower hemisphere, making the ball
    // appear to "disappear into" the obstacle. Lift the rendered Z by
    // MARBLE_R so the ball's BOTTOM rides the mesh — visually it
    // sits on top, which is what the physics already says.
    ctx.save();
    var renderZ = marble.h + MARBLE_R - marble.sink * 1.6;
    var mp = project(marble.x, marble.y, renderZ);
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
    // Dark outline for contrast against any obstacle fill (cyan ice,
    // tan mud, green conveyor, etc.) — keeps the ball readable.
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(1, DPR * 1.1);
    ctx.strokeStyle = "rgba(40,18,8,0.70)";
    ctx.stroke();
    ctx.restore();

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
  // Live-tune panel — ?tune=1.
  //   - Wide on phone (92vw) so sliders have real drag precision.
  //   - Big value readout above each slider, monospace, cyan.
  //   - Collapsible to a single bar tap; collapse state persisted.
  //   - "Copy current values" dumps ALL knobs as a JSON snippet you can
  //     paste back to Claude; the new values become defaults next commit.
  // ---------------------------------------------------------------------
  (function buildTunePanel() {
    var on = false;
    try { on = /[?&]tune=1(?:&|$)/.test(location.search); } catch (e) {}
    if (!on) return;

    // Slider specs — order = display order. Ranges per spec; ESCAPE and
    // GRAVITY_MULT are the new Phase-1.1 knobs.
    var SPECS = [
      { k: "ACCEL",                 min: 5,    max: 40,   step: 1,    fmt: 0,
        get: function () { return ACCEL; },           set: function (v) { ACCEL = v; } },
      { k: "GRAVITY_MULT",          min: 0,    max: 2.0,  step: 0.05, fmt: 2,
        get: function () { return GRAVITY_MULT; },    set: function (v) { GRAVITY_MULT = v; } },
      { k: "MAX_SPEED",             min: 2,    max: 15,   step: 0.5,  fmt: 1,
        get: function () { return MAX_SPEED; },       set: function (v) { MAX_SPEED = v; } },
      { k: "WALL_BOUNCE",           min: 0,    max: 0.99, step: 0.05, fmt: 2,
        get: function () { return WALL_BOUNCE; },     set: function (v) { WALL_BOUNCE = v; } },
      { k: "FRICTION_FLOOR",        min: 0.70, max: 0.99, step: 0.01, fmt: 2,
        get: function () { return FRICTION_FLOOR; },  set: function (v) { FRICTION_FLOOR = v; } },
      { k: "TILT_FORCE_MULTIPLIER", min: 0.5,  max: 3.0,  step: 0.1,  fmt: 1,
        get: function () { return TILT_FORCE_MULTIPLIER; },
        set: function (v) { TILT_FORCE_MULTIPLIER = v; } },
      { k: "ESCAPE_THRESHOLD",      min: 0,    max: 5.0,  step: 0.1,  fmt: 1,
        get: function () { return ESCAPE_THRESHOLD; },set: function (v) { ESCAPE_THRESHOLD = v; } },
      // Per-well attraction layer — see PHYSICS_SPEC "Well-pull force".
      { k: "WELL_PULL_STRENGTH",    min: 0,    max: 10,   step: 0.1,  fmt: 2,
        get: function () { return WELL_PULL_STRENGTH; },
        set: function (v) { WELL_PULL_STRENGTH = v; } },
      { k: "WELL_PULL_RADIUS",      min: 0.5,  max: 8,    step: 0.1,  fmt: 1,
        get: function () { return WELL_PULL_RADIUS; },
        set: function (v) { WELL_PULL_RADIUS = v; } },
      { k: "WELL_PULL_MIN_DIST",    min: 0.1,  max: 1.0,  step: 0.05, fmt: 2,
        get: function () { return WELL_PULL_MIN_DIST; },
        set: function (v) { WELL_PULL_MIN_DIST = v; } },
      { k: "WELL_PULL_FALLOFF_EXP", min: 0.5,  max: 4.0,  step: 0.1,  fmt: 1,
        get: function () { return WELL_PULL_FALLOFF_EXP; },
        set: function (v) { WELL_PULL_FALLOFF_EXP = v; } },
      // Capture fixes — see PHYSICS_SPEC "Well-pull cap + drain zone".
      { k: "WELL_PULL_MAX_FORCE",   min: 1,    max: 30,   step: 0.5,  fmt: 1,
        get: function () { return WELL_PULL_MAX_FORCE; },
        set: function (v) { WELL_PULL_MAX_FORCE = v; } },
      { k: "WELL_DRAIN_RADIUS",     min: 0.5,  max: 5.0,  step: 0.1,  fmt: 1,
        get: function () { return WELL_DRAIN_RADIUS; },
        set: function (v) { WELL_DRAIN_RADIUS = v; } },
      { k: "WELL_DRAIN_FRICTION",   min: 0.5,  max: 0.99, step: 0.01, fmt: 2,
        get: function () { return WELL_DRAIN_FRICTION; },
        set: function (v) { WELL_DRAIN_FRICTION = v; } },
      // Obstacle default strengths — each obstacle MAY override its
      // own strength inline; these are the level-builder defaults.
      { k: "BUMPER_KICK",           min: 0,    max: 10,   step: 0.1,  fmt: 1,
        get: function () { return BUMPER_KICK; },
        set: function (v) { BUMPER_KICK = v; } },
      { k: "CONVEYOR_STR",          min: 0,    max: 40,   step: 1,    fmt: 0,
        get: function () { return CONVEYOR_STR; },
        set: function (v) { CONVEYOR_STR = v; } },
      { k: "WIND_STR",              min: 0,    max: 30,   step: 1,    fmt: 0,
        get: function () { return WIND_STR; },
        set: function (v) { WIND_STR = v; } },
      { k: "TRACTOR_STR",           min: 0,    max: 30,   step: 1,    fmt: 0,
        get: function () { return TRACTOR_STR; },
        set: function (v) { TRACTOR_STR = v; } },
      { k: "ICE_DRAG_TARGET",       min: 0.90, max: 0.999,step: 0.001,fmt: 3,
        get: function () { return ICE_DRAG_TARGET; },
        set: function (v) { ICE_DRAG_TARGET = v; } },
      { k: "ICE_GRIP_REDUCE",       min: 0,    max: 1,    step: 0.05, fmt: 2,
        get: function () { return ICE_GRIP_REDUCE; },
        set: function (v) { ICE_GRIP_REDUCE = v; } },
      { k: "MUD_DRAG_TARGET",       min: 0.30, max: 0.99, step: 0.01, fmt: 2,
        get: function () { return MUD_DRAG_TARGET; },
        set: function (v) { MUD_DRAG_TARGET = v; } },
      { k: "MUD_GRIP_REDUCE",       min: 0,    max: 1,    step: 0.05, fmt: 2,
        get: function () { return MUD_GRIP_REDUCE; },
        set: function (v) { MUD_GRIP_REDUCE = v; } }
    ];

    function fmtNum(v, dp) {
      if (dp === 0) return String(Math.round(v));
      return (+v).toFixed(dp);
    }

    // v1.0-style: fixed-width panel pinned bottom-left over the gameplay
    // area. Wide enough to give each slider ~280px of pixel travel for
    // real drag precision, but not panel-spanning — tap the header bar
    // to collapse the body to a tiny tab when the canvas needs the room.
    var box = document.createElement("div");
    box.setAttribute("style",
      "position:fixed;" +
      "left:max(8px, env(safe-area-inset-left, 0px));" +
      "bottom:max(8px, env(safe-area-inset-bottom, 0px));" +
      "z-index:9998;" +
      "width:320px;" +
      "max-width:calc(100vw - 16px);" +
      "max-height:80vh;" +
      "overflow-y:auto;" +
      "background:rgba(8,14,28,0.95);" +
      "border:1px solid #1f4a66;" +
      "border-radius:10px;" +
      "padding:10px 12px;" +
      "color:#dff6ff;" +
      "font:12px ui-monospace, Menlo, Consolas, monospace;" +
      "box-shadow:0 8px 32px rgba(0,0,0,0.55);");

    var title = document.createElement("div");
    title.setAttribute("style",
      "color:#7df0c8;font-weight:700;cursor:pointer;user-select:none;" +
      "-webkit-user-select:none;display:flex;align-items:center;gap:8px;" +
      "font-size:13px;letter-spacing:0.5px;");
    var caret = document.createElement("span");
    var tlabel = document.createElement("span");
    tlabel.textContent = "LIVE TUNE  (?tune=1)";
    title.appendChild(caret); title.appendChild(tlabel);
    box.appendChild(title);

    var bodyEl = document.createElement("div");
    bodyEl.setAttribute("style", "margin-top:6px;");
    box.appendChild(bodyEl);

    var collapsed;
    try {
      var sv = localStorage.getItem("mm2.tune.collapsed");
      // Default: expanded so the user finds the sliders straight away on
      // first open; once she collapses once the preference sticks.
      collapsed = (sv === "1");
    } catch (e) { collapsed = false; }
    function applyCollapsed() {
      bodyEl.style.display = collapsed ? "none" : "block";
      caret.textContent = collapsed ? "▸" : "▾";
      box.style.width = collapsed ? "auto" : "320px";
    }
    title.addEventListener("click", function () {
      collapsed = !collapsed;
      try { localStorage.setItem("mm2.tune.collapsed", collapsed ? "1" : "0"); } catch (e) {}
      applyCollapsed();
    });

    tuneLvlEl = document.createElement("div");
    tuneLvlEl.setAttribute("style",
      "color:#7df0c8;font-size:11px;margin-bottom:6px;opacity:0.8;");
    tuneLvlEl.textContent = curLevelLabel || "(no level yet)";
    bodyEl.appendChild(tuneLvlEl);

    // Live diagnostic overlay — pos / vel / well-pull / zone flags.
    // Tiny font so it doesn't eat slider room. Updates at ~12 Hz.
    var dbgEl = document.createElement("pre");
    dbgEl.setAttribute("style",
      "margin:0 0 8px;padding:6px 8px;" +
      "background:rgba(20,40,60,0.55);border-radius:5px;" +
      "color:#bcd9e6;font:10px ui-monospace, Menlo, Consolas, monospace;" +
      "line-height:1.35;white-space:pre;");
    bodyEl.appendChild(dbgEl);
    function pad(s, n) { s = String(s); return s.length >= n ? s : (s + "      ").slice(0, n); }
    function f(v, dp) { return (v >= 0 ? " " : "") + (+v).toFixed(dp); }
    function updateDbg() {
      var inBowl = mmDbg.inBowl ? "Y" : ".";
      var inDrain = mmDbg.inDrain ? "Y" : ".";
      dbgEl.textContent =
        "pos  " + f(mmDbg.pos.x, 2) + "  " + f(mmDbg.pos.y, 2) +
        "   d=" + f(mmDbg.wd, 2) + "\n" +
        "vel  " + f(mmDbg.vel.x, 2) + "  " + f(mmDbg.vel.y, 2) +
        "   |v|=" + f(mmDbg.vel.m, 2) + "\n" +
        "pull " + f(mmDbg.pull.x, 2) + "  " + f(mmDbg.pull.y, 2) +
        "  |F|=" + f(mmDbg.pull.m, 2) + "\n" +
        "bowl=" + inBowl + "  drain=" + inDrain;
    }
    updateDbg();
    setInterval(updateDbg, 80);

    SPECS.forEach(function (s) {
      // v1.0-style row: label + readout on one line, native HTML range
      // input below. The slider gets the full inner width of the panel
      // (~296px of pixel travel inside a 320px panel) for drag precision.
      var row = document.createElement("div");
      row.setAttribute("style", "margin:6px 0 8px;");

      var head = document.createElement("div");
      head.setAttribute("style",
        "display:flex;justify-content:space-between;align-items:baseline;" +
        "margin-bottom:2px;gap:8px;");
      var lab = document.createElement("span");
      lab.textContent = s.k;
      lab.setAttribute("style", "font-size:12px;opacity:0.92;");
      var val = document.createElement("span");
      val.setAttribute("style",
        "color:#7df0c8;font-size:14px;font-weight:700;" +
        "font-variant-numeric:tabular-nums;");
      function setLabel() { val.textContent = fmtNum(s.get(), s.fmt); }
      head.appendChild(lab); head.appendChild(val);
      row.appendChild(head);

      var rng = document.createElement("input");
      rng.type = "range";
      rng.min = s.min; rng.max = s.max; rng.step = s.step;
      rng.value = s.get();
      // Native range input — no custom track/thumb styling. Just full
      // width so the pixel travel matches the panel width.
      rng.setAttribute("style", "width:100%;");
      rng.addEventListener("input", function () { s.set(parseFloat(rng.value)); setLabel(); });
      setLabel();
      row.appendChild(rng);
      bodyEl.appendChild(row);
      tuneRefreshers.push(function () { rng.value = s.get(); setLabel(); });
    });

    // "Copy current values" — emits ALL knobs as a JSON snippet the user
    // can paste back so Claude can commit them as the new defaults.
    var copy = document.createElement("button");
    copy.textContent = "Copy current values";
    copy.setAttribute("style",
      "margin-top:8px;width:100%;background:#173a52;color:#dff6ff;" +
      "border:1px solid #2a6a8c;border-radius:6px;padding:7px;" +
      "font:inherit;cursor:pointer;");
    copy.addEventListener("click", function () {
      // All current values — paste-back format.
      var live = {};
      SPECS.forEach(function (s) {
        live[s.k] = +(+s.get()).toFixed(s.fmt + 2); // a couple extra dp for fidelity
      });
      var txt =
        "// Munki Madness v2.0 — tuned constants from " + curLevelLabel + "\n" +
        "// Paste back to Claude to make these the new defaults.\n" +
        JSON.stringify(live, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          function () {
            copy.textContent = "Copied ✓";
            setTimeout(function () { copy.textContent = "Copy current values"; }, 1400);
          },
          function () { window.prompt("Copy these values:", txt); });
      } else { window.prompt("Copy these values:", txt); }
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

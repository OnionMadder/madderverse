/* Munki Madness — Chunk 1
   Isometric marble maze. The marble IS a curled-up Munki (cross-pollinates
   with All Munkis). Matter.js does the physics in a top-down plane (no
   constant gravity — tilt/touch apply forces); the iso projection is a
   render-only affine transform. Audio is 100% Web Audio synthesis and is
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
  // Matter aliases
  // ---------------------------------------------------------------------
  var Engine = Matter.Engine,
      World = Matter.World,
      Bodies = Matter.Bodies,
      Body = Matter.Body,
      Events = Matter.Events;

  // ---------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------
  var CANVAS = 640;          // internal canvas resolution (square)
  var MARGIN = 56;           // px breathing room around the board
  var WALL_H = 0.55;         // wall block height in world (tile) units
  var MARBLE_R = 0.30;       // marble radius in world units (1 = one tile)

  // Per-surface air friction applied to the marble each step.
  var SURFACE_DRAG = { floor: 0.060, slow: 0.150, ice: 0.012 };

  var FORCE = 0.00026;       // peak control force (full tilt / max drag)
  var TILT_FULL = 38;        // degrees of tilt that = full force
  var DRAG_FULL = 90;        // px of drag that = full force
  var WALL_BONK_MIN = 1.4;   // min impact speed to trigger a squeak

  // SPRITE-SWAP: flip to true once the curl frames + ball PNG are dropped
  // in assets/sprites/ (filenames per SPRITES_README.md). Nothing else
  // needs to change for the placeholder -> real-sprite handoff.
  var USE_SPRITES = false;

  // ---------------------------------------------------------------------
  // Levels — grid strings. Row index = world Y, col index = world X.
  //   #  wall      .  floor (normal)     S  slow (sticky) floor
  //   I  ice (slippery)   O  hole (fall)   @  start        G  goal
  // Match the existing flat-shape convention: hand-designed, JSON-ish.
  // ---------------------------------------------------------------------
  var LEVELS = [
    {
      name: "First Roll",
      time: 45,
      grid: [
        "########",
        "#@.....#",
        "#.####.#",
        "#.####.#",
        "#.####.#",
        "#.....G#",
        "########"
      ]
    },
    {
      name: "Steady Now",
      time: 40,
      grid: [
        "##########",
        "#@.......#",
        "#.######.#",
        "#.#OOOO#.#",
        "#.#OOOO#.#",
        "#.######.#",
        "#.......G#",
        "##########"
      ]
    },
    {
      name: "Slick & Sticky",
      time: 55,
      grid: [
        "############",
        "#@.........#",
        "#.########.#",
        "#.#SSSS##..#",
        "#.#SSSS##.O#",
        "#.#SSSS##..#",
        "#.########.#",
        "#.IIIIIIII.#",
        "#.IIIIIIII.#",
        "#.........G#",
        "############"
      ]
    }
  ];

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
  var fallFlash = document.getElementById("fallFlash");

  // ---------------------------------------------------------------------
  // Control mode
  // ---------------------------------------------------------------------
  var isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  var CONTROL_MODES = ["tilt", "touch", "hybrid"];
  var controlMode = isTouchDevice ? "tilt" : "touch";

  function refreshCtrlLabel() {
    var label = controlMode.charAt(0).toUpperCase() + controlMode.slice(1);
    if (ctrlLabel) ctrlLabel.textContent = label;
    if (howText) {
      howText.textContent =
        controlMode === "touch" ? "Drag anywhere on screen to roll." :
        controlMode === "tilt"  ? "Tilt your device to roll the Munki." :
        "Tilt your device or drag on screen to roll.";
    }
  }
  refreshCtrlLabel();

  ctrlBtn.addEventListener("click", function () {
    var i = CONTROL_MODES.indexOf(controlMode);
    controlMode = CONTROL_MODES[(i + 1) % CONTROL_MODES.length];
    if ((controlMode === "tilt" || controlMode === "hybrid")) requestTilt();
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

    function setMuted(m) { muted = m; if (m && rollGain) rollGain.gain.value = 0; }
    function isMuted() { return muted; }

    return { resume: resume, roll: roll, squeak: squeak,
             scream: scream, chime: chime, setMuted: setMuted,
             isMuted: isMuted };
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
        im.src = base + "munki-curl-" + idx + ".png";
        Sprites.curl[idx - 1] = im;
      })(i);
    }
    var b = new Image();
    b.onload = function () { ok++; done(); };
    b.onerror = done;
    b.src = base + "munki-ball.png";
    Sprites.ball = b;
  }
  loadSprites();

  // ---------------------------------------------------------------------
  // Munki — the player marble's animation state machine.
  //   STANDING -> CURLING -> ROLLED -> UNCURLING
  // Curl/uncurl play frames 1..5 over ~400ms at level start/end. While
  // ROLLED the sprite spins to match the physics velocity vector.
  // ---------------------------------------------------------------------
  function Munki() {
    this.state = "STANDING";
    this.animT = 0;            // 0..1 progress through curl/uncurl
    this.spin = 0;             // accumulated roll angle (rad)
    this.popT = 0;             // placeholder curl-pop timer (s)
  }
  Munki.ANIM_DUR = 0.4;        // seconds for a full curl / uncurl
  Munki.prototype.beginCurl = function () {
    this.state = "CURLING"; this.animT = 0; this.popT = 0;
  };
  Munki.prototype.beginUncurl = function () {
    this.state = "UNCURLING"; this.animT = 0;
  };
  Munki.prototype.update = function (dt, speed) {
    if (this.state === "CURLING") {
      this.animT += dt / Munki.ANIM_DUR;
      this.popT += dt;
      if (this.animT >= 1) { this.animT = 1; this.state = "ROLLED"; }
    } else if (this.state === "UNCURLING") {
      this.animT += dt / Munki.ANIM_DUR;
      if (this.animT >= 1) { this.animT = 1; this.state = "STANDING"; }
    } else if (this.state === "ROLLED") {
      this.spin += speed * dt * 2.4;
    }
  };
  Munki.prototype.frameIndex = function () {
    if (this.state === "CURLING")  return Math.min(4, Math.floor(this.animT * 5));
    if (this.state === "UNCURLING") return Math.min(4, Math.floor((1 - this.animT) * 5));
    if (this.state === "ROLLED")   return 4;
    return 0;
  };

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  var engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 0;                  // top-down: forces only
  engine.timing.timeScale = 1;

  var levelIndex = 0;
  var grid = [], cols = 0, rows = 0;
  var marble = null, walls = [];
  var startTile = { x: 1.5, y: 1.5 }, goalTile = { x: 0, y: 0 };
  var tileW = 64, tileH = 32, OX = 0, OY = 0;

  var phase = "menu";   // menu | intro | play | falling | won
  var munki = new Munki();
  var attempts = 0;
  var levelTime = 0;    // seconds this attempt
  var timerRunning = false;
  var fallZ = 0, fallVZ = 0, fallScale = 1;
  var dragVec = { x: 0, y: 0 }, dragging = false;
  var tilt = { gamma: 0, beta: 0, on: false };
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
  function tileAt(c, r) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return "#";
    return grid[r][c];
  }
  function isWall(ch) { return ch === "#"; }
  function isHole(ch) { return ch === "O"; }
  function surfaceOf(ch) {
    if (ch === "S") return "slow";
    if (ch === "I") return "ice";
    return "floor";
  }

  function loadLevel(i) {
    levelIndex = ((i % LEVELS.length) + LEVELS.length) % LEVELS.length;
    var lv = LEVELS[levelIndex];
    grid = lv.grid.slice();
    rows = grid.length;
    cols = grid[0].length;

    World.clear(engine.world, false);
    walls = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var ch = grid[r][c];
        if (ch === "@") startTile = { x: c + 0.5, y: r + 0.5 };
        if (ch === "G") goalTile = { x: c, y: r };
        if (isWall(ch)) {
          var wb = Bodies.rectangle(c + 0.5, r + 0.5, 1, 1, {
            isStatic: true, restitution: 0.2, friction: 0,
            label: "wall"
          });
          walls.push(wb);
          World.add(engine.world, wb);
        }
      }
    }

    marble = Bodies.circle(startTile.x, startTile.y, MARBLE_R, {
      restitution: 0.34,
      friction: 0.02,
      frictionAir: SURFACE_DRAG.floor,
      density: 0.04,
      label: "marble"
    });
    World.add(engine.world, marble);

    fitProjection();
    attempts = 0;
    elLevel.textContent = String(levelIndex + 1);
    elAttempts.textContent = "0";
    showBest();
    resetAttempt(true);
  }

  function resetAttempt(initial) {
    Body.setPosition(marble, { x: startTile.x, y: startTile.y });
    Body.setVelocity(marble, { x: 0, y: 0 });
    Body.setAngularVelocity(marble, 0);
    fallZ = 0; fallVZ = 0; fallScale = 1;
    levelTime = 0;
    timerRunning = false;
    elTimer.textContent = "0.0";
    munki = new Munki();
    munki.beginCurl();              // curl-up intro every spawn
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
    tilt.gamma = e.gamma || 0;
    tilt.beta = e.beta || 0;
    tilt.on = true;
  }
  function requestTilt() {
    if (typeof DeviceOrientationEvent === "undefined") return;
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(function (st) {
        if (st === "granted") window.addEventListener("deviceorientation", onOrient);
      }).catch(function () {});
    } else {
      window.addEventListener("deviceorientation", onOrient);
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
    if (k === "r") restartLevel();
    if (k === "m") muteBtn.click();
  });

  // ---------------------------------------------------------------------
  // Control force -> world (screen-space push, mapped through inverse iso)
  // ---------------------------------------------------------------------
  function applyControl() {
    if (phase !== "play") return;
    var sx = 0, sy = 0;
    var useTilt = (controlMode === "tilt" || controlMode === "hybrid") && tilt.on;
    var useDrag = (controlMode === "touch" || controlMode === "hybrid") && dragging;

    if (useTilt) {
      sx += clamp(tilt.gamma / TILT_FULL, -1, 1);
      sy += clamp(tilt.beta  / TILT_FULL, -1, 1);
    }
    if (useDrag) {
      var dx = clamp(dragVec.x / DRAG_FULL, -1, 1);
      var dy = clamp(dragVec.y / DRAG_FULL, -1, 1);
      sx += dx; sy += dy;
    }
    sx = clamp(sx, -1, 1); sy = clamp(sy, -1, 1);
    if (sx === 0 && sy === 0) return;

    var w = screenVecToWorld(sx, sy);
    var len = Math.hypot(w.x, w.y) || 1;
    var f = FORCE;
    Body.applyForce(marble, marble.position, {
      x: (w.x / len) * f * Math.hypot(sx, sy),
      y: (w.y / len) * f * Math.hypot(sx, sy)
    });
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------------------------------------------------------------------
  // Wall-bonk squeak
  // ---------------------------------------------------------------------
  Events.on(engine, "collisionStart", function (ev) {
    if (phase !== "play") return;
    for (var i = 0; i < ev.pairs.length; i++) {
      var p = ev.pairs[i];
      var hitWall = (p.bodyA.label === "wall" || p.bodyB.label === "wall");
      var hitMarble = (p.bodyA.label === "marble" || p.bodyB.label === "marble");
      if (hitWall && hitMarble) {
        var sp = marble.speed;
        if (sp > WALL_BONK_MIN) Sound.squeak(sp);
      }
    }
  });

  // ---------------------------------------------------------------------
  // Per-step world logic: surface drag, hole/goal checks
  // ---------------------------------------------------------------------
  function worldStep(dt) {
    if (phase === "play") {
      var cc = Math.floor(marble.position.x);
      var rr = Math.floor(marble.position.y);
      var ch = tileAt(cc, rr);

      marble.frictionAir = SURFACE_DRAG[surfaceOf(ch)];

      if (!timerRunning && marble.speed > 0.05) {
        timerRunning = true;
      }
      if (timerRunning) {
        levelTime += dt;
        elTimer.textContent = levelTime.toFixed(1);
      }

      if (isHole(ch) || cc < 0 || rr < 0 || cc >= cols || rr >= rows) {
        beginFall();
      } else if (cc === goalTile.x && rr === goalTile.y) {
        winLevel();
      }
    } else if (phase === "falling") {
      fallVZ += 9 * dt;
      fallZ -= fallVZ * dt;
      fallScale = Math.max(0, fallScale - dt * 1.6);
      if (fallScale <= 0.02) {
        flashFall(false);
        resetAttempt(false);
      }
    }
  }

  function beginFall() {
    phase = "falling";
    timerRunning = false;
    fallVZ = 1.2; fallZ = 0; fallScale = 1;
    Body.setVelocity(marble, { x: marble.velocity.x * 0.3, y: marble.velocity.y * 0.3 });
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
    munki.beginUncurl();
    Sound.chime();
    var b = getBest(levelIndex);
    var isBest = (b == null || levelTime < b);
    if (isBest) { setBest(levelIndex, +levelTime.toFixed(2)); }
    showBest();
    endTitle.textContent = LEVELS[levelIndex].name + " — Clear!";
    endTime.textContent = levelTime.toFixed(1);
    endTries.textContent = String(attempts);
    endBest.hidden = !isBest;
    setTimeout(function () { endScreen.hidden = false; }, 520);
  }

  function restartLevel() {
    if (phase === "menu") return;
    endScreen.hidden = true;
    flashFall(false);
    resetAttempt(false);
    attempts = Math.max(0, attempts);
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

  function tileColors(ch) {
    switch (ch) {
      case "S": return { top: "#6b4b8a", side: "#4a3360" };  // sticky/slow
      case "I": return { top: "#7fd9ff", side: "#3f93b8" };  // ice
      case "G": return { top: "#ffd76b", side: "#b8902f" };  // goal
      default:  return { top: "#3d2a63", side: "#291a47" };  // floor
    }
  }

  function drawBoard() {
    var hw = tileW / 2, hh = tileH / 2;
    // painter's order: far tiles (small x+y) first
    for (var sum = 0; sum <= cols + rows; sum++) {
      for (var r = 0; r < rows; r++) {
        var c = sum - r;
        if (c < 0 || c >= cols) continue;
        var ch = grid[r][c];
        if (isHole(ch)) continue;                 // gap: draw nothing -> void
        var cen = project(c + 0.5, r + 0.5, 0);
        var col = tileColors(ch);

        if (isWall(ch)) {
          var top = project(c + 0.5, r + 0.5, WALL_H);
          // left & right faces
          ctx.fillStyle = "#1f1338";
          ctx.beginPath();
          ctx.moveTo(cen.x - hw, cen.y);
          ctx.lineTo(cen.x, cen.y + hh);
          ctx.lineTo(top.x, top.y + hh);
          ctx.lineTo(top.x - hw, top.y);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#2c1c4d";
          ctx.beginPath();
          ctx.moveTo(cen.x + hw, cen.y);
          ctx.lineTo(cen.x, cen.y + hh);
          ctx.lineTo(top.x, top.y + hh);
          ctx.lineTo(top.x + hw, top.y);
          ctx.closePath(); ctx.fill();
          // top
          ctx.fillStyle = "#4a3270";
          diamond(top.x, top.y, hw, hh); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.07)";
          ctx.stroke();
        } else {
          diamond(cen.x, cen.y, hw, hh);
          ctx.fillStyle = col.top; ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.28)";
          ctx.lineWidth = 1; ctx.stroke();
          if (ch === "G") {
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 240);
            diamond(cen.x, cen.y, hw * 0.62, hh * 0.62);
            ctx.fillStyle = "#fff2c0"; ctx.fill();
            ctx.restore();
          }
        }
      }
    }
  }

  function drawMarble() {
    if (!marble) return;
    var z = (phase === "falling") ? fallZ : 0;
    var p = project(marble.position.x, marble.position.y, z);

    // shadow on the floor (skip while falling)
    if (phase !== "falling") {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = "#000";
      var fp = project(marble.position.x, marble.position.y, 0);
      ctx.beginPath();
      ctx.ellipse(fp.x, fp.y + tileH * 0.10, tileW * MARBLE_R * 0.95,
                  tileH * MARBLE_R * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // placeholder "curl pop" during the intro: scale 1.0 -> 0.6 w/ bounce
    var rpx = tileW * MARBLE_R;
    var scale = 1;
    if (munki.state === "CURLING") {
      var k = munki.animT;
      scale = 1 - 0.4 * k + 0.08 * Math.sin(k * Math.PI * 3) * (1 - k);
    } else if (munki.state === "UNCURLING") {
      scale = 0.6 + 0.4 * munki.animT;
    }
    if (phase === "falling") scale *= fallScale;
    var R = rpx * scale;

    if (USE_SPRITES && Sprites.ready) {
      var img = (munki.state === "ROLLED") ? Sprites.ball
                                           : Sprites.curl[munki.frameIndex()];
      ctx.save();
      ctx.translate(p.x, p.y);
      if (munki.state === "ROLLED") ctx.rotate(munki.spin * 0.5);
      ctx.drawImage(img, -R, -R, R * 2, R * 2);
      ctx.restore();
      return;
    }

    // placeholder marble: shaded sphere with a roll seam to read spin
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
    ctx.rotate(munki.spin * 0.5);
    ctx.strokeStyle = "rgba(60,25,0,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.62, R * 0.92, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    if (cols === 0) return;
    drawBoard();
    drawMarble();
  }

  // ---------------------------------------------------------------------
  // Main loop — fixed-ish step into Matter, then render
  // ---------------------------------------------------------------------
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTS) lastTS = ts;
    var dt = Math.min((ts - lastTS) / 1000, 0.05);
    lastTS = ts;

    if (phase === "intro") {
      munki.update(dt, 0);
      if (munki.state === "ROLLED") phase = "play";
    } else if (phase === "play") {
      applyControl();
      Engine.update(engine, dt * 1000);
      munki.update(dt, marble.speed);
      Sound.roll(marble.speed);
    } else if (phase === "falling") {
      Sound.roll(0);
      munki.update(dt, 0);
    } else if (phase === "won") {
      Sound.roll(0);
      munki.update(dt, 0);
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
    if (controlMode === "tilt" || controlMode === "hybrid") requestTilt();
    startScreen.hidden = true;
    loadLevel(0);
  });
  nextBtn.addEventListener("click", function () {
    endScreen.hidden = true;
    loadLevel(levelIndex + 1);
  });
  replayBtn.addEventListener("click", function () {
    endScreen.hidden = true;
    resetAttempt(true);
    attempts = 0; elAttempts.textContent = "0";
  });
  restartBtn.addEventListener("click", restartLevel);

  // first paint of the menu (board hidden behind overlay)
  requestAnimationFrame(frame);
})();

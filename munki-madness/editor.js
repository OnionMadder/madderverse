/* Munki Madness — Level Editor (Phase A: flat object-tile editor)

   DEV-ONLY. Never bundled into normal play: index.html injects this only
   behind the gate (?editor=1 or the Konami code). Quick-and-dirty — the
   designer's tool, speed over polish.

   PHASE A scope: flat levels (no elevation yet — Phase B adds height /
   ramp / spring). Emits the EXACT object-tile catalog JSON game.js loads
   so editor output is directly playable / committable into levels/:

     {
       "name": "...",
       "grid": { "w": W, "h": H },
       "target_time_ms": 30000,
       "tiles": [ { "x":.., "y":.., "type":"floor" }, ... ],   // sparse
       "physics": { ... }            // preserved if the level had one
     }

   Sparse map: a cell with no tile = a GAP (impassable — irregular / L /
   multi-island shapes). spawn & goal are tiles. Per-tile props beyond
   {type} (e.g. a future "height") are preserved on round-trip so Phase B
   data survives flat editing.

   window.MM bridge (game.js): MM.playLevel(obj,{onExit}) — test-play.
*/

(function () {
  "use strict";

  var CANVAS = 640;
  var MIN = 8, MAX = 32, DEF = 16;
  var WALL_H = 0.55;

  // Palette → tile type. `props` opens the bumper/spinner sub-selectors.
  var PALETTE = [
    { t: "floor",   label: "Floor",   fill: "#3d2a63" },
    { t: "gravel",  label: "Gravel",  fill: "#7a5733" },
    { t: "ice",     label: "Ice",     fill: "#7fd9ff" },
    { t: "wall",    label: "Wall",    fill: "#4a3270" },
    { t: "hole",    label: "Hole",    fill: "#0c0718" },
    { t: "bumper",  label: "Bumper",  fill: "#c8623c", props: "dir" },
    { t: "spinner", label: "Spinner", fill: "#3f8f86", props: "rot" },
    { t: "spawn",   label: "Spawn",   fill: "#7df0c8" },
    { t: "goal",    label: "Goal",    fill: "#ffd76b" },
    { t: "",        label: "Eraser",  fill: "#241638", eraser: true }
  ];
  var CHAR2TYPE = { "#":"wall", ".":"floor", "S":"gravel", "I":"ice",
                    "O":"hole", "@":"spawn", "G":"goal" };

  var KEY_PREFIX = "mm.editor.lvl.";
  var LEGACY_PREFIX = "mm.editor.";

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ---- LevelStorage abstraction (UGC-forward; see munki-madness/CLAUDE.md)
  // UI talks ONLY to this interface. v1.0 = localStorage; v1.5 swaps a
  // remote backend with zero UI change (every method returns a Promise).
  function LocalLevelStorage() {}
  LocalLevelStorage.prototype.save = function (rec) {
    rec.level_id = rec.level_id || uuid();
    try { localStorage.setItem(KEY_PREFIX + rec.level_id, JSON.stringify(rec)); }
    catch (e) { return Promise.reject(e); }
    return Promise.resolve(rec.level_id);
  };
  LocalLevelStorage.prototype.load = function (id) {
    var raw = null;
    try { raw = localStorage.getItem(KEY_PREFIX + id); } catch (e) {}
    return Promise.resolve(raw ? JSON.parse(raw) : null);
  };
  LocalLevelStorage.prototype.list = function () {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) {
          try {
            var o = JSON.parse(localStorage.getItem(k));
            out.push({ id: o.level_id, title: o.title || o.name || "Untitled" });
          } catch (e) {}
        } else if (k && k.indexOf(LEGACY_PREFIX) === 0 && k.indexOf(KEY_PREFIX) !== 0) {
          out.push({ id: "legacy:" + k.slice(LEGACY_PREFIX.length),
                     title: k.slice(LEGACY_PREFIX.length) + " (legacy)" });
        }
      }
    } catch (e) {}
    return Promise.resolve(out);
  };
  LocalLevelStorage.prototype.remove = function (id) {
    try { localStorage.removeItem(KEY_PREFIX + id); } catch (e) {}
    return Promise.resolve();
  };
  LocalLevelStorage.prototype.loadLegacy = function (name) {
    var raw = null;
    try { raw = localStorage.getItem(LEGACY_PREFIX + name); } catch (e) {}
    return Promise.resolve(raw ? JSON.parse(raw) : null);
  };
  var Storage = new LocalLevelStorage();

  // ------- editor state -------
  // tiles: sparse map "x,y" -> { type, ...props }. Missing = gap.
  var W = DEF, H = DEF;
  var tiles = {};
  var brush = "wall";
  var bumpDir = "E", spinRot = "CW90";
  var painting = false;
  var tileW = 36, tileH = 18, OX = 0, OY = 0;
  var levelName = "Untitled";
  var timeSec = 30;                 // exported as target_time_ms (sec*1000)
  var levelId = null, createdAt = null;
  var levelPhysics = null;          // preserved per-level "physics" block

  function key(x, y) { return x + "," + y; }
  function clampInt(v, lo, hi) {
    v = parseInt(v, 10); if (isNaN(v)) v = DEF;
    return Math.max(lo, Math.min(hi, v));
  }
  // Loading must be LOSSLESS: honor a level's real size (only cap the
  // hard MAX + a tiny sane floor). MIN=8 bounds AUTHORING (W/H inputs,
  // New), not existing levels (e.g. 01-first-roll is 8x7).
  function clampLoad(v) {
    v = parseInt(v, 10); if (isNaN(v) || v < 2) v = DEF;
    return Math.min(MAX, v);
  }

  function freshGrid(w, h) {
    tiles = {};
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var edge = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
      tiles[key(x, y)] = { type: edge ? "wall" : "floor" };
    }
    if (w >= 3 && h >= 3) {
      tiles[key(1, 1)] = { type: "spawn" };
      tiles[key(w - 2, h - 2)] = { type: "goal" };
    }
  }

  function resizeGrid(nw, nh) {
    nw = clampInt(nw, MIN, MAX); nh = clampInt(nh, MIN, MAX);
    var old = tiles, ow = W, oh = H;
    tiles = {};
    for (var y = 0; y < nh; y++) for (var x = 0; x < nw; x++) {
      if (x < ow && y < oh && old[key(x, y)]) tiles[key(x, y)] = old[key(x, y)];
      else {
        var edge = (x === 0 || y === 0 || x === nw - 1 || y === nh - 1);
        tiles[key(x, y)] = { type: edge ? "wall" : "floor" };
      }
    }
    W = nw; H = nh; fit();
  }

  // ------- iso projection (mirrors game.js exactly) -------
  function projRaw(wx, wy, wz) {
    return { x: (wx - wy) * (tileW / 2),
             y: (wx + wy) * (tileH / 2) - (wz || 0) * tileH };
  }
  function project(wx, wy, wz) {
    var p = projRaw(wx, wy, wz);
    return { x: p.x + OX, y: p.y + OY };
  }
  function fit() {
    tileW = 40; tileH = 20;
    var cs = [[0,0],[W,0],[0,H],[W,H]], mnX=1e9,mxX=-1e9,mnY=1e9,mxY=-1e9,i,p;
    for (i = 0; i < 4; i++) { p = projRaw(cs[i][0], cs[i][1], 0);
      mnX=Math.min(mnX,p.x);mxX=Math.max(mxX,p.x);mnY=Math.min(mnY,p.y);mxY=Math.max(mxY,p.y); }
    mnY -= WALL_H * tileH;
    var s = Math.min((CANVAS - 60) / (mxX - mnX), (CANVAS - 60) / (mxY - mnY));
    tileW *= s; tileH *= s;
    mnX=1e9;mxX=-1e9;mnY=1e9;mxY=-1e9;
    for (i = 0; i < 4; i++) { p = projRaw(cs[i][0], cs[i][1], 0);
      mnX=Math.min(mnX,p.x);mxX=Math.max(mxX,p.x);mnY=Math.min(mnY,p.y);mxY=Math.max(mxY,p.y); }
    mnY -= WALL_H * tileH;
    OX = CANVAS/2 - (mnX+mxX)/2;
    OY = CANVAS/2 - (mnY+mxY)/2;
  }
  function pick(sx, sy) {
    var a = (sx - OX) / (tileW / 2);
    var b = (sy - OY) / (tileH / 2);
    return { c: Math.floor((a + b) / 2), r: Math.floor((b - a) / 2) };
  }

  // ------- DOM -------
  var root, cv, cx, statusEl, nameInp, wInp, hInp, timeInp, fileInp,
      dirSel, rotSel;

  function injectStyle() {
    var st = document.createElement("style");
    st.textContent =
      "#mmed{position:fixed;inset:0;z-index:9999;background:#0e0720;color:#f3ecff;" +
      "font:13px 'Trebuchet MS',system-ui,sans-serif;display:flex;flex-direction:column}" +
      "#mmed .bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;background:#170d2c;border-bottom:1px solid #2c1c4d}" +
      "#mmed .bar input,#mmed .bar select{background:#241638;color:#fff;border:1px solid #3a2a5c;border-radius:5px;padding:5px 7px;font:inherit}" +
      "#mmed .bar input.nm{width:140px}#mmed .bar input.num{width:52px}" +
      "#mmed button{background:#3c2464;color:#f3ecff;border:1px solid #5a3286;border-radius:6px;padding:6px 11px;font:inherit;cursor:pointer}" +
      "#mmed button:hover{background:#52328a}#mmed button.warn{background:#7a2f2f;border-color:#a14a4a}" +
      "#mmed .body{flex:1;display:flex;min-height:0}" +
      "#mmed .pal{display:flex;flex-direction:column;gap:4px;padding:8px;background:#140b26;overflow:auto}" +
      "#mmed .sw{display:flex;align-items:center;gap:7px;padding:6px 9px;border:2px solid transparent;border-radius:6px;cursor:pointer;white-space:nowrap}" +
      "#mmed .sw:hover{background:#1f1336}#mmed .sw.on{border-color:#ffd76b;background:#1f1336}" +
      "#mmed .chip{width:18px;height:18px;border-radius:4px;border:1px solid rgba(255,255,255,.25)}" +
      "#mmed .cvwrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto}" +
      "#mmed canvas{background:radial-gradient(circle at 50% 35%,#2c1a4d,#150b26);border-radius:10px;touch-action:none}" +
      "#mmed .status{padding:7px 10px;background:#170d2c;border-top:1px solid #2c1c4d;min-height:20px}" +
      "#mmed .status.bad{color:#ff9a9a}#mmed .status.ok{color:#7df0c8}";
    document.head.appendChild(st);
  }
  function btn(label, fn, cls) {
    var b = document.createElement("button");
    b.textContent = label; if (cls) b.className = cls;
    b.addEventListener("click", fn);
    return b;
  }
  function label(t) {
    var s = document.createElement("span");
    s.textContent = t; s.style.opacity = ".7"; return s;
  }
  function mkSelect(opts, val, onCh) {
    var s = document.createElement("select");
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o; op.textContent = o; s.appendChild(op);
    });
    s.value = val;
    s.addEventListener("change", function () { onCh(s.value); });
    return s;
  }

  function build() {
    injectStyle();
    root = document.createElement("div"); root.id = "mmed";

    var bar = document.createElement("div"); bar.className = "bar";
    nameInp = document.createElement("input"); nameInp.className = "nm";
    nameInp.value = levelName; nameInp.title = "Level name";
    nameInp.addEventListener("input", function () { levelName = nameInp.value || "Untitled"; });
    wInp = document.createElement("input"); wInp.className = "num"; wInp.type = "number";
    wInp.value = W; wInp.min = MIN; wInp.max = MAX; wInp.title = "Width 8-32";
    hInp = document.createElement("input"); hInp.className = "num"; hInp.type = "number";
    hInp.value = H; hInp.min = MIN; hInp.max = MAX; hInp.title = "Height 8-32";
    timeInp = document.createElement("input"); timeInp.className = "num"; timeInp.type = "number";
    timeInp.value = timeSec; timeInp.min = 5; timeInp.max = 999; timeInp.title = "3-star target (seconds)";
    timeInp.addEventListener("change", function () { timeSec = clampInt(timeInp.value, 5, 999); timeInp.value = timeSec; });
    function applySize() { resizeGrid(wInp.value, hInp.value); wInp.value = W; hInp.value = H; draw(); }
    wInp.addEventListener("change", applySize);
    hInp.addEventListener("change", applySize);
    dirSel = mkSelect(["N", "E", "S", "W"], bumpDir, function (v) { bumpDir = v; });
    dirSel.title = "Bumper push direction";
    rotSel = mkSelect(["CW90", "CCW90"], spinRot, function (v) { spinRot = v; });
    rotSel.title = "Spinner rotation";

    bar.appendChild(label("Name")); bar.appendChild(nameInp);
    bar.appendChild(label("W")); bar.appendChild(wInp);
    bar.appendChild(label("H")); bar.appendChild(hInp);
    bar.appendChild(label("sec")); bar.appendChild(timeInp);
    bar.appendChild(label("Bmp")); bar.appendChild(dirSel);
    bar.appendChild(label("Spn")); bar.appendChild(rotSel);
    bar.appendChild(btn("New", onNew));
    bar.appendChild(btn("Save", onSave));
    bar.appendChild(btn("Load", onLoad));
    bar.appendChild(btn("Export", onExportFile));
    bar.appendChild(btn("Import", onImportFile));
    bar.appendChild(btn("Copy JSON", onCopyJSON));
    bar.appendChild(btn("Validate", function () { report(validate(), true); }));
    bar.appendChild(btn("Test Play", onTest));
    bar.appendChild(btn("Close", onClose, "warn"));

    fileInp = document.createElement("input");
    fileInp.type = "file"; fileInp.accept = ".json,application/json";
    fileInp.style.display = "none";
    fileInp.addEventListener("change", handleImport);
    bar.appendChild(fileInp);

    var body = document.createElement("div"); body.className = "body";
    var pal = document.createElement("div"); pal.className = "pal";
    PALETTE.forEach(function (p) {
      var sw = document.createElement("div");
      sw.className = "sw" + (p.t === brush && !p.eraser ? " on" : "");
      var chip = document.createElement("div"); chip.className = "chip";
      chip.style.background = p.fill;
      var txt = document.createElement("span"); txt.textContent = p.label;
      sw.appendChild(chip); sw.appendChild(txt);
      sw.addEventListener("click", function () {
        brush = p.eraser ? "" : p.t;
        [].forEach.call(pal.querySelectorAll(".sw"), function (e) { e.classList.remove("on"); });
        sw.classList.add("on");
      });
      pal.appendChild(sw);
    });

    var cvwrap = document.createElement("div"); cvwrap.className = "cvwrap";
    cv = document.createElement("canvas"); cv.width = CANVAS; cv.height = CANVAS;
    cv.style.width = "min(76vw,76vh)"; cv.style.height = "min(76vw,76vh)";
    cx = cv.getContext("2d");
    cvwrap.appendChild(cv);
    body.appendChild(pal); body.appendChild(cvwrap);

    statusEl = document.createElement("div"); statusEl.className = "status";
    statusEl.textContent = "Phase A — flat editor. Paint tiles; Eraser makes a GAP (impassable). Spawn is unique.";

    root.appendChild(bar); root.appendChild(body); root.appendChild(statusEl);
    document.body.appendChild(root);
    bindCanvas();
    fit(); draw();
  }

  // ------- painting -------
  function evtCell(ev) {
    var rect = cv.getBoundingClientRect();
    var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    var sx = (t.clientX - rect.left) * (CANVAS / rect.width);
    var sy = (t.clientY - rect.top) * (CANVAS / rect.height);
    return pick(sx, sy);
  }
  function paintAt(cell) {
    if (cell.r < 0 || cell.r >= H || cell.c < 0 || cell.c >= W) return;
    var k = key(cell.c, cell.r);
    if (brush === "") { delete tiles[k]; draw(); return; }      // eraser = gap
    if (brush === "spawn") {                                     // unique
      for (var kk in tiles) if (tiles[kk].type === "spawn") delete tiles[kk];
    }
    var cell2 = { type: brush };
    if (brush === "bumper") cell2.direction = bumpDir;
    if (brush === "spinner") cell2.rotation = spinRot;
    tiles[k] = cell2;
    draw();
  }
  function bindCanvas() {
    cv.addEventListener("mousedown", function (e) { painting = true; paintAt(evtCell(e)); });
    window.addEventListener("mousemove", function (e) { if (painting) paintAt(evtCell(e)); });
    window.addEventListener("mouseup", function () { painting = false; });
    cv.addEventListener("touchstart", function (e) { painting = true; paintAt(evtCell(e)); e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchmove", function (e) { if (painting) paintAt(evtCell(e)); e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchend", function () { painting = false; });
  }

  // ------- WYSIWYG render (mirrors game.js drawBoard flat tiles) -------
  function diamond(x, y, hw, hh) {
    cx.beginPath(); cx.moveTo(x, y - hh); cx.lineTo(x + hw, y);
    cx.lineTo(x, y + hh); cx.lineTo(x - hw, y); cx.closePath();
  }
  function tileColor(t) {
    switch (t) {
      case "gravel":  return "#7a5733";
      case "ice":     return "#7fd9ff";
      case "goal":    return "#ffd76b";
      case "bumper":  return "#c8623c";
      case "spinner": return "#3f8f86";
      default:        return "#3d2a63";   // floor / spawn
    }
  }
  function dirVec(d) {
    return d === "N" ? { x:0,y:-1 } : d === "S" ? { x:0,y:1 } :
           d === "W" ? { x:-1,y:0 } : { x:1,y:0 };
  }
  function drawArrow(c, r, cen, dn) {
    var v = dirVec(dn);
    var tp = project(c + 0.5 + v.x * 0.4, c === c ? r + 0.5 + v.y * 0.4 : 0, 0);
    var ang = Math.atan2(tp.y - cen.y, tp.x - cen.x), L = tileW * 0.22;
    cx.save(); cx.translate(cen.x, cen.y); cx.rotate(ang);
    cx.fillStyle = "#fff1dd"; cx.beginPath();
    cx.moveTo(L, 0); cx.lineTo(-L * 0.5, L * 0.45);
    cx.lineTo(-L * 0.2, 0); cx.lineTo(-L * 0.5, -L * 0.45);
    cx.closePath(); cx.fill(); cx.restore();
  }
  function draw() {
    cx.clearRect(0, 0, CANVAS, CANVAS);
    var hw = tileW / 2, hh = tileH / 2;
    for (var sum = 0; sum <= W + H; sum++) {
      for (var r = 0; r < H; r++) {
        var c = sum - r; if (c < 0 || c >= W) continue;
        var cell = tiles[key(c, r)];
        if (!cell) continue;                       // gap → void
        var ty = cell.type, cen = project(c + 0.5, r + 0.5, 0);

        if (ty === "wall") {
          var top = project(c + 0.5, r + 0.5, WALL_H);
          cx.fillStyle = "#1f1338";
          cx.beginPath(); cx.moveTo(cen.x-hw,cen.y); cx.lineTo(cen.x,cen.y+hh);
          cx.lineTo(top.x,top.y+hh); cx.lineTo(top.x-hw,top.y); cx.closePath(); cx.fill();
          cx.fillStyle = "#2c1c4d";
          cx.beginPath(); cx.moveTo(cen.x+hw,cen.y); cx.lineTo(cen.x,cen.y+hh);
          cx.lineTo(top.x,top.y+hh); cx.lineTo(top.x+hw,top.y); cx.closePath(); cx.fill();
          cx.fillStyle = "#4a3270"; diamond(top.x, top.y, hw, hh); cx.fill();
          cx.strokeStyle = "rgba(255,255,255,.08)"; cx.stroke();
          continue;
        }
        if (ty === "hole") {
          diamond(cen.x, cen.y, hw, hh); cx.fillStyle = "#150b25"; cx.fill();
          cx.save(); diamond(cen.x, cen.y + hh*0.16, hw*0.66, hh*0.66);
          cx.fillStyle = "#05030a"; cx.fill(); cx.restore();
          diamond(cen.x, cen.y, hw, hh);
          cx.strokeStyle = "rgba(0,0,0,.65)"; cx.lineWidth = 2; cx.stroke();
          continue;
        }
        diamond(cen.x, cen.y, hw, hh);
        cx.fillStyle = tileColor(ty); cx.fill();
        cx.strokeStyle = "rgba(0,0,0,.28)"; cx.lineWidth = 1; cx.stroke();

        if (ty === "gravel") {
          cx.save(); cx.fillStyle = "rgba(0,0,0,.28)";
          for (var k = 0; k < 7; k++) {
            var a = ((c*13 + r*29 + k*47) % 100) / 100, b = ((c*7 + r*17 + k*31) % 100) / 100;
            cx.beginPath(); cx.arc(cen.x + (a-0.5)*hw, cen.y + (b-0.5)*hh, 1.4, 0, 6.28); cx.fill();
          }
          cx.restore();
        } else if (ty === "ice") {
          cx.save(); cx.globalAlpha = 0.30;
          diamond(cen.x, cen.y, hw*0.6, hh*0.6); cx.fillStyle = "#e7faff"; cx.fill();
          cx.restore();
        } else if (ty === "goal") {
          cx.save(); cx.globalAlpha = 0.5;
          diamond(cen.x, cen.y, hw*0.62, hh*0.62); cx.fillStyle = "#fff2c0"; cx.fill();
          cx.restore();
        } else if (ty === "bumper") {
          drawArrow(c, r, cen, cell.direction || "E");
        } else if (ty === "spinner") {
          cx.save(); cx.translate(cen.x, cen.y);
          cx.strokeStyle = "#cdf3ee"; cx.lineWidth = 2.4;
          var d0 = (cell.rotation === "CCW90") ? -1 : 1;
          cx.beginPath(); cx.arc(0, 0, tileW*0.20, 0, Math.PI*1.4*d0, d0 < 0); cx.stroke();
          cx.restore();
        }
        if (ty === "spawn" || ty === "goal") {
          cx.fillStyle = "rgba(0,0,0,.6)";
          cx.font = "bold " + Math.max(10, tileH*0.7) + "px sans-serif";
          cx.textAlign = "center"; cx.textBaseline = "middle";
          cx.fillText(ty === "spawn" ? "S" : "G", cen.x, cen.y);
        }
      }
    }
  }

  // ------- level <-> object-tile catalog JSON -------
  // toLevel(): the EXACT shape game.js loads + harmless storage metadata.
  function toLevel() {
    var arr = [];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var cell = tiles[key(x, y)];
      if (!cell) continue;                         // gap → omit (sparse)
      var o = { x: x, y: y, type: cell.type };
      for (var p in cell) if (p !== "type") o[p] = cell[p];   // keep height etc.
      arr.push(o);
    }
    var lvl = {
      name: levelName || "Untitled",
      grid: { w: W, h: H },
      target_time_ms: timeSec * 1000,
      tiles: arr
    };
    if (levelPhysics) lvl.physics = levelPhysics;   // preserve per-level tune
    return lvl;
  }
  function storageRecord() {
    var now = new Date().toISOString();
    if (!createdAt) createdAt = now;
    if (!levelId) levelId = uuid();
    var rec = toLevel();
    rec.level_id = levelId; rec.title = rec.name;
    rec.created_at = createdAt; rec.updated_at = now;
    return rec;
  }
  // Accepts object-tile (current), char-rows (repo readable / legacy), or
  // the old portable schema. Per-tile props (height, …) are preserved.
  function fromLevel(o) {
    o = o || {};
    var grid = o.grid || o.grid_dimensions || {};
    levelPhysics = (o.physics && typeof o.physics === "object") ? o.physics : null;
    levelName = o.name || o.title || "Untitled";
    timeSec = o.target_time_ms ? Math.round(o.target_time_ms / 1000)
              : (o.time || 30);
    levelId = o.level_id || null;
    createdAt = o.created_at || null;

    var src = o.tiles || o.rows || [];
    var objectTiles = Array.isArray(src) && src.length && typeof src[0] === "object";
    if (objectTiles) {
      W = clampLoad(grid.w || 0);
      H = clampLoad(grid.h || 0);
      if (!grid.w || !grid.h) {           // derive from extents if absent
        var mx = 0, my = 0;
        src.forEach(function (t) { mx = Math.max(mx, t.x); my = Math.max(my, t.y); });
        W = clampLoad(mx + 1); H = clampLoad(my + 1);
      }
      tiles = {};
      if (o.fill) for (var y = 0; y < H; y++) for (var x = 0; x < W; x++)
        tiles[key(x, y)] = { type: o.fill };
      src.forEach(function (t) {
        if (t.x == null || t.y == null) return;
        var cell = { type: t.type };
        for (var p in t) if (p !== "x" && p !== "y" && p !== "type") cell[p] = t[p];
        tiles[key(t.x, t.y)] = cell;
      });
    } else {                              // char rows
      var rows = src;
      H = clampLoad(rows.length || DEF);
      W = clampLoad((rows[0] || "").length || DEF);
      tiles = {};
      for (var ry = 0; ry < H; ry++) {
        var rowStr = rows[ry] || "";
        for (var rx = 0; rx < W; rx++) {
          var ch = rowStr[rx];
          if (ch == null || ch === " ") continue;          // gap
          tiles[key(rx, ry)] = { type: CHAR2TYPE[ch] || "floor" };
        }
      }
    }
    if (nameInp) nameInp.value = levelName;
    if (wInp) wInp.value = W;
    if (hInp) hInp.value = H;
    if (timeInp) timeInp.value = timeSec;
    fit(); draw();
  }

  // ------- validation: 1 spawn, >=1 goal, flat reachability -------
  function validate() {
    var spawn = null, goals = 0, k, c;
    for (k in tiles) {
      if (tiles[k].type === "spawn") {
        if (spawn) return { ok:false, msg:"More than one spawn — keep exactly one." };
        c = k.split(","); spawn = { x:+c[0], y:+c[1] };
      }
      if (tiles[k].type === "goal") goals++;
    }
    if (!spawn) return { ok:false, msg:"No spawn — add exactly one." };
    if (!goals) return { ok:false, msg:"No goal — add at least one." };
    // BFS over passable tiles: exists, not wall, not hole (hole = death).
    var seen = {}, q = [spawn], reached = false;
    seen[spawn.x + "," + spawn.y] = 1;
    while (q.length) {
      var n = q.shift(), t0 = tiles[key(n.x, n.y)];
      if (t0 && t0.type === "goal") { reached = true; break; }
      var nb = [[1,0],[-1,0],[0,1],[0,-1]];
      for (var i = 0; i < 4; i++) {
        var nx = n.x + nb[i][0], ny = n.y + nb[i][1], kk = nx + "," + ny;
        if (seen[kk]) continue;
        var t = tiles[kk];
        if (!t || t.type === "wall" || t.type === "hole") continue;
        seen[kk] = 1; q.push({ x:nx, y:ny });
      }
    }
    if (!reached) return { ok:false, msg:"Goal not reachable from spawn (walls / holes / gaps block every path)." };
    var n2 = Object.keys(tiles).length;
    return { ok:true, msg:"Valid: spawn + " + goals + " goal(s), reachable. " + n2 + " tiles, " + W + "x" + H + "." };
  }
  function report(v, force) {
    statusEl.className = "status " + (v.ok ? "ok" : "bad");
    statusEl.textContent = (v.ok ? "OK — " : "WARNING — ") + v.msg;
    return v.ok || !force;
  }

  // ------- actions -------
  function slug() {
    return (levelName || "untitled").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  }
  function onNew() {
    if (!confirm("Discard current level and start fresh?")) return;
    W = DEF; H = DEF; freshGrid(W, H);
    levelName = "Untitled"; timeSec = 30;
    levelId = null; createdAt = null; levelPhysics = null;
    nameInp.value = levelName; wInp.value = W; hInp.value = H; timeInp.value = timeSec;
    fit(); draw();
    report({ ok:true, msg:"New " + W + "x" + H + " level." });
  }
  function onSave() {
    var v = validate();
    if (!v.ok && !confirm("Not valid:\n\n" + v.msg + "\n\nSave anyway?")) { report(v); return; }
    var rec = storageRecord();
    Storage.save(rec).then(function (id) {
      levelId = id;
      report({ ok:true, msg:'Saved "' + rec.name + '" (' + String(id).slice(0,8) + '…). Export to commit into levels/.' });
    }, function (e) { report({ ok:false, msg:"Save failed: " + e }); });
  }
  function levelJSON() { return JSON.stringify(toLevel(), null, 2); }
  function onCopyJSON() {
    var v = validate(); if (!v.ok) report(v);
    var j = levelJSON();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(j).then(
        function () { report({ ok:true, msg:"Catalog JSON copied — paste into a munki-madness/levels/*.json." }); },
        function () { window.prompt("Copy this level JSON:", j); });
    } else { window.prompt("Copy this level JSON:", j); }
  }
  function onExportFile() {
    var v = validate(); if (!v.ok) report(v);
    var blob = new Blob([levelJSON()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = slug() + ".json";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    report({ ok:true, msg:"Exported " + slug() + ".json (catalog form — drop into munki-madness/levels/ + add to index.json)." });
  }
  function onImportFile() { if (fileInp) { fileInp.value = ""; fileInp.click(); } }
  function handleImport(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try { var o = JSON.parse(rd.result); fromLevel(o); levelId = o.level_id || null;
        report({ ok:true, msg:'Imported "' + (o.name || o.title || f.name) + '".' }); }
      catch (e) { report({ ok:false, msg:"Import failed — not valid level JSON (" + e + ")" }); }
    };
    rd.readAsText(f);
  }
  function onLoad() {
    // bundled catalog (fetched live so it's never a stale bridge) + saves
    fetch("levels/index.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : { levels: [] }; })
      .catch(function () { return { levels: [] }; })
      .then(function (idx) {
        var bundled = (idx && idx.levels) || [];
        Storage.list().then(function (saved) {
          var menu = [];
          bundled.forEach(function (f, i) { menu.push("B" + i + " : [catalog] " + f); });
          saved.forEach(function (s, i) { menu.push("S" + i + " : [saved] " + s.title); });
          if (!menu.length) { report({ ok:false, msg:"Nothing to load — design one or Import." }); return; }
          var p = window.prompt("Load which? Enter its code:\n\n" + menu.join("\n"));
          if (!p) return;
          p = p.trim();
          if (p[0] === "B") {
            var f = bundled[+p.slice(1)]; if (!f) return;
            fetch("levels/" + f, { cache: "no-store" }).then(function (r) { return r.json(); })
              .then(function (o) { fromLevel(o); levelId = null;
                report({ ok:true, msg:"Loaded catalog: " + f + " (Save makes a local copy)." }); })
              .catch(function (e) { report({ ok:false, msg:"Fetch failed: " + e }); });
          } else if (p[0] === "S") {
            var s = saved[+p.slice(1)]; if (!s) return;
            var ld = String(s.id).indexOf("legacy:") === 0
              ? Storage.loadLegacy(s.id.slice(7)) : Storage.load(s.id);
            ld.then(function (o) {
              if (o) { fromLevel(o); report({ ok:true, msg:"Loaded: " + s.title }); }
              else report({ ok:false, msg:"Could not load that entry." });
            });
          }
        });
      });
  }
  function onTest() {
    var v = validate();
    if (!v.ok && !confirm("Not valid:\n\n" + v.msg + "\n\nTest anyway?")) { report(v); return; }
    if (!(window.MM && window.MM.playLevel)) { report({ ok:false, msg:"Game bridge (window.MM) not ready." }); return; }
    root.style.display = "none";
    window.MM.playLevel(toLevel(), { onExit: function () { root.style.display = "flex"; draw(); } });
  }
  function onClose() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    try {
      var u = new URL(location.href);
      u.searchParams.delete("editor");
      history.replaceState(null, "", u.toString());
    } catch (e) {}
  }

  // ------- boot (wait for window.MM from game.js) -------
  function boot() {
    if (!window.MM) { setTimeout(boot, 60); return; }
    var ss = document.getElementById("startScreen");
    if (ss) ss.hidden = true;
    freshGrid(W, H);
    build();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();

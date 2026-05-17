/* Munki Madness — Level Editor (Chunk 3)

   DEV-ONLY tool, not a player feature. It is never bundled into normal
   play: index.html only injects this file behind the gate (?editor=1 or
   the Konami code). It is intentionally quick-and-dirty — it is the
   designer's tool, so it favors speed over polish.

   Shares the gameplay tile alphabet and level schema exactly, so editor
   output is directly playable with zero conversion:
     #  wall   .  floor   S  slow/sticky   I  ice
     O  hole   @  spawn   G  goal
   Level JSON:  { "name", "time", "rows": [ "..." ] }

   Bridges into the game via window.MM (defined at the end of game.js):
     MM.getBundledLevels()  -> the levels/*.json catalog
     MM.playLevel(obj,{onExit})  -> drop into a playable test, returns here
*/

(function () {
  "use strict";

  var CANVAS = 640;
  var MIN = 8, MAX = 32, DEF = 16;
  var WALL_H = 0.55;

  // Palette: code -> { label, swatch fill }. Extend by adding an entry.
  var PALETTE = [
    { code: ".", label: "Floor",  fill: "#3d2a63" },
    { code: "I", label: "Ice",    fill: "#7fd9ff" },
    { code: "S", label: "Gravel", fill: "#6b4b8a" },
    { code: "O", label: "Hole",   fill: "#0c0718" },
    { code: "G", label: "Goal",   fill: "#ffd76b" },
    { code: "@", label: "Spawn",  fill: "#7df0c8" },
    { code: "#", label: "Wall",   fill: "#4a3270" },
    { code: ".", label: "Eraser", fill: "#241638", eraser: true }
  ];

  // id-keyed prefix (v1.0). Old chunk-3 name-keyed prefix still read on
  // Load so nothing saved before this refactor is lost.
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
  // The editor UI ONLY talks to this interface. v1.0 binds the local
  // (localStorage) backend below. v1.5 will bind a remote backend hitting
  // api.onionmadder.rocks/munki-madness/levels/... — every method already
  // returns a Promise so swapping the backend needs ZERO editor-UI change.
  function LocalLevelStorage() {}
  LocalLevelStorage.prototype.save = function (level) {
    level.level_id = level.level_id || uuid();
    try { localStorage.setItem(KEY_PREFIX + level.level_id, JSON.stringify(level)); }
    catch (e) { return Promise.reject(e); }
    return Promise.resolve(level.level_id);
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
            out.push({ id: o.level_id, title: o.title || "Untitled", updated_at: o.updated_at || "" });
          } catch (e) {}
        } else if (k && k.indexOf(LEGACY_PREFIX) === 0 && k.indexOf(KEY_PREFIX) !== 0) {
          out.push({ id: "legacy:" + k.slice(LEGACY_PREFIX.length),
                     title: k.slice(LEGACY_PREFIX.length) + " (legacy)", updated_at: "" });
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

  // v1.0 binding. v1.5:  Storage = new RemoteLevelStorage(API_BASE);
  var Storage = new LocalLevelStorage();

  // ------- editor state -------
  var W = DEF, H = DEF;
  var cells = makeGrid(W, H);
  var brush = "#";
  var painting = false;
  var tileW = 36, tileH = 18, OX = 0, OY = 0;
  var levelName = "Untitled";
  var levelTimeBudget = 60;
  var levelId = null;          // uuid; minted on first save, then preserved
  var levelAuthor = "ME";      // v1.5 populates from the user's creator handle
  var createdAt = null;        // ISO; set on first save, then preserved
  var creatorNotes = "";
  var levelStats = defaultStats();

  function defaultStats() {
    return { plays: 0, attempts_per_play: [], completions: 0, best_time_ms: null };
  }

  function makeGrid(w, h) {
    // fresh grid: wall border, floor interior, default spawn + goal so a
    // brand-new level already passes validation.
    var g = [];
    for (var r = 0; r < h; r++) {
      var row = [];
      for (var c = 0; c < w; c++) {
        row.push((r === 0 || c === 0 || r === h - 1 || c === w - 1) ? "#" : ".");
      }
      g.push(row);
    }
    if (h >= 3 && w >= 3) { g[1][1] = "@"; g[h - 2][w - 2] = "G"; }
    return g;
  }

  function resizeGrid(nw, nh) {
    nw = clampInt(nw, MIN, MAX); nh = clampInt(nh, MIN, MAX);
    var g = [];
    for (var r = 0; r < nh; r++) {
      var row = [];
      for (var c = 0; c < nw; c++) {
        if (r < cells.length && c < cells[0].length) row.push(cells[r][c]);
        else row.push((r === 0 || c === 0 || r === nh - 1 || c === nw - 1) ? "#" : ".");
      }
      g.push(row);
    }
    W = nw; H = nh; cells = g;
    fit();
  }

  function clampInt(v, lo, hi) {
    v = parseInt(v, 10); if (isNaN(v)) v = DEF;
    return Math.max(lo, Math.min(hi, v));
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
    var cs = [[0,0],[W,0],[0,H],[W,H]], mnX=1e9,mxX=-1e9,mnY=1e9,mxY=-1e9, i, p;
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
  // screen px (canvas space) -> tile col/row
  function pick(sx, sy) {
    var a = (sx - OX) / (tileW / 2);
    var b = (sy - OY) / (tileH / 2);
    var wx = (a + b) / 2, wy = (b - a) / 2;
    return { c: Math.floor(wx), r: Math.floor(wy) };
  }

  // ------- DOM -------
  var root, cv, cx, statusEl, nameInp, wInp, hInp, fileInp;

  function injectStyle() {
    var st = document.createElement("style");
    st.textContent =
      "#mmed{position:fixed;inset:0;z-index:9999;background:#0e0720;color:#f3ecff;" +
      "font:13px 'Trebuchet MS',system-ui,sans-serif;display:flex;flex-direction:column}" +
      "#mmed .bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;background:#170d2c;border-bottom:1px solid #2c1c4d}" +
      "#mmed .bar input{background:#241638;color:#fff;border:1px solid #3a2a5c;border-radius:5px;padding:5px 7px;font:inherit}" +
      "#mmed .bar input.nm{width:150px}#mmed .bar input.num{width:54px}" +
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

  function build() {
    injectStyle();
    root = document.createElement("div"); root.id = "mmed";

    var bar = document.createElement("div"); bar.className = "bar";
    nameInp = document.createElement("input"); nameInp.className = "nm";
    nameInp.value = levelName; nameInp.title = "Level name";
    nameInp.addEventListener("input", function () { levelName = nameInp.value || "Untitled"; });
    wInp = document.createElement("input"); wInp.className = "num"; wInp.type = "number";
    wInp.value = W; wInp.min = MIN; wInp.max = MAX; wInp.title = "Width (8-32)";
    hInp = document.createElement("input"); hInp.className = "num"; hInp.type = "number";
    hInp.value = H; hInp.min = MIN; hInp.max = MAX; hInp.title = "Height (8-32)";
    function applySize() { resizeGrid(wInp.value, hInp.value); wInp.value = W; hInp.value = H; draw(); }
    wInp.addEventListener("change", applySize);
    hInp.addEventListener("change", applySize);

    bar.appendChild(label("Name")); bar.appendChild(nameInp);
    bar.appendChild(label("W")); bar.appendChild(wInp);
    bar.appendChild(label("H")); bar.appendChild(hInp);
    bar.appendChild(btn("New", onNew));
    bar.appendChild(btn("Save", onSave));
    bar.appendChild(btn("Load", onLoad));
    bar.appendChild(btn("Export File", onExportFile));
    bar.appendChild(btn("Import File", onImportFile));
    bar.appendChild(btn("Copy JSON", onCopyJSON));
    bar.appendChild(btn("Validate", function () { report(validate(), true); }));
    bar.appendChild(btn("Test Play", onTest));
    bar.appendChild(btn("Close", onClose, "warn"));

    fileInp = document.createElement("input");
    fileInp.type = "file";
    fileInp.accept = ".json,application/json";
    fileInp.style.display = "none";
    fileInp.addEventListener("change", handleImport);
    bar.appendChild(fileInp);

    var body = document.createElement("div"); body.className = "body";
    var pal = document.createElement("div"); pal.className = "pal";
    PALETTE.forEach(function (p, idx) {
      var sw = document.createElement("div");
      sw.className = "sw" + ((!p.eraser && p.code === brush) ? " on" : "");
      sw.dataset.idx = idx;
      var chip = document.createElement("div"); chip.className = "chip";
      chip.style.background = p.fill;
      var txt = document.createElement("span"); txt.textContent = p.label + "  (" + (p.eraser ? "erase" : p.code) + ")";
      sw.appendChild(chip); sw.appendChild(txt);
      sw.addEventListener("click", function () {
        brush = p.code;
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
    statusEl.textContent = "Paint with the palette. Spawn (@) is unique; multiple goals (G) allowed.";

    root.appendChild(bar); root.appendChild(body); root.appendChild(statusEl);
    document.body.appendChild(root);

    bindCanvas();
    fit(); draw();
  }

  function label(t) { var s = document.createElement("span"); s.textContent = t; s.style.opacity = ".7"; return s; }

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
    if (brush === "@") {
      for (var r = 0; r < H; r++) for (var c = 0; c < W; c++)
        if (cells[r][c] === "@") cells[r][c] = ".";
    }
    cells[cell.r][cell.c] = brush;
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

  // ------- rendering (matches gameplay look) -------
  function diamond(g, x, y, hw, hh) {
    g.beginPath(); g.moveTo(x, y - hh); g.lineTo(x + hw, y);
    g.lineTo(x, y + hh); g.lineTo(x - hw, y); g.closePath();
  }
  function colFor(ch) {
    switch (ch) {
      case "S": return "#6b4b8a"; case "I": return "#7fd9ff";
      case "G": return "#ffd76b"; case "@": return "#7df0c8";
      default: return "#3d2a63";
    }
  }
  function draw() {
    cx.clearRect(0, 0, CANVAS, CANVAS);
    var hw = tileW / 2, hh = tileH / 2;
    for (var sum = 0; sum <= W + H; sum++) {
      for (var r = 0; r < H; r++) {
        var c = sum - r; if (c < 0 || c >= W) continue;
        var ch = cells[r][c];
        var cen = project(c + 0.5, r + 0.5, 0);
        if (ch === "O") {
          cx.save(); cx.globalAlpha = .55; cx.fillStyle = "#000";
          diamond(cx, cen.x, cen.y, hw, hh); cx.fill(); cx.restore();
          cx.strokeStyle = "rgba(255,255,255,.10)";
          diamond(cx, cen.x, cen.y, hw, hh); cx.stroke();
          continue;
        }
        if (ch === "#") {
          var top = project(c + 0.5, r + 0.5, WALL_H);
          cx.fillStyle = "#1f1338";
          cx.beginPath(); cx.moveTo(cen.x-hw,cen.y); cx.lineTo(cen.x,cen.y+hh);
          cx.lineTo(top.x,top.y+hh); cx.lineTo(top.x-hw,top.y); cx.closePath(); cx.fill();
          cx.fillStyle = "#2c1c4d";
          cx.beginPath(); cx.moveTo(cen.x+hw,cen.y); cx.lineTo(cen.x,cen.y+hh);
          cx.lineTo(top.x,top.y+hh); cx.lineTo(top.x+hw,top.y); cx.closePath(); cx.fill();
          cx.fillStyle = "#4a3270"; diamond(cx, top.x, top.y, hw, hh); cx.fill();
          cx.strokeStyle = "rgba(255,255,255,.08)"; cx.stroke();
          continue;
        }
        diamond(cx, cen.x, cen.y, hw, hh);
        cx.fillStyle = colFor(ch); cx.fill();
        cx.strokeStyle = "rgba(0,0,0,.28)"; cx.lineWidth = 1; cx.stroke();
        if (ch === "@" || ch === "G") {
          cx.fillStyle = "rgba(0,0,0,.55)";
          cx.font = "bold " + Math.max(10, tileH * 0.7) + "px sans-serif";
          cx.textAlign = "center"; cx.textBaseline = "middle";
          cx.fillText(ch, cen.x, cen.y);
        }
      }
    }
  }

  // ------- level <-> portable JSON (schema_version 1) -------
  // Self-contained & portable by design: every UGC field is present in
  // v1.0 even though only some have UI yet, so v1.5 populates them with
  // NO schema migration. `tiles` stays an array of row strings (the
  // readable form the repo catalog also uses). The game engine reads
  // `tiles`/`title`/`time` via game.js normalizeLevel.
  function toLevel() {
    var rows = cells.map(function (row) { return row.join(""); });
    var sp = null, goals = [];
    for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) {
      if (cells[r][c] === "@") sp = { x: c, y: r };
      if (cells[r][c] === "G") goals.push({ x: c, y: r });
    }
    var now = new Date().toISOString();
    if (!createdAt) createdAt = now;
    if (!levelId) levelId = uuid();
    return {
      schema_version: 1,
      level_id: levelId,
      title: levelName || "Untitled",
      author: levelAuthor,                 // "ME" in v1.0
      created_at: createdAt,
      updated_at: now,
      grid_dimensions: { w: W, h: H },
      tiles: rows,
      spawn: sp,
      goals: goals,
      metadata: { tags: [], estimated_difficulty: null, creator_notes: creatorNotes || "" },
      stats: levelStats || defaultStats(),
      time: levelTimeBudget                // engine time budget (extra top-level)
    };
  }
  // Accepts portable schema OR the legacy { name, time, rows|grid } form.
  function fromLevel(o) {
    o = o || {};
    var rows = o.tiles || o.rows || o.grid || [];
    H = clampInt(rows.length || DEF, MIN, MAX);
    W = clampInt((rows[0] || "").length || DEF, MIN, MAX);
    cells = [];
    for (var r = 0; r < H; r++) {
      var src = rows[r] || "";
      var row = [];
      for (var c = 0; c < W; c++) row.push(src[c] || "#");
      cells.push(row);
    }
    levelName = o.title || o.name || "Untitled";
    levelTimeBudget = o.time || 60;
    levelId = o.level_id || null;          // null => Save mints a fresh id
    levelAuthor = o.author || "ME";
    createdAt = o.created_at || null;
    creatorNotes = (o.metadata && o.metadata.creator_notes) || "";
    levelStats = o.stats || defaultStats();
    if (nameInp) nameInp.value = levelName;
    if (wInp) wInp.value = W; if (hInp) hInp.value = H;
    fit(); draw();
  }

  // ------- validation: spawn, goal, flood-fill reachability -------
  function validate() {
    var spawn = null, goals = 0, r, c;
    for (r = 0; r < H; r++) for (c = 0; c < W; c++) {
      if (cells[r][c] === "@") { if (spawn) return { ok:false, msg:"More than one spawn (@). Keep exactly one." }; spawn = { r:r, c:c }; }
      if (cells[r][c] === "G") goals++;
    }
    if (!spawn) return { ok:false, msg:"No spawn (@). Add exactly one." };
    if (goals === 0) return { ok:false, msg:"No goal (G). Add at least one." };
    // BFS over passable tiles (everything except wall and hole)
    var seen = {}, q = [spawn], reached = false;
    seen[spawn.r + "," + spawn.c] = 1;
    while (q.length) {
      var n = q.shift();
      if (cells[n.r][n.c] === "G") { reached = true; break; }
      var nb = [[1,0],[-1,0],[0,1],[0,-1]];
      for (var i = 0; i < 4; i++) {
        var rr = n.r + nb[i][0], cc = n.c + nb[i][1];
        if (rr<0||cc<0||rr>=H||cc>=W) continue;
        var k = rr + "," + cc; if (seen[k]) continue;
        var t = cells[rr][cc];
        if (t === "#" || t === "O") continue;
        seen[k] = 1; q.push({ r:rr, c:cc });
      }
    }
    if (!reached) return { ok:false, msg:"Goal not reachable from spawn (walls/holes block every path)." };
    return { ok:true, msg:"Valid: spawn + " + goals + " goal(s), reachable. " + W + "x" + H + "." };
  }
  function report(v, force) {
    statusEl.className = "status " + (v.ok ? "ok" : "bad");
    statusEl.textContent = (v.ok ? "OK — " : "WARNING — ") + v.msg;
    return v.ok || !force;
  }

  // ------- actions -------
  function resetMeta() {
    levelId = null; createdAt = null; creatorNotes = "";
    levelAuthor = "ME"; levelStats = defaultStats();
  }
  function onNew() {
    if (!confirm("Discard current level and start fresh?")) return;
    W = DEF; H = DEF; cells = makeGrid(W, H);
    levelName = "Untitled"; levelTimeBudget = 60;
    resetMeta();
    nameInp.value = levelName; wInp.value = W; hInp.value = H;
    fit(); draw();
    report({ ok:true, msg:"New " + W + "x" + H + " level." });
  }
  function onSave() {
    var v = validate();
    if (!v.ok && !confirm("Level is not valid:\n\n" + v.msg + "\n\nSave anyway?")) { report(v); return; }
    var lvl = toLevel();
    Storage.save(lvl).then(function (id) {
      levelId = id;
      report({ ok:true, msg:'Saved "' + lvl.title + '" (id ' + String(id).slice(0, 8) + '…). Export File to share or commit it.' });
    }, function (e) {
      report({ ok:false, msg:"Save failed: " + e });
    });
  }
  function onCopyJSON() {
    var v = validate(); if (!v.ok) report(v);
    var json = JSON.stringify(toLevel(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(function () {
        report({ ok:true, msg:"Portable level JSON copied to clipboard." });
      }, function () { fallbackCopy(json); });
    } else { fallbackCopy(json); }
  }
  function fallbackCopy(json) {
    window.prompt("Copy this level JSON:", json);
  }
  function onExportFile() {
    var v = validate(); if (!v.ok) report(v);
    var json = JSON.stringify(toLevel(), null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = slug() + ".munki-level.json";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    report({ ok:true, msg:"Exported " + slug() + ".munki-level.json — a portable, shareable level file." });
  }
  function onImportFile() {
    if (!fileInp) return;
    fileInp.value = "";
    fileInp.click();
  }
  function handleImport(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var o = JSON.parse(rd.result);
        fromLevel(o);
        if (!o.level_id) levelId = null;   // imported copy gets a fresh id on Save
        report({ ok:true, msg:'Imported "' + (o.title || o.name || f.name) + '".' });
      } catch (e) {
        report({ ok:false, msg:"Import failed — not a valid level file (" + e + ")" });
      }
    };
    rd.readAsText(f);
  }
  function slug() {
    return (levelName || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  }
  function onLoad() {
    var bundled = (window.MM && window.MM.getBundledLevels) ? window.MM.getBundledLevels() : [];
    Storage.list().then(function (saved) {
      var menu = [];
      bundled.forEach(function (l, i) { menu.push("B" + i + " : [bundled] " + l.name); });
      saved.forEach(function (s, i) { menu.push("S" + i + " : [saved] " + s.title); });
      if (!menu.length) { report({ ok:false, msg:"Nothing saved yet — design a level or Import File." }); return; }
      var pick = window.prompt("Load which level? Enter its code:\n\n" + menu.join("\n"));
      if (!pick) return;
      pick = pick.trim();
      if (pick[0] === "B") {
        var bi = +pick.slice(1);
        if (bundled[bi]) { fromLevel(bundled[bi]); levelId = null; report({ ok:true, msg:"Loaded bundled: " + bundled[bi].name + " (Save makes a local copy)." }); }
      } else if (pick[0] === "S") {
        var s = saved[+pick.slice(1)];
        if (!s) return;
        if (String(s.id).indexOf("legacy:") === 0) {
          Storage.loadLegacy(s.id.slice(7)).then(function (o) {
            if (o) { fromLevel(o); levelId = null; report({ ok:true, msg:"Loaded legacy save: " + s.title }); }
            else report({ ok:false, msg:"Legacy entry unreadable." });
          });
        } else {
          Storage.load(s.id).then(function (o) {
            if (o) { fromLevel(o); report({ ok:true, msg:"Loaded: " + s.title }); }
            else report({ ok:false, msg:"Could not load that entry." });
          });
        }
      }
    });
  }
  function onTest() {
    var v = validate();
    if (!v.ok && !confirm("Level is not valid:\n\n" + v.msg + "\n\nTest anyway?")) { report(v); return; }
    if (!(window.MM && window.MM.playLevel)) { report({ ok:false, msg:"Game bridge (window.MM) not ready." }); return; }
    root.style.display = "none";
    window.MM.playLevel(toLevel(), { onExit: function () { root.style.display = "flex"; draw(); } });
  }
  function onClose() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    var u = new URL(location.href);
    u.searchParams.delete("editor");
    history.replaceState(null, "", u.toString());
  }

  // ------- boot (wait for window.MM from game.js) -------
  function boot() {
    if (!window.MM) { setTimeout(boot, 60); return; }
    var ss = document.getElementById("startScreen");
    if (ss) ss.hidden = true;
    build();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();

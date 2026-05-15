/* ============================================================
   Tiny Canvas — drawing engine, audio, gallery, screen switcher
   ============================================================
   Pattern follows lets-crayte-pootery/game.js:
     - Single IIFE, no globals beyond window.TINY_CANVAS_TEMPLATES.
     - DPR-aware canvas sized to a logical 800×800 box.
     - Web Audio synthesized SFX, lazy-init on first user gesture.
     - Screens swap via the [hidden] attribute on <main class="screen">.
     - Gallery persisted to localStorage as JSON of {id, name, date,
       template, png(dataURL)} records.
   ============================================================ */

(function () {
    "use strict";

    /* ---------- 0. CONFIG ---------- */

    const STAGE_W = 800;
    const STAGE_H = 800;

    /* Color palette — 36 colors organized in 5 groups so kids can find
       a color by category instead of scrolling a flat row. The pink/teal
       canon anchors RAINBOW; the rest fill out coverage. */
    const COLOR_GROUPS = {
        rainbow: {
            label: "RAINBOW",
            colors: [
                "#ff2e88", "#ff4d4d", "#ff7a1f", "#ff9d42",
                "#ffd23f", "#9be15d", "#1ac88a", "#00ffcc",
                "#4fc3f7", "#5b6cff", "#a86bff", "#1c2226"
            ]
        },
        pastels: {
            label: "PASTELS",
            colors: [
                "#ffcbe0", "#ffd6c2", "#ffe9a8", "#f0f4a8",
                "#c8f0c8", "#b6efe6", "#bfe2ff", "#cfd2ff",
                "#e6cfff", "#ffd9ec"
            ]
        },
        neons: {
            label: "NEONS",
            colors: [
                "#ff0080", "#ff5500", "#ffea00", "#00ff5e",
                "#00ffd5", "#00b0ff", "#7a00ff", "#ff00d4"
            ]
        },
        earth: {
            label: "EARTH",
            colors: [
                "#4a2510", "#6b3a1a", "#a05a2c", "#c98a52",
                "#e2b888", "#6b7a4a", "#8a9a5b", "#3a5a4a"
            ]
        },
        metallic: {
            label: "METALLIC",
            colors: [
                "#d4af37",   /* gold */
                "#c0c0c0",   /* silver */
                "#b87333",   /* copper */
                "#8c7853",   /* bronze */
                "#e5e4e2",   /* platinum */
                "#fff"       /* white */
            ]
        }
    };

    /* Brush sizes: 5 for the painting tools, 3 for eraser. Per-tool
       state so each remembers its own size between switches. */
    const BRUSH_SIZES  = [4, 10, 18, 28, 42];
    const ERASER_SIZES = [14, 28, 50];

    const STORAGE_KEY = "tinyCanvas.gallery.v1";
    const MAX_HISTORY = 20;        /* undo stack depth */
    const SAVE_MAX    = 60;        /* gallery item cap */

    /* ---------- 0a. BRUSH DEFINITIONS ----------
       Each brush implements:
         beginStroke(ctx, p, size, color) — fires on pointerdown.
           Sets composite mode + lays the initial dot.
         drawSegment(ctx, p0, p1, size, color) — fires on pointermove.
           Draws one segment of the stroke from p0 to p1.
       The pointer handler is brush-agnostic — it just routes events
       to whichever brush is active. Adding a new brush = adding an
       entry here + a tool button in the DOM. */

    /* Helper: distance between two points. */
    function dist(p0, p1) {
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /* Helper: linearly interpolated points along a segment.
       Returns count steps from p0 toward p1 (exclusive of p0,
       inclusive of p1). Used by textured brushes that stamp
       dabs along the path instead of drawing a vector line.   */
    function interp(p0, p1, count) {
        const out = [];
        for (let i = 1; i <= count; i++) {
            const t = i / count;
            out.push({ x: p0.x + (p1.x - p0.x) * t,
                       y: p0.y + (p1.y - p0.y) * t });
        }
        return out;
    }

    const BRUSHES = {
        pen: {
            label:       "PEN",
            defaultSize: 10,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 1;
                ctx.fillStyle   = color;
                ctx.strokeStyle = color;
                ctx.lineWidth   = size;
                ctx.lineCap     = "round";
                ctx.lineJoin    = "round";
                ctx.beginPath();
                ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
                ctx.fill();
            },
            drawSegment: function (ctx, p0, p1) {
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
            }
        },

        marker: {
            label:       "MARKER",
            defaultSize: 28,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 0.78;
                ctx.fillStyle   = color;
                ctx.strokeStyle = color;
                ctx.lineWidth   = size;
                ctx.lineCap     = "round";
                ctx.lineJoin    = "round";
                ctx.beginPath();
                ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
                ctx.fill();
            },
            drawSegment: function (ctx, p0, p1) {
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
            }
        },

        crayon: {
            /* Stippled-grain texture. Dabs along the path with small
               random offsets at moderate alpha — multiple dabs per
               segment build up the waxy/grainy look. */
            label:       "CRAYON",
            defaultSize: 18,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 0.45;
                ctx.fillStyle   = color;
                this._stampDot(ctx, p.x, p.y, size);
            },
            drawSegment: function (ctx, p0, p1, size) {
                const d = dist(p0, p1);
                const steps = Math.max(1, Math.ceil(d / (size * 0.18)));
                const pts = interp(p0, p1, steps);
                for (let i = 0; i < pts.length; i++) {
                    this._stampDot(ctx, pts[i].x, pts[i].y, size);
                }
            },
            _stampDot: function (ctx, x, y, size) {
                /* Three offset dabs per stamp produce the wax-edge look. */
                const r = size / 2;
                const jitter = r * 0.45;
                for (let k = 0; k < 3; k++) {
                    const ox = (Math.random() - 0.5) * jitter;
                    const oy = (Math.random() - 0.5) * jitter;
                    const rr = r * (0.62 + Math.random() * 0.38);
                    ctx.beginPath();
                    ctx.arc(x + ox, y + oy, rr, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        pencil: {
            /* Thin, scratchy, low-alpha hand-drawn feel. The width is
               narrower than the nominal size because pencils make
               narrow marks even at "thick" settings. */
            label:       "PENCIL",
            defaultSize: 4,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 0.55;
                const w = Math.max(1, size * 0.5);
                ctx.strokeStyle = color;
                ctx.fillStyle   = color;
                ctx.lineWidth   = w;
                ctx.lineCap     = "round";
                ctx.lineJoin    = "round";
                ctx.beginPath();
                ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
                ctx.fill();
            },
            drawSegment: function (ctx, p0, p1) {
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
            }
        },

        paint: {
            /* Watercolor / paint feel — stacked translucent passes
               with width variation. Wider base softens the edge;
               narrow center gives a saturated core. */
            label:       "PAINT",
            defaultSize: 28,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.fillStyle   = color;
                ctx.strokeStyle = color;
                ctx.lineCap     = "round";
                ctx.lineJoin    = "round";
                this._stackDab(ctx, p.x, p.y, size);
            },
            drawSegment: function (ctx, p0, p1, size) {
                /* Three passes: wide+faint, mid, narrow+strong. */
                const passes = [
                    { w: size * 1.25, a: 0.18 },
                    { w: size * 0.85, a: 0.30 },
                    { w: size * 0.50, a: 0.45 }
                ];
                for (let i = 0; i < passes.length; i++) {
                    ctx.globalAlpha = passes[i].a;
                    ctx.lineWidth   = passes[i].w;
                    ctx.beginPath();
                    ctx.moveTo(p0.x, p0.y);
                    ctx.lineTo(p1.x, p1.y);
                    ctx.stroke();
                }
            },
            _stackDab: function (ctx, x, y, size) {
                const passes = [
                    { r: size * 0.62, a: 0.18 },
                    { r: size * 0.42, a: 0.30 },
                    { r: size * 0.25, a: 0.45 }
                ];
                for (let i = 0; i < passes.length; i++) {
                    ctx.globalAlpha = passes[i].a;
                    ctx.beginPath();
                    ctx.arc(x, y, passes[i].r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        glitter: {
            /* Translucent color base + bright white sparkle dabs at
               random positions along the path. Reads as "shimmery"
               without needing actual animation. */
            label:       "GLITTER",
            defaultSize: 18,
            beginStroke: function (ctx, p, size, color) {
                ctx.globalCompositeOperation = "source-over";
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                /* Tinted soft base */
                ctx.globalAlpha = 0.45;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
                ctx.fill();
                this._sparkles(ctx, p.x, p.y, size);
            },
            drawSegment: function (ctx, p0, p1, size, color) {
                /* Soft tinted base stroke */
                ctx.globalAlpha = 0.42;
                ctx.strokeStyle = color;
                ctx.lineWidth   = size;
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
                /* Sparkles scattered along the segment */
                const d = dist(p0, p1);
                const sparkleCount = Math.max(1, Math.floor(d / (size * 0.4)));
                const pts = interp(p0, p1, sparkleCount);
                for (let i = 0; i < pts.length; i++) {
                    this._sparkles(ctx, pts[i].x, pts[i].y, size);
                }
            },
            _sparkles: function (ctx, x, y, size) {
                const r = size / 2;
                const n = 2 + Math.floor(Math.random() * 3);
                for (let k = 0; k < n; k++) {
                    const ang = Math.random() * Math.PI * 2;
                    const dst = Math.random() * r;
                    const sx = x + Math.cos(ang) * dst;
                    const sy = y + Math.sin(ang) * dst;
                    const sr = 0.8 + Math.random() * 1.6;
                    ctx.globalAlpha = 0.55 + Math.random() * 0.35;
                    ctx.fillStyle   = "#ffffff";
                    ctx.beginPath();
                    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        eraser: {
            label:       "ERASER",
            defaultSize: 28,
            beginStroke: function (ctx, p, size) {
                ctx.globalCompositeOperation = "destination-out";
                ctx.globalAlpha = 1;
                ctx.fillStyle   = "#000";
                ctx.strokeStyle = "#000";
                ctx.lineWidth   = size;
                ctx.lineCap     = "round";
                ctx.lineJoin    = "round";
                ctx.beginPath();
                ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
                ctx.fill();
            },
            drawSegment: function (ctx, p0, p1) {
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
            }
        }
    };

    /* Brushes that draw color (everything except eraser). Used for
       deciding which size set + palette state apply. */
    const BRUSH_IDS  = ["pen", "marker", "crayon", "pencil", "paint", "glitter"];
    const TOOL_IDS   = BRUSH_IDS.concat("eraser");

    /* ---------- 1. STATE ---------- */

    const state = {
        screen:        "title",                 /* title | picker | draw | gallery */
        templateId:    null,                    /* current template */
        templateName:  "BLANK",
        currentColor:  COLOR_GROUPS.rainbow.colors[0],
        currentTool:   "pen",                   /* any key in BRUSHES */
        colorGroup:    "rainbow",               /* active palette group */
        brushSize:     BRUSHES.pen.defaultSize, /* size for whichever brush is active */
        eraserSize:    BRUSHES.eraser.defaultSize,
        isDrawing:     false,
        lastX:         0,
        lastY:         0,
        history:       [],                      /* ImageData snapshots */
        dirty:         false,
        savedId:       null,                    /* gallery record id if this drawing was saved */
        dpr:           1
    };

    /* True if the current tool draws color (everything except eraser). */
    function isBrushTool() { return state.currentTool !== "eraser"; }

    /* Size set + active size for whichever tool is current. */
    function sizesForCurrentTool() {
        return isBrushTool() ? BRUSH_SIZES : ERASER_SIZES;
    }
    function activeSize() {
        return isBrushTool() ? state.brushSize : state.eraserSize;
    }
    function setActiveSize(n) {
        if (isBrushTool()) state.brushSize = n;
        else               state.eraserSize = n;
    }

    function currentBrush() {
        return BRUSHES[state.currentTool] || BRUSHES.pen;
    }

    /* ---------- 2. DOM HOOKS ---------- */

    const $  = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    /* Screen elements */
    const screens = {
        title:   $("#screen-title"),
        picker:  $("#screen-picker"),
        draw:    $("#screen-draw"),
        gallery: $("#screen-gallery")
    };

    /* ---------- 3. AUDIO BOOTSTRAP ----------
       Single shared AudioContext, lazy-created on first user gesture.
       All SFX synthesized — no audio files. See DESIGN.md §11.       */

    let audioCtx = null;

    function ensureAudio() {
        if (audioCtx) {
            if (audioCtx.state === "suspended") {
                try { audioCtx.resume(); } catch (_) {}
            }
            return audioCtx;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            audioCtx = new AC();
            if (audioCtx.state === "suspended") {
                try { audioCtx.resume(); } catch (_) {}
            }
        } catch (_) {
            audioCtx = null;
        }
        return audioCtx;
    }

    function unlockAudioOnce() {
        ensureAudio();
        document.removeEventListener("pointerdown", unlockAudioOnce, true);
        document.removeEventListener("keydown",     unlockAudioOnce, true);
    }
    document.addEventListener("pointerdown", unlockAudioOnce, true);
    document.addEventListener("keydown",     unlockAudioOnce, true);

    /* Soft tap — short low blip when the brush hits the page. */
    function sfxTap() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.10);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.07, now + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.20);
    }

    /* Two-note perfect-fifth bell — confirmation chime (save). */
    function sfxSave() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        [880, 1320].forEach(function (freq, i) {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq;
            const g = ctx.createGain();
            const start = now + i * 0.06;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.14, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, start + 1.1);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 1.2);
        });
    }

    /* Soft swoosh — page change / screen transition. */
    function sfxSwoosh() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.18);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 1.6);
            data[i] = (Math.random() * 2 - 1) * env * 0.4;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1400;
        bp.Q.value = 1.5;
        const g = ctx.createGain();
        g.gain.value = 0.4;
        src.connect(bp); bp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    /* Eraser "scratch" — quick noise burst with a high-pass. */
    function sfxErase() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.12);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 2);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1800;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        src.connect(hp); hp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    /* ---------- 4. CANVAS SETUP ---------- */

    const canvas = $("#drawCanvas");
    const ctx2d  = canvas.getContext("2d");

    function setupCanvas() {
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        state.dpr = dpr;
        canvas.width  = STAGE_W * dpr;
        canvas.height = STAGE_H * dpr;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.lineCap  = "round";
        ctx2d.lineJoin = "round";
        clearCanvas();
    }

    function clearCanvas() {
        ctx2d.save();
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        ctx2d.restore();
        state.history.length = 0;
        state.dirty = false;
        updateUndoButton();
        updateStatus();
    }

    /* Convert a pointer event into logical canvas coords (0..STAGE_W). */
    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = STAGE_W / rect.width;
        const sy = STAGE_H / rect.height;
        return {
            x: (e.clientX - rect.left) * sx,
            y: (e.clientY - rect.top)  * sy
        };
    }

    function pushHistory() {
        /* Snapshot before the stroke begins so undo restores the
           pre-stroke state. Cap depth so we don't eat all the
           memory on long sessions. */
        try {
            const snap = ctx2d.getImageData(0, 0,
                canvas.width, canvas.height);
            state.history.push(snap);
            if (state.history.length > MAX_HISTORY) {
                state.history.shift();
            }
        } catch (_) {
            /* getImageData can throw under taint rules; ignore. */
        }
        updateUndoButton();
    }

    function undo() {
        const snap = state.history.pop();
        if (!snap) return;
        ctx2d.save();
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.putImageData(snap, 0, 0);
        ctx2d.restore();
        updateUndoButton();
        if (state.history.length === 0) state.dirty = false;
        updateStatus();
    }

    function updateUndoButton() {
        const btn = $("#undoBtn");
        if (!btn) return;
        if (state.history.length === 0) {
            btn.setAttribute("disabled", "");
        } else {
            btn.removeAttribute("disabled");
        }
    }

    /* ---------- 5. DRAWING ---------- */

    function attachDrawing() {
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup",   onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("pointerleave",  onPointerUp);
    }

    function onPointerDown(e) {
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        pushHistory();
        const p = getPos(e);
        state.isDrawing = true;
        state.lastX = p.x;
        state.lastY = p.y;
        const brush = currentBrush();
        const size  = activeSize();
        const color = state.currentColor;
        brush.beginStroke(ctx2d, p, size, color);
        state.dirty = true;
        updateStatus();
        if (state.currentTool === "eraser") sfxErase();
        else                                sfxTap();
    }

    function onPointerMove(e) {
        if (!state.isDrawing) return;
        const p = getPos(e);
        const brush = currentBrush();
        brush.drawSegment(ctx2d,
            { x: state.lastX, y: state.lastY },
            p,
            activeSize(),
            state.currentColor);
        state.lastX = p.x;
        state.lastY = p.y;
    }

    function onPointerUp() {
        state.isDrawing = false;
        /* Reset shared canvas state so the next stroke begins clean. */
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.globalAlpha = 1;
    }

    /* ---------- 6. TEMPLATE LOADING ---------- */

    function loadTemplate(tpl) {
        state.templateId   = tpl.id;
        state.templateName = tpl.name;
        const overlay = $("#lineArt");
        overlay.innerHTML = tpl.svg || "";
        $("#drawTitle").innerHTML = "&lt;&nbsp;" + tpl.name + "&nbsp;&gt;";
        clearCanvas();
        state.savedId = null;
        updateStatus();
    }

    /* ---------- 7. UI BUILDERS ---------- */

    function buildPicker() {
        const grid = $("#pickerGrid");
        grid.innerHTML = "";
        window.TINY_CANVAS_TEMPLATES.forEach(function (tpl) {
            const card = document.createElement("button");
            card.className = "pick-card";
            card.type = "button";
            card.setAttribute("data-id", tpl.id);

            const thumb = document.createElement("div");
            thumb.className = "pick-thumb";
            thumb.innerHTML = tpl.svg ||
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">' +
                '<rect x="100" y="100" width="600" height="600" fill="none" ' +
                'stroke="currentColor" stroke-width="6" stroke-dasharray="20 16"/>' +
                '</svg>';
            card.appendChild(thumb);

            const name = document.createElement("span");
            name.className = "pick-name";
            name.textContent = tpl.name;
            card.appendChild(name);

            card.addEventListener("click", function () {
                loadTemplate(tpl);
                showScreen("draw");
            });
            grid.appendChild(card);
        });
    }

    /* Palette-group tabs build once at init; the active tab swaps
       the swatches rendered inside #colorPalette. */
    function buildPaletteTabs() {
        const tabsHost = $("#paletteTabs");
        if (!tabsHost) return;
        tabsHost.innerHTML = "";
        Object.keys(COLOR_GROUPS).forEach(function (key) {
            const grp = COLOR_GROUPS[key];
            const tab = document.createElement("button");
            tab.className = "palette-tab";
            tab.type = "button";
            tab.setAttribute("data-group", key);
            tab.textContent = grp.label;
            tab.addEventListener("click", function () {
                state.colorGroup = key;
                buildPalette();
                refreshPaletteTabs();
            });
            tabsHost.appendChild(tab);
        });
        refreshPaletteTabs();
    }

    function refreshPaletteTabs() {
        $$("#paletteTabs .palette-tab").forEach(function (t) {
            t.classList.toggle("active",
                t.getAttribute("data-group") === state.colorGroup);
        });
    }

    function buildPalette() {
        const palette = $("#colorPalette");
        palette.innerHTML = "";
        const colors = COLOR_GROUPS[state.colorGroup].colors;
        colors.forEach(function (hex) {
            const sw = document.createElement("button");
            sw.className = "swatch";
            sw.type = "button";
            sw.style.background = hex;
            sw.setAttribute("role", "option");
            sw.setAttribute("aria-label", hex);
            sw.setAttribute("data-color", hex);
            if (hex === state.currentColor) sw.classList.add("active");
            sw.addEventListener("click", function () {
                state.currentColor = hex;
                /* Picking a color switches to a brush if we were on
                   the eraser — kids expect the color to "do something". */
                if (state.currentTool === "eraser") {
                    state.currentTool = "pen";
                    refreshToolButtons();
                    rebuildSizeButtons();
                }
                refreshPaletteActive();
            });
            palette.appendChild(sw);
        });
    }

    function refreshPaletteActive() {
        $$("#colorPalette .swatch").forEach(function (sw) {
            sw.classList.toggle("active",
                sw.getAttribute("data-color") === state.currentColor);
        });
    }

    function refreshToolButtons() {
        $$(".tool-btn").forEach(function (b) {
            b.classList.toggle("active",
                b.getAttribute("data-tool") === state.currentTool);
        });
    }

    /* Size set is per-tool (brush has 5, eraser has 3) — rebuild the
       buttons each time the tool changes so the visible dots match
       what's actually selectable. */
    function rebuildSizeButtons() {
        const host = $("#sizeRow");
        if (!host) return;
        const sizes = sizesForCurrentTool();
        host.innerHTML = "";
        sizes.forEach(function (n) {
            const btn = document.createElement("button");
            btn.className = "size-btn";
            btn.type = "button";
            btn.setAttribute("data-size", String(n));
            btn.setAttribute("aria-label", "Size " + n);
            const dot = document.createElement("span");
            dot.className = "size-dot";
            /* Visually scale dot to size, capped so the biggest
               doesn't overflow the 40px button. */
            const dotPx = Math.min(28, Math.max(4, Math.round(n * 0.65)));
            dot.style.width  = dotPx + "px";
            dot.style.height = dotPx + "px";
            btn.appendChild(dot);
            btn.addEventListener("click", function () {
                setActiveSize(n);
                refreshSizeButtons();
            });
            host.appendChild(btn);
        });
        refreshSizeButtons();
    }

    function refreshSizeButtons() {
        $$("#sizeRow .size-btn").forEach(function (b) {
            b.classList.toggle("active",
                Number(b.getAttribute("data-size")) === activeSize());
        });
    }

    function attachToolHandlers() {
        $$(".tool-btn").forEach(function (b) {
            b.addEventListener("click", function () {
                const newTool = b.getAttribute("data-tool");
                if (!BRUSHES[newTool]) return;
                state.currentTool = newTool;
                /* Each brush has its own ergonomic default — adopt it
                   if the kid hasn't already set a size for this tool.
                   We just always reset to the default on tool switch;
                   it's predictable and avoids "why did my line get
                   tiny" confusion. */
                if (isBrushTool()) {
                    state.brushSize = BRUSHES[newTool].defaultSize;
                } else {
                    state.eraserSize = BRUSHES.eraser.defaultSize;
                }
                refreshToolButtons();
                rebuildSizeButtons();
            });
        });
    }

    /* ---------- 8. SCREEN SWITCHER ---------- */

    function showScreen(name) {
        Object.keys(screens).forEach(function (k) {
            if (k === name) {
                screens[k].removeAttribute("hidden");
            } else {
                screens[k].setAttribute("hidden", "");
            }
        });
        state.screen = name;
        document.body.className = "screen-" + name;
        sfxSwoosh();
        if (name === "gallery") renderGallery();
    }

    /* ---------- 9. STATUS LINE ---------- */

    function updateStatus() {
        const el = $("#drawStatus");
        if (!el) return;
        if (state.savedId) {
            el.textContent = "SAVED";
        } else if (state.dirty) {
            el.textContent = "DRAWING";
        } else {
            el.textContent = "READY";
        }
    }

    /* ---------- 10. GALLERY (localStorage) ---------- */

    function loadGallery() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function persistGallery(items) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        } catch (_) {
            /* Quota etc — fail silently, the kid just won't get a
               persisted record. The on-screen drawing is unaffected. */
        }
    }

    /* Composite the canvas + line-art into a single PNG dataURL so
       saved drawings include the page outlines, not just the kid's
       strokes. We render to an offscreen canvas at logical size. */
    function composePng() {
        const off = document.createElement("canvas");
        off.width  = STAGE_W;
        off.height = STAGE_H;
        const o = off.getContext("2d");
        /* Paper */
        o.fillStyle = "#fbfaf6";
        o.fillRect(0, 0, STAGE_W, STAGE_H);
        /* Kid's strokes */
        o.drawImage(canvas, 0, 0, STAGE_W, STAGE_H);
        /* Line art — render the SVG as an image */
        return new Promise(function (resolve) {
            const overlay = $("#lineArt").innerHTML.trim();
            if (!overlay) {
                resolve(off.toDataURL("image/png"));
                return;
            }
            const blob = new Blob([overlay], { type: "image/svg+xml" });
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            img.onload = function () {
                /* Match the in-page line-art positioning (92% inset). */
                const inset = STAGE_W * 0.04;
                const draw  = STAGE_W * 0.92;
                o.drawImage(img, inset, inset, draw, draw);
                URL.revokeObjectURL(url);
                resolve(off.toDataURL("image/png"));
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                resolve(off.toDataURL("image/png"));
            };
            img.src = url;
        });
    }

    async function saveDrawing() {
        const png = await composePng();
        const items = loadGallery();
        const record = {
            id:        "tc_" + Date.now() + "_" +
                       Math.random().toString(36).slice(2, 7),
            name:      state.templateName,
            template:  state.templateId,
            date:      new Date().toISOString(),
            png:       png
        };
        items.unshift(record);
        /* Drop the oldest entries past the cap. */
        while (items.length > SAVE_MAX) items.pop();
        persistGallery(items);
        state.savedId = record.id;
        sfxSave();
        flashButton("#drawSave");
        updateStatus();
    }

    function flashButton(sel) {
        const el = $(sel);
        if (!el) return;
        el.classList.add("is-flash");
        setTimeout(function () { el.classList.remove("is-flash"); }, 280);
    }

    function renderGallery() {
        const items = loadGallery();
        const grid  = $("#galleryGrid");
        const empty = $("#galleryEmpty");
        const count = $("#galleryCount");
        count.textContent = items.length + (items.length === 1 ? " PIC" : " PICS");
        grid.innerHTML = "";
        if (items.length === 0) {
            empty.removeAttribute("hidden");
            return;
        }
        empty.setAttribute("hidden", "");
        items.forEach(function (rec) {
            const card = document.createElement("button");
            card.className = "pic-card";
            card.type = "button";
            const thumb = document.createElement("div");
            thumb.className = "pic-thumb";
            const img = document.createElement("img");
            img.src = rec.png;
            img.alt = rec.name;
            thumb.appendChild(img);
            card.appendChild(thumb);
            const name = document.createElement("span");
            name.className = "pic-name";
            name.textContent = rec.name;
            card.appendChild(name);
            const date = document.createElement("span");
            date.className = "pic-date";
            date.textContent = formatDate(rec.date);
            card.appendChild(date);
            card.addEventListener("click", function () { openDetail(rec); });
            grid.appendChild(card);
        });
    }

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return d.getFullYear() + "-" + mm + "-" + dd;
        } catch (_) {
            return "";
        }
    }

    function openDetail(rec) {
        $("#detailTemplate").textContent = rec.name;
        $("#detailDate").textContent     = formatDate(rec.date);
        $("#detailImg").src              = rec.png;
        const panel = $("#picDetail");
        panel.removeAttribute("hidden");
        panel.dataset.id = rec.id;
    }

    function closeDetail() {
        $("#picDetail").setAttribute("hidden", "");
    }

    function deleteCurrent() {
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        const items = loadGallery().filter(function (r) { return r.id !== id; });
        persistGallery(items);
        closeDetail();
        renderGallery();
    }

    function exportCurrent() {
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        const rec = loadGallery().find(function (r) { return r.id === id; });
        if (!rec) return;
        const a = document.createElement("a");
        a.href = rec.png;
        a.download = (rec.name || "tiny-canvas") + "-" + formatDate(rec.date) + ".png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /* ---------- 11. PWA INSTALL PROMPT ---------- */

    let deferredInstall = null;
    const installBtn = $("#btnInstall");

    window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        deferredInstall = e;
        if (installBtn) installBtn.hidden = false;
    });

    if (installBtn) {
        installBtn.addEventListener("click", async function () {
            if (!deferredInstall) return;
            deferredInstall.prompt();
            try { await deferredInstall.userChoice; } catch (_) {}
            deferredInstall = null;
            installBtn.hidden = true;
        });
    }

    /* ---------- 12. KEYBOARD ---------- */

    document.addEventListener("keydown", function (e) {
        if (state.screen !== "draw") return;
        const isUndo = (e.ctrlKey || e.metaKey) &&
                       e.key.toLowerCase() === "z" && !e.shiftKey;
        if (isUndo) {
            e.preventDefault();
            undo();
        }
    });

    /* ---------- 13. WIRING ---------- */

    function init() {
        setupCanvas();
        buildPicker();
        buildPaletteTabs();
        buildPalette();
        attachToolHandlers();
        attachDrawing();
        rebuildSizeButtons();
        refreshToolButtons();

        $("#btnStart").addEventListener("click", function () {
            showScreen("picker");
        });
        $("#btnGallery").addEventListener("click", function () {
            showScreen("gallery");
        });
        $("#pickerBack").addEventListener("click", function () {
            showScreen("title");
        });
        $("#drawBack").addEventListener("click", function () {
            showScreen("picker");
        });
        $("#galleryBack").addEventListener("click", function () {
            showScreen("title");
        });
        $("#drawClear").addEventListener("click", function () {
            pushHistory();
            clearCanvas();
            /* clearCanvas resets history; pushing one frame first
               gives the kid a way back from an accidental tap. */
        });
        $("#drawSave").addEventListener("click", function () {
            saveDrawing();
        });
        $("#undoBtn").addEventListener("click", undo);
        $("#detailClose").addEventListener("click", closeDetail);
        $("#detailDelete").addEventListener("click", deleteCurrent);
        $("#detailExport").addEventListener("click", exportCurrent);
        const galleryStart = $("#galleryStartBtn");
        if (galleryStart) {
            galleryStart.addEventListener("click", function () {
                showScreen("picker");
            });
        }

        /* Default tool selection. State is pre-initialized at the top
           of the IIFE; this just syncs the DOM after the builders ran. */
        refreshToolButtons();
        rebuildSizeButtons();
        refreshPaletteActive();

        /* Resize-aware backing store: rebuild on orientation change
           so DPR-scaled strokes don't blur when the screen rotates. */
        let resizeRaf = 0;
        window.addEventListener("resize", function () {
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(function () {
                /* Preserve current drawing across resize. */
                let snap = null;
                try {
                    snap = ctx2d.getImageData(0, 0,
                        canvas.width, canvas.height);
                } catch (_) {}
                setupCanvas();
                if (snap) {
                    ctx2d.save();
                    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
                    try { ctx2d.putImageData(snap, 0, 0); } catch (_) {}
                    ctx2d.restore();
                }
            });
        });

        updateStatus();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

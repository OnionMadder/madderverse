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

    /* Onioncore-friendly kid-safe palette. Pink + teal anchor it to
       the brand; the rest fill out coverage so kids can color a sun
       yellow or a fish orange without reaching for "off-brand".  */
    const COLORS = [
        "#ff2e88",   /* canon pink */
        "#ff5cab",   /* light pink */
        "#ff9d42",   /* orange */
        "#ffd23f",   /* yellow */
        "#9be15d",   /* lime */
        "#1ac88a",   /* green */
        "#00ffcc",   /* canon teal */
        "#4fc3f7",   /* sky blue */
        "#5b6cff",   /* indigo */
        "#a86bff",   /* purple */
        "#7a4a2a",   /* brown */
        "#1c2226"    /* near-black */
    ];

    const SIZES   = [8, 18, 32];
    const TOOLS   = ["brush", "eraser"];
    const STORAGE_KEY = "tinyCanvas.gallery.v1";
    const MAX_HISTORY = 20;        /* undo stack depth */
    const SAVE_MAX    = 60;        /* gallery item cap */

    /* ---------- 1. STATE ---------- */

    const state = {
        screen:        "title",       /* title | picker | draw | gallery */
        templateId:    null,          /* current template */
        templateName:  "BLANK",
        currentColor:  COLORS[0],
        currentSize:   SIZES[1],
        currentTool:   "brush",
        isDrawing:     false,
        lastX:         0,
        lastY:         0,
        history:       [],            /* ImageData snapshots */
        dirty:         false,
        savedId:       null,          /* gallery record id if this drawing was saved */
        dpr:           1
    };

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
        applyBrushStyle();
        /* Draw a dot so taps register without a drag. */
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, state.currentSize / 2, 0, Math.PI * 2);
        ctx2d.fillStyle = state.currentColor;
        if (state.currentTool === "eraser") {
            ctx2d.globalCompositeOperation = "destination-out";
            ctx2d.fillStyle = "#000";
        } else {
            ctx2d.globalCompositeOperation = "source-over";
        }
        ctx2d.fill();
        state.dirty = true;
        updateStatus();
        if (state.currentTool === "eraser") {
            sfxErase();
        } else {
            sfxTap();
        }
    }

    function onPointerMove(e) {
        if (!state.isDrawing) return;
        const p = getPos(e);
        ctx2d.beginPath();
        if (state.currentTool === "eraser") {
            ctx2d.globalCompositeOperation = "destination-out";
            ctx2d.strokeStyle = "rgba(0,0,0,1)";
        } else {
            ctx2d.globalCompositeOperation = "source-over";
            ctx2d.strokeStyle = state.currentColor;
        }
        ctx2d.lineWidth = state.currentSize;
        ctx2d.moveTo(state.lastX, state.lastY);
        ctx2d.lineTo(p.x, p.y);
        ctx2d.stroke();
        state.lastX = p.x;
        state.lastY = p.y;
    }

    function onPointerUp() {
        state.isDrawing = false;
        ctx2d.globalCompositeOperation = "source-over";
    }

    function applyBrushStyle() {
        ctx2d.lineCap  = "round";
        ctx2d.lineJoin = "round";
        ctx2d.lineWidth = state.currentSize;
        ctx2d.strokeStyle = state.currentColor;
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

    function buildPalette() {
        const palette = $("#colorPalette");
        palette.innerHTML = "";
        COLORS.forEach(function (hex) {
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
                state.currentTool  = "brush";
                refreshToolButtons();
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

    function refreshSizeButtons() {
        $$(".size-btn").forEach(function (b) {
            b.classList.toggle("active",
                Number(b.getAttribute("data-size")) === state.currentSize);
        });
    }

    function attachToolHandlers() {
        $$(".tool-btn").forEach(function (b) {
            b.addEventListener("click", function () {
                state.currentTool = b.getAttribute("data-tool");
                refreshToolButtons();
            });
        });
        $$(".size-btn").forEach(function (b) {
            b.addEventListener("click", function () {
                state.currentSize = Number(b.getAttribute("data-size"));
                refreshSizeButtons();
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
        buildPalette();
        attachToolHandlers();
        attachDrawing();
        refreshToolButtons();
        refreshSizeButtons();

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

        /* Default tool selection. */
        state.currentTool = "brush";
        refreshToolButtons();
        refreshSizeButtons();
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

/* ============================================================
   Tiny Canvas — drawing engine, audio, gallery, screen switcher
   ============================================================
   Pattern follows pootery/game.js:
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

    /* Canvas now fills the viewport — STAGE_W / STAGE_H are recomputed
       at setupCanvas() from window.innerWidth / window.innerHeight.
       These exports stay so the rest of the codebase can reference
       "the canvas's logical size in CSS pixels" but they're no longer
       constants. */
    let STAGE_W = 800;
    let STAGE_H = 800;

    /* Long-side of the rasterized PNG produced by composePng().
       Independent of viewport — keeps saved + autosaved files at a
       bounded size regardless of device aspect or pixel density. */
    const SAVE_LONG_SIDE = 1024;

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

    const STORAGE_KEY        = "tinyCanvas.gallery.v1";
    const SETTINGS_KEY       = "tinyCanvas.settings.v1";
    const IN_PROGRESS_KEY    = "tinyCanvas.inProgress.v1";
    const FIRST_SAVE_KEY     = "tinyCanvas.firstSaveCelebrated.v1";
    const GATE_UNLOCKED_KEY  = "tinyCanvas.parentGate.unlockedUntil.v1";
    /* History entries are dirty-rect ImageData patches, not full-canvas
       snapshots — see the HISTORY section for why. Cheap enough to
       afford real depth; the byte budget is the backstop for the rare
       full-canvas entry (a CLEAR). */
    const MAX_HISTORY          = 30;
    const HISTORY_BYTE_BUDGET  = 24 * 1024 * 1024;
    /* Logical-px slack added around every stroke's dirty rect. Covers
       brushes that paint wider than their nominal nib: glitter throws
       sparkles to size/2 + ~2.4, paint stacks passes wider than the
       line. Cheap insurance — an under-sized rect leaves stray marks
       behind after an undo. */
    const STROKE_BOUNDS_SLACK  = 12;
    const SAVE_MAX           = 60;     /* gallery item cap */
    const AUTOSAVE_INTERVAL_MS = 60_000;
    const GATE_UNLOCK_MS     = 24 * 60 * 60 * 1000;  /* 24h persistent unlock */

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

        /* FILL is not a stroke tool — it has no beginStroke/drawSegment
           and never reaches the pointer-move path. onPointerDown
           intercepts it and calls floodFillAt() instead. It lives in
           this table anyway so the tool button, the active-state
           refresh and the tool-switch handler all keep working off one
           list. `sizeless` tells rebuildSizeButtons to hide the SIZE
           row — a bucket has no nib. */
        fill: {
            label:       "FILL",
            sizeless:    true,
            defaultSize: 0
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
        screen:        "title",                 /* title | picker | draw | gallery | settings */
        templateId:    null,                    /* current template */
        templateName:  "BLANK",
        currentColor:  COLOR_GROUPS.rainbow.colors[0],
        currentTool:   "pen",                   /* any key in BRUSHES */
        colorGroup:    "rainbow",               /* active palette group */
        brushSize:     BRUSHES.pen.defaultSize, /* size for whichever brush is active */
        eraserSize:    BRUSHES.eraser.defaultSize,
        isDrawing:     false,
        lastX:         0,                       /* raw pointer */
        lastY:         0,
        smoothX:       0,                       /* midpoint-smoothed pen tip */
        smoothY:       0,
        history:       [],                      /* ImageData snapshots */
        dirty:         false,
        savedId:       null,                    /* gallery record id if this drawing was saved */
        dpr:           1,
        /* Parent gate is unlocked once per session per Apple's
           documented Kids-category pattern. */
        parentGateUnlocked: false,
        /* Pending callback for parentGate(cb). Stored so the modal
           knows which action to run on correct answer. */
        parentGatePending: null,
        /* Settings — initialized from localStorage in loadSettings(). */
        settings: {
            smoothing: true,    /* brush smoothing on by default — better for kids */
            sfx:       true,    /* SFX on by default */
            music:     false,   /* music not implemented v1; toggle disabled */
            locale:    "en"
        }
    };

    /* True if the current tool lays down a stroke in color — i.e.
       everything except the eraser and the sizeless fill bucket. */
    function isBrushTool() {
        return state.currentTool !== "eraser" && !isFillTool();
    }
    function isFillTool() { return state.currentTool === "fill"; }

    /* Size set + active size for whichever tool is current. Fill has
       no sizes at all, so it returns an empty set and the SIZE row
       hides itself. */
    function sizesForCurrentTool() {
        if (isFillTool()) return [];
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

    /* ---------- 1a. CAPACITOR NATIVE BRIDGE ----------
       Tiny Canvas runs as both a static web page (served from
       madderverse.org/tiny-canvas/) AND a Capacitor-wrapped native
       app on iOS + Android. The native runtime injects window.Capacitor
       at app start; this section feature-detects it and adapts the
       export, persistence, status bar, and splash-screen flows.

       Plugins are registered in package.json and auto-linked by
       `npx cap sync`. Each call site is guarded so the web build runs
       the same code untouched. */

    function getCapacitor() {
        return (typeof window !== "undefined" && window.Capacitor) || null;
    }

    function isNative() {
        const cap = getCapacitor();
        return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    }

    function nativePlugin(name) {
        const cap = getCapacitor();
        return cap && cap.Plugins && cap.Plugins[name] || null;
    }

    /* True when the page is running as a wrapped app (Capacitor) OR
       as an installed PWA in standalone mode (iOS Add to Home Screen,
       Android PWA install). The parent gate only enforces in this
       context — the regular web at madderverse.org/tiny-canvas/ has
       a browser address bar, the back button, and is just a website
       you visit. Gating navigation there is friction without
       compliance value. */
    function isStandaloneOrNative() {
        if (isNative()) return true;
        try {
            if (window.matchMedia &&
                window.matchMedia("(display-mode: standalone)").matches) {
                return true;
            }
            if (typeof navigator !== "undefined" &&
                navigator.standalone === true) {
                return true;
            }
        } catch (_) {}
        return false;
    }

    /* Storage keys mirrored to native Preferences. localStorage stays
       the source of truth at runtime (synchronous reads) but writes
       are mirrored to Preferences so the data survives app uninstall
       on Android and webview clears on iOS. Rehydration on app start
       reads Preferences back into localStorage. */
    const STORAGE_KEYS_TO_MIRROR = [
        STORAGE_KEY, SETTINGS_KEY, IN_PROGRESS_KEY, FIRST_SAVE_KEY
    ];

    async function rehydrateFromNativePrefs() {
        const prefs = nativePlugin("Preferences");
        if (!prefs) return;
        for (const key of STORAGE_KEYS_TO_MIRROR) {
            try {
                const r = await prefs.get({ key });
                if (r && r.value !== null && r.value !== undefined) {
                    /* Only overwrite localStorage if the native value
                       differs (avoids needlessly thrashing the cache). */
                    if (localStorage.getItem(key) !== r.value) {
                        localStorage.setItem(key, r.value);
                    }
                }
            } catch (_) { /* missing key, etc — skip silently */ }
        }
    }

    function mirrorToNativePrefs(key, value) {
        const prefs = nativePlugin("Preferences");
        if (!prefs) return;
        try {
            if (value === null || value === undefined) {
                prefs.remove({ key });
            } else {
                prefs.set({ key, value: String(value) });
            }
        } catch (_) { /* fail silently — native is a mirror, not auth */ }
    }

    /* setStorage / removeStorage replace direct localStorage calls for
       data we want mirrored. Sync to localStorage immediately, fire
       Preferences write async in the background. */
    function setStorage(key, value) {
        try { localStorage.setItem(key, value); } catch (_) {}
        mirrorToNativePrefs(key, value);
    }
    function removeStorage(key) {
        try { localStorage.removeItem(key); } catch (_) {}
        mirrorToNativePrefs(key, null);
    }

    async function setupStatusBar() {
        const sb = nativePlugin("StatusBar");
        if (!sb) return;
        try {
            await sb.setStyle({ style: "DARK" });
            await sb.setBackgroundColor({ color: "#06141a" });
            /* overlaysWebView: false in capacitor.config.json means the
               status bar sits ABOVE the webview, not over it. We've
               configured for that mode — don't toggle here. */
        } catch (_) { /* StatusBar can fail on some Android builds */ }
    }

    async function hideSplashScreen() {
        const ss = nativePlugin("SplashScreen");
        if (!ss) return;
        try { await ss.hide(); } catch (_) {}
    }

    /* Native export: write the PNG to the Cache directory, then open
       the Share sheet so the user picks "Save to Photos" or "Save to
       Files" (iOS) / "Save image" or share target (Android). This is
       the standard iOS app pattern for "save my drawing somewhere"
       since Capacitor core doesn't include a direct photo-library
       writer plugin.

       Returns true on success so the web fallback doesn't double-fire. */
    async function nativeExport(rec) {
        const fs    = nativePlugin("Filesystem");
        const share = nativePlugin("Share");
        if (!fs) return false;

        const base64 = (rec.png || "").replace(/^data:image\/png;base64,/, "");
        if (!base64) return false;

        const safeName = (rec.name || "tiny-canvas")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        const fileName = safeName + "-" + formatDate(rec.date) + ".png";

        try {
            const written = await fs.writeFile({
                path: fileName,
                data: base64,
                directory: "CACHE",
                recursive: false
            });
            if (share) {
                await share.share({
                    title: "Tiny Canvas — " + (rec.name || "Drawing"),
                    url: written.uri,
                    dialogTitle: "Save or share your drawing"
                });
            }
            return true;
        } catch (e) {
            /* User canceled the share sheet, or write failed.
               Either way: return true so we don't double-fire the
               web download. The kid sees no error; they just don't
               get a file out — the drawing is still in the gallery. */
            return true;
        }
    }

    /* ---------- 2. DOM HOOKS ---------- */

    const $  = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    /* Screen elements */
    const screens = {
        title:    $("#screen-title"),
        picker:   $("#screen-picker"),
        draw:     $("#screen-draw"),
        gallery:  $("#screen-gallery"),
        settings: $("#screen-settings")
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

    /* Settings-gated audio: every SFX exits silently if the user has
       turned sound off. Keeps the call sites unchanged. */
    function audioEnabled() {
        return state.settings.sfx;
    }

    /* Soft tap — short low blip when the brush hits the page. */
    function sfxTap() {
        if (!audioEnabled()) return;
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
        if (!audioEnabled()) return;
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
        if (!audioEnabled()) return;
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
        if (!audioEnabled()) return;
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

    /* ---------- 3b. MUSIC (synthesised, no audio files) ----------

       The Settings screen shipped a permanently disabled "Music —
       coming in a future update" toggle. Rather than delete the row,
       this makes it real.

       The bed is generated, never sampled: four detuned voices on a
       pentatonic chord, each breathing on its own slow LFO, through a
       lowpass. No scheduler (so nothing drifts out of sync over a long
       session) and no audio files at all — which also keeps it clear
       of the licensing trap that bit Slip Studio, where a stock-music
       subscription turned out not to cover an app with a music toggle.

       Default OFF. Deliberately quiet — this is a kids' colouring app,
       not a jukebox. */

    const MUSIC_VOICES = [
        { hz: 174.61, lfo: 0.031 },   /* F3  */
        { hz: 261.63, lfo: 0.043 },   /* C4  */
        { hz: 349.23, lfo: 0.037 },   /* F4  */
        { hz: 392.00, lfo: 0.026 }    /* G4  */
    ];
    const MUSIC_GAIN = 0.035;
    let musicRig = null;

    function startMusic() {
        if (musicRig) return;
        const ctx = ensureAudio();
        if (!ctx) return;

        const master = ctx.createGain();
        master.gain.value = 0;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 820;
        lp.Q.value = 0.4;
        lp.connect(master);
        master.connect(ctx.destination);

        const parts = [];
        MUSIC_VOICES.forEach(function (v, i) {
            const osc = ctx.createOscillator();
            osc.type = i % 2 ? "sine" : "triangle";
            osc.frequency.value = v.hz;
            osc.detune.value = (i - 1.5) * 4;      /* gentle chorus */

            const vg = ctx.createGain();
            /* Base equals the LFO depth, so the swing lands in
               [0, 2*amp] and never inverts phase. */
            const amp = 1 / MUSIC_VOICES.length;
            vg.gain.value = amp;

            const lfo = ctx.createOscillator();
            lfo.frequency.value = v.lfo;
            const lfoAmt = ctx.createGain();
            lfoAmt.gain.value = amp;
            lfo.connect(lfoAmt);
            lfoAmt.connect(vg.gain);

            osc.connect(vg);
            vg.connect(lp);
            osc.start();
            lfo.start();
            parts.push({ osc: osc, lfo: lfo });
        });

        /* Long fade-in so it never announces itself. */
        master.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + 4);
        musicRig = { ctx: ctx, master: master, parts: parts };
    }

    function stopMusic() {
        if (!musicRig) return;
        const rig = musicRig;
        musicRig = null;
        const now = rig.ctx.currentTime;
        try {
            rig.master.gain.cancelScheduledValues(now);
            rig.master.gain.setValueAtTime(rig.master.gain.value, now);
            rig.master.gain.linearRampToValueAtTime(0, now + 1.2);
        } catch (_) {}
        setTimeout(function () {
            rig.parts.forEach(function (p) {
                try { p.osc.stop(); } catch (_) {}
                try { p.lfo.stop(); } catch (_) {}
            });
        }, 1500);
    }

    function syncMusic() {
        if (state.settings.music) startMusic();
        else                      stopMusic();
    }

    /* ---------- 4. CANVAS SETUP ---------- */

    const canvas = $("#drawCanvas");
    const ctx2d  = canvas.getContext("2d");

    function setupCanvas() {
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        state.dpr = dpr;
        /* Logical canvas size = viewport size (CSS pixels). Capped at
           2x DPR to keep backing store bounded on large laptop screens. */
        /* Size from the canvas's OWN laid-out box, not window.innerWidth.
           They are not the same number — a classic desktop scrollbar makes
           innerWidth ~22px wider than the element, and Android WebView
           insets can do the same vertically. Sizing the backing store from
           innerWidth while the element lays out narrower means
           canvas.width / rect.width != dpr, and every consumer that
           assumes it IS dpr silently lands in the wrong place: the fill
           mask is positioned by the true ratio while the fill seed was
           computed with dpr, so taps seeded in the wrong region and the
           coloring page appeared to leak. Fall back to innerWidth only
           when the canvas has no box yet (screen still hidden at init). */
        const box = canvas.getBoundingClientRect();
        STAGE_W = Math.max(320, Math.round(box.width)  || window.innerWidth  || 800);
        STAGE_H = Math.max(320, Math.round(box.height) || window.innerHeight || 800);
        canvas.width  = STAGE_W * dpr;
        canvas.height = STAGE_H * dpr;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.lineCap  = "round";
        ctx2d.lineJoin = "round";
        /* The mask is sized to the backing store and positioned from
           the live SVG rect, so a resize or rotate invalidates both. */
        invalidateFillMask();
        clearCanvas();
    }

    /* keepHistory: the CLEAR button passes true so the wipe itself is
       undoable. Everything else (new page, resize) passes nothing and
       resets the stack, because history from a previous drawing can't
       be replayed onto a different one. */
    function clearCanvas(keepHistory) {
        ctx2d.save();
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        ctx2d.restore();
        if (!keepHistory) state.history.length = 0;
        state.dirty = false;
        updateUndoButton();
        updateStatus();
    }

    /* Convert a pointer event into logical canvas coords. Since the
       canvas is fixed inset 0 and fills the viewport, clientX/Y maps
       directly to canvas CSS coordinates. */
    function getPos(e) {
        /* Map the pointer into LOGICAL canvas coords via the canvas's own
           box. This used to return clientX/clientY raw, on the assumption
           that the canvas is fixed inset:0 so the two are identical. They
           are identical only while the backing store was sized from the
           same number the element actually laid out at — and it wasn't
           (setupCanvas used window.innerWidth, which a scrollbar or a
           WebView inset makes wider than the element). The mismatch
           compressed every stroke toward the top-left: at the far edge of
           a 375px-wide box sized from a 397px innerWidth, the line landed
           about 10px from the finger. */
        const cr = canvas.getBoundingClientRect();
        if (!cr.width || !cr.height) return { x: e.clientX, y: e.clientY };
        return { x: (e.clientX - cr.left) * (STAGE_W / cr.width),
                 y: (e.clientY - cr.top)  * (STAGE_H / cr.height) };
    }

    /* ---------- 4a. FILL MASK + FLOOD FILL ----------

       The coloring page is an SVG in #lineArt sitting ABOVE the canvas
       at pointer-events:none — the kid colors underneath it. That means
       the canvas bitmap holds no line information at all, so a naive
       flood fill would bleed straight across the whole page.

       So we rasterize the same overlay SVG into an offscreen canvas,
       positioned with the identical svgRect/canvasRect math composePng()
       uses for export, and keep a 1-byte-per-pixel boundary mask.

       That mask is only HALF the boundary though. A fill also has to
       stop at the kid's own strokes, the way MS Paint does — draw a
       closed shape freehand and tapping inside it should fill just that
       shape. Walking the mask alone ignored the bitmap entirely, so on
       a blank page there was nothing to stop the flood and one tap
       filled the whole screen. See floodFillAt for the colour-matching
       half.

       Threshold is deliberately high (not 1): the SVG strokes are
       antialiased, so a low threshold would stop the fill at the faint
       outer skirt of the line and leave a pale halo ringing every
       region. At 96 the fill runs under the skirt and stops at the
       stroke core — and since the line art draws on TOP of the canvas,
       that underlap is invisible. */

    const FILL_BOUNDARY_ALPHA = 96;
    let fillMask        = null;   /* Uint8Array, 1 = line, 0 = fillable */
    let fillMaskW       = 0;
    let fillMaskH       = 0;
    let fillMaskPending = null;   /* in-flight build, so two fast taps
                                     share one rasterization */
    let fillMaskGeom    = "";     /* geometry fingerprint the cached
                                     mask was built against */

    /* Called whenever the page or the backing store changes shape. */
    function invalidateFillMask() {
        fillMask        = null;
        fillMaskPending = null;
        fillMaskGeom    = "";
    }

    /* Fingerprint of every input the mask's geometry depends on.
       Explicit invalidation alone is not enough: the mask is positioned
       from the LIVE svg rect measured against the LIVE canvas backing
       store, so anything that moves or resizes either one — a resize
       whose handler hasn't run yet, an orientation change, a layout
       shift from the tool drawer — leaves a mask that still looks valid
       but is drawn in the wrong place. A misaligned mask doesn't fail
       loudly; it just fills the wrong region, which reads as "the
       coloring page leaks". Cheaper to re-measure on every fill than to
       chase that. */
    function fillGeomKey() {
        const host = $("#lineArt");
        const svg  = host && host.querySelector("svg");
        const c    = canvas.getBoundingClientRect();
        if (!svg) return canvas.width + "x" + canvas.height + ":none";
        const r = svg.getBoundingClientRect();
        return [canvas.width, canvas.height,
                Math.round(r.left - c.left), Math.round(r.top - c.top),
                Math.round(r.width), Math.round(r.height),
                state.templateId || ""].join(",");
    }

    function buildFillMask() {
        const key = fillGeomKey();
        if (fillMask && fillMaskGeom === key) return Promise.resolve(fillMask);
        if (fillMask) invalidateFillMask();   /* geometry moved under us */
        if (fillMaskPending) return fillMaskPending;
        fillMaskGeom = key;

        const W = canvas.width, H = canvas.height;
        fillMaskPending = new Promise(function (resolve) {
            const mask = new Uint8Array(W * H);
            fillMaskW = W;
            fillMaskH = H;

            function done() {
                fillMask        = mask;
                fillMaskPending = null;
                resolve(mask);
            }

            const host = $("#lineArt");
            const svg  = host && host.querySelector("svg");
            /* BLANK page — no line art, so nothing bounds the fill and
               a tap floods the whole canvas. That's the correct
               behaviour: on a blank page, fill IS "paint the paper". */
            if (!svg) { done(); return; }

            const svgRect    = svg.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            if (!svgRect.width || !canvasRect.width) { done(); return; }

            /* CSS px -> device px, same ratio the kid's strokes use. */
            const scale = W / canvasRect.width;
            const x = (svgRect.left - canvasRect.left) * scale;
            const y = (svgRect.top  - canvasRect.top)  * scale;
            const w = svgRect.width  * scale;
            const h = svgRect.height * scale;

            const off = document.createElement("canvas");
            off.width  = W;
            off.height = H;
            const o = off.getContext("2d", { willReadFrequently: true });

            const blob = new Blob([svg.outerHTML],
                                  { type: "image/svg+xml" });
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            img.onload = function () {
                o.drawImage(img, x, y, w, h);
                URL.revokeObjectURL(url);
                let d;
                try {
                    d = o.getImageData(0, 0, W, H).data;
                } catch (_) { done(); return; }
                for (let i = 0, a = 3; i < mask.length; i++, a += 4) {
                    if (d[a] >= FILL_BOUNDARY_ALPHA) mask[i] = 1;
                }
                done();
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                done();
            };
            img.src = url;
        });
        return fillMaskPending;
    }

    /* "#rrggbb" -> [r,g,b]. Every colour in COLOR_GROUPS is 6-digit
       hex, so this stays deliberately narrow. */
    function hexToRgb(hex) {
        const h = String(hex).replace("#", "");
        return [parseInt(h.slice(0, 2), 16) || 0,
                parseInt(h.slice(2, 4), 16) || 0,
                parseInt(h.slice(4, 6), 16) || 0];
    }

    /* Scanline flood fill in device pixels, bounded by the mask.
       Packed indices (y*W+x) on a plain stack — the stack holds span
       seeds, not pixels, so it stays small even on a full-page fill. */
    function floodFillAt(p) {
        buildFillMask().then(function (mask) {
            const W = fillMaskW, H = fillMaskH;
            if (!W || !H) return;
            /* p is already in logical canvas coords (getPos maps it there
               off the canvas's own box), so logical -> device is just the
               backing-store ratio. This composes to exactly the same
               client -> device transform buildFillMask uses to position
               the art, which is what keeps seed and mask in one space. */
            if (!STAGE_W || !STAGE_H) return;
            const sx = Math.round(p.x * (W / STAGE_W));
            const sy = Math.round(p.y * (H / STAGE_H));
            if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
            /* Tapped directly on a line — nothing to fill. */
            if (mask[sy * W + sx]) return;

            const rgb = hexToRgb(state.currentColor);
            const r = rgb[0], g = rgb[1], b = rgb[2];

            let image;
            try {
                image = ctx2d.getImageData(0, 0, W, H);
            } catch (_) { return; }
            const data = image.data;

            /* MS Paint semantics: spread across pixels that match the
               colour under the finger, and stop at anything different —
               the kid's own strokes included. The printed line art is
               still an absolute boundary via the mask, so this composes
               with a coloring page instead of replacing it.
               Matching on all four channels means transparent paper
               (0,0,0,0) is its own "colour" and reads as a region. */
            const si = (sy * W + sx) * 4;
            const seedR = data[si], seedG = data[si + 1],
                  seedB = data[si + 2], seedA = data[si + 3];

            /* Already this colour — nothing would change. */
            if (seedA === 255 && seedR === r && seedG === g && seedB === b) {
                return;
            }

            /* Tolerance, squared. Brush strokes and the SVG's own edges
               are antialiased, so an exact match would stop a pixel or
               two early and ring every fill with a pale halo. Kept
               modest so a soft edge isn't treated as open ground. */
            const TOL2 = 48 * 48;
            function matches(i) {
                if (mask[i]) return false;
                const q = i * 4;
                const dr = data[q]     - seedR;
                const dg = data[q + 1] - seedG;
                const db = data[q + 2] - seedB;
                const da = data[q + 3] - seedA;
                return dr * dr + dg * dg + db * db + da * da <= TOL2;
            }

            beginHistoryCapture();

            const seen = new Uint8Array(W * H);
            const stack = [sy * W + sx];

            while (stack.length) {
                const seed = stack.pop();
                const y = (seed / W) | 0;
                let   x = seed - y * W;

                /* Walk left to the start of this span. `seen` is tested
                   BEFORE matches() throughout: a pixel we already filled
                   now carries the fill colour and would fail the seed
                   comparison, so the visited flag is what keeps the walk
                   honest once the region starts being painted. */
                while (x > 0 && !seen[y * W + x - 1] &&
                       matches(y * W + x - 1)) x--;

                let spanUp = false, spanDown = false;
                while (x < W) {
                    const i = y * W + x;
                    if (seen[i] || !matches(i)) break;
                    seen[i] = 1;
                    growBoundsDevice(x, y);
                    const q = i * 4;
                    data[q]     = r;
                    data[q + 1] = g;
                    data[q + 2] = b;
                    data[q + 3] = 255;

                    if (y > 0) {
                        const up = i - W;
                        const openUp = !seen[up] && matches(up);
                        if (openUp && !spanUp) { stack.push(up); spanUp = true; }
                        else if (!openUp)      { spanUp = false; }
                    }
                    if (y < H - 1) {
                        const dn = i + W;
                        const openDn = !seen[dn] && matches(dn);
                        if (openDn && !spanDown) { stack.push(dn); spanDown = true; }
                        else if (!openDn)        { spanDown = false; }
                    }
                    x++;
                }
            }

            /* putImageData ignores the DPR transform, so drop to
               identity for the write and restore it after. */
            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            ctx2d.putImageData(image, 0, 0);
            ctx2d.restore();

            /* +1 because growBoundsDevice records pixel indices, and
               the rect is exclusive at the far edge. */
            sMaxX += 1; sMaxY += 1;
            commitHistory();

            state.dirty = true;
            updateStatus();
            markInProgressDirty();
            hideIdleScribble();
            triggerOnionReaction("drawing", 500);
            sfxTap();
        });
    }

    /* ---------- HISTORY (dirty-rect patches) ----------

       History used to be a full-canvas PNG dataURL per stroke. That
       cost a toDataURL() encode of the whole viewport-sized backing
       store on EVERY pointerdown — tens of milliseconds of jank right
       at the moment the kid starts drawing — and each entry weighed a
       hundred-odd KB, which is why the depth was capped at 12.

       Now: snapshot the canvas into an offscreen buffer with
       drawImage (a cheap blit, no encode), track the bounding box the
       stroke actually touches, and on commit keep ONLY that rectangle
       as raw ImageData. A typical stroke covers a tiny fraction of the
       screen, so entries are small, undo is instant, and the depth
       affords 30 instead of 12.

       It also makes undo SYNCHRONOUS — the old version had to decode
       an Image before it could paint, so an undo could still be
       pending a frame or two after the click. */

    let histCanvas = null;
    let histCtx    = null;
    let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;

    function ensureHistCanvas() {
        if (!histCanvas) {
            histCanvas = document.createElement("canvas");
            histCtx = histCanvas.getContext("2d", { willReadFrequently: true });
        }
        if (histCanvas.width  !== canvas.width ||
            histCanvas.height !== canvas.height) {
            histCanvas.width  = canvas.width;
            histCanvas.height = canvas.height;
        }
    }

    /* Snapshot the pre-change canvas and reset the dirty box. */
    function beginHistoryCapture() {
        ensureHistCanvas();
        histCtx.setTransform(1, 0, 0, 1, 0, 0);
        histCtx.clearRect(0, 0, histCanvas.width, histCanvas.height);
        histCtx.drawImage(canvas, 0, 0);
        sMinX = Infinity; sMinY = Infinity;
        sMaxX = -Infinity; sMaxY = -Infinity;
    }

    /* Grow the dirty box around a point given in LOGICAL px.
       `pad` is a logical-px radius — pass the brush size plus slack,
       because several brushes scatter past their nominal width
       (glitter throws sparkles out to size/2 + ~2.4, paint stacks
       passes wider than the nib). Under-padding here is the one way
       this design can go visibly wrong: anything drawn outside the
       recorded rect survives an undo as a stray mark. */
    function growBounds(x, y, pad) {
        const d = state.dpr || 1;
        const r = (pad || 0) * d;
        const dx = x * d, dy = y * d;
        if (dx - r < sMinX) sMinX = dx - r;
        if (dy - r < sMinY) sMinY = dy - r;
        if (dx + r > sMaxX) sMaxX = dx + r;
        if (dy + r > sMaxY) sMaxY = dy + r;
    }

    /* Device-px variant, used by the fill tool which already works
       in device space. */
    function growBoundsDevice(x, y) {
        if (x < sMinX) sMinX = x;
        if (y < sMinY) sMinY = y;
        if (x > sMaxX) sMaxX = x;
        if (y > sMaxY) sMaxY = y;
    }

    function markWholeCanvasDirty() {
        sMinX = 0; sMinY = 0;
        sMaxX = canvas.width; sMaxY = canvas.height;
    }

    function historyBytes() {
        let n = 0;
        for (let i = 0; i < state.history.length; i++) {
            n += state.history[i].patch.data.length;
        }
        return n;
    }

    function trimHistory() {
        while (state.history.length > MAX_HISTORY) state.history.shift();
        /* A full-canvas patch (a CLEAR) is ~4.8MB on a phone, so cap
           by bytes too. Always keep at least one entry. */
        while (state.history.length > 1 &&
               historyBytes() > HISTORY_BYTE_BUDGET) {
            state.history.shift();
        }
    }

    function commitHistory() {
        if (!histCanvas) return;
        if (!isFinite(sMinX) || sMaxX < sMinX) return;   /* nothing drawn */
        const W = canvas.width, H = canvas.height;
        const x = Math.max(0, Math.floor(sMinX));
        const y = Math.max(0, Math.floor(sMinY));
        const w = Math.min(W, Math.ceil(sMaxX)) - x;
        const h = Math.min(H, Math.ceil(sMaxY)) - y;
        if (w <= 0 || h <= 0) return;
        let patch;
        try {
            patch = histCtx.getImageData(x, y, w, h);
        } catch (_) { return; }
        state.history.push({ x: x, y: y, patch: patch });
        trimHistory();
        updateUndoButton();
    }

    function undo() {
        const entry = state.history.pop();
        if (!entry) return;
        ctx2d.save();
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.putImageData(entry.patch, entry.x, entry.y);
        ctx2d.restore();
        updateUndoButton();
        if (state.history.length === 0) state.dirty = false;
        markInProgressDirty();
        triggerOnionReaction("undo");
        updateStatus();
        maybeShowIdleScribble();
    }

    /* Two undo controls, kept in lockstep: the floating one over the
       canvas (reachable mid-drawing) and the one in the tool tray next
       to CLEAR/SAVE (where people actually look for it). */
    function updateUndoButton() {
        const empty = state.history.length === 0;
        [$("#undoBtn"), $("#drawUndo")].forEach(function (btn) {
            if (!btn) return;
            if (empty) btn.setAttribute("disabled", "");
            else       btn.removeAttribute("disabled");
        });
    }

    /* ---------- 4. IDLE SCRIBBLE ----------
       Kinetic centerpiece visible on a fresh blank canvas — Tiny
       Canvas's answer to Pootery's spinning clay. Fades out the
       moment the kid makes a stroke; comes back after CLEAR.
       Only renders on the BLANK template (other templates have
       their own line-art as the centerpiece). */

    function maybeShowIdleScribble() {
        const el = $("#idleScribble");
        if (!el) return;
        const shouldShow = state.templateId === "blank" && !state.dirty;
        el.classList.toggle("is-hidden", !shouldShow);
    }

    function hideIdleScribble() {
        const el = $("#idleScribble");
        if (el) el.classList.add("is-hidden");
    }

    /* ---------- 4a. ONION MASCOT ----------
       Small SVG character anchored to the bottom-left of the viewport
       that reacts to drawing events. Eyes track the brush; mouth
       changes per state; whole onion jumps on save, shudders on clear.

       The onion has pointer-events: none so it never blocks drawing.
       All animations honor prefers-reduced-motion in CSS. */

    function setOnionState(name) {
        const onion = $("#onion");
        if (!onion) return;
        onion.classList.remove("is-drawing", "is-saved",
                               "is-cleared", "is-undo");
        if (name) onion.classList.add("is-" + name);
    }

    let _onionRevertT = 0;
    function triggerOnionReaction(name, ms) {
        setOnionState(name);
        ms = ms || (name === "saved" ? 900 :
                    name === "cleared" ? 1000 :
                    name === "undo" ? 400 : 600);
        clearTimeout(_onionRevertT);
        _onionRevertT = setTimeout(function () { setOnionState(null); }, ms);
    }

    /* Eye tracking: as the pointer moves anywhere on the viewport,
       shift the pupils + highlights toward it. Subtle — max ~3px.
       Uses SVG transform on the eye groups so it composes with the
       CSS blink animation (which targets pupils + highlights). */
    function onionTrackGaze(e) {
        const onion = $("#onion");
        if (!onion) return;
        const rect = onion.getBoundingClientRect();
        if (rect.width === 0) return;
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const maxOff   = 3;
        const distRamp = Math.min(1, dist / 220);
        const ox = (dx / dist) * maxOff * distRamp;
        const oy = (dy / dist) * maxOff * distRamp;
        const t = "translate(" + ox.toFixed(2) + " " + oy.toFixed(2) + ")";
        const eL = onion.querySelector(".onion-eye-l");
        const eR = onion.querySelector(".onion-eye-r");
        if (eL) eL.setAttribute("transform", t);
        if (eR) eR.setAttribute("transform", t);
    }

    /* ---------- 5. DRAWING ---------- */

    function attachDrawing() {
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup",   onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("pointerleave",  onPointerUp);
        /* Eye tracking lives at document level so the onion looks at
           the cursor even when it's over the tool rail or titlebar. */
        document.addEventListener("pointermove", onionTrackGaze, { passive: true });
    }

    function onPointerDown(e) {
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        /* The first real gesture retires the coach — a kid who has
           already started drawing does not need to be told how. */
        dismissCoach();
        /* Reaching the canvas at all means the kid is done with the
           sheet — slide it back down so it stops covering the art. */
        if (isDrawerOpen()) setDrawerOpen(false);
        const p = getPos(e);
        /* Fill is a one-shot tap, not a stroke: it never sets
           isDrawing, so pointermove stays inert and no stroke is
           finished on pointerup. It pushes its own history entry once
           it knows it will actually paint something — pushing here
           would burn an undo step on a tap that landed on a line. */
        if (isFillTool()) { floodFillAt(p); return; }
        beginHistoryCapture();
        state.isDrawing = true;
        state.lastX  = p.x;
        state.lastY  = p.y;
        state.smoothX = p.x;
        state.smoothY = p.y;
        const brush = currentBrush();
        const size  = activeSize();
        const color = state.currentColor;
        brush.beginStroke(ctx2d, p, size, color);
        growBounds(p.x, p.y, size + STROKE_BOUNDS_SLACK);
        state.dirty = true;
        updateStatus();
        markInProgressDirty();
        hideIdleScribble();
        setOnionState("drawing");
        if (state.currentTool === "eraser") sfxErase();
        else                                sfxTap();
    }

    function onPointerMove(e) {
        if (!state.isDrawing) return;
        const p = getPos(e);
        const brush = currentBrush();
        const size  = activeSize();
        const color = state.currentColor;

        if (state.settings.smoothing) {
            /* Midpoint-quadratic smoothing: draw from the current
               smoothed point to the midpoint of (lastRaw, currentRaw).
               This filters out pointer jitter and produces a softer
               line that follows the kid's intent rather than every
               event tremor. */
            const midX = (state.lastX + p.x) / 2;
            const midY = (state.lastY + p.y) / 2;
            brush.drawSegment(ctx2d,
                { x: state.smoothX, y: state.smoothY },
                { x: midX,          y: midY },
                size, color);
            state.smoothX = midX;
            state.smoothY = midY;
        } else {
            brush.drawSegment(ctx2d,
                { x: state.lastX, y: state.lastY },
                p, size, color);
            state.smoothX = p.x;
            state.smoothY = p.y;
        }

        growBounds(p.x, p.y, size + STROKE_BOUNDS_SLACK);

        state.lastX = p.x;
        state.lastY = p.y;
    }

    function onPointerUp() {
        const wasDrawing = state.isDrawing;
        if (state.isDrawing && state.settings.smoothing) {
            /* Finish the smoothed stroke by drawing one final segment
               from the last smoothed point to the actual raw point.
               Without this the smoothed line stops short of the kid's
               finger. */
            const brush = currentBrush();
            brush.drawSegment(ctx2d,
                { x: state.smoothX, y: state.smoothY },
                { x: state.lastX,   y: state.lastY },
                activeSize(), state.currentColor);
            growBounds(state.lastX, state.lastY,
                       activeSize() + STROKE_BOUNDS_SLACK);
        }
        /* Bank the stroke as one undo step, keeping only the rectangle
           it actually touched. */
        if (wasDrawing) commitHistory();
        state.isDrawing = false;
        /* Reset shared canvas state so the next stroke begins clean. */
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.globalAlpha = 1;
        /* Onion goes back to idle after the stroke ends. */
        setOnionState(null);
    }

    /* ---------- 6. TEMPLATE LOADING ---------- */

    async function loadTemplate(tpl) {
        /* Save the kid's current work to its template's in-progress
           slot BEFORE clearing the canvas — so going BLANK → UNICORN
           → BLANK restores the BLANK strokes. Without this the
           previous drawing would be lost the moment you tap a
           different page. No-op on first entry. */
        if (state.templateId && state.dirty) {
            markInProgressDirty();
            await persistInProgress();
        }
        state.templateId   = tpl.id;
        state.templateName = tpl.name;
        const overlay = $("#lineArt");
        overlay.innerHTML = tpl.svg || "";
        /* New page, new boundaries. */
        invalidateFillMask();
        $("#drawTitle").innerHTML = "&lt;&nbsp;" + tpl.name + "&nbsp;&gt;";
        clearCanvas();
        state.savedId = null;
        updateStatus();
        /* If the kid was mid-drawing this template before (e.g. they
           closed the app and came back), restore those strokes silently.
           No confirm dialog — Bala's gallery is sacred + no nag. */
        tryRestoreInProgress(tpl.id);
        /* Reveal the idle scribble if we landed on a fresh BLANK
           with no strokes; hide it otherwise (template is loaded
           or restore brought back existing strokes). */
        maybeShowIdleScribble();
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

            card.addEventListener("click", async function () {
                await loadTemplate(tpl);
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

    /* Held across rebuilds. The custom swatch lives in the markup as a
       sibling of #colorPalette (buildPalette rewrites that container's
       innerHTML, which would destroy it), but visually it belongs as
       the LAST swatch in the wrapping flow — as a sibling it stacked to
       the right of the whole block and floated off on its own line.
       innerHTML="" only detaches it; holding the node keeps its
       listeners, so re-appending each rebuild is safe. */
    let customSwatchEl = null;

    function buildPalette() {
        const palette = $("#colorPalette");
        if (!customSwatchEl) customSwatchEl = $("#customSwatch");
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
        /* Custom swatch goes last, inside the same wrapping flow. */
        if (customSwatchEl) palette.appendChild(customSwatchEl);
    }

    function refreshPaletteActive() {
        let matchedPreset = false;
        $$("#colorPalette .swatch").forEach(function (sw) {
            const on = sw.getAttribute("data-color") === state.currentColor;
            if (on) matchedPreset = true;
            sw.classList.toggle("active", on);
        });
        syncCustomColorInput(matchedPreset);
    }

    /* Point the native colour input at whatever colour is actually
       armed. Its value was set once in the HTML and never touched
       again, so the picker always opened on that hardcoded pink no
       matter what the kid was drawing with — you'd tap it to nudge
       your green and land back at magenta.
       The swatch itself KEEPS its rainbow gradient rather than being
       repainted with the chosen colour: the rainbow is what says "pick
       any colour", and overwriting it would spend that affordance on
       the first use. Which colour is armed is shown by the active ring
       instead, same as every preset. */
    function syncCustomColorInput(matchedPreset) {
        const custom = $("#customColor");
        const wrap   = $("#customSwatch");
        if (custom && /^#[0-9a-f]{6}$/i.test(state.currentColor)) {
            custom.value = state.currentColor;
        }
        if (wrap) wrap.classList.toggle("active", !matchedPreset);
    }

    function refreshToolButtons() {
        $$(".tool-btn").forEach(function (b) {
            b.classList.toggle("active",
                b.getAttribute("data-tool") === state.currentTool);
        });
    }

    /* Size set is per-tool (brush has 5, eraser has 3, fill has none)
       — rebuild the buttons each time the tool changes so the visible
       dots match what's actually selectable. An empty set hides the
       whole row, label included, rather than leaving a stranded SIZE
       caption over nothing. */
    function rebuildSizeButtons() {
        const host = $("#sizeRow");
        if (!host) return;
        const sizes = sizesForCurrentTool();
        const row = host.closest(".size-row");
        if (row) row.hidden = sizes.length === 0;
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

    /* ---------- TOOL DRAWER (phone bottom sheet) ----------

       Below 768px the rail is a bottom sheet that sits collapsed to
       its 54px handle and slides up when .is-open is set. The CSS for
       that class shipped, but nothing ever set it — there was no
       drawer reference in the JS at all, no :focus-within fallback and
       no swipe handler. On a phone that left the kid with the default
       pen in the default colour and no way to reach brushes, sizes,
       colours, the eraser or fill.

       Above 768px .drawer-handle is display:none and the rail is
       always visible, so the class is inert there. */

    function isDrawerOpen() {
        const rail = $(".draw-side-rail");
        return !!rail && rail.classList.contains("is-open");
    }

    function setDrawerOpen(open) {
        const rail   = $(".draw-side-rail");
        const handle = $(".drawer-handle");
        if (!rail || !handle) return;
        rail.classList.toggle("is-open", !!open);
        handle.setAttribute("aria-expanded", open ? "true" : "false");
        handle.setAttribute("aria-label", open ? "Hide tools" : "Show tools");
    }

    function attachDrawerHandler() {
        const handle = $(".drawer-handle");
        if (!handle) return;
        handle.addEventListener("click", function () {
            retireCoachButtons();
            setDrawerOpen(!isDrawerOpen());
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
                if (isFillTool()) {
                    /* no size to adopt — the bucket has no nib */
                } else if (isBrushTool()) {
                    state.brushSize = BRUSHES[newTool].defaultSize;
                } else {
                    state.eraserSize = BRUSHES.eraser.defaultSize;
                }
                refreshToolButtons();
                rebuildSizeButtons();
            });
        });
    }

    /* ---------- 7c. COACH (first-run onboarding) ----------

       Three things are invisible on arrival: that you can draw
       anywhere, that PAGES holds 21 coloring pages, and that TOOLS
       holds the brushes, colours and the fill bucket. The coach
       teaches the first with a moving touch dot; the other two get a
       short breathe on the buttons themselves, because a caption
       alone doesn't move a thumb toward a control nobody has noticed.

       Shown once, then never again unless replayed from Settings.
       Dismissed by the first real gesture — the kid who already
       started drawing doesn't need to be told how. */

    const COACH_KEY   = "tinyCanvas.coach.draw.v1";
    const OFFERED_KEY = "tinyCanvas.coach.offered.v1";
    const COACH_TIMEOUT_MS = 9000;

    let coachTimer = 0;

    function prefersReducedMotion() {
        try {
            return window.matchMedia &&
                   window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (_) { return false; }
    }

    function coachSeen() {
        try { return localStorage.getItem(COACH_KEY) === "1"; }
        catch (_) { return true; }   /* no storage — don't nag every launch */
    }

    function markCoachSeen() {
        try { setStorage(COACH_KEY, "1"); } catch (_) {}
    }

    function showCoach() {
        const el = $("#coach");
        if (!el) return;
        /* SMIL ignores prefers-reduced-motion, so the travelling dot
           has to be removed rather than styled away. The squiggle and
           caption stay — they still teach the gesture. */
        if (prefersReducedMotion()) {
            const motion = $("#coachMotion");
            if (motion && motion.parentNode) {
                motion.parentNode.removeChild(motion);
            }
        }
        el.classList.remove("is-leaving");
        el.removeAttribute("hidden");
        clearTimeout(coachTimer);
        coachTimer = setTimeout(dismissCoach, COACH_TIMEOUT_MS);
    }

    function dismissCoach() {
        const el = $("#coach");
        clearTimeout(coachTimer);
        if (!el || el.hasAttribute("hidden")) return;
        markCoachSeen();
        if (prefersReducedMotion()) {
            el.setAttribute("hidden", "");
            return;
        }
        el.classList.add("is-leaving");
        setTimeout(function () {
            el.setAttribute("hidden", "");
            el.classList.remove("is-leaving");
        }, 300);
    }

    /* Breathe PAGES + TOOLS so they get noticed at all. Retired the
       moment either is tapped — an affordance the kid has already
       found never needs advertising again. */
    function offerCoachButtons() {
        try { if (localStorage.getItem(OFFERED_KEY) === "1") return; }
        catch (_) { return; }
        const pages  = $(".pages-btn");
        const handle = $(".drawer-handle");
        if (pages)  pages.classList.add("is-new");
        if (handle) handle.classList.add("is-new");
    }

    function retireCoachButtons() {
        try { setStorage(OFFERED_KEY, "1"); } catch (_) {}
        const pages  = $(".pages-btn");
        const handle = $(".drawer-handle");
        if (pages)  pages.classList.remove("is-new");
        if (handle) handle.classList.remove("is-new");
    }

    /* Settings → HOW TO PLAY. Clears both flags and replays. */
    function replayCoaching() {
        try {
            setStorage(COACH_KEY, "0");
            setStorage(OFFERED_KEY, "0");
        } catch (_) {}
        showScreen("draw");
        offerCoachButtons();
        showCoach();
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
        if (name === "gallery")  renderGallery();
        if (name === "settings") syncSettingsUI();
        if (name === "draw") {
            if (!coachSeen()) {
                offerCoachButtons();
                showCoach();
            }
        } else {
            dismissCoach();
        }
    }

    /* ---------- 8a. SETTINGS PERSISTENCE ---------- */

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (obj && typeof obj === "object") {
                Object.assign(state.settings, obj);
            }
        } catch (_) { /* fall through to defaults */ }
    }

    function persistSettings() {
        try {
            setStorage(SETTINGS_KEY, JSON.stringify(state.settings));
        } catch (_) { /* quota; non-fatal */ }
    }

    function syncSettingsUI() {
        const smoothing = $("#setSmoothing");
        const sfx       = $("#setSfx");
        const music     = $("#setMusic");
        const locale    = $("#setLocale");
        if (smoothing) smoothing.checked = !!state.settings.smoothing;
        if (sfx)       sfx.checked       = !!state.settings.sfx;
        if (music)     music.checked     = !!state.settings.music;
        if (locale)    locale.value      = state.settings.locale || "en";
    }

    function attachSettingsHandlers() {
        const smoothing = $("#setSmoothing");
        const sfx       = $("#setSfx");
        const locale    = $("#setLocale");
        if (smoothing) {
            smoothing.addEventListener("change", function () {
                state.settings.smoothing = smoothing.checked;
                persistSettings();
            });
        }
        if (sfx) {
            sfx.addEventListener("change", function () {
                state.settings.sfx = sfx.checked;
                persistSettings();
            });
        }
        const music = $("#setMusic");
        if (music) {
            music.addEventListener("change", function () {
                state.settings.music = music.checked;
                persistSettings();
                /* The toggle itself is the user gesture that lets the
                   AudioContext start, so act on it immediately. */
                syncMusic();
            });
        }
        /* Don't keep humming in the pocket. */
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) stopMusic();
            else if (state.settings.music) startMusic();
        });

        /* Custom colour — the 36 swatches cover the common ground, this
           covers "but I want THAT green". Native input so it uses the
           platform picker kids' parents already know. */
        const custom = $("#customColor");
        const customWrap = $("#customSwatch");
        if (custom) {
            const applyCustom = function () {
                state.currentColor = custom.value;
                /* Same courtesy the preset swatches do: picking a
                   colour while the eraser is armed means the kid wants
                   to draw, not rub out. */
                if (state.currentTool === "eraser") {
                    state.currentTool = "pen";
                    refreshToolButtons();
                    rebuildSizeButtons();
                }
                refreshPaletteActive();
            };
            custom.addEventListener("input",  applyCustom);
            custom.addEventListener("change", applyCustom);
        }
        if (locale) {
            locale.addEventListener("change", function () {
                state.settings.locale = locale.value;
                persistSettings();
            });
        }
    }

    /* ---------- 8b. PARENT GATE ----------
       Apple Kids category and Google's Designed for Families both
       require external links, destructive actions, and share/export
       to sit behind an adult-only gate in the installed app context.
       Implementation choices, all on purpose:

       1. Plain web (not installed as PWA, not Capacitor) short-circuits
          past the gate entirely. madderverse.org/tiny-canvas/ in a
          browser tab has a back button and address bar — it's a
          website you visit, not an installed kids app. Gating
          navigation there is friction without a compliance reason.

       2. Single-digit addition (4..18 sum) with 3 options. Above an
          early-reader's grade level, low enough that adults don't
          curse at their own app. Distractors are within ±3 of the
          correct answer so it's still real math, not a pattern match.

       3. Unlock persists 24h via localStorage. Within Apple's
          "designated area" pattern but doesn't re-pester the parent
          every reload. */

    function isGateUnlocked() {
        if (state.parentGateUnlocked) return true;
        try {
            const until = parseInt(
                localStorage.getItem(GATE_UNLOCKED_KEY) || "0", 10);
            if (until > Date.now()) {
                state.parentGateUnlocked = true;
                return true;
            }
        } catch (_) {}
        return false;
    }

    function setGateUnlocked() {
        state.parentGateUnlocked = true;
        try {
            setStorage(GATE_UNLOCKED_KEY,
                       String(Date.now() + GATE_UNLOCK_MS));
        } catch (_) {}
    }

    function parentGate(label, onPass) {
        /* No-op on plain web — the address bar IS the safety net. */
        if (!isStandaloneOrNative()) { onPass(); return; }
        if (isGateUnlocked())        { onPass(); return; }
        state.parentGatePending = onPass;
        renderParentGate(label);
        const modal = $("#parentGate");
        modal.removeAttribute("hidden");
    }

    function renderParentGate(label) {
        /* Single-digit addition; sums in [4, 18]. Beyond an early
           reader without being a brain-teaser. */
        const a = 2 + Math.floor(Math.random() * 7);   /* 2..8 */
        const b = 2 + Math.floor(Math.random() * 7);   /* 2..8 */
        const correct = a + b;
        $("#parentGateProblem").textContent = "What is " + a + " + " + b + "?";
        const foot = $("#parentGateFoot");
        foot.textContent = "";
        foot.classList.remove("is-error");

        /* Two plausible wrong answers within ±3 — real math, not a
           pattern match, but adults solve it instantly. */
        const wrongs = new Set();
        while (wrongs.size < 2) {
            const delta = (Math.random() < 0.5 ? -1 : 1) *
                          (1 + Math.floor(Math.random() * 3));
            const candidate = correct + delta;
            if (candidate !== correct && candidate > 0) wrongs.add(candidate);
        }
        const options = [correct].concat(Array.from(wrongs));
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }

        const host = $("#parentGateOptions");
        host.innerHTML = "";
        options.forEach(function (n) {
            const btn = document.createElement("button");
            btn.className = "parent-gate-option";
            btn.type = "button";
            btn.textContent = String(n);
            btn.addEventListener("click", function () {
                if (n === correct) {
                    setGateUnlocked();
                    closeParentGate();
                    const cb = state.parentGatePending;
                    state.parentGatePending = null;
                    if (cb) cb();
                } else {
                    btn.classList.add("is-wrong");
                    setTimeout(function () {
                        btn.classList.remove("is-wrong");
                    }, 600);
                    foot.textContent = "That's not it — try again.";
                    foot.classList.add("is-error");
                }
            });
            host.appendChild(btn);
        });
    }

    function closeParentGate() {
        $("#parentGate").setAttribute("hidden", "");
    }

    function cancelParentGate() {
        state.parentGatePending = null;
        closeParentGate();
    }

    /* ---------- 8c. AUTO-SAVE ----------
       Independent of the gallery: keeps the current canvas + template
       in localStorage so a crash or backgrounded tab doesn't lose the
       kid's work. Auto-fires every 60s while there's something dirty
       to save, and on visibilitychange when the kid switches apps. */

    let autosaveTimer = 0;
    let inProgressDirty = false;

    function markInProgressDirty() {
        inProgressDirty = true;
    }

    async function persistInProgress() {
        if (!inProgressDirty) return;
        if (!state.templateId) return;
        try {
            /* Use composePng so the autosaved PNG is bounded —
               viewport canvas at native size would blow localStorage. */
            const png = await composePng();
            const rec = {
                templateId:   state.templateId,
                templateName: state.templateName,
                png:          png,
                savedAt:      new Date().toISOString()
            };
            setStorage(IN_PROGRESS_KEY, JSON.stringify(rec));
            inProgressDirty = false;
        } catch (_) {
            /* quota or taint — fail silently */
        }
    }

    function clearInProgress() {
        removeStorage(IN_PROGRESS_KEY);
        inProgressDirty = false;
    }

    function loadInProgressFor(templateId) {
        try {
            const raw = localStorage.getItem(IN_PROGRESS_KEY);
            if (!raw) return null;
            const rec = JSON.parse(raw);
            if (rec && rec.templateId === templateId && rec.png) return rec;
        } catch (_) {}
        return null;
    }

    function tryRestoreInProgress(templateId) {
        const rec = loadInProgressFor(templateId);
        if (!rec) return;
        /* Paint the saved PNG onto the canvas, scaled to fill it.
           The saved PNG is at SAVE_LONG_SIDE / scaled-aspect; the
           live canvas is at viewport size — drawImage handles the
           stretch. Strokes will keep their relative position to the
           line-art (which scales similarly). */
        const img = new Image();
        img.onload = function () {
            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);
            ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx2d.restore();
            state.dirty = true;
            updateStatus();
        };
        img.onerror = function () { /* corrupt rec — ignore */ };
        img.src = rec.png;
    }

    function startAutosave() {
        if (autosaveTimer) clearInterval(autosaveTimer);
        autosaveTimer = setInterval(persistInProgress, AUTOSAVE_INTERVAL_MS);
        /* Save when the tab loses visibility (kid backgrounds the app
           or locks the device). visibilitychange fires before the
           browser kills the page on iOS Safari. */
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden") persistInProgress();
        });
        /* Last-chance save on close. */
        window.addEventListener("beforeunload", persistInProgress);
        window.addEventListener("pagehide",     persistInProgress);
    }

    /* ---------- 8d. TOASTS ---------- */

    function showSavedToast() {
        const t = $("#savedToast");
        if (!t) return;
        t.removeAttribute("hidden");
        /* Force reflow so the .is-show transition fires from hidden state */
        // eslint-disable-next-line no-unused-expressions
        t.offsetHeight;
        t.classList.add("is-show");
        clearTimeout(showSavedToast._timer);
        showSavedToast._timer = setTimeout(function () {
            t.classList.remove("is-show");
            setTimeout(function () { t.setAttribute("hidden", ""); }, 250);
        }, 1400);
    }

    function showFirstSaveToast() {
        const t = $("#firstSaveToast");
        if (!t) return;
        t.removeAttribute("hidden");
        t.offsetHeight;
        t.classList.add("is-show");
        setTimeout(function () {
            t.classList.remove("is-show");
            setTimeout(function () { t.setAttribute("hidden", ""); }, 250);
        }, 2400);
    }

    function isFirstSaveCelebrated() {
        try { return localStorage.getItem(FIRST_SAVE_KEY) === "1"; }
        catch (_) { return false; }
    }
    function markFirstSaveCelebrated() {
        try { setStorage(FIRST_SAVE_KEY, "1"); }
        catch (_) {}
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
            setStorage(STORAGE_KEY, JSON.stringify(items));
        } catch (_) {
            /* Quota etc — fail silently, the kid just won't get a
               persisted record. The on-screen drawing is unaffected. */
        }
    }

    /* Composite the live canvas + line-art SVG into a fixed-size PNG
       dataURL. With the canvas now filling the viewport, we scale to
       a bounded SAVE_LONG_SIDE square so localStorage stays sane and
       gallery thumbnails are consistent across devices.

       Aspect is preserved by scaling so the longer viewport dimension
       maps to SAVE_LONG_SIDE; the shorter dimension is centered with
       paper-color fill. The line-art SVG is drawn on top at its
       same visible proportion of the viewport so saved drawings
       look like what the kid saw on screen. */
    function composePng() {
        return new Promise(function (resolve) {
            const cw = canvas.width;
            const ch = canvas.height;
            const aspect = cw / ch;
            let outW, outH;
            if (aspect >= 1) {
                outW = SAVE_LONG_SIDE;
                outH = Math.round(SAVE_LONG_SIDE / aspect);
            } else {
                outH = SAVE_LONG_SIDE;
                outW = Math.round(SAVE_LONG_SIDE * aspect);
            }

            const off = document.createElement("canvas");
            off.width = outW;
            off.height = outH;
            const o = off.getContext("2d");

            /* Paper background */
            o.fillStyle = "#fbfaf6";
            o.fillRect(0, 0, outW, outH);

            /* Kid's strokes — full canvas scaled to output */
            o.drawImage(canvas, 0, 0, outW, outH);

            /* Line-art overlay, scaled by the SAME ratio used for the
               kid's strokes so the printed page lines up exactly with
               anything the kid drew on top of them. */
            const lineArtHost = $("#lineArt");
            const overlaySvg  = lineArtHost && lineArtHost.querySelector("svg");
            if (!overlaySvg) { resolve(off.toDataURL("image/png")); return; }

            const svgRect    = overlaySvg.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            if (svgRect.width === 0 || canvasRect.width === 0) {
                resolve(off.toDataURL("image/png"));
                return;
            }
            const scale = outW / canvasRect.width;
            const laX = (svgRect.left - canvasRect.left) * scale;
            const laY = (svgRect.top  - canvasRect.top)  * scale;
            const laW = svgRect.width  * scale;
            const laH = svgRect.height * scale;

            const blob = new Blob([overlaySvg.outerHTML],
                                  { type: "image/svg+xml" });
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            img.onload = function () {
                o.drawImage(img, laX, laY, laW, laH);
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
        const wasEmpty = loadGallery().length === 0;
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
        /* Once a piece is saved to gallery, the in-progress slot is
           no longer needed — kid moved on to "finished" territory. */
        clearInProgress();
        sfxSave();
        flashButton("#drawSave");
        showSavedToast();
        triggerOnionReaction("saved");
        /* One-shot first-save celebration. Construction Paper Principle:
           a single gentle pat on the back, no streaks, never repeats. */
        if (wasEmpty && !isFirstSaveCelebrated()) {
            markFirstSaveCelebrated();
            setTimeout(showFirstSaveToast, 500);
        }
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
        /* Destructive — parent-gated. */
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        parentGate("delete", function () {
            const items = loadGallery().filter(function (r) { return r.id !== id; });
            persistGallery(items);
            closeDetail();
            renderGallery();
        });
    }

    function exportCurrent() {
        /* Export saves a PNG to the device — gated as a "leaves the app"
           action per Apple Kids policy.

           Native: writes to Filesystem.Cache + opens the Share sheet
           so the user picks "Save to Photos" / "Save to Files".
           Web: anchor-download fallback. */
        const id = $("#picDetail").dataset.id;
        if (!id) return;
        parentGate("export", async function () {
            const rec = loadGallery().find(function (r) { return r.id === id; });
            if (!rec) return;

            if (isNative()) {
                const ok = await nativeExport(rec);
                if (ok) return;
                /* Native plugin failed entirely (e.g. Filesystem missing).
                   Fall through to the web anchor download as a last resort
                   — it'll still produce a file via the Capacitor webview's
                   download intent. */
            }

            const a = document.createElement("a");
            a.href = rec.png;
            a.download = (rec.name || "tiny-canvas") + "-" + formatDate(rec.date) + ".png";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
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

    async function init() {
        /* Native rehydration must run BEFORE loadSettings/loadGallery
           so the first localStorage reads see the canonical native
           values, not stale web-cache values. No-op on web. */
        await rehydrateFromNativePrefs();
        loadSettings();
        setupCanvas();
        buildPicker();
        buildPaletteTabs();
        buildPalette();
        attachToolHandlers();
        attachDrawerHandler();
        attachDrawing();
        attachSettingsHandlers();
        rebuildSizeButtons();
        refreshToolButtons();

        $("#btnStart").addEventListener("click", async function () {
            /* START COLORING goes straight to a blank canvas instead of
               dumping the kid into a 20-template grid. Most kids just
               want to scribble; templates are an optional side-trip via
               the floating PAGES button on the draw screen. */
            const blank = (window.TINY_CANVAS_TEMPLATES || [])
                .find(function (t) { return t.id === "blank"; });
            if (blank) await loadTemplate(blank);
            showScreen("draw");
        });
        $("#btnGallery").addEventListener("click", function () {
            showScreen("gallery");
        });
        $("#pickerBack").addEventListener("click", function () {
            /* Picker is now reached ONLY from the draw screen via the
               floating PAGES button. Back-from-picker returns to
               drawing rather than punting to the title. */
            showScreen("draw");
        });
        $("#drawBack").addEventListener("click", function () {
            /* Save the in-progress before leaving so the kid's
               current strokes survive going back to title and
               coming back to draw later. */
            persistInProgress();
            showScreen("title");
        });
        /* Floating PAGES button on the draw screen — opens the
           template picker as an optional browse view. */
        const howTo = $("#btnHowToPlay");
        if (howTo) howTo.addEventListener("click", replayCoaching);

        const pagesBtn = $("#pagesBtn");
        if (pagesBtn) {
            pagesBtn.addEventListener("click", function () {
                retireCoachButtons();
                showScreen("picker");
            });
        }
        $("#galleryBack").addEventListener("click", function () {
            showScreen("title");
        });
        $("#drawClear").addEventListener("click", function () {
            /* CLEAR is undoable. It used to call pushHistory() and
               then clearCanvas(), which wiped the very entry it had
               just pushed — so an accidental CLEAR destroyed the
               drawing with no way back, on a kids' app. */
            beginHistoryCapture();
            markWholeCanvasDirty();
            commitHistory();
            clearCanvas(true);
            clearInProgress();
            triggerOnionReaction("cleared");
            /* Bring the idle scribble back if we're on BLANK — the
               kid just got back to a fresh page. */
            maybeShowIdleScribble();
        });
        $("#drawSave").addEventListener("click", function () {
            saveDrawing();
        });
        $("#undoBtn").addEventListener("click", undo);
        const trayUndo = $("#drawUndo");
        if (trayUndo) trayUndo.addEventListener("click", undo);
        $("#detailClose").addEventListener("click", closeDetail);
        $("#detailDelete").addEventListener("click", deleteCurrent);
        $("#detailExport").addEventListener("click", exportCurrent);
        const galleryStart = $("#galleryStartBtn");
        if (galleryStart) {
            galleryStart.addEventListener("click", async function () {
                const blank = (window.TINY_CANVAS_TEMPLATES || [])
                    .find(function (t) { return t.id === "blank"; });
                if (blank) await loadTemplate(blank);
                showScreen("draw");
            });
        }

        /* Settings screen */
        const settingsHook = $("#settingsHook");
        if (settingsHook) {
            settingsHook.addEventListener("click", function () {
                showScreen("settings");
            });
        }
        const settingsBack = $("#settingsBack");
        if (settingsBack) {
            settingsBack.addEventListener("click", function () {
                showScreen("title");
            });
        }

        /* Parent gate close button */
        const gateClose = $("#parentGateClose");
        if (gateClose) gateClose.addEventListener("click", cancelParentGate);

        /* External links — apply parent gate. The .madder-home button
           leaves the app for the Madderverse hub; the footer Madderverse
           / About / Mad Sundar links all do too. Each gets an
           interception click handler. parentGate() itself short-circuits
           on plain web (just navigates) and uses the 24h-persisted unlock
           on native/PWA-standalone. */
        document.querySelectorAll('.madder-home, .site-footer-slim a')
            .forEach(function (link) {
                link.addEventListener("click", function (e) {
                    const href = link.getAttribute("href");
                    const target = link.getAttribute("target");
                    /* If gate would be a no-op (web context or already
                       unlocked), let the browser handle the click
                       natively — preserves middle-click open-in-tab,
                       cmd-click, etc. */
                    if (!isStandaloneOrNative() || isGateUnlocked()) return;
                    e.preventDefault();
                    parentGate("external-link", function () {
                        if (target) window.open(href, target);
                        else        window.location.href = href;
                    });
                });
            });

        /* Default tool selection. State is pre-initialized at the top
           of the IIFE; this just syncs the DOM after the builders ran. */
        refreshToolButtons();
        rebuildSizeButtons();
        refreshPaletteActive();
        syncSettingsUI();

        /* Kick off auto-save once everything is wired. */
        startAutosave();

        /* Native shell setup — no-op on web. Splash hide is slightly
           delayed so the first webview frame paints before the splash
           fades. Capacitor's capacitor.config.json launchShowDuration:
           1200 covers the case where init takes longer than expected. */
        setupStatusBar();
        setTimeout(hideSplashScreen, 400);

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

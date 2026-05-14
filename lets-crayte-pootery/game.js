/* ============================================================
   Let's CRAYte! Pootery — main script
   ============================================================
   Single IIFE. Chunk 1 covers the title screen + screen-switching
   scaffold. Chunks 2-3 (shape + decorate) bolt onto SCREENS via
   registerScreen() and the SCREENS map. Chunks 5-6 add KILN +
   GALLERY the same way.
   ============================================================ */

(function () {
    "use strict";

    /* ---------- 0. AUDIO BOOTSTRAP ----------
       Single shared AudioContext. Web Audio requires a user
       gesture to start; we lazy-create on the first gesture
       anywhere on the page, then any sound function can call
       ensureAudio() to get the context (returns null if creation
       failed or the context is still suspended — sound funcs
       must no-op silently in that case). KILN, SHAPE, and the
       title-screen poot all route through here.                */

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
        } catch (e) {
            audioCtx = null;
        }
        return audioCtx;
    }

    /* First user gesture anywhere on the page unlocks audio. */
    function unlockAudioOnce() {
        ensureAudio();
        document.removeEventListener("pointerdown", unlockAudioOnce, true);
        document.removeEventListener("keydown",     unlockAudioOnce, true);
    }
    document.addEventListener("pointerdown", unlockAudioOnce, true);
    document.addEventListener("keydown",     unlockAudioOnce, true);

    /* "Poot" — short, low, farty sawtooth blip with a tiny pitch
       wobble and a band-pass to round off the buzz. Used on the
       title screen, synced to the clay-drifter animation cycle. */
    function poot() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.exponentialRampToValueAtTime(58, now + 0.28);

        /* Pitch wobble for the comedic farty character. */
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 17;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 7;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        /* Band-pass shapes it into "poot" not "buzz". */
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 200;
        bp.Q.value = 3.5;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0,    now);
        g.gain.linearRampToValueAtTime(0.13, now + 0.025);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

        osc.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.34);
        lfo.start(now);
        lfo.stop(now + 0.34);
    }

    /* Wet-clay sustain — low-pass-filtered noise with an LFO
       riding the cutoff. Subtle, sits under the squelch pops.   */
    let wetLoop = null;

    function wetLoopStart() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        if (wetLoop) return;

        const len = Math.floor(ctx.sampleRate * 0.5);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        /* Pink-ish noise via Voss-McCartney-style filter. */
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + w * 0.0990460;
            b1 = 0.96300 * b1 + w * 0.2965164;
            b2 = 0.57000 * b2 + w * 1.0526913;
            data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.13;
        }

        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 480;
        lp.Q.value = 3.5;

        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 2.2;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 260;
        lfo.connect(lfoGain);
        lfoGain.connect(lp.frequency);

        const g = ctx.createGain();
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.08, now + 0.10);

        src.connect(lp);
        lp.connect(g);
        g.connect(ctx.destination);
        src.start(now);
        lfo.start(now);

        wetLoop = { src: src, lfo: lfo, g: g, ctx: ctx };
    }

    function wetLoopStop() {
        if (!wetLoop) return;
        const { src, lfo, g, ctx } = wetLoop;
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.18);
        try { src.stop(now + 0.20); } catch (_) {}
        try { lfo.stop(now + 0.20); } catch (_) {}
        wetLoop = null;
    }

    /* Squelch — short pitched noise pop, swept band-pass. Fires
       on actual clay deformation; throttled in applyShaping so
       a sustained drag emits one every ~90-160ms.              */
    function squelch() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;

        const len = Math.floor(ctx.sampleRate * 0.09);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.exp(-i / len * 4.5);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;

        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        const startF = 420 + Math.random() * 260;
        const endF   = startF * (0.45 + Math.random() * 0.25);
        bp.frequency.setValueAtTime(startF, now);
        bp.frequency.exponentialRampToValueAtTime(endF, now + 0.075);
        bp.Q.value = 6;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0,    now);
        g.gain.linearRampToValueAtTime(0.09, now + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.10);

        src.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        src.start(now);
    }

    /* ---------- 1. SCREEN ROUTER ----------
       Screens are <main class="screen" id="screen-{id}">. Showing
       one hides the others. Each screen optionally registers an
       onEnter / onLeave hook via registerScreen(). The body's
       class swaps in lockstep so screen-specific CSS can hook.   */

    const SCREENS = Object.create(null);

    function registerScreen(id, hooks) {
        SCREENS[id] = Object.assign(
            { onEnter: null, onLeave: null },
            hooks || {}
        );
    }

    let currentScreen = "title";

    function showScreen(id) {
        const target = document.getElementById("screen-" + id);
        if (!target) {
            console.warn("[CRAYte] no screen:", id);
            return;
        }

        const prev = SCREENS[currentScreen];
        if (prev && typeof prev.onLeave === "function") {
            try { prev.onLeave(); }
            catch (e) { console.error("[CRAYte] onLeave " + currentScreen, e); }
        }

        document.querySelectorAll("main.screen").forEach(function (el) {
            el.hidden = true;
        });
        target.hidden = false;

        document.body.classList.remove("screen-" + currentScreen);
        document.body.classList.add("screen-" + id);
        currentScreen = id;

        const next = SCREENS[id];
        if (next && typeof next.onEnter === "function") {
            try { next.onEnter(); }
            catch (e) { console.error("[CRAYte] onEnter " + id, e); }
        }

        window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }

    /* ---------- 2. TITLE SCREEN ---------- */

    registerScreen("title", {
        onEnter: function () {
            startClock();
            startTitlePoot();
        },
        onLeave: function () {
            stopClock();
            stopTitlePoot();
        }
    });

    /* ---------- 2A. TITLE POOT ----------
       The clay-drifter CSS animation is a 14s loop with peak
       visibility around the 50% mark. We schedule a poot at
       ~7s into each cycle so it sounds like the particle is
       making the noise. If audio isn't unlocked yet, poot()
       no-ops silently; the first time it does fire, the user
       has already interacted somewhere so audio is alive.   */

    const TITLE_POOT = {
        firstT: null,    /* setTimeout — initial offset */
        intervalT: null  /* setInterval — repeating cycle */
    };

    function startTitlePoot() {
        stopTitlePoot();
        TITLE_POOT.firstT = setTimeout(function () {
            poot();
            TITLE_POOT.intervalT = setInterval(poot, 14000);
        }, 7000);
    }

    function stopTitlePoot() {
        if (TITLE_POOT.firstT)    clearTimeout(TITLE_POOT.firstT);
        if (TITLE_POOT.intervalT) clearInterval(TITLE_POOT.intervalT);
        TITLE_POOT.firstT = null;
        TITLE_POOT.intervalT = null;
    }

    function initTitle() {
        const btnStart    = document.getElementById("btnStart");
        const btnGallery  = document.getElementById("btnGallery");
        const btnSettings = document.getElementById("btnSettings");

        if (btnStart) {
            btnStart.addEventListener("click", function () {
                /* Chunk 2 mounts #screen-shape and showScreen("shape")
                   becomes the real handoff. For chunk 1, give the user
                   honest, in-character feedback that this is coming. */
                if (SCREENS["shape"]) {
                    showScreen("shape");
                } else {
                    flashStub(btnStart, "WHEEL BOOTING...");
                }
            });
        }

        if (btnGallery) {
            btnGallery.addEventListener("click", function () {
                if (SCREENS["gallery"]) {
                    showScreen("gallery");
                } else {
                    flashStub(btnGallery, "NO POTS YET");
                }
            });
        }

        if (btnSettings) {
            btnSettings.addEventListener("click", function () {
                if (SCREENS["settings"]) {
                    showScreen("settings");
                } else {
                    flashStub(btnSettings, "COMING SOON");
                }
            });
        }

        wireSpecsPanel();
    }

    /* Temporary "feature not built yet" feedback. Swaps the button
       label for a beat. Removed once chunks 2-3 wire real screens. */
    function flashStub(btn, msg) {
        const label = btn.querySelector(".btn-label");
        if (!label) return;
        if (btn._stubT) clearTimeout(btn._stubT);
        const original = label.dataset.orig || label.textContent;
        label.dataset.orig = original;
        label.textContent = msg;
        btn.classList.add("is-stub");
        btn._stubT = setTimeout(function () {
            label.textContent = original;
            btn.classList.remove("is-stub");
        }, 1100);
    }

    /* ---------- 3. SPECS PANEL ----------
       Easter-egg payload (chunk 8) lives here. The opener is the
       small [?] in the corner. Chunk 1 ships the panel itself so
       there's already something to find; chunk 8 layers Konami /
       overheat / PINGAS on top.                                  */

    function wireSpecsPanel() {
        const hook  = document.getElementById("specsHook");
        const panel = document.getElementById("specsPanel");
        const close = document.getElementById("specsClose");
        if (!hook || !panel || !close) return;

        function open() {
            panel.hidden = false;
            document.body.classList.add("specs-open");
            close.focus({ preventScroll: true });
        }
        function shut() {
            panel.hidden = true;
            document.body.classList.remove("specs-open");
            hook.focus({ preventScroll: true });
        }

        hook.addEventListener("click", open);
        close.addEventListener("click", shut);

        panel.addEventListener("click", function (e) {
            if (e.target === panel) shut();
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !panel.hidden) shut();
        });
    }

    /* ---------- 4. CRT CLOCK ----------
       The HH:MM:SS in the top bar. Only ticks while a screen that
       requests it is mounted. Title screen does; in-game screens
       in later chunks may want to suppress it.                   */

    let clockTimer = null;

    function tickClock() {
        const el = document.getElementById("crtClock");
        if (!el) return;
        const d = new Date();
        const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
        el.textContent =
            pad(d.getHours()) + ":" +
            pad(d.getMinutes()) + ":" +
            pad(d.getSeconds());
    }

    function startClock() {
        tickClock();
        if (clockTimer) return;
        clockTimer = setInterval(tickClock, 1000);
    }

    function stopClock() {
        if (!clockTimer) return;
        clearInterval(clockTimer);
        clockTimer = null;
    }

    /* ============================================================
       SHAPE SCREEN — chunk 2: wheel-throwing
       ============================================================
       Model: a 1-D array of sample points along the pot's vertical
       axis. Each sample stores (y, radius). The renderer draws the
       right side of the silhouette by walking the samples bottom
       -> top, then mirrors back down the left side to close the
       path. The pot looks 3-D thanks to a horizontal clay-tone
       gradient + a vertical highlight strip near the centerline.

       Input model: pointer x position relative to the centerline =
       target radius for the slice nearest the pointer's y. A
       gaussian kernel pulls neighboring slices proportionally so
       the deformation is smooth, not a pinch. Each frame eases
       toward the target by SHAPE.EASE (frame-rate independent).

       Real wheel rotation isn't visible on a symmetric clay form,
       so we sell rotation via animated wedges on the wheel platform.
       ============================================================ */

    const SHAPE = {
        /* Logical canvas size. Display scales via CSS aspect-ratio;
           backing store is W*dpr × H*dpr. */
        W: 400,
        H: 600,
        centerX: 200,
        baseY:  510,    /* pot base sits here, on the wheel */
        topY:   95,     /* fully-extended pot rim height */

        /* Sample model */
        N:      28,
        MIN_R:  20,     /* clay can't pinch to nothing */
        MAX_R:  128,    /* clay can't escape the canvas */
        INIT_R: 72,     /* starting cylinder radius */

        /* Shaping behavior */
        KERNEL_SIGMA: 2.4,   /* gaussian spread (in sample-index units) */
        KERNEL_CUT:   0.06,  /* below this weight, skip the slice */
        EASE:         0.30,  /* per-16.67-ms ease factor */

        /* Wheel */
        WHEEL_RPM: 26,

        /* Particles */
        PART_GRAV: 0.00045,
        PART_LIFE: 700,
        PART_MAX:  90,

        /* Runtime */
        canvas: null,
        ctx: null,
        dpr: 1,
        clay: null,
        clayLocked: false,    /* FINISH FORM flips this — input ignored */

        pointer: null,        /* {x, y} in logical coords, or null */
        pointerActive: false,
        pointerLastX: 0,      /* used to detect "actually shaping" */
        pointerLastY: 0,

        particles: [],
        wheelPhase: 0,
        lastT: 0,
        rafId: null,
        running: false,
        shapeInited: false
    };

    /* ----- 5A. Init (lazy on first onEnter) ----- */

    function initShape() {
        const canvas = document.getElementById("shapeCanvas");
        if (!canvas) {
            console.warn("[CRAYte] no #shapeCanvas");
            return;
        }
        SHAPE.canvas = canvas;
        SHAPE.ctx = canvas.getContext("2d");
        sizeShapeCanvas();
        resetClay();
        attachShapePointer();
        wireShapeButtons();

        /* DPR can change on display swap. Re-size when the canvas
           is reflowed (cheap — only rebuilds the backing store). */
        if (typeof ResizeObserver === "function") {
            const ro = new ResizeObserver(function () { sizeShapeCanvas(); });
            ro.observe(canvas);
        }
    }

    function sizeShapeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        SHAPE.dpr = dpr;
        const c = SHAPE.canvas;
        const bw = Math.round(SHAPE.W * dpr);
        const bh = Math.round(SHAPE.H * dpr);
        if (c.width !== bw)  c.width  = bw;
        if (c.height !== bh) c.height = bh;
        /* setTransform also resets — so coords stay in logical 400×600 space. */
        SHAPE.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resetClay() {
        const arr = new Array(SHAPE.N);
        const span = SHAPE.baseY - SHAPE.topY;
        for (let i = 0; i < SHAPE.N; i++) {
            const t = i / (SHAPE.N - 1);
            arr[i] = {
                /* i=0 at base (high y), i=N-1 at rim (low y) */
                y: SHAPE.baseY - t * span,
                radius: SHAPE.INIT_R
            };
        }
        SHAPE.clay = arr;
        SHAPE.clayLocked = false;
        SHAPE.particles.length = 0;
    }

    /* ----- 5B. Pointer input ----- */

    function shapePointerPos(e) {
        const r = SHAPE.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * SHAPE.W / r.width,
            y: (e.clientY - r.top)  * SHAPE.H / r.height
        };
    }

    function attachShapePointer() {
        const c = SHAPE.canvas;

        c.addEventListener("pointerdown", function (e) {
            if (SHAPE.clayLocked) return;
            e.preventDefault();
            try { c.setPointerCapture(e.pointerId); } catch (_) {}
            const p = shapePointerPos(e);
            SHAPE.pointer = p;
            SHAPE.pointerLastX = p.x;
            SHAPE.pointerLastY = p.y;
            SHAPE.pointerActive = true;
            wetLoopStart();   /* sustained wet hum under the squelches */
        });

        c.addEventListener("pointermove", function (e) {
            if (!SHAPE.pointerActive) return;
            SHAPE.pointer = shapePointerPos(e);
        });

        function endPointer(e) {
            if (!SHAPE.pointerActive) return;
            SHAPE.pointerActive = false;
            SHAPE.pointer = null;
            try { c.releasePointerCapture(e.pointerId); } catch (_) {}
            wetLoopStop();
        }
        c.addEventListener("pointerup",     endPointer);
        c.addEventListener("pointercancel", endPointer);
        c.addEventListener("pointerleave",  endPointer);
    }

    /* ----- 5C. Buttons ----- */

    function wireShapeButtons() {
        const back   = document.getElementById("shapeBack");
        const reset  = document.getElementById("shapeReset");
        const finish = document.getElementById("shapeFinish");

        if (back) back.addEventListener("click", function () {
            showScreen("title");
        });

        if (reset) reset.addEventListener("click", function () {
            resetClay();
            flashButton(reset);
        });

        if (finish) finish.addEventListener("click", function () {
            SHAPE.clayLocked = true;
            flashButton(finish);
            if (SCREENS["decorate"]) {
                showScreen("decorate");
            } else {
                flashStub(finish, "KILN HEATING...");
                /* Unlock so user can keep playing while chunk 3 is pending. */
                setTimeout(function () { SHAPE.clayLocked = false; }, 1100);
            }
        });
    }

    function flashButton(btn) {
        btn.classList.add("is-flash");
        setTimeout(function () { btn.classList.remove("is-flash"); }, 220);
    }

    /* ----- 5D. Shape deformation (per-frame) ----- */

    function applyShaping(p, dt) {
        const clay = SHAPE.clay;
        const N = clay.length;

        /* Map pointer y to a sample-index domain. Outside the pot's
           vertical zone? Don't deform. */
        const span = SHAPE.baseY - SHAPE.topY;
        const t = (SHAPE.baseY - p.y) / span;
        if (t < -0.05 || t > 1.05) return false;
        const centerIdx = Math.max(0, Math.min(N - 1, t * (N - 1)));

        /* Target radius = pointer's horizontal distance from centerline.
           Allow targets a touch under MIN_R so a hard pinch still feels
           like it's biting; clamp below. */
        const targetR = Math.max(SHAPE.MIN_R - 4,
                                 Math.min(SHAPE.MAX_R + 10,
                                          Math.abs(p.x - SHAPE.centerX)));

        const sigma2 = 2 * SHAPE.KERNEL_SIGMA * SHAPE.KERNEL_SIGMA;
        /* Frame-rate independent ease: at 60fps with EASE=0.30, ~30%
           per frame; at 30fps, ~52% per frame; both feel the same. */
        const ease = 1 - Math.pow(1 - SHAPE.EASE, dt / 16.67);

        let didShape = false;
        for (let i = 0; i < N; i++) {
            const d = i - centerIdx;
            const w = Math.exp(-d * d / sigma2);
            if (w < SHAPE.KERNEL_CUT) continue;
            /* desired pulls slice toward targetR weighted by kernel,
               then we ease toward that desired over the frame. */
            const desired = clay[i].radius + (targetR - clay[i].radius) * w;
            const next = clay[i].radius + (desired - clay[i].radius) * ease;
            const clamped = Math.max(SHAPE.MIN_R, Math.min(SHAPE.MAX_R, next));
            if (Math.abs(clamped - clay[i].radius) > 0.04) didShape = true;
            clay[i].radius = clamped;
        }
        return didShape;
    }

    /* ----- 5E. Clay-shaving particles ----- */

    function emitParticles(p) {
        if (SHAPE.particles.length >= SHAPE.PART_MAX) return;
        /* Sparse — most pointer-moves emit nothing, so the field
           looks like the occasional flake instead of a stream. */
        if (Math.random() > 0.35) return;
        const sign = (p.x >= SHAPE.centerX) ? 1 : -1;
        const count = 1 + (Math.random() < 0.35 ? 1 : 0);
        for (let i = 0; i < count; i++) {
            SHAPE.particles.push({
                x: p.x + (Math.random() - 0.5) * 6,
                y: p.y + (Math.random() - 0.5) * 4,
                vx: sign * (0.05 + Math.random() * 0.06),
                vy: -0.07 - Math.random() * 0.05,
                life: SHAPE.PART_LIFE * (0.7 + Math.random() * 0.6),
                age: 0,
                size: 1.4 + Math.random() * 1.9,
                /* Vary brown tones a bit for warmth. */
                hue: 22 + Math.random() * 14,
                lit: 28 + Math.random() * 18
            });
        }
    }

    function updateParticles(dt) {
        const parts = SHAPE.particles;
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.age += dt;
            if (p.age >= p.life) {
                parts.splice(i, 1);
                continue;
            }
            p.vy += SHAPE.PART_GRAV * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;
        }
    }

    /* ----- 5F. Render ----- */

    /* Shared by SHAPE, DECORATE, and KILN. All three render the same
       pot from SHAPE.clay; decorate composites a paint layer, kiln
       additionally applies a "fired" warm overlay + can suppress its
       own backdrop so the kiln's chrome wraps the scene.            */
    function renderPotScene(ctx, opts) {
        opts = opts || {};

        if (opts.background !== false) {
            ctx.fillStyle = "#0c1f25";
            ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
            drawShapeBackdrop(ctx);
        }

        /* Wheel platform — drawn first so the pot covers the front
           half, leaving the back rim visible as an arc. */
        if (opts.wheel !== false) drawWheel(ctx);

        /* Pot silhouette + 3-D shading */
        drawPot(ctx);

        /* Paint layer (decorate mode) — clipped to the pot silhouette
           so strokes outside the body never show. */
        if (opts.paintCanvas) {
            ctx.save();
            buildPotPath(ctx);
            ctx.clip();
            ctx.drawImage(opts.paintCanvas, 0, 0, SHAPE.W, SHAPE.H);
            ctx.restore();
        }

        /* Fired overlay — warm-tone "overlay" composite that pumps
           midtone saturation and shifts toward kiln-orange. Brief
           calls for "deeper / richer glaze color (slight color shift
           to suggest firing has set the glaze)." Clipped to pot. */
        if (opts.fired) {
            ctx.save();
            buildPotPath(ctx);
            ctx.clip();
            ctx.globalCompositeOperation = "overlay";
            ctx.fillStyle = "rgba(180, 70, 22, 0.20)";
            ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
            ctx.globalCompositeOperation = "source-over";
            /* Subtle gloss highlight on top to feel "vitrified" */
            const g = ctx.createLinearGradient(0, 80, 0, 510);
            g.addColorStop(0,    "rgba(255, 245, 220, 0.10)");
            g.addColorStop(0.35, "rgba(255, 245, 220, 0.00)");
            g.addColorStop(1,    "rgba(0, 0, 0, 0.12)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
            ctx.restore();
        }

        /* Rim opening on top — drawn AFTER paint so the rim ring
           stays visible even with a painted pot. */
        drawRim(ctx);

        /* Particles last so they're on top. Decorate disables. */
        if (opts.particles !== false) drawParticles(ctx);

        /* Decorative HUD ticks in the corners — onioncore polish */
        if (opts.corners !== false) drawCornerTicks(ctx);
    }

    /* Back-compat alias used by SHAPE's frame loop. */
    function renderShape() { renderPotScene(SHAPE.ctx); }

    function drawShapeBackdrop(ctx) {
        /* Faint vertical gradient — top a touch lighter than bottom
           to suggest a soft light from above. */
        const g = ctx.createLinearGradient(0, 0, 0, SHAPE.H);
        g.addColorStop(0,    "rgba(0, 255, 204, 0.06)");
        g.addColorStop(0.6,  "rgba(0, 0, 0, 0)");
        g.addColorStop(1,    "rgba(0, 0, 0, 0.35)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);

        /* Centerline guide — very faint, helps the eye see the axis */
        ctx.strokeStyle = "rgba(0, 255, 204, 0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(SHAPE.centerX, 30);
        ctx.lineTo(SHAPE.centerX, SHAPE.baseY);
        ctx.stroke();
    }

    function drawWheel(ctx) {
        const cx = SHAPE.centerX;
        const cy = SHAPE.baseY;
        const rx = 150;
        const ry = 22;

        /* Disc body */
        const disc = ctx.createLinearGradient(cx - rx, cy, cx + rx, cy);
        disc.addColorStop(0,    "#0d2228");
        disc.addColorStop(0.5,  "#2a626c");
        disc.addColorStop(1,    "#0d2228");
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = disc;
        ctx.fill();

        /* Rotating wedges — sells the spin without literally rotating
           the symmetric pot. Six wedges, alternating light/dark. */
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 2, ry - 2, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        ctx.rotate(SHAPE.wheelPhase);
        const segs = 6;
        for (let i = 0; i < segs; i++) {
            const a0 = (i / segs) * Math.PI * 2;
            const a1 = ((i + 1) / segs) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, rx, a0, a1);
            ctx.closePath();
            ctx.fillStyle = (i % 2 === 0)
                ? "rgba(255, 255, 255, 0.05)"
                : "rgba(0, 0, 0, 0.18)";
            ctx.fill();
        }
        ctx.restore();

        /* Rim ring */
        ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        /* Subtle highlight stripe on the front edge */
        ctx.strokeStyle = "rgba(0, 255, 204, 0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0.1, Math.PI - 0.1);
        ctx.stroke();
    }

    function buildPotPath(ctx) {
        /* Right side bottom -> top with midpoint-quadratic smoothing,
           lineTo across the rim, left side top -> bottom smoothed,
           lineTo across the base. */
        const cx = SHAPE.centerX;
        const clay = SHAPE.clay;
        const N = clay.length;

        ctx.beginPath();
        ctx.moveTo(cx + clay[0].radius, clay[0].y);
        for (let i = 1; i < N - 1; i++) {
            const xc = cx + (clay[i].radius + clay[i + 1].radius) * 0.5;
            const yc = (clay[i].y + clay[i + 1].y) * 0.5;
            ctx.quadraticCurveTo(cx + clay[i].radius, clay[i].y, xc, yc);
        }
        ctx.lineTo(cx + clay[N - 1].radius, clay[N - 1].y);
        ctx.lineTo(cx - clay[N - 1].radius, clay[N - 1].y);
        for (let i = N - 2; i > 0; i--) {
            const xc = cx - (clay[i].radius + clay[i - 1].radius) * 0.5;
            const yc = (clay[i].y + clay[i - 1].y) * 0.5;
            ctx.quadraticCurveTo(cx - clay[i].radius, clay[i].y, xc, yc);
        }
        ctx.lineTo(cx - clay[0].radius, clay[0].y);
        ctx.closePath();
    }

    function drawPot(ctx) {
        const cx = SHAPE.centerX;
        const clay = SHAPE.clay;
        const N = clay.length;

        /* Compute current max radius (for gradient stops). */
        let maxR = 0;
        for (let i = 0; i < N; i++) {
            if (clay[i].radius > maxR) maxR = clay[i].radius;
        }
        if (maxR < 1) maxR = 1;

        /* Soft shadow under the pot */
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.beginPath();
        ctx.ellipse(cx, SHAPE.baseY + 6, maxR * 1.05, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        /* Fill pot body */
        buildPotPath(ctx);

        const grad = ctx.createLinearGradient(cx - maxR, 0, cx + maxR, 0);
        grad.addColorStop(0.00, "#2c1306");
        grad.addColorStop(0.18, "#5a2b14");
        grad.addColorStop(0.42, "#a25a2c");
        grad.addColorStop(0.55, "#b06a36");
        grad.addColorStop(0.78, "#7a3d1a");
        grad.addColorStop(1.00, "#2c1306");
        ctx.fillStyle = grad;
        ctx.fill();

        /* Highlight strip near the centerline (offset slightly left to
           sell light coming from the upper-left). */
        ctx.save();
        buildPotPath(ctx);
        ctx.clip();
        const hl = ctx.createLinearGradient(cx - 36, 0, cx + 14, 0);
        hl.addColorStop(0,   "rgba(255, 224, 184, 0)");
        hl.addColorStop(0.5, "rgba(255, 224, 184, 0.34)");
        hl.addColorStop(1,   "rgba(255, 224, 184, 0)");
        ctx.fillStyle = hl;
        ctx.fillRect(cx - 40, clay[N - 1].y - 4, 60, SHAPE.baseY - clay[N - 1].y + 14);

        /* Faint horizontal throwing rings (potter's mark) — only
           visible where the clay catches the light. */
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 0.6;
        const ringStep = 16;
        for (let y = clay[N - 1].y + 12; y < SHAPE.baseY - 4; y += ringStep) {
            ctx.beginPath();
            ctx.moveTo(cx - maxR, y);
            ctx.lineTo(cx + maxR, y);
            ctx.stroke();
        }
        ctx.restore();

        /* Outline */
        buildPotPath(ctx);
        ctx.strokeStyle = "#1f0a02";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    function drawRim(ctx) {
        const cx = SHAPE.centerX;
        const top = SHAPE.clay[SHAPE.N - 1];

        /* Inner cavity (the dark hole at the top of the pot) */
        ctx.beginPath();
        ctx.ellipse(cx, top.y, top.radius - 3, (top.radius - 3) * 0.20,
                    0, 0, Math.PI * 2);
        ctx.fillStyle = "#1a0904";
        ctx.fill();

        /* Highlight on the back of the rim */
        ctx.strokeStyle = "rgba(255, 200, 150, 0.45)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(cx, top.y - 0.5, top.radius - 3, (top.radius - 3) * 0.20,
                    0, Math.PI + 0.1, Math.PI * 2 - 0.1);
        ctx.stroke();

        /* Slight rim thickness (outer ellipse stroke) */
        ctx.strokeStyle = "rgba(60, 24, 6, 0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, top.y, top.radius, top.radius * 0.20,
                    0, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawParticles(ctx) {
        const parts = SHAPE.particles;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            const t = p.age / p.life;
            const a = (1 - t) * 0.85;
            ctx.fillStyle = "hsla(" + p.hue + ", 55%, " + p.lit + "%, " + a + ")";
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawCornerTicks(ctx) {
        ctx.save();
        ctx.strokeStyle = "rgba(0, 255, 204, 0.25)";
        ctx.lineWidth = 1.5;
        const m = 10;
        const len = 14;
        const w = SHAPE.W;
        const h = SHAPE.H;
        ctx.beginPath();
        /* TL */ ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m);
        /* TR */ ctx.moveTo(w - m - len, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + len);
        /* BL */ ctx.moveTo(m, h - m - len); ctx.lineTo(m, h - m); ctx.lineTo(m + len, h - m);
        /* BR */ ctx.moveTo(w - m - len, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - len);
        ctx.stroke();
        ctx.restore();
    }

    /* ----- 5G. Main loop ----- */

    function shapeFrame(t) {
        if (!SHAPE.running) return;
        if (!SHAPE.lastT) SHAPE.lastT = t;
        const dt = Math.min(48, t - SHAPE.lastT); /* clamp dt for stability */
        SHAPE.lastT = t;

        /* Wheel spin */
        SHAPE.wheelPhase += (2 * Math.PI * SHAPE.WHEEL_RPM / 60) * (dt / 1000);
        if (SHAPE.wheelPhase > Math.PI * 2) SHAPE.wheelPhase -= Math.PI * 2;

        /* Shaping */
        if (SHAPE.pointerActive && SHAPE.pointer && !SHAPE.clayLocked) {
            const didShape = applyShaping(SHAPE.pointer, dt);
            if (didShape) {
                emitParticles(SHAPE.pointer);
                /* Throttled squelch — fires once every 90-160ms
                   while clay is actually being reshaped. */
                SHAPE.squelchT = (SHAPE.squelchT || 0) + dt;
                if (SHAPE.squelchT > 90 + Math.random() * 70) {
                    squelch();
                    SHAPE.squelchT = 0;
                }
            } else {
                SHAPE.squelchT = 0;
            }
        }

        updateParticles(dt);
        renderShape();
        SHAPE.rafId = requestAnimationFrame(shapeFrame);
    }

    function startShapeLoop() {
        if (SHAPE.running) return;
        SHAPE.running = true;
        SHAPE.lastT = 0;
        SHAPE.rafId = requestAnimationFrame(shapeFrame);
    }

    function stopShapeLoop() {
        SHAPE.running = false;
        if (SHAPE.rafId) cancelAnimationFrame(SHAPE.rafId);
        SHAPE.rafId = null;
    }

    /* ----- 5H. Register with the screen router ----- */

    registerScreen("shape", {
        onEnter: function () {
            if (!SHAPE.shapeInited) {
                initShape();
                SHAPE.shapeInited = true;
            } else {
                /* Ensure backing store matches current DPR after a
                   trip away from the screen. */
                sizeShapeCanvas();
            }
            startShapeLoop();
        },
        onLeave: function () {
            stopShapeLoop();
        }
    });

    /* Eager init: build the default cylinder before any screen
       mounts so renderPotScene has a clay array to read even if
       the user jumps to decorate without entering shape (e.g.,
       deep links via window.CRAYte.showScreen, future "load from
       gallery" paths). resetClay() is idempotent; initShape will
       re-run it from a clean state. */
    resetClay();

    /* ============================================================
       DECORATE SCREEN — chunk 3: brushes / glazes / stamps
       ============================================================
       Same pot from SHAPE.clay (locked). An offscreen paint canvas
       accumulates strokes / stamps; renderPotScene composites it
       clipped to the pot's silhouette so paint outside the body
       is never visible. Chunk 4 will add themed packs as new
       entries in GLAZE_PACKS without changing this layer.
       ============================================================ */

    /* ----- 6A. Stamp drawers + helpers -----
       Each pattern is a function (ctx, x, y, r, c) that draws
       itself at (x, y) with radius r and ink/fill color c. The
       same drawers are used for on-canvas stamping AND for the
       mini palette icons.

       Helpers below are shared by the themed-pack stamps (chunk
       4 adds 23 more drawers — silhouettes, pixel art, text
       labels, circuit traces). Keep them generic.               */

    function roundedRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /* Tint a hex color lighter (amt > 0) or darker (amt < 0).
       amt is a [-1, 1] fraction; non-hex inputs pass through. */
    function shiftColor(hex, amt) {
        if (typeof hex !== "string" || hex.charAt(0) !== "#") return hex;
        let h = hex.slice(1);
        if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
        if (h.length !== 6) return hex;
        let r = parseInt(h.slice(0, 2), 16);
        let g = parseInt(h.slice(2, 4), 16);
        let b = parseInt(h.slice(4, 6), 16);
        const pad = function (v) {
            v = Math.max(0, Math.min(255, Math.round(v)));
            return (v < 16 ? "0" : "") + v.toString(16);
        };
        if (amt >= 0) {
            r += (255 - r) * amt;
            g += (255 - g) * amt;
            b += (255 - b) * amt;
        } else {
            r *= (1 + amt);
            g *= (1 + amt);
            b *= (1 + amt);
        }
        return "#" + pad(r) + pad(g) + pad(b);
    }

    /* Text in a chunky framed box — used by GOOD BOY, POWER,
       GAME OVER, PRESS START stamps. Bungee is the title font
       (already in <head>); fallback chain keeps it chunky. */
    function textStamp(ctx, x, y, r, color, text, opts) {
        opts = opts || {};
        const fontSize  = (opts.fontSize || 0.42) * r;
        const fontStack = opts.fontFamily ||
            '"Bungee", "Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif';
        ctx.save();
        ctx.font = fontSize + "px " + fontStack;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(text).width;
        const padX = r * 0.18;
        const padY = r * 0.12;
        const w = tw + padX * 2;
        const h = fontSize + padY * 2;
        ctx.fillStyle = "#000";
        roundedRect(ctx, x - w / 2, y - h / 2, w, h, h * 0.22);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, r * 0.06);
        roundedRect(ctx, x - w / 2 + 1, y - h / 2 + 1, w - 2, h - 2, h * 0.22);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(text, x, y + 1);
        ctx.restore();
    }

    /* Rasterized pixel art — used by pixel-heart, pixel-skull,
       cloud-8bit. Cell size scales with stamp radius.         */
    function pixelGrid(ctx, x, y, color, grid, cell) {
        const rows = grid.length;
        const cols = grid[0].length;
        const ox = x - (cols * cell) / 2;
        const oy = y - (rows * cell) / 2;
        ctx.fillStyle = color;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c]) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
            }
        }
    }
    const PATTERN_DRAWERS = {
        dot: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
            ctx.fill();
        },
        ring: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.32);
            ctx.beginPath();
            ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
            ctx.stroke();
        },
        star: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
                const rad = (i % 2 === 0) ? r : r * 0.42;
                const px = x + Math.cos(a) * rad;
                const py = y + Math.sin(a) * rad;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        },
        chevron: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.32);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(x - r * 0.9, y + r * 0.35);
            ctx.lineTo(x, y - r * 0.35);
            ctx.lineTo(x + r * 0.9, y + r * 0.35);
            ctx.stroke();
        },
        wave: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.30);
            ctx.lineCap = "round";
            ctx.beginPath();
            const steps = 18;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const px = x - r + t * 2 * r;
                const py = y + Math.sin(t * Math.PI * 2) * r * 0.42;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        },
        triangle: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(x, y - r * 0.85);
            ctx.lineTo(x + r * 0.74, y + r * 0.45);
            ctx.lineTo(x - r * 0.74, y + r * 0.45);
            ctx.closePath();
            ctx.fill();
        },
        x: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.30);
            ctx.lineCap = "round";
            const k = r * 0.65;
            ctx.beginPath();
            ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
            ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
            ctx.stroke();
        },
        heart: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            const top = y - r * 0.35;
            ctx.moveTo(x, top + r * 0.30);
            ctx.bezierCurveTo(x, top - r * 0.15,
                              x - r * 0.95, top - r * 0.05,
                              x - r * 0.95, top + r * 0.50);
            ctx.bezierCurveTo(x - r * 0.95, top + r * 0.95,
                              x - r * 0.40, top + r * 1.05,
                              x, y + r * 0.70);
            ctx.bezierCurveTo(x + r * 0.40, top + r * 1.05,
                              x + r * 0.95, top + r * 0.95,
                              x + r * 0.95, top + r * 0.50);
            ctx.bezierCurveTo(x + r * 0.95, top - r * 0.05,
                              x, top - r * 0.15,
                              x, top + r * 0.30);
            ctx.fill();
        },

        /* ===== CANDY pack ===== */
        lollipop: function (ctx, x, y, r, c) {
            /* stick */
            ctx.strokeStyle = "#f4f4ea";
            ctx.lineWidth = Math.max(2, r * 0.14);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x, y + r * 0.10);
            ctx.lineTo(x, y + r * 0.95);
            ctx.stroke();
            /* candy disc */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y - r * 0.20, r * 0.62, 0, Math.PI * 2);
            ctx.fill();
            /* swirl */
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = Math.max(1.4, r * 0.10);
            ctx.lineCap = "round";
            ctx.beginPath();
            for (let t = 0; t < Math.PI * 4; t += 0.18) {
                const rad = 1.5 + t * r * 0.06;
                const px = x + Math.cos(t) * rad;
                const py = y - r * 0.20 + Math.sin(t) * rad;
                if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        },

        "candy-cane": function (ctx, x, y, r, c) {
            ctx.save();
            ctx.fillStyle = "#fff";
            roundedRect(ctx, x - r * 0.30, y - r * 0.90,
                        r * 0.60, r * 1.80, r * 0.18);
            ctx.fill();
            ctx.clip();
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.20);
            for (let i = -3; i <= 5; i++) {
                ctx.beginPath();
                ctx.moveTo(x - r + i * r * 0.45, y - r);
                ctx.lineTo(x + r + i * r * 0.45, y + r);
                ctx.stroke();
            }
            ctx.restore();
            /* dark outline for definition */
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = Math.max(1, r * 0.05);
            roundedRect(ctx, x - r * 0.30, y - r * 0.90,
                        r * 0.60, r * 1.80, r * 0.18);
            ctx.stroke();
        },

        gumballs: function (ctx, x, y, r, c) {
            /* cluster of 5 gumballs in slightly varied tints */
            const spots = [
                [ 0.00,  0.00, 0.42, c],
                [-0.55, -0.40, 0.28, shiftColor(c,  0.18)],
                [ 0.55, -0.40, 0.28, shiftColor(c, -0.18)],
                [-0.50,  0.45, 0.28, shiftColor(c,  0.28)],
                [ 0.50,  0.45, 0.28, shiftColor(c, -0.10)]
            ];
            for (let i = 0; i < spots.length; i++) {
                const s = spots[i];
                ctx.fillStyle = s[3];
                ctx.beginPath();
                ctx.arc(x + s[0] * r, y + s[1] * r, r * s[2], 0, Math.PI * 2);
                ctx.fill();
                /* highlight */
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.beginPath();
                ctx.arc(x + s[0] * r - r * s[2] * 0.35,
                        y + s[1] * r - r * s[2] * 0.35,
                        r * s[2] * 0.22, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        drip: function (ctx, x, y, r, c) {
            /* glaze drip — teardrop */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(x, y - r * 0.95);
            ctx.bezierCurveTo(x + r * 0.55, y - r * 0.40,
                              x + r * 0.65, y + r * 0.55,
                              x, y + r * 0.95);
            ctx.bezierCurveTo(x - r * 0.65, y + r * 0.55,
                              x - r * 0.55, y - r * 0.40,
                              x, y - r * 0.95);
            ctx.fill();
            /* shine */
            ctx.fillStyle = "rgba(255,255,255,0.42)";
            ctx.beginPath();
            ctx.ellipse(x - r * 0.18, y + r * 0.15, r * 0.10, r * 0.30,
                        -0.3, 0, Math.PI * 2);
            ctx.fill();
        },

        /* ===== PLUSHIE pack ===== */
        teddy: function (ctx, x, y, r, c) {
            const belly = shiftColor(c, 0.28);
            const dark  = shiftColor(c, -0.30);
            /* body */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y + r * 0.30, r * 0.55, 0, Math.PI * 2);
            ctx.fill();
            /* head */
            ctx.beginPath();
            ctx.arc(x, y - r * 0.35, r * 0.42, 0, Math.PI * 2);
            ctx.fill();
            /* ears */
            ctx.beginPath();
            ctx.arc(x - r * 0.38, y - r * 0.68, r * 0.18, 0, Math.PI * 2);
            ctx.arc(x + r * 0.38, y - r * 0.68, r * 0.18, 0, Math.PI * 2);
            ctx.fill();
            /* ear inners */
            ctx.fillStyle = belly;
            ctx.beginPath();
            ctx.arc(x - r * 0.38, y - r * 0.68, r * 0.10, 0, Math.PI * 2);
            ctx.arc(x + r * 0.38, y - r * 0.68, r * 0.10, 0, Math.PI * 2);
            ctx.fill();
            /* belly patch */
            ctx.beginPath();
            ctx.arc(x, y + r * 0.32, r * 0.34, 0, Math.PI * 2);
            ctx.fill();
            /* snout */
            ctx.fillStyle = belly;
            ctx.beginPath();
            ctx.arc(x, y - r * 0.22, r * 0.18, 0, Math.PI * 2);
            ctx.fill();
            /* eyes */
            ctx.fillStyle = "#1a0e08";
            ctx.beginPath();
            ctx.arc(x - r * 0.14, y - r * 0.42, r * 0.06, 0, Math.PI * 2);
            ctx.arc(x + r * 0.14, y - r * 0.42, r * 0.06, 0, Math.PI * 2);
            ctx.fill();
            /* nose */
            ctx.fillStyle = dark;
            ctx.beginPath();
            ctx.arc(x, y - r * 0.26, r * 0.05, 0, Math.PI * 2);
            ctx.fill();
        },

        paw: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            /* 4 toe beans */
            const toes = [
                [-0.38, -0.40, 0.18],
                [-0.12, -0.60, 0.18],
                [ 0.12, -0.60, 0.18],
                [ 0.38, -0.40, 0.18]
            ];
            for (let i = 0; i < toes.length; i++) {
                const t = toes[i];
                ctx.beginPath();
                ctx.arc(x + t[0] * r, y + t[1] * r, r * t[2], 0, Math.PI * 2);
                ctx.fill();
            }
            /* main pad — three-lobed */
            ctx.beginPath();
            ctx.moveTo(x - r * 0.42, y + r * 0.10);
            ctx.bezierCurveTo(x - r * 0.55, y + r * 0.30,
                              x - r * 0.35, y + r * 0.55,
                              x,            y + r * 0.50);
            ctx.bezierCurveTo(x + r * 0.35, y + r * 0.55,
                              x + r * 0.55, y + r * 0.30,
                              x + r * 0.42, y + r * 0.10);
            ctx.bezierCurveTo(x + r * 0.25, y - r * 0.05,
                              x - r * 0.25, y - r * 0.05,
                              x - r * 0.42, y + r * 0.10);
            ctx.fill();
        },

        button: function (ctx, x, y, r, c) {
            const dark = shiftColor(c, -0.35);
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
            ctx.fill();
            /* rim ring */
            ctx.strokeStyle = dark;
            ctx.lineWidth = Math.max(1, r * 0.07);
            ctx.beginPath();
            ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
            ctx.stroke();
            /* 4 thread holes */
            ctx.fillStyle = "#1a0e08";
            const holes = [[-0.18, -0.18], [0.18, -0.18],
                           [-0.18,  0.18], [0.18,  0.18]];
            for (let i = 0; i < holes.length; i++) {
                ctx.beginPath();
                ctx.arc(x + holes[i][0] * r, y + holes[i][1] * r,
                        r * 0.075, 0, Math.PI * 2);
                ctx.fill();
            }
            /* thread X */
            ctx.strokeStyle = "rgba(0,0,0,0.55)";
            ctx.lineWidth = Math.max(1, r * 0.04);
            ctx.beginPath();
            ctx.moveTo(x - r * 0.18, y - r * 0.18);
            ctx.lineTo(x + r * 0.18, y + r * 0.18);
            ctx.moveTo(x + r * 0.18, y - r * 0.18);
            ctx.lineTo(x - r * 0.18, y + r * 0.18);
            ctx.stroke();
        },

        "plush-grain": function (ctx, x, y, r, c) {
            /* soft cross-hatch — short fuzz tufts */
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(1, r * 0.06);
            ctx.lineCap = "round";
            for (let i = 0; i < 22; i++) {
                /* deterministic-ish positions via i for stability */
                const a = (i * 137.5) % 360 * Math.PI / 180;
                const rad = ((i * 41) % 80) / 100 * r * 0.85;
                const px = x + Math.cos(a) * rad;
                const py = y + Math.sin(a) * rad;
                const ang = (i * 29) % 180 * Math.PI / 180;
                const len = r * 0.18;
                ctx.beginPath();
                ctx.moveTo(px - Math.cos(ang) * len * 0.5,
                           py - Math.sin(ang) * len * 0.5);
                ctx.lineTo(px + Math.cos(ang) * len * 0.5,
                           py + Math.sin(ang) * len * 0.5);
                ctx.stroke();
            }
        },

        /* ===== GOOD DOG pack ===== */
        bone: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            /* shaft */
            roundedRect(ctx, x - r * 0.75, y - r * 0.18,
                        r * 1.50, r * 0.36, r * 0.10);
            ctx.fill();
            /* 4 bulb ends */
            const ends = [[-0.75, -0.30], [-0.75, 0.30],
                          [ 0.75, -0.30], [ 0.75, 0.30]];
            for (let i = 0; i < ends.length; i++) {
                ctx.beginPath();
                ctx.arc(x + ends[i][0] * r, y + ends[i][1] * r,
                        r * 0.30, 0, Math.PI * 2);
                ctx.fill();
            }
            /* subtle outline */
            ctx.strokeStyle = "rgba(0,0,0,0.35)";
            ctx.lineWidth = Math.max(1, r * 0.05);
            roundedRect(ctx, x - r * 0.75, y - r * 0.18,
                        r * 1.50, r * 0.36, r * 0.10);
            ctx.stroke();
        },

        doghouse: function (ctx, x, y, r, c) {
            ctx.save();
            /* body */
            ctx.fillStyle = c;
            roundedRect(ctx, x - r * 0.70, y - r * 0.10,
                        r * 1.40, r * 0.85, r * 0.05);
            ctx.fill();
            /* roof */
            ctx.fillStyle = shiftColor(c, -0.30);
            ctx.beginPath();
            ctx.moveTo(x - r * 0.85, y - r * 0.05);
            ctx.lineTo(x, y - r * 0.75);
            ctx.lineTo(x + r * 0.85, y - r * 0.05);
            ctx.closePath();
            ctx.fill();
            /* door (arched) — punch through */
            ctx.globalCompositeOperation = "destination-out";
            ctx.beginPath();
            ctx.arc(x, y + r * 0.40, r * 0.25, Math.PI, 0);
            ctx.lineTo(x + r * 0.25, y + r * 0.75);
            ctx.lineTo(x - r * 0.25, y + r * 0.75);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        },

        goodboy: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "GOOD BOY");
        },

        whosagoodboy: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "WHO'S A GOOD BOY?",
                      { fontSize: 0.28 });
        },

        dachshund: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            /* long body */
            ctx.beginPath();
            ctx.ellipse(x, y, r * 0.82, r * 0.26, 0, 0, Math.PI * 2);
            ctx.fill();
            /* head */
            ctx.beginPath();
            ctx.arc(x - r * 0.72, y - r * 0.12, r * 0.22, 0, Math.PI * 2);
            ctx.fill();
            /* snout */
            ctx.beginPath();
            ctx.ellipse(x - r * 0.92, y - r * 0.04,
                        r * 0.13, r * 0.09, 0, 0, Math.PI * 2);
            ctx.fill();
            /* droopy ear */
            ctx.fillStyle = shiftColor(c, -0.25);
            ctx.beginPath();
            ctx.ellipse(x - r * 0.65, y - r * 0.04,
                        r * 0.12, r * 0.20, -0.3, 0, Math.PI * 2);
            ctx.fill();
            /* 4 short legs */
            ctx.fillStyle = c;
            const legs = [-0.50, -0.18, 0.28, 0.58];
            for (let i = 0; i < legs.length; i++) {
                roundedRect(ctx, x + legs[i] * r - r * 0.06,
                            y + r * 0.18, r * 0.12, r * 0.30, r * 0.04);
                ctx.fill();
            }
            /* tail */
            ctx.beginPath();
            roundedRect(ctx, x + r * 0.70, y - r * 0.04,
                        r * 0.28, r * 0.08, r * 0.03);
            ctx.fill();
            /* eye */
            ctx.fillStyle = "#1a0e08";
            ctx.beginPath();
            ctx.arc(x - r * 0.70, y - r * 0.16, r * 0.04, 0, Math.PI * 2);
            ctx.fill();
        },

        /* ===== MODDED pack ===== */
        circuit: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.fillStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.10);
            ctx.lineCap = "square";
            /* L-shaped trace */
            ctx.beginPath();
            ctx.moveTo(x - r * 0.70, y - r * 0.55);
            ctx.lineTo(x - r * 0.70, y + r * 0.15);
            ctx.lineTo(x + r * 0.35, y + r * 0.15);
            ctx.lineTo(x + r * 0.35, y + r * 0.70);
            ctx.stroke();
            /* pads */
            const pads = [[-0.70, -0.55], [0.35, 0.70]];
            for (let i = 0; i < pads.length; i++) {
                ctx.beginPath();
                ctx.arc(x + pads[i][0] * r, y + pads[i][1] * r,
                        r * 0.13, 0, Math.PI * 2);
                ctx.fill();
            }
            /* zig-zag resistor */
            ctx.lineWidth = Math.max(2, r * 0.07);
            ctx.beginPath();
            const baseY = y + r * 0.15;
            for (let i = 0; i < 7; i++) {
                const px = x - r * 0.50 + i * r * 0.12;
                const py = baseY + (i % 2 === 0 ? -r * 0.14 : r * 0.14);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        },

        "fan-hex": function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.10);
            /* outer hex */
            for (let pass = 0; pass < 2; pass++) {
                const size = pass === 0 ? r * 0.90 : r * 0.48;
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
                    const px = x + Math.cos(a) * size;
                    const py = y + Math.sin(a) * size;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.stroke();
            }
            /* center dot */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.10, 0, Math.PI * 2);
            ctx.fill();
        },

        "rgb-strip": function (ctx, x, y, r, c) {
            const colors = ["#ff3030", "#ffaa30", "#ffff30",
                            "#30ff30", "#30c0ff", "#5040ff", "#cc40ff"];
            const segW = (r * 1.50) / colors.length;
            const startX = x - r * 0.75;
            /* dark backing */
            ctx.fillStyle = "#0c0c0c";
            roundedRect(ctx, startX - r * 0.06, y - r * 0.25,
                        r * 1.62, r * 0.50, r * 0.10);
            ctx.fill();
            /* LEDs */
            for (let i = 0; i < colors.length; i++) {
                ctx.fillStyle = colors[i];
                roundedRect(ctx, startX + i * segW + segW * 0.10,
                            y - r * 0.18, segW * 0.80, r * 0.36,
                            r * 0.07);
                ctx.fill();
                /* shine */
                ctx.fillStyle = "rgba(255,255,255,0.45)";
                ctx.beginPath();
                ctx.ellipse(startX + i * segW + segW * 0.50,
                            y - r * 0.05,
                            segW * 0.30, r * 0.06,
                            0, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        power: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "POWER");
        },

        reset: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "RESET");
        },

        trace: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.fillStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.10);
            ctx.lineCap = "square";
            ctx.lineJoin = "miter";
            /* serpentine right-angle path */
            ctx.beginPath();
            ctx.moveTo(x - r * 0.85, y - r * 0.55);
            ctx.lineTo(x - r * 0.30, y - r * 0.55);
            ctx.lineTo(x - r * 0.30, y);
            ctx.lineTo(x + r * 0.30, y);
            ctx.lineTo(x + r * 0.30, y - r * 0.40);
            ctx.lineTo(x + r * 0.85, y - r * 0.40);
            ctx.stroke();
            /* vias */
            const vias = [[-0.85, -0.55], [-0.30, 0], [0.30, 0], [0.85, -0.40]];
            for (let i = 0; i < vias.length; i++) {
                ctx.beginPath();
                ctx.arc(x + vias[i][0] * r, y + vias[i][1] * r,
                        r * 0.09, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        /* ===== GAMER pack ===== */
        "pixel-heart": function (ctx, x, y, r, c) {
            const cell = r * 0.18;
            pixelGrid(ctx, x, y, c, [
                [0,1,1,0,1,1,0],
                [1,1,1,1,1,1,1],
                [1,1,1,1,1,1,1],
                [0,1,1,1,1,1,0],
                [0,0,1,1,1,0,0],
                [0,0,0,1,0,0,0]
            ], cell);
        },

        "pixel-skull": function (ctx, x, y, r, c) {
            const cell = r * 0.16;
            pixelGrid(ctx, x, y, c, [
                [0,1,1,1,1,1,0],
                [1,1,1,1,1,1,1],
                [1,0,1,1,1,0,1],
                [1,1,1,1,1,1,1],
                [0,1,0,1,0,1,0],
                [0,1,1,1,1,1,0]
            ], cell);
        },

        "cloud-8bit": function (ctx, x, y, r, c) {
            const cell = r * 0.15;
            pixelGrid(ctx, x, y, c, [
                [0,0,0,1,1,1,0,0,0],
                [0,0,1,1,1,1,1,0,0],
                [0,1,1,1,1,1,1,1,0],
                [1,1,1,1,1,1,1,1,1],
                [1,1,1,1,1,1,1,1,1],
                [0,1,1,1,1,1,1,1,0]
            ], cell);
        },

        controller: function (ctx, x, y, r, c) {
            /* body */
            ctx.fillStyle = c;
            roundedRect(ctx, x - r * 0.85, y - r * 0.32,
                        r * 1.70, r * 0.64, r * 0.28);
            ctx.fill();
            /* grips */
            ctx.beginPath();
            ctx.arc(x - r * 0.62, y + r * 0.18, r * 0.22, 0, Math.PI * 2);
            ctx.arc(x + r * 0.62, y + r * 0.18, r * 0.22, 0, Math.PI * 2);
            ctx.fill();
            /* D-pad */
            ctx.fillStyle = "#1a0e08";
            ctx.fillRect(x - r * 0.52, y - r * 0.08, r * 0.34, r * 0.16);
            ctx.fillRect(x - r * 0.43, y - r * 0.17, r * 0.16, r * 0.34);
            /* 4 face buttons */
            const cb = [[0.24, -0.10], [0.45, 0.05], [0.24, 0.20], [0.03, 0.05]];
            for (let i = 0; i < cb.length; i++) {
                ctx.beginPath();
                ctx.arc(x + cb[i][0] * r, y + cb[i][1] * r,
                        r * 0.07, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        "game-over": function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "GAME OVER");
        },

        "press-start": function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "PRESS START", { fontSize: 0.30 });
        }
    };

    /* ----- 6B. Decorate state -----
       Each pack defines its own glaze list + pattern list. The
       active pack drives the GLAZE + STAMPS palette rows. Tabs
       above the rows switch the active pack. The "@rgb-cycle"
       glaze id is a dynamic glaze whose color cycles through HSL
       in real time — see currentPaintColor().                   */
    const GLAZE_PACKS = [
        {
            id: "core",  label: "BASIC",
            glazes: [
                "#3a2218",   /* dark clay */
                "#7a3a18",   /* sienna */
                "#cc6633",   /* terracotta */
                "#e4b13e",   /* amber */
                "#e9e4c8",   /* bone */
                "#f4f6ea",   /* milk white */
                "#5f8d5d",   /* sage */
                "#2b6b6c",   /* deep teal */
                "#244e9b",   /* cobalt */
                "#7a3c8c",   /* plum */
                "#b53939",   /* crimson */
                "#1a0e08"    /* ink */
            ],
            patterns: ["dot", "ring", "star", "chevron",
                       "wave", "triangle", "x", "heart"]
        },
        {
            id: "candy", label: "CANDY",
            glazes: [
                "#d92128",   /* cherry red */
                "#2b6fff",   /* blue raspberry */
                "#b3e51c",   /* sour green */
                "#ffa6c9",   /* cotton candy pink */
                "#4a230b",   /* root beer brown */
                "#ff7a00",   /* orange creamsicle */
                "#9534d8"    /* grape soda */
            ],
            patterns: ["lollipop", "candy-cane", "gumballs", "drip"]
        },
        {
            id: "plushie", label: "PLUSH",
            glazes: [
                "#a07050",   /* teddy brown */
                "#ffc8e0",   /* pastel pink */
                "#fff4e0",   /* soft cream */
                "#c8aedb",   /* lavender */
                "#b8d8ed"    /* sky blue */
            ],
            patterns: ["teddy", "paw", "button", "plush-grain"]
        },
        {
            id: "doggo", label: "DOGGO",
            glazes: [
                "#d9a567",   /* golden retriever */
                "#f4f4ec",   /* dalmatian white */
                "#8a9aaa",   /* husky gray */
                "#5a3422",   /* chocolate lab */
                "#2a2a2a"    /* black lab */
            ],
            patterns: ["paw", "bone", "doghouse", "goodboy",
                       "whosagoodboy", "dachshund"]
        },
        {
            id: "modded", label: "MODDED",
            glazes: [
                "@rgb-cycle",   /* animated rainbow */
                "#39ff14",      /* neon green */
                "#ff10a0",      /* hot pink */
                "#00d4ff",      /* electric blue */
                "#0a0a0a",      /* black ops */
                "#c8c8c8"       /* brushed aluminum */
            ],
            patterns: ["circuit", "fan-hex", "rgb-strip",
                       "power", "reset", "trace"]
        },
        {
            id: "gamer", label: "GAMER",
            glazes: [
                "#33ff66",   /* CRT green */
                "#ff8c1a",   /* retro orange */
                "#ff2a8a",   /* arcade pink */
                "#2a3a3a",   /* scanline gray */
                "#ffea00"    /* hi-score yellow */
            ],
            patterns: ["pixel-heart", "controller", "game-over",
                       "pixel-skull", "cloud-8bit", "press-start"]
        }
    ];

    const D = {
        canvas: null,
        ctx: null,
        paintCanvas: null,   /* offscreen — accumulates strokes / stamps */
        paintCtx: null,
        dpr: 1,

        activePackId: "core",
        glaze:   "#cc6633",
        tool:    "brush",     /* "brush" | "stamp" | "eraser" */
        size:    14,          /* logical-px stroke half-thickness */
        pattern: "dot",

        pointer: null,
        pointerActive: false,
        lastPaintPos: null,
        strokedThisGesture: false,

        running: false,
        rafId: null,
        lastT: 0,
        inited: false
    };

    function activePack() {
        for (let i = 0; i < GLAZE_PACKS.length; i++) {
            if (GLAZE_PACKS[i].id === D.activePackId) return GLAZE_PACKS[i];
        }
        return GLAZE_PACKS[0];
    }

    /* The MODDED pack's "@rgb-cycle" glaze cycles through HSL in
       real time. Strokes / stamps placed with it capture the
       current cycle color at paint time, so a single stroke
       produces a smooth rainbow trail (the user sees the swatch
       cycling and can time their motion). Chunk 8 will layer a
       real-time animated overlay on top (the OVERCLOCKED easter
       egg). For any static hex, this just passes through.       */
    function currentPaintColor() {
        if (D.glaze === "@rgb-cycle") {
            const h = (performance.now() * 0.18) % 360;
            return "hsl(" + h.toFixed(1) + ", 95%, 55%)";
        }
        return D.glaze;
    }

    function setPack(packId) {
        if (D.activePackId === packId) return;
        D.activePackId = packId;
        const pack = activePack();
        /* Snap glaze + pattern back to the new pack's first item
           so the user never has a non-existent selection. */
        D.glaze = pack.glazes[0];
        D.pattern = pack.patterns[0];
        buildToolUI();
    }

    /* ----- 6C. Init / sizing ----- */

    function initDecorate() {
        const c = document.getElementById("decorateCanvas");
        if (!c) {
            console.warn("[CRAYte] no #decorateCanvas");
            return;
        }
        D.canvas = c;
        D.ctx = c.getContext("2d");

        /* Offscreen paint layer — DPR-scaled so strokes look crisp
           on retina. Coordinates are in logical 400×600 space via
           setTransform; resize keeps existing strokes by drawImage
           through a temp canvas. */
        D.paintCanvas = document.createElement("canvas");
        D.paintCtx = D.paintCanvas.getContext("2d");
        sizeDecorateCanvas();

        D.paintCtx.lineCap = "round";
        D.paintCtx.lineJoin = "round";

        attachDecoratePointer();
        wireDecorateButtons();
        attachPackTabs();
        buildToolUI();

        if (typeof ResizeObserver === "function") {
            const ro = new ResizeObserver(function () { sizeDecorateCanvas(); });
            ro.observe(c);
        }
    }

    function attachPackTabs() {
        document.querySelectorAll(".pack-tab[data-pack]").forEach(function (b) {
            b.addEventListener("click", function () { setPack(b.dataset.pack); });
        });
    }

    function sizeDecorateCanvas() {
        const dpr = window.devicePixelRatio || 1;
        D.dpr = dpr;
        const bw = Math.round(SHAPE.W * dpr);
        const bh = Math.round(SHAPE.H * dpr);
        if (D.canvas) {
            if (D.canvas.width !== bw)  D.canvas.width  = bw;
            if (D.canvas.height !== bh) D.canvas.height = bh;
            D.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        if (D.paintCanvas && (D.paintCanvas.width !== bw ||
                              D.paintCanvas.height !== bh)) {
            /* Preserve existing paint across DPR / resize. */
            const tmp = document.createElement("canvas");
            tmp.width  = D.paintCanvas.width  || 1;
            tmp.height = D.paintCanvas.height || 1;
            if (D.paintCanvas.width && D.paintCanvas.height) {
                tmp.getContext("2d").drawImage(D.paintCanvas, 0, 0);
            }
            D.paintCanvas.width  = bw;
            D.paintCanvas.height = bh;
            D.paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            D.paintCtx.lineCap = "round";
            D.paintCtx.lineJoin = "round";
            if (tmp.width > 1 && tmp.height > 1) {
                D.paintCtx.drawImage(tmp, 0, 0, SHAPE.W, SHAPE.H);
            }
        }
    }

    function clearPaint() {
        if (!D.paintCtx) return;
        D.paintCtx.save();
        D.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
        D.paintCtx.clearRect(0, 0, D.paintCanvas.width, D.paintCanvas.height);
        D.paintCtx.restore();
    }

    /* ----- 6D. Pointer / paint ----- */

    function decPointerPos(e) {
        const r = D.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * SHAPE.W / r.width,
            y: (e.clientY - r.top)  * SHAPE.H / r.height
        };
    }

    function attachDecoratePointer() {
        const c = D.canvas;

        c.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            try { c.setPointerCapture(e.pointerId); } catch (_) {}
            const p = decPointerPos(e);
            D.pointer = p;
            D.pointerActive = true;
            D.lastPaintPos = p;
            D.strokedThisGesture = false;
            if (D.tool === "stamp") {
                stampAt(p);
                D.strokedThisGesture = true;
            } else {
                paintDot(p);
                D.strokedThisGesture = true;
            }
        });

        c.addEventListener("pointermove", function (e) {
            if (!D.pointerActive) return;
            const p = decPointerPos(e);
            if (D.tool === "brush" || D.tool === "eraser") {
                paintStrokeTo(p);
            }
            D.lastPaintPos = p;
            D.pointer = p;
        });

        function endPointer(e) {
            if (!D.pointerActive) return;
            D.pointerActive = false;
            D.lastPaintPos = null;
            try { c.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        c.addEventListener("pointerup",     endPointer);
        c.addEventListener("pointercancel", endPointer);
        c.addEventListener("pointerleave",  endPointer);
    }

    function paintDot(p) {
        const ctx = D.paintCtx;
        ctx.save();
        if (D.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "#000";
        } else {
            ctx.fillStyle = currentPaintColor();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, D.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function paintStrokeTo(p) {
        const ctx = D.paintCtx;
        const last = D.lastPaintPos;
        if (!last) { paintDot(p); return; }
        ctx.save();
        if (D.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.strokeStyle = "#000";
        } else {
            ctx.strokeStyle = currentPaintColor();
        }
        ctx.lineWidth = D.size * 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
    }

    function stampAt(p) {
        const fn = PATTERN_DRAWERS[D.pattern];
        if (!fn) return;
        /* Slightly bigger than brush dot so a "thin" stamp still
           reads as a recognizable shape. */
        const r = D.size * 1.7;
        fn(D.paintCtx, p.x, p.y, r, currentPaintColor());
    }

    /* ----- 6E. Tool UI ----- */

    function buildToolUI() {
        const pack = activePack();

        /* Pack tabs — markup is static (chunk-4 added 6 tabs to
           index.html). Click handlers attached once via
           attachPackTabs(); here we just toggle .active. */
        document.querySelectorAll(".pack-tab[data-pack]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.pack === pack.id);
        });

        /* Glaze swatches */
        const gp = document.getElementById("glazePalette");
        if (gp) {
            gp.innerHTML = "";
            pack.glazes.forEach(function (gid) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "swatch";
                btn.dataset.glaze = gid;
                if (gid === "@rgb-cycle") {
                    /* CSS handles the animated rainbow background. */
                    btn.classList.add("dynamic-rgb");
                    btn.setAttribute("aria-label", "RGB cycle glaze");
                    btn.title = "RGB CYCLE";
                } else {
                    btn.style.background = gid;
                    btn.setAttribute("aria-label", "Glaze " + gid);
                }
                if (gid === D.glaze) btn.classList.add("active");
                btn.addEventListener("click", function () {
                    D.glaze = gid;
                    gp.querySelectorAll(".swatch").forEach(function (s) {
                        s.classList.toggle("active", s.dataset.glaze === gid);
                    });
                    /* Picking a glaze while on eraser snaps back to brush. */
                    if (D.tool === "eraser") setTool("brush");
                });
                gp.appendChild(btn);
            });
        }

        /* Pattern stamps */
        const pp = document.getElementById("patternPalette");
        if (pp) {
            pp.innerHTML = "";
            pack.patterns.forEach(function (id) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "stamp-btn";
                btn.dataset.pattern = id;
                btn.setAttribute("aria-label", "Pattern " + id);
                /* Mini preview canvas as the icon */
                const mini = document.createElement("canvas");
                mini.width = 36;
                mini.height = 36;
                const mctx = mini.getContext("2d");
                mctx.translate(18, 18);
                const fn = PATTERN_DRAWERS[id];
                if (fn) fn(mctx, 0, 0, 12, "#eaf6f4");
                btn.appendChild(mini);
                if (id === D.pattern) btn.classList.add("active");
                btn.addEventListener("click", function () {
                    D.pattern = id;
                    pp.querySelectorAll(".stamp-btn").forEach(function (s) {
                        s.classList.toggle("active", s.dataset.pattern === id);
                    });
                    /* Picking a stamp implies STAMP mode. */
                    setTool("stamp");
                });
                pp.appendChild(btn);
            });
        }

        /* Tool-mode buttons */
        document.querySelectorAll(".tool-btn[data-tool]").forEach(function (b) {
            b.addEventListener("click", function () {
                setTool(b.dataset.tool);
            });
            b.classList.toggle("active", b.dataset.tool === D.tool);
        });

        /* Size pucks */
        document.querySelectorAll(".size-btn[data-size]").forEach(function (b) {
            b.addEventListener("click", function () {
                D.size = parseInt(b.dataset.size, 10);
                document.querySelectorAll(".size-btn").forEach(function (s) {
                    s.classList.toggle("active", s.dataset.size === b.dataset.size);
                });
            });
            b.classList.toggle("active",
                parseInt(b.dataset.size, 10) === D.size);
        });
    }

    function setTool(tool) {
        D.tool = tool;
        document.querySelectorAll(".tool-btn[data-tool]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.tool === tool);
        });
        if (D.canvas) {
            D.canvas.style.cursor = (tool === "eraser") ? "cell" : "crosshair";
        }
    }

    /* ----- 6F. Buttons ----- */

    function wireDecorateButtons() {
        const back  = document.getElementById("decBack");
        const clear = document.getElementById("decClear");
        const fire  = document.getElementById("decFire");

        if (back) back.addEventListener("click", function () {
            /* Re-shape escape hatch: unlock clay; paint persists so
               the decoration deforms with any re-shaping (the paint
               composite is clipped to the new silhouette). */
            SHAPE.clayLocked = false;
            showScreen("shape");
        });

        if (clear) clear.addEventListener("click", function () {
            clearPaint();
            flashButton(clear);
        });

        if (fire) fire.addEventListener("click", function () {
            flashButton(fire);
            if (SCREENS["kiln"]) {
                /* User gesture — wake up Web Audio here so the kiln
                   roar can play (browsers block context until then). */
                ensureKilnAudio();
                showScreen("kiln");
            } else {
                flashStub(fire, "KILN OFFLINE");
            }
        });
    }

    /* ----- 6G. Frame loop ----- */

    function decorateFrame(t) {
        if (!D.running) return;
        if (!D.lastT) D.lastT = t;
        const dt = Math.min(48, t - D.lastT);
        D.lastT = t;

        /* Wheel keeps spinning while decorating — same state as SHAPE. */
        SHAPE.wheelPhase += (2 * Math.PI * SHAPE.WHEEL_RPM / 60) * (dt / 1000);
        if (SHAPE.wheelPhase > Math.PI * 2) SHAPE.wheelPhase -= Math.PI * 2;

        renderPotScene(D.ctx, { paintCanvas: D.paintCanvas, particles: false });
        D.rafId = requestAnimationFrame(decorateFrame);
    }

    function startDecorateLoop() {
        if (D.running) return;
        D.running = true;
        D.lastT = 0;
        D.rafId = requestAnimationFrame(decorateFrame);
    }

    function stopDecorateLoop() {
        D.running = false;
        if (D.rafId) cancelAnimationFrame(D.rafId);
        D.rafId = null;
    }

    /* ----- 6H. Register with the router ----- */

    registerScreen("decorate", {
        onEnter: function () {
            if (!D.inited) {
                initDecorate();
                D.inited = true;
            } else {
                sizeDecorateCanvas();
            }
            startDecorateLoop();
        },
        onLeave: function () {
            stopDecorateLoop();
        }
    });

    /* ============================================================
       KILN SCREEN — chunk 5: firing animation
       ============================================================
       State machine: intro -> closing -> firing -> opening ->
       reveal -> done. Each transition fires the matching audio
       (door thunk, kiln roar, ding) and triggers auto-save when
       reveal lands. The pot itself renders via renderPotScene
       with opts.fired so the same composite chain handles the
       fired-glaze warmth.
       ============================================================ */

    const KILN = {
        canvas: null,
        ctx: null,
        dpr: 1,

        state: "idle",       /* idle | intro | closing | firing | opening | reveal | done */
        stateT: 0,

        doorProgress: 1.0,   /* 1 = fully open, 0 = fully closed */
        potOffsetY: 0,       /* slide-in from below during intro */
        glowIntensity: 0,    /* 0-1 — orange interior glow */
        glowPhase: 0,        /* for pulsing */
        sparks: [],
        crackleTimer: 0,

        fired: false,        /* true once the firing reveal lands */
        audio: null,
        savedId: null,       /* id of the latest auto-saved pot */

        lastT: 0,
        rafId: null,
        running: false,
        inited: false
    };

    const KILN_DUR = {
        intro:   500,
        closing: 700,
        firing:  3500,
        opening: 700,
        reveal:  1500,
        done:    Infinity
    };

    const NICE_POT_LINES = [
        "NICE POT",
        "POT IS HARD NOW",
        "POTTERY ACHIEVED",
        "HOT STUFF",
        "VERY WAS POOTED",
        "CONGRATS DUDE",
        "SO CRAYTED"
    ];

    /* ----- 7A. Init ----- */

    function initKiln() {
        const c = document.getElementById("kilnCanvas");
        if (!c) { console.warn("[CRAYte] no #kilnCanvas"); return; }
        KILN.canvas = c;
        KILN.ctx = c.getContext("2d");
        sizeKilnCanvas();
        wireKilnButtons();

        if (typeof ResizeObserver === "function") {
            const ro = new ResizeObserver(function () { sizeKilnCanvas(); });
            ro.observe(c);
        }
    }

    function sizeKilnCanvas() {
        const dpr = window.devicePixelRatio || 1;
        KILN.dpr = dpr;
        const c = KILN.canvas;
        if (!c) return;
        const bw = Math.round(SHAPE.W * dpr);
        const bh = Math.round(SHAPE.H * dpr);
        if (c.width !== bw)  c.width  = bw;
        if (c.height !== bh) c.height = bh;
        KILN.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ----- 7B. Buttons ----- */

    function wireKilnButtons() {
        const back    = document.getElementById("kilnBack");
        const again   = document.getElementById("kilnAgain");
        const fresh   = document.getElementById("kilnNew");
        const gallery = document.getElementById("kilnGallery");

        if (back) back.addEventListener("click", function () {
            stopKilnLoop();
            /* Drop fired status if user bailed mid-firing; keep it
               otherwise so a subsequent re-fire still looks fired. */
            if (KILN.state !== "done" && KILN.state !== "reveal") {
                KILN.fired = false;
            }
            SHAPE.clayLocked = false;
            showScreen("decorate");
        });

        if (again) again.addEventListener("click", function () {
            /* Lock clay back so decorate stays in paint mode. */
            SHAPE.clayLocked = true;
            showScreen("decorate");
        });

        if (fresh) fresh.addEventListener("click", function () {
            /* Fresh slate — reset clay + paint, return to shape. */
            resetClay();
            if (typeof clearPaint === "function") clearPaint();
            SHAPE.clayLocked = false;
            KILN.fired = false;
            showScreen("shape");
        });

        if (gallery) gallery.addEventListener("click", function () {
            if (SCREENS["gallery"]) {
                showScreen("gallery");
            } else {
                flashStub(gallery, "GALLERY SOON");
            }
        });
    }

    function setKilnStatus(text) {
        const el = document.getElementById("kilnStatus");
        if (el) el.textContent = text;
    }

    function showCelebrate() {
        const cel = document.getElementById("kilnCelebrate");
        const sub = document.getElementById("kilnSub");
        const saved = document.getElementById("kilnSaved");
        const ctrls = document.getElementById("kilnControls");
        if (sub) sub.textContent = NICE_POT_LINES[
            Math.floor(Math.random() * NICE_POT_LINES.length)
        ];
        if (saved) {
            saved.textContent = KILN.savedId
                ? "✓ SAVED TO GALLERY"
                : "⚠ SAVE FAILED";
            saved.hidden = false;
        }
        if (cel) cel.hidden = false;
        if (ctrls) ctrls.hidden = false;
    }

    function hideCelebrate() {
        const cel = document.getElementById("kilnCelebrate");
        const ctrls = document.getElementById("kilnControls");
        if (cel) cel.hidden = true;
        if (ctrls) ctrls.hidden = true;
    }

    /* ----- 7C. Auto-save (chunk 6 reads from the same key) ----- */

    function autoSaveFiredPot() {
        try {
            const key = "crayte-gallery";
            let existing = [];
            try {
                existing = JSON.parse(localStorage.getItem(key) || "[]");
                if (!Array.isArray(existing)) existing = [];
            } catch (_) { existing = []; }

            const entry = {
                id: "pot-" + Date.now() + "-" +
                    Math.random().toString(36).slice(2, 8),
                createdAt: Date.now(),
                clay: SHAPE.clay.map(function (c) {
                    return { y: c.y, radius: c.radius };
                }),
                paintDataUrl: (D.paintCanvas)
                    ? D.paintCanvas.toDataURL("image/png")
                    : null,
                packId: D.activePackId,
                fired: true
            };
            existing.push(entry);
            /* Cap at 50 — keep newest. Brief calls for the "you have
               a lot of pots" celebration screen at ~50.            */
            while (existing.length > 50) existing.shift();
            localStorage.setItem(key, JSON.stringify(existing));
            KILN.savedId = entry.id;
            return true;
        } catch (e) {
            console.warn("[CRAYte] auto-save failed", e);
            KILN.savedId = null;
            return false;
        }
    }

    /* ----- 7D. Audio (Web Audio, all synthesized) ----- */

    /* Routes through the shared bootstrap so KILN, SHAPE, and the
       title poot all live on the same AudioContext. KILN.audio
       kept as a cache for the rest of the chunk-5 functions that
       still reference it; populate it here on first call.       */
    function ensureKilnAudio() {
        const ctx = ensureAudio();
        if (ctx) KILN.audio = ctx;
        return ctx;
    }

    function kilnRoar(durationSec) {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        const now = ctx.currentTime;
        /* Brown-ish noise via low-pass-filtered noise buffer */
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5),
                                      ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 220;
        lp.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.20, now + 0.5);
        g.gain.linearRampToValueAtTime(0.20, now + Math.max(0.5, durationSec - 0.5));
        g.gain.linearRampToValueAtTime(0,    now + durationSec);
        src.connect(lp); lp.connect(g); g.connect(ctx.destination);
        src.start(now);
        src.stop(now + durationSec + 0.05);
    }

    function kilnCrackle() {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.06);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 2.5);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1100;
        const g = ctx.createGain();
        g.gain.value = 0.07 + Math.random() * 0.05;
        src.connect(hp); hp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    function kilnDoorThunk(strength) {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        strength = strength || 1;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.32);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.45 * strength, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
    }

    function kilnDing() {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        const now = ctx.currentTime;
        /* Two-tone bell (perfect fifth) for a "pot done" celebration */
        [1320, 1980].forEach(function (freq, i) {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq;
            const g = ctx.createGain();
            const start = now + i * 0.05;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.18, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, start + 1.6);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 1.7);
        });
    }

    /* ----- 7E. Sparks (rise above the chimney during firing) ----- */

    function emitKilnSpark() {
        if (KILN.sparks.length > 36) return;
        const cx = SHAPE.centerX + (Math.random() - 0.5) * 50;
        KILN.sparks.push({
            x: cx,
            y: 60 + Math.random() * 20,
            vx: (Math.random() - 0.5) * 0.04,
            vy: -0.06 - Math.random() * 0.05,
            life: 900 + Math.random() * 600,
            age: 0,
            size: 1.2 + Math.random() * 1.6,
            hue: 22 + Math.random() * 22
        });
    }

    function updateSparks(dt) {
        const s = KILN.sparks;
        for (let i = s.length - 1; i >= 0; i--) {
            const p = s[i];
            p.age += dt;
            if (p.age >= p.life) { s.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            /* Sparks drift sideways slightly */
            p.vx += (Math.random() - 0.5) * 0.0008 * dt;
        }
    }

    function drawKilnSparks(ctx) {
        const s = KILN.sparks;
        for (let i = 0; i < s.length; i++) {
            const p = s[i];
            const t = p.age / p.life;
            const a = (1 - t) * 0.9;
            ctx.fillStyle = "hsla(" + p.hue + ", 100%, 65%, " + a + ")";
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ----- 7F. Kiln chrome ----- */

    /* Layout constants for the kiln frame around the doorway. */
    const KILN_FRAME = {
        wallX:   18,        /* left wall thickness */
        wallY:   60,        /* top wall (under chimney) */
        floorY:  20,        /* bottom wall thickness */
        doorY0:  60,        /* top of doorway */
        doorY1:  580,       /* bottom of doorway */
        doorX0:  18,        /* left edge of doorway interior */
        doorX1:  382,       /* right edge of doorway interior */
        chimneyX0: 162,
        chimneyX1: 238,
        chimneyTop: 0,
        chimneyBot: 60
    };

    function drawKilnChrome(ctx) {
        const f = KILN_FRAME;

        /* Outer body fill — dark steel with subtle vertical gradient */
        const body = ctx.createLinearGradient(0, 0, 0, SHAPE.H);
        body.addColorStop(0,   "#1a2830");
        body.addColorStop(0.6, "#101c22");
        body.addColorStop(1,   "#0a1418");
        ctx.fillStyle = body;
        /* Top hood */
        ctx.fillRect(0, 0, SHAPE.W, f.doorY0);
        /* Left wall */
        ctx.fillRect(0, f.doorY0, f.doorX0, f.doorY1 - f.doorY0);
        /* Right wall */
        ctx.fillRect(f.doorX1, f.doorY0, SHAPE.W - f.doorX1, f.doorY1 - f.doorY0);
        /* Hearth floor */
        ctx.fillRect(0, f.doorY1, SHAPE.W, SHAPE.H - f.doorY1);

        /* Chimney cutout (lighter — looks like it's open to sky/smoke) */
        ctx.fillStyle = "#06141a";
        ctx.fillRect(f.chimneyX0, 0, f.chimneyX1 - f.chimneyX0,
                     f.chimneyBot);

        /* Chimney walls (frame the cutout) */
        ctx.fillStyle = body;
        const chW = 12;
        ctx.fillRect(f.chimneyX0 - chW, 0, chW, f.chimneyBot + 4);
        ctx.fillRect(f.chimneyX1,       0, chW, f.chimneyBot + 4);

        /* Copper trim along the doorway opening */
        const copperGrad = ctx.createLinearGradient(0, 0, SHAPE.W, 0);
        copperGrad.addColorStop(0,    "#5a3010");
        copperGrad.addColorStop(0.5,  "#c08040");
        copperGrad.addColorStop(1,    "#5a3010");
        ctx.fillStyle = copperGrad;
        const tw = 4;
        /* Top trim */
        ctx.fillRect(f.doorX0 - tw, f.doorY0 - tw,
                     f.doorX1 - f.doorX0 + tw * 2, tw);
        /* Left trim */
        ctx.fillRect(f.doorX0 - tw, f.doorY0,
                     tw, f.doorY1 - f.doorY0);
        /* Right trim */
        ctx.fillRect(f.doorX1, f.doorY0,
                     tw, f.doorY1 - f.doorY0);
        /* Bottom trim */
        ctx.fillRect(f.doorX0 - tw, f.doorY1,
                     f.doorX1 - f.doorX0 + tw * 2, tw);

        /* Rivets along the hood */
        ctx.fillStyle = "#4a5860";
        for (let x = 30; x < SHAPE.W - 30; x += 28) {
            ctx.beginPath();
            ctx.arc(x, 12, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x, 42, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        /* CRT-style nameplate on the hood */
        ctx.fillStyle = "#0a1418";
        roundedRect(ctx, SHAPE.W / 2 - 70, 22, 140, 22, 4);
        ctx.fill();
        ctx.strokeStyle = "#c08040";
        ctx.lineWidth = 1;
        roundedRect(ctx, SHAPE.W / 2 - 70, 22, 140, 22, 4);
        ctx.stroke();
        ctx.fillStyle = "#ff6a2a";
        ctx.font = "13px " + "\"VT323\", \"Courier New\", monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("KILN-9000", SHAPE.W / 2, 34);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";

        /* Heat-indicator LED — pulses brighter during firing */
        const ledX = SHAPE.W / 2 + 80;
        const ledOn = KILN.glowIntensity > 0.1;
        if (ledOn) {
            ctx.fillStyle = "rgba(255, 80, 30, 0.5)";
            ctx.beginPath();
            ctx.arc(ledX, 34, 8, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = ledOn ? "#ff5a1f" : "#3a1818";
        ctx.beginPath();
        ctx.arc(ledX, 34, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawKilnDoors(ctx, progress) {
        /* progress: 1 = fully open (doors hidden against walls),
                    0 = fully closed (doors meet at centerX).      */
        const f = KILN_FRAME;
        const doorH = f.doorY1 - f.doorY0;
        const halfDoor = (f.doorX1 - f.doorX0) / 2;
        /* When open, doors are tucked behind a strip along the walls. */
        const tucked = 6;
        const leftDoorX  = f.doorX0 - tucked + progress * (halfDoor - tucked) * 0;
        const closedLeftX  = f.doorX0;
        const openLeftX    = f.doorX0 - halfDoor + tucked;
        const lx = openLeftX + (closedLeftX - openLeftX) * (1 - progress);

        const closedRightX = f.doorX0 + halfDoor;
        const openRightX   = f.doorX1 - tucked;
        const rx = openRightX + (closedRightX - openRightX) * (1 - progress);

        /* Door body gradient */
        const dGrad = ctx.createLinearGradient(0, 0, 0, doorH);
        dGrad.addColorStop(0,   "#22323a");
        dGrad.addColorStop(0.5, "#101a22");
        dGrad.addColorStop(1,   "#0a1418");

        /* Left door */
        ctx.fillStyle = dGrad;
        ctx.fillRect(lx, f.doorY0, halfDoor, doorH);
        /* Right door */
        ctx.fillRect(rx, f.doorY0, halfDoor, doorH);

        /* Door-edge highlight */
        ctx.strokeStyle = "rgba(255, 200, 140, 0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx + halfDoor - 0.5, f.doorY0);
        ctx.lineTo(lx + halfDoor - 0.5, f.doorY1);
        ctx.moveTo(rx + 0.5, f.doorY0);
        ctx.lineTo(rx + 0.5, f.doorY1);
        ctx.stroke();

        /* Door rivets — 4 down the inner edge of each */
        ctx.fillStyle = "#4a5860";
        for (let i = 0; i < 4; i++) {
            const y = f.doorY0 + 40 + i * ((doorH - 80) / 3);
            ctx.beginPath();
            ctx.arc(lx + halfDoor - 14, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(rx + 14, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        /* Copper handles */
        ctx.fillStyle = "#c08040";
        roundedRect(ctx, lx + halfDoor - 22, f.doorY0 + doorH / 2 - 18,
                    6, 36, 2);
        ctx.fill();
        roundedRect(ctx, rx + 16,           f.doorY0 + doorH / 2 - 18,
                    6, 36, 2);
        ctx.fill();
    }

    function drawKilnGlow(ctx) {
        const f = KILN_FRAME;
        const intensity = KILN.glowIntensity *
            (0.85 + 0.15 * Math.sin(KILN.glowPhase * 0.18));

        /* Interior glow — radial from the seam between doors. The
           glow leaks out where the doors are most closed. */
        const cx = SHAPE.centerX;
        const cy = (f.doorY0 + f.doorY1) / 2;
        const seamGap = Math.max(0, (1 - KILN.doorProgress)); /* 0..1 */

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        /* Big radial body glow visible through the doorway interior
           (when doors are fully closed, this still bleeds through
           the door faces a touch — sells the heat). */
        const bigR = 240;
        const radGlow = ctx.createRadialGradient(cx, cy, 20, cx, cy, bigR);
        radGlow.addColorStop(0,
            "rgba(255, 180, 60, " + (0.55 * intensity) + ")");
        radGlow.addColorStop(0.4,
            "rgba(255, 90, 30, "  + (0.35 * intensity) + ")");
        radGlow.addColorStop(1, "rgba(255, 90, 30, 0)");
        ctx.fillStyle = radGlow;
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);

        /* Bright seam line where the doors meet — most visible at
           the moment of full closure. */
        if (seamGap > 0.85) {
            const seamA = (seamGap - 0.85) / 0.15;
            const seamGrad = ctx.createLinearGradient(cx - 12, 0, cx + 12, 0);
            seamGrad.addColorStop(0,   "rgba(255, 200, 80, 0)");
            seamGrad.addColorStop(0.5,
                "rgba(255, 240, 120, " + (0.9 * seamA * intensity) + ")");
            seamGrad.addColorStop(1,   "rgba(255, 200, 80, 0)");
            ctx.fillStyle = seamGrad;
            ctx.fillRect(cx - 12, f.doorY0, 24, f.doorY1 - f.doorY0);
        }

        /* Chimney plume — column of warm glow rising out the top */
        const chimGrad = ctx.createLinearGradient(0, 0, 0, f.chimneyBot);
        chimGrad.addColorStop(0, "rgba(255, 90, 30, 0)");
        chimGrad.addColorStop(1, "rgba(255, 180, 60, " + (0.55 * intensity) + ")");
        ctx.fillStyle = chimGrad;
        ctx.fillRect(KILN_FRAME.chimneyX0, 0,
                     KILN_FRAME.chimneyX1 - KILN_FRAME.chimneyX0,
                     f.chimneyBot);

        ctx.restore();
    }

    function renderKiln() {
        const ctx = KILN.ctx;

        /* Background */
        ctx.fillStyle = "#04101a";
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);

        /* Pot in place (translated during intro for slide-in). The
           pot's own backdrop is suppressed — kiln chrome is its own
           background. Wheel + corners suppressed (kiln chrome owns
           those areas). */
        ctx.save();
        ctx.translate(0, KILN.potOffsetY);
        renderPotScene(ctx, {
            paintCanvas: D.paintCanvas,
            particles:   false,
            background:  false,
            wheel:       false,
            corners:     false,
            fired:       KILN.fired
        });
        ctx.restore();

        /* Glow comes from BEHIND the doors when doors are mostly
           closed (firing). For visual layering we draw it now —
           the doors will mask most of it. */
        if (KILN.glowIntensity > 0) drawKilnGlow(ctx);

        /* Kiln chrome wraps around the pot. */
        drawKilnChrome(ctx);

        /* Doors over the doorway. */
        drawKilnDoors(ctx, KILN.doorProgress);

        /* Sparks live ABOVE the kiln (chimney smoke). */
        drawKilnSparks(ctx);
    }

    /* ----- 7G. State machine ----- */

    function kilnEnter(state) {
        KILN.state = state;
        KILN.stateT = 0;
        if (state === "intro") {
            setKilnStatus("LOADING");
            KILN.doorProgress = 1.0;
            KILN.glowIntensity = 0;
            KILN.fired = false;
            hideCelebrate();
        } else if (state === "closing") {
            setKilnStatus("DOORS CLOSING");
        } else if (state === "firing") {
            setKilnStatus("FIRING IT");
            kilnDoorThunk(1.0);
            kilnRoar(KILN_DUR.firing / 1000);
        } else if (state === "opening") {
            setKilnStatus("DOORS OPENING");
            kilnDoorThunk(0.6);
        } else if (state === "reveal") {
            setKilnStatus("FIRED");
            KILN.fired = true;
            autoSaveFiredPot();
            kilnDing();
            showCelebrate();
        } else if (state === "done") {
            /* user takes the wheel from here */
        }
    }

    function kilnAdvance() {
        switch (KILN.state) {
            case "intro":   kilnEnter("closing"); break;
            case "closing": kilnEnter("firing");  break;
            case "firing":  kilnEnter("opening"); break;
            case "opening": kilnEnter("reveal");  break;
            case "reveal":  kilnEnter("done");    break;
        }
    }

    function kilnFrame(t) {
        if (!KILN.running) return;
        if (!KILN.lastT) KILN.lastT = t;
        const dt = Math.min(48, t - KILN.lastT);
        KILN.lastT = t;

        SHAPE.wheelPhase += (2 * Math.PI * SHAPE.WHEEL_RPM / 60) * (dt / 1000);
        if (SHAPE.wheelPhase > Math.PI * 2) SHAPE.wheelPhase -= Math.PI * 2;

        KILN.stateT += dt;
        KILN.glowPhase += dt / 100;

        const dur = KILN_DUR[KILN.state] || Infinity;
        if (KILN.stateT >= dur) kilnAdvance();

        /* Per-state derived values */
        const st = KILN.state, t01 = KILN.stateT / dur;
        if (st === "intro") {
            /* slide pot up from below */
            const eased = 1 - Math.pow(1 - t01, 3); /* easeOutCubic */
            KILN.potOffsetY = (1 - eased) * 220;
            KILN.doorProgress = 1.0;
            KILN.glowIntensity = 0;
        } else if (st === "closing") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = 1 - t01;
            KILN.glowIntensity = t01 * 0.25;
        } else if (st === "firing") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = 0;
            /* Ramp up to peak in the first 25%, hold, then cool */
            if (t01 < 0.25) {
                KILN.glowIntensity = 0.25 + (t01 / 0.25) * 0.75;
            } else if (t01 < 0.80) {
                KILN.glowIntensity = 1.0;
            } else {
                KILN.glowIntensity = 1.0 - (t01 - 0.80) / 0.20 * 0.55;
            }
            if (Math.random() < 0.6) emitKilnSpark();
            KILN.crackleTimer += dt;
            if (KILN.crackleTimer > 160 + Math.random() * 240) {
                kilnCrackle();
                KILN.crackleTimer = 0;
            }
        } else if (st === "opening") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = t01;
            KILN.glowIntensity = Math.max(0, 0.45 - t01 * 0.45);
        } else if (st === "reveal" || st === "done") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = 1;
            KILN.glowIntensity = 0;
        } else { /* idle */
            KILN.doorProgress = 1;
            KILN.glowIntensity = 0;
        }

        updateSparks(dt);
        renderKiln();
        KILN.rafId = requestAnimationFrame(kilnFrame);
    }

    function startKilnLoop() {
        if (KILN.running) return;
        KILN.running = true;
        KILN.lastT = 0;
        KILN.rafId = requestAnimationFrame(kilnFrame);
    }

    function stopKilnLoop() {
        KILN.running = false;
        if (KILN.rafId) cancelAnimationFrame(KILN.rafId);
        KILN.rafId = null;
    }

    /* ----- 7H. Register with the router ----- */

    registerScreen("kiln", {
        onEnter: function () {
            if (!KILN.inited) {
                initKiln();
                KILN.inited = true;
            } else {
                sizeKilnCanvas();
            }
            KILN.sparks.length = 0;
            hideCelebrate();
            kilnEnter("intro");
            startKilnLoop();
        },
        onLeave: function () {
            stopKilnLoop();
            hideCelebrate();
        }
    });

    /* ============================================================
       GALLERY SCREEN — chunk 6: thumbnail grid + PNG export
       ============================================================
       Source of truth is localStorage key "crayte-gallery" — same
       key the kiln writes to on every successful firing. Each
       thumbnail re-renders the saved pot at small size using the
       same drawPot / drawRim / fired-overlay chain as the live
       canvas; the clay snapshot is swapped into SHAPE.clay for
       the duration of each render (synchronous within a .then()
       callback, so no race even with parallel thumbnail loads).
       ============================================================ */

    const GALLERY = {
        items: [],
        detailEntry: null,
        inited: false
    };

    const GALLERY_KEY  = "crayte-gallery";
    const LOT_OF_POTS  = 50;

    function loadGalleryEntries() {
        try {
            const raw = localStorage.getItem(GALLERY_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function saveGalleryEntries(arr) {
        try {
            /* Strip the cached _paintImg before serializing — Image
               objects don't survive JSON. */
            const clean = arr.map(function (e) {
                const o = {};
                for (const k in e) {
                    if (k === "_paintImg") continue;
                    o[k] = e[k];
                }
                return o;
            });
            localStorage.setItem(GALLERY_KEY, JSON.stringify(clean));
            return true;
        } catch (e) {
            console.warn("[CRAYte] gallery save failed", e);
            return false;
        }
    }

    function loadEntryPaint(entry) {
        if (entry._paintImg) return Promise.resolve(entry._paintImg);
        if (!entry.paintDataUrl) return Promise.resolve(null);
        return new Promise(function (resolve) {
            const img = new Image();
            img.onload  = function () { entry._paintImg = img; resolve(img); };
            img.onerror = function () { resolve(null); };
            img.src = entry.paintDataUrl;
        });
    }

    function formatPotDate(ts) {
        const d = new Date(ts);
        const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" +
               pad(d.getDate()) + " " + pad(d.getHours()) + ":" +
               pad(d.getMinutes());
    }

    /* Pack-id -> friendly label for the detail tag. Falls back to
       the id itself for any future-added pack. */
    function packLabel(packId) {
        for (let i = 0; i < GLAZE_PACKS.length; i++) {
            if (GLAZE_PACKS[i].id === packId) return GLAZE_PACKS[i].label;
        }
        return (packId || "BASIC").toUpperCase();
    }

    /* ----- 8A. Render a saved entry into any 2D context -----
       Logical coords are 400×600. Caller is responsible for the
       ctx transform so the logical space maps to the destination
       canvas size. clay-swap is purely synchronous within this
       call, so no race with parallel renders.                   */
    function renderSavedPot(ctx, entry, opts) {
        opts = opts || {};
        const savedClay = SHAPE.clay;
        SHAPE.clay = entry.clay || SHAPE.clay;
        try {
            if (opts.background !== false) {
                ctx.fillStyle = "#0c1f25";
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                drawShapeBackdrop(ctx);
            }
            if (opts.wheel !== false) drawWheel(ctx);
            drawPot(ctx);
            if (entry._paintImg) {
                ctx.save();
                buildPotPath(ctx);
                ctx.clip();
                ctx.drawImage(entry._paintImg, 0, 0, SHAPE.W, SHAPE.H);
                ctx.restore();
            }
            if (entry.fired) {
                ctx.save();
                buildPotPath(ctx);
                ctx.clip();
                ctx.globalCompositeOperation = "overlay";
                ctx.fillStyle = "rgba(180, 70, 22, 0.20)";
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                ctx.globalCompositeOperation = "source-over";
                const g = ctx.createLinearGradient(0, 80, 0, 510);
                g.addColorStop(0,    "rgba(255, 245, 220, 0.10)");
                g.addColorStop(0.35, "rgba(255, 245, 220, 0.00)");
                g.addColorStop(1,    "rgba(0, 0, 0, 0.12)");
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                ctx.restore();
            }
            drawRim(ctx);
        } finally {
            SHAPE.clay = savedClay;
        }
    }

    function renderEntryIntoCanvas(canvas, entry) {
        const cssW = canvas.clientWidth  || canvas.width;
        const cssH = canvas.clientHeight || canvas.height;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(cssW * dpr));
        const bh = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== bw)  canvas.width  = bw;
        if (canvas.height !== bh) canvas.height = bh;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr * (cssW / SHAPE.W), 0, 0,
                         dpr * (cssH / SHAPE.H), 0, 0);
        renderSavedPot(ctx, entry);
    }

    /* ----- 8B. Grid building ----- */

    function buildThumbCard(entry) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "pot-card";
        card.dataset.id = entry.id;

        const thumb = document.createElement("div");
        thumb.className = "pot-thumb";
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 300;
        thumb.appendChild(canvas);
        card.appendChild(thumb);

        const meta = document.createElement("div");
        meta.className = "pot-meta";

        const name = document.createElement("span");
        name.className = "pot-name";
        name.textContent = entry.name || "UNNAMED POT";
        meta.appendChild(name);

        const date = document.createElement("span");
        date.className = "pot-date";
        date.textContent = formatPotDate(entry.createdAt);
        meta.appendChild(date);

        const tag = document.createElement("span");
        tag.className = "pot-pack-tag";
        tag.textContent = packLabel(entry.packId);
        meta.appendChild(tag);

        card.appendChild(meta);

        card.addEventListener("click", function () { openDetail(entry); });

        /* Render async — paint may be a dataURL that needs loading. */
        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry);
        });

        return card;
    }

    function refreshGalleryGrid() {
        const grid = document.getElementById("galleryGrid");
        const empty = document.getElementById("galleryEmpty");
        const count = document.getElementById("galleryCount");
        const banner = document.getElementById("lotOfPotsBanner");
        if (!grid) return;

        GALLERY.items = loadGalleryEntries();
        grid.innerHTML = "";

        if (GALLERY.items.length === 0) {
            if (empty)  empty.hidden = false;
            if (banner) banner.hidden = true;
            if (count)  count.textContent = "0 POTS";
            return;
        }
        if (empty) empty.hidden = true;

        if (count) {
            count.textContent = GALLERY.items.length +
                (GALLERY.items.length === 1 ? " POT" : " POTS");
        }
        if (banner) banner.hidden = GALLERY.items.length < LOT_OF_POTS;

        /* Newest first */
        const arr = GALLERY.items.slice().reverse();
        for (let i = 0; i < arr.length; i++) {
            grid.appendChild(buildThumbCard(arr[i]));
        }
    }

    /* ----- 8C. Detail modal ----- */

    function openDetail(entry) {
        GALLERY.detailEntry = entry;
        const panel  = document.getElementById("potDetail");
        const canvas = document.getElementById("detailCanvas");
        const name   = document.getElementById("detailName");
        const date   = document.getElementById("detailDate");
        const pack   = document.getElementById("detailPack");
        if (!panel || !canvas) return;

        if (name) name.value = entry.name || "";
        if (date) date.textContent = formatPotDate(entry.createdAt);
        if (pack) pack.textContent = packLabel(entry.packId);

        panel.hidden = false;

        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry);
        });
    }

    function closeDetail() {
        GALLERY.detailEntry = null;
        const panel = document.getElementById("potDetail");
        if (panel) panel.hidden = true;
    }

    function saveDetailName() {
        const entry = GALLERY.detailEntry;
        if (!entry) return;
        const input = document.getElementById("detailName");
        if (!input) return;
        const newName = input.value.trim();
        if ((entry.name || "") === newName) return;
        entry.name = newName;
        /* Persist to the master array (find by id and patch). */
        const arr = loadGalleryEntries();
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].id === entry.id) { arr[i].name = newName; break; }
        }
        saveGalleryEntries(arr);
    }

    function deleteCurrentEntry() {
        const entry = GALLERY.detailEntry;
        if (!entry) return;
        const ok = window.confirm(
            "Delete this pot? This cannot be undone."
        );
        if (!ok) return;
        const arr = loadGalleryEntries().filter(function (e) {
            return e.id !== entry.id;
        });
        saveGalleryEntries(arr);
        closeDetail();
        refreshGalleryGrid();
    }

    /* ----- 8D. PNG export -----
       Renders the current detail entry to a high-res offscreen
       canvas (800×1200 — 2× logical) and triggers a download.
       Includes the wheel + backdrop so the exported PNG reads
       as a complete artwork, not just a floating silhouette.   */
    function exportCurrentEntry() {
        const entry = GALLERY.detailEntry;
        if (!entry) return;
        const W = 800, H = 1200;
        const off = document.createElement("canvas");
        off.width = W;
        off.height = H;
        const ctx = off.getContext("2d");
        ctx.setTransform(W / SHAPE.W, 0, 0, H / SHAPE.H, 0, 0);

        loadEntryPaint(entry).then(function () {
            /* Backdrop + wheel ON for shareable image */
            renderSavedPot(ctx, entry);

            off.toBlob(function (blob) {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const safe = (entry.name && entry.name.trim()) ||
                             ("pootery-" + entry.id);
                a.href = url;
                a.download = safe.replace(/[^a-z0-9_-]+/gi, "_") + ".png";
                document.body.appendChild(a);
                a.click();
                setTimeout(function () {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 200);
            }, "image/png");
        });
    }

    /* ----- 8E. Init / wiring ----- */

    function initGallery() {
        const back  = document.getElementById("galleryBack");
        const startBtn = document.getElementById("galleryStartBtn");
        const close = document.getElementById("detailClose");
        const del   = document.getElementById("detailDelete");
        const expt  = document.getElementById("detailExport");
        const name  = document.getElementById("detailName");
        const panel = document.getElementById("potDetail");

        if (back) back.addEventListener("click", function () {
            closeDetail();
            showScreen("title");
        });

        if (startBtn) startBtn.addEventListener("click", function () {
            showScreen("shape");
        });

        if (close) close.addEventListener("click", closeDetail);

        if (del) del.addEventListener("click", deleteCurrentEntry);

        if (expt) expt.addEventListener("click", exportCurrentEntry);

        if (name) {
            name.addEventListener("change", saveDetailName);
            name.addEventListener("blur",   saveDetailName);
        }

        if (panel) {
            panel.addEventListener("click", function (e) {
                if (e.target === panel) closeDetail();
            });
        }

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && panel && !panel.hidden) closeDetail();
        });
    }

    registerScreen("gallery", {
        onEnter: function () {
            if (!GALLERY.inited) {
                initGallery();
                GALLERY.inited = true;
            }
            refreshGalleryGrid();
        },
        onLeave: function () {
            closeDetail();
        }
    });

    /* ---------- 9. INIT (must run after all registerScreen calls) ---------- */

    function init() {
        initTitle();
        showScreen("title");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    /* ---------- 10. EXPORT ----------
       A tiny window namespace so chunks 2+ can register screens
       without rewriting this file. Strictly internal.            */
    window.CRAYte = {
        registerScreen: registerScreen,
        showScreen: function (id) { showScreen(id); },
        get currentScreen() { return currentScreen; }
    };

})();

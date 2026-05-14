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
        onEnter: function () { startClock(); },
        onLeave: function () { stopClock(); }
    });

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

    function renderShape() {
        const ctx = SHAPE.ctx;

        /* Background */
        ctx.fillStyle = "#0c1f25";
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
        drawShapeBackdrop(ctx);

        /* Wheel platform — drawn first so the pot covers the front
           half, leaving the back rim visible as an arc. */
        drawWheel(ctx);

        /* Pot silhouette + 3-D shading */
        drawPot(ctx);

        /* Rim opening on top (ellipse — gives the open-top look) */
        drawRim(ctx);

        /* Particles last so they're on top */
        drawParticles(ctx);

        /* Decorative HUD ticks in the corners — onioncore polish */
        drawCornerTicks(ctx);
    }

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
            if (didShape) emitParticles(SHAPE.pointer);
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

    /* ---------- 6. INIT (must run after all registerScreen calls) ---------- */

    function init() {
        initTitle();
        showScreen("title");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    /* ---------- 7. EXPORT ----------
       A tiny window namespace so chunks 2+ can register screens
       without rewriting this file. Strictly internal.            */
    window.CRAYte = {
        registerScreen: registerScreen,
        showScreen: function (id) { showScreen(id); },
        get currentScreen() { return currentScreen; }
    };

})();

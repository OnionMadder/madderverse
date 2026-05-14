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

    /* Shared by both SHAPE and DECORATE. Both screens render the same
       pot from SHAPE.clay; decorate optionally composites a paint layer
       clipped to the pot path. */
    function renderPotScene(ctx, opts) {
        opts = opts || {};

        ctx.fillStyle = "#0c1f25";
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
        drawShapeBackdrop(ctx);

        /* Wheel platform — drawn first so the pot covers the front
           half, leaving the back rim visible as an arc. */
        drawWheel(ctx);

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

        /* Rim opening on top — drawn AFTER paint so the rim ring
           stays visible even with a painted pot. */
        drawRim(ctx);

        /* Particles last so they're on top. Decorate disables. */
        if (opts.particles !== false) drawParticles(ctx);

        /* Decorative HUD ticks in the corners — onioncore polish */
        drawCornerTicks(ctx);
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

    /* ---------- 7. INIT (must run after all registerScreen calls) ---------- */

    function init() {
        initTitle();
        showScreen("title");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    /* ---------- 8. EXPORT ----------
       A tiny window namespace so chunks 2+ can register screens
       without rewriting this file. Strictly internal.            */
    window.CRAYte = {
        registerScreen: registerScreen,
        showScreen: function (id) { showScreen(id); },
        get currentScreen() { return currentScreen; }
    };

})();

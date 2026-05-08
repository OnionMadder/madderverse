(() => {
    'use strict';

    // ---------- DOM ----------
    const stage      = document.getElementById('stage');
    const bait       = document.getElementById('bait');
    const caughtEl   = document.getElementById('caughtCount');
    const yearEl     = document.getElementById('year');
    const arcLayer   = document.getElementById('arcLayer');
    const arcPath    = document.getElementById('arcPath');
    const arcTarget  = document.getElementById('arcTarget');
    const fishLine   = document.getElementById('fishLine');

    yearEl.textContent = new Date().getFullYear();

    // ---------- collection state ----------
    // Persisted catch list lives in localStorage (step 5 wires this for real).
    const STORAGE_KEY = 'go-eat-worms-collection';
    let collection = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) collection = JSON.parse(raw) || [];
    } catch (e) { /* ignore */ }
    caughtEl.textContent = collection.length;

    // ---------- cast state machine ----------
    // idle    — worm at rest on shore, waiting for touch
    // aiming  — touch held; arc preview tracking finger
    // flying  — bait launched, animating along parabola
    // landed  — bait splashed, sitting in water (step 3 hooks fish in here)
    let mode = 'idle';
    let activePointerId = null;

    // Resting position of the bait in stage coords. Computed lazily because
    // CSS positions it via bottom/left percentages until JS takes over.
    let baitRest = { x: 0, y: 0 };

    // Anchor point for the fishing line — top of the stage at the bait's
    // resting x. The line trails from here to wherever the bait is.
    let lineAnchor = { x: 0, y: 0 };

    // ---------- layout helpers ----------
    function stageRect() { return stage.getBoundingClientRect(); }

    function syncBaitRest() {
        // Read the bait's current center in stage-local coords, while it's
        // still in its CSS-positioned rest state.
        const sr = stageRect();
        const br = bait.getBoundingClientRect();
        baitRest.x = (br.left + br.right) / 2 - sr.left;
        baitRest.y = (br.top  + br.bottom) / 2 - sr.top;
        lineAnchor.x = baitRest.x;
        lineAnchor.y = 0;
        fishLine.setAttribute('x1', lineAnchor.x);
        fishLine.setAttribute('y1', lineAnchor.y);
        updateLine(baitRest.x, baitRest.y);
    }

    function updateLine(x, y) {
        fishLine.setAttribute('x2', x);
        fishLine.setAttribute('y2', y);
    }

    function setBaitPx(x, y) {
        bait.classList.add('in-flight');
        bait.style.left = x + 'px';
        bait.style.top  = y + 'px';
        updateLine(x, y);
    }

    function returnBaitToRest() {
        bait.classList.remove('in-flight');
        bait.style.left = '';
        bait.style.top  = '';
        // syncBaitRest reads the post-CSS position so subsequent flights
        // start from wherever CSS puts the bait now (handles orientation).
        syncBaitRest();
    }

    // ---------- arc math ----------
    // Quadratic Bezier from the rest position through an apex above the
    // midpoint to the target. Apex height scales with throw distance so
    // short flicks have a tighter arc than long ones.
    function computeApex(startX, startY, endX, endY) {
        const dist = Math.hypot(endX - startX, endY - startY);
        const lift = Math.max(80, dist * 0.55);
        return {
            mx: (startX + endX) / 2,
            my: Math.min(startY, endY) - lift
        };
    }

    function bezier(t, p0x, p0y, p1x, p1y, p2x, p2y) {
        const u = 1 - t;
        return {
            x: u * u * p0x + 2 * u * t * p1x + t * t * p2x,
            y: u * u * p0y + 2 * u * t * p1y + t * t * p2y
        };
    }

    // ---------- waterline test ----------
    // The shore takes up the bottom 22% of the stage. Anywhere above that
    // is "valid water" — releasing here casts. Below is "shore" — release
    // here cancels the throw.
    function isInWater(y) {
        const sr = stageRect();
        const waterlineY = sr.height * 0.78;
        return y < waterlineY - 6; // small slop to disallow edge cases
    }

    // ---------- aim ----------
    function showArc(targetX, targetY, valid) {
        const { mx, my } = computeApex(baitRest.x, baitRest.y, targetX, targetY);
        arcPath.setAttribute('d',
            `M ${baitRest.x} ${baitRest.y} Q ${mx} ${my} ${targetX} ${targetY}`);
        arcTarget.setAttribute('cx', targetX);
        arcTarget.setAttribute('cy', targetY);
        arcLayer.classList.toggle('invalid', !valid);
        arcLayer.classList.add('active');
    }

    function hideArc() {
        arcLayer.classList.remove('active', 'invalid');
    }

    // ---------- pointer handlers ----------
    bait.addEventListener('pointerdown', e => {
        if (mode !== 'idle') return;
        e.preventDefault();
        try { bait.setPointerCapture(e.pointerId); } catch (_) {}
        activePointerId = e.pointerId;
        mode = 'aiming';
        document.body.classList.add('aiming');
        syncBaitRest();
        const sr = stageRect();
        const fx = e.clientX - sr.left;
        const fy = e.clientY - sr.top;
        showArc(fx, fy, isInWater(fy));
    });

    function onMove(e) {
        if (mode !== 'aiming' || e.pointerId !== activePointerId) return;
        const sr = stageRect();
        const fx = e.clientX - sr.left;
        const fy = e.clientY - sr.top;
        showArc(fx, fy, isInWater(fy));
    }

    function onUp(e) {
        if (mode !== 'aiming' || e.pointerId !== activePointerId) return;
        try { bait.releasePointerCapture(e.pointerId); } catch (_) {}
        activePointerId = null;
        document.body.classList.remove('aiming');

        const sr = stageRect();
        const fx = e.clientX - sr.left;
        const fy = e.clientY - sr.top;

        if (!isInWater(fy)) {
            // Cancelled — release was on the shore. Reset to idle.
            mode = 'idle';
            hideArc();
            return;
        }

        hideArc();
        launchBait(fx, fy);
    }

    stage.addEventListener('pointermove',   onMove);
    stage.addEventListener('pointerup',     onUp);
    stage.addEventListener('pointercancel', onUp);

    // ---------- launch ----------
    // Animate the bait along the previewed Bezier. Keeps the fishing line
    // attached so the cast looks continuous.
    function launchBait(targetX, targetY) {
        mode = 'flying';
        document.body.classList.add('flying');
        const { mx, my } = computeApex(baitRest.x, baitRest.y, targetX, targetY);

        // Flight time scales with distance — feels more natural than a
        // fixed duration.
        const dist = Math.hypot(targetX - baitRest.x, targetY - baitRest.y);
        const duration = Math.min(950, Math.max(450, dist * 1.6));
        const start = performance.now();

        function frame(now) {
            const t = Math.min((now - start) / duration, 1);
            const p = bezier(t,
                baitRest.x, baitRest.y,
                mx, my,
                targetX, targetY);
            setBaitPx(p.x, p.y);
            if (t < 1) {
                requestAnimationFrame(frame);
            } else {
                splashAt(targetX, targetY);
                landed(targetX, targetY);
            }
        }
        requestAnimationFrame(frame);
    }

    function splashAt(x, y) {
        const ring = document.createElement('div');
        ring.className = 'splash';
        ring.style.left = x + 'px';
        ring.style.top  = y + 'px';
        stage.appendChild(ring);
        setTimeout(() => ring.remove(), 700);
        // Add a second smaller ring for layered effect.
        setTimeout(() => {
            const ring2 = document.createElement('div');
            ring2.className = 'splash';
            ring2.style.left = (x + (Math.random() - 0.5) * 18) + 'px';
            ring2.style.top  = (y + (Math.random() - 0.5) * 12) + 'px';
            ring2.style.opacity = 0.6;
            stage.appendChild(ring2);
            setTimeout(() => ring2.remove(), 700);
        }, 90);
    }

    function landed(x, y) {
        mode = 'landed';
        // Step 3 hooks fish-attraction logic here. For step 2, sit in
        // place a moment, then retrieve the bait.
        setTimeout(() => {
            mode = 'idle';
            document.body.classList.remove('flying');
            returnBaitToRest();
        }, 1400);
    }

    // ---------- orientation / resize ----------
    // Re-anchor the fishing line + bait reference if the viewport reshapes.
    // If a cast is in flight we let it complete and re-sync on landing.
    function onResize() {
        if (mode === 'idle' || mode === 'aiming') {
            syncBaitRest();
        }
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ---------- init ----------
    // Wait one frame so the .stage has its computed size before we read
    // the bait's CSS-positioned rest coords.
    requestAnimationFrame(() => {
        syncBaitRest();
    });
})();
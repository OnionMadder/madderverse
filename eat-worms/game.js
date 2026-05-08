(() => {
    'use strict';

    // ---------- DOM ----------
    const stage      = document.getElementById('stage');
    const bait       = document.getElementById('bait');
    const caughtEl   = document.getElementById('caughtCount');
    const yearEl     = document.getElementById('year');
    const bandLayer  = document.getElementById('bandLayer');
    const bandPath   = document.getElementById('bandPath');
    const bandShadow = document.getElementById('bandShadow');
    const fishLine   = document.getElementById('fishLine');

    yearEl.textContent = new Date().getFullYear();

    // ---------- collection state ----------
    const STORAGE_KEY = 'go-eat-worms-collection';
    let collection = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) collection = JSON.parse(raw) || [];
    } catch (e) { /* ignore */ }
    caughtEl.textContent = collection.length;

    // ---------- state machine ----------
    // idle      — worm at rest on shore, idle-wiggling
    // pulling   — kid is yanking the worm back, slingshot stretching
    // flying    — worm tumbling through the air after release
    // splashed  — worm landed, splash effects playing
    let mode = 'idle';
    let activePointerId = null;
    let baitAnchor = { x: 0, y: 0 };  // shore center — pivot of the slingshot
    let baitPos    = { x: 0, y: 0 };  // current worm position during pull/flight

    // ---------- helpers ----------
    function stageRect() { return stage.getBoundingClientRect(); }

    function syncAnchor() {
        // Read the worm's CSS-positioned center as the slingshot anchor.
        const sr = stageRect();
        const br = bait.getBoundingClientRect();
        baitAnchor.x = (br.left + br.right) / 2 - sr.left;
        baitAnchor.y = (br.top  + br.bottom) / 2 - sr.top;
        // Fishing line still trails from the top of stage down to the worm.
        fishLine.setAttribute('x1', baitAnchor.x);
        fishLine.setAttribute('y1', 0);
        updateLine(baitAnchor.x, baitAnchor.y);
    }

    function updateLine(x, y) {
        fishLine.setAttribute('x2', x);
        fishLine.setAttribute('y2', y);
    }

    function setBaitPx(x, y) {
        bait.style.left = x + 'px';
        bait.style.top  = y + 'px';
        updateLine(x, y);
    }

    // ---------- rubber band ----------
    // Curve sags slightly toward the bottom of the screen, like a real
    // stretchy band under tension. Two concentric strokes (shadow + pink)
    // fake a thicker, juicier line.
    function drawBand() {
        const sr = stageRect();
        const sag = Math.min(40, Math.hypot(baitPos.x - baitAnchor.x, baitPos.y - baitAnchor.y) * 0.18);
        const mx  = (baitAnchor.x + baitPos.x) / 2;
        const my  = (baitAnchor.y + baitPos.y) / 2 + sag;
        const d = `M ${baitAnchor.x} ${baitAnchor.y} Q ${mx} ${my} ${baitPos.x} ${baitPos.y}`;
        bandPath.setAttribute('d', d);
        bandShadow.setAttribute('d', d);
    }

    function showBand() { bandLayer.classList.add('active'); }
    function hideBand() { bandLayer.classList.remove('active'); }

    // ---------- comedy text bursts ----------
    const PULL_WORDS    = ['EEK!', 'OOF!', 'NOO!', 'WAIT!', 'AAAH!', 'YOINK!'];
    const LAUNCH_WORDS  = ['WHEEEE!', 'YEET!', 'WAHOO!', 'BOOYAH!', 'YIPPEE!', 'BLAST OFF!'];
    const WATER_WORDS   = ['SPLOOSH!', 'BLORP!', 'KERPLUNK!', 'PLOP!', 'GLUB GLUB!', 'SPLAT!'];
    const SHORE_WORDS   = ['FLOP!', 'OUCH!', 'DOINK!', 'BONK!', 'OOMPH!', 'OOPSIE!'];
    const RESPAWN_WORDS = ['BOING!', 'POP!', 'TA-DA!', 'BACK!'];

    function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    function spawnToon(word, x, y, variant) {
        const el = document.createElement('div');
        el.className = 'toon-text' + (variant ? ' ' + variant : '');
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
        el.style.setProperty('--toon-rot', (Math.random() * 16 - 8).toFixed(1) + 'deg');
        el.textContent = word;
        stage.appendChild(el);
        setTimeout(() => el.remove(), 900);
    }

    // ---------- splash effects ----------
    function bigSplash(x, y) {
        // Main expanding ring.
        const ring = document.createElement('div');
        ring.className = 'splash';
        ring.style.left = x + 'px';
        ring.style.top  = y + 'px';
        stage.appendChild(ring);
        setTimeout(() => ring.remove(), 1000);

        // Echo ring — slight delay + offset for a layered "double plop".
        setTimeout(() => {
            const r2 = document.createElement('div');
            r2.className = 'splash';
            r2.style.left = (x + (Math.random() - 0.5) * 24) + 'px';
            r2.style.top  = (y + (Math.random() - 0.5) * 14) + 'px';
            r2.style.opacity = 0.55;
            stage.appendChild(r2);
            setTimeout(() => r2.remove(), 1000);
        }, 110);

        // Droplets shooting out in 8 directions.
        for (let i = 0; i < 8; i++) {
            const d = document.createElement('div');
            d.className = 'splash-droplet';
            d.style.left = x + 'px';
            d.style.top  = y + 'px';
            const angle = (Math.PI * 2 * i / 8) + (Math.random() - 0.5) * 0.4;
            const dist  = 70 + Math.random() * 50;
            // Bias droplets upward so they look like splashed water arcing back.
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist - 30;
            d.style.setProperty('--dx', dx + 'px');
            d.style.setProperty('--dy', dy + 'px');
            stage.appendChild(d);
            setTimeout(() => d.remove(), 900);
        }
    }

    // ---------- pointer handlers ----------
    bait.addEventListener('pointerdown', e => {
        if (mode !== 'idle') return;
        e.preventDefault();
        try { bait.setPointerCapture(e.pointerId); } catch (_) {}
        activePointerId = e.pointerId;
        mode = 'pulling';
        syncAnchor();

        const sr = stageRect();
        baitPos.x = e.clientX - sr.left;
        baitPos.y = e.clientY - sr.top;

        // Take over positioning. .pulling clears the bottom anchor and
        // applies the panic-wiggle keyframe.
        bait.classList.remove('popping');
        bait.classList.add('pulling');
        setBaitPx(baitPos.x, baitPos.y);
        drawBand();
        showBand();

        spawnToon(pickRandom(PULL_WORDS), baitAnchor.x + 30, baitAnchor.y - 30, 'pink');
    });

    function onMove(e) {
        if (mode !== 'pulling' || e.pointerId !== activePointerId) return;
        const sr = stageRect();
        baitPos.x = e.clientX - sr.left;
        baitPos.y = e.clientY - sr.top;
        setBaitPx(baitPos.x, baitPos.y);
        drawBand();
    }

    function onUp(e) {
        if (mode !== 'pulling' || e.pointerId !== activePointerId) return;
        try { bait.releasePointerCapture(e.pointerId); } catch (_) {}
        activePointerId = null;
        hideBand();
        bait.classList.remove('pulling');
        bait.classList.add('in-flight');

        // SLINGSHOT: launch in the OPPOSITE direction of the pull,
        // scaled by how far the kid yanked. Pull DOWN-RIGHT → fling
        // UP-LEFT. Pull tiny → tiny yeet (still funny).
        const pullX = baitPos.x - baitAnchor.x;
        const pullY = baitPos.y - baitAnchor.y;
        const POWER = 5.5;
        let vx = -pullX * POWER;
        let vy = -pullY * POWER;
        // If barely yanked, bias upward so something always goes flying.
        const speed = Math.hypot(vx, vy);
        if (speed < 250) {
            vx = (Math.random() - 0.5) * 200;
            vy = -350 - Math.random() * 150;
        }

        spawnToon(pickRandom(LAUNCH_WORDS), baitPos.x, baitPos.y - 50, 'cyan');
        flyWorm(baitPos.x, baitPos.y, vx, vy);
    }

    stage.addEventListener('pointermove',   onMove);
    stage.addEventListener('pointerup',     onUp);
    stage.addEventListener('pointercancel', onUp);

    // ---------- flight ----------
    // Cartoon projectile motion: gravity + a sin-wave wobble for chaos.
    // No "valid aim" check — wherever the worm lands, comedy.
    function flyWorm(startX, startY, vx, vy) {
        mode = 'flying';
        document.body.classList.add('flying');
        const t0 = performance.now();
        const gravity = 1900;        // px/s²
        const wobbleHz = 18;
        const wobbleAmp = 5;

        function frame(now) {
            if (mode !== 'flying') return;
            const t = (now - t0) / 1000;
            const wobble = Math.sin(t * wobbleHz) * wobbleAmp;
            const x = startX + vx * t + wobble;
            const y = startY + vy * t + 0.5 * gravity * t * t;
            setBaitPx(x, y);

            const sr = stageRect();
            const waterTopY    = 0;
            const shoreLineY   = sr.height * 0.78;

            // Off the bottom of the screen — flop ending.
            if (y > sr.height + 60) {
                return endFlight(x, sr.height * 0.85, 'shore');
            }
            // Hit the shore band — flop.
            if (y >= shoreLineY && t > 0.05) {
                return endFlight(x, y, 'shore');
            }
            // Reached water area moving downward — splash. (We treat any
            // descent into water above the shore line as a splash. Even
            // crossing the top of the water counts because it's water.)
            // Detect water entry: descending through any water area.
            // Simpler: if t > 0.15 and y is within water area and moving down.
            const vy_now = vy + gravity * t;
            if (t > 0.12 && y > waterTopY && y < shoreLineY && vy_now > 0) {
                // Splash the moment the worm starts heading down WITHIN
                // the water area. Most casts splash here.
                return endFlight(x, y, 'water');
            }
            // Off the side of the screen — wrap as a flop.
            if (x < -80 || x > sr.width + 80) {
                return endFlight(Math.max(20, Math.min(sr.width - 20, x)), sr.height * 0.85, 'shore');
            }
            // Safety cap: 5 seconds of flight max.
            if (t > 5) return endFlight(x, sr.height * 0.85, 'shore');

            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function endFlight(x, y, where) {
        mode = 'splashed';
        bait.classList.remove('in-flight');
        // Briefly hide the worm under the splash so it looks like it
        // disappeared into the water (or thumped onto the ground).
        bait.style.left = x + 'px';
        bait.style.top  = y + 'px';
        bait.style.opacity = '0';

        if (where === 'water') {
            bigSplash(x, y);
            spawnToon(pickRandom(WATER_WORDS), x, y - 60, 'white');
        } else {
            spawnToon(pickRandom(SHORE_WORDS), x, y - 50, 'pink');
        }

        setTimeout(() => respawn(), 1100);
    }

    function respawn() {
        // Reset the worm back to its CSS-positioned shore home with a
        // bouncy pop so it feels like the kid has unlimited tries.
        bait.style.opacity = '';
        bait.style.left = '';
        bait.style.top  = '';
        bait.classList.remove('in-flight', 'pulling');
        document.body.classList.remove('flying');
        // Force a reflow so the popping animation always restarts.
        // eslint-disable-next-line no-unused-expressions
        void bait.offsetWidth;
        bait.classList.add('popping');
        setTimeout(() => bait.classList.remove('popping'), 460);
        spawnToon(pickRandom(RESPAWN_WORDS), 0, 0, 'cyan'); // positioned below
        // Position the respawn toon at the worm's home.
        const last = stage.querySelector('.toon-text:last-of-type');
        // We want it at the worm anchor; recompute now that CSS owns the
        // worm position again.
        requestAnimationFrame(() => {
            syncAnchor();
            if (last) {
                last.style.left = baitAnchor.x + 'px';
                last.style.top  = (baitAnchor.y - 30) + 'px';
            }
        });
        mode = 'idle';
    }

    // ---------- orientation / resize ----------
    function onResize() {
        if (mode === 'idle') {
            syncAnchor();
        }
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ---------- init ----------
    requestAnimationFrame(() => {
        syncAnchor();
    });
})();

(async () => {
    'use strict';

    // ---------- DOM ----------
    const stage      = document.getElementById('stage');
    const bait       = document.getElementById('bait');
    const baitSprite = document.getElementById('baitSprite');
    const caughtEl   = document.getElementById('caughtCount');
    const yearEl     = document.getElementById('year');
    const fishLine   = document.getElementById('fishLine');
    const lineLayer  = document.getElementById('lineLayer');
    const wipe       = document.getElementById('wipe');

    yearEl.textContent = new Date().getFullYear();

    // ====================================================================
    //                       4-PHASE SPRITE ENGINE
    // ====================================================================
    // The worm has four behavioural phases — panic, catch, fling, land —
    // each backed by its own sprite sheet (`sprites/<phase>.png` +
    // `sprites/<phase>.json`). Each sheet has 6 frames; per-frame x/y/w/h
    // come from the JSON. Frames vary slightly in size (106-113 px), so
    // we update the sprite element's width / height on every frame swap
    // rather than assuming a uniform grid.
    //
    // Phase numbering in the source JSONs is sequential across sheets
    // (panic 1-6, catch 7-12, fling 13-17 + 20, land 1-6) so we sort the
    // numeric keys per sheet and trust those to be the playback order.

    const PHASE_NAMES = ['panic', 'catch', 'fling', 'land'];
    const PHASES = {};

    async function loadSpriteManifests() {
        await Promise.all(PHASE_NAMES.map(async (name) => {
            const res = await fetch(`sprites/${name}.json`);
            const data = await res.json();
            const sortedKeys = Object.keys(data.frames).sort((a, b) => +a - +b);
            const frames = sortedKeys.map(k => data.frames[k].frame);
            PHASES[name] = {
                src: `sprites/${name}.png`,
                sheetW: data.meta.size.w,
                sheetH: data.meta.size.h,
                frames
            };
        }));
    }

    /** Set the sprite element to render frame `idx` of `phase`. */
    function showFrame(phase, idx) {
        const def = PHASES[phase];
        if (!def) return;
        const f = def.frames[idx];
        if (!f) return;
        baitSprite.style.backgroundImage  = `url("${def.src}")`;
        baitSprite.style.backgroundSize   = `${def.sheetW}px ${def.sheetH}px`;
        baitSprite.style.backgroundPosition = `-${f.x}px -${f.y}px`;
        baitSprite.style.width  = f.w + 'px';
        baitSprite.style.height = f.h + 'px';
    }

    /** Play a phase. Loops by default; pass loop:false + onEnd for a
     *  one-shot (used for the land sequence on water entry). */
    let animState = null;
    function playPhase(phase, opts) {
        opts = opts || {};
        const def = PHASES[phase];
        if (!def) return;
        if (animState && animState.raf) cancelAnimationFrame(animState.raf);
        animState = {
            phase, idx: 0, lastT: 0,
            fps:  opts.fps || 12,
            loop: opts.loop !== false,
            onEnd: opts.onEnd || null,
            done: false
        };
        showFrame(phase, 0);
        animState.raf = requestAnimationFrame(tickAnim);
    }
    function tickAnim(now) {
        if (!animState || animState.done) return;
        if (!animState.lastT) animState.lastT = now;
        const def = PHASES[animState.phase];
        const frameDur = 1000 / animState.fps;
        if (now - animState.lastT >= frameDur) {
            animState.lastT = now;
            animState.idx++;
            if (animState.idx >= def.frames.length) {
                if (animState.loop) animState.idx = 0;
                else {
                    animState.idx = def.frames.length - 1;
                    animState.done = true;
                    showFrame(animState.phase, animState.idx);
                    if (animState.onEnd) animState.onEnd();
                    return;
                }
            }
            showFrame(animState.phase, animState.idx);
        }
        animState.raf = requestAnimationFrame(tickAnim);
    }
    function stopAnim() {
        if (animState && animState.raf) cancelAnimationFrame(animState.raf);
        animState = null;
    }

    // ---------- collection state ----------
    const STORAGE_KEY = 'go-eat-worms-collection';
    let collection = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) collection = JSON.parse(raw) || [];
    } catch (e) { /* ignore */ }
    caughtEl.textContent = collection.length;

    // ====================================================================
    //                       STATE MACHINE
    // ====================================================================
    // idle      — sprite parked on panic frame 0 (the calm pose), CSS
    //             bait-idle-wiggle handles the bobbing. No anim driver.
    // panic     — cursor came within proximity (desktop) OR worm tapped
    //             on touch. Loops the panic sheet. Returns to idle when
    //             cursor leaves on desktop.
    // pulling   — pointerdown sustained AND moved past CATCH_THRESHOLD,
    //             worm being yanked back. Loops the catch sheet.
    // flying    — released, slingshot in flight. Loops the fling sheet.
    // splashed  — water entry, plays the land sheet ONCE then transitions
    //             to underwater placeholder.
    // submerged — `.stage.underwater` is set; sky fades, water fills the
    //             stage, worm + fish silhouettes appear (placeholders
    //             until the side-view art lands).
    let mode = 'idle';
    let activePointerId = null;

    let baitRest    = { x: 0, y: 0 };
    let baitPos     = { x: 0, y: 0 };
    let pointerStart = { x: 0, y: 0 };
    let rodTip      = { x: 0, y: 0 };

    const ROD_OFFSCREEN_OFFSET = 80;
    const MAX_PULL_DIST   = 260;
    const PROXIMITY_PX    = 130;
    const CATCH_THRESHOLD = 18;
    const HORIZON_FRAC    = 0.50; // y >= horizon → in water

    // ---------- helpers ----------
    function stageRect() { return stage.getBoundingClientRect(); }

    function syncRest() {
        const sr = stageRect();
        const br = bait.getBoundingClientRect();
        baitRest.x = (br.left + br.right) / 2 - sr.left;
        baitRest.y = (br.top  + br.bottom) / 2 - sr.top;
        rodTip.x   = baitRest.x;
        rodTip.y   = sr.height + ROD_OFFSCREEN_OFFSET;
        fishLine.setAttribute('x1', rodTip.x);
        fishLine.setAttribute('y1', rodTip.y);
        updateLine(baitRest.x, baitRest.y);
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

    // ---------- comedy text ----------
    const PULL_WORDS    = ['EEK!', 'OOF!', 'WAIT!', 'YOINK!'];
    const LAUNCH_WORDS  = ['WHEEEE!', 'YEET!', 'WAHOO!', 'BLAST OFF!'];
    const WATER_WORDS   = ['SPLOOSH!', 'BLORP!', 'KERPLUNK!', 'GLUB GLUB!'];
    const SHORE_WORDS   = ['FLOP!', 'OOPSIE!', 'DOINK!', 'BONK!'];
    const RESPAWN_WORDS = ['BOING!', 'POP!', 'TA-DA!'];
    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

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

    // ====================================================================
    //                          WEB AUDIO
    // ====================================================================
    let audioCtx = null;
    function ensureAudio() {
        if (!audioCtx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            audioCtx = new Ctor();
        }
        if (audioCtx.state === 'suspended') {
            try { audioCtx.resume(); } catch (_) {}
        }
        return audioCtx;
    }
    window.__wormScreams = window.__wormScreams || { count: 0, last: null };

    const SCREAM_TYPES = ['long-aaaa', 'hiccup', 'wheee', 'raspberry'];
    function playScream(type, durationSec) {
        const ctx = ensureAudio();
        if (!ctx) return false;
        const variant = type || pickRandom(SCREAM_TYPES);
        const now = ctx.currentTime;
        const dur = durationSec || (0.85 + Math.random() * 0.45);
        const out = ctx.createGain();
        out.gain.value = 0.22;
        out.connect(ctx.destination);
        if (variant === 'raspberry') {
            const noise = ctx.createBufferSource();
            const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
            noise.buffer = buf;
            const filt = ctx.createBiquadFilter();
            filt.type = 'bandpass';
            filt.frequency.setValueAtTime(220, now);
            filt.frequency.exponentialRampToValueAtTime(90, now + dur);
            filt.Q.value = 8;
            const trem = ctx.createOscillator();
            trem.frequency.value = 22;
            const tg = ctx.createGain(); tg.gain.value = 0.4;
            trem.connect(tg).connect(out.gain);
            trem.start(now); trem.stop(now + dur);
            noise.connect(filt).connect(out);
            noise.start(now); noise.stop(now + dur);
        } else {
            const osc = ctx.createOscillator();
            osc.type = (variant === 'wheee') ? 'square' : 'sawtooth';
            const startHz = (variant === 'wheee') ? 440 : 600 + Math.random() * 160;
            const endHz   = (variant === 'wheee') ? 90  : 130 + Math.random() * 40;
            osc.frequency.setValueAtTime(startHz, now);
            osc.frequency.exponentialRampToValueAtTime(endHz, now + dur);
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 7 + Math.random() * 5;
            const ld = ctx.createGain(); ld.gain.value = 45;
            lfo.connect(ld).connect(osc.frequency);
            lfo.start(now); lfo.stop(now + dur);
            const filt = ctx.createBiquadFilter();
            filt.type = 'lowpass';
            filt.frequency.value = 1900;
            filt.Q.value = 5;
            const gain = ctx.createGain();
            if (variant === 'hiccup') {
                let t = now;
                while (t < now + dur) {
                    gain.gain.setValueAtTime(0.0008, t);
                    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
                    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);
                    t += 0.10;
                }
            } else {
                gain.gain.setValueAtTime(0.0008, now);
                gain.gain.exponentialRampToValueAtTime(0.9, now + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);
            }
            osc.connect(filt).connect(gain).connect(out);
            osc.start(now); osc.stop(now + dur);
        }
        window.__wormScreams.count += 1;
        window.__wormScreams.last  = { type: variant, dur, startedAt: performance.now() };
        return true;
    }

    function playSplash() {
        const ctx = ensureAudio();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(170, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.28);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0008, now);
        og.gain.exponentialRampToValueAtTime(0.42, now + 0.012);
        og.gain.exponentialRampToValueAtTime(0.0008, now + 0.4);
        osc.connect(og).connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.45);
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.22, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
        noise.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1300;
        const ng = ctx.createGain(); ng.gain.value = 0.18;
        noise.connect(hp).connect(ng).connect(ctx.destination);
        noise.start(now);
    }
    function playGlubGlub() {
        const ctx = ensureAudio();
        if (!ctx) return;
        const count = 4 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            const delay = 0.12 + Math.random() * 1.0;
            const t0 = ctx.currentTime + delay;
            const baseHz = 80 + Math.random() * 70;
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(baseHz * 1.5, t0);
            osc.frequency.exponentialRampToValueAtTime(baseHz * 0.65, t0 + 0.09);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0006, t0);
            gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.13);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t0); osc.stop(t0 + 0.16);
        }
    }

    // ====================================================================
    //                       VFX HELPERS
    // ====================================================================
    function bigSplash(x, y) {
        const ring = document.createElement('div');
        ring.className = 'splash';
        ring.style.left = x + 'px'; ring.style.top  = y + 'px';
        stage.appendChild(ring);
        setTimeout(() => ring.remove(), 1000);
        setTimeout(() => {
            const r2 = document.createElement('div');
            r2.className = 'splash';
            r2.style.left = (x + (Math.random() - 0.5) * 24) + 'px';
            r2.style.top  = (y + (Math.random() - 0.5) * 14) + 'px';
            r2.style.opacity = 0.55;
            stage.appendChild(r2);
            setTimeout(() => r2.remove(), 1000);
        }, 110);
        for (let i = 0; i < 8; i++) {
            const d = document.createElement('div');
            d.className = 'splash-droplet';
            d.style.left = x + 'px'; d.style.top  = y + 'px';
            const angle = (Math.PI * 2 * i / 8) + (Math.random() - 0.5) * 0.4;
            const dist  = 70 + Math.random() * 50;
            d.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
            d.style.setProperty('--dy', (Math.sin(angle) * dist - 30) + 'px');
            stage.appendChild(d);
            setTimeout(() => d.remove(), 900);
        }
    }
    function spawnRippleChase(splashX, splashY, restX, restY) {
        const STEPS = 4;
        for (let i = 0; i < STEPS; i++) {
            const t = (i + 1) / (STEPS + 1);
            const dx = restX - splashX;
            const dy = restY - splashY;
            const len = Math.hypot(dx, dy) || 1;
            const perpX = -dy / len * 18 * Math.sin(t * Math.PI);
            const perpY =  dx / len * 18 * Math.sin(t * Math.PI);
            const x = splashX + dx * t + perpX;
            const y = splashY + dy * t + perpY;
            setTimeout(() => {
                const r = document.createElement('div');
                r.className = 'ripple';
                r.style.left = x + 'px'; r.style.top  = y + 'px';
                stage.appendChild(r);
                setTimeout(() => r.remove(), 1100);
            }, i * 220);
        }
    }
    function gentleVibrate(ms) {
        if ('vibrate' in navigator) {
            try { navigator.vibrate(ms); } catch (_) {}
        }
    }

    // ====================================================================
    //                       INPUT
    // ====================================================================

    // Cursor-proximity panic — desktop only. Touch devices don't fire
    // hover-style mousemoves so they hit panic via pointerdown.
    let proximityIdleTimer = null;
    document.addEventListener('mousemove', e => {
        if (mode !== 'idle' && mode !== 'panic') return;
        const sr = stageRect();
        const br = bait.getBoundingClientRect();
        const cx = (br.left + br.right) / 2;
        const cy = (br.top  + br.bottom) / 2;
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (dist < PROXIMITY_PX) {
            if (mode === 'idle') {
                mode = 'panic';
                playPhase('panic', { fps: 14, loop: true });
            }
            clearTimeout(proximityIdleTimer);
            proximityIdleTimer = null;
        } else if (mode === 'panic') {
            if (proximityIdleTimer == null) {
                proximityIdleTimer = setTimeout(() => {
                    if (mode === 'panic') {
                        mode = 'idle';
                        stopAnim();
                        showFrame('panic', 0);
                    }
                    proximityIdleTimer = null;
                }, 350);
            }
        }
    });

    bait.addEventListener('pointerdown', e => {
        if (mode !== 'idle' && mode !== 'panic') return;
        e.preventDefault();
        ensureAudio();
        try { bait.setPointerCapture(e.pointerId); } catch (_) {}
        activePointerId = e.pointerId;

        // Touch devices: tap → panic phase first so the kid sees the
        // worm freak out before the catch animation takes over once
        // they actually start dragging.
        if (mode === 'idle') {
            mode = 'panic';
            playPhase('panic', { fps: 14, loop: true });
        }

        const sr = stageRect();
        pointerStart.x = e.clientX - sr.left;
        pointerStart.y = e.clientY - sr.top;
        baitPos.x = pointerStart.x;
        baitPos.y = pointerStart.y;

        bait.classList.remove('popping');
        bait.classList.add('pulling');
        syncRest();
        setBaitPx(baitPos.x, baitPos.y);
        spawnToon(pickRandom(PULL_WORDS), baitRest.x + 30, baitRest.y - 30, 'pink');
    });

    function onMove(e) {
        if (mode !== 'panic' && mode !== 'pulling') return;
        if (e.pointerId !== activePointerId) return;
        const sr = stageRect();
        baitPos.x = e.clientX - sr.left;
        baitPos.y = e.clientY - sr.top;
        setBaitPx(baitPos.x, baitPos.y);
        updateTension();

        // Transition panic → pulling once they've actually dragged the
        // worm (not just tapped it). This is the "catch" phase.
        if (mode === 'panic') {
            const moved = Math.hypot(baitPos.x - pointerStart.x, baitPos.y - pointerStart.y);
            if (moved > CATCH_THRESHOLD) {
                mode = 'pulling';
                playPhase('catch', { fps: 12, loop: true });
            }
        }
    }
    function updateTension() {
        const dx = baitPos.x - baitRest.x;
        const dy = baitPos.y - baitRest.y;
        const dist = Math.hypot(dx, dy);
        const tension = Math.min(1, dist / MAX_PULL_DIST);
        if (tension > 0.18) {
            lineLayer.classList.add('taut');
            if (tension > 0.85 && !lineLayer.dataset.hapticFired) {
                gentleVibrate(20);
                lineLayer.dataset.hapticFired = '1';
            }
        } else {
            lineLayer.classList.remove('taut');
            delete lineLayer.dataset.hapticFired;
        }
        lineLayer.style.setProperty('--tension', tension.toFixed(3));
    }

    function onUp(e) {
        if (mode !== 'panic' && mode !== 'pulling') return;
        if (e.pointerId !== activePointerId) return;
        try { bait.releasePointerCapture(e.pointerId); } catch (_) {}
        activePointerId = null;
        lineLayer.classList.remove('taut');
        delete lineLayer.dataset.hapticFired;

        bait.classList.remove('pulling');
        bait.classList.add('in-flight');

        const pullX = baitPos.x - baitRest.x;
        const pullY = baitPos.y - baitRest.y;
        const POWER = 5.5;
        let vx = -pullX * POWER;
        let vy = -pullY * POWER;
        const speed = Math.hypot(vx, vy);
        if (speed < 250) {
            vx = (Math.random() - 0.5) * 240;
            vy = -380 - Math.random() * 160;
        }

        spawnToon(pickRandom(LAUNCH_WORDS), baitPos.x, baitPos.y - 50, 'cyan');
        playScream();
        flyWorm(baitPos.x, baitPos.y, vx, vy);
    }

    stage.addEventListener('pointermove',   onMove);
    stage.addEventListener('pointerup',     onUp);
    stage.addEventListener('pointercancel', onUp);

    // ====================================================================
    //                          FLIGHT
    // ====================================================================
    function flyWorm(startX, startY, vx, vy) {
        mode = 'flying';
        document.body.classList.add('flying');
        playPhase('fling', { fps: 14, loop: true });
        const t0 = performance.now();
        const gravity = 1900;
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
            const horizonY = sr.height * HORIZON_FRAC;
            const vyNow = vy + gravity * t;

            if (y > sr.height + 60) return endFlight(x, sr.height * 0.85, 'shore');
            if (t > 0.12 && y > horizonY && y < sr.height - 20 && vyNow > 0) return endFlight(x, y, 'water');
            if (x < -80 || x > sr.width + 80) return endFlight(Math.max(20, Math.min(sr.width - 20, x)), sr.height * 0.85, 'shore');
            if (t > 5) return endFlight(x, sr.height * 0.85, 'shore');

            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function endFlight(x, y, where) {
        mode = 'splashed';
        bait.classList.remove('in-flight');

        if (where === 'water') {
            playSplash();
            bigSplash(x, y);
            spawnToon(pickRandom(WATER_WORDS), x, y - 60, 'white');
            stage.classList.add('shake');
            setTimeout(() => stage.classList.remove('shake'), 320);
            playGlubGlub();
            spawnRippleChase(x, y, x, y);

            // Land animation plays once. When it finishes, fire the
            // wipe → underwater scene.
            bait.style.left = x + 'px';
            bait.style.top  = y + 'px';
            playPhase('land', { fps: 10, loop: false, onEnd: () => {
                setTimeout(() => sinkToUnderwater(x, y), 100);
            }});
        } else {
            spawnToon(pickRandom(SHORE_WORDS), x, y - 50, 'pink');
            bait.style.left = x + 'px';
            bait.style.top  = y + 'px';
            bait.style.opacity = '0';
            setTimeout(() => respawn(), 900);
        }
    }

    /** Black wipe across screen, then reveal underwater silhouette
     *  layer + flip stage to .underwater (sky fades, water fills). */
    function sinkToUnderwater(x, y) {
        mode = 'submerged';
        // Restart the wipe animation cleanly.
        wipe.classList.remove('go');
        // eslint-disable-next-line no-unused-expressions
        void wipe.offsetWidth;
        wipe.classList.add('go');
        // At wipe midpoint, swap to the underwater scene.
        setTimeout(() => {
            stage.classList.add('underwater');
            bait.style.opacity = '0';
        }, 300);
        // Hold the underwater view, then return to the fishing scene.
        setTimeout(() => respawn(), 3000);
    }

    function respawn() {
        bait.style.opacity = '';
        bait.style.left = '';
        bait.style.top  = '';
        bait.classList.remove('in-flight', 'pulling', 'underwater');
        document.body.classList.remove('flying');
        stage.classList.remove('underwater');
        stopAnim();
        showFrame('panic', 0);
        // eslint-disable-next-line no-unused-expressions
        void bait.offsetWidth;
        bait.classList.add('popping');
        setTimeout(() => bait.classList.remove('popping'), 460);
        requestAnimationFrame(() => {
            syncRest();
            spawnToon(pickRandom(RESPAWN_WORDS), baitRest.x, baitRest.y - 30, 'cyan');
        });
        mode = 'idle';
    }

    // ---------- orientation / resize ----------
    function onResize() {
        if (mode === 'idle') syncRest();
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ---------- init ----------
    await loadSpriteManifests();
    showFrame('panic', 0);
    requestAnimationFrame(() => syncRest());
    window.__eatWormsReady = true;
})();

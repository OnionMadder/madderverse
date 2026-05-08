(() => {
    'use strict';

    // ---------- DOM ----------
    const stage      = document.getElementById('stage');
    const bait       = document.getElementById('bait');
    const caughtEl   = document.getElementById('caughtCount');
    const yearEl     = document.getElementById('year');
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
    // idle      — worm dangles on the line, idle-wiggling
    // pulling   — kid is yanking the worm down/back; line under tension
    // flying    — worm slingshotted, screaming through the air
    // splashed  — worm hit water, splash + glub-glub + ripple chase
    // submerged — worm bobs in water (placeholder until step 4 wires bite)
    let mode = 'idle';
    let activePointerId = null;

    // The worm's "rest position" — its CSS-positioned center on the line.
    let baitRest = { x: 0, y: 0 };
    // Where the worm currently is (during pull and flight).
    let baitPos  = { x: 0, y: 0 };
    // Rod tip — the line origin, kept off-screen below the visible
    // viewport so the line "comes up from below" out of the player's
    // POV (their hands are off-screen south).
    let rodTip   = { x: 0, y: 0 };

    const ROD_OFFSCREEN_OFFSET = 80;   // px below the bottom edge
    const MAX_PULL_DIST = 260;          // pixels of pull → 1.0 tension

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
    const PULL_WORDS    = ['EEK!', 'OOF!', 'NOO!', 'WAIT!', 'YOINK!'];
    const LAUNCH_WORDS  = ['WHEEEE!', 'YEET!', 'WAHOO!', 'BLAST OFF!', 'YIPPEE!'];
    const WATER_WORDS   = ['SPLOOSH!', 'BLORP!', 'KERPLUNK!', 'PLOP!', 'GLUB GLUB!'];
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
    //                            WEB AUDIO
    // ====================================================================
    // All sounds synthesized — no audio files. Audio context is lazy
    // because Chrome / iOS Safari block autoplay until the first user
    // gesture; we ensure() inside pointerdown so the context is unlocked
    // before any actual sound needs to play.
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

    // Verifiable hook: each scream bumps these so a test can assert it
    // fired without needing to actually decode audio.
    window.__wormScreams = window.__wormScreams || { count: 0, last: null };

    const SCREAM_TYPES = ['long-aaaa', 'hiccup', 'wheee', 'raspberry'];

    /**
     * Worm's panicked scream during flight. Pitch envelope from ~600Hz
     * down to ~150Hz with a vibrato wobble. 4 personality variants:
     *   long-aaaa  : sawtooth lowpass, classic descending wail.
     *   hiccup     : sawtooth gated rapidly so it stutters.
     *   wheee      : square wave, slower descent, more "rollercoaster".
     *   raspberry  : low-freq wobble + noise, deflating-balloon vibe.
     */
    function playScream(type, durationSec) {
        const ctx = ensureAudio();
        if (!ctx) return false;

        const variant = type || pickRandom(SCREAM_TYPES);
        const now = ctx.currentTime;
        const dur = durationSec || (0.85 + Math.random() * 0.45);

        // Master out for this scream.
        const out = ctx.createGain();
        out.gain.value = 0.22;
        out.connect(ctx.destination);

        if (variant === 'raspberry') {
            // Raspberry: noisy + tremolo'd at low frequency, deflating.
            const noise = ctx.createBufferSource();
            const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
            }
            noise.buffer = buf;
            const filt = ctx.createBiquadFilter();
            filt.type = 'bandpass';
            filt.frequency.setValueAtTime(220, now);
            filt.frequency.exponentialRampToValueAtTime(90, now + dur);
            filt.Q.value = 8;
            const trem = ctx.createOscillator();
            trem.frequency.value = 22;
            const tremGain = ctx.createGain();
            tremGain.gain.value = 0.4;
            trem.connect(tremGain).connect(out.gain);
            trem.start(now);
            trem.stop(now + dur);
            noise.connect(filt).connect(out);
            noise.start(now);
            noise.stop(now + dur);
        } else {
            const osc = ctx.createOscillator();
            osc.type = (variant === 'wheee') ? 'square' : 'sawtooth';

            const startHz = (variant === 'wheee') ? 440 : 600 + Math.random() * 160;
            const endHz   = (variant === 'wheee') ? 90  : 130 + Math.random() * 40;
            osc.frequency.setValueAtTime(startHz, now);
            osc.frequency.exponentialRampToValueAtTime(endHz, now + dur);

            // Vibrato LFO — fast wobble for "AHHH" character.
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 7 + Math.random() * 5;
            const lfoDepth = ctx.createGain();
            lfoDepth.gain.value = 45;
            lfo.connect(lfoDepth).connect(osc.frequency);
            lfo.start(now);
            lfo.stop(now + dur);

            // Filter for less harsh edge.
            const filt = ctx.createBiquadFilter();
            filt.type = 'lowpass';
            filt.frequency.value = 1900;
            filt.Q.value = 5;

            const gain = ctx.createGain();
            if (variant === 'hiccup') {
                // Rapid amplitude stutters — like a panicked sob.
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
            osc.start(now);
            osc.stop(now + dur);
        }

        // Verifiable hook.
        window.__wormScreams.count += 1;
        window.__wormScreams.last  = { type: variant, dur, startedAt: performance.now() };
        return true;
    }

    /** Low-frequency *plonk* on water entry — ~150Hz dropping to ~60Hz, with a
     *  high-pass noise burst for splash crackle. */
    function playSplash() {
        const ctx = ensureAudio();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(170, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.28);
        const oGain = ctx.createGain();
        oGain.gain.setValueAtTime(0.0008, now);
        oGain.gain.exponentialRampToValueAtTime(0.42, now + 0.012);
        oGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.4);
        osc.connect(oGain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);

        // White-noise burst for the splash crackle.
        const noise = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.22, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
        }
        noise.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1300;
        const nGain = ctx.createGain();
        nGain.gain.value = 0.18;
        noise.connect(hp).connect(nGain).connect(ctx.destination);
        noise.start(now);
    }

    /** A handful of low-pitched bubble pops at irregular intervals, like
     *  the worm bobbing under water muttering "blub blub". */
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
            osc.start(t0);
            osc.stop(t0 + 0.16);
        }
    }

    // ====================================================================
    //                       VISUAL EFFECTS HELPERS
    // ====================================================================

    function bigSplash(x, y) {
        const ring = document.createElement('div');
        ring.className = 'splash';
        ring.style.left = x + 'px';
        ring.style.top  = y + 'px';
        stage.appendChild(ring);
        setTimeout(() => ring.remove(), 1000);
        // Echo ring.
        setTimeout(() => {
            const r2 = document.createElement('div');
            r2.className = 'splash';
            r2.style.left = (x + (Math.random() - 0.5) * 24) + 'px';
            r2.style.top  = (y + (Math.random() - 0.5) * 14) + 'px';
            r2.style.opacity = 0.55;
            stage.appendChild(r2);
            setTimeout(() => r2.remove(), 1000);
        }, 110);
        // Droplets shooting outward.
        for (let i = 0; i < 8; i++) {
            const d = document.createElement('div');
            d.className = 'splash-droplet';
            d.style.left = x + 'px';
            d.style.top  = y + 'px';
            const angle = (Math.PI * 2 * i / 8) + (Math.random() - 0.5) * 0.4;
            const dist  = 70 + Math.random() * 50;
            d.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
            d.style.setProperty('--dy', (Math.sin(angle) * dist - 30) + 'px');
            stage.appendChild(d);
            setTimeout(() => d.remove(), 900);
        }
    }

    /** "Fish chasing" trail — 4 expanding ripple circles staggered along
     *  a curve from the splash point toward where the worm comes to rest
     *  underwater. Builds anticipation that something is hunting from below. */
    function spawnRippleChase(splashX, splashY, restX, restY) {
        const STEPS = 4;
        for (let i = 0; i < STEPS; i++) {
            const t = (i + 1) / (STEPS + 1);
            // Slight perpendicular curve so the trail reads as "swimming".
            const dx = restX - splashX;
            const dy = restY - splashY;
            const perpX = -dy / Math.hypot(dx, dy) * 18 * Math.sin(t * Math.PI);
            const perpY =  dx / Math.hypot(dx, dy) * 18 * Math.sin(t * Math.PI);
            const x = splashX + dx * t + perpX;
            const y = splashY + dy * t + perpY;
            setTimeout(() => {
                const r = document.createElement('div');
                r.className = 'ripple';
                r.style.left = x + 'px';
                r.style.top  = y + 'px';
                stage.appendChild(r);
                setTimeout(() => r.remove(), 1100);
            }, i * 220);
        }
        // A few rising bubbles from the splash zone for the "glub" visual.
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                const b = document.createElement('div');
                b.className = 'bubble';
                const bx = splashX + (Math.random() - 0.5) * 50;
                const by = splashY + (Math.random() - 0.5) * 20;
                b.style.left = bx + 'px';
                b.style.top  = by + 'px';
                b.style.setProperty('--bx', ((Math.random() - 0.5) * 30) + 'px');
                b.style.setProperty('--by', (-50 - Math.random() * 40) + 'px');
                stage.appendChild(b);
                setTimeout(() => b.remove(), 1500);
            }, 160 + i * 110);
        }
    }

    function gentleVibrate(ms) {
        if ('vibrate' in navigator) {
            try { navigator.vibrate(ms); } catch (_) {}
        }
    }

    // ====================================================================
    //                          POINTER + STATE
    // ====================================================================

    bait.addEventListener('pointerdown', e => {
        if (mode !== 'idle') return;
        e.preventDefault();
        ensureAudio();   // unlock audio on the gesture
        try { bait.setPointerCapture(e.pointerId); } catch (_) {}
        activePointerId = e.pointerId;
        mode = 'pulling';
        syncRest();

        const sr = stageRect();
        baitPos.x = e.clientX - sr.left;
        baitPos.y = e.clientY - sr.top;

        bait.classList.remove('popping');
        bait.classList.add('pulling');
        setBaitPx(baitPos.x, baitPos.y);
        updateTension();

        spawnToon(pickRandom(PULL_WORDS), baitRest.x + 30, baitRest.y - 30, 'pink');
    });

    function onMove(e) {
        if (mode !== 'pulling' || e.pointerId !== activePointerId) return;
        const sr = stageRect();
        baitPos.x = e.clientX - sr.left;
        baitPos.y = e.clientY - sr.top;
        setBaitPx(baitPos.x, baitPos.y);
        updateTension();
    }

    function updateTension() {
        const dx = baitPos.x - baitRest.x;
        const dy = baitPos.y - baitRest.y;
        const dist = Math.hypot(dx, dy);
        const tension = Math.min(1, dist / MAX_PULL_DIST);
        const layer = document.getElementById('lineLayer');
        if (tension > 0.18) {
            layer.classList.add('taut');
            // Gentle haptic at peak tension once.
            if (tension > 0.85 && !layer.dataset.hapticFired) {
                gentleVibrate(20);
                layer.dataset.hapticFired = '1';
            }
        } else {
            layer.classList.remove('taut');
            delete layer.dataset.hapticFired;
        }
        layer.style.setProperty('--tension', tension.toFixed(3));
    }

    function onUp(e) {
        if (mode !== 'pulling' || e.pointerId !== activePointerId) return;
        try { bait.releasePointerCapture(e.pointerId); } catch (_) {}
        activePointerId = null;
        const layer = document.getElementById('lineLayer');
        layer.classList.remove('taut');
        delete layer.dataset.hapticFired;

        bait.classList.remove('pulling');
        bait.classList.add('in-flight');

        // Slingshot: launch in the OPPOSITE direction of the pull.
        const pullX = baitPos.x - baitRest.x;
        const pullY = baitPos.y - baitRest.y;
        const POWER = 5.5;
        let vx = -pullX * POWER;
        let vy = -pullY * POWER;
        const speed = Math.hypot(vx, vy);
        if (speed < 250) {
            // Tiny pull → still send it flying somewhere silly.
            vx = (Math.random() - 0.5) * 240;
            vy = -380 - Math.random() * 160;
        }

        spawnToon(pickRandom(LAUNCH_WORDS), baitPos.x, baitPos.y - 50, 'cyan');

        // The headline scream — fires synchronously at release so a
        // verifiable test catches the call before any RAF runs.
        playScream();

        flyWorm(baitPos.x, baitPos.y, vx, vy);
    }

    stage.addEventListener('pointermove',   onMove);
    stage.addEventListener('pointerup',     onUp);
    stage.addEventListener('pointercancel', onUp);

    // ---------- flight ----------
    function flyWorm(startX, startY, vx, vy) {
        mode = 'flying';
        document.body.classList.add('flying');
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
            const vyNow = vy + gravity * t;

            if (y > sr.height + 60) {
                return endFlight(x, sr.height * 0.85, 'shore');
            }
            // Worm enters water once it's descending inside the visible
            // water area (which is most of the stage now). The "shore"
            // band is gone — falling off the bottom is shore-style flop.
            if (t > 0.12 && y > 0 && y < sr.height - 20 && vyNow > 0) {
                return endFlight(x, y, 'water');
            }
            if (x < -80 || x > sr.width + 80) {
                return endFlight(Math.max(20, Math.min(sr.width - 20, x)), sr.height * 0.85, 'shore');
            }
            if (t > 5) return endFlight(x, sr.height * 0.85, 'shore');

            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function endFlight(x, y, where) {
        mode = 'splashed';
        bait.classList.remove('in-flight');

        if (where === 'water') {
            // SPLASH! The big sequence.
            playSplash();
            bigSplash(x, y);
            spawnToon(pickRandom(WATER_WORDS), x, y - 60, 'white');
            stage.classList.add('shake');
            setTimeout(() => stage.classList.remove('shake'), 320);

            // Then: glub-glub + ripple chase as a "fish hunts from below"
            // sequence. The worm settles at (x, y) underwater while the
            // ripples trail toward it.
            playGlubGlub();
            spawnRippleChase(x, y, x, y + 0);

            // Park the worm under water briefly so it visually bobs there.
            setTimeout(() => {
                bait.classList.add('underwater');
                bait.style.left = x + 'px';
                bait.style.top  = y + 'px';
                bait.style.opacity = '0.9';
                mode = 'submerged';
            }, 60);

            // For step 2, after a beat, retrieve the worm (step 4 will
            // wire the bite + reel mini-game in here instead).
            setTimeout(() => respawn(), 1700);
        } else {
            // Off-screen flop — no scream end, just a comedic *donk*.
            spawnToon(pickRandom(SHORE_WORDS), x, y - 50, 'pink');
            bait.style.left = x + 'px';
            bait.style.top  = y + 'px';
            bait.style.opacity = '0';
            setTimeout(() => respawn(), 900);
        }
    }

    function respawn() {
        bait.style.opacity = '';
        bait.style.left = '';
        bait.style.top  = '';
        bait.classList.remove('in-flight', 'pulling', 'underwater');
        document.body.classList.remove('flying');
        // Force reflow so the popping animation always restarts.
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
    requestAnimationFrame(() => syncRest());
})();

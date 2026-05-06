// === BALA'S ADVENTURES OF ALL MONKEYS — Sprunki Engine ===
// Pure HTML/CSS/JS. No build step. No external assets. All audio synthesized.

(() => {
    'use strict';

    // ---------- CONFIG ----------
    const TEMPO = 100;                       // BPM
    const STEPS_PER_BAR = 16;                // sixteenth notes
    const SECONDS_PER_STEP = 60 / TEMPO / 4; // 0.15s
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.1;              // seconds
    const NUM_SLOTS = 4;

    // ---------- AUDIO ENGINE ----------
    let audioCtx = null;
    let masterGain = null;
    let isPlaying = false;
    let isMuted = false;
    let currentStep = 0;
    let nextStepTime = 0;
    let schedTimer = null;

    function ensureAudio() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = isMuted ? 0 : 0.55;
            masterGain.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (!isPlaying) {
            isPlaying = true;
            currentStep = 0;
            nextStepTime = audioCtx.currentTime + 0.08;
            schedule();
        }
    }

    function schedule() {
        while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
            scheduleStep(currentStep, nextStepTime);
            nextStepTime += SECONDS_PER_STEP;
            currentStep = (currentStep + 1) % STEPS_PER_BAR;
        }
        schedTimer = setTimeout(schedule, LOOKAHEAD_MS);
    }

    function scheduleStep(step, when) {
        for (let i = 0; i < NUM_SLOTS; i++) {
            const id = slots[i];
            if (!id) continue;
            const ch = CHARACTERS[id];
            if (ch && ch.play) ch.play(audioCtx, masterGain, when, step);
        }
        // Visual sync — pulse all active icons on quarter notes
        if (step % 4 === 0) {
            const delayMs = Math.max(0, (when - audioCtx.currentTime) * 1000);
            setTimeout(pulseActiveIcons, delayMs);
        }
    }

    function pulseActiveIcons() {
        document.querySelectorAll('.stage-slot.active .slot-icon').forEach(icon => {
            icon.classList.remove('beat');
            void icon.offsetWidth;
            icon.classList.add('beat');
        });
    }

    // ---------- SYNTH HELPERS ----------
    function noiseSource(ctx, dur) {
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        return src;
    }

    function distortionCurve(amount) {
        const k = amount;
        const n = 2048;
        const c = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            c[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
        }
        return c;
    }

    // ---------- CHARACTERS ----------
    const CHARACTERS = {
        monkey: {
            emoji: '🐒',
            label: 'MONKEY',
            play(ctx, out, when, step) {
                if (step !== 0 && step !== 8) return;
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.setValueAtTime(700, when);
                f.frequency.linearRampToValueAtTime(1300, when + 0.1);
                f.frequency.linearRampToValueAtTime(500, when + 0.35);
                osc.type = 'sawtooth';
                const base = step === 0 ? 392 : 440; // G4, A4
                osc.frequency.setValueAtTime(base, when);
                osc.frequency.exponentialRampToValueAtTime(base * 1.25, when + 0.05);
                osc.frequency.exponentialRampToValueAtTime(base * 0.92, when + 0.35);
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.28, when + 0.03);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.42);
                osc.connect(f).connect(g).connect(out);
                osc.start(when); osc.stop(when + 0.45);
            }
        },

        nugget: {
            emoji: '🍗',
            label: 'NUGGET',
            play(ctx, out, when, step) {
                if (![3, 7, 11, 15].includes(step)) return;
                // pitched cluck body
                const osc = ctx.createOscillator();
                const og = ctx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(360, when);
                osc.frequency.exponentialRampToValueAtTime(180, when + 0.07);
                og.gain.setValueAtTime(0.18, when);
                og.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
                osc.connect(og).connect(out);
                osc.start(when); osc.stop(when + 0.08);
                // crispy noise click
                const n = noiseSource(ctx, 0.05);
                const nf = ctx.createBiquadFilter();
                nf.type = 'highpass';
                nf.frequency.value = 2200;
                const ng = ctx.createGain();
                ng.gain.setValueAtTime(0.18, when);
                ng.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
                n.connect(nf).connect(ng).connect(out);
                n.start(when); n.stop(when + 0.05);
            }
        },

        choochoo: {
            emoji: '🚂',
            label: 'CHOO CHOO',
            play(ctx, out, when, step) {
                // chug on every other step
                if (step % 2 === 0) {
                    const n = noiseSource(ctx, 0.12);
                    const f = ctx.createBiquadFilter();
                    f.type = 'bandpass';
                    f.frequency.value = step % 4 === 0 ? 650 : 420;
                    f.Q.value = 4;
                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.22, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
                    n.connect(f).connect(g).connect(out);
                    n.start(when); n.stop(when + 0.12);
                }
                // whistle once per bar
                if (step === 0) {
                    const w = ctx.createOscillator();
                    const wg = ctx.createGain();
                    w.type = 'triangle';
                    w.frequency.setValueAtTime(880, when);
                    w.frequency.linearRampToValueAtTime(1100, when + 0.3);
                    wg.gain.setValueAtTime(0, when);
                    wg.gain.linearRampToValueAtTime(0.08, when + 0.05);
                    wg.gain.linearRampToValueAtTime(0, when + 0.45);
                    w.connect(wg).connect(out);
                    w.start(when); w.stop(when + 0.5);
                }
            }
        },

        truck: {
            emoji: '🚚',
            label: 'TRUCK',
            play(ctx, out, when, step) {
                // 4-on-the-floor sub kick
                if (step % 4 === 0) {
                    const k = ctx.createOscillator();
                    const kg = ctx.createGain();
                    k.type = 'sine';
                    k.frequency.setValueAtTime(140, when);
                    k.frequency.exponentialRampToValueAtTime(38, when + 0.18);
                    kg.gain.setValueAtTime(0.55, when);
                    kg.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
                    k.connect(kg).connect(out);
                    k.start(when); k.stop(when + 0.24);
                }
                // engine rev sweep
                if (step === 0 || step === 8) {
                    const saw = ctx.createOscillator();
                    const sg = ctx.createGain();
                    const sf = ctx.createBiquadFilter();
                    sf.type = 'lowpass';
                    sf.frequency.setValueAtTime(220, when);
                    sf.frequency.linearRampToValueAtTime(900, when + 0.25);
                    saw.type = 'sawtooth';
                    saw.frequency.setValueAtTime(60, when);
                    saw.frequency.linearRampToValueAtTime(120, when + 0.25);
                    sg.gain.setValueAtTime(0, when);
                    sg.gain.linearRampToValueAtTime(0.18, when + 0.05);
                    sg.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
                    saw.connect(sf).connect(sg).connect(out);
                    saw.start(when); saw.stop(when + 0.36);
                }
            }
        },

        cocoa: {
            emoji: '🐦',
            label: 'COCOA',
            play(ctx, out, when, step) {
                if (![1, 5, 9, 13].includes(step)) return;
                // manic 3-note arpeggio
                const notes = [880, 1108, 1318]; // A5, C#6, E6
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.value = freq;
                    const t = when + i * 0.045;
                    g.gain.setValueAtTime(0, t);
                    g.gain.linearRampToValueAtTime(0.16, t + 0.01);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                    osc.connect(g).connect(out);
                    osc.start(t); osc.stop(t + 0.06);
                });
            }
        },

        tamil: {
            emoji: '🪘',
            label: 'TAMIL',
            play(ctx, out, when, step) {
                // mridangam-style: 'thom' (low) and 'tha' (high) on a tala-ish pattern
                const lowSteps = [0, 6, 11];
                const highSteps = [3, 8, 14];
                if (lowSteps.includes(step)) {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(115, when);
                    o.frequency.exponentialRampToValueAtTime(70, when + 0.2);
                    g.gain.setValueAtTime(0.42, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.26);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + 0.28);
                }
                if (highSteps.includes(step)) {
                    const n = noiseSource(ctx, 0.06);
                    const f = ctx.createBiquadFilter();
                    f.type = 'bandpass';
                    f.frequency.value = 1500;
                    f.Q.value = 6;
                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.28, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
                    n.connect(f).connect(g).connect(out);
                    n.start(when); n.stop(when + 0.07);
                    // pitched ping accent
                    const o = ctx.createOscillator();
                    const og = ctx.createGain();
                    o.type = 'triangle';
                    o.frequency.setValueAtTime(660, when);
                    o.frequency.exponentialRampToValueAtTime(440, when + 0.08);
                    og.gain.setValueAtTime(0.12, when);
                    og.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
                    o.connect(og).connect(out);
                    o.start(when); o.stop(when + 0.1);
                }
            }
        },

        troll: {
            emoji: '👹',
            label: 'TROLL',
            play(ctx, out, when, step) {
                if (![2, 7, 13].includes(step)) return;
                const pent = [261.63, 293.66, 329.63, 392.00, 440];
                const freq = pent[Math.floor(Math.random() * pent.length)];
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                const dist = ctx.createWaveShaper();
                dist.curve = distortionCurve(60);
                osc.type = 'sawtooth';
                osc.frequency.value = freq;
                // chopper LFO for glitchy texture
                const lfo = ctx.createOscillator();
                const lfoG = ctx.createGain();
                lfo.frequency.value = 32;
                lfoG.gain.value = 0.45;
                lfo.connect(lfoG).connect(g.gain);
                g.gain.setValueAtTime(0.18, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
                osc.connect(dist).connect(g).connect(out);
                osc.start(when); osc.stop(when + 0.18);
                lfo.start(when); lfo.stop(when + 0.18);
            }
        }
    };

    const ORDER = ['monkey', 'nugget', 'choochoo', 'truck', 'cocoa', 'tamil', 'troll'];

    // ---------- STATE ----------
    const slots = new Array(NUM_SLOTS).fill(null);

    // ---------- UI / RENDER ----------
    function renderTray() {
        const tray = document.getElementById('tray');
        tray.innerHTML = '';
        ORDER.forEach(id => {
            const ch = CHARACTERS[id];
            const el = document.createElement('div');
            el.className = 'tray-chip';
            el.dataset.char = id;
            el.innerHTML = `
                <div class="chip-icon">${ch.emoji}</div>
                <div class="chip-label">${ch.label}</div>
            `;
            tray.appendChild(el);
        });
    }

    function renderSlot(index) {
        const slot = document.querySelector(`.stage-slot[data-index="${index}"]`);
        if (!slot) return;
        const id = slots[index];
        if (id) {
            const ch = CHARACTERS[id];
            slot.classList.add('active');
            slot.classList.remove('empty');
            slot.dataset.char = id;
            slot.innerHTML = `
                <div class="slot-icon">${ch.emoji}</div>
                <div class="slot-label">${ch.label}</div>
            `;
        } else {
            slot.classList.remove('active');
            slot.classList.add('empty');
            delete slot.dataset.char;
            slot.innerHTML = `
                <div class="slot-icon">🐒</div>
                <div class="slot-label">EMPTY</div>
            `;
        }
    }

    function renderAllSlots() {
        for (let i = 0; i < NUM_SLOTS; i++) renderSlot(i);
    }

    function setSlot(index, charId) {
        slots[index] = charId;
        renderSlot(index);
    }

    // ---------- DRAG & DROP (pointer events, mouse + touch) ----------
    let drag = null;

    function startDrag(chip, pointerId, x, y) {
        ensureAudio();
        const charId = chip.dataset.char;
        const ghost = document.createElement('div');
        ghost.id = 'drag-ghost';
        ghost.textContent = CHARACTERS[charId].emoji;
        ghost.style.left = x + 'px';
        ghost.style.top = y + 'px';
        document.body.appendChild(ghost);
        chip.classList.add('dragging');
        drag = { charId, ghost, chip, pointerId };
    }

    function moveDrag(x, y) {
        if (!drag) return;
        drag.ghost.style.left = x + 'px';
        drag.ghost.style.top = y + 'px';
        document.querySelectorAll('.stage-slot').forEach(s => s.classList.remove('drop-hover'));
        const target = findSlotAt(x, y);
        if (target) target.classList.add('drop-hover');
    }

    function endDrag(x, y) {
        if (!drag) return;
        const target = findSlotAt(x, y);
        if (target) {
            const idx = parseInt(target.dataset.index, 10);
            setSlot(idx, drag.charId);
            playDropSound();
        }
        document.querySelectorAll('.stage-slot').forEach(s => s.classList.remove('drop-hover'));
        drag.chip.classList.remove('dragging');
        drag.ghost.remove();
        drag = null;
    }

    function findSlotAt(x, y) {
        const els = document.elementsFromPoint(x, y);
        return els.find(el => el.classList && el.classList.contains('stage-slot'));
    }

    function attachTrayHandlers() {
        document.querySelectorAll('.tray-chip').forEach(chip => {
            chip.addEventListener('pointerdown', e => {
                e.preventDefault();
                chip.setPointerCapture(e.pointerId);
                startDrag(chip, e.pointerId, e.clientX, e.clientY);
            });
            chip.addEventListener('pointermove', e => {
                if (drag && drag.pointerId === e.pointerId) moveDrag(e.clientX, e.clientY);
            });
            chip.addEventListener('pointerup', e => {
                if (drag && drag.pointerId === e.pointerId) {
                    endDrag(e.clientX, e.clientY);
                    if (chip.hasPointerCapture(e.pointerId)) chip.releasePointerCapture(e.pointerId);
                }
            });
            chip.addEventListener('pointercancel', e => {
                if (drag && drag.pointerId === e.pointerId) endDrag(e.clientX, e.clientY);
            });
        });
    }

    function attachSlotHandlers() {
        document.querySelectorAll('.stage-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                if (drag) return;
                const idx = parseInt(slot.dataset.index, 10);
                if (slots[idx]) {
                    setSlot(idx, null);
                    playClearSound();
                }
            });
        });
    }

    // ---------- UI SOUNDS ----------
    function playDropSound() {
        if (!audioCtx || isMuted) return;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        const t = audioCtx.currentTime;
        o.frequency.setValueAtTime(800, t);
        o.frequency.exponentialRampToValueAtTime(1600, t + 0.08);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        o.connect(g).connect(masterGain);
        o.start(t); o.stop(t + 0.12);
    }

    function playClearSound() {
        if (!audioCtx || isMuted) return;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        const t = audioCtx.currentTime;
        o.frequency.setValueAtTime(420, t);
        o.frequency.exponentialRampToValueAtTime(160, t + 0.16);
        g.gain.setValueAtTime(0.14, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.connect(g).connect(masterGain);
        o.start(t); o.stop(t + 0.2);
    }

    // ---------- HEADER BUTTONS ----------
    function attachHeaderHandlers() {
        document.getElementById('remixBtn').addEventListener('click', () => {
            ensureAudio();
            for (let i = 0; i < NUM_SLOTS; i++) {
                slots[i] = ORDER[Math.floor(Math.random() * ORDER.length)];
                renderSlot(i);
            }
            playDropSound();
        });

        const muteBtn = document.getElementById('muteBtn');
        const muteIcon = document.getElementById('muteIcon');
        muteBtn.addEventListener('click', () => {
            isMuted = !isMuted;
            if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.55;
            muteBtn.classList.toggle('muted', isMuted);
            muteIcon.textContent = isMuted ? '🔇' : '🔊';
        });
    }

    // ---------- INIT ----------
    function init() {
        renderTray();
        renderAllSlots();
        attachTrayHandlers();
        attachSlotHandlers();
        attachHeaderHandlers();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

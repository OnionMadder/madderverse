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

    // ---------- CHARACTER SVG ART (placeholder Sprunkis) ----------
    // viewBox 100x140 — swap any of these out for an <img src="..."> tag when real art arrives.
    const CHARACTER_SVG = {
        monkey: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="50" cy="105" rx="26" ry="28" fill="#8b5a2b" stroke="#3d220e" stroke-width="3"/>
            <ellipse cx="50" cy="108" rx="15" ry="18" fill="#d4a574"/>
            <ellipse cx="22" cy="92" rx="9" ry="14" fill="#8b5a2b" stroke="#3d220e" stroke-width="3" transform="rotate(-15 22 92)"/>
            <ellipse cx="78" cy="92" rx="9" ry="14" fill="#8b5a2b" stroke="#3d220e" stroke-width="3" transform="rotate(15 78 92)"/>
            <ellipse cx="38" cy="135" rx="8" ry="4" fill="#3d220e"/>
            <ellipse cx="62" cy="135" rx="8" ry="4" fill="#3d220e"/>
            <circle cx="20" cy="42" r="13" fill="#6b4423" stroke="#3d220e" stroke-width="3"/>
            <circle cx="20" cy="42" r="7" fill="#d4a574"/>
            <circle cx="80" cy="42" r="13" fill="#6b4423" stroke="#3d220e" stroke-width="3"/>
            <circle cx="80" cy="42" r="7" fill="#d4a574"/>
            <circle cx="50" cy="42" r="28" fill="#8b5a2b" stroke="#3d220e" stroke-width="3"/>
            <ellipse cx="50" cy="50" rx="20" ry="16" fill="#d4a574"/>
            <circle cx="42" cy="42" r="3.5" fill="#000"/>
            <circle cx="58" cy="42" r="3.5" fill="#000"/>
            <circle cx="43" cy="41" r="1.2" fill="#fff"/>
            <circle cx="59" cy="41" r="1.2" fill="#fff"/>
            <ellipse cx="46" cy="52" rx="1.2" ry="2" fill="#000"/>
            <ellipse cx="54" cy="52" rx="1.2" ry="2" fill="#000"/>
            <path d="M 42 60 Q 50 66 58 60" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>
        </svg>`,

        nugget: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
            <path d="M 25 50 Q 14 38 28 25 Q 50 14 72 27 Q 88 40 80 60 Q 92 88 70 108 Q 50 124 28 110 Q 8 95 18 75 Q 12 60 25 50 Z" fill="#f4c465" stroke="#a06b1f" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="32" cy="48" r="2" fill="#a06b1f"/>
            <circle cx="60" cy="40" r="2.5" fill="#a06b1f"/>
            <circle cx="75" cy="65" r="2" fill="#a06b1f"/>
            <circle cx="40" cy="80" r="2.5" fill="#a06b1f"/>
            <circle cx="65" cy="92" r="2" fill="#a06b1f"/>
            <circle cx="25" cy="85" r="2" fill="#a06b1f"/>
            <circle cx="50" cy="62" r="2" fill="#a06b1f"/>
            <circle cx="55" cy="105" r="2" fill="#a06b1f"/>
            <path d="M 36 55 Q 42 49 48 55" fill="none" stroke="#3d220e" stroke-width="3" stroke-linecap="round"/>
            <path d="M 56 55 Q 62 49 68 55" fill="none" stroke="#3d220e" stroke-width="3" stroke-linecap="round"/>
            <path d="M 36 75 Q 50 92 64 75 Q 60 80 50 80 Q 40 80 36 75 Z" fill="#5d3a18" stroke="#3d220e" stroke-width="2.5" stroke-linejoin="round"/>
        </svg>`,

        choochoo: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
            <rect x="42" y="12" width="16" height="22" fill="#1a1a1a" stroke="#000" stroke-width="2"/>
            <rect x="38" y="10" width="24" height="6" fill="#1a1a1a" stroke="#000" stroke-width="2"/>
            <circle cx="50" cy="6" r="5" fill="#666" opacity="0.6"/>
            <circle cx="60" cy="3" r="4" fill="#666" opacity="0.5"/>
            <circle cx="40" cy="2" r="3" fill="#666" opacity="0.4"/>
            <path d="M 15 45 L 85 45 L 85 100 L 80 100 L 80 110 L 20 110 L 20 100 L 15 100 Z" fill="#2a2a2a" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
            <ellipse cx="50" cy="65" rx="32" ry="18" fill="#3a3a3a" stroke="#000" stroke-width="3"/>
            <circle cx="38" cy="62" r="6" fill="#ff0000"/>
            <circle cx="62" cy="62" r="6" fill="#ff0000"/>
            <circle cx="38" cy="62" r="3" fill="#ffff66"/>
            <circle cx="62" cy="62" r="3" fill="#ffff66"/>
            <rect x="28" y="80" width="44" height="14" fill="#0a0a0a" stroke="#000" stroke-width="2"/>
            <line x1="34" y1="80" x2="34" y2="94" stroke="#999" stroke-width="2"/>
            <line x1="42" y1="80" x2="42" y2="94" stroke="#999" stroke-width="2"/>
            <line x1="50" y1="80" x2="50" y2="94" stroke="#999" stroke-width="2"/>
            <line x1="58" y1="80" x2="58" y2="94" stroke="#999" stroke-width="2"/>
            <line x1="66" y1="80" x2="66" y2="94" stroke="#999" stroke-width="2"/>
            <circle cx="28" cy="118" r="14" fill="#1a1a1a" stroke="#000" stroke-width="3"/>
            <circle cx="28" cy="118" r="5" fill="#666"/>
            <circle cx="72" cy="118" r="14" fill="#1a1a1a" stroke="#000" stroke-width="3"/>
            <circle cx="72" cy="118" r="5" fill="#666"/>
        </svg>`,

        truck: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
            <rect x="22" y="32" width="56" height="14" rx="4" fill="#5a7aaa" stroke="#1a2a4a" stroke-width="3"/>
            <rect x="15" y="42" width="70" height="55" rx="6" fill="#3a5a8a" stroke="#1a2a4a" stroke-width="3"/>
            <circle cx="30" cy="62" r="9" fill="#ffeb3b" stroke="#000" stroke-width="2.5"/>
            <circle cx="70" cy="62" r="9" fill="#ffeb3b" stroke="#000" stroke-width="2.5"/>
            <circle cx="30" cy="62" r="3" fill="#000"/>
            <circle cx="70" cy="62" r="3" fill="#000"/>
            <rect x="30" y="78" width="40" height="14" rx="2" fill="#222" stroke="#000" stroke-width="2"/>
            <line x1="36" y1="78" x2="36" y2="92" stroke="#aaa" stroke-width="2"/>
            <line x1="44" y1="78" x2="44" y2="92" stroke="#aaa" stroke-width="2"/>
            <line x1="50" y1="78" x2="50" y2="92" stroke="#aaa" stroke-width="2"/>
            <line x1="56" y1="78" x2="56" y2="92" stroke="#aaa" stroke-width="2"/>
            <line x1="64" y1="78" x2="64" y2="92" stroke="#aaa" stroke-width="2"/>
            <circle cx="22" cy="115" r="20" fill="#1a1a1a" stroke="#000" stroke-width="3"/>
            <circle cx="22" cy="115" r="9" fill="#555"/>
            <circle cx="22" cy="115" r="3" fill="#888"/>
            <circle cx="78" cy="115" r="20" fill="#1a1a1a" stroke="#000" stroke-width="3"/>
            <circle cx="78" cy="115" r="9" fill="#555"/>
            <circle cx="78" cy="115" r="3" fill="#888"/>
            <circle cx="42" cy="105" r="2" fill="#5a3a1a"/>
            <circle cx="58" cy="103" r="2" fill="#5a3a1a"/>
        </svg>`,

        cocoa: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
            <line x1="42" y1="100" x2="38" y2="130" stroke="#a06000" stroke-width="3" stroke-linecap="round"/>
            <line x1="58" y1="100" x2="62" y2="130" stroke="#a06000" stroke-width="3" stroke-linecap="round"/>
            <path d="M 33 132 L 38 130 L 35 134 M 38 130 L 41 134" stroke="#a06000" stroke-width="2.5" stroke-linecap="round" fill="none"/>
            <path d="M 67 132 L 62 130 L 65 134 M 62 130 L 59 134" stroke="#a06000" stroke-width="2.5" stroke-linecap="round" fill="none"/>
            <circle cx="50" cy="65" r="38" fill="#ffa500" stroke="#a06000" stroke-width="3"/>
            <ellipse cx="50" cy="80" rx="20" ry="22" fill="#fdd835"/>
            <path d="M 45 27 L 50 14 L 55 27 Z" fill="#ffa500" stroke="#a06000" stroke-width="2.5" stroke-linejoin="round"/>
            <path d="M 36 30 L 40 17 L 47 28 Z" fill="#ffa500" stroke="#a06000" stroke-width="2.5" stroke-linejoin="round"/>
            <path d="M 53 28 L 60 17 L 64 30 Z" fill="#ffa500" stroke="#a06000" stroke-width="2.5" stroke-linejoin="round"/>
            <circle cx="38" cy="55" r="13" fill="#fff" stroke="#000" stroke-width="2.5"/>
            <circle cx="62" cy="55" r="13" fill="#fff" stroke="#000" stroke-width="2.5"/>
            <circle cx="42" cy="58" r="4" fill="#000"/>
            <circle cx="58" cy="52" r="4" fill="#000"/>
            <circle cx="43" cy="57" r="1.5" fill="#fff"/>
            <circle cx="59" cy="51" r="1.5" fill="#fff"/>
            <path d="M 38 78 L 50 96 L 62 78 L 60 76 L 50 90 L 40 76 Z" fill="#ff6b1c" stroke="#5a2a0a" stroke-width="2.5" stroke-linejoin="round"/>
            <path d="M 42 80 L 50 90 L 58 80 Z" fill="#5a2a0a"/>
            <ellipse cx="50" cy="86" rx="3" ry="2" fill="#ff3d6b"/>
        </svg>`,

        tamil: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="50" cy="118" rx="32" ry="8" fill="#5a3a1a" stroke="#3d220e" stroke-width="2"/>
            <rect x="18" y="42" width="64" height="76" fill="#a0522d" stroke="#3d220e" stroke-width="3"/>
            <ellipse cx="50" cy="42" rx="32" ry="10" fill="#f5deb3" stroke="#3d220e" stroke-width="3"/>
            <rect x="18" y="50" width="64" height="4" fill="#d4af37"/>
            <rect x="18" y="100" width="64" height="4" fill="#d4af37"/>
            <line x1="22" y1="54" x2="26" y2="100" stroke="#3d220e" stroke-width="2"/>
            <line x1="32" y1="54" x2="36" y2="100" stroke="#3d220e" stroke-width="2"/>
            <line x1="42" y1="54" x2="44" y2="100" stroke="#3d220e" stroke-width="2"/>
            <line x1="56" y1="54" x2="56" y2="100" stroke="#3d220e" stroke-width="2"/>
            <line x1="68" y1="54" x2="64" y2="100" stroke="#3d220e" stroke-width="2"/>
            <line x1="78" y1="54" x2="74" y2="100" stroke="#3d220e" stroke-width="2"/>
            <circle cx="50" cy="42" r="6" fill="#3d220e"/>
            <circle cx="40" cy="75" r="3" fill="#3d220e"/>
            <circle cx="60" cy="75" r="3" fill="#3d220e"/>
            <path d="M 38 85 Q 50 95 62 85" fill="none" stroke="#3d220e" stroke-width="3" stroke-linecap="round"/>
        </svg>`,

        troll: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
            <path d="M 18 50 Q 14 30 30 25 Q 50 16 70 26 Q 88 32 84 50 Q 92 70 86 90 Q 88 110 70 118 Q 50 124 30 118 Q 12 112 14 92 Q 8 70 18 50 Z" fill="#a8b88a" stroke="#3a4a2a" stroke-width="3" stroke-linejoin="round"/>
            <rect x="14" y="55" width="6" height="3" fill="#db2777" opacity="0.7"/>
            <rect x="80" y="72" width="8" height="2" fill="#fbbf24" opacity="0.7"/>
            <rect x="58" y="105" width="5" height="3" fill="#2dd4bf" opacity="0.7"/>
            <rect x="22" y="100" width="4" height="2" fill="#db2777" opacity="0.7"/>
            <ellipse cx="36" cy="55" rx="9" ry="6" fill="#fff" stroke="#000" stroke-width="2.5"/>
            <ellipse cx="64" cy="55" rx="9" ry="6" fill="#fff" stroke="#000" stroke-width="2.5"/>
            <circle cx="36" cy="56" r="3.5" fill="#000"/>
            <circle cx="64" cy="56" r="3.5" fill="#000"/>
            <path d="M 26 44 L 44 50" stroke="#3a4a2a" stroke-width="4" stroke-linecap="round"/>
            <path d="M 56 50 L 74 44" stroke="#3a4a2a" stroke-width="4" stroke-linecap="round"/>
            <path d="M 22 78 Q 50 105 78 78 Q 70 100 50 100 Q 30 100 22 78 Z" fill="#3d220e" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
            <path d="M 28 82 L 32 92 L 36 82 Z" fill="#fff" stroke="#000" stroke-width="1"/>
            <path d="M 38 84 L 42 95 L 46 84 Z" fill="#fff" stroke="#000" stroke-width="1"/>
            <path d="M 48 86 L 50 96 L 52 86 Z" fill="#fff" stroke="#000" stroke-width="1"/>
            <path d="M 54 86 L 58 95 L 60 84 Z" fill="#fff" stroke="#000" stroke-width="1"/>
            <path d="M 64 84 L 68 92 L 72 82 Z" fill="#fff" stroke="#000" stroke-width="1"/>
        </svg>`
    };

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
                <div class="chip-icon">${CHARACTER_SVG[id]}</div>
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
                <div class="slot-icon">${CHARACTER_SVG[id]}</div>
                <div class="slot-label">${ch.label}</div>
            `;
        } else {
            slot.classList.remove('active');
            slot.classList.add('empty');
            delete slot.dataset.char;
            slot.innerHTML = `
                <div class="slot-icon">${CHARACTER_SVG.monkey}</div>
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
        ghost.innerHTML = CHARACTER_SVG[charId];
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

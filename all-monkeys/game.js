
(() => {
    'use strict';

    // ---------- CONFIG ----------
    const TEMPO = 100;                       // BPM
    const STEPS_PER_BAR = 16;                // sixteenth notes
    const SECONDS_PER_STEP = 60 / TEMPO / 4; // 0.15s
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.1;
    const NUM_SLOTS = 8;

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
            masterGain.gain.value = isMuted ? 0 : 0.5;
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
        if (step % 4 === 0) {
            const delayMs = Math.max(0, (when - audioCtx.currentTime) * 1000);
            setTimeout(pulseActiveIcons, delayMs);
        }
    }

    function pulseActiveIcons() {
        document.querySelectorAll('.stage-slot.active .char-art').forEach(art => {
            art.classList.remove('beat');
            void art.offsetWidth;
            art.classList.add('beat');
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
    // 16 mods. Each entry: visual palette (body + head colors with the emoji as
    // the placeholder face) plus a play() function scheduling its WebAudio
    // events on a given step (0..15 sixteenth-note grid).
    const CHARACTERS = {
        monkey: {
            label: 'MONKEY', emoji: '🐒',
            bodyColor: '#8b5a2b', bodyHi: '#a86d3a', bodyShade: '#3d220e',
            headColor: '#9c6633', headHi: '#d4a574', headShade: '#3d220e',
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
                g.gain.linearRampToValueAtTime(0.26, when + 0.03);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.42);
                osc.connect(f).connect(g).connect(out);
                osc.start(when); osc.stop(when + 0.45);
            }
        },

        nugget: {
            label: 'NUGGET', emoji: '🍗',
            bodyColor: '#f4c465', bodyHi: '#fbdc92', bodyShade: '#a06b1f',
            headColor: '#f4c465', headHi: '#fbdc92', headShade: '#a06b1f',
            play(ctx, out, when, step) {
                if (![3, 7, 11, 15].includes(step)) return;
                const osc = ctx.createOscillator();
                const og = ctx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(360, when);
                osc.frequency.exponentialRampToValueAtTime(180, when + 0.07);
                og.gain.setValueAtTime(0.16, when);
                og.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
                osc.connect(og).connect(out);
                osc.start(when); osc.stop(when + 0.08);
                const n = noiseSource(ctx, 0.05);
                const nf = ctx.createBiquadFilter();
                nf.type = 'highpass';
                nf.frequency.value = 2200;
                const ng = ctx.createGain();
                ng.gain.setValueAtTime(0.16, when);
                ng.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
                n.connect(nf).connect(ng).connect(out);
                n.start(when); n.stop(when + 0.05);
            }
        },

        choochoo: {
            label: 'CHOO CHOO', emoji: '🚂',
            bodyColor: '#2a2a2a', bodyHi: '#5a5a5a', bodyShade: '#000',
            headColor: '#3a3a3a', headHi: '#7a7a7a', headShade: '#000',
            play(ctx, out, when, step) {
                if (step % 2 === 0) {
                    const n = noiseSource(ctx, 0.12);
                    const f = ctx.createBiquadFilter();
                    f.type = 'bandpass';
                    f.frequency.value = step % 4 === 0 ? 650 : 420;
                    f.Q.value = 4;
                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.2, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
                    n.connect(f).connect(g).connect(out);
                    n.start(when); n.stop(when + 0.12);
                }
                if (step === 0) {
                    const w = ctx.createOscillator();
                    const wg = ctx.createGain();
                    w.type = 'triangle';
                    w.frequency.setValueAtTime(880, when);
                    w.frequency.linearRampToValueAtTime(1100, when + 0.3);
                    wg.gain.setValueAtTime(0, when);
                    wg.gain.linearRampToValueAtTime(0.07, when + 0.05);
                    wg.gain.linearRampToValueAtTime(0, when + 0.45);
                    w.connect(wg).connect(out);
                    w.start(when); w.stop(when + 0.5);
                }
            }
        },

        truck: {
            label: 'TRUCK', emoji: '🚚',
            bodyColor: '#3a5a8a', bodyHi: '#5a7aaa', bodyShade: '#1a2a4a',
            headColor: '#5a7aaa', headHi: '#86a6cf', headShade: '#1a2a4a',
            play(ctx, out, when, step) {
                if (step % 4 === 0) {
                    const k = ctx.createOscillator();
                    const kg = ctx.createGain();
                    k.type = 'sine';
                    k.frequency.setValueAtTime(140, when);
                    k.frequency.exponentialRampToValueAtTime(38, when + 0.18);
                    kg.gain.setValueAtTime(0.5, when);
                    kg.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
                    k.connect(kg).connect(out);
                    k.start(when); k.stop(when + 0.24);
                }
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
                    sg.gain.linearRampToValueAtTime(0.16, when + 0.05);
                    sg.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
                    saw.connect(sf).connect(sg).connect(out);
                    saw.start(when); saw.stop(when + 0.36);
                }
            }
        },

        cocoa: {
            label: 'COCOA', emoji: '🐦',
            bodyColor: '#ffa500', bodyHi: '#ffd089', bodyShade: '#a06000',
            headColor: '#ffa500', headHi: '#fdd835', headShade: '#a06000',
            play(ctx, out, when, step) {
                if (![1, 5, 9, 13].includes(step)) return;
                const notes = [880, 1108, 1318]; // A5, C#6, E6
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.value = freq;
                    const t = when + i * 0.045;
                    g.gain.setValueAtTime(0, t);
                    g.gain.linearRampToValueAtTime(0.14, t + 0.01);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                    osc.connect(g).connect(out);
                    osc.start(t); osc.stop(t + 0.06);
                });
            }
        },

        tamil: {
            label: 'TAMIL', emoji: '🪘',
            bodyColor: '#a0522d', bodyHi: '#c97b50', bodyShade: '#3d220e',
            headColor: '#f5deb3', headHi: '#fff0c2', headShade: '#3d220e',
            play(ctx, out, when, step) {
                const lowSteps = [0, 6, 11];
                const highSteps = [3, 8, 14];
                if (lowSteps.includes(step)) {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(115, when);
                    o.frequency.exponentialRampToValueAtTime(70, when + 0.2);
                    g.gain.setValueAtTime(0.4, when);
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
                    g.gain.setValueAtTime(0.26, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
                    n.connect(f).connect(g).connect(out);
                    n.start(when); n.stop(when + 0.07);
                    const o = ctx.createOscillator();
                    const og = ctx.createGain();
                    o.type = 'triangle';
                    o.frequency.setValueAtTime(660, when);
                    o.frequency.exponentialRampToValueAtTime(440, when + 0.08);
                    og.gain.setValueAtTime(0.11, when);
                    og.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
                    o.connect(og).connect(out);
                    o.start(when); o.stop(when + 0.1);
                }
            }
        },

        troll: {
            label: 'TROLL', emoji: '👹',
            bodyColor: '#a8b88a', bodyHi: '#c5d6a5', bodyShade: '#3a4a2a',
            headColor: '#a8b88a', headHi: '#c5d6a5', headShade: '#3a4a2a',
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
                const lfo = ctx.createOscillator();
                const lfoG = ctx.createGain();
                lfo.frequency.value = 32;
                lfoG.gain.value = 0.45;
                lfo.connect(lfoG).connect(g.gain);
                g.gain.setValueAtTime(0.16, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
                osc.connect(dist).connect(g).connect(out);
                osc.start(when); osc.stop(when + 0.18);
                lfo.start(when); lfo.stop(when + 0.18);
            }
        },

        banana: {
            label: 'BANANA', emoji: '🍌',
            bodyColor: '#ffd54f', bodyHi: '#fff176', bodyShade: '#8b6914',
            headColor: '#ffeb3b', headHi: '#fff59d', headShade: '#8b6914',
            play(ctx, out, when, step) {
                if (step !== 2 && step !== 10) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.setValueAtTime(900, when);
                o.type = 'sine';
                const root = step === 2 ? 196 : 220; // G3, A3
                o.frequency.setValueAtTime(root * 1.5, when);
                o.frequency.exponentialRampToValueAtTime(root, when + 0.18);
                g.gain.setValueAtTime(0.3, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
                o.connect(f).connect(g).connect(out);
                o.start(when); o.stop(when + 0.24);
            }
        },

        coconut: {
            label: 'COCONUT', emoji: '🥥',
            bodyColor: '#6b4423', bodyHi: '#8b5a2b', bodyShade: '#2a1a0a',
            headColor: '#8b5a2b', headHi: '#a86d3a', headShade: '#2a1a0a',
            play(ctx, out, when, step) {
                if (![2, 6, 10, 14].includes(step)) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'square';
                const pitch = step % 4 === 2 ? 750 : 600;
                o.frequency.setValueAtTime(pitch, when);
                o.frequency.exponentialRampToValueAtTime(pitch * 0.6, when + 0.04);
                g.gain.setValueAtTime(0.2, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.06);
            }
        },

        drum: {
            label: 'DRUM', emoji: '🥁',
            bodyColor: '#c62828', bodyHi: '#e57373', bodyShade: '#5a0000',
            headColor: '#fafafa', headHi: '#fff', headShade: '#5a0000',
            play(ctx, out, when, step) {
                if (step !== 4 && step !== 12) return;
                const n = noiseSource(ctx, 0.13);
                const f = ctx.createBiquadFilter();
                f.type = 'bandpass';
                f.frequency.value = 2400;
                f.Q.value = 1;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.36, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.13);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.14);
                const o = ctx.createOscillator();
                o.type = 'triangle';
                o.frequency.setValueAtTime(220, when);
                o.frequency.exponentialRampToValueAtTime(140, when + 0.06);
                const og = ctx.createGain();
                og.gain.setValueAtTime(0.16, when);
                og.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
                o.connect(og).connect(out);
                o.start(when); o.stop(when + 0.08);
            }
        },

        flute: {
            label: 'FLUTE', emoji: '🎵',
            bodyColor: '#bdbdbd', bodyHi: '#e0e0e0', bodyShade: '#424242',
            headColor: '#9e9e9e', headHi: '#cfcfcf', headShade: '#424242',
            play(ctx, out, when, step) {
                const melody = { 0: 523.25, 4: 659.25, 8: 783.99, 12: 587.33 }; // C5 E5 G5 D5
                const f = melody[step];
                if (!f) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const lfo = ctx.createOscillator();
                const lfoG = ctx.createGain();
                lfo.frequency.value = 5.5;
                lfoG.gain.value = 6;
                lfo.connect(lfoG).connect(o.frequency);
                o.type = 'triangle';
                o.frequency.value = f;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.14, when + 0.04);
                g.gain.linearRampToValueAtTime(0.12, when + 0.28);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.42);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.45);
                lfo.start(when); lfo.stop(when + 0.45);
            }
        },

        star: {
            label: 'STAR', emoji: '⭐',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headColor: '#ffd700', headHi: '#ffeb91', headShade: '#a07000',
            play(ctx, out, when, step) {
                if (step !== 0 && step !== 6) return;
                const freqs = [1318.51, 1760.00, 2637.02]; // E6 A6 E7
                freqs.forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.value = freq;
                    const t = when + i * 0.07;
                    g.gain.setValueAtTime(0.11, t);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
                    o.connect(g).connect(out);
                    o.start(t); o.stop(t + 0.6);
                });
            }
        },

        cloud: {
            label: 'CLOUD', emoji: '☁️',
            bodyColor: '#e8f0f7', bodyHi: '#fff', bodyShade: '#7e92a8',
            headColor: '#fff', headHi: '#fff', headShade: '#7e92a8',
            play(ctx, out, when, step) {
                if (step !== 0 && step !== 8) return;
                const chord = [196.00, 261.63, 329.63]; // G3 C4 E4
                chord.forEach(freq => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.value = freq;
                    g.gain.setValueAtTime(0, when);
                    g.gain.linearRampToValueAtTime(0.045, when + 0.18);
                    g.gain.linearRampToValueAtTime(0.035, when + 0.6);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 1.05);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + 1.1);
                });
            }
        },

        moon: {
            label: 'MOON', emoji: '🌙',
            bodyColor: '#1e3a5f', bodyHi: '#3d6090', bodyShade: '#0a1828',
            headColor: '#fff8c5', headHi: '#fffbe0', headShade: '#9c8a3a',
            play(ctx, out, when, step) {
                if (step !== 2 && step !== 10) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                o.frequency.setValueAtTime(55, when);
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.4, when + 0.05);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.55);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.6);
                const o2 = ctx.createOscillator();
                const g2 = ctx.createGain();
                o2.type = 'sine';
                o2.frequency.setValueAtTime(110, when);
                g2.gain.setValueAtTime(0, when);
                g2.gain.linearRampToValueAtTime(0.1, when + 0.05);
                g2.gain.exponentialRampToValueAtTime(0.001, when + 0.5);
                o2.connect(g2).connect(out);
                o2.start(when); o2.stop(when + 0.55);
            }
        },

        fire: {
            label: 'FIRE', emoji: '🔥',
            bodyColor: '#ff6f00', bodyHi: '#ffab40', bodyShade: '#7c2900',
            headColor: '#ff3d00', headHi: '#ff8a65', headShade: '#7c2900',
            play(ctx, out, when, step) {
                if (step % 2 !== 1) return;
                const n = noiseSource(ctx, 0.04);
                const f = ctx.createBiquadFilter();
                f.type = 'highpass';
                f.frequency.value = 3500;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.11, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.04);
            }
        },

        ice: {
            label: 'ICE', emoji: '❄️',
            bodyColor: '#4fc3f7', bodyHi: '#81d4fa', bodyShade: '#0277bd',
            headColor: '#e1f5fe', headHi: '#fff', headShade: '#0277bd',
            play(ctx, out, when, step) {
                if (![2, 5, 9, 13].includes(step)) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'triangle';
                o.frequency.value = 1976 + Math.floor(Math.random() * 4) * 88;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.06, when + 0.02);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.2);
            }
        }
    };

    const ORDER = [
        'monkey', 'nugget', 'choochoo', 'truck',
        'cocoa', 'tamil', 'troll', 'banana',
        'coconut', 'drum', 'flute', 'star',
        'cloud', 'moon', 'fire', 'ice'
    ];

    // ---------- PLACEHOLDER ART ----------
    // Body and head are independent SVG layers so a real sprite-sheet drop-in
    // can replace either side without disturbing the other. The emoji acts as
    // the placeholder face — swap to <image href> or background-image once the
    // real frames arrive.
    function bodyArt(c) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
            + `<ellipse cx="22" cy="48" rx="9" ry="14" fill="${c.bodyColor}" stroke="${c.bodyShade}" stroke-width="3" transform="rotate(-15 22 48)"/>`
            + `<ellipse cx="78" cy="48" rx="9" ry="14" fill="${c.bodyColor}" stroke="${c.bodyShade}" stroke-width="3" transform="rotate(15 78 48)"/>`
            + `<ellipse cx="50" cy="55" rx="36" ry="38" fill="${c.bodyColor}" stroke="${c.bodyShade}" stroke-width="3"/>`
            + `<ellipse cx="50" cy="62" rx="22" ry="22" fill="${c.bodyHi}" opacity="0.5"/>`
            + `<ellipse cx="38" cy="92" rx="9" ry="5" fill="${c.bodyShade}"/>`
            + `<ellipse cx="62" cy="92" rx="9" ry="5" fill="${c.bodyShade}"/>`
            + `</svg>`;
    }

    function headArt(c) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
            + `<circle cx="50" cy="50" r="42" fill="${c.headColor}" stroke="${c.headShade}" stroke-width="3"/>`
            + `<ellipse cx="50" cy="58" rx="28" ry="22" fill="${c.headHi}" opacity="0.55"/>`
            + `<text x="50" y="66" text-anchor="middle" font-size="44" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${c.emoji}</text>`
            + `</svg>`;
    }

    function characterArt(id) {
        const c = CHARACTERS[id];
        return `<div class="char-art" data-char="${id}">`
            + `<div class="char-body">${bodyArt(c)}</div>`
            + `<div class="char-head">${headArt(c)}</div>`
            + `</div>`;
    }

    // ---------- STATE ----------
    const slots = new Array(NUM_SLOTS).fill(null);

    // ---------- UI / RENDER ----------
    function buildStage() {
        const stage = document.getElementById('stage');
        stage.innerHTML = '';
        for (let i = 0; i < NUM_SLOTS; i++) {
            const slot = document.createElement('div');
            slot.className = 'stage-slot empty';
            slot.dataset.index = i;
            stage.appendChild(slot);
        }
    }

    function renderTray() {
        const tray = document.getElementById('tray');
        tray.innerHTML = '';
        ORDER.forEach(id => {
            const ch = CHARACTERS[id];
            const el = document.createElement('div');
            el.className = 'tray-chip';
            el.dataset.char = id;
            el.innerHTML = `
                <div class="chip-icon">${characterArt(id)}</div>
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
                <div class="slot-icon">${characterArt(id)}</div>
                <div class="slot-label">${ch.label}</div>
            `;
        } else {
            slot.classList.remove('active');
            slot.classList.add('empty');
            delete slot.dataset.char;
            slot.innerHTML = `
                <div class="slot-icon slot-empty"><span class="empty-plus">+</span></div>
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

    // ---------- DRAG & DROP (pointer events: mouse + touch + pen) ----------
    let drag = null;

    function startDrag(chip, pointerId, x, y) {
        ensureAudio();
        const charId = chip.dataset.char;
        const ghost = document.createElement('div');
        ghost.id = 'drag-ghost';
        ghost.innerHTML = characterArt(charId);
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
        // Single delegated listener on the stage so we don't need to rewire on
        // every slot re-render.
        document.getElementById('stage').addEventListener('click', e => {
            if (drag) return;
            const slot = e.target.closest('.stage-slot');
            if (!slot) return;
            const idx = parseInt(slot.dataset.index, 10);
            if (slots[idx]) {
                setSlot(idx, null);
                playClearSound();
            }
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

        const clearBtn = document.getElementById('clearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                let cleared = false;
                for (let i = 0; i < NUM_SLOTS; i++) {
                    if (slots[i]) {
                        slots[i] = null;
                        renderSlot(i);
                        cleared = true;
                    }
                }
                if (cleared) playClearSound();
            });
        }

        const muteBtn = document.getElementById('muteBtn');
        const muteIcon = document.getElementById('muteIcon');
        muteBtn.addEventListener('click', () => {
            isMuted = !isMuted;
            if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.5;
            muteBtn.classList.toggle('muted', isMuted);
            muteIcon.textContent = isMuted ? '🔇' : '🔊';
        });
    }

    // ---------- INIT ----------
    function init() {
        buildStage();
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

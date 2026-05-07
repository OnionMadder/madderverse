
(() => {
    'use strict';

    // ---------- CONFIG ----------
    const TEMPO = 100;                       // BPM
    const STEPS_PER_BAR = 16;                // sixteenth notes
    const SECONDS_PER_STEP = 60 / TEMPO / 4; // 0.15s
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.1;
    const NUM_SLOTS = 8;
    const BARS_PER_LOOP = 2;                
    const MADBALLZ_UNLOCK_THRESHOLD = 3;
    const STORAGE_KEY = 'all-munkis-progress-v1';

    // ---------- AUDIO ENGINE ----------
    let audioCtx = null;
    let masterGain = null;
    let isPlaying = false;
    let isMuted = false;
    let isBaseSongOn = true;                 // background "level music" theme
    let isJumpScareActive = false;           // debounce + visual gate for BOO
    let currentStep = 0;
    let currentBar = 0;
    let nextStepTime = 0;
    let schedTimer = null;

    let horrorTriggers = 0;
    let madballzUnlocked = false;
    let isMadballzMode = false;

    function ensureAudio() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = isMuted ? 0 : 0.55;
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -10;
            comp.knee.value = 8;
            comp.ratio.value = 6;
            comp.attack.value = 0.004;
            comp.release.value = 0.15;
            masterGain.connect(comp).connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (!isPlaying) {
            isPlaying = true;
            currentStep = 0;
            currentBar = 0;
            nextStepTime = audioCtx.currentTime + 0.08;
            schedule();
        }
    }

    function schedule() {
        while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
            scheduleStep(currentStep, currentBar, nextStepTime);
            nextStepTime += SECONDS_PER_STEP;
            currentStep++;
            if (currentStep >= STEPS_PER_BAR) {
                currentStep = 0;
                currentBar = (currentBar + 1) % BARS_PER_LOOP;
            }
        }
        schedTimer = setTimeout(schedule, LOOKAHEAD_MS);
    }

    function scheduleStep(step, bar, when) {
        if (isBaseSongOn) BASE_SONG.play(audioCtx, masterGain, when, step, bar);
        // User-placed mods
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
    const BASE_SONG = {
        play(ctx, out, when, step, bar) {
            // Sustained bass + pad fire once at the top of each bar and ring
            // out across the full 2.4s the bar takes to complete.
            if (step === 0) {
                const isC = bar === 0;
                const root = isC ? 65.41 : 55.00;            // C2 / A1
                const chord = isC
                    ? [261.63, 329.63, 392.00]               // C E G
                    : [220.00, 261.63, 329.63];              // A C E (Am)
                const BAR_LEN = SECONDS_PER_STEP * STEPS_PER_BAR; // 2.4s

                // Bass — triangle wave, gentle attack/sustain envelope
                const b = ctx.createOscillator();
                const bg = ctx.createGain();
                b.type = 'triangle';
                b.frequency.value = root;
                bg.gain.setValueAtTime(0, when);
                bg.gain.linearRampToValueAtTime(0.16, when + 0.07);
                bg.gain.linearRampToValueAtTime(0.13, when + BAR_LEN * 0.7);
                bg.gain.exponentialRampToValueAtTime(0.001, when + BAR_LEN);
                b.connect(bg).connect(out);
                b.start(when); b.stop(when + BAR_LEN + 0.05);

                // Pad — chord triad, quieter on each higher voice so the
                // root sits forward in the mix without muddying the leads.
                chord.forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'triangle';
                    o.frequency.value = freq;
                    const peak = 0.045 - i * 0.005;
                    g.gain.setValueAtTime(0, when);
                    g.gain.linearRampToValueAtTime(peak, when + 0.22);
                    g.gain.linearRampToValueAtTime(peak * 0.85, when + BAR_LEN * 0.7);
                    g.gain.exponentialRampToValueAtTime(0.001, when + BAR_LEN);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + BAR_LEN + 0.05);
                });
            }

            // Melody hook on quarter notes — bouncy "bala-bala" phrase.
            //   Bar 0 (Cmaj):  G5  E5  C5  E5
            //   Bar 1 (Am):    A4  C5  E5  G4
            const melodyBar0 = { 0: 783.99, 4: 659.25, 8: 523.25, 12: 659.25 };
            const melodyBar1 = { 0: 440.00, 4: 523.25, 8: 659.25, 12: 392.00 };
            const melody = bar === 0 ? melodyBar0 : melodyBar1;
            const freq = melody[step];
            if (freq !== undefined) {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.value = 3000;
                f.Q.value = 1;
                o.type = 'square';
                o.frequency.value = freq;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.075, when + 0.02);
                g.gain.linearRampToValueAtTime(0.06, when + 0.18);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.32);
                o.connect(f).connect(g).connect(out);
                o.start(when); o.stop(when + 0.36);
            }
        }
    };
const CHARACTERS = {
        green: {
            label: 'Green Gear',
            // Sprite head is ORANGE in the new sheet — body matches head.
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
            headFrame: 'green',
            play(ctx, out, when, step) {
                const hook = { 0: 523.25, 4: 659.25, 8: 783.99, 12: 659.25 };
                const freq = hook[step];
                if (!freq) return;
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.setValueAtTime(2200, when);
                f.frequency.exponentialRampToValueAtTime(900, when + 0.3);
                f.Q.value = 4;
                osc.type = 'sawtooth';
                osc.frequency.value = freq;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.16, when + 0.015);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.32);
                osc.connect(f).connect(g).connect(out);
                osc.start(when); osc.stop(when + 0.35);
            }
        },

        high: {
            label: 'High-Z',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'high',
            play(ctx, out, when, step) {
                if (![2, 6, 10, 14].includes(step)) return;
                const n = noiseSource(ctx, 0.04);
                const f = ctx.createBiquadFilter();
                f.type = 'highpass';
                f.frequency.value = 7000;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.13, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.035);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.05);
            }
        },

        shadow: {
            label: 'Shadow Pulse',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'shadow',
            play(ctx, out, when, step) {
                if (step % 2 !== 0) return;
                const n = noiseSource(ctx, 0.05);
                const f = ctx.createBiquadFilter();
                f.type = 'bandpass';
                f.frequency.value = 6000;
                f.Q.value = 1.5;
                const g = ctx.createGain();
                const accent = step % 4 === 0 ? 0.10 : 0.06;
                g.gain.setValueAtTime(accent, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.06);
            }
        },

        mega: {
            label: 'Mega Thump',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'mega',
            play(ctx, out, when, step) {
                if (step % 4 !== 0) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                o.frequency.setValueAtTime(150, when);
                o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
                g.gain.setValueAtTime(0.55, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.2);
                const click = ctx.createOscillator();
                const cg = ctx.createGain();
                click.type = 'triangle';
                click.frequency.value = 1800;
                cg.gain.setValueAtTime(0.12, when);
                cg.gain.exponentialRampToValueAtTime(0.001, when + 0.012);
                click.connect(cg).connect(out);
                click.start(when); click.stop(when + 0.015);
            }
        },

        amber: {
            label: 'Amber Arp',
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
            headFrame: 'amber',
            play(ctx, out, when, step) {
                if (step !== 5 && step !== 13) return;
                const notes = [659.25, 783.99, 987.77, 1318.51];
                notes.forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'triangle';
                    o.frequency.value = freq;
                    const t = when + i * 0.04;
                    g.gain.setValueAtTime(0, t);
                    g.gain.linearRampToValueAtTime(0.11, t + 0.008);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
                    o.connect(g).connect(out);
                    o.start(t); o.stop(t + 0.07);
                });
            }
        },

        srivi: {
            label: 'Srivi-Bot',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'srivi',
            play(ctx, out, when, step) {
                const lowSteps = [0, 6, 10];
                const highSteps = [3, 8, 13];
                if (lowSteps.includes(step)) {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(110, when);
                    o.frequency.exponentialRampToValueAtTime(75, when + 0.15);
                    g.gain.setValueAtTime(0.32, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + 0.24);
                }
                if (highSteps.includes(step)) {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'triangle';
                    o.frequency.setValueAtTime(880, when);
                    o.frequency.exponentialRampToValueAtTime(523.25, when + 0.06);
                    g.gain.setValueAtTime(0.13, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.08);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + 0.1);
                }
            }
        },

        grumble: {
            label: 'Grumble Bass',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'grumble',
            play(ctx, out, when, step) {
                if (step !== 0 && step !== 8) return;
                const root = step === 0 ? 65.41 : 98.00;
                const o1 = ctx.createOscillator();
                const o2 = ctx.createOscillator();
                const f = ctx.createBiquadFilter();
                const g = ctx.createGain();
                f.type = 'lowpass';
                f.frequency.setValueAtTime(800, when);
                f.frequency.exponentialRampToValueAtTime(300, when + 0.35);
                f.Q.value = 5;
                o1.type = 'sawtooth'; o1.frequency.value = root;
                o2.type = 'sawtooth'; o2.frequency.value = root * 1.005;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.18, when + 0.01);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.4);
                o1.connect(f); o2.connect(f);
                f.connect(g).connect(out);
                o1.start(when); o1.stop(when + 0.45);
                o2.start(when); o2.stop(when + 0.45);
            }
        },

        sine: {
            label: 'Sine Wave',
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
            headFrame: 'sine',
            play(ctx, out, when, step) {
                const seq = { 2: 130.81, 6: 164.81, 10: 196.00, 14: 164.81 };
                const f = seq[step];
                if (!f) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                o.frequency.value = f;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.20, when + 0.012);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.18);
            }
        },

        hiss: {
            label: 'Hiss Shell',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'hiss',
            play(ctx, out, when, step) {
                if (step !== 4 && step !== 12) return;
                const n = noiseSource(ctx, 0.18);
                const f = ctx.createBiquadFilter();
                f.type = 'highpass';
                f.frequency.value = 6500;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.10, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.2);
            }
        },

        snare: {
            label: 'Snare-Bot',
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
            headFrame: 'snare',
            play(ctx, out, when, step) {
                if (step !== 4 && step !== 12) return;
                const n = noiseSource(ctx, 0.13);
                const f = ctx.createBiquadFilter();
                f.type = 'bandpass';
                f.frequency.value = 2200;
                f.Q.value = 1.2;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.32, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.14);
                const o = ctx.createOscillator();
                o.type = 'triangle';
                o.frequency.setValueAtTime(210, when);
                o.frequency.exponentialRampToValueAtTime(135, when + 0.06);
                const og = ctx.createGain();
                og.gain.setValueAtTime(0.14, when);
                og.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
                o.connect(og).connect(out);
                o.start(when); o.stop(when + 0.08);
            }
        },

        flute: {
            label: 'Vibe Berry',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'flute',
            play(ctx, out, when, step) {
                const melody = { 2: 783.99, 6: 880.00, 10: 783.99, 14: 659.25 };
                const freq = melody[step];
                if (!freq) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const lfo = ctx.createOscillator();
                const lfoG = ctx.createGain();
                lfo.frequency.value = 5;
                lfoG.gain.value = 4;
                lfo.connect(lfoG).connect(o.frequency);
                o.type = 'triangle';
                o.frequency.value = freq;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.13, when + 0.04);
                g.gain.linearRampToValueAtTime(0.11, when + 0.2);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.32);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.35);
                lfo.start(when); lfo.stop(when + 0.35);
            }
        },

        star: {
            label: 'Star Ping',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'star',
            play(ctx, out, when, step) {
                if (step !== 0) return;
                const notes = [1046.5, 1318.51, 1567.98];
                notes.forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.value = freq;
                    const t = when + i * 0.06;
                    g.gain.setValueAtTime(0, t);
                    g.gain.linearRampToValueAtTime(0.10, t + 0.005);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
                    o.connect(g).connect(out);
                    o.start(t); o.stop(t + 0.65);
                });
            }
        },

        fog: {
            label: 'Fog Chord',
            bodyColor: '#3a5a8a', bodyHi: '#5a7aaa', bodyShade: '#1a2a4a',
            headFrame: 'fog',
            play(ctx, out, when, step) {
                if (step !== 0) return;
                const chord = [261.63, 329.63, 392.00];
                chord.forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'triangle';
                    o.frequency.value = freq;
                    g.gain.setValueAtTime(0, when);
                    g.gain.linearRampToValueAtTime(0.05 - i * 0.01, when + 0.4);
                    g.gain.linearRampToValueAtTime(0.04 - i * 0.008, when + 1.6);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 2.4);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + 2.45);
                });
            }
        },

        moon: {
            label: 'Moon Munki',
            bodyColor: '#3a5a8a', bodyHi: '#5a7aaa', bodyShade: '#1a2a4a',
            headFrame: 'moon',
            play(ctx, out, when, step) {
                if (step !== 0) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                o.frequency.value = 65.41;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.32, when + 0.06);
                g.gain.linearRampToValueAtTime(0.26, when + 1.6);
                g.gain.exponentialRampToValueAtTime(0.001, when + 2.4);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 2.45);
                const o2 = ctx.createOscillator();
                const g2 = ctx.createGain();
                o2.type = 'sine';
                o2.frequency.value = 130.81;
                g2.gain.setValueAtTime(0, when);
                g2.gain.linearRampToValueAtTime(0.06, when + 0.1);
                g2.gain.exponentialRampToValueAtTime(0.001, when + 2.4);
                o2.connect(g2).connect(out);
                o2.start(when); o2.stop(when + 2.45);
            }
        },

        spark: {
            label: 'Spark Snap',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'spark',
            play(ctx, out, when, step) {
                if (step % 2 !== 1) return;
                const n = noiseSource(ctx, 0.025);
                const f = ctx.createBiquadFilter();
                f.type = 'highpass';
                f.frequency.value = 8500;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.06, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.025);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.03);
            }
        },

        ice: {
            label: 'Ice Munki',
            bodyColor: '#3a5a8a', bodyHi: '#5a7aaa', bodyShade: '#1a2a4a',
            headFrame: 'ice',
            play(ctx, out, when, step) {
                const seq = { 3: 1046.50, 7: 1174.66, 11: 1318.51, 15: 1567.98 };
                const freq = seq[step];
                if (!freq) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'triangle';
                o.frequency.value = freq;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.07, when + 0.015);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.2);
            }
        },

        'mb-zorb': {
            label: 'Zorb Drive', sheet: 'madballs', headFrame: 'mb-alien',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764',
            play(ctx, out, when, step) {
                if (step !== 0 && step !== 8) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const dist = ctx.createWaveShaper();
                dist.curve = distortionCurve(45);
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.setValueAtTime(2000, when);
                f.frequency.exponentialRampToValueAtTime(380, when + 0.4);
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(220, when);
                o.frequency.exponentialRampToValueAtTime(110, when + 0.4);
                g.gain.setValueAtTime(0.16, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.42);
                o.connect(dist).connect(f).connect(g).connect(out);
                o.start(when); o.stop(when + 0.45);
            }
        },

        'mb-drip': {
            label: 'Drip Drop', sheet: 'madballs', headFrame: 'mb-cry',
            bodyColor: '#a16207', bodyHi: '#d97706', bodyShade: '#451a03',
            play(ctx, out, when, step) {
                const seq = { 4: 415.30, 12: 392.00 };
                const start = seq[step];
                if (!start) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'triangle';
                o.frequency.setValueAtTime(start, when);
                o.frequency.exponentialRampToValueAtTime(start * 0.92, when + 0.45);
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.13, when + 0.05);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.5);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.55);
            }
        },

        'mb-random': {
            label: 'Random Root', sheet: 'madballs', headFrame: 'mb-shroom',
            bodyColor: '#15803d', bodyHi: '#22c55e', bodyShade: '#052e16',
            play(ctx, out, when, step) {
                if (![1, 4, 7, 10, 13].includes(step)) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                const base = [523.25, 659.25, 783.99][step % 3];
                const oct = Math.random() < 0.5 ? 1 : 2;
                o.frequency.value = base * oct;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.08, when + 0.005);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 0.14);
            }
        },

        'mb-thrum': {
            label: 'Thrum Brain', sheet: 'madballs', headFrame: 'mb-brain',
            bodyColor: '#65a30d', bodyHi: '#84cc16', bodyShade: '#1a2e05',
            play(ctx, out, when, step) {
                if (step !== 0 && step !== 8) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const dist = ctx.createWaveShaper();
                dist.curve = distortionCurve(70);
                const lfo = ctx.createOscillator();
                const lfoG = ctx.createGain();
                lfo.frequency.value = 24;
                lfoG.gain.value = 0.45;
                lfo.connect(lfoG).connect(g.gain);
                o.type = 'sawtooth';
                o.frequency.value = 82.41;
                g.gain.setValueAtTime(0.18, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.55);
                o.connect(dist).connect(g).connect(out);
                o.start(when); o.stop(when + 0.6);
                lfo.start(when); lfo.stop(when + 0.6);
            }
        },

        'mb-volt': {
            label: 'Volt Twist', sheet: 'madballs', headFrame: 'mb-wires',
            bodyColor: '#78350f', bodyHi: '#a16207', bodyShade: '#1c0701',
            play(ctx, out, when, step) {
                if (step % 4 !== 2) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const f = ctx.createBiquadFilter();
                f.type = 'highpass';
                f.frequency.value = 1500;
                o.type = 'square';
                o.frequency.value = 880 + (step * 11);
                g.gain.setValueAtTime(0.07, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
                o.connect(f).connect(g).connect(out);
                o.start(when); o.stop(when + 0.07);
            }
        },

        'mb-rock': {
            label: 'Rock Slide', sheet: 'madballs', headFrame: 'mb-rocky',
            bodyColor: '#57534e', bodyHi: '#78716c', bodyShade: '#1c1917',
            play(ctx, out, when, step) {
                if (![2, 9, 14].includes(step)) return;
                const n = noiseSource(ctx, 0.18);
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.setValueAtTime(420, when);
                f.frequency.exponentialRampToValueAtTime(120, when + 0.15);
                f.Q.value = 4;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.32, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
                n.connect(f).connect(g).connect(out);
                n.start(when); n.stop(when + 0.2);
            }
        }
    };

    // Tray order: Munkis are grouped by HEAD COLOR so the bank reads as a
    // tidy color rainbow (green → orange → purple → blue), and Ice Munki +
    // Moon Munki are pinned to the very end on EVERY page (standard tray
    // and Madballz tray) since they are the antagonists.
    const STANDARD_ORDER = [
        // GREEN (4)
        'hiss', 'srivi', 'star', 'grumble',
        // ORANGE (4)
        'sine', 'snare', 'amber', 'green',
        // PURPLE (5)
        'high', 'mega', 'shadow', 'spark', 'flute',
        // BLUE non-antagonist (1)
        'fog',
        // Antagonists, always last
        'ice', 'moon'
    ];

    const MADBALLZ_ORDER = [
        'mb-zorb', 'mb-drip', 'mb-random',
        'mb-thrum', 'mb-volt', 'mb-rock',
        // Antagonists, always last (matches the standard tray rule)
        'ice', 'moon'
    ];
    const SHEETS = {
        munki: {
            src: 'assets/sprites/default-heads.png',
            sheetW: 4330,
            sheetH: 4381,
            // Frame names match each Munki's id 1:1 — body color must match
            // the head color in the sprite (see CHARACTERS below for the
            // color groupings used in the tray).
            frames: {
                'high':    { x: 2,    y: 2,    w: 1080, h: 1093 }, // PURPLE
                'hiss':    { x: 1084, y: 2,    w: 1080, h: 1092 }, // GREEN
                'ice':     { x: 2166, y: 2,    w: 1080, h: 1091 }, // BLUE  (antagonist)
                'mega':    { x: 3248, y: 2,    w: 1080, h: 1089 }, // PURPLE
                'moon':    { x: 2,    y: 1097, w: 1080, h: 1094 }, // BLUE  (antagonist)
                'shadow':  { x: 1084, y: 1097, w: 1080, h: 1088 }, // PURPLE
                'sine':    { x: 2166, y: 1097, w: 1080, h: 1092 }, // ORANGE
                'snare':   { x: 3248, y: 1097, w: 1080, h: 1088 }, // ORANGE
                'spark':   { x: 2,    y: 2193, w: 1080, h: 1086 }, // PURPLE
                'srivi':   { x: 1084, y: 2193, w: 1080, h: 1088 }, // GREEN
                'star':    { x: 2166, y: 2193, w: 1080, h: 1086 }, // GREEN
                'amber':   { x: 3248, y: 2193, w: 1080, h: 1093 }, // ORANGE
                'flute':   { x: 2,    y: 3288, w: 1080, h: 1090 }, // PURPLE
                'fog':     { x: 1084, y: 3288, w: 1080, h: 1091 }, // BLUE
                'green':   { x: 2166, y: 3288, w: 1080, h: 1091 }, // ORANGE (legacy id, orange head)
                'grumble': { x: 3248, y: 3288, w: 1080, h: 1086 }  // GREEN
            }
        },
        madballs: {
            src: 'assets/sprites/madballs-heads.png',
            sheetW: 3244,
            sheetH: 2160,
            frames: {
                // names map to the visual identity of each frame
                'mb-alien':  { x: 1,    y: 1,    w: 1080, h: 1068 }, // head-three
                'mb-cry':    { x: 1082, y: 1,    w: 1080, h: 1107 }, // head-five
                'mb-shroom': { x: 2163, y: 1,    w: 1080, h: 1074 }, // head-four
                'mb-brain':  { x: 1,    y: 1109, w: 1080, h: 1042 }, // head-one
                'mb-wires':  { x: 1082, y: 1109, w: 1080, h: 1022 }, // head-six
                'mb-rocky':  { x: 2163, y: 1109, w: 1080, h: 1050 }  // head-two
            }
        }
    };

    // The two antagonists in the lore. When either ICE MUNKI or MOON MUNKI
    // is dropped onto a slot, the jumpscare fires automatically AND counts
    // toward unlocking the Madballz screen (see MADBALLZ_UNLOCK_THRESHOLD).
    const HORROR_TRIGGER_MODS = new Set(['ice', 'moon']);
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

    // Colored head circle (matches body color). r=44 in the 100 viewBox; the
    // .head-mod / .head-face siblings inset to match this radius so the sprite
    // fills exactly the visible circle (no gaps under the headphones).
    function headShapeArt(c) {
        return `<svg class="head-shape" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
            + `<circle cx="50" cy="50" r="44" fill="${c.bodyColor}" stroke="${c.bodyShade}" stroke-width="3"/>`
            + `<ellipse cx="50" cy="60" rx="30" ry="22" fill="${c.bodyHi}" opacity="0.32"/>`
            + `</svg>`;
    }

    // Generic Munki face — used as a fallback when no headFrame is set.
    function headFaceArt() {
        return `<svg class="head-face" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
            + `<circle cx="38" cy="50" r="7" fill="#fff" stroke="#000" stroke-width="2"/>`
            + `<circle cx="62" cy="50" r="7" fill="#fff" stroke="#000" stroke-width="2"/>`
            + `<circle cx="38" cy="51" r="3.5" fill="#000"/>`
            + `<circle cx="62" cy="51" r="3.5" fill="#000"/>`
            + `<circle cx="39" cy="50" r="1.4" fill="#fff"/>`
            + `<circle cx="63" cy="50" r="1.4" fill="#fff"/>`
            + `<path d="M 38 66 Q 50 76 62 66" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>`
            + `</svg>`;
    }

    // Custom head sprite cropped from one of the spritesheets. The SVG viewBox
    // crops to the named frame's pixel coords, while the inner <image> shows
    // the full sheet — preserveAspectRatio scales the cropped frame into the
    // SVG's display box (which is 100% of .head-mod = the head circle area).
    // Defaults to the 'munki' sheet; pass 'madballs' for the Madballz Modz set.
    function headModArt(frameName, sheetName) {
        const sheet = SHEETS[sheetName || 'munki'];
        const f = sheet && sheet.frames[frameName];
        if (!f) return headFaceArt(); // fall back to placeholder face
        return `<svg class="head-mod" viewBox="${f.x} ${f.y} ${f.w} ${f.h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
            + `<image href="${sheet.src}" x="0" y="0" width="${sheet.sheetW}" height="${sheet.sheetH}"/>`
            + `</svg>`;
    }

    // Headphones — big studio over-ear cans with a mic boom. Drawn in the
    // same 100×100 viewBox as the head so the rig keeps its position whether
    // a generic face or a mod sprite sits underneath.
    //
    // Geometry notes (head circle is r=44 at (50,50), so head crown sits at
    // y=6, ear region around y=50–60):
    //   - Headband is a true SEMICIRCLE arc: rx=ry=40, endpoints (10,42) and
    //     (90,42), apex at (50, 2). Apex sits 4px above the head crown so the
    //     band visibly wraps OVER the top of the head like real over-ear cans
    //     instead of cutting across the face.
    //   - Tiny crown cushion fills the gap between band apex and the head
    //     dome so the touch point reads as soft contact.
    //   - Earcups bumped from rx=9 ry=13 to rx=11 ry=14 (≈30% bigger area)
    //     so they read as proper over-ear pads, anchored at the side of
    //     the head.
    //   - Mic boom is a stacked stroke (black + gray inner) for a chunkier
    //     studio-boom feel, ending in a cardioid capsule on the right.
    function headPhonesArt() {
        return `<svg class="head-phones" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
            // headband — true semicircle arc (rx=ry=40), outer thick black
            // and inner metallic stripe sharing the same path data.
            + `<path d="M 10 42 A 40 40 0 0 1 90 42" fill="none" stroke="#0a0a0a" stroke-width="8" stroke-linecap="round"/>`
            + `<path d="M 10 42 A 40 40 0 0 1 90 42" fill="none" stroke="#3a3a3a" stroke-width="3" stroke-linecap="round"/>`
            // crown cushion — soft pad nesting between the arc apex and head
            + `<ellipse cx="50" cy="6.5" rx="14" ry="2.5" fill="#111" stroke="#000" stroke-width="1.2"/>`
            + `<ellipse cx="50" cy="5.8" rx="11" ry="1.4" fill="#555" opacity="0.7"/>`
            // left earcup — bigger, over-ear sized
            + `<ellipse cx="11" cy="55" rx="11" ry="14" fill="#111" stroke="#000" stroke-width="2"/>`
            + `<ellipse cx="11" cy="55" rx="6.5" ry="9.5" fill="#444"/>`
            + `<ellipse cx="9" cy="50" rx="1.8" ry="2.8" fill="#aaa" opacity="0.7"/>`
            // right earcup
            + `<ellipse cx="89" cy="55" rx="11" ry="14" fill="#111" stroke="#000" stroke-width="2"/>`
            + `<ellipse cx="89" cy="55" rx="6.5" ry="9.5" fill="#444"/>`
            + `<ellipse cx="87" cy="50" rx="1.8" ry="2.8" fill="#aaa" opacity="0.7"/>`
            // mic boom — beefier studio boom + cardioid capsule on the right
            + `<line x1="83" y1="65" x2="73" y2="78" stroke="#0a0a0a" stroke-width="3" stroke-linecap="round"/>`
            + `<line x1="83" y1="65" x2="73.5" y2="77.5" stroke="#3a3a3a" stroke-width="1.2" stroke-linecap="round"/>`
            + `<ellipse cx="71" cy="79" rx="3.6" ry="3" fill="#3a3a3a" stroke="#000" stroke-width="1.2"/>`
            + `<ellipse cx="71" cy="78.5" rx="2.2" ry="1.6" fill="#666"/>`
            // tiny "live" LED on the left earcup
            + `<circle cx="13" cy="62" r="1.6" fill="#2dd4bf"/>`
            + `</svg>`;
    }

    // ---------- HAIR ----------
    // Procedural hair: 5 silhouette styles, 5 colors. About half the Munkis
    // get a random combo at load time (see assignRandomHair below) and keep
    // it for the session — same id always renders the same hair.
    //
    // Hair sits BETWEEN the head sprite and the headphones in the z-stack:
    //   shape (z 1) → mod/face (z 2) → hair (z 2.5) → phones (z 3)
    // This means tufts and spikes peek above the face but are partly covered
    // by the chunky band/earcups, which reads naturally for over-ear cans.
    const HAIR_STYLES = ['spikes', 'mohawk', 'tuft', 'antennae', 'sidepuffs'];
    const HAIR_COLORS = ['#1a1a1a', '#6b3410', '#fbbf24', '#e91e63', '#f5f5f5'];

    function hairSvg(style, color, dark) {
        const stroke = `stroke="${dark}" stroke-width="2" stroke-linejoin="round"`;
        switch (style) {
            case 'spikes':
                return `<path d="M 22 16 L 28 -2 L 34 16 Z" fill="${color}" ${stroke}/>`
                     + `<path d="M 38 14 L 46 -6 L 52 14 Z" fill="${color}" ${stroke}/>`
                     + `<path d="M 56 14 L 64 -4 L 72 14 Z" fill="${color}" ${stroke}/>`;
            case 'mohawk':
                return `<path d="M 38 14 Q 40 -12 50 -10 Q 60 -12 62 14 Z" fill="${color}" ${stroke}/>`
                     + `<line x1="50" y1="-8" x2="50" y2="14" stroke="${dark}" stroke-width="1" opacity="0.6"/>`;
            case 'tuft':
                return `<path d="M 38 16 Q 36 0 44 0 Q 50 -6 56 0 Q 64 0 62 16 Z" fill="${color}" ${stroke}/>`
                     + `<circle cx="44" cy="6" r="3" fill="${color}"/>`
                     + `<circle cx="56" cy="4" r="2.5" fill="${color}"/>`;
            case 'antennae':
                return `<line x1="40" y1="14" x2="30" y2="-8" stroke="${dark}" stroke-width="2.5" stroke-linecap="round"/>`
                     + `<circle cx="30" cy="-8" r="3.5" fill="${color}" stroke="${dark}" stroke-width="1.5"/>`
                     + `<line x1="60" y1="14" x2="70" y2="-6" stroke="${dark}" stroke-width="2.5" stroke-linecap="round"/>`
                     + `<circle cx="70" cy="-6" r="3.5" fill="${color}" stroke="${dark}" stroke-width="1.5"/>`;
            case 'sidepuffs':
                return `<ellipse cx="8" cy="44" rx="7" ry="11" fill="${color}" ${stroke}/>`
                     + `<ellipse cx="92" cy="44" rx="7" ry="11" fill="${color}" ${stroke}/>`;
            default:
                return '';
        }
    }

    function hairArt(c) {
        if (!c.hair) return '';
        const dark = c.hair.outline || '#000';
        return `<svg class="char-hair" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" overflow="visible">`
            + hairSvg(c.hair.style, c.hair.color, dark)
            + `</svg>`;
    }

    function assignRandomHair() {
        // ~55% of mods get hair, randomly. Munkis with horror trigger flags
        // (moon, ice) skip — bald horror reads better than wig horror.
        ORDER.forEach(id => {
            if (HORROR_TRIGGER_MODS.has(id)) return;
            if (Math.random() > 0.55) return;
            const style = HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)];
            const color = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
            CHARACTERS[id].hair = { style, color, outline: '#000' };
        });
    }

    function headArt(c) {
        const inner = c.headFrame ? headModArt(c.headFrame, c.sheet) : headFaceArt();
        return headShapeArt(c) + inner + hairArt(c) + headPhonesArt();
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
        const order = isMadballzMode ? MADBALLZ_ORDER : STANDARD_ORDER;
        order.forEach(id => {
            const ch = CHARACTERS[id];
            const el = document.createElement('div');
            el.className = 'tray-chip';
            el.dataset.char = id;
            // Tooltip carries the full name even when the chip label is
            // truncated by the small chip width on mobile.
            el.title = ch.label;
            // Mark the antagonists so the chip can pulse / glow distinctly.
            if (HORROR_TRIGGER_MODS.has(id)) el.classList.add('chip-bad');
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
            slot.classList.toggle('slot-bad', HORROR_TRIGGER_MODS.has(id));
            slot.dataset.char = id;
            slot.title = ch.label;
            slot.innerHTML = `
                <div class="slot-icon">${characterArt(id)}</div>
                <div class="slot-label">${ch.label}</div>
            `;
        } else {
            slot.classList.remove('active');
            slot.classList.remove('slot-bad');
            slot.classList.add('empty');
            delete slot.dataset.char;
            slot.removeAttribute('title');
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
        const wasHorror = HORROR_TRIGGER_MODS.has(slots[index]);
        const iceWasOn = isIceOnStage();
        slots[index] = charId;
        renderSlot(index);
        // Lore: ICE MUNKI and MOON MUNKI are the antagonists — placing one
        // onto a slot tears the level into horror mode for a moment. Only
        // fire on transition into a trigger so swapping between two trigger
        // mods doesn't double-fire. Each transition also nudges the kid
        // toward unlocking the Madballz screen.
        if (charId && HORROR_TRIGGER_MODS.has(charId) && !wasHorror) {
            triggerJumpScare();
            horrorTriggers++;
            saveProgress();
            maybeUnlockMadballz();
        }
        // ICE MUNKI freeze: every other Munki on stage gets flash-frozen to
        // "DEATH" with cyan tint + ice crystals + RIP tag. Plays the icy
        // shimmer once on the transition INTO an iced stage. Stage thaws
        // automatically when the last Ice Munki is cleared.
        const iceNowOn = isIceOnStage();
        updateIceFreeze();
        if (iceNowOn && !iceWasOn) playIceFreezeSound();
    }

    function isIceOnStage() {
        return slots.indexOf('ice') !== -1;
    }

    // Toggles `.frozen-by-ice` on every active non-ice slot whenever an Ice
    // Munki is on the board. Class is only added on the transition from
    // unfrozen → frozen so the RIP/skull animation re-fires for fresh
    // victims, but doesn't loop forever on already-frozen slots.
    function updateIceFreeze() {
        const iceOn = isIceOnStage();
        document.body.classList.toggle('ice-on-stage', iceOn);
        document.querySelectorAll('.stage-slot').forEach(slot => {
            const idx = parseInt(slot.dataset.index, 10);
            const id = slots[idx];
            const shouldFreeze = iceOn && !!id && id !== 'ice';
            const wasFrozen = slot.classList.contains('frozen-by-ice');
            if (shouldFreeze && !wasFrozen) {
                slot.classList.add('frozen-by-ice');
            } else if (!shouldFreeze && wasFrozen) {
                slot.classList.remove('frozen-by-ice');
            }
        });
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

    // ---------- JUMP SCARE ----------
    // Sprunki-style horror moment, kid-controlled via the BOO button. Plays a
    // distorted descending shriek + sub thud while the page shakes, flashes
    // red, and the active Munkis glitch out. Returns to normal after 1.5s.
    // Debounced so spamming the button doesn't stack scares.
    function triggerJumpScare() {
        if (isJumpScareActive) return;
        isJumpScareActive = true;

        // Make sure the audio engine is alive before we try to play anything;
        // also lets the kid trigger a scare as their very first interaction.
        ensureAudio();
        playJumpScareSound();

        document.body.classList.add('jumpscare');
        setTimeout(() => {
            document.body.classList.remove('jumpscare');
            isJumpScareActive = false;
        }, 1500);
    }

    function playJumpScareSound() {
        if (!audioCtx || isMuted) return;
        const t = audioCtx.currentTime;

        // Distorted descending shriek — sawtooth + square through a wave
        // shaper. Sweeps from a piercing high down to a sub growl over ~1s.
        const dist = audioCtx.createWaveShaper();
        dist.curve = distortionCurve(100);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.45, t + 0.02);
        g.gain.linearRampToValueAtTime(0.35, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
        dist.connect(g).connect(masterGain);

        const o1 = audioCtx.createOscillator();
        o1.type = 'sawtooth';
        o1.frequency.setValueAtTime(1200, t);
        o1.frequency.exponentialRampToValueAtTime(60, t + 1.0);
        o1.connect(dist);
        o1.start(t); o1.stop(t + 1.4);

        const o2 = audioCtx.createOscillator();
        o2.type = 'square';
        o2.frequency.setValueAtTime(800, t);
        o2.frequency.exponentialRampToValueAtTime(45, t + 1.0);
        o2.connect(dist);
        o2.start(t); o2.stop(t + 1.4);

        // Sub thud — gives the scare a chest-punch landing.
        const k = audioCtx.createOscillator();
        const kg = audioCtx.createGain();
        k.type = 'sine';
        k.frequency.setValueAtTime(80, t);
        k.frequency.exponentialRampToValueAtTime(28, t + 0.5);
        kg.gain.setValueAtTime(0.7, t);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        k.connect(kg).connect(masterGain);
        k.start(t); k.stop(t + 0.65);
    }

    // ---------- ICE FREEZE ----------
    // Glassy descending shimmer + a soft icy crackle so the freeze has a
    // sound-cue distinct from the regular jumpscare. Fires once when Ice
    // Munki first lands on the stage.
    function playIceFreezeSound() {
        if (!audioCtx || isMuted) return;
        const t = audioCtx.currentTime;
        [1568, 1318, 1046, 783].forEach((freq, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            const start = t + i * 0.05;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.13, start + 0.012);
            g.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
            o.connect(g).connect(masterGain);
            o.start(start); o.stop(start + 0.5);
        });
        const n = noiseSource(audioCtx, 0.32);
        const f = audioCtx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 5200;
        const ng = audioCtx.createGain();
        ng.gain.setValueAtTime(0, t);
        ng.gain.linearRampToValueAtTime(0.18, t + 0.22);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        n.connect(f).connect(ng).connect(masterGain);
        n.start(t); n.stop(t + 0.6);
    }

    // ---------- MOON RULES ----------
    // Moon Munki is "all-powerful": while on the stage, ANY click on the
    // page has a chance to trigger one of a small bag of chaos events.
    // Cooldown keeps it readable instead of seizure-y when the kid is
    // mashing the screen.
    let moonChaosCooldown = false;

    function moonRules() {
        if (!slots.includes('moon')) return;
        if (moonChaosCooldown) return;
        if (isJumpScareActive) return; // don't pile on during scares
        moonChaosCooldown = true;
        setTimeout(() => { moonChaosCooldown = false; }, 700);
        const events = [
            moonHueRotate, moonInvertFlash, moonShuffleSlots,
            moonRain, moonGlitchSubtitle, moonTilt, moonPhantomDrop
        ];
        events[Math.floor(Math.random() * events.length)]();
        playMoonChaosSound();
    }

    function moonHueRotate() {
        document.body.classList.remove('moon-hue');
        void document.body.offsetWidth;
        document.body.classList.add('moon-hue');
        setTimeout(() => document.body.classList.remove('moon-hue'), 850);
    }

    function moonInvertFlash() {
        document.body.classList.remove('moon-invert');
        void document.body.offsetWidth;
        document.body.classList.add('moon-invert');
        setTimeout(() => document.body.classList.remove('moon-invert'), 280);
    }

    function moonTilt() {
        document.body.classList.remove('moon-tilt');
        void document.body.offsetWidth;
        document.body.classList.add('moon-tilt');
        setTimeout(() => document.body.classList.remove('moon-tilt'), 750);
    }

    // Reorder placed Munkis on stage. Keeps the same set of mods playing
    // but switches which slot each one sits in — auditory layout doesn't
    // change, but the visuals scramble.
    function moonShuffleSlots() {
        const filled = [];
        for (let i = 0; i < NUM_SLOTS; i++) {
            if (slots[i]) filled.push(i);
        }
        if (filled.length < 2) return;
        const ids = filled.map(i => slots[i]);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        filled.forEach((idx, k) => { slots[idx] = ids[k]; });
        renderAllSlots();
        updateIceFreeze();
    }

    function moonRain() {
        const layer = document.createElement('div');
        layer.className = 'moon-rain';
        for (let i = 0; i < 14; i++) {
            const m = document.createElement('span');
            m.textContent = '🌙';
            m.style.left = (Math.random() * 100) + 'vw';
            m.style.fontSize = (16 + Math.random() * 36) + 'px';
            m.style.animationDelay = (Math.random() * 0.5) + 's';
            m.style.animationDuration = (2 + Math.random() * 1.6) + 's';
            layer.appendChild(m);
        }
        document.body.appendChild(layer);
        setTimeout(() => layer.remove(), 4500);
    }

    const MOON_GLITCH_LINES = [
        'MOON KNOWS WHAT YOU DID',
        'THE TIDE IS COMING IN',
        'ALL PATHS LEAD TO THE MOON',
        'GRAVITY IS A SUGGESTION',
        'WATCHED FROM ORBIT',
        'TONIGHT WE LISTEN UPSIDE DOWN',
        'OBEY THE CRESCENT'
    ];

    function moonGlitchSubtitle() {
        const sub = document.getElementById('subtitle');
        if (!sub) return;
        if (sub.dataset.original === undefined) sub.dataset.original = sub.textContent;
        sub.textContent = MOON_GLITCH_LINES[Math.floor(Math.random() * MOON_GLITCH_LINES.length)];
        sub.classList.add('moon-glitch-text');
        clearTimeout(sub._moonRevert);
        sub._moonRevert = setTimeout(() => {
            sub.textContent = sub.dataset.original || sub.textContent;
            sub.classList.remove('moon-glitch-text');
        }, 1400);
    }

    // Pop a ghostly random Munki into a random empty slot for under a
    // second — the kid sees a friend flicker into existence then vanish.
    function moonPhantomDrop() {
        const empty = [];
        for (let i = 0; i < NUM_SLOTS; i++) if (!slots[i]) empty.push(i);
        if (!empty.length) return;
        const idx = empty[Math.floor(Math.random() * empty.length)];
        const order = isMadballzMode ? MADBALLZ_ORDER : STANDARD_ORDER;
        const choices = order.filter(id => id !== 'moon' && id !== 'ice');
        if (!choices.length) return;
        const id = choices[Math.floor(Math.random() * choices.length)];
        const slot = document.querySelector(`.stage-slot[data-index="${idx}"]`);
        if (!slot) return;
        const ghost = document.createElement('div');
        ghost.className = 'moon-phantom';
        ghost.innerHTML = characterArt(id);
        slot.appendChild(ghost);
        setTimeout(() => ghost.remove(), 950);
    }

    function playMoonChaosSound() {
        if (!audioCtx || isMuted) return;
        const t = audioCtx.currentTime;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(880, t + 0.35);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        o.connect(g).connect(masterGain);
        o.start(t); o.stop(t + 0.5);
        const b = audioCtx.createOscillator();
        const bg = audioCtx.createGain();
        b.type = 'sine';
        b.frequency.value = 55;
        bg.gain.setValueAtTime(0.15, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        b.connect(bg).connect(masterGain);
        b.start(t); b.stop(t + 0.32);
    }

    function attachMoonChaos() {
        // Document-level listener fires after slot/tray handlers, so a click
        // that clears Moon Munki happens BEFORE moonRules checks — meaning
        // chaos politely refuses to fire on the very click that removed the
        // moon. No need to special-case it.
        document.addEventListener('click', () => moonRules());
    }

    // ---------- STORY PROGRESSION & MADBALLZ MODE ----------
    // Persistence: { horrorTriggers, madballzUnlocked } in localStorage so the
    // kid keeps their unlock between visits. We swallow storage errors (private
    // mode, quota) so a flaky client never breaks the game.
    function loadProgress() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const obj = JSON.parse(raw);
            horrorTriggers = (obj.horrorTriggers | 0);
            madballzUnlocked = !!obj.madballzUnlocked;
        } catch (e) { /* ignore — start fresh */ }
    }

    function saveProgress() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                horrorTriggers,
                madballzUnlocked
            }));
        } catch (e) { /* ignore */ }
    }

    // Called every time horrorTriggers ticks up. The first time we cross the
    // threshold we flip the unlocked flag, persist it, and reveal the
    // "MEET THE MADBALLZ" button so the kid spots the new path.
    function maybeUnlockMadballz() {
        if (madballzUnlocked) {
            revealMadballzButton(false);
            return;
        }
        if (horrorTriggers >= MADBALLZ_UNLOCK_THRESHOLD) {
            madballzUnlocked = true;
            saveProgress();
            revealMadballzButton(true);
        }
    }

    function revealMadballzButton(animate) {
        const btn = document.getElementById('madballzBtn');
        if (!btn) return;
        btn.hidden = false;
        if (animate) {
            // Re-trigger the reveal animation on each fresh unlock so the kid
            // sees a clear "NEW THING" beat instead of the button just popping
            // in silently.
            btn.classList.remove('reveal');
            void btn.offsetWidth;
            btn.classList.add('reveal');
        }
    }

    // Switch to the Madballz screen — the antagonists Ice Munki + Moon Munki
    // travel here too because (per lore) they are friends with the Madballz.
    // Stage is cleared on entry so the kid starts the new screen with a blank
    // canvas, and the tray + hint + body class swap to the darker palette.
    function enterMadballzMode() {
        ensureAudio();
        isMadballzMode = true;
        document.body.classList.add('madballz-mode');
        const meet = document.getElementById('madballzBtn');
        const back = document.getElementById('backBtn');
        if (meet) meet.hidden = true;
        if (back) back.hidden = false;
        for (let i = 0; i < NUM_SLOTS; i++) slots[i] = null;
        renderAllSlots();
        updateIceFreeze();
        renderTray();
        attachTrayHandlers();
        updateTrayHint();
    }

    function exitMadballzMode() {
        isMadballzMode = false;
        document.body.classList.remove('madballz-mode');
        const meet = document.getElementById('madballzBtn');
        const back = document.getElementById('backBtn');
        if (meet) meet.hidden = !madballzUnlocked;
        if (back) back.hidden = true;
        for (let i = 0; i < NUM_SLOTS; i++) slots[i] = null;
        renderAllSlots();
        updateIceFreeze();
        renderTray();
        attachTrayHandlers();
        updateTrayHint();
    }

    function updateTrayHint() {
        const hint = document.getElementById('trayHint');
        if (!hint) return;
        hint.textContent = isMadballzMode
            ? 'MADBALLZ MODE · 6 Madballz · ICE + MOON last (they are friends)'
            : 'Drag a friend · grouped by color · ICE freezes · MOON RULES on every click';
    }

    function openStoryModal() {
        const modal = document.getElementById('storyModal');
        if (!modal) return;
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('open');
    }

    function closeStoryModal() {
        const modal = document.getElementById('storyModal');
        if (!modal) return;
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('open');
    }

    // ---------- HEADER BUTTONS ----------
    function attachHeaderHandlers() {
        document.getElementById('remixBtn').addEventListener('click', () => {
            ensureAudio();
            // Route through setSlot so a remix that lands on Ice or Moon
            // fires the horror jumpscare just like a manual drop would.
            // Picks from the order matching the screen the kid is on.
            const order = isMadballzMode ? MADBALLZ_ORDER : STANDARD_ORDER;
            for (let i = 0; i < NUM_SLOTS; i++) {
                setSlot(i, order[Math.floor(Math.random() * order.length)]);
            }
            playDropSound();
        });

        const storyBtn = document.getElementById('storyBtn');
        if (storyBtn) storyBtn.addEventListener('click', openStoryModal);

        const storyClose = document.getElementById('storyCloseBtn');
        if (storyClose) storyClose.addEventListener('click', closeStoryModal);

        const storyModal = document.getElementById('storyModal');
        if (storyModal) {
            // Click on the dim backdrop (not the card) closes the modal.
            storyModal.addEventListener('click', e => {
                if (e.target === storyModal) closeStoryModal();
            });
        }
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeStoryModal();
        });

        const madballzBtn = document.getElementById('madballzBtn');
        if (madballzBtn) madballzBtn.addEventListener('click', enterMadballzMode);

        const backBtn = document.getElementById('backBtn');
        if (backBtn) backBtn.addEventListener('click', exitMadballzMode);

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
                updateIceFreeze();
                if (cleared) playClearSound();
            });
        }

        const songBtn = document.getElementById('songBtn');
        if (songBtn) {
            songBtn.addEventListener('click', () => {
                ensureAudio(); // start playback if user toggles song first
                isBaseSongOn = !isBaseSongOn;
                songBtn.classList.toggle('off', !isBaseSongOn);
                songBtn.setAttribute('aria-pressed', String(isBaseSongOn));
            });
        }

        const booBtn = document.getElementById('booBtn');
        if (booBtn) {
            booBtn.addEventListener('click', triggerJumpScare);
        }

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
        loadProgress();
        buildStage();
        renderTray();
        renderAllSlots();
        attachTrayHandlers();
        attachSlotHandlers();
        attachHeaderHandlers();
        attachMoonChaos();
        updateTrayHint();
        // If the kid already unlocked Madballz on a previous visit, surface
        // the button immediately (without the "new" reveal flourish).
        if (madballzUnlocked) revealMadballzButton(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
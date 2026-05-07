
(() => {
    'use strict';

    // ---------- CONFIG ----------
    const TEMPO = 100;                       // BPM
    const STEPS_PER_BAR = 16;                // sixteenth notes
    const SECONDS_PER_STEP = 60 / TEMPO / 4; // 0.15s
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.1;
    const NUM_SLOTS = 8;
    const BARS_PER_LOOP = 2;                 // BASE_SONG cycles every 2 bars
    // Story progression: trip horror mode this many times (by dropping ICE
    // MUNKI or MOON MUNKI onto the stage) and the "MEET THE MADBALLZ" button
    // appears in the header. Persisted in localStorage so the kid keeps the
    // unlock between visits.
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

    // ---------- STORY PROGRESSION STATE ----------
    // Counts horror triggers (Ice/Moon drops) toward the Madballz unlock.
    // `madballzUnlocked` flips true the first time the threshold is hit and
    // stays true forever after (persisted in localStorage). `isMadballzMode`
    // is the live toggle for the "Meet the Madballz" screen.
    let horrorTriggers = 0;
    let madballzUnlocked = false;
    let isMadballzMode = false;

    function ensureAudio() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = isMuted ? 0 : 0.55;
            // Bus compressor — glues 8 simultaneous voices together and stops
            // peaks from clipping when the full 8-slot mix is running.
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
        // Background level theme — runs underneath the user's mods.
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

    // ---------- BASE SONG ("Bala's Theme") ----------
    // A 2-bar level-music loop that plays under whatever mods are on stage.
    //
    //   Bar 0: Cmaj  — bass C2, pad C-E-G held the whole bar
    //   Bar 1: Am    — bass A1, pad A3-C4-E4 held the whole bar
    //   Melody: bouncy square hook on quarter notes, descending across bar 0
    //           and resolving back up across bar 1.
    //
    // Both chords sit inside C major so any combination of the 16 mods
    // (which all stay in C) lays cleanly on top. Toggle the whole thing with
    // the SONG button in the header (sets isBaseSongOn).
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

    // ---------- CHARACTERS ----------
    // 16 standard mods + 6 Madballz. Each entry has:
    //   - body palette (color + highlight + shade); the head circle behind a
    //     mod sprite uses the same body color
    //   - headFrame: name of the frame inside the matching head spritesheet
    //     (sheet defaults to 'munki'; Madballz use sheet: 'madballs')
    //   - label: the two-word display name (uppercased by CSS in chip/slot UI)
    //   - play() scheduling its WebAudio events on a 0..15 step grid
    //
    // Render layers per character (bottom → top):
    //   body → head-shape circle (body color) → head sprite OR generic face →
    //   headphones overlay. All head layers share the same 100×100 viewBox so
    //   the headphones stay visually anchored regardless of which sprite (or
    //   the placeholder face) is showing underneath.
    //
    // Color groups (the 14 friends):
    //   green  (5): munki, nugget, tamil, troll, coconut
    //   orange (3): cocoa, banana, fire
    //   purple (5): black, drum, flute, star, cloud
    //   blue   (1): truck
    // Antagonists (also blue, but the bad guys): ice, moon
    // Madballz set (own sheet, only seen on the unlocked Madballz screen):
    //   mb-alien, mb-cry, mb-shroom, mb-brain, mb-wires, mb-rocky
    const CHARACTERS = {
        munki: {
            label: 'Reginald Cotswattle',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'green (1)',
            // Filtered saw lead — C major hook on the quarter notes.
            // C5 E5 G5 E5 (steps 0, 4, 8, 12). Stacks tunefully with FLUTE,
            // STAR and ICE, all of which stay in C major.
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

        nugget: {
            label: 'Bibsy McNibbles',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'green (2)',
            // Closed hi-hat — short, tight noise burst on the offbeat 8ths
            // (steps 2, 6, 10, 14). Pairs with TRUCK kick + DRUM snare for
            // a full standard kit feel.
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

        // BLACK was originally a horror trigger; in the new lore the only
        // antagonists are ICE and MOON, so BLACK is just a regular friend.
        // Body colour is the shared purple — head sprite is in the purple
        // group, so the body matches per the uniform-color rule.
        black: {
            label: 'Onyx Shimmygobs',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'purple (1)',
            // Shaker — chuffs on every 8th note. Quarter-note hits are a
            // touch louder than the off-beats so the groove still feels like
            // a steam rhythm rather than a flat tick.
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

        truck: {
            label: 'Hubert Hubcap',
            bodyColor: '#3a5a8a', bodyHi: '#5a7aaa', bodyShade: '#1a2a4a',
            headFrame: 'blue (1)',
            // Kick drum — four on the floor. Sine sweep from 150Hz → 45Hz
            // gives weight without muddying the bass voices (MOON/TROLL/BANANA).
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
                // Click transient gives the kick a definable attack
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

        cocoa: {
            label: 'Marzipan Featherbottom',
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
            headFrame: 'orange (1)',
            // Bird-style arpeggio in C major — C-E-G-C climb on the "and"
            // of beats 2 and 4, fills the space between the lead phrases.
            play(ctx, out, when, step) {
                if (step !== 5 && step !== 13) return;
                const notes = [659.25, 783.99, 987.77, 1318.51]; // E5 G5 B5 E6
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

        tamil: {
            label: 'Srivatsan Sivanesan',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'green (3)',
            // Tabla — "thom" (low) on syncopated beats, "tha" (high) on the
            // ands. Pitched into the C major root so it complements the bass
            // voices instead of clashing with them.
            play(ctx, out, when, step) {
                const lowSteps = [0, 6, 10];
                const highSteps = [3, 8, 13];
                if (lowSteps.includes(step)) {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(110, when); // ~A2 — neutral
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
                    o.frequency.setValueAtTime(880, when); // A5
                    o.frequency.exponentialRampToValueAtTime(523.25, when + 0.06);
                    g.gain.setValueAtTime(0.13, when);
                    g.gain.exponentialRampToValueAtTime(0.001, when + 0.08);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + 0.1);
                }
            }
        },

        troll: {
            label: 'Glamburt Underbridge',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'green (4)',
            // Detuned saw bass stab on beat 1 and beat 3 — moves between C2
            // and G2 to give the loop a I → V root motion under the leads.
            play(ctx, out, when, step) {
                if (step !== 0 && step !== 8) return;
                const root = step === 0 ? 65.41 : 98.00; // C2, G2
                const o1 = ctx.createOscillator();
                const o2 = ctx.createOscillator();
                const f = ctx.createBiquadFilter();
                const g = ctx.createGain();
                f.type = 'lowpass';
                f.frequency.setValueAtTime(800, when);
                f.frequency.exponentialRampToValueAtTime(300, when + 0.35);
                f.Q.value = 5;
                o1.type = 'sawtooth'; o1.frequency.value = root;
                o2.type = 'sawtooth'; o2.frequency.value = root * 1.005; // detune
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.18, when + 0.01);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.4);
                o1.connect(f); o2.connect(f);
                f.connect(g).connect(out);
                o1.start(when); o1.stop(when + 0.45);
                o2.start(when); o2.stop(when + 0.45);
            }
        },

        banana: {
            label: 'Flavio Splitsville',
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
            headFrame: 'orange (2)',
            // Bouncy sine bassline — C3 E3 G3 E3 walking through C major.
            // Sits in the middle bass register so it stays out of MOON's
            // sub-bass and TROLL's mid-bass lanes.
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

        coconut: {
            label: 'Plopplop Tropicalo',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
            headFrame: 'green (5)',
            // Open hi-hat — long, splashy noise on the backbeat (steps 4, 12).
            // Mixes well with NUGGET's closed hat for a varied groove.
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

        drum: {
            label: 'Snerrick Backbeatington',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'purple (2)',
            // Snare drum on the backbeat (steps 4, 12). Bandpassed noise +
            // pitched body — sits naturally with TRUCK kick and the hats.
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
            label: 'JerryBerry Jamband',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'purple (3)',
            // Flute line in C major — sits on the offbeats so it weaves
            // between MUNKI's quarter-note hook. G5 A5 G5 E5.
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
            label: 'Twinkle Tessellate',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'purple (4)',
            // Bell / glockenspiel arpeggio — C major triad in the high
            // register. Plays once per bar on beat 1, long ringing tail.
            play(ctx, out, when, step) {
                if (step !== 0) return;
                const notes = [1046.5, 1318.51, 1567.98]; // C6 E6 G6
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

        cloud: {
            label: 'Nimbus Dreamslippers',
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
            headFrame: 'purple (5)',
            // Pad — C major triad held across the whole bar (~2.4s) with a
            // soft attack and slow release. Provides the harmonic bed
            // everything else rides on top of.
            play(ctx, out, when, step) {
                if (step !== 0) return;
                const chord = [261.63, 329.63, 392.00]; // C4 E4 G4
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

        // MOON MUNKI — the second antagonist. He "dims the lights". Dropping
        // him on a slot trips horror mode automatically. See HORROR_TRIGGER_MODS.
        // Shares the uniform blue body palette with truck + ice; the dark
        // moon head sprite carries his identity.
        moon: {
            label: 'Moon Munki',
            bodyColor: '#3a5a8a', bodyHi: '#5a7aaa', bodyShade: '#1a2a4a',
            headFrame: 'blue (2)',
            // Sub-bass drone — C2 sustained for the full bar with a tiny
            // C3 octave on top for body. Pure foundation under the kit.
            play(ctx, out, when, step) {
                if (step !== 0) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                o.frequency.value = 65.41; // C2
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.32, when + 0.06);
                g.gain.linearRampToValueAtTime(0.26, when + 1.6);
                g.gain.exponentialRampToValueAtTime(0.001, when + 2.4);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 2.45);
                // Octave for harmonic warmth
                const o2 = ctx.createOscillator();
                const g2 = ctx.createGain();
                o2.type = 'sine';
                o2.frequency.value = 130.81; // C3
                g2.gain.setValueAtTime(0, when);
                g2.gain.linearRampToValueAtTime(0.06, when + 0.1);
                g2.gain.exponentialRampToValueAtTime(0.001, when + 2.4);
                o2.connect(g2).connect(out);
                o2.start(when); o2.stop(when + 2.45);
            }
        },

        fire: {
            label: 'Cinder Sparkletoot',
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
            headFrame: 'orange (3)',
            // Tambourine-style 16th tick on every "and" — fills the gaps
            // between the 8th-note shaker and gives the loop forward drive.
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

        // ICE MUNKI — one of the two antagonists in the lore. She "freezes
        // the song". Dropping her on a slot trips horror mode automatically.
        // See HORROR_TRIGGER_MODS. Body uses the shared blue palette so the
        // antagonists are color-uniform with the rest of the blue group; her
        // identity reads through the icy blue head sprite + the red chip
        // accent (.chip-bad), not the body color.
        ice: {
            label: 'Ice Munki',
            bodyColor: '#3a5a8a', bodyHi: '#5a7aaa', bodyShade: '#1a2a4a',
            headFrame: 'blue (3)',
            // Twinkle — high C major scale steps on the 16th-note ands.
            // Walks C6 D6 E6 G6 around the bar for a sparkly counter-line.
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

        // ===================== MADBALLZ MODZ ============================
        // A gnarlier, horror-leaning set of 6 mods that drop weird, distorted
        // textures over the top of the regular Munki band. Each one points at
        // a frame inside the madballs-heads spritesheet (sheet: 'madballs').
        // Sounds are intentionally rougher — wave-shapers, detune, chopper
        // LFOs — so the player can hear immediately when they've added one.
        // ================================================================

        'mb-alien': {
            label: 'Zorbax Beanbean', sheet: 'madballs', headFrame: 'mb-alien',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764',
            // Distorted sub-pluck — descending saw through a wave-shaper.
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

        'mb-cry': {
            label: 'Drippy Frowndorf', sheet: 'madballs', headFrame: 'mb-cry',
            bodyColor: '#a16207', bodyHi: '#d97706', bodyShade: '#451a03',
            // Wailing minor melody on the offbeats — sliding triangle whine.
            play(ctx, out, when, step) {
                const seq = { 4: 415.30, 12: 392.00 }; // G#4 → G4 (chromatic dip)
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

        'mb-shroom': {
            label: 'Sporeazo Toadcap', sheet: 'madballs', headFrame: 'mb-shroom',
            bodyColor: '#15803d', bodyHi: '#22c55e', bodyShade: '#052e16',
            // Bubbly water arpeggio — short sine plinks in random octaves.
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

        'mb-brain': {
            label: 'Cerebellio Wibbletons', sheet: 'madballs', headFrame: 'mb-brain',
            bodyColor: '#65a30d', bodyHi: '#84cc16', bodyShade: '#1a2e05',
            // Pulsing distorted bass — chopper LFO on the gain for a glitchy
            // brainwave feel. Plays on beat 1 and beat 3.
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
                o.frequency.value = 82.41; // E2
                g.gain.setValueAtTime(0.18, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.55);
                o.connect(dist).connect(g).connect(out);
                o.start(when); o.stop(when + 0.6);
                lfo.start(when); lfo.stop(when + 0.6);
            }
        },

        'mb-wires': {
            label: 'Volty Twistplug', sheet: 'madballs', headFrame: 'mb-wires',
            bodyColor: '#78350f', bodyHi: '#a16207', bodyShade: '#1c0701',
            // Electric buzz — high-frequency square chops on every 8th.
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

        'mb-rocky': {
            label: 'Rumblestone Cragglethorpe', sheet: 'madballs', headFrame: 'mb-rocky',
            bodyColor: '#57534e', bodyHi: '#78716c', bodyShade: '#1c1917',
            // Tribal stone-thud — pitched-down noise hit on the syncopated
            // beats, gives the loop a chunky, primitive backbone.
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

    // Tray orders for the two screens.
    //
    // STANDARD_ORDER (default screen): the 14 colored "friends" arranged by
    // body palette, then the two antagonists (Ice Munki + Moon Munki) at the
    // end. Madballz never appear here — they live in their own screen.
    //   green  (5): munki, nugget, tamil, troll, coconut
    //   orange (3): cocoa, banana, fire
    //   purple (5): black, drum, flute, star, cloud
    //   blue   (1): truck
    //   antagonists: ice, moon
    //
    // MADBALLZ_ORDER: only revealed after the kid has triggered horror mode
    // enough times to "find" the dark crew. Lore-wise the Madballz are friends
    // with Ice Munki and Moon Munki, so the antagonists travel here too.
    const STANDARD_ORDER = [
        'munki', 'nugget', 'tamil', 'troll', 'coconut',
        'cocoa', 'banana', 'fire',
        'black', 'drum', 'flute', 'star', 'cloud',
        'truck',
        'ice', 'moon'
    ];
    const MADBALLZ_ORDER = [
        'ice', 'moon',
        'mb-alien', 'mb-cry', 'mb-shroom',
        'mb-brain', 'mb-wires', 'mb-rocky'
    ];

    // ---------- HEAD SPRITESHEETS ----------
    // Two sheets feed character art:
    //   - munki:    16 round colored Munki heads (the standard mods)
    //   - madballs:  6 gnarly creature heads (the "Madballz Modz" set, more
    //                horror-leaning aesthetic). Mirrored from the JSON files
    //                in assets/sprites/ so we stay synchronous (no fetch).
    const SHEETS = {
        munki: {
            src: 'assets/sprites/munki-heads.png',
            sheetW: 1608,
            sheetH: 1604,
            frames: {
                'blue (1)':   { x: 2,    y: 2,    w: 389, h: 388 },
                'blue (2)':   { x: 400,  y: 2,    w: 400, h: 400 },
                'blue (3)':   { x: 802,  y: 2,    w: 402, h: 401 },
                'green (1)':  { x: 1206, y: 2,    w: 392, h: 392 },
                'green (2)':  { x: 2,    y: 405,  w: 396, h: 396 },
                'green (3)':  { x: 400,  y: 405,  w: 396, h: 396 },
                'green (4)':  { x: 802,  y: 405,  w: 401, h: 400 },
                'green (5)':  { x: 1206, y: 405,  w: 399, h: 399 },
                'orange (1)': { x: 2,    y: 807,  w: 392, h: 392 },
                'orange (2)': { x: 400,  y: 807,  w: 399, h: 399 },
                'orange (3)': { x: 802,  y: 807,  w: 393, h: 393 },
                'purple (1)': { x: 1206, y: 807,  w: 400, h: 399 },
                'purple (2)': { x: 2,    y: 1208, w: 394, h: 394 },
                'purple (3)': { x: 400,  y: 1208, w: 389, h: 389 },
                'purple (4)': { x: 802,  y: 1208, w: 394, h: 394 },
                'purple (5)': { x: 1206, y: 1208, w: 389, h: 389 }
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

    // ---------- ART (body + layered head) ----------
    // The head is composed of three sibling layers, all anchored to the same
    // 100×100 footprint so the headphones overlay always lands in the same
    // visual spot regardless of which face/sprite is showing:
    //
    //   1. .head-shape   — colored circle (matches body color)
    //   2. .head-face OR .head-mod — generic SVG eyes/mouth, OR custom head img
    //   3. .head-phones  — headphones drawn on top
    //
    // The custom head sprite is rendered as an SVG <image> with a viewBox that
    // crops to the relevant frame inside munki-heads.png, scaled with
    // preserveAspectRatio="xMidYMid meet" so it fills the head circle without
    // distortion. Drop in new mod heads by adding `headFrame: '<frame name>'`
    // to a CHARACTERS entry (and the matching frame to HEAD_SHEET).
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

    function headArt(c) {
        const inner = c.headFrame ? headModArt(c.headFrame, c.sheet) : headFaceArt();
        return headShapeArt(c) + inner + headPhonesArt();
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
        renderTray();
        attachTrayHandlers();
        updateTrayHint();
    }

    function updateTrayHint() {
        const hint = document.getElementById('trayHint');
        if (!hint) return;
        hint.textContent = isMadballzMode
            ? 'MADBALLZ MODE · 6 Madballz + Ice Munki + Moon Munki · they are friends'
            : 'Drag a friend onto a slot · 14 friends + 2 bad munkis · ICE or MOON = horror';
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

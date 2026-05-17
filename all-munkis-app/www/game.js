
(() => {
    'use strict';

    // ---------- CONFIG ----------
    const TEMPO = 100;                       // BPM
    const STEPS_PER_BAR = 16;                // sixteenth notes
    const SECONDS_PER_STEP = 60 / TEMPO / 4; // 0.15s
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.1;
    const NUM_SLOTS = 6;
    const BARS_PER_LOOP = 4;                 // I-vi-IV-V progression (Cmaj, Am, Fmaj, G)
    const MADBALLZ_UNLOCK_THRESHOLD = 3;
    // Feature flag: Madballz mode is dormant in the 8-Munki redesign — code,
    // sprites, audio profiles, and the mode toggle are all preserved, but the
    // reveal button never appears. Flip to true to bring the bonus screen back.
    const MADBALLZ_ENABLED = false;
    const STORAGE_KEY = 'all-munkis-progress-v1';

    // ---------- FLYING CREEP CONFIG (all tunable, all in one place) ----
    // A Flying Creep is an ambient threat: ONE drifts across the stage on
    // a timer, scares nearby Munkis, and — if it scares enough of them —
    // trips the same 12s slow-creep horror visual that an Ice/Moon drop
    // does. The kid can't touch it (v1 is hands-off). Each appearance
    // randomly picks one of VARIANT_COUNT visually-distinct creep designs
    // from the sprite sheet (mechanically identical). Only one is ever on
    // screen at a time. Tweak the numbers here; nothing else hard-codes.
    const CREEP = {
        ENABLED:            true,
        // How many distinct creep designs the sheet is expected to hold.
        // The actual count comes from the loaded sheet's frame list at
        // runtime; this is the design target + the "All Creeps
        // Encountered" achievement goal when no sheet is present yet.
        VARIANT_COUNT:      6,
        // Spawn timing — a fresh appearance is scheduled this many ms
        // after the previous one ends (uniform random in [MIN, MAX]).
        // AGGRO TUNING: comes sooner, far more often, scares from a
        // wider radius, ramps fear fast so horror trips readily.
        SPAWN_MIN_MS:       12000,
        SPAWN_MAX_MS:       40000,
        FIRST_SPAWN_MIN_MS: 7000,    // grace before the very first one
        FIRST_SPAWN_MAX_MS: 16000,
        // STAY_* are now UNUSED — the Creep persists until it drifts
        // fully off-screen (see creepTick); kept for reference only.
        STAY_MIN_MS:        10000,
        STAY_MAX_MS:        15000,
        // Drift motion.
        SPEED_MIN_PXPS:     34,      // horizontal/vertical px per second
        SPEED_MAX_PXPS:     58,
        WAVE_AMP_PX:        62,      // sine-wave excursion amplitude
        WAVE_PERIOD_MS:     2200,    // sine-wave period
        SIZE_PX:            128,     // rendered creep box (square)
        // Proximity (CSS px, creep-center to Munki-center). Hysteresis:
        // scares while CLOSE, only decays once clearly FAR — the gap
        // between the two stops fear flickering at the boundary.
        CLOSE_PX:           104,
        FAR_PX:             150,
        // Fear per Munki: 0..100. Gains while close, decays while far.
        FEAR_MAX:           100,
        FEAR_GAIN_PER_S:    9,
        FEAR_DECAY_PER_S:   1,
        // Sum of all on-stage Munki fear that trips horror, and the
        // lower level it must fall back below before horror releases
        // (hysteresis so it doesn't strobe at the threshold).
        HORROR_TRIGGER_SUM: 105,
        HORROR_RELEASE_SUM: 45,
        // z-index: above the stage BG + Munkis, below the tray/controls.
        Z_INDEX:            42
    };

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
    // Tone.js layer — built once on first user interaction (inside ensureAudio).
    // Adds a reverb/delay-driven pad, a sparkly FM bell, and a subtle hi-hat
    // groove on top of the raw-WebAudio BASE_SONG. The 24 character voices
    // continue to use raw WebAudio underneath. See buildToneLayer + TONE_LAYER.
    let toneReady = false;
    let toneBus = null;       // shared reverb/delay sink for melodic Tone voices
    let tonePad = null;       // PolySynth — sustained chord per bar
    let toneBell = null;      // FMSynth — section-transition sparkle
    let toneHat = null;       // MetalSynth — off-beat hi-hat tick
    let toneDrone = null;     // Oscillator — low rumble that swells during react mode
    let toneDroneGain = null; // Drone's gain envelope (ramps on react in/out)
    let anyWasReacting = false; // edge-detect react mode transitions for the drone
    // Horror mode (body.react-mode-active) has TWO independent sources that
    // are OR'd together by syncHorrorMode():
    //   beatReacting    — Ice/Moon adjacency dwell (set by tickReactState)
    //   fearHorrorActive — a Flying Creep scared the Munkis enough (set by
    //                      the Flying Creep system). Either alone lights the
    //                      12s slow-creep corner-sprite visual.
    let beatReacting = false;
    let fearHorrorActive = false;
    // True whenever horror mode (body.react-mode-active) is on, from
    // EITHER source. While on, every on-stage non-evil Munki cycles its
    // head 1→5 (staggered per slot), not just the Ice/Moon-adjacent one.
    let horrorActive = false;
    let horrorStartBeat = 0;

    let horrorTriggers = 0;
    let activeBankIndex = 0;
    let madballzUnlocked = false;
    let isMadballzMode = false;

    // ---------- DUAL BAND MODE (v1.1) ----------
    // A toggled mode: the 6-slot stage splits into two rows of 3 — Row A
    // (slots 0-2) and Row B (slots 3-5) — each a fully independent band
    // with its OWN Bala's Song + oscillators + loop clock (wired in
    // chunk B). bandOn[0]/[0] gate each row's WHOLE band via a big
    // footswitch; the player times the two switches to compose the
    // layering. Single-row default + v1.0 audio path are untouched.
    let isDualBandMode = false;
    let bandOn = [false, false]; // Row A, Row B — both start OFF on entry
    function bandFootEl(i) {
        return document.getElementById(i === 0 ? 'bandFootA' : 'bandFootB');
    }
    function setBandOn(i, on) {
        bandOn[i] = on;
        const el = bandFootEl(i);
        if (el) {
            el.setAttribute('aria-pressed', String(on));
            el.classList.toggle('lit', on);
            const st = el.querySelector('.band-foot-state');
            if (st) st.textContent = on ? 'ON' : 'OFF';
        }
        // (Chunk B reads bandOn[i] to gate that row's rowGain.)
    }
    function setDualBandMode(on) {
        isDualBandMode = on;
        document.body.classList.toggle('dual-band-mode', on);
        const btn = document.getElementById('dualBandBtn');
        if (btn) {
            btn.setAttribute('aria-pressed', String(on));
            btn.classList.toggle('on', on);
        }
        const foot = document.getElementById('bandFootswitches');
        if (foot) { foot.hidden = !on; foot.setAttribute('aria-hidden', String(!on)); }
        // Entering or leaving always resets both bands to OFF so the
        // player starts the layering from silence and times it in.
        setBandOn(0, false);
        setBandOn(1, false);
    }

    // ---------- ACHIEVEMENTS ----------
    // Hidden discoveries scattered across the page. Each grants moon points;
    // when total points hits MOON_UNLOCK_THRESHOLD, Moon Munki unlocks. The
    // 5 originals are kept at 1pt each so existing save data unlocks Moon
    // at the same time it always did. The 8 new ones give the redesign
    // more discovery surface without grinding.
    //
    // Detector wiring lives in attachEggDetectors() (originals) plus
    // checkAchievementsAfterSlot / cycle / etc. for the new ones.
    const ACHIEVEMENTS = [
        // ----- Original 5 hidden interactions -----
        { id: 'titleClick',    name: 'Title Tapper',       points: 1 },
        { id: 'corners',       name: 'Corner Crawler',     points: 1 },
        { id: 'rainbowOrder',  name: 'Rainbow Order',      points: 1 },
        { id: 'chipSpam',      name: 'Bank Stalker',       points: 1 },
        { id: 'stageTriple',   name: 'Stage Whisperer',    points: 1 },
        // ----- New 8 -----
        { id: 'solidSquad',    name: 'Solid Squad',        points: 1 },
        { id: 'solidSequence', name: 'Solid Sequence',     points: 2 },
        { id: 'patternMaker',  name: 'Pattern Maker',      points: 2 },
        { id: 'band3',         name: '3 Bands',            points: 1 },
        { id: 'band10',        name: '10 Bands',           points: 2 },
        { id: 'band20',        name: '20 Bands',           points: 3 },
        { id: 'coldSnap',      name: 'Cold Snap',          points: 1 },
        { id: 'touchOutsider', name: 'Touch the Outsider', points: 3 },
        // ----- Flying Creeps feature -----
        { id: 'creepWhisperer', name: 'Creep Whisperer',     points: 2 },
        { id: 'allCreeps',      name: 'All Creeps Encountered', points: 3 }
    ];
    const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
    // The first 5 ids — kept around so existing detector code that refers
    // to EGG_IDS keeps working. New achievements use grantAchievement(id)
    // directly without going through this list.
    const EGG_IDS = ['titleClick', 'corners', 'rainbowOrder', 'chipSpam', 'stageTriple'];
    const MOON_UNLOCK_THRESHOLD = 5;
    // achievements: Map<id, { unlocked_at, points_awarded }>
    const achievements = new Map();
    // Lifetime band counter — increments every time the stage transitions
    // from <6 placements to =6. Persisted. Drives the 3/10/20 Bands tier.
    let bandCount = 0;
    let moonUnlocked = false;

    function totalAchievementPoints() {
        let n = 0;
        achievements.forEach(meta => { n += (meta.points_awarded | 0); });
        return n;
    }

    // Which evil rides the 7th-wheel slot in the bank. Pre-Moon-unlock this
    // is always 'ice'. Post-unlock the kid can drag-swap (see the altar
    // logic in renderMunkiAltar). Persisted across sessions.
    let seventhWheel = 'ice';
    function altWheel() { return seventhWheel === 'ice' ? 'moon' : 'ice'; }

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
            buildToneLayer(); // no-op if Tone.js isn't loaded
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

    // Binds Tone.js to our existing audioCtx so its scheduler shares the
    // same clock as the raw-WebAudio scheduler, then builds three ambient
    // instruments (pad / bell / hat) that TONE_LAYER drives every bar.
    // Silently bails if Tone.js failed to load — the raw-WebAudio BASE_SONG
    // is the source of truth and the game stays playable without it.
    function buildToneLayer() {
        if (typeof Tone === 'undefined' || toneReady) return;
        try {
            // Tone.setContext accepts a raw AudioContext in v14+. The new
            // Tone.Context wrapper picks up our existing destination so
            // every Tone.connect(node, masterGain) below routes correctly.
            Tone.setContext(audioCtx);
        } catch (e) {
            try { Tone.setContext(new Tone.Context({ context: audioCtx })); }
            catch (e2) { return; }
        }
        // Effects bus: PolySynth pad + FM bell go through reverb + delay so
        // the ambient layer sits "behind" the chiptune voices in the mix.
        const reverb = new Tone.Reverb({ decay: 3.4, preDelay: 0.04, wet: 0.35 });
        const delay  = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.22, wet: 0.22 });
        const busOut = new Tone.Gain(0.55);
        reverb.connect(delay);
        delay.connect(busOut);
        Tone.connect(busOut, masterGain);
        toneBus = reverb;

        // PolySynth pad — fat, slow sine cluster that sustains the bar's
        // chord. Quiet enough to sit under the leads without muddying.
        tonePad = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'fatsine', count: 3, spread: 22 },
            envelope: { attack: 0.45, decay: 0.35, sustain: 0.65, release: 1.4 },
            volume: -22
        });
        tonePad.connect(toneBus);

        // FMSynth bell — sparkles on section-change bars for ear candy.
        toneBell = new Tone.FMSynth({
            harmonicity: 2,
            modulationIndex: 11,
            envelope:           { attack: 0.002, decay: 0.5, sustain: 0, release: 0.7 },
            modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.7 },
            volume: -16
        });
        toneBell.connect(toneBus);

        // MetalSynth hi-hat — direct to masterGain (no reverb wash) so the
        // off-beat tick stays tight against the kid's drum-mods.
        toneHat = new Tone.MetalSynth({
            envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
            harmonicity: 5.1, modulationIndex: 32, resonance: 4200, octaves: 1.5,
            volume: -32
        });
        Tone.connect(toneHat, masterGain);

        // Sub-bass drone for react mode. A pair of slightly detuned low
        // sawtooths through a heavy lowpass — when any Munki tips into
        // react mode, the drone swells up over ~4 s and just sits there
        // ominously until react ends. It's silent the rest of the time
        // (start gain at zero, ramp on transitions in tickReactState).
        const droneOsc1 = new Tone.Oscillator({ frequency: 55, type: 'sawtooth' });
        const droneOsc2 = new Tone.Oscillator({ frequency: 55.5, type: 'sawtooth' });
        const droneFilter = new Tone.Filter({ type: 'lowpass', frequency: 240, Q: 4 });
        const droneShape = new Tone.Distortion(0.35);
        toneDroneGain = new Tone.Gain(0);
        droneOsc1.connect(droneFilter);
        droneOsc2.connect(droneFilter);
        droneFilter.connect(droneShape);
        droneShape.connect(toneDroneGain);
        Tone.connect(toneDroneGain, masterGain);
        droneOsc1.start();
        droneOsc2.start();
        toneDrone = { osc1: droneOsc1, osc2: droneOsc2, filter: droneFilter };

        toneReady = true;
    }

    // Ramp the sub-bass drone up or down depending on whether react mode
    // is active. Long 4-s envelope so the menace sneaks in rather than
    // popping. Called from tickReactState only on a transition.
    function setReactDrone(on) {
        if (!toneReady || !toneDroneGain) return;
        const now = Tone.now();
        toneDroneGain.gain.cancelScheduledValues(now);
        toneDroneGain.gain.setValueAtTime(toneDroneGain.gain.value, now);
        toneDroneGain.gain.linearRampToValueAtTime(on ? 0.32 : 0, now + 4);
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
        if (isBaseSongOn) {
            BASE_SONG.play(audioCtx, masterGain, when, step, bar);
            TONE_LAYER.play(step, bar, when); // ambient pad + bell + hat
        }
        // User-placed mods
        for (let i = 0; i < NUM_SLOTS; i++) {
            const id = slots[i];
            if (!id) continue;
            const ch = CHARACTERS[id];
            if (ch && ch.play) ch.play(audioCtx, masterGain, when, step);
        }
        if (step % 4 === 0) {
            const delayMs = Math.max(0, (when - audioCtx.currentTime) * 1000);
            setTimeout(() => { pulseActiveIcons(); tickReactState(); }, delayMs);
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
    // ---------- BASE SONG ----------
    // Bala's Theme — a 4-bar I-vi-IV-V loop (Cmaj → Am → Fmaj → G), the
    // classic singable kid-pop progression. Each bar fires:
    //   - one sustained triangle bass (the chord root, an octave low)
    //   - a triangle triad pad ringing across the bar
    //   - a square-wave melody hook on quarter notes (steps 0/4/8/12)
    // The TONE_LAYER block below adds a thicker reverb-y pad + a bell + an
    // off-beat hat on top — Tone.js sits on the same audioCtx so the two
    // layers stay phase-locked.
    const BASE_SONG = {
        chordsByBar: [
            // bass = chord root in the low octave; triad = three voices
            // a fourth/fifth above it for the sustained pad.
            { bass: 65.41, triad: [261.63, 329.63, 392.00], melody: { 0: 783.99, 4: 659.25, 8: 523.25, 12: 659.25 } }, // Cmaj  (G E C E)
            { bass: 55.00, triad: [220.00, 261.63, 329.63], melody: { 0: 440.00, 4: 523.25, 8: 659.25, 12: 392.00 } }, // Am    (A C E G)
            { bass: 87.31, triad: [174.61, 220.00, 261.63], melody: { 0: 440.00, 4: 349.23, 8: 440.00, 12: 523.25 } }, // Fmaj  (A F A C)
            { bass: 98.00, triad: [196.00, 246.94, 293.66], melody: { 0: 493.88, 4: 392.00, 8: 493.88, 12: 587.33 } }  // G     (B G B D)
        ],
        play(ctx, out, when, step, bar) {
            const cb = this.chordsByBar[bar];
            if (!cb) return;
            const BAR_LEN = SECONDS_PER_STEP * STEPS_PER_BAR; // 2.4 s

            // Sustained bass + pad fire once at the top of each bar and ring
            // out across the full bar length.
            if (step === 0) {
                const b = ctx.createOscillator();
                const bg = ctx.createGain();
                b.type = 'triangle';
                b.frequency.value = cb.bass;
                bg.gain.setValueAtTime(0, when);
                bg.gain.linearRampToValueAtTime(0.16, when + 0.07);
                bg.gain.linearRampToValueAtTime(0.13, when + BAR_LEN * 0.7);
                bg.gain.exponentialRampToValueAtTime(0.001, when + BAR_LEN);
                b.connect(bg).connect(out);
                b.start(when); b.stop(when + BAR_LEN + 0.05);

                cb.triad.forEach((freq, i) => {
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

            // Melody hook on quarter notes — square-wave through a soft lowpass.
            const freq = cb.melody[step];
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

    // ---------- TONE LAYER ----------
    // Tone.js-driven ambient instruments triggered alongside BASE_SONG. Same
    // 4-bar progression in chord-name form so Tone can do its own scheduling.
    // No-op when buildToneLayer failed (no Tone.js, or browser blocks AC).
    const TONE_LAYER = {
        chordsByBar: [
            ['C4', 'E4', 'G4'],   // Cmaj
            ['A3', 'C4', 'E4'],   // Am
            ['F3', 'A3', 'C4'],   // Fmaj
            ['G3', 'B3', 'D4']    // G
        ],
        play(step, bar, when) {
            if (!toneReady) return;
            const BAR_LEN = SECONDS_PER_STEP * STEPS_PER_BAR;
            // Sustained PolySynth pad — sits behind the triangle pad, adds
            // body and reverb wash.
            if (step === 0) {
                const chord = this.chordsByBar[bar];
                if (chord) tonePad.triggerAttackRelease(chord, BAR_LEN * 0.92, when);
            }
            // Hi-hat tick on the off-eighth (steps 2/10). Very quiet — just
            // a glassy sparkle to give the groove some forward motion when
            // the kid hasn't placed any drum mods.
            if (step === 2 || step === 10) {
                toneHat.triggerAttackRelease('C5', '32n', when);
            }
            // Bell sparkle marking the section turns: top of bar 2 (the
            // "lift" into the IV chord) and the last beat of bar 3 (the
            // turnaround back into Cmaj).
            if (bar === 2 && step === 0) {
                toneBell.triggerAttackRelease('C6', '2n', when + 0.04);
            }
            if (bar === 3 && step === 12) {
                toneBell.triggerAttackRelease('E6', '4n', when);
            }
        }
    };
    // 8-Munki roster (post-redesign):
    //   6 rainbow Munkis named for their color (red/orange/yellow/green/blue/purple)
    //   Ice Munki (white sprite Z, freeze power) — default 7th in bank
    //   Moon Munki (black sprite X, chaos power) — unlockable via Easter eggs;
    //     swappable into the 7th bank slot in place of Ice.
    // 8 Madballz mod entries are kept dormant (no button reveal) per design
    // intent so the code/voices stay archived in-place rather than deleted.
    const CHARACTERS = {
        red: {
            label: 'Red',
            // Audio profile: saw bass stab (was "grumble"). Body color #dc2626
            // → sprite letter R via COLOR_BY_BODY.
            bodyColor: '#dc2626', bodyHi: '#fca5a5', bodyShade: '#7f1d1d',
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

        orange: {
            label: 'Orange',
            // Audio profile: snare drum (was "snare"). Body color #ff9800 → O.
            bodyColor: '#ff9800', bodyHi: '#ffb74d', bodyShade: '#bf360c',
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

        yellow: {
            label: 'Yellow',
            // Audio profile: bell triad on bar start (was "star"). Body #fbbf24 → Y.
            bodyColor: '#fbbf24', bodyHi: '#fde68a', bodyShade: '#92400e',
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

        green: {
            label: 'Green',
            bodyColor: '#43a047', bodyHi: '#81c784', bodyShade: '#1b5e20',
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

        blue: {
            label: 'Blue',
            // Audio profile: sub-bass + triangle blip (was "srivi"). Body #1e88e5 → B.
            bodyColor: '#1e88e5', bodyHi: '#90caf9', bodyShade: '#0d47a1',
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

        purple: {
            label: 'Purple',
            // Audio profile: vibrato triangle melody (was "flute"/"Vibe"). Body #9c27b0 → P.
            bodyColor: '#9c27b0', bodyHi: '#ce93d8', bodyShade: '#4a148c',
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

        moon: {
            label: 'Moon',
            bodyColor: '#1f2937', bodyHi: '#4b5563', bodyShade: '#000000',
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

        ice: {
            label: 'Ice',
            bodyColor: '#f8fafc', bodyHi: '#ffffff', bodyShade: '#94a3b8',
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

        // ===== MADBALLZ MODZ (sheet: 'mb' → assets/sprites/mb-heads.png) =====
        // 8 sprites, body color matches each head's background color so the
        // bank reads as a tidy color rainbow on the Madballz page.
        // PURPLE: mb-skull, mb-zombie, mb-grump
        // ORANGE: mb-sad, mb-snooze, mb-scared
        // GREEN:  mb-cool
        // TEAL:   mb-eye
        'mb-skull': {
            label: 'Skull', sheet: 'mb', headFrame: 'mb-skull',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764',
            // Bone-rumble: sub thud filtered low — fits the skull vibe.
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
        },

        'mb-zombie': {
            label: 'Zombi', sheet: 'mb', headFrame: 'mb-zombie',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764',
            // Distorted alien-pluck — sawtooth through a wave shaper, sweeps
            // pitch + filter for that "zorbie zombie" stagger.
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

        'mb-grump': {
            label: 'Grump', sheet: 'mb', headFrame: 'mb-grump',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764',
            // Chopper-LFO bass — angry pulsing low end.
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

        'mb-sad': {
            label: 'Sad', sheet: 'mb', headFrame: 'mb-sad',
            bodyColor: '#a16207', bodyHi: '#d97706', bodyShade: '#451a03',
            // Triangle wave drip — descending pitch fits a teardrop falling.
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

        'mb-snooze': {
            label: 'Snooze', sheet: 'mb', headFrame: 'mb-snooze',
            bodyColor: '#a16207', bodyHi: '#d97706', bodyShade: '#451a03',
            // Long yawn pad — sine with light vibrato, fades up then sleeps
            // back down across most of the bar.
            play(ctx, out, when, step) {
                if (step !== 0) return;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const lfo = ctx.createOscillator();
                const lfoG = ctx.createGain();
                lfo.frequency.value = 3.5;
                lfoG.gain.value = 4;
                lfo.connect(lfoG).connect(o.frequency);
                o.type = 'sine';
                o.frequency.value = 196.00; // G3
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.07, when + 0.6);
                g.gain.linearRampToValueAtTime(0.05, when + 1.6);
                g.gain.exponentialRampToValueAtTime(0.001, when + 2.2);
                o.connect(g).connect(out);
                o.start(when); o.stop(when + 2.25);
                lfo.start(when); lfo.stop(when + 2.25);
            }
        },

        'mb-scared': {
            label: 'Shiver', sheet: 'mb', headFrame: 'mb-scared',
            bodyColor: '#a16207', bodyHi: '#d97706', bodyShade: '#451a03',
            // Shaky percussion — high-pass noise burst + a quick triangle
            // pitch-drop tap, fires on the off-beat.
            play(ctx, out, when, step) {
                if (step % 4 !== 3) return;
                const n = noiseSource(ctx, 0.06);
                const f = ctx.createBiquadFilter();
                f.type = 'highpass';
                f.frequency.value = 3500;
                const ng = ctx.createGain();
                ng.gain.setValueAtTime(0.10, when);
                ng.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
                n.connect(f).connect(ng).connect(out);
                n.start(when); n.stop(when + 0.08);
                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = 'triangle';
                o.frequency.setValueAtTime(440, when);
                o.frequency.exponentialRampToValueAtTime(220, when + 0.05);
                og.gain.setValueAtTime(0.07, when);
                og.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
                o.connect(og).connect(out);
                o.start(when); o.stop(when + 0.07);
            }
        },

        'mb-cool': {
            label: 'Cool', sheet: 'mb', headFrame: 'mb-cool',
            bodyColor: '#15803d', bodyHi: '#22c55e', bodyShade: '#052e16',
            // Random sine notes — picks an octave for that "shades say
            // whatever" cool randomness.
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

        'mb-eye': {
            label: 'Eye', sheet: 'mb', headFrame: 'mb-eye',
            bodyColor: '#0e7490', bodyHi: '#22d3ee', bodyShade: '#083344',
            // Square wave electric blip — rising pitch, hi-pass filtered for
            // a sharp electric snap.
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
        }
    };

    // Single bank of 7 chips: the 6 rainbow Munkis + the current 7th-wheel
    // antagonist (Ice by default; swaps to Moon once the kid unlocks Moon
    // via the hidden-Easter-egg system — see chunk 3+ work). Moon stays out
    // of BANKS entirely until unlocked so it doesn't appear in the tray.
    const BANKS = [
        { id: 'bank-1', label: 'BANK 1', munkis: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'ice'], unlocked: true }
    ];

    // Madballz mode tray order — kept for the dormant Madballz screen (the
    // reveal button is gated off, but the data + audio profiles stay in
    // place so the work isn't lost).
    const MADBALLZ_ORDER = [
        'mb-skull', 'mb-zombie', 'mb-grump',
        'mb-sad',   'mb-snooze', 'mb-scared',
        'mb-cool',
        'mb-eye',
        'ice', 'moon'
    ];

    function currentOrder() {
        if (isMadballzMode) return MADBALLZ_ORDER;
        return BANKS[activeBankIndex].munkis;
    }

    // Cycle to the next/previous unlocked bank, save, and re-render. No-op
    // if there's only one unlocked bank.
    function nudgeBank(direction) {
        if (isMadballzMode) return;
        const total = BANKS.length;
        let i = activeBankIndex;
        for (let step = 0; step < total; step++) {
            i = (i + direction + total) % total;
            if (BANKS[i].unlocked) break;
        }
        if (i === activeBankIndex || !BANKS[i].unlocked) return;
        activeBankIndex = i;
        saveProgress();
        updateBankLabel();
        renderTray();
        attachTrayHandlers();
    }

    function updateBankLabel() {
        const lbl = document.getElementById('bankLabel');
        const prev = document.getElementById('bankPrev');
        const next = document.getElementById('bankNext');
        if (lbl) lbl.textContent = BANKS[activeBankIndex].label;
        const unlockedCount = BANKS.filter(b => b.unlocked).length;
        if (prev) prev.disabled = unlockedCount < 2 || isMadballzMode;
        if (next) next.disabled = unlockedCount < 2 || isMadballzMode;
        // With only one bank, hide the whole switcher so the kid doesn't see
        // a useless "BANK 1" label with dead arrows.
        const switcher = document.querySelector('.bank-switcher');
        if (switcher) switcher.hidden = unlockedCount < 2 || isMadballzMode;
    }

    const SHEETS = {
        munki: {
            src: 'assets/sprites/default-heads.png',
            sheetW: 1602,
            sheetH: 1002,
            // 40 frames = 5 expression rows × 8 color columns.
            // Frame names are `{expression}-{color}` where expression ∈ 1..5
            // (1 silly/default → 2 shocked → 3 sad → 4 smug → 5 angry) and
            // color ∈ {B,G,O,P,R,Y} for regular Munkis, plus X (black) and
            // Z (white) which both glitch to grey — reserved for the two
            // antagonists (Moon Munki = X, Ice Munki = Z).
            // Expression is chosen dynamically per slot by expressionForSlot;
            // see headArt for how the frame name is composed at render time.
            frames: {
                '1-B': { x:    2, y:   2, w: 198, h: 198 }, '1-G': { x:  202, y:   2, w: 198, h: 198 },
                '1-O': { x:  402, y:   2, w: 198, h: 198 }, '1-P': { x:  602, y:   2, w: 198, h: 198 },
                '1-R': { x:  802, y:   2, w: 198, h: 198 }, '1-X': { x: 1002, y:   2, w: 198, h: 198 },
                '1-Y': { x: 1202, y:   2, w: 198, h: 198 }, '1-Z': { x: 1402, y:   2, w: 198, h: 198 },
                '2-B': { x:    2, y: 202, w: 198, h: 198 }, '2-G': { x:  202, y: 202, w: 198, h: 198 },
                '2-O': { x:  402, y: 202, w: 198, h: 198 }, '2-P': { x:  602, y: 202, w: 198, h: 198 },
                '2-R': { x:  802, y: 202, w: 198, h: 198 }, '2-X': { x: 1002, y: 202, w: 198, h: 198 },
                '2-Y': { x: 1202, y: 202, w: 198, h: 198 }, '2-Z': { x: 1402, y: 202, w: 198, h: 198 },
                '3-B': { x:    2, y: 402, w: 198, h: 198 }, '3-G': { x:  202, y: 402, w: 198, h: 198 },
                '3-O': { x:  402, y: 402, w: 198, h: 198 }, '3-P': { x:  602, y: 402, w: 198, h: 198 },
                '3-R': { x:  802, y: 402, w: 198, h: 198 }, '3-X': { x: 1002, y: 402, w: 198, h: 198 },
                '3-Y': { x: 1202, y: 402, w: 198, h: 198 }, '3-Z': { x: 1402, y: 402, w: 198, h: 198 },
                '4-B': { x:    2, y: 602, w: 198, h: 198 }, '4-G': { x:  202, y: 602, w: 198, h: 198 },
                '4-O': { x:  402, y: 602, w: 198, h: 198 }, '4-P': { x:  602, y: 602, w: 198, h: 198 },
                '4-R': { x:  802, y: 602, w: 198, h: 198 }, '4-X': { x: 1002, y: 602, w: 198, h: 198 },
                '4-Y': { x: 1202, y: 602, w: 198, h: 198 }, '4-Z': { x: 1402, y: 602, w: 198, h: 198 },
                '5-B': { x:    2, y: 802, w: 198, h: 198 }, '5-G': { x:  202, y: 802, w: 198, h: 198 },
                '5-O': { x:  402, y: 802, w: 198, h: 198 }, '5-P': { x:  602, y: 802, w: 198, h: 198 },
                '5-R': { x:  802, y: 802, w: 198, h: 198 }, '5-X': { x: 1002, y: 802, w: 198, h: 198 },
                '5-Y': { x: 1202, y: 802, w: 198, h: 198 }, '5-Z': { x: 1402, y: 802, w: 198, h: 198 }
            }
        },
        mb: {
            src: 'assets/sprites/mb-heads.png',
            sheetW: 4330,
            sheetH: 2191,
            // Frame names match each Madballz Mod's id 1:1. Body color
            // tracks the head-circle background color the same way the
            // Munki sheet does. PURPLE / ORANGE / GREEN / TEAL.
            frames: {
                'mb-skull':  { x: 2,    y: 2,    w: 1080, h: 1085 }, // PURPLE
                'mb-sad':    { x: 1084, y: 2,    w: 1080, h: 1050 }, // ORANGE
                'mb-zombie': { x: 2166, y: 2,    w: 1080, h: 1088 }, // PURPLE
                'mb-snooze': { x: 3248, y: 2,    w: 1080, h: 1094 }, // ORANGE
                'mb-scared': { x: 2,    y: 1098, w: 1080, h: 1088 }, // ORANGE
                'mb-cool':   { x: 1084, y: 1098, w: 1080, h: 1077 }, // GREEN
                'mb-grump':  { x: 2166, y: 1098, w: 1080, h: 1090 }, // PURPLE
                'mb-eye':    { x: 3248, y: 1098, w: 1080, h: 1091 }  // TEAL
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

    // Maps a Munki's bodyColor hex to its single-letter color code in
    // default-heads.png. Used by headArt to compose the dynamic frame name
    // `${expression}-${color}`. X = black-glitch (Moon), Z = white-glitch
    // (Ice). The other 6 letters are regular crew colors.
    const COLOR_BY_BODY = {
        '#1f2937': 'X',  '#1e88e5': 'B',  '#43a047': 'G',  '#ff9800': 'O',
        '#9c27b0': 'P',  '#dc2626': 'R',  '#f8fafc': 'Z',  '#fbbf24': 'Y'
    };

    // Flat colored circle that sits behind the head sprite. The sprite is a
    // complete head (circle + face), so this backdrop only shows through any
    // transparent edges of the PNG — a safety net, not the primary visual.
    function headShapeArt(c) {
        return `<svg class="head-shape" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
            + `<circle cx="50" cy="50" r="44" fill="${c.bodyColor}" stroke="${c.bodyShade}" stroke-width="3"/>`
            + `</svg>`;
    }

    // Head sprite cropped from one of the spritesheets. The SVG viewBox crops
    // to the named frame's pixel coords; the inner <image> shows the full
    // sheet — preserveAspectRatio scales the cropped frame into .head-mod
    // (which fills the head circle area). 'munki' is the dynamic default-heads
    // sheet (`{expr}-{color}` frames); 'mb' is the static Madballz sheet.
    // 1px crop inset on every frame. The sheets pack frames on a 200px
    // (munki) / 1082px (mb) pitch with only a 2px transparent gutter
    // between them. When the browser scales the full sheet and clips via
    // viewBox, bilinear sampling at the viewBox EDGE pulls in fractions
    // of the neighbouring frame ("tiny bits of neighbouring heads"). The
    // head sheet only has a 2px gutter between 198px frames; at the
    // display downscale a 1px inset still left a sliver of the neighbour
    // bleeding in. 3px clears the sampling window with margin and is
    // invisible — the head art has transparent padding inside the frame.
    const FRAME_BLEED_INSET = 3;
    // Flying Creeps need a MUCH larger inset than the head sheets. The
    // creep sheet is 3248×1738 with 1082×869 frames packed on a 1px
    // horizontal gutter and a ZERO-px vertical gutter (row 0 ends at
    // y=869, row 1 starts at y=869 — touching). paintCreepVariant scales
    // a frame down to CREEP.SIZE_PX (128) via CSS background-size — a
    // ~8.4× downscale — so a 1px source inset becomes ~0.12 *display*
    // px, far below the ~4px bilinear sampling reach of that downscale,
    // and the neighbouring creep bleeds in at the touching edge. 8 source
    // px (~0.7% per side, invisible on the centred creature art) clears
    // the sampling window with margin. Heads use SVG viewBox cropping on
    // a smaller, lightly-scaled sheet, so 1px stays correct for them —
    // do NOT raise FRAME_BLEED_INSET to "fix" creeps.
    const CREEP_BLEED_INSET = 8;
    function headModArt(frameName, sheetName) {
        const sheet = SHEETS[sheetName || 'munki'];
        const f = sheet && sheet.frames[frameName];
        if (!f) return '';
        const b = FRAME_BLEED_INSET;
        const vx = f.x + b, vy = f.y + b, vw = f.w - 2 * b, vh = f.h - 2 * b;
        return `<svg class="head-mod" viewBox="${vx} ${vy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`
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
        // (moon, ice) skip — bald horror reads better than wig horror. The
        // Madballz mods (sheet: 'mb') also skip since their head sprites are
        // already styled. Iterates every defined character so renames and
        // dormant entries are both covered.
        Object.keys(CHARACTERS).forEach(id => {
            if (HORROR_TRIGGER_MODS.has(id)) return;
            if (CHARACTERS[id].sheet) return;
            if (Math.random() > 0.55) return;
            const style = HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)];
            const color = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
            CHARACTERS[id].hair = { style, color, outline: '#000' };
        });
    }

    // ---------- EXPRESSION (state → 1..5 row of default-heads) ----------
    // Each slot picks a row of default-heads based on game state at render
    // time. Madballz mods have a static `headFrame` and ignore this.
    // Priority (highest first):
    //   jumpscare    →  2 (shocked, briefest gate)
    //   react mode   →  cycles 1→2→3→4→5→1 on every quarter note (auto-fired
    //                   after dwelling adjacent to Ice or Moon for
    //                   REACT_DWELL_BEATS beats — see tickReactState)
    //   just placed  →  2 (shocked, ~600 ms after a fresh drop)
    //   manual tap   →  whichever expression the kid last tapped to
    //   default      →  1 (silly / idle)
    const PLACED_SHOCK_MS = 600;
    const placedAt = new Map();         // slotIndex → performance.now()
    const manualExpression = new Map();  // slotIndex → 1..5 (set by tap-cycle)
    const dwellBeats = new Map();        // slotIndex → consecutive beats adjacent to a trigger
    const reactStartBeat = new Map();    // slotIndex → beatCounter when react fired
    const REACT_DWELL_BEATS = 8;         // ~4.8 s at 100 BPM
    let beatCounter = 0;                 // monotonically ticks on every quarter note

    function expressionForSlot(slotIndex) {
        if (slotIndex == null) return 1;
        if (isJumpScareActive) return 2;
        const id = slots[slotIndex];
        if (!id) return 1;
        const isEvil = (id === 'ice' || id === 'moon');
        // A Creep within CLOSE_PX → snap to shocked (2). Most urgent
        // read; the .creep-scared shake compounds on top of this.
        if (!isEvil && creepScaredSlots.has(slotIndex)) return 2;
        const r = reactStartBeat.get(slotIndex);
        if (r !== undefined) return ((beatCounter - r) % 5) + 1;
        // Horror mode: EVERY on-stage non-evil Munki cycles 1→5, offset
        // by slot so the dread ripples across the stage rather than all
        // flipping in lockstep.
        if (horrorActive && !isEvil) {
            return (((beatCounter - horrorStartBeat) + slotIndex) % 5) + 1;
        }
        const t = placedAt.get(slotIndex);
        if (t !== undefined && (performance.now() - t) < PLACED_SHOCK_MS) return 2;
        const m = manualExpression.get(slotIndex);
        if (m !== undefined) return m;
        return 1;
    }

    // Tap on a stage slot cycles its expression 1 → 2 → 3 → 4 → 5 → 1.
    // The result is read by expressionForSlot until a higher-priority state
    // (jumpscare, react mode, fresh placement) overrides it.
    function cycleManualExpression(slotIndex) {
        const cur = manualExpression.get(slotIndex) || 1;
        manualExpression.set(slotIndex, (cur % 5) + 1);
        // Count intentional taps for the solidSequence achievement (5 taps
        // = one full 1→2→3→4→5→1 cycle on that slot).
        if (typeof bumpSlotTapCount === 'function') bumpSlotTapCount(slotIndex);
    }

    // True if either immediate neighbour in the linear 5-slot row holds an
    // antagonist (Ice or Moon). Used by the react-mode dwell ticker.
    function isTriggerAdjacent(idx) {
        const left  = idx > 0             ? slots[idx - 1] : null;
        const right = idx < NUM_SLOTS - 1 ? slots[idx + 1] : null;
        const evil = id => id === 'ice' || id === 'moon';
        return evil(left) || evil(right);
    }

    // Beat-quantised state machine. Fires once per quarter note (from
    // scheduleStep). Increments dwell for every regular Munki next to an
    // antagonist; trips that Munki into react mode when dwell crosses
    // REACT_DWELL_BEATS. Resets dwell when the kid moves things around so
    // the kid can rescue a Munki by sliding it away in time.
    function tickReactState() {
        beatCounter++;
        let anyReacting = false;
        const toRender = new Set();
        for (let i = 0; i < NUM_SLOTS; i++) {
            const id = slots[i];
            // Empty slots and the antagonists themselves never react.
            if (!id || id === 'ice' || id === 'moon') {
                if (dwellBeats.delete(i))     toRender.add(i);
                if (reactStartBeat.delete(i)) toRender.add(i);
                continue;
            }
            if (isTriggerAdjacent(i)) {
                const next = (dwellBeats.get(i) || 0) + 1;
                dwellBeats.set(i, next);
                if (next >= REACT_DWELL_BEATS && !reactStartBeat.has(i)) {
                    reactStartBeat.set(i, beatCounter);
                    manualExpression.delete(i); // react overrides any prior tap
                    toRender.add(i);
                }
            } else {
                if (dwellBeats.delete(i))     toRender.add(i);
                if (reactStartBeat.delete(i)) toRender.add(i);
            }
            if (reactStartBeat.has(i)) {
                anyReacting = true;
                toRender.add(i); // expression cycles every beat
            }
        }
        beatReacting = anyReacting;
        syncHorrorMode();
        // While horror is on, every occupied non-evil slot is cycling its
        // expression (see expressionForSlot) — re-render them all each
        // beat so the sprites actually advance, not just the dwell ones.
        if (horrorActive) {
            for (let i = 0; i < NUM_SLOTS; i++) {
                const sid = slots[i];
                if (sid && sid !== 'ice' && sid !== 'moon') toRender.add(i);
            }
        }
        toRender.forEach(i => renderSlot(i));
    }

    // Single owner of body.react-mode-active + the sub-bass drone. Horror
    // is on if EITHER the beat-driven Ice/Moon adjacency OR the Flying
    // fear accumulation says so. Called from tickReactState (every beat)
    // and from the Flying Creep fear logic (on threshold transitions) so it
    // engages promptly regardless of which source fires.
    function syncHorrorMode() {
        const on = beatReacting || fearHorrorActive;
        document.body.classList.toggle('react-mode-active', on);
        if (on && !horrorActive) horrorStartBeat = beatCounter; // clean cycle start
        horrorActive = on;
        if (on !== anyWasReacting) {
            setReactDrone(on);
            anyWasReacting = on;
        }
    }

    // headArt composes the head layers (shape circle → sprite → hair → cans).
    // For Munkis, the sprite frame is computed from `${expr}-${color letter}`
    // where expr comes from expressionForSlot. Madballz keep their static
    // `headFrame` (e.g. 'mb-skull') and ignore expression.
    function headArt(c, expr) {
        let inner = '';
        if (c.headFrame) {
            inner = headModArt(c.headFrame, c.sheet);
        } else {
            const letter = COLOR_BY_BODY[c.bodyColor];
            if (letter) inner = headModArt(`${expr}-${letter}`, 'munki');
        }
        return headShapeArt(c) + inner + hairArt(c) + headPhonesArt();
    }

    // forceExpr (optional) overrides the game-state expression — used by
    // the 7th-wheel chip rendering so the lonely Munki always wears a sad
    // face (sprite row 3) instead of the chip-default silly (row 1).
    function characterArt(id, slotIndex, forceExpr) {
        const c = CHARACTERS[id];
        const expr = forceExpr != null ? forceExpr : expressionForSlot(slotIndex);
        return `<div class="char-art" data-char="${id}">`
            + `<div class="char-body">${bodyArt(c)}</div>`
            + `<div class="char-head">${headArt(c, expr)}</div>`
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
        const order = currentOrder();
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
            // The 7th-wheel evil (the one not on stage in any rainbow run)
            // wears a sad face by default and gets a .sulk class for the
            // CSS droop/sigh animation. checkSulkState() may later upgrade
            // it to .sulk-deep when the rainbow on stage is complete.
            const isSulker = !isMadballzMode && id === seventhWheel;
            const expr = isSulker ? 3 : undefined;
            if (isSulker) el.classList.add('sulk');
            // Post-Moon-unlock the 7th-wheel chip carries a tap-to-swap
            // badge (Ice <-> Moon). Replaces the old drag-an-altar-chip
            // mechanic so the bank stays a single 7-chip row with no
            // dangling extra chip. ⇄ is a typographic arrow, not emoji.
            const swapBadge = (isSulker && moonUnlocked)
                ? `<button class="chip-swap" type="button"
                          aria-label="Swap to ${CHARACTERS[altWheel()].label} Munki"
                          title="Tap to swap Ice / Moon">`
                  + `<span class="chip-swap-arrow" aria-hidden="true">⇄</span>`
                  + `<span class="chip-swap-txt">SWAP</span></button>`
                : '';
            el.innerHTML = `
                <div class="chip-icon">${characterArt(id, undefined, expr)}</div>
                <div class="chip-label">${ch.label}</div>
                ${swapBadge}
            `;
            tray.appendChild(el);
        });
        checkSulkState();
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
                <div class="slot-icon">${characterArt(id, index)}</div>
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
        // Replacing or clearing a slot resets every per-slot state map so
        // the new occupant starts from a clean default. dwell + react are
        // cheap to rebuild via the beat tick if conditions re-apply.
        manualExpression.delete(index);
        dwellBeats.delete(index);
        reactStartBeat.delete(index);
        // New occupant restarts the solidSequence tap counter for this slot.
        resetSlotTapCount(index);
        if (charId) {
            // Track placement time so expressionForSlot shows the "shocked"
            // row for ~600 ms after a fresh drop. Schedule a re-render
            // once that window closes so the face settles back to row 1.
            placedAt.set(index, performance.now());
            setTimeout(() => {
                if (slots[index] === charId) renderSlot(index);
            }, PLACED_SHOCK_MS + 30);
        } else {
            placedAt.delete(index);
        }
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
        // Easter egg: stage now matches the rainbow R-O-Y-G-B-P order?
        checkRainbowEgg();
        // Jealousy: if the rainbow is now complete, deepen the sulk on the
        // 7th-wheel chip; otherwise drop back to the idle sulk.
        checkSulkState();
        // New achievement family: solid colours, palindromic / repeating
        // patterns, band-fill milestones, first encounter with Ice or Moon.
        if (charId) checkColdSnap(charId);
        checkSolidSquad();
        checkPattern();
        checkBandMilestones();
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

    // ---------- TRAY: drag-to-place ----------
    // Pointer-event drag. pointerdown on a chip starts tracking; once the
    // pointer moves past DRAG_THRESHOLD_PX, a ghost element follows the
    // cursor/finger and the slot under it lights up as a drop target.
    // pointerup over a stage slot drops the Munki there (replacing any
    // existing occupant). Release elsewhere just discards the ghost.
    //
    // touch-action: none on .tray-chip lets the browser hand the whole
    // gesture to JS instead of stealing it for scrolling — important now
    // that the tray wraps onto two rows instead of horizontally scrolling.
    const trayDragState = new Map();
    let trayDragGhost = null;

    function startTrayGhost(chip, x, y) {
        if (trayDragGhost) trayDragGhost.remove();
        const ghost = chip.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.position = 'fixed';
        ghost.style.left = '0';
        ghost.style.top = '0';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '1000';
        document.body.appendChild(ghost);
        trayDragGhost = ghost;
        moveTrayGhost(x, y);
    }

    function moveTrayGhost(x, y) {
        if (!trayDragGhost) return;
        const w = trayDragGhost.offsetWidth;
        const h = trayDragGhost.offsetHeight;
        trayDragGhost.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) scale(1.08)`;
    }

    function clearTrayGhost() {
        if (trayDragGhost) {
            trayDragGhost.remove();
            trayDragGhost = null;
        }
    }

    function highlightSlotUnder(x, y) {
        const slot = findSlotAt(x, y);
        document.querySelectorAll('.stage-slot.drop-target').forEach(s => {
            if (s !== slot) s.classList.remove('drop-target');
        });
        if (slot) slot.classList.add('drop-target');
        return slot;
    }

    function attachTrayHandlers() {
        document.querySelectorAll('.tray-chip').forEach(chip => {
            chip.addEventListener('pointerdown', e => {
                if (e.button !== undefined && e.button !== 0) return; // left/touch only
                // The tap-to-swap badge handles its own click — never let
                // a pointerdown on it start a drag or capture the pointer.
                if (e.target.closest && e.target.closest('.chip-swap')) return;
                e.preventDefault();
                ensureAudio();
                try { chip.setPointerCapture(e.pointerId); } catch (_) {}
                chip.classList.add('grabbing');
                trayDragState.set(e.pointerId, {
                    chip,
                    charId: chip.dataset.char,
                    startX: e.clientX, startY: e.clientY,
                    dragging: false
                });
            });
            chip.addEventListener('pointermove', e => {
                const state = trayDragState.get(e.pointerId);
                if (!state) return;
                const dx = e.clientX - state.startX;
                const dy = e.clientY - state.startY;
                if (!state.dragging && (dx * dx + dy * dy) > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
                    state.dragging = true;
                    startTrayGhost(state.chip, e.clientX, e.clientY);
                }
                if (state.dragging) {
                    moveTrayGhost(e.clientX, e.clientY);
                    highlightSlotUnder(e.clientX, e.clientY);
                }
            });
            chip.addEventListener('pointerup', e => {
                const state = trayDragState.get(e.pointerId);
                if (!state) return;
                trayDragState.delete(e.pointerId);
                try {
                    if (state.chip.hasPointerCapture(e.pointerId)) {
                        state.chip.releasePointerCapture(e.pointerId);
                    }
                } catch (_) {}
                state.chip.classList.remove('grabbing');
                document.querySelectorAll('.stage-slot.drop-target').forEach(s => s.classList.remove('drop-target'));
                if (state.dragging) {
                    const slot = findSlotAt(e.clientX, e.clientY);
                    if (slot) {
                        const idx = parseInt(slot.dataset.index, 10);
                        setSlot(idx, state.charId);
                        playDropSound();
                    }
                    clearTrayGhost();
                    // Any successful (or attempted) drag in the tray resets
                    // the chipSpam egg counter — see attachEggDetectors().
                    document.dispatchEvent(new CustomEvent('trayChipDrag'));
                } else {
                    // No-drag tap. tap-to-place is gone (Bala's feedback),
                    // but tap is still meaningful for the chipSpam egg:
                    // 7 taps without dragging triggers a hidden discovery.
                    document.dispatchEvent(new CustomEvent('trayChipTap', {
                        detail: { charId: state.charId }
                    }));
                }
            });
            chip.addEventListener('pointercancel', e => {
                const state = trayDragState.get(e.pointerId);
                if (!state) return;
                trayDragState.delete(e.pointerId);
                state.chip.classList.remove('grabbing');
                document.querySelectorAll('.stage-slot.drop-target').forEach(s => s.classList.remove('drop-target'));
                clearTrayGhost();
            });
            // Tap-to-swap badge (only on the 7th-wheel chip post-unlock).
            // Its own click swaps Ice<->Moon; stopPropagation keeps it from
            // bubbling into the chip's drag / jealousy-tap logic.
            const swapBtn = chip.querySelector('.chip-swap');
            if (swapBtn) {
                swapBtn.addEventListener('click', ev => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ensureAudio();
                    swapSeventhWheel();
                });
            }
        });
    }

    // ---------- STAGE: tap-to-cycle + drag-off-to-clear ----------
    // pointerdown on a filled slot starts tracking. If the pointer moves
    // past DRAG_THRESHOLD_PX, treat it as a drag — release outside any
    // stage slot clears the Munki. Release without moving (a tap) cycles
    // the head expression 1 → 2 → 3 → 4 → 5 → 1 instead.
    const DRAG_THRESHOLD_PX = 12;
    const slotDragState = new Map();

    function findSlotAt(x, y) {
        const els = document.elementsFromPoint(x, y);
        return els.find(el => el.classList && el.classList.contains('stage-slot'));
    }

    function attachSlotHandlers() {
        const stage = document.getElementById('stage');
        stage.addEventListener('pointerdown', e => {
            const slot = e.target.closest('.stage-slot');
            if (!slot) return;
            const idx = parseInt(slot.dataset.index, 10);
            if (!slots[idx]) return; // empty slot — nothing to grab or tap
            e.preventDefault();
            ensureAudio(); // unlock audio on first interaction
            // setPointerCapture can throw InvalidPointerId for synthetic
            // events (testing) — guard so the handler still records state.
            try { slot.setPointerCapture(e.pointerId); } catch (_) {}
            slotDragState.set(e.pointerId, {
                slot, idx,
                startX: e.clientX, startY: e.clientY,
                dragging: false
            });
        });
        stage.addEventListener('pointermove', e => {
            const state = slotDragState.get(e.pointerId);
            if (!state) return;
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            if (!state.dragging && (dx * dx + dy * dy) > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
                state.dragging = true;
                state.slot.classList.add('dragging-off');
            }
        });
        stage.addEventListener('pointerup', e => {
            const state = slotDragState.get(e.pointerId);
            if (!state) return;
            slotDragState.delete(e.pointerId);
            try {
                if (state.slot.hasPointerCapture(e.pointerId)) {
                    state.slot.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}
            state.slot.classList.remove('dragging-off');
            if (state.dragging) {
                // Drag — clear if the kid let go outside the stage area.
                const overSlot = findSlotAt(e.clientX, e.clientY);
                if (!overSlot) {
                    setSlot(state.idx, null);
                    playClearSound();
                }
            } else {
                // Tap — cycle the expression and re-render just this slot.
                cycleManualExpression(state.idx);
                renderSlot(state.idx);
            }
        });
        stage.addEventListener('pointercancel', e => {
            const state = slotDragState.get(e.pointerId);
            if (!state) return;
            slotDragState.delete(e.pointerId);
            state.slot.classList.remove('dragging-off');
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
        // Refresh every active slot so faces snap to the shocked row for the
        // duration of the scare, then flip back when the gate releases.
        renderAllSlots();
        setTimeout(() => {
            document.body.classList.remove('jumpscare');
            isJumpScareActive = false;
            renderAllSlots();
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

    // Moon-chaos rain. Each particle is a real moon sprite cropped from
    // sky-items.png (one of 8 variants; comets excluded). NO emoji. If
    // the sheet hasn't loaded yet, fall back to a drawn glowing orb —
    // still never a 🌙. Reuses the existing `.moon-rain span` fall anim.
    const SKY_RAIN_INSET = 3; // px shaved per side (sheet has a ~2px gutter)
    function moonRain() {
        const layer = document.createElement('div');
        layer.className = 'moon-rain';
        const sheet = skyItemsSheet;
        for (let i = 0; i < 14; i++) {
            const m = document.createElement('span');
            const size = 22 + Math.random() * 34; // rendered px, longest side
            if (sheet && sheet.moons.length) {
                const f = sheet.moons[(Math.random() * sheet.moons.length) | 0];
                const b = SKY_RAIN_INSET;
                const iw = f.w - 2 * b, ih = f.h - 2 * b;
                const sc = size / Math.max(iw, ih);
                m.style.cssText =
                    `background-image:url('${sheet.src}');background-repeat:no-repeat;` +
                    `background-size:${sheet.sheetW * sc}px ${sheet.sheetH * sc}px;` +
                    `background-position:${-(f.x + b) * sc}px ${-(f.y + b) * sc}px;` +
                    `width:${iw * sc}px;height:${ih * sc}px;`;
            } else {
                m.style.cssText =
                    `width:${size}px;height:${size}px;border-radius:50%;` +
                    `background:radial-gradient(circle at 38% 36%,#dbeafe,#1e293b 72%);` +
                    `box-shadow:0 0 10px rgba(147,197,253,0.7);`;
            }
            m.style.left = (Math.random() * 100) + 'vw';
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
        const order = currentOrder();
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
    // Persistence keys:
    //   horrorTriggers   — counter (legacy: also gates dormant Madballz mode)
    //   madballzUnlocked — dormant feature flag, still persisted for safety
    //   achievements     — { id: { unlocked_at, points_awarded } } map
    //   moonUnlocked     — bool, set when total achievement points ≥ threshold
    //   seventhWheel     — 'ice' | 'moon', which evil sits in the bank
    //   bandCount        — lifetime count of 6/6 stage fills (drives the
    //                      3/10/20 Bands achievements)
    //   activeBankIndex  — legacy from the multi-bank era; still clamped
    //   unlockedBanks    — legacy parallel array; still hydrated for safety
    // Legacy fields auto-migrated on load:
    //   munkiSightings   — array of egg ids; promoted into `achievements`
    //                      with their canonical point values
    // Storage errors are swallowed so a flaky client never breaks the game.
    function loadProgress() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const obj = JSON.parse(raw);
            horrorTriggers = (obj.horrorTriggers | 0);
            madballzUnlocked = !!obj.madballzUnlocked;
            moonUnlocked = !!obj.moonUnlocked;
            bandCount = (obj.bandCount | 0);
            // Legacy migration: any old munkiSightings array becomes an
            // achievement record with the canonical point value. Run BEFORE
            // the achievements object so a corrupt object can't shadow good
            // legacy data, and so the new object can overwrite legacy.
            if (Array.isArray(obj.munkiSightings)) {
                obj.munkiSightings.forEach(id => {
                    const def = ACHIEVEMENT_BY_ID[id];
                    if (def && !achievements.has(id)) {
                        achievements.set(id, {
                            unlocked_at: null,
                            points_awarded: def.points
                        });
                    }
                });
            }
            if (obj.achievements && typeof obj.achievements === 'object') {
                Object.entries(obj.achievements).forEach(([id, meta]) => {
                    if (ACHIEVEMENT_BY_ID[id] && meta) {
                        achievements.set(id, {
                            unlocked_at: meta.unlocked_at || null,
                            points_awarded: (meta.points_awarded | 0) || ACHIEVEMENT_BY_ID[id].points
                        });
                    }
                });
            }
            if (obj.seventhWheel === 'moon' || obj.seventhWheel === 'ice') {
                seventhWheel = obj.seventhWheel;
            }
            const idx = (obj.activeBankIndex | 0);
            if (idx >= 0 && idx < BANKS.length && BANKS[idx].unlocked) {
                activeBankIndex = idx;
            }
            if (Array.isArray(obj.unlockedBanks)) {
                obj.unlockedBanks.forEach((u, i) => {
                    if (i < BANKS.length && u) BANKS[i].unlocked = true;
                });
            }
        } catch (e) { /* ignore — start fresh */ }
    }

    function saveProgress() {
        try {
            const achievementsObj = {};
            achievements.forEach((meta, id) => { achievementsObj[id] = meta; });
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                horrorTriggers,
                madballzUnlocked,
                achievements: achievementsObj,
                moonUnlocked,
                bandCount,
                seventhWheel,
                activeBankIndex,
                unlockedBanks: BANKS.map(b => b.unlocked)
            }));
            // App build: notify the native bridge to mirror into
            // Capacitor Preferences. No-op on web (no listener attached).
            try {
                window.dispatchEvent(new CustomEvent('all-munkis-progress-saved'));
            } catch (_) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }

    // Keeps BANKS[0]'s 7th chip in sync with the current seventhWheel value.
    // Idempotent — call after any swap, on init, after loadProgress.
    function syncBankWithSeventhWheel() {
        const bank = BANKS[0].munkis;
        // Strip both evils, then append the current 7th wheel.
        const cleaned = bank.filter(id => id !== 'ice' && id !== 'moon');
        cleaned.push(seventhWheel);
        BANKS[0].munkis = cleaned;
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
        if (!MADBALLZ_ENABLED) return; // dormant under the 8-Munki redesign
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
        if (meet) meet.hidden = !MADBALLZ_ENABLED || !madballzUnlocked;
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
            ? 'MADBALLZ MODE · Drag a Munki onto the stage · Tap on stage to react · Drag off to remove'
            : 'Drag a Munki onto the stage · Tap on stage to react · Drag off stage to remove';
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
        stopReadAloud();
    }

    // Read the lore aloud via SpeechSynthesis. Toggle: click while speaking
    // to stop. Auto-stops on modal close. Falls back silently if the browser
    // lacks the API (very rare on modern mobile, but fail closed).
    function toggleReadAloud() {
        if (!('speechSynthesis' in window)) return;
        if (window.speechSynthesis.speaking) {
            stopReadAloud();
            return;
        }
        const body = document.querySelector('.story-body');
        if (!body) return;
        const text = body.innerText.replace(/\s+/g, ' ').trim();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.pitch = 1.0;
        u.onend    = updateReadButton;
        u.onerror  = updateReadButton;
        u.oncancel = updateReadButton;
        window.speechSynthesis.speak(u);
        updateReadButton();
    }

    function stopReadAloud() {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        updateReadButton();
    }

    function updateReadButton() {
        const btn = document.getElementById('storyReadBtn');
        if (!btn) return;
        const speaking = ('speechSynthesis' in window) && window.speechSynthesis.speaking;
        btn.classList.toggle('speaking', speaking);
        const lbl = btn.querySelector('.story-read-lbl');
        const ico = btn.querySelector('.story-read-ico');
        if (lbl) lbl.textContent = speaking ? 'Stop' : 'Read';
        if (ico) ico.innerHTML = speaking
            ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>`
            : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>`;
    }

    // ---------- ACHIEVEMENT GRANT / UI ----------
    // grantAchievement(id) is the single entry point — each detector calls it
    // when its trigger fires. Idempotent: already-unlocked ids are no-ops.
    // Awarding pulls points from the canonical ACHIEVEMENT_BY_ID lookup so
    // the value is single-sourced. Threshold cross flips moonUnlocked.
    //
    // findEgg(id) is kept as an alias so existing detector code reads
    // naturally for the 5 original eggs.
    function grantAchievement(id) {
        const def = ACHIEVEMENT_BY_ID[id];
        if (!def) return;
        if (achievements.has(id)) return;
        achievements.set(id, {
            unlocked_at: new Date().toISOString(),
            points_awarded: def.points
        });
        saveProgress();
        showEggCounter();
        bumpEggCounter();
        showAchievementToast(def);
        if (totalAchievementPoints() >= MOON_UNLOCK_THRESHOLD && !moonUnlocked) {
            unlockMoon();
        }
    }
    function findEgg(id) { grantAchievement(id); }

    function showEggCounter() {
        const el = document.getElementById('eggCounter');
        if (!el) return;
        el.hidden = false;
        // double-RAF so the .shown transition actually animates (browser
        // needs a frame between hidden=false and the class flip).
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('shown')));
    }

    function bumpEggCounter() {
        const el = document.getElementById('eggCounter');
        if (!el) return;
        const text = el.querySelector('.egg-counter-text');
        const pts = totalAchievementPoints();
        if (text) {
            text.textContent = moonUnlocked
                ? `FOUND · ${pts}`
                : `${pts}/${MOON_UNLOCK_THRESHOLD}`;
        }
        el.classList.toggle('found-all', moonUnlocked);
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
    }

    // Brief celebratory toast under the egg counter naming the achievement
    // and the points it was worth. Stays visible ~3 s, fades out, stacks
    // gracefully if a second unlock fires before the first dismisses (each
    // toast appears below the prior one).
    let toastOffset = 0;
    function showAchievementToast(def) {
        const root = document.body;
        const toast = document.createElement('div');
        toast.className = 'achievement-toast';
        toast.innerHTML = `
            <div class="achievement-toast-title">${def.name}</div>
            <div class="achievement-toast-points">+${def.points} moon point${def.points === 1 ? '' : 's'}</div>
        `;
        const myOffset = toastOffset;
        toastOffset += 1;
        toast.style.setProperty('--toast-stack', String(myOffset));
        root.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('shown')));
        setTimeout(() => {
            toast.classList.remove('shown');
            setTimeout(() => {
                toast.remove();
                toastOffset = Math.max(0, toastOffset - 1);
            }, 400);
        }, 2800);
    }

    // Click-to-open panel listing every unlocked achievement. Hidden by
    // default; tap the eggCounter chip to toggle. Locked achievements
    // intentionally don't appear (the discovery IS the reward).
    function toggleAchievementsPanel() {
        const panel = document.getElementById('achievementsPanel');
        if (!panel) return;
        if (panel.classList.contains('open')) {
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
            return;
        }
        renderAchievementsPanel();
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
    }

    function renderAchievementsPanel() {
        const panel = document.getElementById('achievementsPanel');
        if (!panel) return;
        const pts = totalAchievementPoints();
        const unlockedDefs = ACHIEVEMENTS.filter(a => achievements.has(a.id));
        // Sort by unlock time (most recent first); legacy null timestamps
        // get pushed to the bottom so newly-earned items stay on top.
        unlockedDefs.sort((a, b) => {
            const ta = (achievements.get(a.id).unlocked_at || '');
            const tb = (achievements.get(b.id).unlocked_at || '');
            return tb.localeCompare(ta);
        });
        const headline = moonUnlocked
            ? `MOON MUNKI AWAKENED · ${pts} MOON POINTS`
            : `${pts}/${MOON_UNLOCK_THRESHOLD} moon points`;
        const items = unlockedDefs.length
            ? unlockedDefs.map(a => `
                <li class="achievement-row">
                    <span class="achievement-name">${a.name}</span>
                    <span class="achievement-points">+${a.points}</span>
                </li>`).join('')
            : '<li class="achievement-empty">No achievements yet — try things.</li>';
        panel.innerHTML = `
            <div class="achievements-head">
                <span class="achievements-title">${headline}</span>
                <button type="button" class="achievements-close" aria-label="Close">&times;</button>
            </div>
            <ul class="achievements-list">${items}</ul>
        `;
        const closeBtn = panel.querySelector('.achievements-close');
        if (closeBtn) closeBtn.addEventListener('click', toggleAchievementsPanel);
    }

    function attachCounterPanelToggle() {
        const counter = document.getElementById('eggCounter');
        if (counter) counter.addEventListener('click', toggleAchievementsPanel);
        // Click outside the panel also closes it.
        document.addEventListener('pointerdown', e => {
            const panel = document.getElementById('achievementsPanel');
            if (!panel || !panel.classList.contains('open')) return;
            if (e.target.closest('#achievementsPanel') || e.target.closest('#eggCounter')) return;
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
        });
    }

    function unlockMoon() {
        moonUnlocked = true;
        saveProgress();
        // Show the swap altar — the kid can now drag Moon's alternate chip
        // onto Ice in the bank (or vice-versa) to swap which evil rides
        // the 7th-wheel slot. Bank itself stays at 7 chips. seventhWheel
        // defaults to 'ice' so the existing bank layout is unchanged on
        // first unlock; the kid earns Moon's presence by swapping.
        renderMunkiAltar();
        // Re-render the bank so the 7th-wheel chip gets its tap-to-swap
        // badge the instant Moon unlocks (no reload needed).
        renderTray();
        attachTrayHandlers();
        bumpEggCounter(); // flip "5/5" → "FOUND"
        showMoonReveal();
    }

    function showMoonReveal() {
        const overlay = document.getElementById('moonReveal');
        if (!overlay) return;
        overlay.setAttribute('aria-hidden', 'false');
        overlay.classList.add('open');
        // Tap-to-dismiss + auto-close after 3.5s.
        const dismiss = () => {
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
            overlay.removeEventListener('pointerdown', dismiss);
            clearTimeout(autoClose);
        };
        overlay.addEventListener('pointerdown', dismiss);
        const autoClose = setTimeout(dismiss, 3500);
    }

    // Wires the 5 hidden interactions. Idempotent — call once on init.
    function attachEggDetectors() {
        // ---- Egg 1: titleClick — tap the pink "Munkis" 5× in 8s ----
        const titleSpan = document.querySelector('h1 .neon-pink');
        if (titleSpan) {
            const taps = [];
            titleSpan.addEventListener('click', () => {
                const now = performance.now();
                taps.push(now);
                while (taps.length && now - taps[0] > 8000) taps.shift();
                if (taps.length >= 5) {
                    taps.length = 0;
                    findEgg('titleClick');
                }
            });
            titleSpan.style.cursor = 'pointer';
        }

        // ---- Egg 2: corners — tap all 4 corner hotspots within 10s ----
        const visited = new Set();
        let firstCornerAt = 0;
        ['cornerTL', 'cornerTR', 'cornerBR', 'cornerBL'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('pointerdown', e => {
                e.preventDefault();
                const now = performance.now();
                if (visited.size === 0 || now - firstCornerAt > 10000) {
                    visited.clear();
                    firstCornerAt = now;
                }
                visited.add(id);
                if (visited.size === 4) {
                    visited.clear();
                    findEgg('corners');
                }
            });
        });

        // ---- Egg 3: rainbowOrder — fired from setSlot via checkRainbow ----
        // (handled in checkRainbowEgg(), called from setSlot)

        // ---- Egg 4: chipSpam — 7 taps (no drag) on the same chip in 6s ----
        const spamTaps = new Map(); // chipCharId → [timestamps]
        document.addEventListener('trayChipTap', e => {
            const charId = e.detail && e.detail.charId;
            if (!charId) return;
            // Jealousy flavor: a tap on the lonely 7th-wheel chip pops a
            // speech bubble. Doesn't conflict with chipSpam — both fire.
            if (charId === seventhWheel) {
                const chipEl = document.querySelector(`#tray .tray-chip[data-char="${charId}"]`);
                maybeSpeakJealousy(charId, chipEl);
            }
            const now = performance.now();
            const arr = spamTaps.get(charId) || [];
            arr.push(now);
            while (arr.length && now - arr[0] > 6000) arr.shift();
            spamTaps.set(charId, arr);
            if (arr.length >= 7) {
                spamTaps.clear();
                findEgg('chipSpam');
            }
        });
        // Any drag in the tray resets all spam counters — clearly the kid
        // is using the chip, not stuck repeating taps on it.
        document.addEventListener('trayChipDrag', () => spamTaps.clear());

        // ---- Egg 5: stageTriple — triple-tap on the empty stage area ----
        const stage = document.getElementById('stage');
        if (stage) {
            const tripleTaps = [];
            stage.addEventListener('pointerdown', e => {
                // Only count taps that hit the bare stage (not a slot).
                if (e.target.closest('.stage-slot')) return;
                const now = performance.now();
                tripleTaps.push(now);
                while (tripleTaps.length && now - tripleTaps[0] > 1000) tripleTaps.shift();
                if (tripleTaps.length >= 3) {
                    tripleTaps.length = 0;
                    findEgg('stageTriple');
                }
            });
        }
    }

    // Called from setSlot — checks if every slot now holds its rainbow color
    // in the canonical R-O-Y-G-B-P order. Triggers the rainbowOrder egg.
    const RAINBOW_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    function checkRainbowEgg() {
        for (let i = 0; i < RAINBOW_ORDER.length; i++) {
            if (slots[i] !== RAINBOW_ORDER[i]) return;
        }
        findEgg('rainbowOrder');
    }

    // ---------- NEW ACHIEVEMENT DETECTORS ----------
    // Per-slot tap counter for the head-cycle solidSequence achievement.
    // Reset when a slot is cleared or replaced; bumps on cycleManualExpression.
    const slotTapCount = new Map();
    function bumpSlotTapCount(idx) {
        slotTapCount.set(idx, (slotTapCount.get(idx) || 0) + 1);
        checkSolidSequence();
    }
    function resetSlotTapCount(idx) { slotTapCount.delete(idx); }

    function isStageFull() {
        for (let i = 0; i < NUM_SLOTS; i++) if (!slots[i]) return false;
        return true;
    }

    function stageBodyColors() {
        return slots.map(id => id ? CHARACTERS[id].bodyColor : null);
    }

    function isSolidStage() {
        if (!isStageFull()) return false;
        const colors = stageBodyColors();
        return colors.every(c => c === colors[0]);
    }

    // Achievement: Solid Squad — 6/6 same body color.
    function checkSolidSquad() { if (isSolidStage()) grantAchievement('solidSquad'); }

    // Achievement: Solid Sequence — every slot has been tap-cycled at least
    // 5 times (one full 1→2→3→4→5→1 loop) while the squad is still solid.
    function checkSolidSequence() {
        if (!isSolidStage()) return;
        for (let i = 0; i < NUM_SLOTS; i++) {
            if ((slotTapCount.get(i) || 0) < 5) return;
        }
        grantAchievement('solidSequence');
    }

    // Achievement: Pattern Maker — 6/6 stage forms a palindrome or a
    // repeating unit of length 2 or 3 (by character id).
    function checkPattern() {
        if (!isStageFull()) return;
        const s = slots;
        const palindrome =
            s[0] === s[5] && s[1] === s[4] && s[2] === s[3] &&
            // exclude the trivial all-same case from THIS detector — solidSquad
            // handles that one and would double-fire here.
            !(s[0] === s[1] && s[1] === s[2]);
        const rep2 = s[0] === s[2] && s[2] === s[4]
                  && s[1] === s[3] && s[3] === s[5]
                  && s[0] !== s[1];
        const rep3 = s[0] === s[3] && s[1] === s[4] && s[2] === s[5]
                  && !(s[0] === s[1] && s[1] === s[2]);
        if (palindrome || rep2 || rep3) grantAchievement('patternMaker');
    }

    // Achievement: 3/10/20 Bands — lifetime counter of "stage hit 6/6" events.
    // wasFull tracks the prior-tick fullness so we only count the transition.
    let stageWasFull = false;
    function checkBandMilestones() {
        const nowFull = isStageFull();
        if (nowFull && !stageWasFull) {
            bandCount++;
            saveProgress();
            if (bandCount >= 3)  grantAchievement('band3');
            if (bandCount >= 10) grantAchievement('band10');
            if (bandCount >= 20) grantAchievement('band20');
        }
        stageWasFull = nowFull;
    }

    // Achievement: Cold Snap — fires the first time Ice or Moon lands on
    // the stage. setSlot calls this with the charId being placed.
    function checkColdSnap(charId) {
        if (charId === 'ice' || charId === 'moon') grantAchievement('coldSnap');
    }

    // Achievement: Touch the Outsider — tap the horror-munki corner sprite
    // while it's visible (i.e., react-mode-active). The SVGs default to
    // pointer-events:none; we override only during react mode (see CSS) and
    // listen for pointerdown on document, matching by element class.
    function attachOutsiderTapDetector() {
        document.addEventListener('pointerdown', e => {
            if (!document.body.classList.contains('react-mode-active')) return;
            const el = e.target.closest('.horror-munki');
            if (!el) return;
            grantAchievement('touchOutsider');
        });
    }

    // ---------- JEALOUSY FLAVOR ----------
    // The 7th-wheel evil is the lonely one — the rainbow has 6 slots and 6
    // colors, so one of Ice/Moon always sits out. checkSulkState() runs after
    // every stage change and bumps the bank's 7th chip + the altar chip to
    // .sulk-deep when the rainbow is fully on stage ("they really did it
    // without me"). showSpeechBubble() / JEALOUS_QUOTES surface a tiny tap-
    // triggered thought bubble per kid-friendly emotional storytelling.
    function isRainbowComplete() {
        for (let i = 0; i < RAINBOW_ORDER.length; i++) {
            if (slots[i] !== RAINBOW_ORDER[i]) return false;
        }
        return true;
    }

    function checkSulkState() {
        const deep = isRainbowComplete();
        document.querySelectorAll('.tray-chip.sulk, .altar-chip.sulk').forEach(el => {
            el.classList.toggle('sulk-deep', deep);
        });
    }

    // Terse, cold, FNAF-quiet. The "left out" loneliness is still here
    // but it reads as a threat now, not sad-but-cute. No emoji, lower-
    // case kept only for an unsettling flat affect.
    const JEALOUS_QUOTES = {
        ice: [
            "you never pick me.",
            "you'll be cold too. soon.",
            "i don't forget the warm ones.",
            "i was a color once.",
            "stay. it's freezing out here."
        ],
        moon: [
            "i see you. always.",
            "you'll make room for me.",
            "i'm closer than you think.",
            "don't look away.",
            "you should have picked me."
        ]
    };

    let bubbleCooldown = false;
    function showSpeechBubble(chipEl, text) {
        if (!chipEl || bubbleCooldown) return;
        bubbleCooldown = true;
        setTimeout(() => { bubbleCooldown = false; }, 450);
        // Remove any prior bubble first so rapid taps don't stack.
        document.querySelectorAll('.speech-bubble').forEach(b => b.remove());
        const bubble = document.createElement('div');
        bubble.className = 'speech-bubble';
        bubble.textContent = text;
        document.body.appendChild(bubble);
        // Anchor above the chip. Uses fixed positioning so it doesn't shift
        // when the page scrolls during the auto-dismiss.
        const r = chipEl.getBoundingClientRect();
        bubble.style.left = `${r.left + r.width / 2}px`;
        bubble.style.top  = `${r.top - 8}px`;
        requestAnimationFrame(() => bubble.classList.add('shown'));
        setTimeout(() => {
            bubble.classList.remove('shown');
            setTimeout(() => bubble.remove(), 360);
        }, 2400);
    }

    function maybeSpeakJealousy(charId, chipEl) {
        const lines = JEALOUS_QUOTES[charId];
        if (!lines) return;
        const text = lines[Math.floor(Math.random() * lines.length)];
        showSpeechBubble(chipEl, text);
    }

    // ---------- MUNKI ALTAR (Ice ↔ Moon swap, post-unlock) ----------
    // After Moon unlocks, the alt-evil sits in a small "altar" chip next to
    // the tray. The kid drags it onto the active 7th-wheel chip in the bank
    // to swap which evil rides that slot. Drop anywhere else snaps back.
    // The bank itself stays at 7 chips, preserving the rainbow-with-one-evil
    // visual the redesign asked for.
    // RETIRED. The Ice<->Moon swap is now a tap-to-swap badge on the
    // 7th-wheel bank chip (see the .chip-swap branch in renderTray and
    // its click handler in attachTrayHandlers). The old #munkiAltar
    // element is kept in the DOM but always hidden+empty so the bank is
    // a single 7-chip row with no dangling extra chip. attachAltarHandlers()
    // below is dead code, intentionally left in place (zero-risk, unused).
    function renderMunkiAltar() {
        const altar = document.getElementById('munkiAltar');
        if (altar) { altar.hidden = true; altar.innerHTML = ''; }
    }

    function attachAltarHandlers() {
        const chip = document.querySelector('.altar-chip');
        if (!chip) return;
        chip.addEventListener('pointerdown', e => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            ensureAudio();
            try { chip.setPointerCapture(e.pointerId); } catch (_) {}
            chip.classList.add('grabbing');
            trayDragState.set(e.pointerId, {
                chip,
                charId: chip.dataset.char,
                startX: e.clientX, startY: e.clientY,
                dragging: false,
                isAltar: true
            });
        });
        chip.addEventListener('pointermove', e => {
            const state = trayDragState.get(e.pointerId);
            if (!state) return;
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            if (!state.dragging && (dx * dx + dy * dy) > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
                state.dragging = true;
                startTrayGhost(state.chip, e.clientX, e.clientY);
                // Highlight the active 7th-wheel chip in the bank as the
                // only valid drop target for an altar drag.
                const active = document.querySelector(`.tray-chip[data-char="${seventhWheel}"]`);
                if (active) active.classList.add('swap-target');
            }
            if (state.dragging) {
                moveTrayGhost(e.clientX, e.clientY);
            }
        });
        chip.addEventListener('pointerup', e => {
            const state = trayDragState.get(e.pointerId);
            if (!state) return;
            trayDragState.delete(e.pointerId);
            try {
                if (state.chip.hasPointerCapture(e.pointerId)) {
                    state.chip.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}
            state.chip.classList.remove('grabbing');
            document.querySelectorAll('.tray-chip.swap-target').forEach(c => c.classList.remove('swap-target'));
            if (state.dragging) {
                // Drop on the active 7th-wheel chip → swap.
                const els = document.elementsFromPoint(e.clientX, e.clientY);
                const dropTarget = els.find(el => el.classList && el.classList.contains('tray-chip') && el.dataset.char === seventhWheel);
                if (dropTarget) {
                    swapSeventhWheel();
                }
                clearTrayGhost();
            } else {
                // No-drag tap on the altar chip — the alternate evil is also
                // the lonely one (the rainbow doesn't pick either of them).
                maybeSpeakJealousy(state.charId, state.chip);
            }
        });
        chip.addEventListener('pointercancel', e => {
            const state = trayDragState.get(e.pointerId);
            if (!state) return;
            trayDragState.delete(e.pointerId);
            state.chip.classList.remove('grabbing');
            document.querySelectorAll('.tray-chip.swap-target').forEach(c => c.classList.remove('swap-target'));
            clearTrayGhost();
        });
    }

    function swapSeventhWheel() {
        const incoming = altWheel();
        // If the outgoing evil is on the stage, clear it (its chip won't
        // exist after the swap, so leaving the stage occupant orphaned
        // would be a confusing state).
        for (let i = 0; i < NUM_SLOTS; i++) {
            if (slots[i] === seventhWheel) setSlot(i, null);
        }
        seventhWheel = incoming;
        syncBankWithSeventhWheel();
        saveProgress();
        renderTray();
        attachTrayHandlers();
        renderMunkiAltar();
        playDropSound();
    }

    // ---------- HEADER BUTTONS ----------
    function attachHeaderHandlers() {
        document.getElementById('remixBtn').addEventListener('click', () => {
            ensureAudio();
            // Route through setSlot so a remix that lands on Ice or Moon
            // fires the horror jumpscare just like a manual drop would.
            // Picks from the order matching the screen the kid is on.
            const order = currentOrder();
            for (let i = 0; i < NUM_SLOTS; i++) {
                setSlot(i, order[Math.floor(Math.random() * order.length)]);
            }
            playDropSound();
        });

        const bankPrev = document.getElementById('bankPrev');
        const bankNext = document.getElementById('bankNext');
        if (bankPrev) bankPrev.addEventListener('click', () => nudgeBank(-1));
        if (bankNext) bankNext.addEventListener('click', () => nudgeBank(1));
        updateBankLabel();

        const storyBtn = document.getElementById('storyBtn');
        if (storyBtn) storyBtn.addEventListener('click', openStoryModal);

        const storyClose = document.getElementById('storyCloseBtn');
        if (storyClose) storyClose.addEventListener('click', closeStoryModal);

        const storyRead = document.getElementById('storyReadBtn');
        if (storyRead) storyRead.addEventListener('click', toggleReadAloud);

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

        // ---- Dual Band Mode (v1.1, chunk A: mode + footswitch UI) ----
        const dualBandBtn = document.getElementById('dualBandBtn');
        if (dualBandBtn) {
            dualBandBtn.addEventListener('click', () => {
                ensureAudio();
                setDualBandMode(!isDualBandMode);
            });
        }
        const footA = document.getElementById('bandFootA');
        const footB = document.getElementById('bandFootB');
        if (footA) footA.addEventListener('click', () => { ensureAudio(); setBandOn(0, !bandOn[0]); });
        if (footB) footB.addEventListener('click', () => { ensureAudio(); setBandOn(1, !bandOn[1]); });

        // (Manual BOO! button removed — childish. triggerJumpScare still
        // auto-fires on an Ice/Moon stage drop as the FNAF scare.)

        const muteBtn = document.getElementById('muteBtn');
        const muteIcon = document.getElementById('muteIcon');
        muteBtn.addEventListener('click', () => {
            isMuted = !isMuted;
            if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.55;
            muteBtn.classList.toggle('muted', isMuted);
            muteIcon.innerHTML = isMuted
                ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>`
                : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>`;
        });
    }

    // ---------- TRAY HEIGHT TRACKER ----------
    // The fixed-position tray-wrap wraps onto 2 rows on phones and 1 row on
    // tablets+. main reads --tray-h to size its padding-bottom so the stage
    // always sits just above the tray no matter which layout is active.
    // Re-measures on every event that could change the wrap state, with a
    // double-RAF after each so the value reflects the post-layout height
    // (not the mid-resize transient).
    function watchTrayHeight() {
        const tray = document.querySelector('.tray-wrap');
        if (!tray) return;
        let pending = false;
        const apply = () => {
            const h = Math.ceil(tray.getBoundingClientRect().height);
            document.documentElement.style.setProperty('--tray-h', `${h}px`);
            pending = false;
        };
        const schedule = () => {
            if (pending) return;
            pending = true;
            // Double-RAF: first frame queues, second frame runs AFTER the
            // browser has laid out any wrap changes. Without this the
            // ResizeObserver sometimes fires mid-reflow and reads a stale
            // height (e.g. on a viewport resize that wraps the chips).
            requestAnimationFrame(() => requestAnimationFrame(apply));
        };
        schedule();
        if ('ResizeObserver' in window) {
            new ResizeObserver(schedule).observe(tray);
        }
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);
        // Re-measure after fonts load — chip-label height can shift slightly
        // once 'Fredoka' swaps in, which nudges tray height.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(schedule).catch(() => {});
        }
    }

    // ---------- AUDIO BACKGROUNDING ----------
    // When the page is hidden (Android home button, screen lock, tab switch),
    // suspend the audio context and pause the scheduler. Without this the
    // setTimeout-driven scheduler keeps firing while the OS has the audio
    // context suspended; events queue up and play back loudly when the user
    // returns, plus battery is wasted. Resume on visibility return.
    function watchVisibility() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                isPlaying = false;
                if (schedTimer) { clearTimeout(schedTimer); schedTimer = null; }
                if (audioCtx && audioCtx.state === 'running') {
                    audioCtx.suspend().catch(() => {});
                }
            } else {
                // Resume only if the user had audio going before backgrounding.
                if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume().catch(() => {});
                    isPlaying = true;
                    nextStepTime = audioCtx.currentTime + 0.08;
                    schedule();
                }
            }
        });
    }

    // ---------- FLYING CREEPS ----------
    // An ambient creature that drifts across the stage on a timer. ONE at a
    // time. Each appearance randomly picks one of the sheet's visually
    // distinct variants (target: CREEP.VARIANT_COUNT, currently 12) — they
    // are mechanically identical, just different art. Munkis a Creep gets
    // close to flinch (CSS .creep-scared, compounds with the jealous-sulk)
    // and accumulate `fear`. When total fear across on-stage Munkis crosses
    // CREEP.HORROR_TRIGGER_SUM, horror mode trips via the shared
    // syncHorrorMode() path (same 12s creep-in as an Ice/Moon drop) and the
    // hidden "Creep Whisperer" achievement unlocks. Seeing every variant at
    // least once (across sessions) unlocks "All Creeps Encountered". Not
    // interactive in v1.
    //
    // Sprite: assets/sprites/flying-creeps.png + flying-creeps.json
    // (TexturePacker hash, same shape as mb-heads.json — 12 frames = 12
    // VARIANTS, not animation frames). Until the real art lands the entity
    // renders a clearly-marked PLACEHOLDER ghost SVG and variant tracking
    // is inert (you can't "encounter all creeps" with no sheet). See
    // assets/sprites/FLYING_CREEPS_README.md for the full sheet spec.
    const CREEPS_SEEN_KEY = 'all-munkis-creeps-seen-v1';
    const creepFear = new Map();   // slotIndex -> 0..100
    // Slots a Creep is currently CLOSE to — drives the shocked-face fear
    // expression (expressionForSlot), not just the .creep-scared shake.
    const creepScaredSlots = new Set();
    let creepEl = null;            // the floating DOM element
    let creepActive = false;       // currently drifting across?
    let creepSheet = null;         // {src, sheetW, sheetH, frames:[...]} or null
    // Moon-chaos rain art: 8 moon variants cropped from sky-items.png.
    // The 4 comet-* frames in that sheet are deliberately ignored here
    // (reserved for v1.1). null until loaded — moonRain falls back to a
    // drawn glowing orb, never an emoji.
    let skyItemsSheet = null;      // {src, sheetW, sheetH, moons:[{x,y,w,h}]}
    let creepSpawnTimer = null;
    let creepRAF = null;
    let creepState = null;         // { x, y, vx, baseY, tStart, stayMs, variant }
    let creepPaused = false;       // mirrors page-visibility (battery)
    let creepLastTs = 0;
    const creepsSeen = new Set();  // variant indices seen across all sessions

    function rand(min, max) { return min + Math.random() * (max - min); }

    function loadCreepsSeen() {
        try {
            const raw = localStorage.getItem(CREEPS_SEEN_KEY);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) arr.forEach(n => creepsSeen.add(n | 0));
        } catch (_) { /* ignore */ }
    }
    function saveCreepsSeen() {
        try {
            localStorage.setItem(CREEPS_SEEN_KEY, JSON.stringify([...creepsSeen]));
        } catch (_) { /* ignore */ }
    }
    // Record a freshly-spawned variant; grant "All Creeps Encountered" once
    // every variant in the loaded sheet has been seen at least once. Only
    // meaningful with a real sheet (the placeholder has no variants).
    function markCreepSeen(variant) {
        if (variant < 0) return;
        if (creepsSeen.has(variant)) return;
        creepsSeen.add(variant);
        saveCreepsSeen();
        const total = creepSheet ? creepSheet.frames.length : 0;
        if (total > 0 && creepsSeen.size >= total) {
            grantAchievement('allCreeps');
        }
    }

    // Try to load the real sprite sheet. Resolves to a sheet descriptor or
    // null (→ placeholder). Never rejects — a missing sheet is expected
    // until the art is dropped in. Each frame is a distinct VARIANT.
    function loadCreepSheet() {
        return fetch('assets/sprites/flying-creeps.json')
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (!json || !json.frames) return null;
                // Accept either an array or the TexturePacker object map
                // (same shape as mb-heads.json: frames[name].frame{x,y,w,h}).
                const frames = Array.isArray(json.frames)
                    ? json.frames.map(f => f.frame || f)
                    : Object.values(json.frames).map(f => f.frame || f);
                if (!frames.length) return null;
                const meta = json.meta || {};
                const size = meta.size || {};
                return {
                    src: 'assets/sprites/flying-creeps.png',
                    // Natural sheet pixel size — needed to scale one variant
                    // frame into the SIZE_PX box. Fall back to bounding the
                    // frame rects if meta.size is absent.
                    sheetW: size.w || Math.max(...frames.map(f => f.x + f.w)),
                    sheetH: size.h || Math.max(...frames.map(f => f.y + f.h)),
                    frames
                };
            })
            .catch(() => null);
    }

    // Loads sky-items.{png,json} for the moon-chaos rain. Same
    // TexturePacker-hash shape as flying-creeps.json. Returns ONLY the 8
    // moon frames — any frame whose name contains "comet" is skipped
    // (the 4 large comets are reserved for v1.1). null if absent.
    function loadSkyItemsSheet() {
        return fetch('assets/sprites/sky-items.json')
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (!json || !json.frames) return null;
                const moons = Object.keys(json.frames)
                    .filter(name => !/comet/i.test(name))
                    .map(name => {
                        const e = json.frames[name];
                        return (e && e.frame) ? e.frame : e;
                    })
                    .filter(f => f && f.w && f.h);
                if (!moons.length) return null;
                const meta = json.meta || {};
                const size = meta.size || {};
                return {
                    src: 'assets/sprites/sky-items.png',
                    sheetW: size.w || Math.max(...moons.map(f => f.x + f.w)),
                    sheetH: size.h || Math.max(...moons.map(f => f.y + f.h)),
                    moons
                };
            })
            .catch(() => null);
    }

    // Paint the .flying-creep-frame child to show VARIANT `vi` (static for
    // the whole appearance — frames are variants, not an animation cycle).
    function paintCreepVariant(child, vi) {
        if (!creepSheet) return;
        const f = creepSheet.frames[vi % creepSheet.frames.length];
        if (!f) return;
        // Same 1px crop inset as the head sheets — flying-creeps.png also
        // packs variants on a 2px gutter, so without the inset a scaled
        // background-position can bleed the neighbouring variant in at the
        // edges. Inset the source rect by FRAME_BLEED_INSET on every side.
        const b = CREEP_BLEED_INSET;
        const ix = f.x + b, iy = f.y + b, iw = f.w - 2 * b, ih = f.h - 2 * b;
        // Scale so the variant's longest (inset) side fills SIZE_PX.
        const scale = CREEP.SIZE_PX / Math.max(iw, ih);
        child.style.backgroundSize =
            `${creepSheet.sheetW * scale}px ${creepSheet.sheetH * scale}px`;
        child.style.backgroundPosition =
            `${-ix * scale}px ${-iy * scale}px`;
        child.style.width  = `${iw * scale}px`;
        child.style.height = `${ih * scale}px`;
    }

    function creepPlaceholderMarkup() {
        // Translucent drifting ghost + a tiny PLACEHOLDER tag so it's
        // obvious this isn't the final art. Replaced automatically the
        // moment assets/sprites/flying-creeps.{png,json} is dropped in.
        return ''
            + '<svg viewBox="0 0 100 120" width="100%" height="100%" '
            + 'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            +   '<defs><radialGradient id="crp" cx="50%" cy="40%" r="60%">'
            +     '<stop offset="0%" stop-color="#eaf6ff" stop-opacity="0.92"/>'
            +     '<stop offset="100%" stop-color="#9fb6d6" stop-opacity="0.55"/>'
            +   '</radialGradient></defs>'
            +   '<path d="M50 6 C26 6 14 26 14 50 L14 104 '
            +     'Q22 96 30 104 Q38 112 46 104 Q54 96 62 104 '
            +     'Q70 112 78 104 L86 104 86 50 C86 26 74 6 50 6 Z" '
            +     'fill="url(#crp)" stroke="#dfeaf7" stroke-width="2"/>'
            +   '<circle cx="38" cy="48" r="6.5" fill="#1a2330"/>'
            +   '<circle cx="62" cy="48" r="6.5" fill="#1a2330"/>'
            +   '<path d="M40 70 Q50 80 60 70" fill="none" '
            +     'stroke="#1a2330" stroke-width="3" stroke-linecap="round"/>'
            + '</svg>'
            + '<span class="flying-creep-ph">PLACEHOLDER</span>';
    }

    function buildCreepEl() {
        if (creepEl) return creepEl;
        creepEl = document.createElement('div');
        creepEl.className = 'flying-creep';
        creepEl.setAttribute('aria-hidden', 'true');
        creepEl.style.width = CREEP.SIZE_PX + 'px';
        creepEl.style.height = CREEP.SIZE_PX + 'px';
        creepEl.style.zIndex = String(CREEP.Z_INDEX);
        if (creepSheet) {
            // Real sheet: a child whose background we lock to one variant.
            const f = document.createElement('div');
            f.className = 'flying-creep-frame';
            f.style.backgroundImage = `url('${creepSheet.src}')`;
            creepEl.appendChild(f);
        } else {
            creepEl.innerHTML = creepPlaceholderMarkup();
        }
        creepEl.hidden = true;
        document.body.appendChild(creepEl);
        return creepEl;
    }

    function scheduleCreepSpawn(first) {
        if (!CREEP.ENABLED) return;
        clearTimeout(creepSpawnTimer);
        const lo = first ? CREEP.FIRST_SPAWN_MIN_MS : CREEP.SPAWN_MIN_MS;
        const hi = first ? CREEP.FIRST_SPAWN_MAX_MS : CREEP.SPAWN_MAX_MS;
        creepSpawnTimer = setTimeout(spawnCreep, rand(lo, hi));
    }

    function spawnCreep() {
        // Only ONE Flying Creep on screen at a time.
        if (!CREEP.ENABLED || creepActive || creepPaused) {
            scheduleCreepSpawn(false);
            return;
        }
        buildCreepEl();
        // Pick a variant uniformly from the loaded sheet (−1 = placeholder,
        // which has no variants and never counts toward "All Creeps").
        const variant = creepSheet
            ? Math.floor(Math.random() * creepSheet.frames.length)
            : -1;
        if (creepSheet) {
            const child = creepEl.querySelector('.flying-creep-frame');
            if (child) paintCreepVariant(child, variant);
            markCreepSeen(variant);
        }
        const vw = window.innerWidth, vh = window.innerHeight;
        const edge = ['left', 'right', 'top'][Math.floor(Math.random() * 3)];
        const speed = rand(CREEP.SPEED_MIN_PXPS, CREEP.SPEED_MAX_PXPS);
        const size = CREEP.SIZE_PX;
        // Cross roughly the vertical middle band of the viewport so the
        // path overlaps where Munkis stand near the bottom-ish stage.
        const midY = vh * rand(0.32, 0.6);
        let x, y, vx, vy = 0;
        if (edge === 'left')  { x = -size;       y = midY; vx =  speed; }
        else if (edge === 'right') { x = vw;     y = midY; vx = -speed; }
        else { /* top */      x = vw * rand(0.2, 0.8); y = -size; vx = (Math.random() < 0.5 ? -1 : 1) * speed * 0.5; vy = speed; }
        creepState = {
            x, y, vx, vy, baseY: y, edge, variant,
            tStart: performance.now(),
            stayMs: rand(CREEP.STAY_MIN_MS, CREEP.STAY_MAX_MS),
            leaving: false
        };
        creepActive = true;
        creepEl.hidden = false;
        creepEl.classList.add('flying-creep-in');
        creepLastTs = performance.now();
        if (!creepRAF) creepRAF = requestAnimationFrame(creepTick);
    }

    function endCreep() {
        creepActive = false;
        creepState = null;
        if (creepEl) {
            creepEl.hidden = true;
            creepEl.classList.remove('flying-creep-in');
        }
        // Clear any lingering flinch + scared-face state.
        document.querySelectorAll('.stage-slot.creep-scared')
            .forEach(s => s.classList.remove('creep-scared'));
        const wasScared = [...creepScaredSlots];
        creepScaredSlots.clear();
        wasScared.forEach(i => renderSlot(i));
        if (creepRAF) { cancelAnimationFrame(creepRAF); creepRAF = null; }
        scheduleCreepSpawn(false);
    }

    function slotCenters() {
        // Center point of every ACTIVE (occupied) stage slot, keyed by idx.
        const out = [];
        document.querySelectorAll('.stage-slot.active').forEach(el => {
            const i = parseInt(el.dataset.index, 10);
            if (Number.isNaN(i)) return;
            const r = el.getBoundingClientRect();
            out.push({ i, el, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
        });
        return out;
    }

    function creepTick(ts) {
        if (!creepActive || !creepState) { creepRAF = null; return; }
        if (creepPaused) { creepRAF = requestAnimationFrame(creepTick); creepLastTs = ts; return; }
        const dt = Math.min(0.05, (ts - creepLastTs) / 1000) || 0;
        creepLastTs = ts;
        const st = creepState;
        const elapsed = ts - st.tStart;

        // Motion: constant drift + gentle sine bob around the entry axis.
        st.x += st.vx * dt;
        st.y += (st.vy || 0) * dt;
        const wave = Math.sin((elapsed / CREEP.WAVE_PERIOD_MS) * Math.PI * 2)
                   * CREEP.WAVE_AMP_PX;
        const drawY = (st.edge === 'top' ? st.y : st.baseY + wave);
        creepEl.style.transform = `translate(${st.x}px, ${drawY}px)`;
        // Variant art is painted once at spawn (static — frames are
        // variants, not an animation cycle), so nothing to update here.

        // Proximity → flinch + fear, with CLOSE/FAR hysteresis.
        const sr = creepEl.getBoundingClientRect();
        const scx = sr.left + sr.width / 2, scy = sr.top + sr.height / 2;
        const live = new Set();
        slotCenters().forEach(({ i, el, cx, cy }) => {
            live.add(i);
            const d = Math.hypot(scx - cx, scy - cy);
            const cur = creepFear.get(i) || 0;
            if (d <= CREEP.CLOSE_PX) {
                el.classList.add('creep-scared');
                if (!creepScaredSlots.has(i)) { creepScaredSlots.add(i); renderSlot(i); }
                creepFear.set(i, Math.min(CREEP.FEAR_MAX,
                    cur + CREEP.FEAR_GAIN_PER_S * dt));
            } else {
                if (d >= CREEP.FAR_PX) {
                    el.classList.remove('creep-scared');
                    if (creepScaredSlots.delete(i)) renderSlot(i);
                    creepFear.set(i, Math.max(0,
                        cur - CREEP.FEAR_DECAY_PER_S * dt));
                }
                // Between CLOSE and FAR: hold (hysteresis, no flicker).
            }
        });
        // Drop fear for slots that emptied / changed under us.
        [...creepFear.keys()].forEach(i => { if (!live.has(i)) creepFear.delete(i); });

        // Fear → horror, with its own trigger/release hysteresis.
        let sum = 0;
        creepFear.forEach(v => { sum += v; });
        if (!fearHorrorActive && sum >= CREEP.HORROR_TRIGGER_SUM) {
            fearHorrorActive = true;
            syncHorrorMode();
            grantAchievement('creepWhisperer');
        } else if (fearHorrorActive && sum <= CREEP.HORROR_RELEASE_SUM) {
            fearHorrorActive = false;
            syncHorrorMode();
        }

        // Lifetime: the Creep drifts on its constant-velocity path and
        // ONLY despawns once it has fully left the viewport — it never
        // vanishes mid-stage on a timer. (90s watchdog is pure insurance
        // against a stuck state; a normal crossing is ~20–35s.)
        const off = st.x < -CREEP.SIZE_PX * 1.5 || st.x > window.innerWidth + CREEP.SIZE_PX * 1.5
                 || drawY > window.innerHeight + CREEP.SIZE_PX * 1.5;
        if (off) { endCreep(); return; }
        if (elapsed > 90000) { endCreep(); return; }

        creepRAF = requestAnimationFrame(creepTick);
    }

    function startCreepSystem() {
        if (!CREEP.ENABLED) return;
        loadCreepsSeen();
        loadCreepSheet().then(sheet => { creepSheet = sheet; });
        loadSkyItemsSheet().then(s => { skyItemsSheet = s; });
        scheduleCreepSpawn(true);
        // Pause drift + spawn while the app is backgrounded (battery; also
        // avoids a fear blast when the kid returns). Reuses the same
        // visibility signal watchVisibility() listens to.
        document.addEventListener('visibilitychange', () => {
            creepPaused = document.hidden;
            if (!document.hidden && creepActive && !creepRAF) {
                creepLastTs = performance.now();
                creepRAF = requestAnimationFrame(creepTick);
            }
        });
    }

    // ---------- CAPACITOR NATIVE BRIDGE (app build only) ----------
    // All feature-detected: on the plain web build window.Capacitor is
    // undefined and every call below is a silent no-op.
    function capPlugin(name) {
        const C = window.Capacitor;
        if (!C || !C.Plugins) return null;
        return C.Plugins[name] || null;
    }
    function isNativeApp() {
        return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
                  window.Capacitor.isNativePlatform());
    }
    function setupNativeChrome() {
        if (!isNativeApp()) return;
        const StatusBar = capPlugin('StatusBar');
        if (StatusBar) {
            try { StatusBar.setStyle({ style: 'DARK' }); } catch (_) {}
            try { StatusBar.setBackgroundColor({ color: '#0c0c1a' }); } catch (_) {}
            try { StatusBar.setOverlaysWebView({ overlay: false }); } catch (_) {}
        }
        const SplashScreen = capPlugin('SplashScreen');
        if (SplashScreen) {
            setTimeout(() => { try { SplashScreen.hide(); } catch (_) {} }, 350);
        }
    }
    function mirrorProgressToPrefs() {
        if (!isNativeApp()) return;
        const Preferences = capPlugin('Preferences');
        if (!Preferences) return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw != null) Preferences.set({ key: STORAGE_KEY, value: raw });
        } catch (_) { /* ignore */ }
    }
    async function rehydrateProgressFromPrefs() {
        if (!isNativeApp()) return;
        const Preferences = capPlugin('Preferences');
        if (!Preferences) return;
        try {
            const cur = localStorage.getItem(STORAGE_KEY);
            if (cur != null) return;
            const { value } = await Preferences.get({ key: STORAGE_KEY });
            if (value) localStorage.setItem(STORAGE_KEY, value);
        } catch (_) { /* ignore */ }
    }

    // ---------- INIT ----------
    async function init() {
        await rehydrateProgressFromPrefs();
        loadProgress();
        setupNativeChrome();
        window.addEventListener('all-munkis-progress-saved', mirrorProgressToPrefs);
        // Make sure the 7th slot reflects the persisted seventhWheel (ice
        // by default, moon if the kid swapped) before the first renderTray.
        syncBankWithSeventhWheel();
        buildStage();
        renderTray();
        renderAllSlots();
        attachTrayHandlers();
        attachSlotHandlers();
        attachHeaderHandlers();
        attachMoonChaos();
        attachEggDetectors();
        attachOutsiderTapDetector();
        attachCounterPanelToggle();
        watchTrayHeight();
        watchVisibility();
        startCreepSystem();
        updateTrayHint();
        // If Moon is unlocked, surface the altar chip so the kid can swap.
        renderMunkiAltar();
        // If the kid found any eggs on a prior visit, restore the counter
        // chip with the saved count (no animation — it's not "new").
        if (achievements.size > 0 || moonUnlocked) {
            showEggCounter();
            bumpEggCounter();
        }
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
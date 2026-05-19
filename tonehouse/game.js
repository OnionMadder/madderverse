/* ===================================================================
 * TONEHOUSE — standalone playground for the All Munkis audio engine.
 *
 * The audio engine below (AudioContext setup, the "Tale of Two Clocks"
 * scheduler, BASE_SONG, the Tone.js ambient layer, and the 8 Munki
 * voices) is a FAITHFUL extraction from:
 *   madderverse/all-munkis/game.js
 * Nothing about the sound generation was rewritten — only the
 * game/stage wiring was replaced with the realtime mixer UI and the
 * oscilloscope / spectrum / activity visualizations.
 * =================================================================== */
(() => {
    'use strict';

    // ---------- CONFIG ----------
    // TEMPO is `let` here (the original is a const) so the BPM slider can
    // retune the scheduler live. Everything that needs step/bar timing
    // reads secondsPerStep() instead of a baked constant.
    let TEMPO = 100;                           // BPM (slider, 60–160)
    const STEPS_PER_BAR = 16;                  // sixteenth notes
    // Same Tale-of-Two-Clocks scheduler as All Munkis, but the look-ahead
    // window is widened. All Munkis runs one foreground tab; Tonehouse's
    // headline feature is running it in TWO tabs at once, and a background
    // tab clamps setTimeout to >=1000ms. With only 0.1s of look-ahead the
    // backgrounded tab's scheduler starves and its voices cut out. A 1.5s
    // horizon keeps the second tab playing. Notes still fire at their exact
    // `when` times — only how far ahead they're queued changes.
    const LOOKAHEAD_MS = 200;
    const SCHEDULE_AHEAD = 1.5;
    const BARS_PER_LOOP = 4;                    // I-vi-IV-V (Cmaj, Am, Fmaj, G)
    // tapeFactor (T4 TAPE STOP) stretches the step interval toward infinity
    // as the "tape" slows. Clamped so the scheduler can't divide by zero.
    function secondsPerStep() { return 60 / (TEMPO * Math.max(0.02, tapeFactor)) / 4; }
    function barLen() { return secondsPerStep() * STEPS_PER_BAR; }

    // ---------- AUDIO ENGINE STATE ----------
    let audioCtx = null;
    let masterGain = null;
    let analyser = null;            // master-bus tap for the scope/spectrum
    let isPlaying = false;
    let isBaseSongOn = true;        // Bala's Theme backing bed
    let isToneLayerOn = true;       // Tone.js ambient pad/bell/hat
    let currentStep = 0;
    let currentBar = 0;
    let nextStepTime = 0;
    let schedTimer = null;

    // Per-voice routing: every Munki voice plays into its own GainNode
    // (its attenuation slider) which feeds masterGain. A second tiny
    // AnalyserNode per voice drives the activity dot — this keeps the
    // ported play() functions byte-for-byte identical (they just take an
    // `out` node like they always did).
    const voiceGain = {};           // id -> GainNode (slider level)
    const voiceMeter = {};          // id -> AnalyserNode (activity dot)
    const voiceLevel = {};          // id -> 0..1 user attenuation
    let baseGain = null;            // BASE_SONG output bus

    const enabled = new Set();      // voices toggled ON
    const mutedSet = new Set();     // voices MUTEd
    const soloSet = new Set();      // voices SOLOed
    let userMaster = 0.55;          // master slider (engine default 0.55)
    let toneAmbientLevel = 0.55;    // Tone bus level (engine default 0.55)

    // Tone.js layer handles (built once in buildToneLayer)
    let toneReady = false;
    let toneBus = null;             // the Tone.Reverb (its .wet is the ambient reverb knob)
    let tonePad = null;
    let toneBell = null;
    let toneHat = null;
    let toneBusGain = null;         // the ambient level control

    // ---------- T2: BUILT-IN HARMONY LAYER ----------
    // When ON, the WHOLE engine (BASE_SONG + the 8 voices) is scheduled a
    // SECOND time, time-offset and detuned, through its own reverb send —
    // the built-in version of the accidental two-tab harmony. Same play()
    // functions, same scheduler tick; only `when` and oscillator detune
    // differ. This is the Bala's-Song-Layering prototype for All Munkis v1.1.
    let harmonyOn = false;
    let harmonyOffset = 1.0;        // seconds (-2.0 .. +2.0)
    let harmonyDetune = -8;         // cents   (-50 .. +50) — the FF tuning
    let harmonyReverbWet = 0.5;     // 0 .. 1
    const harmonyVoiceGain = {};    // id -> GainNode (harmony bus, mirrors voiceGain)
    // Per-voice channel: 'main' | 'harm' | 'both'. Default main — harmony
    // is opt-in per voice (detuning every voice muddied the mix).
    const voiceChannel = {};
    let harmonyBaseGain = null;
    let harmonySum = null;          // harmony layer sum bus
    let harmonyWet = null;          // harmony reverb send level

    // ---------- T3: MASTER FX RACK ----------
    let masterPitchSemis = 0;       // -12 .. +12 (global oscillator detune)
    let fxFilter = null;            // global lowpass (cutoff + Q)
    let fxDelay = null;             // global feedback delay
    let fxFeedback = null;
    let fxDelayWet = null;
    let fxCutoff = 20000;           // Hz
    let fxQ = 0.7;
    let fxDelayTime = 0.0;          // s
    let fxDelayFb = 0.0;            // 0 .. 0.95
    let fxDelayLevel = 0.0;         // 0 .. 1

    // ---------- T4: CHAOS ----------
    let tapeFactor = 1;             // 1 = normal, ->~0 = tape stopped
    let tapeAnim = null;            // rAF id for the tape ramp
    let holdActive = false;         // freeze the scheduler's step pointer

    // Pitch/detune in cents that applies to EVERY oscillator the verbatim
    // play() functions create. tapeFactor also bends pitch down as the
    // "tape" slows (1200*log2(speed)). Per-voice pitch (T5) adds on top.
    function tapeCents() { return 1200 * Math.log2(Math.max(0.02, tapeFactor)); }
    function baseMainCents()  { return masterPitchSemis * 100 + tapeCents(); }
    function baseHarmCents()  { return baseMainCents() + harmonyDetune; }
    function voiceMainCents(id) { return baseMainCents() + (voicePitch[id] || 0) * 100; }
    function voiceHarmCents(id) { return voiceMainCents(id) + harmonyDetune; }

    // A Proxy around audioCtx whose createOscillator() injects a live
    // detune offset. Everything else passes straight through. This is how
    // pitch shift / detune reach oscillators born inside the untouched
    // engine code without editing a single play() function.
    function detuneProxy(getCents) {
        return new Proxy(audioCtx, {
            get(t, p) {
                if (p === 'createOscillator') {
                    return () => {
                        const o = t.createOscillator();
                        o.detune.value += getCents();
                        return o;
                    };
                }
                const v = t[p];
                return typeof v === 'function' ? v.bind(t) : v;
            }
        });
    }
    const proxMain = {};            // id -> proxy ctx (main layer)
    const proxHarm = {};            // id -> proxy ctx (harmony layer)
    let proxBaseMain = null, proxBaseHarm = null;

    // ---------- T5: PER-VOICE EXTRAS ----------
    const voicePan = {};            // id -> -1 .. +1
    const voicePitch = {};          // id -> -12 .. +12 semitones
    const voicePanNode = {};        // id -> StereoPannerNode (main)
    const harmonyPanNode = {};      // id -> StereoPannerNode (harmony)

    // ---------- MODE ('studio'=HARMONY | 'toy'=COOP | 'twin') ----------
    let mode = 'studio';

    // ---------- TRUE TWIN — a genuine second AudioContext ----------
    // Two browser tabs sound lush because each has its OWN hardware audio
    // clock; the two drift a few ppm apart forever so the phase never
    // settles. We recreate that exactly: a second AudioContext running an
    // independent engine instance. No detune, no fixed offset — the
    // free-running clock drift is the whole effect.
    let twinCtx = null;
    let twinMaster = null;
    let twinPlaying = false;
    let twinTimer = null;
    let twinStep = 0, twinBar = 0, twinNext = 0;
    let twinLevel = 0.55;
    function twinSecondsPerStep() { return 60 / TEMPO / 4; }  // tempo-only, no tape/hold

    // ---------- T6: COOP (kids around a tablet) ----------
    let toyOn = false;              // legacy flag (true when in COOP screen)
    let toyLayout = '2p';           // '2p' | 'solo'
    let bowserEnabled = false;      // 3rd-player chaos strip
    let toyChoke = null;            // shared choke gain for CUT-OFF
    let cutOffShared = false;       // shared interrupt rule
    const quantize = { p1: true, p2: true, solo: true };
    // Which player owns each voice in 2-player mode.
    const toyOwner = {
        red: 'p1', orange: 'p1', yellow: 'p1', green: 'p1',
        blue: 'p2', purple: 'p2', moon: 'p2', ice: 'p2'
    };
    // The step each voice actually makes sound on, so a tap always fires
    // audibly (the engine voices are gated to specific steps).
    const TRIGGER_STEP = {
        red: 0, orange: 4, yellow: 0, green: 0,
        blue: 0, purple: 2, moon: 0, ice: 3
    };

    // ---------- AUDIO BOOT ----------
    // Same AudioContext + master compressor chain as All Munkis, plus an
    // AnalyserNode tapped right before destination for the visualizers.
    function ensureAudio() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = userMaster;
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -10;
            comp.knee.value = 8;
            comp.ratio.value = 6;
            comp.attack.value = 0.004;
            comp.release.value = 0.15;
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;

            // ---- T3 master FX: masterGain -> filter -> (dry + delay)
            //      -> compressor -> analyser -> speakers ----
            fxFilter = audioCtx.createBiquadFilter();
            fxFilter.type = 'lowpass';
            fxFilter.frequency.value = fxCutoff;
            fxFilter.Q.value = fxQ;
            fxDelay = audioCtx.createDelay(1.0);
            fxDelay.delayTime.value = fxDelayTime;
            fxFeedback = audioCtx.createGain();
            fxFeedback.gain.value = fxDelayFb;
            fxDelayWet = audioCtx.createGain();
            fxDelayWet.gain.value = fxDelayLevel;

            masterGain.connect(fxFilter);
            fxFilter.connect(comp);                 // dry path
            fxFilter.connect(fxDelay);
            fxDelay.connect(fxFeedback);
            fxFeedback.connect(fxDelay);            // feedback loop
            fxDelay.connect(fxDelayWet);
            fxDelayWet.connect(comp);               // wet path
            comp.connect(analyser).connect(audioCtx.destination);

            // ---- T2 harmony layer reverb send: harmonySum -> (dry +
            //      convolver) -> masterGain (so it also gets master FX) ----
            harmonySum = audioCtx.createGain();
            const harmonyDry = audioCtx.createGain();
            harmonyDry.gain.value = 1;
            const harmonyConv = audioCtx.createConvolver();
            harmonyConv.buffer = makeImpulse(audioCtx, 2.6, 3.2);
            harmonyWet = audioCtx.createGain();
            harmonyWet.gain.value = harmonyReverbWet;
            harmonySum.connect(harmonyDry).connect(masterGain);
            harmonySum.connect(harmonyConv).connect(harmonyWet).connect(masterGain);

            baseGain = audioCtx.createGain();
            baseGain.gain.value = 1;
            baseGain.connect(masterGain);

            // T6 toy pads sum here; CUT-OFF chokes this node so a new tap
            // silences the previous tail. Routes through masterGain so the
            // FX rack still colours the jam.
            toyChoke = audioCtx.createGain();
            toyChoke.gain.value = 0.92;
            toyChoke.connect(masterGain);
            harmonyBaseGain = audioCtx.createGain();
            harmonyBaseGain.gain.value = 1;
            harmonyBaseGain.connect(harmonySum);

            // Per voice: gain -> pan -> bus, plus a meter tap for the dot.
            Object.keys(CHARACTERS).forEach(id => {
                const g = audioCtx.createGain();
                g.gain.value = voiceLevel[id];
                const pan = audioCtx.createStereoPanner();
                pan.pan.value = voicePan[id] || 0;
                const m = audioCtx.createAnalyser();
                m.fftSize = 256;
                g.connect(m);
                g.connect(pan).connect(masterGain);
                voiceGain[id] = g;
                voicePanNode[id] = pan;
                voiceMeter[id] = m;

                // Harmony-bus twin for this voice (used when its channel
                // is 'harm' or 'both'): own gain + pan -> harmonySum.
                const hg = audioCtx.createGain();
                hg.gain.value = voiceLevel[id];
                const hpan = audioCtx.createStereoPanner();
                hpan.pan.value = voicePan[id] || 0;
                hg.connect(hpan).connect(harmonySum);
                harmonyVoiceGain[id] = hg;
                harmonyPanNode[id] = hpan;
            });

            // Build the detune proxies once (they read live state lazily).
            proxBaseMain = detuneProxy(baseMainCents);
            proxBaseHarm = detuneProxy(baseHarmCents);
            Object.keys(CHARACTERS).forEach(id => {
                proxMain[id] = detuneProxy(() => voiceMainCents(id));
                proxHarm[id] = detuneProxy(() => voiceHarmCents(id));
            });

            buildToneLayer(); // no-op if Tone.js failed to load
        }
        // Return a promise that resolves once the context is actually
        // running. A freshly created AudioContext is 'suspended' under
        // browser autoplay policy even inside a click gesture, and its
        // currentTime stays frozen until resume() resolves — so the
        // scheduler MUST wait for this before anchoring its clock.
        return audioCtx.state === 'suspended'
            ? audioCtx.resume()
            : Promise.resolve();
    }

    // Binds Tone.js to our existing audioCtx so its scheduler shares the
    // same clock as the raw-WebAudio scheduler, then builds the ambient
    // instruments (pad / bell / hat). Faithful port of All Munkis'
    // buildToneLayer (the react-mode sub-bass drone is omitted: react
    // mode is an All Munkis gameplay concept with no standalone analog).
    function buildToneLayer() {
        if (typeof Tone === 'undefined' || toneReady) return;
        try {
            Tone.setContext(audioCtx);
        } catch (e) {
            try { Tone.setContext(new Tone.Context({ context: audioCtx })); }
            catch (e2) { return; }
        }
        const reverb = new Tone.Reverb({ decay: 3.4, preDelay: 0.04, wet: 0.35 });
        const delay  = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.22, wet: 0.22 });
        toneBusGain = new Tone.Gain(toneAmbientLevel);
        reverb.connect(delay);
        delay.connect(toneBusGain);
        Tone.connect(toneBusGain, masterGain);
        toneBus = reverb;

        tonePad = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'fatsine', count: 3, spread: 22 },
            envelope: { attack: 0.45, decay: 0.35, sustain: 0.65, release: 1.4 },
            volume: -22
        });
        tonePad.connect(toneBus);

        toneBell = new Tone.FMSynth({
            harmonicity: 2,
            modulationIndex: 11,
            envelope:           { attack: 0.002, decay: 0.5, sustain: 0, release: 0.7 },
            modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.7 },
            volume: -16
        });
        toneBell.connect(toneBus);

        toneHat = new Tone.MetalSynth({
            envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
            harmonicity: 5.1, modulationIndex: 32, resonance: 4200, octaves: 1.5,
            volume: -32
        });
        Tone.connect(toneHat, masterGain);

        toneReady = true;
    }

    // ---------- THE "TALE OF TWO CLOCKS" SCHEDULER ----------
    // Verbatim from All Munkis: a setTimeout look-ahead loop that posts
    // sample-accurate events onto the WebAudio clock.
    function schedule() {
        if (!isPlaying) return;
        while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
            scheduleStep(currentStep, currentBar, nextStepTime);
            nextStepTime += secondsPerStep();
            // T4 HOLD: while held, the step pointer is frozen so the
            // current step keeps re-triggering — catches a moment.
            if (!holdActive) {
                currentStep++;
                if (currentStep >= STEPS_PER_BAR) {
                    currentStep = 0;
                    currentBar = (currentBar + 1) % BARS_PER_LOOP;
                }
            }
        }
        schedTimer = setTimeout(schedule, LOOKAHEAD_MS);
    }

    function isVoiceAudible(id) {
        if (!enabled.has(id)) return false;
        if (soloSet.size > 0) return soloSet.has(id);
        return !mutedSet.has(id);
    }

    function scheduleStep(step, bar, when) {
        // Main layer — engine code untouched; the proxy ctx injects the
        // global pitch / tape bend into every oscillator it creates.
        if (isBaseSongOn) BASE_SONG.play(proxBaseMain, baseGain, when, step, bar);
        if (isToneLayerOn) TONE_LAYER.play(step, bar, when);
        // Per-voice channel routing. Each voice goes to the MAIN bus, the
        // HARMONY bus (time-offset + extra detune + harmony reverb), or
        // BOTH — independent of the global Harmony toggle (which only
        // doubles the base melody). Default is 'main'.
        const hw = Math.max(audioCtx.currentTime + 0.005, when + harmonyOffset);
        Object.keys(CHARACTERS).forEach(id => {
            if (!isVoiceAudible(id)) return;
            const ch = CHARACTERS[id];
            if (!ch || !ch.play) return;
            const c = voiceChannel[id] || 'main';
            if (c !== 'harm') ch.play(proxMain[id], voiceGain[id], when, step);
            if (c !== 'main') ch.play(proxHarm[id], harmonyVoiceGain[id], hw, step);
        });

        // Global Harmony toggle doubles Bala's Theme (the base melody/bed)
        // through the harmony bus. Voices follow their own channel above.
        if (harmonyOn && isBaseSongOn) {
            BASE_SONG.play(proxBaseHarm, harmonyBaseGain, hw, step, bar);
        }
    }

    // Decaying-noise impulse response for the harmony layer's ConvolverNode.
    function makeImpulse(ctx, seconds, decay) {
        const rate = ctx.sampleRate;
        const len = Math.floor(rate * seconds);
        const buf = ctx.createBuffer(2, len, rate);
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < len; i++) {
                d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
            }
        }
        return buf;
    }

    // ---------- SYNTH HELPERS (verbatim) ----------
    function noiseSource(ctx, dur) {
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        return src;
    }

    // ---------- BASE SONG (verbatim) ----------
    // Bala's Theme — a 4-bar I-vi-IV-V loop (Cmaj -> Am -> Fmaj -> G).
    const BASE_SONG = {
        chordsByBar: [
            { bass: 65.41, triad: [261.63, 329.63, 392.00], melody: { 0: 783.99, 4: 659.25, 8: 523.25, 12: 659.25 } }, // Cmaj
            { bass: 55.00, triad: [220.00, 261.63, 329.63], melody: { 0: 440.00, 4: 523.25, 8: 659.25, 12: 392.00 } }, // Am
            { bass: 87.31, triad: [174.61, 220.00, 261.63], melody: { 0: 440.00, 4: 349.23, 8: 440.00, 12: 523.25 } }, // Fmaj
            { bass: 98.00, triad: [196.00, 246.94, 293.66], melody: { 0: 493.88, 4: 392.00, 8: 493.88, 12: 587.33 } }  // G
        ],
        play(ctx, out, when, step, bar) {
            const cb = this.chordsByBar[bar];
            if (!cb) return;
            const BAR_LEN = barLen();

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

    // ---------- TONE LAYER (verbatim) ----------
    const TONE_LAYER = {
        chordsByBar: [
            ['C4', 'E4', 'G4'],
            ['A3', 'C4', 'E4'],
            ['F3', 'A3', 'C4'],
            ['G3', 'B3', 'D4']
        ],
        play(step, bar, when) {
            if (!toneReady) return;
            const BAR_LEN = barLen();
            if (step === 0) {
                const chord = this.chordsByBar[bar];
                if (chord) tonePad.triggerAttackRelease(chord, BAR_LEN * 0.92, when);
            }
            if (step === 2 || step === 10) {
                toneHat.triggerAttackRelease('C5', '32n', when);
            }
            if (bar === 2 && step === 0) {
                toneBell.triggerAttackRelease('C6', '2n', when + 0.04);
            }
            if (bar === 3 && step === 12) {
                toneBell.triggerAttackRelease('E6', '4n', when);
            }
        }
    };

    // ---------- THE 8 MUNKI VOICES (verbatim) ----------
    // Red, Orange, Yellow, Green, Blue, Purple, Moon, Ice — ported
    // exactly from All Munkis CHARACTERS. The Madballz roster is not
    // included (dormant in the source, out of scope here).
    const CHARACTERS = {
        red: {
            label: 'Red', color: '#dc2626',
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
            label: 'Orange', color: '#ff9800',
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
            label: 'Yellow', color: '#fbbf24',
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
            label: 'Green', color: '#43a047',
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
            label: 'Blue', color: '#1e88e5',
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
            label: 'Purple', color: '#9c27b0',
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
            label: 'Moon', color: '#a78bfa',
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
            label: 'Ice', color: '#67e8f9',
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
        }
    };

    const VOICE_IDS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'moon', 'ice'];
    VOICE_IDS.forEach(id => { voiceLevel[id] = 0.9; enabled.add(id); });

    // ===================================================================
    //  STANDALONE UI  (not part of the engine — the "mess with it" layer)
    // ===================================================================
    function $(sel) { return document.querySelector(sel); }

    function startPlayback() {
        if (isPlaying) return;
        isPlaying = true;                   // set early so a double-tap is a no-op
        document.body.classList.add('playing');
        $('#playBtn').textContent = 'PLAYING';
        // ensureAudio() must run inside this user gesture; the scheduler
        // is only armed AFTER resume() resolves so nextStepTime is
        // anchored to a live clock (not a frozen suspended-context one).
        ensureAudio().then(() => {
            if (!isPlaying) return;         // user hit STOP during resume
            // Recover master gain in case PANIC ramped it to 0.
            masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
            masterGain.gain.setValueAtTime(userMaster, audioCtx.currentTime);
            currentStep = 0;
            currentBar = 0;
            nextStepTime = audioCtx.currentTime + 0.12;
            schedule();
        });
        // TRUE TWIN: also boot the genuine 2nd context (two real instances
        // = the authentic two-tab effect, in one page).
        if (mode === 'twin') startTwin();
    }

    function stopPlayback() {
        isPlaying = false;
        if (schedTimer) { clearTimeout(schedTimer); schedTimer = null; }
        if (audioCtx) audioCtx.suspend();
        stopTwin();
        document.body.classList.remove('playing');
        $('#playBtn').textContent = 'PLAY';
        $('#twinPlay') && ($('#twinPlay').textContent = 'PLAY');
    }

    // ---------- TRUE TWIN engine: independent AudioContext ----------
    function ensureTwin() {
        if (!twinCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            twinCtx = new Ctx();                         // its OWN hardware clock
            twinMaster = twinCtx.createGain();
            twinMaster.gain.value = twinLevel;
            const comp = twinCtx.createDynamicsCompressor();
            comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6;
            comp.attack.value = 0.004; comp.release.value = 0.15;
            twinMaster.connect(comp).connect(twinCtx.destination);
        }
        return twinCtx.state === 'suspended' ? twinCtx.resume() : Promise.resolve();
    }

    function twinScheduleStep(step, bar, when) {
        // Raw engine on the twin's own clock — no proxy, no detune, no
        // offset. Mirrors the HARMONY tab's voice/bed enablement so it's
        // "the same song in another tab". Drift does the rest.
        if (isBaseSongOn) BASE_SONG.play(twinCtx, twinMaster, when, step, bar);
        Object.keys(CHARACTERS).forEach(id => {
            if (!isVoiceAudible(id)) return;
            const ch = CHARACTERS[id];
            if (ch && ch.play) ch.play(twinCtx, twinMaster, when, step);
        });
    }

    function twinSchedule() {
        if (!twinPlaying) return;
        while (twinNext < twinCtx.currentTime + SCHEDULE_AHEAD) {
            twinScheduleStep(twinStep, twinBar, twinNext);
            twinNext += twinSecondsPerStep();
            twinStep++;
            if (twinStep >= STEPS_PER_BAR) {
                twinStep = 0;
                twinBar = (twinBar + 1) % BARS_PER_LOOP;
            }
        }
        twinTimer = setTimeout(twinSchedule, LOOKAHEAD_MS);
    }

    function startTwin() {
        if (twinPlaying) return;
        twinPlaying = true;
        $('#twinPlay') && ($('#twinPlay').textContent = 'PLAYING');
        ensureTwin().then(() => {
            if (!twinPlaying) return;
            twinMaster.gain.cancelScheduledValues(twinCtx.currentTime);
            twinMaster.gain.setValueAtTime(twinLevel, twinCtx.currentTime);
            twinStep = 0; twinBar = 0;
            // small random phase seed; the free-running clock drift evolves
            // it from there forever.
            twinNext = twinCtx.currentTime + 0.12 + Math.random() * 0.45;
            twinSchedule();
        });
    }

    function stopTwin() {
        twinPlaying = false;
        if (twinTimer) { clearTimeout(twinTimer); twinTimer = null; }
        if (twinCtx) twinCtx.suspend();
    }

    // Kick the twin to a fresh random phase (its clock keeps drifting from
    // there) — for when you want a different beat-against-beat character.
    function reseedTwin() {
        if (!twinPlaying || !twinCtx) return;
        twinStep = 0; twinBar = 0;
        twinNext = twinCtx.currentTime + 0.05 +
                   Math.random() * twinSecondsPerStep() * STEPS_PER_BAR;
    }

    function buildConsole() {
        const tbody = $('#voiceRows');
        VOICE_IDS.forEach(id => {
            const ch = CHARACTERS[id];
            const row = document.createElement('div');
            row.className = 'voice-row';
            row.style.setProperty('--vc', ch.color);
            row.innerHTML = `
                <span class="dot" data-dot="${id}"></span>
                <button class="toggle on" data-toggle="${id}"
                        aria-pressed="true">${ch.label}</button>
                <button class="mini" data-mute="${id}"
                        aria-label="${ch.label} mute" aria-pressed="false">M</button>
                <button class="mini" data-solo="${id}"
                        aria-label="${ch.label} solo" aria-pressed="false">S</button>
                <button class="mini chan" data-chan="${id}"
                        aria-label="${ch.label} channel: Main, Harmony, or Both"
                        title="channel — tap to cycle Main / Harmony / Both">M</button>
                <input class="gain" type="range" min="0" max="1" step="0.01"
                       value="${voiceLevel[id]}" data-gain="${id}"
                       aria-label="${ch.label} gain">
                <input class="xtra" type="range" min="-1" max="1" step="0.05"
                       value="0" data-pan="${id}" aria-label="${ch.label} pan">
                <input class="xtra" type="range" min="-12" max="12" step="1"
                       value="0" data-vpitch="${id}" aria-label="${ch.label} pitch">
            `;
            tbody.appendChild(row);
        });

        tbody.addEventListener('click', e => {
            const t = e.target;
            const set = (s, k, on) => { s[on ? 'add' : 'delete'](k); };
            if (t.dataset.toggle) {
                const id = t.dataset.toggle, on = !enabled.has(id);
                set(enabled, id, on);
                t.classList.toggle('on', on);
                t.setAttribute('aria-pressed', String(on));
            } else if (t.dataset.mute) {
                const id = t.dataset.mute, on = !mutedSet.has(id);
                set(mutedSet, id, on);
                t.classList.toggle('active', on);
                t.setAttribute('aria-pressed', String(on));
            } else if (t.dataset.solo) {
                const id = t.dataset.solo, on = !soloSet.has(id);
                set(soloSet, id, on);
                t.classList.toggle('active', on);
                t.setAttribute('aria-pressed', String(on));
            } else if (t.dataset.chan) {
                const id = t.dataset.chan;
                const order = ['main', 'harm', 'both'];
                const next = order[(order.indexOf(voiceChannel[id] || 'main') + 1) % 3];
                voiceChannel[id] = next;
                t.textContent = { main: 'M', harm: 'H', both: 'B' }[next];
                t.classList.toggle('ch-h', next === 'harm');
                t.classList.toggle('ch-b', next === 'both');
                t.setAttribute('aria-label',
                    CHARACTERS[id].label + ' channel: ' +
                    { main: 'Main', harm: 'Harmony', both: 'Both' }[next]);
            }
        });

        tbody.addEventListener('input', e => {
            const d = e.target.dataset, v = parseFloat(e.target.value);
            if (d.gain) {
                voiceLevel[d.gain] = v;
                if (voiceGain[d.gain]) voiceGain[d.gain].gain.value = v;
                if (harmonyVoiceGain[d.gain]) harmonyVoiceGain[d.gain].gain.value = v;
            } else if (d.pan) {
                voicePan[d.pan] = v;
                if (voicePanNode[d.pan]) voicePanNode[d.pan].pan.value = v;
                if (harmonyPanNode[d.pan]) harmonyPanNode[d.pan].pan.value = v;
            } else if (d.vpitch) {
                voicePitch[d.vpitch] = v;   // read live by the detune proxy
            }
        });
    }

    // Generic slider wiring: applies `onset(value)` + writes the value chip.
    function wireSlider(id, valId, fmt, onset) {
        const el = $('#' + id);
        if (!el) return;
        el.addEventListener('input', () => {
            const v = parseFloat(el.value);
            if (valId) $('#' + valId).textContent = fmt ? fmt(v) : v;
            onset(v);
        });
    }
    // Set a slider from code (RANDOMIZE/INVERT) and fire its handler.
    function setSlider(id, v) {
        const el = $('#' + id);
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event('input'));
    }

    function wireControls() {
        // ---- Tabs (MIXER / FX / CHAOS) ----
        document.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.tab;
                document.querySelectorAll('[data-tab]').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('on', on);
                    b.setAttribute('aria-selected', String(on));
                });
                document.querySelectorAll('[data-panel]').forEach(p => {
                    p.hidden = p.dataset.panel !== name;
                });
            });
        });

        // ---- Transport ----
        $('#playBtn').addEventListener('click', startPlayback);
        $('#stopBtn').addEventListener('click', stopPlayback);

        const harmBtns = ['#harmonyToggle'];
        harmBtns.forEach(sel => $(sel) && $(sel).addEventListener('click', e => {
            harmonyOn = !harmonyOn;
            harmBtns.forEach(s => {
                const b = $(s);
                b.classList.toggle('on', harmonyOn);
                b.setAttribute('aria-pressed', String(harmonyOn));
                b.textContent = 'Harmony: ' + (harmonyOn ? 'ON' : 'OFF');
            });
        }));

        $('#baseToggle').addEventListener('click', e => {
            isBaseSongOn = !isBaseSongOn;
            e.target.classList.toggle('on', isBaseSongOn);
            e.target.setAttribute('aria-pressed', String(isBaseSongOn));
            e.target.textContent = 'Bala’s Theme: ' + (isBaseSongOn ? 'ON' : 'OFF');
        });
        $('#toneToggle').addEventListener('click', e => {
            isToneLayerOn = !isToneLayerOn;
            e.target.classList.toggle('on', isToneLayerOn);
            e.target.setAttribute('aria-pressed', String(isToneLayerOn));
            e.target.textContent = 'Ambient Layer: ' + (isToneLayerOn ? 'ON' : 'OFF');
        });

        // ---- Levels / BED ----
        wireSlider('masterGain', 'masterVal', v => v.toFixed(2), v => {
            userMaster = v;
            if (masterGain) {
                masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
                masterGain.gain.setValueAtTime(v, audioCtx.currentTime);
            }
        });
        wireSlider('ambientLevel', 'ambientVal', v => v.toFixed(2), v => {
            toneAmbientLevel = v;
            if (toneBusGain) toneBusGain.gain.value = v;
        });

        // ---- T2 harmony sliders ----
        wireSlider('harmOffset', 'harmOffsetVal', v => v.toFixed(2) + 's', v => harmonyOffset = v);
        wireSlider('harmDetune', 'harmDetuneVal', v => v + '¢', v => harmonyDetune = v);
        wireSlider('harmWet', 'harmWetVal', v => v.toFixed(2), v => {
            harmonyReverbWet = v;
            if (harmonyWet) harmonyWet.gain.value = v;
        });

        // ---- T3 master FX ----
        wireSlider('bpm', 'bpmVal', v => v, v => TEMPO = v);
        wireSlider('mPitch', 'mPitchVal', v => (v > 0 ? '+' : '') + v, v => masterPitchSemis = v);
        // Filter cutoff slider is 0..1 mapped log (80Hz..20kHz) so the
        // musically useful low-mid sweep isn't crushed into 1% of travel.
        const cutHz = t => 80 * Math.pow(20000 / 80, t);
        wireSlider('fxCut', 'fxCutVal', t => Math.round(cutHz(t)) + 'Hz', t => {
            fxCutoff = cutHz(t);
            if (fxFilter) fxFilter.frequency.value = fxCutoff;
        });
        wireSlider('fxQ', 'fxQVal', v => v.toFixed(1), v => {
            fxQ = v;
            if (fxFilter) fxFilter.Q.value = v;
        });
        wireSlider('fxDelayT', 'fxDelayTVal', v => v.toFixed(2) + 's', v => {
            fxDelayTime = v;
            if (fxDelay) fxDelay.delayTime.value = v;
        });
        wireSlider('fxDelayFb', 'fxDelayFbVal', v => v.toFixed(2), v => {
            fxDelayFb = v;
            if (fxFeedback) fxFeedback.gain.value = v;
        });
        wireSlider('fxDelayLvl', 'fxDelayLvlVal', v => v.toFixed(2), v => {
            fxDelayLevel = v;
            if (fxDelayWet) fxDelayWet.gain.value = v;
        });
        wireSlider('ambWet', 'ambWetVal', v => v.toFixed(2), v => {
            if (toneBus && toneBus.wet) toneBus.wet.value = v;
        });

        wireChaos();
    }

    // ---------- T4: CHAOS ----------
    function panic() {
        // Kill the twin too — it's a separate context the master gain
        // can't reach.
        if (twinCtx && twinMaster) {
            const tt = twinCtx.currentTime;
            twinMaster.gain.cancelScheduledValues(tt);
            twinMaster.gain.setValueAtTime(twinMaster.gain.value, tt);
            twinMaster.gain.linearRampToValueAtTime(0, tt + 0.05);
        }
        if (!audioCtx || !masterGain) { stopPlayback(); return; }
        const t = audioCtx.currentTime;
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.setValueAtTime(masterGain.gain.value, t);
        masterGain.gain.linearRampToValueAtTime(0, t + 0.05);
        setTimeout(stopPlayback, 70);
    }

    function rampTape(target, ms) {
        if (tapeAnim) cancelAnimationFrame(tapeAnim);
        const start = tapeFactor, t0 = performance.now();
        (function step() {
            const k = Math.min(1, (performance.now() - t0) / ms);
            tapeFactor = start + (target - start) * k;
            if (k < 1) tapeAnim = requestAnimationFrame(step);
        })();
    }

    // momentary: pointer + keyboard (Space/Enter) for accessibility
    function momentary(el, onDown, onUp) {
        let down = false;
        const d = e => { if (down) return; down = true; el.classList.add('held'); onDown(); if (e.cancelable) e.preventDefault(); };
        const u = () => { if (!down) return; down = false; el.classList.remove('held'); onUp(); };
        el.addEventListener('pointerdown', d);
        el.addEventListener('pointerup', u);
        el.addEventListener('pointerleave', u);
        el.addEventListener('pointercancel', u);
        el.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') d(e); });
        el.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') u(); });
        el.addEventListener('blur', u);
    }

    function randomize() {
        VOICE_IDS.forEach(id => setSlider2(`[data-gain="${id}"]`, +(Math.random()).toFixed(2)));
        setSlider('bpm', Math.floor(40 + Math.random() * 200));
        setSlider('fxCut', +(0.25 + Math.random() * 0.6).toFixed(3));   // log-mapped, mid sweep
        setSlider('harmOffset', +(-2 + Math.random() * 4).toFixed(2));
        setSlider('harmDetune', Math.floor(-50 + Math.random() * 100));
    }
    function setSlider2(sel, v) {
        const el = document.querySelector(sel);
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function invert() {
        VOICE_IDS.forEach(id => {
            const btn = document.querySelector(`[data-toggle="${id}"]`);
            if (btn) btn.click();
        });
    }

    function wireChaos() {
        const panicEls = ['#panicBtn', '#panicBar'].map(s => $(s)).filter(Boolean);
        panicEls.forEach(b => b.addEventListener('click', panic));
        $('#randomBtn') && $('#randomBtn').addEventListener('click', randomize);
        $('#invertBtn') && $('#invertBtn').addEventListener('click', invert);

        const tape = $('#tapeBtn');
        if (tape) momentary(tape,
            () => rampTape(0.02, 700),
            () => rampTape(1, 300));

        const hold = $('#holdBtn');
        if (hold) momentary(hold,
            () => { holdActive = true; },
            () => { holdActive = false; });
    }

    // ===================================================================
    //  T6: TOY MODE — kids around a tablet, 2 players + optional Bowser
    // ===================================================================
    const PLAYER_COLOR = { p1: '#00ffff', p2: '#ff66cc', solo: '#a78bfa' };

    // Fire one Munki voice as a pad hit. `who` picks the quantize rule.
    function triggerVoice(id, who) {
        ensureAudio().then(() => {
            const t = audioCtx.currentTime;
            const sps = secondsPerStep();
            // QUANTIZE on -> snap to the next 16th grid (tight, musical).
            // off -> fire right now (raw, expressive).
            const when = quantize[who] ? Math.ceil((t + 0.03) / sps) * sps : t + 0.02;
            // Shared CUT-OFF: choke the toy bus at the hit so the previous
            // sound's tail is interrupted — call-and-response tightness.
            if (cutOffShared && toyChoke) {
                toyChoke.gain.cancelScheduledValues(when);
                toyChoke.gain.setValueAtTime(0.0001, when);
                toyChoke.gain.linearRampToValueAtTime(0.92, when + 0.012);
            }
            const ch = CHARACTERS[id];
            if (ch && ch.play) ch.play(proxMain[id], toyChoke, when, TRIGGER_STEP[id]);
        });
    }

    // Keep STUDIO + TOY ambient/harmony buttons showing the true flag.
    function refreshToggleLabels() {
        const tone = $('#toneToggle');
        if (tone) {
            tone.classList.toggle('on', isToneLayerOn);
            tone.setAttribute('aria-pressed', String(isToneLayerOn));
            tone.textContent = 'Ambient Layer: ' + (isToneLayerOn ? 'ON' : 'OFF');
        }
        const harm = $('#harmonyToggle');
        if (harm) {
            harm.classList.toggle('on', harmonyOn);
            harm.setAttribute('aria-pressed', String(harmonyOn));
            harm.textContent = 'Harmony: ' + (harmonyOn ? 'ON' : 'OFF');
        }
        document.querySelectorAll('[data-toy-amb]').forEach(b => {
            b.classList.toggle('on', isToneLayerOn);
            b.setAttribute('aria-pressed', String(isToneLayerOn));
            b.textContent = 'AMBIENT ' + (isToneLayerOn ? 'ON' : 'OFF');
        });
        document.querySelectorAll('[data-toy-harm]').forEach(b => {
            b.classList.toggle('on', harmonyOn);
            b.setAttribute('aria-pressed', String(harmonyOn));
            b.textContent = 'HARMONY ' + (harmonyOn ? 'ON' : 'OFF');
        });
    }

    function shuffleRoles() {
        const ids = VOICE_IDS.slice();
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        ids.forEach((id, i) => { toyOwner[id] = i < 4 ? 'p1' : 'p2'; });
        buildToy();
    }

    function padHTML(id, who) {
        const ch = CHARACTERS[id];
        return `<button class="pad" data-pad="${id}" data-who="${who}"
                    style="--vc:${ch.color};--pc:${PLAYER_COLOR[who]}"
                    aria-label="${ch.label} (player ${who === 'solo' ? '' : who.slice(1)})">
                  <span class="pad-name">${ch.label}</span>
                </button>`;
    }

    function halfHTML(side, ids) {
        const q = quantize[side];
        return `
          <div class="half ${side}" style="--pc:${PLAYER_COLOR[side]}">
            <div class="half-top">
              <span class="half-name">${side === 'solo' ? 'SOLO' : 'PLAYER ' + side.slice(1)}</span>
              <button class="ptog ${q ? 'on' : ''}" data-quant="${side}"
                      aria-pressed="${q}">QUANTIZE ${q ? 'ON' : 'OFF'}</button>
            </div>
            <div class="pad-grid">${ids.map(id => padHTML(id, side)).join('')}</div>
            <div class="half-bed">
              <button class="ptog small" data-toy-amb aria-pressed="false">AMBIENT</button>
              <button class="ptog small" data-toy-harm aria-pressed="false">HARMONY</button>
            </div>
          </div>`;
    }

    function bowserHTML() {
        return `
          <div class="bowser" style="--pc:#ff8a3d">
            <span class="bowser-tag">BOWSER — wreck their jam</span>
            <div class="bowser-row">
              <button class="bz panic" data-bz="panic">PANIC</button>
              <button class="bz" data-bz="tape">TAPE STOP</button>
              <button class="bz" data-bz="random">RANDOMIZE</button>
              <button class="bz" data-bz="invert">INVERT</button>
              <button class="bz" data-bz="hold">HOLD</button>
            </div>
          </div>`;
    }

    function buildToy() {
        const field = $('#toyField');
        if (!field) return;
        if (toyLayout === 'solo') {
            field.className = 'toy-field solo';
            field.innerHTML = halfHTML('solo', VOICE_IDS.slice());
        } else {
            field.className = 'toy-field two';
            const p1 = VOICE_IDS.filter(id => toyOwner[id] === 'p1');
            const p2 = VOICE_IDS.filter(id => toyOwner[id] === 'p2');
            field.innerHTML = halfHTML('p1', p1) + halfHTML('p2', p2);
        }
        const strip = $('#bowserStrip');
        strip.hidden = !bowserEnabled;
        strip.innerHTML = bowserEnabled ? bowserHTML() : '';

        // ---- Multi-touch pads. Each pad owns its own pointer listeners so
        // simultaneous presses in either half never steal each other. ----
        field.querySelectorAll('.pad').forEach(pad => {
            const press = e => {
                pad.classList.add('press');
                triggerVoice(pad.dataset.pad, pad.dataset.who);
                if (e.cancelable) e.preventDefault();
            };
            const release = () => pad.classList.remove('press');
            pad.addEventListener('pointerdown', press);
            pad.addEventListener('pointerup', release);
            pad.addEventListener('pointercancel', release);
            pad.addEventListener('pointerleave', release);
            pad.addEventListener('keydown', e => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) press(e);
            });
            pad.addEventListener('keyup', e => {
                if (e.key === ' ' || e.key === 'Enter') release();
            });
        });

        field.querySelectorAll('[data-quant]').forEach(b => {
            b.addEventListener('click', () => {
                const k = b.dataset.quant;
                quantize[k] = !quantize[k];
                b.classList.toggle('on', quantize[k]);
                b.setAttribute('aria-pressed', String(quantize[k]));
                b.textContent = 'QUANTIZE ' + (quantize[k] ? 'ON' : 'OFF');
            });
        });
        field.querySelectorAll('[data-toy-amb]').forEach(b => {
            b.addEventListener('click', () => {
                isToneLayerOn = !isToneLayerOn;
                refreshToggleLabels();
            });
        });
        field.querySelectorAll('[data-toy-harm]').forEach(b => {
            b.addEventListener('click', () => {
                harmonyOn = !harmonyOn;
                refreshToggleLabels();
            });
        });

        if (bowserEnabled) {
            const bz = sel => strip.querySelector(`[data-bz="${sel}"]`);
            bz('panic').addEventListener('click', panic);
            bz('random').addEventListener('click', randomize);
            bz('invert').addEventListener('click', invert);
            momentary(bz('tape'), () => rampTape(0.02, 700), () => rampTape(1, 300));
            momentary(bz('hold'), () => { holdActive = true; }, () => { holdActive = false; });
        }

        // Manual remix (settings): flip a voice's player. 2-player only.
        const ma = $('#manualAssign');
        if (ma) {
            if (toyLayout === '2p') {
                ma.hidden = false;
                ma.innerHTML = '<span class="fine">Tap to move a voice between players:</span>' +
                    VOICE_IDS.map(id => `<button class="chip" data-assign="${id}"
                        style="--vc:${CHARACTERS[id].color}">${CHARACTERS[id].label}:
                        ${toyOwner[id].toUpperCase()}</button>`).join('');
                ma.querySelectorAll('[data-assign]').forEach(b => {
                    b.addEventListener('click', () => {
                        const id = b.dataset.assign;
                        toyOwner[id] = toyOwner[id] === 'p1' ? 'p2' : 'p1';
                        buildToy();
                    });
                });
            } else {
                ma.hidden = true;
                ma.innerHTML = '';
            }
        }
        refreshToggleLabels();
    }

    function setMode(name) {
        mode = name;
        toyOn = (name === 'toy');
        $('#studio').hidden = name !== 'studio';
        $('#toy').hidden = name !== 'toy';
        $('#twin').hidden = name !== 'twin';
        document.querySelectorAll('[data-mode]').forEach(b => {
            const sel = b.dataset.mode === name;
            b.classList.toggle('on', sel);
            b.setAttribute('aria-selected', String(sel));
        });
        if (name === 'toy') buildToy();
        if (name !== 'twin') stopTwin();   // release the 2nd context
    }

    function wireToy() {
        document.querySelectorAll('[data-mode]').forEach(b => {
            b.addEventListener('click', () => setMode(b.dataset.mode));
        });
        // TRUE TWIN transport + controls
        $('#twinPlay') && $('#twinPlay').addEventListener('click', startPlayback);
        $('#twinStop') && $('#twinStop').addEventListener('click', stopPlayback);
        $('#twinPanic') && $('#twinPanic').addEventListener('click', panic);
        $('#reseedBtn') && $('#reseedBtn').addEventListener('click', reseedTwin);
        const tl = $('#twinLevel');
        tl && tl.addEventListener('input', () => {
            twinLevel = parseFloat(tl.value);
            $('#twinLvlVal').textContent = twinLevel.toFixed(2);
            if (twinMaster) twinMaster.gain.value = twinLevel;
        });
        // Slowly creeping skew readout = the two clocks drifting apart.
        const dEl = $('#twinDrift');
        if (dEl) setInterval(() => {
            if (mode !== 'twin') return;
            if (twinPlaying && twinCtx && audioCtx) {
                const skew = ((audioCtx.currentTime - twinCtx.currentTime) * 1000);
                dEl.textContent = 'twin running — independent clock, skew ' +
                    skew.toFixed(1) + ' ms (watch it creep — that’s the drift)';
            } else if (!twinPlaying) {
                dEl.textContent = 'twin idle — press PLAY';
            }
        }, 600);
        $('#toyPlay').addEventListener('click', startPlayback);
        $('#toyStop').addEventListener('click', stopPlayback);
        $('#shuffleBtn').addEventListener('click', shuffleRoles);

        const cut = $('#cutoffBtn');
        cut.addEventListener('click', () => {
            cutOffShared = !cutOffShared;
            cut.classList.toggle('on', cutOffShared);
            cut.setAttribute('aria-pressed', String(cutOffShared));
            cut.textContent = 'CUT-OFF ' + (cutOffShared ? 'ON' : 'OFF');
        });

        const gear = $('#gearBtn'), panelEl = $('#toySettings');
        gear.addEventListener('click', () => {
            const open = panelEl.hidden;
            panelEl.hidden = !open;
            gear.setAttribute('aria-expanded', String(open));
        });

        document.querySelectorAll('[data-layout]').forEach(b => {
            b.addEventListener('click', () => {
                toyLayout = b.dataset.layout;
                document.querySelectorAll('[data-layout]').forEach(x =>
                    x.classList.toggle('on', x === b));
                buildToy();
            });
        });
        const bw = $('#bowserChk');
        bw.addEventListener('click', () => {
            bowserEnabled = !bowserEnabled;
            bw.classList.toggle('on', bowserEnabled);
            bw.setAttribute('aria-pressed', String(bowserEnabled));
            bw.textContent = 'BOWSER: ' + (bowserEnabled ? 'ENABLED' : 'OFF');
            buildToy();
        });
    }

    // ---------- VISUALIZERS ----------
    function startVisualizers() {
        const scope = $('#scope');
        const spec = $('#spectrum');
        const sctx = scope.getContext('2d');
        const fctx = spec.getContext('2d');
        const dots = {};
        VOICE_IDS.forEach(id => { dots[id] = $(`[data-dot="${id}"]`); });

        function fit(c) {
            const r = c.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            c.width = r.width * dpr;
            c.height = r.height * dpr;
            return dpr;
        }
        let dpr = fit(scope); fit(spec);
        window.addEventListener('resize', () => { dpr = fit(scope); fit(spec); });

        const timeBuf = new Uint8Array(2048);
        const freqBuf = new Uint8Array(1024);
        const meterBuf = new Uint8Array(256);

        function frame() {
            requestAnimationFrame(frame);
            if (!analyser) return;

            // Oscilloscope
            analyser.getByteTimeDomainData(timeBuf);
            const sw = scope.width, sh = scope.height;
            sctx.clearRect(0, 0, sw, sh);
            sctx.lineWidth = 2 * dpr;
            sctx.strokeStyle = '#66ffff';
            sctx.shadowColor = '#ff66cc';
            sctx.shadowBlur = 8 * dpr;
            sctx.beginPath();
            for (let i = 0; i < timeBuf.length; i++) {
                const x = (i / timeBuf.length) * sw;
                const y = (timeBuf[i] / 255) * sh;
                i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
            }
            sctx.stroke();
            sctx.shadowBlur = 0;

            // Spectrum
            analyser.getByteFrequencyData(freqBuf);
            const fw = spec.width, fh = spec.height;
            fctx.clearRect(0, 0, fw, fh);
            const bars = 96;
            const bw = fw / bars;
            for (let i = 0; i < bars; i++) {
                const v = freqBuf[Math.floor(i / bars * freqBuf.length)] / 255;
                const bh = v * fh;
                const hue = 300 - v * 120; // pink -> teal
                fctx.fillStyle = `hsl(${hue} 100% ${40 + v * 25}%)`;
                fctx.fillRect(i * bw, fh - bh, bw - 1, bh);
            }

            // Per-voice activity dots (RMS off each voice meter)
            VOICE_IDS.forEach(id => {
                const m = voiceMeter[id];
                if (!m) return;
                m.getByteTimeDomainData(meterBuf);
                let sum = 0;
                for (let i = 0; i < meterBuf.length; i++) {
                    const d = (meterBuf[i] - 128) / 128;
                    sum += d * d;
                }
                const rms = Math.sqrt(sum / meterBuf.length);
                dots[id].classList.toggle('lit', rms > 0.008);
            });
        }
        frame();
    }

    document.addEventListener('DOMContentLoaded', () => {
        buildConsole();
        wireControls();
        wireToy();
        startVisualizers();
        if (typeof Tone === 'undefined') {
            const note = $('#toneNote');
            if (note) note.textContent =
                'Ambient layer unavailable (tone.min.js did not load).';
        }
    });
})();

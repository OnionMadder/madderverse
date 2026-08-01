
(() => {
    'use strict';

    // ---------- CONFIG ----------
    // TEMPO / SECONDS_PER_STEP are MUTABLE — Tier-1 music expansion adds a
    // tempo cycler pill. All downstream sites read the current values
    // fresh (scheduler, BAR_LEN calcs) so a mid-loop tempo change lands on
    // the next scheduled step. STEPS_PER_BAR stays const — every Munki's
    // play() hardcodes literal step indices (see the "Things that bite"
    // section in the game-level CLAUDE.md).
    let TEMPO = 100;                         // BPM (mutable — see setTempo)
    let SECONDS_PER_STEP = 60 / TEMPO / 4;   // 0.15s at 100 BPM
    const TEMPO_PRESETS = [80, 100, 120, 140];
    const STEPS_PER_BAR = 16;                // sixteenth notes
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.1;
    const NUM_SLOTS = 6;
    const BARS_PER_LOOP = 4;                 // I-vi-IV-V progression (Cmaj, Am, Fmaj, G)
    const MADBALLZ_UNLOCK_THRESHOLD = 3;
    // Feature flag: Madballz mode is dormant in the 8-Munki redesign — code,
    // sprites, audio profiles, and the mode toggle are all preserved, but the
    // reveal button never appears. Flip to true to bring the bonus screen back.
    const MADBALLZ_ENABLED = true;
    // Dual Band Mode: enabled 2026-07-31 after finishing the audio-independence
    // + UX gaps that had kept it flag-off for the v1.1 Play release:
    //   1. Per-band DynamicsCompressor before merge (ensureDualBandAudio) so
    //      each band's peaks don't sidechain the other — matches the
    //      two-tab reference that had one compressor per tab.
    //   2. Loop-clock anchor jitter (setBandOn) so a same-instant double-tap
    //      doesn't phase-lock both bands to the same 16th-note grid.
    //   3. Horror pipeline gated off in dual-band mode (CSS + JS bypasses in
    //      setReactDrone/setIceMuffle/triggerJumpScare/moonRules) so Ice/Moon
    //      drops don't hijack a composition surface.
    //   4. Footswitches lifted to position:fixed above the fixed tray (were
    //      buried behind it in normal flow, making them un-tappable).
    // Flip to false to disable the mode without removing any wiring.
    const DUAL_BAND_ENABLED = true;
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
        // ----- FLY drift (the hunting cruise) -----
        SPEED_MIN_PXPS:     34,      // base flight px/sec
        SPEED_MAX_PXPS:     58,
        WAVE_AMP_PX:        22,      // subtle bob while cruising
        WAVE_PERIOD_MS:     2200,
        SIZE_PX:            128,     // rendered creep box cap (square)
        // ----- Hunting cycle (HUNT → EXIT) -----
        // The creep actively flies toward Munkis. Passive proximity is
        // the fun interaction (restored): any Munki within CLOSE_PX
        // flinches (.creep-scared + shocked face) and accrues fear,
        // bleeding off once clearly FAR (CLOSE/FAR hysteresis stops
        // boundary flicker). Once it has scared SCARE_COUNT *distinct*
        // Munkis — or the hunt times out — it EXITs in a fast dive off
        // the opposite edge from entry. No Munki dive-bomb / no IMPACT.
        CLOSE_PX:           110,     // scare radius (creep↔Munki centre)
        FAR_PX:             160,     // must clear this before fear decays
        FEAR_MAX:           100,
        FEAR_GAIN_PER_S:    34,      // fear ramp while CLOSE
        FEAR_DECAY_PER_S:   8,       // fear bleed while FAR
        SCARE_COUNT:        3,       // distinct Munkis to scare, then go
        SCARE_DWELL_MS:     2200,    // it HOVERS this long menacing each
                                     // one (within CLOSE_PX) before that
                                     // Munki counts as scared + it moves
                                     // on — leaving range resets the timer
        MAX_HUNT_MS:        20000,   // hard stop → EXIT even if < 3 scared
        EXIT_SPEED_MULT:    5,       // off-screen dive = FLY × this
        FLY_HOME_OFFSET_PX: 130,     // cruise height above the Munki band
        // Sum of all on-stage fear that trips horror + the lower level
        // it must fall back below before horror releases (hysteresis).
        HORROR_TRIGGER_SUM: 105,
        HORROR_RELEASE_SUM: 45,
        // HUNT wing-flap is BEAT-LOCKED (frame 1<->2 on the quarter
        // note); FLAP_MS is only the fallback when no audio beat is
        // advancing. The EXIT dive off-screen plays frames 3→4→5.
        FLAP_MS:            300,
        // Size normalisation. The exporter packs uniform frame CANVASES
        // but the creep DRAWN inside each varies in size — so we measure
        // each frame's real painted content (alpha bbox, in-browser) and
        // scale every frame so its NORM_DIM renders to NORM_FILL × the
        // box. Result: the creep reads the same size in every pose; the
        // wing-flap then shows as the OTHER dimension changing (real
        // animation, not a size jump). 'area' (geom-mean of the content
        // box) is the steadiest single proxy — a wing-flap moves only
        // one axis so it barely swings the overall size, yet the flap
        // still reads. 'width' / 'height' / 'max' available per creep.
        NORM_DIM:           'area',
        NORM_FILL:          0.80,
        // z-index: above the stage BG + Munkis, below the tray/controls.
        Z_INDEX:            42
    };

    // ---------- DREAD SYSTEM (v1.1 — see CLAUDE.md "The Dread System") ----------
    // CHUNK 1: the meter + stages live UNDERNEATH the existing horror
    // visuals. `body.react-mode-active` is still computed exactly as
    // before (zero regression) — `body.dread-<stage>` is emitted in
    // parallel and not yet read by any CSS/audio. Later chunks migrate
    // the visuals onto the stages, fold the two react concepts into one
    // per-Munki ladder, and split Moon/Ice personalities.
    const DREAD = {
        // Stage thresholds on the 0–100 meter.
        UNEASE:           25,
        DREAD:            55,
        TERROR:           80,
        // Meter dynamics (px/units per second).
        RISE_PER_S:       45,   // climb toward the live threat pressure
        DECAY_PER_S:      14,   // bleed when below pressure / threat gone
        DECAY_HIGH_PER_S: 7,    // slower while already high (stays tense)
        // Pressure contributors (added into the live target each tick).
        PER_ADJACENT:     42,   // each Ice/Moon-adjacent regular Munki
        JUMPSCARE_SPIKE:  60,   // instant add on an Ice/Moon drop
        // Moon "perception lies" — passive phantom-flicker cadence
        // (ms window) while Moon is on stage at the dread / terror
        // stages. Non-destructive (ghost in an empty slot only).
        PHANTOM_DREAD_MIN_MS:  9000,
        PHANTOM_DREAD_MAX_MS:  15000,
        PHANTOM_TERROR_MIN_MS: 4500,
        PHANTOM_TERROR_MAX_MS: 8000
    };
    let dread = 0;                 // 0–100, the single meter
    let dreadStageNow = 'calm';    // last applied stage (class bookkeeping)
    let dreadRAF = null, dreadLastTs = 0;
    let moonPhantomNextAt = 0;     // scheduled ts for the next phantom

    // ---- Unified per-Munki fear (Dread System chunk 2) ----
    // ONE fear value per slot (0–FEAR.MAX) fed by BOTH creep proximity
    // AND Ice/Moon adjacency. Drives a single react ladder in
    // expressionForSlot: >= FLINCH → afraid (.creep-scared shake +
    // shocked face 2); >= PANIC → full freak-out (expression cycles
    // 1→5 per beat). Replaces the old creep `.creep-scared` set + the
    // separate 8-beat Ice/Moon dwell trip.
    const FEAR = {
        MAX:               100,
        FLINCH:            1,    // any fear → shake + shocked face
        PANIC:             55,   // full expression-cycle freak-out
        PANIC_RELEASE:     33,   // hysteresis to leave panic (no flicker)
        ADJ_GAIN_PER_BEAT: 7,    // Ice/Moon adjacency ramp (~8 beats→PANIC)
        DECAY_PER_BEAT:    6     // bleeds off when nothing feeds it
    };
    const munkiFear      = new Map(); // slot → 0..FEAR.MAX (THE fear)
    const afraidSlots    = new Set(); // slots currently >= FLINCH (diff)
    const panicStartBeat = new Map(); // slot → beat the panic anchored
    const fearFedAt      = new Map(); // slot → last ts a source fed it

    // ---------- AUDIO ENGINE ----------
    let audioCtx = null;
    let masterGain = null;
    let masterLP = null;            // 14 kHz speaker-protect LP — also
                                     // modulated DOWNWARD by setIceMuffle()
                                     // for Ice's "frozen / underwater" feel.
    let iceMuffleLevel = -1;        // last applied muffle level (edge-detect)
    let isPlaying = false;
    let isMuted = false;
    let isBaseSongOn = true;                 // background "level music" theme
    // ---------- MUSIC EXPANSION (Tier 1) — 2026-07-31 ----------
    // Four global params the player controls via top-cluster pills. Each
    // persists in the save (see loadProgress / saveProgress). Combined
    // with the 8-character roster and 4-bar loop, they multiply the
    // sonic surface far beyond the fixed-Cmaj-100-BPM baseline: 3 song
    // moods × 4 tempos × 4 keys × 2 grooves = 96 distinct beds without
    // adding a single character.
    let songVariationIndex = 0;              // 0 = SUNNY, 1 = MINOR, 2 = AMBIENT
    let keyShiftSemitones  = 0;              // 0, 2, 5, 8 = C, D, F, A♭
    let isSwingOn          = false;          // straight vs shuffled 8ths
    const KEY_PRESETS = [
        { name: 'C',  shift: 0 },
        { name: 'D',  shift: 2 },
        { name: 'F',  shift: 5 },
        { name: 'A♭', shift: 8 }
    ];
    // Global pitch-shift node — a ConstantSourceNode driving detune on
    // every oscillator via a monkey-patch in ensureAudio. Musical
    // transposition without editing any per-Munki play() function.
    let pitchShiftSource = null;
    // Tier-2 music: SPACE (reverb send) + FILTER (master lowpass base freq).
    // SPACE routes a copy of the master signal through a Tone.Reverb bus
    // (parallel to the dry masterLP path); the send gain scales wet.
    // FILTER swaps the masterLP frequency — same node that setIceMuffle
    // modulates during Ice horror, so we track a `filterBaseHz` the
    // player picks and setIceMuffle multiplies against it during dread.
    let masterComp = null;              // exposed ref for the SPACE parallel path
    let spaceSend = null;               // GainNode: masterGain -> spaceSend -> reverb -> comp
    let spaceReverb = null;
    let spaceLevel = 0;                 // current send gain (0..0.6)
    let filterBaseHz = 14000;           // player-set base LP freq (see FILTER_PRESETS)
    const SPACE_PRESETS = [
        { name: 'DRY',  send: 0.00, decay: 1.2 },
        { name: 'ROOM', send: 0.16, decay: 1.8 },
        { name: 'HALL', send: 0.34, decay: 3.4 },
        { name: 'CAVE', send: 0.58, decay: 6.0 }
    ];
    let spaceIndex = 0;                 // 0 = DRY
    const FILTER_PRESETS = [
        { name: 'BRIGHT', hz: 14000 },
        { name: 'WARM',   hz:  8000 },
        { name: 'DARK',   hz:  3200 }
    ];
    let filterIndex = 0;                // 0 = BRIGHT
    let isBassOn     = false;                // optional booming bass overlay (Madballz Theme) — off by default; user toggles via BASS button
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
    let toneDroneGain = null; // Drone's gain envelope (ramps per dread stage)
    let droneLevel = -1;      // last drone target (edge-detect; stage-driven)
    // Chunk 3: the dread STAGE owns horror now (applyDreadStageClass).
    // `fearHorrorActive` survives only as the latch for the
    // creepWhisperer achievement (creep fear sum crossed the horror
    // sum) — it no longer gates any visual.
    let fearHorrorActive = false;
    // Set true at the `dread`/`terror` stages. While on, every on-stage
    // non-evil Munki cycles its head 1→5 (staggered per slot) — the
    // global ripple on top of the per-Munki fear ladder.
    let horrorActive = false;
    let horrorStartBeat = 0;

    let horrorTriggers = 0;
    let activeBankIndex = 0;
    let madballzUnlocked = true;   // v1.1: Madballz mode ships unlocked by default
    let isMadballzMode = false;

    // ---------- DUAL BAND MODE (v1.1) ----------
    // A toggled mode: the 6-slot stage splits into two rows of 3 — Row A
    // (slots 0-2) and Row B (slots 3-5) — each a fully independent band
    // with its OWN Bala's Theme + oscillators + loop clock (wired in
    // chunk B). bandOn[0]/[0] gate each row's WHOLE band via a big
    // footswitch; the player times the two switches to compose the
    // layering. Single-row default + v1.0 audio path are untouched.
    let isDualBandMode = false;
    let bandOn = [false, false]; // Row A, Row B — both start OFF on entry

    // ---------- ROUND ROBIN MODE ----------
    // Third playback mode. Munkis enter one at a time (one per bar) in
    // rainbow order, hold the full-chorus for a few bars, clear, repeat.
    // Uses the existing audio engine — voices layer cumulatively via
    // scheduleStep's per-slot play() loop, no engine changes. Sequencer
    // hook is a single call in scheduleStep at step === 0 of each bar.
    // Mutually exclusive with Dual Band + Madballz (entering RR turns
    // those off; entering either of them turns RR off).
    let isRoundRobinMode = false;
    let rrCycleBar = 0;                   // advances +1 per bar while RR is on
    const RR_PLAN       = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    const RR_ENTRY_BARS = 6;              // one Munki per bar for 6 bars
    const RR_HOLD_BARS  = 4;              // stay full for 4 bars
    const RR_TOTAL_BARS = RR_ENTRY_BARS + RR_HOLD_BARS; // 10 bars per cycle
    // ---- Chunk B audio (built lazily on first dual-band entry) ----
    // Pattern ported from the Tonehouse prototype: each band is the SAME
    // untouched engine code (BASE_SONG + per-Munki play()) scheduled into
    // its OWN bus GainNode + its OWN Tone ambient set on its OWN loop
    // clock; both buses converge at the single masterGain -> compressor
    // (the locked design's required convergence). v1.0 single-row path is
    // never touched — scheduleStep just early-returns its audio in mode.
    let dualReady = false;
    let rowGain = [null, null];   // per-row bus -> rowCompressor -> masterGain
    let rowCompressor = [null, null]; // per-row DynamicsCompressor (see below)
    let rowTone = [null, null];   // per-row {pad,bell,hat} (own Bala's Theme)
    let rowClock = [
        { step: 0, bar: 0, next: 0, started: false },
        { step: 0, bar: 0, next: 0, started: false }
    ];
    function bandFootEl(i) {
        return document.getElementById(i === 0 ? 'bandFootA' : 'bandFootB');
    }
    function ensureDualBandAudio() {
        if (dualReady || !audioCtx || !masterGain) return;
        for (let r = 0; r < 2; r++) {
            const rg = audioCtx.createGain();
            rg.gain.value = 0;            // silent until the footswitch lifts it
            // Per-band DynamicsCompressor BEFORE the merge. The
            // "two-tab magic" this mode reproduces relied on each tab
            // owning its OWN compressor — the OS mixer summed them
            // uncompressed against each other, so peaks stayed
            // independent. Sharing a single master compressor here
            // meant Band B's kick sidechained Band A's pad and
            // vice versa; per-band compressors restore the
            // independence. Settings clone the current master
            // (line ~423) so each band sounds like the single-band
            // path. Master downstream still runs but with far less
            // work — it effectively becomes a soft peak limiter.
            const rc = audioCtx.createDynamicsCompressor();
            rc.threshold.value = -14;
            rc.knee.value      = 10;
            rc.ratio.value     = 6;
            rc.attack.value    = 0.003;
            rc.release.value   = 0.25;
            rg.connect(rc).connect(masterGain);
            rowGain[r] = rg;
            rowCompressor[r] = rc;
            // This row's OWN Bala's Theme: its own Tone ambient instances
            // through its own reverb/delay bus -> this row's gain. Wrapped
            // so a Tone failure can never break the raw-WebAudio path.
            if (typeof Tone !== 'undefined' && toneReady) {
                try {
                    const rv = new Tone.Reverb({ decay: 3.4, preDelay: 0.04, wet: 0.35 });
                    const dl = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.22, wet: 0.22 });
                    const bo = new Tone.Gain(0.55);
                    rv.connect(dl); dl.connect(bo); Tone.connect(bo, rg);
                    const pad = new Tone.PolySynth(Tone.Synth, {
                        oscillator: { type: 'fatsine', count: 3, spread: 22 },
                        envelope: { attack: 0.45, decay: 0.35, sustain: 0.65, release: 1.4 },
                        volume: -22 });
                    pad.connect(rv);
                    const bell = new Tone.FMSynth({
                        harmonicity: 2, modulationIndex: 11,
                        envelope:           { attack: 0.002, decay: 0.5, sustain: 0, release: 0.7 },
                        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.7 },
                        volume: -16 });
                    bell.connect(rv);
                    const hat = new Tone.MetalSynth({
                        envelope: { attack: 0.001, decay: 0.05, release: 0.08 },
                        harmonicity: 5.1, modulationIndex: 32, resonance: 4200,
                        octaves: 1.5, volume: -32 });
                    Tone.connect(hat, rg);
                    rowTone[r] = { pad: pad, bell: bell, hat: hat };
                } catch (_) { rowTone[r] = null; }
            }
        }
        dualReady = true;
    }
    // Mirrors TONE_LAYER.play onto a given row's own ambient instruments.
    function playRowTone(r, step, bar, when) {
        const T = rowTone[r];
        if (!T) return;
        const BAR_LEN = SECONDS_PER_STEP * STEPS_PER_BAR;
        if (step === 0) {
            const ch = TONE_LAYER.chordsByBar[bar];
            if (ch) T.pad.triggerAttackRelease(ch, BAR_LEN * 0.92, when);
        }
        if (step === 2 || step === 10) T.hat.triggerAttackRelease('C5', '32n', when);
        if (bar === 2 && step === 0)  T.bell.triggerAttackRelease('C6', '2n', when + 0.04);
        if (bar === 3 && step === 12) T.bell.triggerAttackRelease('E6', '4n', when);
    }
    // One scheduler tick for one band: its own Bala's Theme bed + Tone
    // ambient + only its 3 slots, all into this row's bus. Row A = slots
    // 0-2, Row B = slots 3-5. Engine code (BASE_SONG/play) is untouched —
    // we only pass this row's bus as `out` and this row's clock as `when`.
    function dualRowStep(r, step, bar, when) {
        if (!rowGain[r]) return;
        const w = swungWhen(when, step);
        if (isBaseSongOn) {
            // Mirror the single-band routing: MADBALLZ_SONG in madballz
            // mode, current variation otherwise. Both bands share the
            // same MOOD pill so they harmonize.
            const song = currentSong();
            song.play(audioCtx, rowGain[r], w, step, bar);
            if (!isMadballzMode) playRowTone(r, step, bar, w);
        }
        const lo = r * 3;
        for (let i = lo; i < lo + 3; i++) {
            const id = slots[i];
            if (!id) continue;
            const ch = CHARACTERS[id];
            if (ch && ch.play) ch.play(audioCtx, rowGain[r], w, step);
        }
    }
    function setBandOn(i, on) {
        // Defensive: a stray footswitch click before the dual-band audio
        // graph is wired (e.g. ensureDualBandAudio bailed when masterGain
        // wasn't ready) silently no-ops the gain ramp. Idempotent via
        // dualReady, so calling it from here always closes that gap.
        if (on) ensureDualBandAudio();
        bandOn[i] = on;
        const el = bandFootEl(i);
        if (el) {
            el.setAttribute('aria-pressed', String(on));
            el.classList.toggle('lit', on);
            const st = el.querySelector('.band-foot-state');
            if (st) st.textContent = on ? 'ON' : 'OFF';
        }
        // Footswitch = mute/unmute this row's WHOLE band via its bus gain.
        if (rowGain[i] && audioCtx) {
            const g = rowGain[i].gain, t = audioCtx.currentTime;
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
            g.linearRampToValueAtTime(on ? 1 : 0, t + 0.06);
        }
        // First time a band is switched ON, anchor its loop clock to NOW,
        // with 0-50 ms of random jitter added to the base 80 ms offset.
        // The gap between the two anchors = whenever the player stamped
        // each footswitch = the performed offset (the two-tab magic).
        // The jitter simulates the natural setTimeout drift that two
        // separate browser tabs would produce, so even a same-instant
        // double-tap doesn't phase-lock the two bands to a single grid.
        if (on && audioCtx && !rowClock[i].started) {
            const jitter = Math.random() * 0.05;
            rowClock[i] = { step: 0, bar: 0, next: audioCtx.currentTime + 0.08 + jitter, started: true };
        }
    }
    function setDualBandMode(on) {
        // Mutually exclusive with Round Robin.
        if (on && isRoundRobinMode) setRoundRobinMode(false);
        isDualBandMode = on;
        document.body.classList.toggle('dual-band-mode', on);
        const btn = document.getElementById('dualBandBtn');
        if (btn) {
            btn.setAttribute('aria-pressed', String(on));
            btn.classList.toggle('on', on);
        }
        const foot = document.getElementById('bandFootswitches');
        if (foot) { foot.hidden = !on; foot.setAttribute('aria-hidden', String(!on)); }
        if (on) { ensureAudio(); ensureDualBandAudio(); }
        // Entering or leaving always resets both bands to OFF + un-anchors
        // their clocks, so the player re-times the layering from silence.
        rowClock[0].started = false;
        rowClock[1].started = false;
        setBandOn(0, false);
        setBandOn(1, false);
        // Named combos are Standard-mode only; re-evaluate so a matched
        // combo hides on entry and re-shows on exit if still valid.
        checkNamedCombo();
    }

    // Round Robin toggle. Restarts the cycle on every ON transition so
    // the player always sees the show start from an empty stage. Turning
    // OFF leaves the current stage as-is (whatever the sequencer had
    // laid down) so the player can pick up composing manually.
    function setRoundRobinMode(on) {
        if (on) {
            // Mutually exclusive with the other alternate modes. Bounce
            // Dual Band off explicitly; Madballz gets exited so the tray
            // and body class both reset before RR takes over.
            if (isDualBandMode) setDualBandMode(false);
            if (isMadballzMode) exitMadballzMode();
        }
        isRoundRobinMode = on;
        document.body.classList.toggle('round-robin-mode', on);
        const btn = document.getElementById('roundRobinBtn');
        if (btn) {
            btn.setAttribute('aria-pressed', String(on));
            btn.classList.toggle('on', on);
        }
        if (on) {
            ensureAudio();
            // Start from a clean stage + reset cycle counter so bar 0
            // clears (already empty) then places red at slot 0.
            for (let i = 0; i < NUM_SLOTS; i++) {
                if (slots[i]) { slots[i] = null; renderSlot(i); }
            }
            updateIceFreeze();
            rrCycleBar = 0;
            // Poke the sequencer once immediately so the first Munki lands
            // now rather than waiting up to ~2.4 s for the next bar tick.
            rrTick();
        }
        // Combo detector needs to know the mode changed (RR shouldn't
        // suppress combos — FULL RAINBOW firing mid-buildup is a feature).
        checkNamedCombo();
    }

    // Called once per bar (at step === 0) while Round Robin is on.
    // Phase 0..5 = ENTRY: place RR_PLAN[phase] into slot [phase].
    // Phase 6..9 = HOLD: full chorus stays visible.
    // Wrapping to phase 0 clears the stage before the next entry begins.
    function rrTick() {
        if (!isRoundRobinMode) return;
        const phase = rrCycleBar % RR_TOTAL_BARS;
        if (phase === 0) {
            // New cycle — clear whatever's on stage first.
            for (let i = 0; i < NUM_SLOTS; i++) {
                if (slots[i]) { slots[i] = null; renderSlot(i); }
            }
            updateIceFreeze();
        }
        if (phase < RR_ENTRY_BARS && phase < NUM_SLOTS) {
            // Place the next planned Munki. Route through setSlot so
            // per-Munki state (placedAt shock face, dread, combo check)
            // fires exactly like a manual drop.
            setSlot(phase, RR_PLAN[phase]);
        }
        rrCycleBar++;
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

    function ensureAudio() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = isMuted ? 0 : 0.55;
            // Mobile audio hygiene Fix 3 — master lowpass BEFORE the
            // compressor. Tiny phone speakers can't cleanly reproduce
            // >~14 kHz; that energy comes back as "static-y residue"
            // over long sessions. Musically inaudible (Bala's Theme's
            // top partials sit well below 14 kHz) but phones sound
            // dramatically cleaner. (Future madderverse/lib/audio/:
            // keep this node — it's a speaker-protection stage, not an
            // EQ choice.)
            masterLP = audioCtx.createBiquadFilter();
            masterLP.type = 'lowpass';
            masterLP.frequency.value = 14000;
            masterLP.Q.value = 0.7;
            const comp = audioCtx.createDynamicsCompressor();
            // Mobile audio hygiene Fix 5 — tightened from desktop-loose
            // (was -10 / 8 / 6 / 0.004 / 0.15) toward mobile-safe so no
            // peak above ~-3 dBFS reaches small speakers. ratio stays 6
            // (already >= the 4 floor — more peak control, not less).
            // This only tames transients/peaks; it does NOT recolor the
            // tone — Bala's Theme character is preserved.
            comp.threshold.value = -14;
            comp.knee.value = 10;
            comp.ratio.value = 6;
            comp.attack.value = 0.003;
            comp.release.value = 0.25;
            // Chain: masterGain -> 14 kHz LP -> compressor -> destination.
            masterGain.connect(masterLP).connect(comp).connect(audioCtx.destination);
            masterComp = comp;   // exposed for the SPACE parallel path below

            // Global pitch shifter (Tier-1 music expansion): a
            // ConstantSourceNode outputting `keyShiftSemitones * 100`
            // cents, wired into every oscillator's `.detune` AudioParam
            // via a createOscillator monkey-patch. AudioParam sums its
            // intrinsic value with all connected inputs, so per-voice
            // detune (e.g. Tone's chorus / vibrato) still stacks on top.
            // Set BEFORE buildToneLayer so Tone's oscillators get the
            // patch too.
            pitchShiftSource = audioCtx.createConstantSource();
            pitchShiftSource.offset.value = keyShiftSemitones * 100;
            pitchShiftSource.start();
            const origCreateOsc = audioCtx.createOscillator.bind(audioCtx);
            audioCtx.createOscillator = function() {
                const osc = origCreateOsc();
                try { pitchShiftSource.connect(osc.detune); } catch (_) {}
                return osc;
            };

            buildToneLayer(); // no-op if Tone.js isn't loaded

            // SPACE bus (Tier-2 music expansion). Parallel wet path:
            //   masterGain -> spaceSend -> Tone.Reverb -> comp
            // The dry path (masterGain -> masterLP -> comp) is unchanged.
            // Bail silently if Tone.js didn't load — SPACE just stays DRY.
            if (toneReady) {
                spaceReverb = new Tone.Reverb({
                    decay:    SPACE_PRESETS[spaceIndex].decay,
                    preDelay: 0.03
                });
                spaceSend = audioCtx.createGain();
                spaceSend.gain.value = SPACE_PRESETS[spaceIndex].send;
                masterGain.connect(spaceSend);
                Tone.connect(spaceSend, spaceReverb);
                Tone.connect(spaceReverb, masterComp);
            }
            // Seed masterLP frequency from the saved FILTER choice.
            masterLP.frequency.value = filterBaseHz;
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
            // Mobile audio hygiene Fix 1 (Tone layer) — release 0.02 ->
            // 0.08: a 20 ms metallic-synth release snaps closed hard
            // enough to click on phone speakers. 80 ms is still a tight
            // tick against the kid's drum-mods but ends cleanly. (Pad
            // release 1.4 s / bell 0.7 s are already soft — left as-is.)
            envelope: { attack: 0.001, decay: 0.05, release: 0.08 },
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
    // Stage-driven now: target gain ramps with the dread stage (calm 0,
    // unease faint, dread the old 0.32, terror loudest). Edge-detected
    // on `droneLevel` so it only re-ramps when the stage actually moves.
    function setReactDrone(level) {
        // Madballz mode mutes the horror sub-bass drone — creeps + per-
        // Munki reacts still escalate the dread state, but the screen-wide
        // horror audio (and the matching overlays, gated in CSS) goes away.
        if (isMadballzMode || isDualBandMode) level = 0;
        if (level === droneLevel) return;
        droneLevel = level;
        if (!toneReady || !toneDroneGain) return;
        const now = Tone.now();
        toneDroneGain.gain.cancelScheduledValues(now);
        toneDroneGain.gain.setValueAtTime(toneDroneGain.gain.value, now);
        toneDroneGain.gain.linearRampToValueAtTime(level, now + 3.5);
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
        // Dual Band Mode: each band runs its OWN independent loop clock,
        // pumped here in the same look-ahead window. A band's clock only
        // advances once it's been switched on (rowClock[r].started).
        if (isDualBandMode) {
            for (let r = 0; r < 2; r++) {
                const rc = rowClock[r];
                if (!rc.started) continue;
                while (rc.next < audioCtx.currentTime + SCHEDULE_AHEAD) {
                    dualRowStep(r, rc.step, rc.bar, rc.next);
                    rc.next += SECONDS_PER_STEP;
                    rc.step++;
                    if (rc.step >= STEPS_PER_BAR) {
                        rc.step = 0;
                        rc.bar = (rc.bar + 1) % BARS_PER_LOOP;
                    }
                }
            }
        }
        schedTimer = setTimeout(schedule, LOOKAHEAD_MS);
    }

    // Swing shifts off-beat 8ths (steps 2/6/10/14) forward by ~20% of a
    // step, turning the straight grid into a shuffled lope. Applied to
    // audio `when` only — the scheduler's constant advance rate is
    // unchanged, so no note-density drift builds up over a bar.
    function swungWhen(when, step) {
        if (!isSwingOn) return when;
        if (step === 2 || step === 6 || step === 10 || step === 14) {
            return when + SECONDS_PER_STEP * 0.4;   // ~30ms at 100 BPM
        }
        return when;
    }
    // Which song plays right now. Madballz mode wins outright (its own
    // brooding theme). Standard mode picks from SONG_VARIATIONS by the
    // MOOD pill's index.
    function currentSong() {
        if (isMadballzMode) return MADBALLZ_SONG;
        return SONG_VARIATIONS[songVariationIndex].song;
    }
    function currentTone() {
        if (isMadballzMode) return null;
        return SONG_VARIATIONS[songVariationIndex].tone;
    }

    // ---------- MUSIC EXPANSION SETTERS ----------
    function setTempo(bpm) {
        TEMPO = bpm;
        SECONDS_PER_STEP = 60 / TEMPO / 4;
        // The scheduler picks up SECONDS_PER_STEP on its next advance —
        // already-scheduled notes fire at the old timing, the next step
        // uses the new one. No pop.
    }
    function cycleTempo() {
        const i = TEMPO_PRESETS.indexOf(TEMPO);
        const next = TEMPO_PRESETS[(i + 1) % TEMPO_PRESETS.length];
        setTempo(next);
        updateTempoBtn();
        saveProgress();
    }
    function setSwing(on) {
        isSwingOn = !!on;
        updateSwingBtn();
        saveProgress();
    }
    function setKeyShift(semitones) {
        keyShiftSemitones = semitones;
        if (pitchShiftSource) {
            const now = audioCtx.currentTime;
            pitchShiftSource.offset.cancelScheduledValues(now);
            pitchShiftSource.offset.setValueAtTime(pitchShiftSource.offset.value, now);
            // 60ms glide keeps a mid-loop key change from clicking; short
            // enough that the shift feels immediate to the player.
            pitchShiftSource.offset.linearRampToValueAtTime(semitones * 100, now + 0.06);
        }
    }
    function cycleKey() {
        const i = KEY_PRESETS.findIndex(k => k.shift === keyShiftSemitones);
        const next = KEY_PRESETS[(i + 1) % KEY_PRESETS.length];
        setKeyShift(next.shift);
        updateKeyBtn();
        saveProgress();
    }
    function cycleSongVariation() {
        songVariationIndex = (songVariationIndex + 1) % SONG_VARIATIONS.length;
        updateMoodBtn();
        saveProgress();
    }
    // Label / aria-pressed updaters — safe to call before their button
    // element exists (early-return; init runs them once buttons are in DOM).
    function updateTempoBtn() {
        const el = document.getElementById('tempoBtn');
        if (el) el.textContent = TEMPO + ' BPM';
    }
    function updateSwingBtn() {
        const el = document.getElementById('swingBtn');
        if (!el) return;
        el.textContent = 'SWING ' + (isSwingOn ? 'ON' : 'OFF');
        el.classList.toggle('off', !isSwingOn);
        el.setAttribute('aria-pressed', String(isSwingOn));
    }
    function updateKeyBtn() {
        const el = document.getElementById('keyBtn');
        if (!el) return;
        const preset = KEY_PRESETS.find(k => k.shift === keyShiftSemitones) || KEY_PRESETS[0];
        el.textContent = 'KEY ' + preset.name;
    }
    function updateMoodBtn() {
        const el = document.getElementById('moodBtn');
        if (!el) return;
        el.textContent = SONG_VARIATIONS[songVariationIndex].name;
    }
    // SPACE + FILTER setters (Tier 2). Both idempotent + save on change.
    function setSpace(idx) {
        spaceIndex = idx % SPACE_PRESETS.length;
        const preset = SPACE_PRESETS[spaceIndex];
        spaceLevel = preset.send;
        if (spaceSend && audioCtx) {
            const now = audioCtx.currentTime;
            spaceSend.gain.cancelScheduledValues(now);
            spaceSend.gain.setValueAtTime(spaceSend.gain.value, now);
            // 300ms glide keeps a mid-loop space change smooth; short
            // enough that the tap feels responsive.
            spaceSend.gain.linearRampToValueAtTime(preset.send, now + 0.3);
        }
        if (spaceReverb && spaceReverb.decay !== undefined) {
            // Tone.Reverb regenerates its IR when decay changes. Fine
            // to do on-the-fly; brief silence during regen is inaudible
            // over an active mix.
            try { spaceReverb.decay = preset.decay; } catch (_) {}
        }
    }
    function cycleSpace() {
        setSpace(spaceIndex + 1);
        updateSpaceBtn();
        saveProgress();
    }
    function setFilter(idx) {
        filterIndex = idx % FILTER_PRESETS.length;
        filterBaseHz = FILTER_PRESETS[filterIndex].hz;
        // Reapply the muffle math: setIceMuffle now scales relative to
        // filterBaseHz, so player choice + ice horror compose cleanly.
        applyMasterFilter();
    }
    function cycleFilter() {
        setFilter(filterIndex + 1);
        updateFilterBtn();
        saveProgress();
    }
    // Central applier: reads the current filter base + the live dread
    // stage's ice-muffle multiplier and glides masterLP to the target.
    // Called from setFilter AND from setIceMuffle so both routes stay
    // in agreement.
    function applyMasterFilter() {
        if (!masterLP || !audioCtx) return;
        const ice = typeof isIceOnStage === 'function' && isIceOnStage();
        const stage = typeof dreadStageNow !== 'undefined' ? dreadStageNow : 'calm';
        const suppress = isMadballzMode || isDualBandMode;
        const mult = (suppress || !ice || stage === 'calm') ? 1.0
                   : stage === 'unease'                     ? 0.55
                   : stage === 'dread'                      ? 0.20
                   :                                          0.05;   // terror
        const target = filterBaseHz * mult;
        const now = audioCtx.currentTime;
        masterLP.frequency.cancelScheduledValues(now);
        masterLP.frequency.setValueAtTime(masterLP.frequency.value, now);
        masterLP.frequency.exponentialRampToValueAtTime(Math.max(200, target), now + 2.5);
    }
    function updateSpaceBtn() {
        const el = document.getElementById('spaceBtn');
        if (!el) return;
        el.textContent = SPACE_PRESETS[spaceIndex].name;
        el.classList.toggle('off', spaceIndex === 0);
    }
    function updateFilterBtn() {
        const el = document.getElementById('filterBtn');
        if (!el) return;
        el.textContent = FILTER_PRESETS[filterIndex].name;
    }

    function scheduleStep(step, bar, when) {
        // Single-row v1.0 audio path. In Dual Band Mode the audio is
        // produced by dualRowStep() per band instead; we still run the
        // quarter-note visual/react tick below.
        if (!isDualBandMode) {
            const w = swungWhen(when, step);
            if (isBaseSongOn) {
                const song = currentSong();
                song.play(audioCtx, masterGain, w, step, bar);
                const tone = currentTone();
                if (tone) tone.play(step, bar, w);
            }
            // User-placed mods
            for (let i = 0; i < NUM_SLOTS; i++) {
                const id = slots[i];
                if (!id) continue;
                const ch = CHARACTERS[id];
                if (ch && ch.play) ch.play(audioCtx, masterGain, w, step);
            }
        }
        if (step % 4 === 0) {
            const delayMs = Math.max(0, (when - audioCtx.currentTime) * 1000);
            setTimeout(() => { pulseActiveIcons(); tickReactState(); }, delayMs);
        }
        // Round Robin sequencer — fires once per bar (start-of-bar).
        // Placed here (audio-thread schedule) so the entries land in
        // time with the loop, not on wall-clock drift.
        if (isRoundRobinMode && step === 0) {
            const delayMs = Math.max(0, (when - audioCtx.currentTime) * 1000);
            setTimeout(rrTick, delayMs);
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

    // ---------- MADBALLZ THEME (v1.1) ----------
    // Madballz mode auto-swaps to this brooding minor-key variant instead of
    // Bala's Theme. Same shape as BASE_SONG (chordsByBar + same play(step,bar)
    // signature) so the scheduler picks one or the other by mode without any
    // other logic changes. Progression is i-iv-VI-V in A minor (Am → Dm → F
    // → E) with the raised 7th (G#) in the E chord for that classic dark-
    // cathedral tension that resolves back to Am at the loop point.
    // Instrument palette skews darker than Bala's: sawtooth bass (edgier),
    // triangle pad (same), triangle melody filtered low (mellow + haunting
    // vs Bala's bright square hook). TONE_LAYER ambient is *skipped* in
    // Madballz mode — its Cmaj voicings would clash with the minor keys.
    const MADBALLZ_SONG = {
        chordsByBar: [
            { bass: 110.00, triad: [220.00, 261.63, 329.63], melody: { 0: 440.00, 4: 523.25, 8: 659.25, 12: 523.25 } }, // Am  (A C E)
            { bass:  73.42, triad: [146.83, 174.61, 220.00], melody: { 0: 587.33, 4: 698.46, 8: 587.33, 12: 440.00 } }, // Dm  (D F A)
            { bass:  87.31, triad: [174.61, 220.00, 261.63], melody: { 0: 523.25, 4: 698.46, 8: 523.25, 12: 440.00 } }, // F   (F A C)
            { bass:  82.41, triad: [164.81, 207.65, 246.94], melody: { 0: 493.88, 4: 415.30, 8: 659.25, 12: 415.30 } }  // E   (E G# B) — leading tone, resolves to Am
        ],
        play(ctx, out, when, step, bar) {
            const cb = this.chordsByBar[bar];
            if (!cb) return;
            const BAR_LEN = SECONDS_PER_STEP * STEPS_PER_BAR;

            // Triangle triad pad sustain at the top of each bar. The
            // booming sawtooth bass below is gated behind the BASS button
            // (isBassOn) — the user pulled the bass out of the song by
            // default; clicking BASS layers it back on.
            if (step === 0) {
                if (isBassOn) {
                    const b = ctx.createOscillator();
                    const bg = ctx.createGain();
                    b.type = 'sawtooth';
                    b.frequency.value = cb.bass;
                    // Slightly quieter than BASE_SONG bass — sawtooth is brighter.
                    bg.gain.setValueAtTime(0, when);
                    bg.gain.linearRampToValueAtTime(0.10, when + 0.08);
                    bg.gain.linearRampToValueAtTime(0.08, when + BAR_LEN * 0.7);
                    bg.gain.exponentialRampToValueAtTime(0.001, when + BAR_LEN);
                    b.connect(bg).connect(out);
                    b.start(when); b.stop(when + BAR_LEN + 0.05);
                }

                cb.triad.forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'triangle';
                    o.frequency.value = freq;
                    const peak = 0.040 - i * 0.004;
                    g.gain.setValueAtTime(0, when);
                    g.gain.linearRampToValueAtTime(peak, when + 0.22);
                    g.gain.linearRampToValueAtTime(peak * 0.85, when + BAR_LEN * 0.7);
                    g.gain.exponentialRampToValueAtTime(0.001, when + BAR_LEN);
                    o.connect(g).connect(out);
                    o.start(when); o.stop(when + BAR_LEN + 0.05);
                });
            }

            // Melody hook on quarter notes — triangle through a lowpass for
            // a mellower, more haunting voice than Bala's bright square hook.
            const freq = cb.melody[step];
            if (freq !== undefined) {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.value = 2400;
                f.Q.value = 1;
                o.type = 'triangle';
                o.frequency.value = freq;
                g.gain.setValueAtTime(0, when);
                g.gain.linearRampToValueAtTime(0.065, when + 0.03);
                g.gain.linearRampToValueAtTime(0.05, when + 0.2);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.36);
                o.connect(f).connect(g).connect(out);
                o.start(when); o.stop(when + 0.4);
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

    // ---------- SONG VARIATIONS (Tier-1 music expansion, 2026-07-31) ----------
    // Alternate progressions the MOOD pill cycles through. Each is a
    // {song, tone} pair — song = raw-WebAudio synth (bass/triad/melody),
    // tone = Tone.js ambient pad. Shape-identical to BASE_SONG /
    // TONE_LAYER; each shares its play() with the original by reference
    // so a change to the base playback code lands on every variation for
    // free.
    //
    // Adding a new variation = one new SONG/TONE data object + one entry
    // in SONG_VARIATIONS below. No per-Munki edits — Munki voices are
    // Cmaj-tuned and the global KEY pill's ConstantSourceNode-based
    // pitch shift preserves their harmony with whatever bed is playing.
    const MINOR_SONG = {
        chordsByBar: [
            // Am → Dm → G → C (aeolian loop, resolves back to A minor).
            // Same shape as BASE_SONG; reuses its play() unmodified.
            { bass: 55.00, triad: [220.00, 261.63, 329.63], melody: { 0: 440.00, 4: 523.25, 8: 659.25, 12: 523.25 } },
            { bass: 73.42, triad: [293.66, 349.23, 440.00], melody: { 0: 587.33, 4: 698.46, 8: 587.33, 12: 440.00 } },
            { bass: 49.00, triad: [196.00, 246.94, 293.66], melody: { 0: 493.88, 4: 587.33, 8: 493.88, 12: 392.00 } },
            { bass: 65.41, triad: [261.63, 329.63, 392.00], melody: { 0: 523.25, 4: 659.25, 8: 523.25, 12: 440.00 } }
        ],
        play: BASE_SONG.play   // `this.chordsByBar` picks these bars
    };
    const MINOR_TONE = {
        chordsByBar: [
            ['A3', 'C4', 'E4'],   // Am
            ['D3', 'F3', 'A3'],   // Dm
            ['G3', 'B3', 'D4'],   // G
            ['C4', 'E4', 'G4']    // C
        ],
        play: TONE_LAYER.play
    };
    // AMBIENT holds two Maj7 chords across the 4-bar loop (Cmaj7 for two
    // bars, Fmaj7 for two) with the melody hook removed by leaving an
    // empty `melody: {}` per bar — the shared BASE_SONG.play() renders
    // just the bass + pad triad, which reads as an atmospheric drone.
    const AMBIENT_SONG = {
        chordsByBar: [
            { bass: 32.70, triad: [130.81, 164.81, 196.00, 246.94], melody: {} },  // Cmaj7
            { bass: 32.70, triad: [130.81, 164.81, 196.00, 246.94], melody: {} },  // Cmaj7 held
            { bass: 43.65, triad: [130.81, 174.61, 220.00, 261.63], melody: {} },  // Fmaj7
            { bass: 43.65, triad: [130.81, 174.61, 220.00, 261.63], melody: {} }   // Fmaj7 held
        ],
        play: BASE_SONG.play
    };
    const AMBIENT_TONE = {
        chordsByBar: [
            ['C4', 'E4', 'G4', 'B4'],   // Cmaj7
            ['C4', 'E4', 'G4', 'B4'],   // Cmaj7
            ['C4', 'F4', 'A4', 'C5'],   // Fmaj7 (voiced over C bass)
            ['C4', 'F4', 'A4', 'C5']    // Fmaj7
        ],
        play: TONE_LAYER.play
    };
    const SONG_VARIATIONS = [
        { name: 'SUNNY',   song: BASE_SONG,    tone: TONE_LAYER },
        { name: 'MINOR',   song: MINOR_SONG,   tone: MINOR_TONE },
        { name: 'AMBIENT', song: AMBIENT_SONG, tone: AMBIENT_TONE }
    ];

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

        // ===== MADBALLZ MODZ (sheet: 'mb' → assets/sprites/madballz.png) =====
        // 8 sprites, body color matches each new head sprite's circle so the
        // Madballz tray reads as a clean color group:
        //   PURPLE: mb-brainy, mb-zombi, mb-unc, mb-snooz
        //   ORANGE: mb-pressio, mb-eyeball, mb-sweats
        //   GREEN:  mb-chad
        // Audio profiles are intentionally distinct from the rainbow crew
        // (no kick/snare/sub-bass overlap) so Madballz Mode reads as its
        // own sonic palette — each carries forward the v1.0 sound that
        // was tuned for the previous madballz line, retargeted to the new
        // sprite that best matches the feel.
        'mb-brainy': {
            label: 'Brainy', sheet: 'mb', headFrame: 'brainy',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764', // PURPLE — matches new head circle
            // Bone-rumble: sub thud filtered low — fits the brain-skull vibe.
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

        'mb-zombi': {
            label: 'Zombi', sheet: 'mb', headFrame: 'zombi',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764',
            // Distorted alien-pluck — sawtooth through a wave shaper, sweeps
            // pitch + filter for that staggering undead drag.
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

        'mb-unc': {
            label: 'Unc', sheet: 'mb', headFrame: 'unc',
            bodyColor: '#7e22ce', bodyHi: '#a855f7', bodyShade: '#3b0764',
            // Chopper-LFO bass — angry pulsing low end, the grumpy uncle.
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

        'mb-snooz': {
            label: 'Snooz', sheet: 'mb', headFrame: 'snooz',
            bodyColor: '#1e88e5', bodyHi: '#42a5f5', bodyShade: '#0d47a1', // BLUE — matches new head circle (snooz is the blue madball)
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

        'mb-pressio': {
            label: 'Press', sheet: 'mb', headFrame: 'pressio',
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

        'mb-eyeball': {
            label: 'Eyeball', sheet: 'mb', headFrame: 'eyeball',
            bodyColor: '#1e88e5', bodyHi: '#42a5f5', bodyShade: '#0d47a1', // BLUE — matches new head circle
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
        },

        'mb-sweats': {
            label: 'Sweats', sheet: 'mb', headFrame: 'sweats',
            bodyColor: '#1e88e5', bodyHi: '#42a5f5', bodyShade: '#0d47a1', // BLUE — matches new head circle
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

        'mb-chad': {
            label: 'Chad', sheet: 'mb', headFrame: 'chad',
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
        }
    };

    // Single bank of 7 chips: the 6 rainbow Munkis + the current 7th-wheel
    // antagonist (Ice by default; swaps to Moon once the kid unlocks Moon
    // via the hidden-Easter-egg system — see chunk 3+ work). Moon stays out
    // of BANKS entirely until unlocked so it doesn't appear in the tray.
    const BANKS = [
        { id: 'bank-1', label: 'BANK 1', munkis: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'ice'], unlocked: true }
    ];

    // Madballz mode tray order. Color-grouped (purple → blue → orange →
    // green) for v1.1, matching each head sprite's circle backdrop:
    //   PURPLE: brainy, unc, zombi
    //   BLUE:   snooz, sweats, eyeball
    //   ORANGE: pressio
    //   GREEN:  chad
    // Ice + Moon are NOT included on the Madballz tray — the user pulled
    // them so Madballz mode stays its own self-contained set.
    const MADBALLZ_ORDER = [
        'mb-brainy', 'mb-unc',    'mb-zombi',
        'mb-snooz',  'mb-sweats', 'mb-eyeball',
        'mb-pressio',
        'mb-chad'
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
        rainbow: {
            src: 'assets/sprites/rainbow-munkis.png',
            sheetW: 1001,
            sheetH: 1196,
            // 30 frames = 6 crew colours × 5 expressions. Frame names are
            // `{colorWord}{expr}` (e.g. blue1, purple3, yellow5). The colour
            // is resolved from the Munki's bodyColor via COLOR_BY_BODY →
            // LETTER_TO_HEAD; the expression is chosen at render time by
            // expressionForSlot. Each frame has 2 px in-frame padding +
            // a generous inter-frame gutter so SVG viewBox edge sampling
            // can no longer pull neighbour pixels through (was the root
            // cause of the long-standing sprite-bleed issue).
            frames: {
                blue1:   { x:   2, y:   2, w: 198, h: 198 },
                blue2:   { x: 202, y:   2, w: 197, h: 197 },
                blue3:   { x: 401, y:   2, w: 196, h: 196 },
                blue4:   { x: 601, y:   2, w: 192, h: 192 },
                blue5:   { x: 801, y:   2, w: 193, h: 193 },
                green1:  { x:   2, y: 202, w: 195, h: 195 },
                green2:  { x: 202, y: 202, w: 192, h: 192 },
                green3:  { x: 401, y: 202, w: 195, h: 195 },
                green4:  { x: 601, y: 202, w: 195, h: 195 },
                green5:  { x: 801, y: 202, w: 196, h: 196 },
                orange1: { x:   2, y: 400, w: 196, h: 196 },
                orange2: { x: 202, y: 400, w: 194, h: 194 },
                orange3: { x: 401, y: 400, w: 194, h: 194 },
                orange4: { x: 601, y: 400, w: 193, h: 193 },
                orange5: { x: 801, y: 400, w: 198, h: 198 },
                purple1: { x:   2, y: 600, w: 195, h: 195 },
                purple2: { x: 202, y: 600, w: 194, h: 194 },
                purple3: { x: 401, y: 600, w: 195, h: 195 },
                purple4: { x: 601, y: 600, w: 196, h: 196 },
                purple5: { x: 801, y: 600, w: 195, h: 195 },
                red1:    { x:   2, y: 798, w: 195, h: 195 },
                red2:    { x: 202, y: 798, w: 194, h: 194 },
                red3:    { x: 401, y: 798, w: 198, h: 198 },
                red4:    { x: 601, y: 798, w: 198, h: 198 },
                red5:    { x: 801, y: 798, w: 198, h: 198 },
                yellow1: { x:   2, y: 998, w: 194, h: 194 },
                yellow2: { x: 202, y: 998, w: 194, h: 194 },
                yellow3: { x: 401, y: 998, w: 196, h: 196 },
                yellow4: { x: 601, y: 998, w: 195, h: 195 },
                yellow5: { x: 801, y: 998, w: 196, h: 196 }
            }
        },
        icemoon: {
            src: 'assets/sprites/ice-moon.png',
            sheetW: 993,
            sheetH: 400,
            // 10 frames = 2 evil Munkis × 5 expressions. Frame names are
            // `ice1..5` and `moon1..5`. Split off from the rainbow crew
            // sheet so the antagonists can ship their own evolving art
            // and the crew sheet stays packed tight.
            frames: {
                ice1:  { x:   2, y:   2, w: 196, h: 196 },
                ice2:  { x: 200, y:   2, w: 195, h: 195 },
                ice3:  { x: 397, y:   2, w: 194, h: 194 },
                ice4:  { x: 596, y:   2, w: 197, h: 197 },
                ice5:  { x: 795, y:   2, w: 192, h: 192 },
                moon1: { x:   2, y: 201, w: 196, h: 196 },
                moon2: { x: 200, y: 201, w: 195, h: 195 },
                moon3: { x: 397, y: 201, w: 197, h: 197 },
                moon4: { x: 596, y: 201, w: 197, h: 197 },
                moon5: { x: 795, y: 201, w: 196, h: 196 }
            }
        },
        mb: {
            src: 'assets/sprites/madballz.png',
            sheetW: 874,
            sheetH: 442,
            // 8 Madballz heads on a 4×2 grid: ~216 px square, 2–4 px gutters.
            // Frame names are short single-word ids that match the new
            // sheet's JSON (brainy, chad, eyeball, pressio, snooz, sweats,
            // unc, zombi). Each character def below pairs its head sprite
            // with a bodyColor that matches that head's circle backdrop:
            //   PURPLE backdrop: brainy, snooz, unc, zombi
            //   ORANGE backdrop: eyeball, pressio, sweats
            //   GREEN  backdrop: chad
            frames: {
                brainy:  { x:   2, y:   2, w: 216, h: 216 },
                chad:    { x: 220, y:   2, w: 216, h: 215 },
                eyeball: { x: 438, y:   2, w: 216, h: 218 },
                pressio: { x: 656, y:   2, w: 216, h: 218 },
                snooz:   { x:   2, y: 222, w: 216, h: 216 },
                sweats:  { x: 220, y: 222, w: 216, h: 217 },
                unc:     { x: 438, y: 222, w: 216, h: 218 },
                zombi:   { x: 656, y: 222, w: 216, h: 217 }
            }
        }
    };

    // The two antagonists in the lore. When either ICE MUNKI or MOON MUNKI
    // is dropped onto a slot, the jumpscare fires automatically AND counts
    // toward unlocking the Madballz screen (see MADBALLZ_UNLOCK_THRESHOLD).
    const HORROR_TRIGGER_MODS = new Set(['ice', 'moon']);

    // ---------- NAMED COMBOS ----------
    // Detects arrangements worth calling out with a subtitle. Purely
    // display — no scoring, no persistence, no sound. When the current
    // slots match multiple entries, the highest-priority one wins;
    // when nothing matches, the last subtitle fades out. A combo
    // holds visible while its condition remains true and re-shows only
    // when it becomes true again (so rearranging inside the same combo
    // doesn't blink the label).
    const CREW = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    const WARM = ['red', 'orange', 'yellow'];
    const COOL = ['green', 'blue', 'purple'];
    function crewCount(set) {
        let n = 0;
        for (const c of CREW) if (set.has(c)) n++;
        return n;
    }
    const NAMED_COMBOS = [
        { name: 'FULL RAINBOW',   priority: 100, className: 'combo-rainbow',
          detect: s => CREW.every(c => s.has(c)) && !s.has('ice') && !s.has('moon') },
        { name: 'CURSED CHOIR',   priority:  90, className: 'combo-cursed',
          detect: s => s.has('ice') && s.has('moon') && crewCount(s) >= 3 },
        { name: 'THE COUP',       priority:  85, className: 'combo-coup',
          detect: s => s.has('ice') && s.has('moon') && crewCount(s) === 0 },
        { name: 'HALF LIGHT',     priority:  70, className: 'combo-ice',
          detect: s => s.has('ice') && !s.has('moon') && crewCount(s) >= 3 },
        { name: 'HAUNTED',        priority:  70, className: 'combo-moon',
          detect: s => s.has('moon') && !s.has('ice') && crewCount(s) >= 3 },
        { name: 'WARM SIDE',      priority:  50, className: 'combo-warm',
          detect: s => WARM.every(c => s.has(c)) && !COOL.some(c => s.has(c))
                    && !s.has('ice') && !s.has('moon') },
        { name: 'COOL SIDE',      priority:  50, className: 'combo-cool',
          detect: s => COOL.every(c => s.has(c)) && !WARM.some(c => s.has(c))
                    && !s.has('ice') && !s.has('moon') }
    ];
    let comboLastName = null;
    function checkNamedCombo() {
        // Dual Band / Madballz have their own stage semantics — the combo
        // catalogue was built for the Standard bank's crew + Ice/Moon. Skip
        // outside that mode to avoid mislabeling a Madballz set as "COOP".
        if (isMadballzMode || isDualBandMode) { showCombo(null); return; }
        const set = new Set(slots.filter(Boolean));
        let match = null;
        for (const c of NAMED_COMBOS) {
            if (c.detect(set) && (!match || c.priority > match.priority)) match = c;
        }
        showCombo(match);
    }
    function showCombo(combo) {
        const el = document.getElementById('combo-subtitle');
        if (!el) return;
        const name = combo && combo.name;
        if (name === comboLastName) return;
        comboLastName = name;
        // Wipe prior per-combo class before applying the new one so old
        // palette accents don't leak between labels.
        el.className = 'combo-subtitle';
        if (name) {
            el.textContent = name;
            if (combo.className) el.classList.add(combo.className);
            el.classList.add('is-shown');
        } else {
            el.classList.remove('is-shown');
        }
    }

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

    // Bridges COLOR_BY_BODY's single-letter codes to the (sheet, framePrefix)
    // they live on under the new split sheets. Frame names compose as
    // `${prefix}${expr}` — e.g. blue3, ice2, moon5 — replacing the old
    // `${expr}-${letter}` scheme that lived on the unified default-heads.
    const LETTER_TO_HEAD = {
        'B': { sheet: 'rainbow', prefix: 'blue'   },
        'G': { sheet: 'rainbow', prefix: 'green'  },
        'O': { sheet: 'rainbow', prefix: 'orange' },
        'P': { sheet: 'rainbow', prefix: 'purple' },
        'R': { sheet: 'rainbow', prefix: 'red'    },
        'Y': { sheet: 'rainbow', prefix: 'yellow' },
        'X': { sheet: 'icemoon', prefix: 'moon'   },  // Moon Munki — X = black-glitch
        'Z': { sheet: 'icemoon', prefix: 'ice'    }   //  Ice Munki — Z = white-glitch
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
    // Was 3 on the old packed default-heads sheet (only 2 px gutter between
    // 198 px frames — bilinear sampling at the viewBox edge pulled pixels
    // from the neighbouring head). Even after the split rainbow-munkis +
    // ice-moon sheets shipped with 2 px in-frame padding + a generous
    // inter-frame gutter, an inset of 2 still showed faint bleed on heads
    // because SVG's own rasterisation step is doing its own resampling
    // independent of `image-rendering: pixelated`. Bumping to 4 burns a
    // few more source pixels but the sprite art has enough transparent
    // padding inside each frame to absorb it — and it kills the bleed.
    const FRAME_BLEED_INSET = 4;
    // Flying Creeps need a MUCH larger inset than the head sheets. The
    // STANDARD creep sheet is a uniform 6×5 grid of the 1310×1412 image
    // (~218×282 px cells) with the cells tiling EDGE-TO-EDGE (no gutter —
    // each frame's rect touches its neighbours). paintCreepFrame scales a
    // frame down into the responsive creep box via CSS background-size —
    // a multi-× downscale — so without a source inset bilinear sampling
    // at the touching edge pulls in a sliver of the adjacent frame. 8
    // source px (~3.7% per side here, invisible because the creature art
    // has transparent padding inside each cell) clears the sampling
    // window with margin. Heads use SVG viewBox cropping on a smaller,
    // lightly-scaled sheet, so 1px stays correct for them — do NOT raise
    // FRAME_BLEED_INSET to "fix" creeps.
    const CREEP_BLEED_INSET = 8;
    function headModArt(frameName, sheetName) {
        const sheet = SHEETS[sheetName || 'rainbow'];
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
    //   PANIC fear   →  cycles 1→2→3→4→5→1 every quarter note (the
    //                   unified fear ladder — munkiFear >= FEAR.PANIC,
    //                   fed by creep proximity OR Ice/Moon adjacency)
    //   FLINCH fear  →  2 (shocked) + .creep-scared shake
    //   just placed  →  2 (shocked, ~600 ms after a fresh drop)
    //   manual tap   →  whichever expression the kid last tapped to
    //   default      →  1 (silly / idle)
    const PLACED_SHOCK_MS = 600;
    const placedAt = new Map();         // slotIndex → performance.now()
    const manualExpression = new Map();  // slotIndex → 1..5 (set by tap-cycle)
    let beatCounter = 0;                 // monotonically ticks on every quarter note

    function expressionForSlot(slotIndex) {
        if (slotIndex == null) return 1;
        if (isJumpScareActive) return 2;
        const id = slots[slotIndex];
        if (!id) return 1;
        const isEvil = (id === 'ice' || id === 'moon');
        // Unified fear ladder (creep proximity OR Ice/Moon adjacency):
        //   >= PANIC  → full freak-out, cycle 1→5 anchored on the beat
        //               panic started (staggered by slot so the dread
        //               ripples instead of lock-stepping)
        //   >= FLINCH → shocked (2); the .creep-scared shake compounds
        if (!isEvil) {
            const f = munkiFear.get(slotIndex) || 0;
            if (f >= FEAR.PANIC) {
                const a = panicStartBeat.has(slotIndex)
                    ? panicStartBeat.get(slotIndex) : beatCounter;
                return (((beatCounter - a) + slotIndex) % 5) + 1;
            }
            if (f >= FEAR.FLINCH) return 2;
        }
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

    // ----- Dread meter (CHUNK 1) -----
    // Stage from the meter value.
    function dreadStage() {
        return dread >= DREAD.TERROR ? 'terror'
             : dread >= DREAD.DREAD  ? 'dread'
             : dread >= DREAD.UNEASE ? 'unease'
             :                         'calm';
    }
    // Live "threat pressure" the meter eases toward = the total
    // unified Munki fear on stage. Since munkiFear is now fed by BOTH
    // creep proximity AND Ice/Moon adjacency (Chunk 2), summing it
    // captures every threat source without double-counting.
    function dreadPressure() {
        let p = 0;
        munkiFear.forEach(v => { p += v; });
        return p;
    }
    // CHUNK 3: the SINGLE owner of the horror presentation. On a stage
    // change it sets body.dread-<stage>, drives the legacy
    // `react-mode-active` (= stage is dread|terror, so every existing
    // horror CSS rule keeps working unchanged — the full look is the
    // `dread` tier; `unease` adds a subtle pre-horror layer, `terror`
    // amps beyond it), the global Munki face-cycle (`horrorActive`),
    // the stage-leveled sub-bass drone, and the falling-moon gate.
    function applyDreadStageClass() {
        const s = dreadStage();
        if (s === dreadStageNow) return;
        document.body.classList.remove('dread-' + dreadStageNow);
        document.body.classList.add('dread-' + s);
        dreadStageNow = s;
        const horror = (s === 'dread' || s === 'terror');
        document.body.classList.toggle('react-mode-active', horror);
        if (horror && !horrorActive) horrorStartBeat = beatCounter;
        horrorActive = horror;
        setReactDrone(s === 'terror' ? 0.5
                    : s === 'dread'  ? 0.32
                    : s === 'unease' ? 0.12
                    :                  0);
        // Falling-moon atmosphere gate (owner moved here from
        // syncHorrorMode): stamp when full horror engages so it can
        // wait out the 12 s creep-in ramp; clear when it lifts.
        if (horror && !horrorOnSince) horrorOnSince = performance.now();
        if (!horror) horrorOnSince = 0;
        syncMoonFall();
        // Ice personality (Chunk 5): scale the master lowpass muffle +
        // the snow atmosphere by the same stage. Both no-op unless Ice
        // is actually on stage.
        setIceMuffle(s);
        syncSnowFall();
    }
    function dreadTick(ts) {
        if (document.hidden) {
            dreadRAF = requestAnimationFrame(dreadTick);
            dreadLastTs = ts;
            return;
        }
        const dt = Math.min(0.05, (ts - dreadLastTs) / 1000) || 0;
        dreadLastTs = ts;
        const target = Math.min(100, dreadPressure());
        if (target > dread) {
            dread = Math.min(100, dread + DREAD.RISE_PER_S * dt);
        } else {
            const dec = dread > DREAD.DREAD
                ? DREAD.DECAY_HIGH_PER_S : DREAD.DECAY_PER_S;
            dread = Math.max(0, dread - dec * dt);
        }
        applyDreadStageClass();
        // Moon "perception lies" (Chunk 4): while Moon is on stage AND
        // fully dreaded, a phantom Munki occasionally flickers into an
        // empty slot — NON-destructive (never touches slots[]); more
        // often at terror. The CSS hue-warp layer is driven separately
        // by body.moon-present + the stage class.
        if (moonOnStage()
            && (dreadStageNow === 'dread' || dreadStageNow === 'terror')) {
            const terror = (dreadStageNow === 'terror');
            const lo = terror ? DREAD.PHANTOM_TERROR_MIN_MS
                              : DREAD.PHANTOM_DREAD_MIN_MS;
            const hi = terror ? DREAD.PHANTOM_TERROR_MAX_MS
                              : DREAD.PHANTOM_DREAD_MAX_MS;
            if (!moonPhantomNextAt) {
                moonPhantomNextAt = ts + rand(lo, hi);
            } else if (ts >= moonPhantomNextAt) {
                moonPhantomDrop();
                moonPhantomNextAt = ts + rand(lo, hi);
            }
        } else {
            moonPhantomNextAt = 0;
        }
        // Self-stop at idle (no meter, no pressure) — restarted by
        // kickDread() the next time a contributor appears.
        if (dread <= 0 && target <= 0) { dreadRAF = null; return; }
        dreadRAF = requestAnimationFrame(dreadTick);
    }
    // Ensure the meter loop is running (cheap; self-stops when idle).
    function kickDread() {
        if (dreadRAF) return;
        dreadLastTs = performance.now();
        dreadRAF = requestAnimationFrame(dreadTick);
    }
    // Instant meter bump (jumpscare). Clamped; restarts the loop.
    function addDread(n) {
        dread = Math.max(0, Math.min(100, dread + n));
        applyDreadStageClass();
        kickDread();
    }

    // Single owner of the `.creep-scared` shake class + the afraidSlots
    // diff set. A Munki is "afraid" (shake + shocked face) whenever its
    // unified fear is >= FLINCH, regardless of source (creep OR Ice/
    // Moon). Idempotent; only re-renders a slot on a membership change.
    // Called per beat (tickReactState) AND per creep frame (creepTick)
    // so the shake appears the instant a creep gets close.
    function refreshFearVisuals() {
        for (let i = 0; i < NUM_SLOTS; i++) {
            const id = slots[i];
            const f = munkiFear.get(i) || 0;
            const afraid = !!id && id !== 'ice' && id !== 'moon'
                           && f >= FEAR.FLINCH;
            if (afraid === afraidSlots.has(i)) continue;
            const el = document.querySelector(
                `.stage-slot[data-index="${i}"]`);
            if (afraid) {
                afraidSlots.add(i);
                if (el) el.classList.add('creep-scared');
            } else {
                afraidSlots.delete(i);
                if (el) el.classList.remove('creep-scared');
            }
            renderSlot(i);
        }
    }

    // Beat-quantised fear update. Fires once per quarter note (from
    // scheduleStep). Ice/Moon adjacency RAMPS the unified per-Munki
    // fear (~8 beats to PANIC, matching the old dwell feel); creep
    // proximity ramps it from creepTick between beats. A central decay
    // bleeds fear off once nothing has fed a slot recently (fearFedAt),
    // so the kid can still rescue a Munki by pulling it away in time.
    function tickReactState() {
        beatCounter++;
        const now = performance.now();
        const toRender = new Set();
        for (let i = 0; i < NUM_SLOTS; i++) {
            const id = slots[i];
            if (!id || id === 'ice' || id === 'moon') {
                munkiFear.delete(i);
                if (panicStartBeat.delete(i)) toRender.add(i);
                fearFedAt.delete(i);
                continue;
            }
            let f = munkiFear.get(i) || 0;
            const adj = isTriggerAdjacent(i);
            if (adj) { f += FEAR.ADJ_GAIN_PER_BEAT; fearFedAt.set(i, now); }
            const fedRecently = (now - (fearFedAt.get(i) || 0)) < 350;
            if (!adj && !fedRecently) f -= FEAR.DECAY_PER_BEAT;
            f = Math.max(0, Math.min(FEAR.MAX, f));
            munkiFear.set(i, f);
            if (f >= FEAR.PANIC && !panicStartBeat.has(i)) {
                panicStartBeat.set(i, beatCounter);
                manualExpression.delete(i); // panic overrides a prior tap
            } else if (f < FEAR.PANIC_RELEASE && panicStartBeat.has(i)) {
                panicStartBeat.delete(i);
            }
            if (f >= FEAR.FLINCH) toRender.add(i); // face advances/holds
        }
        refreshFearVisuals();   // shake class diff (unified)
        kickDread();            // keep the dread meter ticking (Chunk 1)
        syncHorrorMode();
        // While horror is on, every occupied non-evil Munki cycles —
        // re-render them all each beat so the sprites actually advance.
        if (horrorActive) {
            for (let i = 0; i < NUM_SLOTS; i++) {
                const sid = slots[i];
                if (sid && sid !== 'ice' && sid !== 'moon') toRender.add(i);
            }
        }
        toRender.forEach(i => renderSlot(i));
    }

    // Chunk 3: the dread STAGE is the single source of truth now (see
    // applyDreadStageClass — it owns react-mode-active / horrorActive /
    // drone / moon-fall). This is just the prompt-engage hook: callers
    // (tickReactState every beat, the creep fear logic) poke it so the
    // meter loop is alive and re-stages immediately, instead of waiting
    // for the next pressure change.
    function syncHorrorMode() {
        kickDread();
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
            const info = letter && LETTER_TO_HEAD[letter];
            if (info) inner = headModArt(`${info.prefix}${expr}`, info.sheet);
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
            // Sulk / seventhWheel / chip-swap machinery retired 2026-07-30
            // when Ice + Moon became coexisting tray citizens (see
            // syncBankWithSeventhWheel + unlockMoon). Neither evil is
            // "the lonely 7th wheel" any more, so neither gets the sad
            // face + droop animation + tap-to-swap badge that used to
            // render here.
            el.innerHTML = `
                <div class="chip-icon">${characterArt(id, undefined, undefined)}</div>
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
            // Label ONLY for Madballz — the rainbow crew (+ Ice/Moon) is
            // identified by color, so a redundant name plate under the
            // sprite just adds noise. Madballz aren't color-coded the same
            // way and their names (BRAINY, ZOMBI, CHAD…) carry info.
            const showLabel = ch.sheet === 'mb';
            slot.innerHTML = `
                <div class="slot-icon">${characterArt(id, index)}</div>
                ${showLabel ? `<div class="slot-label">${ch.label}</div>` : ''}
            `;
        } else {
            slot.classList.remove('active');
            slot.classList.remove('slot-bad');
            slot.classList.add('empty');
            delete slot.dataset.char;
            slot.removeAttribute('title');
            // Empty slot: the '+' placeholder is enough — no 'EMPTY' text.
            slot.innerHTML = `
                <div class="slot-icon slot-empty"><span class="empty-plus">+</span></div>
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
        munkiFear.delete(index);
        panicStartBeat.delete(index);
        fearFedAt.delete(index);
        if (afraidSlots.delete(index)) {
            const ael = document.querySelector(
                `.stage-slot[data-index="${index}"]`);
            if (ael) ael.classList.remove('creep-scared');
        }
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
        // New achievement family: solid colours, palindromic / repeating
        // patterns, band-fill milestones, first encounter with Ice or Moon.
        if (charId) checkColdSnap(charId);
        checkSolidSquad();
        checkPattern();
        checkBandMilestones();
        // Moon added to / removed from the stage mid-horror → re-evaluate
        // the falling-moon atmosphere promptly, and flag Moon presence
        // for the stage-scaled "perception lies" chaos (Chunk 4).
        document.body.classList.toggle('moon-present', moonOnStage());
        syncMoonFall();
        // Void: anti-hero counter-presence, appears ONLY when BOTH Ice
        // AND Moon are on stage. Purely visual; CSS gates the full-body
        // central sprite behind body.void-present.
        document.body.classList.toggle('void-present', isIceOnStage() && moonOnStage());
        // Named-combo subtitle (FULL RAINBOW / CURSED CHOIR / etc). Cheap
        // enough to run on every slot change; showCombo() debounces same-
        // combo repeats so re-arranging inside the same combo is silent.
        checkNamedCombo();
    }

    function isIceOnStage() {
        return slots.indexOf('ice') !== -1;
    }

    // Toggles `.frozen-by-ice` on every active non-ice slot whenever an
    // Ice Munki is on the board. Class is only added on the transition
    // from unfrozen → frozen so the ice-climb animation re-fires for
    // fresh victims, but doesn't loop forever on already-frozen slots.
    // After ICE_ENCASE_MS (matches the @keyframes ice-climb duration),
    // .frozen-encased is added — that's the moment the bounce stops.
    const ICE_ENCASE_MS = 3500;
    const iceEncaseTimers = new Map(); // slotIndex → setTimeout id
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
                // Schedule the "head finally encased → bouncing stops"
                // transition to land when the climb animation tops out.
                clearTimeout(iceEncaseTimers.get(idx));
                iceEncaseTimers.set(idx, setTimeout(() => {
                    if (slot.classList.contains('frozen-by-ice')) {
                        slot.classList.add('frozen-encased');
                    }
                    iceEncaseTimers.delete(idx);
                }, ICE_ENCASE_MS));
            } else if (!shouldFreeze && wasFrozen) {
                slot.classList.remove('frozen-by-ice', 'frozen-encased');
                const t = iceEncaseTimers.get(idx);
                if (t) { clearTimeout(t); iceEncaseTimers.delete(idx); }
            }
        });
        // Ice presence changed — refresh the Chunk 5 atmosphere
        // immediately (not just on the next dread-stage transition).
        setIceMuffle(dreadStageNow);
        syncSnowFall();
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
        // Dual Band Mode is a composition surface — scares would blow up
        // the layering performance, so bypass entirely (mirrors the
        // Madballz-mode design where Ice/Moon aren't even in the tray;
        // Dual Band DOES ship them, so we need an active bypass).
        if (isDualBandMode) return;
        if (isJumpScareActive) return;
        isJumpScareActive = true;
        addDread(DREAD.JUMPSCARE_SPIKE);   // instant meter spike

        // Make sure the audio engine is alive before we try to play anything;
        // also lets the kid trigger a scare as their very first interaction.
        ensureAudio();

        // CHUNK 3 gating: the FULL scare (shriek + screen flash) only
        // fires once dread has reached the `dread` stage. A legit
        // Ice/Moon drop self-qualifies — its JUMPSCARE_SPIKE (60) lifts
        // the meter past DREAD on the spot. Below that it's a soft beat:
        // the dread bump + a brief shocked face, no full-screen scare.
        if (dreadStage() !== 'dread' && dreadStage() !== 'terror') {
            renderAllSlots();
            setTimeout(() => {
                isJumpScareActive = false;
                renderAllSlots();
            }, 500);
            return;
        }
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
        // Dual Band Mode: clicks are the composition instrument (footswitch
        // taps, Munki drags). Chaos hijacking those taps would be actively
        // hostile. Bypass to keep the mode clean, same rationale as the
        // triggerJumpScare early-return above.
        if (isDualBandMode) return;
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

    // ---------- FALLING MOON + COMET SPRITES (v1.1 atmospheric) -------
    // While Moon Munki is ON the stage AND horror mode is FULLY engaged
    // (react-mode-active sustained PAST the 12 s creep-in ramp), the sky
    // rains down the whole viewport: mostly small MOON sprites — parallax
    // by size (smaller=further=slower), gentle sway, fade near the floor
    // — punctuated by the occasional big, fast, diagonal COMET streak
    // (COMET_CHANCE per spawn). This is the Moon trigger's signature
    // atmosphere (locked "per-trigger atmosphere" design). Reuses the
    // sky-items moon + comet art (NO emoji — UI is emoji-free post-FNAF);
    // drawn fallbacks if the sheet is absent. Single rAF spawn loop (no
    // setInterval drift); CSS does the travel on the compositor;
    // animationend auto-removes each sprite. Tunable knobs below; drop-in
    // art path documented in CLAUDE.md. Future: Ice on stage during
    // horror → same engine, snowflake sprite + cyan tint.
    const MOON_FALL = {
        SPAWN_MIN_MS:   200,
        SPAWN_MAX_MS:   400,
        MIN_PX:         12,    // smaller = further = slower
        MAX_PX:         32,    // larger  = nearer  = faster
        FALL_MIN_S:     4,
        FALL_MAX_S:     8,
        RAMP_MS:        12000, // horror creep-in must complete first
        MAX_CONCURRENT: 30,
        STOP_FADE_MS:   2500,
        // Comets: bigger, SLOW, shaky, glitchy DIAGONAL falls woven into
        // the Moon-horror rain (locked "per-trigger atmosphere" — Moon-
        // horror = moons + comets). A haunted shooting star that doesn't
        // know where it's going: slow descent, per-instant jitter, and
        // opacity/colour flicker (CSS comet-streak/-jitter/-flicker).
        // Each spawn rolls COMET_CHANCE to be a comet instead of a moon
        // (only if the sheet has comet frames). Chance trimmed a touch
        // because the slower fall keeps each one on screen ~2-3× longer
        // — keeps them eerie accents, not a constant shower.
        COMET_CHANCE:   0.05,
        COMET_MIN_PX:   48,
        COMET_MAX_PX:   88,
        COMET_FALL_MIN_S: 4.0,   // slow, takes its time
        COMET_FALL_MAX_S: 7.0,
        COMET_DX_MIN_VW: 22,     // still diagonal — horizontal travel
        COMET_DX_MAX_VW: 58
    };
    let moonFallLayer = null, moonFallActive = false, moonFallRAF = null;
    let moonFallNextAt = 0, horrorOnSince = 0, moonFallRampTimer = null;

    function moonOnStage() { return slots.indexOf('moon') !== -1; }
    function moonFallShouldRun() {
        return moonOnStage()
            && document.body.classList.contains('react-mode-active')
            && horrorOnSince
            && (performance.now() - horrorOnSince) >= MOON_FALL.RAMP_MS;
    }

    function spawnFallingMoon() {
        if (!moonFallLayer) return;
        const m = document.createElement('span');
        const size = MOON_FALL.MIN_PX +
            Math.random() * (MOON_FALL.MAX_PX - MOON_FALL.MIN_PX);
        const sheet = skyItemsSheet;
        let css;
        if (sheet && sheet.moons.length) {
            const f = sheet.moons[(Math.random() * sheet.moons.length) | 0];
            const b = SKY_RAIN_INSET;
            const iw = f.w - 2 * b, ih = f.h - 2 * b;
            const sc = size / Math.max(iw, ih);
            css = `background-image:url('${sheet.src}');background-repeat:no-repeat;` +
                  `background-size:${sheet.sheetW * sc}px ${sheet.sheetH * sc}px;` +
                  `background-position:${-(f.x + b) * sc}px ${-(f.y + b) * sc}px;` +
                  `width:${iw * sc}px;height:${ih * sc}px;`;
        } else {
            css = `width:${size}px;height:${size}px;border-radius:50%;` +
                  `background:radial-gradient(circle at 38% 36%,#dbeafe,#1e293b 72%);` +
                  `box-shadow:0 0 8px rgba(147,197,253,0.6);`;
        }
        const frac = (size - MOON_FALL.MIN_PX) / (MOON_FALL.MAX_PX - MOON_FALL.MIN_PX);
        const dur  = MOON_FALL.FALL_MAX_S
                   - frac * (MOON_FALL.FALL_MAX_S - MOON_FALL.FALL_MIN_S);
        m.style.cssText = css +
            `left:${(Math.random() * 100).toFixed(2)}vw;` +
            `--amp:${(6 + Math.random() * 12).toFixed(1)}px;` +
            `animation-duration:${dur.toFixed(2)}s;`;
        m.addEventListener('animationend', () => m.remove());
        moonFallLayer.appendChild(m);
        while (moonFallLayer.childElementCount > MOON_FALL.MAX_CONCURRENT) {
            moonFallLayer.removeChild(moonFallLayer.firstChild);
        }
    }

    // Rarer, bigger, fast DIAGONAL streak. Same .moon-fall layer (so it
    // shares the cap / fade / teardown); CSS class `comet` swaps it to
    // the comet-streak keyframe driven by the per-comet --dx / --rot.
    function spawnFallingComet() {
        if (!moonFallLayer) return;
        const sheet = skyItemsSheet;
        const m = document.createElement('span');
        m.className = 'comet';
        const size = MOON_FALL.COMET_MIN_PX +
            Math.random() * (MOON_FALL.COMET_MAX_PX - MOON_FALL.COMET_MIN_PX);
        let css;
        if (sheet && sheet.comets && sheet.comets.length) {
            const f = sheet.comets[(Math.random() * sheet.comets.length) | 0];
            const b = SKY_RAIN_INSET;
            const iw = f.w - 2 * b, ih = f.h - 2 * b;
            const sc = size / Math.max(iw, ih);
            css = `background-image:url('${sheet.src}');background-repeat:no-repeat;` +
                  `background-size:${sheet.sheetW * sc}px ${sheet.sheetH * sc}px;` +
                  `background-position:${-(f.x + b) * sc}px ${-(f.y + b) * sc}px;` +
                  `width:${iw * sc}px;height:${ih * sc}px;`;
        } else {
            // Drawn fallback: bright head + a fading streak tail.
            css = `width:${size}px;height:${Math.max(3, size * 0.18).toFixed(1)}px;` +
                  `border-radius:50%;background:linear-gradient(90deg,` +
                  `rgba(186,230,253,0) 0%,rgba(191,219,254,0.55) 45%,#ffffff 100%);` +
                  `box-shadow:0 0 14px rgba(186,230,253,0.85);`;
        }
        // Comets only ever enter diagonally from a TOP CORNER — never
        // mid-screen. 50/50 between top-LEFT (travel down-right) and
        // top-RIGHT (travel down-left). The sprite is horizontally
        // mirrored (scaleX -1 via --flip-x in the comet-streak keyframe)
        // when entering from the LEFT so the tail trails behind its
        // travel direction in either case.
        const enterFromLeft = Math.random() < 0.5;
        const dir = enterFromLeft ? 1 : -1;        // dir > 0 = going right; dir < 0 = going left
        const dx  = dir * (MOON_FALL.COMET_DX_MIN_VW +
            Math.random() * (MOON_FALL.COMET_DX_MAX_VW - MOON_FALL.COMET_DX_MIN_VW));
        const rot = dir > 0 ? 28 : -28;
        const dur = MOON_FALL.COMET_FALL_MIN_S +
            Math.random() * (MOON_FALL.COMET_FALL_MAX_S - MOON_FALL.COMET_FALL_MIN_S);
        // Hug the entry edge — tight cluster, no mid-screen launches.
        const startLeft = enterFromLeft
            ? (-8 + Math.random() * 10)            // top-left:  -8 to +2 vw
            : (98 + Math.random() * 10);           // top-right: +98 to +108 vw
        const flipX = enterFromLeft ? -1 : 1;
        m.style.cssText = css +
            `left:${startLeft.toFixed(2)}vw;` +
            `--dx:${dx.toFixed(1)}vw;` +
            `--rot:${rot}deg;` +
            `--dur:${dur.toFixed(2)}s;` +
            `--flip-x:${flipX};`;
        m.addEventListener('animationend', () => m.remove());
        moonFallLayer.appendChild(m);
        while (moonFallLayer.childElementCount > MOON_FALL.MAX_CONCURRENT) {
            moonFallLayer.removeChild(moonFallLayer.firstChild);
        }
    }

    function moonFallTick(ts) {
        if (!moonFallActive || !moonFallLayer) { moonFallRAF = null; return; }
        if (ts >= moonFallNextAt) {
            if (skyItemsSheet && skyItemsSheet.comets
                && skyItemsSheet.comets.length
                && Math.random() < MOON_FALL.COMET_CHANCE) {
                spawnFallingComet();
            } else {
                spawnFallingMoon();
            }
            moonFallNextAt = ts + MOON_FALL.SPAWN_MIN_MS +
                Math.random() * (MOON_FALL.SPAWN_MAX_MS - MOON_FALL.SPAWN_MIN_MS);
        }
        moonFallRAF = requestAnimationFrame(moonFallTick);
    }

    function startMoonFall() {
        if (moonFallActive) return;
        moonFallActive = true;
        moonFallLayer = document.createElement('div');
        moonFallLayer.className = 'moon-fall';
        moonFallLayer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(moonFallLayer);
        moonFallNextAt = 0; // spawn on the first frame
        moonFallRAF = requestAnimationFrame(moonFallTick);
    }

    function stopMoonFall() {
        if (!moonFallActive) return;
        moonFallActive = false;
        if (moonFallRAF) { cancelAnimationFrame(moonFallRAF); moonFallRAF = null; }
        const dying = moonFallLayer;
        moonFallLayer = null;
        if (dying) {
            dying.classList.add('fading'); // CSS fades the airborne sprites
            setTimeout(() => dying.remove(), MOON_FALL.STOP_FADE_MS);
        }
    }

    // Central evaluator — safe from anywhere (horror transitions, slot
    // changes). Arms a one-shot timer so it auto-starts the instant the
    // 12 s ramp completes even if no other event fires.
    function syncMoonFall() {
        if (moonFallRampTimer) { clearTimeout(moonFallRampTimer); moonFallRampTimer = null; }
        if (moonFallShouldRun()) {
            startMoonFall();
        } else {
            stopMoonFall();
            if (moonOnStage()
                && document.body.classList.contains('react-mode-active')
                && horrorOnSince) {
                const remain = MOON_FALL.RAMP_MS - (performance.now() - horrorOnSince);
                if (remain > 0) moonFallRampTimer = setTimeout(syncMoonFall, remain + 50);
            }
        }
    }

    // ---------- FALLING SNOWFLAKES (v1.1 — Ice atmosphere, Chunk 5) ----------
    // Sibling of MOON_FALL: while Ice Munki is ON the stage AND horror
    // is fully engaged past the 12 s ramp, gentle snow drifts down. NO
    // sheet — each particle is a tiny cyan/white speck (drawn fallback,
    // can swap to a real snowflake sheet later by editing the inline
    // background). Same self-managing rAF + fade-out pattern.
    const SNOW_FALL = {
        SPAWN_MIN_MS:   220,
        SPAWN_MAX_MS:   450,
        MIN_PX:         18,
        MAX_PX:         42,
        FALL_MIN_S:     6,    // gentler than moons
        FALL_MAX_S:     11,
        RAMP_MS:        12000,
        MAX_CONCURRENT: 36,
        STOP_FADE_MS:   2500
    };
    let snowFallLayer = null, snowFallActive = false, snowFallRAF = null;
    let snowFallNextAt = 0, snowFallRampTimer = null;

    function snowFallShouldRun() {
        return isIceOnStage()
            && document.body.classList.contains('react-mode-active')
            && horrorOnSince
            && (performance.now() - horrorOnSince) >= SNOW_FALL.RAMP_MS;
    }
    function spawnFallingSnowflake() {
        if (!snowFallLayer) return;
        const s = document.createElement('span');
        const size = SNOW_FALL.MIN_PX +
            Math.random() * (SNOW_FALL.MAX_PX - SNOW_FALL.MIN_PX);
        // ice-chunks.png is a 3×3 sheet of crystal shards — pick a
        // random cell each spawn so the rain isn't visibly repeating.
        const cx = Math.floor(Math.random() * 3) * 50;
        const cy = Math.floor(Math.random() * 3) * 50;
        const baseCss =
            `width:${size}px;height:${size}px;` +
            `background-image:url('assets/sprites/ice-chunks.png');` +
            `background-size:300% 300%;` +
            `background-position:${cx}% ${cy}%;` +
            `background-repeat:no-repeat;` +
            `filter:drop-shadow(0 0 ${(size*0.4).toFixed(1)}px rgba(165,243,252,0.75));`;
        const frac = (size - SNOW_FALL.MIN_PX) / (SNOW_FALL.MAX_PX - SNOW_FALL.MIN_PX);
        const dur = SNOW_FALL.FALL_MAX_S
                  - frac * (SNOW_FALL.FALL_MAX_S - SNOW_FALL.FALL_MIN_S);
        s.style.cssText = baseCss +
            `left:${(Math.random() * 100).toFixed(2)}vw;` +
            `--amp:${(10 + Math.random() * 16).toFixed(1)}px;` +
            `animation-duration:${dur.toFixed(2)}s;`;
        s.addEventListener('animationend', () => s.remove());
        snowFallLayer.appendChild(s);
        while (snowFallLayer.childElementCount > SNOW_FALL.MAX_CONCURRENT) {
            snowFallLayer.removeChild(snowFallLayer.firstChild);
        }
    }
    function snowFallTick(ts) {
        if (!snowFallActive || !snowFallLayer) { snowFallRAF = null; return; }
        if (ts >= snowFallNextAt) {
            spawnFallingSnowflake();
            snowFallNextAt = ts + SNOW_FALL.SPAWN_MIN_MS +
                Math.random() * (SNOW_FALL.SPAWN_MAX_MS - SNOW_FALL.SPAWN_MIN_MS);
        }
        snowFallRAF = requestAnimationFrame(snowFallTick);
    }
    function startSnowFall() {
        if (snowFallActive) return;
        snowFallActive = true;
        snowFallLayer = document.createElement('div');
        snowFallLayer.className = 'snow-fall';
        snowFallLayer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(snowFallLayer);
        snowFallNextAt = 0;
        snowFallRAF = requestAnimationFrame(snowFallTick);
    }
    function stopSnowFall() {
        if (!snowFallActive) return;
        snowFallActive = false;
        if (snowFallRAF) { cancelAnimationFrame(snowFallRAF); snowFallRAF = null; }
        const dying = snowFallLayer;
        snowFallLayer = null;
        if (dying) {
            dying.classList.add('fading');
            setTimeout(() => dying.remove(), SNOW_FALL.STOP_FADE_MS);
        }
    }
    function syncSnowFall() {
        if (snowFallRampTimer) { clearTimeout(snowFallRampTimer); snowFallRampTimer = null; }
        if (snowFallShouldRun()) {
            startSnowFall();
        } else {
            stopSnowFall();
            if (isIceOnStage()
                && document.body.classList.contains('react-mode-active')
                && horrorOnSince) {
                const remain = SNOW_FALL.RAMP_MS - (performance.now() - horrorOnSince);
                if (remain > 0) snowFallRampTimer = setTimeout(syncSnowFall, remain + 50);
            }
        }
    }

    // Ice "frozen / underwater" master lowpass muffle. Modulates the
    // existing masterLP frequency by the dread stage when Ice is on
    // stage: calm = bypass (14 kHz), unease = 7 kHz (a touch dampened),
    // dread = 2.5 kHz (clearly muffled), terror = 700 Hz (nearly
    // underwater). exponentialRampToValueAtTime because frequency is
    // logarithmic; edge-detected via iceMuffleLevel so it only re-ramps
    // when the (stage, ice-on-stage) state actually changes.
    function setIceMuffle(stage) {
        // Refactored 2026-07-31 for Tier-2 FILTER pill: ice horror now
        // composes with the player's chosen master filter by multiplying
        // filterBaseHz (BRIGHT/WARM/DARK) with a per-stage mult inside
        // applyMasterFilter. The stage argument is intentionally
        // unused here — applyMasterFilter reads dreadStageNow directly
        // to stay in one source of truth.
        applyMasterFilter();
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
    //                      (also gates whether Moon appears in the bank at all)
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
            // Legacy field `seventhWheel` (obj.seventhWheel) was the swap
            // selector before Ice + Moon became coexisting tray citizens
            // (2026-07-30). Ignored on load; unknown-to-us field on save.
            // Music-expansion params (Tier 1, 2026-07-31). All optional
            // — missing fields fall through to defaults.
            if (TEMPO_PRESETS.includes(obj.tempo | 0)) setTempo(obj.tempo | 0);
            if (KEY_PRESETS.some(k => k.shift === (obj.keyShift | 0))) {
                keyShiftSemitones = obj.keyShift | 0;
            }
            if (typeof obj.songVariation === 'number'
                && obj.songVariation >= 0 && obj.songVariation < SONG_VARIATIONS.length) {
                songVariationIndex = obj.songVariation;
            }
            if (typeof obj.swingOn === 'boolean') isSwingOn = obj.swingOn;
            if (typeof obj.spaceIndex === 'number'
                && obj.spaceIndex >= 0 && obj.spaceIndex < SPACE_PRESETS.length) {
                spaceIndex = obj.spaceIndex;
            }
            if (typeof obj.filterIndex === 'number'
                && obj.filterIndex >= 0 && obj.filterIndex < FILTER_PRESETS.length) {
                filterIndex = obj.filterIndex;
                filterBaseHz = FILTER_PRESETS[filterIndex].hz;
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
                activeBankIndex,
                unlockedBanks: BANKS.map(b => b.unlocked),
                // Music-expansion params (Tier 1 + 2)
                tempo: TEMPO,
                keyShift: keyShiftSemitones,
                songVariation: songVariationIndex,
                swingOn: isSwingOn,
                spaceIndex,
                filterIndex
            }));
        } catch (e) { /* ignore */ }
    }

    // Ice + Moon coexist in the bank as of 2026-07-30 (retired the old
    // seventhWheel swap altar / tap-to-swap badge design). Ice is always
    // present; Moon appears once moonUnlocked flips via the achievement
    // path. Idempotent; call after moon unlock, on init, after
    // loadProgress. Keeps the old function name for stability across
    // any lingering internal callers.
    function syncBankWithSeventhWheel() {
        const bank = BANKS[0].munkis;
        const cleaned = bank.filter(id => id !== 'ice' && id !== 'moon');
        cleaned.push('ice');
        if (moonUnlocked) cleaned.push('moon');
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
        // Mutually exclusive with Round Robin — kill it before switching
        // to the Madballz roster.
        if (isRoundRobinMode) setRoundRobinMode(false);
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
        checkNamedCombo();
    }

    function exitMadballzMode() {
        isMadballzMode = false;
        document.body.classList.remove('madballz-mode');
        const meet = document.getElementById('madballzBtn');
        const back = document.getElementById('backBtn');
        if (meet) meet.hidden = !MADBALLZ_ENABLED;   // v1.1: always visible when enabled (unlock gate removed)
        if (back) back.hidden = true;
        for (let i = 0; i < NUM_SLOTS; i++) slots[i] = null;
        renderAllSlots();
        updateIceFreeze();
        renderTray();
        attachTrayHandlers();
        updateTrayHint();
        checkNamedCombo();
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
        // "Coexist" design (2026-07-30): syncBankWithSeventhWheel now
        // appends BOTH Ice + Moon post-unlock. Re-sync the bank + re-
        // render the tray so Moon's chip appears immediately alongside
        // Ice. The old altar/swap machinery is retired — renderMunkiAltar
        // is a no-op now (see its body), left in place so any stale
        // caller stays safe.
        syncBankWithSeventhWheel();
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
                // CLEAR bypasses setSlot (writes slots[i] direct), so the
                // named-combo detector needs an explicit poke or the
                // subtitle keeps showing the last matched combo forever.
                checkNamedCombo();
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

        // BASS — swappable booming sawtooth bass overlay for the Madballz
        // Theme. Off by default (user pulled the booming bass out of the
        // song; this button adds it back when wanted). No audible effect
        // in standard mode since BASE_SONG already carries its own bass.
        const bassBtn = document.getElementById('bassBtn');
        if (bassBtn) {
            bassBtn.addEventListener('click', () => {
                ensureAudio();
                isBassOn = !isBassOn;
                bassBtn.classList.toggle('off', !isBassOn);
                bassBtn.setAttribute('aria-pressed', String(isBassOn));
            });
        }

        // ---- Music expansion pills (Tier 1): MOOD / TEMPO / KEY / SWING ----
        // Cycle-on-click, no dropdowns. Each pill's label reflects its
        // current value; update*Btn() functions push state → label after
        // every change (also called once from init() to seed labels from
        // the loaded save).
        const moodBtn = document.getElementById('moodBtn');
        if (moodBtn) moodBtn.addEventListener('click', () => { ensureAudio(); cycleSongVariation(); });
        const tempoBtn = document.getElementById('tempoBtn');
        if (tempoBtn) tempoBtn.addEventListener('click', () => { ensureAudio(); cycleTempo(); });
        const keyBtn = document.getElementById('keyBtn');
        if (keyBtn) keyBtn.addEventListener('click', () => { ensureAudio(); cycleKey(); });
        const swingBtn = document.getElementById('swingBtn');
        if (swingBtn) swingBtn.addEventListener('click', () => { ensureAudio(); setSwing(!isSwingOn); });
        const spaceBtn = document.getElementById('spaceBtn');
        if (spaceBtn) spaceBtn.addEventListener('click', () => { ensureAudio(); cycleSpace(); });
        const filterBtn = document.getElementById('filterBtn');
        if (filterBtn) filterBtn.addEventListener('click', () => { ensureAudio(); cycleFilter(); });

        // ---- Dual Band Mode (v1.1, chunk A: mode + footswitch UI) ----
        const dualBandBtn = document.getElementById('dualBandBtn');
        if (dualBandBtn && !DUAL_BAND_ENABLED) {
            // v1.1 ship gate: hide the button entirely; never wire up the
            // click handler so setDualBandMode can't be invoked and the
            // bandFootswitches stay hidden (per their HTML `hidden` attr).
            dualBandBtn.hidden = true;
        } else if (dualBandBtn) {
            dualBandBtn.addEventListener('click', () => {
                ensureAudio();
                setDualBandMode(!isDualBandMode);
            });
        }
        const footA = document.getElementById('bandFootA');
        const footB = document.getElementById('bandFootB');
        if (footA) footA.addEventListener('click', () => { ensureAudio(); setBandOn(0, !bandOn[0]); });
        if (footB) footB.addEventListener('click', () => { ensureAudio(); setBandOn(1, !bandOn[1]); });

        const roundRobinBtn = document.getElementById('roundRobinBtn');
        if (roundRobinBtn) {
            roundRobinBtn.addEventListener('click', () => {
                ensureAudio();
                setRoundRobinMode(!isRoundRobinMode);
            });
        }

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
        // Mobile audio hygiene Fix 4 — release the AudioContext on
        // navigation so the OS audio path is torn down cleanly instead
        // of leaving the mobile DSP half-open across a session +
        // navigation (a known Android "static residue" cause).
        // suspend/resume on background is already handled by the
        // visibilitychange listener above (kept — it also pauses the
        // scheduler, which the naive spec snippet does not). Guarded so
        // it never close()s a missing or already-closed context.
        window.addEventListener('beforeunload', () => {
            if (audioCtx && audioCtx.state !== 'closed') {
                audioCtx.close().catch(() => {});
            }
        });
    }

    // ---------- FLYING CREEPS ----------
    // An animated creature. ONE at a time. Each appearance picks a random
    // creep (one per colour). Lifecycle is Float -> one swoop-attack ->
    // die:
    //   FLOAT  drifts across on its sine path, wings flapping frames
    //          1<->2 IN TIME TO THE BEAT (the menace); nearby Munkis
    //          flinch (.creep-scared) + accumulate `fear`.
    //   SWOOP  gated on menace — only once it has menaced (come CLOSE
    //          to) >= SWOOP_MIN_MENACED (2) distinct Munkis and loomed
    //          long enough does it smoothly dive its "third" (the
    //          nearest one) playing frames 3->4->5.
    //          At STRIKE_AT it lands a hit: a fear burst + a brief knock
    //          on that Munki (uniform — no per-Munki art, per the locked
    //          "per-trigger atmosphere only" design). The kid can dodge by
    //          sliding the targeted Munki away before the hit.
    //   DIE    the swoop is terminal: frame 5 is held while CSS dissipates
    //          it (fade+scale+spin), then it despawns. If NO Munki is on
    //          stage it never swoops — it just floats across and exits.
    // When total fear crosses CREEP.HORROR_TRIGGER_SUM, horror trips via
    // the shared syncHorrorMode() path (same 12s creep-in as an Ice/Moon
    // drop) and the hidden "Creep Whisperer" achievement unlocks; the
    // creep dying releases its fear so creep-horror lifts with the threat.
    // Seeing every creep at least once (across sessions) unlocks "All
    // Creeps Encountered".
    //
    // Sprite: assets/sprites/flying-creeps.png + flying-creeps.json —
    // STANDARD sheet is a uniform 6x5 grid: 6 creeps (colour columns) x
    // 5 frames, frames named creep-<colour>-<n>; loadCreepSheet() groups
    // them. The loader SCHEMA-DETECTS: an ungrouped/single-frame sheet
    // (the itch-creeps.* meta swap, an old array sheet, anything else)
    // degrades to one 1-frame creep each, so it still runs. With no sheet
    // at all it renders a clearly-marked PLACEHOLDER ghost (tracking inert).
    // See assets/sprites/FLYING_CREEPS_README.md for the full sheet spec.
    const CREEPS_SEEN_KEY = 'all-munkis-creeps-seen-v1';
    // (Unified per-Munki fear lives in `munkiFear` near the Dread
    // config — creep proximity feeds it, the beat tick + ladder read
    // it. No creep-private fear/scared maps any more.)
    let creepEl = null;            // the floating DOM element
    let creepActive = false;       // currently drifting across?
    let creepSheet = null;         // {src, sheetW, sheetH, frames:[...]} or null
    // Sky art cropped from sky-items.png: `moons` (8, the gentle
    // Moon-horror precipitation + the Moon-chaos splash) and `comets`
    // (4, the rarer big fast diagonal streaks woven into Moon-horror).
    // null until loaded — callers fall back to drawn shapes, never emoji.
    let skyItemsSheet = null;      // {src, sheetW, sheetH, moons:[…], comets:[…]}
    let creepSpawnTimer = null;
    let creepRAF = null;
    let creepState = null;         // see spawnCreep for the full shape (phase machine)
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
    // Record a freshly-spawned creep; grant "All Creeps Encountered" once
    // every creep in the loaded sheet has been seen at least once. Counts
    // CREEPS (one per colour), not individual animation frames. Only
    // meaningful with a real sheet (the placeholder has no creeps).
    function markCreepSeen(creepIdx) {
        if (creepIdx < 0) return;
        if (creepsSeen.has(creepIdx)) return;
        creepsSeen.add(creepIdx);
        saveCreepsSeen();
        const total = creepSheet ? creepSheet.creeps.length : 0;
        if (total > 0 && creepsSeen.size >= total) {
            grantAchievement('allCreeps');
        }
    }

    // Try to load the real sprite sheet. Resolves to a sheet descriptor
    // ({src, sheetW, sheetH, creeps:[{color, frames:[rect,...]}]}) or null
    // (→ placeholder). Never rejects — a missing sheet is expected until
    // the art is dropped in.
    //
    // PRIMARY: per-creep sheets — assets/sprites/creep-<colour>.{png,json}.
    // Each is its own exporter sheet (Sprite Sheet Maker / TexturePacker
    // hash) of 5 UNIFORM frames on ONE canvas size; the artist centres
    // each pose inside that fixed canvas, so we use the exporter `frame`
    // rects VERBATIM — no alpha-detection, no re-centering (that fought
    // the artist's framing and was why sprites drifted). Frame order is
    // the leading integer in each key (`1G-flight`..`5G-swoop`).
    // FALLBACK: a single legacy assets/sprites/flying-creeps.{png,json}
    // (the itch-creeps.* meta swap / old sheet) — schema-detected and
    // degraded to per-creep groups or 1-frame static drifters so the
    // itch build + no-art placeholder still work.
    const CREEP_COLORS = ['blue','green','orange','purple','red','yellow'];
    function loadOneCreepSheet(color) {
        return fetch(`assets/sprites/creep-${color}.json`)
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (!json || !json.frames || Array.isArray(json.frames)) return null;
                const rectOf = e => (e && e.frame) ? e.frame : e;
                const frames = Object.keys(json.frames)
                    .map(name => {
                        const m = /^\s*(\d+)/.exec(name);
                        return { n: m ? parseInt(m[1], 10) : 999,
                                 f: rectOf(json.frames[name]) };
                    })
                    .sort((a, b) => a.n - b.n)
                    .map(o => o.f)
                    .filter(f => f && f.w && f.h);
                if (!frames.length) return null;
                const meta = json.meta || {}, size = meta.size || {};
                return {
                    color,
                    src: `assets/sprites/creep-${color}.png`,
                    sheetW: size.w || Math.max(...frames.map(f => f.x + f.w)),
                    sheetH: size.h || Math.max(...frames.map(f => f.y + f.h)),
                    frames
                };
            })
            .catch(() => null);
    }
    function loadLegacyCreepSheet() {
        return fetch('assets/sprites/flying-creeps.json')
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (!json || !json.frames) return null;
                const rectOf = e => (e && e.frame) ? e.frame : e;
                const src = 'assets/sprites/flying-creeps.png';
                const meta = json.meta || {}, size = meta.size || {};
                let groups = null;
                if (!Array.isArray(json.frames)) {
                    const g = new Map();
                    Object.keys(json.frames).forEach(name => {
                        const m = /^creep-([a-z]+)-(\d+)$/i.exec(name);
                        if (!m) return;
                        const k = m[1].toLowerCase();
                        if (!g.has(k)) g.set(k, []);
                        g.get(k).push({ n: parseInt(m[2], 10),
                                        f: rectOf(json.frames[name]) });
                    });
                    if (g.size) groups = [...g.entries()].map(([color, a]) => ({
                        color,
                        frames: a.sort((x, y) => x.n - y.n).map(o => o.f)
                                 .filter(f => f && f.w && f.h)
                    })).filter(c => c.frames.length);
                }
                if (!groups || !groups.length) {
                    const flat = (Array.isArray(json.frames)
                        ? json.frames.map(rectOf)
                        : Object.values(json.frames).map(rectOf)
                    ).filter(f => f && f.w && f.h);
                    if (!flat.length) return null;
                    groups = flat.map(f => ({ color: null, frames: [f] }));
                }
                const sW = size.w || Math.max(...groups.flatMap(c =>
                    c.frames.map(f => f.x + f.w)));
                const sH = size.h || Math.max(...groups.flatMap(c =>
                    c.frames.map(f => f.y + f.h)));
                return { creeps: groups.map(c => ({
                    color: c.color, src, sheetW: sW, sheetH: sH,
                    frames: c.frames
                })) };
            })
            .catch(() => null);
    }
    function loadCreepSheet() {
        return Promise.all(CREEP_COLORS.map(loadOneCreepSheet))
            .then(list => {
                const creeps = list.filter(Boolean);
                if (creeps.length) return { creeps };
                return loadLegacyCreepSheet();
            })
            .catch(() => null);
    }

    // Loads sky-items.{png,json} (TexturePacker-hash). Splits frames
    // into `moons` (gentle background precipitation) and `comets` (the
    // rarer, bigger, fast diagonal streaks) by name. Either list may be
    // empty; null only if the sheet has neither.
    function loadSkyItemsSheet() {
        return fetch('assets/sprites/sky-items.json')
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (!json || !json.frames) return null;
                const rect = name => {
                    const e = json.frames[name];
                    return (e && e.frame) ? e.frame : e;
                };
                const names = Object.keys(json.frames);
                const moons = names.filter(n => !/comet/i.test(n))
                    .map(rect).filter(f => f && f.w && f.h);
                const comets = names.filter(n => /comet/i.test(n))
                    .map(rect).filter(f => f && f.w && f.h);
                if (!moons.length && !comets.length) return null;
                const all = moons.concat(comets);
                const meta = json.meta || {};
                const size = meta.size || {};
                return {
                    src: 'assets/sprites/sky-items.png',
                    sheetW: size.w || Math.max(...all.map(f => f.x + f.w)),
                    sheetH: size.h || Math.max(...all.map(f => f.y + f.h)),
                    moons,
                    comets
                };
            })
            .catch(() => null);
    }

    // Measure each frame's REAL painted content (alpha bounding box) in
    // a canvas, once per creep at load. The exporter packs uniform frame
    // canvases but the creep drawn inside each varies in size — these
    // measured boxes (fr.cx/cy/cw/ch, sheet coords) let paintCreepFrame
    // normalise every pose to the same on-screen size. Same-origin over
    // http (dev server / madderverse.org / Capacitor) so getImageData is
    // fine; if it ever taints (file://) we just skip → full-frame paint.
    function measureCreepContent(creep) {
        if (!creep || !creep.src || !creep.frames) return;
        const img = new Image();
        img.onload = () => {
            try {
                const cv = document.createElement('canvas');
                const cx = cv.getContext('2d', { willReadFrequently: true });
                creep.frames.forEach(fr => {
                    cv.width = fr.w; cv.height = fr.h;
                    cx.clearRect(0, 0, fr.w, fr.h);
                    cx.drawImage(img, fr.x, fr.y, fr.w, fr.h,
                                 0, 0, fr.w, fr.h);
                    const d = cx.getImageData(0, 0, fr.w, fr.h).data;
                    let mnx = fr.w, mny = fr.h, mxx = -1, mxy = -1;
                    for (let y = 0; y < fr.h; y++) {
                        const row = y * fr.w;
                        for (let x = 0; x < fr.w; x++) {
                            if (d[(row + x) * 4 + 3] > 16) {
                                if (x < mnx) mnx = x;
                                if (x > mxx) mxx = x;
                                if (y < mny) mny = y;
                                if (y > mxy) mxy = y;
                            }
                        }
                    }
                    if (mxx >= mnx && mxy >= mny) {
                        fr.cx = fr.x + mnx; fr.cy = fr.y + mny;
                        fr.cw = mxx - mnx + 1; fr.ch = mxy - mny + 1;
                    }
                });
            } catch (_) { /* tainted/unavailable → full-frame fallback */ }
        };
        img.onerror = () => {};
        img.src = creep.src;
    }

    // Paint the .flying-creep-frame child to show frame `f`. If the
    // frame's measured content box (cx/cy/cw/ch) is available, scale so
    // its CREEP.NORM_DIM renders to NORM_FILL × the box and centre that
    // content box — so every pose is the SAME on-screen size and the
    // wing-flap reads as motion, not a size jump. Until measured (or if
    // measuring was blocked) it falls back to the verbatim exporter
    // frame rect, scaled longest-side to the box and centred.
    function paintCreepFrame(child, f, box, src, sheetW, sheetH) {
        if (!child || !f) return;
        let scale, sx, sy, sw, sh;
        if (f.cw && f.ch) {
            const cur = CREEP.NORM_DIM === 'height' ? f.ch
                      : CREEP.NORM_DIM === 'width'  ? f.cw
                      : CREEP.NORM_DIM === 'max'    ? Math.max(f.cw, f.ch)
                      :                  Math.sqrt(f.cw * f.ch); // 'area'
            scale = (box * CREEP.NORM_FILL) / cur;
            sx = f.cx; sy = f.cy; sw = f.cw; sh = f.ch;
        } else {
            scale = box / Math.max(f.w, f.h);
            sx = f.x; sy = f.y; sw = f.w; sh = f.h;
        }
        const dw = sw * scale, dh = sh * scale;
        // The element is sized to EXACTLY the rendered sprite and centred
        // in the outer creep box (position:absolute; inset:0;
        // margin:auto in CSS). Because it's the sprite's own size with
        // overflow:hidden, the background can only ever show THIS frame's
        // pixels — no adjacent strip frame can bleed into a margin (the
        // ghost double-creep). background-position puts the source rect
        // at the element's origin.
        child.style.width  = `${dw.toFixed(2)}px`;
        child.style.height = `${dh.toFixed(2)}px`;
        child.style.backgroundImage = `url('${src}')`;
        child.style.backgroundSize =
            `${sheetW * scale}px ${sheetH * scale}px`;
        child.style.backgroundPosition =
            `${(-sx * scale).toFixed(2)}px ${(-sy * scale).toFixed(2)}px`;
    }

    // Set the active creep's current animation frame (index into its
    // frames[]). Clamps, and only repaints when the index actually
    // changes — safe to call every rAF tick.
    function setCreepFrame(n) {
        const st = creepState;
        if (!st || !st.frames || !st.frames.length || !creepEl) return;
        n = Math.max(0, Math.min(st.frames.length - 1, n | 0));
        if (st.curFrame === n) return;
        st.curFrame = n;
        const child = creepEl.querySelector('.flying-creep-frame');
        if (!child) return;
        paintCreepFrame(child, st.frames[n], creepSizePx(),
                        st.src, st.sheetW, st.sheetH);
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

    // Responsive creep size. Fixed px (CREEP.SIZE_PX 128) read as a tiny
    // gnat on a big desktop viewport but BIGGER THAN A MUNKI on a phone.
    // Scale to the viewport's short side (~14 vmin), clamped
    // [58, CREEP.SIZE_PX]: desktop caps at 128 (the "perfect gnat"),
    // phones land ~55-62 px (smaller than a Munki), tablets ~100.
    // Recomputed per use so it also tracks orientation changes.
    // (Future madderverse/lib/audio sibling lib: creature/sprite sizes
    // should be vmin-based, never raw px — this is the lesson.)
    function creepSizePx() {
        const vmin = Math.min(window.innerWidth, window.innerHeight);
        return Math.round(Math.max(58, Math.min(CREEP.SIZE_PX, vmin * 0.14)));
    }

    function buildCreepEl() {
        if (creepEl) return creepEl;
        creepEl = document.createElement('div');
        creepEl.className = 'flying-creep';
        creepEl.setAttribute('aria-hidden', 'true');
        const csz = creepSizePx();
        creepEl.style.width = csz + 'px';
        creepEl.style.height = csz + 'px';
        creepEl.style.zIndex = String(CREEP.Z_INDEX);
        if (creepSheet && creepSheet.creeps && creepSheet.creeps.length) {
            // Real sheet(s): a child whose background paintCreepFrame
            // locks to the chosen creep's frame (per-creep src/size).
            const f = document.createElement('div');
            f.className = 'flying-creep-frame';
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
        // Pick a creep uniformly from the loaded sheet (−1 = placeholder,
        // which has no creeps and never counts toward "All Creeps").
        const hasCreeps = !!(creepSheet && creepSheet.creeps
                              && creepSheet.creeps.length);
        const creepIdx = hasCreeps
            ? Math.floor(Math.random() * creepSheet.creeps.length)
            : -1;
        const creepDef = hasCreeps ? creepSheet.creeps[creepIdx] : null;
        const frames = creepDef ? creepDef.frames : null;
        if (hasCreeps) markCreepSeen(creepIdx);
        const vw = window.innerWidth, vh = window.innerHeight;
        // Always enter from a side edge — top-edge entries used to drop
        // straight down on EXIT (so some creeps appeared to dive off
        // while others flew sideways). Side-only entries guarantee a
        // consistent horizontal sweep + horizontal exit for every creep.
        const edge = (Math.random() < 0.5) ? 'left' : 'right';
        const speed = rand(CREEP.SPEED_MIN_PXPS, CREEP.SPEED_MAX_PXPS);
        const size = creepSizePx();
        // Flight height: a band ABOVE where the Munkis stand, used when
        // the creep has no specific Munki to steer toward.
        const sc0 = slotCenters();
        let flyHomeY;
        if (sc0.length) {
            const avg = sc0.reduce((a, s) => a + s.cy, 0) / sc0.length;
            flyHomeY = Math.max(size * 0.5, avg - CREEP.FLY_HOME_OFFSET_PX);
        } else {
            flyHomeY = vh * 0.3;
        }
        let x, y, dir;
        if (edge === 'left') { x = -size; y = flyHomeY; dir =  1; }
        else                 { x = vw;    y = flyHomeY; dir = -1; }
        creepState = {
            x, y, drawY: y, entryEdge: edge, dir, speed, flyHomeY,
            creepIdx, frames, curFrame: -1,
            src:    creepDef ? creepDef.src    : null,
            sheetW: creepDef ? creepDef.sheetW : 0,
            sheetH: creepDef ? creepDef.sheetH : 0,
            tStart: performance.now(),
            // Hunting cycle: HUNT (steer toward un-scared Munkis; passive
            // proximity scares + accrues fear) → EXIT (fast dive off the
            // opposite edge) once `scared` reaches SCARE_COUNT or the
            // hunt times out. exitStart stamps the EXIT dive.
            phase: 'HUNT', scared: new Set(), exitStart: 0,
            steerTarget: null, lingerStart: 0,
            lastBeat: -1, lastBeatTs: 0, flapAt: 0,
            faceLeft: dir < 0
        };
        creepActive = true;
        creepEl.hidden = false;
        creepEl.classList.remove('flying-creep-dying');
        creepEl.classList.add('flying-creep-in');
        if (frames) setCreepFrame(0);   // wings-up to start
        creepLastTs = performance.now();
        if (!creepRAF) creepRAF = requestAnimationFrame(creepTick);
    }

    function endCreep() {
        creepActive = false;
        creepState = null;
        if (creepEl) {
            creepEl.hidden = true;
            creepEl.classList.remove('flying-creep-in', 'flying-creep-dying');
        }
        // Don't wipe fear — unified munkiFear may also hold Ice/Moon
        // adjacency dread, and creep-induced fear should DECAY (the
        // Munkis calm over a few seconds, a nicer "phew" than a snap).
        // The creep-sum horror source is gone though, so release it;
        // syncHorrorMode keeps horror on if any Munki is still in PANIC.
        if (fearHorrorActive) { fearHorrorActive = false; syncHorrorMode(); }
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

    // ---- predatory-cycle helpers ----
    function creepCenterXY() {
        const r = creepEl.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    // Wing-flap, frames 0<->1. Beat-locked to Bala's loop; timed
    // fallback when no beat advances. `fast` = the tense SPOT pulse.
    function creepFlap(st, ts, fast) {
        if (!st.frames || st.frames.length < 2) return;
        if (fast) {
            if (ts >= st.pulseAt) {
                setCreepFrame(st.curFrame === 0 ? 1 : 0);
                st.pulseAt = ts + 110;
            }
            return;
        }
        if (beatCounter !== st.lastBeat) {
            st.lastBeat = beatCounter; st.lastBeatTs = ts;
            setCreepFrame(beatCounter & 1);
        } else if (ts - (st.lastBeatTs || st.tStart) > 1200
                   && ts >= st.flapAt) {
            setCreepFrame(st.curFrame === 0 ? 1 : 0);
            st.flapAt = ts + CREEP.FLAP_MS;
        }
    }
    // Outer transform: position (+ optional dive tilt) (+ mirror when
    // travelling left — the art is drawn flying left→right).
    function creepTransform(st, tiltDeg) {
        return `translate(${st.x.toFixed(1)}px, ${st.drawY.toFixed(1)}px)` +
               (tiltDeg ? ` rotate(${tiltDeg.toFixed(1)}deg)` : '') +
               (st.faceLeft ? ' scaleX(-1)' : '');
    }

    function creepTick(ts) {
        if (!creepActive || !creepState) { creepRAF = null; return; }
        if (creepPaused) { creepRAF = requestAnimationFrame(creepTick); creepLastTs = ts; return; }
        const dt = Math.min(0.05, (ts - creepLastTs) / 1000) || 0;
        creepLastTs = ts;
        const st = creepState;
        const elapsed = ts - st.tStart;
        const csz = creepSizePx();

        if (st.phase === 'HUNT') {
            // One creep-centre read per tick (1-frame lag is fine and
            // matches the original proven proximity behaviour).
            const c = creepCenterXY();
            const sc = slotCenters();

            // Pick / refresh the current quarry: nearest active Munki
            // not already scared. Keep it until it's been menaced long
            // enough (or it leaves the stage).
            if (st.steerTarget == null
                || !slots[st.steerTarget]
                || st.scared.has(st.steerTarget)
                || !sc.some(s => s.i === st.steerTarget)) {
                let pick = null, bd = Infinity;
                sc.forEach(s => {
                    if (st.scared.has(s.i)) return;
                    const d = Math.hypot(s.cx - c.cx, s.cy - c.cy);
                    if (d < bd) { bd = d; pick = s; }
                });
                st.steerTarget = pick ? pick.i : null;
                st.lingerStart = 0;
            }
            const tgt = st.steerTarget != null
                ? sc.find(s => s.i === st.steerTarget) : null;

            if (tgt) {
                const tdist = Math.hypot(tgt.cx - c.cx, tgt.cy - c.cy);
                if (tdist > CREEP.CLOSE_PX) {
                    // Approach: fly straight at it (the hunt).
                    const tX = tgt.cx - csz / 2, tY = tgt.cy - csz / 2;
                    const dx = tX - st.x, dy = tY - st.y;
                    const dd = Math.hypot(dx, dy) || 1;
                    const step = st.speed * dt;
                    if (dd <= step) { st.x = tX; st.y = tY; }
                    else { st.x += (dx / dd) * step; st.y += (dy / dd) * step; }
                    st.faceLeft = dx < 0;
                    st.lingerStart = 0;          // not menacing yet
                } else {
                    // In range → HOVER and MENACE it: hold position
                    // (just bob) while the proximity loop below scares
                    // it + banks fear. Counts as scared only after a
                    // full SCARE_DWELL_MS in range; leaving range (kid
                    // pulls it away) resets the timer — a rescue.
                    if (!st.lingerStart) st.lingerStart = ts;
                    st.faceLeft = (tgt.cx < c.cx);
                    if (ts - st.lingerStart >= CREEP.SCARE_DWELL_MS) {
                        st.scared.add(st.steerTarget);
                        st.steerTarget = null;
                        st.lingerStart = 0;
                    }
                }
            } else {
                // Nothing left to scare → head on out (toward exit).
                st.x += st.dir * st.speed * dt;
                const dyf = st.flyHomeY - st.y, sf = st.speed * dt;
                st.y += Math.abs(dyf) <= sf ? dyf : Math.sign(dyf) * sf;
                st.faceLeft = st.dir < 0;
            }
            const bob = Math.sin((elapsed / CREEP.WAVE_PERIOD_MS) * Math.PI * 2)
                      * (CREEP.WAVE_AMP_PX * 0.5);
            st.drawY = st.y + bob;
            creepEl.style.transform = creepTransform(st, 0);
            creepFlap(st, ts, false);

            // Passive proximity feeds the UNIFIED per-Munki fear: any
            // Munki within CLOSE_PX banks fear (and stamps fearFedAt so
            // the beat decay won't fight it). No decay / no class here —
            // the central beat tick decays, refreshFearVisuals() drives
            // the shake, the ladder in expressionForSlot drives the
            // face. The dwell logic above (SCARE_DWELL_MS) still gates
            // when a Munki counts toward the scare quota.
            const nowMs = performance.now();
            sc.forEach(({ i, cx, cy }) => {
                if (Math.hypot(c.cx - cx, c.cy - cy) <= CREEP.CLOSE_PX) {
                    const cur = munkiFear.get(i) || 0;
                    munkiFear.set(i, Math.min(FEAR.MAX,
                        cur + CREEP.FEAR_GAIN_PER_S * dt));
                    fearFedAt.set(i, nowMs);
                }
            });
            refreshFearVisuals();   // shake appears the instant it's close

            // Scared SCARE_COUNT distinct Munkis (or the hunt timed
            // out) → dramatic fast dive off the opposite edge.
            if (st.scared.size >= CREEP.SCARE_COUNT
                || elapsed > CREEP.MAX_HUNT_MS) {
                st.phase = 'EXIT'; st.exitStart = ts;
                // Always horizontal — exit the OPPOSITE side edge.
                st.dir = (st.entryEdge === 'right') ? 1 : -1;
                st.faceLeft = (st.dir < 0);
            }
            // Wandered fully off (no targets / pushed off) → just gone.
            const off = st.x < -csz * 1.8
                     || st.x > window.innerWidth + csz * 1.8;
            if (off || elapsed > 90000) { endCreep(); return; }

        } else { // EXIT — fast horizontal dive off the opposite side.
            const ex = st.speed * CREEP.EXIT_SPEED_MULT;
            st.x += st.dir * ex * dt;
            const td = ts - st.exitStart;
            setCreepFrame(td < 180 ? 2 : (td < 360 ? 3 : 4));
            const tilt = st.faceLeft ? -22 : 22;
            creepEl.style.transform = creepTransform(st, tilt);
            const gone = st.x < -csz * 1.8
                      || st.x > window.innerWidth + csz * 1.8;
            if (gone || td > 6000) { endCreep(); return; }
        }

        // Fear → horror, with its own trigger/release hysteresis. Fear
        // accrues from passive proximity (HUNT block); a creep that
        // lingers scaring its 3 Munkis reliably crosses the threshold.
        let sum = 0;
        munkiFear.forEach(v => { sum += v; });
        if (!fearHorrorActive && sum >= CREEP.HORROR_TRIGGER_SUM) {
            fearHorrorActive = true;
            syncHorrorMode();
            grantAchievement('creepWhisperer');
        } else if (fearHorrorActive && sum <= CREEP.HORROR_RELEASE_SUM) {
            fearHorrorActive = false;
            syncHorrorMode();
        }
        kickDread();          // creep proximity feeds the meter (Chunk 1)

        creepRAF = requestAnimationFrame(creepTick);
    }

    function startCreepSystem() {
        if (!CREEP.ENABLED) return;
        loadCreepsSeen();
        loadCreepSheet().then(sheet => {
            creepSheet = sheet;
            // Measure each creep's real content boxes for size
            // normalisation (mutates frame objs in place; paint uses
            // them once ready, full-frame fallback until then).
            if (sheet && sheet.creeps) sheet.creeps.forEach(measureCreepContent);
        });
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

    // ---------- INIT ----------
    // ---------- HORROR-MODE OVERLAY (v1.1 visual) ----------
    // Three layered atmosphere effects, ALL pure-CSS keyed off the
    // existing `body.react-mode-active` (no redundant second class — that
    // class is already toggled exactly on horror enter/exit and drives
    // the 12 s corner-Munki creep, so these ramp in lockstep with it):
    //   .bg-dim        — darkens the scene (z 0, below Munkis/tray)
    //   .eyes-container — watcher eye-pairs (z 0, below Munkis)
    //   .red-vignette  — red edge tint + slow pulse (z 8, above Munkis,
    //                    below tray/moon-fall/UI)
    // JS only builds the DOM once + seeds eye positions; CSS does all
    // transitions/animations. Eye pair positions are % of the viewport
    // (responsive) — tweak freely; mapped to the haunted-theatre plate's
    // doorway / balcony boxes / side boxes / seat-shadow depths.
    const EYE_PAIRS = [
        { x: 50, y: 40 }, // back-centre doorway
        { x: 16, y: 21 }, // upper-left balcony box
        { x: 84, y: 21 }, // upper-right balcony box
        { x: 7,  y: 39 }, // left side box
        { x: 93, y: 39 }, // right side box
        { x: 31, y: 57 }, // seat shadows, left
        { x: 69, y: 58 }, // seat shadows, right
        { x: 50, y: 66 }  // deep centre seats
    ];
    // Phone-portrait re-frames the theatre TALLER + NARROWER (the 9:16
    // assets/bg-img/stage-portrait.png crop, 432×768), so the landscape
    // coords above land in the wrong spots there. This set is mapped
    // against the portrait crop instead: x pulled inward (less horizontal
    // room), y spread over a longer vertical run — balconies high, doorway
    // mid, seat-shadow depths pushed low. Gated on the SAME media query as
    // the CSS background swap, so the eyes always agree with whichever
    // stage plate is on screen. All values are % of viewport — tune freely
    // against the real portrait art (these are first-pass placements at
    // the doorway / balcony boxes / side boxes / deep-seat shadows of the
    // taller crop).
    const EYE_PAIRS_PORTRAIT = [
        { x: 50, y: 30 }, // back-centre doorway (high in the tall crop)
        { x: 24, y: 16 }, // upper-left balcony box
        { x: 76, y: 16 }, // upper-right balcony box
        { x: 14, y: 34 }, // left side box
        { x: 86, y: 34 }, // right side box
        { x: 30, y: 56 }, // seat shadows, left
        { x: 70, y: 57 }, // seat shadows, right
        { x: 50, y: 74 }  // deep centre seats (low — long vertical run)
    ];
    // Identical gate to the CSS portrait background swap in style.css —
    // keep these two in lockstep so the eye layout always matches the
    // stage plate that's actually showing.
    const portraitMQ = window.matchMedia &&
        window.matchMedia('(orientation: portrait) and (max-width: 600px)');
    function activeEyePairs() {
        return (portraitMQ && portraitMQ.matches) ? EYE_PAIRS_PORTRAIT : EYE_PAIRS;
    }
    function buildHorrorOverlay() {
        if (document.getElementById('horror-overlay')) return;
        const root = document.createElement('div');
        root.id = 'horror-overlay';
        root.setAttribute('aria-hidden', 'true');
        const dim = document.createElement('div'); dim.className = 'bg-dim';
        const eyes = document.createElement('div'); eyes.className = 'eyes-container';
        const set = activeEyePairs();
        set.forEach((p, i) => {
            const pair = document.createElement('div');
            pair.className = 'eye-pair';
            pair.style.left = p.x + '%';
            pair.style.top  = p.y + '%';
            // Stagger fade-in across the 12 s creep (not all at once).
            pair.style.transitionDelay =
                (i * (10 / set.length)).toFixed(2) + 's';
            for (let e = 0; e < 2; e++) {
                const eye = document.createElement('span');
                eye.className = 'eye';
                // Occasional desynced blink: random long period + offset.
                eye.style.animationDelay    = (2 + Math.random() * 13).toFixed(2) + 's';
                eye.style.animationDuration = (8 + Math.random() * 7).toFixed(2) + 's';
                pair.appendChild(eye);
            }
            eyes.appendChild(pair);
        });
        const vig = document.createElement('div'); vig.className = 'red-vignette';
        const iw  = document.createElement('div'); iw.className  = 'ice-wall';
        root.appendChild(dim);
        root.appendChild(eyes);
        root.appendChild(vig);
        root.appendChild(iw);
        document.body.appendChild(root);
        // Moon "perception lies" backdrop hue-warp layer (Chunk 4).
        // Inert until body.moon-present + a dread stage drives its
        // keyframes from CSS. z below tray/vignette so the controls
        // stay readable while the stage + Munkis warp.
        if (!document.getElementById('moon-warp')) {
            const mw = document.createElement('div');
            mw.id = 'moon-warp';
            mw.setAttribute('aria-hidden', 'true');
            document.body.appendChild(mw);
        }
        // Ice "world seizes" backdrop layer (Chunk 5). Sibling of
        // #moon-warp; same z. Inert until body.ice-on-stage + a dread
        // stage drives the steps() stutter from CSS.
        if (!document.getElementById('ice-freeze-warp')) {
            const ifw = document.createElement('div');
            ifw.id = 'ice-freeze-warp';
            ifw.setAttribute('aria-hidden', 'true');
            document.body.appendChild(ifw);
        }
        // If the viewport crosses the phone-portrait threshold (rotate /
        // resize), re-place the existing pairs to match the stage plate
        // CSS just swapped to. Cheap — only moves the divs, no rebuild.
        if (portraitMQ) {
            const reflow = () => {
                const next = activeEyePairs();
                eyes.querySelectorAll('.eye-pair').forEach((el, i) => {
                    const p = next[i] || next[next.length - 1];
                    el.style.left = p.x + '%';
                    el.style.top  = p.y + '%';
                });
            };
            if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', reflow);
            else if (portraitMQ.addListener) portraitMQ.addListener(reflow);
        }
    }

    function init() {
        loadProgress();
        // Bank membership depends on moonUnlocked (Ice always in; Moon in
        // once unlocked). Call BEFORE renderTray so the first render has
        // the right chip roster.
        syncBankWithSeventhWheel();
        buildStage();
        buildHorrorOverlay();
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
        // Seed music-expansion pill labels from loaded save state.
        updateMoodBtn();
        updateTempoBtn();
        updateKeyBtn();
        updateSwingBtn();
        updateSpaceBtn();
        updateFilterBtn();
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
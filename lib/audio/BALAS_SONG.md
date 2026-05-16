# Bala's Song — reverse-engineered analysis of the All Munkis audio engine

**What this is.** A teardown of the audio code in `all-munkis/game.js`,
written so the future shared library at `madderverse/lib/audio/` has one
canonical reference for *what is actually there* and *why it sounds the
way it does*.

**Honest framing.** This engine was **not composed**. It was AI-generated
from a loose brief ("a basic reusable JS audio system with a set of
oscillators"). There was no musical intent to recover — no key chosen on
purpose, no arrangement decisions, no mix engineering. So this document
does **not** reverse-engineer intent. It documents the exact configuration
that exists and analyses, after the fact, which of those values produce
the perceived "Bala's Song" quality — the soft, sustained,
faintly-Final-Fantasy wash people reacted to. The musicality is
**emergent**, not authored. That distinction is the whole point (see
`madderverse/STORIES.md`).

Line numbers are accurate as of the commit that adds this file; treat
them as "near here," not eternal. All config values below are quoted
verbatim from the code, not from memory.

---

## 0. Global timing (CONFIG, `game.js:5–18`)

| Constant | Value | Consequence |
|---|---|---|
| `TEMPO` | 100 BPM | calm, mid-tempo |
| `STEPS_PER_BAR` | 16 | sixteenth-note grid |
| `SECONDS_PER_STEP` | `60/100/4` = **0.15 s** | one step = 150 ms |
| `BARS_PER_LOOP` | 4 | the whole piece is a **4-bar loop** |
| `NUM_SLOTS` | 6 | up to 6 player voices on top |
| derived `BAR_LEN` | `0.15 × 16` = **2.4 s** | |
| derived loop length | `2.4 × 4` = **9.6 s** | the entire song repeats every 9.6 s |

Everything is a 9.6-second diatonic-C-major loop. Nothing modulates,
nothing develops. The "song" sense comes entirely from texture and
sustain, not from form.

---

## 1. The Tone.js ambient layer (`buildToneLayer`, `game.js:189–258`)

Built once, lazily, inside `ensureAudio()`. Tone.js is bound to the
**existing raw `AudioContext`** via `Tone.setContext(audioCtx)`
(`game.js:195`). This is load-bearing: the Tone instruments and the
raw-WebAudio voices share **one hardware clock**, so reverb tails and
chiptune onsets stay sample-aligned. No second context, no drift.

### 1.1 Effects bus (`game.js:202–208`)

```
reverb → delay → busOut(Gain 0.55) → masterGain
```

| Node | Exact config | Notes |
|---|---|---|
| `reverb` | `Tone.Reverb({ decay: 3.4, preDelay: 0.04, wet: 0.35 })` | long 3.4 s tail; 35% wet |
| `delay` | `Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.22, wet: 0.22 })` | dotted-eighth (≈0.225 s at 100 BPM), modest 22% regeneration |
| `busOut` | `Tone.Gain(0.55)` | trims the wet bus before the master |

`toneBus` is assigned `reverb` (`game.js:208`), i.e. **the pad and the
bell feed the *input* of the reverb**, then through delay, then to the
master. This is the single most important block in the whole engine for
the perceived "score" quality.

### 1.2 PolySynth pad — `tonePad` (`game.js:212–217`)

```js
new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'fatsine', count: 3, spread: 22 },
  envelope:   { attack: 0.45, decay: 0.35, sustain: 0.65, release: 1.4 },
  volume: -22
})  // → toneBus (reverb)
```

- `fatsine` with `count: 3`, `spread: 22` = **three detuned sine
  oscillators per note**, ±~22 cents apart → built-in chorus/ensemble
  per voice, before any reverb.
- Envelope is **slow in, slow out**: 0.45 s attack, 1.4 s release,
  0.65 sustain. Pads bloom and bleed across the bar boundary.
- Triggered once per bar for `BAR_LEN × 0.92` (`game.js:421`) on the
  bar's triad (`C4 E4 G4` / `A3 C4 E4` / `F3 A3 C4` / `G3 B3 D4`).
- `-22 dB` — deliberately quiet; it is a bed, not a lead.

### 1.3 FMSynth bell — `toneBell` (`game.js:220–227`)

```js
new Tone.FMSynth({
  harmonicity: 2,
  modulationIndex: 11,
  envelope:           { attack: 0.002, decay: 0.5, sustain: 0, release: 0.7 },
  modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.7 },
  volume: -16
})  // → toneBus (reverb)
```

- `harmonicity: 2` (modulator one octave above carrier),
  `modulationIndex: 11` (fairly bright FM) → a clean glassy bell, not a
  clangorous one.
- `sustain: 0` on both envelopes = pure percussive *ping* that decays
  out; the **reverb is what makes it ring**.
- Fires only on section turns: bar 2 step 0 → `C6` for `2n`; bar 3
  step 12 → `E6` for `4n` (`game.js:432–437`). Sparse, high, and wet.

### 1.4 MetalSynth hat — `toneHat` (`game.js:231–236`)

```js
new Tone.MetalSynth({
  envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
  harmonicity: 5.1, modulationIndex: 32, resonance: 4200, octaves: 1.5,
  volume: -32
})  // → masterGain DIRECTLY (no reverb)
```

Routed straight to `masterGain` (`game.js:236`) — **deliberately dry**
so the off-beat tick stays tight against the kid's drum mods. Very quiet
(`-32 dB`), steps 2 and 10 only, `'32n'` at `C5`. It is groove glue, not
texture.

### 1.5 React-mode sub-drone (`game.js:243–255`)

Silent in normal play. Two sawtooths (`55 Hz` and `55.5 Hz` — a
deliberate **0.5 Hz beat**) → `lowpass 240 Hz, Q 4` → `Distortion(0.35)`
→ `Gain(0)`. On a react-mode transition `setReactDrone(true)` ramps that
gain `0 → 0.32` over **4 s** (`game.js:263–269`); off ramps back to 0.
Direct to `masterGain`, bypassing reverb. This is the horror swell, not
part of the "song" proper, but it's the same architectural pattern:
slow envelope + shared clock.

---

## 2. The raw-WebAudio BASE_SONG (`game.js:339–401`)

"Bala's Theme" proper. A 4-bar **I–vi–IV–V** loop:

| Bar | Chord | Bass (Hz) | Triad (Hz) | Melody steps 0/4/8/12 |
|---|---|---|---|---|
| 0 | C major | 65.41 (C2) | 261.63 / 329.63 / 392.00 | G5 E5 C5 E5 |
| 1 | A minor | 55.00 (A1) | 220.00 / 261.63 / 329.63 | A4 C5 E5 G4 |
| 2 | F major | 87.31 (F2) | 174.61 / 220.00 / 261.63 | A4 F4 A4 C5 |
| 3 | G major | 98.00 (G2) | 196.00 / 246.94 / 293.66 | B4 G4 B4 D5 |

Per bar, at **step 0 only**:
- **Sustained triangle bass** at the chord root: gain `0 → 0.16`
  (7 ms) → `0.13` (70% of bar) → `0.001` by end of bar. Rings the full
  2.4 s.
- **Triangle triad** (3 voices): per-voice peak `0.045 − i·0.005`,
  same slow bar-length contour. A second sustained pad under the Tone
  pad.

On quarter notes (steps 0/4/8/12): a **square-wave melody** through a
`lowpass 3000 Hz, Q 1`, gain ~`0.075`, ~0.32 s decay. The only overtly
"tune"-like, foreground element — and it's intentionally softened by the
lowpass so it doesn't read as harsh chiptune.

I–vi–IV–V in C is the canonical sentimental pop / JRPG cadence; the vi
(A minor) is the bittersweet pivot. Everything is diatonic, so anything
layered on top is consonant by construction.

---

## 3. The 8 Munki voices (`CHARACTERS`, `game.js:447–653`)

Player-placed. Up to 6 play simultaneously over BASE_SONG + Tone layer.
Each `play(ctx, out, when, step)` is raw WebAudio → `masterGain`.

| Munki | Lines | Waveform / synthesis | Steps | Peak gain | Musical role |
|---|---|---|---|---|---|
| **red** | 448–474 | 2× sawtooth, root + `root×1.005` (detuned), → `lowpass 800→300 Hz, Q 5` | 0, 8 | 0.18 | **detuned saw bass stab** (C2 / G2) — rhythmic low end |
| **orange** | 476–502 | white noise → `bandpass 2200, Q 1.2` + triangle `210→135` body | 4, 12 | 0.32 | **snare / backbeat** — percussive, no pitch content |
| **yellow** | 504–524 | 3× sine, `1046.5 / 1318.51 / 1567.98` (C6 E6 G6), staggered 60 ms | 0 | 0.10 | **bell triad shimmer** — pure high harmonics, 0.6 s tail |
| **green** | 526–548 | sawtooth hook → `lowpass 2200→900, Q 4` | 0,4,8,12 | 0.16 | **melodic saw lead** (C5 E5 G5 E5) — sits in the tune register |
| **blue** | 550–580 | sine sub `110→75` (steps 0,6,10) + triangle blip `880→523` (steps 3,8,13) | many | 0.32 / 0.13 | **sub-bass + syncopated blip** — depth + motion |
| **purple** | 582–607 | triangle + **LFO vibrato** (5 Hz, ±4 Hz depth) | 2,6,10,14 | 0.13 | **lyrical "singing" lead** — the most vocal-like voice |
| **moon** | 609–634 | 2× sine, `65.41` (C2) + `130.81` (C3) | 0 | 0.32 | **deep sustained drone** — 2.4 s full-bar pedal tone |
| **ice** | 636–653 | triangle, `1046.5 / 1174.66 / 1318.51 / 1567.98` (C6 D6 E6 G6) | 3,7,11,15 | 0.07 | **glassy off-beat filigree** — celesta-like sparkle |

### Which voices carry "song" vs. decoration

- **Song / sustained / melodic:** `moon` (full-bar sine pedal — the
  single most "orchestral" character voice), `purple` (vibrato lead,
  the closest thing to a singing line), `green` (diatonic saw hook),
  `yellow` (sine triad pad-let), `ice` (high consonant filigree).
- **Rhythmic / percussive decoration:** `orange` (snare), `red`
  (bass stab), `blue` (sub + blip — half pitched, half rhythmic).

`moon` is notable: its 2.4-second `65.41 Hz + 130.81 Hz` sine pair, gain
`0 → 0.32 → 0.26 → 0.001` across the whole bar, is functionally an
orchestral low-pedal. Drop Moon on stage and the loop instantly gains
the "epic underscore" floor. Even without Moon, BASE_SONG's full-bar
triangle bass+triad provides a weaker version of the same scaffold.

---

## 4. The master chain (`ensureAudio`, `game.js:159–172`)

```
all voices → masterGain (0.55) → DynamicsCompressor → destination
```

| Node | Exact config |
|---|---|
| `masterGain.gain` | **0.55** (0 when muted) |
| compressor `threshold` | **−10 dB** |
| compressor `knee` | **8** |
| compressor `ratio` | **6 : 1** |
| compressor `attack` | **0.004 s** |
| compressor `release` | **0.15 s** |

Per-voice gains are all deliberately small (pad `−22 dB`; character
peaks `0.07–0.32`). With `masterGain 0.55` and a `6:1` compressor biting
at `−10 dB` with a soft `8` knee and fast `4 ms` attack, the stack of
12+ simultaneous voices is squeezed into one coherent body instead of a
pile of additive beeps. The `Tone` effects bus (`busOut 0.55`) and the
dry hat/drone all converge here too. The compressor is the "mix
engineer" the code never had.

---

## 5. The scheduler (`schedule` / `scheduleStep`, `game.js:271–300`)

Textbook "Tale of Two Clocks":

- **Lookahead window:** `SCHEDULE_AHEAD = 0.1 s` — schedule everything
  due within the next 100 ms.
- **Polling interval:** `LOOKAHEAD_MS = 25 ms` — `setTimeout(schedule,
  25)` re-arms; timer jitter never touches note onset.
- **`when` computation:** `nextStepTime` starts at
  `audioCtx.currentTime + 0.08`, advances by exactly `SECONDS_PER_STEP`
  (0.15 s) per step. Every voice receives this sample-accurate `when`
  and calls `osc.start(when)` — the `setTimeout` only *queues*, it never
  *gates* onset.
- **Step/bar advance:** `currentStep` 0→15 then wraps, incrementing
  `currentBar` 0→3 (`% BARS_PER_LOOP`).
- Visual pulse + react tick are deferred with a `setTimeout` of
  `(when − currentTime)·1000` so graphics line up with audio without
  ever blocking the audio thread.

Because Tone shares this same `audioCtx`, the Tone scheduler and this
loop are on the same crystal. That phase-lock is why the reverb wash
sits *under* the chiptune instead of smearing against it.

---

## 6. Analysis — what actually produces the "Bala's Song" quality

After the fact (no intent existed), these are the 3–5 elements doing the
work, most → least significant:

1. **The reverb-drenched PolySynth pad is the entire "score" bed.**
   `fatsine, count 3, spread 22` (`game.js:213`) is a 3-oscillator
   detuned chorus *per note* before any effect. Run that through a
   `decay 3.4 s, wet 0.35` reverb plus a dotted-eighth feedback delay
   (`game.js:202–203`), with a slow `0.45 s` attack / `1.4 s` release
   envelope (`game.js:214`), and you get the weightless, blooming,
   "town theme" wash. Remove this one block and the magic is gone — it
   is the dominant contributor.

2. **A single shared `AudioContext` clock binds it together.**
   `Tone.setContext(audioCtx)` (`game.js:195`) means the long reverb
   tails and the sample-accurate chiptune onsets are on one hardware
   clock. This is why a 12-voice pile reads as one *recorded* thing
   rather than a smeary layering of two engines. (It is also the same
   property that made two browser tabs accidentally harmonise — see
   the Dual Row Stage note in `all-munkis/CLAUDE.md`.)

3. **Sustained low pedal tones imply orchestration.** BASE_SONG's
   full-`BAR_LEN` triangle bass + triad (`game.js:355–379`) and,
   when present, `moon`'s 2.4 s `C2+C3` sine pair (`game.js:609–634`)
   hold harmony across the whole bar. Sustained roots under a moving
   progression is the oldest "this is a film/JRPG score" trick there
   is; the code does it for free because the envelopes happen to be
   bar-length.

4. **Pure waveforms + a sentimental diatonic loop = nothing can
   clash.** Everything is sine/triangle (saws are always filtered:
   red `800→300`, green `2200→900`), all in C major, over an
   **I–vi–IV–V** 9.6 s loop with A-minor as the bittersweet pivot
   (`game.js:340–347`). Any combination of the 6 player voices is
   consonant by construction, so it always sounds "musical" no matter
   what a 5-year-old does. The FM bell + yellow's sine triad + ice's
   triangle filigree pile on high, pure harmonics with zero harshness —
   the "chime over strings" Final-Fantasy signature.

5. **The master compressor is the mix engineer.** `threshold −10`,
   `ratio 6:1`, `knee 8`, `attack 4 ms`, `release 150 ms`
   (`game.js:165–170`) over `masterGain 0.55`, with every voice
   deliberately low-gain, glues the polyphony into one produced-sounding
   body. Without it, the same notes are a thin additive beep-stack. With
   it, they're "a song."

**Summary for the shared library.** The signature is not a melody — it
is a *system*: pure low-harmonic waveforms, slow bar-length envelopes, a
heavy shared reverb/delay bus, a diatonic I–vi–IV–V bed, and a gluing
compressor, all on one shared `AudioContext` clock. Port *that system*,
not the note tables, and any madderverse game will speak in Bala's
voice. The note tables are interchangeable; the architecture is the
brand.

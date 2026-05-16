# All Munkis — game-level guide

Sprunki-style drag-and-drop music game inside the Madderverse hub.
**Read the repo root [`CLAUDE.md`](../CLAUDE.md) first** for project-wide rules
(no build system, GitHub Pages deploy, "flat" game shape, GoatCounter beacon,
ad-free / kid-friendly branding). This file captures only what's specific to
`all-munkis/`.

## Dual Row Stage origin (v1.1 feature)

Discovered by accident during a two-monitor debug session — two
independent browser instances of the game running offset by a few
seconds produced clean polyphonic harmony, because each tab's
`AudioContext` has its own crystal clock and the Tale of Two Clocks
scheduling pattern keeps both deterministic loops drift-free. The Dual
Row Stage feature (front row + offset back row, single tab, two
simultaneous groups of Munkis) reproduces this intentionally.

## What it is

- 5-slot stage × 22-mod tray. **Tap** a tray chip to teleport its Munki onto
  the next empty stage slot. **Tap** a Munki on stage to cycle its head
  expression 1→2→3→4→5→1. **Drag** a Munki off the stage to clear it.
  If the stage is full, the tapped chip shakes to signal "no room."
- Pure HTML/CSS/JS. No build step. **All audio is synthesized in-browser**
  — there are no audio files anywhere. The 24 per-Munki voices use raw
  WebAudio; on top of that, a self-hosted Tone.js (v14.8.49, MIT) drives
  an ambient layer (PolySynth pad + FM bell + MetalSynth hat through a
  shared reverb/delay bus). Both layers share the same `AudioContext`
  so they stay phase-locked.
- Ambient + horror layers that aren't user-controlled mods:
  - **`BASE_SONG`** — Cmaj→Am two-bar background loop ("Bala's Theme"). Toggle
    via the `SONG` button.
  - **Jumpscare** — manual via the `BOO!` button, **and** auto-fires when
    `MOON` or `ICE` lands in a slot. 1.5s, debounced.
  - **Ice freeze** — when Ice Munki is on the stage, every other active
    slot gets the cyan tint + ❄ flake + 💀 RIP visual via
    `.frozen-by-ice`. Morbidly absurd, not gory. Thaws automatically
    when no Ice Munki remains. See `updateIceFreeze()`.
  - **Moon Rules** — while Moon Munki is on the stage, ANY click on the
    page rolls a random chaos event (hue rotate, invert flash, slot
    shuffle, 🌙 rain, subtitle glitch, page tilt, phantom Munki).
    Cooldown 700ms. Wired in `attachMoonChaos()`.
  - **React mode** — a regular Munki on a slot directly adjacent (N-1 or
    N+1) to Ice or Moon accrues dwell time on every quarter note. After
    `REACT_DWELL_BEATS` (8) beats it trips into react mode and auto-cycles
    its expression 1→2→3→4→5 on every beat. `body.react-mode-active` is
    toggled whenever any slot is reacting. Dwell resets when the trigger
    or victim is moved away. See `tickReactState()`.
  - **Horror mode visuals + audio** — while `body.react-mode-active` is
    set:
      - the body BG (the `stage.jpg` photo) darkens + desaturates via a
        slow 4-s `filter: brightness(0.55) saturate(0.45) contrast(1.12)`,
      - the `Moon` and `Ice` Munki sprites (cropped from
        `assets/bg-img/bg-munkis.png`) creep into view from the lower
        corners over ~4.5 s, then settle into a subtle 5-s "breathing"
        scale animation,
      - a Tone.js sub-bass drone (twin detuned sawtooths → lowpass →
        Distortion → Gain) ramps its gain 0 → 0.32 over 4 s and sits in
        the mix until react ends. All three back off on the reverse
        transition.

## File layout

```
all-munkis/
  index.html            # static markup; header buttons + #stage + #tray + #booOverlay
  game.js               # everything below in one IIFE
  style.css             # @imports the bundled JetBrains Mono TTF
  assets/
    bg-img/             # Shared stage background art.
      stage.jpg           # One generic stage photo behind every screen
                          # (Bank 1 / Bank 2 / Madballz). Set as the body
                          # background-image in style.css.
      bg-munkis.png       # 870×992 sprite sheet, two frames:
                          #   bg-moon (x=2,   y=2, w=432, h=988)
                          #   bg-ice  (x=436, y=2, w=432, h=988)
      bg-munkis.json      # frame coords (mirrored into the index.html
                          # SVG viewBox attributes for .horror-munki--moon
                          # and .horror-munki--ice).
    JetBrainsMono-VariableFont_wght.ttf
    vendor/
      tone.min.js          # Self-hosted Tone.js v14.8.49 (MIT). Loaded by
                           # index.html BEFORE game.js. ~340 KB. The whole
                           # ambient layer (PolySynth pad, FM bell, metal
                           # hat, reverb + delay bus) is built from this.
                           # Game stays playable if the file fails to load
                           # — buildToneLayer just bails.
    sprites/
      default-heads.png    # 1602×1002, 40 Munki heads = 5 expression rows
                           # × 8 color columns. Frame names are
                           # `{expr}-{color}`, e.g. `3-G`. Composed on
                           # render — Munkis pick their COLOR from their
                           # bodyColor (see COLOR_BY_BODY) and their
                           # EXPRESSION from game state (see expressionForSlot).
                           # Expressions: 1 silly (default) → 2 shocked
                           # → 3 sad → 4 smug → 5 angry.
                           # Colors: B G O P R Y are crew colors. X (black,
                           # glitch-grey) is pinned to Moon Munki; Z (white,
                           # glitch-grey) is pinned to Ice Munki — both are
                           # evil in lore.
      default-heads.json   # frame coords (mirrored into SHEETS.munki)
      mb-heads.png         # 4330×2191, 8 Madballz heads named by id
                           # (mb-skull, mb-sad, mb-zombie, mb-snooze,
                           # mb-scared, mb-cool, mb-grump, mb-eye).
                           # Heads come in 4 colors: PURPLE / ORANGE /
                           # GREEN / TEAL. Static — Madballz keep their
                           # single `headFrame` and ignore expression state.
      mb-heads.json        # frame coords (mirrored into SHEETS.mb)
  .claude/launch.json     # `python -m http.server 8770` — used by preview tools
```

## Architecture (game.js, top → bottom)

| Section | What lives there |
|---|---|
| **CONFIG** | `TEMPO=100`, `STEPS_PER_BAR=16`, `NUM_SLOTS=5`, `BARS_PER_LOOP=4`, `REACT_DWELL_BEATS=8`, `PLACED_SHOCK_MS=600`, `DRAG_THRESHOLD_PX=12` |
| **AUDIO ENGINE** | `audioCtx`, `masterGain` + `DynamicsCompressor` bus, `isMuted`, `isBaseSongOn`, `isJumpScareActive`, `currentStep`, `currentBar`, plus Tone.js handles: `toneReady`, `toneBus`, `tonePad`, `toneBell`, `toneHat`. |
| `ensureAudio()` | Lazily creates the AudioContext + compressor on first user interaction, then calls `buildToneLayer()` to set up the Tone.js side. |
| `buildToneLayer()` | Binds Tone.js to the existing `audioCtx`, builds a reverb + delay bus, and constructs the three ambient Tone instruments. Silently bails if Tone isn't loaded — the game stays playable without it. |
| `schedule()` | Look-ahead scheduler. Advances `currentStep` 0..15 then increments `currentBar` 0..3 (`BARS_PER_LOOP`). |
| `scheduleStep(step, bar, when)` | Calls `BASE_SONG.play()` + `TONE_LAYER.play()` (both gated on `isBaseSongOn`) + every active slot's `ch.play()` + visual pulse / `tickReactState` on quarter notes. |
| **SYNTH HELPERS** | `noiseSource(ctx, dur)`, `distortionCurve(amount)` |
| **BASE_SONG** | Raw-WebAudio 4-bar I-vi-IV-V loop (Cmaj → Am → Fmaj → G). `chordsByBar` array carries `{ bass, triad, melody }` per bar. `play(ctx, out, when, step, bar)` fires bass + pad triad at `step === 0` and a square-wave melody hook on quarter notes. |
| **TONE_LAYER** | Tone.js side of the loop. Same 4-bar progression in chord-name form. PolySynth pad sustains the bar's chord; MetalSynth hat ticks the off-eighth (steps 2 + 10); FMSynth bell sparkles on bar 2 step 0 and bar 3 step 12 for section turns. No-op when `toneReady === false`. |
| **CHARACTERS** | The 22-mod dict. **See "Adding a mod" below.** Body color must match the head sprite color — see comment above `SHEETS`. |
| **STANDARD_ORDER / MADBALLZ_ORDER** | Tray order arrays. Munkis are grouped by HEAD COLOR (green → orange → purple → blue) and Ice Munki + Moon Munki are pinned to the very end on **every page**, including the Madballz tray. |
| **HORROR_TRIGGER_MODS** | `Set(['moon', 'ice'])`. Auto-trigger jumpscare when one of these is placed (and wasn't already there). |
| **SHEETS** | `{ munki: {src, sheetW, sheetH, frames}, mb: {…} }`. Frame coords mirror the matching JSON. Munki frames are `{expr}-{color}` (5×8 = 40 frames); Madballz frames are `mb-{id}` (8 static frames). |
| **COLOR_BY_BODY** | Maps each Munki's `bodyColor` hex to its single-letter color code (B/G/O/P/R/X/Y/Z). Used by `headArt` to pick which column of `default-heads.png` to render. |
| **expressionForSlot(slotIndex)** | Returns 1..5 per slot. Priority: jumpscare → 2; react mode → cycle 1..5 on beat (`reactStartBeat` Map + `beatCounter`); just placed → 2 (`placedAt` Map, ~600 ms); manual tap → that row (`manualExpression` Map); default → 1. |
| **cycleManualExpression(idx)** | Tap-on-stage handler — bumps `manualExpression[idx]` to the next row, wrapping 5→1. |
| **tickReactState()** | Called from `scheduleStep` on every quarter note. Increments `dwellBeats[idx]` for any regular Munki adjacent to Ice/Moon; trips it into react mode at `REACT_DWELL_BEATS`. Re-renders just the affected slots and toggles `body.react-mode-active`. |
| **isTriggerAdjacent(idx)** | True when slot N-1 or N+1 holds Ice or Moon (linear 5-slot row). |
| **isIceOnStage / updateIceFreeze** | Ice Munki freeze logic — toggles `.frozen-by-ice` on every other active slot when Ice is placed. |
| **moonRules / attachMoonChaos** | Moon Munki click chaos — `attachMoonChaos()` adds a document-level click listener; `moonRules()` picks a random effect (hue, invert, shuffle, rain, glitch text, tilt, phantom). |
| **setReactDrone(on)** | Ramps the Tone.js sub-bass drone (`toneDroneGain.gain`) 0 → 0.32 or back to 0 over 4 s. Called only on react-mode transitions (`anyWasReacting` edge-detect in `tickReactState`) so the drone holds steady during react and silently rests the rest of the time. |
| **ART** | `bodyArt(c)`, `headShapeArt(c)`, `headModArt(frameName, sheetName)`, `headPhonesArt()`, `hairArt(c)`, `headArt(c, expr)`, `characterArt(id, slotIndex?)`. All return SVG strings. |
| **HAIR** | `HAIR_STYLES`, `HAIR_COLORS`, `hairSvg(style, color, dark)`, `assignRandomHair()` (picks ~55% of mods at init, skips horror-trigger ones). |
| **STATE** | `slots = new Array(NUM_SLOTS).fill(null)` |
| **UI / RENDER** | `buildStage`, `renderTray`, `renderSlot`, `renderAllSlots`, `setSlot` |
| **TRAY: tap-to-place** | Plain `click` listener on every chip — `setSlot(slots.indexOf(null), id)`. If `indexOf` returns -1 the chip shakes (`.shake` keyframes). Re-attached after every `renderTray()` (init / bank switch / mode switch). |
| **STAGE: tap-cycle + drag-clear** | Single delegated pointer-event listener on `#stage`. `pointerdown` records start; if the pointer moves past `DRAG_THRESHOLD_PX` it's a drag (slot gets `.dragging-off`). On `pointerup`, a drag released outside any stage slot clears via `setSlot(idx, null)`; otherwise it's a tap and calls `cycleManualExpression(idx)`. `findSlotAt(x, y)` helps the drag branch decide. |
| **UI SOUNDS** | `playDropSound`, `playClearSound` |
| **JUMP SCARE** | `triggerJumpScare()` toggles `body.jumpscare` for 1.5s + `playJumpScareSound()` (distorted shriek + sub thud) |
| **HEADER BUTTONS** | `attachHeaderHandlers()` wires REMIX, CLEAR, SONG, BOO!, mute |
| **INIT** | `assignRandomHair()` → build → render → attach handlers |

## Audio engine notes

**Reusable audio generator (cross-game intent):** This Web Audio
engine — single `AudioContext` + Tale of Two Clocks lookahead
scheduler + per-voice `play(when, step)` functions + master gain →
`DynamicsCompressor` → destination + optional Tone.js ambient layer —
is intended to be extracted into a shared library at
`madderverse/lib/audio/` for use across the rest of the rhythm-based
madderverse games (Pootery, Cookie Cache, Groodle, Tiny Canvas,
future). All Munkis is the prototype; treat the engine code (the
`ensureAudio()` + `schedule()` + `scheduleStep()` + voice-helper range,
roughly `game.js:159-285`) as the canonical implementation that future
extraction will pull from. Don't break the architectural patterns —
lazy single-context init, sample-accurate `when`-scheduled voices,
the look-ahead `setTimeout` only queueing (never gating) note onset —
in ways that would complicate that future extraction.

## Flying Creeps — standard vs itch-exclusive sheet

The Flying Creep is an ambient creature that drifts across the stage,
scares nearby Munkis (per-Munki `fear`), and trips the shared horror
mode at threshold. Its art is a **hot-swappable sprite sheet** —
`loadCreepSheet()` only ever reads `assets/sprites/flying-creeps.{png,
json}`; with no valid sheet it falls back to a clearly-marked
placeholder ghost. Zero code coupling to the art.

**Official lore (canon — standard builds):** the Flying Creeps *are
the Rainbow Munkis*. Ice and Moon, out of jealousy, cursed Red,
Orange, Yellow, Green, Blue, and Purple — twisting each into a winged
Flying Creep and casting them out, doomed to drift back forever to
ruin the performance they can never rejoin. Six Munkis → six Creeps,
one per colour (the shipped sheet is a 6-variant 3×2 grid). The
`index.html` lore modal ("THE RAINBOW & THE CURSED MUNKIS") tells it.

The concept was *originally* born from rude "AI slop" comments on the
itch.io release — the haters' comments reincarnated. That meta version
is now **itch.io-only** (the curse story above is canon everywhere
else); it's unsuitable for a kid-clean Play / web listing.
Convention (full spec in
[`assets/sprites/FLYING_CREEPS_README.md`](assets/sprites/FLYING_CREEPS_README.md)):

- **`flying-creeps.{png,json}`** = the STANDARD kid-clean sheet —
  ships in *every* standard release (madderverse.org **and** the
  Play app). Identical across `all-munkis/` and `all-munkis-app/www/`.
- **`itch-creeps.{png,json}`** = the itch-exclusive meta sheet — lives
  ONLY in `all-munkis/assets/sprites/`, swapped over `flying-creeps.*`
  at itch-package time as a documented manual build step. Never
  committed as `flying-creeps.*`; never copied into `all-munkis-app/`.

Treat `flying-creeps.{png,json}` as a deliberately divergent asset
(like the Capacitor native bridge in the app's `game.js`): a blind
"sync web → app" must not reintroduce the itch art onto Play.

## Future modes (planned, v1.2+)

**Round Robin Mode** — single stage. Munkis enter one at a time, each
on the next configurable interval (default: every 4 beats or 1
measure). Build to full 6-Munki chorus, hold for some duration, then
peel away in reverse or freeze on the full mix. Visual: stage fills
from left to right as voices stack, audio layers cumulatively per the
existing engine. Single AudioContext, no offset between voices — they
all share the same hardware clock, just enter at different `step`
indices.

**Hambone Mode** — Munkis are assigned one of two roles when placed:
**Lead** (plays on the beat, beats 1 and 3) or **Answer** (plays on
the off-beat, beats 2 and 4, or syncopated "&" positions). Mixing
leads and answers creates call-and-response polyrhythmic feel
automatically. Optional global toggle for **triplet/shuffle feel**
that retimes eighth notes from straight to long-short for the
gospel/country lope.

Visual differentiation: Lead Munkis stand tall and steady; Answer
Munkis sway side-to-side, the rhythmic geometry literally visible on
stage. Subtle hand-clap synth (oscillator + filtered noise burst, no
samples) on the Answer beats. The role assignment is a runtime
property set on drop, not part of the Munki identity — same Munki
sprite can be Lead or Answer depending on stage role.

Combination: a **Hambone Round** preset cycles through Round Robin
entry order while alternating Lead/Answer role assignment as new
voices join. Builds a complete polyrhythmic small-choir texture as
the stage fills.

**Architectural notes:** Both modes are step-pattern + timing +
role-assignment features layered on top of the existing audio engine.
Audio engine architecture (Tale of Two Clocks, single AudioContext,
per-Munki play() functions, master gain → compressor) stays exactly
as-is. These modes are mode switches, not engine rewrites.

## The character data shape

```js
mod_id: {
    label: 'DISPLAY NAME',          // shown in chip + slot
    bodyColor: '#hex',               // body fill — ALSO selects the head
                                    //   sprite column via COLOR_BY_BODY
                                    //   for Munkis (no headFrame).
    bodyHi:    '#hex',               // body highlight oval
    bodyShade: '#hex',               // body stroke + feet
    headFrame: 'mb-skull',           // optional. Madballz ONLY — pins a
                                    //   static frame name. Munkis don't
                                    //   set this; their frame is built at
                                    //   render time as `${expr}-${letter}`.
    sheet:     'mb',                 // optional. Pair with headFrame for
                                    //   the Madballz sheet. Munkis omit.
    play(ctx, out, when, step) {     // WebAudio scheduling. step is 0..15.
        // create oscillators/noise/filters, connect to `out`,
        // schedule with start/stop relative to `when`.
    }
}
```

`hair: { style, color, outline }` is added by `assignRandomHair()` at init —
**don't** set it manually on character defs (it would override the random pick).

## The visual layering (per character)

`characterArt(id, slotIndex?)` returns:

```
.char-art
├── .char-body          (SVG, full ellipse + feet, animates squash/stretch on beat)
└── .char-head          (animates head bob on beat)
    ├── .head-shape     z-index 1   colored circle, body color, drop-shadow
    ├── .head-mod       z-index 2   <svg><image> cropped to a sheet frame
    │                              (Munki: `{expr}-{color}` in default-heads;
    │                               Madballz: static frame in mb-heads)
    ├── .char-hair      z-index 2   procedural SVG hair (only if c.hair set)
    └── .head-phones    z-index 3   oversized SVG cans, overflow:visible
```

All head sub-layers share the same 100×100 viewBox so the headphones stay
anchored when the sprite frame swaps (e.g. a Munki shocked → angry on a
state change). The bounce keyframes (`char-body-bounce`, `char-head-bob`)
are in `style.css` and fire when a `.beat` class is added to `.char-art`
on quarter notes.

`slotIndex` is passed for chips on the stage so `expressionForSlot` can
pick the right row; tray chips, drag ghosts, and moon phantoms omit it
and render at expression 1 (idle).

## How to make common changes

### Add a new Munki
1. Add an entry to `CHARACTERS` (see shape above). Pick one of the 6 crew
   `bodyColor`s — that hex must already be in `COLOR_BY_BODY` (otherwise
   no head sprite will render). Do NOT set `headFrame` — Munkis pick their
   frame at render time.
2. Add the id to `STANDARD_ORDER` at the right position for its color
   group. **Ice + Moon must remain the last two entries.**

### Add a new Madballz mod
1. Add an entry to `CHARACTERS` with `sheet: 'mb'` and `headFrame: 'mb-…'`
   pointing at a frame in `SHEETS.mb`. Body color matches that head's
   background per the existing convention.
2. Add the id to `MADBALLZ_ORDER`.

### Change a Munki's color
- Change its `bodyColor` to another hex in `COLOR_BY_BODY`. The head
  sprite column follows automatically. (X = Moon-only, Z = Ice-only —
  don't reassign these to other Munkis.)

### Replace a Madballz character's head
- Change its `headFrame` (and `sheet` if switching sheets). Body stays.

### Swap in new stage art
The body BG is just `url('assets/bg-img/stage.jpg')` in `style.css` — drop
in a replacement at that path (any dimensions; `background-size: cover`
handles the framing) and every screen retints. The horror-mode corner
characters live in `assets/bg-img/bg-munkis.png` (frames `bg-moon` and
`bg-ice`); to swap those, keep the file at the same path and update the
SVG `viewBox` attributes in `index.html` to match the new frame coords.

### Tweak the expression rules
- Edit `expressionForSlot(slotIndex)`. Keep the contract: returns 1..5.
  `headArt` slots the result into the frame name `${expr}-${letter}`.

### Add a new hair style
- Add the style name to `HAIR_STYLES` and a `case` in `hairSvg()`'s switch.

### Add a new spritesheet
1. Drop the PNG + JSON in `assets/sprites/`.
2. Add a new entry to `SHEETS` with `{ src, sheetW, sheetH, frames }`.
3. Reference it via `sheet: 'your-name'` on a character.

### Audio role assignments (for stacking-friendly arrangements)
The 22 mods are tuned to fill specific musical roles in C major so any 8
will sound coherent together:

- **Drums** truck (kick), drum (snare), nugget (closed hat), coconut (open hat),
  choochoo (shaker), fire (16th tambourine), tamil (tabla)
- **Bass** moon (sub C2 sustain), troll (saw stab C2/G2), banana (sine walk C-E-G-E)
- **Pad** cloud (Cmaj triad held)
- **Leads / arps** munki (saw hook), flute (offbeat melody), cocoa (bird arp),
  star (bell triad), ice (high twinkle)
- **Madballz textures** mb-zombie (distorted alien-pluck), mb-sad (triangle drip),
  mb-cool (random sine arp), mb-grump (chopper-LFO bass), mb-eye (electric square),
  mb-skull (low noise thud), mb-snooze (long yawn pad), mb-scared (high-pass shiver)

When adding a new mod, pick a register/role that isn't crowded.

## Things that bite

- **Don't change `STEPS_PER_BAR`** — every existing `play()` uses literal step
  numbers (e.g. `if (step !== 0 && step !== 8) return`). Need a 32-step bar?
  Add a separate counter, don't grow this one.
- **`isJumpScareActive` debounces the scare** — REMIX over multiple horror
  mods only fires one scare. Intentional.
- **Ice freeze re-fires on transition only** — `updateIceFreeze()` adds
  `.frozen-by-ice` only when a slot moves from unfrozen → frozen so the
  CSS RIP animation runs once per victim. Don't toggle the class on every
  render or it will replay the death animation forever.
- **Moon chaos has a 700ms cooldown** — `moonChaosCooldown` blocks rapid
  spam. Don't shorten it without testing on a low-end phone; the
  effects (page hue rotate, invert flash) get seizure-y if stacked.
- **Body color drives head color** — `headArt` looks up the Munki's
  `bodyColor` in `COLOR_BY_BODY` to pick which column of `default-heads.png`
  to crop. If you set a custom body hex not in that map, the sprite layer
  renders empty and only the flat `headShapeArt` circle shows. Add the hex
  to `COLOR_BY_BODY` (or pick an existing one) before shipping.
- **X (black) and Z (white) are reserved for Moon and Ice** — they are
  the only colors with the "glitch-grey" evil face set. Don't reassign
  these letters to regular crew Munkis.
- **Headphones use `overflow="visible"`** so cups extend past the SVG box.
  Don't switch the SVG element to `overflow: hidden` or the chunky cartoon
  silhouette breaks.
- **`assignRandomHair()` runs at init** — different page loads = different
  hair. If determinism is ever needed, seed `Math.random` or hash by id.
- **Audio engine is lazy** — nothing plays until the user clicks/taps. Tests
  that programmatically trigger audio need to call `ensureAudio()` first.
- **Master compressor sits between `masterGain` and `destination`** in
  `ensureAudio`. New voices that connect directly to `audioCtx.destination`
  bypass it; always connect to `masterGain` (or whatever `out` is passed in).
- **Drag/drop uses pointer events with `setPointerCapture`** — works on
  mouse + touch. The tray chip itself sets `touch-action: none` in CSS so
  the browser doesn't steal the gesture for scrolling.
- **CSS file is small** — it's safe to scan with `Read` in one call.
  `game.js` is now ~1400 lines; prefer `Grep` for specific symbols
  (`headPhonesArt`, `BASE_SONG`, `triggerJumpScare`, etc.) to avoid loading
  the whole file when you only need one section.

## Local preview

The repo root `CLAUDE.md` documents `python3 -m http.server 8000`. For this
game specifically, `.claude/launch.json` runs `python -m http.server 8770`
when invoked through the preview MCP. Open `http://localhost:8770/`.

## Recent history (for context, may go stale)

The session that built the current shape did, in order:
1. 4 slots → 8 slots, body+head split, mobile layout
2. Layered head (shape/face/mod/phones) wired to a 6-frame head set
3. Tuned 16 mods into a C-major band + master compressor
4. `BASE_SONG` two-bar Cmaj→Am loop + SONG toggle
5. `BOO!` jumpscare + 1.5s shake/flash/glitch/overlay
6. Switched to `munki-heads` (16) + added `madballs-heads` (6 Madballz Modz);
   horror trigger logic; lore copy
7. Restored CHOOCHOO, switched horror trigger to MOON/ICE, supersized
   headphones (~3× cups, +71% band stroke), added procedural hair to ~55%
   of non-horror mods
8. Renamed game directory `all-monkeys/` → `all-munkis/`. New
   `default-heads.png` sheet (4330×4381) with frame names = ids.
   Re-grouped tray by head color with Ice + Moon pinned last on every
   page. Added Ice freeze ("DEATH" tint + 💀 RIP) and Moon Rules
   (random click chaos: hue rotate, invert, shuffle, 🌙 rain, glitch
   text, page tilt, phantom Munki).
9. New Madballz sheet `mb-heads.png` (4330×2191), 8 frames named
   `mb-skull`, `mb-sad`, `mb-zombie`, `mb-snooze`, `mb-scared`,
   `mb-cool`, `mb-grump`, `mb-eye`. Replaced the 6 old `mb-zorb`,
   `mb-drip`, `mb-random`, `mb-thrum`, `mb-volt`, `mb-rock` with 8 new
   characters that match the new sprites; added two new audio profiles
   (`mb-snooze` yawn pad, `mb-scared` shiver). Madballz tray now also
   color-grouped (purple → orange → green → teal) with Ice + Moon last.
10. New `default-heads.png` (1602×1002), 40 frames = 5 expression rows ×
   8 color columns. Removed the procedural SVG face system
   (`headFaceArt`, `EYE/MOUTH/BROW/EXTRA_RENDERERS`, per-character
   `face: {…}` properties) and replaced it with sprite-based heads that
   pick their expression from game state (`expressionForSlot`): 2 on a
   fresh drop or during a jumpscare, 3 if Ice is on stage, 5 if Moon is
   on stage, 1 otherwise. Moon's body flipped white → dark `#1f2937` to
   match its new X (black-glitch) head. Ice keeps the white body, now
   paired with the Z (white-glitch) head.

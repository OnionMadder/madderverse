# All Munkis — game-level guide

Sprunki-style drag-and-drop music game inside the Madderverse hub.
**Read the repo root [`CLAUDE.md`](../CLAUDE.md) first** for project-wide rules
(no build system, GitHub Pages deploy, "flat" game shape, GoatCounter beacon,
ad-free / kid-friendly branding). This file captures only what's specific to
`all-munkis/`.

## What it is

- 8-slot stage × 22-mod tray. Drag a chip onto a slot, the mod's voice joins
  the loop. Tap a filled slot to clear it.
- Pure HTML/CSS/JS. No build step. **All audio is synthesized via WebAudio**
  — there are no audio files anywhere.
- Two ambient layers that aren't user-controlled mods:
  - **`BASE_SONG`** — Cmaj→Am two-bar background loop ("Bala's Theme"). Toggle
    via the `SONG` button.
  - **Jumpscare** — manual via the `BOO!` button, **and** auto-fires when
    `MOON` or `ICE` lands in a slot (drag, drop, or REMIX). 1.5s, debounced.
  - **Ice freeze** — additional layer on top of the jumpscare: when Ice
    Munki is on the stage, every other active slot freezes to "DEATH"
    (cyan tint, ❄ flake, 💀 RIP flag). Morbidly absurd, not gory. Thaws
    automatically when no Ice Munki remains. See `updateIceFreeze()`.
  - **Moon Rules** — while Moon Munki is on the stage, ANY click on the
    page rolls a random chaos event (hue rotate, invert flash, slot
    shuffle, 🌙 rain, subtitle glitch, page tilt, phantom Munki).
    Cooldown 700ms. Wired in `attachMoonChaos()`.

## File layout

```
all-munkis/
  index.html            # static markup; header buttons + #stage + #tray + #booOverlay
  game.js               # everything below in one IIFE
  style.css             # @imports the bundled JetBrains Mono TTF
  assets/
    JetBrainsMono-VariableFont_wght.ttf
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
| **CONFIG** | `TEMPO=100`, `STEPS_PER_BAR=16`, `NUM_SLOTS=8`, `BARS_PER_LOOP=2` |
| **AUDIO ENGINE** | `audioCtx`, `masterGain` + `DynamicsCompressor` bus, `isMuted`, `isBaseSongOn`, `isJumpScareActive`, `currentStep`, `currentBar` |
| `ensureAudio()` | Lazily creates context + compressor on first user interaction |
| `schedule()` | Look-ahead scheduler. Advances `currentStep` 0..15 then increments `currentBar` 0..1 |
| `scheduleStep(step, bar, when)` | Calls `BASE_SONG.play()` (if on) + every active slot's `ch.play()` + visual pulse on quarter notes |
| **SYNTH HELPERS** | `noiseSource(ctx, dur)`, `distortionCurve(amount)` |
| **BASE_SONG** | One object with `play(ctx, out, when, step, bar)`. Sustained bass + pad on step 0; melody hook on quarter notes. Cmaj on bar 0, Am on bar 1. |
| **CHARACTERS** | The 22-mod dict. **See "Adding a mod" below.** Body color must match the head sprite color — see comment above `SHEETS`. |
| **STANDARD_ORDER / MADBALLZ_ORDER** | Tray order arrays. Munkis are grouped by HEAD COLOR (green → orange → purple → blue) and Ice Munki + Moon Munki are pinned to the very end on **every page**, including the Madballz tray. |
| **HORROR_TRIGGER_MODS** | `Set(['moon', 'ice'])`. Auto-trigger jumpscare when one of these is placed (and wasn't already there). |
| **SHEETS** | `{ munki: {src, sheetW, sheetH, frames}, mb: {…} }`. Frame coords mirror the matching JSON. Munki frames are `{expr}-{color}` (5×8 = 40 frames); Madballz frames are `mb-{id}` (8 static frames). |
| **COLOR_BY_BODY** | Maps each Munki's `bodyColor` hex to its single-letter color code (B/G/O/P/R/X/Y/Z). Used by `headArt` to pick which column of `default-heads.png` to render. |
| **expressionForSlot(slotIndex)** | Returns 1..5 per slot based on game state. 2 during jumpscare or for ~600 ms after a fresh drop (`placedAt` Map). 3 if Ice is on stage. 5 if Moon is on stage. 1 otherwise. Ice/Moon themselves stay on row 1. |
| **isIceOnStage / updateIceFreeze** | Ice Munki freeze logic — toggles `.frozen-by-ice` on every other active slot when Ice is placed. |
| **moonRules / attachMoonChaos** | Moon Munki click chaos — `attachMoonChaos()` adds a document-level click listener; `moonRules()` picks a random effect (hue, invert, shuffle, rain, glitch text, tilt, phantom). |
| **ART** | `bodyArt(c)`, `headShapeArt(c)`, `headModArt(frameName, sheetName)`, `headPhonesArt()`, `hairArt(c)`, `headArt(c, expr)`, `characterArt(id, slotIndex?)`. All return SVG strings. |
| **HAIR** | `HAIR_STYLES`, `HAIR_COLORS`, `hairSvg(style, color, dark)`, `assignRandomHair()` (picks ~55% of mods at init, skips horror-trigger ones). |
| **STATE** | `slots = new Array(NUM_SLOTS).fill(null)` |
| **UI / RENDER** | `buildStage`, `renderTray`, `renderSlot`, `renderAllSlots`, `setSlot` |
| **DRAG & DROP** | Pointer events, single delegated stage click handler, `findSlotAt`. |
| **UI SOUNDS** | `playDropSound`, `playClearSound` |
| **JUMP SCARE** | `triggerJumpScare()` toggles `body.jumpscare` for 1.5s + `playJumpScareSound()` (distorted shriek + sub thud) |
| **HEADER BUTTONS** | `attachHeaderHandlers()` wires REMIX, CLEAR, SONG, BOO!, mute |
| **INIT** | `assignRandomHair()` → build → render → attach handlers |

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

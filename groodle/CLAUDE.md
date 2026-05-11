# Groodle — game-level guide

Scribble inside the silhouette, watch your drawing come alive and dance.

**Read the repo-root [`../CLAUDE.md`](../CLAUDE.md) first** for project-wide
rules (no build system, GitHub Pages deploy, "flat" game shape, GoatCounter
beacon, ad-free / kid-friendly branding). This file is only what's specific
to `groodle/`.

## What it is

- One frontal humanoid silhouette on a stage. Kid colors inside it with a
  palette + brush sizes; their strokes are clipped to the body shape via
  SVG `<clipPath id="bodyClip">`.
- DANCE button switches modes: drawing stops, the whole creature (silhouette
  + canvas as one unit) animates with translate / rotate / scale on every
  audio beat. Audio is procedural Web Audio — kick, snare, hat, bass, lead —
  no audio files anywhere.
- 4 MOVES × 4 BEATS combine for 16 grooves; kid cycles each independently
  with the ↻ MOVE / ↻ BEAT buttons.
- 4 background presets (studio, disco, outdoors, night) chosen via thumbnail
  buttons below the stage.

## File layout

```
groodle/
  index.html   — silhouette SVG + draw canvas + tool panels + bg picker
  style.css    — full stylesheet (no build, no preprocessor)
  game.js      — single IIFE; canvas drawing + audio engine + dance loop
  cover.jpg    — hub-page card art
```

All three are loaded directly by the browser. Path conventions match the
rest of the hub (relative for in-game assets, absolute for SEO / favicon).

## Architecture (`game.js`, top → bottom)

| Section | What lives there |
|---|---|
| **CONFIG** | `STAGE_W=400`, `STAGE_H=600`, `COLORS` (10), `SIZES` (4/12/22), `TEMPO=112`, `STEPS_PER_BAR=16`, `BARS_PER_LOOP=4`, `MOVES`, `BEATS` |
| **STATE** | `currentColor`, `currentSize`, `isErasing`, `isDrawing`, `lastX/Y`, `isPlaying`, `currentMoveIdx`, `currentBeatIdx`, `danceStartTime` |
| **AUDIO** | `audioCtx`, `masterGain` + `DynamicsCompressor`. `ensureAudio()` lazy-inits on first user click. `startAudio` / `stopAudio` drive the scheduler. |
| `scheduler()` | Look-ahead scheduler — every 25 ms, schedule any beats due in the next 100 ms. Advances `currentStep` (0..15) then increments `currentBar` (0..3). |
| `scheduleStep(step, bar, when)` | Per-beat dispatcher. Picks drum hits from the active `BEAT` pattern + bass / lead from the active `MOVE`. |
| **SYNTH VOICES** | `kick`, `snare`, `hat`, `bass`, `lead`. All synthesized with oscillators + filters; no samples. |
| **CANVAS** | `buildCanvas` sizes the canvas at `STAGE_W*dpr × STAGE_H*dpr` and scales the 2D context so coordinates are in logical 400×600 units. `getPos(e)` converts pointer coords to those logical units. `attachDrawing` wires the pointer events. |
| **TOOLS UI** | `buildPalette`, `buildSizes`, `attachBgPicker` — generates the swatches / size pucks and the 4 background thumbnails. |
| `drawSurprise()` | Goofy default character (skin fill, green shirt, blue pants, red star, eyes, smile, purple hair tufts) so kids can hit DANCE without drawing first. Relies on the clip to trim everything outside the silhouette. |
| **DANCE** | `startDance` / `stopDance` toggles the panel + audio. `danceFrame` runs the RAF loop. `applyMove(move, beats)` computes the per-move transform. `scheduleBubblePulse` flashes the corner bubble on quarter notes. |
| **INIT** | `init()` builds everything; fires on `DOMContentLoaded`. |

## The silhouette + clip trick

Three copies of the same 6 shapes (head circle + torso rect + 2 angled arms +
2 angled legs) live in `index.html` inside one `<svg>`:

```
.silhouette-fill        — pale white wash, visible to the kid as a guide
.silhouette-outline     — passed through #outlineFilter (feMorphology
                          dilate → composite out) to render a dark ring
                          around the union of the body shapes
<clipPath id="bodyClip"> — the SAME shapes again, used by CSS
                          clip-path: url(#bodyClip) on the .draw-canvas
                          so strokes are visually masked to the body
```

**The canvas itself isn't trimmed — strokes outside the body still hit the
backing bitmap, they're just hidden by the CSS clip.** That's important for
the "snapping" TODO below: if the kid drags outside the silhouette, the
stroke is invisible but technically painted, and the clip cleanly hides it.
This is the source of both the "stay in the lines" magic AND the perception
that the brush "snaps".

The creature `<div id="creature">` wraps both the silhouette and the draw
canvas, so when `applyMove()` sets `creature.style.transform`, the silhouette
and the kid's drawing both transform together — one cohesive sprite.
`transform-origin: 50% 92%` keeps the feet planted on the floor.

## Audio role assignments (the 16 combos)

Each `MOVE` controls melody/bass; each `BEAT` controls the drum pattern:

| | BOOM | FUNKY | SHUFFLE | WILD |
|---|---|---|---|---|
| **BOUNCE** | 4-on-floor, no bass | syncopated kick, no bass | shuffle ghost notes, no bass | scattered kicks, no bass |
| **TWIST** | + bass on quarter notes (root + 7th on step 8) | same +funky drums | +bass +shuffle drums | +bass +wild drums |
| **DISCO** | TWIST + 4-note lead phrase on bars 1 & 3 | same | same | same |
| **PARTY** | DISCO + lead hit on step 8 every bar | same | same | same |

When tweaking, drum hits live in the `if (beat === 'BOOM') {...}` blocks
inside `scheduleStep`. Bass/lead live just below in the `move !== 'BOUNCE'`
guards.

## Drawing flow

1. `pointerdown` on `.draw-canvas` → draws a single dot at the pointer,
   captures the pointer.
2. `pointermove` extends a stroke from `lastX/lastY` to the new position.
3. `pointerup` / `pointercancel` / `pointerleave` ends the stroke.
4. Eraser uses `globalCompositeOperation = 'destination-out'` to punch holes
   in whatever's painted.
5. `body.dancing .draw-canvas { pointer-events: none }` — drawing is hard-
   locked off while the creature is dancing.

DPR scaling matters: the canvas backing store is `STAGE_W*dpr × STAGE_H*dpr`,
the 2D context is scaled by `dpr`, and coords are normalized in `getPos()`
to the logical `400×600` space so JS only ever thinks in those units.

## Things that bite

- **Strokes outside the silhouette aren't blocked, just masked.** See the
  silhouette + clip section above. This means `drawSurprise()` can fill the
  entire `400×600` rect with skin tone and trust the clip to make it a
  body. Toggling the strict-drawing mode (TODO 2) is a JS change, not a
  geometry change.
- **`audioCtx` needs a user gesture to start.** `ensureAudio` lazy-inits,
  and `startDance` calls `audioCtx.resume()` before its `begin()` callback
  — don't try to schedule audio from page load.
- **The scheduler is look-ahead, not RAF-driven.** It advances 0..15 steps
  then loops; `currentBar` increments 0..3. `applyMove` runs on RAF and
  reads `audioCtx.currentTime - danceStartTime` for the beat phase, so the
  dance stays locked to the music even if frames drop.
- **`transform-origin` on `.creature` is `50% 92%`** so the feet stay
  planted. If you change pose dimensions, re-check this — a different pose
  height shifts where 92% lands and the feet will lift off / sink through
  the floor.
- **Don't change `STEPS_PER_BAR`** without auditing every literal step
  comparison in `scheduleStep` (`step === 4`, `step % 4 === 0`, etc.).
- **DPR sizing**: the canvas is set up once in `buildCanvas` from
  `window.devicePixelRatio`. It does **not** re-init on viewport / pixel-
  ratio changes, so dragging a window between displays of different DPR
  can blur strokes until reload.
- **Surprise relies on the clip.** `drawSurprise()` paints rects across the
  whole `400×600` rectangle (skin tone everywhere, shirt 0-400 x 175-350,
  pants 0-400 x 350-570). It only looks like a body because the clip
  trims everything outside the silhouette. If the clip ever changes shape,
  surprise will look wrong.

## How to make common changes

### Add a new color or brush size
- Color: append a hex to the `COLORS` array in `game.js`. Palette UI is
  data-driven — `buildPalette` renders one swatch per entry.
- Brush size: append a number to `SIZES`. `buildSizes` renders one button
  per entry; the visual dot inside scales with the value (clamped 6–28 px).

### Add a new background
1. Add a new `.bg-newname { background: ... }` rule to `style.css` under
   the "background variants" section.
2. Add a `<button class="bg-thumb" data-bg="newname">` to the `.bg-picker`
   in `index.html`, with a matching `<span class="bg-preview bg-newname">`
   inside.
3. `attachBgPicker` is data-driven via `data-bg`; no JS change needed.

### Add a new MOVE or BEAT
1. Append to the `MOVES` or `BEATS` arrays at the top of `game.js`.
2. Add a new branch inside `applyMove()` (MOVE) or `scheduleStep()` (BEAT)
   that handles the new id. The pattern is the same as the existing four.
3. Cycle buttons in `dancePanel` cycle through the arrays automatically.

### Swap or add a silhouette pose
This is bigger — it touches three SVG groups in `index.html` that must
stay in sync:
- `.silhouette-fill > g` (the pale wash)
- `.silhouette-outline > g` (input to the outline filter)
- `<clipPath id="bodyClip">` (controls where strokes are visible)

All three must contain the **same shapes** or the clip won't match the
visible body. There's no pose abstraction today — see TODO 1 below for
what a real pose system would look like.

## Local dev

```bash
python -m http.server 8000
# then open http://localhost:8000/groodle/
```

GitHub Pages auto-deploys on push to `main`; the file you see live is the
file at the committed SHA.

## TODOs (pending — Bala's feedback)

These are open work items, in rough priority order. Each is sized for a
single focused session.

### 1. Increase amount of poses and backgrounds

**Poses (bigger work, ~1 session):**
- Today there's exactly one silhouette: a front-facing humanoid (head + torso
  + 2 arms + 2 legs). The shapes are duplicated three times in
  `index.html` (fill / outline / clipPath).
- To add more poses cleanly, extract a `POSES` data structure where each
  entry is a list of `{ shape, attrs }` and have JS inject the same shapes
  into all three SVG groups + the clip. Then add a pose-picker UI similar
  to the background picker.
- Pose candidates to try: side profile (one-arm extended), arms-up
  ("yay!"), seated, animal (cat / dog), abstract blob (no-rules drawing).
- Each pose needs to re-anchor `transform-origin` if its bottom isn't at
  ~92% (e.g. seated pose's "feet" might be at 75%).

**Backgrounds (easier, ~30 min):**
- Add 3-4 more under `style.css` "background variants" section, register
  them in the `.bg-picker` in `index.html`. No JS change.
- Candidates: stadium / concert (spotlight beams), underwater, rainbow,
  forest at dawn, candy land.

### 2. Fix figure "snapping" for coloring within the lines

The current behavior: strokes outside the silhouette are drawn to the
canvas but visually masked by `clip-path: url(#bodyClip)`. To the kid this
reads as "my brush snaps to the body" — strokes appear and disappear at
the silhouette edge with no warning.

Three approaches, ranked by effort:
- **(a) Visual feedback (easy):** keep the current clip but render a faint
  ghost stroke outside the silhouette so the kid sees their input is
  registered. A duplicate canvas under the clip, slightly transparent.
- **(b) Hard block (medium):** detect whether the pointer is inside the
  silhouette in `getPos()` (point-in-path against the clip shapes) and
  skip the stroke draw if outside. Pointer is still captured so a drag
  that crosses back in continues correctly.
- **(c) Stroke clamping (hardest):** when the pointer leaves the body,
  draw the line up to the silhouette edge instead of past it. Needs a
  line-segment / clip-shape intersection. Most satisfying feel but real
  geometry work.

Pick one based on how strict we want "stay in the lines" to feel. (a) +
(b) together would probably give the best kid UX: the brush won't paint
outside, but the kid sees their finger / cursor is still tracked.

### 3. Improve layout

Current layout is mobile-first single-column: stage → bg-picker → tool
panel → footer. Known rough edges:
- On landscape / desktop the tool panel falls way below the stage with
  wasted side gutters. A horizontal layout (tools to one side of the
  stage) would use the screen better.
- The hint tag ("STAY IN THE LINES TO GROOVE!") overlaps the bg-picker
  on small phones.
- `.stage` is `width: min(94vw, 380px)` — caps narrower than it needs to
  on tablets.
- The dance panel (MOVE / BEAT / DRAW buttons) is fine on mobile but
  could be a sidebar on desktop.

Likely fix: a CSS grid layout with media-query breakpoints at ~720 px and
~1100 px. Keep mobile single-column; tablet = stage + tools side-by-side;
desktop = same but bigger stage.
